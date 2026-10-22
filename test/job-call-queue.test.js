// Calls wait their turn (ADR 026, ADR 011): a call to a busy bot waits as its own work with its own body, at most
// three per job, apart from the ten places of the other work; the owner's messages still start first. A call to
// a switched-off job or a paused bot is refused and never kept for later. Through a real server and the stand-in
// for Claude, every run held until the test lets it end.
// Tests here count on work for a busy bot waiting its turn: one run of a bot at a time (ADR 062 lets three go at
// once, and at that limit the same holds).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor, sleep } = require('./helpers');
const { turnOn, call } = require('./call-helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv.unhold(); await srv.stop(); });

const isRunOf = (b) => (x) => !!x.self?.env && x.args.includes(`${b.emoji} ${b.name}`);
const addJob = async (b, name, prompt = `Do ${name}.`) => (await srv.api(`/bots/${b.id}/jobs`, { method: 'POST', body: { name, kind: 'ai', cron: '0 4 1 1 *', prompt } })).data;
const runsOf = async (b, j) => (await srv.api(`/runs?botId=${b.id}`)).data.filter((r) => r.jobId === j.id);

test('calls to a busy bot wait with their own bodies, three per job, and the owner\'s message starts before them', async () => {
  const bot = await makeBot(srv, { name: 'Door Watch', emoji: '🚪' });
  const job = await addJob(bot, 'Door');
  const other = await addJob(bot, 'Tidy');
  const key = await turnOn(srv, bot, job);
  srv.hold();
  const busy = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Keep busy.' } })).data;
  const first = await srv.nextRun(isRunOf(bot), 'the busy run');

  const taken = [];
  for (const body of ['open 1', 'open 2', 'open 3']) {
    const r = await call(srv, bot, job, key, { body });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    assert.match(r.data.runId, /\S/);
    taken.push(r.data.runId);
  }
  assert.equal(new Set(taken).size, 3, 'each call is a run of its own');
  const fourth = await call(srv, bot, job, key, { body: 'open 4' });
  assert.equal(fourth.status, 429);
  assert.equal(fourth.data.error, 'Too many calls are waiting for this job.');

  // The other work still finds its places: "Run now" of another job waits as before.
  const runNow = await srv.api(`/bots/${bot.id}/jobs/${other.id}/run`, { method: 'POST' });
  assert.equal(runNow.status, 200, JSON.stringify(runNow.data));
  assert.equal(runNow.data.queued, true);
  // The owner writes after the calls: their message starts first.
  const mine = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'The owner asks now.' } })).data;
  assert.equal(mine.status, 'queued', JSON.stringify(mine));

  srv.release(first);
  await srv.finished(busy.id);
  const next = await srv.nextRun(isRunOf(bot), 'the next run');
  assert.match(next.stdin, /The owner asks now\./);
  const order = [];
  srv.release(next);
  for (let i = 0; i < 4; i++) {
    const rec = await srv.nextRun(isRunOf(bot), `waiting run ${i + 1}`);
    order.push((/<call-body>\n(.*)\n<\/call-body>/.exec(rec.stdin) || [null, 'Tidy'])[1]);
    srv.release(rec);
  }
  assert.deepEqual(order, ['open 1', 'open 2', 'open 3', 'Tidy'], 'in the order they came, each with its own body');
  for (const id of taken) {
    const run = await srv.finished(id);
    assert.equal(run.trigger, 'call');
  }
  assert.equal((await runsOf(bot, job)).length, 3, 'the refused fourth call left no run');
  srv.unhold();
});

test('a switched-off job and a paused bot answer 409; nothing is queued', async () => {
  const bot = await makeBot(srv, { name: 'Shed Watch', emoji: '🛖' });
  const job = await addJob(bot, 'Shed');
  const on = await addJob(bot, 'Still on');
  const key = await turnOn(srv, bot, job);
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } });
  const off = await call(srv, bot, job, key, { body: 'x' });
  assert.equal(off.status, 409);
  assert.equal(off.data.error, 'This job is switched off.');
  // Every job switched off: the bot is paused.
  await srv.api(`/bots/${bot.id}/jobs/${on.id}`, { method: 'PUT', body: { enabled: false } });
  const paused = await call(srv, bot, job, key, { body: 'x' });
  assert.equal(paused.status, 409);
  assert.equal(paused.data.error, 'This bot is paused.');
  // Switched on again later, nothing that was refused runs then.
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: true } });
  await sleep(500);
  assert.deepEqual(await runsOf(bot, job), []);
  await waitFor(async () => !srv.runs().some(isRunOf(bot)), { what: 'no run of the bot' });
});

test('a call that waits does not start once calls to its job are turned off', async () => {
  const bot = await makeBot(srv, { name: 'Gate Watch', emoji: '🚧' });
  const job = await addJob(bot, 'Gate');
  const key = await turnOn(srv, bot, job);
  srv.hold();
  const busy = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Keep busy.' } })).data;
  const first = await srv.nextRun(isRunOf(bot), 'the busy run');
  assert.equal((await call(srv, bot, job, key, { body: 'open' })).status, 202);
  assert.equal((await srv.asChief(`/bots/${bot.id}/jobs/${job.id}/call/setup`, { method: 'DELETE' })).data.call, false);
  srv.unhold();
  srv.release(first);
  await srv.finished(busy.id);
  await sleep(500);
  assert.deepEqual(await runsOf(bot, job), []);
});
