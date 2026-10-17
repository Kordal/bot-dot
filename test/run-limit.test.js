// A bot's run and a Chief's turn that go on for 60 minutes are ended (BUSY-003, ADR 012): the run is a failed run
// with `endedBy: "limit"`, the reply has the same sentence, and what waits behind either starts. The limit is one
// constant on the server; these servers have it at a second or two (BOT_DOT_RUN_LIMIT_MS). It counts from the
// run's start, the time the run waits for the owner included: a run that is ended while it waits for an OK keeps
// its card, and the yes starts the bot again.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, feed, waitFor, fakeConnectedApp, connectorEnv } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const LIMIT = 'I stopped after 60 minutes: this took too long. Send it again, or break it into smaller pieces.';
const SHORT_MS = 1200;
const LONGER_MS = 2500; // room to make a card before it ends

let app; let srv; let slow; let f;
before(async () => {
  app = await fakeConnectedApp();
  [srv, slow] = await Promise.all([
    startServer({ env: { BOT_DOT_RUN_LIMIT_MS: String(SHORT_MS) } }),
    startServer({ env: { ...app.env, BOT_DOT_RUN_LIMIT_MS: String(LONGER_MS) } }),
  ]);
  await app.connect(slow);
  f = feed(srv);
  await f.wait('hello');
});
after(async () => { f?.close(); await Promise.all([srv.stop(), slow.stop()]); app.close(); });

const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;

test("a bot's run that goes on past the limit is ended with endedBy limit, and the owner's message that waited starts", async () => {
  const bot = await makeBot(srv, { name: 'Goes On', emoji: '🐢' });
  const first = await heldRun(srv, bot, 'The endless one');
  const waiting = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'And this' } })).data;
  assert.equal(waiting.status, 'queued');
  const ended = await srv.finished(first.run.id);
  assert.deepEqual([ended.status, ended.endedBy, ended.problem, ended.error], ['error', 'limit', LIMIT, LIMIT]);
  assert.ok(Date.parse(ended.endedAt) - Date.parse(ended.startedAt) >= SHORT_MS - 50, 'not before the limit');
  const listed = (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.id === first.run.id);
  const event = (await f.wait('run_finished', (d) => d.id === first.run.id)).data;
  assert.deepEqual([listed.endedBy, listed.problem, event.status, event.endedBy, event.problem], ['limit', LIMIT, 'error', 'limit', LIMIT]);
  // What waited behind it starts. (How it ends is not asked: it has the same short limit.)
  srv.unhold();
  await srv.nextRun((x) => isRunOf(bot)(x) && x.stdin.startsWith('And this'), 'the waiting message to start');
  assert.equal((await srv.finished(waiting.id)).prompt, 'And this');
});

test("a Chief's turn that goes on past the limit ends with the limit's sentence, and the owner's message that waited starts", async () => {
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Think about everything' } });
  await srv.nextRun((x) => !!x.botdot && x.stdin.includes('Think about everything'), 'the Chief turn');
  const kept = (await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'And then this' } })).data;
  assert.equal(kept.queued.length, 1);
  const reply = (await f.wait('chief_reply', (d) => d.chatId === chat.id)).data;
  assert.deepEqual([reply.status, reply.error], ['error', LIMIT]);
  srv.unhold();
  await srv.nextRun((x) => !!x.botdot && x.stdin.includes('And then this'), "the waiting message's turn");
  const now = await waitFor(async () => { const c = await chatOf(chat.id); return !c.busy && !c.messages.some((m) => m.pending) ? c : null; }, { what: 'the chat to be quiet' });
  assert.deepEqual(now.messages.slice(0, 3).map((m) => [m.role, m.error || m.text]), [['user', 'Think about everything'], ['chief', LIMIT], ['user', 'And then this']]);
  assert.deepEqual([now.messages.length, now.messages[3].role], [4, 'chief'], "the waiting message's own reply (how it ends is not asked: it has the same short limit)");
  assert.equal('stopped' in now.messages[1], false, 'the limit ends the turn alone');
});

test('a run the Chief started that the limit ended is passed on to the chat that started it: the Chief is told it failed, with the sentence', async () => {
  const bot = await makeBot(srv, { name: 'Too Long', emoji: '🦥' });
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  const run = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Take your time' }, headers: { 'X-Chief-Chat': chat.id } })).data;
  const ended = (await f.wait('run_finished', (d) => d.id === run.id)).data;
  assert.deepEqual([ended.status, ended.endedBy, ended.passedOn], ['error', 'limit', true]);
  const turn = await srv.nextRun((x) => !!x.botdot && /^botdot writes this, not the user/m.test(x.stdin), "the Chief's turn");
  assert.equal(turn.botdot.env.CHIEF_CHAT_ID, chat.id);
  assert.match(turn.stdin, new RegExp(`has ended its run ${run.id}\\.\\nHow it ended: it failed\\.`));
  assert.ok(turn.stdin.includes(`<problem>\n${LIMIT}\n</problem>`));
  srv.unhold();
  await waitFor(async () => !(await chatOf(chat.id)).busy, { what: 'the turn to end' });
});

test('the limit counts the time a run waits for the owner: ended while it waits for an OK, its card stays and the yes starts the bot again', async (t) => {
  const bot = await makeBot(slow, { name: 'Waits For OK', emoji: '✉️', connectors: ['gmail'] });
  const r = await heldRun(slow, bot, 'Send Anna the mail');
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(slow, r.token));
  const call = tools.call('connector_run', { app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: { recipient_email: 'anna@example.com', subject: 'Late', body: 'I will be late.' } }).catch(() => null);
  const cards = async () => (await slow.api('/asks')).data.filter((a) => a.botId === bot.id);
  const held = await waitFor(async () => (await cards())[0], { what: 'the card of the action' });
  assert.equal(held.held, true);
  assert.equal((await slow.api(`/runs/${r.run.id}?events=0`)).data.waitingFor, 'ok');
  // Nobody answers: the limit ends the run, long before the ten minutes of the wait are over.
  const ended = await slow.finished(r.run.id);
  assert.deepEqual([ended.status, ended.endedBy, ended.problem], ['error', 'limit', LIMIT]);
  await call;
  const [card] = await cards();
  assert.deepEqual([card.id, card.held, typeof card.stoppedAt], [held.id, false, 'string']);
  // The late yes starts the bot again on that work, as after any run that failed (ADR 009, ADR 010).
  slow.unhold();
  assert.deepEqual((await slow.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).data.ok, true);
  const next = await waitFor(async () => (await slow.api(`/runs?botId=${bot.id}`)).data.find((x) => x.continues === r.run.id), { what: 'the run that carries on' });
  await slow.finished(next.id);
});
