// A repeating job's scheduled run that fails for a passing reason runs again 5, 10 and 15 minutes after each failure,
// quietly (ADR 182): the owner hears of it only when the last try fails too. This file loads lib/bots.js itself, on a
// scratch data folder and the stand-in for Claude, and hands the scheduler its clock (as job-row.test.js).
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-retry-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0', BOT_DOT_TRANSIENT_RETRY_MS: '1',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'), TZ: 'UTC',
});
fs.mkdirSync(process.env.HOME);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('./helpers');
const B = require('../lib/bots');
const { withProblem } = require('../lib/problems');

const BUSY = 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
const busy = () => fs.writeFileSync(path.join(out, 'error-result.txt'), BUSY);
const broken = () => fs.writeFileSync(path.join(out, 'error-result.txt'), 'boom');
const works = () => fs.rmSync(path.join(out, 'error-result.txt'), { force: true });
after(() => { works(); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });
B.settings.update({ quietHours: { start: 0, end: 0, timeZone: 'UTC' } });

// The scheduler's clock, which a test hands in. A try's time is the real clock's (the run's end), so each bot's job is
// due at the minute after now, and in the hour after it only a try starts it.
let clock = Date.now();
const at = (ms) => new Date(clock = ms);
let n = 0;
const due = new Map(); // bot id -> its job's minute, a minute of its own: the scheduler looks at a minute once
let nextDue = 0;
function botWith(name) {
  const d = new Date(Math.max(Date.now() + 60_000, nextDue));
  d.setUTCSeconds(0, 0);
  nextDue = d.getTime() + 60_000;
  const bot = B.bots.create({ name, emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Check', cron: `${d.getUTCMinutes()} * * * *`, prompt: 'Check it' }] });
  due.set(bot.id, d);
  return bot;
}
const dueMinute = (bot) => at(due.get(bot.id).getTime());
const runsOf = (bot, count) => waitFor(() => { const all = B.listRuns({ botId: bot.id }); return all.length === count && all.every((m) => m.status !== 'running') ? all.map(withProblem) : null; }, { what: `${count} ended runs of ${bot.name}` });
const done = (bot) => B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => ({ ...j, enabled: false })) });
const minutesBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);

test('Claude busy: tried again 5, 10 and 15 minutes after each failure, quietly; the owner hears once, when the last try fails', async () => {
  busy();
  const bot = botWith(`Busy ${++n}`);
  const job = B.bots.get(bot.id).jobs[0];
  B.tick(dueMinute(bot));
  let runs = await runsOf(bot, 1);
  const waits = [];
  for (let i = 0; i < 3; i++) {
    const last = runs[0];
    assert.equal(last.status, 'error');
    assert.equal(last.quiet, true, `try ${i + 1} is quiet`);
    assert.ok(last.retryAt, 'it says when it runs again');
    waits.push(minutesBetween(last.endedAt, last.retryAt));
    assert.equal(B.jobLast(job.id)?.failures, undefined, 'the row does not count a try');
    // A minute before: nothing starts.
    B.tick(at(Date.parse(last.retryAt) - 60_000));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(B.listRuns({ botId: bot.id }).length, i + 1);
    B.tick(at(Date.parse(last.retryAt)));
    runs = await runsOf(bot, i + 2);
    assert.equal(runs[0].trigger, 'schedule');
  }
  assert.deepEqual(waits, [5, 10, 15]);
  const final = runs[0];
  assert.deepEqual([final.status, !!final.quiet, final.retryAt, final.retried], ['error', false, undefined, 3]);
  assert.equal(B.jobLast(job.id).failures, 1, 'told as the first failure of the row');
  assert.equal(B.unreadOfBot(bot.id).unread, 1, 'one dot for the four runs');
  // No fifth try: the next is the job's own minute.
  B.tick(at(clock + 20 * 60_000));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(B.listRuns({ botId: bot.id }).length, 4);
  done(bot);
});

test('a try that works ends the tries; the next busy run starts from 5 minutes again', async () => {
  busy();
  const bot = botWith(`Busy ${++n}`);
  B.tick(dueMinute(bot));
  const first = (await runsOf(bot, 1))[0];
  works();
  B.tick(at(Date.parse(first.retryAt)));
  const well = (await runsOf(bot, 2))[0];
  assert.deepEqual([well.status, well.retryAt], ['success', undefined]);
  busy();
  B.tick(dueMinute(bot));
  const again = (await runsOf(bot, 3))[0];
  assert.equal(minutesBetween(again.endedAt, again.retryAt), 5);
  done(bot);
});

test('a failure that is no passing one is told at once and not tried again; nor is "Run now"', async () => {
  broken();
  const bot = botWith(`Broken ${++n}`);
  const job = B.bots.get(bot.id).jobs[0];
  B.tick(dueMinute(bot));
  const run = (await runsOf(bot, 1))[0];
  assert.deepEqual([run.status, !!run.quiet, run.retryAt], ['error', false, undefined]);
  busy();
  B.runJob(B.bots.get(bot.id), job, 'manual');
  const manual = (await runsOf(bot, 2))[0];
  assert.deepEqual([manual.trigger, !!manual.quiet, manual.retryAt], ['manual', false, undefined]);
  done(bot);
});

test('a job switched off loses its next try', async () => {
  busy();
  const bot = botWith(`Off ${++n}`);
  B.tick(dueMinute(bot));
  const first = (await runsOf(bot, 1))[0];
  done(bot);
  B.tick(at(Date.parse(first.retryAt)));
  B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => ({ ...j, enabled: true })) });
  B.tick(at(clock + 60_000));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(B.listRuns({ botId: bot.id }).length, 1);
  done(bot);
});
