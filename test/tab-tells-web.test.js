// The web page's tab tells (ALV-009): the page's own code for its tab, cut out of public/app.js and run against
// stand-ins, with public/unread.js loaded the way the browser loads it. While any chat has a new reply (a bot's
// chat, a Chief chat, a group) or anything waits in Needs you, the tab's title carries a mark before "botdot" and
// its icon a dot; both are gone when nothing is new and nothing waits. A mark, never a count, and nothing the
// browser has to ask the owner about. How the icon looks is the owner's to judge on screen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut } = require('./web-page');

const lib = vm.createContext({});
vm.runInContext(read('unread.js'), lib);
const SRC = cut('// ---------- the tab tells ----------', '// An arrival is over');
const ICON = read('icon.svg');
const PLAIN = '/icon.svg?v=2';
const soon = () => new Promise((r) => setImmediate(r));

// The two pure functions alone.
function pure() {
  const ctx = vm.createContext({ Unread: lib.Unread, encodeURIComponent });
  vm.runInContext(`${SRC}\nObject.assign(this, { tabTells, markedIcon, TAB_NAME, TAB_MARK });`, ctx);
  return ctx;
}

// The page around them: what it holds from the feed, its title and its icon's link, and the icon's file.
function page({ icon = async () => ({ ok: true, text: async () => ICON }) } = {}) {
  const link = { href: PLAIN, getAttribute: (n) => (n === 'href' ? link.href : null), setAttribute(n, v) { assert.equal(n, 'href'); link.href = v; link.sets.push(v); }, sets: [] };
  const state = { bots: [], groups: [], chiefUnread: 0 };
  const needs = [];
  const fetched = [];
  const document = { title: 'botdot' };
  const ctx = vm.createContext({
    Unread: lib.Unread, encodeURIComponent, state, document, console: { warn() {} },
    $: (sel) => (sel === 'link[rel="icon"]' ? link : null),
    needsItems: () => needs,
    fetch: (url) => { fetched.push(url); return icon(url); },
  });
  vm.runInContext(`${SRC}\nthis.tellTab = tellTab;`, ctx);
  return { ctx, state, needs, link, document, fetched, tell: async () => { ctx.tellTab(); await soon(); await soon(); } };
}

test('web: no mark while nothing is new and nothing waits', () => {
  const { tabTells } = pure();
  for (const held of [
    {}, undefined, null,
    { bots: [], groups: [], chief: 0, needs: [] },
    { bots: [{ id: 'a' }, { id: 'b', unread: 0, firstUnread: null }], groups: [{ id: 'g', unread: 0 }], chief: 0, needs: [] },
    // What a server without new replies sends, or anything that is no count: nothing is new.
    { bots: [{ id: 'a', unread: null }, { id: 'b', unread: '2' }, { id: 'c', unread: -1 }, null], groups: null, chief: undefined, needs: undefined },
    { bots: 'no list', groups: {}, chief: '3', needs: 'no list' },
    // A bot that works, or that asks while nothing of its is new, is no new reply and no card.
    { bots: [{ id: 'a', running: true }, { id: 'b', asks: { text: 'Which one?' } }], groups: [], chief: 0, needs: [] },
  ]) {
    const tab = tabTells(held);
    assert.equal(tab.due, false, JSON.stringify(held));
    assert.equal(tab.title, 'botdot', JSON.stringify(held));
  }
});

test('web: a new reply in a bot\'s chat, a Chief chat or a group puts the mark before "botdot"', () => {
  const { tabTells, TAB_MARK } = pure();
  const marked = `${TAB_MARK} botdot`;
  for (const [what, held] of [
    ['a bot', { bots: [{ id: 'a' }, { id: 'b', unread: 1, firstUnread: 'r1' }] }],
    ['the Chief', { chief: 2 }],
    ['a group', { bots: [{ id: 'a', unread: 0 }], groups: [{ id: 'g', unread: 3 }] }],
    ['all three', { bots: [{ id: 'a', unread: 12 }], groups: [{ id: 'g', unread: 3 }], chief: 4 }],
  ]) {
    assert.deepEqual({ ...tabTells(held) }, { due: true, title: marked }, what);
  }
});

