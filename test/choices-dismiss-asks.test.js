// Putting a reply's quick answers away ends its open question (docs/api.md, "Putting quick answers away" and
// "A bot that asks"): the bot's head stops saying "Needs you" and the feed says `asks` ended; Undo opens the question
// again. A card of questions is never put away this way, and another open question of the bot stays.
// Real botdot server, stand-in Claude.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, makeBot, seedRuns, feed, waitFor } = require('./helpers');

const BUTTONS = 'The invoice is ready.\nShould I send it to the client?\n\n[[choices: Yes | No]]';
const BUTTONS_2 = 'Shall I book the dentist for Monday?\n\n[[choices: Book it | Leave it]]';
const CARD = '[[ask: Which calendar?]]\n[[ask: What time?]]';
const isRunOf = (bot, words = '') => (x) => x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(words);
const botOf = async (srv, bot) => (await srv.api(`/bots/${bot.id}`)).data;
const listed = async (srv, bot) => (await srv.api('/bots')).data.find((b) => b.id === bot.id);
const open = async (srv, bot) => ((await botOf(srv, bot)).asks?.open || []).map((x) => x.runId);
const post = async (srv, bot, body) => (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body })).data;
const dismiss = (srv, runId, dismissed) => srv.api(`/runs/${runId}/choices-dismissed`, { method: 'PUT', body: { dismissed } });
// The feed's events about a bot's open questions, oldest first: the runs that ask on each, [] for none.
const told = (f, bot) => f.events.filter((e) => e.type === 'asks' && e.data.botId === bot.id).map((e) => (e.data.asks?.open || []).map((x) => x.runId));

test('putting the answers away ends the question: the bot is no longer "Needs you", the feed says so, and Undo brings it back', async () => {
  let srv = await startServer();
  let f;
  try {
    f = await feed(srv);
    await f.wait('hello');
    const bot = await makeBot(srv, { name: 'Office Helper', emoji: '🗂️' });
    srv.reply(BUTTONS);
    const a = await srv.finished((await post(srv, bot, { prompt: 'make the invoice' })).id);
    assert.deepEqual(await open(srv, bot), [a.id]);
    assert.equal((await listed(srv, bot)).state, 'needs_you');
    assert.equal((await srv.api(`/runs/${a.id}?events=0`)).data.asks, true);
    await waitFor(() => told(f, bot).length === 1, { what: 'the question on the feed' });

    // The ×: the question ends at once, on the bot, in the list, on the run, and on the feed.
    assert.equal((await dismiss(srv, a.id, true)).status, 200);
    assert.deepEqual(await open(srv, bot), []);
    assert.equal((await botOf(srv, bot)).asks, undefined);
    assert.notEqual((await listed(srv, bot)).state, 'needs_you', 'the head says it no more');
    const run = (await srv.api(`/runs/${a.id}?events=0`)).data;
    assert.deepEqual([run.choicesDismissed, run.asks, run.question], [true, undefined, undefined], 'the run asks nothing, and keeps its answers');
    assert.deepEqual(run.choices, ['Yes', 'No']);
    await waitFor(() => told(f, bot).length === 2, { what: 'the end of the question on the feed' });
    assert.deepEqual(told(f, bot), [[a.id], []]);
    assert.equal((await f.wait('asks', (d) => d.botId === bot.id && d.asks === null)).data.asks, null);

    // Putting them away again changes nothing, and says nothing again.
    await dismiss(srv, a.id, true);
    assert.deepEqual(await open(srv, bot), []);
    assert.equal(told(f, bot).length, 2);

    // Kept after a restart: the question is not open again.
    f.close();
    srv = await restartServer(srv);
    f = await feed(srv);
    await f.wait('hello');
    assert.deepEqual(await open(srv, bot), []);
    assert.notEqual((await listed(srv, bot)).state, 'needs_you');

    // Undo: the question is open again, the head says so, and the feed too.
    assert.equal((await dismiss(srv, a.id, false)).status, 200);
    assert.deepEqual(await open(srv, bot), [a.id]);
    assert.equal((await listed(srv, bot)).state, 'needs_you');
    assert.equal((await srv.api(`/runs/${a.id}?events=0`)).data.asks, true);
    assert.deepEqual((await f.wait('asks', (d) => d.botId === bot.id && d.asks?.runId === a.id)).data.asks.runId, a.id);
  } finally { f?.close(); await srv.stop(); }
});

