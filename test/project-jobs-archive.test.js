// A job of an archived project waits (#1512): the scheduler, a call and a bot's run-again start nothing for it until
// the project is unarchived; then it runs again. The owner's own Run now still runs it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-archived-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'), TZ: 'UTC',
});
fs.mkdirSync(process.env.HOME);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor, writeData } = require('./helpers');
const B = require('../lib/bots');

after(() => { B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

const project = (archived) => writeData(path.join(process.env.BOT_DOT_DATA, 'company.json'), { id: 'p1', name: 'Weather', start: 'weather', phase: 'running', startedAt: '2026-11-01T00:00:00.000Z', ...(archived ? { archived: true } : {}) });
let clock = Date.now();
const nextMinute = () => new Date(clock += 60_000);
const runs = (bot) => B.listRuns({ botId: bot.id });

test("an archived project's job does not start on its schedule, a call or a run-again, and starts again once unarchived", async () => {
  project(true);
  const bot = B.bots.create({ name: 'QA Writer', emoji: '✍️', prompt: 'Writes.', jobs: [{ name: 'Evening log', cron: '* * * * *', prompt: 'Log it', project: 'p1' }, { name: 'Own digest', cron: '* * * * *', prompt: 'Digest' }] });
  const [forProject, own] = B.bots.get(bot.id).jobs;
  assert.equal(forProject.project, 'p1');
  B.tick(nextMinute());
  await waitFor(() => (runs(bot).length === 1 && runs(bot).every((m) => m.status !== 'running') ? true : null), { what: 'the run of its own job' });
  assert.deepEqual(runs(bot).map((m) => m.jobName), ['Own digest'], 'the job of its own runs, the archived project\'s does not');
  assert.throws(() => B.runJob(B.bots.get(bot.id), forProject, 'call'), (e) => e.status === 409 && /project is archived/.test(e.message));
  assert.throws(() => B.runFailedJobAgain(B.bots.get(bot.id), forProject), (e) => e.status === 409 && /project is archived/.test(e.message));
  B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => (j.id === own.id ? { ...j, enabled: false } : j)) });
  project(false);
  B.tick(nextMinute());
  await waitFor(() => (runs(bot).some((m) => m.jobName === 'Evening log' && m.status !== 'running') ? true : null), { what: 'the project\'s job, once unarchived' });
  B.bots.update(bot.id, { jobs: B.bots.get(bot.id).jobs.map((j) => ({ ...j, enabled: false })) });
});
