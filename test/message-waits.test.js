// A bot does one thing at a time, and the owner's message waits (BUSY-001, ADR 011; docs/api.md "A message that
// waits"): a message to a bot that is working starts no run beside the one going. It is kept on the botdot
// server, on disk, under the id its run will have, starts by itself when the bot is free, before anything else
// that waits, and can be listed and taken back. Against a real botdot server and the stand-in for Claude, whose
// runs are held and released: no test here waits for a time to pass.
// A bot that waits for the owner's OK on a connected-app action is in test/connector-wait.test.js; what cannot
// be reached through the API (a deleted bot, a message that cannot start) in test/message-waits-unit.test.js.
// Tests here count on work for a busy bot waiting its turn: one run of a bot at a time (ADR 062 lets three go at
// once, and at that limit the same holds).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor, feed, readData } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const asksLib = require('../lib/asks');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const send = (on, bot, body, as = on.api) => as(`/bots/${bot.id}/run`, { method: 'POST', body });
const runsOf = async (on, bot) => (await on.api(`/runs?botId=${bot.id}`)).data;
const going = async (on, bot) => (await runsOf(on, bot)).filter((r) => r.status === 'running');
const botOf = async (on, bot) => (await on.api(`/bots/${bot.id}`)).data;
const waitingIn = (on, bot) => (readData(on.data, 'queue.json').queues[bot.id] || []);
const ranAll = (on, bot, n) => waitFor(async () => { const r = await runsOf(on, bot); return r.length === n && r.every((x) => x.status !== 'running') ? r : null; }, { timeout: 30_000, what: `${n} runs of ${bot.name}` });
// The stand-in's runs of a bot, in the order they started: what each was asked.
const asked = (on, bot) => on.runs().filter(isRunOf(bot)).map((x) => x.stdin.split('\n')[0]);
const upload = async (on, bot, name = 'which.txt') => (await on.api(`/uploads?to=bot:${bot.id}`, { method: 'POST', raw: Buffer.from('repo: acme/site\n'), headers: { 'X-File-Name': name } })).data;
const takeBack = (on, bot, id, as = on.api) => as(`/bots/${bot.id}/queued/${id}`, { method: 'DELETE' });

test('the features name it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('message-waits'));
});

