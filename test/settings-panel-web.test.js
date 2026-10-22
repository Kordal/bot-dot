// The settings panel on the web page: public/panel.js loaded the way the browser loads it (a plain
// script, no module). The chat is the view; the panel beside it is open or closed and shows the settings
// of that chat. Side by side or covering, the widths and the look are checked in a browser
// (test/browser/settings-panel.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webSource } = require('./web-source');

const PUBLIC = path.join(__dirname, '..', 'public');
const page = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'panel.js'), 'utf8'), page);
const { Panel } = page;
const app = webSource();
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');

const next = (view, panel, req, via = false) => { const { view: v, panel: p } = Panel.next({ view, panel, via }, req); return [v, p]; };

test('web: the page gets it as window.Panel, before app.js', () => {
  assert.equal(typeof Panel.next, 'function');
  assert.equal(page.module, undefined);
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/panel.js') > 0 && at('/panel.js') < at('/app.js'));
});

test('web: a bot\'s figure and name open the panel on its settings, and close it again', () => {
  assert.deepEqual(next('bot', null, { panel: 'toggle' }), ['bot', 'settings']);
  assert.deepEqual(next('bot', 'settings', { panel: 'toggle' }), ['bot', null]);
  assert.deepEqual(next('bot', 'jobs', { panel: 'toggle' }), ['bot', null]);
});

test('web: the close button closes it, whatever it showed', () => {
  assert.deepEqual(next('bot', 'settings', { panel: 'close' }), ['bot', null]);
  assert.deepEqual(next('bot', 'jobs', { panel: 'close' }), ['bot', null]);
  assert.deepEqual(next('chief', 'settings', { panel: 'close' }), ['chief', null]);
  assert.deepEqual(next('bot', null, { panel: 'close' }), ['bot', null]);
});

test('web: "Scheduled jobs" opens the jobs in the panel, and their back button returns to the settings', () => {
  assert.deepEqual(next('bot', 'settings', { view: 'botjobs' }), ['bot', 'jobs']);
  assert.equal(Panel.next({ view: 'bot', panel: 'settings' }, { view: 'botjobs' }).via, true, 'opened from the settings');
  assert.deepEqual(next('bot', 'jobs', { panel: 'back' }, true), ['bot', 'settings']);
  assert.equal(Panel.next({ view: 'bot', panel: null }, { view: 'botjobs' }).via, false, 'opened from the chat');
  assert.deepEqual(next('bot', 'jobs', { panel: 'back' }), ['bot', null], 'opened from the chat, back shows the chat');
  assert.equal(Panel.next({ view: 'bot', panel: 'jobs', via: true }, { view: 'botjobs' }).via, true, 'asked for again, they keep where they came from');
  // Jobs opened straight from the chat (a run's "what it learned" link) go back to the settings too.
  assert.deepEqual(next('bot', null, { view: 'botjobs' }), ['bot', 'jobs']);
});

test('web: back from the settings, where the panel covers the chat, shows the chat', () => {
  assert.deepEqual(next('bot', 'settings', { panel: 'back' }), ['bot', null]);
  assert.deepEqual(next('chief', 'settings', { panel: 'back' }), ['chief', null]);
});

test('web: another bot in the list keeps the panel open, on that bot\'s settings', () => {
  assert.deepEqual(next('bot', 'settings', { view: 'bot' }), ['bot', 'settings']);
  assert.deepEqual(next('bot', 'jobs', { view: 'bot' }), ['bot', 'settings'], 'a panel that showed jobs shows the new chat\'s settings');
  assert.deepEqual(next('chief', 'settings', { view: 'bot' }), ['bot', 'settings']);
  assert.deepEqual(next('bot', null, { view: 'bot' }), ['bot', null], 'a closed panel stays closed');
});

