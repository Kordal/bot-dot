// A series of the same action in a connected app (ADR 220, #1254): a bot that deletes four events sends them in one
// connector_run call with `items`, and the owner gets one card that lists every item, its label (title, date) over its
// arguments (an id). One "Allow once" runs exactly those items and nothing else: a call outside the list asks on its
// own card. Against a real botdot server, the stand-in for Claude, the bot's own tools server and the stand-in app.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, waitFor, fakeConnectedApp, connectorEnv } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { isRunOf } = require('./carry-on-helpers');

const ACTION = 'GMAIL_DELETE_EVENT';
const ITEMS = [
  { label: 'Team lunch, Thu 14 Nov 12:00', arguments: { event_id: 'ev1' } },
  { label: 'Dentist, Fri 15 Nov 09:30', arguments: { event_id: 'ev2' } },
  { label: 'Gym, Sat 16 Nov 08:00', arguments: { event_id: 'ev3' } },
];

let app, srv, quick;
before(async () => {
  app = await fakeConnectedApp();
  [srv, quick] = await Promise.all([startServer({ env: app.env }), startServer({ env: { ...app.env, BOT_DOT_CONNECTOR_WAIT_MS: '1500' } })]);
  await Promise.all([app.connect(srv), app.connect(quick)]);
});
after(async () => { await Promise.all([srv.stop(), quick.stop()]); app.close(); });

const said = (result) => result.content.map((c) => c.text).join('\n');
const cardsOf = async (on, bot) => (await on.api('/asks')).data.filter((a) => a.botId === bot.id);
const answer = (on, ask, body) => on.api(`/asks/${ask.id}`, { method: 'POST', body });
// What a run's own tools send (lib/connectors-mcp.js), with that run's token.
const post = (on, token, body) => on.api('/connectors/session/run', { method: 'POST', headers: { 'X-Run-Token': token }, body: { app: 'gmail', action: ACTION, ...body } });

test('a series asks once, on one card that lists every item, and "Allow once" runs exactly those items', async (t) => {
  const bot = await makeBot(srv, { name: 'Calendar Keeper', emoji: '📅', connectors: ['gmail'] });
  const { token, rec, run } = await heldRun(srv, bot);
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, token));
  const listed = (await tools.request('tools/list')).tools.find((x) => x.name === 'connector_run');
  assert.equal(listed.inputSchema.properties.items.maxItems, 50);
  assert.match(listed.description, /send "items" instead of "arguments"/);

  const before = app.executed.length;
  const call = tools.call('connector_run', { app: 'gmail', action: ACTION, items: ITEMS });
  const card = await waitFor(async () => (await cardsOf(srv, bot))[0], { what: 'the one card of the series' });
  assert.equal((await cardsOf(srv, bot)).length, 1, 'one card, not one per item');
  assert.equal(card.title, 'Delete event with Gmail, 3 times?');
  assert.equal(card.text, 'Wants to delete event with Gmail, 3 times');
  assert.deepEqual(card.rows, [
    { label: 'Team lunch, Thu 14 Nov 12:00', value: 'Event id: ev1' },
    { label: 'Dentist, Fri 15 Nov 09:30', value: 'Event id: ev2' },
    { label: 'Gym, Sat 16 Nov 08:00', value: 'Event id: ev3' },
  ]);
  assert.equal(card.held, true);
  assert.equal(app.executed.length, before, 'nothing ran before the yes');

  assert.deepEqual((await answer(srv, card, { yes: true })).data, { ok: true });
  assert.deepEqual(JSON.parse(said(await call)), ITEMS.map((it) => ({ label: it.label, ok: true, result: { done: true } })));
  assert.deepEqual(app.executed.slice(before), ITEMS.map((it) => ({ action: ACTION, args: it.arguments })), 'each item once, in order');
  assert.deepEqual(await cardsOf(srv, bot), []);

  // The yes covered those items once: the same item again, or one outside the list, asks on a card of its own.
  for (const args of [ITEMS[0].arguments, { event_id: 'ev9' }]) {
    const r = await post(srv, token, { arguments: args });
    assert.deepEqual([r.data.needsApproval, r.data.waits], [true, true], JSON.stringify(args));
  }
  const own = await cardsOf(srv, bot);
  assert.deepEqual(own.map((a) => a.title), ['Delete event with Gmail?', 'Delete event with Gmail?']);
  assert.equal(app.executed.length, before + ITEMS.length);
  for (const a of own) await answer(srv, a, { yes: false });
  srv.release(rec);
  await srv.finished(run.id);
});

