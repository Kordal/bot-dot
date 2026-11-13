// The owner's message to a Chief that replies is sorted like a bot's (ADR 167, ADR 106): more for the reply that goes
// on is steered into it, a question about it is answered aside, and anything else waits its turn as before.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, waitFor, hookCall } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const isChief = (x) => x.args.includes('🧭 Chief of Staff');
const newChat = async () => (await srv.api('/chief/chats', { method: 'POST' })).data.id;
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const say = (id, body) => srv.api(`/chief/chats/${id}/messages`, { method: 'POST', body: typeof body === 'string' ? { text: body } : body });
const answer = (json) => fs.writeFileSync(path.join(srv.out, 'follow-up.txt'), json);
const asks = () => fs.readdirSync(srv.out).filter((f) => /^follow-up-\d/.test(f)).sort();
const toolCall = async (turn) => (await hookCall(turn.settings, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: 'x' })).hookSpecificOutput || null;
const quiet = (id) => waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.queued.length && !c.messages.at(-1)?.pending ? c : null; }, { what: 'the Chief to finish' });

test('"also" to a Chief that replies is steered into that reply, and read at its next tool call', async (t) => {
  t.after(() => { srv.unhold(); fs.rmSync(path.join(srv.out, 'follow-up.txt'), { force: true }); });
  const id = await newChat();
  srv.hold();
  await say(id, 'Set up a bot that checks my mail at 8');
  const turn = await srv.nextRun(isChief, 'the turn');
  const turns = srv.runs().filter(isChief).length;
  answer('{"decision":"steer","run":1}');
  const n = asks().length;
  const sent = (await say(id, 'make it 9, not 8')).data;
  assert.equal(asks().length, n + 1, 'asked once');
  const asked = fs.readFileSync(path.join(srv.out, asks().at(-1)), 'utf8');
  assert.match(asked, /1\. asked \d+ s ago: Set up a bot that checks my mail at 8/);
  assert.match(asked, /The message: make it 9, not 8/);
  assert.deepEqual(sent.queued.map((q) => [q.text, q.steering]), [['make it 9, not 8', true]], 'shown as steered');
  const read = await toolCall(turn);
  assert.match(read.additionalContext, /botdot took it for more of this reply's work/);
  assert.ok(read.additionalContext.includes('make it 9, not 8'));
  srv.unhold();
  srv.release(turn);
  await quiet(id);
  assert.equal(srv.runs().filter(isChief).length, turns, 'one reply: no second turn');
});

test('a question about the reply is answered aside; a task of its own, files or a failure wait their turn as before', async (t) => {
  t.after(() => { srv.unhold(); fs.rmSync(path.join(srv.out, 'follow-up.txt'), { force: true }); });
  const id = await newChat();
  srv.hold();
  await say(id, 'Plan my week');
  const turn = await srv.nextRun(isChief, 'the turn');
  answer('{"decision":"ask"}');
  const aside = (await say(id, 'how far are you?')).data;
  assert.deepEqual(aside.queued, [], 'no waiting message');
  const side = await srv.nextRun((x) => isChief(x) && /<question>\nhow far are you\?\n<\/question>/.test(x.stdin), 'the side turn');
  assert.ok(side);
  srv.release(side);
  answer('{"decision":"new"}');
  const later = (await say(id, 'and find me a recipe')).data;
  assert.deepEqual(later.queued.map((q) => [q.text, !!q.steering]), [['and find me a recipe', false]], 'a task of its own waits');
  const n = asks().length;
  const behind = (await say(id, 'also this')).data;
  assert.equal(asks().length, n, 'behind a waiting message nothing is sorted: the order stays');
  assert.equal(behind.queued.length, 2);
  srv.unhold();
  srv.release(turn);
  await quiet(id);
});

test('generated project receipts never reach the Chief follow-up sorter', async (t) => {
  t.after(() => { srv.unhold(); fs.rmSync(path.join(srv.out, 'follow-up.txt'), { force: true }); });
  const project = (await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Sorter privacy' } })).data;
  await srv.api(`/company/decisions?project=${project.id}`, { method: 'POST', body: { text: 'RECEIPT_ONLY_ORCHID' } });
  const receipt = await srv.api(`/company/updates/now?project=${project.id}`, { method: 'POST', body: { key: 'sorter-receipt' } });
  assert.match(receipt.data.update.text, /RECEIPT_ONLY_ORCHID/);
  const id = receipt.data.update.chatId;
  srv.hold();
  await say(id, 'Plan the garden launch');
  const turn = await srv.nextRun((x) => isChief(x) && /Plan the garden launch/.test(x.stdin), 'the project Chief turn');
  answer('{"decision":"steer","run":1}');
  const n = asks().length;
  await say(id, 'also add a seed order');
  assert.equal(asks().length, n + 1);
  const asked = fs.readFileSync(path.join(srv.out, asks().at(-1)), 'utf8');
  assert.match(asked, /Plan the garden launch/);
  assert.doesNotMatch(asked, /RECEIPT_ONLY_ORCHID|Project update:/);
  srv.unhold(); srv.release(turn);
  await quiet(id);
});
