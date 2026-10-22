// A check a bot offers (#342, ADR 064): a one-time AI job, due within a week, that a bot sets up in a run the owner
// started with their own message is approved at once; anything else a bot sets up still waits for the owner.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob, ONCE_DAYS } = require('../lib/jobs');
const { startServer, makeBot, self } = require('./helpers');
const { isRunOf } = require('./carry-on-helpers');

const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const inHours = (h) => local(new Date(Date.now() + h * 3600e3));
const check = (fields = {}) => ({ name: 'Boarding pass', kind: 'ai', at: inHours(2), prompt: 'Look whether the boarding pass came.', assessment: 'Needs reading mail.', ...fields });

test('a one-time AI job of a bot is approved at once only in a run the owner started, and only within the week', () => {
  const owners = { runId: 'r1', ownerRun: true };
  assert.equal(normalizeJob(check(), null, 'bot', owners).approved, true);
  assert.equal(normalizeJob(check(), null, 'bot', { runId: 'r1' }).approved, false, 'a run the owner did not start');
  assert.equal(normalizeJob(check({ at: undefined, cron: '20 13 * * *' }), null, 'bot', owners).approved, false, 'a recurring job');
  assert.equal(normalizeJob(check({ kind: 'script', script: 'echo hi', aiWhen: 'never' }), null, 'bot', owners).approved, false, 'a script job');
  assert.equal(normalizeJob(check({ at: inHours(ONCE_DAYS * 24 + 2) }), null, 'bot', owners).approved, false, 'further than a week ahead');
  assert.equal(normalizeJob(check(), null, 'chief', { ownerRun: true }).approved, true, "the Chief's AI jobs as before");
});

test('an approved job a bot changes into a one-time check still waits beside it', () => {
  const approved = normalizeJob({ name: 'Daily', kind: 'ai', cron: '0 9 * * *', prompt: 'Report.' }, null, 'you');
  const changed = normalizeJob({ ...approved, at: inHours(2), prompt: 'Do anything.' }, approved, 'bot', { runId: 'r1', ownerRun: true });
  assert.ok(changed.change, 'the change waits');
  assert.equal(changed.prompt, 'Report.');
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv.unhold?.(); await srv.stop(); });

// Starts a run of `bot` (as the owner, or as the Chief), has it add `job`, and answers what add said.
async function addIn(bot, job, { chief = false } = {}) {
  srv.hold();
  const prompt = `Check later ${Math.random().toString(36).slice(2, 8)}`;
  const start = (chief ? srv.asChief : srv.api)(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  const started = await start;
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(bot)(x) && x.stdin.includes(prompt), 'the run');
  let added;
  try { added = await self(srv, rec.self.env.RUN_TOKEN, 'jobs', { action: 'add', ...job }); } finally { srv.reply('Done.'); srv.release(rec); }
  await srv.finished(started.data.id);
  srv.unhold();
  return added.data;
}

test("the owner's yes is the one OK: a check the bot sets up in their run needs no card, one the Chief's run sets up waits", async () => {
  const bot = await makeBot(srv, { name: 'Trip Watch' });
  const mine = await addIn(bot, check());
  assert.equal(mine.ok, true);
  assert.equal(mine.job.approved, true);
  assert.equal(mine.needsApproval, false);
  const daily = await addIn(bot, check({ name: 'Daily', at: undefined, cron: '20 13 * * *' }));
  assert.equal(daily.needsApproval, true, 'a recurring job still waits');
  const chiefs = await addIn(bot, check({ name: 'For the Chief' }), { chief: true });
  assert.equal(chiefs.needsApproval, true, "a run the Chief started isn't the owner's yes");
});
