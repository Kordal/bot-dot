// Groups on the web page (GRP-005; docs/api.md, "Groups"): public/groups.js loaded the way the browser loads it,
// after the parts of public/app.js it uses, and run against stand-ins (test/web-page.js) with what a botdot server
// sends. Making a group from a bot's chat, its panel, its row in the list, its chat, its cards, and the word
// "category" for a folder of bots. The look, and the walk at desktop and at a phone's width, are the acceptance task's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element } = require('./web-page');
const cards = require('./need-cards');

const css = read('style.css');
const html = read('index.html');
const src = read('groups.js');
const plain = (x) => JSON.parse(JSON.stringify(x));
const at = (n) => `2026-10-08T14:${String(n).padStart(2, '0')}:00.000Z`;
const refused = (said, status = 400) => Object.assign(new Error(said), { status, refused: true });
const texts = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const CODER = { id: 'coder', name: 'Coder', color: '#1d9e75', state: 'idle', group: 'Programming', order: 1, description: 'Writes the code', jobs: [{ id: 'j1', name: 'Nightly build' }] };
const REVIEWER = { id: 'reviewer', name: 'Reviewer', color: '#e24b4a', state: 'idle', group: 'Programming', order: 2, description: 'Reviews a change' };
const WRITER = { id: 'writer', name: 'Issue Writer', color: '#7f77dd', state: 'idle', group: 'Programming', order: 3, description: 'Writes the issue' };
const WEATHER = { id: 'weather', name: 'Weather', color: '#378add', state: 'idle', group: 'House', order: 1, description: 'Tomorrow in Brussels' };
const SHOPPER = { id: 'shopper', name: 'Shopper', color: '#ef9f27', state: 'idle', group: '', order: 1, description: 'Watches prices' };
const BOTS = [CODER, REVIEWER, WRITER, WEATHER, SHOPPER];
const DEV = { id: 'g1', name: 'Dev', members: ['coder', 'reviewer', 'writer'], category: 'Programming', pinned: 0, order: 1, unread: 0, firstUnread: null, last: null, working: [], asks: null, limit: null };

const message = (id, text, more = {}) => ({ type: 'message', id, text, at: at(1), to: DEV.members, waitsFor: [], next: [], canTakeBack: false, ...more });
const reply = (id, bot, result, more = {}) => ({ type: 'reply', id, at: more.at || at(2), run: { id, botId: bot.id, botName: bot.name, botColor: bot.color, status: 'success', result, startedAt: more.at || at(2), endedAt: more.at || at(2), ...more } });

// The page: its state, the parts of app.js that groups.js draws with, and groups.js itself. reply(path, opts) is
// botdot's answer to a request; an Error is a refusal.
function page({ features = ['groups', 'unread'], bots = BOTS, groups = [DEV], reply: answer = async () => ({}) } = {}) {
  const state = { features, bots: plain(bots), groups: plain(groups), runs: [], chats: [], view: 'chief', groupId: groups[0]?.id || null, approvals: null, groupsKnown: true };
  const said = { calls: [], toasts: [], refreshed: 0, contacts: 0, views: [], left: 0, unread: [], modals: [], confirms: [], needs: [], notes: [], opened: [], jumped: [], streams: [], frames: [] };
  // The run streams the page opens (a turn's draft), and the frames it waits for.
  class EventSource { constructor(url) { this.url = url; this.closed = false; said.streams.push(this); } close() { this.closed = true; } }
  const doc = {};
  const stores = {};
  const lib = vm.createContext({});
  for (const f of ['mentions.js', 'unread.js', 'opening-line.js', 'panel.js', 'keypad.js']) vm.runInContext(read(f), lib);
  const ctx = vm.createContext({
    state, esc, console, JSON, encodeURIComponent, setTimeout, clearTimeout, crypto: globalThis.crypto,
    Mentions: lib.Mentions, Unread: lib.Unread, OpeningLine: lib.OpeningLine, Panel: lib.Panel, Keypad: lib.Keypad,
    Figure: { svg: (st, color) => `<svg class="fig" data-st="${st}" data-c="${color}"></svg>`, small: (color) => `<svg class="fig fig-small" data-c="${color}"></svg>`, CHIEF: null },
    CHIEF_BOT: { id: 'chief', name: 'Chief of Staff', color: '#d85a30', jobs: [] }, CHIEF_COLOR: '#d85a30', BACK_BTN: '<back>', ICON: {},
    CSS: { escape: (s) => s }, localStorage: { getItem: (k) => stores[k] ?? null, setItem: (k, v) => { stores[k] = v; } },
    signedOut: { on: false }, newLine: lib.Unread.lineKeeper(), failedSends: new Map(), openingLines: lib.OpeningLine.keeper(),
    api: async (path, opts = {}) => { said.calls.push([opts.method || 'GET', path, ...(opts.body ? [plain(opts.body)] : [])]); const a = await answer(path, opts); if (a instanceof Error) throw a; return a; },
    toast: (text, bad) => said.toasts.push([text, !!bad]), refresh: async () => { said.refreshed++; }, renderContacts: () => { said.contacts++; },
    setView: (v, sub) => said.views.push([v, sub]), setPanel() {}, leaveBot: () => { said.left++; }, setUnread: (chat, d) => said.unread.push([chat, d.unread]),
    confirm: (t) => { said.confirms.push(t); return true; }, updateChatNeeds: (thread, scope) => said.needs.push(scope),
    showBoxNote: (form, text) => said.notes.push(text), openModal: (h) => { said.modals.push(h); return said.modal(h); },
    botFigure: (color, st = 'idle', size = '', outfit = null, bot = '') => `<div class="avatar head ${size}"${bot ? ` data-bot="${bot}"` : ''} data-st="${st}" data-c="${color}"></div>`,
    botLabel: (b) => (b ? `<svg class="fig fig-small"></svg>${esc(b.name)}` : ''),
    botMark: (b) => `<svg class="fig fig-small" aria-hidden="true" data-bot="${b.id}" data-c="${b.color}"></svg>`,
    md: (t) => `<p>${esc(t)}</p>`, copyBtn: (t) => `<button class="copy-btn" data-copy="${esc(t)}"></button>`, learnedChips: () => '', learnedOpens: () => '',
    friendlyProblem: () => 'Something went wrong.', dur: (ms) => `${Math.round(ms / 1000)}s`, msgTime: (iso) => String(iso).slice(11, 16), shortTime: (iso) => (iso ? String(iso).slice(11, 16) : ''),
    mentionSig: () => state.bots.map((b) => b.name).join('|'), messageKey: () => 'k'.repeat(32), withFailed: (a, b) => a || b, readyFiles: (l) => l || [],
    dashStrip: () => '<button class="dash" data-contact="dashboard"></button>', fitStrip() {}, chiefFigure: () => '<chief>', hitHTML: () => '', openChiefChat() {}, openGroupMenu() {}, reducedMotion: () => true,
    $: (sel, root) => (root ? root.querySelector(sel) : doc[sel] ?? null), $$: (sel, root) => (root ? root.querySelectorAll(sel) : Array.isArray(doc[sel]) ? doc[sel] : []),
    document: { activeElement: null }, gaps: [], scrollToNew() {}, wireChoices() {}, markSearch() {}, setSendBusy() {}, openRun: (id) => said.opened.push(id),
    jumpTo: (row) => { state.jump = null; if (row) said.jumped.push(row.id); return !!row; },
    EventSource, requestAnimationFrame: (fn) => said.frames.push(fn), draftSource: (t) => t,
  });
  said.modal = () => element();
  vm.runInContext(`${cut('const botById = ', 'const colorOf = ')}
    ${cut("// ---------- the Chief's name", "// ---------- end of the Chief's name")}
    ${cut('const mentionCtx = ', '// What mentions match against')}
    ${cut('const plain = (t) =>', '// ---------- contacts (sidebar) ----------')}
    ${cut('const fmtSize = ', '// Files a bot attached to its reply')}
    const botFilesHTML = (list) => (list?.length ? '<div class="bubble-files">' + list.map((f) => esc(f.name)).join(',') + '</div>' : '');
    ${cut('const choicesHTML = ', '// send(text, key) resolves to whether it went')}
    ${cut('function contactLine(b, r, working)', '// ---------- search in every chat ----------')}
    ${cut('function openHit(h) {', '// After a chat is drawn')}
    ${cut('const groupNames = ', '// Drag a bot or a group anywhere in the list')}
    ${cut('const BOT_DRAG = ', '// The gap that opens where the dragged row would land')}
    ${cut('let gapSpot = null;', 'function openGap(spot, el, above) {')}
    function openGap(spot, el, above) { this.gaps.push([spot, el.name, !!above]); gapSpot = spot; }
    function closeGap() {}
    ${cut('function dropAt(e, spot) {', '// Put the pinned ones in order again')}
    ${cut('const chatParts = ', '// What the page knows about')}
    ${cut('// ---------- the sent message, there at once ----------', '// Stop a run.')}
    ${cut('// ---------- the reply draft ----------', '// ---------- data ----------')}
    function pinBot(...a) { this.placed = ['pinBot', ...a.slice(1)]; }
    function moveBot(...a) { this.placed = ['moveBot', ...a.slice(1)]; }
    ${src}
    Object.assign(this, { hasGroups, canMakeGroup, ids: (c) => chatItems(c).map((x) => x.id), mentionCtx, escMentions, drawContacts, pinnedGroups, groupsIn, categoryNames, turnLines, GROUP_MAX, isGoOn,
      drag: (id) => { dragId = id; }, chat: () => groupChat, open: (c) => { groupChat = c; }, replyDrafts, followGroups, followGroupDrafts });`, ctx);
  // A chat that is read, as loadGroupChat leaves it.
  const chat = (items = [], more = {}) => { const c = { id: state.groupId, items: new Map(), more: false, working: [], asks: null, limit: null, loaded: false, want: 50, asked: 0 }; ctx.takeGroupPage(c, { items, more: false, working: [], asks: null, limit: null, ...more }); ctx.open(c); return c; };
  return { ctx, state, said, doc, chat, group: () => state.groups[0] };
}

// ---------- old and new ----------

test('web: the page loads groups.js after app.js, and has a view and a panel page for a group', () => {
  const place = (s) => html.indexOf(`<script src="${s}">`);
  assert.ok(place('/app.js') > 0 && place('/groups.js') > place('/app.js'));
  assert.match(html, /<section id="view-group" class="view hidden"><\/section>/);
  assert.match(html, /<section id="view-groupsettings" class="page panel-page hidden"><\/section>/);
});

test('web: against a server without `groups` in `features` nothing of a group is asked for or offered', async () => {
  const p = page({ features: ['unread'], groups: [] });
  assert.equal(p.ctx.hasGroups(), false);
  assert.deepEqual(plain(await p.ctx.loadGroups()), []);
  await p.ctx.loadGroupChat('g1');
  assert.deepEqual(p.said.calls, [], 'no request for a list or a chat the server does not have');
  assert.equal(p.ctx.canMakeGroup(p.state.bots[0]), false, 'no "Add a bot to this chat"');
  // The search asks for groups only where the server has them.
  assert.match(app, /\/search\?q=\$\{encodeURIComponent\(q\)\}\$\{hasGroups\(\) \? '&groups=1' : ''\}/);
  // With the feature: the list is the server's, and one that could not be read leaves the page's own.
  const q = page({ reply: async () => [DEV, null, { name: 'no id' }] });
  assert.deepEqual(plain(await q.ctx.loadGroups()).map((g) => g.id), ['g1']);
  const away = page({ reply: async () => new Error("Can't reach botdot.") });
  assert.equal(await away.ctx.loadGroups(), away.state.groups);
  assert.equal(q.ctx.canMakeGroup(q.state.bots[0]), true);
  assert.equal(page({ bots: [CODER] }).ctx.canMakeGroup(CODER), false, 'with no other bot there is nobody to add');
});

