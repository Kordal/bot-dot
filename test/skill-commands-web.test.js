// "/" in a bot's chat on the web page (#237): the message box's list, as the page's own wireMentions draws it (cut out
// of public/chief.js and run against stand-in elements, with public/mentions.js as the page loads it). The rules
// themselves are the table's (test/fixtures/mentions.json, test/mentions-web.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, element, finders } = require('./web-page');
const table = require('./fixtures/mentions.json');

function box(features) {
  const list = element();
  const ta = element({}, { selectionStart: 0, selectionEnd: 0, setSelectionRange(a, b) { ta.selectionStart = a; ta.selectionEnd = b; } });
  const wrap = element({}, { append: () => {} });
  const form = element({ '.composer-wrap': wrap }, { text: ta });
  const ctx = vm.createContext({
    ...finders(), String, Math,
    document: { createElement: () => Object.assign(list, { setAttribute() {} }) },
    state: { features },
    esc: (s) => String(s).replace(/</g, '&lt;'),
    botLabel: (b) => b.name,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'mentions.js'), 'utf8'), ctx);
  vm.runInContext(`const mentionCtx = (chat) => ({ chat, ...${JSON.stringify(table.worlds.team)} });
    ${cut('function wireMentions(form, chat, grow)', '// onSend(text, attachments, key) sends')}
    this.wireMentions = wireMentions;`, ctx);
  const keys = ctx.wireMentions(form, 'fleet', () => {});
  const type = (text) => { ta.value = text; ta.selectionStart = ta.selectionEnd = text.length; ta.listeners.input.forEach((f) => f()); };
  const press = (key) => keys.key({ key, shiftKey: false, preventDefault() {}, stopPropagation() {} });
  const shown = () => (list.classList.contains('hidden') ? [] : [...list.innerHTML.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]));
  return { ta, type, press, shown };
}

test('web: "/" at the start of a bot\'s chat lists its skills with what each is for, and Enter puts one in', () => {
  const b = box(['skill-commands']);
  b.type('/');
  assert.deepEqual(b.shown(), ['/digest <span class="about">Write a short digest.</span>', '/weekly-report <span class="about">How the weekly report is laid out.</span>']);
  b.type('/wee');
  assert.equal(b.shown().length, 1);
  assert.equal(b.press('Enter'), true);
  assert.equal(b.ta.value, '/weekly-report ');
  assert.deepEqual(b.shown(), [], 'the list is closed');
});

test('web: Escape or a space closes the list', () => {
  const b = box(['skill-commands']);
  b.type('/d');
  assert.equal(b.shown().length, 1);
  b.press('Escape');
  assert.deepEqual(b.shown(), []);
  b.type('/digest ');
  assert.deepEqual(b.shown(), []);
});

test('web: a botdot without skill-commands gets no list', () => {
  const b = box([]);
  b.type('/');
  assert.deepEqual(b.shown(), []);
});
