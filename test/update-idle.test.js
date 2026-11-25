// Whether the account is idle (#1688, ADR 053's switch waits for it): GET /api/update/idle, asked by the front door
// alone. Nothing a restart would cut off is going or queued, nothing starts within 30 minutes, and the owner has not
// written in the last 10. The pieces are tested here too: the verdict, the Chief's jobs' next run, the next look and
// the room turns in flight.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');
const idleLib = require('../lib/update-idle');
const chiefJobsLib = require('../lib/chief-jobs');
const lookLib = require('../lib/look');
const cron = require('../lib/cron');
const roomTurn = require('../lib/room-turn');

const MIN = 60_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();
const FD = { 'x-botdot-room': '1' };

// ---------- the verdict ----------

test('idle: nothing working, nothing within 30 minutes, the owner quiet for 10', () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  const at = (nextStartAt, lastOwnerMessageAt = null, working = 0) => idleLib.assess({ working, nextStartAt, lastOwnerMessageAt, now });
  assert.deepEqual(at(null), { idle: true, working: 0, nextStartAt: null, lastOwnerMessageAt: null });
  assert.equal(idleLib.SOON_MS, 30 * MIN);
  assert.equal(idleLib.OWNER_QUIET_MS, 10 * MIN);
  assert.equal(at('2026-11-25T12:40:00.000Z').idle, true, 'a job in 40 minutes');
  assert.equal(at('2026-11-25T12:20:00.000Z').idle, false, 'a job in 20 minutes');
  assert.equal(at('2026-11-25T12:30:00.000Z').idle, false, 'exactly 30 minutes is not more than 30');
  assert.equal(at('2026-11-25T12:30:01.000Z').idle, true);
  assert.equal(at('2026-11-25T11:50:00.000Z').idle, false, 'one that is due and has not started');
  assert.equal(at(null, '2026-11-25T11:45:00.000Z').idle, true, 'the owner wrote 15 minutes ago');
  assert.equal(at(null, '2026-11-25T11:55:00.000Z').idle, false, 'the owner wrote 5 minutes ago');
  assert.equal(at(null, '2026-11-25T11:50:00.000Z').idle, false, 'exactly 10 minutes is not more than 10');
  assert.equal(at(null, null, 1).idle, false, 'one thing working');
  assert.deepEqual(at('2026-11-25T12:20:00.000Z', '2026-11-25T11:55:00.000Z', 2), { idle: false, working: 2, nextStartAt: '2026-11-25T12:20:00.000Z', lastOwnerMessageAt: '2026-11-25T11:55:00.000Z' });
});

test('the earliest of the times, ISO or null; a time that is no time is no time', () => {
  assert.equal(idleLib.earliest([]), null);
  assert.equal(idleLib.earliest([null, undefined, 'soon', NaN]), null);
  assert.equal(idleLib.earliest([new Date('2026-11-25T13:00:00Z'), '2026-11-25T12:00:00Z', null, Date.parse('2026-11-25T14:00:00Z')]), '2026-11-25T12:00:00.000Z');
  assert.equal(idleLib.isoOrNull(0), null, 'no message yet is 0 ms');
  assert.equal(idleLib.isoOrNull(Date.parse('2026-11-25T12:00:00Z')), '2026-11-25T12:00:00.000Z');
});

// ---------- the Chief's jobs: the next run ----------

test("the Chief's jobs say when the first of them runs next", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const jobs = chiefJobsLib.create(dir);
  const now = new Date('2026-11-25T12:00:00Z');
  assert.equal(jobs.nextRun(now), null, 'none');
  const daily = jobs.add({ name: 'Morning', task: 'Look.', cron: '0 8 * * *' });
  const eight = cron.next('0 8 * * *', now).toISOString(); // the clock of the machine the test runs on
  assert.equal(jobs.nextRun(now), eight);
  const hourly = jobs.add({ name: 'Hourly', task: 'Look.', cron: '30 * * * *' });
  assert.equal(jobs.nextRun(now), '2026-11-25T12:30:00.000Z', 'the earliest of them');
  jobs.update(hourly.id, { on: false });
  assert.equal(jobs.nextRun(now), eight, 'a job that is off never runs');
  jobs.remove(daily.id);
  const once = jobs.add({ name: 'Once', task: 'Look.', at: new Date(Date.now() + 3 * 3600_000).toISOString() });
  assert.equal(jobs.nextRun(new Date()), once.at, 'a one-time job at its moment');
  jobs.remove(once.id);
  assert.equal(jobs.nextRun(now), null);
});

