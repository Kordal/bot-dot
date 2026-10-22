// Token usage (#301): every result event of a bot's run, a group's turn and the Chief's turn adds its tokens to the day
// (the account's) and the bot, in the account's own data folder, with no cost; a range gives the totals, the bots and
// every day; 400 days are kept; and only the owner of that account reads it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const usageLib = require('../lib/usage');
const { startServer, makeBot, waitFor } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
const result = (u = {}) => ({
  type: 'result', is_error: false, result: 'Done.', total_cost_usd: 0.25,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, ...u },
});
// A clock that can be moved: the store reads it at each call.
const clock = (iso) => { let t = new Date(iso); return { now: () => t, set: (x) => { t = new Date(x); } }; };

test('a result adds its four token counts to the day and the bot, never its cost; the Chief has a row of its own', () => {
  const c = clock('2026-10-22T10:00:00Z');
  const u = usageLib.create(tmp(), { now: c.now, timeZone: () => 'UTC' });
  assert.equal(u.record('b1', result(), 'Researcher'), true);
  u.record('b1', result({ input_tokens: 1 }), 'Researcher');
  u.record(null, result());
  assert.equal(u.record('b1', { type: 'assistant' }), false, 'only a result counts');
  assert.equal(u.record('b1', { type: 'result', usage: {} }), false, 'a result with nothing used adds nothing');
  const r = u.range({ from: '2026-10-22', to: '2026-10-22' }, { botName: (id) => (id === 'b1' ? 'Researcher' : null), chiefName: 'Chief of Staff' });
  assert.deepEqual(r.totals, { inputTokens: 21, outputTokens: 15, cacheReadTokens: 300, cacheWriteTokens: 60, totalTokens: 396, runs: 3 });
  assert.deepEqual(r.bots.map((b) => [b.id, b.name, b.chief || false, b.runs, b.totalTokens]), [['b1', 'Researcher', false, 2, 261], [null, 'Chief of Staff', true, 1, 135]]);
  assert.deepEqual(r.days, [{ day: '2026-10-22', ...r.totals }]);
  assert.equal(r.timeZone, 'UTC');
});

test('fromResult reads Claude Code\'s fields and ignores what is not a count', () => {
  assert.deepEqual(usageLib.fromResult(result()), { input: 10, output: 5, cacheRead: 100, cacheWrite: 20 });
  assert.deepEqual(usageLib.fromResult({ type: 'result', usage: { input_tokens: 'x', output_tokens: -3, cache_read_input_tokens: 7 } }), { input: 0, output: 0, cacheRead: 7, cacheWrite: 0 });
  assert.equal(usageLib.fromResult({ type: 'result', total_cost_usd: 0.5, usage: {} }), null, 'a cost alone is nothing: no cost is kept');
  assert.equal(usageLib.fromResult({ type: 'result' }), null);
  assert.equal(usageLib.fromResult(null), null);
});

test('a day is the account\'s day, in its time zone', () => {
  const c = clock('2026-10-22T23:30:00Z');
  const u = usageLib.create(tmp(), { now: c.now, timeZone: () => 'Europe/Warsaw' });
  u.record('b1', result(), 'A');
  assert.equal(u.range().today, '2026-10-23', 'already the 23rd in Warsaw');
  assert.equal(u.range({ from: '2026-10-23', to: '2026-10-23' }).totals.runs, 1);
  assert.equal(u.range({ from: '2026-10-22', to: '2026-10-22' }).totals.runs, 0);
});

test('a range gives every day in it, zeros too, and the bots over all of it; a bot that is gone keeps its last name', () => {
  const c = clock('2026-10-20T12:00:00Z');
  const dir = tmp();
  const u = usageLib.create(dir, { now: c.now, timeZone: () => 'UTC' });
  u.record('b1', result(), 'Old Name');
  c.set('2026-10-22T12:00:00Z');
  u.record('b2', result({ output_tokens: 500 }), 'Writer');
  const r = usageLib.create(dir, { now: c.now, timeZone: () => 'UTC' }).range({ from: '2026-10-19', to: '2026-10-22' }, { botName: (id) => (id === 'b2' ? 'Writer' : null) });
  assert.deepEqual(r.days.map((d) => [d.day, d.runs]), [['2026-10-19', 0], ['2026-10-20', 1], ['2026-10-21', 0], ['2026-10-22', 1]]);
  assert.deepEqual(r.bots.map((b) => [b.id, b.name, !!b.gone]), [['b2', 'Writer', false], ['b1', 'Old Name', true]]);
  assert.equal(r.bots[0].outputTokens, 500);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'), /cost/i, 'no cost in the file');
  // Only what is inside the range.
  assert.deepEqual(u.range({ from: '2026-10-21', to: '2026-10-22' }).bots.map((b) => b.id), ['b2']);
  // No from or to: today.
  assert.deepEqual([u.range().from, u.range().to], ['2026-10-22', '2026-10-22']);
  // One of them: that day alone.
  assert.deepEqual([u.range({ from: '2026-10-20' }).from, u.range({ from: '2026-10-20' }).to], ['2026-10-20', '2026-10-20']);
  assert.deepEqual([u.range({ to: '2026-10-21' }).from, u.range({ to: '2026-10-21' }).to], ['2026-10-21', '2026-10-21']);
});

