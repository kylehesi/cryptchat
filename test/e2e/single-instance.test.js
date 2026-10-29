// Single-instance lock: a second launch with the same profile quits at once and brings the
// running window to the front; another profile still gets its own instance.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { e2e, ROOT } = require('./harness');

/** Starts another CryptChat process on `userData`; resolves with its exit code (or 'running'). */
function launch(t, userData, waitMs) {
  const boot = path.join(t.tmp, `boot-${Date.now()}.js`);
  fs.writeFileSync(boot, `require('electron').app.setPath('userData', ${JSON.stringify(userData)});\nrequire(${JSON.stringify(path.join(ROOT, 'src', 'main', 'main.js'))});\n`);
  const child = spawn(process.execPath, [boot], { stdio: 'ignore' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 'running', child }), waitMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, child });
    });
  });
}

e2e('single instance', async (t) => {
  const main = t.a;
  let signalled = 0;
  app.on('second-instance', () => signalled++);

  main.minimize();
  await t.expect(() => main.isMinimized(), 'the main window is minimized', 5000);

  const second = await launch(t, app.getPath('userData'), 15000);
  t.equal(second.code, 0, 'a second launch with the same profile quits by itself');
  await t.expect(() => signalled === 1, 'the running instance is told about it', 5000);
  await t.expect(() => !main.isMinimized(), 'the running window comes back to the front', 5000);
  t.equal(BrowserWindow.getAllWindows().length, 2, 'no extra window was opened');

  // A different profile (another userData folder) is a separate instance and keeps running.
  const other = await launch(t, path.join(t.tmp, 'other-profile'), 6000);
  t.equal(other.code, 'running', 'another profile starts its own instance');
  other.child.kill();
}, { timeoutMs: 60000 });
