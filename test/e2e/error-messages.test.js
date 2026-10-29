// Error messages for the usual mix-ups: they say what happened and what to do, instead of a
// browser exception or a misleading state message.
const { e2e } = require('./harness');

e2e('error messages', async (t) => {
  const { a, b } = t;
  const lastError = async (win) => (await t.js(win, `[...document.querySelectorAll('#kernel-log .log-err')].map((l) => l.textContent).at(-1) ?? ''`));
  const paste = async (win, payload) => {
    await t.setVal(win, 'remote-payload', payload);
    await t.click(win, 'btn-connect');
    await t.sleep(300);
  };
  const generate = async (win) => {
    await t.click(win, 'btn-generate');
    await t.expect(async () => (await t.val(win, 'local-payload')).startsWith('CC1.'), 'a payload is generated', 20000);
    return t.val(win, 'local-payload');
  };
  const stop = async (win) => {
    if ((await t.phase(win)) !== 'idle') await t.click(win, 'btn-generate'); // TERMINATE_LINK
    await t.expect(async () => (await t.phase(win)) === 'idle', 'back to idle', 5000);
  };

  // Your own OFFER pasted into your own box.
  const offerA = await generate(a);
  await paste(a, offerA);
  t.match(await lastError(a), /That is your own OFFER\. Send it to your peer/, 'own OFFER is recognised');
  t.equal(await t.phase(a), 'awaiting-answer', 'and nothing changes');

  // Both sides pressed GENERATE_PAYLOAD.
  await generate(b);
  await paste(b, offerA);
  t.match(await lastError(b), /You both pressed GENERATE_PAYLOAD/, 'two OFFERs: told that only one side generates');
  await stop(b);

  // B answers, A terminates, then pastes the (now useless) ANSWER.
  await paste(b, offerA);
  await t.expect(async () => (await t.phase(b)) !== 'idle' && (await t.val(b, 'local-payload')).startsWith('CC1.'), 'B answers', 20000);
  const answerB = await t.val(b, 'local-payload');
  t.ok(await t.js(b, `document.getElementById('btn-connect').disabled`), 'B cannot paste anything while it waits (so no own-ANSWER mix-up)');
  await stop(a);
  await paste(a, answerB);
  t.match(await lastError(a), /no OFFER waiting.*Payloads are single-use/, 'an ANSWER after TERMINATE_LINK: told to start over');
  await stop(b);

  // A payload whose wrapper is fine but whose content is broken.
  const broken = await t.js(a, `import('/js/net/payload.js').then(({ encodePayload }) => encodePayload({ type: 'offer', sdp: 'v=0\\r\\nthis is not SDP\\r\\n' }))`);
  await paste(b, broken);
  t.match(await lastError(b), /payload is damaged or does not belong to this link/, 'broken content: a readable reason');
  t.ok(!(await lastError(b)).includes('Failed to'), 'not the browser\'s own exception text');
  t.equal(await t.phase(b), 'idle', 'B is left idle');

  // The microphone cannot start during a call.
  await t.js(b, `navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Could not start audio source', 'NotReadableError')); true`);
  await t.connectOrFail();
  await t.expect(async () => /Microphone unavailable: the microphone could not start/.test(await lastError(b)), 'mic failure: what happened and what to do', 8000);
  t.match(await lastError(b), /listen-only\)\.$/, 'and that listening still works');
  t.match(await lastError(b), /\[NotReadableError\]/, 'the exact error stays for bug reports');
  await t.terminate(a);
});
