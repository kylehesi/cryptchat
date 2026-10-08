// Central log. Modules write here; the KERNEL_LOG panel (ui/log-panel.js) renders it.
// This file never touches the DOM.

const MAX_HISTORY = 500;

const target = new EventTarget();
const history = [];

function write(level, message) {
  const entry = { level, message: String(message), time: new Date() };

  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();

  target.dispatchEvent(new CustomEvent('entry', { detail: entry }));

  const sink = level === 'err' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(`[${level}] ${entry.message}`);
}

export const log = {
  info: (message) => write('info', message),
  ok: (message) => write('ok', message),
  warn: (message) => write('warn', message),
  err: (message) => write('err', message),

  /** Replays existing history to `fn`, then calls it for every new entry. Returns an unsubscribe function. */
  subscribe(fn) {
    history.forEach(fn);
    const handler = (event) => fn(event.detail);
    target.addEventListener('entry', handler);
    return () => target.removeEventListener('entry', handler);
  },
};
