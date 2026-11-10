// The Chief runs an approved job again, once, when its newest run failed (ADR 188): the server checks it is one.
// This file loads lib/bots.js itself, on a scratch data folder and the stand-in for Claude (as job-retry.test.js).
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-again-'));
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

const broken = () => fs.writeFileSync(path.join(out, 'error-result.txt'), 'boom');
const works = () => fs.rmSync(path.join(out, 'error-result.txt'), { force: true });
after(() => { works(); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

let n = 0;
const botWith = () => B.bots.create({ name: `Again ${++n}`, emoji: '🧪', prompt: 'Do the task.', jobs: [{ name: 'Check', cron: '0 6 * * *', prompt: 'Check it' }] });
const ended = (bot, count) => waitFor(() => { const all = B.listRuns({ botId: bot.id }); return all.length === count && all.every((m) => m.status !== 'running') ? all : null; }, { what: `${count} ended runs` });
const refused = (bot, job, re) => assert.throws(() => B.runFailedJobAgain(B.bots.get(bot.id), job), (e) => e.status === 409 && re.test(e.message));

test('a failed approved job runs again once; a second try is the owner\'s', async () => {
  broken();
  const bot = botWith();
  const job = B.bots.get(bot.id).jobs[0];
  B.runJob(B.bots.get(bot.id), job, 'manual');
  const [failed] = await ended(bot, 1);
  assert.equal(failed.status, 'error');
  works();
  const ran = B.runFailedJobAgain(B.bots.get(bot.id), job);
  assert.ok(ran.run?.id, 'it started a run');
  const runs = await ended(bot, 2);
  assert.equal(runs.find((r) => r.id === ran.run.id).jobId, job.id);
  assert.equal(runs.find((r) => r.id === failed.id).ranAgain, ran.run.id, 'the failed run is marked');
  refused(bot, job, /didn't fail/);
});

test('not for a job that did not fail, was stopped, is off, or waits for the owner', async () => {
  works();
  const bot = botWith();
  const job = B.bots.get(bot.id).jobs[0];
  refused(bot, job, /didn't fail/);
  B.runJob(B.bots.get(bot.id), job, 'manual');
  await ended(bot, 1);
  refused(bot, job, /didn't fail/);
  refused(bot, { ...job, enabled: false }, /switched-on job/);
  refused(bot, { ...job, approved: false }, /switched-on job/);
  refused(bot, { ...job, change: { prompt: 'x' } }, /switched-on job/);
});

test('once per failure: a failure marked already is refused', async () => {
  broken();
  const bot = botWith();
  const job = B.bots.get(bot.id).jobs[0];
  B.runJob(B.bots.get(bot.id), job, 'manual');
  await ended(bot, 1);
  B.runFailedJobAgain(B.bots.get(bot.id), job);
  await ended(bot, 2);
  refused(bot, job, /once already/);
  works();
});
