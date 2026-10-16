// Notifications: which event plays which sound, highlights until seen, taskbar flash, own actions
// stay quiet, settings. B is the hidden ("background") window.
const { e2e } = require('./harness');

const history = (t, win) => t.js(win, 'window.__cc.sounds.history.map((h) => h.variant ? h.name + ":" + h.variant : h.name)');
const has = (t, win, id, cls) => t.js(win, `document.querySelector(${JSON.stringify(id)}).classList.contains(${JSON.stringify(cls)})`);
const sinceIndex = async (t, win) => (await history(t, win)).length;
const after = async (t, win, index) => (await history(t, win)).slice(index);

e2e('notifications', async (t) => {
  const { a, b } = t;

  // Every sound renders audible, short and without clipping.
  const rendered = await t.js(a, `(async () => {
    const { renderSound } = await import('/js/media/sounds.js');
    const out = {};
    for (const [name, variant] of [['message'], ['console'], ['disconnect'], ['ui', 'click'], ['ui', 'on'], ['ui', 'off']]) {
      const data = (await renderSound(name, variant)).getChannelData(0);
      let peak = 0, last = 0;
      for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > peak) peak = v; if (v > 0.001) last = i; }
      out[name + (variant ? ':' + variant : '')] = { peak: +peak.toFixed(3), ms: Math.round(last / 48) };
    }
    return out;
  })()`);
  for (const [name, { peak, ms }] of Object.entries(rendered)) {
    t.ok(peak > 0.02 && peak < 0.99, `${name} is audible and does not clip (peak ${peak})`);
    t.ok(ms < 1100, `${name} is short (${ms} ms)`);
  }
  const flashes = [];
  b.flashFrame = (flag) => flashes.push(flag); // observe the main-process taskbar flash for B

  // Link up: the 'console' sound on both sides.
  await t.connectOrFail();
  await t.expect(async () => (await history(t, a)).includes('console') && (await history(t, b)).includes('console'), 'link up plays the system sound on both sides', 3000);

  // A message for B, who is in the background.
  let mark = await sinceIndex(t, b);
  await t.say(a, 'ping from A');
  await t.expect(async () => (await after(t, b, mark)).includes('message'), 'an incoming message plays the message sound', 3000);
  t.ok(await has(t, b, '.panel-chat', 'is-unseen-accent'), 'the chat panel glows');
  t.ok(await t.js(b, `document.getElementById('chat-log').lastElementChild.classList.contains('is-unseen')`), 'the new line glows');
  await t.expect(async () => flashes.includes(true), 'the taskbar button flashes while in the background', 3000);
  if (process.env.CC_SHOT) {
    await t.js(b, `import('/js/core/logger.js').then(({ log }) => log.warn('TEST: link unstable'))`);
    b.showInactive(); // visible but still not focused, so the highlights stay on
    await t.sleep(500);
    b.webContents.invalidate();
    await t.sleep(300);
    require('node:fs').writeFileSync(process.env.CC_SHOT, (await b.webContents.capturePage()).toPNG());
  }
  await t.sleep(3500);
  t.ok(await has(t, b, '.panel-chat', 'is-unseen'), 'it stays lit until the user looks');

  // B looks at the window: the glow fades a few seconds later, the flash stops.
  b.show();
  b.focus();
  await t.expect(async () => flashes.includes(false), 'focusing the window stops the flash', 3000);
  await t.sleep(1000);
  t.ok(await has(t, b, '.panel-chat', 'is-unseen'), 'still bright right after looking');
  await t.expect(async () => !(await has(t, b, '.panel-chat', 'is-unseen')), 'the glow fades a few seconds after looking', 5000);

  // Our own message makes no message sound on our side.
  mark = await sinceIndex(t, a);
  await t.say(a, 'own message');
  await t.sleep(400);
  t.ok(!(await after(t, a, mark)).includes('message'), 'own messages are silent');

  // UI sounds: any button = click; mic/deafen = on/off without an extra click.
  mark = await sinceIndex(t, a);
  await t.click(a, 'btn-help');
  await t.click(a, 'btn-help-close');
  t.equal(await after(t, a, mark), ['ui:click', 'ui:click'], 'buttons play the UI click');
  mark = await sinceIndex(t, a);
  await t.click(a, 'btn-mic');
  await t.click(a, 'btn-mic');
  await t.click(a, 'btn-deafen');
  await t.click(a, 'btn-deafen');
  t.equal(await after(t, a, mark), ['ui:off', 'ui:on', 'ui:off', 'ui:on'], 'mic/deafen play off/on, no extra click');

  // System alerts: errors and warnings ring, own-action confirmations do not.
  mark = await sinceIndex(t, b);
  await t.js(b, `import('/js/core/logger.js').then(({ log }) => log.err('TEST: something broke'))`);
  await t.expect(async () => (await after(t, b, mark)).includes('console'), 'an error plays the system sound', 3000);
  t.ok(await has(t, b, '.panel-log', 'is-unseen-danger'), 'the log panel glows red for an error');
  mark = await sinceIndex(t, b);
  await t.js(b, `import('/js/core/logger.js').then(({ log }) => log.warn('TEST: you did this', { notify: false }))`);
  await t.sleep(400);
  t.equal(await after(t, b, mark), [], 'a warning marked notify:false stays silent');

  // An incoming file: message sound + its line glows.
  mark = await sinceIndex(t, b);
  await t.js(a, `window.__cc.transfers.send([new File([new Uint8Array(16)], 'note.txt')]); true`);
  await t.expect(async () => (await after(t, b, mark)).includes('message'), 'an incoming file plays the message sound', 3000);
  t.ok(await t.js(b, `document.querySelector('#chat-log [data-transfer-id]:last-of-type')?.classList.contains('is-unseen') ?? false`), 'the file line glows');

  // A terminates: B hears the alarm (and only the alarm), A hears just its own click.
  const markA = await sinceIndex(t, a);
  mark = await sinceIndex(t, b);
  await t.terminate(a);
  await t.sleep(400);
  t.equal(await after(t, b, mark), ['disconnect'], 'the peer gets one alarm, not alarm + system sound');
  t.ok(await has(t, b, '#peer-remote', 'is-unseen-danger'), 'the peer card glows red');
  t.ok(!(await after(t, a, markA)).includes('disconnect'), 'our own TERMINATE_LINK raises no alarm');

  // Settings: switches persist and take effect.
  await t.click(b, 'btn-settings');
  await t.change(b, '#notify-settings [data-key="eventsEnabled"]', false, 'checked');
  t.equal(JSON.parse(await t.js(b, `localStorage.getItem('cc.notify')`)).eventsEnabled, false, 'EVENT_SOUNDS off is remembered');
  mark = await sinceIndex(t, b);
  await t.js(b, `window.__cc.sounds.event('message')`);
  await t.sleep(400);
  t.equal(await after(t, b, mark), [], 'EVENT_SOUNDS off silences event sounds');
  await t.js(b, `document.querySelector('[data-test-sound="disconnect"]').click()`);
  t.equal((await after(t, b, mark)).at(-1), 'disconnect', 'TEST buttons still preview the sound');
  await t.change(b, '#notify-settings [data-key="eventsEnabled"]', true, 'checked');
});
