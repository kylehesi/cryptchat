// Turns an RTCSessionDescription into a compact copy-paste string and back.
//
//   CC1.<base64url( deflate-raw( JSON{ v, t, sdp } ) )>
//
// The prefix versions the format and lets us reject random pasted text with a clear error.

const PREFIX = 'CC1.';
const FORMAT_VERSION = 1;
const MAX_ENCODED_CHARS = 64 * 1024;
const MAX_DECODED_BYTES = 256 * 1024; // guards against decompression bombs

export class PayloadError extends Error {}

export async function encodePayload(description) {
  const json = JSON.stringify({ v: FORMAT_VERSION, t: description.type, sdp: description.sdp });
  const compressed = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  return PREFIX + bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
}

/** Returns `{ type: 'offer' | 'answer', sdp }` or throws PayloadError with a user-facing message. */
export async function decodePayload(text) {
  // Chat apps like to wrap long strings; whitespace is never part of the payload.
  const clean = String(text).replace(/\s+/g, '');

  if (!clean) throw new PayloadError('Remote payload is empty.');
  if (clean.length > MAX_ENCODED_CHARS) throw new PayloadError('Remote payload is too large.');
  if (!clean.startsWith(PREFIX)) throw new PayloadError('Not a CryptChat payload (missing CC1 prefix).');

  let bytes;
  try {
    bytes = Uint8Array.fromBase64(clean.slice(PREFIX.length), { alphabet: 'base64url' });
  } catch {
    throw new PayloadError('Payload is corrupted (invalid characters). Copy it again.');
  }

  let json;
  try {
    json = await inflateWithLimit(bytes, MAX_DECODED_BYTES);
  } catch (error) {
    if (error instanceof PayloadError) throw error;
    throw new PayloadError('Payload is corrupted or truncated. Copy it again.');
  }

  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new PayloadError('Payload is corrupted (bad JSON).');
  }

  if (data?.v !== FORMAT_VERSION) {
    throw new PayloadError(`Unsupported payload version: ${data?.v}. Both sides must run the same CryptChat version.`);
  }
  if (data.t !== 'offer' && data.t !== 'answer') throw new PayloadError('Payload has an unknown type.');
  if (typeof data.sdp !== 'string' || !data.sdp.startsWith('v=0')) throw new PayloadError('Payload has no valid SDP.');

  return { type: data.t, sdp: data.sdp };
}

async function inflateWithLimit(bytes, limit) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new PayloadError('Payload expands to an unreasonable size; refusing it.');
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}
