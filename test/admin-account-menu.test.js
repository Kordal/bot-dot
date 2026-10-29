// The admin page's account card (#725): one action in sight ("Change share") and a ⋯ menu with the rest (Update now,
// Suspend or Resume, New sign-in link, Delete), Delete plain in the menu and red only in its own box; the dates
// relative with the full date in a title; the state a dot and a word. The menu is reached by keyboard and closes on
// Escape and on a click outside it. The admin page's own script (ADMIN_SCRIPT) runs against a small stand-in DOM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const pages = require('../lib/front-door/pages');

// A small DOM: elements with children, attributes, listeners that bubble up to the document, and the selectors the
// script asks for (a class, a tag, [attr="value"], and lists of them).
function dom() {
  const document = { activeElement: null, listeners: {}, byId: {} };
  const matches = (n, sel) => sel.split(',').some((one) => {
    one = one.trim();
    const attr = one.match(/^\[([\w-]+)="([^"]*)"\]$/);
    if (attr) return n.getAttribute(attr[1]) === attr[2];
    if (one.startsWith('.')) return n.className.split(' ').includes(one.slice(1));
    return n.tagName === one.toUpperCase();
  });
  function make(tag) {
    const n = {
      tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: {}, listeners: {}, style: {}, className: '',
      hidden: false, disabled: false, title: '', type: '', value: '', tabIndex: 0, id: '',
      get textContent() { return n.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); },
      set textContent(t) { n.children = [String(t)]; },
      append(...kids) { for (const k of kids) { if (typeof k !== 'string') { k.remove(); k.parentNode = n; } n.children.push(k); } },
      replaceChildren(...kids) { for (const c of n.children) if (typeof c !== 'string') c.parentNode = null; n.children = []; n.append(...kids); },
      remove() { if (n.parentNode) { n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1); n.parentNode = null; } },
      contains(x) { for (let p = x; p; p = p.parentNode) if (p === n) return true; return false; },
      setAttribute(k, v) { n.attrs[k] = String(v); },
      getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
      addEventListener(type, fn) { (n.listeners[type] ||= []).push(fn); },
      querySelectorAll(sel) { const out = []; const walk = (p) => { for (const c of p.children) if (typeof c !== 'string') { if (matches(c, sel)) out.push(c); walk(c); } }; walk(n); return out; },
      querySelector(sel) { return n.querySelectorAll(sel)[0] || null; },
      focus() { document.activeElement = n; },
      select() {},
      get elements() { const e = {}; for (const c of n.querySelectorAll('input')) e[c.name] = c; return e; },
    };
    return n;
  }
  const root = make('body');
  // An event from a node, up through its parents to the document.
  function fire(target, type, props = {}) {
    const ev = { type, target, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, ...props };
    for (let p = target; p; p = p.parentNode) for (const fn of p.listeners[type] || []) fn(ev);
    for (const fn of document.listeners[type] || []) fn(ev);
    return ev;
  }
  Object.assign(document, {
    createElement: make,
    getElementById: (id) => (document.byId[id] ||= (() => { const e = make('div'); e.id = id; root.append(e); e.append(make('label'), make('input')); return e; })()),
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    addEventListener: (type, fn) => (document.listeners[type] ||= []).push(fn),
  });
  return { document, root, fire, make };
}

const HOUR = 3600_000;
const now = Date.now();
const ACCOUNTS = [
  { name: 'ann', admin: true, state: 'running', created: new Date(now - 30 * 24 * HOUR).toISOString(), lastSeen: new Date(now - 2 * HOUR).toISOString(),
    share: { cpu: 2, ram: 5, disk: 30 }, ownShare: false, use: { cpu: 1.1, ram: 2.5e9, diskUsed: 16e9, diskSize: 40e9, computers: 1 } },
  { name: 'bob', state: 'running', created: new Date(now - 3 * 24 * HOUR).toISOString(), lastSeen: new Date(now - 5 * 60_000).toISOString(),
    share: { cpu: 1, ram: 3, disk: 20 }, ownShare: true, use: { cpu: 0.2, ram: 1e9, diskUsed: 2e9, diskSize: 20e9, computers: 0 }, update: { canUpdate: true, autoUpdate: false } },
  { name: 'cat', state: 'suspended', created: new Date(now - HOUR).toISOString(), share: { cpu: 1, ram: 3, disk: 20 }, ownShare: false, use: null },
];

