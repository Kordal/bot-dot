// The keypad on the web page (#495, ADR 029): the part of public/app.js that draws it and takes its keys, cut out
// and run against stand-ins with what a botdot server sends, beside the list's own state line (contactLine) and a
// group's (groups.js). And the stylesheet: a wide window shows the keypad and one chat, a narrower one the list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const Motion = require('../public/motion.js');
const { read, cut, esc, element, words } = require('./web-page');
const { rulesAt, winner } = require('./css-rules');

const css = read('style.css');
const html = read('index.html');
const groupsSrc = read('groups.js');
const texts = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// A part of groups.js, from one line of it up to another.
const cutGroups = (from, to) => { const a = groupsSrc.indexOf(from), b = groupsSrc.indexOf(to, a); assert.ok(a >= 0 && b > a, `groups.js has "${from}"`); return groupsSrc.slice(a, b); };

const NEWS = { id: 'news', name: 'News Watcher', color: '#378add', state: 'working', group: 'Home', order: 1, running: true, description: 'Reads the feeds' };
const INBOX = { id: 'inbox', name: 'Inbox Sweeper', color: '#1d9e75', state: 'idle', group: 'Money', order: 1, asks: { text: 'Archive 212 newsletters?' } };
const LIGHTS = { id: 'lights', name: 'Home Lights', color: '#e24b4a', state: 'idle', group: 'Home', order: 2 };
const GARDEN = { id: 'garden', name: 'Garden Log', color: '#ef9f27', state: 'idle', group: 'Home', order: 3, pinned: 1 };
const BOTS = [NEWS, INBOX, LIGHTS, GARDEN];
const EVENING = { id: 'g1', name: 'Evening', members: ['lights', 'news', 'garden', 'inbox'], category: 'Home', pinned: 0, order: 1, working: ['lights'], asks: null, last: null };
const at = (n) => `2026-10-17T08:${String(n).padStart(2, '0')}:00.000Z`;

// Elements whose buttons are found in their HTML: `[data-…]` gives one stand-in per value, the same while it stays.
function holder() {
  const buttons = new Map();
  const el = element({}, {
    querySelectorAll: (sel) => {
      const attr = (sel.match(/^\[data-([\w-]+)\]$/) || [])[1];
      if (!attr) return [];
      return [...el.innerHTML.matchAll(new RegExp(`data-${attr}(?![\\w-])(?:="([^"]*)")?`, 'g'))].map(([, value = '']) => {
        const key = `${attr}=${value}`;
        if (!buttons.has(key)) buttons.set(key, element({}, { dataset: { [attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())]: value }, onclick: null }));
        return buttons.get(key);
      });
    },
  });
  el.click = (attr, value = '') => el.querySelectorAll(`[data-${attr}]`).find((b) => b.dataset[attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())] === value).onclick();
  return el;
}

