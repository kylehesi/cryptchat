// Screen share (needs real desktop capture, so local only): picker, AV1 default, live codec switch,
// TX/RX stats, PiP, fullscreen, stop, auto-stop on window close. System audio: system-audio.local.test.js.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { e2e, ROOT } = require('./harness');

const sentCodec = (t, win) => t.js(win, `(async () => {
  const st = await window.__cc.connection.session.slots.screen.sender.getStats(); let c = null;
  st.forEach((r) => { if (r.type === 'outbound-rtp') c = st.get(r.codecId)?.mimeType; }); return c; })()`);

e2e('screen (local)', async (t) => {
  const { a, b } = t;
  const pattern = spawn(process.execPath, [path.join(ROOT, 'test', 'fixtures', 'pattern-window.js')], { stdio: 'ignore' });
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

    // Live codec switch: same SDP, different encoder.
    const sdpBefore = await t.js(a, 'window.__cc.connection.session.pc.localDescription.sdp');
    await t.change(a, '#video-codec', 'VP9');
    await t.expect(async () => (await sentCodec(t, a)) === 'video/VP9', 'switching to VP9 applies live', 10000);
    t.equal(await t.js(a, 'window.__cc.connection.session.pc.localDescription.sdp'), sdpBefore, 'no renegotiation was needed');
    await t.change(a, '#video-codec', 'auto');

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
    await t.click(a, 'btn-share');
    await t.expect(() => t.js(a, `document.querySelectorAll('#source-grid .source-item').length > 0`), 'picker lists sources again', 10000);
    await t.js(a, `[...document.querySelectorAll('#source-grid .source-item')].find((i) => i.title === 'CC_TEST_PATTERN')?.click()`);
    await t.click(a, 'btn-source-start');
    await t.expect(async () => !(await t.hidden(b, 'remote-video')), 'sharing again', 8000);
    pattern.kill();
    await t.expect(async () => (await t.text(a, 'btn-share')) === 'SHARE_SCR' && !(await t.hidden(b, 'screen-placeholder')), 'broadcast stops when the shared window closes', 10000);
  } finally {
    pattern.kill();
  }
}, { timeoutMs: 180000 });
