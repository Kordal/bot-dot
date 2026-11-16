// The owner steers a message that waits in a group into the run of the busy member that is going (ADR 253, docs/api.md
// "Steer in a group"): a press on "Steer" marks the member's turn of it, and the member's run reads it at its next tool call,
// through the hook botdot gives the run. Here the test calls what the hook calls, with the run's key, as each tool call of
// the run would. Against a real botdot server and the stand-in for Claude, whose runs are held and released.
// One run of a bot at a time: a message for a bot that is busy elsewhere waits in its queue (ADR 062 lets three go at once).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self, waitFor, feed, sleep } = require('./helpers');
const { shortName } = require('../public/mentions.js');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const send = (group, body) => srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body });
const steer = (group, id) => srv.api(`/group-chats/${group.id}/messages/${id}/steer`, { method: 'POST' });
const takeBack = (group, id) => srv.api(`/group-chats/${group.id}/messages/${id}`, { method: 'DELETE' });
const chatOf = async (group) => (await srv.api(`/group-chats/${group.id}/chat?limit=200`)).data;
const messageIn = async (group, id) => (await chatOf(group)).items.find((x) => x.type === 'message' && x.id === id);
const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const toolCall = async (token) => (await self(srv, token, 'steer')).data.hookSpecificOutput?.additionalContext ?? null;
// A group has two bots at least: a member that is never written to, and messages that mention the one under test.
const startGroup = async (name, bots) => {
  const other = await makeBot(srv, { name: `Bystander ${name}`, emoji: '🪑' });
  return (await srv.api('/group-chats', { method: 'POST', body: { name, members: [...bots, other].map((b) => b.id) } })).data;
};
const to = (bot, text) => `@${shortName(bot.name)} ${text}`;

test('the features name it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('group-steer'));
});

test('a message that waits behind the member\'s turn of an earlier message is read by that run at its next tool call, and starts no turn', async (t) => {
  const infra = await makeBot(srv, { name: 'Infra Admin', emoji: '🗄️' });
  const group = await startGroup('Qwotz Dev', [infra]);
  const f = await feed(srv);
  t.after(() => f.close());
  await f.wait('hello');
  srv.hold();
  const one = (await send(group, { text: to(infra, 'Set up the staging key') })).data;
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(infra)(x), 'the first turn of Infra Admin');
  const token = rec.self.env.RUN_TOKEN;
  const two = (await send(group, { text: to(infra, 'Do all of it in config, I want to see everything') })).data;
  assert.deepEqual([two.waitsFor, two.canTakeBack, two.steering], [[infra.id], true, undefined]);
  // Nothing was steered yet: a tool call reads nothing.
  assert.equal(await toolCall(token), null);

  const s = await steer(group, two.id);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.deepEqual([s.data.waitsFor, s.data.steering, s.data.canTakeBack], [[], [infra.id], true]);
  await f.wait('group_message', (d) => d.message.id === two.id && d.message.steering?.[0] === infra.id);
  assert.deepEqual((await messageIn(group, two.id)).steering, [infra.id]);
  // Pressed again: the same answer.
  assert.equal((await steer(group, two.id)).status, 200);

  // The next tool call of the run: the hook is answered with the message, in botdot's words, and the group's name.
  const read = await toolCall(token);
  assert.match(read, /The owner has sent you a message in the group chat "Qwotz Dev" while you work/);
  assert.ok(read.includes('Do all of it in config, I want to see everything'));
  assert.equal(await toolCall(token), null, 'read once');
  // It is a started message now: nothing waits, no Steer, no Take back, and its line is over.
  const now = await waitFor(async () => { const m = await messageIn(group, two.id); return m.canTakeBack === false && m.waitsFor.length === 0 ? m : null; }, { what: 'the steered message to be read' });
  assert.equal(now.steering, undefined);
  assert.deepEqual([(await steer(group, two.id)).status, (await takeBack(group, two.id)).status], [409, 409]);
  const runId = (await chatOf(group)).working[0].runId;
  const going = (await srv.api(`/runs/${runId}?events=0`)).data;
  assert.deepEqual(going.steered.map((x) => [x.id, x.text]), [[going.steered[0].id, to(infra, 'Do all of it in config, I want to see everything')]]);

  srv.unhold();
  srv.release(rec);
  await waitFor(async () => { const m = await messageIn(group, one.id); return m?.canTakeBack === false && (await chatOf(group)).working.length === 0 ? true : null; }, { what: 'the first turn to end' });
  await sleep(400);
  assert.equal(srv.runs().filter(isRunOf(infra)).length, 1, 'no turn of its own for the steered message');
  assert.equal((await messageIn(group, two.id)).canTakeBack, false);
});

