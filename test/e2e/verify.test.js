// Verification code (SAS): match, MITM sets differ, MISMATCH drops, tampered fingerprint fails DTLS.
const { e2e } = require('./harness');

e2e('verify', async (t) => {
  const { a, b } = t;
  t.ok(await t.hidden(a, 'verify-section'), 'no code while idle');

  await t.connectOrFail();
  await t.expect(async () => /-\d\d$/.test(await t.text(a, 'verify-code')) && /-\d\d$/.test(await t.text(b, 'verify-code')), 'both sides show a code', 5000);
  const code = await t.text(a, 'verify-code');
  t.match(code, /^([A-Z]+-){4}\d{2}$/, 'code is 4 words + 2 digits');
  t.equal(await t.text(b, 'verify-code'), code, 'both sides show the same code');
  t.ok(await t.hidden(a, 'remote-section'), 'the code replaces the paste box');
  t.equal(await t.text(a, 'verify-tag'), '[ UNVERIFIED ]', 'chat header says UNVERIFIED');

  await t.click(a, 'btn-verify-ok');
  await t.expect(async () => (await t.text(a, 'verify-tag')) === '[ VERIFIED ]', 'MATCH marks the link verified', 2000);
  t.equal(await t.text(b, 'verify-tag'), '[ UNVERIFIED ]', 'verification is per side');

  // Man in the middle: A hashes (A, M1), B hashes (M2, B). The codes must differ.
  const mitm = await t.js(a, `(async () => {
    const { computeVerificationCode } = await import('/js/security/verification.js');
    const sdp = async () => { const pc = new RTCPeerConnection(); pc.createDataChannel('x'); const o = await pc.createOffer(); pc.close(); return o.sdp; };
    const [A, M1, M2, B] = [await sdp(), await sdp(), await sdp(), await sdp()];
    return { atA: await computeVerificationCode(A, M1), atB: await computeVerificationCode(B, M2), swapped: await computeVerificationCode(M1, A) };
  })()`);
  t.ok(mitm.atA !== mitm.atB, 'a man in the middle produces different codes');
  t.equal(mitm.swapped, mitm.atA, 'the code does not depend on which side computes it');

  await t.click(b, 'btn-verify-bad');
  await t.expect(async () => (await t.phase(a)) === 'idle' && (await t.phase(b)) === 'idle', 'MISMATCH drops both sides', 5000);
  t.ok(await t.logHas(b, /VERIFICATION MISMATCH/), 'MISMATCH is logged');

  // A tampered fingerprint in transit: DTLS must refuse, and the log must say why.
  await t.connect({
    tamperOffer: (offer) => t.js(a, `(async () => {
      const { decodePayload, encodePayload } = await import('/js/net/payload.js');
      const d = await decodePayload(${JSON.stringify(offer)});
      const sdp = d.sdp.replace(/(a=fingerprint:sha-256 )([0-9A-F]{2})/, (m, p, h) => p + (h === 'AA' ? 'BB' : 'AA'));
      return encodePayload({ type: d.type, sdp });
    })()`),
  });
  t.ok(!(await t.waitFor(() => t.connected(), 12000)), 'a tampered payload never connects');
  await t.expect(async () => (await t.logHas(a, /DTLS\) FAILED/)) || (await t.logHas(b, /DTLS\) FAILED/)), 'the DTLS failure is reported as possible tampering', 15000);
});
