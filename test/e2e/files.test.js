// File transfer: sizes with hash check, hostile names, decline, cancels, link drop, MOTW.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { e2e } = require('./harness');

const PAGE_HELPERS = `
window.__t = {
  async make(name, size) {
    const buf = new Uint8Array(size);
    for (let i = 0; i < size; i += 65536) crypto.getRandomValues(buf.subarray(i, Math.min(size, i + 65536)));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { file: new File([buf], name), hash };
  },
  find(name) { return [...window.__cc.transfers.transfers.values()].filter((t) => t.name === name).at(-1); },
  state(name) { const t = this.find(name); return t ? { status: t.status, bytes: t.bytes, savedAs: t.savedAs, reason: t.reason } : null; },
  press(name, label) {
    const line = [...document.querySelectorAll('#chat-log .transfer')].reverse()
      .find((l) => l.querySelector('.transfer-name')?.textContent === name && l.textContent.includes(label));
    const button = line && [...line.querySelectorAll('button')].find((b) => b.textContent === label);
    if (!button) return false;
    button.click();
    return true;
  },
}; true;`;

e2e('files', async (t) => {
  const { a, b } = t;
  t.ok(await t.js(a, `document.getElementById('btn-file').disabled`), '[ + ] is disabled without a link');
  await t.connectOrFail();
  await t.js(a, PAGE_HELPERS);
  await t.js(b, PAGE_HELPERS);
  const state = (win, name) => t.js(win, `__t.state(${JSON.stringify(name)})`);
  const status = async (win, name) => (await state(win, name))?.status;
  const offer = (name, size) => t.js(a, `(async () => { const { file, hash } = await __t.make(${JSON.stringify(name)}, ${size}); window.__cc.transfers.send([file]); return hash; })()`);
  const press = (win, name, label) => t.js(win, `__t.press(${JSON.stringify(name)}, ${JSON.stringify(label)})`);
  const parts = () => (fs.existsSync(t.downloads) ? fs.readdirSync(t.downloads).filter((f) => f.endsWith('.part')) : []);

  /** A offers, B accepts; returns the saved file name after checking content and MOTW. */
  async function roundTrip(name, size) {
    const hash = await offer(name, size);
    await t.expect(async () => (await status(b, name)) === 'offered', `${name}: offer arrives`, 8000);
    await press(b, name, 'ACCEPT');
    await t.expect(async () => (await status(b, name)) === 'done' && (await status(a, name)) === 'done', `${name}: transfer completes`, 120000, 100);
    const { savedAs } = await state(b, name);
    const saved = path.join(t.downloads, savedAs);
    t.equal(crypto.createHash('sha256').update(fs.readFileSync(saved)).digest('hex'), hash, `${name}: content is identical`);
    t.ok(fs.readFileSync(`${saved}:Zone.Identifier`, 'utf8').includes('ZoneId=3'), `${name}: has Mark-of-the-Web`);
    return savedAs;
  }

  await roundTrip('empty.bin', 0);
  await roundTrip('notes.txt', 1024);
  await roundTrip('photo.jpg', 5 * 1024 * 1024);
  await roundTrip('odd-size.zip', 40 * 1024 * 1024 + 3);
  t.equal(await roundTrip('notes.txt', 2048), 'notes (1).txt', 'an existing file is never overwritten');

  t.equal(await roundTrip('..\\..\\evil.bat', 10), 'evil.bat', 'path traversal is stripped');
  t.equal(await roundTrip('CON.txt', 10), '_CON.txt', 'reserved device names are defused');
  t.equal(await roundTrip('invoice‮gpj.exe', 10), 'invoice_gpj.exe', 'bidi override is removed from names');
  t.equal(fs.readdirSync(path.dirname(t.downloads)).join(), 'CryptChat', 'nothing is written outside Downloads\\CryptChat');

  // Decline + the warning for programs.
  await offer('setup.exe', 10);
  await t.expect(async () => (await status(b, 'setup.exe')) === 'offered', 'exe offer arrives', 8000);
  t.ok(await t.js(b, `[...document.querySelectorAll('#chat-log .transfer')].some((l) => l.querySelector('.transfer-name')?.textContent === 'setup.exe' && l.textContent.includes('PROGRAM'))`), 'programs get a warning before ACCEPT');
  await press(b, 'setup.exe', 'DECLINE');
  await t.expect(async () => (await status(a, 'setup.exe')) === 'declined', 'sender sees DECLINED', 5000);

  // Sender cancels before the peer answers.
  await offer('oops.txt', 100);
  await t.expect(async () => (await status(b, 'oops.txt')) === 'offered', 'offer arrives', 8000);
  await press(a, 'oops.txt', 'CANCEL');
  await t.expect(async () => (await status(b, 'oops.txt')) === 'canceled', 'receiver sees the cancel', 5000);

  // Receiver cancels mid-transfer: no .part left behind.
  await offer('movie.mkv', 150 * 1024 * 1024);
  await t.expect(async () => (await status(b, 'movie.mkv')) === 'offered', 'big offer arrives', 15000);
  await press(b, 'movie.mkv', 'ACCEPT');
  await t.expect(async () => ((await state(b, 'movie.mkv'))?.bytes ?? 0) > 8 * 1024 * 1024, 'big transfer is running', 30000, 20);
  t.equal(parts().length, 1, 'data goes to a .part file while active');
  await press(b, 'movie.mkv', 'CANCEL');
  await t.expect(async () => (await status(a, 'movie.mkv')) === 'canceled', 'sender sees the cancel', 5000);
  await t.expect(async () => parts().length === 0, '.part is deleted after a cancel', 5000);

  // Link drops mid-transfer: both fail, no .part left.
  await offer('drop.bin', 150 * 1024 * 1024);
  await t.expect(async () => (await status(b, 'drop.bin')) === 'offered', 'offer arrives', 15000);
  await press(b, 'drop.bin', 'ACCEPT');
  await t.expect(async () => ((await state(b, 'drop.bin'))?.bytes ?? 0) > 8 * 1024 * 1024, 'transfer is running', 30000, 20);
  await t.terminate(a);
  await t.expect(async () => (await status(b, 'drop.bin')) === 'failed' && (await status(a, 'drop.bin')) === 'failed', 'both sides fail the transfer', 5000);
  await t.expect(async () => parts().length === 0, '.part is deleted after a link drop', 5000);
}, { timeoutMs: 300000 });
