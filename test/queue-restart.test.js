// Queued work survives a restart (bots.js, data/queue.json): what waited runs once when botdot is back, work that
// may no longer run is dropped, a broken queue file is kept aside, and one-time jobs missed while it was off catch up.
// Tests here count on work for a busy bot waiting its turn: one run of a bot at a time (ADR 062 lets three go at
// once, and at that limit the same holds).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor, sleep, seedRuns } = require('./helpers');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const runsOf = async (srv, bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const ranAll = (srv, bot, n) => waitFor(async () => { const r = await runsOf(srv, bot); return r.length === n && r.every((x) => x.status !== 'running'); }, { timeout: 30_000, what: `${n} runs of ${bot.name}` });
const addJob = async (srv, bot, fields) => {
  const r = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', prompt: 'Do it.', assessment: 'Needs AI', ...fields } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};
// Stop botdot, let the held runs go (the stand-in Claude outlives it), change its data, start it again.
async function restart(srv, change = () => {}) {
  await srv.stop();
  srv.unhold();
  change(srv.data);
  return startServer({ dir: srv.dir });
}
const editBots = (data, fn) => { const f = path.join(data, 'bots.json'); fs.writeFileSync(f, JSON.stringify(fn(readJson(f)), null, 2)); };

test('work waiting behind a busy bot runs once after a restart', async () => {
  let srv = await startServer();
  try {
    const worker = await makeBot(srv, { name: 'Worker', emoji: '🛠️' });
    const sender = await makeBot(srv, { name: 'Sender', emoji: '📤' });
    const job = await addJob(srv, worker, { name: 'Nightly', cron: '0 3 * * *' });
    const first = await heldRun(srv, worker, 'Something long');
    const s = await heldRun(srv, sender);
    for (const t of ['Task A', 'Task B']) assert.equal((await self(srv, s.token, 'message', { to: worker.id, message: t, priority: true })).data.delivered, 'queued');
    assert.deepEqual((await srv.api(`/bots/${worker.id}/jobs/${job.id}/run`, { method: 'POST' })).data, { queued: true });
    assert.deepEqual((await srv.api(`/memory/review/${worker.id}`, { method: 'POST' })).data, { queued: true });
    // The owner's message to the busy bot waits in the same file (ADR 011), and is the first to start afterwards.
    const mine = (await srv.api(`/bots/${worker.id}/run`, { method: 'POST', body: { prompt: 'And one thing more' } })).data;
    assert.equal(mine.status, 'queued');
    assert.deepEqual(readJson(path.join(srv.data, 'queue.json')).queues[worker.id].map((x) => x.kind), ['message', 'message', 'job', 'review', 'owner']);

    srv = await restart(srv);
    await ranAll(srv, worker, 6);
    const runs = await runsOf(srv, worker);
    assert.equal(runs.find((r) => r.id === first.run.id).status, 'interrupted', 'the run cut off by the restart is not repeated');
    const after = runs.filter((r) => r.id !== first.run.id);
    assert.deepEqual([after.at(-1).id, after.at(-1).prompt, after.at(-1).trigger], [mine.id, 'And one thing more', 'manual'], "the owner's message started first, as the run it was answered with");
    assert.deepEqual(after.filter((r) => r.trigger === 'bot').map((r) => r.prompt).sort(), ['Task A', 'Task B']);
    assert.equal(after.filter((r) => r.jobId === job.id && r.trigger === 'manual').length, 1);
    assert.equal(after.filter((r) => r.trigger === 'review').length, 1);
    await sleep(500);
    assert.equal((await runsOf(srv, worker)).length, 6, 'each ran once');
    assert.deepEqual(readJson(path.join(srv.data, 'queue.json')).queues, {});
  } finally { srv.unhold(); await srv.stop(); }
});

test('queued work for a deleted bot or an unapproved job is dropped, and says why', async () => {
  let srv = await startServer();
  try {
    const keep = await makeBot(srv, { name: 'Keeper', emoji: '🗝️' });
    const gone = await makeBot(srv, { name: 'Goner', emoji: '👻' });
    const sender = await makeBot(srv, { name: 'Sender', emoji: '📤' });
    const job = await addJob(srv, keep, { name: 'Report', cron: '0 3 * * *' });
    await heldRun(srv, keep);
    await heldRun(srv, gone);
    const s = await heldRun(srv, sender);
    assert.equal((await self(srv, s.token, 'message', { to: gone.id, message: 'Still there?', priority: true })).data.delivered, 'queued');
    assert.deepEqual((await srv.api(`/bots/${keep.id}/jobs/${job.id}/run`, { method: 'POST' })).data, { queued: true });

    srv = await restart(srv, (data) => editBots(data, (all) => all.filter((b) => b.id !== gone.id).map((b) => (b.id === keep.id ? { ...b, jobs: b.jobs.map((j) => ({ ...j, approved: false })) } : b))));
    await waitFor(() => /dropped job:.*waiting for your approval/.test(srv.log.join('')) && /dropped msg:.*the bot was deleted/.test(srv.log.join('')), { what: 'both to be dropped' });
    assert.equal((await runsOf(srv, keep)).length, 1, 'only its interrupted run');
    const state = readJson(path.join(srv.data, 'job-state.json'))[job.id];
    assert.equal(state.status, 'error');
    assert.match(state.error, /waiting for your approval/);
  } finally { srv.unhold(); await srv.stop(); }
});

test('a broken queue file is kept aside, and botdot starts with an empty queue', async () => {
  const first = await startServer();
  await first.stop();
  fs.writeFileSync(path.join(first.data, 'queue.json'), '{"queues": {"x": [');
  const srv = await startServer({ dir: first.dir });
  try {
    assert.ok(fs.readdirSync(srv.data).some((f) => f.startsWith('queue.json.broken-')));
    assert.match(srv.log.join(''), /queue\.json couldn't be read/);
    const bot = await makeBot(srv);
    const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Hi' } });
    await srv.finished(r.data.id);
  } finally { srv.unhold(); await srv.stop(); }
});

test('a one-time job missed while botdot was off runs when it is back, if it came due in the last day', async () => {
  let srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Planner', emoji: '🗓️' });
    const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
    const recent = await addJob(srv, bot, { name: 'Missed this morning', at: soon });
    const old = await addJob(srv, bot, { name: 'Missed last week', at: soon });
    const ago = (ms) => new Date(Date.now() - ms).toISOString();
    srv = await restart(srv, (data) => editBots(data, (all) => all.map((b) => ({ ...b, jobs: (b.jobs || []).map((j) => (j.id === recent.id ? { ...j, at: ago(2 * 3600e3) } : j.id === old.id ? { ...j, at: ago(3 * 864e5) } : j)) }))));
    const run = await waitFor(async () => (await runsOf(srv, bot)).find((r) => r.jobId === recent.id), { what: 'the missed job to run' });
    await srv.finished(run.id);
    const jobs = (await srv.api('/bots')).data.find((b) => b.id === bot.id).jobs.map((j) => j.id);
    assert.deepEqual(jobs, [old.id], 'it ran and is gone; the one from last week stays');
    assert.equal((await runsOf(srv, bot)).length, 1);
  } finally { srv.unhold(); await srv.stop(); }
});

test('a one-time job that waited behind a busy bot runs once after a restart, and is not offered again', async () => {
  let srv = await startServer();
  try {
    const worker = await makeBot(srv, { name: 'Waiter', emoji: '🕰️' });
    const sender = await makeBot(srv, { name: 'Sender', emoji: '📤' });
    const job = await addJob(srv, worker, { name: 'Once only', at: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16), prompt: 'Check it once' });
    const moved = await addJob(srv, worker, { name: 'Moved to later', at: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16), prompt: 'Not yet' });
    const off = await addJob(srv, worker, { name: 'Switched off', at: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16), prompt: 'Not at all' });
    const sooner = await addJob(srv, worker, { name: 'Moved, and due again', at: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16), prompt: 'Check it after all' });
    await heldRun(srv, worker, 'Something long');
    const s = await heldRun(srv, sender);
    assert.equal((await self(srv, s.token, 'message', { to: worker.id, message: 'Task A', priority: true })).data.delivered, 'queued');
    // As botdot leaves it when the job came due an hour ago behind the running bot: the job still among the
    // bot's jobs, its work in the queue after the message. Back on, the catch-up finds a job due in the last day.
    const due = new Date(Date.now() - 3600e3).toISOString();
    srv = await restart(srv, (data) => {
      const later = new Date(Date.now() - 600e3).toISOString();
      editBots(data, (all) => all.map((b) => ({ ...b, jobs: (b.jobs || []).map((j) => (j.id === job.id ? { ...j, at: due } : j.id === off.id ? { ...j, at: due, enabled: false } : j.id === sooner.id ? { ...j, at: later } : j)) })));
      const f = path.join(data, 'queue.json');
      const q = readJson(f);
      q.queues[worker.id].push({ key: `once:${job.id}`, kind: 'job', jobId: job.id, trigger: 'schedule', at: due, queuedAt: due });
      // And one the owner moved to another day while it waited: it runs then, not now.
      q.queues[worker.id].push({ key: `once:${moved.id}`, kind: 'job', jobId: moved.id, trigger: 'schedule', at: due, queuedAt: due });
      // One switched off while it waited does not run; one moved to a time that has passed meanwhile runs, once.
      q.queues[worker.id].push({ key: `once:${off.id}`, kind: 'job', jobId: off.id, trigger: 'schedule', at: due, queuedAt: due });
      q.queues[worker.id].push({ key: `once:${sooner.id}`, kind: 'job', jobId: sooner.id, trigger: 'schedule', at: due, queuedAt: due });
      fs.writeFileSync(f, JSON.stringify(q));
    });
    await ranAll(srv, worker, 4);
    await sleep(500);
    const runs = await runsOf(srv, worker);
    assert.equal(runs.length, 4, 'the interrupted run, the message and the two jobs: each once');
    assert.equal(runs.filter((r) => r.jobId === sooner.id).length, 1);
    const run = runs.find((r) => r.jobId === job.id);
    assert.deepEqual([run.trigger, run.oneTime, run.prompt], ['schedule', true, 'Check it once']);
    assert.deepEqual((await srv.api(`/bots/${worker.id}`)).data.jobs.map((j) => j.id), [moved.id, off.id], 'gone once they started; the moved one and the one switched off stay');
    assert.match(srv.log.join(''), new RegExp(`dropped once:${moved.id}: its time was changed`));
    assert.match(srv.log.join(''), new RegExp(`dropped once:${off.id}: its job was switched off`));
    for (const j of [moved, off]) assert.equal(readJson(path.join(srv.data, 'job-state.json'))[j.id], undefined, 'and shows no failure');
    assert.deepEqual(readJson(path.join(srv.data, 'queue.json')), { queues: {}, oneTimeRetries: [off.id], oneTimeRetryTimes: { [off.id]: due } }, 'the one switched off is tried each minute, for when it is switched on with that time');
  } finally { srv.unhold(); await srv.stop(); }
});

