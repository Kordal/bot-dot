// A failing job is said once and not at night (BUSY-004; docs/api.md, "A job's line"). A row is a job's failed
// scheduled runs one after another: the first is told, the rest are quiet, and a first failure in quiet hours is
// held and told once in the morning with how often the job failed since.
// This file loads lib/bots.js itself, on a scratch data folder and the stand-in for Claude, and hands the
// scheduler its clock: no test waits for a minute to come. Quiet hours are set around the real hour, since a
// run's end reads the real clock.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-row-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'), TZ: 'UTC',
});
fs.mkdirSync(process.env.HOME);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('./helpers');
const B = require('../lib/bots');
const feed = require('../lib/events');
const { withProblem } = require('../lib/problems');
const { lastOf } = require('../lib/jobs');

const events = [];
feed.subscribe((ev) => events.push(ev));
const finishedOf = (id) => events.filter((e) => e.type === 'run_finished' && e.data.id === id).map((e) => e.data);

const fails = (text = 'boom') => fs.writeFileSync(path.join(out, 'fail.txt'), text);
const works = () => fs.rmSync(path.join(out, 'fail.txt'), { force: true });
const hold = () => fs.writeFileSync(path.join(out, 'hold'), '');
const letGo = () => fs.rmSync(path.join(out, 'hold'), { force: true });
after(() => { works(); letGo(); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

const hour = new Date().getUTCHours();
const day = () => B.settings.update({ quietHours: { start: 0, end: 0, timeZone: 'UTC' } });
const night = () => B.settings.update({ quietHours: { start: hour, end: (hour + 2) % 24, timeZone: 'UTC' } }); // now, and the hour after
const MORNING_MS = 3 * 3600_000; // from now: outside those quiet hours

// The scheduler's clock: each look is at a minute of its own.
let clock = Date.now();
const nextMinute = () => new Date(clock += 60_000);

const botWith = (name, job) => B.bots.create({ name, emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Check', cron: '* * * * *', prompt: 'Check it', ...job }] });
const jobOf = (bot) => B.bots.get(bot.id).jobs[0];
// A bot's jobs are switched off when its test is over: the scheduler's later looks start nothing of it.
const done = (bot) => B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => ({ ...j, enabled: false })) });
// The bot's runs once it has `n` and none is going, newest first, each as the API sends it.
const runsOf = (bot, n) => waitFor(() => { const all = B.listRuns({ botId: bot.id }); return all.length === n && all.every((m) => m.status !== 'running') ? all.map(withProblem) : null; }, { what: `${n} ended runs of ${bot.name}` });
// The scheduler looks at the next minute; returns the bot's newest run once it has `n`.
async function scheduled(bot, n) {
  B.tick(nextMinute());
  return (await runsOf(bot, n))[0];
}
const PROBLEM = 'Something went wrong and I couldn\'t finish. It said: “boom”. The details show everything that happened.';
const hhmm = (iso) => iso.slice(11, 16);

test('the rule: a failed scheduled run of a repeating job is quiet after the first of its row, and held at night', () => {
  const { finishReport } = require('../lib/reporting');
  const failed = { trigger: 'schedule', status: 'error', jobId: 'j1', error: 'boom' };
  const at = new Date('2026-10-06T01:00:00Z');
  const nights = { start: 22, end: 7, timeZone: 'UTC' };
  const off = { start: 0, end: 0, timeZone: 'UTC' };
  const said = (meta, config, row) => { const m = { ...failed, ...meta }; finishReport(m, at, config, row); return [m.reporting, !!withProblem(m).quiet]; };
  assert.deepEqual(said({}, off, null), [undefined, false], 'the first, by day: told');
  assert.deepEqual(said({}, off, { failures: 1 }), ['quiet', true], 'a later one');
  assert.deepEqual(said({}, nights, null), ['held', true], 'the first, at night');
  assert.deepEqual(said({}, nights, { failures: 2 }), ['quiet', true], 'a later one is never held');
  assert.deepEqual(said({ trigger: 'manual' }, nights, { failures: 2 }), [undefined, false], '"Run now" and the owner\'s message');
  assert.deepEqual(said({ oneTime: true }, nights, { failures: 2 }), [undefined, false], 'a one-time job');
  assert.deepEqual(said({ endedBy: 'signout' }, off, null), ['quiet', true], 'a run a sign-out ended: the sign-out is said by itself');
  assert.deepEqual(said({ endedBy: 'limit' }, off, null), [undefined, false], 'the limit is a failure like any');
  assert.deepEqual(said({ status: 'stopped' }, nights, { failures: 2 }), [undefined, false], 'a stopped run is no failure');
  // Told in the morning, the held one says how often, when that is more than once.
  const held = { ...failed, reporting: 'delivered', deliveredAt: '2026-10-06T07:00:00.000Z' };
  assert.equal(withProblem(held).problem, 'Something went wrong and I couldn\'t finish. It said: “boom”. The details show everything that happened.');
  assert.match(withProblem({ ...held, row: { failures: 1, since: '2026-10-06T02:00:03.000Z' } }).problem, /^Something went wrong/);
  assert.match(withProblem({ ...held, row: { failures: 5, since: '2026-10-06T02:00:03.000Z' } }).problem, /^Failed 5 times since 02:00\. Something went wrong/);
  assert.equal(withProblem({ ...held, row: { failures: 5, since: '2026-10-06T02:00:03.000Z' } }).quiet, undefined);
});

test("the line under a job, in the server's words", () => {
  const now = new Date('2026-10-06T15:30:00Z');
  const line = (state, more) => lastOf(state, { now, ...more });
  assert.equal(lastOf(null), null);
  assert.equal(line({ status: 'success', at: '2026-10-06T14:00:05.000Z', runId: 'r' }).text, 'Last run at 14:00: done.');
  assert.equal(line({ status: 'quiet', at: '2026-10-06T09:00:00.000Z' }).text, 'Last run at 09:00: nothing to report.');
  assert.equal(line({ status: 'held', at: '2026-10-06T02:00:00.000Z', row: { failures: 1, since: '2026-10-06T02:00:00.000Z', held: 'r' } }).text, 'Last run at 02:00: held till morning.');
  assert.equal(line({ status: 'stopped', at: '2026-10-06T14:00:00.000Z' }).text, 'Last run at 14:00: stopped.');
  assert.equal(line({ status: 'interrupted', at: '2026-10-06T14:00:00.000Z' }).text, 'Last run at 14:00: cut off.');
  const once = line({ status: 'error', at: '2026-10-06T14:00:00.000Z', runId: 'r', row: { failures: 1, since: '2026-10-06T14:00:00.000Z' } }, { problem: 'It broke.' });
  assert.deepEqual(once, { status: 'error', at: '2026-10-06T14:00:00.000Z', runId: 'r', failures: 1, since: '2026-10-06T14:00:00.000Z', text: 'Last run at 14:00: failed. It broke.' });
  const often = line({ status: 'error', at: '2026-10-06T14:00:00.000Z', row: { failures: 5, since: '2026-10-06T02:00:00.000Z' } }, { problem: 'It broke.' });
  assert.deepEqual([often.failures, often.since, often.text], [5, '2026-10-06T02:00:00.000Z', 'Last run at 14:00: failed, 5 times in a row since 02:00. It broke.']);
  // A failure outside a row ("Run now") has no count; a result that is no failure names no row.
  assert.deepEqual(line({ status: 'error', at: '2026-10-06T14:00:00.000Z' }, { problem: 'It broke.' }), { status: 'error', at: '2026-10-06T14:00:00.000Z', text: 'Last run at 14:00: failed. It broke.' });
  assert.deepEqual(Object.keys(line({ status: 'held', at: '2026-10-06T02:00:00.000Z', row: { failures: 1, since: 'x', held: 'r' } })).sort(), ['at', 'status', 'text']);
  // A day, when it was not today.
  assert.equal(line({ status: 'success', at: '2026-10-04T14:00:00.000Z' }).text, 'Last run on 4 Oct at 14:00: done.');
  assert.equal(line({ status: 'error', at: '2026-10-06T14:00:00.000Z', row: { failures: 30, since: '2026-10-05T09:00:00.000Z' } }).text, 'Last run at 14:00: failed, 30 times in a row since 5 Oct at 09:00.');
  // A job that did not run: why, and neither the reason's own field nor the row leave the server.
  for (const why of ['botdot was off.', 'its last run was still going.', 'Reader had 10 things waiting.', 'Claude was signed out.']) {
    assert.deepEqual(line({ status: 'missed', at: '2026-10-06T08:00:00.000Z', why, row: { failures: 2, since: 'x' } }), { status: 'missed', at: '2026-10-06T08:00:00.000Z', text: `Did not run at 08:00: ${why}` });
  }
  assert.equal(line({ status: 'missed', at: '2026-10-03T08:00:00.000Z', why: 'botdot was off.' }).text, 'Did not run on 3 Oct at 08:00: botdot was off.');
});

test('said once: the first failure of a row is told, the next are quiet; a run that ends well ends the row; "Run now" is no part of it', async () => {
  day();
  const bot = botWith('Said Once', {});
  const job = jobOf(bot);
  fails();
  const first = await scheduled(bot, 1);
  const second = await scheduled(bot, 2);
  const third = await scheduled(bot, 3);
  assert.deepEqual([first, second, third].map((r) => [r.status, r.trigger, !!r.quiet, r.problem]), [['error', 'schedule', false, PROBLEM], ['error', 'schedule', true, PROBLEM], ['error', 'schedule', true, PROBLEM]]);
  // Only the first is new: one dot, one notification.
  assert.deepEqual([first, second, third].map((r) => finishedOf(r.id).map((d) => [d.quiet, !!d.new])), [[[false, true]], [[true, false]], [[true, false]]]);
  assert.deepEqual(B.unreadOfBot(bot.id), { unread: 1, firstUnread: first.id });
  // The quiet ones are in the bot's runs like any, with what went wrong.
  assert.deepEqual(B.listRuns({ botId: bot.id }).map((r) => r.id), [third.id, second.id, first.id]);
  let last = B.jobLast(job.id);
  assert.deepEqual([last.status, last.runId, last.failures, last.since], ['error', third.id, 3, first.endedAt]);
  assert.equal(last.text, `Last run at ${hhmm(last.at)}: failed, 3 times in a row since ${hhmm(first.endedAt)}. ${PROBLEM}`);

  // It works again: reported by the job's own rules (a job that reports nothing is quiet), and the row is over.
  works();
  const well = await scheduled(bot, 4);
  assert.deepEqual([well.status, well.reporting, !!well.quiet], ['success', 'quiet', true]);
  last = B.jobLast(job.id);
  assert.deepEqual([last.status, 'failures' in last, 'since' in last, last.text], ['quiet', false, false, `Last run at ${hhmm(last.at)}: nothing to report.`]);

  // A failure after that is the first of a new row.
  fails();
  const again = await scheduled(bot, 5);
  assert.deepEqual([!!again.quiet, finishedOf(again.id).map((d) => !!d.new)], [false, [true]]);
  assert.deepEqual(B.unreadOfBot(bot.id).unread, 2);
  // "Run now" fails: told at once, and no part of the row.
  const now = B.runJob(B.bots.get(bot.id), job, 'manual').run;
  const manual = (await runsOf(bot, 6))[0];
  assert.deepEqual([manual.id, manual.trigger, manual.status, !!manual.quiet, finishedOf(manual.id).map((d) => !!d.new)], [now.id, 'manual', 'error', false, [true]]);
  last = B.jobLast(job.id);
  assert.deepEqual([last.runId, last.failures, last.since], [manual.id, 1, again.endedAt]);
  // The owner's own message that fails is told too.
  const mine = B.askBot(B.bots.get(bot.id), { prompt: 'And you?' }).run;
  const asked = (await runsOf(bot, 7))[0];
  assert.deepEqual([asked.id, !!asked.quiet, finishedOf(asked.id).map((d) => !!d.new)], [mine.id, false, [true]]);
  // The next scheduled failure is the second of the row.
  const next = await scheduled(bot, 8);
  assert.deepEqual([!!next.quiet, B.jobLast(job.id).failures, B.unreadOfBot(bot.id).unread], [true, 2, 4]);
  // "Run now" that works ends the row as any run that ends well.
  works();
  B.runJob(B.bots.get(bot.id), job, 'manual');
  await runsOf(bot, 9);
  assert.deepEqual([B.jobLast(job.id).status, 'failures' in B.jobLast(job.id)], ['success', false]);
  done(bot);
});

test('not at night: a first failure in quiet hours is held, and told once in the morning with how often the job failed since', async () => {
  night();
  const bot = botWith('Night Owl', {});
  const job = jobOf(bot);
  fails();
  const first = await scheduled(bot, 1);
  assert.deepEqual([first.status, first.reporting, first.quiet, finishedOf(first.id).map((d) => [d.quiet, !!d.new])], ['error', 'held', true, [[true, false]]]);
  assert.deepEqual(B.unreadOfBot(bot.id).unread, 0);
  let last = B.jobLast(job.id);
  assert.deepEqual([last.status, last.text, 'failures' in last], ['held', `Last run at ${hhmm(last.at)}: held till morning.`, false]);
  // The failures after it are quiet, not held; the line counts them.
  const second = await scheduled(bot, 2);
  const third = await scheduled(bot, 3);
  assert.deepEqual([second.reporting, third.reporting, B.unreadOfBot(bot.id).unread], ['quiet', 'quiet', 0]);
  last = B.jobLast(job.id);
  assert.deepEqual([last.status, last.failures, last.since], ['error', 3, first.endedAt]);
  // "Run now" and the owner's own message are told at once, also at night.
  const now = B.runJob(B.bots.get(bot.id), job, 'manual').run;
  const manual = (await runsOf(bot, 4))[0];
  assert.deepEqual([manual.id, manual.reporting, !!manual.quiet, finishedOf(manual.id).map((d) => !!d.new)], [now.id, undefined, false, [true]]);
  const mine = B.askBot(B.bots.get(bot.id), { prompt: 'Still up?' }).run;
  assert.deepEqual([(await runsOf(bot, 5))[0].id, finishedOf(mine.id).map((d) => !!d.new)], [mine.id, [true]]);
  B.read.mark(`bot:${bot.id}`); // the owner read those two
  assert.equal(B.unreadOfBot(bot.id).unread, 0);

  // Still night: nothing is told. The first minute outside quiet hours: the held one, once, as new, with the count.
  B.deliverHeldReports(new Date());
  assert.equal(finishedOf(first.id).length, 1);
  done(bot);
  const morning = new Date(Date.now() + MORNING_MS);
  B.tick(morning);
  const told = withProblem(B.readMeta(first.id));
  assert.deepEqual([told.reporting, told.deliveredAt, told.quiet], ['delivered', morning.toISOString(), undefined]);
  assert.equal(told.problem, `Failed 3 times since ${hhmm(first.endedAt)}. ${PROBLEM}`);
  assert.deepEqual(finishedOf(first.id).map((d) => [d.quiet, !!d.new, d.problem]), [[true, false, PROBLEM], [false, true, told.problem]]);
  assert.deepEqual(B.unreadOfBot(bot.id), { unread: 1, firstUnread: first.id });
  // Not a second time, and the others stay as they were.
  B.tick(new Date(morning.getTime() + 60_000));
  assert.deepEqual([finishedOf(first.id).length, finishedOf(second.id).length, finishedOf(third.id).length, B.unreadOfBot(bot.id).unread], [2, 1, 1, 1]);
  // A failure of that row after the morning's line stays quiet.
  B.bots.update(bot.id, { jobs: [{ ...jobOf(bot), enabled: true }] });
  const later = await scheduled(bot, 6);
  assert.deepEqual([later.reporting, !!later.quiet, B.jobLast(job.id).failures, B.unreadOfBot(bot.id).unread], ['quiet', true, 4, 1]);
  done(bot);
});

test('at night: one failure that is alone says no count; a job that works again is still told; a row said by day is not said again', async () => {
  // Said by day, failing on into the night: quiet there, and nothing in the morning.
  day();
  const said = botWith('Said By Day', {});
  fails();
  const told = await scheduled(said, 1);
  assert.equal(!!told.quiet, false);
  night();
  const atNight = await scheduled(said, 2);
  assert.deepEqual([atNight.reporting, atNight.quiet], ['quiet', true]);
  done(said);

  // Failed once at night, then worked: the morning still says that it failed, once and without a count.
  const once = botWith('Failed Once', {});
  const first = await scheduled(once, 1);
  assert.equal(first.reporting, 'held');
  works();
  const well = await scheduled(once, 2);
  assert.equal(well.status, 'success');
  assert.equal(B.jobLast(jobOf(once).id).status, 'quiet');
  done(once);

  const before = events.length;
  B.tick(new Date(Date.now() + MORNING_MS + 10 * 60_000));
  const news = events.slice(before).filter((e) => e.type === 'run_finished').map((e) => [e.data.id, !!e.data.new, e.data.problem]);
  assert.deepEqual(news, [[first.id, true, PROBLEM]], 'only the held one');
  assert.equal(B.jobLast(jobOf(once).id).status, 'quiet', 'the job has run well since: its line stays');
  assert.equal(B.unreadOfBot(said.id).unread, 1, 'the row said by day: one new reply, the first');
});

test("a one-time job's failure is told once, as it is, also at night", async () => {
  night();
  fails();
  const at = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 5 * 60_000);
  const bot = B.bots.create({ name: 'Only Once', emoji: '1️⃣', prompt: 'Do the task.', jobs: [{ name: 'Remind', at: at.toISOString(), prompt: 'Remind me' }] });
  B.tick(at);
  const [run] = await runsOf(bot, 1);
  assert.deepEqual([run.trigger, run.oneTime, run.status, run.reporting, !!run.quiet, finishedOf(run.id).map((d) => !!d.new)], ['schedule', true, 'error', undefined, false, [true]]);
  assert.deepEqual(B.bots.get(bot.id).jobs, [], 'it ran, so it is gone');
});

