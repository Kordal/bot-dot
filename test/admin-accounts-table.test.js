// The admin page's accounts (#910): a table to search by part of a name, sort by name, joined, last seen, CPU, RAM and
// disk, and filter by state, all three together. A row opens what the card had (#725): the share and the update in
// words, and every action (Change share, Update now, Suspend or Resume, New sign-in link, Delete), on the same routes;
// Delete is plain there and red only in its own box. The marks stay in the row: Disk full, near its RAM, long
// commands. The admin page's own script (ADMIN_SCRIPT) runs against a small stand-in DOM.
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
    share: { cpu: 1, ram: 3, disk: 20 }, ownShare: true, use: { cpu: 0.2, ram: 2.9e9, diskUsed: 20e9, diskSize: 20e9, computers: 0, full: true },
    long: { count: 2, oldestSeconds: 1200 }, update: { canUpdate: true, autoUpdate: false } },
  { name: 'cat', state: 'suspended', created: new Date(now - HOUR).toISOString(), share: { cpu: 1, ram: 3, disk: 20 }, ownShare: false, use: null },
  { name: 'bea', state: 'stopped', created: new Date(now - 10 * 24 * HOUR).toISOString(), lastSeen: new Date(now - 26 * HOUR).toISOString(),
    share: { cpu: 2, ram: 5, disk: 30 }, ownShare: false, use: { cpu: 0, ram: 1e9, diskUsed: 30e9, diskSize: 40e9, computers: 0 } },
];

// The script's account half (helpers, shares and the table), with fetch answering from `ACCOUNTS`.
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
  const byId = (id) => d.document.getElementById(id);
  const rows = () => byId('account-rows').children.filter((r) => r.className.split(' ').includes('row'));
  const names = () => rows().map((r) => r.getAttribute('aria-label'));
  const row = (name) => rows().find((r) => r.getAttribute('aria-label') === name);
  const open = (name) => { d.fire(row(name), 'click'); return byId('account-rows').querySelector('.account'); };
  const heads = () => byId('account-head').children;
  const sort = (title) => d.fire(heads().find((th) => th.textContent === title).querySelector('button'), 'click');
  const type = (text) => { byId('account-search').value = text; d.fire(byId('account-search'), 'input'); };
  const pick = (state) => { byId('account-state').value = state; d.fire(byId('account-state'), 'change'); };
  const buttons = (n) => n.querySelectorAll('button');
  const tick = () => new Promise((r) => setImmediate(r));
  return { ...d, ctx, calls, byId, rows, names, row, open, heads, sort, type, pick, buttons, tick };
}

test('admin page: the accounts are a table sorted by name; a header sorts by its column, a second click the other way', async () => {
  const { names, heads, sort } = await page();
  assert.deepEqual(heads().map((th) => th.textContent), ['Account', 'State', 'Joined', 'Last seen', 'CPU', 'RAM', 'Disk']);
  assert.deepEqual(names(), ['ann', 'bea', 'bob', 'cat']);
  assert.equal(heads()[0].getAttribute('aria-sort'), 'ascending');
  sort('Account');
  assert.deepEqual(names(), ['cat', 'bob', 'bea', 'ann']);
  assert.equal(heads()[0].getAttribute('aria-sort'), 'descending');
  sort('Joined');
  assert.deepEqual(names(), ['cat', 'bob', 'bea', 'ann'], 'the newest first');
  assert.equal(heads()[0].getAttribute('aria-sort'), null, 'one column sorts at a time');
  sort('Joined');
  assert.deepEqual(names(), ['ann', 'bea', 'bob', 'cat']);
  sort('Last seen');
  assert.deepEqual(names(), ['bob', 'ann', 'bea', 'cat'], 'never seen goes last');
  sort('Disk');
  assert.deepEqual(names(), ['bea', 'bob', 'ann', 'cat']);
  sort('RAM');
  assert.deepEqual(names(), ['bob', 'ann', 'bea', 'cat']);
  sort('CPU');
  assert.deepEqual(names(), ['ann', 'bob', 'bea', 'cat']);
  assert.equal(heads()[1].querySelector('button'), null, 'State does not sort: it filters');
});