test('a range that is not one is refused with a 400', () => {
  const u = usageLib.create(tmp(), { now: () => new Date('2026-10-22T12:00:00Z'), timeZone: () => 'UTC' });
  for (const q of [{ from: '2026-13-01', to: '2026-10-22' }, { from: 'yesterday' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-10-22', to: '2026-10-01' }, { from: '2025-01-01', to: '2026-10-22' }]) {
    assert.throws(() => u.range(q), (e) => e.status === 400, JSON.stringify(q));
  }
  assert.equal(u.range({ from: '2025-09-18', to: '2026-10-22' }).days.length, 400, 'exactly 400 days is fine');
});

test('days older than 400 days are dropped when something is recorded', () => {
  const c = clock('2025-09-01T12:00:00Z');
  const dir = tmp();
  const u = usageLib.create(dir, { now: c.now, timeZone: () => 'UTC' });
  u.record('b1', result(), 'A'); // 2025-09-01
  c.set('2025-09-20T12:00:00Z');
  u.record('b1', result(), 'A'); // 2025-09-20
  c.set('2026-10-22T12:00:00Z'); // 400 days back, 2025-09-18, is the oldest day kept
  u.record('b1', result(), 'A');
  const kept = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8')).days);
  assert.deepEqual(kept.sort(), ['2025-09-20', '2026-10-22']);
  assert.equal(usageLib.KEEP_DAYS, 400);
});

test('each account has its own: usage.json in its own data folder', () => {
  const t = { now: () => new Date('2026-10-22T12:00:00Z'), timeZone: () => 'UTC' };
  const one = tmp(), two = tmp();
  usageLib.create(one, t).record('b1', result(), 'A');
  assert.ok(fs.existsSync(path.join(one, 'usage.json')));
  assert.equal(fs.existsSync(path.join(two, 'usage.json')), false);
  assert.equal(usageLib.create(two, t).range().totals.runs, 0);
});

test('the route: a bot\'s run and a Chief turn are counted for this account, the owner reads them, the Chief is refused', async () => {
  const srv = await startServer();
  try {
    assert.ok((await srv.api('/version')).data.features.includes('token-usage'));
    const empty = (await srv.api('/usage')).data;
    assert.equal(empty.totals.totalTokens, 0);
    assert.equal(empty.from, empty.today);
    const bot = await makeBot(srv, { name: 'Counter' });
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Count.' } })).data;
    await srv.finished(run.id);
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Hello' } });
    const r = await waitFor(async () => {
      const d = (await srv.api('/usage')).data;
      return d.bots?.length === 2 ? d : null;
    }, { what: 'both rows' });
    // The stand-in Claude reports 100 in, 20 out, 300 read, 40 written and $0.01 a result.
    const counter = r.bots.find((b) => b.id === bot.id);
    assert.deepEqual([counter.name, counter.inputTokens, counter.outputTokens, counter.cacheReadTokens, counter.cacheWriteTokens, counter.runs], ['Counter', 100, 20, 300, 40, 1]);
    assert.ok(r.bots.some((b) => b.chief && b.inputTokens >= 100));
    assert.equal(r.days.length, 1);
    assert.equal(r.days[0].day, r.today);
    assert.doesNotMatch(JSON.stringify(r), /cost/i, 'no cost in the answer');
    assert.ok(fs.existsSync(path.join(srv.data, 'usage.json')), 'kept in the account\'s data folder');
    assert.equal((await srv.api('/usage?from=2026-10-22&to=2026-10-01')).status, 400);
    assert.equal((await srv.api('/usage?from=nope')).status, 400);
    assert.equal((await srv.asChief('/usage')).status, 403, 'the Chief\'s tools never read it');
    assert.equal((await srv.api('/usage', { method: 'POST', body: {} })).status, 405);
  } finally { await srv.stop(); }
});

test('the route: another account on the machine sees none of it', async () => {
  const a = await startServer({ account: 'first' });
  const b = await startServer({ account: 'second' });
  try {
    const bot = await makeBot(a);
    const run = (await a.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Count.' } })).data;
    await a.finished(run.id);
    await waitFor(async () => (await a.api('/usage')).data.totals.runs >= 1, { what: 'the run counted' });
    assert.equal((await b.api('/usage')).data.totals.runs, 0);
    assert.deepEqual((await b.api('/usage')).data.bots, []);
  } finally { await a.stop(); await b.stop(); }
});
