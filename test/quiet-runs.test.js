// Quiet runs: a scheduled AI run that ends well with an empty reply comes marked `quiet` (no chat bubble,
// no notification, no preview), and stays in the run history. Manual runs keep showing "Done.".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { quietRun, withProblem } = require('../lib/problems');
const { runSummary } = require('../lib/events');
const { startServer, makeBot, feed, waitFor } = require('./helpers');

test('quietRun: a scheduled AI run that succeeded with a blank reply, and a scheduled script handed to the AI', () => {
  const run = { kind: 'ai', trigger: 'schedule', status: 'success', result: '' };
  assert.equal(quietRun(run), true);
  assert.equal(quietRun({ ...run, result: null }), true);
  assert.equal(quietRun({ ...run, result: '  \n ' }), true, 'whitespace is blank');
  assert.equal(quietRun({ ...run, kind: undefined }), true, 'no kind means AI');
  assert.equal(quietRun({ ...run, result: 'Found 2 issues' }), false, 'a reply shows');
  assert.equal(quietRun({ ...run, trigger: 'manual' }), false, 'runs you started show "Done."');
  assert.equal(quietRun({ ...run, trigger: 'bot' }), false);
  assert.equal(quietRun({ ...run, trigger: 'review' }), false);
  assert.equal(quietRun({ ...run, kind: 'script' }), false);
  // A script's run is quiet only when its output went to the AI (test/script-handover.test.js).
  const script = { ...run, kind: 'script', result: '[ELEC] laptop', handedOver: true };
  assert.equal(quietRun(script), true, 'the AI reports what it finds');
  assert.equal(quietRun({ ...script, handedOver: undefined }), false, 'a script that hands nothing over shows what it printed');
  assert.equal(quietRun({ ...script, result: '' }), true, 'handed over with no output');
  assert.equal(quietRun({ ...script, trigger: 'manual' }), false, '"Run now" shows');
  assert.equal(quietRun({ ...script, status: 'error' }), false, 'a failed script shows');
  for (const status of ['error', 'stopped', 'interrupted']) assert.equal(quietRun({ ...run, status }), false, `${status} is unchanged`);
  // A scheduled job's failure that is not told (BUSY-004): one of its row after the first, and the first while it
  // is held for the morning. Told in the morning, it shows. Only a failure: never a run that was stopped or cut off.
  assert.equal(quietRun({ ...run, status: 'error', reporting: 'quiet' }), true, 'a later failure of a row');
  assert.equal(quietRun({ ...run, status: 'error', reporting: 'held' }), true, 'held till morning');
  assert.equal(quietRun({ ...run, status: 'error', reporting: 'delivered' }), false, 'told in the morning');
  assert.equal(quietRun({ ...script, status: 'error', reporting: 'quiet' }), true, "a script's failure in a row");
  assert.equal(quietRun({ ...run, status: 'error', reporting: 'quiet', trigger: 'manual' }), false);
  for (const status of ['stopped', 'interrupted']) assert.equal(quietRun({ ...run, status, reporting: 'quiet' }), false);
});

test('the API and the feed carry quiet', () => {
  const meta = { id: 'x', botId: 'b', status: 'success', trigger: 'schedule', startedAt: new Date().toISOString(), result: '' };
  assert.equal(withProblem(meta).quiet, true);
  assert.equal(runSummary(meta).quiet, true);
  assert.equal(withProblem({ ...meta, result: 'Hi' }).quiet, undefined);
  assert.equal(runSummary({ ...meta, trigger: 'manual' }).quiet, false);
  // A quiet failure has both: it is folded like a quiet run, and Details say what went wrong.
  const failed = { ...meta, status: 'error', error: 'boom', reporting: 'quiet' };
  assert.deepEqual([withProblem(failed).quiet, typeof withProblem(failed).problem], [true, 'string']);
  assert.deepEqual([runSummary(failed).quiet, runSummary(failed).problem], [true, withProblem(failed).problem]);
  assert.deepEqual([withProblem({ ...failed, reporting: undefined }).quiet, runSummary({ ...failed, reporting: undefined }).quiet], [undefined, false]);
});

let srv;
before(async () => { srv = await startServer(); await srv.api('/settings', { method: 'PUT', body: { quietHours: { start: 0, end: 0, timeZone: 'UTC' } } }); });
after(() => srv.stop());

test('a scheduled job with an empty reply is quiet, and still in the run history', { timeout: 60_000 }, async () => {
  const f = feed(srv);
  srv.reply('');
  const bot = await makeBot(srv);
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Every minute', kind: 'ai', notify: 'always', cron: '* * * * *', prompt: 'Check for news' } })).data;
  await srv.tick();
  const run = await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.trigger === 'schedule' && r.status !== 'running'), { timeout: 30_000, every: 200, what: 'the scheduled run' });
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal(run.status, 'success');
  assert.equal(run.jobName, 'Every minute');
  assert.equal(run.quiet, true);
  assert.equal((await srv.api(`/runs/${run.id}`)).data.quiet, true, 'kept, for Details');
  const ev = await f.wait('run_finished', (d) => d.id === run.id);
  assert.equal(ev.data.quiet, true);
  f.close();
});

test('a scheduled job with a reply, and runs you start, are not quiet', { timeout: 60_000 }, async () => {
  const f = feed(srv);
  const bot = await makeBot(srv);
  srv.reply('');
  const manual = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'anything new?' } });
  const done = await srv.finished(manual.data.id);
  assert.equal(done.status, 'success');
  assert.ok(!done.quiet, 'a blank reply to your message still shows "Done."');
  assert.equal((await f.wait('run_finished', (d) => d.id === done.id)).data.quiet, false);

  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Run now', kind: 'ai', cron: '0 9 * * *', prompt: 'Check for news' } })).data;
  const now = await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' });
  assert.ok(!(await srv.finished(now.data.run.id)).quiet, '"Run now" is a run you started');

  srv.reply('Found one ready issue.');
  const every = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Every minute', kind: 'ai', notify: 'always', cron: '* * * * *', prompt: 'Check for news' } })).data;
  await srv.tick();
  // The tick is the next minute: at 08:59 that is 09:00, and "Run now" (0 9 * * *) runs on it too.
  const run = await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.trigger === 'schedule' && r.jobName === 'Every minute' && r.status !== 'running'), { timeout: 30_000, every: 200, what: 'the scheduled run' });
  await srv.api(`/bots/${bot.id}/jobs/${every.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal(run.result, 'Found one ready issue.');
  assert.ok(!run.quiet);
  f.close();
});
