// Receive-side disk errors: the app must not crash, both sides get a readable reason, and the
// local path (which contains the Windows user name) never reaches the log or the peer.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Writable } = require('node:stream');
const { e2e } = require('./harness');

const SECRET_PATH = 'C:\\Users\\secret-user\\Downloads\\CryptChat\\x.part';
const fsError = (code, syscall) => Object.assign(new Error(`${code}: failure, ${syscall} '${SECRET_PATH}'`), { code });

// Swap fs.promises.open (what file-receive.js uses) for the duration of one scenario.
const realOpen = fsp.open;
function failWrites(code) {
  fsp.open = async (...args) => {
    const handle = await realOpen(...args);
    handle.createWriteStream = () => {
      // Asynchronous, like a real disk error (one reported at once would make write() return false).
      const stream = new Writable({ write: (chunk, encoding, done) => setTimeout(() => done(fsError(code, 'write')), 5) });
      stream.once('close', () => handle.close().catch(() => {}));
      return stream;
    };
    return handle;
  };
}
function failOpen(code) {
  fsp.open = async () => { throw fsError(code, 'open'); };
}
const restore = () => { fsp.open = realOpen; };

// Electron does not exit on an uncaught main-process exception: it shows the user an error
// dialog and carries on. Record them instead, so the test can tell.
const uncaught = [];
process.on('uncaughtException', (error) => uncaught.push(error));

e2e('file errors', async (t) => {
  const { a, b } = t;
  await t.connectOrFail();
  const state = (win, name) => t.js(win, `(() => { const x = [...window.__cc.transfers.transfers.values()].filter((t) => t.name === ${JSON.stringify(name)}).at(-1); return x ? { status: x.status, reason: x.reason } : null; })()`);
  const offer = (name, size) => t.js(a, `window.__cc.transfers.send([new File([new Uint8Array(${size})], ${JSON.stringify(name)})])`);
  const accept = (name) => t.js(b, `window.__cc.transfers.accept([...window.__cc.transfers.transfers.values()].find((t) => t.name === ${JSON.stringify(name)}).id)`);
  const leaked = async () => [...await t.logLines(a), ...await t.logLines(b)].some((line) => line.includes('secret-user'));

  // 1) The disk fills up while receiving.
  failWrites('ENOSPC');
  await offer('big.bin', 3 * 1024 * 1024);
  await t.expect(async () => (await state(b, 'big.bin'))?.status === 'offered', 'the offer arrives', 8000);
  await accept('big.bin');
  await t.expect(async () => (await state(b, 'big.bin'))?.status === 'failed', 'the receiver stops the transfer', 15000);
  await t.expect(async () => (await state(a, 'big.bin'))?.status === 'failed', 'the sender is told', 10000);
  t.match((await state(b, 'big.bin')).reason, /Not enough free disk space/, 'the receiver reads why');
  t.match((await state(a, 'big.bin')).reason, /Not enough free disk space/, 'the sender reads why');

  // A small write fits the stream's buffer and is not awaited: its error must still end the
  // transfer cleanly (here it surfaces at close).
  await offer('small.bin', 100);
  await t.expect(async () => (await state(b, 'small.bin'))?.status === 'offered', 'a small offer arrives', 8000);
  await accept('small.bin');
  await t.expect(async () => (await state(b, 'small.bin'))?.status === 'failed', 'a small file fails cleanly too', 15000);
  t.match((await state(b, 'small.bin')).reason, /Not enough free disk space/, 'with the same reason');
  restore();

  // 2) Windows refuses to create the file at all.
  failOpen('EACCES');
  await offer('denied.txt', 100);
  await t.expect(async () => (await state(b, 'denied.txt'))?.status === 'offered', 'the second offer arrives', 8000);
  await accept('denied.txt');
  await t.expect(async () => ['failed', 'declined'].includes((await state(a, 'denied.txt'))?.status), 'the sender learns it cannot be received', 10000);
  t.match((await state(a, 'denied.txt')).reason, /Windows denied writing to Downloads\\CryptChat/, 'with a readable reason');
  restore();

  t.equal(uncaught.map((error) => error.message), [], 'no uncaught error in the main process (no error dialog)');
  t.ok(!(await leaked()), 'no local path (Windows user name) in either log');
  t.equal(fs.existsSync(t.downloads) ? fs.readdirSync(t.downloads).filter((f) => f.endsWith('.part')) : [], [], 'no .part files are left behind');

  // The app is still fine: a normal transfer works afterwards.
  await offer('after.txt', 1000);
  await t.expect(async () => (await state(b, 'after.txt'))?.status === 'offered', 'a new offer arrives', 8000);
  await accept('after.txt');
  await t.expect(async () => (await state(b, 'after.txt'))?.status === 'done', 'and completes', 15000);
});
