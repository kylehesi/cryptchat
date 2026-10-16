// Peer-to-peer file transfer (ARCHITECTURE §10). Never touches the DOM.
//
// Control channel:  file-offer {id,name,size} → file-accept {id} | file-decline {id,reason}
//                   file-cancel {id,reason} (either side, any time)
// Per transfer:     the sender opens a DataChannel "file:<id>" after the accept and streams
//                   64 KB binary chunks, then {type:'end',bytes}. The receiver answers on the
//                   same channel with {type:'ack',bytes} (flow control) and {type:'done'}.
//
// Integrity: DTLS authenticates and encrypts every chunk, and the channel is reliable and
// ordered, so data cannot be altered or reordered in transit. The receiver additionally checks
// the exact byte count before the file gets its final name.
//
// Events: 'change' { transfer }  (any state or progress change; progress is throttled)

import { log } from '../core/logger.js';
import { decodeMessage, encodeMessage } from '../net/protocol.js';

const CHUNK_BYTES = 64 * 1024;
const MAX_BUFFERED = 4 * 1024 * 1024; // pause sending above this DataChannel buffer
const BUFFER_LOW = 1 * 1024 * 1024;
const WINDOW_BYTES = 16 * 1024 * 1024; // max sent-but-not-yet-written bytes (protects the receiver's RAM)
const ACK_EVERY = 1 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 150;
const MAX_NAME_CHARS = 255;
const TRANSFER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_PREFIX = 'file:';

/**
 * @typedef {{ id: string, direction: 'out' | 'in', name: string, size: number, bytes: number,
 *             status: 'waiting' | 'offered' | 'opening' | 'active' | 'finishing' | 'done' | 'declined' | 'canceled' | 'failed',
 *             reason?: string, savedAs?: string, startedAt?: number, endedAt?: number }} Transfer
 */

export class FileTransfers extends EventTarget {
  /** @type {Map<string, Transfer & { [key: string]: any }>} */
  transfers = new Map();

  /** @param {import('../net/connection.js').Connection} connection */
  constructor(connection) {
    super();
    this.connection = connection;

    connection.addEventListener('peer-message', ({ detail }) => {
      if (detail.channel === 'control' && detail.message.type.startsWith('file-')) this.#onControl(detail.message);
    });
    connection.addEventListener('datachannel', ({ detail }) => {
      if (detail.channel.label.startsWith(CHANNEL_PREFIX)) this.#onIncomingChannel(detail.channel);
    });
    connection.addEventListener('phase', ({ detail }) => {
      if (detail.phase !== 'idle' && detail.phase !== 'failed') return;
      for (const transfer of this.transfers.values()) {
        if (isOpen(transfer)) this.#finish(transfer, 'failed', 'link closed');
      }
    });
  }

  get canSend() {
    return this.connection.phase === 'connected';
  }

  /** Offers files to the peer. Each file becomes its own transfer. */
  send(files) {
    if (!this.canSend) {
      log.err('No active link: cannot send files.');
      return;
    }
    for (const file of files) {
      const transfer = { id: crypto.randomUUID(), direction: 'out', name: file.name, size: file.size, bytes: 0, acked: 0, status: 'waiting', file };
      this.transfers.set(transfer.id, transfer);
      this.connection.send('control', 'file-offer', { id: transfer.id, name: file.name, size: file.size });
      log.info(`File offered: ${file.name} (${formatBytes(file.size)}). Waiting for the peer to accept.`);
      this.#changed(transfer);
    }
  }

  /** Receiver: accept an offered file. It is saved to Downloads\CryptChat. */
  async accept(id) {
    const transfer = this.transfers.get(id);
    if (transfer?.direction !== 'in' || transfer.status !== 'offered') return;
    transfer.status = 'opening';
    this.#changed(transfer);

    const opened = await window.cc.files.open(id, transfer.name, transfer.size);
    if (transfer.status !== 'opening') {
      // Canceled while the file was being created: remove the fresh .part file again.
      if (opened.ok) window.cc.files.abort(id);
      return;
    }
    if (!opened.ok) {
      this.connection.send('control', 'file-decline', { id, reason: opened.error });
      this.#finish(transfer, 'failed', opened.error);
      return;
    }
    transfer.savedAs = opened.fileName;
    transfer.written = 0;
    transfer.lastAck = 0;
    transfer.writeChain = Promise.resolve();
    transfer.status = 'active';
    transfer.startedAt = performance.now();
    this.connection.send('control', 'file-accept', { id });
    this.#changed(transfer);
  }

  decline(id) {
    const transfer = this.transfers.get(id);
    if (transfer?.direction !== 'in' || transfer.status !== 'offered') return;
    this.connection.send('control', 'file-decline', { id, reason: 'declined' });
    this.#finish(transfer, 'declined');
  }

