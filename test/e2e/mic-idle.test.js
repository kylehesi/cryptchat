// The microphone stays closed until a call: no capture at startup (device names are listed
// without it), capture during the call, closed again afterwards.
const { app, session } = require('electron');
const { e2e } = require('./harness');

// Every getUserMedia() reaches the permission request handler, so count the media requests
// there. Registered before main.js's own handler, which this wraps.
const micRequests = { a: 0, total: 0 };
app.whenReady().then(() => {
  const ses = session.defaultSession;
  const original = ses.setPermissionRequestHandler.bind(ses);
  ses.setPermissionRequestHandler = (handler) => original((webContents, permission, callback, details) => {
    if (permission === 'media' && details.mediaTypes?.includes('audio')) micRequests.total++;
    handler(webContents, permission, callback, details);
  });
});

e2e('mic idle', async (t) => {
  const { a, b } = t;
  await t.sleep(2000); // boot is long done (device lists, settings)

  t.equal(micRequests.total, 0, 'nothing captured audio at startup');
  t.ok((await t.js(a, 'window.__cc.microphone.devices.length')) > 0, 'microphones are listed anyway');
  t.ok(!(await t.js(a, 'window.__cc.microphone.labelsHidden')), 'with their real names');
  t.ok((await t.js(a, `document.getElementById('mic-src').options.length`)) > 0, 'MIC_SRC is filled');
  t.ok((await t.js(a, 'window.__cc.speakers.devices.length')) > 0, 'speakers are listed too');
  t.ok(await t.logHas(a, /Audio subsystem: \d+ input \/ \d+ output device\(s\) found\./), 'the boot line reports the devices');

  await t.connectOrFail();
  await t.expect(async () => (await t.js(a, 'window.__cc.microphone.track?.readyState')) === 'live', 'the call opens the mic', 10000);
  t.ok(micRequests.total >= 2, `both sides captured for the call (${micRequests.total} requests)`);

  await t.terminate(a);
  await t.expect(async () => (await t.js(a, 'window.__cc.microphone.track')) === null && (await t.js(b, 'window.__cc.microphone.track')) === null, 'the mic closes again when the call ends', 5000);
});
