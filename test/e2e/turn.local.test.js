// TURN + RELAY_ONLY through a throwaway local TURN server (local only).
// Needs the optional test-only package:  npm install --no-save node-turn
// Windows may ask whether node.exe may use the network; "Cancel" is fine (traffic stays on this PC).
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { e2e } = require('./harness');

let nodeTurnPath = null;
try {
  nodeTurnPath = require.resolve('node-turn');
} catch {
  console.log('SKIP turn (local): install with "npm install --no-save node-turn" to run it');
  process.exit(0);
}

// Chromium binds TURN sockets to a network interface, so loopback does not work: use the LAN IP.
const LAN_IP = Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;

e2e('turn (local)', async (t) => {
  const { a, b } = t;
  // Electron's own binary in Node mode: works even where `node` is not on PATH.
  const server = spawn(process.execPath, ['-e', `
    const Turn = require(${JSON.stringify(nodeTurnPath)});
    new Turn({ authMech: 'long-term', credentials: { ccuser: 'ccpass' }, realm: 'cryptchat.test',
      listeningPort: 3478, listeningIps: [${JSON.stringify(LAN_IP)}], relayIps: [${JSON.stringify(LAN_IP)}], debugLevel: 'OFF' }).start();
    console.log('TURN_READY');`], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', (d) => d.includes('TURN_READY') && resolve());
      server.on('exit', () => reject(new Error('TURN server did not start')));
    });

    await t.click(a, 'btn-settings');
    await t.setVal(a, 'net-turn-urls', `turn:${LAN_IP}:3478?transport=udp`);
    await t.setVal(a, 'net-turn-user', 'ccuser');
    await t.setVal(a, 'net-turn-pass', 'WRONG');
    await t.click(a, 'btn-net-test');
    await t.expect(async () => /TURN (OK|FAILED)/.test(await t.text(a, 'net-status')), 'TEST_TURN answers', 12000);
    t.match(await t.text(a, 'net-status'), /401/, 'a wrong password shows 401 Unauthorized');
    await t.setVal(a, 'net-turn-pass', 'ccpass');
    await t.click(a, 'btn-net-test');
    await t.expect(async () => /TURN (OK|FAILED)/.test(await t.text(a, 'net-status')), 'TEST_TURN answers again', 12000);
    t.match(await t.text(a, 'net-status'), /TURN OK/, 'the right password passes');

    await t.js(a, `document.getElementById('net-relay-only').checked = true`);
    await t.click(a, 'btn-net-save');
    await t.expect(async () => (await t.text(a, 'net-status')).startsWith('Saved'), 'settings are saved', 5000);
    await t.click(a, 'btn-settings-close');

    await t.connectOrFail();
    const offerTypes = await t.js(a, `[...new Set([...window.__cc.connection.session.pc.localDescription.sdp.matchAll(/typ (\\w+)/g)].map((m) => m[1]))]`);
    t.equal(offerTypes, ['relay'], 'a RELAY_ONLY offer carries relay candidates only');
    const seenByB = await t.js(b, `[...new Set([...window.__cc.connection.session.pc.remoteDescription.sdp.matchAll(/a=candidate:\\S+ \\d+ \\w+ \\d+ (\\S+) \\d+ typ (\\w+)/g)].map((m) => m[1]))]`);
    t.equal(seenByB, [LAN_IP], 'the peer only learns the relay address');
    await t.expect(async () => /LINK: RELAY/.test(await t.text(a, 'link-status')), 'the route is RELAY', 8000);
  } finally {
    server.kill();
  }
}, { timeoutMs: 90000 });