  cancel(id) {
    const transfer = this.transfers.get(id);
    if (!transfer || !isOpen(transfer)) return;
    this.connection.send('control', 'file-cancel', { id, reason: 'canceled' });
    this.#finish(transfer, 'canceled', 'by you');
  }

  reveal(id) {
    window.cc.files.reveal(id).then((result) => {
      if (!result.ok) log.warn(result.error);
    });
  }

  // --- control messages ----------------------------------------------------------------

  #onControl(message) {
    const id = typeof message.id === 'string' && TRANSFER_ID.test(message.id) ? message.id : null;
    if (!id) return;
    const transfer = this.transfers.get(id);

    switch (message.type) {
      case 'file-offer': {
        const { name, size } = message;
        if (transfer || typeof name !== 'string' || !name || name.length > MAX_NAME_CHARS) return;
        if (!Number.isSafeInteger(size) || size < 0) return;
        const incoming = { id, direction: 'in', name, size, bytes: 0, status: 'offered' };
        this.transfers.set(id, incoming);
        log.info(`Incoming file: ${name} (${formatBytes(size)}). Accept or decline in the chat.`);
        this.#changed(incoming);
        break;
      }
      case 'file-accept':
        if (transfer?.direction === 'out' && transfer.status === 'waiting') this.#startSending(transfer);
        break;
      case 'file-decline':
        if (transfer?.direction === 'out' && transfer.status === 'waiting') {
          const reason = typeof message.reason === 'string' && message.reason !== 'declined' ? message.reason.slice(0, 200) : undefined;
          this.#finish(transfer, reason ? 'failed' : 'declined', reason ? `peer could not receive: ${reason}` : undefined);
        }
        break;
      case 'file-cancel':
        if (transfer && isOpen(transfer)) this.#finish(transfer, 'canceled', 'by peer');
        break;
      default:
        break;
    }
  }

  // --- sending ---------------------------------------------------------------------------

  #startSending(transfer) {
    const channel = this.connection.openChannel(CHANNEL_PREFIX + transfer.id);
    if (!channel) {
      this.#finish(transfer, 'failed', 'link closed');
      return;
    }
    transfer.channel = channel;
    transfer.status = 'active';
    transfer.startedAt = performance.now();
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFER_LOW;

    channel.addEventListener('bufferedamountlow', () => transfer.wake?.());
    channel.addEventListener('open', () => this.#pump(transfer));
    channel.addEventListener('message', ({ data }) => {
      const message = decodeMessage(data);
      if (message?.type === 'ack' && Number.isSafeInteger(message.bytes)) {
        transfer.acked = Math.max(transfer.acked, message.bytes);
        transfer.wake?.();
      } else if (message?.type === 'done') {
        this.#finish(transfer, 'done');
      } else if (message?.type === 'error') {
        this.#finish(transfer, 'failed', `peer: ${String(message.reason).slice(0, 200)}`);
      }
    });
    channel.addEventListener('close', () => {
      if (isOpen(transfer)) this.#finish(transfer, 'failed', 'channel closed');
    });
    this.#changed(transfer);
  }

  async #pump(transfer) {
    const { channel } = transfer;
    const reader = transfer.file.stream().getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < value.byteLength; offset += CHUNK_BYTES) {
          await this.#waitForRoom(transfer);
          if (transfer.status !== 'active') return;
          const piece = value.subarray(offset, offset + CHUNK_BYTES);
          channel.send(piece);
          transfer.bytes += piece.byteLength;
          this.#progress(transfer);
        }
      }
      if (transfer.status !== 'active') return;
      channel.send(encodeMessage('end', { bytes: transfer.bytes }));
      transfer.status = 'finishing';
      this.#changed(transfer);
    } catch (error) {
      if (transfer.status === 'active') {
        this.connection.send('control', 'file-cancel', { id: transfer.id, reason: 'read error' });
        this.#finish(transfer, 'failed', `could not read the file (${error.message})`);
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /** Waits until the channel buffer has room and the receiver has caught up. */
  async #waitForRoom(transfer) {
    const { channel } = transfer;
    while (
      transfer.status === 'active' &&
      (channel.bufferedAmount > MAX_BUFFERED || transfer.bytes - transfer.acked > WINDOW_BYTES)
    ) {
      await new Promise((resolve) => {
        transfer.wake = resolve;
      });
      transfer.wake = null;
    }
  }

  // --- receiving -------------------------------------------------------------------------

  #onIncomingChannel(channel) {
    const transfer = this.transfers.get(channel.label.slice(CHANNEL_PREFIX.length));
    if (transfer?.direction !== 'in' || transfer.status !== 'active' || transfer.channel) {
      channel.close(); // not a transfer we accepted
      return;
    }
    transfer.channel = channel;
    channel.binaryType = 'arraybuffer';

    channel.addEventListener('message', ({ data }) => {
      if (data instanceof ArrayBuffer) this.#receiveChunk(transfer, data);
      else if (decodeMessage(data)?.type === 'end') this.#completeReceive(transfer, decodeMessage(data).bytes);
    });
    channel.addEventListener('close', () => {
      if (isOpen(transfer)) this.#finish(transfer, 'failed', 'channel closed');
    });
  }

  #receiveChunk(transfer, data) {
    if (transfer.status !== 'active') return;
    if (transfer.bytes + data.byteLength > transfer.size) {
      this.#failReceive(transfer, 'peer sent more data than announced');
      return;
    }
    transfer.bytes += data.byteLength; // received; `written` trails behind until the disk catches up
    this.#progress(transfer);

    // Writes are chained so they hit the disk strictly in order.
    transfer.writeChain = transfer.writeChain.then(async () => {
      if (transfer.status !== 'active' && transfer.status !== 'finishing') return;
      const result = await window.cc.files.write(transfer.id, new Uint8Array(data));
      if (!result.ok) {
        this.#failReceive(transfer, result.error);
        return;
      }
      transfer.written = result.written;
      if (transfer.written - transfer.lastAck >= ACK_EVERY) {
        transfer.lastAck = transfer.written;
        this.#sendOnChannel(transfer, 'ack', { bytes: transfer.written });
      }
    });
  }

  #completeReceive(transfer, announced) {
    if (transfer.status !== 'active') return;
    transfer.status = 'finishing';
    this.#changed(transfer);

    transfer.writeChain = transfer.writeChain.then(async () => {
      if (transfer.status !== 'finishing') return;
      if (announced !== transfer.size || transfer.written !== transfer.size) {
        this.#failReceive(transfer, `size mismatch (${transfer.written} of ${transfer.size} bytes)`);
        return;
      }
      const closed = await window.cc.files.close(transfer.id);
      if (!closed.ok) {
        this.#failReceive(transfer, closed.error);
        return;
      }
      transfer.savedAs = closed.fileName;
      this.#sendOnChannel(transfer, 'done');
      this.#finish(transfer, 'done');
    });
  }

  #failReceive(transfer, reason) {
    if (!isOpen(transfer)) return;
    this.#sendOnChannel(transfer, 'error', { reason });
    this.#finish(transfer, 'failed', reason);
  }

  #sendOnChannel(transfer, type, fields) {
    if (transfer.channel?.readyState === 'open') transfer.channel.send(encodeMessage(type, fields));
  }

  // --- shared ----------------------------------------------------------------------------

  #finish(transfer, status, reason) {
    if (!isOpen(transfer)) return;
    // Receiver: from 'opening' on, a .part file may exist in the main process.
    const wasActive = transfer.status !== 'offered' && transfer.status !== 'waiting';
    transfer.status = status;
    transfer.reason = reason;
    transfer.endedAt = performance.now();
    transfer.wake?.();
    transfer.file = null; // let the File be garbage-collected

    if (transfer.direction === 'in' && status !== 'done' && wasActive) window.cc.files.abort(transfer.id);
    // Let queued messages ('done', 'error') flush before closing the channel.
    const channel = transfer.channel;
    if (channel) setTimeout(() => channel.close(), status === 'done' ? 1000 : 0);

    const verb = transfer.direction === 'out' ? 'sent' : 'received';
    if (status === 'done') {
      const seconds = Math.max(0.001, (transfer.endedAt - transfer.startedAt) / 1000);
      const where = transfer.direction === 'in' ? ` → Downloads\\CryptChat\\${transfer.savedAs}` : '';
      log.ok(`File ${verb}: ${transfer.name} (${formatBytes(transfer.size)}, ${formatBytes(transfer.size / seconds)}/s)${where}`);
    } else {
      const label = { declined: 'declined', canceled: 'canceled', failed: 'failed' }[status];
      const line = `File ${label}: ${transfer.name}${reason ? ` (${reason})` : ''}`;
      // Our own cancel/decline only confirms a click: no notification for it.
      const ownAction = reason === 'by you' || (status === 'declined' && transfer.direction === 'in');
      if (status === 'failed') log.err(line);
      else log.warn(line, { notify: !ownAction });
    }
    this.#changed(transfer);
  }

  #progress(transfer) {
    const now = performance.now();
    if (now - (transfer.lastEmit ?? 0) < PROGRESS_INTERVAL_MS && transfer.bytes < transfer.size) return;
    transfer.lastEmit = now;
    this.#changed(transfer);
  }

  #changed(transfer) {
    this.dispatchEvent(new CustomEvent('change', { detail: { transfer } }));
  }
}

/** Not finished yet (including an offer nobody has answered). */
function isOpen(transfer) {
  return ['offered', 'waiting', 'opening', 'active', 'finishing'].includes(transfer.status);
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