test('a message to a working bot starts no run: it waits, is listed and announced, and starts alone when the run ends, seeing the first reply', async (t) => {
  const bot = await makeBot(srv, { name: 'One Thing', emoji: '☝️' });
  const f = await feed(srv);
  t.after(() => f.close());
  await f.wait('hello');
  const file = await upload(srv, bot);
  srv.reply('The first answer.');
  const h = await heldRun(srv, bot, 'The first question');

  const w = await send(srv, bot, { prompt: 'The second question', attachments: [file], key: 'second-question-1' });
  assert.equal(w.status, 201);
  // The contract's waiting run: the id its run will have, at the top, as a run has it.
  assert.deepEqual(Object.keys(w.data).filter((k) => ['id', 'botId', 'status', 'prompt', 'attachments', 'queuedAt', 'again'].includes(k)).sort(), ['attachments', 'botId', 'id', 'prompt', 'queuedAt', 'status']);
  assert.deepEqual([w.data.botId, w.data.status, w.data.prompt, w.data.attachments.map((a) => a.file)], [bot.id, 'queued', 'The second question', [file.file]]);
  assert.match(w.data.id, /^\d{14}-[0-9a-f]{6}$/, 'an id as a run has it');
  assert.ok(Date.parse(w.data.queuedAt) <= Date.now());
  // On disk before the request was answered, with its text, its files, its key and its run's id.
  const [item] = waitingIn(srv, bot);
  assert.deepEqual([item.kind, item.runId, item.text, item.prompt, item.msgKey, item.attachments.length, item.queuedAt], ['owner', w.data.id, 'The second question', 'The second question', 'second-question-1', 1, w.data.queuedAt]);
  // One run going, and no run of that id yet.
  assert.deepEqual((await runsOf(srv, bot)).map((r) => [r.id, r.status]), [[h.run.id, 'running']]);
  assert.equal(asked(srv, bot).length, 1);

  // Sent again with its key: it waits once, and both answers carry the same id.
  const again = await send(srv, bot, { prompt: 'The second question', attachments: [file], key: 'second-question-1' });
  assert.deepEqual([again.status, again.data.again, again.data.id, again.data.status], [200, true, w.data.id, 'queued']);
  assert.equal(waitingIn(srv, bot).length, 1);

  // The list, on the bot alone and in the list of bots, and the feed.
  const entry = { id: w.data.id, text: 'The second question', attachments: w.data.attachments, at: w.data.queuedAt };
  assert.deepEqual((await botOf(srv, bot)).queued, [entry]);
  assert.deepEqual((await srv.api('/bots')).data.find((b) => b.id === bot.id).queued, [entry]);
  const said = (await f.wait('queued', (d) => d.botId === bot.id)).data;
  assert.deepEqual([said.chat, said.botId, said.queued], [`bot:${bot.id}`, bot.id, [entry]]);
  // Its run's record while it waits.
  for (const p of [`/runs/${w.data.id}`, `/runs/${w.data.id}?events=0`]) {
    const r = await srv.api(p);
    assert.deepEqual([r.status, r.data.id, r.data.status, r.data.queuedAt], [200, w.data.id, 'queued', w.data.queuedAt], p);
  }
  // A call that waits for it is held as for a run that is going, through its start, to its end.
  const waited = srv.asChief(`/runs/${w.data.id}/wait?timeout=50`);

  srv.unhold();
  srv.release(h.rec);
  const first = await srv.finished(h.run.id);
  const second = await srv.finished(w.data.id);
  assert.deepEqual([second.id, second.trigger, second.status, second.result, second.prompt], [w.data.id, 'manual', 'success', 'The first answer.', 'The second question']);
  assert.deepEqual(second.attachments.map((a) => a.file), [file.file], 'its files attached');
  assert.equal(second.sentAt, w.data.queuedAt, 'the run keeps when the owner sent it');
  assert.ok(second.startedAt >= first.endedAt, 'alone: it started after the first run ended');
  assert.deepEqual([(await waited).data.id, (await waited).data.status], [w.data.id, 'success']);
  const rec = srv.runs().filter(isRunOf(bot))[1];
  assert.match(rec.stdin, /^The second question/);
  assert.ok(rec.stdin.includes(file.file), 'told of its file');
  assert.ok(rec.system.includes(`<conversation>\n[run ${h.run.id} · `) && /\] Asked by the owner:\nThe first question\nYou replied:\nThe first answer\.\n<\/conversation>/.test(rec.system), "its chat holds the first run's reply (CHAT-001)");
  // It left the list as it started, and the feed said so.
  assert.deepEqual((await botOf(srv, bot)).queued, []);
  assert.deepEqual(f.events.filter((e) => e.type === 'queued' && e.data.botId === bot.id).map((e) => e.data.queued.length), [1, 0]);
  assert.deepEqual(waitingIn(srv, bot), []);
  // Its key, after it ran: the run.
  const late = await send(srv, bot, { prompt: 'The second question', key: 'second-question-1' });
  assert.deepEqual([late.status, late.data.again, late.data.id, late.data.status], [200, true, w.data.id, 'success']);

  // A message to a free bot starts at once, with a run's answer, as before.
  const free = await send(srv, bot, { prompt: 'A third question' });
  assert.deepEqual([free.status, free.data.status, free.data.queuedAt, free.data.sentAt], [201, 'running', undefined, undefined]);
  await ranAll(srv, bot, 3);
});

