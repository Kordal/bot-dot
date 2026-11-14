// Two runs of one bot that ask keep two questions (#1377; docs/api.md, "A bot that asks"). Runs of one bot go beside
// each other (ADR 062): the reply of the second that asks must not take the place of the first's question. An answer
// that names its run (a tapped answer, a card of questions sent) ends that question alone; a typed message ends all.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, makeBot, feed, waitFor } = require('./helpers');

const BUTTONS = 'The invoice is ready.\nShould I send it to the client?\n\n[[choices: Yes | No]]';
const CARD = '[[ask: Which calendar?]]\n[[ask: What time?]]';
const isRunOf = (bot, words = '') => (x) => x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(words);
const botOf = async (srv, bot) => (await srv.api(`/bots/${bot.id}`)).data;
const open = async (srv, bot) => ((await botOf(srv, bot)).asks?.open || []).map((x) => x.runId);
const post = async (srv, bot, body) => (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body })).data;

test('two runs of one bot that ask keep both questions until each is answered (#1377)', async () => {
  let srv = await startServer();
  let f;
  try {
    f = await feed(srv);
    await f.wait('hello');
    const bot = await makeBot(srv, { name: 'Office Helper', emoji: '🗂️' });
    assert.ok((await srv.api('/version')).data.features.includes('asks-several'));

    // Two messages, two runs at once.
    srv.hold();
    const a = await post(srv, bot, { prompt: 'make the invoice' });
    const aRec = await srv.nextRun(isRunOf(bot, 'make the invoice'));
    const b = await post(srv, bot, { prompt: 'book the dentist' });
    const bRec = await srv.nextRun(isRunOf(bot, 'book the dentist'));
    assert.notEqual(b.status, 'queued', 'the second goes beside the first');

    // The first asks with buttons, then the second with a card: both stay open, the newest first.
    srv.reply(BUTTONS);
    srv.release(aRec);
    await srv.finished(a.id);
    assert.deepEqual(await open(srv, bot), [a.id]);
    srv.reply(CARD);
    srv.release(bRec);
    await srv.finished(b.id);
    const asks = (await botOf(srv, bot)).asks;
    assert.equal(asks.runId, b.id, 'runId: the newest, as an older app reads it');
    assert.deepEqual(asks.open.map((x) => [x.runId, x.text]), [[b.id, 'Which calendar? (+1 more)'], [a.id, 'Should I send it to the client?']]);
    await waitFor(() => f.events.some((e) => e.type === 'asks' && e.data.botId === bot.id && e.data.asks?.open?.length === 2), { what: 'both questions on the feed' });

    // The same after a restart: nothing is kept for them.
    f.close();
    srv = await restartServer(srv);
    f = await feed(srv);
    await f.wait('hello');
    assert.deepEqual(await open(srv, bot), [b.id, a.id]);

    // The older question's answer, tapped: it answers that run, and the card of the newer one stays.
    srv.hold();
    const tapped = await post(srv, bot, { prompt: 'Yes', answers: a.id });
    const tapRec = await srv.nextRun(isRunOf(bot, 'Yes'));
    assert.equal(tapped.answers, a.id);
    assert.ok(tapRec.system.includes(`answer to the question at the end of your reply in run ${a.id}`), "the run is told which question it answers");
    assert.deepEqual(await open(srv, bot), [b.id]);
    // Its reply, which asks nothing, ends nothing else.
    srv.reply('Sent to the client.');
    srv.release(tapRec);
    await srv.finished(tapped.id);
    assert.deepEqual(await open(srv, bot), [b.id]);

    // A run that is no open question is not taken as the one answered.
    srv.unhold();
    srv.reply('Noted.');
    const stale = await post(srv, bot, { prompt: 'Which calendar?\n→ Home\n\nWhat time?\n→ 8:00', answers: a.id });
    assert.equal(stale.answers, undefined);
    await srv.finished(stale.id);
    assert.equal((await botOf(srv, bot)).asks, undefined, 'a message that names no open question ends them all');

    // Again two questions: a typed message, which names none, ends both.
    srv.hold();
    const c = await post(srv, bot, { prompt: 'make the second invoice' });
    const cRec = await srv.nextRun(isRunOf(bot, 'make the second invoice'));
    const d = await post(srv, bot, { prompt: 'book the barber' });
    const dRec = await srv.nextRun(isRunOf(bot, 'book the barber'));
    srv.reply(BUTTONS);
    srv.release(cRec);
    await srv.finished(c.id);
    srv.reply(CARD);
    srv.release(dRec);
    await srv.finished(d.id);
    assert.deepEqual(await open(srv, bot), [d.id, c.id]);
    // The card sent: that question ends alone.
    srv.unhold();
    srv.reply('Booked.');
    srv.hold();
    const card = await post(srv, bot, { prompt: 'Which calendar?\n→ Work\n\nWhat time?\n→ 9:00', answers: d.id });
    const cardRec = await srv.nextRun(isRunOf(bot, '→ Work'));
    assert.equal(card.answers, d.id);
    assert.ok(cardRec.system.includes(`answers the questions at the end of your reply in run ${d.id}`));
    srv.release(cardRec);
    srv.unhold();
    assert.equal(card.answers, d.id);
    await srv.finished(card.id);
    assert.deepEqual(await open(srv, bot), [c.id]);
    srv.reply('Fine.');
    await srv.finished((await post(srv, bot, { prompt: 'never mind, I did it myself' })).id);
    assert.equal((await botOf(srv, bot)).asks, undefined);
  } finally { f?.close(); srv.unhold(); await srv.stop(); }
});

test('a newer run that started after a question still takes its place, as in one conversation', async () => {
  const srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Office Helper', emoji: '🗂️' });
    srv.reply(BUTTONS);
    const a = await srv.finished((await post(srv, bot, { prompt: 'make the invoice' })).id);
    assert.deepEqual(await open(srv, bot), [a.id]);
    // A job's run after it, not an answer: its question takes the place of the first.
    const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Digest', cron: '0 3 1 1 *', prompt: 'Compile the digest', notify: 'always' } })).data;
    srv.reply(CARD);
    const going = (await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data;
    const later = await srv.finished(going.run.id);
    assert.deepEqual(await open(srv, bot), [later.id]);
  } finally { await srv.stop(); }
});
