import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enableOpusHifi, withGeneration } from '../../src/renderer/js/net/sdp.js';

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

test('withGeneration: generation replaced, ufrag dropped, the rest kept', () => {
  const srflx = 'candidate:842163049 1 udp 1677729535 203.0.113.5 50000 typ srflx raddr 192.168.1.20 rport 50000 generation 0 ufrag Ab12 network-id 1 network-cost 10';
  assert.equal(withGeneration(srflx, 3), 'candidate:842163049 1 udp 1677729535 203.0.113.5 50000 typ srflx raddr 192.168.1.20 rport 50000 network-id 1 network-cost 10 generation 3');
  const bare = 'candidate:1 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active';
  assert.equal(withGeneration(bare, 1), 'candidate:1 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active generation 1');
  assert.equal(withGeneration(withGeneration(srflx, 2), 5), withGeneration(srflx, 5), 'idempotent apart from the number');
});
