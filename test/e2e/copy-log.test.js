// COPY_LOG: copies KERNEL_LOG for a bug report with IPs, hosts, payloads and marked names
// masked (even with HIDE_IP_AND_PAYLOAD off), while the screen keeps showing everything.
const { clipboard } = require('electron');
const { e2e } = require('./harness');

e2e('copy log', async (t) => {
  const { a } = t;
  const write = (code) => t.js(a, `import('/js/core/logger.js').then(({ log, secret }) => { ${code} })`);
  await write(`
    log.info('File offered: ' + secret('my-tax-return.pdf') + ' (2 MB). Waiting for the peer to accept.');
    log.err('TEST_TURN failed: turn:relay.my-home.example:3478: 401 Unauthorized.', { notify: false });
    log.warn('Route via 203.0.113.77 and 2001:db8::5', { notify: false });
  `);

  // The screen is not affected (HIDE_IP_AND_PAYLOAD is off).
  t.ok(await t.logHas(a, /File offered: my-tax-return\.pdf/), 'KERNEL_LOG still shows the file name');
  t.ok(await t.logHas(a, /203\.0\.113\.77/), 'and the IP, since hiding is off');

  await clipboard.writeText('something else');
  await t.click(a, 'btn-copy-log');
  await t.expect(async () => (await clipboard.readText()).startsWith('CryptChat v'), 'the log lands in the clipboard', 3000);
  const text = await clipboard.readText();

  t.match(text, /^CryptChat v\S+ · Electron \S+ · Chromium \S+ · \S+/, 'it starts with the versions');
  t.match(text, /--- SYSTEM BOOT --- CryptChat v/, 'it has the whole session, boot line included');
  t.match(text, /File offered: \[hidden\] \(2 MB\)/, 'file names are hidden');
  t.ok(!text.includes('my-tax-return'), 'the file name appears nowhere');
  t.match(text, /turn:\[host\]:3478: 401 Unauthorized/, 'TURN host names are hidden, the error stays');
  t.ok(!text.includes('203.0.113.77') && !text.includes('2001:db8::5'), 'IP addresses are masked');
  t.match(text, /\[\d{2}:\d{2}:\d{2}\] (INFO|OK  |WARN|ERR ) /, 'lines carry a 24 h time and a level');
  await t.expect(() => t.logHas(a, /KERNEL_LOG copied \(\d+ lines\)/), 'KERNEL_LOG confirms the copy', 3000);
});