test('admin page: typing part of a name narrows the table, the state filter too, and both combine with the sort', async () => {
  const { names, type, pick, sort, byId } = await page();
  const states = byId('account-state').children.map((o) => [o.value, o.textContent]);
  assert.deepEqual(states, [['', 'All states'], ['running', 'Running'], ['suspended', 'Suspended'], ['stopped', 'Not running']], 'the states the accounts are in');
  type('B');
  assert.deepEqual(names(), ['bea', 'bob'], 'part of a name, any case');
  pick('running');
  assert.deepEqual(names(), ['bob']);
  type('');
  assert.deepEqual(names(), ['ann', 'bob']);
  sort('Account');
  assert.deepEqual(names(), ['bob', 'ann']);
  type('zz');
  assert.deepEqual(names(), []);
  assert.equal(byId('account-none').hidden, false, 'says that none matches');
  type('');
  pick('');
  assert.deepEqual(names(), ['cat', 'bob', 'bea', 'ann']);
  assert.equal(byId('account-none').hidden, true);
});

test('admin page: a row opens every action of today; each does it on the same route; Delete is red only in its box', async () => {
  const { open, buttons, fire, calls, tick, row, byId } = await page();
  for (const [name, acts] of [['ann', ['Change share', 'New sign-in link']], ['bob', ['Change share', 'Update now', 'Suspend', 'New sign-in link', 'Delete']], ['cat', ['Change share', 'Resume', 'New sign-in link', 'Delete']]]) {
    const box = open(name);
    assert.equal(row(name).getAttribute('aria-expanded'), 'true');
    assert.deepEqual(buttons(box).map((b) => b.textContent), acts, name);
    assert.ok(buttons(box).every((b) => !/danger/.test(b.className)), 'Delete is plain here');
    fire(row(name), 'click');
    assert.equal(byId('account-rows').querySelector('.account'), null, 'the row again closes it');
  }
  for (const [name, text, path] of [['bob', 'Suspend', '/admin/accounts/bob/suspend'], ['bob', 'Update now', '/admin/accounts/bob/update'], ['cat', 'Resume', '/admin/accounts/cat/resume'], ['ann', 'New sign-in link', '/admin/accounts/ann/sign-in-link']]) {
    const box = open(name);
    calls.length = 0;
    fire(buttons(box).find((b) => b.textContent === text), 'click');
    await tick();
    assert.deepEqual(calls[0], ['POST', path], text);
    assert.ok(byId('account-rows').querySelector('.account'), 'the row stays open after its action');
    fire(row(name), 'click');
  }
  let box = open('bob');
  fire(buttons(box).find((b) => b.textContent === 'Change share'), 'click');
  const form = box.querySelector('.confirm');
  assert.ok(form, 'the share opens under the row');
  calls.length = 0;
  fire(form.querySelector('form'), 'submit');
  await tick();
  assert.deepEqual(calls[0], ['POST', '/admin/accounts/bob/share']);
  box = byId('account-rows').querySelector('.account');
  fire(buttons(box).find((b) => b.textContent === 'Delete'), 'click');
  const del = box.querySelector('.confirm');
  const button = buttons(del).find((b) => b.textContent === 'Delete bob');
  assert.match(button.className, /danger/, 'red only here');
  assert.ok(buttons(box).filter((b) => /danger/.test(b.className)).every((b) => del.contains(b)));
  calls.length = 0;
  fire(button, 'click');
  await tick();
  assert.deepEqual(calls[0], ['POST', '/admin/accounts/bob/delete']);
});