test("a script job's row: its failures are said once too, and a run with nothing to report ends the row", async () => {
  day();
  const bot = botWith('Scripted', { kind: 'script', script: '[ -f "$BOT_WORKSPACE/ok" ] && exit 0; echo broken; exit 1', prompt: '' });
  const job = jobOf(bot);
  const first = await scheduled(bot, 1);
  const second = await scheduled(bot, 2);
  assert.deepEqual([first, second].map((r) => [r.kind, r.status, !!r.quiet, finishedOf(r.id).map((d) => !!d.new)]), [['script', 'error', false, [true]], ['script', 'error', true, [false]]]);
  let last = await waitFor(() => { const l = B.jobLast(job.id); return l.failures === 2 ? l : null; }, { what: 'the row of two' });
  assert.match(last.text, /^Last run at \d\d:\d\d: failed, 2 times in a row since \d\d:\d\d\. Something went wrong and I couldn't finish\. It said: “The script ended with exit code 1”\./);
  // It works, with nothing to report: no run, and the row is over.
  fs.writeFileSync(path.join(B.WORKSPACES_DIR, bot.id, 'ok'), '');
  B.tick(nextMinute());
  last = await waitFor(() => { const l = B.jobLast(job.id); return l.status === 'quiet' ? l : null; }, { what: 'the script to end well' });
  assert.deepEqual(['failures' in last, B.listRuns({ botId: bot.id }).length], [false, 2]);
  fs.rmSync(path.join(B.WORKSPACES_DIR, bot.id, 'ok'));
  const third = await scheduled(bot, 3);
  assert.deepEqual([!!third.quiet, B.jobLast(job.id).failures], [false, 1], 'the first of a new row');
  done(bot);
});

test("a run that a sign-out of Claude ended is no part of a row: a job's is quiet, the owner's own is told", async () => {
  day();
  works();
  const bot = botWith('Was Going', {});
  const job = jobOf(bot);
  hold();
  B.tick(nextMinute());
  const going = await waitFor(() => B.listRuns({ botId: bot.id, status: 'running' })[0], { what: "the job's run" });
  done(bot);
  B.stopRun(going.id, 'signout');
  const [ended] = await runsOf(bot, 1);
  assert.deepEqual([ended.status, ended.endedBy, ended.reporting, ended.quiet, ended.problem], ['error', 'signout', 'quiet', true, 'This run was stopped because Claude was signed out.']);
  assert.deepEqual(finishedOf(ended.id).map((d) => [d.quiet, !!d.new]), [[true, false]]);
  const last = B.jobLast(job.id);
  assert.deepEqual([last.status, 'failures' in last, last.text], ['error', false, `Last run at ${hhmm(last.at)}: failed. This run was stopped because Claude was signed out.`]);
  // The owner's own message: a failed run that is told, as since BUSY-003.
  const mine = B.askBot(B.bots.get(bot.id), { prompt: 'Look at this' }).run;
  await waitFor(() => fs.readdirSync(out).filter((f) => f.startsWith('run-')).length >= 2, { what: 'the run to have started' });
  B.stopRun(mine.id, 'signout');
  const [told] = await runsOf(bot, 2);
  assert.deepEqual([told.id, told.endedBy, !!told.quiet, finishedOf(told.id).map((d) => !!d.new)], [mine.id, 'signout', false, [true]]);
  letGo();
  // The job's next failure is the first of a row: told.
  fails();
  B.bots.update(bot.id, { jobs: [{ ...jobOf(bot), enabled: true }] });
  const first = await scheduled(bot, 3);
  assert.deepEqual([!!first.quiet, B.jobLast(job.id).failures], [false, 1]);
  done(bot);
});

test("a script and the AI's look at what it printed are one time of the job: one failure, said once", async () => {
  day();
  // The script fails and hands over to the AI when it does; the AI's look fails too.
  fails();
  const bot = botWith('Fails And Asks', { kind: 'script', aiWhen: 'failed', script: 'echo broken; exit 1', prompt: 'Say what broke' });
  const job = jobOf(bot);
  const kinds = (runs) => runs.map((r) => [r.kind || 'ai', r.status, !!r.quiet]).sort(); // an AI run names no kind
  B.tick(nextMinute());
  let runs = await runsOf(bot, 2);
  assert.deepEqual(kinds(runs), [['ai', 'error', true], ['script', 'error', false]], "the script's failure is told, the look's is not a second one");
  const first = runs.find((r) => r.kind === 'script');
  let last = B.jobLast(job.id);
  assert.deepEqual([last.failures, last.runId, last.since], [1, first.id, first.endedAt], 'one time, one failure');
  B.tick(nextMinute());
  runs = await runsOf(bot, 4);
  assert.deepEqual(kinds(runs.slice(0, 2)), [['ai', 'error', true], ['script', 'error', true]]);
  assert.equal(B.jobLast(job.id).failures, 2);
  // The AI's look works: the script still failed, so the row goes on and the job's line says so.
  works();
  B.tick(nextMinute());
  runs = await runsOf(bot, 6);
  assert.deepEqual(kinds(runs.slice(0, 2)), [['ai', 'success', true], ['script', 'error', true]]);
  last = B.jobLast(job.id);
  assert.deepEqual([last.status, last.failures], ['error', 3]);
  assert.match(last.text, /: failed, 3 times in a row since \d\d:\d\d\. /);
  assert.equal(B.unreadOfBot(bot.id).unread, 1);
  done(bot);

  // The script ends well and hands over what it found; the AI's look is what fails.
  fails();
  const finds = botWith('Finds And Asks', { kind: 'script', aiWhen: 'output', script: 'echo found', prompt: 'Say what it found' });
  const findsJob = jobOf(finds);
  B.tick(nextMinute());
  runs = await runsOf(finds, 2);
  assert.deepEqual(kinds(runs), [['ai', 'error', false], ['script', 'success', true]], 'the first failure of the row is told');
  B.tick(nextMinute());
  runs = await runsOf(finds, 4);
  assert.deepEqual(kinds(runs.slice(0, 2)), [['ai', 'error', true], ['script', 'success', true]], 'the next is quiet: the script that ended well did not end the row');
  assert.deepEqual([B.jobLast(findsJob.id).failures, B.unreadOfBot(finds.id).unread], [2, 1]);
  works();
  B.tick(nextMinute());
  await runsOf(finds, 6);
  assert.deepEqual([B.jobLast(findsJob.id).status, 'failures' in B.jobLast(findsJob.id)], ['quiet', false], 'the look ends well: the row is over');
  done(finds);
});

test('called runs and scheduled runs are one row: a called failure is held at night, the next are quiet (ADR 026)', async () => {
  night();
  const bot = botWith('Called Row', {});
  // Calls on: the Chief proposes it and the owner says yes (the key itself is in job-call-setup.test.js).
  B.bots.update(bot.id, { jobs: [{ ...jobOf(bot), call: true }] }, { by: 'chief' });
  B.bots.approveJob(bot.id, jobOf(bot).id);
  assert.equal(jobOf(bot).call, true);
  const job = jobOf(bot);
  const called = async (n) => { B.runJob(B.bots.get(bot.id), jobOf(bot), 'call', { input: 'motion' }); return (await runsOf(bot, n))[0]; };
  fails();
  const first = await called(1);
  const second = await scheduled(bot, 2);
  const third = await called(3);
  assert.deepEqual([first, second, third].map((r) => [r.trigger, r.status, r.reporting, !!r.quiet]), [['call', 'error', 'held', true], ['schedule', 'error', 'quiet', true], ['call', 'error', 'quiet', true]]);
  assert.deepEqual([first, second, third].map((r) => finishedOf(r.id).map((d) => !!d.new)), [[false], [false], [false]], 'nothing is new at night');
  assert.deepEqual([B.jobLast(job.id).failures, B.jobLast(job.id).since], [3, first.endedAt]);
  // A call that ends well ends the row, as a scheduled run does.
  works();
  const well = await called(4);
  assert.deepEqual([well.status, 'failures' in B.jobLast(job.id)], ['success', false]);
  day();
  done(bot);
});
