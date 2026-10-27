// The account's usage summary (ADR 105, #607): one finished UTC day as counts alone, for the front door and nobody
// else, with the owner's activity counted per day (lib/activity.js) and the ledger's runs (ADR 099).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot } = require('./helpers');
const activityLib = require('../lib/activity');
const { validDay } = require('../lib/routes/usage-summary');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const summary = (day, headers = { 'x-botdot-room': '1' }) => srv.api(`/usage-summary?day=${day}`, { headers });

test('the front door gets a finished day as counts, with no name in it', async () => {
  const bot = await makeBot(srv, { name: 'Secretname' });
  const r = await summary(yesterday());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.day, yesterday());
  assert.ok(r.data.bots >= 1);
  assert.equal(typeof r.data.version, 'string');
  assert.deepEqual(Object.keys(r.data.features).sort(), ['boat', 'computer', 'connectors', 'groups', 'jobs', 'pages', 'rooms', 'scripts', 'vaultLogins']);
  for (const k of ['runs', 'errors', 'cards']) assert.equal(typeof r.data[k], 'object');
  assert.ok(Array.isArray(r.data.failures));
  for (const k of ['counted', 'reasked', 'corrected', 'messages', 'web', 'android']) assert.ok(Number.isInteger(r.data[k]), k);
  assert.equal(typeof r.data.active, 'boolean');
  assert.ok(!JSON.stringify(r.data).includes('Secretname'), 'no name of a bot');
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test('only a finished day, only a date, and only the front door', async () => {
  assert.equal((await summary(new Date().toISOString().slice(0, 10))).status, 400, 'today has not ended');
  assert.equal((await summary('2026-02-30')).status, 400);
  assert.equal((await summary('yesterday')).status, 400);
  assert.equal((await summary(yesterday(), {})).status, 403, "a person's request: the front door strips the header from theirs");
  const chief = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/usage-summary?day=${yesterday()}`, { headers: { 'X-Chief-Key': srv.chiefKey, 'x-botdot-room': '1' } });
  assert.equal(chief.status, 403);
});

test('validDay takes a real date only', () => {
  assert.equal(validDay('2026-10-26'), true);
  for (const d of ['2026-13-01', '2026-02-30', '26-10-26', '', '2026-10-26T00:00']) assert.equal(validDay(d), false, d);
});

test('activity: the app of a request, the owner\'s messages, cards and the median answer, per UTC day', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.parse('2026-10-20T10:00:00Z');
  const a = activityLib.create(dir, { now: () => now });
  assert.equal(activityLib.clientOf('okhttp/4.12.0'), 'android');
  assert.equal(activityLib.clientOf('Mozilla/5.0 (Linux; Android 14; wv)'), 'android');
  assert.equal(activityLib.clientOf('curl/8'), null);
  assert.deepEqual(a.day('2026-10-20'), { active: false, web: 0, android: 0, messages: 0, cards: { shown: 0, answered: 0, medianAnswerMs: null } });
  a.saw('GET', '/api/bots', 'Mozilla/5.0');
  a.saw('POST', '/api/bots/b1/run', 'okhttp/4');
  a.saw('POST', '/api/chief/chats/c1/messages', 'Mozilla/5.0');
  a.saw('POST', '/api/group-chats/g1/messages', 'curl/8');
  a.saw('POST', '/api/bots/b1', 'Mozilla/5.0');
  a.cardShown(); a.cardShown(); a.cardShown();
  a.cardAnswered(new Date(now - 60_000).toISOString());
  a.cardAnswered(new Date(now - 180_000).toISOString());
  a.cardAnswered('not a date');
  assert.deepEqual(a.day('2026-10-20'), { active: true, web: 3, android: 1, messages: 3, cards: { shown: 3, answered: 3, medianAnswerMs: 120_000 } });
  // Kept on disk; a day past KEEP_DAYS goes.
  a.flush();
  assert.deepEqual(activityLib.create(dir, { now: () => now }).day('2026-10-20').messages, 3);
  now += (activityLib.KEEP_DAYS + 1) * 864e5;
  const later = activityLib.create(dir, { now: () => now });
  later.saw('GET', '/api/bots', 'Mozilla/5.0');
  later.flush();
  assert.equal(activityLib.create(dir, { now: () => now }).day('2026-10-20').active, false);
  assert.equal(activityLib.median([5, 1, 3]), 3);
});