// The owner at the test of Milestone 10 (GRP-011): "Move this plus on the top of the chat on the right side of the bot name."
test('web: the small plus that makes a group stands right of the name in a bot\'s chat, and no longer in its settings', () => {
  const draw = cut('function renderBotChat() {', '// Re-render the thread only when something changed');
  const head = draw.slice(draw.indexOf('<div class="chat-head">'), draw.indexOf('<div class="chat-thread"'));
  // A sibling of the name's button, right after it and before the buttons on the right: a tap on it is no tap on the name.
  assert.match(head, /<button class="chat-title" id="bot-settings" title="Settings">(?:(?!<button)[\s\S])*<\/button>\s*<button type="button" class="icon-btn sm hidden" id="bot-add-to-chat" title="Add a bot to this chat" aria-label="Add a bot to this chat">＋<\/button>\s*<div class="actions-right">/);
  assert.equal(head.match(/<button/g).length, 3, 'the name, the plus and its computer: no button inside another');
  // Drawn hidden, and shown at every drawing only where a group can be made: a server without groups, or no other bot, never shows it.
  assert.ok(draw.includes("$('#bot-add-to-chat').classList.toggle('hidden', !canMakeGroup(bot));"));
  // It opens the picker, for the bot whose chat is open; the name still opens the settings.
  assert.ok(draw.includes("$('#bot-add-to-chat').onclick = () => { const b = state.bots.find((x) => x.id === state.botId); if (b && canMakeGroup(b)) openGroupMaker(b); };"));
  assert.ok(draw.includes("$('#bot-settings').onclick = () => setPanel('toggle');"));
  // Only there: not in the bot's settings, the Chief's chat or a group's.
  assert.equal(app.split('bot-add-to-chat').length - 1, 3, 'the head, its click and its showing');
  assert.ok(!src.includes('bot-add-to-chat'));
  assert.ok(!app.includes('bs-add') && !css.includes('bs-add'));
  // A long name is cut, the plus keeps its size.
  assert.match(css, /#view-bot \.chat-head h2 \{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
  assert.match(css, /\.chat-title \{[^}]*min-width: 0;/);
  assert.ok(css.includes('#view-bot .chat-head .back-btn { flex: none; }'), 'a long name does not squeeze the back button');
  assert.match(css, /\.icon-btn\.sm \{[^}]*flex: none;/);
});

// ---------- making and changing ----------

// The picker as openBotPicker draws it: its rows, its hint, its button and the line for a refusal.
function picker(p) {
  let m = null;
  p.said.modal = (h) => {
    const rows = [...h.matchAll(/data-pick="([^"]*)"/g)].map(([, id]) => { const row = element({}, { dataset: { pick: id }, setAttribute(k, v) { row[k] = v; } }); return row; });
    const hint = element(), button = element(), note = element();
    const form = element({ '[data-pick]': rows, '.pick-hint': hint, '.btn.primary': button, '.send-note': note }, { name: { value: '' } });
    m = element({ '#bot-picker': form }, { closed: false, close() { m.closed = true; }, html: h, rows, hint, button, form });
    return m;
  };
  return {
    get: () => m,
    tick: (id) => m.rows.find((r) => r.dataset.pick === id).onclick(),
    ticked: () => m.rows.filter((r) => r['aria-pressed'] === 'true').map((r) => r.dataset.pick),
    submit: () => m.form.onsubmit({ preventDefault() {} }),
  };
}

test('web: "Add a bot to this chat" opens a picker of the other bots with a name to give, and makes a group of that bot and those picked', async () => {
  const made = { ...DEV, id: 'g9' };
  const p = page({ groups: [], reply: async (path, opts) => (opts.method === 'POST' ? made : {}) });
  p.said.refresh = null;
  const pick = picker(p);
  p.ctx.refresh = async () => { p.state.groups = [made]; };
  p.ctx.openGroupMaker(p.state.bots[0]);
  const m = pick.get();
  assert.match(m.html, /<h2>New group<\/h2>/);
  assert.match(m.html, /<label class="field">Name<input type="text" name="name" maxlength="60" value=""/);
  assert.deepEqual(m.rows.map((r) => r.dataset.pick), ['reviewer', 'writer', 'shopper', 'weather'], 'every other bot, its own category first; the bot itself is in already');
  assert.equal(m.button.disabled, true, 'nothing to make with nobody picked');
  assert.equal(m.hint.textContent, 'Pick one to five bots to join Coder. Its own chat stays as it is.');
  pick.tick('writer'); pick.tick('reviewer');
  assert.equal(m.button.disabled, false);
  assert.equal(m.hint.textContent, '3 bots in the group, with Coder.');
  pick.tick('writer'); pick.tick('writer'); // off and on again: last in the order
  m.form.name.value = 'Dev';
  await pick.submit();
  assert.deepEqual(p.said.calls, [['POST', '/group-chats', { name: 'Dev', members: ['coder', 'reviewer', 'writer'] }]], 'the bot first, then the picked ones in the order they were ticked');
  assert.equal(m.closed, true);
  assert.deepEqual(p.said.views, [['group', 'g9']], 'the group is open');
  assert.deepEqual(p.said.calls.filter(([, path]) => path.startsWith('/bots')), [], "nothing of the bot's own chat is touched");
});

test('web: one to five bots can be picked: a sixth tick takes nothing', () => {
  const more = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id.toUpperCase(), color: '#888780', group: '' }));
  const p = page({ bots: [CODER, ...more], groups: [] });
  const pick = picker(p);
  p.ctx.openGroupMaker(p.state.bots[0]);
  for (const id of ['a', 'b', 'c', 'd', 'e']) pick.tick(id);
  const m = pick.get();
  assert.deepEqual(m.rows.map((r) => [r.dataset.pick, r.disabled]), [['a', false], ['b', false], ['c', false], ['d', false], ['e', false], ['f', true]], 'the group is full: the row that is left cannot be ticked');
  pick.tick('f');
  assert.deepEqual(pick.ticked(), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(m.hint.textContent, '6 bots in the group, with Coder.');
  pick.tick('a');
  assert.equal(m.rows[5].disabled, false, 'room again');
});

test("web: a refusal of the server is shown in its words, in the picker, and nothing is lost or made", async () => {
  const p = page({ groups: [], reply: async (path, opts) => (opts.method === 'POST' ? refused('Give the group a name.') : {}) });
  const pick = picker(p);
  p.ctx.openGroupMaker(p.state.bots[0]);
  pick.tick('reviewer');
  await pick.submit();
  const m = pick.get();
  assert.deepEqual(p.said.notes, ['', 'Give the group a name.']);
  assert.equal(m.closed, false);
  assert.deepEqual(pick.ticked(), ['reviewer']);
  assert.equal(m.button.disabled, false, 'to try again');
  assert.deepEqual(p.said.views, []);
  assert.deepEqual(p.said.toasts, []);
});

test("web: the group's title opens its panel, and the panel is the group's own", () => {
  const { Panel } = page().ctx;
  const next = (view, panel, req) => { const to = Panel.next({ view, panel }, req); return [to.view, to.panel]; };
  assert.deepEqual(next('group', null, { panel: 'toggle' }), ['group', 'settings']);
  assert.deepEqual(next('group', 'settings', { panel: 'toggle' }), ['group', null]);
  assert.equal(Panel.page('group', 'settings'), 'groupsettings');
  assert.equal(Panel.name('group', null), 'group');
  assert.deepEqual(next('group', 'settings', { view: 'botjobs' }), ['bot', 'jobs'], 'a group has no jobs');
  assert.equal(Panel.page('group', 'jobs'), 'groupsettings', 'only a bot has jobs');
  assert.deepEqual(next('bot', 'settings', { view: 'group' }), ['group', 'settings'], 'another chat keeps the panel open');
  assert.deepEqual(next('group', 'settings', { gone: true }), ['chief', null], 'a deleted group leaves to the Chief');
  assert.match(src, /\$\('#group-settings'\)\.onclick = \(\) => setPanel\('toggle'\);/);
  assert.match(app, /if \(GROUP_NAMES\.includes\(v\) && sub\) state\.groupId = sub;/);
  assert.match(app, /if \(panelPage\(\) === 'groupsettings'\) renderGroupSettings\(\);/);
});

