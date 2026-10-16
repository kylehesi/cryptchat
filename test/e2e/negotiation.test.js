// In-band renegotiation: single ICE restart, simultaneous restart (glare), crash → "Link lost".
const { e2e } = require('./harness');

const ufrag = (t, win) => t.js(win, `(window.__cc.connection.session?.pc.localDescription?.sdp.match(/a=ice-ufrag:(\\S+)/) || [])[1]`);
const stable = async (t) =>
  (await t.js(t.a, 'window.__cc.connection.session.pc.signalingState')) === 'stable' &&
  (await t.js(t.b, 'window.__cc.connection.session.pc.signalingState')) === 'stable';

e2e('negotiation', async (t) => {
  const { a, b } = t;
  await t.connectOrFail();

  // 1) A (impolite) restarts ICE over the control channel.
  let before = [await ufrag(t, a), await ufrag(t, b)];
  await t.js(a, 'window.__cc.connection.restartIce()');
  await t.expect(async () => (await ufrag(t, a)) !== before[0] && (await ufrag(t, b)) !== before[1] && (await stable(t)), 'single ICE restart completes', 10000);
  await t.sleep(1000);
  t.ok(await t.connected(), 'still connected after the restart');

  // 2) Both restart at the same instant: perfect negotiation resolves the collision.
  before = [await ufrag(t, a), await ufrag(t, b)];
  await Promise.all([t.js(a, 'window.__cc.connection.restartIce()'), t.js(b, 'window.__cc.connection.restartIce()')]);
  await t.expect(async () => (await ufrag(t, a)) !== before[0] && (await ufrag(t, b)) !== before[1] && (await stable(t)), 'glare resolves', 10000);
  await t.sleep(1000);
  t.ok(await t.connected(), 'still connected after glare');

  await t.say(b, 'still here');
  await t.expect(() => t.js(a, `[...document.querySelectorAll('#chat-log .chat-line')].some((l) => l.textContent.includes('still here'))`), 'chat flows after two renegotiations', 5000);

  // 3) B crashes without "bye": A goes UNSTABLE, tries a restart, then gives up.
  b.webContents.forcefullyCrashRenderer();
  await t.expect(async () => (await t.phase(a)) === 'reconnecting', 'A notices the dead peer', 20000);
  t.equal(await t.text(a, 'link-status'), 'LINK: UNSTABLE', 'link status shows UNSTABLE');
  await t.expect(() => t.logHas(a, /Attempting ICE restart/), 'A attempts an ICE restart', 10000);
  await t.expect(async () => (await t.phase(a)) === 'idle', 'A gives up with "Link lost"', 45000, 500);
  t.ok(await t.logHas(a, /Link lost/), '"Link lost" is logged');
}, { timeoutMs: 150000 });
