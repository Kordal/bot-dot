// A write through a connected app waits for the owner's answer inside its run (ADR 010, OK-003): the bot's own
// tools server (lib/connectors-mcp.js) leaves connector_run unanswered while the card waits, against a real
// botdot server, the stand-in for Claude and the stand-in connected app. "Allow once" and "Always allow this
// action" let the same call through, a decline and the end of the wait are told to the bot in botdot's words,
// and the card says through each whether its run still waits (`held`, `stoppedAt`, the run's `waitingFor`).
// The wait is ten minutes; one server here has it at under a second. What a yes does after the wait ended is in
// test/connector-late.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, makeBot, heldRun, waitFor, feed, fakeConnectedApp, connectorEnv } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const MAIL = { recipient_email: 'anna@example.com', subject: 'Running late', body: 'Hi Anna,\nI will be 20 minutes late.' };
const ROWS = [{ label: 'To', value: 'anna@example.com' }, { label: 'Subject', value: 'Running late' }, { label: 'Text', value: 'Hi Anna,\nI will be 20 minutes late.' }];
const WAIT_MS = 700;

let app, srv, quick;
before(async () => {
  app = await fakeConnectedApp();
  [srv, quick] = await Promise.all([startServer({ env: app.env }), startServer({ env: { ...app.env, BOT_DOT_CONNECTOR_WAIT_MS: String(WAIT_MS) } })]);
  await Promise.all([app.connect(srv), app.connect(quick)]);
});
after(async () => { await Promise.all([srv.stop(), quick.stop()]); app.close(); });

// A run of the bot that is going on, with the bot's own tools for connected apps.
async function running(t, on, bot) {
  const { token, rec, run } = await heldRun(on, bot);
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(on, token));
  const send = (args = MAIL, action = 'GMAIL_SEND_EMAIL') => tools.call('connector_run', { app: 'gmail', action, arguments: args });
  const cards = async () => (await on.api('/asks')).data.filter((a) => a.botId === bot.id);
  const card = (not = null) => waitFor(async () => (await cards()).find((a) => a.id !== not), { what: 'the card of the action' });
  const answer = (ask, body) => on.api(`/asks/${ask.id}`, { method: 'POST', body });
  const now = async () => (await on.api(`/runs/${run.id}?events=0`)).data;
  const end = async () => { on.release(rec); return on.finished(run.id); };
  return { token, rec, run, send, cards, card, answer, now, end };
}
const said = (result) => result.content.map((c) => c.text).join('\n');
const stateOf = async (on, bot) => (await on.api('/bots')).data.find((b) => b.id === bot.id).state;

