'use strict';

// Cloudflare TURN: trades a long-lived TURN key (ID + API token) for short-lived ICE credentials.
// https://developers.cloudflare.com/realtime/turn/generate-credentials/
//
// Runs in the main process: the renderer's CSP allows no network requests, and this keeps the
// only outbound HTTP call in one auditable place.

const crypto = require('node:crypto');
const { ipcMain, net } = require('electron');

const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const TTL_SECONDS = 24 * 60 * 60;
const REUSE_MARGIN_MS = 60 * 60 * 1000; // mint a new set when less than 1 h is left
const KEY_ID = /^[A-Za-z0-9_-]{8,128}$/;
const API_TOKEN = /^[A-Za-z0-9_.-]{16,256}$/;

const cache = new Map(); // sha256(keyId:token) → { iceServers, expires }

/** Returns a sanitized RTCIceServer[] (TURN entries only), or throws with a user-facing message. */
async function mintIceServers(keyId, apiToken) {
  if (!KEY_ID.test(keyId ?? '') || !API_TOKEN.test(apiToken ?? '')) {
    throw new Error('Cloudflare key ID or API token has an invalid format.');
  }

  const cacheKey = crypto.createHash('sha256').update(`${keyId}:${apiToken}`).digest('hex');
  const cached = cache.get(cacheKey);
  if (cached && cached.expires - Date.now() > REUSE_MARGIN_MS) return cached.iceServers;

  let response;
  try {
    response = await net.fetch(`${API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    });
  } catch (error) {
    throw new Error(`Cloudflare unreachable (${error.message}).`);
  }
  if (!response.ok) {
    const hint = [401, 403, 404].includes(response.status) ? ' (wrong TURN key ID or API token)' : '';
    throw new Error(`Cloudflare refused the request: HTTP ${response.status}${hint}.`);
  }

  const iceServers = sanitize(await response.json().catch(() => null));
  if (!iceServers.length) throw new Error('Cloudflare returned no usable TURN servers.');

  cache.set(cacheKey, { iceServers, expires: Date.now() + TTL_SECONDS * 1000 });
  return iceServers;
}

// Keep only TURN URLs with string credentials. Port 53 is dropped: browsers block it, and with
// our non-trickle gathering a dead URL would only add a timeout.
function sanitize(body) {
  const servers = Array.isArray(body?.iceServers) ? body.iceServers : [];
  const result = [];
  for (const server of servers) {
    const urls = (Array.isArray(server?.urls) ? server.urls : [server?.urls])
      .filter((url) => typeof url === 'string' && /^turns?:/i.test(url) && !/:53(\?|$)/.test(url));
    if (urls.length && typeof server.username === 'string' && typeof server.credential === 'string') {
      result.push({ urls, username: server.username, credential: server.credential });
    }
  }
  return result;
}

function registerCloudflareTurn({ isOwnOrigin }) {
  ipcMain.handle('turn:cloudflare', async (event, keyId, apiToken) => {
    if (!isOwnOrigin(event.senderFrame?.url)) return { ok: false, error: 'Forbidden.' };
    try {
      return { ok: true, iceServers: await mintIceServers(keyId, apiToken) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = { registerCloudflareTurn, KEY_ID, API_TOKEN, sanitize }; // sanitize: exported for unit tests