// The script's account half (helpers, shares, the menu and the cards), with fetch answering from `ACCOUNTS`.
async function page() {
  const d = dom();
  const calls = [];
  const fetch = async (path, opts) => {
    calls.push([opts.method, path]);
    const body = path === '/admin/accounts' ? { accounts: ACCOUNTS } : path.endsWith('/sign-in-link') ? { url: 'https://x/l' } : path === '/admin/links' ? { links: [] } : {};
    return { ok: true, json: async () => body };
  };
  const src = pages.ADMIN_SCRIPT;
  const part = src.slice(src.indexOf('  const said'), src.indexOf('  const what = (l)'));
  const ctx = vm.createContext({ document: d.document, fetch, Date, Math, Number, Object, JSON, String, Error, setInterval() {}, confirm: () => true });
  vm.runInContext(`${part}\n async function showLinks() {}\n Object.assign(this, { showAccounts, ago });`, ctx);
  await ctx.showAccounts();
  const cards = d.document.getElementById('account-list').children;
  const card = (name) => cards.find((c) => c.querySelector('.nm').textContent.startsWith(name));
  const buttons = (n) => n.querySelectorAll('button');
  const tick = () => new Promise((r) => setImmediate(r));
  return { ...d, ctx, calls, card, buttons, tick };
}

test('admin page: an account card shows one action and ⋯; every other action is in the menu', async () => {
  const { card, buttons, fire } = await page();
  for (const [name, inMenu] of [['ann', ['New sign-in link']], ['bob', ['Update now', 'Suspend', 'New sign-in link', 'Delete']], ['cat', ['Resume', 'New sign-in link', 'Delete']]]) {
    const c = card(name);
    const acts = c.querySelector('.acts');
    assert.deepEqual(buttons(acts).map((b) => b.textContent), ['Change share', '⋯'], name);
    const more = buttons(acts)[1];
    assert.equal(more.getAttribute('aria-label'), 'More for ' + name);
    assert.equal(more.getAttribute('aria-haspopup'), 'menu');
    assert.equal(more.getAttribute('aria-expanded'), 'false');
    assert.equal(c.querySelector('.menu'), null, 'closed until asked');
    fire(more, 'click');
    const menu = c.querySelector('.menu');
    assert.equal(menu.getAttribute('role'), 'menu');
    const items = menu.querySelectorAll('[role="menuitem"]');
    assert.deepEqual(items.map((b) => b.textContent), inMenu, name);
    assert.ok(items.every((b) => !/danger/.test(b.className)), 'Delete is plain in the menu');
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    fire(more, 'click');
    assert.equal(c.querySelector('.menu'), null, '⋯ again closes it');
  }
});

test('admin page: the menu is keyboard reachable and closes on Escape and on a click outside it', async () => {
  const { card, buttons, fire, document, root } = await page();
  const more = buttons(card('bob').querySelector('.acts'))[1];
  fire(more, 'click');
  const items = card('bob').querySelectorAll('[role="menuitem"]');
  assert.equal(document.activeElement, items[0], 'the first item has the focus');
  const menu = card('bob').querySelector('.menu');
  fire(document.activeElement, 'keydown', { key: 'ArrowDown' });
  assert.equal(document.activeElement, items[1]);
  fire(document.activeElement, 'keydown', { key: 'ArrowUp' });
  fire(document.activeElement, 'keydown', { key: 'ArrowUp' });
  assert.equal(document.activeElement, items[items.length - 1], 'it wraps around');
  fire(document.activeElement, 'keydown', { key: 'Home' });
  assert.equal(document.activeElement, items[0]);
  const esc = fire(document.activeElement, 'keydown', { key: 'Escape' });
  assert.ok(esc.defaultPrevented);
  assert.equal(menu.parentNode, null, 'Escape closes it');
  assert.equal(document.activeElement, more, 'and gives the focus back to ⋯');
  assert.equal(more.getAttribute('aria-expanded'), 'false');

  fire(more, 'click');
  fire(card('bob').querySelector('[role="menuitem"]'), 'click', {}); // a click inside does what it says, not "outside"
  fire(more, 'click');
  assert.ok(card('bob').querySelector('.menu'));
  fire(root, 'click');
  assert.equal(card('bob').querySelector('.menu'), null, 'a click outside closes it');

  // One open at a time.
  fire(more, 'click');
  fire(buttons(card('cat').querySelector('.acts'))[1], 'click');
  assert.equal(card('bob').querySelector('.menu'), null);
  assert.ok(card('cat').querySelector('.menu'));
});