// A scheduled job's failure that is held through quiet hours (BUSY-004) is on record like a held report: the run,
// with the row it carries, and the job's state. botdot finds it again after a restart, and tells it once.
test("a job's held failure is found again after a restart, and told once when quiet hours have ended", async () => {
  let srv = await startServer();
  try {
    const hour = new Date().getUTCHours();
    await srv.api('/settings', { method: 'PUT', body: { quietHours: { start: hour, end: (hour + 2) % 24, timeZone: 'UTC' } } });
    const bot = await makeBot(srv, { name: 'Night Shift', emoji: '🌙' });
    const job = await addJob(srv, bot, { name: 'Nightly', cron: '0 3 * * *' });
    const since = new Date(Date.now() - 3600_000).toISOString();
    let id;
    srv = await restart(srv, (data) => {
      const failed = { trigger: 'schedule', status: 'error', jobId: job.id, jobName: job.name, customPrompt: false, result: null, error: 'boom' };
      // Three failures of one row: the first held, with the count the later ones gave it; the others quiet.
      const ids = seedRuns(srv, bot, [{ ...failed, reporting: 'held', row: { failures: 3, since } }, { ...failed, reporting: 'quiet', times: 2 }]);
      id = ids[0];
      fs.writeFileSync(path.join(data, 'job-state.json'), JSON.stringify({ [job.id]: { status: 'error', runId: ids[2], at: new Date().toISOString(), row: { failures: 3, since, held: id } } }));
    });
    const seen = async () => ({ run: (await srv.api(`/runs/${id}`)).data, bot: (await srv.api(`/bots/${bot.id}`)).data });
    // Still quiet hours: held, and nothing is new.
    let now = await seen();
    assert.deepEqual([now.run.reporting, now.run.quiet, now.bot.unread, now.bot.jobs[0].last.failures], ['held', true, 0, 3]);
    // Quiet hours end while botdot is off.
    srv = await restart(srv, (data) => {
      const file = path.join(data, 'settings.json');
      const settings = readJson(file);
      settings.quietHours.start = settings.quietHours.end;
      fs.writeFileSync(file, JSON.stringify(settings));
    });
    now = await waitFor(async () => { const s = await seen(); return s.run.reporting === 'delivered' ? s : null; }, { what: 'the held failure to be told' });
    assert.ok(now.run.deliveredAt);
    assert.equal(now.run.quiet, undefined);
    assert.match(now.run.problem, /^Failed 3 times since \d\d:\d\d\. Something went wrong and I couldn't finish\. It said: “boom”\./);
    assert.deepEqual([now.bot.unread, now.bot.firstUnread], [1, id], 'one new reply for the three');
    assert.deepEqual([now.bot.jobs[0].last.status, now.bot.jobs[0].last.failures, now.bot.jobs[0].last.since], ['error', 3, since]);
    assert.equal(readJson(path.join(srv.data, 'job-state.json'))[job.id].row.held, undefined, 'the row has no failure that waits any more');
    const deliveredAt = now.run.deliveredAt;
    srv = await restart(srv);
    now = await seen();
    assert.deepEqual([now.run.deliveredAt, now.bot.unread], [deliveredAt, 1], 'a restart does not tell it twice');
  } finally { srv.unhold(); await srv.stop(); }
});
