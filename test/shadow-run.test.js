// A shadow run end to end (ADR 100): the Chief starts a script beside a bot's AI job; after each scheduled run the
// script runs too, its output goes nowhere, and a short model call compares the two. A week of the same answers
// ends with one card, a change of the job to a script job; the owner's yes promotes it, and back_to_ai brings the
// AI job back as it was. A run that differs ends the shadow, and the AI job stays. The tests' week is 6 seconds,
// and one run is enough (BOT_DOT_SHADOW_MS, BOT_DOT_SHADOW_RUNS).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor } = require('./helpers');

const WEEK_MS = 6000;
let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_SHADOW_MS: String(WEEK_MS), BOT_DOT_SHADOW_RUNS: '1' } }); });
after(() => srv.stop());

const jobOf = async (bot, jobId) => (await srv.api(`/bots/${bot.id}/jobs`)).data.find((j) => j.id === jobId);
async function aiJob(bot, name) {
  const r = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name, kind: 'ai', cron: '* * * * *', prompt: 'Count the open issues.', notify: 'always' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
const shadow = (bot, job, body) => srv.asChief(`/bots/${bot.id}/jobs/${job.id}/shadow`, { method: 'POST', body });

test('only an AI job gets a shadow, and back_to_ai only undoes a promotion', async () => {
  const bot = await makeBot(srv, { name: 'Shadow Rules' });
  const script = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Script', kind: 'script', cron: '0 3 * * *', script: 'echo 1' } });
  assert.equal((await shadow(bot, script.data, { script: 'echo 1' })).status, 400);
  const job = await aiJob(bot, 'Plain');
  assert.equal((await shadow(bot, job, { script: '' })).status, 400);
  assert.equal((await srv.asChief(`/bots/${bot.id}/jobs/${job.id}/back-to-ai`, { method: 'POST' })).status, 409);
  const r = await shadow(bot, job, { script: 'echo 1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.shadow.compared, r.data.kind], [0, 'ai']);
  assert.equal((await srv.asChief(`/bots/${bot.id}/jobs/${job.id}/shadow`, { method: 'DELETE' })).data.shadow.ended.why, 'stopped');
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'DELETE' });
});

test('a week of the same answers: one card, the owner\'s yes promotes it, back_to_ai restores the AI job', { timeout: 90_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Shadow Same' });
  const job = await aiJob(bot, 'Open issues');
  srv.reply('{"same":true}'); // what the AI says, and what the stand-in answers when asked to compare
  const started = Date.now();
  assert.equal((await shadow(bot, job, { script: 'echo \'{"same":true}\'', aiWhen: 'never' })).status, 200);
  await srv.tick();
  const compared = await waitFor(async () => { const j = await jobOf(bot, job.id); return j.shadow?.compared ? j : null; }, { timeout: 30_000, what: 'the shadow to compare a run' });
  assert.deepEqual([compared.shadow.matched, compared.shadow.ended], [1, undefined]);
  assert.equal(compared.kind, 'ai');
  const runs = (await srv.api(`/runs?botId=${bot.id}`)).data;
  assert.equal(runs.filter((x) => x.kind === 'script').length, 0, 'the shadow is no run');
  await new Promise((r) => setTimeout(r, Math.max(0, started + WEEK_MS + 200 - Date.now())));
  await srv.tick();
  const proposed = await waitFor(async () => { const j = await jobOf(bot, job.id); return j.change ? j : null; }, { what: 'the swap to be proposed' });
  assert.equal(proposed.kind, 'ai', 'the AI job runs on as approved meanwhile');
  assert.equal(proposed.change.kind, 'script');
  assert.equal(proposed.change.script, 'echo \'{"same":true}\'');
  assert.match(proposed.change.summary, /^Same answers \d+ of \d+ in 7 days/);
  const yes = await srv.api(`/bots/${bot.id}/jobs/${job.id}/approve`, { method: 'POST', body: {} });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  await srv.tick();
  const promoted = await waitFor(async () => { const j = await jobOf(bot, job.id); return j.promoted ? j : null; }, { what: 'the promotion' });
  assert.deepEqual([promoted.kind, promoted.shadow], ['script', undefined]);
  const back = await srv.asChief(`/bots/${bot.id}/jobs/${job.id}/back-to-ai`, { method: 'POST' });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.deepEqual([back.data.kind, back.data.prompt, back.data.cron, back.data.script, back.data.change, back.data.promoted], ['ai', 'Count the open issues.', '* * * * *', '', undefined, undefined]);
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'DELETE' });
});

test('a run that differs ends the shadow at once; the AI job stays and no card comes', { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Shadow Differs' });
  const job = await aiJob(bot, 'Health');
  srv.reply('All 3 hosts are up.');
  assert.equal((await shadow(bot, job, { script: 'echo broken; exit 1' })).status, 200);
  await srv.tick();
  const ended = await waitFor(async () => { const j = await jobOf(bot, job.id); return j.shadow?.ended ? j : null; }, { timeout: 30_000, what: 'the shadow to end' });
  assert.deepEqual([ended.shadow.ended.why, ended.shadow.ended.said, ended.kind, ended.change], ['differed', 'the script failed', 'ai', undefined]);
  const detail = (await srv.asChief(`/bots/${bot.id}/jobs/${job.id}/shadow`)).data;
  assert.deepEqual([detail.ended.ai, detail.ended.script.trim()], ['All 3 hosts are up.', 'broken']);
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'DELETE' });
});
