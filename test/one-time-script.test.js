// A one-time script job ("at") that hands its output to the AI (QW-009, bots.js runScriptJob): the job is gone
// from the bot's jobs as its script starts, so the AI's look carries the job. That look is a one-time run, whose
// reply reaches the owner (QW-004), on an idle bot and behind a busy one. No test here waits for a schedule.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, readData, setJobs, setQueue, runNowItem, makeBot, waitFor, sleep } = require('./helpers');

const runsOf = async (srv, bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const soon = () => new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16); // the test server runs on UTC
const addScript = async (srv, bot, fields) => {
  const r = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Deal scan', kind: 'script', at: soon(), prompt: 'Only report Grok deals.', ...fields } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.approved, true, 'the owner\'s own script needs no OK');
  return r.data;
};
// The script's run and, where its output went to the AI, the AI's run after it, both over.
const scanned = (srv, bot, { ai = true } = {}) => waitFor(async () => {
  const runs = await runsOf(srv, bot);
  const script = runs.find((r) => r.kind === 'script');
  const after = script && runs.find((r) => r.parentRunId === script.id && r.status !== 'running');
  return script && (after || !ai) ? { script, ai: after } : null;
}, { timeout: 30_000, what: `the scan of ${bot.name}` });
const ONE_TIME_NOTE = /This run is a one-time job the owner asked for, at a time they chose: your final reply reaches the owner as it is/;

test('a one-time script job hands its output to the AI as its aiWhen says, and the AI\'s reply reaches the owner', async () => {
  let srv = await startServer();
  try {
    srv.reply('SuperGrok is 20% off.');
    const make = async (name, fields) => { const bot = await makeBot(srv, { name }); return { bot, job: await addScript(srv, bot, fields) }; };
    const handed = {
      output: await make('Output', { script: 'echo "[AI] SuperGrok -20%"', aiWhen: 'output' }),
      failed: await make('Failed', { script: 'echo boom; exit 3', aiWhen: 'failed' }),
      always: await make('Always', { script: 'true', aiWhen: 'always' }),
    };
    const alone = {
      never: await make('Never', { script: 'echo "disk 91% full"', aiWhen: 'never' }),
      'failed, and it went well': await make('Went well', { script: 'echo "all 3 sites are up"', aiWhen: 'failed' }),
    };
    const all = [...Object.values(handed), ...Object.values(alone)];
    const due = new Date(Date.now() - 3600e3).toISOString();
    srv = await restartServer(srv, (data) => setJobs(data, Object.fromEntries(all.map(({ job }) => [job.id, { at: due }]))));

    for (const [when, { bot, job }] of Object.entries(handed)) {
      const { script, ai } = await scanned(srv, bot);
      assert.equal(script.handedOver, true, `aiWhen "${when}": the script's output went to the AI`);
      assert.deepEqual([ai.trigger, ai.oneTime, ai.jobId, ai.jobName, ai.notify], ['schedule', true, job.id, 'Deal scan', 'report-only'], `aiWhen "${when}": the AI's run is a one-time run of that job`);
      assert.deepEqual([ai.status, ai.reporting, ai.result, !!ai.quiet], ['success', 'delivered', 'SuperGrok is 20% off.', false], `aiWhen "${when}": its reply reaches the owner`);
      assert.ok((await srv.api(`/bots/${bot.id}`)).data.unread > 0, 'as a new reply');
      const rec = srv.runs().find((r) => r.stdin.includes(`exit-code="${script.exitCode}"`) && r.args.includes(`${bot.emoji} ${bot.name}`));
      assert.match(rec.stdin, /^Only report Grok deals\./);
      assert.match(rec.system, ONE_TIME_NOTE);
      assert.match(rec.system, /This run is your scheduled job "Deal scan"\./);
    }
    for (const [when, { bot }] of Object.entries(alone)) {
      const { script } = await scanned(srv, bot, { ai: false });
      assert.ok(!script.handedOver && !script.quiet, `aiWhen "${when}": the script's output shows, as it always did`);
      assert.ok((await srv.api(`/bots/${bot.id}`)).data.unread > 0);
    }
    await sleep(500);
    for (const { bot } of Object.values(handed)) assert.equal((await runsOf(srv, bot)).length, 2, 'the script and the AI, each once');
    for (const { bot } of Object.values(alone)) assert.equal((await runsOf(srv, bot)).length, 1, 'no AI run followed');
    for (const { bot } of all) assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.jobs, [], 'the job is gone');
    assert.doesNotMatch(srv.log.join(''), /dropped followup:/);
    assert.deepEqual(readData(srv.data, 'queue.json').queues, {});
  } finally { srv.unhold(); await srv.stop(); }
});

test('behind a busy bot the AI\'s look at a one-time script waits its turn with the job, and its reply arrives', async () => {
  let srv = await startServer();
  try {
    srv.reply('SuperGrok is 20% off.');
    const bot = await makeBot(srv, { name: 'Busy Scan', emoji: '🐝' });
    const daily = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Daily', kind: 'ai', cron: '0 3 * * *', prompt: 'Something long' } })).data;
    const job = await addScript(srv, bot, { script: 'echo "[AI] SuperGrok -20%"', aiWhen: 'output' });
    // Back on, botdot starts the "Run now" that waited, which is held, and the script comes due beside it.
    const due = new Date(Date.now() - 3600e3).toISOString();
    srv.hold();
    srv = await restartServer(srv, (data) => {
      setJobs(data, { [job.id]: { at: due } });
      setQueue(data, (q) => { q.queues[bot.id] = [runNowItem(daily)]; });
    });
    const waiting = await waitFor(() => (readData(srv.data, 'queue.json').queues[bot.id] || [])[0], { what: 'the AI\'s look to wait' });
    const script = (await runsOf(srv, bot)).find((r) => r.kind === 'script');
    assert.deepEqual([waiting.key, waiting.kind, waiting.jobId, waiting.trigger, waiting.parentRunId], [`followup:${script.id}`, 'script-followup', job.id, 'schedule', script.id]);
    assert.deepEqual([waiting.once.id, waiting.once.name, waiting.once.at, waiting.once.notify, waiting.once.script], [job.id, 'Deal scan', due, 'report-only', ''], 'with the job, which is gone from the bot\'s jobs; its script stays out of the queue');
    assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.jobs.map((j) => j.id), [daily.id]);
    assert.equal(script.handedOver, true);

    srv.unhold();
    const { ai } = await scanned(srv, bot);
    assert.deepEqual([ai.trigger, ai.oneTime, ai.jobId, ai.reporting, ai.result], ['schedule', true, job.id, 'delivered', 'SuperGrok is 20% off.']);
    await sleep(500);
    const runs = await runsOf(srv, bot);
    assert.deepEqual(runs.map((r) => r.kind === 'script' ? 'script' : r.trigger).sort(), ['manual', 'schedule', 'script'], 'the run it was busy with, the script and the AI: each once');
    assert.doesNotMatch(srv.log.join(''), /dropped followup:/);
    assert.equal((await runsOf(srv, bot)).find((r) => r.id === script.id).handedOver, true, 'the script\'s run stays the AI\'s to report');
  } finally { srv.unhold(); await srv.stop(); }
});
