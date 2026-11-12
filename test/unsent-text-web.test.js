// Unsent text per chat on the web page (#1068): what the owner typed in a bot's or a group's chat and did not send
// waits for that chat when the view is built again for another one, and is put back once its box is built again,
// behind a failed message given back. The page's own code, cut out of it and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, cut, read, element } = require('./web-page');

function page() {
  const ctx = vm.createContext({ $: (sel, root) => root.querySelector(sel), Event: class { constructor(type) { this.type = type; } } });
  vm.runInContext(`${cut('// A failed message back in the box,', '// A message whose send failed after')}
    ${cut("// What was typed and not sent in a chat whose box", '// The chat of a bot drawn on the page')}
    Object.assign(this, { carry, putCarried, carried });`, ctx);
  return ctx;
}
// A chat's root and its box: the textarea is the form's text.
function chat(value = '') {
  const inputs = [];
  const text = { value, dispatchEvent: (e) => inputs.push(e.type) };
  const form = element({}, { text });
  return { root: element({ textarea: text }), form, text, inputs };
}

test('web: text typed in one chat waits for it while another is drawn, and comes back once when it is drawn again', () => {
  const p = page();
  const a = chat('Check the invoices from');
  p.carry(a.root, 'bot:writer');
  const b = chat();
  p.putCarried(b.form, 'bot:coder');
  assert.equal(b.text.value, '', 'not into another chat');
  const back = chat();
  p.putCarried(back.form, 'bot:writer');
  assert.equal(back.text.value, 'Check the invoices from');
  assert.deepEqual(back.inputs, ['input'], 'the box grows to it');
  const again = chat();
  p.putCarried(again.form, 'bot:writer');
  assert.equal(again.text.value, '', 'put back once');
  // An empty box keeps nothing; a group is kept by its own key.
  p.carry(chat('  ').root, 'bot:coder');
  p.carry(chat('Plan for Monday').root, 'group:g1');
  assert.deepEqual([...p.carried.keys()], ['group:g1']);
});

test('web: a failed message given back stands in front of the text that waited', () => {
  const p = page();
  p.carry(chat('and the second thing').root, 'group:g1');
  const box = chat('Send the report');
  p.putCarried(box.form, 'group:g1');
  assert.equal(box.text.value, 'Send the report\nand the second thing');
});

test("web: a bot's and a group's chat keep the typed text before their view is built again for another chat", () => {
  const bot = cut('function renderBotChat(root', '// Re-render the thread only when something changed');
  assert.ok(bot.includes("if (root.dataset.bot) carry(root, `bot:${root.dataset.bot}`);"), 'to any other bot, not only into the dock');
  assert.ok(bot.indexOf('carry(root') < bot.indexOf('root.innerHTML ='));
  assert.ok(bot.includes('putCarried(form, `bot:${bot.id}`);'));
  const groups = read('groups.js'); // loaded after boot.js, so not in the page's joined code
  const group = groups.slice(groups.indexOf('function renderGroupChat()'), groups.indexOf("const pic = $('#group-pic');"));
  assert.ok(group.length > 0);
  assert.ok(group.includes("if (root.dataset.group) carry(root, `group:${root.dataset.group}`);"));
  assert.ok(group.indexOf('carry(root') < group.indexOf('root.innerHTML ='));
  assert.ok(group.includes("putCarried($('form.composer', root), key);"));
  assert.ok(!app.includes('Dock?.docked()) carried'), 'no longer only into the dock');
});
