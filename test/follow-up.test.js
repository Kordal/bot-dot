// The owner's message to a bot at work (ADR 106; docs/api.md "Send a message"): rules first, then one short question to
// a small model whose answer is checked and never trusted. "steer" waits marked for that run (ADR 040), "ask" is
// answered as a "/btw" is (ADR 063), and "new", or anything unsure, failed or late, starts a run of its own as
// before (ADR 062). The first tests are of lib/follow-up.js alone; the others against a real botdot server and the
// stand-in for Claude (test/fixtures/fake-claude.js answers the question with $FAKE_OUT/follow-up.txt).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const followUp = require('../lib/follow-up');
const { startServer, makeBot, heldRun, readData, self } = require('./helpers');

const NOW = Date.parse('2026-10-27T09:00:00Z');
const BOT = { name: 'Media Watcher', description: 'Reads posts on X.' };
const RUN = { prompt: 'Try again', startedAt: new Date(NOW - 8000).toISOString(), line: 'Looking at its screen' };
const M = { bot: BOT, runs: [RUN], recent: [{ who: 'bot', text: 'The server does not start.' }, { who: 'owner', text: 'Try again' }], text: 'check x', now: NOW };

test('files or a skill command always start a run of their own, without asking', () => {
  assert.equal(followUp.rules({ text: 'look', files: 1 }), 'files');
  assert.equal(followUp.rules({ text: '/code-review 252' }), 'skill');
  for (const text of ['check x', 'a/b', 'try again /now', '']) assert.equal(followUp.rules({ text }), null, text);
});

test('the answer is steer into a run on the list, ask or new; anything else is none', () => {
  assert.deepEqual(followUp.parse('{"decision":"steer","run":1}', 1), { decision: 'steer', run: 0 });
  assert.deepEqual(followUp.parse('So: {"decision":"steer","run":2}', 2), { decision: 'steer', run: 1 });
  assert.deepEqual(followUp.parse('{"decision":"steer"}', 1), { decision: 'steer', run: 0 }, 'one run needs no number');
  assert.deepEqual(followUp.parse('{"decision":"ask"}', 1), { decision: 'ask' });
  assert.deepEqual(followUp.parse('{"decision":"new"}', 2), { decision: 'new' });
  for (const bad of ['', 'steer', '{"decision":"steer"}', '{"decision":"steer","run":3}', '{"decision":"steer","run":0}', '{"decision":"steer","run":"1"}', '{"decision":"constructor"}', '{oops}']) assert.equal(followUp.parse(bad, 2), null, bad);
  const q = followUp.question(M);
  assert.ok(q.includes('1. asked 8 s ago: Try again') && q.includes('doing now: Looking at its screen'));
  assert.ok(q.includes('- bot: The server does not start.') && q.includes('- owner: Try again'));
  assert.ok(q.indexOf('<chat>') < q.indexOf('The bot:') && q.lastIndexOf('</chat>') > q.indexOf('The message: check x'), 'the text is inside the block');
  assert.match(followUp.question({ ...M, runs: [{ ...RUN, startedAt: new Date(NOW - 600_000).toISOString() }] }), /asked 10 min ago/);
});

test('decide never throws, and starts a run of its own on a rule, an unsure, failed or late answer', async () => {
  const decide = (ask, m = M, ms = 200) => followUp.create({ ask, ms }).decide(m);
  const steer = await decide(async () => '{"decision":"steer","run":1}');
  assert.deepEqual([steer.decision, steer.run, steer.by], ['steer', 0, 'haiku']);
  assert.equal((await decide(async () => '{"decision":"ask"}')).decision, 'ask');
  assert.equal((await decide(async () => 'no idea')).why, 'unsure');
  assert.equal((await decide(async () => { throw new Error('overloaded'); })).why, 'failed');
  const late = await decide(() => new Promise(() => {}), M, 50);
  assert.deepEqual([late.decision, late.why], ['new', 'late']);
  let asked = 0;
  const ruled = await decide(async () => { asked++; return '{"decision":"steer"}'; }, { ...M, files: 2 });
  assert.deepEqual([ruled.decision, ruled.by, asked], ['new', 'rule', 0]);
  assert.equal((await decide(async () => '{"decision":"steer"}', { ...M, runs: [] })).decision, 'new', 'no run to steer into');
  let opts;
  await decide(async (p, o) => { opts = o; return '{}'; });
  assert.deepEqual([opts.llm.model, opts.system], [followUp.MODEL, followUp.SYSTEM]);
  assert.equal(followUp.on({}), true);
  assert.equal(followUp.on({ BOT_DOT_FOLLOW_UP: 'off' }), false);
});