test("the owner's messages start first and in the order sent; the Chief's run and a tile wait too, each as its own run", async (t) => {
  const bot = await makeBot(srv, { name: 'In Order', emoji: '🚦' });
  const sender = await makeBot(srv, { name: 'Teammate', emoji: '📤' });
  const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', name: 'Nightly', cron: '0 3 * * *', prompt: 'The nightly job', assessment: 'Needs AI' } })).data;
  const tile = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { bot: bot.id, kind: 'button', title: 'Lights off', do: { type: 'bot', message: 'The tile asks' } } })).data;
  const h = await heldRun(srv, bot, 'Something long');
  const s = await heldRun(srv, sender);

  // Other work waits already: a job and a teammate's message. Then the Chief's run_bot, by its own tool.
  assert.deepEqual((await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data, { queued: true });
  assert.equal((await self(srv, s.token, 'message', { to: bot.id, message: 'The teammate asks', priority: true })).data.delivered, 'queued');
  const chief = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const byChief = await chief.json('run_bot', { id: bot.id, prompt: 'The Chief asks' });
  assert.deepEqual([byChief.status, byChief.bot, byChief.note], ['queued', 'In Order', 'In Order is busy: this starts when it is free.']);
  // The owner's two messages, and a tap on a tile that asks the bot.
  const one = (await send(srv, bot, { prompt: 'The owner asks first' })).data;
  const two = (await send(srv, bot, { prompt: 'The owner asks second' })).data;
  const tapped = await srv.api(`/dashboard/tiles/${tile.id}/tap`, { method: 'POST', body: {} });
  assert.deepEqual([tapped.status, tapped.data.queued, typeof tapped.data.runId], [200, true, 'string']);
  assert.deepEqual([one.status, two.status], ['queued', 'queued']);

  // The owner's list: their messages and the tile's, not the Chief's run. One run is going.
  assert.deepEqual((await botOf(srv, bot)).queued.map((q) => [q.id, q.text]), [[one.id, 'The owner asks first'], [two.id, 'The owner asks second'], [tapped.data.runId, 'The tile asks']]);
  assert.deepEqual(waitingIn(srv, bot).map((x) => x.kind), ['job', 'message', 'chief', 'owner', 'owner', 'owner']);
  assert.deepEqual((await going(srv, bot)).map((r) => r.id), [h.run.id]);
  // The Chief's waiting run answers under its id, and is the Chief's.
  assert.deepEqual([(await srv.asChief(`/runs/${byChief.id}?events=0`)).data.status, (await srv.asChief(`/runs/${byChief.id}?events=0`)).data.startedBy], ['queued', 'chief']);

  srv.unhold();
  srv.release(h.rec);
  srv.release(s.rec);
  const runs = await ranAll(srv, bot, 7);
  assert.deepEqual(asked(srv, bot), ['Something long', 'The owner asks first', 'The owner asks second', 'The tile asks', 'The nightly job', 'The teammate asks', 'The Chief asks'], 'the owner first, in the order sent; then the rest, first in, first out');
  // Never two at once: each started when the one before it had ended.
  const inOrder = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (let i = 1; i < inOrder.length; i++) assert.ok(inOrder[i].startedAt >= inOrder[i - 1].endedAt, `run ${i + 1} started after run ${i} ended`);
  const byId = Object.fromEntries(runs.map((r) => [r.id, r]));
  assert.deepEqual([one.id, two.id, tapped.data.runId].map((id) => [byId[id].prompt, byId[id].trigger, byId[id].startedBy]), [['The owner asks first', 'manual', undefined], ['The owner asks second', 'manual', undefined], ['The tile asks', 'manual', undefined]]);
  assert.deepEqual([byId[byChief.id].prompt, byId[byChief.id].startedBy], ['The Chief asks', 'chief']);
  // The Chief can still wait for its result on that id.
  assert.deepEqual([(await chief.json('wait_for_run', { runId: byChief.id })).status, (await chief.json('get_run', { runId: byChief.id })).prompt], ['success', 'The Chief asks']);
  await srv.finished(s.run.id);
  await srv.api(`/dashboard/tiles/${tile.id}`, { method: 'DELETE' });
});