test('admin page: each menu item still does its action; Delete opens the box whose button is red', async () => {
  const { card, buttons, fire, calls, tick } = await page();
  const pick = (name, text) => {
    fire(buttons(card(name).querySelector('.acts'))[1], 'click');
    const item = card(name).querySelectorAll('[role="menuitem"]').find((b) => b.textContent === text);
    fire(item, 'click');
    assert.equal(card(name).querySelector('.menu'), null, 'the menu closes on a pick');
  };
  for (const [name, text, path] of [['bob', 'Suspend', '/admin/accounts/bob/suspend'], ['bob', 'Update now', '/admin/accounts/bob/update'], ['cat', 'Resume', '/admin/accounts/cat/resume'], ['ann', 'New sign-in link', '/admin/accounts/ann/sign-in-link']]) {
    calls.length = 0;
    pick(name, text);
    await tick();
    assert.deepEqual(calls[0], ['POST', path], text);
  }
  pick('bob', 'Delete');
  const box = card('bob').querySelector('.confirm');
  assert.ok(box, 'the delete box opens in the card');
  const del = buttons(box).find((b) => b.textContent === 'Delete bob');
  assert.match(del.className, /danger/, 'red only here');
  assert.ok(buttons(card('bob')).filter((b) => /danger/.test(b.className)).every((b) => box.contains(b)));
});

test('admin page: relative dates with the full date in a title, the state as a dot and a word, a short share line', async () => {
  const { card, ctx } = await page();
  const meta = card('ann').querySelector('.meta');
  assert.match(meta.textContent, /^Joined \S+ \d+ · seen 2 h ago$/);
  assert.ok(meta.children.filter((c) => typeof c !== 'string').every((s) => s.title), 'the full date in a title');
  assert.match(card('bob').querySelector('.meta').textContent, /seen 5 min ago$/);
  assert.match(card('cat').querySelector('.meta').textContent, /· not seen yet$/);
  const state = card('cat').querySelector('.state');
  assert.equal(state.textContent, 'Suspended');
  assert.equal(state.className, 'state warn');
  assert.equal(card('ann').querySelector('.pill'), null, 'no pill');
  const notes = (n) => card(n).querySelectorAll('.note').map((s) => s.textContent);
  assert.deepEqual(notes('ann').slice(0, 1), ['Computer on · default share']);
  assert.ok(notes('bob').includes('Computer off · own share'));
  assert.ok(notes('cat').includes('Default share: 1 CPU · 3 GB RAM · 20 GB disk'), 'without the bars the line holds the numbers');
  const t = Date.parse('2026-10-29T12:00:00Z');
  assert.equal(ctx.ago('2026-10-29T11:59:40Z', t), 'just now');
  assert.equal(ctx.ago('2026-10-29T11:15:00Z', t), '45 min ago');
  assert.equal(ctx.ago('2026-10-28T09:00:00Z', t), '1 d ago');
  assert.doesNotMatch(ctx.ago('2026-10-01T09:00:00Z', t), /ago/, 'older than a week: the day');
});

test('admin page: the state is no uppercase pill, and the meters are right-aligned in tabular figures', () => {
  const html = pages.admin();
  const rule = (sel) => (html.match(new RegExp(`\\n${sel.replace(/[.*]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';
  assert.doesNotMatch(rule('.state'), /uppercase/);
  assert.match(rule('.use .r'), /text-align: right/);
  assert.match(rule('.use .r'), /tabular-nums/);
});
