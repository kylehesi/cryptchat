// HOLD_OPEN: while the offerer has not pasted our answer, the answerer keeps checking (that is
// what keeps a port-restricted NAT open for the peer), stops after the configured time, and a
// link that opens late still survives an ICE restart.
//
// Locally there is no NAT, so the offer's candidates are pointed at a black hole (TEST-NET-1):
// that is what the answerer sees when the offerer's NAT drops its checks.
const { e2e } = require('./harness');

// In the answerer's page: how many candidate pairs are being checked right now.
const ACTIVE_PAIRS = `window.__cc.connection.session?.pc.getStats().then((stats) => {
  let n = 0;
  stats.forEach((r) => { if (r.type === 'candidate-pair' && (r.state === 'in-progress' || r.state === 'waiting')) n++; });
  return n;
}) ?? 0`;

// Rewrites the offer so every candidate points at an address that never answers.
const blackHoleOffer = (t, payload) => t.js(t.a, `(async () => {
  const { decodePayload, encodePayload } = await import('/js/net/payload.js');
  const offer = await decodePayload(${JSON.stringify(payload)});
  let n = 0;
  offer.sdp = offer.sdp.split('\\r\\n').map((line) => {
    if (!line.startsWith('a=candidate:')) return line;
    const parts = line.split(' ');
    parts[4] = '192.0.2.' + (++n);
    return parts.join(' ');
  }).join('\\r\\n');
  return encodePayload(offer);
})()`);

const setHoldOpen = (t, win, seconds) => t.js(win, `(async () => {
  const { config } = await window.cc.settings.getNetwork();
  const result = await window.cc.settings.setNetwork({ ...config, holdOpenSec: ${seconds} });
  await window.__cc.networkSettings.load();
  return result.ok;
})()`);

/** Samples ACTIVE_PAIRS on `win` once per second for `seconds`; returns how many samples had checks running. */
async function activeSamples(t, win, seconds) {
  let active = 0;
  for (let i = 0; i < seconds; i++) {
    if ((await t.js(win, ACTIVE_PAIRS)) > 0) active++;
    await t.sleep(1000);
  }
  return active;
}

e2e('hold open', async (t) => {
  const { a, b } = t;
  t.ok(await setHoldOpen(t, b, 30), 'HOLD_OPEN set to 30 s on the answerer');

  // 1) The offerer never pastes the answer: checks keep running for 30 s, then stop.
  await t.click(a, 'btn-generate');
  await t.expect(async () => (await t.val(a, 'local-payload')).startsWith('CC1.'), 'A produced an OFFER');
  await t.setVal(b, 'remote-payload', await blackHoleOffer(t, await t.val(a, 'local-payload')));
  await t.click(b, 'btn-connect');
  await t.expect(async () => (await t.val(b, 'local-payload')).startsWith('CC1.'), 'B produced an ANSWER');
  const started = Date.now();
  t.ok(await t.logHas(b, /HOLD_OPEN: this side stays reachable for 30 s/), 'B says how long it stays reachable');

  // Chromium alone stops checking after ~15-20 s; HOLD_OPEN brings the checks back.
  await t.sleep(Math.max(0, 20000 - (Date.now() - started)));
  const during = await activeSamples(t, b, 10);
  t.ok(during >= 6, `checks are still running 20-30 s after the answer (${during}/10 samples)`);
  t.ok(!(await t.logHas(b, /ICE failed/)), 'B does not give up while it holds');

  await t.expect(() => t.logHas(b, /HOLD_OPEN ended after 30 s/), 'B says when HOLD_OPEN ends', 15000);
  await t.sleep(25000); // the last round of checks runs out
  t.equal(await activeSamples(t, b, 5), 0, 'no more checks after HOLD_OPEN ended');
  t.ok(await t.logHas(b, /ICE failed/), 'only then does B report the failure');
  await t.click(b, 'btn-generate'); // TERMINATE_LINK on both: they never linked
  await t.click(a, 'btn-generate');
  await t.expect(async () => (await t.phase(a)) === 'idle' && (await t.phase(b)) === 'idle', 'both sides back to idle', 10000);

  // 2) The offerer pastes late (after Chromium alone would have given up): the link opens,
  // HOLD_OPEN stops, and an ICE restart afterwards still finds working paths.
  t.ok(await setHoldOpen(t, b, 60), 'HOLD_OPEN set to 60 s');
  await t.click(a, 'btn-generate');
  await t.expect(async () => (await t.val(a, 'local-payload')).startsWith('CC1.'), 'A produced a second OFFER');
  await t.setVal(b, 'remote-payload', await blackHoleOffer(t, await t.val(a, 'local-payload')));
  await t.click(b, 'btn-connect');
  await t.expect(async () => (await t.val(b, 'local-payload')).startsWith('CC1.'), 'B produced a second ANSWER');
  await t.sleep(25000);
  await t.setVal(a, 'remote-payload', await t.val(b, 'local-payload'));
  await t.click(a, 'btn-connect');
  await t.expect(() => t.connected(), 'the late answer still opens the link', 30000);
  await t.sleep(6000);
  const ended = (await t.logLines(b)).filter((line) => /HOLD_OPEN ended/.test(line)).length;
  t.equal(ended, 1, 'HOLD_OPEN stopped quietly once the link was up (only round 1 ended by time)');

  await t.js(a, 'window.__cc.connection.session.restartIce()');
  const newUfrag = () => t.js(a, `window.__cc.connection.session.pc.localDescription.sdp.split('\\r\\n').find((l) => l.startsWith('a=ice-ufrag:')).slice(12)`);
  const oldUfrag = await newUfrag();
  await t.expect(async () => (await newUfrag()) !== oldUfrag, 'A restarted ICE (new credentials)', 10000);
  const ufrag = await newUfrag();
  await t.expect(() => t.js(b, `window.__cc.connection.session.pc.getStats().then((stats) => {
    let ok = 0;
    stats.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && stats.get(r.remoteCandidateId)?.usernameFragment === ${JSON.stringify(ufrag)}) ok++; });
    return ok > 0;
  })`), 'after the restart, B has working pairs with the new credentials', 20000);
  t.ok(await t.connected(), 'still connected after the restart');
  await t.terminate(a);
}, { timeoutMs: 240000 });