test('a one-time job whose moment has passed and has not run is due now', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const jobs = chiefJobsLib.create(dir);
  const job = jobs.add({ name: 'Once', task: 'Look.', at: new Date(Date.now() + 3600_000).toISOString() });
  const later = new Date(Date.parse(job.at) + 5 * MIN);
  assert.equal(jobs.nextRun(later), later.toISOString(), 'botdot runs it as soon as it is back');
});

// ---------- the next look ----------

test('the next look: the next of the day\'s times, none when looks are off', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let at = new Date('2026-11-25T10:00:00Z');
  const config = { quietHours: { start: 22, end: 7, timeZone: 'UTC' }, unaskedPerDay: 8, lookTimes: ['09:00', '16:00'] };
  const looks = lookLib.create({ dataDir: dir, settings: { get: () => config }, busy: () => false, input: () => ({}), run: async () => '', post: () => {}, now: () => at });
  assert.equal(looks.nextAt(), '2026-11-25T16:00:00.000Z', 'the owner\'s own times, the next one today');
  at = new Date('2026-11-25T17:30:30Z');
  assert.equal(looks.nextAt(), '2026-11-26T09:00:00.000Z', 'tomorrow\'s first once today\'s are over, to the minute');
  config.lookTimes = [];
  assert.equal(looks.nextAt(), '2026-11-25T17:50:00.000Z', 'spread over the day: 07:50, then every 1 h 40 min, nine in all');
  config.unaskedPerDay = 0;
  assert.equal(looks.nextAt(), null, 'looks are off');
});

// ---------- a room turn in flight ----------

test('a room turn that Claude is still answering counts as work', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const t = roomTurn.create({
    account: 'bob', bot: () => ({ id: 'b1', name: 'Scout', description: '' }), mayAnswer: () => true, claudeOut: () => false,
    ask: () => held.then(() => 'Tomatoes.'), llmOf: () => ({ model: 'sonnet', effort: '' }), log: () => {},
  });
  const before = roomTurn.going();
  const turn = t.turn({ bot: 'b1', room: { id: 'r1', name: 'Garden club' }, messages: [{ account: 'ann', name: 'Ann', bot: false, text: 'hi' }] });
  assert.equal(roomTurn.going(), before + 1);
  release();
  await turn;
  assert.equal(roomTurn.going(), before, 'and no more when its reply is there');
});

test('what is working is every kind of work added up, and a look, a checkup or a kept page is one session', () => {
  const parts = { runs: 0, scripts: 0, queued: 0, chiefTurns: 0, look: false, keep: false, room: 0 };
  const idle = idleLib.create({
    bots: { workingCount: () => ({ runs: parts.runs, scripts: parts.scripts, queued: parts.queued }), bots: { list: () => [] }, nextRun: () => null },
    chief: { activeCount: () => parts.chiefTurns, lookBusy: () => parts.look, keepBusy: () => parts.keep, chiefJobs: { nextRun: () => null }, nextReminderAt: () => null, looks: { nextAt: () => null } },
    roomTurns: { going: () => parts.room }, activity: { lastMessageAt: () => 0 },
  });
  assert.equal(idle.working(), 0);
  for (const [key, how] of [['runs', 2], ['scripts', 1], ['queued', 3], ['chiefTurns', 1], ['room', 2]]) {
    Object.assign(parts, { runs: 0, scripts: 0, queued: 0, chiefTurns: 0, room: 0, [key]: how });
    assert.equal(idle.working(), how, key);
  }
  Object.assign(parts, { runs: 0, scripts: 0, queued: 0, chiefTurns: 0, room: 0, look: true });
  assert.equal(idle.working(), 1, 'a look');
  parts.keep = true;
  assert.equal(idle.working(), 1, 'a look and a page being kept share one session: still one');
  parts.look = false;
  assert.equal(idle.working(), 1, 'a page being kept');
  assert.deepEqual(idle.report(), { idle: false, working: 1, nextStartAt: null, lastOwnerMessageAt: null });
});

