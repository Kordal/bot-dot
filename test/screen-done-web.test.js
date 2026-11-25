// #1743: "I'm done" on a bot's screen (ADR 225) closes the window whatever the server answers; the server's words
// still show as a toast. The web page's screenDone() run against stand-ins for the page's api, toast and dialog.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const computers = fs.readFileSync(path.join(__dirname, '..', 'public', 'computers.js'), 'utf8');
const start = computers.indexOf('function screenDone(m, bot) {');
const source = computers.slice(start, computers.indexOf('\n}\n', start) + 2);

// Presses the button with the server answering `answer`: what the page did (calls, toasts, whether it closed).
async function press(answer) {
  const button = { disabled: false, onclick: null };
  const calls = [];
  const toasts = [];
  const closed = [];
  const m = { close: () => closed.push(true) };
  const api = async (url, opts) => { calls.push([url, opts.method]); return answer(); };
  const refreshed = [];
  const run = new Function('$', 'api', 'toast', 'tr', 'refresh', `${source}; return screenDone;`);
  run(() => button, api, (text, isError) => toasts.push([text, !!isError]), (s) => s, () => refreshed.push(true))(m, { id: 'b1' });
  await button.onclick();
  return { calls, toasts, closed: closed.length, refreshed: refreshed.length, button };
}

test('I\'m done closes the screen and shows the words of the server when it went', async () => {
  const r = await press(async () => ({ ok: true, text: 'Form Maker carries on.' }));
  assert.deepEqual(r.calls, [['/bots/b1/computer/done', 'POST']]);
  assert.deepEqual(r.toasts, [['Form Maker carries on.', false]]);
  assert.equal(r.closed, 1);
  assert.equal(r.refreshed, 1, 'the card of the step it carries on is answered too (ADR 258)');
});

test('I\'m done closes the screen when the server refuses, and the toast has its words', async () => {
  for (const words of ['Idle has nothing to carry on. Write to it in its chat.', 'Idle is working on it already.']) {
    const r = await press(async () => { throw new Error(words); });
    assert.deepEqual(r.toasts, [[words, true]]);
    assert.equal(r.closed, 1);
  }
});

test('I\'m done closes the screen when the network fails, and the toast has the error', async () => {
  const r = await press(async () => { throw new TypeError('Failed to fetch'); });
  assert.deepEqual(r.toasts, [['Failed to fetch', true]]);
  assert.equal(r.closed, 1);
});