test('a series that is no series is refused in words for the bot, and nothing is asked', async () => {
  const bot = await makeBot(srv, { name: 'Strict Keeper', emoji: '🗂️', connectors: ['gmail'] });
  const { token, rec, run } = await heldRun(srv, bot);
  const cases = [
    [[ITEMS[0]], /"items" takes 2 to 50 items/],
    [Array.from({ length: 51 }, (_, i) => ({ label: `Event ${i}`, arguments: { event_id: `e${i}` } })), /"items" takes 2 to 50 items/],
    [[ITEMS[0], { label: 'Again', arguments: { event_id: 'ev1' } }], /Item 2 has the same arguments as an earlier one/],
    [[ITEMS[0], { label: '  ', arguments: { event_id: 'ev2' } }], /Item 2 has no "label"/],
    [[ITEMS[0], { label: 'No args' }], /Item 2 has no "arguments" object/],
  ];
  for (const [items, error] of cases) {
    const r = await post(srv, token, { items });
    assert.equal(r.data.ok, false);
    assert.match(r.data.error, error);
  }
  assert.deepEqual(await cardsOf(srv, bot), []);
  srv.release(rec);
  await srv.finished(run.id);
});

test('a decline of the series is told to the bot, and no item runs', async (t) => {
  const bot = await makeBot(srv, { name: 'Careful Keeper', emoji: '🧹', connectors: ['gmail'] });
  const { token, rec, run } = await heldRun(srv, bot);
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, token));
  const before = app.executed.length;
  const call = tools.call('connector_run', { app: 'gmail', action: ACTION, items: ITEMS });
  const card = await waitFor(async () => (await cardsOf(srv, bot))[0], { what: 'the card' });
  await answer(srv, card, { yes: false });
  assert.match(said(await call), /The owner declined this action/);
  assert.equal(app.executed.length, before);
  srv.release(rec);
  await srv.finished(run.id);
});

test('"Allow once" on a series after the bot stopped waiting starts it again with the items, and they go through once', async (t) => {
  const bot = await makeBot(quick, { name: 'Late Keeper', emoji: '⏰', connectors: ['gmail'] });
  quick.hold();
  const run = (await quick.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Delete my three events.' } })).data;
  const rec = await quick.nextRun(isRunOf(bot), 'the run');
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(quick, rec.connectors.env.RUN_TOKEN));
  assert.match(said(await tools.call('connector_run', { app: 'gmail', action: ACTION, items: ITEMS })), /Its card stays in Needs you/);
  quick.reply('Not done yet: it waits for your OK.');
  quick.release(rec);
  await quick.finished(run.id);
  const [card] = await cardsOf(quick, bot);
  assert.deepEqual([card.held, card.rows.length], [false, 3]);

  const before = app.executed.length;
  assert.deepEqual((await answer(quick, card, { yes: true })).data, { ok: true, carriesOn: { who: 'bot', text: 'it carries on' } });
  const again = await quick.nextRun((x) => isRunOf(bot)(x) && /botdot writes this, not the owner/.test(x.stdin), 'the bot started again');
  assert.ok(again.stdin.includes('The owner allowed this action in Gmail, once for each of these items: GMAIL_DELETE_EVENT.'));
  assert.ok(again.stdin.includes(`<items>\n${JSON.stringify(ITEMS, null, 1)}\n</items>`));
  const token = again.connectors.env.RUN_TOKEN;
  const done = await post(quick, token, { items: ITEMS });
  assert.equal(done.data.ok, true);
  assert.deepEqual(app.executed.slice(before), ITEMS.map((it) => ({ action: ACTION, args: it.arguments })));
  // Used up: the series again asks again.
  const twice = await post(quick, token, { items: ITEMS });
  assert.deepEqual([twice.data.needsApproval, twice.data.waits], [true, true]);
  await answer(quick, (await cardsOf(quick, bot))[0], { yes: false });
  quick.release(again);
});
