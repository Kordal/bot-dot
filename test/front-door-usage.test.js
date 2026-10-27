// How the accounts use botdot, on the admin page (ADR 105, #607): the front door asks each account's botdot server
// (a stand-in here) for every finished day it lacks, keeps counts alone for 13 months, and shows the admin totals and
// one row per account. Nobody but the admin sees them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { waitFor } = require('./helpers');
const usageLib = require('../lib/front-door/usage');

const DAY = 864e5;
const scratch = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const row = (over = {}) => ({ version: '1.2.3', bots: 1, active: true, runs: { done: 2, failed: 1 }, errors: { timeout: 1 }, counted: 2, reasked: 1, corrected: 1, messages: 3, web: 5, android: 1, cards: { shown: 1, answered: 1, medianAnswerMs: 1000 }, features: { groups: true, jobs: true }, ...over });

test('clean keeps counts, yes-or-no and a version, and nothing else', () => {
  const r = usageLib.clean({ version: 'v1 <b>', bots: -2, runs: { done: 3, nope: 9, failed: 1.5 }, errors: { timeout: 2, 'Error: secret text': 1 }, active: 'yes', features: { groups: true, pages: 'yes', other: true }, cards: { shown: 1, medianAnswerMs: -1 }, name: 'Secret', text: 'Secret' });
  assert.equal(r.version, null);
  assert.equal(r.bots, 0);
  assert.deepEqual(r.runs, { done: 3 });
  assert.deepEqual(r.errors, { timeout: 2 });
  assert.equal(r.active, false);
  assert.equal(r.features.groups, true);
  assert.equal(r.features.pages, false);
  assert.ok(!('other' in r.features));
  assert.deepEqual(r.cards, { shown: 1, answered: 0, medianAnswerMs: null });
  assert.ok(!JSON.stringify(r).includes('Secret'));
});

test('collect asks for each finished day it lacks, from the account\'s first day, and stops at one that fails', async (t) => {
  const dir = scratch(t);
  let now = Date.parse('2026-10-20T08:00:00Z');
  const u = usageLib.open(dir, { now: () => now });
  const asked = [];
  let down = new Set();
  const ask = async (name, day) => { asked.push(`${name} ${day}`); return down.has(name) ? { status: 0, data: null } : { status: 200, data: row() }; };
  await u.collect([{ name: 'ann', created: '2026-10-01T00:00:00Z' }, { name: 'bob', created: '2026-10-18T15:00:00Z' }], ask);
  assert.deepEqual(asked, ['ann 2026-10-13', 'ann 2026-10-14', 'ann 2026-10-15', 'ann 2026-10-16', 'ann 2026-10-17', 'ann 2026-10-18', 'ann 2026-10-19', 'bob 2026-10-18', 'bob 2026-10-19']);
  assert.equal(fs.statSync(path.join(dir, 'usage.json')).mode & 0o777, 0o600);
  asked.length = 0;
  await u.collect([{ name: 'ann', created: '2026-10-01T00:00:00Z' }, { name: 'bob', created: '2026-10-18T15:00:00Z' }], ask);
  assert.deepEqual(asked, [], 'nothing new to ask');
  // Next day bob doesn't answer: tried once, asked again the next time.
  now += DAY; down = new Set(['bob']);
  await u.collect([{ name: 'ann', created: '2026-10-01T00:00:00Z' }, { name: 'bob', created: '2026-10-18T15:00:00Z' }], ask);
  assert.deepEqual(asked, ['ann 2026-10-20', 'bob 2026-10-20']);
  down = new Set(); asked.length = 0;
  await u.collect([{ name: 'ann', created: '2026-10-01T00:00:00Z' }, { name: 'bob', created: '2026-10-18T15:00:00Z' }], ask);
  assert.deepEqual(asked, ['bob 2026-10-20']);
  // An account no longer listed loses its rows; forget does it at once.
  await u.collect([{ name: 'ann', created: '2026-10-01T00:00:00Z' }], ask);
  assert.deepEqual(usageLib.open(dir, { now: () => now }).rowsOf('bob'), {});
  u.forget('ann');
  assert.deepEqual(usageLib.open(dir, { now: () => now }).rowsOf('ann'), {});
});

test('rows older than 13 months go', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify({ rows: { ann: { '2025-01-01': usageLib.clean(row()), '2026-10-10': usageLib.clean(row()) } } }));
  const u = usageLib.open(dir, { now: () => Date.parse('2026-10-20T08:00:00Z') });
  await u.collect([{ name: 'ann', created: '2024-01-01T00:00:00Z' }], async () => ({ status: 200, data: row() }));
  assert.ok(!('2025-01-01' in u.rowsOf('ann')));
  assert.ok('2026-10-10' in u.rowsOf('ann'));
});