// The page: its state, the keypad's elements, and what it asked for. shown: whether the stylesheet shows the keypad.
// folded: the list's folded categories, as localStorage holds them ('\u0000' is Other).
function page({ bots = BOTS, groups = [EVENING], runs = [], dash = null, view = 'chief', botId = null, shown = true, features = ['groups'], folded = [] } = {}) {
  const state = { features, bots: JSON.parse(JSON.stringify(bots)), groups: JSON.parse(JSON.stringify(groups)), runs, dash, view, botId, groupId: null, chats: [{ id: 'c1' }] };
  const said = { views: [], chief: [], focused: 0, puts: [], toasts: [], answers: [], opened: [] };
  const lib = vm.createContext({ ...words });
  for (const f of ['unread.js', 'opening-line.js', 'keypad.js']) vm.runInContext(read(f), lib);
  const pad = element({}, { display: shown ? 'flex' : 'none' });
  const doc = { '#keypad': pad, '#kp-board': holder(), '#kp-keys': holder(), '#modal': { open: false },
    '#kp-phone-board': holder(), '#kp-sections': holder(), '#kp-chief': holder(), '#kp-needs': holder(), '#kp-phone-needs': holder(),
    '#contact-search': element({}, { focus: () => said.focused++, select() {} }) };
  const ctx = vm.createContext({
    Motion, state, esc, ...words, JSON, Unread: lib.Unread, OpeningLine: lib.OpeningLine, Keypad: lib.Keypad, openingLines: lib.OpeningLine.keeper(),
    Figure: { svg: (st, color) => `<svg class="fig" data-st="${st}" data-c="${color}"></svg>` },
    botFigure: (color, st = 'idle') => `<div class="avatar head" data-st="${st}" data-c="${color}"></div>`,
    tintOf: (c) => c || '#888', CHIEF_COLOR: '#d85a30', chiefFigure: () => '<div class="avatar head chief"></div>', outfitOf: () => null,
    answerNeed: (x, yes) => said.answers.push([x.key, yes]),
    setView: (v, sub) => said.views.push([v, sub]), openChiefChat: (id) => said.chief.push(id),
    api: async (path, { method, body }) => { said.puts.push([method, path, JSON.parse(JSON.stringify(body))]); return {}; }, toast: (t) => said.toasts.push(t), refresh: () => {},
    localStorage: (() => { const m = new Map([['botdot.groups.folded', JSON.stringify(folded)]]); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; })(),
    getComputedStyle: (el) => ({ display: el.display }), requestAnimationFrame: (f) => f(), setTimeout: (f) => f(),
    $: (sel) => doc[sel] ?? null, $$: (sel, root) => (root ? root.querySelectorAll(sel) : []),
  });
  vm.runInContext(`const CHIEF_BOT = { id: 'chief', name: 'Chief of Staff' };
    ${cut("// ---------- the Chief's name", "// ---------- end of the Chief's name")}
    ${cut('const plain = (t) =>', '// ---------- the list\'s width ----------')}
    ${cut('function contactLine(b, r, working)', 'function drawContacts() {')}
    ${cut('// ---------- the keypad', '// ---------- search in every chat ----------')}
    ${cut('function foldedGroups()', '// Drag a bot or a group anywhere')}
    ${cut('// Unpinned ones get a place in their group back', '// Chips for picking')}
    ${cut('function shortTime(iso)', '// When a message in a chat was sent')}
    ${cut('// ---------- the block kit ----------', "// A chart's series as it draws them")}
    const needLine = (x) => x.line || '';
    ${cut('// The bots something waits for', '// The banner: one small head')}
    const renderContacts = () => drawKeypad();
    ${cut('// The tiles of the Board', '// The strip at the top of the list')}
    const botById = (id) => state.bots.find((x) => x.id === id);
    ${cutGroups('const groupMembers = ', '// Every group, each with')}
    ${cutGroups('const memberName = ', '// The line of each member at work')}
    ${cutGroups('const turnLines = new Map();', '// ---------- the list ----------')}
    ${cutGroups('// The picture of a group:', '// What the picture is drawn from')}
    ${cutGroups('// A group\'s row in the list: the line under its name', 'function groupContactHTML(g) {')}
    ${cutGroups('// A group\'s place in a category is counted', '// What the search box finds a group by')}
    ${cutGroups('// A group dragged in the list', '// ---------- making and changing a group')}
    Object.assign(this, { drawKeypad, drawKeypadNeeds, onKeypadKey, sayTurnLine, shortTime });`, ctx);
  ctx.drawKeypad();
  // A key pressed with the page's focus on `target` (the page itself unless said).
  const key = (k, more = {}) => {
    const e = { key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: { matches: () => false, isContentEditable: false }, defaultPrevented: false, prevented: false, preventDefault() { e.prevented = true; }, ...more };
    ctx.onKeypadKey(e);
    return e.prevented;
  };
  return { ctx, state, said, doc, key, keys: () => doc['#kp-keys'].innerHTML, board: () => doc['#kp-board'].innerHTML,
    sections: () => doc['#kp-sections'].innerHTML, phoneBoard: () => doc['#kp-phone-board'].innerHTML, chief: () => doc['#kp-chief'].innerHTML };
}
// A key's status line (#664): [kind, the status's words (its title), what it shows], or null for none.
const dotOf = (key) => { const m = key.match(/<span class="key-st (\w+)" title="([^"]*)"><span>([^<]*)<\/span><\/span>/); return m && [m[1], m[2], m[3]]; };
// The keys drawn: "digit name", in order, across the pages; the digit from its title (none past nine). Its status line
// is read by dotOf.
const noState = (inner) => inner.replace(/<span class="key-st [\s\S]*?<\/span><\/span>/, '');
const keysOf = (h) => [...h.matchAll(/<button class="key[^"]*" data-key="\d+"[^>]*? title="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].map(([, title, inner]) => texts(`${(title.match(/ · (\d)$/) || [])[1] || ''} ${noState(inner)}`));
// A category's heading: [name, the dot's colour or ''] (#635: no count; Pinned has none).
const headOf = (inner) => { const m = inner.match(/>([^<]*)(?:<span class="chev closed">▾<\/span>)?(?:<i class="kp-dot" style="--c:([^"]*)"><\/i>)?(?:<i class="kp-busy"><\/i>)?<\/button>$/); return [m[1], m[2] || '']; };
const headsOf = (h) => [...h.matchAll(/<h3 class="kp-page-head" data-page="\d+">([\s\S]*?)<\/h3>/g)].map((m) => headOf(m[1]));
// The keys of page `n` (0: the top row): "digit name line".
const pageKeysOf = (h, n) => keysOf(h.split(/<section class="kp-page[^"]*"[^>]*>/)[n + 1] || '');
// One key by its bot's name.
const keyNamed = (h, name) => h.match(new RegExp(`<button class="key[^"]*" data-(?:section-)?key="[\\d.]+"[^>]*title="${name}(?: · \\d)?"[^>]*>[\\s\\S]*?</button>`))[0];

// ---------- what a key shows ----------

test('web: the keypad shows the top row, then every category, its keys numbered across the pages (#508, #635)', () => {
  const p = page();
  assert.deepEqual(headsOf(p.keys()), [['Home', ''], ['Money', '']], 'a category is its plain name; no count, no Pinned heading');
  assert.deepEqual(pageKeysOf(p.keys(), 0), ['1 Garden Log'], 'a head and a name, nothing under it');
  assert.deepEqual(pageKeysOf(p.keys(), 1), ['2 News Watcher', '3 Home Lights', '4 Evening']);
  assert.deepEqual(pageKeysOf(p.keys(), 2), ['5 Inbox Sweeper'], 'its question is in Needs you, not on its key');
  assert.match(p.keys(), /<div class="avatar head" data-st="idle" data-c="#ef9f27"><\/div>/, 'its head, in its colour and state');
  assert.match(p.keys(), /<section class="kp-page kp-pinned" data-page="0" aria-label="Pinned"><div class="kp-page-keys"><button class="key key-chief/, 'the top row first');
  assert.match(p.keys(), /<\/section><div class="kp-cats"><section class="kp-page">/, 'the categories in one box, side by side where they fit');
  assert.doesNotMatch(p.keys(), /key-n|key-ask|kit-pill|key-time|key-run|No messages yet/, 'no digit on its face, no extra key, no pill, no time, no filler line');
});

test('web: a key\'s digit is in its title and its keyboard shortcut', () => {
  const p = page();
  assert.match(keyNamed(p.keys(), 'Home Lights'), /title="Home Lights · 3" aria-keyshortcuts="3"/);
  assert.match(p.keys(), /data-key-chief title="Chief of Staff · Esc" aria-keyshortcuts="Escape"/);
});

test('web: a working bot\'s status line is its opening line; a group\'s says which member works on what (#664)', () => {
  const p = page({ runs: [{ id: 'r1', botId: 'lights', status: 'success', result: 'Off at 23:30', startedAt: at(1) }] });
  assert.deepEqual(dotOf(keyNamed(p.keys(), 'News Watcher')), ['working', 'Working', 'Working'], 'working without a line yet');
  p.ctx.openingLines.sync([{ chat: 'bot:news', runId: 'r9', text: 'Reading 14 feeds' }]);
  p.ctx.drawKeypad();
  assert.deepEqual(dotOf(keyNamed(p.keys(), 'News Watcher')), ['working', 'Working', 'Reading 14 feeds…']);
  assert.deepEqual(dotOf(keyNamed(p.keys(), 'Home Lights')), ['done', 'Done', 'Done'], 'its last result is in its chat');
  assert.deepEqual(dotOf(keyNamed(p.keys(), 'Evening')), ['working', 'Working', 'Home Lights: Working…']);
  assert.doesNotMatch(p.keys(), /class="prev/, 'no second line');
});

test('web: a group\'s key shows up to three heads, and while a member works who it is', () => {
  const p = page({ groups: [{ ...EVENING, working: [], asks: { botId: 'inbox', text: 'Which lamp?' } }] });
  const group = keyNamed(p.keys(), 'Evening');
  assert.equal((group.match(/<i><svg class="fig"/g) || []).length, 3, 'three of its four members');
  assert.match(group, /group-pic/);
  assert.deepEqual(dotOf(group), ['needs', 'Needs you', 'Needs you'], 'a member that asks');
});

test('web: a key\'s state is one line under its name: working, needs you, unread, done, couldn\'t finish or idle (#664)', () => {
  const p = page({
    bots: [{ ...NEWS }, { ...INBOX }, { ...LIGHTS, unread: 2 }, { ...GARDEN }, { id: 'calm', name: 'Calm', color: '#888', state: 'idle', group: 'Home', order: 4 }, { id: 'oops', name: 'Oops', color: '#888', state: 'idle', group: 'Home', order: 5 }, { id: 'lots', name: 'Lots', color: '#888', state: 'idle', group: 'Home', order: 6, unread: 12 }],
    groups: [],
    runs: [{ id: 'r1', botId: 'news', status: 'running', startedAt: at(1) }, { id: 'r2', botId: 'garden', status: 'success', result: 'Watered', startedAt: at(5) }, { id: 'r3', botId: 'oops', status: 'error', startedAt: at(6) }],
  });
  const dot = (name) => dotOf(keyNamed(p.keys(), name));
  assert.deepEqual(dot('News Watcher'), ['working', 'Working', 'Working']);
  assert.deepEqual(dot('Inbox Sweeper'), ['needs', 'Needs you', 'Needs you'], 'it asks');
  assert.deepEqual(dot('Home Lights'), ['unread', '2 unread', '2 unread']);
  assert.deepEqual(dot('Lots'), ['unread', '12 unread', '12 unread']);
  assert.deepEqual(dot('Garden Log'), ['done', 'Done', 'Done']);
  assert.deepEqual(dot('Oops'), ['failed', 'Couldn&#39;t finish', 'Couldn&#39;t finish'], 'escaped as the page writes it');
  assert.deepEqual(dot('Calm'), ['idle', 'Idle', 'Idle']);
  assert.doesNotMatch(p.keys(), /key-dot/, 'no dot on a head');
  assert.match(keyNamed(p.keys(), 'News Watcher'), /<span class="name">News Watcher<\/span><span class="key-st working"/, 'under its name');
  const chief = () => p.keys().match(/<button class="key key-chief[\s\S]*?<\/button>/)[0];
  assert.deepEqual(dotOf(chief()), ['idle', 'Idle', 'Idle'], 'the Chief\'s key too');
  Object.assign(p.state, { chiefBusy: true });
  p.ctx.drawKeypad();
  assert.deepEqual(dotOf(chief()), ['working', 'Working', 'Working']);
  Object.assign(p.state, { chiefBusy: false, chiefUnread: 3 });
  p.ctx.drawKeypad();
  assert.deepEqual(dotOf(chief()), ['unread', '3 unread', '3 unread']);
  assert.deepEqual(dotOf(keyNamed(p.sections(), 'Inbox Sweeper')), ['needs', 'Needs you', 'Needs you'], 'a phone\'s keys too');
});

test('web: a key whose bot a card in Needs you waits for says Needs you; a group\'s key the state of its line (#397)', () => {
  const p = page();
  const dot = (name) => dotOf(keyNamed(p.keys(), name))?.[0] ?? null;
  assert.equal(dot('Home Lights'), 'idle');
  p.ctx.drawKeypadNeeds([{ key: 'j', kind: 'job', bot: LIGHTS }], () => {});
  assert.equal(dot('Home Lights'), 'needs', 'drawn again when the bots that wait change');
  assert.equal(dot('Evening'), 'working', 'a member works');
  p.ctx.drawKeypadNeeds([], () => {}, [{ key: 'j', kind: 'job', bot: LIGHTS }]);
  assert.equal(dot('Home Lights'), 'needs', 'on the Needs you page the rows are not shown, and the key still says it');
  p.ctx.drawKeypadNeeds([], () => {});
  assert.equal(dot('Home Lights'), 'idle');
});

// ---------- Needs you, a row per thing that waits (#635) ----------

const ASK = (id, more = {}) => ({ key: `ask:${id}`, kind: 'ask', a: { id, kind: 'permission', permission: 'web', what: { label: 'browse the web' }, ...more }, bot: { id: 'lights', name: 'Home Lights', color: '#e24b4a' }, color: '#e24b4a', line: 'wants to browse the web' });
const needRows = (el) => [...el.innerHTML.matchAll(/<div class="kp-need">([\s\S]*?)<\/div>(?=<div class="kp-need">|<button type="button" class="kp-needs-more"|$)/g)].map((m) => texts(m[1]));

test('web: Needs you is a row per thing that waits: its bot, what it wants, and No and Allow where the row shows all a yes gives', () => {
  const p = page();
  const job = { key: 'job:j1', kind: 'job', bot: LIGHTS, color: LIGHTS.color, line: 'Router reboot' };
  p.ctx.drawKeypadNeeds([ASK('a1'), job, { key: 'bitwarden', kind: 'bitwarden', bot: null, line: 'Bitwarden is locked' }], (x) => p.said.opened.push(x.key));
  for (const id of ['#kp-needs', '#kp-phone-needs']) {
    const el = p.doc[id];
    assert.deepEqual(needRows(el), ['Home Lights wants to browse the web No Allow', 'Home Lights Router reboot Review', 'Chief of Staff Bitwarden is locked Review'], id);
    assert.equal(el.classList.contains('hidden'), false);
    assert.match(el.innerHTML, /^<div class="kp-need"><div class="avatar head" data-st="idle" data-c="#e24b4a"><\/div>/, 'its bot\'s head');
  }
  const el = p.doc['#kp-needs'];
  el.click('kp-yes', '0');
  el.click('kp-no', '0');
  assert.deepEqual(p.said.answers, [['ask:a1', true], ['ask:a1', false]], 'answered as its card\'s buttons answer it');
  el.click('kp-open', '1');
  el.click('kp-open', '2');
  assert.deepEqual(p.said.opened, ['job:j1', 'bitwarden'], 'Review opens it as its card does');
  p.ctx.drawKeypadNeeds([{ ...job, line: '<b>one</b>' }], () => {});
  assert.ok(el.innerHTML.includes('&lt;b&gt;one&lt;/b&gt;'), 'escaped');
  p.ctx.drawKeypadNeeds([], () => {});
  assert.equal(el.innerHTML, '');
  assert.equal(el.classList.contains('hidden'), true, 'nothing waits: no box');
});

test('web: a permission whose yes is given on its card only has Review; past three rows "+N more" opens Needs you', () => {
  const p = page();
  p.ctx.drawKeypadNeeds([ASK('a1', { yesOn: 'card' })], () => {});
  assert.deepEqual(needRows(p.doc['#kp-needs']), ['Home Lights wants to browse the web Review']);
  p.ctx.drawKeypadNeeds(['a', 'b', 'c', 'd', 'e'].map((id) => ASK(id)), () => {});
  assert.equal(needRows(p.doc['#kp-needs']).length, 3);
  assert.match(p.doc['#kp-needs'].innerHTML, /<button type="button" class="kp-needs-more" data-kp-more>\+2 more<\/button>$/);
  p.doc['#kp-needs'].click('kp-more');
  assert.deepEqual(p.said.views, [['needs', undefined]]);
  p.doc['#kp-needs'].click('kp-yes', '2');
  assert.deepEqual(p.said.answers, [['ask:c', true]], 'each row answers its own');
});

test('web: the Board\'s strip is a plain number per tile: its title, its first number with its sparkline or bar, a switch On or Off (#397, #635)', () => {
  const dash = { tiles: [
    { id: 't1', title: 'Living room', look: { face: [{ type: 'value', text: '21.5', unit: '°C', points: [20.7, 21.1, 21.5] }], short: '21.5 °C' } },
    { id: 't2', title: 'Disk', look: { face: [{ type: 'row', blocks: [{ type: 'kpi', text: '62', unit: '%', ratio: 0.62 }] }] } },
    { id: 't3', title: 'Heating', look: { dot: { filled: true, big: true, color: 'ok' }, face: [] } },
    { id: 't4', title: 'Shopping', look: { dot: { filled: true }, face: [{ type: 'list', items: ['Leeks'] }] } },
  ] };
  const p = page({ dash });
  const cards = [...p.board().matchAll(/<span class="kp-card">([\s\S]*?)<\/span>(?=<span class="kp-card">|<\/div>$)/g)].map((m) => m[1]);
  assert.deepEqual(cards.map(texts), ['Living room 21.5 °C', 'Disk 62 %', 'Heating On', 'Shopping']);
  assert.match(cards[0], /kit-spark/, 'its recent values as a sparkline');
  assert.match(cards[1], /<div class="kit-bar"><i style="width:62%/, 'a kpi inside a row, with its bar');
  assert.match(cards[2], /kp-card-dot/);
  p.doc['#kp-board'].click('board');
  assert.deepEqual(p.said.views, [['dashboard', undefined]], 'a tap opens the Board');
});

test('web: past nine keys, across the pages, the rest have no number', () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ id: `b${i}`, name: `Bot ${String(i + 1).padStart(2, '0')}`, color: '#378add', state: 'idle', group: i < 6 ? 'Home' : 'Work', order: i + 1 }));
  const p = page({ bots: many, groups: [] });
  const keys = keysOf(p.keys());
  assert.equal(keys.length, 11);
  assert.equal(keys[6], '7 Bot 07', 'the second page goes on counting');
  assert.equal(keys[8], '9 Bot 09');
  assert.equal(keys[9], 'Bot 10', 'no number past nine');
  assert.match(keyNamed(p.keys(), 'Bot 10'), /title="Bot 10">/, 'nor a shortcut');
});

test('web: with no bot and no group the keypad holds the Chief\'s key alone', () => {
  const p = page({ bots: [], groups: [] });
  assert.deepEqual(headsOf(p.keys()), []);
  assert.match(p.keys(), /data-key-chief/);
  assert.doesNotMatch(p.keys(), /kp-cats/);
});

// ---------- the Chief and the pinned bots, under the Board ----------

test('web: the top row, under the Board, holds the Chief of Staff\'s key first, then the pinned bots', () => {
  const p = page();
  const pinned = p.keys().split(/<section class="kp-page[^"]*"[^>]*>/)[1];
  assert.equal((p.keys().match(/kp-pinned/g) || []).length, 1);
  assert.match(pinned, /^<div class="kp-page-keys"><button class="key key-chief active" data-key-chief title="Chief of Staff · Esc"/, 'the Chief first, lit while its chat is open');
  assert.equal(texts(noState(pinned.match(/<button class="key key-chief[\s\S]*?<\/button>/)[0])), 'Chief of Staff', 'its head and name; no tagline');
  assert.deepEqual(pageKeysOf(p.keys(), 0), ['1 Garden Log'], 'the digits still count the bots from 1');
  Object.assign(p.state, { view: 'bot', botId: 'garden', chats: [{ id: 'c1', preview: 'Booked the **plumber**' }], chiefUnread: 2 });
  p.ctx.drawKeypad();
  assert.match(p.keys(), /<button class="key key-chief" data-key-chief/, 'not lit while another chat is open');
  assert.doesNotMatch(p.keys(), /plumber/, 'its last message is in its chat');
  p.doc['#kp-keys'].click('key-chief');
  assert.deepEqual(p.said.chief, ['c1'], 'it opens the Chief\'s chat, as Esc does');
});

test('web: with nothing pinned, the top row still holds the Chief, and a key dropped there is pinned', () => {
  const p = page({ bots: BOTS.map((b) => ({ ...b, pinned: 0 })), groups: [] });
  assert.deepEqual(headsOf(p.keys()).map((h) => h[0]), ['Home', 'Money']);
  assert.deepEqual(pageKeysOf(p.keys(), 0), [], 'no bot key there');
  assert.equal(keysOf(p.keys())[0], '1 News Watcher', 'the first bot is 1');
  assert.ok(dragKey(p, 0, { page: 0 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/bots/news', { pinned: 1 }], 'onto the top row: pinned last, here first');
  assert.ok(dragKey(p, 1, { 'key-chief': '' }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/bots/lights', { pinned: 1 }], 'onto the Chief: pinned first, as the list\'s Chief row does');
});

test('web: the Board line shows the tiles\' values and opens the Board', () => {
  const dash = { tiles: [
    { id: 't1', title: 'Living room', look: { short: '21.4 °C', dot: { color: 'ok', filled: true } } },
    { id: 't2', title: 'Lights', look: { dot: { color: 'ok', filled: false } } },
    { id: 't3', title: 'Inside a group', parent: 'x', look: { short: '1' } },
    { id: 't4', title: 'Waiting', approved: false, look: { short: '2' } },
  ] };
  const p = page({ dash });
  assert.equal(texts(p.board()), 'Living room 21.4 °C Lights');
  p.doc['#kp-board'].click('board');
  assert.deepEqual(p.said.views, [['dashboard', undefined]]);
  assert.equal(texts(page({ dash: { tiles: [] } }).board()), 'Board · Nothing on it yet');
});

test('web: against a server without groups and without the Board\'s tiles the keypad draws the bots alone', () => {
  const p = page({ groups: [], dash: null, features: [] });
  assert.equal(p.board(), '', 'no Board line until the Board is read');
  assert.deepEqual(headsOf(p.keys()).map((h) => h[0]), ['Home', 'Money']);
  assert.deepEqual(pageKeysOf(p.keys(), 1), ['2 News Watcher', '3 Home Lights']);
});

// ---------- opening a key ----------

test('web: a key opens its chat in the right column, and only that chat; its key stays lit; Esc opens the Chief again', () => {
  const p = page();
  p.doc['#kp-keys'].click('key', '2');
  assert.deepEqual(p.said.views, [['bot', 'lights']]);
  Object.assign(p.state, { view: 'bot', botId: 'lights' });
  p.ctx.drawKeypad();
  assert.match(p.keys(), /<button class="key active" data-key="2"/, 'its key stays lit');
  assert.equal((p.keys().match(/ active"/g) || []).length, 1);
  p.doc['#kp-keys'].click('key', '3');
  assert.deepEqual(p.said.views.at(-1), ['group', 'g1'], 'a group\'s key opens the group');
  p.doc['#kp-keys'].click('key', '4');
  assert.deepEqual(p.said.views.at(-1), ['bot', 'inbox'], 'a key of the last page');
  assert.ok(p.key('Escape'));
  assert.deepEqual(p.said.chief, ['c1'], 'the Chief\'s chat, as its row opens it');
});

// ---------- dragging a key (#499) ----------

// Drags key `n` (counted across the pages) and drops it `onto` a key ({ key: m }), a category's name or the top row
// ({ page: p }) or the Chief's key ({ 'key-chief': '' }), as the browser's drag events would. Returns whether the target took the drop.
function dragKey(p, n, onto) {
  const types = [];
  const e = { dataTransfer: { types, setData: (t) => types.push(t), dropEffect: '', effectAllowed: '' }, prevented: false, preventDefault() { e.prevented = true; } };
  const find = (attr, value) => p.doc['#kp-keys'].querySelectorAll(`[data-${attr}]`).find((b) => b.dataset[attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())] === String(value));
  const from = find('key', n);
  from.ondragstart(e);
  const [attr, value] = Object.entries(onto)[0];
  const target = find(attr, value);
  target.ondragover(e);
  const took = e.prevented;
  target.ondrop(e);
  from.ondragend(e);
  return took;
}
const pagesNow = (p) => [...p.ctx.Keypad.pages(p.state.bots, p.state.groups)].map((pg) => `${pg.name}: ${pg.keys.map((k) => k.name).join(', ')}`);

test('web: a key dragged onto another key of its page takes its place, saved as the list\'s drag saves it', () => {
  const p = page();
  assert.match(p.keys(), /<button class="key" data-key="2" draggable="true"/, 'a key can be dragged');
  assert.ok(dragKey(p, 2, { key: 1 }));
  assert.deepEqual(p.said.puts, [['PUT', '/bots/lights', { group: 'Home', order: 1 }]], 'moveBot\'s update, as a drop in the list sends it');
  assert.deepEqual(pageKeysOf(p.keys(), 1).map((k) => k.split(' ').slice(1, 3).join(' ')), ['Home Lights', 'News Watcher', 'Evening'], 'drawn in its new place at once');
  assert.deepEqual(pagesNow(p), ['Pinned: Garden Log', 'Home: Home Lights, News Watcher, Evening', 'Money: Inbox Sweeper'], 'and the list, drawn from the same pages, says the same');
});

test('web: a key dropped on the top row, beside its keys, is pinned last', () => {
  const p = page();
  assert.ok(dragKey(p, 1, { page: 0 }));
  assert.deepEqual(p.said.puts, [['PUT', '/bots/news', { pinned: 2 }]]);
  assert.deepEqual(pagesNow(p)[0], 'Pinned: Garden Log, News Watcher');
});

test('web: a key dropped on its own page\'s heading goes last there', () => {
  const p = page();
  assert.ok(dragKey(p, 1, { page: 1 }));
  assert.deepEqual(p.said.puts, [['PUT', '/bots/news', { group: 'Home', order: 2 }]], 'the last bot, before the groups');
});

test('web: a key dropped on a key of another page takes its place there', () => {
  const p = page();
  assert.ok(dragKey(p, 4, { key: 1 }));
  assert.deepEqual(p.said.puts, [['PUT', '/bots/inbox', { group: 'Home', order: 1 }]]);
  assert.deepEqual(pagesNow(p), ['Pinned: Garden Log', 'Home: Inbox Sweeper, News Watcher, Home Lights, Evening']);
});

test('web: a key dropped on another page\'s heading pins it, moves it to that category, or out of it, as the list does', async () => {
  const p = page({ bots: [...BOTS, { id: 'notes', name: 'Notes', color: '#888780', state: 'idle', group: '', order: 1 }] });
  assert.ok(dragKey(p, 1, { page: 0 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/bots/news', { pinned: 2 }], 'onto Pinned: pinned last, as pinBot sends it');
  // Pinned: Garden, News · Home: Lights, Evening · Money: Inbox · Other: Notes
  assert.ok(dragKey(p, 3, { page: 2 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/group-chats/g1', { category: 'Money', order: 1 }], 'a group onto a category: moveGroup\'s update');
  await new Promise(setImmediate); // the save is answered
  assert.deepEqual(p.said.toasts, ['Evening moved to Money']);
  // Pinned: Garden, News · Home: Lights · Money: Inbox, Evening · Other: Notes
  assert.ok(dragKey(p, 2, { page: 3 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/bots/lights', { group: '', order: 2 }], 'onto Other: no category, last there');
  // Pinned: Garden, News · Money: Inbox, Evening · Other: Notes, Lights
  assert.ok(dragKey(p, 0, { page: 1 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/bots/garden', { group: 'Money', order: 2, pinned: 0 }], 'a pinned bot onto a category: unpinned and moved, as moveBot sends it');
  assert.deepEqual(pagesNow(p), ['Pinned: News Watcher', 'Money: Inbox Sweeper, Garden Log, Evening', 'Other: Notes, Home Lights']);
});

test('web: on Pinned a group dropped on a bot\'s key stands before it, and a bot dropped on a group\'s after it (#276)', async () => {
  const p = page();
  // Pinned: Garden · Home: News, Lights, Evening · Money: Inbox
  assert.ok(dragKey(p, 3, { page: 0 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/group-chats/g1', { pinned: 2 }], 'onto Pinned\'s heading: pinned last');
  await new Promise(setImmediate);
  assert.deepEqual(pagesNow(p), ['Pinned: Garden Log, Evening', 'Home: News Watcher, Home Lights', 'Money: Inbox Sweeper']);
  assert.ok(dragKey(p, 1, { key: 0 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/group-chats/g1', { pinned: 1 }], 'a group onto the first bot: first');
  await new Promise(setImmediate);
  assert.deepEqual(pagesNow(p), ['Pinned: Evening, Garden Log', 'Home: News Watcher, Home Lights', 'Money: Inbox Sweeper'], 'shown at once, before the bot');
  assert.ok(dragKey(p, 2, { key: 1 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/bots/news', { pinned: 2 }], 'a bot onto the second key: between the group and the bot');
  await new Promise(setImmediate);
  assert.deepEqual(pagesNow(p), ['Pinned: Evening, News Watcher, Garden Log', 'Home: Home Lights', 'Money: Inbox Sweeper']);
});

test('web: a key dropped where it is, or on its own page\'s heading when it is last there, sends nothing', () => {
  const p = page();
  dragKey(p, 1, { key: 1 });
  dragKey(p, 2, { page: 1 });
  dragKey(p, 4, { page: 2 }); // the last key of the last page onto its heading
  dragKey(p, 0, { page: 0 }); // the only pinned key onto the top row
  dragKey(p, 3, { key: 1 }); // a group onto a bot: the first group, which it is
  assert.deepEqual(p.said.puts, []);
  assert.deepEqual(p.said.views, [], 'and opens nothing');
});

// ---------- folding a page (#171) ----------
// A category's heading folds its page as the list's category heading does, with the list's folded names.

const foldedNow = (p) => JSON.parse(p.ctx.localStorage.getItem('botdot.groups.folded'));
const chevOf = (h, n) => (h.match(new RegExp(`data-page-fold="${n}"[^>]*>[^<]*<span class="chev([^"]*)">`)) || [])[1];

test('web: clicking a category\'s name folds its page: the name stays with a chevron, its keys go; again shows them', () => {
  const p = page();
  assert.equal(chevOf(p.keys(), 1), undefined, 'open: its name alone');
  assert.match(p.keys(), /data-page-fold="1" aria-expanded="true" title="Hide this category">Home<\/button>/);
  p.doc['#kp-keys'].click('page-fold', '1');
  assert.deepEqual(foldedNow(p), ['Home'], 'in the list\'s folded names');
  assert.deepEqual(headsOf(p.keys()), [['Home', ''], ['Money', '']], 'every name');
  assert.equal(chevOf(p.keys(), 1), ' closed', 'folded: the list\'s chevron says so');
  assert.match(p.keys(), /<section class="kp-page folded"><h3 class="kp-page-head" data-page="1">/);
  assert.deepEqual(pageKeysOf(p.keys(), 1), [], 'no key of Home');
  assert.deepEqual(keysOf(p.keys()).map((k) => k.split(' ').slice(0, 3).join(' ')), ['1 Garden Log', '2 Inbox Sweeper'], 'the digits count the keys shown');
  p.doc['#kp-keys'].click('page-fold', '1');
  assert.deepEqual(foldedNow(p), []);
  assert.equal(pageKeysOf(p.keys(), 1).length, 3);
});

test('web: the top row has no fold; a category folded in the list is folded on the keypad and on a phone, Other too', () => {
  const bots = [...BOTS, { id: 'notes', name: 'Notes', color: '#888780', state: 'idle', group: '', order: 1 }];
  const p = page({ bots, folded: ['Money', '\u0000'] });
  assert.doesNotMatch(p.keys(), /data-page-fold="0"/, 'the top row holds the Chief and stays open');
  assert.deepEqual(headsOf(p.keys()).map((h) => h[0]), ['Home', 'Money', 'Other']);
  assert.deepEqual([2, 3].map((n) => pageKeysOf(p.keys(), n)), [[], []]);
  assert.deepEqual(sectionsOf(p.sections()).map((h) => h[0]), ['Home', 'Money', 'Other']);
  assert.deepEqual(phoneKeysOf(p.sections(), 2), [], 'folded on a phone too');
  assert.deepEqual(phoneKeysOf(p.sections(), 3), []);
  p.doc['#kp-sections'].click('section-fold', '3');
  assert.deepEqual(foldedNow(p), ['Money'], 'a phone\'s heading unfolds it');
  assert.deepEqual(phoneKeysOf(p.sections(), 3), ['Notes']);
  assert.deepEqual(pageKeysOf(p.keys(), 3), ['5 Notes'], 'and the wide keypad with it');
});

test('web: a folded page shows the busy dot while one of its bots works, and the dot of a bot that asks', () => {
  const p = page({ folded: ['Home', 'Money'] });
  assert.match(p.keys(), /data-page-fold="1"[^>]*>Home<span class="chev closed">▾<\/span><i class="kp-busy"><\/i><\/button>/, 'News Watcher runs');
  assert.deepEqual(headsOf(p.keys())[1], ['Money', '#1d9e75']);
  assert.doesNotMatch(page().keys(), /kp-busy|kp-dot/, 'not on an open page: its keys show both');
});

test('web: with a query no page is folded; a digit opens the first key shown; a key dropped on a folded heading goes there', () => {
  const p = page({ folded: ['Home'] });
  p.doc['#contact-search'].value = 'news';
  p.ctx.drawKeypad();
  assert.equal(pageKeysOf(p.keys(), 1).length, 3, 'searching shows them');
  p.doc['#contact-search'].value = '';
  p.ctx.drawKeypad();
  assert.ok(p.key('2'));
  assert.deepEqual(p.said.views, [['bot', 'inbox']], 'not a hidden key of Home');
  assert.ok(dragKey(p, 1, { page: 1 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/bots/inbox', { group: 'Home', order: 3 }], 'last in Home, as onto an open heading');
});

// ---------- on a phone (#498) ----------
// The same pages: the pinned keys, then each category a section with its name over its keys.

// The categories' sections drawn: [name, the dot's colour or ''].
const sectionsOf = (h) => [...h.matchAll(/<section class="kp-section[^"]*" data-section="\d+"><h3 class="kp-sec-head">([\s\S]*?)<\/h3>/g)].map((m) => headOf(m[1]));
// The keys of one section: [name and line], in order.
const phoneKeysOf = (h, n) => [...h.matchAll(new RegExp(`<button class="key[^"]*" data-section-key="${n}\\.\\d+"[^>]*>([\\s\\S]*?)<\\/button>`, 'g'))].map(([, inner]) => texts(noState(inner)));

test('web: on a phone the home draws the pinned keys, then every category with its name, its keys without digits', () => {
  const p = page();
  p.ctx.openingLines.sync([{ chat: 'bot:news', runId: 'r9', text: 'Reading 14 feeds' }]);
  p.ctx.drawKeypad();
  assert.deepEqual(sectionsOf(p.sections()), [['Home', ''], ['Money', '']], 'the pinned keys have no heading');
  assert.match(p.sections(), /^<section class="kp-section kp-sec-pinned" data-section="0"><div class="kp-sec-keys">/);
  assert.match(p.sections(), /<\/section><div class="kp-cats"><section class="kp-section" data-section="1">/, 'the categories side by side where they fit');
  assert.deepEqual(phoneKeysOf(p.sections(), 0), ['Garden Log']);
  assert.deepEqual(phoneKeysOf(p.sections(), 1), ['News Watcher', 'Home Lights', 'Evening']);
  assert.deepEqual(dotOf(keyNamed(p.sections(), 'News Watcher')), ['working', 'Working', 'Reading 14 feeds…'], 'its status line on a phone too');
  assert.deepEqual(phoneKeysOf(p.sections(), 2), ['Inbox Sweeper']);
  assert.doesNotMatch(p.sections(), /aria-keyshortcuts|· \d"/, 'no digits on a phone');
  assert.doesNotMatch(p.sections(), /data-key=|data-key-chief/, 'and none of the wide keypad\'s keys, nor the Chief\'s key');
  assert.match(p.sections(), /<div class="avatar head" data-st="idle" data-c="#ef9f27"><\/div>/, 'a key\'s head, in its colour and state');
  const group = p.sections().match(/<button class="key is-group[^"]*" data-section-key="1\.2"[\s\S]*?<\/button>/)[0];
  assert.equal((group.match(/<i><svg class="fig"/g) || []).length, 3, 'a group\'s key: three of its four members');
  assert.equal(texts(p.chief()), 'Chief of Staff', 'the Chief\'s field: its head, its name and the send arrow');
  assert.match(p.chief(), /<i class="kp-send"><svg/);
  assert.equal(p.doc['#kp-chief'].title, 'Message the Chief of Staff');
});

test('web: on a phone the Board line is on top, as on the wide keypad', () => {
  const dash = { tiles: [{ id: 't1', title: 'Living room', look: { short: '21.4 °C' } }] };
  const p = page({ dash });
  assert.equal(texts(p.phoneBoard()), 'Living room 21.4 °C');
  p.doc['#kp-phone-board'].click('board');
  assert.deepEqual(p.said.views, [['dashboard', undefined]]);
  assert.equal(page({ dash: null }).phoneBoard(), '', 'no Board line until the Board is read');
});

test('web: on a phone a key opens its chat as a row of the list does; the Chief\'s message box opens the Chief', () => {
  const p = page();
  p.doc['#kp-sections'].click('section-key', '1.1');
  assert.deepEqual(p.said.views, [['bot', 'lights']]);
  p.doc['#kp-sections'].click('section-key', '1.2');
  assert.deepEqual(p.said.views.at(-1), ['group', 'g1']);
  p.doc['#kp-chief'].onclick();
  assert.deepEqual(p.said.chief, ['c1']);
});

// ---------- keys ----------

test('web: digits open keys counted across the pages, unless a text field has focus; Tab is the browser\'s; Ctrl+K goes to search', () => {
  const p = page();
  assert.ok(p.key('3'));
  assert.deepEqual(p.said.views, [['bot', 'lights']], 'the third key: the second of the second page');
  assert.ok(p.key('5'));
  assert.deepEqual(p.said.views.at(-1), ['bot', 'inbox'], 'the fifth: on the last page');
  assert.equal(p.key('7'), false, 'past the keys: nothing, and the browser keeps the key');
  assert.equal(p.key('1', { ctrlKey: true }), false);
  assert.equal(p.key('Tab'), false, 'Tab walks the page\'s buttons, as everywhere');
  assert.equal(p.key('Tab', { shiftKey: true }), false);
  const field = { matches: (sel) => /textarea/.test(sel), isContentEditable: false };
  assert.equal(p.key('1', { target: field }), false, 'a digit typed into a message stays there');
  assert.ok(p.key('k', { ctrlKey: true, target: field }));
  assert.equal(p.said.focused, 1);
  assert.equal(p.said.views.length, 2, 'nothing else opened');
});

test("web: a bot's own hotkey is its key's digit and opens it, also from a folded page; the free digits go to the rest (#366)", () => {
  const p = page({ bots: [NEWS, { ...INBOX, hotkey: 1 }, LIGHTS, GARDEN] });
  assert.deepEqual(keysOf(p.keys()).map((k) => k.split(' ').slice(0, 2).join(' ')), ['2 Garden', '3 News', '4 Home', '5 Evening', '1 Inbox']);
  assert.ok(p.key('1'));
  assert.deepEqual(p.said.views.at(-1), ['bot', 'inbox']);
  assert.ok(p.key('2'));
  assert.deepEqual(p.said.views.at(-1), ['bot', 'garden']);
  const folded = page({ bots: [NEWS, { ...INBOX, hotkey: 9 }, LIGHTS, GARDEN], folded: ['Money'] });
  assert.ok(!keysOf(folded.keys()).some((k) => k.includes('Inbox')), 'Money is folded');
  assert.ok(folded.key('9'));
  assert.deepEqual(folded.said.views.at(-1), ['bot', 'inbox'], 'its 9 still opens it');
});

test('web: the keys do nothing where the keypad is not shown, under a dialog, or for a key already taken', () => {
  const narrow = page({ shown: false });
  assert.equal(narrow.key('1'), false);
  assert.equal(narrow.key('Escape'), false);
  assert.equal(narrow.key('k', { ctrlKey: true }), false);
  assert.deepEqual([narrow.said.views, narrow.said.chief], [[], []]);
  const dialog = page();
  dialog.doc['#modal'].open = true;
  assert.equal(dialog.key('Escape'), false, 'Esc closes the dialog');
  const taken = page();
  assert.equal(taken.key('1', { defaultPrevented: true }), false);
  const chief = page();
  assert.equal(chief.key('Escape'), false, 'Esc in the Chief\'s chat leaves the chat it shows');
});

// ---------- the stylesheet ----------

const at1 = (wide) => rulesAt(css, wide);
const APP = { tag: 'div', classes: ['app'], index: 1 };
const SIDE = [APP, { tag: 'aside', classes: ['sidebar'], index: 1 }];
const PAD = [...SIDE, { tag: 'div', classes: ['keypad'], index: 2, id: 'keypad' }];
const LIST = [...SIDE, { tag: 'div', classes: ['contacts'], index: 3, id: 'contacts' }];
const SEARCHING = [APP, { tag: 'aside', classes: ['sidebar', 'searching'], index: 1 }];
const MAIN = [APP, { tag: 'main', classes: ['main'], index: 3 }];
const CHIEF = [...MAIN, { tag: 'div', classes: ['chat-row'], index: 3, id: 'chat-row' }, { tag: 'section', classes: ['view'], index: 1, id: 'view-chief' }];
const shows = (rules, chain) => winner(rules, chain, 'display')?.value !== 'none';

test('web: at 1280 px the page shows the keypad and the Chief\'s chat; at 900 px today\'s list', () => {
  for (const wide of [1001, 1280, 1920]) {
    const rules = at1(wide);
    assert.equal(shows(rules, PAD), true, `${wide}: the keypad`);
    assert.equal(shows(rules, LIST), false, `${wide}: no list`);
    assert.equal(shows(rules, MAIN), true, `${wide}: the chat column`);
    assert.equal(shows(rules, CHIEF), true, `${wide}: the Chief's chat`);
    assert.equal(winner(rules, MAIN, 'flex')?.value, 'none', `${wide}: the chat is a column of its own on the right`);
    assert.equal(shows(rules, [APP, { tag: 'div', classes: ['side-grip'], index: 2 }]), false, `${wide}: no handle: the keypad takes what the chat leaves`);
  }
  for (const wide of [480, 700, 900, 1000]) {
    const rules = at1(wide);
    assert.equal(shows(rules, PAD), false, `${wide}: no keypad`);
    assert.equal(shows(rules, LIST), true, `${wide}: the list`);
    assert.equal(shows(rules, PHONE), false, `${wide}: no sections`);
  }
  assert.equal(shows(at1(1280), PHONE), false, 'nor beside the wide keypad');
});

// The phone's home: after the list, in the list's column.
const PHONE = [...SIDE, { tag: 'div', classes: ['kp-phone'], index: 4, id: 'kp-phone' }];
const IN_PHONE = (cls, index, id) => [...PHONE, { tag: cls === 'kp-chief' ? 'button' : 'div', classes: [cls], index, id }];
const IN_MAIN = { tag: 'div', classes: ['app', 'in-main'], index: 1 };
// The top bar and its search field.
const HEAD = (sidebar = SIDE) => [...sidebar, { tag: 'div', classes: ['side-head'], index: 1 }];
const SEARCH = (sidebar = SIDE) => [...HEAD(sidebar), { tag: 'div', classes: ['search'], index: 4 }];
const OPEN = [APP, { tag: 'aside', classes: ['sidebar', 'search-open'], index: 1 }];

test('web: at phone width the home is the sections: the Board line on top, then the keys, the Chief\'s field at the bottom', () => {
  for (const wide of [320, 390, 479]) {
    const rules = at1(wide);
    assert.equal(shows(rules, PHONE), true, `${wide}: the sections`);
    for (const [cls, i] of [['kp-head', 1], ['kp-sections', 2], ['kp-chief', 3]]) assert.equal(shows(rules, IN_PHONE(cls, i)), true, `${wide}: ${cls}`);
    assert.equal(shows(rules, LIST), false, `${wide}: not the list`);
    assert.equal(shows(rules, PAD), false, `${wide}: not the wide keypad, so no digits`);
    assert.equal(shows(rules, MAIN), false, `${wide}: no chat beside them`);
    const line = [...IN_PHONE('kp-head', 1), { tag: 'div', classes: ['kp-board'], index: 1 }, { tag: 'div', classes: ['kp-board-line'], index: 1 }];
    assert.equal(winner(rules, line, 'grid-template-columns')?.value, 'repeat(2, minmax(0, 1fr))', `${wide}: the Board's numbers two a row (#635)`);
    const keys = [...IN_PHONE('kp-sections', 2), { tag: 'section', classes: ['kp-section'], index: 1 }, { tag: 'div', classes: ['kp-sec-keys'], index: 1 }];
    assert.equal(winner(rules, keys, 'flex-wrap')?.value, 'wrap', `${wide}: the keys wrap`);
  }
});

test('web: the Board\'s numbers are never cut: they wrap onto more lines, on the keypad and a phone (#635)', () => {
  for (const wide of [390, 1280]) {
    const line = [...(wide < 480 ? PHONE : PAD), { tag: 'div', classes: ['kp-head'], index: 1 }, { tag: 'div', classes: ['kp-board'], index: 1 }, { tag: 'div', classes: ['kp-board-line'], index: 1 }];
    const rules = at1(wide);
    assert.equal(winner(rules, line, 'display')?.value, 'grid', `${wide}`);
    assert.notEqual(winner(rules, line, 'overflow-x')?.value, 'auto', `${wide}: nothing scrolls sideways`);
  }
  assert.match(css, /\.kp-board-line \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(160px, 1fr\)\);/, 'as many a line as fit');
});

test('web: at phone width a key\'s chat is full screen, and Back brings the sections again', () => {
  const rules = at1(390);
  // setView puts .in-main on the page and the chat's Back takes it off (showList), as for a row of the list.
  assert.equal(shows(rules, [IN_MAIN, { tag: 'aside', classes: ['sidebar'], index: 1 }]), false, 'in a chat: no sections');
  assert.equal(shows(rules, [IN_MAIN, { tag: 'main', classes: ['main'], index: 3 }]), true, 'the chat, full screen');
  assert.equal(shows(rules, [APP, { tag: 'aside', classes: ['sidebar'], index: 1 }]), true, 'back: the sections');
});

test('web: the search field is behind its icon until opened, and stays open while there is a query (#635)', () => {
  for (const wide of [390, 900, 1280]) {
    const rules = at1(wide);
    assert.equal(shows(rules, SEARCH()), false, `${wide}: closed`);
    assert.equal(shows(rules, SEARCH(OPEN)), true, `${wide}: opened by its icon or Ctrl+K`);
    assert.equal(shows(rules, SEARCH(SEARCHING)), true, `${wide}: a query keeps it open`);
    assert.equal(shows(rules, [...HEAD(), { tag: 'nav', classes: ['side-tools'], index: 5 }, { tag: 'button', classes: ['more-btn'], index: 1, id: 'search-btn' }]), true, `${wide}: its icon in the top bar`);
  }
});

test('web: at phone width a query shows the search\'s results in place of the sections', () => {
  const rules = at1(390);
  assert.equal(shows(rules, [...SEARCHING, { tag: 'div', classes: ['contacts'], index: 3 }]), true, 'the results, as today');
  assert.equal(shows(rules, [...SEARCHING, { tag: 'div', classes: ['kp-phone'], index: 4 }]), false, 'no sections, no Board line, no field');
});

test('web: while there is a query the keypad\'s left side shows the search\'s results, under the Board line', () => {
  const rules = at1(1280);
  const inPad = (cls) => [...SEARCHING, { tag: 'div', classes: ['keypad'], index: 2 }, { tag: 'div', classes: [cls], index: 2 }];
  assert.equal(shows(rules, [...SEARCHING, { tag: 'div', classes: ['contacts'], index: 3 }]), true, 'the results');
  assert.equal(shows(rules, inPad('kp-keys')), false);
  assert.equal(shows(rules, inPad('kp-head')), true);
});

test('web: the top bar holds the logo, the search and the tools; the keypad and a phone\'s home follow, around the list', () => {
  assert.match(html, /<div class="side-head">\s*<div class="brand"[\s\S]*<div class="search"><input id="contact-search"[\s\S]*<nav class="side-tools">\s*<button class="more-btn" id="search-btn"[\s\S]*id="admin-link"[\s\S]*id="feedback-btn"[\s\S]*id="more-btn"[\s\S]*?<\/nav>\s*<\/div>/, 'the gear at the right');
  assert.match(html, /<div class="keypad" id="keypad">\s*<div class="kp-head">[\s\S]*id="kp-board"[\s\S]*id="kp-needs"[\s\S]*id="kp-rooms"[\s\S]*<div class="kp-keys" id="kp-keys"><\/div>\s*<\/div>\s*<div class="contacts" id="contacts">/);
  assert.match(html, /<div class="contacts" id="contacts"><\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div class="kp-phone" id="kp-phone">[\s\S]*class="kp-head"[\s\S]*id="kp-phone-board"[\s\S]*class="kp-sections" id="kp-sections"[\s\S]*class="kp-chief" id="kp-chief"[\s\S]*?<\/div>\s*<\/aside>/, 'a phone\'s home after the list');
  assert.doesNotMatch(html, /kp-hint|side-foot|1–9 open/, 'no hint line, no foot');
  const place = (s) => html.indexOf(`<script src="${s}">`);
  assert.ok(place('/keypad.js') > 0 && place('/keypad.js') < place('/app.js'));
});

test('web: heads on keys stand still under reduced motion, as in the list', () => {
  // The keys draw their heads with the list's own figure (botFigure, groupPicture), whose motion the stylesheet
  // stops under reduced motion; the keypad adds no motion of its own: a key's dot does not pulse.
  const blocks = [...css.matchAll(/\/\* ---------- the keypad[\s\S]*?(?=\/\* ----------|$)/g)].map((m) => m[0]);
  assert.equal(blocks.length, 2, 'the keypad\'s rules stand together, and a phone\'s');
  for (const keypadRules of blocks) assert.doesNotMatch(keypadRules, /animation|transition/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.fig g \{ animation: none !important; \}/, 'every head stands still, on a key too');
});

test('web: a narrow keypad (a page open beside the chat) wraps its keys and categories, and below 480 Needs you takes the width', () => {
  // An open page leaves the keypad about 320px at 1280 and 1440 (`.main.viewing`): the keys are as wide as their name
  // and wrap, so nothing runs out sideways. The sidebar is the `side` container the keypad measures.
  assert.match(css, /\.sidebar \{[^}]*container-type: inline-size; container-name: side;/);
  assert.match(css, /\.kp-page-keys \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.kp-cats \{ display: flex; flex-wrap: wrap;/);
  const narrow = css.match(/@container side \(width < 480px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(narrow, /\.keypad \.kp-needs \{ flex: 1 1 100%; \}/);
});

test('web: a key\'s status words are muted and its colour is in the dot; only Needs you keeps colour and weight (#724)', () => {
  const rules = at1(1280);
  const KEY = [...PAD, { tag: 'button', classes: ['key'], index: 1 }];
  const words = (kind, prop) => winner(rules, [...KEY, { tag: 'span', classes: ['key-st', kind], index: 3 }], prop)?.value;
  const dot = (kind) => rules.filter((r) => r.selector === `.key-st.${kind}::before` && 'background' in r.decls).at(-1)?.decls.background.value;
  for (const kind of ['working', 'unread', 'done', 'failed']) {
    assert.equal(words(kind, 'color'), 'var(--muted)', `${kind}: muted words`);
    assert.notEqual(words(kind, 'font-weight'), '600', `${kind}: regular weight`);
  }
  assert.equal(words('needs', 'color'), 'var(--warn-text)', 'Needs you asks for the owner: its words keep their colour');
  assert.equal(words('needs', 'font-weight'), '600');
  assert.deepEqual(['working', 'needs', 'unread', 'done', 'failed'].map(dot), ['var(--ok)', 'var(--warn)', 'var(--mention)', 'var(--ok)', 'var(--err)'], 'the state\'s colour in its dot');
});
