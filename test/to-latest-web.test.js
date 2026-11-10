// The button to a chat's newest message on the web page (#1120): public/to-latest.js run the way the browser runs it.
// A newer message that arrives while the owner reads back up shows one round button with its writer's head and no
// words; at the end it goes, and nothing else (older messages loaded above, the same chat drawn again) shows it.
// Every chat (the Chief's, a bot's, a group's, a room's) has it, through holdChatEnd. The real page is walked in
// test/browser/to-latest.cjs; the Android app's side is ToLatestTest.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read } = require('./web-page');

const ctx = vm.createContext({ esc: (s) => String(s), tr: (s) => s });
vm.runInContext(`${read('to-latest.js')}; this.ToLatest = ToLatest;`, ctx);
const { ToLatest } = ctx;

// A thread stand-in: its message rows, each with its bubble's words and the head it shows.
function thread(rows) {
  const row = ({ text, mine = false, head = null }) => ({
    textContent: `${text}\n 08:43 · Details`,
    mine,
    querySelector: (sel) => (sel === '.bubble' ? { textContent: text } : sel === '.avatar' ? (head ? { outerHTML: head } : null) : null),
  });
  const all = rows.map(row);
  return { querySelectorAll: (sel) => (sel === '.bubble-row.from-bot' ? all.filter((r) => !r.mine) : all) };
}

test('web: the button shows for a newer message while the owner reads back up, and goes at the end', () => {
  const { next } = ToLatest;
  assert.equal(next(false, 'a', 'b', false), true, 'a newer message, read back up');
  assert.equal(next(false, 'a', 'b', true), false, 'at the end the chat follows it: no button');
  assert.equal(next(true, 'b', 'b', false), true, 'it stays until the end is reached');
  assert.equal(next(true, 'b', 'b', true), false, 'reaching the end hides it');
  assert.equal(next(false, 'a', 'a', false), false, 'nothing new: scrolling up shows nothing');
  assert.equal(next(false, '', 'a', false), false, 'a chat that had nothing drawn yet: its first draw is no arrival');
  assert.equal(next(false, null, 'a', false), false);
  assert.equal(ToLatest.NEAR, 160, 'the same "near the end" as the chats follow replies by');
});

test('web: what is newest is the last message by what its bubble says, not its time or the messages above', () => {
  const { newest } = ToLatest;
  assert.equal(newest(thread([])), '');
  const one = newest(thread([{ text: 'Hi' }, { text: 'The servers are fine.' }]));
  assert.equal(newest(thread([{ text: 'Older' }, { text: 'Hi' }, { text: 'The servers are fine.' }])), one, 'older messages loaded above');
  assert.notEqual(newest(thread([{ text: 'Hi' }, { text: 'The servers are fine.' }, { text: 'One more.' }])), one, 'a new message');
  assert.notEqual(newest(thread([{ text: 'Hi' }, { text: 'The servers are fine. And' }])), one, 'a reply that grows as it is written');
});

test("web: the button shows the head of the newest bot's message, else the chat's own writer", () => {
  const { headOf } = ToLatest;
  const own = () => '<div class="avatar head">chief</div>';
  assert.equal(headOf(thread([{ text: 'a', head: '<div class="avatar">A</div>' }, { text: 'b', head: '<div class="avatar">B</div>' }, { text: 'mine', mine: true }]), own),
    '<div class="avatar">B</div>', "a group: the last member's head, not the owner's");
  assert.equal(headOf(thread([{ text: 'a' }]), own), own(), "the Chief's chat, a bot's: the chat's own");
  assert.equal(headOf(thread([{ text: 'a' }]), null), '', 'none known: the arrow alone');
});

test('web: every chat has the button, under its thread and above its message box, with no words', () => {
  const index = read('index.html');
  assert.ok(index.indexOf('/to-latest.js') > index.indexOf('/app.js') && index.indexOf('/to-latest.js') < index.indexOf('/replies.js'), 'loaded before replies.js uses it');
  assert.match(read('replies.js'), /function holdChatEnd\(thread, head = null\) \{\n\s+if \(thread && typeof ToLatest !== 'undefined'\) ToLatest\.watch\(thread, head\);/);
  assert.match(read('chief.js'), /holdChatEnd\(\$\('#chat-thread', root\), \(\) => chiefFigure\(\)\);/);
  assert.match(read('bot-chat.js'), /holdChatEnd\(thread, \(\) => botFigure\(bot\.color/);
  assert.match(read('groups.js'), /holdChatEnd\(\$\('#group-thread', root\)\);/, "a group's head is its last member's");
  assert.match(read('rooms.js'), /holdChatEnd\(\$\('#room-thread', root\)\);/);
  const src = read('to-latest.js');
  assert.match(src, /aria-label="\$\{esc\(tr\('Latest'\)\)\}"/, 'named for screen readers only');
  assert.doesNotMatch(src.match(/at\.innerHTML = `([^`]*)`/)[1].replace(/<[^>]*>/g, '').replace(/\$\{DOWN\}/, ''), /\w/, 'no words on it');
  const css = read('style.css');
  assert.match(css, /\.to-latest-at \{[^}]*height: 0;/, 'it takes no room from the chat');
  assert.match(css, /\.to-latest \{[^}]*border-radius: 50%;/, 'round');
  assert.equal(JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'i18n', 'pl', 'web.json'), 'utf8')).Latest, 'Najnowsze');
});