// The panel's page as renderGroupSettings fills it.
function panelPage(p) {
  const parts = { '#gs-name': element(), '#gs-pic': element(), '#gs-members': element(), '#gs-add': element(), '#gs-delete': element() };
  const root = element({}, { querySelector: (sel) => (root.innerHTML ? parts[sel] || null : null),
    querySelectorAll: (sel) => (sel === '[data-take-out]' ? [...parts['#gs-members'].innerHTML.matchAll(/data-take-out="([^"]*)"/g)].map(([, id]) => (parts[`out:${id}`] ||= element({}, { dataset: { takeOut: id } }))) : []) });
  p.doc['#view-groupsettings'] = root;
  return { root, parts };
}

test('web: the panel has the name, the members each with a way to take it out, "Add a bot", and "Delete this group", which says that it deletes no bot', async () => {
  const p = page({ reply: async (path, opts) => (opts.method === 'PUT' && opts.body.members?.length < 2 ? refused('A group has at least two bots. Add another, or delete the group.') : {}) });
  const { root, parts } = panelPage(p);
  p.ctx.renderGroupSettings();
  assert.match(root.innerHTML, /<label class="field">Name<input type="text" id="gs-name" maxlength="60"/);
  assert.match(root.innerHTML, /<button type="button" class="btn sm" id="gs-add">＋ Add a bot<\/button>/);
  assert.match(root.innerHTML, /<button type="button" class="btn danger" id="gs-delete">Delete this group<\/button>\s*<p class="faint gs-note">Its chat is erased\. No bot is deleted\.<\/p>/);
  assert.equal(parts['#gs-name'].value, 'Dev');
  assert.deepEqual([...parts['#gs-members'].innerHTML.matchAll(/<span class="grow">(.*?)<\/span>\s*<button type="button" class="icon-btn sm" data-take-out="(\w+)" title="(.*?)"/g)].map((m) => m.slice(1)),
    [['Coder', 'coder', 'Take Coder out of the group'], ['Reviewer', 'reviewer', 'Take Reviewer out of the group'], ['Issue Writer', 'writer', 'Take Issue Writer out of the group']]);
  assert.equal((parts['#gs-pic'].innerHTML.match(/<svg/g) || []).length, 3, 'its picture');
  // Renaming saves by itself; an emptied box takes the name back.
  parts['#gs-name'].value = '  Dev   team ';
  parts['#gs-name'].onchange();
  parts['#gs-name'].value = '';
  parts['#gs-name'].onchange();
  assert.equal(parts['#gs-name'].value, 'Dev');
  // Taking a member out sends the whole list as it is to be.
  await parts['out:writer'].onclick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.said.calls, [['PUT', '/group-chats/g1', { name: 'Dev team' }], ['PUT', '/group-chats/g1', { members: ['coder', 'reviewer'] }]]);
  // What the server refuses is said in its words.
  p.state.groups[0].members = ['coder'];
  await p.ctx.changeGroup(p.state.groups[0], { members: [] });
  assert.deepEqual(p.said.toasts, [['A group has at least two bots. Add another, or delete the group.', true]]);
});

test('web: "Add a bot" picks among the bots that are not members, as many as there is room for, and "Delete this group" deletes the group alone', async () => {
  const p = page();
  const { parts } = panelPage(p);
  const pick = picker(p);
  p.ctx.renderGroupSettings();
  assert.equal(parts['#gs-add'].classList.contains('hidden'), false);
  parts['#gs-add'].onclick();
  const m = pick.get();
  assert.match(m.html, /<h2>Add a bot<\/h2>/);
  assert.doesNotMatch(m.html, /name="name"/, 'no name to give');
  assert.deepEqual(m.rows.map((r) => r.dataset.pick), ['shopper', 'weather']);
  pick.tick('weather');
  assert.equal(m.hint.textContent, '4 bots in Dev.');
  await pick.submit();
  assert.deepEqual(p.said.calls, [['PUT', '/group-chats/g1', { members: ['coder', 'reviewer', 'writer', 'weather'] }]]);
  // A full group, and a group with every bot in it, have nothing to add.
  p.state.groups[0].members = BOTS.map((b) => b.id);
  p.ctx.renderGroupSettings();
  assert.equal(parts['#gs-add'].classList.contains('hidden'), true);
  // Deleting asks first, in words that say what goes and what stays.
  p.said.calls.length = 0;
  await parts['#gs-delete'].onclick();
  assert.match(p.said.confirms[0], /^Delete the group Dev\?\n\nIts chat is erased\. No bot is deleted: each keeps its own chat\.$/);
  assert.deepEqual(p.said.calls, [['DELETE', '/group-chats/g1']]);
  assert.deepEqual([p.state.groups.length, p.said.left, p.state.bots.length], [0, 1, 5], 'the group is gone from the list, its chat is left, and every bot is there');
});

// ---------- the list ----------

test("web: a group is one row in its category, after the category's bots; a pinned one stands after the pinned bots", () => {
  const ops = { ...DEV, id: 'g2', name: 'Ops', members: ['weather', 'shopper'], category: 'House', order: 1 };
  const top = { ...DEV, id: 'g3', name: 'Top', members: ['coder', 'weather'], category: 'Programming', pinned: 1, order: 0 };
  const second = { ...DEV, id: 'g4', name: 'Alpha', members: ['coder', 'weather'], category: 'Programming', order: 2 };
  const loose = { ...DEV, id: 'g5', name: 'Loose', members: ['coder', 'shopper'], category: '', order: 1 };
  const empty = { ...DEV, id: 'g6', name: 'Lab', members: ['coder', 'shopper'], category: 'Lab', order: 1 };
  const p = page({ bots: [...BOTS.slice(0, 4), { ...SHOPPER, pinned: 1, order: 0 }], groups: [second, DEV, ops, top, loose, empty] });
  const list = element();
  p.doc['#contacts'] = list;
  p.doc['#contact-search'] = { value: '' };
  p.state.view = 'group';
  p.state.groupId = 'g1';
  p.ctx.drawContacts();
  const rows = [...list.innerHTML.matchAll(/data-contact="([^"]*)"|data-group-head="([^"]*)"/g)].map((m) => m[1] ?? `# ${m[2]}`);
  assert.deepEqual(rows, ['dashboard', 'chief', 'shopper', 'group:g3', '# House', 'weather', 'group:g2', '# Lab', 'group:g6', '# Programming', 'coder', 'reviewer', 'writer', 'group:g1', 'group:g4', '# ', 'group:g5'],
    'a category that holds only a group is there, and "Other" holds a group without a category');
  assert.match(list.innerHTML, /<button class="contact active" data-contact="group:g1" data-kind="group" data-group="Programming" data-place="1" draggable="true" title="[^"]+">/);
  assert.match(list.innerHTML, /<button class="contact " data-contact="group:g4" data-kind="group" data-group="Programming" data-place="2" draggable="true" title="[^"]+">/, 'its place is counted among the groups');
  assert.match(list.innerHTML, /<button class="contact " data-contact="group:g3" data-kind="group" data-pin="1" draggable="true" title="[^"]+">/);
  assert.match(list.innerHTML, /data-fold="Programming" title="Hide this category">[\s\S]*?Programming <span class="faint">5<\/span>/, 'bots and groups are counted together');
});

test('web: the search box finds a group by its name, its category and its members, and a hit in a group opens the group', () => {
  const p = page();
  const list = element();
  p.doc['#contacts'] = list;
  const found = (q) => { p.doc['#contact-search'] = { value: q }; p.ctx.drawContacts(); return [...list.innerHTML.matchAll(/data-contact="([^"]*)"/g)].map((m) => m[1]); };
  assert.deepEqual(found('dev'), ['group:g1']);
  assert.deepEqual(found('issue wr'), ['writer', 'group:g1'], 'by a member\'s name, beside the bot');
  assert.deepEqual(found('weather'), ['weather']);
  assert.deepEqual(found('program'), ['coder', 'reviewer', 'writer', 'group:g1']);
  // A reply in a group, among the messages found: whose it is and in which group; it opens the group.
  const hit = { runId: 'r7', bot: { id: 'coder', name: 'Coder', color: CODER.color }, group: { id: 'g1', name: 'Dev' }, at: at(3), snippet: 'the «dark» mode' };
  const real = vm.runInContext(`(${cut('function hitHTML(h, i) {', '// The words in the search box').trim().replace(/^function hitHTML/, 'function')})`, p.ctx);
  assert.match(real(hit, 0), /<span class="name"><svg class="fig fig-small"><\/svg>Coder · Dev<\/span>/);
  p.ctx.openHit(hit);
  assert.deepEqual(p.said.views, [['group', 'g1']]);
  assert.equal(p.state.jump, hit);
});

// The group's chat as renderGroupChat finds it once it is built: the head, the thread with its two boxes, the box.
function chatView(p) {
  const items = element({}, { querySelector: (sel) => { const id = (sel.match(/^\[data-reply="(\w+)"\]$/) || [])[1]; return id && items.innerHTML.includes(`data-reply="${id}"`) ? { id } : null; } });
  const tail = element();
  const thread = element({ '.g-items': items, '.g-tail': tail }, { scrollHeight: 0, scrollTop: 0, clientHeight: 0 });
  const root = element({ form: element({}, { text: {} }) });
  root.dataset.group = p.state.groupId;
  Object.assign(p.doc, { '#view-group': root, '#group-thread': thread, '#group-pic': element(), '#group-name': element(), '#group-sub': element() });
  p.state.view = 'group';
  return { root, thread, items, tail };
}

test('web: a hit goes to its reply in the group, also in a chat that is drawn already, and one further back is read first', async () => {
  const older = Array.from({ length: 3 }, (_, i) => reply(`old${i}`, CODER, `Old ${i}`, { at: at(i) }));
  const p = page({ reply: async (path) => (path.endsWith('limit=200') ? { items: [...older, reply('r7', CODER, 'The dark mode', { at: at(9) })], more: false } : {}) });
  const view = chatView(p);
  p.chat([message('m1', 'Dark mode?'), reply('r7', CODER, 'The dark mode', { at: at(9) })]);
  const hit = (runId) => ({ runId, bot: { id: 'coder' }, group: { id: 'g1', name: 'Dev' } });
  p.state.jump = hit('r7');
  p.ctx.renderGroupChat();
  assert.match(view.items.innerHTML, /data-reply="r7"/);
  assert.deepEqual([p.said.jumped, p.state.jump], [['r7'], null]);
  assert.equal(p.doc['#group-name'].textContent, 'Dev');
  assert.equal(p.doc['#group-sub'].textContent, 'Coder, Reviewer, Issue Writer');
  assert.deepEqual(p.said.needs, ['group:g1'], 'the cards stand last');
  // The same chat, nothing new in it: a second hit is gone to all the same.
  const drawn = view.items.innerHTML;
  p.state.jump = hit('r7');
  p.ctx.renderGroupChat();
  assert.deepEqual([p.said.jumped, view.items.innerHTML === drawn], [['r7', 'r7'], true]);
  // A hit in another group waits for that group.
  p.state.jump = { ...hit('r7'), group: { id: 'g2', name: 'Ops' } };
  p.ctx.renderGroupChat();
  assert.equal(p.said.jumped.length, 2);
  // One further back than the page holds: the chat is read further, and then gone to.
  const far = page({ reply: async (path) => (path.endsWith('limit=200') ? { items: [...older, reply('r7', CODER, 'The dark mode', { at: at(9) })], more: false } : {}) });
  chatView(far);
  far.chat([reply('r7', CODER, 'The dark mode', { at: at(9) })], { more: true });
  far.state.jump = hit('old1');
  far.ctx.renderGroupChat();
  assert.deepEqual([far.said.jumped, far.said.opened], [[], []]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(far.said.calls, [['GET', '/group-chats/g1/chat?limit=200']]);
  assert.deepEqual(far.said.jumped, ['old1']);
  // One that is nowhere in the chat opens on its own.
  far.state.jump = hit('lost');
  far.ctx.renderGroupChat();
  assert.deepEqual(far.said.opened, ['lost']);
});

test("web: the row has the members' heads with the faces of their states, the name, the newest reply with its bot's name, the time and the dots", () => {
  const p = page();
  const g = p.group();
  p.state.bots[1].state = 'needs_you';
  Object.assign(g, { last: { runId: 'r3', botId: 'coder', botName: 'Coder', status: 'success', at: at(20), text: 'Pull request **#313** is open.' }, unread: 2 });
  const row = p.ctx.groupContactHTML(g);
  assert.deepEqual([...row.matchAll(/<i><svg class="fig" data-st="(\w+)" data-c="(#\w+)"><\/svg><\/i>/g)].map((m) => [m[1], m[2]]), [['idle', CODER.color], ['needs_you', REVIEWER.color], ['idle', WRITER.color]]);
  assert.match(row, /<div class="group-pic  n3">/);
  assert.match(row, /<span class="name">Dev<\/span><span class="time">14:20<\/span><span class="unread-dots" style="--c:#1d9e75" aria-label="New replies"><i><\/i><i><\/i><\/span>/);
  assert.match(row, /<div class="prev "><span class="who">Coder:<\/span> Pull request 313 is open\.<\/div>/);
  // Five new replies are three dots, and a reply that failed is its problem, or that it could not finish.
  Object.assign(g, { unread: 5, last: { ...g.last, botId: 'gone', botName: 'Old Bot', status: 'error', text: '' } });
  assert.deepEqual(plain(p.ctx.groupLine(g)), { who: 'Old Bot', prev: "Couldn't finish", cls: '', after: p.ctx.Unread.dots(3, '#1d9e75') });
  // A group with four members shows three heads; one whose bots are gone a grey one; one without a reply says so.
  assert.equal((p.ctx.groupPicture({ members: ['coder', 'reviewer', 'writer', 'weather'] }).match(/<svg/g) || []).length, 3);
  assert.match(p.ctx.groupPicture({ members: ['gone'] }), /<div class="group-pic  n1"><i><svg class="fig" data-st="idle" data-c="#888780">/);
  assert.deepEqual(plain(p.ctx.groupLine({ ...DEV })), { who: '', prev: 'No messages yet', cls: '', after: '' });
  assert.match(css, /\.group-pic > i:nth-child\(3\) \{/);
});

test('web: the row says "… asks" when a member asks, and while a member works who it is and its opening line', () => {
  const p = page();
  const g = p.group();
  Object.assign(g, { last: { runId: 'r3', botId: 'coder', botName: 'Coder', status: 'success', at: at(20), text: 'Which branch?' }, asks: { botId: 'coder', botName: 'Coder', text: 'Which **branch** should I use?', runId: 'r3', at: at(20) }, unread: 1 });
  assert.deepEqual(plain(p.ctx.groupLine(g)), { who: '', prev: 'Coder asks: Which branch should I use?', cls: 'asks', after: p.ctx.Unread.mark(CODER.color) });
  assert.match(p.ctx.groupContactHTML(g), /<span class="asks-mark" style="--c:#1d9e75" aria-label="Asks you">\?<\/span><\/div>\s*<div class="prev asks">Coder asks: Which branch should I use\?<\/div>/);
  // At work: the member, and "Working" until it said its line. The question waits behind it.
  g.working = ['reviewer', 'coder'];
  assert.deepEqual(plain(p.ctx.groupLine(g)), { who: 'Reviewer', prev: 'Working…', cls: 'working', after: p.ctx.Unread.dots(1, CODER.color) });
  p.ctx.sayTurnLine('r9', 'g1', 'reviewer', { text: 'Reading pull request 310' });
  p.ctx.sayTurnLine('r8', 'g2', 'reviewer', { text: 'In another group' });
  assert.match(p.ctx.groupContactHTML(g), /<div class="prev working"><span class="who">Reviewer:<\/span> Reading pull request 310…<\/div>/);
});

test('web: a group is dragged among the groups: dropped on a place it is pinned or moved there by its own route', async () => {
  const second = { ...DEV, id: 'g4', name: 'Alpha', order: 2 };
  const ops = { ...DEV, id: 'g2', name: 'Ops', category: 'House', order: 1 };
  const p = page({ groups: [DEV, second, ops] });
  p.doc['#contacts'] = element();
  const e = { preventDefault() {} };
  const order = () => p.state.groups.map((g) => [g.id, g.category, g.pinned, g.order]);
  // Within its category: below the second.
  p.ctx.drag('group:g1');
  p.ctx.dropAt(e, { group: 'Programming', order: 3 });
  assert.deepEqual(order(), [['g1', 'Programming', 0, 2], ['g4', 'Programming', 0, 1], ['g2', 'House', 0, 1]], 'shown at once');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.said.calls, [['PUT', '/group-chats/g1', { category: 'Programming', order: 2 }]], 'it leaves its own place first');
  assert.equal(p.said.refreshed, 1);
  // To another category, first among its groups.
  p.said.calls.length = 0;
  p.ctx.dropAt(e, { group: 'House', order: 1 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order(), [['g1', 'House', 0, 1], ['g4', 'Programming', 0, 1], ['g2', 'House', 0, 2]]);
  assert.deepEqual(p.said.calls, [['PUT', '/group-chats/g1', { category: 'House', order: 1 }]]);
  assert.deepEqual(p.said.toasts, [['Dev moved to House', false]]);
  // Pinned, and back into a category.
  p.said.calls.length = 0;
  p.ctx.dropAt(e, { pinned: 1 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order(), [['g1', 'House', 1, 0], ['g4', 'Programming', 0, 1], ['g2', 'House', 0, 1]]);
  p.ctx.dropAt(e, { group: '', order: 1 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.said.calls, [['PUT', '/group-chats/g1', { pinned: 1 }], ['PUT', '/group-chats/g1', { category: '', order: 1, pinned: 0 }]]);
  // A bot that is dragged still goes by the bot's route.
  p.ctx.drag('weather');
  p.ctx.dropAt(e, { group: 'Programming', order: 1 });
  assert.deepEqual(plain(p.ctx.placed), ['moveBot', 'Programming', 1]);
});

test('web: the gap opens where the dragged row would land: a group among the groups, after the bots, and a bot among the bots', () => {
  const second = { ...DEV, id: 'g4', name: 'Alpha', order: 2 };
  const top = { ...DEV, id: 'g3', name: 'Top', pinned: 1, order: 0 };
  const p = page({ bots: [...BOTS.slice(0, 4), { ...SHOPPER, pinned: 1, order: 0 }], groups: [DEV, second, top] });
  const row = (name, dataset) => element({}, { name, dataset, offsetHeight: 60, getBoundingClientRect: () => ({ top: 100 }) });
  const rows = {
    chief: row('chief', { contact: 'chief' }), shopper: row('shopper', { contact: 'shopper', pin: '1' }), top: row('top', { contact: 'group:g3', kind: 'group', pin: '1' }),
    house: row('# House', { groupHead: 'House' }), weather: row('weather', { contact: 'weather', group: 'House', place: '1' }),
    prog: row('# Programming', { groupHead: 'Programming' }), coder: row('coder', { contact: 'coder', group: 'Programming', place: '1' }), writer: row('writer', { contact: 'writer', group: 'Programming', place: '3' }),
    dev: row('dev', { contact: 'group:g1', kind: 'group', group: 'Programming', place: '1' }), alpha: row('alpha', { contact: 'group:g4', kind: 'group', group: 'Programming', place: '2' }),
    lab: row('# Lab', { groupHead: 'Lab' }),
  };
  const all = Object.values(rows);
  const bots = (cat) => all.filter((r) => r.dataset.contact && r.dataset.contact !== 'chief' && !r.dataset.kind && (cat === null ? r.dataset.pin : r.dataset.group === cat));
  p.ctx.$$ = (sel) => (sel.includes(':not([data-kind="group"])') ? bots(sel.includes('[data-pin]') ? null : sel.match(/\[data-group="(.*?)"\]/)[1]) : sel.includes('[data-group-head]') ? all : all.filter((r) => r.dataset.contact && r.dataset.contact !== 'chief'));
  p.ctx.$ = (sel) => (sel === '#contacts [data-contact="chief"]' ? rows.chief : all.find((r) => 'groupHead' in r.dataset && sel === `#contacts [data-group-head="${r.dataset.groupHead}"]`) || null);
  p.ctx.wireDrags();
  const over = (target, y = 150) => { p.ctx.gaps.length = 0; rows[target].ondragover({ dataTransfer: { types: ['application/x-botdot-bot'] }, preventDefault() {}, clientY: y }); return plain(p.ctx.gaps[0]); };
  // A group that is dragged.
  p.ctx.drag('group:g1');
  assert.deepEqual(over('alpha'), [{ group: 'Programming', order: 3 }, 'alpha', false], 'below a group: after it, among the groups');
  assert.deepEqual(over('alpha', 110), [{ group: 'Programming', order: 2 }, 'alpha', true], 'above it');
  assert.deepEqual(over('coder'), [{ group: 'Programming', order: 1 }, 'writer', false], 'over a bot: the first group there, after the last bot');
  assert.deepEqual(over('weather'), [{ group: 'House', order: 1 }, 'weather', false]);
  assert.deepEqual(over('house'), [{ group: 'House', order: 1 }, 'weather', false], 'on a heading: the first group, after the bots that are drawn');
  assert.deepEqual(over('lab'), [{ group: 'Lab', order: 1 }, '# Lab', false], 'a category without a bot: under its heading');
  assert.deepEqual(over('chief'), [{ pinned: 1 }, 'shopper', false], 'on the Chief: the first pinned group, after the pinned bots');
  assert.deepEqual(over('shopper'), [{ pinned: 1 }, 'shopper', false]);
  assert.deepEqual(over('top'), [{ pinned: 2 }, 'top', false]);
  // A bot that is dragged: as before among the bots, and over a group last among the bots there.
  p.ctx.drag('weather');
  assert.deepEqual(over('coder', 110), [{ group: 'Programming', order: 1 }, 'coder', true]);
  assert.deepEqual(over('dev'), [{ group: 'Programming', order: 4 }, 'writer', false], 'over a group: after the last bot, before the groups');
  assert.deepEqual(over('top'), [{ pinned: 2 }, 'shopper', false]);
  assert.deepEqual(over('prog'), [{ group: 'Programming', order: 1 }, '# Programming', false]);
  assert.deepEqual(over('chief'), [{ pinned: 1 }, 'chief', false]);
  // Anything else that is dragged over the list is not ours.
  p.ctx.gaps.length = 0;
  rows.coder.ondragover({ dataTransfer: { types: ['Files'] }, preventDefault() { assert.fail('not taken'); } });
  assert.deepEqual(p.ctx.gaps, []);
});

test('web: a folder of bots is called a category wherever the page said group', () => {
  for (const said of [/Rename or remove this category/, /<h2>Category: \$\{esc\(group\)\}<\/h2>/, />Remove category<\/button>/, /'Category removed'/, /<div class="field">Category\s*<div class="group-picker"/, /placeholder="Category name" aria-label="New category name"/, />＋ New category<\/button>/, /title="\$\{isFolded \? 'Show' : 'Hide'\} this category"/]) assert.match(app, said);
  for (const gone of [/Rename or remove this group/, /<h2>Group: /, /Remove group/, /Group removed/, /<div class="field">Group\b/, /New group name/, /＋ New group/, /Group name/]) assert.doesNotMatch(app, gone);
  // What the page calls a group now is the chat with several bots.
  assert.match(src, /title: 'New group'/);
});

// ---------- the chat ----------

test("web: every reply has its bot's name above it in the bot's colour and its head beside it, and no reply is drawn without them", () => {
  const p = page();
  const c = p.chat([message('m1', 'The settings page needs a dark mode switch.'), reply('r1', WRITER, 'Issue #312 is written. @Coder, it is yours.'), reply('r2', CODER, 'Done.', { at: at(3), files: [{ name: 'diff.patch', file: 'f/diff.patch' }] })]);
  const h = p.ctx.groupThreadHTML(p.group(), c);
  const rows = [...h.matchAll(/<div class="bubble-row from-bot g-row" data-reply="(\w+)">\s*<div class="avatar head g-head" data-bot="(\w+)" data-st="idle" data-c="(#\w+)"><\/div>\s*<div class="stack">\s*<div class="g-name" style="--c:(#\w+)">(.*?)<\/div>/g)].map((m) => m.slice(1));
  assert.deepEqual(rows, [['r1', 'writer', WRITER.color, WRITER.color, 'Issue Writer'], ['r2', 'coder', CODER.color, CODER.color, 'Coder']]);
  assert.equal((h.match(/class="bubble from-bot/g) || []).length, 2);
  assert.match(h, /<div class="bubble-row from-me" data-gmsg="m1"><div class="stack mine">\s*<div class="bubble from-me" data-expand><div class="clamp">The settings page needs a dark mode switch\.<\/div><\/div>/);
  assert.ok(h.indexOf('data-gmsg="m1"') < h.indexOf('data-reply="r1"') && h.indexOf('data-reply="r1"') < h.indexOf('data-reply="r2"'), 'oldest first');
  assert.match(h, /<div class="bubble-files">diff\.patch<\/div>/, "a member's file is under its reply");
  assert.match(h, /<button data-details="r2">Details<\/button>/);
  // The name and the colour are the bot's now; a bot that is gone keeps what the server said of it.
  p.state.bots[0].name = 'Builder';
  p.state.bots[0].color = '#639922';
  const gone = reply('r3', { id: 'gone', name: 'Old Bot', color: '#d4537e' }, 'Bye.', { at: at(4) });
  const again = p.ctx.groupThreadHTML(p.group(), p.chat([c.items.get('r2'), gone]));
  assert.match(again, /data-c="#639922"><\/div>\s*<div class="stack">\s*<div class="g-name" style="--c:#639922">Builder<\/div>/);
  assert.match(again, /<div class="avatar head g-head" data-st="idle" data-c="#d4537e"><\/div>\s*<div class="stack">\s*<div class="g-name" style="--c:#d4537e">Old Bot<\/div>/);
  // A colour is the server's and goes into a style: nothing but a colour gets there, and every word is text.
  const bad = reply('r4', { id: 'x', name: '<b>x</b>', color: 'red;background:url(x)' }, '<script>alert(1)</script>');
  const drawn = p.ctx.groupThreadHTML(p.group(), p.chat([bad]));
  assert.match(drawn, /<div class="g-name" style="--c:#888780">&lt;b&gt;x&lt;\/b&gt;<\/div>/);
  assert.doesNotMatch(drawn, /<script>|<b>x/);
  assert.match(css, /\.g-name \{[^}]*color: var\(--c\);/);
});

test('web: a reply that failed or was stopped says so under its bot\'s name, and the turns go on', () => {
  const p = page();
  const c = p.chat([message('m1', 'Ship it.'), reply('r1', CODER, '', { status: 'stopped', endedBy: 'owner', problem: 'You stopped this run before it finished.' }), reply('r2', REVIEWER, '', { status: 'error', at: at(3) })]);
  const h = p.ctx.groupThreadHTML(p.group(), c);
  assert.match(h, /<div class="g-name" style="--c:#1d9e75">Coder<\/div>\s*<div class="bubble from-bot problem"><div class="md"><p>You stopped this run before it finished\.<\/p><\/div>/);
  assert.match(h, /data-st="failed" data-c="#e24b4a"><\/div>\s*<div class="stack">\s*<div class="g-name" style="--c:#e24b4a">Reviewer<\/div>\s*<div class="bubble from-bot problem"><div class="md"><p>Something went wrong\.<\/p>/);
});

test('web: a mention is drawn as today, and typing "@" in a group suggests its members and nobody else', () => {
  const p = page();
  const mentions = p.ctx.mentionCtx('group:g1');
  assert.deepEqual(plain(mentions.bots.map((b) => b.name)), ['Coder', 'Reviewer', 'Issue Writer']);
  assert.deepEqual(plain(p.ctx.Mentions.suggest('@', mentions).map((r) => r.text)), ['@Coder', '@Reviewer', '@IssueWriter', '@Coder/NightlyBuild'], 'no Chief, no bot outside the group, no skill');
  assert.deepEqual(plain(p.ctx.Mentions.suggest('ask @rev', mentions).map((r) => r.label)), ['Reviewer']);
  assert.deepEqual(plain(p.ctx.Mentions.suggest('@wea', mentions)), []);
  // In a bot's own chat, and in the Chief's, as before.
  assert.deepEqual(plain(p.ctx.mentionCtx('coder').bots.map((b) => b.id)), ['chief', 'coder', 'reviewer', 'writer', 'weather', 'shopper']);
  // The owner's message: a member is its small head and its name; a bot outside the group stays plain text.
  const h = p.ctx.groupMessageHTML(message('m1', '@Coder and @Weather: which <branch>?'), 'group:g1');
  assert.match(h, /<div class="clamp"><span class="mention" title="@Coder"><svg class="fig fig-small"><\/svg>Coder<\/span> and @Weather: which &lt;branch&gt;\?<\/div>/);
  // The message box of a group is wired to its members and uploads to the group.
  assert.match(src, /wireComposer\(\$\('form', root\), \(text, files, k\) => sendToGroup\(g\.id, text, files, k\), \(\) => key, key\);/);
  assert.match(src, /const key = `group:\$\{g\.id\}`;/);
});

test("web: a member named in a reply is drawn as a mention, from the reply's text alone", () => {
  const p = page();
  // A reply's box with its text nodes, as the browser hands them to a walker.
  const text = (data, inside = null) => { const n = { data, parentElement: { closest: (sel) => (sel === 'a, code, pre, button, .mention' ? inside : null) }, replaced: null, replaceWith(parts) { n.replaced = parts.parts; } }; return n; };
  const nodes = [text('Done. @Coder, it is yours; @Weather and @nobody are not here. <b>'), text('run @Reviewer', 'code'), text('No name here'), text('@Coder/NightlyBuild failed')];
  const box = { nodes };
  Object.assign(p.ctx.document, {
    createTreeWalker: (root, what, filter) => { const taken = root.nodes.filter((n) => filter.acceptNode(n) === 1); let i = -1; const w = { currentNode: null, nextNode: () => { i++; w.currentNode = taken[i] || null; return !!w.currentNode; } }; return w; },
    createDocumentFragment: () => ({ parts: [], append(x) { this.parts.push(x); } }),
    createElement: (tag) => ({ tag }),
  });
  p.ctx.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  p.ctx.drawReplyMentions({ querySelectorAll: (sel) => (sel === '.g-row .md' ? [box] : []) }, 'group:g1');
  assert.deepEqual(plain(nodes[0].replaced), ['Done. ', { tag: 'span', title: '@Coder', className: 'mention', innerHTML: '<svg class="fig fig-small"></svg>Coder' }, ', it is yours; @Weather and @nobody are not here. <b>'],
    'a member is its small head and its name; a bot outside the group and a name nobody has stay the text they were, and so does what looks like markup');
  assert.equal(nodes[1].replaced, null, 'not inside code or a link');
  assert.equal(nodes[2].replaced, null);
  assert.deepEqual(plain(nodes[3].replaced), ['', { tag: 'span', title: '@Coder/NightlyBuild', className: 'mention tint', textContent: '@Coder/NightlyBuild' }, ' failed'], "a member's job is tinted, as in the owner's message");
  // A page without a walker draws the reply as it is.
  delete p.ctx.document.createTreeWalker;
  assert.doesNotThrow(() => p.ctx.drawReplyMentions({ querySelectorAll: () => [box] }, 'group:g1'));
});

test('web: under the chat stands one line per working member, with its name and what it says it is doing, and one "Stop all"', async () => {
  const p = page();
  const c = p.chat([message('m1', 'Ship it.')], { working: [{ botId: 'coder', runId: 'r5', messageId: 'm1', startedAt: at(2), openingLine: 'Running the tests' }, { botId: 'reviewer', runId: 'r6', messageId: 'm1', startedAt: at(3) }] });
  const h = p.ctx.groupTailHTML(p.group(), c);
  assert.deepEqual([...h.matchAll(/<div class="status-line( held)?" role="status" style="--c:(#\w+)"><i><\/i><span><b>(.*?)<\/b> · (.*?)<\/span>/g)].map((m) => m.slice(1)),
    [[undefined, CODER.color, 'Coder', 'Running the tests'], [undefined, REVIEWER.color, 'Reviewer', 'Working']]);
  assert.equal((h.match(/data-stop-all/g) || []).length, 1);
  assert.match(h, /Working<\/span><button type="button" data-stop-all>Stop all<\/button><\/div><\/div>$/, 'at the end of the last line');
  assert.doesNotMatch(h, /data-stop-run/, 'no Stop per member');
  // The feed's line takes the place of "Working"; a run that waits for the owner's OK says so, with a still dot.
  p.ctx.sayTurnLine('r6', 'g1', 'reviewer', { text: 'Reading pull request 310' });
  p.ctx.sayTurnLine('r5', 'g1', 'coder', { held: true });
  assert.deepEqual([...p.ctx.groupWorkingHTML(c.working).matchAll(/<div class="status-line( held)?"[^>]*><i><\/i><span><b>(.*?)<\/b> · (.*?)<\/span>/g)].map((m) => m.slice(1)),
    [[' held', 'Coder', 'Waiting for your OK'], [undefined, 'Reviewer', 'Reading pull request 310']]);
  assert.equal(p.ctx.groupWorkingHTML([]), '');
  // "Stop all" is one request for the group.
  const button = { disabled: false };
  await p.ctx.stopGroup('g1', button);
  assert.deepEqual(p.said.calls.slice(0, 1), [['POST', '/group-chats/g1/stop']]);
  assert.deepEqual(p.said.toasts, [['Stopping…', false]]);
  assert.match(css, /\.g-working \.status-line \{/);
});

test('web: a message that waits for a busy member is drawn as waiting and says for whom, with "Take back"', async () => {
  const p = page({ reply: async (path, opts) => (opts.method === 'DELETE' ? { text: '@Coder also bump the version.', attachments: [{ name: 'notes.txt', file: 'uploads/notes.txt', size: 12 }] } : { items: [] }) });
  const waits = message('m2', '@Coder also bump the version.', { at: at(5), to: ['coder'], waitsFor: ['coder'], next: ['coder'], canTakeBack: true, attachments: [{ name: 'notes.txt', file: 'uploads/notes.txt', size: 12 }] });
  const partly = message('m3', 'All of you: look.', { at: at(4), waitsFor: ['coder', 'reviewer'], next: ['coder', 'reviewer'], canTakeBack: false });
  const c = p.chat([message('m1', 'Ship it.'), reply('r1', WRITER, 'On it.'), partly, waits], { working: [{ botId: 'coder', runId: 'r5', startedAt: at(2) }] });
  // Whole, it stands at the end of the chat, after the working lines: the owner's bubble, faded.
  const rows = p.ctx.groupThreadHTML(p.group(), c);
  assert.doesNotMatch(rows, /data-gmsg="m2"/, 'not among the rows');
  const tail = p.ctx.groupTailHTML(p.group(), c);
  assert.match(tail, /^<div class="g-working">[\s\S]*<\/div><div class="chat-queued"><div class="bubble-row from-me"><div class="stack mine">\s*<div class="bubble from-me waits"><span class="mention" title="@Coder">[\s\S]*?<\/span> also bump the version\.<div class="bubble-files">[\s\S]*?notes\.txt[\s\S]*?<\/div><\/div>\s*<div class="bubble-meta"><span>Waits until Coder is free<\/span><button type="button" data-take-back="m2">Take back<\/button><\/div>/);
  // One whose first turns went says for whom it still waits, in its place, and cannot be taken back.
  assert.match(rows, /data-gmsg="m3">[\s\S]*?<div class="bubble-meta"><span>Waits until Coder and Reviewer are free<\/span>/);
  assert.doesNotMatch(rows, /data-take-back/);
  assert.equal(p.ctx.waitsLine({ waitsFor: ['coder', 'reviewer', 'writer'] }), 'Waits until Coder, Reviewer and Issue Writer are free');
  assert.equal(p.ctx.waitsLine({ waitsFor: [] }), '');
  // "Take back" removes it and puts its text and files into the message box.
  const back = [];
  const form = { _takeBack: (text, files) => back.push([text, files.map((f) => f.name)]) };
  p.doc['#view-group form'] = form;
  p.doc['#view-group'] = { dataset: { group: 'g1' } };
  await p.ctx.takeBackInGroup('g1', 'm2', { disabled: false });
  assert.deepEqual(p.said.calls[0], ['DELETE', '/group-chats/g1/messages/m2']);
  assert.deepEqual(back, [['@Coder also bump the version.', ['notes.txt']]]);
  assert.equal(c.items.has('m2'), false);
  // Its turn came first: the line above the box says so, and the chat is read again.
  const late = page({ reply: async (path, opts) => (opts.method === 'DELETE' ? refused('It has already started.', 409) : { items: [] }) });
  late.chat([waits]);
  late.doc['#view-group form'] = {};
  late.doc['#view-group'] = { dataset: { group: 'g1' } };
  const button = { disabled: false };
  await late.ctx.takeBackInGroup('g1', 'm2', button);
  assert.deepEqual(late.said.notes, ['It has already started.']);
  assert.deepEqual(late.said.toasts, []);
  assert.deepEqual(late.said.calls.map((x) => x.slice(0, 2)), [['DELETE', '/group-chats/g1/messages/m2'], ['GET', '/group-chats/g1/chat?limit=50']]);
});

test('web: while Claude is signed out a message that has not started waits for the sign-in, and can be taken back', () => {
  const p = page();
  const m = message('m1', 'All clear?', { next: DEV.members, canTakeBack: true });
  const c = p.chat([m]);
  assert.match(p.ctx.groupThreadHTML(p.group(), c), /data-gmsg="m1"/, 'signed in, it is a message like any: its first turn is about to start');
  p.ctx.signedOut.on = true;
  assert.doesNotMatch(p.ctx.groupThreadHTML(p.group(), c), /data-gmsg="m1"/);
  assert.match(p.ctx.groupTailHTML(p.group(), c), /<span>Waits until Claude is signed in<\/span><button type="button" data-take-back="m1">Take back<\/button>/);
});

test('web: new replies have a "New" line above the first, and opening the group reads it', () => {
  const p = page();
  const c = p.chat([message('m1', 'All clear?'), reply('r1', WRITER, 'Clear.'), reply('r2', CODER, 'Clear here too.', { at: at(3) }), reply('r3', REVIEWER, 'Yes.', { at: at(4) })]);
  const h = p.ctx.groupThreadHTML(p.group(), c, 'r2');
  assert.equal((h.match(/class="new-line"/g) || []).length, 1);
  assert.match(h, /<div class="new-line" style="--c:#1d9e75">New<\/div><div class="bubble-row from-bot g-row" data-reply="r2">/, 'above the first new reply, in its bot\'s colour');
  assert.doesNotMatch(p.ctx.groupThreadHTML(p.group(), c), /new-line/);
  // The group is a chat the page reports as on screen, and its count and line are the server's.
  assert.match(app, /state\.view === 'group' && state\.groupId \? `group:\$\{state\.groupId\}` : null\);/);
  assert.match(app, /kind === 'group' \? groupById\(id\) : state\.chats\.find/);
  assert.match(app, /kind === 'group' \? api\(`\/group-chats\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(app, /const bot = kind === 'bot' \? botById\(id\) : kind === 'group' \? groupById\(id\) : null;/);
  assert.match(src, /const newFirst = newLine\.first\(key\);/);
  // Presence, for apps from before new replies, is told of no group.
  assert.match(app, /body: \{ chat: chat\?\.startsWith\('group:'\) \? null : chat \}/);
  // The line's reply further back than the page holds: read further, once.
  assert.match(src, /if \(newFirst !== null && !chat\.items\.has\(newFirst\) && chat\.more && chat\.want < GROUP_REACH\) loadGroupChat\(g\.id, GROUP_REACH\);/);
});

test("web: a card asked in the group is at the end of its chat with its bot's name, and in Needs you; it is not drawn in that bot's own chat", () => {
  const ask = { ...cards.PERMISSION, groupId: 'g1', groupName: 'Dev' };
  const own = { ...cards.PERMISSION, id: 'p2' };
  const job = { id: 'j1', name: 'Nightly', kind: 'ai', cron: '0 2 * * *', when: 'every night', prompt: 'Build.', enabled: true, approved: false, changedBy: 'bot' };
  const p = cards.page({ state: { asks: [ask, own], bots: [{ ...cards.CODER, jobs: [job] }, cards.MAIL], groups: [{ id: 'g1', name: 'Dev team' }],
    memPending: [{ id: 'mem1', action: 'add', text: 'Uses main.', botId: 'coder', bot: cards.CODER, title: 'Save a note?', groupId: 'g1', groupName: 'Dev' }],
    approvals: { jobs: [{ botId: 'coder', jobId: 'j1', groupId: 'g1', groupName: 'Dev' }], tiles: [] } } });
  const keys = (scope) => cards.plain(p.chatNeeds(scope).map((x) => x.key));
  assert.deepEqual(keys('group:g1'), ['job:j1', 'mem:mem1', 'ask:p1'], 'the cards of the group, whatever kind, at the end of its chat');
  assert.deepEqual(keys('coder'), ['ask:p2'], "the bot's own chat has only its own");
  assert.deepEqual(keys('group:g2'), []);
  assert.deepEqual(keys('chief'), []);
  assert.deepEqual(cards.plain(p.needsItems().map((x) => [x.key, x.group || null])), [['job:j1', { id: 'g1', name: 'Dev team' }], ['mem:mem1', { id: 'g1', name: 'Dev team' }], ['ask:p1', { id: 'g1', name: 'Dev team' }], ['ask:p2', null]], 'all of them are in Needs you; the group\'s name is its name now');
  // In Needs you the card says its bot and the group; in the group's chat its bot.
  assert.match(p.needCardHTML(p.item('ask:p1')), /<div class="need-who"><svg class="fig fig-small"><\/svg>Coder <span class="need-in">in Dev team<\/span><\/div>/);
  assert.match(p.needCardHTML(p.item('ask:p1'), 'group:g1'), /<div class="need-who"><svg class="fig fig-small"><\/svg>Coder<\/div>/);
  assert.match(p.needCardHTML(p.item('ask:p2')), /<div class="need-who"><svg class="fig fig-small"><\/svg>Coder<\/div>/);
  assert.match(css, /\.chat-needs\[data-scope\^="group:"\] \.need-who \{ display: block; \}/, 'which a bot\'s own chat hides');
  // A group that was deleted: the server's name for it, and a card without a group is nobody's but its bot's.
  p.state.groups = [];
  assert.deepEqual(cards.plain(p.item('ask:p1').group), { id: 'g1', name: 'Dev' });
  // The chat puts the cards last, after the end of the chat, and follows when they are read.
  assert.match(src, /drawGroupTail\(g, chat\);\n  updateChatNeeds\(thread, key\);/);
  const g = page();
  g.doc['#group-thread'] = element();
  g.chat([]);
  g.ctx.drawGroupCards();
  assert.deepEqual(g.said.needs, [], 'not while another view is open');
  g.state.view = 'group';
  g.ctx.drawGroupCards();
  assert.deepEqual(g.said.needs, ['group:g1']);
  assert.match(app, /if \(state\.view === 'group'\) drawGroupCards\(\);/);
});

test('web: when the group stopped at the limit the chat says so in the server\'s words, with "Go on"', async () => {
  const went = { ok: true, wentOn: true, messages: [message('m1', 'Keep correcting.', { next: ['coder'] })] };
  const p = page({ reply: async (path, opts) => (opts.method === 'POST' ? went : { items: [] }) });
  const limit = { at: at(9), replies: 12, waits: ['coder'], messages: ['m1'], text: 'The group stopped after 12 replies without you.' };
  const c = p.chat([message('m1', 'Keep correcting.', { atLimit: true, next: ['coder'] }), reply('r1', CODER, 'Corrected.')], { limit });
  const tail = p.ctx.groupTailHTML(p.group(), c);
  // Under it stands the head of the member whose turn waits (who is next, below).
  assert.equal(tail.replace(/<div class="g-next".*$/, ''), '<div class="g-limit" role="status"><span>The group stopped after 12 replies without you.</span><button type="button" class="btn sm" data-go-on>Go on</button></div>');
  assert.equal(p.ctx.groupLimitHTML(null), '');
  assert.match(p.ctx.groupLimitHTML({ text: '<b>12</b>' }), /<span>&lt;b&gt;12&lt;\/b&gt;<\/span>/, 'text, never markup');
  // "Go on" is the group's route; the line goes at once.
  await p.ctx.goOnGroup('g1', { disabled: false });
  assert.deepEqual(p.said.calls[0], ['POST', '/group-chats/g1/go-on']);
  assert.equal(c.limit, null);
  // Typed: the words are no message. Nothing is added to the chat, and the line goes.
  const typed = page({ reply: async (path, opts) => (opts.method === 'POST' ? went : { items: [message('m1', 'Keep correcting.')], limit: null }) });
  const t = typed.chat([message('m1', 'Keep correcting.', { atLimit: true })], { limit });
  await typed.ctx.sendToGroup('g1', 'Go on', [], 'k1');
  assert.deepEqual(typed.said.calls[0], ['POST', '/group-chats/g1/messages', { text: 'Go on', attachments: [], key: 'k1' }]);
  assert.deepEqual([...t.items.keys()], ['m1']);
  assert.equal(t.limit, null);
  // A group that is not stopped any more says so, and the chat is read again.
  const late = page({ reply: async (path, opts) => (opts.method === 'POST' ? refused('The group is not stopped.', 409) : { items: [] }) });
  late.chat([], { limit });
  const button = { disabled: false };
  await late.ctx.goOnGroup('g1', button);
  assert.deepEqual(late.said.toasts, [['The group is not stopped.', true]]);
  assert.equal(late.chat === undefined, false);
  assert.deepEqual(late.said.calls.map((x) => x[1]), ['/group-chats/g1/go-on', '/group-chats/g1/chat?limit=50']);
});

test('web: the owner writes once: the message is sent to the group with its files and its key, and drawn from the server\'s answer', async () => {
  const sent = message('m7', '@Coder which branch?', { to: ['coder'], next: ['coder'], canTakeBack: true });
  const p = page({ reply: async (path, opts) => (opts.method === 'POST' ? sent : { items: [sent, reply('r1', CODER, 'main.')] }) });
  const c = p.chat([]);
  const files = [{ name: 'shot.png', file: 'uploads/shot.png', size: 9, readable: true }];
  await p.ctx.sendToGroup('g1', '@Coder which branch?', files, 'k2');
  assert.deepEqual(p.said.calls, [['POST', '/group-chats/g1/messages', { text: '@Coder which branch?', attachments: files, key: 'k2' }], ['GET', '/group-chats/g1/chat?limit=50']]);
  assert.deepEqual([...c.items.keys()], ['m7', 'r1']);
  // A refusal rejects, for the line above the box, and adds nothing.
  const full = page({ reply: async (path, opts) => (opts.method === 'POST' ? refused('Coder already has 10 of your messages waiting. Take one back, or wait.', 429) : { items: [] }) });
  const f = full.chat([]);
  await assert.rejects(full.ctx.sendToGroup('g1', 'One more', [], 'k3'), /Coder already has 10 of your messages waiting/);
  assert.equal(f.items.size, 0);
  // The answer buttons of the group's open question stand under the reply that asked, and nowhere else.
  const asked = reply('r2', CODER, 'Which branch?', { choices: ['main', 'dark-mode'] });
  const older = reply('r0', REVIEWER, 'Shall I?', { at: at(1), choices: ['Yes', 'No'] });
  const q = page();
  const drawn = q.ctx.groupThreadHTML(q.group(), q.chat([older, asked], { asks: { botId: 'coder', botName: 'Coder', text: 'Which branch?', runId: 'r2', at: at(2) } }));
  assert.deepEqual([...drawn.matchAll(/data-choice="([^"]*)"/g)].map((m) => m[1]), ['main', 'dark-mode']);
  assert.match(src, /wireChoices\(items, \(t, k\) => sendFrom\(form, \(\) => sendToGroup\(g\.id, t, \[\], k\)\)\);/, 'an answer is a message to the group');
});

// ---------- the sent message, there at once (ALV-005; a bot's chat and the Chief's: test/sent-at-once-web.test.js) ----------

// botdot's answer to the message, held back until the test gives it.
function heldSend(rest = { items: [] }) {
  let answer, fail;
  const reply = (path, opts) => (opts.method === 'POST' ? new Promise((resolve, reject) => { answer = resolve; fail = reject; }) : rest);
  return { reply, answer: (x) => answer(x), fail: (e) => fail(e) };
}
const SENT = /<div class="chat-sent"><div class="bubble-row from-me" data-sent><div class="stack mine"><div class="bubble from-me waits">(.*?)<\/div><\/div><\/div><\/div>(<div class="g-working">.*)$/;

test('web: on Send the message and one plain "Working" are in the group before the request answers; the server\'s message takes their place', async () => {
  const taken = message('m7', 'Who can look at this?', { at: at(5), to: ['coder'], next: ['coder'], canTakeBack: true, attachments: [{ name: 'shot.png', file: 'uploads/shot.png', size: 9 }] });
  const h = heldSend({ items: [message('m1', 'Who can look at this?'), taken] });
  const p = page({ reply: h.reply });
  const c = p.chat([message('m1', 'Who can look at this?')]); // the same words, written before: another message
  const files = [{ name: 'shot.png', file: 'uploads/shot.png', size: 9, readable: true }];
  const sending = p.ctx.sendToGroup('g1', 'Who can look at this?', files, 'k1');
  const tail = p.ctx.groupTailHTML(p.group(), c);
  const [, bubble, line] = tail.match(SENT);
  assert.match(bubble, /^Who can look at this\?<div class="bubble-files">.*shot\.png/, 'the owner\'s words and files, faded as a waiting message is');
  assert.equal(line, '<div class="g-working"><div class="status-line" role="status" style="--c:#888780"><i></i><span>Working</span></div></div>', 'one plain "Working", without a name, until the server says who works');
  assert.doesNotMatch(tail, /data-stop-all|data-take-back|Waits until|<b>/);
  assert.deepEqual(plain(p.ctx.ids(c)), ['m1'], 'nothing is added to what the page holds of the server');
  // The feed's `group_message` brings it before the request answers: drawn once.
  p.ctx.holdMessage(c, taken);
  assert.doesNotMatch(p.ctx.groupTailHTML(p.group(), c), /chat-sent|data-sent/);
  c.items.delete('m7');
  assert.match(p.ctx.groupTailHTML(p.group(), c), SENT);
  // The answer: the server's message is held, and the local one is over.
  h.answer(taken);
  await sending;
  assert.deepEqual(plain(p.ctx.ids(c)), ['m1', 'm7']);
  assert.doesNotMatch(p.ctx.groupTailHTML(p.group(), c), /chat-sent|data-sent/);
  assert.match(css, /\.g-items\.empty:has\(~ \.g-tail \.chat-sent\) \{ display: none; \}/, 'in a group with no message yet the members\' picture gives way to it');
});

test('web: with members at work the message stands at the end, under those that wait, and the lines stay the members\'', async () => {
  const h = heldSend();
  const p = page({ reply: h.reply });
  const c = p.chat([message('m1', 'Ship it.'), message('m2', '@Coder also bump the version.', { at: at(3), to: ['coder'], waitsFor: ['coder'], next: ['coder'], canTakeBack: true })],
    { working: [{ botId: 'coder', runId: 'r5', messageId: 'm1', startedAt: at(2) }] });
  p.ctx.sendToGroup('g1', 'And the changelog', [], 'k1').catch(() => {});
  const tail = p.ctx.groupTailHTML(p.group(), c);
  assert.doesNotMatch(tail, /chat-sent/);
  assert.match(tail, /<span><b>Coder<\/b> · Working<\/span><button type="button" data-stop-all>Stop all<\/button>/);
  assert.match(tail, /<div class="chat-queued">.*data-take-back="m2".*<div class="bubble-row from-me" data-sent><div class="stack mine"><div class="bubble from-me waits">And the changelog<\/div><\/div><\/div><\/div>$/s);
  // It did not go: nothing of it stays, and the send rejects for the line above the box.
  const f = heldSend();
  const q = page({ reply: f.reply });
  const d = q.chat([]);
  const failing = q.ctx.sendToGroup('g1', 'One more', [], 'k2');
  assert.match(q.ctx.groupTailHTML(q.group(), d), SENT);
  f.fail(refused('Coder already has 10 of your messages waiting. Take one back, or wait.', 429));
  await assert.rejects(failing, /Coder already has 10/);
  assert.equal(q.ctx.groupTailHTML(q.group(), d), '');
  assert.equal(d.items.size, 0);
});

test('web: "Go on" typed in a group stopped at the limit is no message, and nothing is drawn for it', async () => {
  for (const words of ['Go on', 'go on', ' GO  ON! ', '**Go on**', '"go on."']) assert.equal(page().ctx.isGoOn(words), true, words);
  for (const words of ['Go on with the report', 'Goon', 'on', '']) assert.equal(page().ctx.isGoOn(words), false, words);
  const limit = { at: at(9), replies: 12, waits: ['coder'], messages: ['m1'], text: 'The group stopped after 12 replies without you.' };
  const h = heldSend();
  const p = page({ reply: h.reply });
  const c = p.chat([message('m1', 'Keep correcting.', { atLimit: true })], { limit });
  const sending = p.ctx.sendToGroup('g1', 'Go on', [], 'k1');
  assert.doesNotMatch(p.ctx.groupTailHTML(p.group(), c), /chat-sent|data-sent/);
  h.answer({ wentOn: true, messages: [message('m1', 'Keep correcting.')] });
  await sending;
  // In a group that is not stopped the same words are a message like any other.
  const q = page({ reply: heldSend().reply });
  const d = q.chat([message('m1', 'Keep correcting.')]);
  q.ctx.sendToGroup('g1', 'Go on', [], 'k2');
  assert.match(q.ctx.groupTailHTML(q.group(), d), SENT);
});

test('web: a group with no message yet shows its members and that all of them read what is written there', () => {
  const p = page();
  const h = p.ctx.groupThreadHTML(p.group(), p.chat([]));
  assert.match(h, /^<div class="chat-empty">\s*<div class="group-pic lg n3">/);
  assert.equal(texts(h), 'Dev Coder, Reviewer and Issue Writer. What you write here, all of them read.');
  // A group whose bots are all gone says what to do.
  p.state.groups[0].members = [];
  assert.equal(texts(p.ctx.groupThreadHTML(p.group(), p.chat([]))), 'Dev Its bots are all gone. Add one, or delete the group.');
  // A message that only waits is something: no empty chat beside it.
  p.state.groups[0].members = DEV.members;
  const waits = message('m1', 'Hello', { waitsFor: ['coder'], canTakeBack: true });
  assert.equal(p.ctx.groupThreadHTML(p.group(), p.chat([waits])), '');
});

test('web: the chat is the server\'s: a page of it adds, the newest page says what is gone, and older pages are put before it', async () => {
  const p = page({ reply: async (path) => (path.includes('before=m2') ? { items: [message('m1', 'First', { at: at(0) })], more: false } : {}) });
  const c = p.chat([message('m2', 'Second', { at: at(2) }), reply('r2', CODER, 'Done.', { at: at(3) }), message('m3', 'Third', { at: at(4), canTakeBack: true, waitsFor: ['coder'] })], { more: true });
  assert.equal(c.more, true);
  // The newest page again, without the message that was taken back in another app, and with a new reply.
  p.ctx.takeGroupPage(c, { items: [message('m2', 'Second', { at: at(2) }), reply('r2', CODER, 'Done.', { at: at(3) }), reply('r3', REVIEWER, 'Fine.', { at: at(5) })], more: true });
  assert.deepEqual(plain(p.ctx.ids(c)), ['m2', 'r2', 'r3']);
  // What is no item of a chat is left out.
  p.ctx.takeGroupPage(c, { items: [null, { type: 'reply', id: 'r9' }, { type: 'note', id: 'n1' }, message('m2', 'Second', { at: at(2) }), reply('r2', CODER, 'Done.', { at: at(3) }), reply('r3', REVIEWER, 'Fine.', { at: at(5) })], more: true });
  assert.deepEqual(plain(p.ctx.ids(c)), ['m2', 'r2', 'r3']);
  assert.match(p.ctx.groupThreadHTML(p.group(), c), /^<div class="g-earlier"><button type="button" class="btn sm" data-earlier>Earlier messages<\/button><\/div>/);
  // The page before the oldest: put before it, and nothing more is left.
  p.doc['#group-thread'] = null;
  await p.ctx.loadEarlier({ disabled: false });
  assert.deepEqual(p.said.calls, [['GET', '/group-chats/g1/chat?limit=50&before=m2']]);
  assert.deepEqual(plain(p.ctx.ids(c)), ['m1', 'm2', 'r2', 'r3']);
  assert.equal(c.more, false);
  // The newest page again keeps what older pages brought, and what they said of more.
  p.ctx.takeGroupPage(c, { items: [reply('r2', CODER, 'Done.', { at: at(3) }), reply('r3', REVIEWER, 'Fine.', { at: at(5) })], more: true });
  assert.deepEqual([plain(p.ctx.ids(c)), c.more], [['m1', 'm2', 'r2', 'r3'], false]);
  // A message and a reply of the same moment: the message first, as the server orders them.
  const same = p.chat([reply('r1', CODER, 'Done.', { at: at(1) }), message('m1', 'Go', { at: at(1) })]);
  assert.deepEqual(plain(p.ctx.ids(same)), ['m1', 'r1']);
});

test('web: a message the feed hands over from further back than the page holds is left to the page that reads it', async () => {
  const p = page();
  const heard = {};
  p.doc['#modal'] = { open: false };
  p.ctx.followGroups({ addEventListener: (type, fn) => { (heard[type] ||= []).push(fn); } });
  const c = p.chat([reply('r9', CODER, 'Ninth', { at: at(9) }), reply('r10', REVIEWER, 'Tenth', { at: at(10) })], { more: true });
  const say = (m) => heard.group_message.forEach((fn) => fn({ data: JSON.stringify({ chat: 'group:g1', groupId: 'g1', message: m }) }));
  const old = { id: 'm0', text: 'Keep correcting.', at: at(0), to: ['coder'], waitsFor: [], next: ['coder'], canTakeBack: false };
  say(old);
  assert.deepEqual(plain(p.ctx.ids(c)), ['r9', 'r10'], 'not held alone above replies that are not read: "Earlier messages" still starts from the oldest reply');
  say({ ...old, id: 'm11', at: at(11) });
  assert.deepEqual(plain(p.ctx.ids(c)), ['r9', 'r10', 'm11'], 'a new one is');
  // Once the page holds it, the feed keeps it as it is now; and a chat that is held whole takes any.
  p.ctx.takeGroupPage(c, { items: [{ type: 'message', ...old }], more: false }, true);
  say({ ...old, atLimit: true });
  assert.equal(c.items.get('m0').atLimit, true);
  const whole = p.chat([reply('r9', CODER, 'Ninth', { at: at(9) })]);
  say(old);
  assert.deepEqual(plain(p.ctx.ids(whole)), ['m0', 'r9']);
  assert.equal(p.ctx.holdMessage(whole, null), false);
});

test('web: of two reads of the chat the later answer stands, and a read that fails leaves the one before it', async () => {
  const waiting = [];
  const p = page({ reply: (path) => new Promise((resolve) => waiting.push(resolve)) });
  const first = p.ctx.loadGroupChat('g1');
  const second = p.ctx.loadGroupChat('g1');
  const c = p.ctx.chat();
  waiting[1]({ items: [reply('r2', CODER, 'Newer.')] });
  await second;
  waiting[0]({ items: [reply('r1', CODER, 'Older.')] });
  await first;
  assert.deepEqual(plain(p.ctx.ids(c)), ['r2'], 'an older answer that arrives late changes nothing');
  // The later read fails: the earlier answer, still on its way, is drawn.
  const third = p.ctx.loadGroupChat('g1');
  const fourth = p.ctx.loadGroupChat('g1');
  waiting[3](new Error("Can't reach botdot."));
  await fourth;
  waiting[2]({ items: [reply('r3', CODER, 'Third.')] });
  await third;
  assert.deepEqual(plain(p.ctx.ids(c)), ['r3']);
  // Another group was opened meanwhile: its chat is not the old one's answer.
  const fifth = p.ctx.loadGroupChat('g1');
  p.ctx.open({ id: 'g2', items: new Map(), loaded: false, working: [] });
  waiting[4]({ items: [reply('r5', CODER, 'Fifth.')] });
  await fifth;
  assert.equal(p.ctx.chat().id, 'g2');
  assert.equal(p.ctx.chat().items.size, 0);
});

// ---------- the live feed ----------

test('web: the feed keeps the row and the open chat as the server says them, and a pass shows nothing', () => {
  const p = page({ reply: async () => ({ items: [] }) });
  const c = p.chat([message('m1', 'All clear?')]);
  const heard = {};
  p.doc['#modal'] = { open: false };
  p.ctx.followGroups({ addEventListener: (type, fn) => { (heard[type] ||= []).push(fn); } });
  const say = (type, d) => heard[type].forEach((fn) => fn({ data: JSON.stringify(d) }));
  const g = p.group();
  for (const type of ['groups', 'group_run_started', 'group_run_finished', 'group_message', 'group_message_gone', 'group_asks', 'group_limit', 'group_unread', 'group_opening_line', 'group_run_waits']) assert.ok(heard[type], `the page listens to ${type}`);
  // A turn starts, says its line, and waits for an OK.
  say('group_run_started', { id: 'r1', botId: 'coder', botName: 'Coder', groupId: 'g1', groupMessageId: 'm1', chat: 'group:g1', startedAt: at(2), status: 'running' });
  assert.deepEqual(plain([g.working, c.working.map((w) => [w.botId, w.runId, w.messageId])]), [['coder'], [['coder', 'r1', 'm1']]]);
  say('group_opening_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r1', text: 'Running the tests' });
  assert.deepEqual(plain(p.ctx.groupLine(g)), { who: 'Coder', prev: 'Running the tests…', cls: 'working', after: '' });
  say('group_run_waits', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r1', waitingFor: 'ok' });
  assert.match(p.ctx.groupWorkingHTML(c.working), /class="status-line held"[^>]*><i><\/i><span><b>Coder<\/b> · Waiting for your OK/);
  say('group_run_waits', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r1' });
  assert.match(p.ctx.groupWorkingHTML(c.working), /<b>Coder<\/b> · Running the tests/);
  // It ends: the line goes, and its reply is the row's newest.
  say('group_run_finished', { id: 'r1', botId: 'coder', botName: 'Coder', groupId: 'g1', status: 'success', result: 'Clear here.', endedAt: at(3), notify: false, new: true });
  assert.deepEqual(plain([g.working, c.working, [...p.ctx.turnLines.keys()]]), [[], [], []]);
  assert.deepEqual(plain(p.ctx.groupLine(g)), { who: 'Coder', prev: 'Clear here.', cls: '', after: '' });
  // A pass: no reply, no preview.
  say('group_run_started', { id: 'r2', botId: 'reviewer', groupId: 'g1', startedAt: at(4) });
  say('group_run_finished', { id: 'r2', botId: 'reviewer', botName: 'Reviewer', groupId: 'g1', status: 'success', result: '', passed: true, quiet: true, endedAt: at(5) });
  assert.deepEqual(plain([g.working, g.last.runId]), [[], 'r1']);
  // The owner's message as it is now, and one taken back.
  say('group_message', { chat: 'group:g1', groupId: 'g1', message: { id: 'm2', text: '@Coder more', at: at(6), to: ['coder'], waitsFor: ['coder'], next: ['coder'], canTakeBack: true } });
  assert.deepEqual(plain(c.items.get('m2')).waitsFor, ['coder']);
  assert.equal(c.items.get('m2').type, 'message');
  say('group_message_gone', { chat: 'group:g1', groupId: 'g1', id: 'm2' });
  assert.equal(c.items.has('m2'), false);
  // The open question, the stopped line and the new replies.
  const asks = { botId: 'coder', botName: 'Coder', text: 'Which branch?', runId: 'r1', at: at(3) };
  say('group_asks', { chat: 'group:g1', groupId: 'g1', asks });
  assert.deepEqual(plain([g.asks, c.asks]), [asks, asks]);
  say('group_asks', { chat: 'group:g1', groupId: 'g1', asks: null });
  assert.deepEqual([g.asks, c.asks], [null, null]);
  const limit = { at: at(9), replies: 12, waits: ['coder'], messages: ['m1'], text: 'The group stopped after 12 replies without you.' };
  say('group_limit', { chat: 'group:g1', groupId: 'g1', limit });
  assert.deepEqual(plain([g.limit, c.limit]), [limit, limit]);
  say('group_limit', { chat: 'group:g1', groupId: 'g1', limit: null });
  assert.deepEqual([g.limit, c.limit], [null, null]);
  say('group_unread', { chat: 'group:g1', groupId: 'g1', unread: 3, firstUnread: 'r1', readAt: at(1) });
  assert.deepEqual(p.said.unread, [['group:g1', 3]]);
  // What is said of a group the page does not hold, and what is no JSON, changes nothing and throws nothing.
  say('group_run_started', { id: 'r3', botId: 'coder', groupId: 'other' });
  say('group_asks', { groupId: 'other', asks });
  heard.group_limit.forEach((fn) => fn({ data: 'not json' }));
  assert.deepEqual(plain(g.working), []);
  // Nothing of a group rings here: the page has no notification for it.
  assert.doesNotMatch(src, /Notification|\.notify\b/);
  assert.match(app, /if \(state\.feed\) followGroups\(state\.feed\);/);
});

// ---------- a turn's working line (ALV-004; docs/api.md, "The working line") ----------

const NEW = ['groups', 'unread', 'working-line'];
const turnLinesOf = (p, c) => [...p.ctx.groupWorkingHTML(c.working).matchAll(/<span><b>(.*?)<\/b> · (.*?)<\/span>/g)].map((m) => [m[1], m[2]]);
const hearing = (p) => {
  const heard = {};
  p.doc['#modal'] = { open: false };
  p.ctx.followGroups({ addEventListener: (type, fn) => { (heard[type] ||= []).push(fn); } });
  return { heard, say: (type, d) => heard[type].forEach((fn) => fn({ data: JSON.stringify(d) })) };
};

test('web: a member\'s line in a group is the server\'s working line: from the chat that is read and from the feed, under the chat and in the row', () => {
  const p = page({ features: NEW });
  const c = p.chat([message('m1', 'Ship it.')], { working: [
    { botId: 'coder', runId: 'r5', messageId: 'm1', startedAt: at(2), openingLine: 'Running the tests', workingLine: 'Reading nytimes.com' },
    { botId: 'reviewer', runId: 'r6', messageId: 'm1', startedAt: at(3) }] });
  assert.deepEqual(turnLinesOf(p, c), [['Coder', 'Reading nytimes.com'], ['Reviewer', 'Working']], 'the line as it reads now, not the opening line');
  const { heard, say } = hearing(p);
  assert.ok(heard.group_working_line, 'the page listens to group_working_line');
  const g = p.group();
  g.working = ['coder', 'reviewer'];
  assert.equal(p.ctx.groupLine(g).prev, 'Reading nytimes.com…', 'the row reads the same');
  // Each change takes the line's place, for that member only.
  const contacts = p.said.contacts;
  say('group_working_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r5', text: 'Running a command' });
  say('group_working_line', { chat: 'group:g1', groupId: 'g1', botId: 'reviewer', runId: 'r6', text: 'Messaging Coder' });
  assert.deepEqual(turnLinesOf(p, c), [['Coder', 'Running a command'], ['Reviewer', 'Messaging Coder']]);
  assert.equal(p.ctx.groupLine(g).prev, 'Running a command…');
  assert.ok(p.said.contacts > contacts, 'the row is drawn again');
  // The opening line, which the server sends as before, never takes the place of a turn's working line.
  say('group_opening_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r5', text: 'Running the tests' });
  assert.deepEqual(turnLinesOf(p, c), [['Coder', 'Running a command'], ['Reviewer', 'Messaging Coder']]);
  // "Waiting for your OK" keeps its words and its place, and the line is back after the answer.
  say('group_run_waits', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r5', waitingFor: 'ok' });
  assert.deepEqual(turnLinesOf(p, c)[0], ['Coder', 'Waiting for your OK']);
  say('group_run_waits', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r5' });
  assert.deepEqual(turnLinesOf(p, c)[0], ['Coder', 'Running a command']);
  // What is no line changes nothing, and the text is never markup.
  for (const bad of [{ groupId: 'g1', botId: 'coder', text: 'x' }, { groupId: 'g1', botId: 'coder', runId: 'r5', text: { no: 'text' } }, { groupId: 'g1', botId: 'coder', runId: 'r5', text: '  ' }]) say('group_working_line', bad);
  assert.deepEqual(turnLinesOf(p, c)[0], ['Coder', 'Running a command']);
  say('group_working_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r5', text: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(p.ctx.groupWorkingHTML(c.working), /<img/);
  // The turn ends: its line goes.
  say('group_run_finished', { id: 'r5', botId: 'coder', botName: 'Coder', groupId: 'g1', status: 'success', result: 'Done.', endedAt: at(4) });
  assert.equal(p.ctx.turnLines.has('r5'), false);
});

test('web: a turn\'s line starts as its opening line, and the member after it has its own', () => {
  const p = page({ features: NEW });
  const c = p.chat([message('m1', 'Ship it.')]);
  const { say } = hearing(p);
  say('group_run_started', { id: 'r1', botId: 'coder', botName: 'Coder', groupId: 'g1', groupMessageId: 'm1', chat: 'group:g1', startedAt: at(2), status: 'running' });
  assert.deepEqual(turnLinesOf(p, c), [['Coder', 'Working']]);
  say('group_opening_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r1', text: 'Reading the diff' });
  say('group_working_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r1', text: 'Reading the diff' });
  assert.deepEqual(turnLinesOf(p, c), [['Coder', 'Reading the diff']]);
  say('group_working_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r1', text: 'Reading a.js' });
  say('group_run_finished', { id: 'r1', botId: 'coder', botName: 'Coder', groupId: 'g1', status: 'success', result: 'Done.', endedAt: at(3) });
  say('group_run_started', { id: 'r2', botId: 'reviewer', botName: 'Reviewer', groupId: 'g1', groupMessageId: 'm1', chat: 'group:g1', startedAt: at(4), status: 'running' });
  assert.deepEqual(turnLinesOf(p, c), [['Reviewer', 'Working']], 'not the line of the member before it');
  say('group_working_line', { chat: 'group:g1', groupId: 'g1', botId: 'reviewer', runId: 'r2', text: 'Looking through its files' });
  assert.deepEqual(turnLinesOf(p, c), [['Reviewer', 'Looking through its files']]);
  assert.deepEqual(plain(p.ctx.groupLine(p.group())), { who: 'Reviewer', prev: 'Looking through its files…', cls: 'working', after: '' });
});

test('web: old and new: against a server without the working line, and one that sends a turn none, a member\'s line is its opening line as before', () => {
  // A server from before the working line: whatever came under those names is not read.
  const old = page();
  const c = old.chat([message('m1', 'Ship it.')], { working: [{ botId: 'coder', runId: 'r5', messageId: 'm1', startedAt: at(2), openingLine: 'Running the tests', workingLine: 'NOT READ' }] });
  assert.deepEqual(turnLinesOf(old, c), [['Coder', 'Running the tests']]);
  const o = hearing(old);
  o.say('group_working_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r5', text: 'NOT READ' });
  assert.deepEqual(turnLinesOf(old, c), [['Coder', 'Running the tests']]);
  o.say('group_opening_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r5', text: 'Reading the diff' });
  assert.deepEqual(turnLinesOf(old, c), [['Coder', 'Reading the diff']]);
  // A server with the working line for a bot's own run only: a turn has its opening line.
  const mid = page({ features: NEW });
  const m = mid.chat([message('m1', 'Ship it.')], { working: [{ botId: 'coder', runId: 'r5', messageId: 'm1', startedAt: at(2), openingLine: 'Running the tests' }] });
  assert.deepEqual(turnLinesOf(mid, m), [['Coder', 'Running the tests']]);
  hearing(mid).say('group_opening_line', { chat: 'group:g1', groupId: 'g1', botId: 'coder', runId: 'r5', text: 'Reading the diff' });
  assert.deepEqual(turnLinesOf(mid, m), [['Coder', 'Reading the diff']]);
  // The page has no words of its own for a step of a turn.
  assert.doesNotMatch(src, /stepText|activityFor|tool_use/);
});

// ---------- who is next (ALV-007; docs/api.md, "A group's chat": a message's `next`) ----------
// The same rule as Android's (Groups.next, GroupNextTest), case for case: the messages are a group chat's, oldest
// first, and the members at work are its `working`.

const line = (id, next = [], more = {}) => message(id, id, { at: at(Number(id.slice(1))), next, ...more });
const works = (botId, messageId) => ({ botId, runId: `run-${botId}`, ...(messageId ? { messageId } : {}) });
const nextOf = (p, messages, working = []) => plain(p.ctx.groupNext(messages, working));
// The row under the working lines: its accessible name, and whose heads stand in it, in order.
const rowOf = (h) => [...h.matchAll(/<div class="g-next" role="img" aria-label="([^"]*)">(.*?)<\/div>/g)].map((m) => [m[1], [...m[2].matchAll(/data-bot="(\w+)"/g)].map((x) => x[1])]);

test('web: while a member works the members to come stand in the server\'s order', () => {
  const p = page();
  assert.deepEqual(nextOf(p, [line('m1', ['writer', 'reviewer'])], [works('coder', 'm1')]), ['writer', 'reviewer']);
});

test('web: between two turns the members to come still stand', () => {
  const p = page();
  assert.deepEqual(nextOf(p, [line('m1', ['reviewer', 'writer'])], []), ['reviewer', 'writer']);
});

test('web: only what the server\'s `next` holds is drawn', () => {
  const p = page();
  // The writer passed, is paused or was deleted: the server's `next` no longer has it, whoever the message was for.
  assert.deepEqual(nextOf(p, [line('m1', ['reviewer'])], [works('coder', 'm1')]), ['reviewer']);
  // A member a reply handed the work on to is there once the server lists it, also one that replied already.
  assert.deepEqual(nextOf(p, [line('m1', ['reviewer', 'coder'])], [works('writer', 'm1')]), ['reviewer', 'coder']);
});

test('web: of two messages the one whose turns are running is shown', () => {
  const p = page();
  const first = line('m1', ['reviewer', 'writer']);
  const second = line('m2', ['coder', 'reviewer', 'writer']);
  assert.deepEqual(nextOf(p, [first, second], [works('coder', 'm1')]), ['reviewer', 'writer'], "the older one runs: its row, not the newer one's");
  assert.deepEqual(nextOf(p, [first, second], [works('coder', 'm2')]), ['coder', 'reviewer', 'writer']);
  // The running one's last turn is at work: nothing is to come after that line, whatever another message waits for.
  assert.deepEqual(nextOf(p, [line('m1'), second], [works('writer', 'm1')]), []);
});

test('web: of two messages that run the newest with members to come is shown', () => {
  const p = page();
  const first = line('m1', ['writer']);
  const both = [works('coder', 'm1'), works('writer', 'm2')];
  assert.deepEqual(nextOf(p, [first, line('m2', ['reviewer'])], both), ['reviewer']);
  assert.deepEqual(nextOf(p, [first, line('m2')], both), ['writer'], 'the newer one is at its last turn');
});

test('web: when none runs the newest with members to come is shown', () => {
  const p = page();
  const first = line('m1', ['writer']);
  assert.deepEqual(nextOf(p, [first, line('m2', ['coder', 'reviewer'])], []), ['coder', 'reviewer']);
  assert.deepEqual(nextOf(p, [first, line('m2')], []), ['writer'], 'the newer one is over');
});

test('web: no heads when `next` is empty, after the last turn and after "Stop all"', () => {
  const p = page();
  assert.deepEqual(nextOf(p, [], []), []);
  assert.deepEqual(nextOf(p, [line('m1')], [works('writer', 'm1')]), [], 'the last turn is at work');
  assert.deepEqual(nextOf(p, [line('m1')], []), [], 'the last turn ended');
  // "Stop all": the server empties the line. A stopped message is shown nothing of, whatever it still carries.
  assert.deepEqual(nextOf(p, [line('m1', [], { stopped: true })], []), []);
  assert.deepEqual(nextOf(p, [line('m1', ['writer'], { stopped: true })], []), []);
  assert.deepEqual(nextOf(p, [line('m0', ['writer']), line('m1', [], { stopped: true })], [works('coder', 'm1')]), [], "an older line is not shown in its place while the stopped one's run ends");
  // A message from a server that sent no `next`, or something else under that name: nobody.
  const bare = line('m1');
  delete bare.next;
  assert.deepEqual(nextOf(p, [bare, line('m2', 'writer')], []), []);
});

test('web: a member at work whose message is not held shows nothing of another', () => {
  const p = page();
  // The chat holds its newest page: a turn of a message further back is at work, and says nothing of this one.
  assert.deepEqual(nextOf(p, [line('m2', ['writer'])], [works('coder', 'm1')]), []);
  assert.deepEqual(nextOf(p, [line('m2', ['writer'])], [works('coder', null)]), []);
});

test('web: the heads are the bots the page knows, in the server\'s order', () => {
  const p = page();
  assert.deepEqual(plain(p.ctx.groupHeads(['writer', 'gone', 'coder'])).map((b) => b.id), ['writer', 'coder']);
  assert.deepEqual(plain(p.ctx.groupHeads([])), []);
  assert.deepEqual(plain(p.ctx.groupHeads(undefined)), []);
});

test('web: the heads stand directly under the working lines and above the waiting messages: small, still, no words and no digits', () => {
  const p = page();
  const c = p.chat([line('m1', ['writer', 'reviewer']), line('m2', ['coder'], { waitsFor: ['coder'], canTakeBack: true })], { working: [works('coder', 'm1')] });
  const h = p.ctx.groupTailHTML(p.group(), c);
  assert.deepEqual(rowOf(h), [['Next: Issue Writer and Reviewer', ['writer', 'reviewer']]], 'one row, of the message whose turn runs');
  assert.match(h, /data-stop-all>Stop all<\/button><\/div><\/div><div class="g-next"/, 'directly under the working lines');
  assert.ok(h.indexOf('class="g-next"') < h.indexOf('class="chat-queued"'), 'above the waiting messages');
  const row = h.match(/<div class="g-next"[^>]*>(.*?)<\/div>/)[1];
  assert.equal(texts(row), '', 'no words and no digits');
  assert.deepEqual([...row.matchAll(/<i>(<svg class="fig fig-small"[^>]*data-c="(#\w+)"><\/svg>)<\/i>/g)].map((m) => m[2]), [WRITER.color, REVIEWER.color], "the page's small figure, each in its bot's colour");
  assert.doesNotMatch(row, /<button|<a |tabindex|data-st=/, 'no control, and no face of a state');
  assert.equal(p.ctx.groupNextHTML(c).includes('Issue Writer, Reviewer'), false);
  // They never move.
  const rules = [...css.matchAll(/^(\.g-[^{]*\.?g-next[^{]*|\.g-next[^{]*)\{([^}]*)\}/gm)];
  assert.ok(rules.length, 'the row has its rules');
  for (const [, sel, body] of rules) assert.doesNotMatch(body, /animation|transition|transform/, `${sel.trim()} moves nothing`);
  // One head says its one name; three are listed as names are everywhere.
  c.items.get('m1').next = ['reviewer'];
  assert.deepEqual(rowOf(p.ctx.groupNextHTML(c)), [['Next: Reviewer', ['reviewer']]]);
  c.items.get('m1').next = ['reviewer', 'writer', 'coder'];
  assert.deepEqual(rowOf(p.ctx.groupNextHTML(c)), [['Next: Reviewer, Issue Writer and Coder', ['reviewer', 'writer', 'coder']]]);
  // A bot the page does not know has no head and no name; when none of them is known there is no row.
  c.items.get('m1').next = ['gone', 'reviewer'];
  assert.deepEqual(rowOf(p.ctx.groupNextHTML(c)), [['Next: Reviewer', ['reviewer']]]);
  c.items.get('m1').next = ['gone'];
  assert.equal(p.ctx.groupNextHTML(c), '');
});

test('web: the heads follow the feed: there while a member works and between two turns, a member handed to appears, and none is left at the end', () => {
  const p = page({ reply: async () => new Error('away') });
  const c = p.chat([reply('r0', CODER, 'Earlier.', { at: at(0) })]);
  const { say } = hearing(p);
  const row = () => rowOf(p.ctx.groupTailHTML(p.group(), c)).map((r) => r[1]);
  const said = (next, more = {}) => say('group_message', { chat: 'group:g1', groupId: 'g1', message: { id: 'm1', text: 'Ship it.', at: at(1), to: DEV.members, waitsFor: [], next, canTakeBack: false, ...more } });
  const starts = (id, botId) => say('group_run_started', { id, botId, groupId: 'g1', groupMessageId: 'm1', chat: 'group:g1', startedAt: at(2), status: 'running' });
  const ends = (id, botId, more = {}) => say('group_run_finished', { id, botId, botName: botId, groupId: 'g1', status: 'success', result: 'Done.', endedAt: at(3), ...more });
  assert.deepEqual(row(), [], 'nothing before the owner wrote');
  said(['reviewer', 'writer']);
  starts('r1', 'coder');
  assert.deepEqual(row(), [['reviewer', 'writer']], 'while the first member works');
  ends('r1', 'coder');
  assert.equal(p.ctx.groupWorkingHTML(c.working), '', 'no member works');
  assert.deepEqual(row(), [['reviewer', 'writer']], 'between two turns the place is not blank');
  said(['writer']);
  starts('r2', 'reviewer');
  assert.deepEqual(row(), [['writer']]);
  // The reviewer's reply names the coder: it is there once the server lists it. Then the writer passes.
  said(['writer', 'coder']);
  ends('r2', 'reviewer');
  assert.deepEqual(row(), [['writer', 'coder']]);
  said(['coder']);
  starts('r3', 'writer');
  ends('r3', 'writer', { passed: true, result: '' });
  assert.deepEqual(row(), [['coder']], 'a member that passed is not among them');
  said([]);
  starts('r4', 'coder');
  assert.deepEqual(row(), [], 'the last turn is at work');
  ends('r4', 'coder');
  assert.deepEqual(row(), [], 'after the last turn');
  assert.doesNotMatch(p.ctx.groupTailHTML(p.group(), c), /g-next/);
});

test('web: after "Stop all" no head is left, and a line stopped at the limit shows its waiting members under "Go on"', () => {
  const p = page();
  const c = p.chat([line('m1', ['reviewer', 'writer'])], { working: [works('coder', 'm1')] });
  assert.deepEqual(rowOf(p.ctx.groupTailHTML(p.group(), c)).map((r) => r[1]), [['reviewer', 'writer']]);
  // "Stop all": the chat is read again, the run has ended and the message is stopped.
  p.ctx.takeGroupPage(c, { items: [line('m1', [], { stopped: true })], working: [] });
  assert.doesNotMatch(p.ctx.groupTailHTML(p.group(), c), /g-next/);
  // The limit: nothing runs, and the turns that wait are the message's `next`.
  const limit = { at: at(9), replies: 12, waits: ['writer'], messages: ['m2'], text: 'The group stopped after 12 replies without you.' };
  p.ctx.takeGroupPage(c, { items: [line('m1', [], { stopped: true }), line('m2', ['writer'], { atLimit: true })], working: [], limit });
  const h = p.ctx.groupTailHTML(p.group(), c);
  assert.deepEqual(rowOf(h), [['Next: Issue Writer', ['writer']]]);
  assert.ok(h.indexOf('data-go-on') < h.indexOf('class="g-next"'), 'under the line with "Go on"');
});

test('web: while the owner\'s message is on its way the heads of an earlier line stand under the plain "Working"', async () => {
  const h = heldSend({ items: [line('m1', ['writer'])] });
  const p = page({ reply: h.reply });
  const c = p.chat([line('m1', ['writer'])]);
  const sending = p.ctx.sendToGroup('g1', 'And the docs?', [], 'k1');
  const tail = p.ctx.groupTailHTML(p.group(), c);
  assert.match(tail, /<div class="chat-sent">/);
  assert.deepEqual(rowOf(tail), [['Next: Issue Writer', ['writer']]]);
  assert.match(tail, /<span>Working<\/span><\/div><\/div><div class="g-next"/, 'directly under the line');
  h.answer(line('m1', ['writer']));
  await sending;
});

// ---------- a reply arrives (ALV-008) ----------
// Which replies count as new, and the owner's own message: the rule and its cases are in
// test/reply-arrives-web.test.js. Here, what a group's chat tells it and which of its rows are marked.

// The group's chat on screen, with rows that can be marked: one stand-in for each reply's row and for the owner's
// message on its way, another one each time the markup they stand in is built again. With motion allowed.
function arrivingView(p) {
  const view = chatView(p);
  p.ctx.reducedMotion = () => false;
  for (const el of [view.thread, view.items, view.tail]) el.getClientRects = () => [{}];
  const rows = (box, pick) => {
    let html = '', made = new Map();
    Object.defineProperty(box, 'innerHTML', { get: () => html, set(v) { html = v; made = new Map(); } });
    box.querySelector = (sel) => { const key = pick(sel, html); if (!key) return null; if (!made.has(key)) made.set(key, element()); return made.get(key); };
    return (key) => made.get(key)?.classList.contains('arrives') ?? null;
  };
  const reply = rows(view.items, (sel, html) => { const id = (sel.match(/^\[data-reply="(\w+)"\]$/) || [])[1]; return id && html.includes(`data-reply="${id}"`) ? id : null; });
  const sent = rows(view.tail, (sel, html) => (sel === '[data-sent]' && html.includes('data-sent') ? 'sent' : null));
  return { ...view, reply, sent: () => sent('sent') };
}

test('web: a group\'s replies are its turns, oldest first, and never the owner\'s messages', () => {
  const p = page();
  const c = p.chat([reply('t2', REVIEWER, 'Looks right.', { at: at(4), status: 'stopped' }), message('m1', 'Hi all'), reply('t1', CODER, 'On it.', { at: at(3) })]);
  assert.deepEqual(plain(vm.runInContext('groupReplyIds', p.ctx)(c)), ['t1', 't2']);
});

test('web: in a group a reply whose turn is new in the open chat arrives, once, under its bot\'s name: none on opening, none when the chat is drawn again', () => {
  const p = page();
  const view = arrivingView(p);
  const c = p.chat([message('m1', 'Hi all'), reply('t1', CODER, 'On it.', { at: at(3) })]);
  p.ctx.renderGroupChat();
  assert.equal(view.reply('t1'), null, 'the chat opens: its replies stand, and none was even looked for');
  // The next member's reply comes with the feed: the chat is drawn again, and that row alone is marked.
  c.items.set('t2', reply('t2', REVIEWER, 'Looks right.', { at: at(4) }));
  p.ctx.renderGroupChat();
  assert.deepEqual([view.reply('t1'), view.reply('t2')], [null, true], 'the whole reply row moves; the one before it stands');
  // The lists are read again and nothing changed: the row is not drawn a second time.
  p.ctx.renderGroupChat();
  assert.equal(view.reply('t2'), true, 'the same row, with its one movement');
  // The group was renamed, and the chat's markup is built again: the same turns, and none arrives.
  p.group().name = 'Dev team';
  p.ctx.renderGroupChat();
  assert.match(view.items.innerHTML, /data-reply="t2"/);
  assert.deepEqual([view.reply('t1'), view.reply('t2')], [null, null]);
  // Two that came together both arrive.
  c.items.set('t3', reply('t3', WRITER, 'Filed.', { at: at(5) }));
  c.items.set('t4', reply('t4', CODER, 'Done.', { at: at(6) }));
  p.ctx.renderGroupChat();
  assert.deepEqual([view.reply('t2'), view.reply('t3'), view.reply('t4')], [null, true, true]);
});

test('web: older messages loaded above a group\'s chat do not arrive, and a group that is not on screen marks nothing', () => {
  const p = page();
  const view = arrivingView(p);
  const c = p.chat([reply('t5', CODER, 'Five', { at: at(5) })]);
  p.ctx.renderGroupChat();
  c.items.set('t1', reply('t1', CODER, 'One', { at: at(1) })); // "Earlier messages"
  p.ctx.renderGroupChat();
  assert.deepEqual([view.reply('t1'), view.reply('t5')], [null, null]);
  // The owner is elsewhere while a reply comes: back in the group it stands.
  view.thread.getClientRects = () => [];
  c.items.set('t6', reply('t6', REVIEWER, 'Six', { at: at(6) }));
  p.ctx.renderGroupChat();
  view.thread.getClientRects = () => [{}];
  p.ctx.renderGroupChat();
  assert.equal(view.reply('t6'), null);
  c.items.set('t7', reply('t7', WRITER, 'Seven', { at: at(7) }));
  p.ctx.renderGroupChat();
  assert.equal(view.reply('t7'), true);
});

test('web: in a group the owner\'s message arrives on Send, once, and the server\'s message that takes its place does not', async () => {
  const taken = message('m7', 'Who can look at this?', { at: at(5), to: ['coder'], next: ['coder'] });
  const h = heldSend({ items: [message('m1', 'Hi all'), taken] });
  const p = page({ reply: h.reply });
  const view = arrivingView(p);
  const c = p.chat([message('m1', 'Hi all')]);
  p.ctx.renderGroupChat();
  const sending = p.ctx.sendToGroup('g1', 'Who can look at this?', [], 'k1');
  assert.match(view.tail.innerHTML, /<div class="chat-sent"><div class="bubble-row from-me" data-sent>/);
  assert.equal(view.sent(), true, 'the page\'s own bubble moves');
  // A member's line changes under it and the end of the chat is built again: the bubble stands.
  c.limit = { text: 'The group stopped.' };
  p.ctx.renderGroupChat();
  assert.match(view.tail.innerHTML, /data-sent/);
  assert.equal(view.sent(), null, 'drawn again, and not marked');
  c.limit = null;
  // The answer: the server's message stands among the rows, with no mark.
  h.answer(taken);
  await sending;
  assert.doesNotMatch(view.tail.innerHTML, /data-sent/);
  assert.match(view.items.innerHTML, /data-gmsg="m7"/);
  assert.doesNotMatch(view.items.innerHTML + view.tail.innerHTML, /arrives/, 'no mark is written into the markup: a row is marked once it is drawn');
  // A message that was on its way when the group opened stands still.
  const q = page({ reply: heldSend({ items: [] }).reply });
  q.chat([message('m1', 'Hi all')]);
  q.ctx.sendToGroup('g1', 'And this?', [], 'k2');
  const later = arrivingView(q);
  q.ctx.renderGroupChat();
  assert.match(later.tail.innerHTML, /data-sent/);
  assert.equal(later.sent(), null);
});

// ---------- a member's reply as it is written (docs/api.md, "The reply draft") ----------

// The open group's drafts box: its rows by their turn, each with its bubble, as drawGroupDrafts finds and puts them.
function draftsBox() {
  const rows = [];
  const box = {
    rows,
    querySelectorAll: (sel) => (sel === '[data-draft]' ? [...rows] : []),
    querySelector: (sel) => rows.find((r) => sel === `[data-draft="${r.dataset.draft}"]`) || null,
    insertAdjacentHTML(where, html) {
      assert.equal(where, 'beforeend');
      const id = html.match(/data-draft="([^"]+)"/)[1];
      const r = { html, dataset: { draft: id }, bubble: { innerHTML: html.match(/<div class="bubble from-bot draft">([\s\S]*?)<\/div><\/div><\/div>$/)?.[1] ?? '' } };
      r.querySelector = (sel) => (sel === '.draft' ? r.bubble : null);
      r.remove = () => rows.splice(rows.indexOf(r), 1);
      rows.push(r);
    },
  };
  return box;
}
function draftsView(p) {
  const view = chatView(p);
  const box = draftsBox();
  view.thread.querySelector = (sel) => ({ '.g-items': view.items, '.g-tail': view.tail, '.g-drafts': box }[sel] || null);
  const heard = {};
  p.doc['#modal'] = { open: false };
  p.ctx.followGroups({ addEventListener: (type, fn) => { (heard[type] ||= []).push(fn); } });
  const feedSays = (type, d) => heard[type].forEach((fn) => fn({ data: JSON.stringify(d) }));
  const frame = () => p.said.frames.splice(0).forEach((fn) => fn());
  return { ...view, box, feedSays, frame };
}
const working = (runId, bot) => ({ botId: bot.id, runId, messageId: 'm1', startedAt: at(2) });

test('web: from a server with drafts, an open group follows each turn at work and draws its draft under the member\'s name, in place', () => {
  const p = page({ features: ['groups', 'unread', 'reply-draft'], reply: async () => new Promise(() => {}) });
  const v = draftsView(p);
  p.chat([message('m1', '@all anything to add?')], { working: [working('t1', CODER), working('t2', REVIEWER)] });
  p.ctx.renderGroupChat();
  assert.deepEqual(p.said.streams.map((s) => s.url), ['/api/runs/t1/stream?simple', '/api/runs/t2/stream?simple'], 'the turns\' run streams: the feed sends no draft');
  const say = (i, ev) => p.said.streams[i].onmessage({ data: JSON.stringify(ev) });
  say(0, { type: 'start', run: {} });
  say(0, { type: 'reply_draft', text: 'The tests\nare green' });
  assert.equal(v.box.rows.length, 0, 'not before the frame');
  v.frame();
  assert.equal(v.box.rows.length, 1);
  const [row] = v.box.rows;
  assert.match(row.html, /^<div class="bubble-row from-bot g-row" data-draft="t1">/);
  assert.match(row.html, /<div class="g-name" style="--c:[^"]+">Coder<\/div><div class="bubble from-bot draft"><div class="md"><p>The tests\nare green<\/p><\/div><\/div>/);
  say(0, { type: 'reply_draft', text: 'The tests\nare green, all 40' });
  v.frame();
  assert.deepEqual([v.box.rows.length, v.box.rows[0]], [1, row], 'the same row: it grows in place, never a second one');
  assert.equal(row.bubble.innerHTML, '<div class="md"><p>The tests\nare green, all 40</p></div>');
  // The reply comes: its turn ends, and the draft stands until the reply is among the replies.
  v.feedSays('group_run_finished', { id: 't1', groupId: 'g1', botId: CODER.id, status: 'success', result: 'The tests are green, all 40.' });
  v.frame();
  assert.equal(p.said.streams[0].closed, true);
  assert.equal(v.box.rows.length, 1, 'no blank between the draft and its reply');
  p.ctx.takeGroupPage(p.ctx.chat(), { items: [message('m1', '@all anything to add?'), reply('t1', CODER, 'The tests are green, all 40.')], working: [working('t2', REVIEWER)] });
  p.ctx.renderGroupChat();
  v.frame();
  assert.equal(v.box.rows.length, 0, 'the reply took its place');
  assert.equal(p.ctx.replyDrafts.of('t1'), '');
});

test('web: a group turn that passes leaves no bubble and nothing in the room, and a group that is left closes its streams', () => {
  const p = page({ features: ['groups', 'unread', 'reply-draft'], reply: async () => new Promise(() => {}) });
  const v = draftsView(p);
  p.chat([message('m1', '@all anything to add?')], { working: [working('t1', CODER), working('t2', REVIEWER)] });
  p.ctx.renderGroupChat();
  // The server sends no draft of a pass; one that was drawn before it ended goes with the pass all the same.
  p.ctx.replyDrafts.say('t1', 'A long line that was not the pass after all, or so it looked\nfor a while');
  v.feedSays('group_run_finished', { id: 't1', groupId: 'g1', botId: CODER.id, status: 'success', passed: true, result: '' });
  v.frame();
  assert.deepEqual([v.box.rows.length, p.ctx.replyDrafts.of('t1'), p.said.streams[0].closed], [0, '', true]);
  assert.doesNotMatch(v.items.innerHTML, /data-reply="t1"/, 'nothing new in the room');
  // Another chat opens (show): every stream of the group closes, and its drafts go.
  p.ctx.replyDrafts.say('t2', 'Reviewing\nthe change');
  p.state.view = 'bot';
  p.ctx.followGroupDrafts(null);
  assert.equal(p.said.streams.every((s) => s.closed), true);
  assert.equal(p.ctx.replyDrafts.of('t2'), '');
  assert.match(app, /if \(v !== 'group'\) followGroupDrafts\(null\);/, 'show() does so for any view but a group');
});

test('web: against a server without reply-draft a group follows no run stream', () => {
  const p = page();
  draftsView(p);
  p.chat([message('m1', 'Hello')], { working: [working('t1', CODER)] });
  p.ctx.renderGroupChat();
  assert.deepEqual(p.said.streams, []);
});
