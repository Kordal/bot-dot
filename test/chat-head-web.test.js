// The chat headers on the web page: the page's own code, read for what opens the settings
// (the panel beside the chat: settings-panel-web.test.js).
// The look is checked by hand, in a browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { webSource } = require('./web-source');

const app = webSource();
const chief = app.slice(app.indexOf('function renderChief()')).match(/<div class="chat-head">[\s\S]*?<div class="chat-thread"/)[0];
const head = app.slice(app.indexOf('function renderBotChat(root')).match(/<div class="chat-head">[\s\S]*?<div class="chat-thread"/)[0];

test('web: a bot\'s figure and name open its settings, as in the apps: in the panel beside the chat, and close it again', () => {
  const title = head.match(/<button class="chat-title"\$\{id\('bot-settings'\)\}[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(title, 'one button around the figure and the name');
  assert.match(title[1], /class="bot-avatar"\$\{id\('bot-avatar'\)\}/);
  assert.match(title[1], /class="bot-name"\$\{id\('bot-name'\)\}/);
  // A chat in the Projects screen's dock (#714) opens the settings its own way: there, of the open chat.
  assert.match(app, /const settings = docked \? docked\.settings : \(\) => setPanel\('toggle'\);\n\s*part\('chat-title'\)\.onclick = settings;/);
  assert.match(app, /function setPanel\(what\) \{ show\(Panel\.next\(state, \{ panel: what \}\)\); \}/);
});

test('web: the Chief\'s figure and name open its settings the same way, and its header has no gear and no chat list', () => {
  const title = chief.match(/<button class="chat-title" id="chief-settings"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(title, 'one button around the figure and the name');
  assert.match(title[1], /id="chief-avatar"/);
  assert.match(title[1], /<h2>\$\{esc\(chiefTitle\(\)\)\}<\/h2>/, "the name the owner gave it (#41)");
  assert.match(app, /\$\('#chief-settings'\)\.onclick = \(\) => setPanel\('toggle'\);/);
  assert.doesNotMatch(chief, /ICON\.(gear|history)/);
});

test('web: the Chief\'s previous chats are in its settings', () => {
  const settings = app.slice(app.indexOf('function renderChiefSettings()'), app.indexOf('// The pages that open from Settings.'));
  assert.match(settings, /<summary><b>\$\{tr\('Previous chats'\)\}<\/b>\$\{CHEV\}<\/summary>\s*<div[^>]*id="chief-chats"/, "a row that opens them under it");
  assert.match(app, /const el = \$\('#chief-chats'\);/);
});

test('web: the header has no gear of its own', () => {
  assert.doesNotMatch(head, /ICON\.gear/);
});

// Quiet keys (#635): a chat head is the figure, the name and its buttons, with no line under the name; a bot's
// holds Files and ⋯, whose menu has its settings, its computer and "Add a bot to this chat".
test('web: a chat head has no line under the name, and a bot\'s keeps its other ways in under ⋯', () => {
  assert.doesNotMatch(head + chief, /class="sub"/);
  assert.doesNotMatch(app, /#bot-sub|#chief-sub/);
  const right = head.slice(head.indexOf('<div class="actions-right">'));
  assert.deepEqual([...right.matchAll(/id\('(bot-[a-z-]+)'\)/g)].map((m) => m[1]), ['bot-files', 'bot-more', 'bot-screen', 'bot-add-to-chat']);
  assert.match(right, /<button type="button" role="menuitem" class="hidden bot-screen"\$\{id\('bot-screen'\)\}>\$\{tr\('Its computer'\)\}<\/button>/);
  assert.match(app, /part\('bot-screen'\)\.onclick = \(\) => openScreen\(bot\.id\);/);
  // Esc in the menu closes it and is not the keypad's Esc, which opens the Chief: that one skips a press already taken.
  const menu = app.slice(app.indexOf('function wireChatMenu(wrap)'), app.indexOf('function renderBotChat(root'));
  assert.match(menu, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); open\(false\); btn\.focus\(\); \}/);
  assert.match(app, /if \(e\.defaultPrevented \|\| e\.isComposing/);
});

test('web: a new Chief chat is its head, its name and the message box: no tagline and no example requests', () => {
  const at = app.indexOf('async function showChat(id)');
  const empty = app.slice(at, app.indexOf('let chat;', at));
  // Its name under its head, as a bot's empty chat has (#727); its own jobs are chips under the box (empty-chat-web).
  assert.match(empty, /thread\.innerHTML = `<div class="chief-empty">\$\{chiefFigure\('lg'\)\}<h3>\$\{esc\(chiefTitle\(\)\)\}<\/h3><\/div>`;/);
  assert.doesNotMatch(empty, /<p |suggestion/);
});
