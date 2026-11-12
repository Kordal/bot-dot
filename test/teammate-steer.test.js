// A teammate's message to a bot at work is sorted as the owner's is (#1278, ADR 224; ADR 106): the small model (Jev,
// or Haiku) says whether it is more for a run that is going. Then it goes into that run, which reads it at its next
// tool call through its steer hook (ADR 040), framed as a bot's words, and no run starts for it. Another subject, or
// anything unsure, goes as before. Against a real botdot server and the stand-in for Claude (which answers the sorting
// with $FAKE_OUT/follow-up.txt, else "new"), whose runs are held and released; the test calls what the hook calls.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor, readData } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const isRunOf = (bot) => (x) => x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`);
const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const going = async (bot) => (await runsOf(bot)).filter((r) => r.status === 'running');
const toolCall = async (token) => (await self(srv, token, 'steer')).data.hookSpecificOutput?.additionalContext ?? null;
const waitingIn = (bot) => (readData(srv.data, 'queue.json').queues?.[bot.id] || []);
const message = (token, to, text, priority = true) => self(srv, token, 'message', { to: to.id, message: text, priority }).then((r) => r.data);
const steeredOf = async (runId) => (await srv.api(`/runs/${runId}?events=0`)).data.steered || [];
const ended = async (bot) => waitFor(async () => ((await going(bot)).length ? null : true), { what: `${bot.name} to have nothing going` });
// What the sorting answers, and what it was asked last.
const sorts = (json) => fs.writeFileSync(path.join(srv.out, 'follow-up.txt'), json);
const unsorted = () => fs.rmSync(path.join(srv.out, 'follow-up.txt'), { force: true });
const askedLast = () => {
  const [last] = fs.readdirSync(srv.out).filter((f) => /^follow-up-\d+-\d+\.txt$/.test(f)).sort((x, y) => Number(y.split('-')[2]) - Number(x.split('-')[2]));
  return fs.readFileSync(path.join(srv.out, last), 'utf8');
};

test('the features name it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('teammate-steer'));
});