test('with Jev chosen, the likeliest run from 0.5 steers, else a question asks, else new; when Jev fails Haiku does', async () => {
  const jev = { router: 'jev', key: 'sk-or-v1-testtesttest' };
  const two = { ...M, runs: [RUN, { ...RUN, prompt: 'Sum up the posts' }] };
  const body = followUp.jevRequest(two);
  assert.deepEqual(Object.keys(body.questions), ['ask', 'r1', 'r2']);
  assert.deepEqual([body.state.message, body.state.tasks[1].request, body.state.tasks[0].askedSecondsAgo], ['check x', 'Sum up the posts', 8]);
  assert.deepEqual(body.provider, { data_collection: 'deny' });
  let haiku = 0;
  const ask = async () => { haiku++; return '{"decision":"new"}'; };
  const answering = (p) => async () => ({ ok: true, status: 200, json: async () => ({ answers: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { type: 'noul', noul: v }])) }) });
  const decide = (fetch, m = two) => followUp.create({ ask, config: () => jev, fetch }).decide(m);
  const steer = await decide(answering({ ask: 0.1, r1: 0.6, r2: 0.8 }));
  assert.deepEqual([steer.decision, steer.run, steer.by, haiku], ['steer', 1, 'jev', 0]);
  assert.equal((await decide(answering({ ask: 0.7, r1: 0.2, r2: 0.3 }))).decision, 'ask');
  assert.equal((await decide(answering({ ask: 0.7, r1: 0.9, r2: 0.3 }))).decision, 'steer', 'a run likelier than a question steers');
  assert.equal((await decide(answering({ ask: 0.2, r1: 0.4, r2: 0.3 }))).decision, 'new');
  const odd = await decide(answering({ ask: 0.2, r1: 0.9 }));
  assert.deepEqual([odd.decision, odd.by, odd.why], ['new', 'fell', 'unsure'], 'a likelihood missing is no answer');
  const down = await decide(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.deepEqual([down.decision, down.by, haiku], ['new', 'haiku', 1], 'Haiku when Jev fails');
});

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const isRunOf = (bot) => (x) => !!x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`);
const send = (bot, prompt, more = {}) => srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt, ...more } });
const going = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data.filter((r) => r.status === 'running' && !r.btw);
const waitingIn = (bot) => (fs.existsSync(path.join(srv.data, 'queue.json')) ? readData(srv.data, 'queue.json').queues?.[bot.id] || [] : []);
const answer = (text) => fs.writeFileSync(path.join(srv.out, 'follow-up.txt'), text);
const asks = () => fs.readdirSync(srv.out).filter((f) => /^follow-up-\d/.test(f)).sort();

test('a follow-up the model says belongs to the run waits steered into it, and its next tool call reads it', async () => {
  const bot = await makeBot(srv, { name: 'Media Watcher', emoji: '🎧' });
  const long = await heldRun(srv, bot, 'Sprobuj jeszcze raz');
  answer('{"decision":"steer","run":1}');
  const before = asks().length;
  const sent = await send(bot, 'sprawdzic x', { key: 'k-steer-1' });
  assert.deepEqual([sent.status, sent.data.status, sent.data.steering], [201, 'queued', long.run.id]);
  assert.equal(asks().length, before + 1, 'asked once');
  const asked = fs.readFileSync(path.join(srv.out, asks().at(-1)), 'utf8');
  assert.match(asked, /1\. asked \d+ s ago: Sprobuj jeszcze raz/);
  assert.match(asked, /The message: sprawdzic x/);
  assert.deepEqual(waitingIn(bot).map((x) => [x.text, x.steering]), [['sprawdzic x', long.run.id]]);
  assert.deepEqual((await going(bot)).map((r) => r.id), [long.run.id], 'no second run');
  const list = (await srv.api('/bots')).data;
  const queued = (Array.isArray(list) ? list : list.bots).find((b) => b.id === bot.id).queued;
  assert.deepEqual(queued.map((x) => [x.text, x.steering]), [['sprawdzic x', true]], 'shown as steered');

  // Sent again with its key: the same message, not a second one.
  const again = await send(bot, 'sprawdzic x', { key: 'k-steer-1' });
  assert.deepEqual([again.status, again.data.id, again.data.again], [200, sent.data.id, true]);

  const read = (await self(srv, long.token, 'steer')).data.hookSpecificOutput?.additionalContext;
  assert.match(read, /<owner-message>\nsprawdzic x\n<\/owner-message>/);
  assert.match(read, /botdot took it for more of this run's work/, 'not "pressed Steer": the owner pressed nothing');
  assert.deepEqual(waitingIn(bot), []);

  srv.unhold();
  srv.release(long.rec);
  await srv.finished(long.run.id);
});

test('a question about the work is answered aside, as a "/btw", with no run', async () => {
  const bot = await makeBot(srv, { name: 'Infra Admin', emoji: '🛠️' });
  const long = await heldRun(srv, bot, 'Restart the containers');
  answer('{"decision":"ask"}');
  const sent = await send(bot, 'did it come back up?');
  assert.deepEqual([sent.status, sent.data.status, sent.data.btw], [201, 'running', true]);
  const rec = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`) && !x.self, 'the side turn');
  assert.match(rec.stdin, /<question>\ndid it come back up\?\n<\/question>/);
  srv.reply('Not yet, waiting for the health checks.');
  srv.release(rec);
  assert.equal((await srv.finished(sent.data.id)).result, 'Not yet, waiting for the health checks.');
  assert.deepEqual((await going(bot)).map((r) => r.id), [long.run.id]);
  srv.unhold();
  srv.release(long.rec);
  await srv.finished(long.run.id);
});

