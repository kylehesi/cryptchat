'use strict';

// Shared harness for the two-window end-to-end tests. Each test file is an Electron entry point:
//
//   electron test/e2e/chat.test.js        (or: npm run test:e2e)
//
// It boots the real app (src/main/main.js) with a throwaway profile and Downloads folder,
// opens a second app window as the peer ("B"), runs the test body, prints PASS/FAIL and exits.
// Microphones are Chromium's fake devices, so no real mic is ever opened.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'src', 'main', 'main.js');
const PRELOAD = path.join(ROOT, 'src', 'preload', 'preload.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} name
 * @param {(t: ReturnType<typeof makeContext>) => Promise<void>} body
 * @param {{ timeoutMs?: number, switches?: [string, string?][], showWindows?: boolean, fakeMedia?: boolean }} [options]
 *   fakeMedia: false uses real capture devices. Needed for system-audio tests, because the fake
 *   switch also replaces loopback audio with a synthetic beep.
 */
function e2e(name, body, { timeoutMs = 180000, switches = [], showWindows = false, fakeMedia = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptchat-test-'));
  app.setPath('userData', path.join(tmp, 'userData'));
  app.setPath('downloads', path.join(tmp, 'downloads'));
  if (fakeMedia) app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  for (const [key, value] of switches) app.commandLine.appendSwitch(key, value);

  let started = false;
  app.on('browser-window-created', (event, first) => {
    if (started) return;
    started = true;
    first.webContents.once('did-finish-load', async () => {
      const b = new BrowserWindow({
        width: 980, height: 600, useContentSize: true, show: showWindows,
        webPreferences: {
          preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false,
          backgroundThrottling: false, additionalArguments: ['--cc-dev', '--cc-version=test'],
        },
      });
      // Window A stays visible: a hidden window gets throttled timers, which would distort
      // things like the speaking indicator. B has throttling disabled instead.
      await b.loadURL('app://cryptchat/index.html');

      const t = makeContext(first, b, tmp);
      const started = Date.now();
      let exitCode = 0;
      const timer = setTimeout(() => {
        console.log(`FAIL ${name}: timed out after ${timeoutMs / 1000} s`);
        finish(1);
      }, timeoutMs);

      try {
        await sleep(600); // let both windows finish booting (mic probe, settings)
        await body(t);
        console.log(`PASS ${name} (${t.checks} checks, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
      } catch (error) {
        exitCode = 1;
        console.log(`FAIL ${name}: ${error.message}`);
        if (error.stack) console.log(error.stack.split('\n').slice(1, 4).join('\n'));
        for (const [label, win] of [['A', t.a], ['B', t.b]]) {
          console.log(`---- KERNEL_LOG ${label} (tail) ----\n${(await t.logLines(win).catch(() => [])).slice(-8).join('\n')}`);
        }
      }
      clearTimeout(timer);
      finish(exitCode);
    });
  });

  function finish(code) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // a locked file in a temp folder is not worth failing the run
    }
    app.exit(code);
  }

  require(MAIN);
}

function makeContext(a, b, tmp) {
  const js = (win, code, userGesture = false) => win.webContents.executeJavaScript(code, userGesture);

  const t = {
    a,
    b,
    tmp,
    checks: 0,
    downloads: path.join(tmp, 'downloads', 'CryptChat'),
    sleep,
    js,
    click: (win, id) => js(win, `document.getElementById(${JSON.stringify(id)}).click()`),
    val: (win, id) => js(win, `document.getElementById(${JSON.stringify(id)}).value`),
    setVal: (win, id, value) => js(win, `document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(value)}`),
    text: (win, id) => js(win, `document.getElementById(${JSON.stringify(id)}).textContent`),
    hidden: (win, id) => js(win, `document.getElementById(${JSON.stringify(id)}).hidden`),
    phase: (win) => js(win, 'window.__cc.connection.phase'),
    logLines: (win) => js(win, `[...document.querySelectorAll('#kernel-log .log-line')].map((line) => line.textContent)`),

    /** Polls `fn` until it returns truthy; returns false on timeout (never throws). */
    async waitFor(fn, ms = 20000, step = 100) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await fn()) return true;
        await sleep(step);
      }
      return false;
    },

    /** Like waitFor, but fails the test with `message` on timeout. */
    async expect(fn, message, ms = 20000, step = 100) {
      t.checks += 1;
      assert.ok(await t.waitFor(fn, ms, step), message);
    },

    ok(value, message) {
      t.checks += 1;
      assert.ok(value, message);
    },
    equal(actual, expected, message) {
      t.checks += 1;
      assert.deepEqual(actual, expected, message);
    },
    match(textValue, regex, message) {
      t.checks += 1;
      assert.match(String(textValue), regex, message);
    },

    async logHas(win, regex) {
      return (await t.logLines(win)).some((line) => regex.test(line));
    },

    /** Full copy-paste handshake A (offerer) ↔ B (answerer). `tamperOffer` may rewrite A's payload. */
    async connect({ tamperOffer, wrap = false } = {}) {
      await t.click(a, 'btn-generate');
      await t.expect(async () => (await t.val(a, 'local-payload')).startsWith('CC1.'), 'A produced an OFFER payload');
      let offer = await t.val(a, 'local-payload');
      if (tamperOffer) offer = await tamperOffer(offer);
      if (wrap) offer = offer.replace(/(.{60})/g, '$1\n'); // like a chat app wrapping long lines
      await t.setVal(b, 'remote-payload', offer);
      await t.click(b, 'btn-connect');
      await t.expect(async () => (await t.val(b, 'local-payload')).startsWith('CC1.'), 'B produced an ANSWER payload');
      await t.setVal(a, 'remote-payload', await t.val(b, 'local-payload'));
      await t.click(a, 'btn-connect');
    },

    async connected() {
      return (await t.phase(a)) === 'connected' && (await t.phase(b)) === 'connected';
    },

    async connectOrFail(options) {
      await t.connect(options);
      await t.expect(() => t.connected(), 'both sides reach "connected"', 30000);
    },

    /** TERMINATE_LINK from `win`; waits until both sides are idle. */
    async terminate(win = a) {
      await t.click(win, 'btn-generate');
      await t.expect(async () => (await t.phase(a)) === 'idle' && (await t.phase(b)) === 'idle', 'both sides back to idle', 10000);
    },

    /** Sets an <input>/<select> value and fires 'change', as a user would. */
    async change(win, selector, value, property = 'value') {
      await js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el[${JSON.stringify(property)}] = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change')); })()`);
    },

    async say(win, message) {
      await js(win, `(() => { document.getElementById('chat-input').value = ${JSON.stringify(message)}; document.getElementById('chat-form').requestSubmit(); })()`);
    },
  };
  return t;
}

module.exports = { e2e, ROOT };
