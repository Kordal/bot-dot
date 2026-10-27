// The owner's Reply on a run of a bot's chat (#627; docs/api.md "A reply to a run"): `replyTo` on the owner's message.
// Into that run while it goes and can read it (ADR 040), never sorted (ADR 106); after it ended, a run that continues
// it, handed it whole and recording `replyTo`. Against a real botdot server and the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('../lib/chat-history');
const { startServer, makeBot, heldRun, readData, self } = require('./helpers');

test('the note of a reply names the run it continues', () => {
  assert.equal(H.replyNote(null), '');
  assert.match(H.replyNote({ id: 'r1' }), /writes the message below as a reply to your run r1, which is in your chat above in full: it continues that task/);
  assert.match(H.replyNote({ id: 'r1' }, true), /wrote that message as a reply to your run r1/);
});

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const isRunOf = (bot) => (x) => !!x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`);
const send = (bot, prompt, more = {}) => srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt, ...more } });
const waitingIn = (bot) => (fs.existsSync(path.join(srv.data, 'queue.json')) ? readData(srv.data, 'queue.json').queues?.[bot.id] || [] : []);
const asks = () => fs.readdirSync(srv.out).filter((f) => /^follow-up-\d/.test(f));

test('the server says it takes a reply', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('reply-to'));
});

test('a reply to a run at work is steered into it without asking the sorter, and its next tool call reads it', async () => {
  const bot = await makeBot(srv, { name: 'Media Watcher', emoji: '🎧' });
  const long = await heldRun(srv, bot, 'Sum up the posts');
  fs.writeFileSync(path.join(srv.out, 'follow-up.txt'), '{"decision":"new"}'); // the sorter would start a run
  const before = asks().length;
  const sent = await send(bot, 'only the last week', { replyTo: long.run.id, key: 'k-reply-1' });
  assert.deepEqual([sent.status, sent.data.status, sent.data.steering], [201, 'queued', long.run.id]);
  assert.equal(asks().length, before, 'not sorted');
  assert.deepEqual(waitingIn(bot).map((x) => [x.text, x.steering, x.replyTo]), [['only the last week', long.run.id, long.run.id]]);
  const read = (await self(srv, long.token, 'steer')).data.hookSpecificOutput?.additionalContext;
  assert.match(read, /picked Reply on this run/);
  assert.match(read, /<owner-message>\nonly the last week\n<\/owner-message>/);
  srv.unhold();
  srv.release(long.rec);
  const done = await srv.finished(long.run.id);
  assert.deepEqual(done.steered.map((x) => x.text), ['only the last week'], 'a steered bubble in its block');
});

test('a reply to a run that ended starts a run that continues it, handed it whole, and records replyTo', async () => {
  const bot = await makeBot(srv, { name: 'Day Planner', emoji: '📅' });
  srv.hold();
  const first = await send(bot, 'Plan my Thursday');
  let rec = await srv.nextRun(isRunOf(bot), 'the first run');
  srv.reply('Thursday: gym at 7, standup at 10.');
  srv.release(rec);
  await srv.finished(first.data.id);
  const later = await send(bot, 'Something else');
  rec = await srv.nextRun(isRunOf(bot), 'a later run');
  srv.release(rec);
  await srv.finished(later.data.id);

  const sent = await send(bot, 'move the gym to 8', { replyTo: first.data.id });
  assert.deepEqual([sent.status, sent.data.status, sent.data.replyTo], [201, 'running', first.data.id]);
  rec = await srv.nextRun(isRunOf(bot), 'the continuation');
  assert.ok(rec.system.includes(`as a reply to your run ${first.data.id}, which is in your chat above in full`));
  assert.ok(rec.system.includes('Thursday: gym at 7, standup at 10.'), 'the replied run whole');
  srv.unhold();
  srv.release(rec);
  const done = await srv.finished(sent.data.id);
  assert.equal(done.replyTo, first.data.id);
  const listed = (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.id === sent.data.id);
  assert.equal(listed.replyTo, first.data.id, 'the chat groups it in the block of the run it continues');

  // A reply to the continuation: its run is handed the chat, each exchange naming the run it replied to.
  srv.hold();
  const again = await send(bot, 'and the standup to 11', { replyTo: sent.data.id });
  rec = await srv.nextRun(isRunOf(bot), 'a reply to the continuation');
  assert.ok(rec.system.includes(`(a reply to run ${first.data.id})`));
  srv.unhold();
  srv.release(rec);
  assert.equal((await srv.finished(again.data.id)).replyTo, sent.data.id);
});

test('a run that is not that bot\'s, or none, is refused and starts nothing', async () => {
  const a = await makeBot(srv, { name: 'Coder', emoji: '👩‍💻' });
  const b = await makeBot(srv, { name: 'Infra Admin', emoji: '🛠️' });
  srv.hold();
  const theirs = await send(b, 'Check the disks');
  const rec = await srv.nextRun(isRunOf(b), 'the other bot\'s run');
  srv.unhold();
  srv.release(rec);
  await srv.finished(theirs.data.id);
  const runs = async () => (await srv.api(`/runs?botId=${a.id}`)).data.length;
  const was = await runs();
  for (const replyTo of [theirs.data.id, 'nope-123', '../x']) {
    const sent = await send(a, 'go on', { replyTo });
    assert.equal(sent.status, 400, replyTo);
    assert.match(sent.data.error, /not a task of Coder's/);
  }
  assert.equal(await runs(), was);
});

test('a reply steered into a run that ends before reading it starts as that run\'s continuation', async () => {
  const bot = await makeBot(srv, { name: 'Quotz Manager', emoji: '📈' });
  const long = await heldRun(srv, bot, 'Write the status');
  const sent = await send(bot, 'add the totals', { replyTo: long.run.id });
  assert.equal(sent.data.steering, long.run.id);
  srv.release(long.rec);
  await srv.finished(long.run.id);
  const rec = await srv.nextRun(isRunOf(bot), 'the reply as its own run');
  assert.ok(rec.system.includes(`as a reply to your run ${long.run.id}`));
  srv.unhold();
  srv.release(rec);
  assert.equal((await srv.finished(sent.data.id)).replyTo, long.run.id);
});
