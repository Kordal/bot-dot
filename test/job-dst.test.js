// The scheduler on the days daylight saving time moves the clock (#312): a job at a fixed time starts once that
// day, a time the clock jumps over is caught up at the jump, and a start during the change neither runs it again
// nor says it was missed. The rule itself is in cron-dst.test.js. This file loads lib/bots.js in a zone with DST
// and hands the scheduler its clock, a minute at a time; the other tests run in UTC.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-dst-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'), TZ: 'Europe/Warsaw',
});
fs.mkdirSync(process.env.HOME);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('./helpers');
const B = require('../lib/bots');

after(() => { B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });
B.settings.update({ quietHours: { start: 0, end: 0, timeZone: 'UTC' } });

const MIN = 60_000;
const jobsOf = (bot) => B.bots.get(bot.id).jobs;
const done = (bot) => B.bots.update(bot.id, { jobs: jobsOf(bot).map((j) => ({ ...j, enabled: false })) });
const readKept = () => JSON.parse(fs.readFileSync(path.join(B.DATA_DIR, 'scheduler.json'), 'utf8'));
// One bot for each schedule, so that no run waits for another. The scheduler looks once a minute from `from` up
// to `to`; what comes back is, for each schedule, the minutes (UTC) its runs started at.
async function day(name, crons, from, to) {
  const bots = crons.map((cron, i) => B.bots.create({ name: `${name} ${i}`, emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Daily', kind: 'ai', prompt: 'Check it', cron }] }));
  const started = crons.map(() => []);
  const ended = () => waitFor(() => bots.every((bot) => !B.isBotRunning(bot.id) && !B.queuedOf(bot.id).length), { what: 'the runs to end' });
  for (let t = Date.parse(from); t < Date.parse(to); t += MIN) {
    B.tick(new Date(t + 20_000)); // a look 20 s into the minute, as the real timer's are
    let any = false;
    bots.forEach((bot, i) => { while (B.listRuns({ botId: bot.id }).length > started[i].length) { started[i].push(new Date(t).toISOString().slice(0, 16)); any = true; } });
    if (any) await ended(); // a run that is still going would keep the next one waiting, where it is not counted
  }
  for (const bot of bots) done(bot);
  await ended();
  return Object.fromEntries(crons.map((cron, i) => [cron, started[i]]));
}

test('clocks go back on 25 October: a job at 02:30 starts once, at the first one, and a job at 09:00 at 09:00', async () => {
  assert.deepEqual(await day('Fall', ['30 2 * * *', '0 2 * * *', '0 9 * * *'], '2026-10-24T22:00Z', '2026-10-25T23:00Z'), {
    '30 2 * * *': ['2026-10-25T00:30'], '0 2 * * *': ['2026-10-25T00:00'], '0 9 * * *': ['2026-10-25T08:00'],
  });
});

test('clocks go forward on 29 March: jobs at 02:00, 02:30 and 02:45 each start once, at the jump to 03:00', async () => {
  assert.deepEqual(await day('Spring', ['30 2 * * *', '0 2 * * *', '45 2 * * *', '0 9 * * *'], '2026-03-28T22:00Z', '2026-03-29T22:00Z'), {
    '30 2 * * *': ['2026-03-29T01:00'], '0 2 * * *': ['2026-03-29T01:00'], '45 2 * * *': ['2026-03-29T01:00'], '0 9 * * *': ['2026-03-29T07:00'],
  });
});

test('a start during the change: a job that ran is not missed, nor run again, and the minute looked at is kept as it was', () => {
  const bot = B.bots.create({ name: 'Restarted', emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Daily', kind: 'ai', prompt: 'Check it', cron: '30 2 * * *', enabled: false }] });
  const [job] = jobsOf(bot);
  B.bots.update(bot.id, { jobs: [{ ...job, enabled: true }] });
  // In the second 02:00 hour the minute written down is that minute, not the first copy's an hour before.
  B.tick(new Date('2026-10-25T01:10:20Z'));
  assert.equal(readKept().lookedAt, '2026-10-25T01:10:00.000Z');
  // It ran at the first 02:30 (00:30Z), and botdot was off from 00:45Z: the second 02:30 is not its time.
  fs.writeFileSync(path.join(B.DATA_DIR, 'scheduler.json'), JSON.stringify({ lookedAt: '2026-10-25T00:45:00.000Z' }));
  B.missedWhileOff(new Date('2026-10-25T01:40:20Z'));
  B.tick(new Date('2026-10-25T01:30:20Z'));
  assert.deepEqual([B.jobLast(job.id), B.listRuns({ botId: bot.id }).length], [null, 0]);
  // Started again right at the jump in March: nothing missed, and the tick catches the job up.
  fs.writeFileSync(path.join(B.DATA_DIR, 'scheduler.json'), JSON.stringify({ lookedAt: '2026-03-29T00:50:00.000Z' }));
  B.missedWhileOff(new Date('2026-03-29T01:00:20Z'));
  assert.equal(B.jobLast(job.id), null);
  // Off over the whole jump: the job missed its time, local 03:00, and is not run for it.
  fs.writeFileSync(path.join(B.DATA_DIR, 'scheduler.json'), JSON.stringify({ lookedAt: '2026-03-29T00:50:00.000Z' }));
  B.missedWhileOff(new Date('2026-03-29T01:10:20Z'));
  assert.deepEqual(B.jobLast(job.id, new Date('2026-03-29T01:10:20Z')), { status: 'missed', at: '2026-03-29T01:00:00.000Z', text: 'Did not run at 03:00: botdot was off.' });
  assert.equal(B.listRuns({ botId: bot.id }).length, 0);
  done(bot);
});