test('admin page: a row keeps the marks, the dates relative with the full date in a title, the state a dot and a word', async () => {
  const { row, open, ctx } = await page();
  const text = (n) => n.querySelectorAll('.mark').map((m) => [m.textContent, m.className]);
  assert.deepEqual(text(row('bob')), [['Disk full', 'mark err'], ['Near its RAM', 'mark err'], ['2 long commands · 20 min', 'mark err']]);
  assert.deepEqual(text(row('ann')), []);
  const cells = (name) => row(name).children;
  assert.match(cells('ann')[2].textContent, /^\S+ \d+$/);
  assert.ok(cells('ann')[2].title && cells('ann')[3].title, 'the full date in a title');
  assert.equal(cells('ann')[3].textContent, '2 h ago');
  assert.equal(cells('cat')[3].textContent, '–', 'not seen yet');
  const state = cells('cat')[1].querySelector('.state');
  assert.deepEqual([state.textContent, state.className], ['Suspended', 'state warn']);
  assert.match(row('cat').className, /dim/);
  assert.deepEqual(cells('ann').slice(4).map((c) => c.children[0].textContent), ['1.1 / 2', '2.5 GB / 5 GB', '16 GB / 40 GB']);
  assert.deepEqual(cells('cat').slice(4).map((c) => c.textContent), ['– / 1', '– / 3 GB', '– / 20 GB'], 'the share while nothing is measured');
  assert.match(cells('bob')[6].className, /err/, 'a full disk is red');
  const lines = (name) => open(name).querySelectorAll('p').map((p) => p.textContent);
  assert.deepEqual(lines('ann'), ['Computer on · Default share: 2 CPUs · 5 GB RAM · 30 GB disk']);
  assert.deepEqual(lines('bob'), ['Computer off · Own share: 1 CPU · 3 GB RAM · 20 GB disk', 'Its owner chooses when it moves to a new version, up to the deadline.']);
  const t = Date.parse('2026-10-29T12:00:00Z');
  assert.equal(ctx.ago('2026-10-29T11:59:40Z', t), 'just now');
  assert.equal(ctx.ago('2026-10-29T11:15:00Z', t), '45 min ago');
  assert.equal(ctx.ago('2026-10-28T09:00:00Z', t), '1 d ago');
  assert.doesNotMatch(ctx.ago('2026-10-01T09:00:00Z', t), /ago/, 'older than a week: the day');
});

