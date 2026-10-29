import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLogReport, maskIps, redactMessage } from '../../src/renderer/js/core/log-report.js';

const META = { version: '9.9.9', electron: '44.7.0', chrome: '152.0', platform: 'Windows', now: new Date(2026, 9, 29, 14, 5, 9) };
const entry = (level, message, redacted) => ({ level, message, redacted, time: new Date(2026, 9, 29, 14, 1, 2) });

test('IPs, STUN/TURN hosts and payloads are masked', () => {
  assert.equal(maskIps('from 203.0.113.7 and 2001:db8::1'), 'from •••.•••.•••.••• and ••••:••••::••••');
  assert.equal(redactMessage('TEST_TURN failed: turn:198.51.100.23:3478: 401'), 'TEST_TURN failed: turn:[host]:3478: 401');
  assert.equal(redactMessage('turns:relay.my-home.example:5349?transport=tcp'), 'turns:[host]:5349?transport=tcp');
  assert.equal(redactMessage('stun:stun.l.google.com:19302'), 'stun:[host]:19302');
  assert.equal(redactMessage('pasted CC1.abcDEF_123-xyz by mistake'), 'pasted CC1.[payload] by mistake');
  assert.equal(redactMessage('[10:01:02 PM] RTT 12 ms, v0.2.3'), '[10:01:02 PM] RTT 12 ms, v0.2.3', 'times and versions are not IPs');
});

test('the report: header, 24 h times, level tags, secrets from `redacted`', () => {
  const { text, lines, omitted } = formatLogReport([
    entry('info', '--- SYSTEM BOOT ---'),
    entry('ok', 'File received: holiday.zip', 'File received: [hidden]'),
    entry('err', 'ICE failed via 203.0.113.7'),
  ], META);
  assert.equal(lines, 3);
  assert.equal(omitted, 0);
  assert.equal(text, [
    'CryptChat v9.9.9 · Electron 44.7.0 · Chromium 152.0 · Windows',
    'KERNEL_LOG copied 2026-10-29 14:05:09 (local time).',
    'Masked: IP addresses, STUN/TURN hosts, payloads, file names, window titles, aliases.',
    '',
    '[14:01:02] INFO --- SYSTEM BOOT ---',
    '[14:01:02] OK   File received: [hidden]',
    '[14:01:02] ERR  ICE failed via •••.•••.•••.•••',
    '',
  ].join('\n'));
});

test('too long for the clipboard: the newest lines are kept', () => {
  const entries = Array.from({ length: 50 }, (_, i) => entry('info', `line ${String(i).padStart(2, '0')} ${'x'.repeat(80)}`));
  const { text, lines, omitted } = formatLogReport(entries, { ...META, maxChars: 1500 });
  assert.ok(text.length <= 1500, `fits (${text.length} chars)`);
  assert.equal(lines + omitted, 50);
  assert.ok(omitted > 0);
  assert.match(text, new RegExp(`\\(${omitted} older line\\(s\\) left out to fit the clipboard\\)`));
  assert.match(text, /line 49 x+\n$/, 'the newest line is last');
  assert.ok(!text.includes('line 00 '), 'the oldest line went first');
});
