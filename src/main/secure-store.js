'use strict';

// Network settings (STUN/TURN, relay-only), encrypted at rest with Electron safeStorage
// (DPAPI on Windows: only this Windows user can decrypt it). The renderer never touches disk.

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, safeStorage } = require('electron');
const { KEY_ID, API_TOKEN } = require('./cloudflare-turn');

const DEFAULT_NETWORK = Object.freeze({
  stunUrls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'],
  turn: { urls: [], username: '', credential: '' },
  cloudflare: { keyId: '', apiToken: '' },
  relayOnly: false,
});

const MAX_STUN = 8;
const MAX_TURN = 4;
const MAX_URL_CHARS = 256;
const MAX_FIELD_CHARS = 256;
const STUN_URL = /^stuns?:[^\s]+$/i;
const TURN_URL = /^turns?:[^\s]+$/i;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

const settingsFile = () => path.join(app.getPath('userData'), 'network.bin');

/** Returns { config, errors }. `config` is only meaningful when errors is empty. */
function validate(input) {
  const errors = [];
  const urlList = (value, pattern, max, label) => {
    const list = Array.isArray(value) ? value.map((url) => String(url).trim()).filter(Boolean) : [];
    if (list.length > max) errors.push(`At most ${max} ${label} URLs.`);
    for (const url of list) {
      if (url.length > MAX_URL_CHARS || !pattern.test(url)) errors.push(`Invalid ${label} URL: ${url.slice(0, 60)}`);
    }
    return list.slice(0, max);
  };
  const field = (value, label) => {
    const text = typeof value === 'string' ? value : '';
    if (text.length > MAX_FIELD_CHARS || CONTROL_CHARS.test(text)) errors.push(`Invalid ${label}.`);
    return text;
  };

  const config = {
    stunUrls: urlList(input?.stunUrls, STUN_URL, MAX_STUN, 'STUN'),
    turn: {
      urls: urlList(input?.turn?.urls, TURN_URL, MAX_TURN, 'TURN'),
      username: field(input?.turn?.username, 'TURN username'),
      credential: field(input?.turn?.credential, 'TURN password'),
    },
    cloudflare: {
      keyId: field(input?.cloudflare?.keyId, 'Cloudflare key ID').trim(),
      apiToken: field(input?.cloudflare?.apiToken, 'Cloudflare API token').trim(),
    },
    relayOnly: input?.relayOnly === true,
  };

  if (config.turn.urls.length && (!config.turn.username || !config.turn.credential)) {
    errors.push('TURN needs a username and a password.');
  }
  const { keyId, apiToken } = config.cloudflare;
  if (keyId || apiToken) {
    if (!KEY_ID.test(keyId)) errors.push('Cloudflare TURN key ID looks invalid.');
    if (!API_TOKEN.test(apiToken)) errors.push('Cloudflare API token looks invalid.');
  }
  if (config.relayOnly && !config.turn.urls.length && !keyId) {
    errors.push('RELAY_ONLY requires a TURN server (custom or Cloudflare).');
  }
  return { config, errors };
}

function loadNetwork() {
  try {
    const encrypted = fs.readFileSync(settingsFile());
    const { config, errors } = validate(JSON.parse(safeStorage.decryptString(encrypted)));
    return errors.length ? structuredClone(DEFAULT_NETWORK) : config;
  } catch {
    return structuredClone(DEFAULT_NETWORK); // missing, corrupted, or from another Windows user
  }
}

function saveNetwork(config) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable, so settings were not saved.');
  }
  const file = settingsFile();
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify(config)));
  fs.renameSync(temp, file); // atomic replace: never a half-written settings file
}

function registerSecureStore({ isOwnOrigin }) {
  ipcMain.handle('settings:get-network', (event) => {
    if (!isOwnOrigin(event.senderFrame?.url)) return null;
    return { config: loadNetwork(), defaults: structuredClone(DEFAULT_NETWORK) };
  });

  ipcMain.handle('settings:set-network', (event, input) => {
    if (!isOwnOrigin(event.senderFrame?.url)) return { ok: false, errors: ['Forbidden.'] };
    const { config, errors } = validate(input);
    if (errors.length) return { ok: false, errors };
    try {
      saveNetwork(config);
      return { ok: true, config, errors: [] };
    } catch (error) {
      return { ok: false, errors: [error.message] };
    }
  });
}

module.exports = { registerSecureStore };