test('web: anything that waits in Needs you does the same', () => {
  const { tabTells, TAB_MARK } = pure();
  assert.deepEqual({ ...tabTells({ needs: [{ key: 'ask:1', kind: 'ask' }] }) }, { due: true, title: `${TAB_MARK} botdot` });
  assert.deepEqual({ ...tabTells({ bots: [{ id: 'a', unread: 0 }], chief: 0, needs: [{ key: 'job:j1' }, { key: 'bitwarden' }, { key: 'sug:c1' }] }) }, { due: true, title: `${TAB_MARK} botdot` });
});

test('web: the title is a mark and the name, and never holds a digit', () => {
  const { tabTells, TAB_MARK, TAB_NAME } = pure();
  assert.equal(TAB_NAME, 'botdot');
  assert.equal([...TAB_MARK].length, 1, 'one sign');
  assert.doesNotMatch(TAB_MARK, /[\d\s\w]/u);
  const many = { bots: Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, unread: 7 + i })), groups: [{ id: 'g', unread: 31 }], chief: 5, needs: Array.from({ length: 6 }, (_, i) => ({ key: `ask:${i}` })) };
  const one = { bots: [{ id: 'a', unread: 1 }] };
  assert.equal(tabTells(many).title, tabTells(one).title, 'the same for one as for many');
  for (const held of [many, one, {}]) assert.doesNotMatch(tabTells(held).title, /\p{N}/u);
  assert.ok(tabTells(many).title.endsWith(' botdot') && tabTells(many).title.startsWith(TAB_MARK), 'the mark stands before the name');
});

