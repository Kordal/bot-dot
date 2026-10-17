// A report held through quiet hours that can't be delivered costs only its delivery: the scheduler's minute goes
// on, the memory review and every job due in it start, and the report is tried again the next minute (#309),
// and the reports held after it are delivered as if it were not there (#352).
// This file loads lib/bots.js itself, on a scratch data folder and the stand-in for Claude, and hands the
// scheduler its clock, like job-row.test.js. Quiet hours are set around the real hour, since a run's end reads
// the real clock.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-held-'));
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

const fails = () => fs.writeFileSync(path.join(out, 'fail.txt'), 'boom');
const works = () => fs.rmSync(path.join(out, 'fail.txt'), { force: true });
after(() => { works(); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

const hour = new Date().getUTCHours();
const night = () => B.settings.update({ quietHours: { start: hour, end: (hour + 2) % 24, timeZone: 'UTC' } }); // now, and the hour after
const MORNING_MS = 3 * 3600_000; // from now: outside those quiet hours

let clock = Date.now();
const nextMinute = () => new Date(clock += 60_000);

const botWith = (name) => B.bots.create({ name, emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Check', cron: '* * * * *', prompt: 'Check it' }] });
const done = (bot) => B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => ({ ...j, enabled: false })) });
const runsOf = (bot, n) => waitFor(() => { const all = B.listRuns({ botId: bot.id }); return all.length === n && all.every((m) => m.status !== 'running') ? all : null; }, { what: `${n} ended runs of ${bot.name}` });

test("a held report whose delivery throws keeps neither the minute's jobs nor the memory review from starting", async () => {
  // A first failure at night is held; two runs that end well after it make the bot due for its memory review,
  // which is off until the morning's minute.
  B.memory.setReviewSettings({ enabled: false });
  night();
  const held = botWith('Held Till Morning');
  fails();
  B.tick(nextMinute());
  const [first] = await runsOf(held, 1);
  assert.equal(first.reporting, 'held');
  works();
  B.tick(nextMinute());
  await runsOf(held, 2);
  B.tick(nextMinute());
  await runsOf(held, 3);
  done(held);
  const due = botWith('Due In The Morning');

  // The morning: the held report's record can't be written (a folder stands where its temp file goes).
  const morning = new Date(Date.now() + MORNING_MS);
  B.memory.setReviewSettings({ enabled: true, day: morning.getDay(), time: morning.toISOString().slice(11, 16) });
  const blocker = path.join(process.env.BOT_DOT_DATA, 'runs', `${first.id}.json.${process.pid}.tmp`);
  fs.mkdirSync(blocker);
  const logged = [];
  const error = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  try { B.tick(morning); } finally { console.error = error; }
  assert.ok(logged.some((l) => l.startsWith('[scheduler] held reports:') && l.includes(first.id)), `the failure is logged: ${logged.join(' | ')}`);

  const [ran] = await runsOf(due, 1);
  assert.deepEqual([ran.trigger, ran.jobName], ['schedule', 'Check'], "the job due in that minute ran");
  await waitFor(() => B.listRuns({ botId: held.id }).find((r) => r.trigger === 'review'), { what: 'the memory review' });
  assert.equal(B.readMeta(first.id).reporting, 'held', 'not delivered yet');
  done(due);

  // The next minute it can be written: the report is delivered then.
  fs.rmdirSync(blocker);
  const next = new Date(morning.getTime() + 60_000);
  B.tick(next);
  const told = B.readMeta(first.id);
  assert.deepEqual([told.reporting, told.deliveredAt], ['delivered', next.toISOString()]);
});

test('a held report whose delivery throws does not keep the reports held after it from being delivered, that minute or later', async () => {
  // Two bots' first failures at night are held, one after the other.
  B.memory.setReviewSettings({ enabled: false });
  night();
  const stuck = botWith('Stuck Report');
  fails();
  B.tick(nextMinute());
  const [blocked] = await runsOf(stuck, 1);
  done(stuck);
  const behind = botWith('Behind It');
  B.tick(nextMinute());
  const [waiting] = await runsOf(behind, 1);
  done(behind);
  works();
  assert.deepEqual([blocked.reporting, waiting.reporting], ['held', 'held']);

  // The morning: the first one's record can't be written, for two minutes.
  const blocker = path.join(process.env.BOT_DOT_DATA, 'runs', `${blocked.id}.json.${process.pid}.tmp`);
  fs.mkdirSync(blocker);
  const logged = [];
  const error = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  const morning = new Date(Date.now() + MORNING_MS);
  const later = new Date(morning.getTime() + 60_000);
  try {
    B.tick(morning);
    const told = B.readMeta(waiting.id);
    assert.deepEqual([told.reporting, told.deliveredAt], ['delivered', morning.toISOString()], 'the report behind it is delivered that minute');
    B.tick(later);
  } finally { console.error = error; }
  assert.ok(logged.some((l) => l.startsWith('[scheduler] held reports:') && l.includes(blocked.id)), `the failure is logged: ${logged.join(' | ')}`);
  assert.equal(B.listRuns({ botId: stuck.id })[0].reporting, 'held', 'still held after a second failing minute');
  assert.equal(B.listRuns({ botId: behind.id })[0].deliveredAt, morning.toISOString(), 'delivered once');

  // Once its record can be written, it is delivered the next minute.
  fs.rmdirSync(blocker);
  const next = new Date(later.getTime() + 60_000);
  B.tick(next);
  const delivered = B.readMeta(blocked.id);
  assert.deepEqual([delivered.reporting, delivered.deliveredAt], ['delivered', next.toISOString()]);
});
