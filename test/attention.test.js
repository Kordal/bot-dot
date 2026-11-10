// Attention (ADR 175): what botdot notices by itself between the Chief's looks (signals), what stays open (the agenda),
// and the one item that starts a look now (wake): a weight-3 item does, once; a new weight-2 item is put to Jev once,
// when the admin chose Jev, and waits for the next look otherwise.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const attention = require('../lib/attention');

const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi); // this machine's clock, as projects keep it
const NOW = local(2026, 10, 14, 9, 0);
const project = (over = {}) => ({
  id: 'p1', name: 'Fernhill', phase: 'running',
  events: [
    { id: 'e1', title: 'Launch call', day: '2026-10-14', time: '09:45' },
    { id: 'e2', title: 'Review', day: '2026-10-14', time: '10:30' },
    { id: 'e3', title: 'Late', day: '2026-10-14', time: '15:00' },
    { id: 'e4', title: 'Gone', day: '2026-10-14', time: '08:00' },
    { id: 'e5', title: 'All day', day: '2026-10-14' },
  ],
  todos: [
    { id: 't1', text: 'Send the deck', due: '2026-10-14' },
    { id: 't2', text: 'Call the printer', due: '2026-10-11', bot: 'b1' },
    { id: 't3', text: 'Tomorrow', due: '2026-10-15' },
    { id: 't4', text: 'Done', due: '2026-10-10', done: true },
  ],
  ...over,
});

test('signals: a timed event within two hours, today\'s and overdue to-dos, a card waiting 12 hours; nothing of a project not running', () => {
  const asks = [{ id: 'c1', at: new Date(NOW - 13 * 3600e3).toISOString(), text: 'Asks to send mail' }, { id: 'c2', at: new Date(NOW - 3600e3).toISOString(), text: 'Fresh' }];
  const found = attention.signals({ projects: [project(), project({ id: 'p2', phase: 'setup' })], asks, nameOfBot: (b) => (b === 'b1' ? 'Outreach' : b), now: NOW });
  assert.deepEqual(found.map((f) => [f.key, f.weight]), [
    ['event:p1:e1:2026-10-14', 3],
    ['event:p1:e2:2026-10-14', 2],
    ['todo:p1:t1:2026-10-14', 1],
    ['todo:p1:t2:2026-10-11', 2],
    ['card:c1', 2],
  ]);
  assert.equal(found[0].text, 'Fernhill: "Launch call" starts at 09:45, in 45 min');
  assert.equal(found[3].text, 'Fernhill: to-do overdue since 2026-10-11: Call the printer (Outreach)');
  assert.equal(found[4].text, 'A card waits in Needs you for 13 h: Asks to send mail');
});

test('the agenda keeps what is open, closes what is gone, and is written only when it changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-agenda-'));
  const a = attention.create({ dataDir: dir, config: () => ({ router: 'haiku' }) });
  const first = a.refresh(attention.signals({ projects: [project()], now: NOW }), NOW);
  assert.deepEqual(first.map((i) => i.weight), [3, 2, 2, 1], 'the weightiest first');
  const file = path.join(dir, 'agenda.json');
  const written = fs.statSync(file).mtimeMs;
  a.refresh(attention.signals({ projects: [project()], now: NOW }), NOW);
  assert.equal(fs.statSync(file).mtimeMs, written, 'nothing changed, nothing written');
  const later = new Date(NOW.getTime() + 60_000);
  const left = a.refresh(attention.signals({ projects: [project({ todos: [] })], now: later }), later);
  assert.deepEqual(left.map((i) => i.kind), ['event', 'event'], 'the to-dos ticked are closed');
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).items['todo:p1:t1:2026-10-14'].closedAt);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wake: a weight-3 item starts a look once; without Jev a weight-2 item waits for the next look', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-agenda-'));
  let asked = 0;
  const a = attention.create({ dataDir: dir, config: () => ({ router: 'haiku' }), fetch: async () => { asked++; throw new Error('not asked'); } });
  a.refresh(attention.signals({ projects: [project()], now: NOW }), NOW);
  const item = await a.wake({ now: NOW });
  assert.equal(item.key, 'event:p1:e1:2026-10-14');
  a.woke(item.key, NOW);
  assert.equal(await a.wake({ now: NOW }), null, 'once');
  assert.equal(asked, 0, 'no Jev, nothing asked');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wake with Jev: each weight-2 item is asked once; a likely "now" starts a look', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-agenda-'));
  const bodies = [];
  const answers = [0.2, 0.9];
  const fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ answers: { now: { noul: answers.shift() } } }) }; };
  const a = attention.create({ dataDir: dir, config: () => ({ router: 'jev', key: 'k-12345678' }), fetch, log: () => {} });
  const asks = [{ id: 'c1', at: new Date(NOW - 13 * 3600e3).toISOString(), text: 'Asks to send mail' }];
  a.refresh(attention.signals({ projects: [project({ events: [] })], asks, now: NOW }), NOW);
  const item = await a.wake({ now: NOW, nextLook: '11:10' });
  assert.equal(bodies.length, 2, 'asked one by one until one is likely');
  assert.equal(bodies[0].state.next_look, '11:10');
  assert.match(bodies[0].state.noticed, /Call the printer/);
  assert.equal(item.key, 'card:c1');
  assert.equal(item.gate, 0.9);
  assert.equal(await a.wake({ now: NOW }), null, 'each is asked once');
  assert.equal(bodies.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('what a look is told: why it starts now, and the open items', () => {
  const items = [{ key: 'event:x', kind: 'event', weight: 3, text: 'Fernhill: "Launch call" starts at 09:45, in 45 min' }, { key: 'card:c1', kind: 'card', weight: 2, text: 'A card waits' }];
  const block = attention.promptBlock(items, items[0]);
  assert.match(block, /^Why this look starts now: Fernhill: "Launch call" starts at 09:45, in 45 min\. Raise it first/);
  assert.match(block, /- \[now\] Fernhill: "Launch call"/);
  assert.match(block, /- \[today\] A card waits/);
  assert.equal(attention.promptBlock([]), '');
});

test('a quiet kind starts no look (P6)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-agenda-'));
  const a = attention.create({ dataDir: dir, config: () => ({ router: 'haiku' }) });
  a.refresh(attention.signals({ projects: [project()], now: NOW }), NOW);
  assert.equal(await a.wake({ now: NOW, quiet: ['event'] }), null);
  assert.equal((await a.wake({ now: NOW })).kind, 'event');
  fs.rmSync(dir, { recursive: true, force: true });
});