test('web: where the panel covers the chat, another chat in the list closes it: the chat was asked for', () => {
  assert.deepEqual(next('bot', 'settings', { view: 'bot', covered: true }), ['bot', null]);
  assert.deepEqual(next('bot', 'jobs', { view: 'bot', covered: true }), ['bot', null]);
  assert.deepEqual(next('bot', 'settings', { view: 'chief', covered: true }), ['chief', null]);
  assert.deepEqual(next('chief', 'settings', { view: 'bot', covered: true }), ['bot', null]);
  assert.deepEqual(next('bot', 'settings', { view: 'botjobs', covered: true }), ['bot', 'jobs'], 'the panel asked for by name still opens');
  assert.match(app, /Panel\.next\(state, \{ view: v, covered: panelCovers\(\) \}\)/, 'the page says whether the chat is covered');
});

test('web: the Chief has the panel too: its gear toggles it, and its row in the list keeps it', () => {
  assert.deepEqual(next('chief', null, { panel: 'toggle' }), ['chief', 'settings']);
  assert.deepEqual(next('chief', 'settings', { panel: 'toggle' }), ['chief', null]);
  assert.deepEqual(next('bot', 'settings', { view: 'chief' }), ['chief', 'settings']);
  assert.deepEqual(next('bot', 'jobs', { view: 'chief' }), ['chief', 'settings'], 'the Chief has no jobs of its own');
  assert.deepEqual(next('bot', null, { view: 'chief' }), ['chief', null]);
});

test('web: every other way into the settings opens the chat with the panel', () => {
  for (const from of ['settings', 'runs', 'dashboard', 'chief', 'bot', 'needs']) {
    assert.deepEqual(next(from, null, { view: 'botsettings' }), ['bot', 'settings'], from);
    assert.deepEqual(next(from, null, { view: 'botjobs' }), ['bot', 'jobs'], from);
    assert.deepEqual(next(from, null, { view: 'chiefsettings' }), ['chief', 'settings'], from);
  }
});

test('web: a page that is no chat has no panel', () => {
  for (const v of ['settings', 'runs', 'dashboard', 'skills', 'vault', 'connectors', 'setup', 'needs']) {
    assert.deepEqual(next('bot', 'settings', { view: v }), [v, null], v);
    assert.deepEqual(next(v, null, { panel: 'toggle' }), [v, null], `${v}: nothing to open a panel beside`);
    assert.deepEqual(next(v, 'settings', { panel: 'back' }), [v, null]);
  }
  // Back in a chat from such a page, the panel is closed.
  assert.deepEqual(next('settings', null, { view: 'bot' }), ['bot', null]);
});

test('web: a deleted bot closes the panel and opens the Chief\'s chat', () => {
  assert.deepEqual(next('bot', 'settings', { gone: true }), ['chief', null]);
  assert.deepEqual(next('bot', 'jobs', { gone: true }), ['chief', null]);
  assert.deepEqual(next('bot', null, { gone: true }), ['chief', null]);
});

test('web: what it does not know changes nothing', () => {
  assert.deepEqual(next('bot', 'settings', {}), ['bot', 'settings']);
  assert.deepEqual(next('bot', 'settings', { panel: 'tabs' }), ['bot', 'settings']);
  assert.deepEqual(next('bot', 'tabs', { panel: 'toggle' }), ['bot', 'settings'], 'a panel it does not know counts as closed');
  assert.deepEqual(next('chief', 'jobs', { view: 'chief' }), ['chief', 'settings']);
});

