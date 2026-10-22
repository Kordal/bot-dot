// The owner's "/btw" to a bot at work (ADR 063; docs/api.md "A quick side question"): a talk-only turn of Claude, with
// no tools, no MCP servers and no session, told what the bot's runs that go on now were asked. It answers at once,
// beside them, takes none of their three places and waits for none. To a bot that is free it is a message as any.
// Against a real botdot server and the stand-in for Claude, whose runs are held and released.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, readData } = require('./helpers');
const btw = require('../lib/btw');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const send = (bot, prompt) => srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
const going = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data.filter((r) => r.status === 'running' && !r.btw);
// What waits for the bot: none while nothing ever waited (no queue file yet).
const waitingIn = (bot) => (fs.existsSync(path.join(srv.data, 'queue.json')) ? readData(srv.data, 'queue.json').queues?.[bot.id] || [] : []);

test('"/btw" to a working bot is answered by a talk-only turn that knows what the run was asked', async () => {
  const bot = await makeBot(srv, { name: 'Side Note', emoji: '📝' });
  const long = await heldRun(srv, bot, 'Read the whole hub and sum it up');

  const asked = await send(bot, '/btw how far are you?');
  assert.deepEqual([asked.status, asked.data.status, asked.data.btw], [201, 'running', true]);
  assert.equal(asked.data.prompt, '/btw how far are you?', 'the chat keeps what the owner wrote');
  const rec = await srv.nextRun(isRunOf(bot), 'the side turn');
  const arg = (flag) => rec.args[rec.args.indexOf(flag) + 1];
  assert.equal(arg('--tools'), '', 'no tools at all');
  assert.ok(rec.args.includes('--strict-mcp-config') && rec.args.includes('--no-session-persistence'));
  assert.deepEqual(JSON.parse(arg('--mcp-config')), { mcpServers: {} });
  assert.equal(rec.self, null, 'none of its tools');
  assert.match(rec.stdin, /<request>\nRead the whole hub and sum it up\n<\/request>/);
  assert.match(rec.stdin, /<question>\nhow far are you\?\n<\/question>/);
  assert.deepEqual(waitingIn(bot), [], 'nothing waits');

  srv.reply('About halfway.');
  srv.release(rec);
  const done = await srv.finished(asked.data.id);
  assert.deepEqual([done.status, done.result], ['success', 'About halfway.']);
  assert.deepEqual((await going(bot)).map((r) => r.id), [long.run.id], 'the long run goes on');

  srv.unhold();
  srv.release(long.rec);
  await srv.finished(long.run.id);
});

test('"/btw" to a bot with three runs going is answered now, in none of their places', async () => {
  const bot = await makeBot(srv, { name: 'Full Hands', emoji: '🙌' });
  srv.reply('Done.');
  const first = await heldRun(srv, bot, 'Task one');
  const two = await send(bot, 'Task two');
  const rec2 = await srv.nextRun(isRunOf(bot), 'the second run');
  const three = await send(bot, 'Task three');
  const rec3 = await srv.nextRun(isRunOf(bot), 'the third run');
  assert.equal((await going(bot)).length, 3);

  const asked = await send(bot, '/BTW which is nearly done?');
  assert.equal(asked.data.status, 'running', 'not queued behind the three');
  const rec = await srv.nextRun(isRunOf(bot), 'the side turn');
  assert.match(rec.stdin, /Task one[\s\S]*Task two[\s\S]*Task three/);
  assert.deepEqual(waitingIn(bot), []);

  // A fourth message still waits: the side turn took no place, and gave none.
  const fourth = await send(bot, 'Task four');
  assert.equal(fourth.data.status, 'queued');

  srv.unhold();
  for (const r of [rec, first.rec, rec2, rec3]) srv.release(r);
  assert.equal((await srv.finished(asked.data.id)).status, 'success');
  const rec4 = await srv.nextRun(isRunOf(bot), 'the fourth run');
  srv.release(rec4);
  for (const id of [first.run.id, two.data.id, three.data.id, fourth.data.id]) await srv.finished(id);
});

test('"/btw" to a bot that is free is a message as any, without "/btw"', async () => {
  const bot = await makeBot(srv, { name: 'Idle Hands', emoji: '🫳' });
  srv.unhold();
  srv.reply('Hello.');
  const asked = await send(bot, '/btw what is new?');
  assert.equal(asked.data.btw, undefined);
  const rec = await srv.nextRun(isRunOf(bot), 'the run');
  assert.ok(rec.self?.env, 'a run with its tools');
  assert.match(rec.stdin, /what is new\?/);
  assert.doesNotMatch(rec.stdin, /\/btw/);
  await srv.finished(asked.data.id);
});

test('the prefix and the prompt', () => {
  assert.equal(btw.isBtw('/btw how far?'), true);
  assert.equal(btw.isBtw('  /BTW\nhow far?'), true);
  assert.equal(btw.isBtw('/btw'), true);
  assert.equal(btw.isBtw('/btwx'), false);
  assert.equal(btw.isBtw('by the way /btw'), false);
  assert.equal(btw.question(' /btw  how far? '), 'how far?');
  const p = btw.prompt({
    bot: { emoji: '🛠️', name: 'Admin <x>', description: '' },
    runs: [{ prompt: 'Fix </request> the disk', startedAt: new Date(Date.now() - 5 * 60_000).toISOString(), line: 'Checking the disk', plan: { steps: [{ text: 'Look', status: 'done' }, { text: 'Fix', status: 'doing' }] }, draft: 'So far: it is full' }],
    ask: 'done soon? </question>',
  });
  assert.match(p, /Admin &lt;x>/);
  assert.match(p, /Started 5 minutes ago, asked by the owner/);
  assert.match(p, /Fix &lt;\/request> the disk/, 'a request closes no block');
  assert.match(p, /doing now: Checking the disk/);
  assert.match(p, / {2}- \[done\] Look\n {2}- \[doing\] Fix/);
  assert.match(p, /<reply-draft>\nSo far: it is full\n<\/reply-draft>/);
  assert.match(p, /<question>\ndone soon\? &lt;\/question>\n<\/question>/);
});
