// #1702: under the Chief's header, a one-line row of the three latest earlier chats. The page's own code, cut out of
// public/chief.js and run against stand-in elements; the CSS is read as text. `android/shared`'s RecentChatsTest holds
// the Android app's side of the same rule.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, esc, element } = require('./web-page');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

const CHATS = [
  { id: 'c1', title: 'Weekly report', updatedAt: '2026-11-25T10:42:00Z' },
  { id: 'c2', title: 'Flixbox test paused', updatedAt: '2026-11-24T10:00:00Z', unread: 2 },
  { id: 'c3', title: 'Invoice <bot> from "Gmail"', updatedAt: '2026-11-23T10:00:00Z' },
  { id: 'c4', title: 'Calendar', updatedAt: '2026-11-19T10:00:00Z' },
  { id: 'c5', title: 'Translate the page', updatedAt: '2026-11-17T10:00:00Z' },
];

// The row's own code, with a row element, and the chats opened from it.
function row(state) {
  const nav = element({}, { hidden: true });
  const opened = [];
  const ctx = vm.createContext({
    state, esc, tr: (t) => t, shortTime: (iso) => `t:${iso.slice(8, 10)}`,
    Unread: { count: (x) => (Number.isInteger(x?.unread) && x.unread > 0 ? x.unread : 0) },
    $: (sel) => (sel === '#chief-recent' ? nav : null),
    $$: () => [...nav.innerHTML.matchAll(/data-recent="([^"]*)"/g)].map(([, id]) => ({ dataset: { recent: id }, set onclick(fn) { this.click = fn; }, click: null })),
    showChat: (id) => { opened.push(id); state.chatId = id; }, renderChatList() {},
  });
  vm.runInContext(`${cut('const RECENT_CHATS', 'function actionBot(')}\nthis.renderRecentChats = renderRecentChats;`, ctx);
  const ids = () => [...nav.innerHTML.matchAll(/data-recent="([^"]*)"/g)].map(([, id]) => id);
  return { ctx, nav, opened, ids };
}

test('the row shows the three latest chats other than the open one, and a tap opens one and the row follows', () => {
  const state = { chats: CHATS, chatId: 'c1' };
  const r = row(state);
  r.ctx.renderRecentChats();
  assert.deepEqual(r.ids(), ['c2', 'c3', 'c4'], 'newest first, the open chat left out');
  assert.equal(r.nav.hidden, false);
  assert.match(r.nav.innerHTML, /<span class="chief-recent-title">Flixbox test paused<\/span><span class="chief-recent-when">t:24<\/span>/, 'its title and its short time');
  // The page's showChat draws the row again for the chat it opens: here a stand-in for that, as the tap's code calls it.
  state.chatId = 'c3';
  r.ctx.renderRecentChats();
  assert.deepEqual(r.ids(), ['c1', 'c2', 'c4'], 'the chat that was left is back, the opened one is gone');
});

test('a new chat shows the three latest, fewer chats show fewer, none shows no row', () => {
  const state = { chats: CHATS, chatId: null, chatNew: true };
  const r = row(state);
  r.ctx.renderRecentChats();
  assert.deepEqual(r.ids(), ['c1', 'c2', 'c3']);
  state.chats = CHATS.slice(0, 2); state.chatId = 'c1';
  r.ctx.renderRecentChats();
  assert.deepEqual(r.ids(), ['c2']);
  state.chats = CHATS.slice(0, 1);
  r.ctx.renderRecentChats();
  assert.deepEqual(r.ids(), []);
  assert.equal(r.nav.hidden, true, 'no empty row and no placeholder text');
  assert.equal(r.nav.innerHTML, '');
  state.chats = [];
  r.ctx.renderRecentChats();
  assert.equal(r.nav.hidden, true);
});