test('web: the address keeps the panel, under the names it had as pages', () => {
  assert.equal(Panel.name('bot', 'settings'), 'botsettings');
  assert.equal(Panel.name('bot', 'jobs'), 'botjobs');
  assert.equal(Panel.name('chief', 'settings'), 'chiefsettings');
  assert.equal(Panel.name('bot', null), 'bot');
  assert.equal(Panel.name('chief', null), 'chief');
  assert.equal(Panel.name('runs', null), 'runs');
  // Each of the three, read back from the address on a reload.
  for (const [hash, to] of [['botsettings', ['bot', 'settings']], ['botjobs', ['bot', 'jobs']], ['chiefsettings', ['chief', 'settings']]]) {
    assert.deepEqual(next('chief', null, { view: hash }), to, hash);
    assert.equal(Panel.name(...to), hash);
    assert.ok(Panel.NAMES.includes(hash));
  }
  assert.match(app, /const known = \[[^\]]*\.\.\.Panel\.NAMES[^\]]*\]\.includes\(view\)/, 'the page knows the three at its start');
  // A chat's address is written in one place, so a chat opened or a message sent beside the panel keeps it.
  assert.doesNotMatch(app, /replaceState\(null, '', `#(chief|bot)/, 'no chat\'s address is written by hand');
  assert.match(app, /function writeHash\(\) \{[\s\S]*?history\.replaceState\(null, '', `#\$\{Panel\.name\(v, state\.panel\)\}/);
});

test('web: which of the three pages the panel draws', () => {
  assert.equal(Panel.page('bot', 'settings'), 'botsettings');
  assert.equal(Panel.page('bot', 'jobs'), 'botjobs');
  assert.equal(Panel.page('chief', 'settings'), 'chiefsettings');
  assert.equal(Panel.page('bot', null), null);
  assert.equal(Panel.page('runs', 'settings'), null);
});

test('web: the page holds one panel beside the two chats, with the three pages in it', () => {
  const row = html.match(/<div class="chat-row" id="chat-row">([\s\S]*?)<\/div>\s*<section id="view-runs"/);
  assert.ok(row, 'a row around the chats and the panel');
  assert.match(row[1], /<section id="view-chief" class="view">/);
  assert.match(row[1], /<section id="view-bot" class="view hidden">/);
  const panel = row[1].match(/<aside id="panel" class="panel hidden"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(panel, 'one panel, closed at the start');
  for (const id of ['botsettings', 'botjobs', 'chiefsettings']) {
    assert.match(panel[1], new RegExp(`<section id="view-${id}" class="page panel-page hidden">`), `${id} is drawn in the panel, and is no view of its own`);
  }
  assert.match(panel[1], /id="panel-back"/);
  assert.match(panel[1], /id="panel-close"/);
  assert.equal((html.match(/id="panel"/g) || []).length, 1);
});

test('web: side by side from 780px of the main column, by a container query: no script measures a width', () => {
  assert.match(css, /\.panel \{[^}]*width: 380px;[^}]*border-left: 1px solid var\(--line\)/);
  assert.match(css, /@container column \(width < 780px\) \{\s*\.chat-row\.with-panel > \.view \{ display: none; \}/);
  assert.match(css, /\.main \{ container-type: inline-size; container-name: main column; \}/);
  assert.doesNotMatch(fs.readFileSync(path.join(PUBLIC, 'panel.js'), 'utf8'), /\d/, 'the decision knows no width');
  assert.match(app, /const panelCovers = \(\) => !!panelPage\(\) && getComputedStyle\(chatView\(\)\)\.display === 'none';/, 'the page asks the style whether the chat is covered');
});

test('web: the bot\'s stream stays open while its chat is the view', () => {
  assert.match(app, /if \(v !== 'bot'\) for \(const es of state\.botStreams\.splice\(0\)\) es\.close\(\);/);
  assert.doesNotMatch(app, /state\.view === '(botsettings|botjobs|chiefsettings)'/, 'the three are no views any more');
});

test('web: covered by the panel, the chat is not on screen: nothing is read, no presence says it is open', () => {
  assert.match(app, /const chatOnScreen = \(\) => \(panelCovers\(\) \? null : chatInView\(\)\);/);
  const present = app.slice(app.indexOf('function sayPresent()'), app.indexOf('// ---------- new replies ----------'));
  assert.match(present, /const chat = chatOnScreen\(\);/);
  const open = app.slice(app.indexOf('function chatOpen()'), app.indexOf('const chatParts'));
  assert.match(open, /const chat = chatOnScreen\(\);/);
  // Widening or narrowing the window changes it without a reload.
  assert.match(app, /addEventListener\('resize', panelResized\)/);
});
