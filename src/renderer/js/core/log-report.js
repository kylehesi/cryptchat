// COPY_LOG: the KERNEL_LOG as plain text for a bug report. Personal details are always masked,
// whatever HIDE_IP_AND_PAYLOAD says, because the text is meant to be posted publicly:
//   - IP addresses (v4 and v6),
//   - STUN/TURN host names (custom TURN servers can identify the user),
//   - payloads (CC1.…), should one ever end up in a message,
//   - anything a module marked with secret(): file names, window titles, aliases.
// Never touches the DOM.

const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
// Compressed or full IPv6 (at least two groups with "::", or eight groups).
const IPV6 = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?\b|::(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4}\b/gi;
const ICE_URL_HOST = /\b(stuns?|turns?):(?!\[)[^\s:?/]+/gi; // keeps the scheme and port
const PAYLOAD = /\bCC1\.[A-Za-z0-9_-]{8,}/g;

const LEVEL_TAGS = { info: 'INFO', ok: 'OK  ', warn: 'WARN', err: 'ERR ' };
const MAX_REPORT_CHARS = 60000; // the clipboard bridge accepts 64 KiB

/** Masks IPv4 and IPv6 addresses (also used on screen by HIDE_IP_AND_PAYLOAD). */
export function maskIps(text) {
  return String(text).replace(IPV4, '•••.•••.•••.•••').replace(IPV6, '••••:••••::••••');
}

/** One log message, as it may be posted publicly. */
export function redactMessage(text) {
  return maskIps(String(text).replace(PAYLOAD, 'CC1.[payload]').replace(ICE_URL_HOST, '$1:[host]'));
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
const day = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * @param {{ level: string, message: string, redacted?: string, time: Date }[]} entries  oldest first
 * @param {{ version: string, electron: string, chrome: string, platform: string, now?: Date, maxChars?: number }} meta
 * @returns {{ text: string, lines: number, omitted: number }}
 */
export function formatLogReport(entries, { version, electron, chrome, platform, now = new Date(), maxChars = MAX_REPORT_CHARS }) {
  const header = [
    `CryptChat v${version} · Electron ${electron} · Chromium ${chrome} · ${platform}`,
    `KERNEL_LOG copied ${day(now)} ${clock(now)} (local time).`,
    'Masked: IP addresses, STUN/TURN hosts, payloads, file names, window titles, aliases.',
    '',
  ];
  const lines = entries.map((entry) => `[${clock(entry.time)}] ${LEVEL_TAGS[entry.level] ?? entry.level} ${redactMessage(entry.redacted ?? entry.message)}`);

  // Too long for the clipboard: keep the newest lines, they matter most for a bug.
  let budget = maxChars - header.join('\n').length - 80;
  let first = lines.length;
  while (first > 0 && budget - (lines[first - 1].length + 1) >= 0) {
    first -= 1;
    budget -= lines[first].length + 1;
  }
  const omitted = first;
  const kept = lines.slice(first);
  if (omitted) header.push(`(${omitted} older line(s) left out to fit the clipboard)`);
  return { text: [...header, ...kept].join('\n') + '\n', lines: kept.length, omitted };
}