test('the answers put away end only that reply\'s question: another open question of the bot stays', async () => {
  const srv = await startServer();
  let f;
  try {
    f = await feed(srv);
    await f.wait('hello');
    const bot = await makeBot(srv, { name: 'Office Helper', emoji: '🗂️' });
    // Two runs at once (ADR 062), each with buttons, and a third that asks with a card.
    srv.hold();
    const a = await post(srv, bot, { prompt: 'make the invoice' });
    const aRec = await srv.nextRun(isRunOf(bot, 'make the invoice'));
    const b = await post(srv, bot, { prompt: 'book the dentist' });
    const bRec = await srv.nextRun(isRunOf(bot, 'book the dentist'));
    const c = await post(srv, bot, { prompt: 'plan the trip' });
    const cRec = await srv.nextRun(isRunOf(bot, 'plan the trip'));
    srv.reply(BUTTONS);
    srv.release(aRec);
    await srv.finished(a.id);
    srv.reply(BUTTONS_2);
    srv.release(bRec);
    await srv.finished(b.id);
    srv.reply(CARD);
    srv.release(cRec);
    await srv.finished(c.id);
    assert.deepEqual(await open(srv, bot), [c.id, b.id, a.id]);

    // The older reply's answers away: it leaves the open questions, the other two stay.
    await dismiss(srv, a.id, true);
    assert.deepEqual(await open(srv, bot), [c.id, b.id]);
    assert.equal((await listed(srv, bot)).state, 'needs_you', 'two questions are still open');
    assert.equal((await botOf(srv, bot)).asks.runId, c.id);
    await waitFor(() => told(f, bot).some((x) => x.length === 2 && x[0] === c.id && x[1] === b.id), { what: 'the two left on the feed' });

    // The newest with buttons away too: the card stays, and the bot is still "Needs you". The card is never put away:
    // its run has no quick answers to dismiss.
    await dismiss(srv, b.id, true);
    assert.deepEqual(await open(srv, bot), [c.id]);
    assert.equal((await listed(srv, bot)).state, 'needs_you');
    assert.equal((await dismiss(srv, c.id, true)).status, 400, 'a card has no quick answers to put away');
    assert.deepEqual(await open(srv, bot), [c.id]);

    // Undo of the older one: it is open again beside the card, in its place by time.
    await dismiss(srv, a.id, false);
    assert.deepEqual(await open(srv, bot), [c.id, a.id]);
  } finally { f?.close(); srv.unhold(); await srv.stop(); }
});

test('a reply that holds a card of questions keeps its question when its buttons are put away', async () => {
  let srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Office Helper', emoji: '🗂️' });
    await srv.stop();
    const [a] = seedRuns(srv, bot, [{ prompt: 'book it', result: 'Two things first.', choices: ['Work', 'Home'], questions: ['Which calendar?', 'What time?'] }]);
    srv = await startServer({ dir: srv.dir });
    assert.deepEqual(await open(srv, bot), [a]);
    assert.equal((await dismiss(srv, a, true)).status, 200);
    assert.deepEqual(await open(srv, bot), [a], 'the card still asks');
    assert.equal((await srv.api(`/runs/${a}?events=0`)).data.asks, true);
    assert.equal((await listed(srv, bot)).state, 'needs_you');
  } finally { await srv.stop(); }
});

test('the reply stays a new reply when its answers are put away: only its question ends', async () => {
  let srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Office Helper', emoji: '🗂️' });
    await srv.stop();
    const [a] = seedRuns(srv, bot, [{ prompt: 'make the invoice', result: 'Send it?', choices: ['Yes', 'No'] }]);
    srv = await startServer({ dir: srv.dir });
    const unread = async () => (await listed(srv, bot)).unread;
    const before = await unread();
    assert.ok(before, 'a reply the owner has not read');
    await dismiss(srv, a, true);
    assert.deepEqual(await unread(), before, 'the reply is as new as it was');
    assert.deepEqual(await open(srv, bot), []);
  } finally { await srv.stop(); }
});
