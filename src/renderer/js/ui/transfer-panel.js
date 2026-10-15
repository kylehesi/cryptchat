import { formatBytes } from '../transfer/file-transfer.js';
import { CHAT_MAX_LINES } from './chat-panel.js';
import { appendToLog } from './scroll-log.js';

const BAR_CELLS = 16;
const RISKY_EXTENSIONS = new Set([
  'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'hta', 'lnk', 'reg', 'dll', 'cpl', 'msc', 'jar', 'iso', 'img', 'vhd', 'vhdx',
]);

/**
 * Shows transfers as lines in the chat log, plus the [ + ] button and drag & drop.
 * Everything from the peer (file name) is rendered with textContent only.
 */
export function mountTransferPanel({ transfers, chat, connection, els }) {
  const { chatPanel, chatLog, fileButton, fileInput } = els;
  const lines = new Map(); // transfer id → line element

  // --- sending: button + drag & drop -----------------------------------------------------

  fileButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) transfers.send([...fileInput.files]);
    fileInput.value = '';
  });

  // Never let a dropped file navigate the window, wherever it lands.
  for (const type of ['dragover', 'drop']) document.addEventListener(type, (event) => event.preventDefault());

  chatPanel.addEventListener('dragover', (event) => {
    if (!transfers.canSend || !event.dataTransfer?.types.includes('Files')) return;
    event.dataTransfer.dropEffect = 'copy';
    chatPanel.classList.add('is-dropping');
  });
  chatPanel.addEventListener('dragleave', (event) => {
    if (!chatPanel.contains(event.relatedTarget)) chatPanel.classList.remove('is-dropping');
  });
  chatPanel.addEventListener('drop', (event) => {
    chatPanel.classList.remove('is-dropping');
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length && transfers.canSend) transfers.send(files);
  });

  connection.addEventListener('phase', () => {
    fileButton.disabled = !transfers.canSend;
  });
  fileButton.disabled = true;

  // --- rendering -------------------------------------------------------------------------

  transfers.addEventListener('change', ({ detail }) => {
    const { transfer } = detail;
    let line = lines.get(transfer.id);
    if (!line) {
      line = document.createElement('div');
      line.className = 'chat-line transfer';
      lines.set(transfer.id, line);
      render(line, transfer);
      appendToLog(chatLog, line, CHAT_MAX_LINES);
      return;
    }
    // Updating in place can change the line's height: keep the log pinned if it was.
    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 24;
    render(line, transfer);
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  });

  function render(line, transfer) {
    // Progress ticks only swap the state row. Rebuilding the buttons several times a second
    // would swallow clicks (mousedown on one element, mouseup on its replacement).
    if (line.dataset.status === transfer.status) {
      line.children[1].replaceWith(stateLine(transfer));
      return;
    }
    line.dataset.status = transfer.status;

    const outgoing = transfer.direction === 'out';
    const alias = outgoing ? chat.alias || 'YOU' : chat.remoteAlias || 'PEER';

    const head = document.createElement('div');
    head.append(
      span(outgoing ? 'chat-alias is-local' : 'chat-alias is-remote', `[ ${alias} ]`),
      ' > ',
      span('transfer-meta', outgoing ? 'FILE ⇪ ' : 'FILE ⇩ '),
      span('transfer-name', transfer.name),
      ' ',
      span('transfer-size', `(${formatBytes(transfer.size)})`),
    );

    const parts = [head, stateLine(transfer)];
    if (!outgoing && transfer.status === 'offered' && isRisky(transfer.name)) {
      parts.push(div('transfer-warn', '⚠ PROGRAM/SCRIPT: open only if you trust the sender.'));
    }
    const actions = actionButtons(transfer);
    if (actions.length) {
      const row = div('transfer-actions');
      row.append(...actions);
      parts.push(row);
    }
    line.replaceChildren(...parts);
  }

  function stateLine(transfer) {
    const outgoing = transfer.direction === 'out';
    switch (transfer.status) {
      case 'waiting':
        return div('transfer-state', 'WAITING FOR PEER TO ACCEPT...');
      case 'offered':
        return div('transfer-state', 'INCOMING FILE. Saved to Downloads\\CryptChat if accepted.');
      case 'opening':
        return div('transfer-state', 'PREPARING...');
      case 'active':
      case 'finishing': {
        const ratio = transfer.size ? transfer.bytes / transfer.size : 1;
        const filled = Math.round(ratio * BAR_CELLS);
        const seconds = Math.max(0.001, (performance.now() - transfer.startedAt) / 1000);
        const speed = transfer.bytes / seconds;
        const eta = speed > 0 ? Math.ceil((transfer.size - transfer.bytes) / speed) : null;
        const row = div('transfer-state');
        row.append(
          span('transfer-bar', `[${'#'.repeat(filled)}${'.'.repeat(BAR_CELLS - filled)}]`),
          ` ${Math.floor(ratio * 100)}% · ${formatBytes(speed)}/s`,
          transfer.status === 'finishing' ? ' · FINALIZING' : eta != null ? ` · ${formatEta(eta)}` : '',
        );
        return row;
      }
      case 'done':
        return div('transfer-state is-done', outgoing ? '✓ DELIVERED' : `✓ SAVED as ${transfer.savedAs}`);
      case 'declined':
        return div('transfer-state is-bad', outgoing ? '✗ DECLINED by peer' : '✗ DECLINED');
      case 'canceled':
        return div('transfer-state is-bad', `✗ CANCELED${transfer.reason ? ` ${transfer.reason}` : ''}`);
      default:
        return div('transfer-state is-bad', `✗ FAILED${transfer.reason ? `: ${transfer.reason}` : ''}`);
    }
  }

  function actionButtons(transfer) {
    const { id, status, direction } = transfer;
    if (status === 'offered') {
      return [button('ACCEPT', () => transfers.accept(id), 'btn-accent'), button('DECLINE', () => transfers.decline(id))];
    }
    if (['waiting', 'opening', 'active', 'finishing'].includes(status)) {
      return [button('CANCEL', () => transfers.cancel(id))];
    }
    if (status === 'done' && direction === 'in') {
      return [button('OPEN_FOLDER', () => transfers.reveal(id))];
    }
    return [];
  }
}

function isRisky(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && RISKY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function formatEta(seconds) {
  if (seconds < 60) return `${seconds}s left`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s left`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}

function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function div(className, text = '') {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label, onClick, extraClass = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `btn btn-tiny ${extraClass}`.trim();
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}
