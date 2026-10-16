// Chat: offline lock, aliases, both directions, hostile text, lock after drop.
const { e2e } = require('./harness');

const chatLines = (t, win) => t.js(win, `[...document.querySelectorAll('#chat-log .chat-line')].map((line) => line.textContent)`);
const names = (t, win) => t.js(win, `[...document.querySelectorAll('.peer-name')].map((name) => name.textContent)`);

e2e('chat', async (t) => {
  const { a, b } = t;

  t.ok(await t.js(a, `document.getElementById('chat-input').disabled`), 'chat is locked without a link');

  await t.connectOrFail();
  await t.expect(async () => !(await t.js(a, `document.getElementById('chat-input').disabled`)) && !(await t.js(b, `document.getElementById('chat-input').disabled`)), 'chat unlocks on both sides', 8000);

  // Aliases are sanitized and shown on the peer cards of the other side.
  await t.change(a, '#chat-alias', 'neo<b> ü');
  await t.change(b, '#chat-alias', 'trinity');
  t.equal(await t.val(a, 'chat-alias'), 'NEOB', 'alias is sanitized to A–Z 0–9 _ . -');
  await t.expect(async () => (await names(t, a))[1] === 'TRINITY' && (await names(t, b))[1] === 'NEOB', 'aliases reach the other side');

  await t.say(a, '  hello from A  ');
  await t.say(b, '<img src=x onerror="window.__pwned=1">');
  await t.say(b, 'safe‮evil\u0007bell');
  await t.say(a, '    '); // empty: not sent
  await t.expect(async () => (await chatLines(t, a)).length >= 4, 'messages arrive');

  const lines = await chatLines(t, a);
  t.ok(lines.includes('[ NEOB ] > hello from A'), 'own message is trimmed and shown');
  t.ok(lines.includes('[ TRINITY ] > <img src=x onerror="window.__pwned=1">'), 'HTML from the peer shows as plain text');
  t.ok(lines.includes('[ TRINITY ] > safeevilbell'), 'bidi override and control chars are stripped');
  t.equal(await t.js(a, `document.querySelectorAll('#chat-log img').length`), 0, 'no element was injected');
  t.equal(await t.js(a, 'window.__pwned === 1'), false, 'no script ran');
  t.equal(lines.filter((line) => line.startsWith('[ NEOB ] >')).length, 1, 'empty message was not sent');

  await t.terminate(a);
  t.ok(await t.js(b, `document.getElementById('chat-input').disabled`), 'chat locks again after the link drops');
  t.equal((await names(t, b))[1], 'REMOTE_USR', 'peer name resets');
});
