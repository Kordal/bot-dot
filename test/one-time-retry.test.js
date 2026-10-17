// A one-time job ("at") is tried outside its time only while it still has the time it came due for (QW-009,
// bots.js oneTimeRetries): one that waited behind a busy bot and was switched off, or lost its approval, runs
// within a minute once it is switched on or approved; moved to another time meanwhile, it runs then and not now.
// An entry an older botdot kept has no time: it is tried once if its job's time has passed, and dropped if that
// time is still ahead, which only a moved job has (QW-010).
// No test here waits for a schedule: the jobs' times are put into the past while botdot is stopped.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, readData, setJobs, setQueue, onceItem, makeBot, waitFor, sleep } = require('./helpers');

const runsOf = async (srv, bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const ranAll = (srv, bot, n) => waitFor(async () => { const r = await runsOf(srv, bot); return r.length === n && r.every((x) => x.status !== 'running'); }, { timeout: 30_000, what: `${n} runs of ${bot.name}` });
const local = (d) => d.toISOString().slice(0, 16); // the test server runs on UTC
const addJob = async (srv, bot, fields) => {
  const r = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', assessment: 'Needs AI', at: local(new Date(Date.now() + 3 * 864e5)), ...fields } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};

test('a one-time job that could not run when it waited runs once it may, unless its time was moved: then it runs at its new time, also when an older botdot kept it', async () => {
  let srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Planner', emoji: '🗓️' });
    const keep = await addJob(srv, bot, { name: 'Switched off, then on', prompt: 'Run me when I am on' });
    const moved = await addJob(srv, bot, { name: 'Switched off, then moved', prompt: 'Not before my new time' });
    const okd = await addJob(srv, bot, { name: 'Changed, then approved', prompt: 'Run me once approved' });
    const older = await addJob(srv, bot, { name: 'Kept by an older botdot', prompt: 'Run me once all the same' });
    // Kept by an older botdot too, and moved by the owner since: its time stays the three days ahead it was added with.
    const olderMoved = await addJob(srv, bot, { name: 'Kept by an older botdot, then moved', prompt: 'Not before my time either' });
    // As botdot leaves them when they came due two days ago behind a running bot, and were changed while they
    // waited: two switched off, one waiting for the owner's OK again. Two days, so that only the entries below
    // can run them: the catch-up after a restart takes jobs of the last day.
    const due = new Date(Date.now() - 2 * 864e5).toISOString();
    srv = await restartServer(srv, (data) => {
      setJobs(data, { [keep.id]: { at: due, enabled: false }, [moved.id]: { at: due, enabled: false }, [okd.id]: { at: due, approved: false }, [older.id]: { at: due } });
      // An older botdot kept the ids to try again, and no times.
      setQueue(data, (q) => { q.queues[bot.id] = [keep, moved, okd].map((j) => onceItem(j, due)); q.oneTimeRetries = [older.id, olderMoved.id]; });
    });
    await ranAll(srv, bot, 1);
    await sleep(500);
    assert.deepEqual((await runsOf(srv, bot)).map((r) => r.jobId), [older.id], 'an entry without a time is tried, once, when its job\'s time has passed, and not when that time is ahead');
    const waiting = readData(srv.data, 'queue.json');
    assert.deepEqual(waiting.queues, {}, 'none of the three started');
    assert.deepEqual(waiting.oneTimeRetryTimes, { [keep.id]: due, [moved.id]: due, [okd.id]: due }, 'each is tried again, for the time it came due for; the entry of the job that was moved is dropped');
    assert.deepEqual([...waiting.oneTimeRetries].sort(), [keep.id, moved.id, okd.id].sort(), 'and their ids are a list, as an older botdot reads them');
    assert.match(srv.log.join(''), new RegExp(`dropped once:${okd.id}: its job is waiting for your approval`));
    for (const j of [keep, moved, okd]) assert.equal(readData(srv.data, 'job-state.json')[j.id], undefined, 'and shows no failure');

    // The owner switches one on as it is, moves the other to another day, and approves the third.
    const later = new Date(Date.now() + 2 * 864e5);
    later.setUTCSeconds(0, 0);
    const put = (job, body) => srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body });
    assert.equal((await put(keep, { enabled: true })).status, 200);
    const movedNow = await put(moved, { enabled: true, at: local(later) });
    assert.deepEqual([movedNow.status, movedNow.data.at], [200, later.toISOString()]);
    assert.equal((await srv.api(`/bots/${bot.id}/jobs/${okd.id}/approve`, { method: 'POST', body: {} })).status, 200);

    // The scheduler's next minute, which a restart brings at once.
    srv = await restartServer(srv);
    await ranAll(srv, bot, 3);
    await sleep(500);
    const runs = await runsOf(srv, bot);
    assert.deepEqual(runs.map((r) => r.jobId).sort(), [keep.id, okd.id, older.id].sort(), 'each ran once; the moved one did not');
    for (const r of runs) assert.deepEqual([r.trigger, r.oneTime], ['schedule', true]);
    assert.ok(!srv.runs().some((r) => /Not before my (new time|time either)/.test(r.stdin)));
    const jobs = (await srv.api(`/bots/${bot.id}`)).data.jobs;
    assert.deepEqual(jobs.map((j) => [j.id, j.enabled, j.at, j.nextRunAt]), [[moved.id, true, later.toISOString(), later.toISOString()], [olderMoved.id, true, olderMoved.at, olderMoved.at]], 'each waits for its time; the others are gone');
    assert.deepEqual(readData(srv.data, 'queue.json'), { queues: {}, oneTimeRetries: [], oneTimeRetryTimes: {} }, 'and is tried at no other time');
  } finally { srv.unhold(); await srv.stop(); }
});
