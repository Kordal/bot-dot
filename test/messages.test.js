// Bots messaging bots (lib/messages.js, bots.js sendBotMessage): who may message whom, starting the
// other bot or leaving a note, and every limit.
// Tests here count on work for a busy bot waiting its turn: one run of a bot at a time (ADR 062 lets three go at
// once, and at that limit the same holds).
process.env.BOT_DOT_RUNS_MAX = '1';
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor, sleep } = require('./helpers');
const { cleanText, MAX_CHARS, MAX_HOPS } = require('../lib/messages');
const { rpcClient } = require('./memory-helpers');

let srv, surfer, social, third;
before(async () => {
  srv = await startServer();
  social = await makeBot(srv, { name: 'Social Watch', emoji: '📣', mayMessage: [] });
  third = await makeBot(srv, { name: 'Mail Bot', emoji: '📬', mayMessage: [] });
  surfer = await makeBot(srv, { name: 'Web Surfer', emoji: '🏄', mayMessage: [social.id, third.id] });
});
after(() => { srv.unhold(); return srv.stop(); });

const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;

test('cleanText trims and caps a message', () => {
  assert.equal(cleanText('  hi\r\nthere  '), 'hi\nthere');
  assert.equal(cleanText('x'.repeat(MAX_CHARS + 50)).length, MAX_CHARS);
});

test('a bot only gets the tools when it has teammates', async () => {
  const { rec, run } = await heldRun(srv, surfer);
  assert.equal(rec.self.env.SELF_TEAM, '1');
  srv.release(rec);
  await srv.finished(run.id);
  const alone = await makeBot(srv, { name: 'Loner', emoji: '🙂', mayMessage: [] });
  const h = await heldRun(srv, alone);
  assert.equal(h.rec.self.env.SELF_TEAM, '0');
  srv.release(h.rec);
  await srv.finished(h.run.id);
});