test("ten of the owner's messages wait at most, beside the other work: the eleventh is refused and keeps its key, and the Chief's run is taken while fewer than ten others wait", async () => {
  // A server of its own: what waits here is not run, the server is stopped with it.
  const own = await startServer();
  try {
    const bot = await makeBot(own, { name: 'Crowded', emoji: '🐝' });
    const sender = await makeBot(own, { name: 'Teammate', emoji: '📤' });
    await heldRun(own, bot, 'Something long');
    const s = await heldRun(own, sender);
    // Nine of the other work, and the Chief's run is the tenth: taken. An eleventh of them is not.
    for (let i = 1; i <= 9; i++) assert.equal((await self(own, s.token, 'message', { to: bot.id, message: `Task ${i}`, priority: true })).data.delivered, 'queued');
    const byChief = await send(own, bot, { prompt: 'The Chief asks' }, own.asChief);
    assert.deepEqual([byChief.status, byChief.data.status, byChief.data.startedBy], [201, 'queued', 'chief']);
    const tooMany = await send(own, bot, { prompt: 'The Chief asks again' }, own.asChief);
    assert.deepEqual([tooMany.status, tooMany.data.error], [429, 'Crowded already has 10 tasks waiting. Try again once it has caught up.']);
    // A queue full of other work does not refuse the owner: ten of their own.
    const mine = [];
    for (let i = 1; i <= 10; i++) mine.push(await send(own, bot, { prompt: `Message ${i}` }));
    assert.deepEqual(mine.map((r) => [r.status, r.data.status]), Array(10).fill([201, 'queued']));
    const eleventh = await send(own, bot, { prompt: 'Message 11', key: 'eleventh-key-0001' });
    assert.deepEqual([eleventh.status, eleventh.data], [429, { error: 'Crowded already has 10 of your messages waiting. Take one back, or wait.' }]);
    assert.deepEqual((await botOf(own, bot)).queued.map((q) => q.text), Array.from({ length: 10 }, (_, i) => `Message ${i + 1}`));
    assert.equal(waitingIn(own, bot).length, 20, 'nothing was kept of what was refused');
    assert.deepEqual((await going(own, bot)).length, 1);
    // Later, with room: the same message with its key is taken, not answered as sent before.
    assert.equal((await takeBack(own, bot, mine[9].data.id)).status, 200);
    const later = await send(own, bot, { prompt: 'Message 11', key: 'eleventh-key-0001' });
    assert.deepEqual([later.status, later.data.status, later.data.again], [201, 'queued', undefined]);
    assert.deepEqual((await botOf(own, bot)).queued.map((q) => q.text).slice(-2), ['Message 9', 'Message 11']);
  } finally { await own.stop(); }
});

