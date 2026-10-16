import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeMessage, encodeMessage, MAX_MESSAGE_CHARS, PROTOCOL_VERSION } from '../../src/renderer/js/net/protocol.js';

test('encode → decode round trip keeps fields, version and type', () => {
  const message = decodeMessage(encodeMessage('chat', { text: 'hi', alias: 'NEO' }));
  assert.deepEqual(message, { text: 'hi', alias: 'NEO', v: PROTOCOL_VERSION, type: 'chat' });
});

test('fields cannot override version or type', () => {
  const message = decodeMessage(encodeMessage('chat', { v: 99, type: 'evil' }));
  assert.equal(message.v, PROTOCOL_VERSION);
  assert.equal(message.type, 'chat');
});

test('invalid input decodes to null and never throws', () => {
  for (const data of ['', 'not json', '[]', 'null', '42', JSON.stringify({ v: 2, type: 'chat' }), JSON.stringify({ v: 1 }), new ArrayBuffer(4)]) {
    assert.equal(decodeMessage(data), null, String(data));
  }
});

test('oversized messages are dropped', () => {
  const big = encodeMessage('chat', { text: 'x'.repeat(MAX_MESSAGE_CHARS) });
  assert.equal(decodeMessage(big), null);
});
