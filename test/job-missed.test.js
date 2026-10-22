// A job that did not run says why (BUSY-004; docs/api.md, "A job's line"): botdot was off, its last run was still
// going, too much was waiting, Claude was signed out. And while Claude is signed out no job is started, a one-time
// job waits for the sign-in, and what waits for a bot stays waiting.
// The first half loads lib/bots.js itself and hands the scheduler its clock; the second starts a server, for what
// the apps and the Chief read. No test waits for a minute to come.
// Tests here count on work for a busy bot waiting its turn: one run of a bot at a time (ADR 062 lets three go at
// once, and at that limit the same holds).
process.env.BOT_DOT_RUNS_MAX = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-missed-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'), TZ: 'UTC',
});
fs.mkdirSync(process.env.HOME);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const B = require('../lib/bots');
const { lastDueBetween } = require('../lib/jobs');

const readData = (file, data = B.DATA_DIR) => JSON.parse(fs.readFileSync(path.join(data, file), 'utf8'));
const hold = () => fs.writeFileSync(path.join(out, 'hold'), '');
const letGo = () => fs.rmSync(path.join(out, 'hold'), { force: true });
after(() => { letGo(); B.claudeIs(true); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });
B.settings.update({ quietHours: { start: 0, end: 0, timeZone: 'UTC' } });

const AI = { kind: 'ai', prompt: 'Check it' };
const botWith = (name, jobs) => B.bots.create({ name, emoji: '🧪', prompt: 'Do the task.', jobs });
const jobsOf = (bot) => B.bots.get(bot.id).jobs;
const done = (bot) => B.bots.update(bot.id, { jobs: jobsOf(bot).map((j) => ({ ...j, enabled: false })) });
const ended = (bot, n) => waitFor(() => { const all = B.listRuns({ botId: bot.id }); return all.length === n && all.every((m) => m.status !== 'running') ? all : null; }, { what: `${n} ended runs of ${bot.name}` });
const NEVER_NOW = '0 0 29 2 *';
// The scheduler's clock, a minute of its own for each look, well away from the real one.
let clock = Date.parse('2031-03-10T10:30:20Z');
const nextMinute = () => new Date(clock += 60_000);
const minute = (d) => `${d.toISOString().slice(0, 16)}:00.000Z`;

test('the time a repeating job missed: the latest between the last look and now', () => {
  const at = (cron, after, before) => lastDueBetween({ cron }, new Date(after), new Date(before))?.toISOString() || null;
  assert.equal(at('0 * * * *', '2026-10-06T07:15:00Z', '2026-10-06T10:30:20Z'), '2026-10-06T10:00:00.000Z', 'three were missed: the latest');
  assert.equal(at('30 8 * * *', '2026-10-06T07:15:00Z', '2026-10-06T10:30:20Z'), '2026-10-06T08:30:00.000Z');
  assert.equal(at('0 23 * * *', '2026-10-06T07:15:00Z', '2026-10-06T10:30:20Z'), null, 'its time was not in between');
  assert.equal(at('30 10 * * *', '2026-10-06T07:15:00Z', '2026-10-06T10:30:20Z'), null, 'this minute is not missed: the scheduler looks at it now');
  assert.equal(at('15 7 * * *', '2026-10-06T07:15:00Z', '2026-10-06T10:30:20Z'), null, 'nor the minute it last looked at');
  assert.equal(at('* * * * *', '2026-09-01T00:00:00Z', '2026-10-06T10:30:20Z'), '2026-10-06T10:29:00.000Z', 'off for weeks');
  assert.equal(at('0 9 1 9 *', '2026-08-20T00:00:00Z', '2026-10-06T10:30:20Z'), '2026-09-01T09:00:00.000Z', 'a rare job, long ago');
  assert.equal(at('not a schedule', '2026-08-20T00:00:00Z', '2026-10-06T10:30:20Z'), null);
});