test('take back: the message is gone and its text and files come back; as it starts it has started; its key may be sent again', async (t) => {
  const bot = await makeBot(srv, { name: 'Giver', emoji: '↩️' });
  const f = await feed(srv);
  t.after(() => f.close());
  await f.wait('hello');
  const file = await upload(srv, bot, 'notes.txt');
  const h = await heldRun(srv, bot, 'Something long');
  const w = (await send(srv, bot, { prompt: 'Not this after all', attachments: [file], key: 'taken-back-key-1' })).data;
  const kept = (await send(srv, bot, { prompt: 'But this' })).data;
  const byChief = (await send(srv, bot, { prompt: 'The Chief asks' }, srv.asChief)).data;
  const waited = srv.api(`/runs/${w.id}/wait?timeout=50`);

  // A message without words of its own, to run the bot's main assignment, waits as that, and comes back empty.
  const bare = (await send(srv, bot, {})).data;
  assert.deepEqual([bare.status, bare.prompt, bare.customPrompt, bare.attachments], ['queued', 'Do the test task.', false, []]);
  assert.deepEqual((await botOf(srv, bot)).queued.at(-1), { id: bare.id, text: '', attachments: [], at: bare.queuedAt });
  assert.deepEqual((await takeBack(srv, bot, bare.id)).data, { text: '', attachments: [] });
  // Only the owner: the Chief's tools have no such route.
  assert.equal((await takeBack(srv, bot, w.id, srv.asChief)).status, 403);
  assert.equal((await botOf(srv, bot)).queued.length, 2);
  const back = await takeBack(srv, bot, w.id);
  assert.deepEqual([back.status, back.data], [200, { text: 'Not this after all', attachments: w.attachments }]);
  assert.deepEqual((await botOf(srv, bot)).queued.map((q) => q.id), [kept.id]);
  assert.deepEqual((await f.wait('queued', (d) => d.botId === bot.id && d.queued.length === 1 && d.queued[0].id === kept.id)).data.chat, `bot:${bot.id}`);
  assert.deepEqual(waitingIn(srv, bot).map((x) => x.runId), [kept.id, byChief.id]);
  // Nothing is left of it: its id is no run, a call that waited for it is answered, a second take back knows none.
  assert.equal((await srv.api(`/runs/${w.id}`)).status, 404);
  assert.equal((await waited).status, 404);
  assert.deepEqual([(await takeBack(srv, bot, w.id)).status, (await takeBack(srv, bot, 'no-such-id')).status], [404, 404]);
  // A run the Chief asked for is not the owner's message to take back.
  assert.equal((await takeBack(srv, bot, byChief.id)).status, 404);
  // The same key again is a new message: it waits, under a new id.
  const anew = await send(srv, bot, { prompt: 'This, then', key: 'taken-back-key-1' });
  assert.deepEqual([anew.status, anew.data.status, anew.data.again, anew.data.id !== w.id], [201, 'queued', undefined, true]);

  // As it starts: it has started, and the answer names the run. The next message is held by its run in turn.
  srv.release(h.rec);
  await srv.finished(h.run.id);
  const rec = await srv.nextRun((x) => isRunOf(bot)(x) && /^But this/.test(x.stdin), 'the kept message to start');
  const late = await takeBack(srv, bot, kept.id);
  assert.deepEqual([late.status, late.data], [409, { error: 'It has already started.', runId: kept.id }]);
  srv.unhold();
  srv.release(rec);
  await ranAll(srv, bot, 4);
  assert.deepEqual(asked(srv, bot), ['Something long', 'But this', 'This, then', 'The Chief asks'], 'what was taken back never ran');
  assert.equal((await takeBack(srv, bot, kept.id)).status, 409, 'also after it ended');
});

test('a waiting message whose file is gone from the workspace starts without that file', async () => {
  const bot = await makeBot(srv, { name: 'Loser', emoji: '🕳️' });
  const [gone, stays] = [await upload(srv, bot, 'gone.txt'), await upload(srv, bot, 'stays.txt')];
  const h = await heldRun(srv, bot, 'Something long');
  const w = (await send(srv, bot, { prompt: 'Read both files', attachments: [gone, stays] })).data;
  assert.deepEqual(w.attachments.map((a) => a.name), ['gone.txt', 'stays.txt']);
  // A file that is gone when the message is sent is refused then, as for a run.
  const refused = await send(srv, bot, { prompt: 'And this one', attachments: [{ name: 'never.txt', file: 'uploads/never.txt' }] });
  assert.deepEqual([refused.status, refused.data.error], [400, 'The attached file never.txt is gone. Attach it again.']);
  fs.rmSync(path.join(srv.data, 'workspaces', bot.id, gone.file));
  srv.unhold();
  srv.release(h.rec);
  const run = await srv.finished(w.id);
  assert.deepEqual([run.status, run.prompt, run.attachments.map((a) => a.name)], ['success', 'Read both files', ['stays.txt']], 'it started, with the file that is left');
  const rec = srv.runs().filter(isRunOf(bot))[1];
  assert.ok(rec.stdin.includes(stays.file) && !rec.stdin.includes(gone.file));
  assert.equal((await runsOf(srv, bot)).length, 2);
});