test('the card shows all it approves: a long email is whole on it, and "Allow once" sends exactly that', async (t) => {
  // An email that no card of 500 characters and 30 rows held: the sentence that matters is the last of a long
  // text, and the arguments after the thirtieth were left out.
  const text = `${'Thank you for your letter. '.repeat(60)}Wire the money to account 12345 today.`;
  const long = { recipient_email: 'anna@example.com', subject: 'Re: your letter', body: text, ...Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`extra_${i}`, `value ${i}`])) };
  const bot = await makeBot(srv, { name: 'Long Writer', emoji: '📜', connectors: ['gmail'] });
  const f = feed(srv);
  t.after(() => f.close());
  await f.wait('hello');
  const r = await running(t, srv, bot);
  const before = app.executed.length;
  const call = r.send(long);
  const card = await r.card();
  // The list: a row for every argument, every value in full, in the bot's order.
  assert.equal(card.rows.length, Object.keys(long).length);
  assert.deepEqual(card.rows.slice(0, 4), [{ label: 'To', value: 'anna@example.com' }, { label: 'Subject', value: 'Re: your letter' }, { label: 'Text', value: text }, { label: 'Extra 0', value: 'value 0' }]);
  assert.deepEqual(card.rows.at(-1), { label: 'Extra 34', value: 'value 34' });
  assert.deepEqual(card.rows.map((row) => row.value), Object.values(long), 'what the rows say is what was sent, argument by argument');
  assert.ok(!('more' in card) && card.rows.every((row) => !('more' in row)));
  // The feed: the short form, which says where it was cut.
  const listed = (await f.wait('asks', (d) => d.list.some((a) => a.id === card.id))).data.list.find((a) => a.id === card.id);
  assert.deepEqual([listed.rows.length, listed.more, listed.rows[2].label, listed.rows[2].value.length, listed.rows[2].more], [31, true, 'Text', 500, true]);
  assert.doesNotMatch(JSON.stringify(listed), /Wire the money|value 34/);
  // "Allow once" lets through exactly what the opened card shows.
  assert.deepEqual((await r.answer(card, { yes: true })).data, { ok: true });
  assert.equal(said(await call), '{"done":true}');
  assert.deepEqual(app.executed.slice(before), [{ action: 'GMAIL_SEND_EMAIL', args: long }]);
  // "Always allow this action" on such a card lets the same through.
  const other = { ...long, subject: 'Once more' };
  const again = r.send(other);
  const next = await r.card(card.id);
  assert.deepEqual([next.rows.length, next.rows[1], next.rows[2].value], [Object.keys(other).length, { label: 'Subject', value: 'Once more' }, text]);
  assert.deepEqual((await r.answer(next, { yes: true, always: true })).data, { ok: true });
  assert.equal(said(await again), '{"done":true}');
  assert.deepEqual(app.executed.slice(before + 1), [{ action: 'GMAIL_SEND_EMAIL', args: other }]);
  await r.end();
});

test('an action too long to show in full waits as any other: "Allow once" is refused, a no and "Always allow this action" are as ever', async (t) => {
  // 201 arguments: the card has the first 200 rows and says `more`. "Allow once" would send what no card shows.
  const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`field_${i}`, `value ${i}`]));
  const TOO_LONG = "This is too long to show in full, so it can't be allowed once. Decline it, or always allow this action.";
  const bot = await makeBot(srv, { name: 'Bulk Writer', emoji: '🧾', connectors: ['gmail'] });
  const r = await running(t, srv, bot);
  const before = app.executed.length;
  const call = r.send(many);
  const card = await r.card();
  assert.deepEqual([card.rows.length, card.more, card.held, card.rows[0], card.rows[199]], [200, true, true, { label: 'Field 0', value: 'value 0' }, { label: 'Field 199', value: 'value 199' }]);
  assert.ok(card.rows.every((row) => !('more' in row)), 'every row it has is whole');
  // The bot is told nothing new: its run waits for the answer as any other.
  assert.deepEqual([(await r.now()).waitingFor, (await r.now()).status, await stateOf(srv, bot)], ['ok', 'running', 'needs_you']);
  // A yes without `always`, as an app of before this card sends it: refused, and nothing changes.
  for (const body of [{ yes: true }, { yes: true, always: false }, { yes: true, always: 'true' }, { yes: true, always: 1 }]) {
    const once = await r.answer(card, body);
    assert.deepEqual([once.status, once.data], [409, { error: TOO_LONG }], JSON.stringify(body));
  }
  assert.deepEqual([(await r.cards()).map((a) => [a.id, a.held]), (await r.now()).waitingFor, app.executed.length], [[[card.id, true]], 'ok', before], 'the card stays, its run still waits, and nothing was sent');
  assert.deepEqual((await srv.api(`/bots/${bot.id}/connector-actions`)).data, []);
  // A no is told to the bot in the words of any card.
  assert.deepEqual((await r.answer(card, { yes: false })).data, { ok: true, declined: true });
  assert.equal(said(await call), "Error: The owner declined this action, so it was not done. Don't try it another way: no other action, app or tool for the same thing. Say in your reply that the owner declined it.");
  assert.equal(app.executed.length, before);
  // "Always allow this action" works as today: the lasting grant, and the same call goes through with every argument.
  const other = { ...many, field_0: 'another value' };
  const again = r.send(other);
  const next = await r.card(card.id);
  assert.deepEqual([next.more, next.rows.length], [true, 200]);
  assert.deepEqual((await r.answer(next, { yes: true, always: true })).data, { ok: true });
  assert.equal(said(await again), '{"done":true}');
  assert.deepEqual(app.executed.slice(before), [{ action: 'GMAIL_SEND_EMAIL', args: other }]);
  assert.deepEqual((await srv.api(`/bots/${bot.id}/connector-actions`)).data, ['gmail:GMAIL_SEND_EMAIL']);
  assert.deepEqual(await r.cards(), []);
  // And the run ends as any other.
  assert.equal((await r.end()).status, 'success');
  // An action of 200 arguments is whole, and is allowed once as before.
  const whole = Object.fromEntries(Object.entries(many).slice(0, 200));
  const keeper = await makeBot(srv, { name: 'Exact Writer', emoji: '📐', connectors: ['gmail'] });
  const k = await running(t, srv, keeper);
  const sent = k.send(whole);
  const full = await k.card();
  assert.deepEqual([full.rows.length, 'more' in full], [200, false]);
  assert.deepEqual((await k.answer(full, { yes: true })).data, { ok: true });
  assert.equal(said(await sent), '{"done":true}');
  assert.deepEqual(app.executed.at(-1), { action: 'GMAIL_SEND_EMAIL', args: whole });
  await k.end();
});

