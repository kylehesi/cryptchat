import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyNat } from '../../src/renderer/js/net/nat-check.js';

const host = (address, port = 50000, protocol = 'udp') => ({ type: 'host', protocol, address, port, relatedAddress: null, relatedPort: null });
const srflx = (address, port, base = '192.168.1.20', basePort = 50000) => ({ type: 'srflx', protocol: 'udp', address, port, relatedAddress: base, relatedPort: basePort });
const run = (combined, answeredAlone = 2, serverCount = 2) => classifyNat({ combined, answeredAlone, serverCount });

test('one mapping for both servers: cone NAT, no TURN needed', () => {
  const result = run([host('192.168.1.20'), host('192.168.1.20', 9, 'tcp'), srflx('203.0.113.5', 50000)]);
  assert.equal(result.verdict, 'direct');
  assert.equal(result.needsTurn, false);
});

test('a different public port per server on the same socket: symmetric NAT, TURN needed', () => {
  const result = run([host('192.168.1.20'), srflx('203.0.113.5', 61001), srflx('203.0.113.5', 61002)]);
  assert.equal(result.verdict, 'symmetric');
  assert.equal(result.needsTurn, true);
});

test('separate sockets (two interfaces) with one mapping each are not symmetric', () => {
  const result = run([
    host('192.168.1.20'), host('10.0.0.7', 50002),
    srflx('203.0.113.5', 50000), srflx('198.51.100.9', 50002, '10.0.0.7', 50002),
  ]);
  assert.equal(result.verdict, 'direct');
});

test('unknown base port: all mappings compared together', () => {
  const noBase = (port) => ({ ...srflx('203.0.113.5', port), relatedAddress: '0.0.0.0', relatedPort: 0 });
  assert.equal(run([noBase(61001), noBase(61002)]).verdict, 'symmetric');
  assert.equal(run([noBase(61001)]).verdict, 'direct');
});

test('no public address at all: UDP blocked, TURN needed', () => {
  const result = run([host('192.168.1.20'), host('192.168.1.20', 9, 'tcp')], 0);
  assert.equal(result.verdict, 'blocked');
  assert.equal(result.needsTurn, true);
});

test('only one server answered or configured: inconclusive', () => {
  const combined = [host('192.168.1.20'), srflx('203.0.113.5', 50000)];
  assert.equal(run(combined, 1).verdict, 'unknown');
  assert.equal(run(combined, 1).needsTurn, null);
  assert.match(run(combined, 1, 1).detail, /Only one STUN server is configured/);
});

test('public IPv4 on the PC itself: no NAT', () => {
  assert.equal(run([host('203.0.113.5'), srflx('203.0.113.5', 50000, '203.0.113.5')]).verdict, 'open');
});

test('CGNAT and public IPv6 are flagged', () => {
  const result = run([host('100.72.4.9'), host('2001:db8::5', 50004), srflx('203.0.113.5', 50000, '100.72.4.9')]);
  assert.equal(result.cgnat, true);
  assert.equal(result.ipv6, true);
  assert.equal(run([host('100.128.0.1'), srflx('203.0.113.5', 50000, '100.128.0.1')]).cgnat, false); // just outside 100.64/10
  assert.equal(run([host('fd00::1'), srflx('203.0.113.5', 50000)]).ipv6, false); // ULA is not public
});
