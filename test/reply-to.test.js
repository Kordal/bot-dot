// A reply to a run (#627; docs/api.md "A reply to a run"): the owner picked Reply on a run's block. To a run at work
// the message waits steered into it, with no sorting (ADR 106); to a finished run a new run carries it on, records
// `replyTo` and is handed that run in full. A run of another bot, or none, is 404. Against a real botdot server and
// the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, readData } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const isRunOf = (bot) => (x) => !!x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`);
const send = (bot, prompt, more = {}) => srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt, ...more } });
const waitingIn = (bot) => (fs.existsSync(path.join(srv.data, 'queue.json')) ? readData(srv.data, 'queue.json').queues?.[bot.id] || [] : []);
const asks = () => fs.readdirSync(srv.out).filter((f) => /^follow-up-\d/.test(f)).length;

test('the server says it takes a reply to a run', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('reply-to'));
});

test('a reply to a run at work waits steered into it, and nothing is sorted', async () => {
  const bot = await makeBot(srv, { name: 'Media Watcher', emoji: '🎧' });
  const long = await heldRun(srv, bot, 'Read the posts');
  fs.writeFileSync(path.join(srv.out, 'follow-up.txt'), '{"decision":"new"}');
  const sorted = asks();
  const sent = await send(bot, 'only the last week', { replyTo: long.run.id, key: 'k-reply-1' });
  assert.deepEqual([sent.status, sent.data.status, sent.data.steering], [201, 'queued', long.run.id]);
  assert.equal(asks(), sorted, 'not sorted: the owner said where it goes');
  assert.deepEqual(waitingIn(bot).map((x) => [x.text, x.steering]), [['only the last week', long.run.id]]);
  const again = await send(bot, 'only the last week', { replyTo: long.run.id, key: 'k-reply-1' });
  assert.deepEqual([again.status, again.data.again], [200, true], 'sent again with its key: the same message');
  srv.unhold();
  srv.release(long.rec);
  await srv.finished(long.run.id);
});

test('a reply to a finished run starts a run that carries it on, handed that run whole', async () => {
  const bot = await makeBot(srv, { name: 'Infra Admin', emoji: '🛠️' });
  const first = await send(bot, 'Check the backup disk');
  const rec1 = await srv.nextRun(isRunOf(bot), 'the first run');
  srv.reply('The disk is 80% full.');
  srv.release(rec1);
  await srv.finished(first.data.id);

  const sent = await send(bot, 'clean the old snapshots', { replyTo: first.data.id });
  assert.deepEqual([sent.status, sent.data.status, sent.data.replyTo], [201, 'running', first.data.id]);
  const rec = await srv.nextRun(isRunOf(bot), 'the reply');
  const told = rec.system;
  assert.match(told, new RegExp(`a reply to your run ${first.data.id}`));
  assert.match(told, /The disk is 80% full\./, 'the run it replies to is in its chat');
  srv.release(rec);
  const done = await srv.finished(sent.data.id);
  assert.equal(done.replyTo, first.data.id, 'on its record');
});

test('a reply to no run of this bot is refused', async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '👩‍💻' });
  const other = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
  const theirs = await send(other, 'Write a haiku');
  const rec = await srv.nextRun(isRunOf(other), "the other bot's run");
  srv.release(rec);
  await srv.finished(theirs.data.id);
  for (const replyTo of [theirs.data.id, 'nope', '../x']) {
    const r = await send(bot, 'hi', { replyTo });
    assert.equal(r.status, 404, replyTo);
  }
});