test('a run that ends before it reads it leaves the message as any that waits: it starts as a turn of its own, once', async () => {
  const bot = await makeBot(srv, { name: 'Late Member', emoji: '🐢' });
  const group = await startGroup('Late group', [bot]);
  srv.hold();
  await send(group, { text: to(bot, 'A long task') });
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(bot)(x), 'the first turn');
  const two = (await send(group, { text: to(bot, 'Steered but never read') })).data;
  assert.equal((await steer(group, two.id)).status, 200);
  srv.unhold();
  srv.release(rec);
  await waitFor(async () => { const c = await chatOf(group); return c.items.filter((x) => x.type === 'reply').length === 2 && !c.working.length ? c : null; }, { what: 'both turns', timeout: 30_000 });
  const prompts = srv.runs().filter(isRunOf(bot)).map((x) => x.stdin.split('\n')[0]);
  assert.equal(prompts.length, 2);
  assert.ok(srv.runs().filter(isRunOf(bot))[1].stdin.includes('Steered but never read'));
  const m = await messageIn(group, two.id);
  assert.deepEqual([m.steering, m.waitsFor], [undefined, []]);
});

test('Take back after Steer, before the run read it: the text comes back and the run never sees it', async () => {
  const bot = await makeBot(srv, { name: 'Taker Member', emoji: '🫳' });
  const group = await startGroup('Taker group', [bot]);
  srv.hold();
  await send(group, { text: to(bot, 'Work') });
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(bot)(x), 'the first turn');
  const two = (await send(group, { text: to(bot, 'Never mind this') })).data;
  assert.equal((await steer(group, two.id)).status, 200);
  const back = await takeBack(group, two.id);
  assert.deepEqual([back.status, back.data.text], [200, to(bot, 'Never mind this')]);
  assert.equal(await toolCall(rec.self.env.RUN_TOKEN), null);
  assert.equal((await steer(group, two.id)).status, 404);
  srv.unhold();
  srv.release(rec);
  await waitFor(async () => (await chatOf(group)).working.length === 0 ? true : null, { what: 'the turn to end' });
  assert.equal(srv.runs().filter(isRunOf(bot)).length, 1);
});

test('a member that is busy in another chat, or not working, cannot take it: 409, and the message keeps waiting', async () => {
  const bot = await makeBot(srv, { name: 'Elsewhere Member', emoji: '🧳' });
  const group = await startGroup('Elsewhere group', [bot]);
  // Busy in its own chat: the group's turn waits in its queue.
  const h = await heldRun(srv, bot, 'Own chat work');
  const w = (await send(group, { text: to(bot, 'In the group') })).data;
  assert.deepEqual([w.waitsFor, w.canTakeBack], [[bot.id], true]);
  const s = await steer(group, w.id);
  assert.equal(s.status, 409);
  assert.match(s.data.error, /Elsewhere Member is working in another chat/);
  assert.deepEqual((await messageIn(group, w.id)).waitsFor, [bot.id]);
  // The Chief's tools may not steer the owner's message.
  assert.equal((await srv.asChief(`/group-chats/${group.id}/messages/${w.id}/steer`, { method: 'POST' })).status, 403);
  assert.equal((await steer(group, 'nope')).status, 404);
  assert.equal(await toolCall(h.token), null, 'its hook hands it no message of the group');
  srv.unhold();
  srv.release(h.rec);
  await waitFor(async () => { const c = await chatOf(group); return c.items.some((x) => x.type === 'reply') && !c.working.length ? true : null; }, { what: 'the group turn to run', timeout: 30_000 });
  // Started by itself: nothing to steer now.
  assert.equal((await steer(group, w.id)).status, 409);
});

test('a message whose line waits for the lines before it is steered to all its busy members or to none: no member answers two lines at once', async () => {
  const lead = await makeBot(srv, { name: 'Line Lead', emoji: '🥇' });
  const dev = await makeBot(srv, { name: 'Line Dev', emoji: '🥈' });
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Lines', members: [lead.id, dev.id] } })).data;
  srv.hold();
  await send(group, { text: `${to(lead, 'first')} ${to(dev, 'then you')}` });
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(lead)(x), 'the first turn of Line Lead');
  // The second message waits for Lead at work and for Dev, who is next on the first line and has no run to read it.
  const two = (await send(group, { text: `${to(lead, 'also')} ${to(dev, 'and you')}` })).data;
  assert.deepEqual(two.waitsFor.sort(), [dev.id, lead.id].sort());
  const s = await steer(group, two.id);
  assert.equal(s.status, 409, JSON.stringify(s.data));
  assert.match(s.data.error, /Line Dev is not working now/);
  // Nothing was given: the line still waits, and Lead's run reads nothing.
  const m = await messageIn(group, two.id);
  assert.deepEqual([m.waitsFor.sort(), m.steering, m.canTakeBack], [[dev.id, lead.id].sort(), undefined, true]);
  assert.equal(await toolCall(rec.self.env.RUN_TOKEN), null);
  assert.equal(srv.runs().filter(isRunOf(dev)).length, 0, 'Dev has no turn of the second message yet');
  srv.unhold();
  srv.release(rec);
});