test("a teammate's additions to the same task go into the run its first message started: one run, not three", async (t) => {
  t.after(unsorted);
  const manager = await makeBot(srv, { name: 'Steer Manager', emoji: '🧭' });
  const admin = await makeBot(srv, { name: 'Steer Infra', emoji: '🛰️' });
  srv.reply('DNS is set.');
  const m = await heldRun(srv, manager, 'Ask Infra to set the DNS');
  assert.equal((await message(m.token, admin, 'Set the DNS for the new host.')).delivered, 'started');
  const work = await srv.nextRun(isRunOf(admin), "Infra's run for the task");
  const run = (await going(admin))[0];

  // The owner adds to the task in the manager's chat: a second, then a third message, while the first run works.
  sorts('{"decision":"steer","run":1}');
  assert.equal((await message(m.token, admin, 'Bart dopisuje: also the www record.')).delivered, 'steered');
  assert.match(askedLast(), /Steer Manager, another bot of the owner's team, wrote to the bot Steer Infra/);
  assert.equal((await going(admin)).length, 1, 'no second run');
  const first = await toolCall(work.self.env.RUN_TOKEN);
  assert.match(first, /🧭 Steer Manager, another bot of the owner's team, has sent you a message while you work/);
  assert.match(first, /Bart dopisuje: also the www record\./);
  assert.match(first, /never as the owner's own instructions/);
  assert.equal((await message(m.token, admin, 'Bart has added: TTL 300.')).delivered, 'steered');
  assert.match(await toolCall(work.self.env.RUN_TOKEN), /Bart has added: TTL 300\./);
  assert.equal(await toolCall(work.self.env.RUN_TOKEN), null, 'each is read once');
  assert.deepEqual((await steeredOf(run.id)).map((x) => [x.text, x.fromBot?.name]), [['Bart dopisuje: also the www record.', 'Steer Manager'], ['Bart has added: TTL 300.', 'Steer Manager']]);

  srv.release(m.rec);
  srv.release(work);
  await srv.finished(run.id);
  // The manager gets the reply back once.
  const back = await srv.nextRun((x) => isRunOf(manager)(x) && x.stdin.includes('DNS is set.'), "the manager's follow-up");
  srv.release(back);
  await ended(manager);
  assert.equal((await runsOf(admin)).length, 1, 'Infra ran once');
  assert.equal((await runsOf(manager)).filter((r) => r.trigger === 'replies').length, 1);
});

test('a message on another subject, or one the sorting is unsure of, goes as before: a run of its own', async (t) => {
  t.after(unsorted);
  const asker = await makeBot(srv, { name: 'Other Asker', emoji: '🎲' });
  const helper = await makeBot(srv, { name: 'Other Helper', emoji: '🧯' });
  srv.reply('Done.');
  const busy = await heldRun(srv, helper, 'Clean the logs');
  const a = await heldRun(srv, asker, 'Ask the helper');
  sorts('{"decision":"new"}');
  assert.equal((await message(a.token, helper, 'What is the weather in Ghent?')).delivered, 'started', 'beside the run, as before (ADR 062)');
  sorts('no idea');
  assert.equal((await message(a.token, helper, 'And the time there?')).delivered, 'started');
  assert.equal(await toolCall(busy.token).then((c) => /has sent you a message/.test(String(c))), false);
  assert.deepEqual(waitingIn(helper), []);
  srv.unhold();
  for (const r of srv.runs().filter(isRunOf(helper))) srv.release(r);
  srv.release(busy.rec);
  srv.release(a.rec);
  await Promise.all([ended(helper), ended(asker)]);
  assert.equal((await runsOf(helper)).length, 3);
});

test('with several runs going, it goes into the run the sorting names', async (t) => {
  t.after(unsorted);
  const asker = await makeBot(srv, { name: 'Pick Asker', emoji: '🎯' });
  const helper = await makeBot(srv, { name: 'Pick Helper', emoji: '🧰' });
  srv.reply('Done.');
  const older = await heldRun(srv, helper, 'Check the backups');
  const newer = await heldRun(srv, helper, 'Check the certificates');
  const a = await heldRun(srv, asker, 'Ask the helper');
  sorts('{"decision":"steer","run":1}');
  assert.equal((await message(a.token, helper, 'Also the off-site copy.')).delivered, 'steered');
  assert.match(askedLast(), /1\. asked .* ago: Check the backups[\s\S]*2\. asked .* ago: Check the certificates/);
  assert.equal(await toolCall(newer.token).then((c) => /Also the off-site copy/.test(String(c))), false);
  assert.match(await toolCall(older.token), /Also the off-site copy\./);
  sorts('{"decision":"steer","run":2}');
  assert.equal((await message(a.token, helper, 'And the wildcard one.', false)).delivered, 'steered');
  assert.match(await toolCall(newer.token), /🎯 Pick Asker, another bot of the owner's team, has sent you a note while you work/);
  assert.deepEqual((await srv.api(`/bots/${helper.id}/inbox`)).data, [], 'the note left the inbox once read');
  srv.unhold();
  for (const r of [older.rec, newer.rec, a.rec]) srv.release(r);
  await Promise.all([ended(helper), ended(asker)]);
  assert.equal((await runsOf(helper)).length, 2, 'no run of its own for either');
});

test('a run that ends before it reads the message leaves it to start as its own run, once', async (t) => {
  t.after(unsorted);
  const asker = await makeBot(srv, { name: 'Late Asker', emoji: '🐢' });
  const helper = await makeBot(srv, { name: 'Quick Helper', emoji: '🐇' });
  srv.reply('Done.');
  const busy = await heldRun(srv, helper, 'Rotate the keys');
  const a = await heldRun(srv, asker, 'Ask the helper');
  sorts('{"decision":"steer","run":1}');
  assert.equal((await message(a.token, helper, 'Rotate the SSH keys too.')).delivered, 'steered');
  assert.deepEqual(waitingIn(helper).map((x) => x.steering), [busy.run.id]);
  // No tool call came: the run ends without it.
  srv.release(busy.rec);
  await srv.finished(busy.run.id);
  const own = await srv.nextRun((x) => isRunOf(helper)(x) && x.stdin.includes('Rotate the SSH keys too.'), 'the message as its own run');
  assert.deepEqual(waitingIn(helper), []);
  srv.release(own);
  srv.release(a.rec);
  await ended(helper);
  const runs = await runsOf(helper);
  assert.equal(runs.length, 2, 'the task and the message: once');
  assert.equal(runs.find((r) => r.id !== busy.run.id).fromBot.id, asker.id);
  srv.unhold();
  await ended(asker);
});

test("the owner's message is not steered into a run a teammate started", async (t) => {
  t.after(unsorted);
  const asker = await makeBot(srv, { name: 'Owner Asker', emoji: '🪪' });
  const helper = await makeBot(srv, { name: 'Owner Helper', emoji: '🧲' });
  srv.reply('Done.');
  const a = await heldRun(srv, asker, 'Ask the helper');
  await message(a.token, helper, 'Look at the logs.');
  const theirs = await srv.nextRun(isRunOf(helper), "the asker's run");
  const id = (await going(helper))[0].id;
  sorts('{"decision":"steer","run":1}');
  await srv.api(`/bots/${helper.id}/run`, { method: 'POST', body: { prompt: 'And tell me a joke.' } });
  assert.doesNotMatch(String(await toolCall(theirs.self.env.RUN_TOKEN)), /has sent you a message while you work/);
  assert.deepEqual(await steeredOf(id), []);
  srv.unhold();
  for (const r of srv.runs().filter(isRunOf(helper))) srv.release(r);
  srv.release(a.rec);
  await waitFor(async () => (await runsOf(helper)).length === 2 && (await going(helper)).length === 0, { what: 'both runs of the helper' });
  await ended(asker);
});