test('report: weekly active, activation, week 1 and week 4, failures, features and the correction rate', async (t) => {
  const dir = scratch(t);
  const now = Date.parse('2026-11-30T08:00:00Z'); // yesterday: 2026-11-29
  const rows = {};
  const days = (from, n, make) => { const out = {}; for (let i = 0; i < n; i++) { const d = dayOf(Date.parse(`${from}T00:00:00Z`) + i * DAY); out[d] = usageLib.clean(make(i, d)); } return out; };
  // ann: made 2026-10-20, a bot and a good run on day one, active every day until its fifth week.
  rows.ann = days('2026-10-20', 41, (i) => row({ active: i < 34, runs: { done: 1 }, errors: {} }));
  // bob: made 2026-11-01, no bot in its first two days, never a good run, gone after week 1.
  rows.bob = days('2026-11-01', 29, (i) => row({ bots: i < 2 ? 0 : 1, runs: i < 2 ? {} : { failed: 1 }, errors: i < 2 ? {} : { timeout: 1 }, active: i < 7, counted: 1, corrected: 0, features: { groups: false, pages: true } }));
  fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify({ rows }));
  const u = usageLib.open(dir, { now: () => now });
  const r = u.report([{ name: 'ann', created: '2026-10-20T09:00:00Z' }, { name: 'bob', created: '2026-11-01T09:00:00Z' }, { name: 'cy', created: '2026-11-29T09:00:00Z' }]);
  assert.equal(r.day, '2026-11-29');
  assert.equal(r.totals.accounts, 3);
  assert.equal(r.totals.weeklyActive, 0, 'ann stopped after week 5, bob after week 1');
  assert.deepEqual([r.totals.activated, r.totals.activationKnown], [1, 2]);
  const ann = r.accounts.find((a) => a.name === 'ann');
  const bob = r.accounts.find((a) => a.name === 'bob');
  const cy = r.accounts.find((a) => a.name === 'cy');
  assert.deepEqual(ann.activation, { bot: true, run: true });
  assert.deepEqual(bob.activation, { bot: false, run: false });
  assert.deepEqual(cy.activation, { bot: null, run: null }, 'not known yet');
  assert.deepEqual(ann.retention, { week1: true, week4: true });
  assert.deepEqual(bob.retention, { week1: false, week4: null }, 'its fifth week has not ended');
  assert.deepEqual([r.totals.week1, r.totals.week1Of, r.totals.week4, r.totals.week4Of], [1, 2, 1, 1]);
  assert.equal(r.totals.errors.timeout, 27, "bob's timeouts over the last 30 days");
  assert.deepEqual([r.totals.features.groups, r.totals.features.pages, r.totals.features.jobs], [1, 1, 1]);
  assert.deepEqual([bob.counted, bob.corrected], [29, 0]);
  assert.deepEqual([ann.counted, ann.corrected], [60, 30], 'the last 30 days only');
  assert.equal(bob.version, '1.2.3');
  assert.equal(cy.lastDay, null);
});

test('the admin page shows the usage collected from each account; nobody else reaches it', async (t) => {
  const answer = (req) => (req.url.startsWith('/api/usage-summary?day=') ? [200, row({ day: req.url.slice(-10), name: 'Secretbot' })] : null);
  const door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', BOT_DOT_USAGE_FIRST_MS: '200', BOT_DOT_USAGE_EVERY_MS: '300' } });
  const ann = await standIn(door, 'ann', { answer });
  t.after(async () => { await door.stop(); ann.close(); });
  const a = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await a.post(`${door.firstLink.path}/options`, { name: 'ann' });
  assert.equal((await a.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) })).status, 201);
  // ann was made today: no finished day of hers yet, and the page says nothing was counted.
  const page = (await a.get('/admin')).text;
  assert.ok(page.includes('<section id="usage"><h2>Usage'));
  const empty = await a.get('/admin/usage');
  assert.equal(empty.status, 200);
  assert.equal(empty.data.totals.accounts, 1);
  assert.equal(empty.data.accounts[0].lastDay, null);
  // Made a week ago (as if): her past days are asked for, as the front door itself.
  const file = path.join(door.data, 'front-door.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.accounts.ann.created = new Date(Date.now() - 3 * DAY).toISOString();
  fs.writeFileSync(file, JSON.stringify(d));
  await waitFor(async () => ((await a.get('/admin/usage')).data.accounts[0].lastDay ? true : null), { what: 'the usage to be collected' });
  const asked = ann.seen.filter((r) => r.url.startsWith('/api/usage-summary'));
  assert.equal(asked[0].headers['x-botdot-room'], '1');
  const r = (await a.get('/admin/usage')).data;
  assert.equal(r.accounts[0].lastDay, dayOf(Date.now() - DAY));
  assert.ok(r.accounts[0].runs > 0);
  assert.ok(!JSON.stringify(r).includes('Secretbot'), 'what an account adds is not kept');
  assert.equal((await door.browser().get('/admin/usage')).status, 401);
});
