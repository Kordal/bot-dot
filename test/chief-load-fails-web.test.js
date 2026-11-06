// A Chief chat that fails to load on the web page (#1075): the screen still shows the chat that was there, and the
// box writes to that chat, not to the one picked. The page's own showChat, cut out of it and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element, words } = require('./web-page');

function chief(reply) {
  const t = element({}, { scrollHeight: 0, scrollTop: 0 });
  t.dataset.chat = 'c1';
  const form = element({}, { text: element() });
  const state = { chatId: 'c1', chatStream: null, view: 'chief', jump: null };
  const said = { toasts: [], hash: [], present: [], read: 0 };
  const ctx = vm.createContext({ ...words, state,
    $: (sel) => (sel === '#chat-thread' ? t : sel === '#view-chief form' ? form : null), $$: () => [],
    api: reply, newLine: { first: () => null }, toast: (...a) => said.toasts.push(a),
    writeHash: () => said.hash.push(state.chatId), sayPresent: () => said.present.push(state.chatId), syncRead: () => said.read++,
  });
  vm.runInContext(`${cut('async function showChat(id) {', '// Stop the Chief\'s reply in a chat')}\nthis.showChat = showChat;`, ctx);
  return { ctx, state, said, t };
}

test('web: a chat that could not be read leaves the box writing to the chat on screen, and the address saying it', async () => {
  const c = chief(async () => { throw new Error("Can't reach botdot."); });
  await c.ctx.showChat('c2');
  assert.deepEqual(c.said.toasts, [["Can't reach botdot.", true]]);
  assert.equal(c.state.chatId, 'c1', 'the box sends to the chat it shows');
  assert.equal(c.said.hash.at(-1), 'c1');
  assert.equal(c.said.present.at(-1), 'c1');
});

test('web: from a new chat it goes back to the new chat', async () => {
  const c = chief(async () => { throw new Error("Can't reach botdot."); });
  delete c.t.dataset.chat;
  c.state.chatId = null;
  await c.ctx.showChat('c2');
  assert.equal(c.state.chatId, null);
});

test('web: a chat picked meanwhile is not undone by one that failed before it', async () => {
  let fail;
  const c = chief(() => new Promise((_, no) => { fail = no; }));
  const first = c.ctx.showChat('c2');
  c.state.chatId = 'c3'; // the owner picked another chat while the first was read
  fail(new Error("Can't reach botdot."));
  await first;
  assert.equal(c.state.chatId, 'c3');
});
