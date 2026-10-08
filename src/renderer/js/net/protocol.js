// Envelope for every DataChannel message: { v, type, ...fields }. See ARCHITECTURE §9.

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_CHARS = 16 * 1024;

export function encodeMessage(type, fields = {}) {
  return JSON.stringify({ ...fields, v: PROTOCOL_VERSION, type });
}

/** Returns the parsed message, or null if it is not a valid envelope. Never throws. */
export function decodeMessage(data) {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_CHARS) return null;

  let message;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }

  if (message === null || typeof message !== 'object') return null;
  if (message.v !== PROTOCOL_VERSION || typeof message.type !== 'string') return null;
  return message;
}
