// Network settings: validation in the main process, encryption at rest, relay-only guard.
const fs = require('node:fs');
const path = require('node:path');
const { e2e } = require('./harness');

e2e('settings', async (t) => {
  const { a } = t;
  const set = (config) => t.js(a, `window.cc.settings.setNetwork(${JSON.stringify(config)})`);

  t.equal((await set({ stunUrls: [], turn: { urls: [] }, relayOnly: true })).errors, ['RELAY_ONLY requires a TURN server (custom or Cloudflare).'], 'RELAY_ONLY without TURN is refused');
  t.ok((await set({ stunUrls: ['http://evil'], turn: { urls: [] } })).errors.some((e) => e.startsWith('Invalid STUN URL')), 'non-STUN URL is refused');
  t.ok((await set({ stunUrls: [], turn: { urls: ['turn:x.example:3478'], username: '', credential: '' } })).errors.includes('TURN needs a username and a password.'), 'TURN without credentials is refused');
  t.ok((await set({ stunUrls: [], turn: { urls: [] }, cloudflare: { keyId: 'bad key!', apiToken: 'x' } })).errors.includes('Cloudflare TURN key ID looks invalid.'), 'malformed Cloudflare key is refused');

  const good = {
    stunUrls: ['stun:stun.l.google.com:19302'],
    turn: { urls: ['turn:turn.example.test:3478'], username: 'alice', credential: 'super-secret-password' },
    cloudflare: { keyId: '', apiToken: '' },
    relayOnly: true,
    holdOpenSec: 60,
  };
  t.ok((await set(good)).ok, 'a valid config is saved');

  const file = path.join(t.tmp, 'userData', 'network.bin');
  const bytes = fs.readFileSync(file);
  t.ok(!bytes.includes(Buffer.from('super-secret-password')), 'the password is not stored in plaintext');
  t.ok(!bytes.includes(Buffer.from('turn.example.test')), 'the TURN URL is not stored in plaintext');
  t.equal((await t.js(a, 'window.cc.settings.getNetwork()')).config, good, 'the saved config reads back unchanged');

  // The settings dialog fills from storage, and RELAY_ONLY without a reachable relay blocks GENERATE.
  await t.js(a, 'window.__cc.networkSettings.load()');
  await t.click(a, 'btn-settings');
  t.equal(await t.val(a, 'net-turn-user'), 'alice', 'dialog shows the stored TURN user');
  t.ok(await t.js(a, `document.getElementById('net-relay-only').checked`), 'dialog shows RELAY_ONLY');
  await t.click(a, 'btn-settings-close');
  await t.click(a, 'btn-generate');
  await t.expect(() => t.logHas(a, /no relay candidate/), 'RELAY_ONLY without a working relay refuses to make a payload', 20000);
  t.equal(await t.phase(a), 'idle', 'nothing is left running');
}, { timeoutMs: 90000 });
