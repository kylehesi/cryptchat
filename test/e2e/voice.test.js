// Voice with Chromium's fake mic (periodic beep): flow both ways, mute, deafen, device switch, DSP.
const { e2e } = require('./harness');

// Received audio energy on the mic slot (mid 0) over `ms`.
// Silence (muted) measures ~1e-9; any real audio is far above 0.001, whatever the fake beep timing.
async function energy(t, win, ms) {
  const read = () => t.js(win, `(async () => {
    const pc = window.__cc.connection.session?.pc; if (!pc) return 0;
    let e = 0; (await pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio' && s.mid === '0') e = s.totalAudioEnergy ?? 0; });
    return e; })()`);
  const start = await read();
  await t.sleep(ms);
  return (await read()) - start;
}
const icons = (t, win, card) => t.js(win, `[...document.querySelectorAll('#${card} .peer-status .icon')].map((i) => i.querySelector('use').getAttribute('href'))`);

e2e('voice', async (t) => {
  const { a, b } = t;
  t.ok((await t.js(a, `document.getElementById('mic-src').options.length`)) >= 1, 'mic list is filled');
  t.equal(await t.js(a, 'window.__cc.microphone.track'), null, 'no capture while idle');

  await t.connectOrFail();
  await t.sleep(1500);
  t.ok((await energy(t, b, 2000)) > 0.001, 'A → B audio flows');
  t.ok((await energy(t, a, 2000)) > 0.001, 'B → A audio flows');

  await t.expect(() => t.js(b, `document.getElementById('peer-remote').classList.contains('is-speaking')`), 'speaking indicator lights up', 6000, 50);

  // Mute: peer sees it, energy stops.
  await t.click(a, 'btn-mic');
  await t.expect(async () => (await icons(t, b, 'peer-remote'))[0] === '#i-mic-off', 'B sees A muted', 3000);
  await t.sleep(500);
  t.ok((await energy(t, b, 2000)) < 0.0001, 'muted mic sends silence');
  await t.click(a, 'btn-mic');
  await t.sleep(700);
  t.ok((await energy(t, b, 2000)) > 0.001, 'unmute restores audio');

  // Deafen = output and mic off; unmuting while deafened undeafens (Discord semantics).
  await t.click(b, 'btn-deafen');
  await t.expect(async () => (await icons(t, a, 'peer-remote')).join() === '#i-mic-off,#i-headphones-off', 'A sees B deafened', 3000);
  await t.sleep(500);
  t.ok((await energy(t, a, 2000)) < 0.0001, 'deafened side sends no audio');
  await t.click(b, 'btn-mic');
  await t.expect(async () => (await icons(t, a, 'peer-remote')).join() === '#i-mic,#i-headphones', 'unmute while deafened undeafens', 3000);

  // Device switch mid-call.
  const other = await t.js(a, `[...document.getElementById('mic-src').options].map((o) => o.value).find((v) => v !== window.__cc.microphone.deviceId)`);
  if (other) {
    await t.change(a, '#mic-src', other);
    // Wait until the NEW device's track is live on the sender (re-capture takes a moment).
    await t.expect(() => t.js(a, `(() => {
      const wanted = [...document.getElementById('mic-src').options].find((o) => o.value === ${JSON.stringify(other)})?.textContent;
      const sent = window.__cc.connection.session.slots.mic.sender.track;
      return sent && sent.label === wanted && sent.readyState === 'live';
    })()`), 'device switch puts the new mic on the sender', 8000);
    await t.sleep(1000);
    const sentBefore = await t.js(a, `(async () => { let n = 0; (await window.__cc.connection.session.slots.mic.sender.getStats()).forEach((r) => { if (r.type === 'outbound-rtp') n = r.bytesSent; }); return n; })()`);
    const afterSwitch = await energy(t, b, 2000);
    const diag = await t.js(a, `(async () => {
      const s = window.__cc.connection.session.slots.mic.sender; const tr = s.track; let n = 0;
      (await s.getStats()).forEach((r) => { if (r.type === 'outbound-rtp') n = r.bytesSent; });
      return { enabled: tr?.enabled, muted: tr?.muted, state: tr?.readyState, same: tr === window.__cc.microphone.track, micOn: window.__cc.voice.micOn, bytesSent: n };
    })()`);
    t.ok(afterSwitch > 0.001, `audio keeps flowing after a device switch (energy ${afterSwitch.toFixed(4)}, sent +${diag.bytesSent - sentBefore} B, ${JSON.stringify(diag)})`);
  }

  // AUDIO_OUT: the list is filled, and a change re-routes every playback element (voice + system audio).
  const outputs = await t.js(a, `[...document.getElementById('audio-out').options].map((o) => o.value)`);
  t.ok(outputs.length >= 1 && !(await t.js(a, `document.getElementById('audio-out').disabled`)), 'AUDIO_OUT lists output devices');
  t.equal(await t.js(a, '[...window.__cc.speakers.elements].filter((e) => e instanceof HTMLMediaElement).length'), 2, 'peer voice and peer system audio are both routed');
  t.ok(await t.js(a, '[...window.__cc.speakers.elements].some((e) => e instanceof AudioContext)'), 'notification sounds are routed too');
  const current = await t.js(a, 'window.__cc.speakers.deviceId');
  const target = outputs.find((id) => id !== current) ?? outputs[0];
  await t.change(a, '#audio-out', target);
  await t.expect(() => t.js(a, `[...window.__cc.speakers.elements].every((el) => el.sinkId === ${JSON.stringify(target)})`), 'changing AUDIO_OUT routes all playback to it', 5000);
  t.equal(await t.js(a, `localStorage.getItem('cc.audio-out')`), target, 'the choice is remembered');
  t.ok((await energy(t, a, 2000)) > 0.001, 'audio still arrives after an output switch');

  // Peer voice volume on the remote card.
  t.ok(!(await t.js(a, `document.getElementById('vol-voice').disabled`)), 'voice volume is usable during a call');
  await t.js(a, `(() => { const s = document.getElementById('vol-voice'); s.value = '35'; s.dispatchEvent(new Event('input')); })()`);
  t.equal(await t.js(a, 'window.__cc.voice.volume'), 0.35, 'slider sets the peer voice volume');
  t.equal(await t.js(a, `localStorage.getItem('cc.volume.voice')`), '0.35', 'voice volume is remembered');
  t.match(await t.js(a, `document.getElementById('vol-voice').title`), /VOICE_VOL 35%/, 'tooltip shows the value');
  await t.js(a, `(() => { const s = document.getElementById('vol-voice'); s.value = '100'; s.dispatchEvent(new Event('input')); })()`);

  // DSP toggle mid-call.
  await t.change(a, '#audio-settings [data-key="echoCancellation"]', false, 'checked');
  await t.expect(async () => (await t.js(a, 'window.__cc.microphone.track?.getSettings().echoCancellation')) === false, 'echo cancellation can be turned off live', 5000);
  await t.change(a, '#audio-settings [data-key="echoCancellation"]', true, 'checked');

  await t.terminate(a);
  t.ok(await t.js(a, `document.getElementById('vol-voice').disabled`), 'voice volume is disabled without a call');
  t.ok((await t.js(a, 'window.__cc.microphone.track === null')) && (await t.js(b, 'window.__cc.microphone.track === null')), 'mic released on both sides');
});
