// HIDE_IP_AND_PAYLOAD: payloads drawn as HIDDEN (click copies the real one), IPs masked in the
// log (and back when turned off), sensitive settings dotted, remembered, links still work.
const { clipboard } = require('electron');
const { e2e } = require('./harness');

const style = (t, win, selector, property, pseudo = null) =>
  t.js(win, `getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo)}).getPropertyValue(${JSON.stringify(property)})`);

e2e('privacy', async (t) => {
  const { a, b } = t;

  // Off by default: the payload is drawn normally.
  t.equal(await t.js(a, `document.body.classList.contains('hide-sensitive')`), false, 'off by default');

  // Turn it on from the settings dialog.
  await t.click(a, 'btn-settings');
  await t.change(a, '#hide-sensitive', true, 'checked');
  await t.click(a, 'btn-settings-close');
  t.ok(await t.js(a, `document.body.classList.contains('hide-sensitive')`), 'the setting applies at once');
  t.equal(await t.js(a, `localStorage.getItem('cc.privacy')`), '{"hidden":true}', 'the setting is remembered');

  // Generate: the payload exists but is not drawn; the box says HIDDEN with the length.
  await t.click(a, 'btn-generate');
  await t.expect(async () => (await t.val(a, 'local-payload')).startsWith('CC1.'), 'payload is generated as usual');
  const payload = await t.val(a, 'local-payload');
  t.equal(await style(t, a, '#local-payload', 'color'), 'rgba(0, 0, 0, 0)', 'payload text is not drawn');
  t.match(await style(t, a, '.payload-box:has(#local-payload)', 'content', '::after'), new RegExp(`HIDDEN · ${payload.length} CHARS · CLICK TO COPY`), 'the box shows HIDDEN with the length');

  if (process.env.CC_SHOT) {
    await t.js(a, `import('/js/core/logger.js').then(({ log }) => log.err('TEST_TURN failed: turn:198.51.100.23:3478: 401 Unauthorized.', { notify: false }))`);
    a.moveTop(); a.webContents.invalidate(); await t.sleep(500);
    require('node:fs').writeFileSync(process.env.CC_SHOT, (await a.webContents.capturePage()).toPNG());
  }

  // Click → real payload in the clipboard.
  // (In this Electron version the main-process clipboard API returns promises.)
  await clipboard.writeText('something else');
  await t.click(a, 'local-payload');
  await t.expect(async () => (await clipboard.readText()) === payload, 'a click copies the real payload', 3000);

  // Log: IPs masked, and shown again when the setting is turned off.
  await t.js(a, `import('/js/core/logger.js').then(({ log }) => log.warn('TEST: turn:203.0.113.77:3478 and 2001:db8::1 refused', { notify: false }))`);
  const lastLine = () => t.js(a, `[...document.querySelectorAll('#kernel-log .log-line')].map((l) => l.textContent).filter((l) => l.includes('TEST: turn:')).at(-1)`);
  await t.expect(async () => Boolean(await lastLine()), 'the test line is logged', 3000);
  t.ok(!(await lastLine()).includes('203.0.113.77') && (await lastLine()).includes('•••.•••.•••.•••'), 'IPv4 is masked in the log');
  t.ok(!(await lastLine()).includes('2001:db8::1'), 'IPv6 is masked in the log');
  t.match(await lastLine(), /\[\d{1,2}:\d{2}:\d{2} [AP]M\]/, 'timestamps are not mistaken for IPs');

  // Sensitive settings fields are dotted.
  t.equal(await style(t, a, '#net-turn-urls', '-webkit-text-security'), 'disc', 'TURN URLs are dotted');
  t.equal(await style(t, a, '#net-cf-key', '-webkit-text-security'), 'disc', 'Cloudflare key ID is dotted');

  // The link still works with everything hidden.
  await t.setVal(b, 'remote-payload', payload);
  await t.click(b, 'btn-connect');
  await t.expect(async () => (await t.val(b, 'local-payload')).startsWith('CC1.'), 'B answers');
  await t.setVal(a, 'remote-payload', await t.val(b, 'local-payload'));
  await t.click(a, 'btn-connect');
  await t.expect(() => t.connected(), 'the link opens with hiding on', 20000);

  // Turn it off: everything is drawn again, including the old log line.
  await t.change(a, '#hide-sensitive', false, 'checked');
  t.ok((await lastLine()).includes('203.0.113.77'), 'the old log line shows the IP again');
  t.equal(await style(t, a, '#net-turn-urls', '-webkit-text-security'), 'none', 'fields are readable again');
  await t.terminate(a);
});
