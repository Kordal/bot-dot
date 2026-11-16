// Steer on a message of a group whose turn waits in the member's queue (ADR 253): the member's earlier turn went on in the
// background (#509, so the message does not wait for its line) and its run is still at work, so the new turn waits for the
// bot to be free. A press marks that turn, and the run reads the message at its next tool call. Against a real botdot server
// and the stand-in for Claude. One run of a bot at a time, so that the turn waits.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, self, waitFor, sleep } = require('./helpers');
const { shortName } = require('../public/mentions.js');

let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_GROUP_TURN_MS: '500' } }); });
after(() => { srv.unhold(); return srv.stop(); });

const send = (group, body) => srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body });
const steer = (group, id) => srv.api(`/group-chats/${group.id}/messages/${id}/steer`, { method: 'POST' });
const chatOf = async (group) => (await srv.api(`/group-chats/${group.id}/chat?limit=200`)).data;
const messageIn = async (group, id) => (await chatOf(group)).items.find((x) => x.type === 'message' && x.id === id);
const kept = (group) => JSON.parse(fs.readFileSync(path.join(srv.data, 'group-messages', `${group.id}.json`), 'utf8'));
const waitingIn = (bot) => (JSON.parse(fs.readFileSync(path.join(srv.data, 'queue.json'), 'utf8')).queues?.[bot.id] || []);

test('a turn that waits in the queue is marked, read by the run that is going, and taken out of the queue; the line is over', async () => {
  const bot = await makeBot(srv, { name: 'Queued Member', emoji: '⏳' });
  const other = await makeBot(srv, { name: 'Quiet Member', emoji: '🤫' });
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Queued group', members: [bot.id, other.id] } })).data;
  srv.hold();
  const one = (await send(group, { text: `@${shortName(bot.name)} a long job` })).data;
  const rec = await srv.nextRun((x) => x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`), 'the first turn');
  // After its time the turn goes on in the background: the next message does not wait for its line, but for the bot.
  await waitFor(async () => (kept(group).find((m) => m.id === one.id).turns[0].background ? true : null), { what: 'the turn in the background' });
  const two = (await send(group, { text: `@${shortName(bot.name)} and also this` })).data;
  assert.deepEqual([two.waitsFor, two.canTakeBack], [[bot.id], true]);
  assert.equal(waitingIn(bot).length, 1, 'its turn waits in the queue');

  const s = await steer(group, two.id);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.deepEqual([s.data.waitsFor, s.data.steering], [[], [bot.id]]);
  assert.equal(waitingIn(bot)[0].steering, (await chatOf(group)).working[0].runId, 'marked for the run that is going');

  const read = (await self(srv, rec.self.env.RUN_TOKEN, 'steer')).data.hookSpecificOutput?.additionalContext;
  assert.match(read, /and also this/);
  assert.deepEqual(waitingIn(bot), [], 'it left the queue');
  const m = await waitFor(async () => { const x = await messageIn(group, two.id); return x.canTakeBack === false && !x.waitsFor.length && !x.steering ? x : null; }, { what: 'the message to be read' });
  assert.equal(kept(group).find((x) => x.id === two.id).done, true, 'its line is over');
  assert.equal(m.canTakeBack, false);

  srv.unhold();
  srv.release(rec);
  await waitFor(async () => ((await chatOf(group)).working.length === 0 ? true : null), { what: 'the run to end' });
  await sleep(400);
  assert.equal(srv.runs().filter((x) => x.args.includes(`${bot.emoji} ${bot.name}`)).length, 1, 'no turn of its own for the steered message');
});
