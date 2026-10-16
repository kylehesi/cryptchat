// Copy-paste connection: bad payloads, offer/answer, route, payload format, terminate.
const { e2e } = require('./harness');

e2e('connect', async (t) => {
  const { a, b } = t;

  // A pasted non-payload is rejected with a clear message, nothing starts.
  await t.setVal(b, 'remote-payload', 'hello world');
  await t.click(b, 'btn-connect');
  await t.expect(() => t.logHas(b, /Not a CryptChat payload/), 'garbage paste is rejected');
  t.equal(await t.phase(b), 'idle', 'B stays idle after a bad paste');

  // Handshake, with the offer line-wrapped like a chat app would do.
  await t.connectOrFail({ wrap: true });
  t.ok((await t.val(a, 'local-payload')).length < 4000, 'payload stays copy-paste sized');
  await t.expect(() => t.logHas(a, /TUNNEL ESTABLISHED/), 'A logs the tunnel');
  await t.expect(() => t.logHas(a, /Route: (HOST|SRFLX|RELAY)/), 'A logs the selected route');
  await t.expect(async () => /LINK: (HOST|SRFLX|RELAY)/.test(await t.text(a, 'link-status')), 'link status shows the route', 8000);
  t.ok(await t.js(a, `document.getElementById('peer-remote').classList.contains('is-online')`), 'remote card turns online');
  t.equal(await t.text(a, 'btn-generate'), 'TERMINATE_LINK', 'primary button becomes TERMINATE_LINK');

  // The answerer gathered its own candidates fully before using the offer's (no missing srflx).
  const answerTypes = await t.js(b, `[...window.__cc.connection.session.pc.localDescription.sdp.matchAll(/typ (\\w+)/g)].map((m) => m[1])`);
  t.ok(answerTypes.includes('host'), 'answer carries host candidates');

  t.ok(await t.js(a, `document.getElementById('btn-connect').disabled`), 'EXECUTE_CONNECT is locked while linked');

  // TERMINATE_LINK: the peer is told ("bye") and drops at once.
  await t.terminate(a);
  await t.expect(() => t.logHas(b, /Remote peer terminated the link/), 'B learns about the terminate');
  t.equal(await t.text(b, 'btn-generate'), 'GENERATE_PAYLOAD', 'B is ready for a new link');
});
