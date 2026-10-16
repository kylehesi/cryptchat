import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enableOpusHifi } from '../../src/renderer/js/net/sdp.js';

const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:1',
  'a=rtpmap:96 VP8/90000',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:2',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  '',
].join('\r\n');

test('stereo + 128 kbps only on the chosen m-section', () => {
  const lines = enableOpusHifi(SDP, 2).split('\r\n');
  assert.equal(lines[4], 'a=fmtp:111 minptime=10;useinbandfec=1', 'mic section untouched');
  assert.equal(lines[11], 'a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000');
});

test('idempotent: applying twice does not duplicate parameters', () => {
  const once = enableOpusHifi(SDP, 2);
  assert.equal(enableOpusHifi(once, 2), once);
});

test('a section without Opus is left alone', () => {
  assert.equal(enableOpusHifi(SDP, 1), SDP);
});
