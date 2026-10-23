// The owner's "/btw" to the Chief while it replies (#386, as ADR 063 for a bot): a talk-only turn of Claude, run as
// the Chief, told what the reply that goes on was asked. Its question and answer stand above that reply, take no
// place in the chat's queue, and the next turn the owner starts is told them. To a Chief that is not replying it is a
// message as any. Against a real botdot server and the stand-in for Claude, whose runs are held and released.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, feed, waitFor } = require('./helpers');

let srv, f;
before(async () => { srv = await startServer(); f = await feed(srv); await f.wait('hello'); });
after(async () => { srv.unhold(); f.close(); await srv.stop(); });

const isChief = (x) => x.args.includes('🧭 Chief of Staff');
const isSide = (x) => isChief(x) && x.args.includes('--tools') && x.args[x.args.indexOf('--tools') + 1] === '';
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const say = (id, text) => srv.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text } });
const replyDone = (id) => waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });

test('"/btw" to a replying Chief is answered at once, above the reply that goes on, and the next turn knows it', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await say(c.id, 'Check every bot and sum up how they did this week');
  const turn = await srv.nextRun((x) => isChief(x) && x.stdin.includes('sum up how they did'), "the Chief's turn");

  const asked = await say(c.id, '/btw how far are you?');
  assert.equal(asked.status, 201);
  assert.deepEqual(asked.data.queued, [], 'nothing waits in the queue');
  const side = await srv.nextRun(isSide, 'the side turn');
  const arg = (flag) => side.args[side.args.indexOf(flag) + 1];
  assert.ok(side.args.includes('--strict-mcp-config') && side.args.includes('--no-session-persistence'));
  assert.deepEqual(JSON.parse(arg('--mcp-config')), { mcpServers: {} });
  assert.ok(!side.args.includes('--resume'), 'no session of the chat');
  assert.match(side.stdin, /the Chief of Staff in botdot/);
  assert.match(side.stdin, /asked by the owner:\n<request>\nCheck every bot and sum up how they did this week\n<\/request>/);
  assert.match(side.stdin, /<question>\nhow far are you\?\n<\/question>/);

  srv.reply('Halfway: four of eight bots read.');
  srv.release(side);
  const answered = await waitFor(async () => { const ch = await chatOf(c.id); return ch.messages.some((m) => m.btw && m.role === 'chief') ? ch : null; }, { what: 'the answer' });
  assert.ok(answered.busy, 'the reply goes on');
  const tail = answered.messages.slice(-3);
  assert.deepEqual(tail.map((m) => [m.role, !!m.btw, !!m.pending]), [['user', true, false], ['chief', true, false], ['chief', false, true]], 'question and answer above the reply still coming');
  assert.equal(tail[0].text, '/btw how far are you?');
  assert.equal(tail[1].text, 'Halfway: four of eight bots read.');
  assert.equal(tail[0].btw, tail[1].btw);
  await f.wait('chief_reply', (d) => d.chatId === c.id && d.btw === true && d.text === 'Halfway: four of eight bots read.');

  srv.reply('All eight did fine.');
  srv.unhold();
  srv.release(turn);
  const after1 = await replyDone(c.id);
  assert.equal(after1.messages.at(-1).text, 'All eight did fine.');
  assert.ok(after1.messages.some((m) => m.btw && m.role === 'chief'), 'the turn saving its chat keeps the answer');

  srv.reply('Yes.');
  await say(c.id, 'Is that all?');
  const next = await srv.nextRun((x) => isChief(x) && x.stdin.includes('Is that all?'), 'the next turn');
  assert.match(next.stdin, /side question with \/btw[\s\S]*<btw-question>\nhow far are you\?\n<\/btw-question>\n<your-btw-answer>\nHalfway: four of eight bots read\.\n<\/your-btw-answer>/);
  await replyDone(c.id);
  srv.reply('Fine.');
  await say(c.id, 'And now?');
  const later = await srv.nextRun((x) => isChief(x) && x.stdin.includes('And now?'), 'a later turn');
  assert.doesNotMatch(later.stdin, /btw-question/, 'told once');
  await replyDone(c.id);
});

test('"/btw" to a Chief that is not replying is a message as any, without "/btw"', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.reply('Hi there.');
  await say(c.id, '/btw hi');
  const run = await srv.nextRun((x) => isChief(x) && x.stdin.includes('hi'), "the Chief's turn");
  assert.ok(!isSide(run), 'a whole turn');
  const done = await replyDone(c.id);
  assert.equal(done.messages.find((m) => m.role === 'user').text, 'hi');
  assert.ok(!done.messages.some((m) => m.btw));
});

test('"/btw" alone to a replying Chief waits its turn as a message', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await say(c.id, 'A long one');
  const turn = await srv.nextRun((x) => isChief(x) && x.stdin.includes('A long one'), "the Chief's turn");
  const r = await say(c.id, '/btw');
  assert.equal(r.data.queued.length, 1, 'no question: it waits as any message');
  srv.unhold();
  srv.release(turn);
  await waitFor(async () => { const ch = await chatOf(c.id); return ch.messages.filter((m) => m.role === 'chief' && !m.pending).length === 2 && !ch.busy ? ch : null; }, { what: 'both turns' });
});
