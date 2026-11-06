// #1104: the web page reads a long Chief chat in parts: its last CHAT_PAGE messages when it opens, older ones as the
// owner scrolls up, each row with its place in the whole chat. Drawn again, the same chat is read from the first
// message on screen, or from further back for the "New" line or a search match.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const chief = fs.readFileSync(path.join(__dirname, '..', 'public', 'chief.js'), 'utf8');
const cut = (from, to) => chief.slice(chief.indexOf(from), chief.indexOf(to));

test('which part of a chat is read', () => {
  const ctx = vm.createContext({ state: {}, line: null, newLine: { first: () => ctx.line } });
  vm.runInContext(`${cut('const CHAT_PAGE', '// The rows of a chat')}\nthis.chatPart = chatPart; this.CHAT_PAGE = CHAT_PAGE;`, ctx);
  const thread = (chat, from) => ({ dataset: chat ? { chat } : {}, _from: from });
  assert.equal(ctx.chatPart(thread(null), 'c1'), `?limit=${ctx.CHAT_PAGE}`, 'a chat that opens: its last part');
  assert.equal(ctx.chatPart(thread('c2', 40), 'c1'), `?limit=${ctx.CHAT_PAGE}`, "another chat's place does not count");
  assert.equal(ctx.chatPart(thread('c1', 40), 'c1'), '?offset=40', 'drawn again: from its first row on screen');
  ctx.line = 12;
  assert.equal(ctx.chatPart(thread('c1', 40), 'c1'), '?offset=12', 'from the "New" line');
  ctx.state.jump = { chatId: 'c1', index: 3 };
  assert.equal(ctx.chatPart(thread(null), 'c1'), '?offset=3', 'from a search match');
});

test('the rows carry their place in the whole chat, and older ones are read as the owner scrolls up', () => {
  const show = cut('async function showChat(', '// Stop the Chief');
  assert.match(show, /api\(`\/chief\/chats\/\$\{id\}\$\{chatPart\(thread, id\)\}`\)/);
  assert.match(show, /data-msg="\$\{from \+ i\}"/);
  assert.match(show, /async function loadOlder\(thread\)/);
  assert.match(show, /api\(`\/chief\/chats\/\$\{id\}\?offset=\$\{off\}&limit=\$\{from - off\}`\)/);
  assert.match(show, /thread\.scrollTop = thread\.scrollHeight - below;/, 'what was in view stays where it was');
  assert.match(chief, /addEventListener\('scroll', \(e\) => \{ if \(e\.target\.scrollTop < 400\) loadOlder\(e\.target\); \}/);
});
