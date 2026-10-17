// Central log. Modules write here; the KERNEL_LOG panel (ui/log-panel.js) renders it.
// This file never touches the DOM.
//
// Entries: { level: 'info' | 'ok' | 'warn' | 'err', message, time, notify }
// `notify` (default true) lets warnings/errors raise a notification. Pass { notify: false } for
// messages that only confirm something the user just did ("Link terminated.").

const MAX_HISTORY = 500;

const target = new EventTarget();
const history = [];

function write(level, message, { notify = true } = {}) {
  const entry = { level, message: String(message), time: new Date(), notify };

  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();

  target.dispatchEvent(new CustomEvent('entry', { detail: entry }));

  const sink = level === 'err' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(`[${level}] ${entry.message}`);
}

export const log = {
  info: (message, options) => write('info', message, options),
  ok: (message, options) => write('ok', message, options),
  warn: (message, options) => write('warn', message, options),
  err: (message, options) => write('err', message, options),

  /** A copy of the kept history, oldest first (e.g. to redraw the log panel). */
  history: () => [...history],

  /** Replays existing history to `fn`, then calls it for every new entry. Returns an unsubscribe function. */
  subscribe(fn) {
    history.forEach(fn);
    const handler = (event) => fn(event.detail);
    target.addEventListener('entry', handler);
    return () => target.removeEventListener('entry', handler);
  },
};