// ---------- the route ----------

let srv;
before(async () => {
  srv = await startServer();
  // No look is due within the half hour whatever the hour of the day the test runs at.
  assert.equal((await srv.api('/settings/writing-first', { method: 'PUT', body: { perDay: 0 } })).status, 200);
});
after(async () => { srv.unhold(); await srv.stop(); });

const idle = async (headers = FD) => srv.api('/update/idle', { headers });

test('a fresh account is idle, and says what it knows', async () => {
  const r = await idle();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { idle: true, working: 0, nextStartAt: null, lastOwnerMessageAt: null });
});

test('only the front door asks: not a person through it, not the Chief, not a bot, and only with a GET', async () => {
  // A person's request: the front door strips the header from it (front-door.js PASSED_OFF), so it reaches here without.
  assert.equal((await idle({})).status, 403, "a person's request has no x-botdot-room");
  const direct = (headers) => fetch(`http://127.0.0.1:${srv.botdotPort}/api/update/idle`, { headers });
  assert.equal((await direct({ 'X-Chief-Key': srv.chiefKey, 'x-botdot-room': '1' })).status, 403, "not on the front door's socket");
  assert.equal((await direct({ 'x-botdot-room': '1' })).status, 403);
  assert.equal((await srv.api('/update/idle', { method: 'POST', headers: FD })).status, 405);
});

