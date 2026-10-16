import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeVerificationCode, extractFingerprint } from '../../src/renderer/js/security/verification.js';
import { WORDS } from '../../src/renderer/js/security/words.js';

const sdpWith = (hex) => `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 ${hex}\r\n`;
const FP1 = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP2 = Array.from({ length: 32 }, (_, i) => (i * 13 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP3 = Array.from({ length: 32 }, (_, i) => (i * 29 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');

test('word list: 256 distinct uppercase words (one per byte)', () => {
  assert.equal(WORDS.length, 256);
  assert.equal(new Set(WORDS).size, 256);
  for (const word of WORDS) assert.match(word, /^[A-Z]{3,10}$/);
});

test('fingerprint extraction normalizes case', () => {
  assert.equal(extractFingerprint(sdpWith(FP1.toLowerCase())), `sha-256 ${FP1}`);
  assert.equal(extractFingerprint('v=0\r\n'), null);
});

test('code format: 4 words + 2 digits', async () => {
  assert.match(await computeVerificationCode(sdpWith(FP1), sdpWith(FP2)), /^([A-Z]+-){4}\d{2}$/);
});

test('both sides compute the same code (order independent)', async () => {
  assert.equal(await computeVerificationCode(sdpWith(FP1), sdpWith(FP2)), await computeVerificationCode(sdpWith(FP2), sdpWith(FP1)));
});

test('a different certificate gives a different code (MITM detection)', async () => {
  assert.notEqual(await computeVerificationCode(sdpWith(FP1), sdpWith(FP2)), await computeVerificationCode(sdpWith(FP1), sdpWith(FP3)));
});

test('missing fingerprint is an error, not a code', async () => {
  await assert.rejects(() => computeVerificationCode('v=0\r\n', sdpWith(FP1)));
});
