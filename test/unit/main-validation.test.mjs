// Main-process validators. `electron` is not loaded here (plain Node), only the pure functions run.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { safeFileName } = require('../../src/main/file-receive.js');
const { validate } = require('../../src/main/secure-store.js');
const { sanitize } = require('../../src/main/cloudflare-turn.js');

test('file names from the peer become harmless Windows names', () => {
  assert.equal(safeFileName('..\\..\\evil.bat'), 'evil.bat');
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('C:\\Windows\\win.ini'), 'win.ini');
  assert.equal(safeFileName('CON.txt'), '_CON.txt');
  assert.equal(safeFileName('lpt1'), '_lpt1');
  assert.equal(safeFileName('a<b>:c"d|e?f*.txt'), 'a_b__c_d_e_f_.txt');
  assert.equal(safeFileName('invoice\u202Egpj.exe'), 'invoice_gpj.exe');
  assert.equal(safeFileName('trailing.dots... '), 'trailing.dots');
  assert.equal(safeFileName('..'), 'file');
  assert.equal(safeFileName(''), 'file');
  const long = safeFileName(`${'x'.repeat(300)}.pdf`);
  assert.equal(long.length, 150);
  assert.ok(long.endsWith('.pdf'));
});

test('network settings validation', () => {
  assert.deepEqual(validate({ stunUrls: [], turn: { urls: [] }, relayOnly: true }).errors, ['RELAY_ONLY requires a TURN server (custom or Cloudflare).']);
  assert.ok(validate({ stunUrls: ['http://x'] }).errors[0].startsWith('Invalid STUN URL'));
  assert.ok(validate({ turn: { urls: ['turn:a.test'], username: '', credential: '' } }).errors.includes('TURN needs a username and a password.'));
  assert.ok(validate({ turn: { urls: ['turn:a.test'], username: 'u\u0000', credential: 'p' } }).errors.includes('Invalid TURN username.'));
  assert.ok(validate({ cloudflare: { keyId: 'x', apiToken: 'y' } }).errors.length === 2);

  const ok = validate({
    stunUrls: [' stun:a.test:3478 ', ''],
    turn: { urls: ['turns:t.test:5349'], username: 'u', credential: 'p' },
    cloudflare: { keyId: 'abcdef0123456789', apiToken: 'token-0123456789abcdef' },
    relayOnly: true,
  });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config.stunUrls, ['stun:a.test:3478'], 'trimmed, empties removed');
});

test('Cloudflare response: TURN only, port 53 dropped, credentials required', () => {
  const result = sanitize({
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'],
        username: 'u', credential: 'c',
      },
      { urls: 'turn:no-credentials.test:3478' },
    ],
  });
  assert.deepEqual(result, [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'u', credential: 'c' }]);
  assert.deepEqual(sanitize(null), []);
});