test('admin page: the state is no uppercase pill, and the meters are in tabular figures', () => {
  const html = pages.admin();
  const rule = (sel) => (html.match(new RegExp(`\\n${sel.replace(/[.*]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';
  assert.doesNotMatch(rule('.state'), /uppercase/);
  assert.match(rule('td.meter'), /tabular-nums/);
});

test('admin page: the rail has the groups Accounts, Usage, Sign-ups, Feedback, Audit log and Settings, every section is in one, and no note or subtitle is left', () => {
  const html = pages.admin();
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const top = nav.slice(0, nav.indexOf('<div class="subnav">'));
  assert.deepEqual([...top.matchAll(/<\/svg>([^<]+)/g)].map((m) => m[1]), ['Accounts', 'Usage', 'Sign-ups', 'Feedback', 'Audit log', 'Settings']);
  const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
  const groups = main.split('<div class="group"').slice(1);
  assert.equal(groups.length, 6);
  const sections = (g) => [...g.matchAll(/<section id="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(groups.map(sections), [['accounts'], ['usage'], ['sign-up-links'], ['feedback'], ['audit'], ['machine', 'update-section', 'rooms', 'group-router', 'replays', 'boat']]);
  assert.match(groups[5], /^ id="settings">/);
  // Every section is reachable from the rail: a group's own link, or Settings' links to each of its sections.
  for (const id of groups.flatMap(sections)) assert.ok(nav.includes(`href="#${id}"`), id);
  assert.doesNotMatch(html, /class="(note|sub)"|class="note |\.note \{|\.sub \{/);
  assert.doesNotMatch(pages.ADMIN_SCRIPT, /'note'|'note |\bnote'/);
  assert.match(html, /<h1 class="brand">/);
  assert.equal((html.match(/<h1/g) || []).length, 1);
});

// The audit log's half of the script (#911): its list, its two filters and Older, with fetch answering from `log`.
async function auditPage(log) {
  const d = dom();
  const calls = [];
  const fetch = async (path) => {
    calls.push(path);
    const q = new URL(path, 'http://x').searchParams;
    let entries = log.filter((e) => (!q.get('account') || e.account === q.get('account')) && (!q.get('action') || e.action === q.get('action')) && (!q.get('before') || e.at < q.get('before')));
    const more = entries.length > 2;
    entries = entries.slice(0, 2);
    return { ok: true, json: async () => ({ entries, more, accounts: ['bob', 'cat'], actions: ['account-made', 'suspend', 'slowed-down'] }) };
  };
  const src = pages.ADMIN_SCRIPT;
  const helpers = src.slice(src.indexOf('  const said'), src.indexOf('  // ---------- shares and load'));
  const part = src.slice(src.indexOf('  // ---------- the audit log'), src.indexOf('  // Shared rooms (ADR 060)'));
  const ctx = vm.createContext({ document: d.document, fetch, URL, URLSearchParams, Date, Math, Number, Object, JSON, String, Error, setInterval() {}, confirm: () => true });
  vm.runInContext(`${helpers}\n${part}\n Object.assign(this, { showAudit });`, ctx);
  await ctx.showAudit(false);
  const byId = (id) => d.document.getElementById(id);
  const lines = () => byId('audit-list').children.map((li) => li.textContent);
  const tick = () => new Promise((r) => setImmediate(r));
  return { ...d, byId, calls, lines, tick };
}

const LOG = [
  { at: '2026-11-03T10:03:00.000Z', actor: 'ann', action: 'suspend', account: 'bob' },
  { at: '2026-11-03T10:02:00.000Z', actor: 'front-door', action: 'slowed-down', detail: '203.0.113.9 · after failed sign-ins' },
  { at: '2026-11-03T10:01:00.000Z', actor: 'front-door', action: 'account-made', account: 'bob', detail: 'from a sign-up link' },
];

test('admin page: the audit log lists entries newest first, in words, and Older shows the ones before', async () => {
  const { byId, calls, lines, fire, tick } = await auditPage(LOG);
  assert.equal(lines().length, 2);
  assert.match(lines()[0], /^Suspended · bob/);
  assert.match(lines()[0], /ann · /);
  assert.match(lines()[1], /^Slowed down203\.0\.113\.9 · after failed sign-ins · botdot · /, "the front door's own entries are botdot's");
  assert.equal(byId('audit-more').hidden, false);
  fire(byId('audit-more'), 'click');
  await tick(); await tick();
  assert.equal(calls.at(-1), '/admin/audit?before=2026-11-03T10%3A02%3A00.000Z');
  assert.equal(lines().length, 3);
  assert.match(lines()[2], /^Account made · bob/);
  assert.equal(byId('audit-more').hidden, true);
});

test('admin page: the audit log filters by account and by action, both together', async () => {
  const { byId, calls, lines, fire, tick } = await auditPage(LOG);
  const accounts = byId('audit-account').children.slice(1).map((o) => o.value);
  assert.deepEqual(accounts, ['bob', 'cat']);
  assert.deepEqual(byId('audit-action').children.slice(1).map((o) => o.textContent), ['Account made', 'Suspended', 'Slowed down']);
  byId('audit-account').value = 'bob';
  fire(byId('audit-account'), 'change');
  await tick(); await tick();
  assert.equal(calls.at(-1), '/admin/audit?account=bob');
  assert.equal(lines().length, 2);
  byId('audit-action').value = 'account-made';
  fire(byId('audit-action'), 'change');
  await tick(); await tick();
  assert.equal(calls.at(-1), '/admin/audit?account=bob&action=account-made');
  assert.equal(lines().length, 1);
  assert.equal(byId('audit-account').value, 'bob', 'what is picked stays');
  byId('audit-account').value = 'cat';
  fire(byId('audit-account'), 'change');
  await tick(); await tick();
  assert.deepEqual(lines(), ['Nothing here yet.']);
});

test('admin page: the audit log has a rail link and its filters wrap at phone width', () => {
  const html = pages.admin();
  assert.match(html, /<a href="#audit">.*Audit log<\/a>/);
  assert.match(html, /<section id="audit"><h2>Audit log<\/h2>\n<div class="find">/);
  assert.match(html, /\.find \{ display: flex; gap: var\(--sp-12\); flex-wrap: wrap; \}/);
});
