// A script job that hands its output to the AI (aiWhen "output" or "always") only finds candidates: what
// reaches the owner is what the AI reports. The script's own scheduled run is `quiet` (no bubble, no new
// reply, no notification) and stays in the run history. A script that hands nothing over, one that fails,
// one you start yourself and one whose bot has no room for the AI's look show as they always did.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, feed, heldRun, self, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const unreadOf = async (bot) => (await srv.api(`/bots/${bot.id}`)).data.unread;
const scriptRun = (runs) => runs.findLast((r) => r.kind === 'script'); // the first one, should a second minute come
const addScript = async (bot, fields) => {
  const r = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Deal scan', kind: 'script', cron: '0 3 * * *', prompt: 'Only report Grok deals.', ...fields } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};
// Its script's run and, where the output went to the AI, the AI's run after it, both over.
const scanned = (bot, { ai = true } = {}) => waitFor(async () => {
  const runs = await runsOf(bot);
  const script = scriptRun(runs);
  const after = script && runs.find((r) => r.parentRunId === script.id && r.status !== 'running');
  return script && (after || !ai) ? { script, ai: after } : null;
}, { timeout: 30_000, every: 200, what: `the scan of ${bot.name}` });

test('on its schedule, a script handed to the AI is quiet; one that hands nothing over, or fails, shows', { timeout: 60_000 }, async () => {
  const f = await feed(srv);
  // The AI ends with a reply. A job reports only what the AI sends with notify_owner, so for the jobs below
  // it has nothing to report; the job with notify "always" reports the reply itself.
  await srv.api('/settings', { method: 'PUT', body: { quietHours: { start: 0, end: 0, timeZone: 'UTC' } } });
  srv.reply('SuperGrok is 20% off.');
  const everyMinute = { cron: '* * * * *' };
  const make = async (name, fields) => { const bot = await makeBot(srv, { name }); return { bot, job: await addScript(bot, { ...everyMinute, ...fields }) }; };
  const handed = await make('Handed over', { script: 'echo "[ELEC] laptop -25%"', aiWhen: 'output' });
  const silent = await make('Always, no output', { script: 'true', aiWhen: 'always' });
  const alone = await make('No AI', { script: 'echo "disk 91% full"', aiWhen: 'never' });
  const failing = await make('Failing', { script: 'echo boom; exit 3', aiWhen: 'always' });
  const reported = await make('Reports', { script: 'echo "[AI] SuperGrok -20%"', aiWhen: 'output', notify: 'always' });
  const onFailure = await make('AI when failed', { script: 'echo "all 3 sites are up"', aiWhen: 'failed' });
  const all = [handed, silent, alone, failing, reported, onFailure];
  await srv.tick();
  const [h, s, a, x, p, o] = await Promise.all([scanned(handed.bot), scanned(silent.bot), scanned(alone.bot, { ai: false }), scanned(failing.bot), scanned(reported.bot), scanned(onFailure.bot, { ai: false })]);
  for (const { bot, job } of all) await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } });
  // Every AI run the minute started is over before the next test.
  await waitFor(async () => (await Promise.all(all.map(({ bot }) => runsOf(bot)))).flat().every((r) => r.status !== 'running'), { timeout: 30_000, what: 'the runs to end' });

  assert.equal(h.ai.quiet, true, 'the AI had nothing to report');
  assert.equal(h.script.quiet, true, 'no bubble for what the script handed to the AI');
  assert.equal(h.script.result.trim(), '[ELEC] laptop -25%', 'kept, for Details');
  assert.equal((await srv.api(`/runs/${h.script.id}`)).data.quiet, true);
  assert.equal(await unreadOf(handed.bot), 0, 'and no new reply');
  const ev = (await f.wait('run_finished', (d) => d.id === h.script.id)).data;
  assert.deepEqual([ev.quiet, ev.new], [true, undefined], 'the feed says so: no notification');

  assert.equal(s.script.quiet, true, 'handed over with no output');
  assert.equal(await unreadOf(silent.bot), 0);

  assert.ok(!a.script.quiet, 'a script that hands nothing over shows what it printed');
  assert.ok(await unreadOf(alone.bot) > 0, 'as a new reply');
  assert.equal((await f.wait('run_finished', (d) => d.id === a.script.id)).data.quiet, false);

  assert.equal(x.script.status, 'error');
  assert.ok(!x.script.quiet, 'a failed script shows, handed over or not');
  assert.ok(await unreadOf(failing.bot) > 0);

  assert.equal(p.script.quiet, true);
  assert.deepEqual([p.ai.result, p.ai.reporting, !!p.ai.quiet], ['SuperGrok is 20% off.', 'delivered', false], 'what the AI reports reaches the owner');
  assert.equal((await f.wait('run_finished', (d) => d.id === p.ai.id)).data.new, true);
  assert.ok(await unreadOf(reported.bot) > 0, 'as a new reply');

  assert.ok(!o.script.quiet && !o.script.handedOver, 'aiWhen "failed" hands nothing over when the script ended well');
  assert.ok(await unreadOf(onFailure.bot) > 0);
  f.close();
});