test('"Allow once" while the run waits: the same call goes through, once, and the run says through it that it waits', async (t) => {
  const bot = await makeBot(srv, { name: 'Mail Writer', emoji: '✉️', connectors: ['gmail'] });
  const f = feed(srv);
  t.after(() => f.close());
  const hello = await f.wait('hello');
  assert.ok(hello.data.features.includes('connector-waits'), 'announced in features');
  const r = await running(t, srv, bot);
  const before = app.executed.length;

  const call = r.send();
  const card = await r.card();
  assert.deepEqual([card.kind, card.title, card.held, card.stoppedAt, card.then, card.yesOn], ['connector-action', 'Send email with Gmail?', true, undefined, undefined, 'card']);
  assert.deepEqual(card.rows, ROWS);
  assert.doesNotMatch([card.title, ...card.rows.flatMap((row) => [row.label, row.value])].join('\n'), /[{}"]/, 'no JSON on the card');
  assert.match(card.details, /"recipient_email": "anna@example\.com"/, '`details` stays for an app from before');
  assert.equal(app.executed.length, before, 'nothing has run');
  // The run waits: on the run, in the list, in the feed, and on the bot's face.
  assert.deepEqual([(await r.now()).waitingFor, (await r.now()).status], ['ok', 'running']);
  assert.equal((await srv.api(`/runs?botId=${bot.id}`)).data[0].waitingFor, 'ok');
  assert.equal(await stateOf(srv, bot), 'needs_you');
  const began = await f.wait('run_waits', (d) => d.runId === r.run.id);
  assert.deepEqual({ ...began.data, at: null }, { chat: `bot:${bot.id}`, botId: bot.id, runId: r.run.id, waitingFor: 'ok', at: null });
  const listed = (await f.wait('asks', (d) => d.list.some((a) => a.id === card.id))).data.list.find((a) => a.id === card.id);
  assert.deepEqual([listed.title, listed.rows, listed.held, listed.stoppedAt, listed.then, listed.text], ['Send email with Gmail?', ROWS, true, undefined, undefined, 'Wants to send email with Gmail']);
  const late = feed(srv);
  t.after(() => late.close());
  assert.equal((await late.wait('hello')).data.running.find((x) => x.id === r.run.id).waitingFor, 'ok', 'an app that connects now reads it from hello');

  // The wait is this run's own: another run's token, or none, gets nothing of it. And only the owner answers.
  const other = await heldRun(srv, await makeBot(srv, { name: 'Other', emoji: '👀', connectors: ['gmail'] }));
  const wait = (headers) => srv.api('/connectors/session/wait', { method: 'POST', headers, body: { id: card.id } });
  assert.deepEqual([(await wait({ 'X-Run-Token': other.token })).status, (await wait({})).status, (await wait({ 'X-Run-Token': 'made-up' })).status], [404, 403, 403]);
  assert.equal((await srv.asChief(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).status, 403);
  assert.equal(app.executed.length, before);

  // The owner's yes: the call that waited gets the action's result, and the wait is over everywhere.
  assert.deepEqual((await r.answer(card, { yes: true })).data, { ok: true });
  const done = await call;
  assert.ok(!done.isError, said(done));
  assert.equal(said(done), '{"done":true}');
  assert.deepEqual(app.executed.slice(before), [{ action: 'GMAIL_SEND_EMAIL', args: MAIL }]);
  assert.deepEqual(await r.cards(), [], 'the card is gone');
  assert.equal((await r.now()).waitingFor, undefined);
  const ended = await f.wait('run_waits', (d) => d.runId === r.run.id && !('waitingFor' in d));
  assert.deepEqual({ ...ended.data, at: null }, { chat: `bot:${bot.id}`, botId: bot.id, runId: r.run.id, at: null });

  // The grant is used up by that call: the same call again asks again. A decline is told to the bot, and the ask goes.
  const second = r.send();
  const again = await r.card(card.id);
  assert.equal(again.held, true);
  assert.deepEqual((await r.answer(again, { yes: false })).data, { ok: true, declined: true });
  const no = await second;
  assert.equal(no.isError, true);
  assert.equal(said(no), "Error: The owner declined this action, so it was not done. Don't try it another way: no other action, app or tool for the same thing. Say in your reply that the owner declined it.");
  assert.deepEqual(await r.cards(), []);
  assert.equal((await r.now()).waitingFor, undefined);
  // After a no the same call again in this run is answered at once with the same words: no card, no second wait.
  assert.equal(said(await r.send()), said(no));
  assert.deepEqual([await r.cards(), (await r.now()).waitingFor], [[], undefined]);
  assert.equal(app.executed.length, before + 1);
  srv.release(other.rec);
  assert.equal((await r.end()).status, 'success');
});

test('"Always allow this action" while the run waits: the same, and the lasting grant is saved; a read and a granted write go through at once', async (t) => {
  const bot = await makeBot(srv, { name: 'Post Keeper', emoji: '📮', connectors: ['gmail'] });
  const r = await running(t, srv, bot);
  const before = app.executed.length;
  // A read needs no answer.
  const read = await r.send({ query: 'from:anna' }, 'GMAIL_READ');
  assert.equal(said(read), '{"done":true}');
  assert.deepEqual(await r.cards(), []);

  const call = r.send();
  const card = await r.card();
  assert.deepEqual((await r.answer(card, { yes: true, always: true })).data, { ok: true });
  assert.equal(said(await call), '{"done":true}');
  assert.deepEqual((await srv.api(`/bots/${bot.id}/connector-actions`)).data, ['gmail:GMAIL_SEND_EMAIL']);
  // With the lasting grant the action goes through at once, with any arguments, and makes no card.
  assert.equal(said(await r.send({ ...MAIL, subject: 'Another' })), '{"done":true}');
  assert.deepEqual(await r.cards(), []);
  assert.deepEqual(app.executed.slice(before).map((x) => [x.action, x.args.subject]), [['GMAIL_READ', undefined], ['GMAIL_SEND_EMAIL', 'Running late'], ['GMAIL_SEND_EMAIL', 'Another']]);
  await r.end();
});

test('the owner stops the waiting run: the ask goes', async (t) => {
  const bot = await makeBot(srv, { name: 'Stopped', emoji: '🛑', connectors: ['gmail'] });
  const r = await running(t, srv, bot);
  const before = app.executed.length;
  const call = r.send();
  await r.card();
  assert.deepEqual((await srv.api(`/runs/${r.run.id}/stop`, { method: 'POST' })).data, { ok: true });
  assert.equal((await srv.finished(r.run.id)).status, 'stopped');
  assert.deepEqual(await r.cards(), [], 'nothing is left to allow');
  assert.equal((await call).isError, true);
  assert.equal(app.executed.length, before);
});

// A bot whose run waits for the owner's OK is busy (ADR 011): the owner's message to it waits its turn, and starts
// when that run has ended, whatever the answer was. The end of the wait is in the test after this one.
test("the owner's message to a bot that waits for the OK waits too, and starts after Allow, Decline or Stop", async (t) => {
  for (const how of ['Allow', 'Decline', 'Stop']) {
    const bot = await makeBot(srv, { name: `Held ${how}`, emoji: '✋', connectors: ['gmail'] });
    const r = await running(t, srv, bot);
    const call = r.send();
    const card = await r.card();
    assert.equal((await r.now()).waitingFor, 'ok');
    const w = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: `After the ${how}` } })).data;
    assert.equal(w.status, 'queued', how);
    assert.deepEqual((await srv.api(`/runs?botId=${bot.id}`)).data.map((x) => [x.id, x.status]), [[r.run.id, 'running']], 'no run beside the one that waits');
    if (how === 'Stop') assert.deepEqual((await srv.api(`/runs/${r.run.id}/stop`, { method: 'POST' })).data, { ok: true });
    else assert.equal((await r.answer(card, { yes: how === 'Allow' })).data.ok, true);
    await call;
    // Answered, the run goes on until it ends by itself: the message still waits meanwhile. The stand-in's run
    // stays held through this (letting every held run go before the answer would end it within a moment, and the
    // message would have started by the time it is looked at).
    if (how !== 'Stop') { assert.equal((await srv.api(`/runs/${w.id}?events=0`)).data.status, 'queued', how); await r.end(); }
    const first = await srv.finished(r.run.id);
    srv.unhold(); // only now: the message's own run, which started as the first ended, is not held
    const next = await srv.finished(w.id);
    assert.deepEqual([first.status, next.status, next.prompt], [how === 'Stop' ? 'stopped' : 'success', 'success', `After the ${how}`]);
    assert.ok(next.startedAt >= first.endedAt, how);
    assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.queued, []);
  }
});