test('after botdot is stopped and started, the run that was cut off says so and the waiting message starts, once', async () => {
  let own = await startServer();
  try {
    const bot = await makeBot(own, { name: 'Survivor', emoji: '🔁' });
    const file = await upload(own, bot);
    const h = await heldRun(own, bot, 'Something long');
    const w = (await send(own, bot, { prompt: 'After the restart', attachments: [file], key: 'restart-waits-key' })).data;
    const chiefs = (await send(own, bot, { prompt: 'The Chief asks' }, own.asChief)).data;
    await own.stop();
    own = await startServer({ dir: own.dir }); // the stand-in's runs stay held

    assert.equal((await own.api(`/runs/${h.run.id}?events=0`)).data.status, 'interrupted', 'the cut-off run is marked');
    const rec = await own.nextRun((x) => isRunOf(bot)(x) && /^After the restart/.test(x.stdin), 'the waiting message to start');
    const started = (await own.api(`/runs/${w.id}?events=0`)).data;
    assert.deepEqual([started.status, started.trigger, started.sentAt, started.attachments.length], ['running', 'manual', w.queuedAt, 1]);
    assert.ok(started.startedAt >= (await own.api(`/runs/${h.run.id}?events=0`)).data.endedAt, 'after the cut-off run was marked');
    assert.deepEqual((await botOf(own, bot)).queued, []);
    assert.deepEqual(waitingIn(own, bot).map((x) => x.runId), [chiefs.id], "the Chief's run still waits its turn");
    // Its key is still its key.
    const again = await send(own, bot, { prompt: 'After the restart', key: 'restart-waits-key' });
    assert.deepEqual([again.status, again.data.again, again.data.id], [200, true, w.id]);
    own.unhold();
    own.release(rec);
    await ranAll(own, bot, 3);
    // Once: another restart starts nothing.
    await own.stop();
    own = await startServer({ dir: own.dir });
    assert.deepEqual((await runsOf(own, bot)).map((r) => [r.id, r.status]).sort(), [[h.run.id, 'interrupted'], [w.id, 'success'], [chiefs.id, 'success']].sort());
    assert.deepEqual(asked(own, bot), ['Something long', 'After the restart', 'The Chief asks']);
    assert.deepEqual(readData(own.data, 'queue.json').queues, {});
  } finally { own.unhold(); await own.stop(); }
});

test("a waiting message counts as sent from when it was sent: a card older than it starts nothing for an earlier request", async () => {
  // The owner's request is refused the web and its card waits. The bot is busy with other work when the owner
  // sends it a new message, which waits. A yes on the card now starts nothing for the earlier request.
  const BASH = { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'gh pr list' } };
  const bot = await makeBot(srv, { name: 'Moved On', emoji: '🧭', allowedTools: ['Read'] });
  fs.writeFileSync(path.join(srv.out, 'denials.json'), JSON.stringify([BASH]));
  const request = await srv.finished((await send(srv, bot, { prompt: 'Check the PRs' })).data.id);
  fs.writeFileSync(path.join(srv.out, 'denials.json'), '[]');
  const cardOf = async () => (await srv.api('/asks')).data.find((a) => a.botId === bot.id);
  assert.equal((await cardOf()).then.text, 'It carries on with “Check the PRs” when you allow it.');
  srv.hold();
  const long = (await send(srv, bot, { prompt: 'Something long' }, srv.asChief)).data;
  const rec = await srv.nextRun((x) => isRunOf(bot)(x) && /^Something long/.test(x.stdin), 'the long run');
  const w = (await send(srv, bot, { prompt: 'Never mind: what time is it?' })).data;
  assert.equal(w.status, 'queued');
  assert.ok(Date.parse(w.queuedAt) >= Date.parse(request.endedAt));
  // The card says nothing of carrying on any more, and its yes only changes the setting.
  const card = await cardOf();
  assert.equal(card.then, undefined);
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.deepEqual([yes.status, yes.data.carriesOn], [200, undefined]);
  assert.deepEqual(waitingIn(srv, bot).map((x) => x.kind), ['owner'], 'no work that carries on was added');
  srv.unhold();
  srv.release(rec);
  await srv.finished(long.id);
  await ranAll(srv, bot, 3);
  assert.deepEqual((await runsOf(srv, bot)).filter((r) => r.continues), []);
});

