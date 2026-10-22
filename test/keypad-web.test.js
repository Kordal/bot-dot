// The keypad on the web page (#495, ADR 029): the part of public/app.js that draws it and takes its keys, cut out
// and run against stand-ins with what a botdot server sends, beside the list's own state line (contactLine) and a
// group's (groups.js). And the stylesheet: a wide window shows the keypad and one chat, a narrower one the list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, element } = require('./web-page');
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
  const said = { views: [], chief: [], focused: 0, puts: [], toasts: [] };
  const lib = vm.createContext({});
  for (const f of ['unread.js', 'opening-line.js', 'keypad.js']) vm.runInContext(read(f), lib);
  const pad = element({}, { display: shown ? 'flex' : 'none' });
  const doc = { '#keypad': pad, '#kp-board': holder(), '#kp-keys': holder(), '#modal': { open: false },
    '#kp-phone-board': holder(), '#kp-sections': holder(), '#kp-chief': holder(),
    '#contact-search': element({}, { focus: () => said.focused++, select() {} }) };
  const ctx = vm.createContext({
    state, esc, JSON, Unread: lib.Unread, OpeningLine: lib.OpeningLine, Keypad: lib.Keypad, openingLines: lib.OpeningLine.keeper(),
    Figure: { svg: (st, color) => `<svg class="fig" data-st="${st}" data-c="${color}"></svg>` },
    botFigure: (color, st = 'idle') => `<div class="avatar head" data-st="${st}" data-c="${color}"></div>`,
    tintOf: (c) => c || '#888', CHIEF_COLOR: '#d85a30', chiefFigure: () => '<div class="avatar head chief"></div>',
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
// A key without its status (#397), which statusOf reads: [pill, its kind, time].
const noStatus = (h) => h.replace(/<div class="key-status">[\s\S]*?<\/div>(?:<i class="key-run"[^>]*><\/i>)?/g, '');
const statusOf = (key) => { const m = key.match(/<div class="key-status"><span class="kit-pill (\w+)">([^<]*)<\/span>(?:<span class="key-time">([^<]*)<\/span>)?<\/div>/); return m && [m[2], m[1], m[3] || '']; };
// The keys drawn: [number, name, line], in order, across the pages.
const keysOf = (h) => [...h.matchAll(/<button class="key[^"]*" data-key="\d+"[^>]*>([\s\S]*?)<\/button>/g)].map(([, inner]) => texts(noStatus(inner)));
// The pages' headings drawn: [name, count, the dot's colour or ''].
// A heading's [name, count, the dot's colour or '']: a category's stands in its fold button, after the chevron.
const headOf = (inner) => { const m = inner.replace(/<span class="chev[^"]*">▾<\/span>/, '').replace(/<\/?button[^>]*>|<i class="kp-busy"><\/i>/g, '').match(/^([^<]*)<b>(\d+)<\/b>(?:<i class="kp-dot" style="--c:([^"]*)"><\/i>)?$/); return [m[1].trim(), m[2], m[3] || '']; };
const headsOf = (h) => [...h.matchAll(/<h3 class="kp-page-head" data-page="\d+">([\s\S]*?)<\/h3>/g)].map((m) => headOf(m[1]));
// The keys of page `n`: [number, name, line].
const pageKeysOf = (h, n) => keysOf(h.split(/<section class="kp-page[^"]*">/)[n + 1] || '');

// ---------- what a key shows ----------

test('web: the keypad shows every page at once, one under the other, its keys numbered across the pages (#508)', () => {
  const p = page();
  assert.deepEqual(headsOf(p.keys()), [['Pinned', '1', ''], ['Home', '3', ''], ['Money', '1', '#1d9e75']]);
  assert.deepEqual(pageKeysOf(p.keys(), 0), ['1 Garden Log No messages yet']);
  assert.deepEqual(pageKeysOf(p.keys(), 1).map((k) => k.split(' ').slice(0, 3).join(' ')), ['2 News Watcher', '3 Home Lights', '4 Evening Home']);
  assert.deepEqual(pageKeysOf(p.keys(), 2), ['5 Inbox Sweeper ? Archive 212 newsletters?']);
  assert.match(p.keys(), /<div class="avatar head" data-st="idle" data-c="#ef9f27"><\/div>/, 'its head, in its colour and state');
  assert.match(p.keys(), /<button class="key key-ask" data-key-ask>Ask the Chief for a bot<\/button><\/div><\/section>$/, 'the last place, after the last page\'s keys, asks the Chief for a bot');
  assert.doesNotMatch(p.keys(), /kp-tab/, 'no tabs');
});

test('web: a working bot\'s key shows its opening line; a bot that asks shows its question and its page\'s heading the dot', () => {
  const p = page({ runs: [{ id: 'r1', botId: 'lights', status: 'success', result: 'Off at 23:30', startedAt: at(1) }] });
  p.ctx.openingLines.sync([{ chat: 'bot:news', runId: 'r9', text: 'Reading 14 feeds' }]);
  p.ctx.drawKeypad();
  assert.deepEqual(pageKeysOf(p.keys(), 1), ['2 News Watcher Reading 14 feeds…', '3 Home Lights Off at 23:30', '4 Evening Home Lights: Working…']);
  assert.match(p.keys(), /class="prev working">Reading 14 feeds…</, 'in the stronger colour of a working line');
  assert.match(p.keys(), /class="prev asks">Archive 212 newsletters\?/, 'and the list\'s mark beside its name');
  assert.deepEqual(headsOf(p.keys()).map((h) => h[2]), ['', '', '#1d9e75'], 'Money has the dot in Inbox Sweeper\'s colour');
});

test('web: a group\'s key shows up to three heads and the group\'s line', () => {
  const p = page({ groups: [{ ...EVENING, working: [], asks: { botId: 'inbox', text: 'Which lamp?' } }] });
  const group = p.keys().match(/<button class="key is-group[^"]*" data-key="3"[\s\S]*?<\/button>/)[0];
  assert.equal((group.match(/<i><svg class="fig"/g) || []).length, 3, 'three of its four members');
  assert.match(group, /group-pic/);
  assert.equal(keysOf(group)[0], '4 Evening ? Inbox Sweeper asks: Which lamp?');
  assert.deepEqual(headsOf(p.keys())[1], ['Home', '3', '#1d9e75'], 'a member that asks in a group puts its dot on the heading');
});

test('web: each key says its status and the time of its last action: Working with its line, Needs you, unread, Done, Idle (#397)', () => {
  const started = new Date(Date.now() - 3 * 60000).toISOString();
  const p = page({
    bots: [{ ...NEWS }, { ...INBOX }, { ...LIGHTS, unread: 2 }, { ...GARDEN }, { id: 'calm', name: 'Calm', color: '#888', state: 'idle', group: 'Home', order: 4 }, { id: 'oops', name: 'Oops', color: '#888', state: 'idle', group: 'Home', order: 5 }],
    groups: [],
    runs: [{ id: 'r1', botId: 'news', status: 'running', startedAt: started }, { id: 'r2', botId: 'garden', status: 'success', result: 'Watered', startedAt: at(5) }, { id: 'r3', botId: 'oops', status: 'error', startedAt: at(6) }],
  });
  const key = (name) => p.keys().match(new RegExp(`<button class="key[^"]*" data-key="\\d+"[^>]*title="${name}">[\\s\\S]*?</button>`))[0];
  assert.deepEqual(statusOf(key('News Watcher')), ['Working', 'info', '3 min'], 'how long it has worked');
  assert.match(key('News Watcher'), /<i class="key-run" aria-hidden="true"><\/i>/, 'and the thin line of a run going');
  assert.deepEqual(statusOf(key('Inbox Sweeper')).slice(0, 2), ['Needs you', 'warn'], 'it asks');
  assert.deepEqual(statusOf(key('Home Lights')).slice(0, 2), ['2 unread', 'unread']);
  assert.deepEqual(statusOf(key('Garden Log')), ['Done', 'ok', p.ctx.shortTime(at(5))]);
  assert.deepEqual(statusOf(key('Oops')).slice(0, 2), ['Couldn&#39;t finish', 'err'], 'escaped');
  assert.deepEqual(statusOf(key('Calm')), ['Idle', 'idle', ''], 'no run yet: no time');
  assert.equal((p.keys().match(/key-run/g) || []).length, 1, 'only the working key has the line');
  assert.deepEqual(statusOf(p.keys().match(/<button class="key key-chief[\s\S]*?<\/button>/)[0]).slice(0, 2), ['Idle', 'idle'], 'the Chief\'s key too');
  Object.assign(p.state, { chiefBusy: true });
  p.ctx.drawKeypad();
  assert.deepEqual(statusOf(p.keys().match(/<button class="key key-chief[\s\S]*?<\/button>/)[0]).slice(0, 2), ['Working', 'info']);
  assert.deepEqual(statusOf(p.sections().match(/<button class="key[^"]*" data-section-key="\d+\.\d+"[^>]*title="Garden Log">[\s\S]*?<\/button>/)[0]).slice(0, 2), ['Done', 'ok'], 'a phone\'s keys too');
});

test('web: a key whose bot a card in Needs you waits for says Needs you; a group\'s key says what its line says (#397)', () => {
  const p = page();
  const key = (name) => p.keys().match(new RegExp(`<button class="key[^"]*" data-key="\\d+"[^>]*title="${name}">[\\s\\S]*?</button>`))[0];
  assert.equal(statusOf(key('Home Lights'))[0], 'Idle');
  p.ctx.drawKeypadNeeds([{ kind: 'job', bot: LIGHTS }], () => {});
  assert.equal(statusOf(key('Home Lights'))[0], 'Needs you', 'drawn again when the bots that wait change');
  assert.equal(statusOf(key('Evening'))[0], 'Working', 'a member works');
  p.ctx.drawKeypadNeeds([], () => {});
  assert.equal(statusOf(key('Home Lights'))[0], 'Idle');
});

test('web: Needs you is one card on the keypad and a phone: how many, what waits in one line, Review (#397)', () => {
  const p = page();
  const needs = { '#kp-needs': element({}, {}), '#kp-phone-needs': element({}, {}) };
  for (const [id, el] of Object.entries(needs)) { p.doc[id] = el; el.classList = { on: new Set(), toggle(c, on) { if (on) this.on.add(c); else this.on.delete(c); } }; }
  let reviewed = 0;
  p.ctx.drawKeypadNeeds([{ kind: 'job', bot: LIGHTS, line: 'Router reboot' }, { kind: 'x', bot: NEWS, line: '3 updates' }, { kind: 'x', bot: NEWS, line: '3 updates' }], () => reviewed++);
  for (const el of Object.values(needs)) {
    assert.equal(texts(el.innerHTML), '3 need you Router reboot · 3 updates Review', 'the same words once');
    assert.equal(el.classList.on.has('hidden'), false);
    el.onclick();
  }
  assert.equal(reviewed, 2, 'Review opens Needs you, as the banner\'s does');
  p.ctx.drawKeypadNeeds([{ kind: 'x', bot: NEWS, line: '<b>one</b>' }], () => {});
  assert.equal(needs['#kp-needs'].innerHTML.includes('&lt;b&gt;one&lt;/b&gt;'), true, 'escaped');
  assert.match(texts(needs['#kp-needs'].innerHTML), /^1 needs you/);
  p.ctx.drawKeypadNeeds([], () => {});
  assert.equal(needs['#kp-needs'].innerHTML, '');
  assert.equal(needs['#kp-needs'].classList.on.has('hidden'), true, 'nothing waits: no card');
});

test('web: the Board\'s strip is one small kpi card per tile: its title, its first number with its sparkline or bar, a switch On or Off (#397)', () => {
  const dash = { tiles: [
    { id: 't1', title: 'Living room', look: { face: [{ type: 'value', text: '21.5', unit: '°C', points: [20.7, 21.1, 21.5] }], short: '21.5 °C' } },
    { id: 't2', title: 'Disk', look: { face: [{ type: 'row', blocks: [{ type: 'kpi', text: '62', unit: '%', ratio: 0.62 }] }] } },
    { id: 't3', title: 'Heating', look: { dot: { filled: true, big: true, color: 'ok' }, face: [] } },
    { id: 't4', title: 'Shopping', look: { dot: { filled: true }, face: [{ type: 'list', items: ['Leeks'] }] } },
  ] };
  const p = page({ dash });
  const cards = [...p.board().matchAll(/<span class="kp-card">([\s\S]*?)<\/span>(?=<span class="kp-card">|<\/button>)/g)].map((m) => m[1]);
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
  assert.equal(keys[6], '7 Bot 07 No messages yet', 'the second page goes on counting');
  assert.equal(keys[8], '9 Bot 09 No messages yet');
  assert.equal(keys[9], 'Bot 10 No messages yet', 'no number past nine');
});

test('web: with no bot and no group the keypad holds Pinned with the Chief, and the last place', () => {
  const p = page({ bots: [], groups: [] });
  assert.deepEqual(headsOf(p.keys()), [['Pinned', '0', '']]);
  assert.match(p.keys(), /data-key-chief/);
  assert.match(p.keys(), /data-key-ask/);
});

// ---------- the Chief and the pinned bots, under the Board ----------

test('web: the first section, under the Board, is Pinned: the Chief of Staff\'s key first, then the pinned bots', () => {
  const p = page();
  const pinned = p.keys().split(/<section class="kp-page[^"]*">/)[1];
  assert.match(p.keys(), /^<section class="kp-page kp-pinned">/, 'set apart from the categories, which are plain sections');
  assert.equal((p.keys().match(/kp-pinned/g) || []).length, 1);
  assert.match(pinned, /^<h3 class="kp-page-head" data-page="0">Pinned <b>1<\/b><\/h3><div class="kp-page-keys"><button class="key key-chief active" data-key-chief title="Chief of Staff">/, 'the Chief first, lit while its chat is open');
  assert.equal(texts(noStatus(pinned.match(/<button class="key key-chief[\s\S]*?<\/button>/)[0])), 'Esc Chief of Staff Your team of bots. Ask for anything.', 'Esc is its key; its line is the list\'s');
  assert.deepEqual(pageKeysOf(p.keys(), 0), ['1 Garden Log No messages yet'], 'the digits still count the bots from 1');
  Object.assign(p.state, { view: 'bot', botId: 'garden', chats: [{ id: 'c1', preview: 'Booked the **plumber**' }], chiefUnread: 2 });
  p.ctx.drawKeypad();
  assert.match(p.keys(), /<button class="key key-chief" data-key-chief/, 'not lit while another chat is open');
  assert.match(texts(p.keys()), /Chief of Staff .*Booked the plumber/, 'its last message, plain');
  p.doc['#kp-keys'].click('key-chief');
  assert.deepEqual(p.said.chief, ['c1'], 'it opens the Chief\'s chat, as Esc does');
});

test('web: with nothing pinned, Pinned still stands first with the Chief, and a key dropped there is pinned', () => {
  const p = page({ bots: BOTS.map((b) => ({ ...b, pinned: 0 })), groups: [] });
  assert.deepEqual(headsOf(p.keys()).map((h) => h.slice(0, 2)), [['Pinned', '0'], ['Home', '3'], ['Money', '1']]);
  assert.deepEqual(pageKeysOf(p.keys(), 0), [], 'no bot key there');
  assert.equal(keysOf(p.keys())[0].split(' ').slice(0, 3).join(' '), '1 News Watcher', 'the first bot is 1');
  assert.ok(dragKey(p, 0, { page: 0 }));
  assert.deepEqual(p.said.puts.at(-1), ['PUT', '/bots/news', { pinned: 1 }], 'onto Pinned\'s heading: pinned first');
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
  assert.deepEqual(headsOf(p.keys()).map((h) => h[0]), ['Pinned', 'Home', 'Money']);
  assert.deepEqual(pageKeysOf(p.keys(), 1).map((k) => k.split(' ').slice(1, 3).join(' ')), ['News Watcher', 'Home Lights']);
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
  p.doc['#kp-keys'].click('key-ask');
  assert.deepEqual(p.said.chief, ['c1', 'c1'], 'the last place opens the Chief');
});

// ---------- dragging a key (#499) ----------

// Drags key `n` (counted across the pages) and drops it `onto` a key ({ key: m }), a page's heading ({ page: p }) or
// the last place ({ 'key-ask': '' }), as the browser's drag events would. Returns whether the target took the drop.
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
  assert.deepEqual(pageKeysOf(p.keys(), 1).map((k) => k.split(' ').slice(1, 3).join(' ')), ['Home Lights', 'News Watcher', 'Evening Home'], 'drawn in its new place at once');
  assert.deepEqual(pagesNow(p), ['Pinned: Garden Log', 'Home: Home Lights, News Watcher, Evening', 'Money: Inbox Sweeper'], 'and the list, drawn from the same pages, says the same');
});

test('web: a key dropped on the last place goes last on the last page', () => {
  const p = page();
  assert.ok(dragKey(p, 1, { 'key-ask': '' }));
  assert.deepEqual(p.said.puts, [['PUT', '/bots/news', { group: 'Money', order: 2 }]]);
  assert.deepEqual(pagesNow(p).at(-1), 'Money: Inbox Sweeper, News Watcher');
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
  dragKey(p, 4, { 'key-ask': '' }); // the last key of the last page onto the last place
  dragKey(p, 3, { key: 1 }); // a group onto a bot: the first group, which it is
  assert.deepEqual(p.said.puts, []);
  assert.deepEqual(p.said.views, [], 'and opens nothing');
});

// ---------- folding a page (#171) ----------
// A category's heading folds its page as the list's category heading does, with the list's folded names.

const foldedNow = (p) => JSON.parse(p.ctx.localStorage.getItem('botdot.groups.folded'));
const chevOf = (h, n) => (h.match(new RegExp(`data-page-fold="${n}"[^>]*><span class="chev([^"]*)">`)) || [])[1];

test('web: clicking a category\'s heading folds its page: the heading and its count stay, its keys go; again shows them', () => {
  const p = page();
  assert.equal(chevOf(p.keys(), 1), '', 'open, with the list\'s chevron');
  assert.match(p.keys(), /data-page-fold="1" aria-expanded="true" title="Hide this category"/);
  p.doc['#kp-keys'].click('page-fold', '1');
  assert.deepEqual(foldedNow(p), ['Home'], 'in the list\'s folded names');
  assert.deepEqual(headsOf(p.keys()), [['Pinned', '1', ''], ['Home', '3', ''], ['Money', '1', '#1d9e75']], 'every heading with its count and dot');
  assert.equal(chevOf(p.keys(), 1), ' closed');
  assert.match(p.keys(), /<section class="kp-page folded"><h3 class="kp-page-head" data-page="1">/);
  assert.deepEqual(pageKeysOf(p.keys(), 1), [], 'no key of Home');
  assert.deepEqual(keysOf(p.keys()).map((k) => k.split(' ').slice(0, 3).join(' ')), ['1 Garden Log', '2 Inbox Sweeper'], 'the digits count the keys shown');
  p.doc['#kp-keys'].click('page-fold', '1');
  assert.deepEqual(foldedNow(p), []);
  assert.equal(pageKeysOf(p.keys(), 1).length, 3);
});

test('web: Pinned has no fold; a category folded in the list is folded on the keypad and on a phone, Other too', () => {
  const bots = [...BOTS, { id: 'notes', name: 'Notes', color: '#888780', state: 'idle', group: '', order: 1 }];
  const p = page({ bots, folded: ['Money', '\u0000'] });
  assert.doesNotMatch(p.keys(), /data-page-fold="0"/, 'Pinned holds the Chief and stays open');
  assert.deepEqual(headsOf(p.keys()).map((h) => h.slice(0, 2)), [['Pinned', '1'], ['Home', '3'], ['Money', '1'], ['Other', '1']]);
  assert.deepEqual([2, 3].map((n) => pageKeysOf(p.keys(), n)), [[], []]);
  assert.match(p.keys(), /<section class="kp-page folded">[\s\S]*?Other[\s\S]*?<div class="kp-page-keys"><button class="key key-ask" data-key-ask>/, 'the last place stays');
  assert.deepEqual(sectionsOf(p.sections()).map((h) => h.slice(0, 2)), [['Pinned', '1'], ['Home', '3'], ['Money', '1'], ['Other', '1']]);
  assert.deepEqual(phoneKeysOf(p.sections(), 2), [], 'folded on a phone too');
  assert.deepEqual(phoneKeysOf(p.sections(), 3), []);
  p.doc['#kp-sections'].click('section-fold', '3');
  assert.deepEqual(foldedNow(p), ['Money'], 'a phone\'s heading unfolds it');
  assert.deepEqual(phoneKeysOf(p.sections(), 3), ['Notes No messages yet']);
  assert.deepEqual(pageKeysOf(p.keys(), 3), ['5 Notes No messages yet'], 'and the wide keypad with it');
});

test('web: a folded page shows the busy dot while one of its bots works, and keeps the dot of a bot that asks', () => {
  const p = page({ folded: ['Home', 'Money'] });
  assert.match(p.keys(), /data-page-fold="1"[^>]*>[\s\S]*?<b>3<\/b><i class="kp-busy"><\/i><\/button>/, 'News Watcher runs');
  assert.deepEqual(headsOf(p.keys())[2], ['Money', '1', '#1d9e75']);
  assert.doesNotMatch(page().keys(), /kp-busy/, 'not on an open page: its keys show it');
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
// The same pages, one under the other: each a section with its name and count, its keys in rows of three.

// The sections drawn: [name, count, the dot's colour or ''].
const sectionsOf = (h) => [...h.matchAll(/<section class="kp-section[^"]*" data-section="\d+"><h3 class="kp-sec-head">([\s\S]*?)<\/h3>/g)].map((m) => headOf(m[1]));
// The keys of one section: [name and line], in order.
const phoneKeysOf = (h, n) => [...h.matchAll(new RegExp(`<button class="key[^"]*" data-section-key="${n}\\.\\d+"[^>]*>([\\s\\S]*?)<\\/button>`, 'g'))].map(([, inner]) => texts(noStatus(inner)));

test('web: on a phone the home draws every page as a section in page order, with its name, count and dot, its keys without digits', () => {
  const p = page();
  p.ctx.openingLines.sync([{ chat: 'bot:news', runId: 'r9', text: 'Reading 14 feeds' }]);
  p.ctx.drawKeypad();
  assert.deepEqual(sectionsOf(p.sections()), [['Pinned', '1', ''], ['Home', '3', ''], ['Money', '1', '#1d9e75']]);
  assert.deepEqual(phoneKeysOf(p.sections(), 0), ['Garden Log No messages yet']);
  assert.deepEqual(phoneKeysOf(p.sections(), 1), ['News Watcher Reading 14 feeds…', 'Home Lights No messages yet', 'Evening Home Lights: Working…']);
  assert.deepEqual(phoneKeysOf(p.sections(), 2), ['Inbox Sweeper ? Archive 212 newsletters?']);
  assert.doesNotMatch(p.sections(), /key-n/, 'no digits on a phone');
  assert.doesNotMatch(p.sections(), /data-key=/, 'and none of the wide keypad\'s keys');
  assert.match(p.sections(), /<div class="avatar head" data-st="idle" data-c="#ef9f27"><\/div>/, 'a key\'s head, in its colour and state');
  const group = p.sections().match(/<button class="key is-group[^"]*" data-section-key="1\.2"[\s\S]*?<\/button>/)[0];
  assert.equal((group.match(/<i><svg class="fig"/g) || []).length, 3, 'a group\'s key: three of its four members');
  assert.match(p.chief(), /Ask the Chief…/, 'the Chief\'s message box');
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

test("web: a bot's own hotkey shows on its key and opens it, also from a folded page; the free digits go to the rest (#366)", () => {
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
const PAD = [...SIDE, { tag: 'div', classes: ['keypad'], index: 3, id: 'keypad' }];
const LIST = [...SIDE, { tag: 'div', classes: ['contacts'], index: 4, id: 'contacts' }];
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
const PHONE = [...SIDE, { tag: 'div', classes: ['kp-phone'], index: 5, id: 'kp-phone' }];
const IN_PHONE = (cls, index, id) => [...PHONE, { tag: cls === 'kp-chief' ? 'button' : 'div', classes: [cls], index, id }];
const IN_MAIN = { tag: 'div', classes: ['app', 'in-main'], index: 1 };

test('web: at phone width the home is the sections: the Board line on top, then the sections, the Chief\'s message box at the bottom', () => {
  for (const wide of [320, 390, 479]) {
    const rules = at1(wide);
    assert.equal(shows(rules, PHONE), true, `${wide}: the sections`);
    for (const [cls, i] of [['kp-head', 1], ['kp-sections', 2], ['kp-chief', 3]]) assert.equal(shows(rules, IN_PHONE(cls, i)), true, `${wide}: ${cls}`);
    assert.equal(shows(rules, LIST), false, `${wide}: not the list`);
    assert.equal(shows(rules, PAD), false, `${wide}: not the wide keypad, so no digits`);
    assert.equal(shows(rules, MAIN), false, `${wide}: no chat beside them`);
    assert.match(winner(rules, [...IN_PHONE('kp-sections', 2), { tag: 'section', classes: ['kp-section'], index: 1 }, { tag: 'div', classes: ['kp-sec-keys'], index: 2 }], 'grid-template-columns')?.value || '', /^repeat\(2,/, `${wide}: keys two a row`);
    assert.equal(winner(rules, [...IN_PHONE('kp-sections', 2), { tag: 'section', classes: ['kp-section', 'kp-sec-pinned'], index: 1 }, { tag: 'div', classes: ['kp-sec-keys'], index: 2 }], 'grid-template-columns')?.value, 'minmax(0, 1fr)', `${wide}: Pinned one a row (#397)`);
  }
});

test('web: at phone width a key\'s chat is full screen, and Back brings the sections again', () => {
  const rules = at1(390);
  // setView puts .in-main on the page and the chat's Back takes it off (showList), as for a row of the list.
  assert.equal(shows(rules, [IN_MAIN, { tag: 'aside', classes: ['sidebar'], index: 1 }]), false, 'in a chat: no sections');
  assert.equal(shows(rules, [IN_MAIN, { tag: 'main', classes: ['main'], index: 3 }]), true, 'the chat, full screen');
  assert.equal(shows(rules, [APP, { tag: 'aside', classes: ['sidebar'], index: 1 }]), true, 'back: the sections');
});

test('web: at phone width a query shows the search\'s results in place of the sections', () => {
  const rules = at1(390);
  assert.equal(shows(rules, [...SEARCHING, { tag: 'div', classes: ['contacts'], index: 4 }]), true, 'the results, as today');
  assert.equal(shows(rules, [...SEARCHING, { tag: 'div', classes: ['kp-phone'], index: 5 }]), false, 'no sections, no Board line, no box');
  assert.equal(shows(rules, [...SIDE, { tag: 'div', classes: ['search'], index: 2 }]), true, 'the search box stays');
});

test('web: while there is a query the keypad\'s left side shows the search\'s results, under the Board line', () => {
  const rules = at1(1280);
  const inPad = (cls) => [...SEARCHING, { tag: 'div', classes: ['keypad'], index: 3 }, { tag: 'div', classes: [cls], index: 2 }];
  assert.equal(shows(rules, [...SEARCHING, { tag: 'div', classes: ['contacts'], index: 4 }]), true, 'the results');
  assert.equal(shows(rules, inPad('kp-keys')), false);
  assert.equal(shows(rules, [...SEARCHING, { tag: 'div', classes: ['keypad'], index: 3 }, { tag: 'div', classes: ['kp-hint'], index: 3 }]), false);
  assert.equal(shows(rules, inPad('kp-head')), true);
  assert.equal(shows(rules, [...SIDE, { tag: 'div', classes: ['search'], index: 2 }]), true, 'the search box stays');
});

test('web: the keypad is in the page, with its parts, before the list; keypad.js loads before app.js', () => {
  assert.match(html, /<div class="keypad" id="keypad">[\s\S]*id="kp-board"[\s\S]*id="kp-needs"[\s\S]*id="kp-keys"[\s\S]*class="kp-hint"[\s\S]*<\/div>\s*<div class="contacts" id="contacts">/);
  assert.match(html, /<div class="contacts" id="contacts"><\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div class="kp-phone" id="kp-phone">[\s\S]*class="kp-head"[\s\S]*id="kp-phone-board"[\s\S]*class="kp-sections" id="kp-sections"[\s\S]*class="kp-chief" id="kp-chief"[\s\S]*?<\/div>\s*<nav class="side-foot">/, 'a phone\'s home after the list');
  const place = (s) => html.indexOf(`<script src="${s}">`);
  assert.ok(place('/keypad.js') > 0 && place('/keypad.js') < place('/app.js'));
});

test('web: heads on keys stand still under reduced motion, as in the list', () => {
  // The keys draw their heads with the list's own figure (botFigure, groupPicture), whose motion the stylesheet
  // stops under reduced motion; the keypad adds no motion of its own but a working key's line (#397), which stops too.
  const blocks = [...css.matchAll(/\/\* ---------- the keypad[\s\S]*?(?=\/\* ----------|$)/g)].map((m) => m[0]);
  assert.equal(blocks.length, 2, 'the keypad\'s rules stand together, and a phone\'s');
  for (const keypadRules of blocks) assert.doesNotMatch(keypadRules, /animation|transition/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.fig g \{ animation: none !important; \}/, 'every head stands still, on a key too');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.key-run::after \{ animation: none;/, 'and a working key\'s line');
});