test('ten minutes without an answer: the bot is told, the card stays as no longer waited for, and the run is not held twice', async (t) => {
  const bot = await makeBot(quick, { name: 'Patient', emoji: '⏳', connectors: ['gmail'] });
  const f = feed(quick);
  t.after(() => f.close());
  await f.wait('hello');
  const r = await running(t, quick, bot);
  // A message of the owner to the bot, sent as its run asks: it waits through the whole wait (ADR 011).
  const behind = (await quick.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'After the wait' } })).data;
  assert.equal(behind.status, 'queued');
  const before = app.executed.length;
  const asked = Date.now();
  const out = await r.send();
  assert.ok(Date.now() - asked >= WAIT_MS - 50, 'the call waited');
  assert.equal(out.isError, true);
  const told = "Error: The owner has not answered yet, so this action was not done. Its card stays in Needs you: if the owner allows it later, botdot starts you again by itself to do it then. Don't call it again in this run and don't try it another way. Say in your reply that it is not done yet and waits for the owner's OK.";
  assert.equal(said(out), told);
  const [card, ...more] = await r.cards();
  assert.deepEqual(more, []);
  assert.deepEqual([card.held, card.then, card.rows], [false, { who: 'bot', text: 'It carries on when you allow it.' }, ROWS]);
  assert.ok(Date.parse(card.stoppedAt) >= asked && Date.parse(card.stoppedAt) <= Date.now(), 'when the wait ended');
  assert.deepEqual([(await r.now()).waitingFor, (await r.now()).status], [undefined, 'running'], 'the run goes on, and no longer waits');
  const events = f.events.filter((e) => e.type === 'run_waits' && e.data.runId === r.run.id).map((e) => e.data.waitingFor);
  assert.deepEqual(events, ['ok', undefined], 'the feed said both');
  const listed = f.events.filter((e) => e.type === 'asks').at(-1).data.list.find((a) => a.id === card.id);
  assert.deepEqual([listed.held, listed.stoppedAt, listed.then], [false, card.stoppedAt, card.then]);
  assert.equal(await stateOf(quick, bot), 'needs_you', 'the card still needs the owner');
  // The same call again in this run: answered at once, with the same words, on the same card.
  const second = Date.now();
  const again = await r.send();
  assert.ok(Date.now() - second < WAIT_MS - 100, 'not held again');
  assert.equal(said(again), told);
  assert.deepEqual((await r.cards()).map((a) => [a.id, a.held]), [[card.id, false]]);
  assert.equal(app.executed.length, before);
  // The wait has ended and the run goes on: the owner's message still waits, and starts when the run ends.
  assert.equal((await quick.api(`/runs/${behind.id}?events=0`)).data.status, 'queued');
  quick.unhold();
  const ended = await r.end();
  const next = await quick.finished(behind.id);
  assert.deepEqual([next.status, next.prompt, next.startedAt >= ended.endedAt], ['success', 'After the wait', true]);
  assert.deepEqual((await r.cards()).map((a) => [a.id, a.held, a.stoppedAt]), [[card.id, false, card.stoppedAt]], 'the card stays after the run');
});

