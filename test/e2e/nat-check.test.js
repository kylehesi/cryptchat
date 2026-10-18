// NAT_CHECK: the detector is checked against fake STUN servers that play a known NAT (cone,
// symmetric, half or fully unreachable), then the header button runs once against the real
// configured servers (that verdict depends on the network the test runs on).
const dgram = require('node:dgram');
const os = require('node:os');
const { e2e } = require('./harness');

const COOKIE = 0x2112a442;
const FAKE_PUBLIC_IP = [203, 0, 113, 7]; // TEST-NET-3: what our fake "NAT" maps to

/**
 * A STUN server that answers Binding requests with a made-up public address: the request's
 * source port + `portShift`. Two servers with different shifts look like a symmetric NAT.
 * `silent` servers never answer (blocked UDP).
 */
async function fakeStun({ portShift = 0, silent = false }) {
  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg, from) => {
    if (silent || msg.length < 20 || msg.readUInt16BE(0) !== 0x0001 || msg.readUInt32BE(4) !== COOKIE) return;
    const reply = Buffer.alloc(32);
    reply.writeUInt16BE(0x0101, 0); // Binding success
    reply.writeUInt16BE(12, 2);
    reply.writeUInt32BE(COOKIE, 4);
    msg.copy(reply, 8, 8, 20); // transaction ID
    reply.writeUInt16BE(0x0020, 20); // XOR-MAPPED-ADDRESS
    reply.writeUInt16BE(8, 22);
    reply.writeUInt16BE(0x0001, 24); // IPv4
    reply.writeUInt16BE(((from.port + portShift) & 0xffff) ^ 0x2112, 26);
    FAKE_PUBLIC_IP.forEach((byte, i) => reply.writeUInt8(byte ^ ((COOKIE >>> (24 - 8 * i)) & 0xff), 28 + i));
    socket.send(reply, from.port, from.address);
  });
  await new Promise((resolve) => socket.bind(0, '0.0.0.0', resolve));
  return socket;
}

// Chromium gathers on real interfaces, not loopback: serve on this PC's LAN address.
const lanAddress = () => Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;

e2e('nat check', async (t) => {
  const { a } = t;
  const lan = lanAddress();
  t.ok(Boolean(lan), 'this machine has a LAN IPv4 address for the fake STUN servers');

  const scenarios = [
    { name: 'cone NAT', servers: [{}, {}], verdict: 'direct', needsTurn: false },
    { name: 'symmetric NAT', servers: [{}, { portShift: 7 }], verdict: 'symmetric', needsTurn: true },
    { name: 'one server unreachable', servers: [{}, { silent: true }], verdict: 'unknown', needsTurn: null },
    { name: 'UDP blocked', servers: [{ silent: true }, { silent: true }], verdict: 'blocked', needsTurn: true },
    { name: 'one server configured', servers: [{}], verdict: 'unknown', needsTurn: null },
  ];
  for (const scenario of scenarios) {
    const sockets = await Promise.all(scenario.servers.map(fakeStun));
    try {
      const urls = sockets.map((s) => `stun:${lan}:${s.address().port}`);
      const result = await t.js(a, `import('/js/net/nat-check.js').then(({ checkNat }) => checkNat(${JSON.stringify(urls)}))`);
      t.equal(result.verdict, scenario.verdict, `${scenario.name}: detected as "${scenario.verdict}"`);
      t.equal(result.needsTurn, scenario.needsTurn, `${scenario.name}: needs TURN = ${scenario.needsTurn}`);
    } finally {
      sockets.forEach((s) => s.close());
    }
  }

  // The real button, against the configured (public) STUN servers.
  const verdictLine = () => t.js(a, `[...document.querySelectorAll('#kernel-log .log-line')].map((l) => l.textContent).find((l) => /NAT_CHECK \\(\\d+ ms\\)/.test(l)) ?? ''`);
  const buttonClass = () => t.js(a, `['is-ok', 'is-warn', 'is-err'].find((c) => document.getElementById('btn-nat-check').classList.contains(c)) ?? ''`);

  t.ok(await t.js(a, `[...document.querySelectorAll('.payload-actions .btn')].every((b) => b.scrollWidth <= b.clientWidth)`), 'GENERATE_PAYLOAD and NAT_CHECK fit side by side');

  await t.click(a, 'btn-nat-check');
  t.ok(await t.js(a, `document.getElementById('btn-nat-check').disabled`), 'the button is busy while checking');
  await t.expect(async () => Boolean(await verdictLine()), 'a verdict is logged', 25000);
  t.match(await verdictLine(), /(Cone NAT|Symmetric NAT|No NAT|No STUN server answered|Only one STUN server)/, 'the verdict names the NAT type');
  t.ok(['is-ok', 'is-warn', 'is-err'].includes(await buttonClass()), 'the button is colored by the result');
  t.match(await t.js(a, `document.getElementById('btn-nat-check').title`), /Click to check again/, 'the tooltip carries the verdict');
  t.ok(!(await t.js(a, `document.getElementById('btn-nat-check').disabled`)), 'the button is usable again');
  console.log(`  verdict here: ${(await verdictLine()).replace(/^\[[^\]]+\]\s*/, '')}`);
});
