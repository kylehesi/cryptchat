// Text chat over the 'chat' DataChannel, plus alias exchange over 'control'.
// Never touches the DOM; ui/chat-panel.js renders it.
//
// Events (CustomEvent.detail):
//   'ready'         { ready }                       chat channel usable or not
//   'message'       { from: 'local' | 'remote', alias, text, time }
//   'local-alias'   { alias }                       '' when unset
//   'remote-alias'  { alias }                       null when no peer

const ALIAS_STORAGE_KEY = 'cc.alias';
const MAX_ALIAS_CHARS = 16;
const MAX_TEXT_CHARS = 2000;
export const FALLBACK_ALIAS = 'ANON';

// Control characters, plus bidirectional overrides that could visually disguise text.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

/** Uppercase A–Z, 0–9, _ . - only; at most 16 chars. Returns '' if nothing usable is left. */
export function sanitizeAlias(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9_.-]/g, '')
    .slice(0, MAX_ALIAS_CHARS);
}

/** Single line, no control/bidi characters, at most 2000 chars. */
export function sanitizeText(raw) {
  return String(raw ?? '').replace(UNSAFE_CHARS, '').trim().slice(0, MAX_TEXT_CHARS);
}

export class Chat extends EventTarget {
  ready = false;
  alias = loadAlias();
  /** @type {string | null} */
  remoteAlias = null;

  /** @param {import('../net/connection.js').Connection} connection */
  constructor(connection) {
    super();
    this.connection = connection;

    connection.addEventListener('channel-open', ({ detail }) => {
      if (detail.name === 'control') this.#sendProfile();
      if (detail.name === 'chat') this.#setReady(true);
    });

    connection.addEventListener('phase', ({ detail }) => {
      if (detail.phase !== 'idle' && detail.phase !== 'failed') return;
      this.#setReady(false);
      this.#setRemoteAlias(null);
    });

    connection.addEventListener('peer-message', ({ detail }) => {
      const { channel, message } = detail;
      if (channel === 'control' && message.type === 'profile') {
        this.#setRemoteAlias(sanitizeAlias(message.alias) || null);
      } else if (channel === 'chat' && message.type === 'chat') {
        this.#receive(message);
      }
    });
  }

  /** Sets and persists the local alias, and tells the peer. Returns the sanitized alias. */
  setAlias(raw) {
    this.alias = sanitizeAlias(raw);
    saveAlias(this.alias);
    this.#emit('local-alias', { alias: this.alias });
    this.#sendProfile();
    return this.alias;
  }

  /** Sends a message. Returns false if there was nothing to send or the channel is closed. */
  send(raw) {
    const text = sanitizeText(raw);
    if (!text) return false;

    const alias = this.alias || FALLBACK_ALIAS;
    const sent = this.connection.send('chat', 'chat', { id: crypto.randomUUID(), alias, text });
    if (sent) this.#emit('message', { from: 'local', alias, text, time: new Date() });
    return sent;
  }

  #receive(message) {
    if (typeof message.text !== 'string') return;
    const text = sanitizeText(message.text);
    if (!text) return;

    const alias = sanitizeAlias(message.alias) || this.remoteAlias || FALLBACK_ALIAS;
    // Local receive time: the peer's clock is not trustworthy.
    this.#emit('message', { from: 'remote', alias, text, time: new Date() });
  }

  #sendProfile() {
    this.connection.send('control', 'profile', { alias: this.alias });
  }

  #setReady(ready) {
    if (this.ready === ready) return;
    this.ready = ready;
    this.#emit('ready', { ready });
  }

  #setRemoteAlias(alias) {
    if (this.remoteAlias === alias) return;
    this.remoteAlias = alias;
    this.#emit('remote-alias', { alias });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// The alias is a per-device convenience; storage may be unavailable, so never let it throw.
function loadAlias() {
  try {
    return sanitizeAlias(localStorage.getItem(ALIAS_STORAGE_KEY));
  } catch {
    return '';
  }
}

function saveAlias(alias) {
  try {
    localStorage.setItem(ALIAS_STORAGE_KEY, alias);
  } catch {
    // ignore
  }
}
