// A busy bot's queue (bots.js startOrQueue): at most 10 AI runs wait their turn. When it's full, work is
// never reported as taken and then dropped: a message goes to the inbox, "Run now" says so, and a follow-up
// waits until there's room. A one-time job that finds it full is in test/one-time-queued.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, feed, waitFor, sleep } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
// A sender of its own for each test: a bot that asked with priority is started once more when the bots it asked
// have finished (QW-004), and that follow-up must not be taken for the next test's held run.
let senders = 0;
const newSender = () => makeBot(srv, { name: `Sender ${++senders}`, emoji: '📤' });
after(() => { srv.unhold(); return srv.stop(); });

const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
// Wait until a bot has made n runs and none is still going.
const ranAll = (bot, n, timeout = 30_000) => waitFor(async () => { const r = await runsOf(bot); return r.length === n && r.every((x) => x.status !== 'running'); }, { timeout, what: `${n} runs of ${bot.name}` });
// The sender (held, so its token stays valid) sends n priority messages; returns how each was delivered.
async function fill(target, n, s) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push((await self(srv, s.token, 'message', { to: target.id, message: `Task ${i}`, priority: true })).data.delivered);
  return out;
}
const addJob = async (bot, fields) => {
  const r = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', prompt: 'Do it.', assessment: 'Needs AI', ...fields } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};

test('a full queue takes no more: the rest go to the inbox, and every message is read', async () => {
  const target = await makeBot(srv, { name: 'Busy One', emoji: '🐝' });
  await heldRun(srv, target, 'Something long');
  const s = await heldRun(srv, await newSender());
  assert.deepEqual(await fill(target, 12, s), [...Array(10).fill('queued'), 'inbox', 'inbox']);
  assert.deepEqual((await srv.api(`/bots/${target.id}/inbox`)).data.map((m) => m.text), ['Task 11', 'Task 12']);
  // Full of other work, it still takes the owner's message: theirs have their own ten places (ADR 011).
  const mine = await srv.api(`/bots/${target.id}/run`, { method: 'POST', body: { prompt: 'And mine' } });
  assert.deepEqual([mine.status, mine.data.status], [201, 'queued']);
  srv.unhold();
  await ranAll(target, 12); // its first run, the owner's message and the ten queued ones
  assert.match(srv.runs().filter(isRunOf(target))[1].stdin, /^And mine/, "the owner's message before the ten");
  const read = srv.runs().filter(isRunOf(target)).map((x) => x.stdin).join('\n');
  for (let i = 1; i <= 12; i++) assert.match(read, new RegExp(`Task ${i}\\b`));
  await srv.finished(s.run.id);
});

test('"Run now" says when too much is waiting; the same job twice is just queued', async () => {
  const target = await makeBot(srv, { name: 'Job Taker', emoji: '🧰' });
  const a = await addJob(target, { name: 'Job A', cron: '0 3 * * *' });
  const b = await addJob(target, { name: 'Job B', cron: '0 4 * * *' });
  await heldRun(srv, target);
  const s = await heldRun(srv, await newSender());
  const runNow = (job) => srv.api(`/bots/${target.id}/jobs/${job.id}/run`, { method: 'POST' });
  assert.deepEqual((await runNow(a)).data, { queued: true });
  assert.deepEqual(await fill(target, 9, s), Array(9).fill('queued'));
  const again = await runNow(a);
  assert.equal(again.status, 200, 'already waiting counts as queued, even when full');
  assert.deepEqual(again.data, { queued: true });
  const full = await runNow(b);
  assert.equal(full.status, 429);
  assert.match(full.data.error, /Job Taker already has 10 tasks waiting/);
  srv.unhold();
  await ranAll(target, 11);
  await srv.finished(s.run.id);
});

test('answers a bot waited for are kept while its queue is full, and its follow-up runs later', async () => {
  const asker = await makeBot(srv, { name: 'Asker', emoji: '🙋' });
  const helper = await makeBot(srv, { name: 'Helper', emoji: '🤝' });
  const a = await heldRun(srv, asker, 'Ask Helper and sum up.');
  assert.equal((await self(srv, a.token, 'message', { to: helper.id, message: 'Your status?', priority: true })).data.delivered, 'started');
  const h = await srv.nextRun(isRunOf(helper), 'Helper to start');
  const s = await heldRun(srv, await newSender());
  assert.deepEqual(await fill(asker, 10, s), Array(10).fill('queued'));
  // Helper answers: Asker's wait is over, but there's no room for its follow-up yet.
  assert.equal((await self(srv, h.self.env.RUN_TOKEN, 'message', { to: asker.id, message: 'Helper: all green.', priority: true })).data.delivered, 'inbox');
  await waitFor(() => srv.log.join('').includes(`not taking replies:${a.run.id}`), { what: 'the follow-up to be refused' });
  const waits = JSON.parse(fs.readFileSync(path.join(srv.data, 'awaits.json'), 'utf8'));
  assert.ok(waits.some((w) => w.runId === a.run.id), 'the wait is kept');
  srv.unhold();
  const follow = await waitFor(async () => (await runsOf(asker)).find((x) => x.trigger === 'replies'), { timeout: 30_000, what: 'the follow-up' });
  const done = await srv.finished(follow.id);
  assert.equal(done.chainId, a.run.id);
  assert.ok(srv.runs().filter(isRunOf(asker)).some((x) => /Helper: all green\./.test(x.stdin)), 'it got the answer');
  await ranAll(asker, 12); // its first run, ten messages and the follow-up
  await srv.finished(s.run.id);
});

test('a follow-up that could not be queued keeps its wait, and runs once when it can', async () => {
  const asker = await makeBot(srv, { name: 'Unlucky Asker', emoji: '🎲' });
  const helper = await makeBot(srv, { name: 'Answerer', emoji: '📣' });
  const events = feed(srv);
  const a = await heldRun(srv, asker, 'Ask Answerer and sum up.');
  assert.equal((await self(srv, a.token, 'message', { to: helper.id, message: 'Your status?', priority: true })).data.delivered, 'started');
  const h = await srv.nextRun(isRunOf(helper), 'Answerer to start');
  await events.wait('run_started', (d) => d.botId === helper.id); // the feed is listening
  // queue.json can't be written (writeJson's temp file has no room), so queueing the follow-up throws.
  const blocker = path.join(srv.data, `queue.json.${srv.pid}.tmp`);
  fs.mkdirSync(blocker);
  const stoppedWaiting = (e) => e.type === 'waiting' && e.data.botIds?.includes(asker.id);
  try {
    assert.equal((await self(srv, h.self.env.RUN_TOKEN, 'message', { to: asker.id, message: 'Answerer: all green.', priority: true })).data.delivered, 'inbox');
    await waitFor(() => srv.log.join('').includes(`${asker.name}: couldn't start its follow-up`), { what: 'the failure to be logged' });
    await sleep(300); // past the 100 ms after which a settled wait is announced
    const waits = JSON.parse(fs.readFileSync(path.join(srv.data, 'awaits.json'), 'utf8'));
    assert.ok(waits.some((w) => w.runId === a.run.id), 'the wait is kept');
    assert.ok(!events.events.some(stoppedWaiting), 'its face still shows it waits');
  } finally { fs.rmdirSync(blocker); }
  // The fault is gone: when its run ends it starts once more, once, with the answer.
  srv.unhold();
  const follow = await waitFor(async () => (await runsOf(asker)).find((x) => x.trigger === 'replies'), { timeout: 30_000, what: 'the follow-up' });
  await srv.finished(follow.id);
  assert.ok(srv.runs().filter(isRunOf(asker)).some((x) => /Answerer: all green\./.test(x.stdin)), 'it got the answer');
  await ranAll(asker, 2);
  assert.equal((await runsOf(asker)).filter((x) => x.trigger === 'replies').length, 1, 'one follow-up');
  const settled = JSON.parse(fs.readFileSync(path.join(srv.data, 'awaits.json'), 'utf8'));
  assert.ok(!settled.some((w) => w.runId === a.run.id), 'then the wait is settled');
  await events.wait('waiting', (d) => d.botIds?.includes(asker.id)); // and its face stops waiting
  events.close();
});

test('a queued follow-up that fails as its turn comes keeps its wait, and runs once with the answer when it can', async () => {
  const asker = await makeBot(srv, { name: 'Late Asker', emoji: '🐢' });
  const helper = await makeBot(srv, { name: 'Quick Answerer', emoji: '🐇' });
  const events = feed(srv);
  const a = await heldRun(srv, asker, 'Ask Quick Answerer and sum up.');
  assert.equal((await self(srv, a.token, 'message', { to: helper.id, message: 'Your status?', priority: true })).data.delivered, 'started');
  const h = await srv.nextRun(isRunOf(helper), 'Quick Answerer to start');
  await events.wait('run_started', (d) => d.botId === helper.id); // the feed is listening
  // The answer comes while the asker is still at work: its follow-up waits its turn, and so does its wait.
  assert.equal((await self(srv, h.self.env.RUN_TOKEN, 'message', { to: asker.id, message: 'Quick: all green.', priority: true })).data.delivered, 'inbox');
  await waitFor(() => (JSON.parse(fs.readFileSync(path.join(srv.data, 'queue.json'), 'utf8')).queues?.[asker.id] || []).some((x) => x.key === `replies:${a.run.id}`), { what: 'the follow-up to be queued' });
  const awaitsNow = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'awaits.json'), 'utf8'));
  assert.ok(awaitsNow().some((w) => w.runId === a.run.id), 'a queued follow-up keeps its wait');
  // The asker's workspace is made unusable, so its follow-up can't start when its run ends.
  const workspace = path.join(srv.data, 'workspaces', asker.id);
  const aside = `${workspace}.aside`;
  fs.renameSync(workspace, aside);
  fs.writeFileSync(workspace, '');
  const stoppedWaiting = (e) => e.type === 'waiting' && e.data.botIds?.includes(asker.id);
  try {
    srv.release(a.rec);
    await srv.finished(a.run.id);
    await waitFor(() => srv.log.join('').includes(`couldn't start replies:${a.run.id}`), { what: 'the failed start to be logged' });
    await sleep(300); // past the 100 ms after which a settled wait is announced
    assert.ok(awaitsNow().some((w) => w.runId === a.run.id), 'the wait is still kept');
    assert.ok(!events.events.some(stoppedWaiting), 'its face still shows it waits');
    assert.equal((await srv.api('/bots')).data.find((b) => b.id === asker.id).state, 'waiting');
    assert.equal((await runsOf(asker)).filter((x) => x.trigger === 'replies').length, 0, 'no follow-up yet');
  } finally {
    fs.rmSync(workspace);
    fs.renameSync(aside, workspace);
  }
  // The fault is gone: the next pass (here the end of the answerer's run) starts it, once, with the answer.
  srv.unhold();
  const follow = await waitFor(async () => (await runsOf(asker)).find((x) => x.trigger === 'replies'), { timeout: 30_000, what: 'the follow-up' });
  await srv.finished(follow.id);
  assert.match(srv.runs().filter(isRunOf(asker)).at(-1).stdin, /Quick: all green\./, 'it got the answer');
  await sleep(500); // time for a second follow-up to start, if there were one
  await ranAll(asker, 2);
  assert.equal((await runsOf(asker)).filter((x) => x.trigger === 'replies').length, 1, 'one follow-up');
  assert.ok(!awaitsNow().some((w) => w.runId === a.run.id), 'then the wait is settled');
  await events.wait('waiting', (d) => d.botIds?.includes(asker.id)); // and its face stops waiting
  events.close();
});