test('a new bot may message every other bot, bots made later too, until the owner limits it', async () => {
  const open = await makeBot(srv, { name: 'Open Door', emoji: '🚪' });
  assert.equal(open.mayMessageAll, true);
  const later = await makeBot(srv, { name: 'Latecomer', emoji: '⏰', mayMessage: [] });
  const h = await heldRun(srv, open);
  assert.equal(h.rec.self.env.SELF_TEAM, '1');
  const mates = (await self(srv, h.token, 'teammates')).data.teammates.map((b) => b.id);
  for (const b of [surfer, social, third, later]) assert.ok(mates.includes(b.id), b.name);
  assert.equal((await self(srv, h.token, 'message', { to: later.id, message: 'hi', priority: false })).data.ok, true);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  // A list limits it; mayMessageAll opens it again.
  const limited = (await srv.api(`/bots/${open.id}`, { method: 'PUT', body: { mayMessage: [social.id] } })).data;
  assert.equal(limited.mayMessageAll, false);
  const h2 = await heldRun(srv, open);
  assert.match((await self(srv, h2.token, 'message', { to: later.id, message: 'hi', priority: false })).data.error, /may not message/);
  srv.release(h2.rec);
  await srv.finished(h2.run.id);
  assert.equal((await srv.api(`/bots/${open.id}`, { method: 'PUT', body: { mayMessageAll: true } })).data.mayMessageAll, true);
  for (const b of [open, later]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test('bots saved before "everyone" existed may message everyone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-test-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  const old = (id, mayMessage) => ({ id, name: id, emoji: '🤖', prompt: 'Do it.', jobs: [], mayMessage });
  fs.writeFileSync(path.join(dir, 'data', 'bots.json'), JSON.stringify([old('a', []), old('b', ['a'])]));
  const s2 = await startServer({ dir });
  try {
    const list = (await s2.api('/bots')).data;
    assert.deepEqual(list.map((b) => b.mayMessageAll), [true, true]);
  } finally { s2.stop(); }
});

test('refused: itself, a bot not in its list, an empty message, no run token', async () => {
  const { rec, run, token } = await heldRun(srv, surfer);
  assert.match((await self(srv, token, 'message', { to: surfer.id, message: 'hi', priority: true })).data.error, /That's you/);
  assert.match((await self(srv, token, 'message', { to: 'nobody', message: 'hi', priority: true })).data.error, /no bot/);
  assert.match((await self(srv, token, 'message', { to: social.id, message: '   ', priority: true })).data.error, /empty/);
  assert.equal((await self(srv, 'not-a-token', 'message', { to: social.id, message: 'hi', priority: true })).status, 403);
  srv.release(rec);
  await srv.finished(run.id);
  const h = await heldRun(srv, social);
  assert.match((await self(srv, h.token, 'message', { to: surfer.id, message: 'hi', priority: true })).data.error, /may not message/);
  srv.release(h.rec);
  await srv.finished(h.run.id);
});

test('priority starts the other bot, marked as from a bot; it may reply', async () => {
  const { rec, run, token } = await heldRun(srv, surfer);
  const r = await self(srv, token, 'message', { to: social.id, message: 'What did Tibo post today?', priority: true });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.delivered, 'started');
  const theirs = await srv.nextRun((x) => x.args.includes('📣 Social Watch'), 'Social Watch to start');
  assert.match(theirs.stdin, /What did Tibo post today\?/);
  assert.match(theirs.system + theirs.stdin, /another bot/);
  const started = (await runsOf(social))[0];
  assert.equal(started.trigger, 'bot');
  assert.equal(started.fromBot.id, surfer.id);
  assert.equal(started.readOutside, true);
  // The sender's run shows who it messaged.
  srv.release(rec);
  const mine = await srv.finished(run.id);
  assert.equal(mine.sentTo.id, social.id);
  // Social Watch may answer Web Surfer, though Web Surfer isn't in its list.
  const reply = await self(srv, theirs.self.env.RUN_TOKEN, 'message', { to: surfer.id, message: 'Nothing new.', priority: false });
  assert.equal(reply.data.ok, true);
  srv.release(theirs);
  await srv.finished(started.id);
  // The answer it waited for starts Web Surfer again (see awaits.test.js).
  const follow = await srv.nextRun((x) => x.args.includes('🏄 Web Surfer') && x.stdin.includes('Nothing new.'), 'the follow-up');
  srv.release(follow);
  await waitFor(async () => (await runsOf(surfer)).every((x) => x.status !== 'running'), { what: 'Web Surfer to finish' });
});

test('one run may message several teammates, as often as it needs', async () => {
  const { rec, run, token } = await heldRun(srv, surfer);
  for (let i = 0; i < 5; i++) assert.equal((await self(srv, token, 'message', { to: social.id, message: `note ${i}`, priority: false })).data.ok, true);
  assert.equal((await self(srv, token, 'message', { to: third.id, message: 'hi', priority: false })).data.ok, true);
  srv.release(rec);
  const done = await srv.finished(run.id);
  // The chat names every bot it messaged, each once.
  assert.deepEqual(done.sentToAll.map((t) => t.id), [social.id, third.id]);
  assert.equal(done.sentTo.id, third.id);
  // The notes woke them (#225): Social Watch read the first at once, the other four once it was free.
  await finishWoken(social, 'note 0');
  await finishWoken(social, 'note 4');
  await finishWoken(third, 'hi');
});

const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
// The run that notes woke, with `text` in its prompt: let it end.
async function finishWoken(bot, text) {
  const rec = await srv.nextRun((x) => isRunOf(bot)(x) && x.stdin.includes(text), `${bot.name} woken by "${text}"`);
  const run = await waitFor(async () => (await runsOf(bot)).find((x) => x.status === 'running'), { what: `${bot.name}'s run` }); // one at a time
  srv.release(rec);
  await srv.finished(run.id);
  return rec;
}

test('a note wakes an idle teammate at once: its run reads it, notifies nobody, and starts nothing more (#225)', async () => {
  fs.rmSync(path.join(srv.data, 'inbox'), { recursive: true, force: true });
  const before = (await runsOf(third)).length;
  const { rec, run, token } = await heldRun(srv, surfer);
  const r = await self(srv, token, 'message', { to: third.id, message: 'Prefer sources from the last 24 hours.', priority: false });
  assert.equal(r.data.delivered, 'inbox');
  assert.equal(r.data.full, undefined);
  const woke = await srv.nextRun((x) => isRunOf(third)(x) && x.stdin.includes('Prefer sources from the last 24 hours'), 'Mail Bot woken by the note');
  assert.match(woke.system, /started by the messages other bots of the owner's team left for you/);
  assert.doesNotMatch(woke.system + woke.stdin, /The owner has sent you a message/);
  const started = (await runsOf(third))[0];
  assert.equal(started.trigger, 'bot');
  assert.equal(started.fromBot, undefined);
  assert.equal(started.notificationAudience, 'internal', 'a note that wakes a bot notifies nobody');
  assert.equal(started.inbox.length, 1);
  assert.equal(started.inbox[0].fromId, surfer.id);
  assert.equal(started.hop, 1, 'it goes on in the exchange of the note');
  assert.deepEqual((await srv.api(`/bots/${third.id}/inbox`)).data, [], 'read notes no longer wait');
  // It may answer the bot that wrote, though that bot isn't in its list.
  assert.equal((await self(srv, woke.self.env.RUN_TOKEN, 'message', { to: surfer.id, message: 'Noted.', priority: false })).data.ok, true);
  srv.release(woke);
  await srv.finished(started.id);
  srv.release(rec);
  await srv.finished(run.id);
  await finishWoken(surfer, 'Noted.');
  await sleep(300);
  assert.equal((await runsOf(third)).length, before + 1, 'a note it read starts no other run');
  const again = await heldRun(srv, third, 'And now?');
  assert.doesNotMatch(again.rec.stdin, /Prefer sources/);
  srv.release(again.rec);
  await srv.finished(again.run.id);
});

test('a note to a busy bot waits beside no second run, and wakes it once it is free (#225)', async (t) => {
  fs.rmSync(path.join(srv.data, 'inbox'), { recursive: true, force: true });
  const busy = await heldRun(srv, third, 'Something long');
  const { rec, run } = await heldRun(srv, surfer);
  // The sender is told it starts once free, and that a request needing an answer goes with priority.
  const said = await rpcClient(t, 'self-mcp.js', rec.self.env).text('message_bot', { to: third.id, message: 'The VPN key changed.', priority: false });
  assert.match(said, /It is a note: 📬 Mail Bot starts as soon as it is free and reads it then, but nothing comes back to you\. A request that needs it to act and answer goes with priority: true/);
  srv.release(rec);
  await srv.finished(run.id);
  assert.equal((await runsOf(third)).filter((x) => x.status === 'running').length, 1, 'no second run beside the one at work');
  // The owner sees it waiting in that bot's chat, with who left it and when.
  const waiting = (await srv.api(`/bots/${third.id}/inbox`)).data;
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].fromId, surfer.id);
  assert.equal(waiting[0].color, surfer.color);
  assert.ok(Date.parse(waiting[0].at) <= Date.now());
  srv.release(busy.rec);
  await srv.finished(busy.run.id);
  await finishWoken(third, 'The VPN key changed.');
  assert.deepEqual((await srv.api(`/bots/${third.id}/inbox`)).data, []);
});

test("a run that starts first reads the note, and the wake starts nothing more (#225)", async () => {
  fs.rmSync(path.join(srv.data, 'inbox'), { recursive: true, force: true });
  const busy = await heldRun(srv, third, 'Something long');
  const { rec, run, token } = await heldRun(srv, surfer);
  await self(srv, token, 'message', { to: third.id, message: 'Use the new bucket.', priority: false });
  srv.release(rec);
  await srv.finished(run.id);
  // The owner's message waits too, and starts before the wake.
  const mine = await srv.api(`/bots/${third.id}/run`, { method: 'POST', body: { prompt: 'Then this.' } });
  assert.equal(mine.data.status, 'queued');
  const count = (await runsOf(third)).length;
  srv.release(busy.rec);
  await srv.finished(busy.run.id);
  const next = await srv.nextRun((x) => isRunOf(third)(x) && x.stdin.startsWith('Then this.'), "the owner's message");
  assert.match(next.stdin, /Use the new bucket/, 'it read the note');
  srv.release(next);
  await waitFor(async () => (await runsOf(third)).every((x) => x.status !== 'running'), { what: 'Mail Bot to finish' });
  await sleep(300);
  assert.equal((await runsOf(third)).length, count + 1, 'only the owner\'s message ran');
});

test('"Run now" under waiting notes starts the bot with them, or once it is free (#225)', async () => {
  fs.rmSync(path.join(srv.data, 'inbox'), { recursive: true, force: true });
  const runNow = () => srv.api(`/bots/${third.id}/inbox/run`, { method: 'POST' });
  assert.equal((await runNow()).status, 409, 'no note waits');
  assert.equal((await srv.api('/bots/nobody/inbox/run', { method: 'POST' })).status, 404);
  // Busy: it waits its turn (and the wake had queued it already).
  const busy = await heldRun(srv, third, 'Something long');
  const { rec, run, token } = await heldRun(srv, surfer);
  await self(srv, token, 'message', { to: third.id, message: 'Rotate the logs.', priority: false });
  srv.release(rec);
  await srv.finished(run.id);
  assert.deepEqual((await runNow()).data, { status: 'queued' });
  srv.release(busy.rec);
  await srv.finished(busy.run.id);
  await finishWoken(third, 'Rotate the logs.');
  assert.equal((await runsOf(third))[0].notificationAudience, 'owner', 'the wake that waited became the owner\'s');
  // Answers it collects for its own question are its follow-up's: "Run now" leaves them.
  const note = (more) => ({ id: 'n1', at: new Date().toISOString(), fromId: surfer.id, fromName: 'Web Surfer', text: 'Old news.', ...more });
  fs.mkdirSync(path.join(srv.data, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(srv.data, 'inbox', `${third.id}.json`), JSON.stringify([note({ answer: true })]));
  const answers = await runNow();
  assert.equal(answers.status, 409);
  assert.match(answers.data.error, /answers to its own question/);
  // A note left where nothing woke it (a botdot from before): "Run now" starts it.
  fs.writeFileSync(path.join(srv.data, 'inbox', `${third.id}.json`), JSON.stringify([note()]));
  assert.deepEqual((await runNow()).data, { status: 'started' });
  const woke = await finishWoken(third, 'Old news.');
  assert.ok(woke);
  const ran = (await runsOf(third))[0];
  assert.equal(ran.notificationAudience, 'owner', 'the owner asked for this one');
});

test('a chain of hand-offs stops after MAX_HOPS, a safety net against endless loops', async () => {
  // A → B → A → …: the hop after MAX_HOPS is refused. Each message back is the answer the other waits for,
  // so it starts once the sender's run ends.
  await srv.api(`/bots/${social.id}`, { method: 'PUT', body: { mayMessage: [surfer.id] } });
  const h = await heldRun(srv, surfer);
  let cur = { rec: h.rec, runId: h.run.id };
  let bot = social;
  for (let hop = 1; hop <= MAX_HOPS; hop++) {
    const r = await self(srv, cur.rec.self.env.RUN_TOKEN, 'message', { to: bot.id, message: `hop ${hop}.`, priority: true });
    assert.equal(r.data.ok, true, `hop ${hop}: ${r.data.error}`);
    // The sender finishes, so the next hand-off back to it starts it rather than queueing.
    srv.release(cur.rec);
    await srv.finished(cur.runId);
    const next = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(`hop ${hop}.`), `hop ${hop}`);
    const runId = (await runsOf(bot)).find((x) => x.status === 'running').id;
    cur = { rec: next, runId };
    bot = bot.id === social.id ? surfer : social;
  }
  const r = await self(srv, cur.rec.self.env.RUN_TOKEN, 'message', { to: bot.id, message: 'one more.', priority: true });
  assert.match(r.data.error, new RegExp(`already ${MAX_HOPS} messages long`));
  srv.release(cur.rec);
  await srv.finished(cur.runId);
  await srv.api(`/bots/${social.id}`, { method: 'PUT', body: { mayMessage: [] } });
});

