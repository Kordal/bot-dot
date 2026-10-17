// A one-time job ("at") that comes due while its bot works waits its turn like any work (QW-007, bots.js
// startQueued): it stays among the bot's jobs until its run starts, so removing it there still stops it, and its
// final reply reaches the owner as it does from an idle bot (test/one-time-report.test.js). With too much
// waiting already, it stays and is tried again until there is room.
// No test here waits for a schedule: botdot is stopped, the jobs' times are put into the past and a "Run now"
// that waited is left in the queue, so that back on it has a busy bot and jobs that are due (QW-009).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, readData, setJobs, setQueue, runNowItem, makeBot, waitFor } = require('./helpers');

const runsOf = async (srv, bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const ranAll = (srv, bot, n) => waitFor(async () => { const r = await runsOf(srv, bot); return r.length === n && r.every((x) => x.status !== 'running'); }, { timeout: 30_000, what: `${n} runs of ${bot.name}` });
const addJob = async (srv, bot, fields) => {
  const r = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', assessment: 'Needs AI', ...fields } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};
const soon = () => new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16); // the test server runs on UTC
const waitingFor = (srv, bot) => (readData(srv.data, 'queue.json').queues[bot.id] || []).map((x) => x.key);
const jobsOf = async (srv, bot) => (await srv.api(`/bots/${bot.id}`)).data.jobs.map((j) => j.id);

test('a one-time job that comes due while its bot works runs when the bot is free, and its reply arrives; a job removed while it waited does not run', async () => {
  let srv = await startServer();
  try {
    const target = await makeBot(srv, { name: 'Busy Once', emoji: '⌛' });
    const busy = await addJob(srv, target, { name: 'Daily', cron: '0 4 * * *', prompt: 'Something long' });
    const once = await addJob(srv, target, { name: 'Once only', at: soon(), prompt: 'Check the PRs once' });
    const removedOnce = await addJob(srv, target, { name: 'Once, then not', at: soon(), prompt: 'Never asked once' });
    const removed = await addJob(srv, target, { name: 'Daily, then not', cron: '0 3 * * *', prompt: 'Never asked daily' });
    // Back on, botdot starts the "Run now" that waited, which is held, and finds both one-time jobs due.
    const due = new Date(Date.now() - 3600e3).toISOString();
    srv.hold();
    srv = await restartServer(srv, (data) => {
      setJobs(data, { [once.id]: { at: due }, [removedOnce.id]: { at: due } });
      setQueue(data, (q) => { q.queues[target.id] = [runNowItem(busy)]; });
    });
    await waitFor(() => waitingFor(srv, target).length === 2, { what: 'both one-time jobs to come due' });
    assert.deepEqual((await srv.api(`/bots/${target.id}/jobs/${removed.id}/run`, { method: 'POST' })).data, { queued: true });
    assert.deepEqual(waitingFor(srv, target).sort(), [`job:${removed.id}`, `once:${once.id}`, `once:${removedOnce.id}`].sort());
    const item = readData(srv.data, 'queue.json').queues[target.id].find((x) => x.key === `once:${once.id}`);
    assert.deepEqual([item.kind, item.jobId, item.trigger, item.at], ['job', once.id, 'schedule', due], 'with the time it came due for');
    assert.ok((await jobsOf(srv, target)).includes(once.id), 'it stays in the bot\'s jobs while it waits, so it can still be removed');
    for (const job of [removedOnce, removed]) assert.equal((await srv.api(`/bots/${target.id}/jobs/${job.id}`, { method: 'DELETE' })).status, 200);

    srv.reply('Nothing new.');
    srv.unhold();
    await ranAll(srv, target, 2);
    const run = (await runsOf(srv, target)).find((x) => x.jobId === once.id);
    assert.deepEqual([run.trigger, run.oneTime, run.notify, run.jobName], ['schedule', true, 'report-only', 'Once only']);
    assert.deepEqual([run.reporting, run.result, !!run.quiet], ['delivered', 'Nothing new.', false], 'its final reply reaches the owner');
    const rec = srv.runs().find((r) => r.stdin.includes('Check the PRs once'));
    assert.match(rec.system, /This run is a one-time job the owner asked for, at a time they chose: your final reply reaches the owner as it is/);
    assert.equal((await srv.api(`/bots/${target.id}`)).data.unread, 2, 'a new reply, beside the one the bot was working on');
    assert.deepEqual(await jobsOf(srv, target), [busy.id], 'gone once it started');
    for (const job of [removedOnce, removed]) assert.match(srv.log.join(''), new RegExp(`dropped (once|job):${job.id}: its job was removed`));
    assert.ok(!srv.runs().some((r) => /Never asked/.test(r.stdin)), 'the removed jobs did not run');
    assert.deepEqual(waitingFor(srv, target), []);
  } finally { srv.unhold(); await srv.stop(); }
});

test('a one-time job that comes up while too much is waiting stays, and runs once there is room', async () => {
  let srv = await startServer();
  try {
    const target = await makeBot(srv, { name: 'Late Starter', emoji: '⏳' });
    const daily = [];
    for (let i = 1; i <= 11; i++) daily.push(await addJob(srv, target, { name: `Daily ${i}`, cron: `0 ${i} * * *`, prompt: `Task ${i}` }));
    const job = await addJob(srv, target, { name: 'Once only', at: soon(), prompt: 'Check it once' });
    // Back on, botdot starts the first "Run now" that waited, which is held; ten more wait, and the job is due in
    // every minute: its schedule is each minute of this year, whatever the clock says when botdot is up. Its time
    // is the year's last second, still ahead: the catch-up after a restart leaves it, nothing is kept to try it,
    // and the scheduler's first step finds it due by its schedule alone. So what is kept below was kept because
    // the job found no room. (In the year's last second the time has passed, and the catch-up keeps it: the same.)
    const due = `${new Date().getUTCFullYear()}-12-31T23:59:59.000Z`;
    srv.hold();
    srv = await restartServer(srv, (data) => {
      setJobs(data, { [job.id]: { at: due, cron: '* * * * *' } });
      setQueue(data, (q) => { q.queues[target.id] = daily.map(runNowItem); });
    });
    await waitFor(() => srv.log.join('').includes(`not taking once:${job.id}`), { what: 'the job to come up' });
    assert.ok((await jobsOf(srv, target)).includes(job.id), 'it stays in the bot\'s jobs');
    assert.equal(waitingFor(srv, target).length, 10);
    const kept = readData(srv.data, 'queue.json');
    assert.deepEqual([kept.oneTimeRetries, kept.oneTimeRetryTimes], [[job.id], { [job.id]: due }], 'it found no room, so it is kept to be tried each minute, for that time');
    // Room: botdot is stopped while the bot still works, which cuts that run off. Back on, the first of the ten
    // that waited starts, held, and nine wait. The scheduler's next step, which a start brings at once, tries the
    // job again and finds room, in whichever minute that is. While everything was held no minute could take it
    // before: each found the ten waiting.
    srv = await restartServer(srv);
    await waitFor(() => waitingFor(srv, target).includes(`once:${job.id}`), { what: 'the job to be taken' });
    assert.equal(waitingFor(srv, target).length, 10, 'the nine that still wait, and the job');
    assert.deepEqual(readData(srv.data, 'queue.json').oneTimeRetries, [], 'taken: nothing is kept to try it');
    srv.unhold();
    await ranAll(srv, target, 12); // the run that was cut off, the ten that waited and the job
    assert.equal((await runsOf(srv, target)).filter((x) => x.status === 'interrupted').length, 1);
    const run = (await runsOf(srv, target)).find((x) => x.jobId === job.id);
    assert.deepEqual([run.trigger, run.oneTime, run.prompt], ['schedule', true, 'Check it once']);
    assert.ok(!(await jobsOf(srv, target)).includes(job.id), 'gone once it ran');
    assert.deepEqual(readData(srv.data, 'queue.json'), { queues: {}, oneTimeRetries: [], oneTimeRetryTimes: {} });
  } finally { srv.unhold(); await srv.stop(); }
});