test('a task of its own, an unsure answer or a file starts a run beside, as before', async () => {
  const bot = await makeBot(srv, { name: 'Day Planner', emoji: '📅' });
  const long = await heldRun(srv, bot, 'Plan my Thursday');
  for (const [text, says] of [['find me a recipe', '{"decision":"new"}'], ['hm', 'no idea']]) {
    answer(says);
    const sent = await send(bot, text);
    assert.deepEqual([sent.status, sent.data.status], [201, 'running'], text);
    const rec = await srv.nextRun(isRunOf(bot), `the run of "${text}"`);
    srv.release(rec);
    await srv.finished(sent.data.id);
  }
  answer('{"decision":"steer","run":1}');
  const before = asks().length;
  fs.mkdirSync(path.join(srv.data, 'workspaces', bot.id, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(srv.data, 'workspaces', bot.id, 'uploads', 'a.txt'), 'x');
  const withFile = await send(bot, 'add this too', { attachments: [{ file: 'uploads/a.txt', name: 'a.txt' }] });
  assert.equal(withFile.data.status, 'running', 'a message with files starts its own run');
  assert.equal(asks().length, before, 'and asks nothing');
  const rec = await srv.nextRun(isRunOf(bot), 'the run with a file');
  srv.release(rec);
  await srv.finished(withFile.data.id);
  srv.unhold();
  srv.release(long.rec);
  await srv.finished(long.run.id);
});

test('two messages to a bot at work keep the order sent, also when the first is sorted slower', async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '👩‍💻' });
  const long = await heldRun(srv, bot, 'Implement #251');
  answer('{"decision":"steer","run":1}');
  fs.writeFileSync(path.join(srv.out, 'follow-up-slow.txt'), 'use the mockup');
  const [a, b] = await Promise.all([send(bot, 'use the mockup', { key: 'k-order-a' }), (async () => { await new Promise((r) => setTimeout(r, 100)); return send(bot, 'and add a test', { key: 'k-order-b' }); })()]);
  fs.rmSync(path.join(srv.out, 'follow-up-slow.txt'));
  assert.deepEqual([a.data.status, b.data.status], ['queued', 'queued']);
  assert.deepEqual(waitingIn(bot).map((x) => x.text), ['use the mockup', 'and add a test']);
  srv.unhold();
  srv.release(long.rec);
  await srv.finished(long.run.id);
  await new Promise((r) => setTimeout(r, 300));
  for (const r of (await srv.api(`/runs?botId=${bot.id}`)).data.filter((x) => x.status === 'running')) await srv.finished(r.id);
});

test('a message to a free bot asks nothing', async () => {
  const bot = await makeBot(srv, { name: 'Quotz Manager', emoji: '📈' });
  answer('{"decision":"steer","run":1}');
  const before = asks().length;
  srv.hold();
  const sent = await send(bot, 'write the status');
  assert.equal(sent.data.status, 'running');
  const rec = await srv.nextRun(isRunOf(bot), 'the run');
  assert.equal(asks().length, before);
  srv.unhold();
  srv.release(rec);
  await srv.finished(sent.data.id);
});