test('the rule reads when a message was sent, before when its run started', () => {
  // A request that asked at 10:00 and its card; a message of the owner sent at 09:59 that started at 10:05,
  // after the bot was free, was not the owner taking up what stopped. One sent at 10:01 was, whenever it started.
  const at = '2026-10-06T10:00:00.000Z';
  const stopped = { id: 'r1', botId: 'b', trigger: 'manual', status: 'success', prompt: 'Check the PRs', startedAt: '2026-10-06T09:58:00.000Z' };
  const facts = (later) => ({ ask: { botId: 'b', at, runs: [{ id: 'r1', at }] }, bot: { id: 'b', jobs: [] }, stopped: { r1: stopped }, later, now: Date.parse(at) + 60e3 });
  const message = (sentAt, startedAt) => ({ id: 'r2', botId: 'b', trigger: 'manual', sentAt, startedAt });
  assert.equal(asksLib.whatCarriesOn(facts([message('2026-10-06T09:59:00.000Z', '2026-10-06T10:05:00.000Z')])).length, 1);
  assert.equal(asksLib.whatCarriesOn(facts([message('2026-10-06T10:01:00.000Z', '2026-10-06T10:05:00.000Z')])).length, 0);
  assert.equal(asksLib.whatCarriesOn(facts([message('2026-10-06T10:01:00.000Z', '2026-10-06T10:01:00.000Z')])).length, 0, 'one that still waits: it has no start but when it was sent');
  assert.equal(asksLib.whatCarriesOn(facts([{ id: 'r2', botId: 'b', trigger: 'manual', startedAt: '2026-10-06T10:01:00.000Z' }])).length, 0, 'a run from before, without sentAt, counts by its start');
});

test("the Chief's wait_for_run on a run that has not started when the time is up says so", async (t) => {
  // The tool itself, with botdot's answers handed to it and its clock moved on: no call here waits.
  const { TOOLS } = require('../lib/mcp-server');
  const tool = TOOLS.find((x) => x.name === 'wait_for_run');
  t.mock.timers.enable({ apis: ['Date'] });
  const calls = [];
  const answers = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    t.mock.timers.tick(25_000); // botdot held the call for its whole slice
    return { ok: true, json: async () => answers.shift() };
  });
  const waiting = { id: 'r9', botId: 'b', botName: 'Busy Bot', trigger: 'manual', status: 'queued', prompt: 'Later', attachments: [], queuedAt: '2026-10-06T10:00:00.000Z' };
  answers.push(waiting, waiting);
  const out = await tool.run({ runId: 'r9', timeoutSeconds: 30 });
  assert.deepEqual([out.id, out.status, out.note], ['r9', 'queued', 'It has not started yet: the bot is still busy with earlier work. Check again later with get_run.']);
  assert.deepEqual(calls.map((u) => u.split('/api')[1]), ['/runs/r9/wait?timeout=25&seen=chief', '/runs/r9/wait?timeout=5&seen=chief'], 'it went on waiting while the run waited its turn');
  // It started and ended within the wait: its result, as for any run.
  answers.push(waiting, { ...waiting, status: 'success', result: 'Done later.' });
  const done = await tool.run({ runId: 'r9', timeoutSeconds: 60 });
  assert.deepEqual([done.status, done.result, done.note], ['success', 'Done later.', undefined]);
});