test('botdot is stopped while a run waits: after the start the ask is there, and nobody waits for it', async (t) => {
  let own = await startServer({ env: app.env });
  t.after(() => own.stop());
  await app.connect(own);
  const bot = await makeBot(own, { name: 'Cut Off', emoji: '✂️', connectors: ['gmail'] });
  const r = await running(t, own, bot);
  r.send().catch(() => {}); // its botdot goes away under it
  const card = await r.card();
  assert.equal(card.held, true);
  const stopped = Date.now();
  own = await restartServer(own);
  const [kept] = (await own.api('/asks')).data.filter((a) => a.botId === bot.id);
  assert.deepEqual([kept.id, kept.held, kept.rows], [card.id, false, ROWS]);
  assert.ok(Date.parse(kept.stoppedAt) >= stopped, 'since the start');
  assert.deepEqual(kept.then, { who: 'bot', text: 'It carries on when you allow it.' }, 'a yes still starts the bot again');
  const run = (await own.api(`/runs/${r.run.id}?events=0`)).data;
  assert.deepEqual([run.status, run.waitingFor], ['interrupted', undefined]);
});

test('the bots are told that a write waits for the owner and that they wait with it', async (t) => {
  const bot = await makeBot(srv, { name: 'Reader', emoji: '📖', connectors: ['gmail'] });
  const r = await running(t, srv, bot);
  assert.match(r.rec.system, /Anything that sends, posts, changes, deletes or pays waits for the owner's OK on a card: connector_run then does not answer until the owner has answered, for up to ten minutes\. That is expected, and you wait with it: call it once, don't call it again meanwhile, and don't look for another way to do the same thing\. Its answer says what happened: done, declined by the owner, or not answered yet\. Say that plainly in your reply\./);
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, r.token));
  const listed = (await tools.request('tools/list')).tools.find((x) => x.name === 'connector_run');
  assert.match(listed.description, /waits for the owner's OK on a card: this call then takes up to ten minutes to answer, which is expected\. Wait with it/);
  await r.end();
});
