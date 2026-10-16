import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeAlias, sanitizeText } from '../../src/renderer/js/chat/chat.js';

test('aliases: uppercase, A–Z 0–9 _ . - only, max 16', () => {
  assert.equal(sanitizeAlias('neo<b> ü'), 'NEOB');
  assert.equal(sanitizeAlias('agent_007.x-y'), 'AGENT_007.X-Y');
  assert.equal(sanitizeAlias('a'.repeat(40)), 'A'.repeat(16));
  assert.equal(sanitizeAlias('ışık'), 'IIK'); // ı→I, ş dropped; toUpperCase is locale-independent, so no dotted İ
  assert.equal(sanitizeAlias(null), '');
  assert.equal(sanitizeAlias('<<<>>>'), '');
});

test('text: control and bidi characters are stripped, trimmed, max 2000', () => {
  assert.equal(sanitizeText('  hello  '), 'hello');
  assert.equal(sanitizeText('safe‮evil\u0007bell'), 'safeevilbell');
  assert.equal(sanitizeText('a⁦b⁩c‏d'), 'abcd');
  assert.equal(sanitizeText('line1\nline2'), 'line1line2');
  assert.equal(sanitizeText('x'.repeat(5000)).length, 2000);
  assert.equal(sanitizeText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>'); // rendered as text, not stripped
});
