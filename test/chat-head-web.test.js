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
const head = app.slice(app.indexOf('function renderBotChat()')).match(/<div class="chat-head">[\s\S]*?<div class="chat-thread"/)[0];

test('web: a bot\'s figure and name open its settings, as in the apps: in the panel beside the chat, and close it again', () => {
  const title = head.match(/<button class="chat-title" id="bot-settings"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(title, 'one button around the figure and the name');
  assert.match(title[1], /id="bot-avatar"/);
  assert.match(title[1], /id="bot-name"/);
  assert.match(app, /\$\('#bot-settings'\)\.onclick = \(\) => setPanel\('toggle'\);/);
  assert.match(app, /function setPanel\(what\) \{ show\(Panel\.next\(state, \{ panel: what \}\)\); \}/);
});

test('web: the Chief\'s figure and name open its settings the same way, and its header has no gear and no chat list', () => {
  const title = chief.match(/<button class="chat-title" id="chief-settings"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(title, 'one button around the figure and the name');
  assert.match(title[1], /id="chief-avatar"/);
  assert.match(title[1], /<h2>\$\{esc\(chiefName\(\)\)\}<\/h2>/, "the name the owner gave it (#41)");
  assert.match(app, /\$\('#chief-settings'\)\.onclick = \(\) => setPanel\('toggle'\);/);
  assert.doesNotMatch(chief, /ICON\.(gear|history)/);
});

test('web: the Chief\'s previous chats are in its settings', () => {
  const settings = app.slice(app.indexOf('function renderChiefSettings()'), app.indexOf('// The pages that open from Settings.'));
  assert.match(settings, /<summary><b>Previous chats<\/b>\$\{CHEV\}<\/summary>\s*<div[^>]*id="chief-chats"/, "a row that opens them under it");
  assert.match(app, /const el = \$\('#chief-chats'\);/);
});

test('web: the header has no gear of its own', () => {
  assert.doesNotMatch(head, /ICON\.gear/);
});
