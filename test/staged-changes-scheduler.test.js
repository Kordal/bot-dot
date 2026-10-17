// A change to an approved job waits beside it (ADR 013, SURE-002): the scheduler and "Run now" read the approved
// definition until the owner answers. This file loads lib/bots.js itself, on a scratch data folder and the
// stand-in for Claude, and hands the scheduler its clock: no test waits for a minute to come. The rules of one
// job (lib/jobs.js normalizeJob) and of what a yes on a proposal starts (lib/asks.js) are checked here too, pure.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-staged-'));
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
const { normalizeJob } = require('../lib/jobs');
const asksLib = require('../lib/asks');

after(() => { B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

// The bot's runs once it has `n` and none is going, newest first.
const runsOf = (bot, n) => waitFor(() => { const all = B.listRuns({ botId: bot.id }); return all.length === n && all.every((m) => m.status !== 'running') ? all : null; }, { what: `${n} ended runs of ${bot.name}` });
const jobOf = (bot) => B.bots.get(bot.id).jobs[0];

test('the scheduler and "Run now" run the approved job while a change waits, and the changed one after the yes', async () => {
  const bot = B.bots.create({ name: 'Ticker', emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Check', cron: '1-59/2 * * * *', prompt: 'Check it' }] });
  // The bot changes the text and the time of its approved job: every even minute, with another task.
  B.bots.update(bot.id, { jobs: [{ ...jobOf(bot), prompt: 'Check it twice', cron: '*/2 * * * *' }] }, { by: 'bot', runId: 'run-of-the-bot' });
  const waiting = jobOf(bot);
  assert.deepEqual([waiting.approved, waiting.prompt, waiting.cron, waiting.change.job.prompt, waiting.change.job.cron, waiting.change.by, waiting.change.runId], [true, 'Check it', '1-59/2 * * * *', 'Check it twice', '*/2 * * * *', 'bot', 'run-of-the-bot']);
  assert.equal(new Date(B.nextRun(B.bots.get(bot.id))).getUTCMinutes() % 2, 1, 'its next run is at the approved time');

  const even = new Date(Math.ceil(Date.now() / 120_000) * 120_000 + 120_000); // an even minute, ahead of now
  const minute = (n) => new Date(even.getTime() + n * 60_000);
  B.tick(minute(0)); // the time of the change: nothing runs
  B.tick(minute(1)); // the approved time
  let runs = await runsOf(bot, 1);
  assert.deepEqual([runs[0].trigger, runs[0].prompt], ['schedule', 'Check it'], 'at the approved time, with the approved text');
  B.runJob(B.bots.get(bot.id), jobOf(bot), 'manual');
  runs = await runsOf(bot, 2);
  assert.deepEqual([runs[0].trigger, runs[0].prompt], ['manual', 'Check it'], '"Run now" runs the approved one');

  // "Keep as it is": the job is as approved, and runs on.
  const kept = B.bots.keepJob(bot.id, waiting.id);
  assert.deepEqual([kept.approved, kept.prompt, kept.change], [true, 'Check it', undefined]);
  B.tick(minute(3));
  assert.equal((await runsOf(bot, 3))[0].prompt, 'Check it');

  // "Approve the change": it runs as changed, at the changed time.
  B.bots.update(bot.id, { jobs: [{ ...jobOf(bot), prompt: 'Check it twice', cron: '*/2 * * * *' }] }, { by: 'bot' });
  const approved = B.bots.approveJob(bot.id, waiting.id);
  assert.deepEqual([approved.approved, approved.prompt, approved.cron, approved.change], [true, 'Check it twice', '*/2 * * * *', undefined]);
  B.tick(minute(5)); // the time it had: nothing
  B.tick(minute(6));
  runs = await runsOf(bot, 4);
  assert.deepEqual([runs[0].trigger, runs[0].prompt], ['schedule', 'Check it twice']);
  B.bots.update(bot.id, { jobs: [] });
});

test('one job: what waits beside it, what replaces it, and what changes at once', () => {
  const approved = normalizeJob({ name: 'Report', kind: 'ai', cron: '0 9 * * *', prompt: 'Write the report.' }, null, 'you');
  assert.deepEqual([approved.approved, approved.change], [true, undefined]);
  const once = normalizeJob({ ...approved, prompt: 'Write a short report.' }, approved, 'bot', { runId: 'r1' });
  assert.deepEqual([once.approved, once.prompt, once.change.job.prompt, once.change.runId], [true, 'Write the report.', 'Write a short report.', 'r1']);
  // A second change replaces the first: it is laid over the approved job, not over the change that waited.
  const twice = normalizeJob({ ...once, cron: '0 7 * * *' }, once, 'bot', { runId: 'r2' });
  assert.deepEqual([twice.prompt, twice.cron, twice.change.job.prompt, twice.change.job.cron, twice.change.runId], ['Write the report.', '0 9 * * *', 'Write the report.', '0 7 * * *', 'r2']);
  // The same change asked for again waits as it did, since when it did.
  assert.equal(normalizeJob({ ...twice, cron: '0 7 * * *' }, twice, 'bot', { runId: 'r3' }).change, twice.change);
  // An edit that changes nothing of what it does is made at once, by anyone, and the change still waits: a name,
  // which the change gets too, so that its yes does not take the name back, and on or off, which is the job's alone.
  const paused = normalizeJob({ ...twice, enabled: false, name: 'Daily report' }, twice, 'chief');
  assert.deepEqual([paused.enabled, paused.name, paused.cron, paused.change], [false, 'Daily report', '0 9 * * *', { ...twice.change, job: { ...twice.change.job, name: 'Daily report' } }]);
  assert.equal(normalizeJob({ ...twice, enabled: false }, twice, 'you').change, twice.change, "the owner's too");
  // A name, a time limit and an assessment that come with a change wait with it: the job is as approved until the answer.
  const whole = normalizeJob({ ...approved, name: 'Short report', timeoutSeconds: 60, assessment: 'Shorter.', prompt: 'Write a short report.' }, approved, 'bot');
  assert.deepEqual([whole.name, whole.timeoutSeconds, whole.assessment, whole.prompt], [approved.name, approved.timeoutSeconds, approved.assessment, approved.prompt]);
  assert.deepEqual([whole.change.job.name, whole.change.job.timeoutSeconds, whole.change.job.assessment, whole.change.job.prompt], ['Short report', 60, 'Shorter.', 'Write a short report.']);
  // An edit that is approved at once and changes what it does drops a change that waits: the Chief's of an AI job too.
  assert.equal(normalizeJob({ ...twice, prompt: 'Chief said.' }, twice, 'chief').change, undefined);
  // The owner's own edit of what it does is approved at once and drops the change.
  const mine = normalizeJob({ ...twice, prompt: 'My report.' }, twice, 'you');
  assert.deepEqual([mine.approved, mine.prompt, mine.change], [true, 'My report.', undefined]);
  // "Always approve": a change by the bot is made at once, as before.
  const trusted = normalizeJob({ ...approved, alwaysApprove: true }, approved, 'you');
  const atOnce = normalizeJob({ ...trusted, prompt: 'Another.' }, trusted, 'bot');
  assert.deepEqual([atOnce.approved, atOnce.prompt, atOnce.change], [true, 'Another.', undefined]);
  // The Chief's change of an AI job needs no OK, as before; its script does.
  assert.equal(normalizeJob({ ...approved, prompt: 'Chief said.' }, approved, 'chief').change, undefined);
  const script = normalizeJob({ ...approved, kind: 'script', script: 'df -h' }, approved, 'chief', { chatId: 'c1' });
  assert.deepEqual([script.kind, script.script, script.change.job.kind, script.change.job.script, script.change.chatId], ['ai', '', 'script', 'df -h', 'c1']);
  // A job that was never approved has nothing to keep: it waits whole, and a change writes it over.
  const fresh = normalizeJob({ name: 'New', kind: 'ai', prompt: 'One.' }, null, 'bot', { runId: 'r4' });
  assert.deepEqual([fresh.approved, fresh.runId, typeof fresh.askedAt, fresh.change], [false, 'r4', 'string', undefined]);
  const again = normalizeJob({ ...fresh, prompt: 'Two.' }, fresh, 'bot', { runId: 'r5' });
  assert.deepEqual([again.approved, again.prompt, again.runId, again.change], [false, 'Two.', 'r5', undefined]);
  assert.deepEqual([normalizeJob({ ...fresh, name: 'Renamed' }, fresh, 'chief').runId, normalizeJob({ ...fresh }, fresh, 'you').approved], ['r4', false], 'untouched, it waits as it did');
});

test('what a yes on a proposal starts: the request of the owner or a teammate, for a day, and never a job or a run of the Chief', () => {
  const bot = { id: 'b1', jobs: [{ id: 'j1', enabled: true, approved: true }] };
  const at = new Date(Date.now() - 3600e3).toISOString();
  const run = (fields) => ({ id: 'r1', botId: 'b1', trigger: 'manual', startedAt: at, status: 'success', prompt: 'Do it', ...fields });
  const who = (fields, ask = {}, more = {}) => asksLib.whatCarriesOn({ ask: { kind: 'proposal', botId: 'b1', at, runs: [{ id: 'r1', at }], ...ask }, bot, stopped: { r1: run(fields) }, chats: { r1: { id: 'c1', title: 'Chat', wroteAt: at } }, ...more }).map((f) => f.who);
  assert.deepEqual(who({}), ['owner']);
  assert.deepEqual(who({ trigger: 'bot', fromBot: { id: 'b2', name: 'Mate' } }), ['teammate']);
  assert.deepEqual(who({ jobId: 'j1', trigger: 'schedule' }), [], "not in a job's own run");
  assert.deepEqual(who({ jobId: 'j1', trigger: 'manual' }), [], 'nor in its "Run now"');
  assert.deepEqual(who({ startedBy: 'chief' }), [], 'a run the Chief started is not handed back for it');
  assert.deepEqual(who({}, {}, { now: Date.now() + 24 * 3600e3 }), [], 'not after 24 hours');
  assert.deepEqual(who({}, {}, { later: [{ id: 'r2', botId: 'b1', trigger: 'manual', startedAt: new Date().toISOString() }] }), [], 'not once the owner wrote to the bot after it');
  // A change a bot proposed to its instructions is a proposal too; a permission's ask is none, and repeats a job's run.
  assert.deepEqual(who({ jobId: 'j1', trigger: 'schedule' }, { kind: 'bot-change', by: 'bot' }), []);
  assert.deepEqual(who({ jobId: 'j1', trigger: 'schedule' }, { kind: 'permission' }), ['job']);
  assert.deepEqual(asksLib.grantWords({ kind: 'bot-change', by: 'bot', changes: { prompt: 'a', systemPrompt: 'b' } }), ['change your main assignment', 'change your rules']);
  assert.deepEqual(asksLib.grantWords({ kind: 'bot-change', by: 'chief', changes: { prompt: 'a' }, before: {} }), [], "the Chief's change gives a run nothing, as before");
});