test('botdot was off: a repeating job whose time passed says so, once, for the latest time, and is not run for it', async () => {
  const bot = botWith('Was Off', [
    { ...AI, name: 'Hourly', cron: '0 * * * *' }, { ...AI, name: 'Morning', cron: '30 8 * * *' }, { ...AI, name: 'Evening', cron: '0 23 * * *' },
    { ...AI, name: 'Switched off', cron: '0 * * * *', enabled: false },
    { ...AI, name: 'Some day', at: '2031-03-10T09:00' }, // a one-time job is caught up, not missed
  ]);
  // A script job the Chief set up waits for the owner's OK.
  B.bots.update(bot.id, { jobs: [...jobsOf(bot), { name: 'Not approved', kind: 'script', script: 'echo hi', cron: '0 * * * *' }] }, { by: 'chief' });
  const [hourly, morning, evening, off, once, waits] = jobsOf(bot);
  assert.deepEqual([off.enabled, waits.approved], [false, false]);
  const now = new Date('2031-03-10T10:30:20Z');
  // A first start, with no look on record: nothing was missed.
  B.missedWhileOff(now);
  assert.deepEqual(jobsOf(bot).map((j) => B.jobLast(j.id)), [null, null, null, null, null, null]);
  fs.writeFileSync(path.join(B.DATA_DIR, 'scheduler.json'), JSON.stringify({ lookedAt: '2031-03-10T07:15:00.000Z' }));
  B.missedWhileOff(now);
  assert.deepEqual(B.jobLast(hourly.id, now), { status: 'missed', at: '2031-03-10T10:00:00.000Z', text: 'Did not run at 10:00: botdot was off.' });
  assert.deepEqual(B.jobLast(morning.id, now), { status: 'missed', at: '2031-03-10T08:30:00.000Z', text: 'Did not run at 08:30: botdot was off.' });
  assert.equal(B.jobLast(morning.id, new Date('2031-03-11T09:00:00Z')).text, 'Did not run on 10 Mar at 08:30: botdot was off.', 'a day later, with its day');
  assert.deepEqual([evening, off, once, waits].map((j) => B.jobLast(j.id)), [null, null, null, null], 'a job that had no time, is switched off or waits for the OK gets none');
  assert.deepEqual(B.listRuns({ botId: bot.id }), [], 'nothing is run for a missed time');
  // The scheduler writes down the minute it looked at.
  done(bot);
  B.tick(now);
  assert.deepEqual(readData('scheduler.json'), { lookedAt: '2031-03-10T10:30:00.000Z' });
  B.missedWhileOff(new Date('2031-03-10T10:30:50Z'));
  assert.equal(B.jobLast(hourly.id).at, '2031-03-10T10:00:00.000Z', 'the same minute: nothing new');
});

test('a script whose last run is still going: its time passes with that line, and "Run now" says it was skipped', async () => {
  const bot = botWith('Slow Script', [{ name: 'Slow', kind: 'script', cron: '* * * * *', script: 'while [ ! -f "$BOT_WORKSPACE/go" ]; do sleep 0.05; done' }]);
  const [job] = jobsOf(bot);
  B.tick(nextMinute());
  assert.equal(B.jobLast(job.id), null, 'it is running');
  const at = nextMinute();
  B.tick(at);
  assert.deepEqual(B.jobLast(job.id, at), { status: 'missed', at: minute(at), text: `Did not run at ${minute(at).slice(11, 16)}: its last run was still going.` });
  assert.deepEqual(B.runJob(B.bots.get(bot.id), job, 'manual'), { skipped: 'Its last run is still going.' });
  done(bot);
  fs.writeFileSync(path.join(B.WORKSPACES_DIR, bot.id, 'go'), '');
  const last = await waitFor(() => { const l = B.jobLast(job.id); return l.status === 'quiet' ? l : null; }, { what: 'the script to end' });
  assert.match(last.text, /^Last run (at|on \d+ \w+ at) \d\d:\d\d: nothing to report\.$/);
  const { scriptRun, ...ran } = B.runJob(B.bots.get(bot.id), job, 'manual'); // scriptRun: the id its run would have, not for clients
  assert.deepEqual([ran, typeof scriptRun], [{ started: 'script' }, 'string']);
  await waitFor(() => B.jobLast(job.id).at > last.at, { what: 'that run to end' });
});