test('web: the marked icon is the page\'s own icon with a dot, drawn by the page', () => {
  const { markedIcon } = pure();
  assert.match(ICON, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512">/, 'the dot is placed for this size: a new logo of another size moves it');
  const url = markedIcon(ICON);
  assert.ok(url.startsWith('data:image/svg+xml,'), 'an address the page made, no file of the server');
  const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
  assert.ok(svg.startsWith(ICON.trim().slice(0, -'</svg>'.length)), 'the icon as it is');
  const added = svg.slice(ICON.trim().length - '</svg>'.length);
  assert.match(added, /^<circle cx="\d+" cy="\d+" r="\d+" fill="#[0-9a-f]{6}"[^<>]*\/><\/svg>$/, 'one dot, then the end');
  assert.doesNotMatch(added, /<text|\d<\/|href|script/, 'no digit drawn, nothing fetched');
  assert.doesNotMatch(url, /[#<>"\s]/, 'safe as an address');
  // Anything that is no SVG gives no icon: the plain one stays.
  for (const none of ['', null, undefined, '<!doctype html><html></html>', 'Not found', 7]) assert.equal(markedIcon(none), '', String(none));
});

test('web: the page sets the title and the icon from what it holds, and takes them back', async () => {
  const p = page();
  await p.tell();
  assert.equal(p.document.title, 'botdot');
  assert.equal(p.link.href, PLAIN);
  assert.deepEqual(p.fetched, [], 'the icon is not read while nothing is marked');

  // A new reply in a bot's chat.
  p.state.bots = [{ id: 'a', unread: 1, firstUnread: 'r1' }];
  await p.tell();
  assert.match(p.document.title, /^\S botdot$/u);
  assert.deepEqual(p.fetched, [PLAIN], 'the page reads its own icon, once');
  assert.ok(p.link.href.startsWith('data:image/svg+xml,'), 'and marks it');
  const marked = p.link.href;

  // Read: nothing is new, nothing waits.
  p.state.bots = [{ id: 'a', unread: 0, firstUnread: null }];
  await p.tell();
  assert.equal(p.document.title, 'botdot');
  assert.equal(p.link.href, PLAIN, 'the icon the page came with');

  // A Chief chat, a group, and Needs you, one after the other: the last one to go takes the mark with it.
  p.state.chiefUnread = 1;
  await p.tell();
  assert.equal(p.link.href, marked);
  p.state.groups = [{ id: 'g', unread: 2 }];
  p.state.chiefUnread = 0;
  await p.tell();
  assert.equal(p.link.href, marked);
  p.needs.push({ key: 'ask:1' });
  p.state.groups = [{ id: 'g', unread: 0 }];
  await p.tell();
  assert.equal(p.link.href, marked);
  assert.notEqual(p.document.title, 'botdot');
  p.needs.length = 0;
  await p.tell();
  assert.equal(p.document.title, 'botdot');
  assert.equal(p.link.href, PLAIN);
  assert.deepEqual(p.fetched, [PLAIN], 'the icon was read once for all of it');
  // Nothing is set again while nothing changes: the browser is not made to draw the icon over and over.
  const sets = p.link.sets.length;
  await p.tell();
  await p.tell();
  assert.equal(p.link.sets.length, sets);
});

test('web: a mark that ended while the icon was being read leaves the plain icon', async () => {
  let give;
  const p = page({ icon: () => new Promise((r) => { give = r; }) });
  p.state.chiefUnread = 1;
  await p.tell();
  assert.notEqual(p.document.title, 'botdot', 'the title does not wait for the icon');
  assert.equal(p.link.href, PLAIN);
  p.state.chiefUnread = 0;
  await p.tell();
  give({ ok: true, text: async () => ICON });
  await soon(); await soon();
  assert.equal(p.document.title, 'botdot');
  assert.equal(p.link.href, PLAIN);
  // The next mark has its icon without reading it again.
  p.state.chiefUnread = 1;
  await p.tell();
  assert.ok(p.link.href.startsWith('data:image/svg+xml,'));
  assert.equal(p.fetched.length, 1);
});

test('web: an icon that cannot be read leaves the title to tell', async () => {
  for (const icon of [async () => { throw new TypeError('Failed to fetch'); }, async () => ({ ok: false, status: 404, text: async () => 'Not found' }), async () => ({ ok: true, text: async () => '<html></html>' })]) {
    const p = page({ icon });
    p.needs.push({ key: 'job:j1' });
    await p.tell();
    assert.notEqual(p.document.title, 'botdot');
    assert.equal(p.link.href, PLAIN);
    p.needs.length = 0;
    await p.tell();
    assert.equal(p.document.title, 'botdot');
    assert.equal(p.link.href, PLAIN);
  }
  // A page without an icon's link: the title alone.
  const p = page();
  p.ctx.$ = () => null;
  p.state.chiefUnread = 1;
  await p.tell();
  assert.notEqual(p.document.title, 'botdot');
});

test('web: the tab is told wherever the list\'s dots and Needs you are drawn, and the browser is asked nothing', () => {
  assert.match(cut('function renderContacts() {', 'const reducedMotion ='), /^function renderContacts\(\) \{\n  tellTab\(\);/, 'with the dots of the list, also while a row is dragged');
  assert.match(cut('function showNeeds() {', 'function openNeed('), /^function showNeeds\(\) \{\n  tellTab\(\);/, 'with the heads of Needs you');
  // What the mark is told from is what the list and Needs you are drawn from.
  assert.match(SRC, /tabTells\(\{ bots: state\.bots, groups: state\.groups, chief: state\.chiefUnread, needs: needsItems\(\) \}\)/);
  const index = read('index.html');
  assert.match(index, /<title>botdot<\/title>/);
  assert.match(index, /<link rel="icon" href="\/icon\.svg\?v=2" \/>/);
  assert.equal(app.match(/document\.title\s*=[^=]/g)?.length, 1, 'one place sets the title');
  // No notification, no permission question, no service worker, no sound.
  for (const f of ['app.js', 'index.html', 'groups.js', 'unread.js']) assert.doesNotMatch(read(f), /\bNotification\b|serviceWorker|requestPermission|new Audio|AudioContext|navigator\.setAppBadge/, f);
});
