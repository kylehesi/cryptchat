// Screen share (needs real desktop capture, so local only): picker, AV1 default, live codec switch,
// TX/RX stats, PiP, fullscreen, stop, auto-stop on window close. System audio: system-audio.local.test.js.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { e2e, ROOT } = require('./harness');

const sentCodec = (t, win) => t.js(win, `(async () => {
  const st = await window.__cc.connection.session.slots.screen.sender.getStats(); let c = null;
  st.forEach((r) => { if (r.type === 'outbound-rtp') c = st.get(r.codecId)?.mimeType; }); return c; })()`);

const decodedFrames = (t, win) => t.js(win, `(async () => {
  let frames = 0;
  (await window.__cc.connection.session.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') frames = r.framesDecoded; });
  return frames; })()`);

e2e('screen (local)', async (t) => {
  const { a, b } = t;
  const pattern = spawn(process.execPath, [path.join(ROOT, 'test', 'fixtures', 'pattern-window.js')], { stdio: 'ignore' });
  const patternB = spawn(process.execPath, [path.join(ROOT, 'test', 'fixtures', 'pattern-window.js'), '--title=CC_TEST_PATTERN_B', '--x=240'], { stdio: 'ignore' });
  try {
    await t.sleep(2500);
    t.ok(await t.js(a, `document.getElementById('btn-share').disabled`), 'SHARE_SCR is disabled without a link');
    await t.connectOrFail();

    // Picker lists sources, never our own windows.
    await t.click(a, 'btn-share');
    await t.expect(() => t.js(a, `document.querySelectorAll('#source-grid .source-item').length > 0`), 'picker lists sources', 10000);
    t.ok(!(await t.js(a, `[...document.querySelectorAll('#source-grid .source-item')].some((i) => i.title === 'CryptChat')`)), 'our own window is not offered');
    t.ok(await t.js(a, `(() => { const i = [...document.querySelectorAll('#source-grid .source-item')].find((i) => i.title === 'CC_TEST_PATTERN'); i?.click(); return Boolean(i); })()`), 'test pattern window is listed');
    await t.js(a, `document.getElementById('share-audio').checked = true`);
    await t.click(a, 'btn-source-start');

    await t.expect(async () => !(await t.hidden(b, 'remote-video')) && (await t.js(b, `document.getElementById('remote-video').videoWidth > 0`)), 'B shows the feed', 10000);
    await t.expect(async () => (await sentCodec(t, a)) === 'video/AV1', 'AV1 is the default screen codec', 8000);
    await t.expect(async () => /TX AV1/.test(await t.text(a, 'screen-badge')) && /RX AV1/.test(await t.text(b, 'screen-rx')), 'TX/RX stats lines appear', 8000);

    // SYS_VOL appears for a share with system audio and drives the peer's system-audio volume.
    t.ok(!(await t.hidden(b, 'screen-volume')), 'SYS_VOL appears on the viewer');
    await t.js(b, `(() => { const s = document.getElementById('vol-system'); s.value = '40'; s.dispatchEvent(new Event('input')); })()`);
    t.equal(await t.js(b, 'window.__cc.screenShare.audioVolume'), 0.4, 'SYS_VOL sets the system-audio volume');
    t.equal(await t.text(b, 'vol-system-value'), '40%', 'SYS_VOL shows the value');
    t.equal(await t.js(b, 'window.__cc.voice.volume'), 1, 'voice volume is independent');
    if (process.env.CC_SHOT) {
      await t.sleep(2500);
      b.show(); b.webContents.invalidate(); await t.sleep(400);
      require('node:fs').writeFileSync(process.env.CC_SHOT, (await b.webContents.capturePage()).toPNG());
    }

    // Live codec switch: same SDP, different encoder.
    const sdpBefore = await t.js(a, 'window.__cc.connection.session.pc.localDescription.sdp');
    await t.change(a, '#video-codec', 'VP9');
    await t.expect(async () => (await sentCodec(t, a)) === 'video/VP9', 'switching to VP9 applies live', 10000);
    t.equal(await t.js(a, 'window.__cc.connection.session.pc.localDescription.sdp'), sdpBefore, 'no renegotiation was needed');
    await t.change(a, '#video-codec', 'auto');

    // SWITCH: change the shared window (and drop system audio) without stopping the broadcast.
    t.equal(await t.text(a, 'btn-share'), 'STOP', 'while sharing the button reads STOP');
    t.ok(!(await t.hidden(a, 'btn-switch')), 'SWITCH appears while sharing');
    await t.js(b, `(() => {
      window.__feedGaps = 0;
      window.__feedWatch = setInterval(() => { if (document.getElementById('remote-video').hidden) window.__feedGaps++; }, 25);
    })()`);
    const framesBefore = await decodedFrames(t, b);
    await t.click(a, 'btn-switch');
    await t.expect(() => t.js(a, `document.querySelectorAll('#source-grid .source-item').length > 1`), 'picker opens for switching', 10000);
    t.equal(await t.text(a, 'btn-source-start'), 'SWITCH_SOURCE', 'the start button says SWITCH_SOURCE');
    t.ok(await t.js(a, `[...document.querySelectorAll('#source-grid .source-item')].some((i) => i.title === 'CC_TEST_PATTERN' && i.textContent.includes('LIVE') && i.getAttribute('aria-selected') === 'true')`), 'the live source is marked and preselected');
    t.ok(await t.js(a, `document.getElementById('share-audio').checked`), 'current audio setting is prefilled');
    t.ok(await t.js(a, `(() => { const i = [...document.querySelectorAll('#source-grid .source-item')].find((i) => i.title === 'CC_TEST_PATTERN_B'); i?.click(); return Boolean(i); })()`), 'the second window is listed');
    await t.js(a, `document.getElementById('share-audio').checked = false`);
    await t.click(a, 'btn-source-start');
    await t.expect(async () => (await t.text(a, 'screen-badge')).includes('CC_TEST_PATTERN_B'), 'the badge shows the new source', 8000);
    t.ok(await t.logHas(a, /Switched to: CC_TEST_PATTERN_B/), 'the switch is logged');
    await t.expect(async () => (await t.hidden(b, 'screen-volume')), 'SYS_VOL hides when the new source has no audio', 5000);
    await t.sleep(1500);
    const framesAfter = await decodedFrames(t, b);
    t.ok(framesAfter > framesBefore, 'the viewer keeps decoding frames across the switch');
    t.equal(await t.js(b, 'clearInterval(window.__feedWatch), window.__feedGaps'), 0, 'the viewer never saw the feed disappear');
    t.ok(!(await t.logHas(b, /Peer stopped broadcasting/)), 'the viewer was never told the share stopped');
    t.equal(await t.js(a, 'window.__cc.screenShare.local.withAudio'), false, 'the broadcast now runs without audio');
    if (process.env.CC_SHOT_SENDER) {
      a.moveTop(); // a covered window is not repainted (native occlusion), so bring it up first
      a.show();
      await t.sleep(600);
      a.webContents.invalidate(); await t.sleep(400);
      require('node:fs').writeFileSync(process.env.CC_SHOT_SENDER, (await a.webContents.capturePage()).toPNG());
    }

    // PiP and fullscreen on the viewer (both need a user gesture).
    await t.js(b, `document.getElementById('btn-pip').click()`, true);
    await t.expect(() => t.js(b, `document.pictureInPictureElement?.id === 'remote-video'`), 'PiP opens', 4000);
    await t.js(b, 'document.exitPictureInPicture().catch(() => {})');
    await t.js(b, `document.getElementById('btn-fullscreen').click()`, true);
    await t.expect(() => t.js(b, `document.fullscreenElement?.id === 'screen'`), 'fullscreen opens', 4000);
    await t.js(b, 'document.exitFullscreen().catch(() => {})');
    await t.sleep(800);

    // STOP_SHARE, then share again and close the shared window: stops by itself.
    await t.click(a, 'btn-share');
    await t.expect(async () => !(await t.hidden(b, 'screen-placeholder')), 'viewer returns to the placeholder', 5000);
    t.ok(await t.hidden(b, 'screen-volume'), 'SYS_VOL hides when the share ends');
    await t.click(a, 'btn-share');
    await t.expect(() => t.js(a, `document.querySelectorAll('#source-grid .source-item').length > 0`), 'picker lists sources again', 10000);
    await t.js(a, `[...document.querySelectorAll('#source-grid .source-item')].find((i) => i.title === 'CC_TEST_PATTERN')?.click()`);
    await t.click(a, 'btn-source-start');
    await t.expect(async () => !(await t.hidden(b, 'remote-video')), 'sharing again', 8000);
    pattern.kill();
    await t.expect(async () => (await t.text(a, 'btn-share')) === 'SHARE_SCR' && !(await t.hidden(b, 'screen-placeholder')), 'broadcast stops when the shared window closes', 10000);
  } finally {
    pattern.kill();
    patternB.kill();
  }
}, { timeoutMs: 180000 });