test('a later answer to the same run while its follow-up is queued goes along in that one follow-up', async () => {
  const asker = await makeBot(srv, { name: 'Twice Asker', emoji: '🪃' });
  const first = await makeBot(srv, { name: 'First Answerer', emoji: '🥇' });
  const second = await makeBot(srv, { name: 'Second Answerer', emoji: '🥈' });
  const a = await heldRun(srv, asker, 'Ask both and sum up.');
  // The first answer: its follow-up waits its turn behind the asker's run.
  assert.equal((await self(srv, a.token, 'message', { to: first.id, message: 'Your status?', priority: true })).data.delivered, 'started');
  const f = await srv.nextRun(isRunOf(first), 'First Answerer to start');
  assert.equal((await self(srv, f.self.env.RUN_TOKEN, 'message', { to: asker.id, message: 'First: all green.', priority: true })).data.delivered, 'inbox');
  await waitFor(() => (JSON.parse(fs.readFileSync(path.join(srv.data, 'queue.json'), 'utf8')).queues?.[asker.id] || []).some((x) => x.key === `replies:${a.run.id}`), { what: 'the follow-up to be queued' });
  // The same run asks again, and that answer comes while the follow-up still waits.
  assert.equal((await self(srv, a.token, 'message', { to: second.id, message: 'And yours?', priority: true })).data.delivered, 'started');
  const s = await srv.nextRun(isRunOf(second), 'Second Answerer to start');
  assert.equal((await self(srv, s.self.env.RUN_TOKEN, 'message', { to: asker.id, message: 'Second: all green.', priority: true })).data.delivered, 'inbox');
  srv.unhold();
  const follow = await waitFor(async () => (await runsOf(asker)).find((x) => x.trigger === 'replies'), { timeout: 30_000, what: 'the follow-up' });
  await srv.finished(follow.id);
  await sleep(500); // time for a second follow-up to start, if there were one
  await waitFor(async () => (await runsOf(asker)).every((x) => x.status !== 'running'), { timeout: 30_000, what: `${asker.name} to be done` });
  assert.equal((await runsOf(asker)).filter((x) => x.trigger === 'replies').length, 1, 'one follow-up');
  const told = srv.runs().filter(isRunOf(asker)).at(-1).stdin;
  assert.match(told, /The teammates you asked have answered: 🥇 First Answerer.*, 🥈 Second Answerer/, 'it is told of both');
  assert.match(told, /First: all green\./);
  assert.match(told, /Second: all green\./);
  const waits = JSON.parse(fs.readFileSync(path.join(srv.data, 'awaits.json'), 'utf8'));
  assert.ok(!waits.some((w) => w.runId === a.run.id), 'no wait is left');
});