test('too much waiting: a job that meets a full queue says so, and "Run now" says that the job waits', async () => {
  const bot = botWith('Crowded', [{ ...AI, name: 'Due', cron: '* * * * *' }, ...Array.from({ length: 10 }, (_, i) => ({ ...AI, name: `Other ${i}`, cron: NEVER_NOW }))]);
  const [due, ...others] = jobsOf(bot);
  hold();
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  for (const j of others) assert.equal(B.runJob(B.bots.get(bot.id), j, 'manual').queued, true);
  const at = nextMinute();
  B.tick(at);
  assert.deepEqual(B.jobLast(due.id, at), { status: 'missed', at: minute(at), text: `Did not run at ${minute(at).slice(11, 16)}: Crowded had 10 things waiting.` });
  done(bot);
  for (const j of others) assert.equal(B.takeJobAway(bot.id, `job:${j.id}`), true);
  B.stopRun(first.id);
  await ended(bot, 1);
  letGo();
});

test('Claude signed out: no job is started, each says so, its row does not grow, and a one-time job waits for the sign-in, a day at most', async (t) => {
  t.after(() => B.claudeIs(true));
  const first = nextMinute();
  const onceAt = new Date(first.getTime());
  onceAt.setSeconds(0, 0);
  const bot = botWith('Signed Out', [
    { ...AI, name: 'Every minute', cron: '* * * * *' },
    { ...AI, name: 'Once', at: onceAt.toISOString() },
    { name: 'Script', kind: 'script', cron: '* * * * *', script: 'echo hi' },
    { ...AI, name: 'Switched off', cron: '* * * * *', enabled: false },
  ]);
  const [every, once, script, off] = jobsOf(bot);
  // One failure of a row from before the sign-out.
  fs.writeFileSync(path.join(out, 'fail.txt'), 'boom');
  B.bots.update(bot.id, { jobs: jobsOf(bot).map((j) => ({ ...j, enabled: j.id === every.id })) });
  B.tick(new Date(first.getTime() - 5 * 60_000));
  await ended(bot, 1);
  fs.rmSync(path.join(out, 'fail.txt'));
  assert.equal(B.jobLast(every.id).failures, 1);
  B.bots.update(bot.id, { jobs: jobsOf(bot).map((j) => ({ ...j, enabled: j.id !== off.id })) });

  B.claudeIs(false);
  B.tick(first);
  const why = (at) => ({ status: 'missed', at, text: `Did not run at ${at.slice(11, 16)}: Claude was signed out.` });
  assert.deepEqual([every, once, script].map((j) => B.jobLast(j.id, first)), [why(minute(first)), why(onceAt.toISOString()), why(minute(first))]);
  assert.equal(B.jobLast(off.id), null, 'a job that is switched off gets none');
  assert.equal(B.listRuns({ botId: bot.id }).length, 1, 'nothing was started');
  assert.equal(B.jobState.get(every.id).row.failures, 1, 'not a failure of the row');
  // The one-time job stays among the bot's jobs and is tried each minute.
  assert.deepEqual([jobsOf(bot).map((j) => j.id).includes(once.id), readData('queue.json').oneTimeRetryTimes[once.id]], [true, onceAt.toISOString()]);
  B.tick(nextMinute());
  assert.equal(B.listRuns({ botId: bot.id }).length, 1);
  assert.equal(B.jobLast(once.id).at, onceAt.toISOString(), "its line keeps the job's time");

  // Signed in again: the one-time job runs, and is gone; the others run at their next time.
  B.bots.update(bot.id, { jobs: jobsOf(bot).map((j) => ({ ...j, enabled: j.id === once.id })) });
  B.claudeIs(true);
  B.tick(nextMinute());
  const [ran] = await ended(bot, 2);
  assert.deepEqual([ran.jobId, ran.oneTime, ran.status, jobsOf(bot).map((j) => j.id).includes(once.id)], [once.id, true, 'success', false]);
  assert.equal(readData('queue.json').oneTimeRetryTimes[once.id], undefined);

  // Signed out for more than a day after a one-time job's time: it waits no longer, stays among the bot's jobs with
  // its line, and does not run after the sign-in.
  const lateAt = new Date(onceAt.getTime() + 3600_000);
  B.bots.update(bot.id, { jobs: [{ ...AI, name: 'Too late', at: lateAt.toISOString() }] });
  const [tooLate] = jobsOf(bot);
  B.claudeIs(false);
  B.tick(lateAt);
  assert.equal(readData('queue.json').oneTimeRetryTimes[tooLate.id], lateAt.toISOString(), 'it waits for the sign-in');
  B.tick(new Date(lateAt.getTime() + 24 * 3600_000));
  assert.equal(readData('queue.json').oneTimeRetryTimes[tooLate.id], lateAt.toISOString(), 'a day: still');
  const dayLater = new Date(lateAt.getTime() + 24 * 3600_000 + 60_000);
  B.tick(dayLater);
  assert.equal(readData('queue.json').oneTimeRetryTimes[tooLate.id], undefined);
  B.claudeIs(true);
  B.tick(new Date(dayLater.getTime() + 60_000));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(B.listRuns({ botId: bot.id }).length, 2, 'it did not run');
  assert.deepEqual([jobsOf(bot).map((j) => j.id), B.jobLast(tooLate.id, dayLater).text], [[tooLate.id], `Did not run on ${lateAt.getDate()} Mar at ${lateAt.toISOString().slice(11, 16)}: Claude was signed out.`]);
  done(bot);
});