test('a job that starts in 20 minutes keeps it from being idle, and one in 40 does not', async () => {
  const bot = await makeBot(srv, { name: 'Clockwork' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Soon', kind: 'ai', prompt: 'Look.', at: ahead(20 * MIN) } })).data;
  assert.ok(job.id, JSON.stringify(job));
  let r = (await idle()).data;
  assert.equal(r.idle, false);
  assert.equal(r.working, 0);
  assert.equal(r.nextStartAt, job.at, 'the job\'s moment');
  assert.equal((await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { at: ahead(40 * MIN) } })).status, 200);
  r = (await idle()).data;
  assert.equal(r.idle, true);
  assert.ok(Date.parse(r.nextStartAt) - Date.now() > 39 * MIN, r.nextStartAt);
  assert.equal((await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } })).status, 200);
  assert.equal((await idle()).data.nextStartAt, null, 'a job that is off never starts');
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test("a reminder due in 20 minutes, and the Chief's own job", async () => {
  const reminder = (await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Call Ann.', at: ahead(20 * MIN) } })).data;
  assert.ok(reminder.id, JSON.stringify(reminder));
  let r = (await idle()).data;
  assert.equal(r.idle, false);
  assert.equal(r.nextStartAt, reminder.at);
  await srv.api(`/chief/reminders/${reminder.id}`, { method: 'DELETE' });
  assert.equal((await idle()).data.idle, true);
  const job = (await srv.api('/chief/jobs', { method: 'POST', body: { name: 'Soon', task: 'Look.', at: ahead(25 * MIN) } })).data;
  assert.ok(job.id, JSON.stringify(job));
  r = (await idle()).data;
  assert.deepEqual([r.idle, r.nextStartAt], [false, job.at]);
  await srv.api(`/chief/jobs/${job.id}`, { method: 'DELETE' });
  assert.equal((await idle()).data.nextStartAt, null);
});

test('the earliest of the jobs, the reminders and the looks is the time it gives', async () => {
  await srv.api('/settings/writing-first', { method: 'PUT', body: { perDay: 8 } });
  const bot = await makeBot(srv, { name: 'Clockwork' });
  const far = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Far', kind: 'ai', prompt: 'Look.', at: ahead(5 * 3600_000) } })).data;
  const reminder = (await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Call Ann.', at: ahead(2 * 3600_000) } })).data;
  const next = (await idle()).data.nextStartAt;
  assert.ok(Date.parse(next) <= Date.parse(reminder.at), 'a look or the reminder, whichever is first');
  assert.ok(Date.parse(next) > Date.now() - MIN);
  await srv.api('/settings/writing-first', { method: 'PUT', body: { perDay: 0 } });
  assert.equal((await idle()).data.nextStartAt, reminder.at, 'with looks off: the reminder');
  await srv.api(`/chief/reminders/${reminder.id}`, { method: 'DELETE' });
  assert.equal((await idle()).data.nextStartAt, far.at, 'then the bot\'s job');
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test("a bot's job run going on and a script job each count as work", async () => {
  const bot = await makeBot(srv, { name: 'Worker' });
  srv.hold();
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Long', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Work.' } })).data;
  const ran = (await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data;
  const rec = await srv.nextRun((x) => x.self?.env && x.stdin.includes('Work.'), "the bot's job run");
  let r = (await idle()).data;
  assert.deepEqual([r.working, r.idle], [1, false], 'the run of a job the owner did not message');
  srv.release(rec);
  await srv.finished(ran.run.id);
  srv.unhold();
  assert.equal((await idle()).data.working, 0, 'and it ends');

  // A script job: no Claude Code, only its shell.
  const script = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Sleeper', kind: 'script', cron: '0 4 1 1 *', script: 'sleep 3', timeoutSeconds: 30 } })).data;
  assert.ok(script.id, JSON.stringify(script));
  const started = await srv.api(`/bots/${bot.id}/jobs/${script.id}/run`, { method: 'POST' });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  r = (await waitFor(async () => { const x = (await idle()).data; return x.working >= 1 ? x : null; }, { what: 'the script to be working' }));
  assert.equal(r.idle, false);
  await waitFor(async () => ((await idle()).data.working === 0 ? true : null), { what: 'the script to have ended', timeout: 20_000 });
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

// The owner's message sets lastOwnerMessageAt, so what follows is on a server of its own: the tests above need it null.
test("the owner's message, runs going, a message that waits its turn and a Chief turn", async (t) => {
  const own = await startServer();
  t.after(async () => { own.unhold(); await own.stop(); });
  await own.api('/settings/writing-first', { method: 'PUT', body: { perDay: 0 } });
  const bot = await makeBot(own, { name: 'Busy' });
  const idleOwn = async () => (await own.api('/update/idle', { headers: FD })).data;
  assert.deepEqual(await idleOwn(), { idle: true, working: 0, nextStartAt: null, lastOwnerMessageAt: null });

  const before = Date.now();
  const first = await heldRun(own, bot, 'First.');
  let r = await idleOwn();
  assert.equal(r.working, 1);
  assert.equal(r.idle, false);
  assert.ok(Date.parse(r.lastOwnerMessageAt) >= before - 1000 && Date.parse(r.lastOwnerMessageAt) <= Date.now(), r.lastOwnerMessageAt);

  // A bot works on up to three runs at once (ADR 062); a fourth message waits its turn, on disk: work a restart would lose.
  const held = [first, await heldRun(own, bot, 'Second.'), await heldRun(own, bot, 'Third.')];
  assert.equal((await idleOwn()).working, 3);
  const fourth = await own.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Fourth.' } });
  assert.equal(fourth.status, 201, JSON.stringify(fourth.data));
  assert.equal((await own.api(`/bots/${bot.id}`)).data.queued.length, 1, 'it waits for a run to end');
  assert.equal((await idleOwn()).working, 4, 'three runs and the message waiting');

  // A Chief turn.
  const chat = (await own.api('/chief/chats', { method: 'POST', body: {} })).data;
  const sent = await own.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Hello Chief.' } });
  assert.ok(sent.status < 300, JSON.stringify(sent.data));
  const chief = await own.nextRun((x) => x.stdin?.includes('Hello Chief.'), "the Chief's turn");
  assert.equal((await idleOwn()).working, 5, 'and the Chief');

  for (const h of held) own.release(h.rec);
  own.release(chief);
  own.unhold();
  const queued = await own.nextRun((x) => x.stdin?.includes('Fourth.'), 'the message that waited, run in its turn');
  own.release(queued);
  await waitFor(async () => ((await idleOwn()).working === 0 ? true : null), { what: 'all of it to end', timeout: 20_000 });
  r = await idleOwn();
  assert.equal(r.idle, false, 'nothing is going, but the owner wrote a moment ago');
  assert.ok(r.lastOwnerMessageAt);
});