test('"Run now" shows what the script printed, handed over or not', async () => {
  srv.reply('');
  const bot = await makeBot(srv, { name: 'Run now' });
  const job = await addScript(bot, { script: 'echo "[ELEC] laptop -25%"', aiWhen: 'output' });
  assert.deepEqual((await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data, { started: 'script' });
  const { script, ai } = await scanned(bot);
  assert.equal(script.trigger, 'manual');
  assert.equal(script.handedOver, true, 'its output went to the AI');
  assert.ok(!script.quiet, 'you asked for it: it shows');
  assert.ok(!ai.quiet);
});

test('a bot with no room for the AI\'s look keeps the script\'s run in the chat', async () => {
  const sender = await makeBot(srv, { name: 'Sender', emoji: '📤' });
  const bot = await makeBot(srv, { name: 'Busy One', emoji: '🐝' });
  const job = await addScript(bot, { script: 'echo "[ELEC] laptop -25%"', aiWhen: 'output' });
  await heldRun(srv, bot, 'Something long');
  const s = await heldRun(srv, sender);
  for (let i = 1; i <= 10; i++) assert.equal((await self(srv, s.token, 'message', { to: bot.id, message: `Task ${i}`, priority: true })).data.delivered, 'queued');
  await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' });
  await waitFor(() => srv.log.join('').includes('not taking followup:'), { what: 'the AI\'s look to be refused' });
  const script = scriptRun(await runsOf(bot));
  assert.equal(script.result.trim(), '[ELEC] laptop -25%');
  assert.equal(script.handedOver, undefined, 'nobody judges it, so it is not marked as handed over');
  assert.ok((await srv.api(`/bots/${bot.id}`)).data.unread > 0, 'and it is a new reply');
  srv.unhold();
  await waitFor(async () => { const r = await runsOf(bot); return r.length === 12 && r.every((x) => x.status !== 'running'); }, { timeout: 30_000, what: 'its first run, the ten messages and the script\'s run' });
  await srv.finished(s.run.id);
});

test('an AI look that is dropped while it waits gives the script\'s run back to the chat', async () => {
  const bot = await makeBot(srv, { name: 'Changed Mind', emoji: '🌀' });
  const job = await addScript(bot, { script: 'echo "[ELEC] laptop -25%"', aiWhen: 'output' });
  await heldRun(srv, bot, 'Something long');
  await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' });
  const marked = await waitFor(async () => scriptRun(await runsOf(bot)), { what: 'the script\'s run' });
  assert.equal(marked.handedOver, true, 'the AI\'s look waits behind the bot\'s run');
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'DELETE' }); // the look can no longer start
  srv.unhold();
  await waitFor(async () => { const r = await runsOf(bot); return r.every((x) => x.status !== 'running') && !scriptRun(r).handedOver; }, { timeout: 30_000, what: 'the script\'s run to be given back' });
  assert.equal((await runsOf(bot)).length, 2, 'no AI run followed');
});
