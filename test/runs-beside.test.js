// A message to a busy bot starts beside the run that is going, up to three runs of one bot at once (ADR 062; docs/api.md
// "A message that waits"): the owner's message and a teammate's start now, the fourth waits and starts as one ends, and
// a job still waits until the bot is free. A run that starts beside others is told what they were asked. Against a real
// botdot server and the stand-in for Claude, whose runs are held and released.
// What waits behind a bot that is at the limit is in test/message-waits.test.js and test/queue.test.js, with one run at
// a time (BOT_DOT_RUNS_MAX=1).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self, waitFor, readData } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const isRunOf = (bot) => (x) => x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`);
const send = (bot, prompt) => srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
const going = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data.filter((r) => r.status === 'running');
const waitingIn = (bot) => (readData(srv.data, 'queue.json').queues[bot.id] || []);

test('the owner\'s messages to a busy bot start beside its run, up to three; the fourth waits and starts when one ends', async () => {
  const bot = await makeBot(srv, { name: 'Side By Side', emoji: '🛤️' });
  srv.reply('Done.');
  const first = await heldRun(srv, bot, 'The long task');

  const second = await send(bot, 'A quick question');
  assert.deepEqual([second.status, second.data.status], [201, 'running'], 'it started at once, beside the long task');
  const rec2 = await srv.nextRun(isRunOf(bot), 'the second run');
  // It is told of the run that goes on beside it, and what that one was asked, as data.
  assert.match(rec2.system, /Other runs of yours are going at the same time as this one/);
  assert.match(rec2.system, /<other-runs>\n- The long task\n<\/other-runs>/);
  assert.doesNotMatch(first.rec.system, /Other runs of yours/, 'the first run started alone');

  const third = await send(bot, 'Another quick one');
  assert.equal(third.data.status, 'running');
  const rec3 = await srv.nextRun(isRunOf(bot), 'the third run');
  assert.match(rec3.system, /- The long task\n- A quick question\n/);
  assert.equal((await going(bot)).length, 3);
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.running, true);
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.runningCount, 3, 'its key says Working ×3');
  assert.equal((await srv.api('/bots')).data.find((b) => b.id === bot.id).runningCount, 3);

  // The fourth waits: three go at once.
  const fourth = await send(bot, 'And one more');
  assert.deepEqual([fourth.status, fourth.data.status], [201, 'queued']);
  assert.deepEqual(waitingIn(bot).map((x) => [x.kind, x.runId]), [['owner', fourth.data.id]]);
  assert.equal((await going(bot)).length, 3);

  // One ends, the one that waited starts, beside the two that still go.
  srv.release(rec2);
  await srv.finished(second.data.id);
  const rec4 = await srv.nextRun(isRunOf(bot), 'the fourth run');
  assert.match(rec4.stdin, /And one more/);
  assert.deepEqual(waitingIn(bot), []);
  assert.deepEqual((await going(bot)).map((r) => r.id).sort(), [first.run.id, third.data.id, fourth.data.id].sort());

  srv.unhold();
  for (const r of [first.rec, rec3, rec4]) srv.release(r);
  for (const id of [first.run.id, third.data.id, fourth.data.id]) assert.equal((await srv.finished(id)).status, 'success');
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.runningCount, 0);
});

test('a teammate\'s request to a busy bot starts beside its run, and its asker gets the answer', async () => {
  const asker = await makeBot(srv, { name: 'Asking Manager', emoji: '🧢' });
  const helper = await makeBot(srv, { name: 'Busy Admin', emoji: '🛠️' });
  srv.reply('The disk is fine.');
  const long = await heldRun(srv, helper, 'Read the whole hub');
  const ask = await heldRun(srv, asker, 'Ask the admin about the disk');

  const sent = (await self(srv, ask.token, 'message', { to: helper.id, message: 'How full is the disk?', priority: true })).data;
  assert.equal(sent.delivered, 'started', 'not "picks it up when free"');
  const answer = await srv.nextRun(isRunOf(helper), "the helper's run for the teammate");
  assert.match(answer.stdin, /How full is the disk\?/);
  assert.equal((await going(helper)).length, 2);
  assert.deepEqual(waitingIn(helper), []);

  srv.unhold();
  srv.release(ask.rec);
  srv.release(answer);
  const runs = await waitFor(async () => { const r = (await srv.api(`/runs?botId=${helper.id}`)).data; return r.find((x) => x.fromBot?.id === asker.id && x.status === 'success') || null; }, { what: "the helper's answer" });
  assert.equal(runs.result, 'The disk is fine.');
  srv.release(long.rec);
  await srv.finished(long.run.id);
});

test('a job of a busy bot still waits until the bot is free, and a message does not wait behind it', async () => {
  const bot = await makeBot(srv, { name: 'Job Keeper', emoji: '🗂️' });
  srv.reply('Done.');
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Tidy', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Tidy the folder.' } })).data;
  const h = await heldRun(srv, bot, 'The long task');

  const ran = await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' });
  assert.ok(ran.status < 300, JSON.stringify(ran.data));
  assert.deepEqual(waitingIn(bot).map((x) => x.kind), ['job'], 'the job waits');

  // The owner's message starts beside the run that is going, ahead of the job.
  const msg = await send(bot, 'Meanwhile, a question');
  assert.equal(msg.data.status, 'running');
  const recMsg = await srv.nextRun(isRunOf(bot), 'the message');
  assert.deepEqual(waitingIn(bot).map((x) => x.kind), ['job'], 'the job still waits');

  srv.release(recMsg);
  await srv.finished(msg.data.id);
  assert.deepEqual(waitingIn(bot).map((x) => x.kind), ['job'], 'one run still goes: the job waits for the bot to be free');

  srv.release(h.rec);
  await srv.finished(h.run.id);
  const recJob = await srv.nextRun((x) => isRunOf(bot)(x) && x.stdin.includes('Tidy the folder.'), 'the job, once the bot is free');
  assert.deepEqual(waitingIn(bot), []);
  srv.unhold();
  srv.release(recJob);
  await waitFor(async () => ((await going(bot)).length ? null : true), { what: 'the job to end' });
});