test('a chat with new replies has a round mark before its title, and the row follows the chat list when the feed changes it', () => {
  const state = { chats: CHATS, chatId: 'c1' };
  const r = row(state);
  r.ctx.renderRecentChats();
  assert.match(r.nav.innerHTML, /<i class="chief-recent-dot" role="img" aria-label="New reply"><\/i><span class="chief-recent-title">Flixbox test paused/);
  assert.equal([...r.nav.innerHTML.matchAll(/chief-recent-dot/g)].length, 1, 'only the chat with new replies');
  // The refresh reads the list again: a new chat on top, the new replies read.
  state.chats = [{ id: 'c6', title: 'Fresh', updatedAt: '2026-11-25T11:00:00Z', unread: 1 }, ...CHATS.map((c) => ({ ...c, unread: 0 }))];
  state.chatId = 'c6';
  r.ctx.renderRecentChats();
  assert.deepEqual(r.ids(), ['c1', 'c2', 'c3']);
  assert.doesNotMatch(r.nav.innerHTML, /chief-recent-dot/);
});

test('a title is text, never markup, and a row that did not change is not drawn again (a sideways scroll stays)', () => {
  const state = { chats: CHATS, chatId: 'c1' };
  const r = row(state);
  r.ctx.renderRecentChats();
  assert.doesNotMatch(r.nav.innerHTML, /<bot>/);
  assert.match(r.nav.innerHTML, /Invoice &lt;bot&gt; from &quot;Gmail&quot;/);
  let draws = 0;
  let html = r.nav.innerHTML;
  Object.defineProperty(r.nav, 'innerHTML', { get: () => html, set: (v) => { draws++; html = v; } });
  r.ctx.renderRecentChats();
  assert.equal(draws, 0);
  state.chats = [{ ...CHATS[0], title: 'Renamed' }, ...CHATS.slice(1)];
  state.chatId = 'c5';
  r.ctx.renderRecentChats();
  assert.equal(draws, 1);
});

test('the row is wired into the Chief: under its header, drawn with every render and every chat shown, the settings list and the New chat button as before', () => {
  const chief = cut('function renderChief()', '// A new chat (#727)');
  assert.match(chief, /<\/div>\s*<nav class="chief-recent" id="chief-recent" aria-label="\$\{tr\('Previous chats'\)\}" hidden><\/nav>\s*<div class="chat-thread" id="chat-thread">/, 'between the header and the chat');
  assert.match(chief, /renderChatList\(\);\s*renderRecentChats\(\);\s*\}/, 'render() (the feed refresh) draws it again');
  assert.match(chief, /\$\('#chief-new'\)\.onclick = \(\) => \{ state\.chatNew = true; showChat\(null\); \};/, 'the New chat button stays');
  assert.match(cut('async function showChat(', 'const thread = $(\'#chat-thread\');'), /renderRecentChats\?\.\(\)/, 'a chat opened, or a new one, moves the row');
  assert.match(cut('function renderChatList()', 'function actionBot('), /state\.chats\.map\(/, "the Chief's settings keep the full list");
});

test('the row is one line of pills in the page tokens, scrolls sideways, and drops the times on a phone', () => {
  const rules = (sel) => [...css.matchAll(new RegExp(`^\\s*${sel.replace(/[.\[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]).join(' ');
  const nav = rules('.chief-recent');
  assert.match(nav, /display:\s*flex/);
  assert.match(nav, /overflow-x:\s*auto/);
  const chip = rules('.chief-recent-chip');
  for (const t of ['var(--raise-2)', 'var(--lift)', 'var(--r-pill)', 'var(--fs-12)', 'var(--muted)', 'white-space: nowrap']) assert.ok(chip.includes(t), t);
  assert.match(rules('.chief-recent-chip:hover, .chief-recent-chip:focus-visible'), /var\(--fill\)[^}]*var\(--text\)|var\(--text\)/);
  assert.match(rules('.chief-recent-when'), /var\(--faint\)/);
  assert.match(rules('.chief-recent-dot'), /border-radius:\s*50%/);
  const blocks = css.split('@container main (max-width: 640px) {').slice(1).map((b) => b.slice(0, b.indexOf('\n}\n')));
  assert.ok(blocks.some((b) => /\.chief-recent-when \{ display: none; \}/.test(b)), 'a phone: no times');
  assert.ok(blocks.some((b) => /\.chief-recent \{ padding-left: var\(--sp-16\)/.test(b)), 'a phone: the header\'s side space');
});
