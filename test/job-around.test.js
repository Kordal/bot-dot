// A job asked for without a clock time runs around its time (docs/decisions/2026-11-24-a-job-with-no-clock-time-runs-
// around-its-time.md): the scheduler starts it once a day at the minute its id and the day give, a job that has a
// change waiting keeps its flag until the owner's yes, and a yes on a change that turns it off makes it exact.
// This file loads lib/bots.js itself, on a scratch data folder and the stand-in for Claude, and hands the scheduler
// its clock: no test waits for a minute to come.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-around-'));
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
const jobsLib = require('../lib/jobs');

after(() => { B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

const MIN = 60_000;
const runsOf = (bot, n) => waitFor(() => { const all = B.listRuns({ botId: bot.id }); return all.length === n && all.every((m) => m.status !== 'running') ? all : null; }, { what: `${n} ended runs of ${bot.name}` });
const jobOf = (bot) => B.bots.get(bot.id).jobs[0];

test('the scheduler starts a job around its time once, at the minute that is its own that day', async () => {
  const bot = B.bots.create({ name: 'Morning', emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Digest', cron: '0 8 * * *', around: true, prompt: 'Digest' }] });
  const job = jobOf(bot);
  assert.equal(job.around, true);
  const day = Date.UTC(2031, 5, 3);
  const run = jobsLib.nextRun(job, new Date(day)); // the day's run, from the job's id and the date
  assert.ok(Math.abs(run.getTime() - (day + 8 * 3600_000)) <= 15 * MIN);
  // Each minute from 07:30 to 08:30: it starts at its minute and not at 08:00 unless that is its minute.
  for (let t = day + 7.5 * 3600_000; t <= day + 8.5 * 3600_000; t += MIN) {
    B.tick(new Date(t));
    if (t === run.getTime()) await runsOf(bot, 1);
    else assert.equal(B.listRuns({ botId: bot.id }).length, t > run.getTime() ? 1 : 0, new Date(t).toISOString());
  }
  assert.equal(B.listRuns({ botId: bot.id }).length, 1, 'once');
  // The bot's next run, as the apps show it, is the next day's.
  assert.equal(new Date(B.nextRun(B.bots.get(bot.id))).getTime() > Date.now(), true);
  B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => ({ ...j, enabled: false })) });
});

test('after downtime across the run, botdot catches it up once; across none, it does not', async () => {
  const bot = B.bots.create({ name: 'Caught up', emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Digest', cron: '0 8 * * *', around: true, prompt: 'Digest' }] });
  const job = jobOf(bot);
  const day = Date.UTC(2032, 5, 3);
  const run = jobsLib.nextRun(job, new Date(day));
  assert.ok(jobsLib.lastDueBetween(job, new Date(run.getTime() - 20 * MIN), new Date(run.getTime() + 20 * MIN)).getTime() === run.getTime());
  assert.equal(jobsLib.lastDueBetween(job, new Date(run.getTime() - 20 * MIN), new Date(run.getTime())), null, 'not yet its time');
  assert.equal(jobsLib.lastDueBetween(job, run, new Date(run.getTime() + 60 * MIN)), null, 'it ran at that minute');
  B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => ({ ...j, enabled: false })) });
});

test('a change that waits beside an approved job keeps the flag as approved until the yes', () => {
  const bot = B.bots.create({ name: 'Waits', emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Digest', kind: 'script', script: 'echo hi', cron: '0 8 * * *', around: true }] });
  assert.equal(jobOf(bot).around, true);
  // The bot makes the job exact: it waits, and the job runs on around its time.
  B.bots.update(bot.id, { jobs: [{ ...jobOf(bot), around: false }] }, { by: 'bot', runId: 'r1' });
  assert.equal(jobOf(bot).around, true, 'as approved');
  assert.notEqual(jobOf(bot).change.job.around, true);
  const yes = B.bots.approveJob(bot.id, jobOf(bot).id);
  assert.equal(yes.around, undefined, 'exact after the yes');
  assert.equal(jobsLib.nextRun(yes, new Date(Date.UTC(2031, 5, 3))).toISOString(), '2031-06-03T08:00:00.000Z');
  // And the other way.
  B.bots.update(bot.id, { jobs: [{ ...jobOf(bot), around: true }] }, { by: 'bot', runId: 'r2' });
  assert.equal(jobOf(bot).around, undefined);
  assert.equal(jobOf(bot).change.job.around, true);
  assert.equal(B.bots.approveJob(bot.id, jobOf(bot).id).around, true);
  B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => ({ ...j, enabled: false })) });
});