test('what waits for a bot stays waiting while Claude is signed out, and goes on with the sign-in', async (t) => {
  t.after(() => { B.claudeIs(true); letGo(); });
  const bot = botWith('Keeps Waiting', []);
  hold();
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  const mine = B.askBot(bot, { prompt: 'And this' }).queued;
  assert.equal(mine.status, 'queued');
  // The sign-out ends the run that was going; the message that waited does not start to fail as not signed in.
  B.claudeIs(false);
  B.stopRun(first.id, 'signout');
  await ended(bot, 1);
  await new Promise((r) => setTimeout(r, 50)); // past the moment the queue would have gone on
  assert.deepEqual([B.isBotRunning(bot.id), B.waitingRun(mine.id)?.status, B.queuedOf(bot.id).map((x) => x.id)], [false, 'queued', [mine.id]]);
  assert.deepEqual(readData('queue.json').queues[bot.id].map((x) => x.runId), [mine.id], 'on disk, as before');
  // The owner can still take another message's place in line, or take this one back; here they sign in.
  B.claudeIs(true);
  await waitFor(() => B.readMeta(mine.id)?.status === 'running', { what: 'the waiting message to start' });
  letGo();
  const [ran] = await ended(bot, 2);
  assert.deepEqual([ran.id, ran.status], [mine.id, 'success']);
});

test('while Claude is signed out, other work that comes up waits behind what is held for the sign-in', async (t) => {
  t.after(() => { B.claudeIs(true); letGo(); });
  const bot = botWith('In Line', [{ ...AI, name: 'First', cron: NEVER_NOW, prompt: 'The first job' }, { ...AI, name: 'Second', cron: NEVER_NOW, prompt: 'The second job' }]);
  const [one, two] = jobsOf(bot);
  hold();
  const going = B.askBot(bot, { prompt: 'Something long' }).run;
  assert.equal(B.runJob(B.bots.get(bot.id), one, 'manual').queued, true);
  B.claudeIs(false);
  B.stopRun(going.id, 'signout');
  await ended(bot, 1);
  // The bot is free and a job's run waits: "Run now" of another job does not start past it, to fail as not signed in.
  assert.equal(B.runJob(B.bots.get(bot.id), two, 'manual').queued, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([B.listRuns({ botId: bot.id }).length, readData('queue.json').queues[bot.id].map((x) => x.jobId)], [1, [one.id, two.id]]);
  letGo();
  B.claudeIs(true);
  const runs = await ended(bot, 3);
  assert.deepEqual(runs.map((r) => [r.jobId, r.status]), [[two.id, 'success'], [one.id, 'success'], [null, 'error']], 'in the order they waited');
});

// ---------- what the apps and the Chief read ----------

const jobsApi = async (srv, bot) => (await srv.api(`/bots/${bot.id}`)).data.jobs;
// The feed from an event on, as an app that connects again reads it: the events it missed, by type.
async function feedSince(srv, id) {
  const ac = new AbortController();
  const res = await fetch(`${srv.base}/api/events?since=${encodeURIComponent(id)}`, { signal: ac.signal });
  const reader = res.body.getReader();
  let text = '';
  // What was missed follows the hello at once: read on for a moment after it, then hang up.
  let until = null;
  for (;;) {
    const next = await Promise.race([reader.read(), ...(until ? [until] : [])]);
    if (!next || next.done) break;
    text += Buffer.from(next.value).toString();
    if (!until && text.includes('event: hello')) until = new Promise((r) => setTimeout(r, 150));
  }
  ac.abort();
  const events = text.split('\n\n').map((c) => ({ id: c.match(/^id: (.*)$/m)?.[1], type: c.match(/^event: (.*)$/m)?.[1], data: JSON.parse(c.match(/^data: (.*)$/m)?.[1] || '{}') })).filter((e) => e.type);
  return { hello: events.find((e) => e.type === 'hello').data, missed: events.filter((e) => e.id) };
}

test('after botdot was off, the job, the bot and the Chief read the same line; a job that waits makes "Run now" say so', async (t) => {
  let srv = await startServer();
  try {
    assert.ok((await srv.api('/version')).data.features.includes('job-line'));
    const bot = await makeBot(srv, { name: 'Reader', emoji: '📖' });
    const due = new Date(Date.now() - 5 * 60_000); // five minutes ago, and not again for most of an hour
    due.setSeconds(0, 0);
    const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Hourly', cron: `${due.getUTCMinutes()} * * * *`, prompt: 'Check it' } })).data;
    assert.equal(job.last, null);
    await waitFor(() => fs.existsSync(path.join(srv.data, 'scheduler.json')), { what: "the scheduler's first look" });
    await srv.stop();
    fs.writeFileSync(path.join(srv.data, 'scheduler.json'), JSON.stringify({ lookedAt: new Date(due.getTime() - 3 * 3600_000).toISOString() }));
    srv = await startServer({ dir: srv.dir });
    const [seen] = await waitFor(async () => { const jobs = await jobsApi(srv, bot); return jobs[0].last ? jobs : null; }, { what: "the job's line" });
    assert.deepEqual([seen.last.status, seen.last.at], ['missed', due.toISOString()]);
    assert.match(seen.last.text, /^Did not run (at|on \d+ \w+ at) \d\d:\d\d: botdot was off\.$/);
    assert.ok(seen.last.text.includes(`${due.toISOString().slice(11, 16)}: `), 'the time of the day, in the time zone of the server');
    assert.deepEqual(Object.keys(seen.last).sort(), ['at', 'status', 'text'], 'what is on record besides stays on the server');
    assert.deepEqual((await srv.api(`/bots/${bot.id}/jobs`)).data[0].last, seen.last);
    assert.deepEqual((await srv.api('/bots')).data.find((b) => b.id === bot.id).jobs[0].last, seen.last);
    assert.deepEqual((await srv.api(`/runs?botId=${bot.id}`)).data, [], 'it is not run for that time');
    // The Chief reads the same line: in every bot's summary and in get_bot.
    const tools = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
    assert.deepEqual((await tools.json('list_bots')).find((b) => b.id === bot.id).jobs[0].last, { status: 'missed', text: seen.last.text });
    assert.equal((await tools.json('get_bot', { id: bot.id })).jobs[0].last.text, seen.last.text);
    // "Run now" while the bot is busy: the job waits.
    const going = await heldRun(srv, bot, 'Something long');
    assert.deepEqual((await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data, { queued: true });
    srv.release(going.rec);
    srv.unhold();
    await waitFor(async () => { const r = (await srv.api(`/runs?botId=${bot.id}`)).data; return r.length === 2 && r.every((x) => x.status === 'success'); }, { what: 'both runs' });
    assert.match((await jobsApi(srv, bot))[0].last.text, /^Last run (at|on \d+ \w+ at) \d\d:\d\d: done\.$/);
  } finally { srv.unhold(); await srv.stop(); }
});

test('Claude signed out: the feed says so though no app listened, what waits stays, also through a restart, and with the sign-in it goes on', async () => {
  let srv = await startServer();
  const signedOut = path.join(srv.out, 'signed-out');
  try {
    const bot = await makeBot(srv, { name: 'Left Waiting', emoji: '🚪' });
    const { hello } = await feedSince(srv, '');
    assert.deepEqual(hello.claude, { loggedIn: true });
    const first = await heldRun(srv, bot, 'Something long');
    const mine = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'And this' } })).data;
    assert.equal(mine.status, 'queued');

    // The owner signs out, with no app on the feed.
    fs.writeFileSync(signedOut, '');
    const out = await srv.api('/setup/claude', { method: 'DELETE' });
    assert.deepEqual([out.status, out.data.claude.loggedIn, out.data.stopped], [200, false, 1]);
    const ended = await srv.finished(first.run.id);
    assert.deepEqual([ended.status, ended.endedBy], ['error', 'signout']);
    await new Promise((r) => setTimeout(r, 100)); // past the moment the queue would have gone on
    assert.equal((await srv.api(`/runs/${mine.id}?events=0`)).data.status, 'queued', 'it did not start, to fail as not signed in');
    assert.deepEqual((await srv.api('/bots')).data.find((b) => b.id === bot.id).queued.map((x) => x.id), [mine.id]);
    // An app that connects again is told: the event was sent when the state changed, not when someone listened.
    let since = await feedSince(srv, hello.lastEventId);
    assert.deepEqual(since.hello.claude, { loggedIn: false });
    assert.deepEqual(since.missed.filter((e) => e.type === 'claude').map((e) => e.data.loggedIn), [false]);

    // botdot starts again, still signed out: it knows before it has asked Claude, and what waits still waits.
    await srv.stop();
    assert.equal(readData('scheduler.json', srv.data).signedOut, true);
    srv = await startServer({ dir: srv.dir });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await srv.api(`/runs/${mine.id}?events=0`)).data.status, 'queued');
    const again = (await feedSince(srv, '')).hello;
    assert.deepEqual(again.claude, { loggedIn: false });

    // Signed in again, which the server learns as Setup is opened: what waited starts.
    fs.rmSync(signedOut);
    assert.equal((await srv.api('/setup?fresh')).data.claude.loggedIn, true);
    const rec = await srv.nextRun((x) => x.stdin.startsWith('And this'), 'the waiting message to start');
    srv.release(rec);
    assert.equal((await srv.finished(mine.id)).status, 'success');
    since = await feedSince(srv, again.lastEventId);
    assert.deepEqual(since.missed.filter((e) => e.type === 'claude').map((e) => e.data.loggedIn), [true]);
    assert.equal(readData('scheduler.json', srv.data).signedOut, undefined);
  } finally { fs.rmSync(signedOut, { force: true }); srv.unhold(); await srv.stop(); }
});
