// Steer in a Chief chat (ADR 040): the owner presses Steer on a message that waits behind the Chief's reply, and the
// turn that is going reads it at its next tool call, through the hook botdot gives a turn the owner started. A
// message not read starts as its own turn, once. Against the stand-in for Claude; the hook is the real one.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, waitFor, feed, readData, hookCall } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => { if (process.env.SHOWLOG) console.log(srv.log.join('').slice(-4000)); srv.unhold(); return srv.stop(); });

const isChief = (x) => x.args.includes('🧭 Chief of Staff');
const chiefTurn = (on, what, fn = () => true) => on.nextRun((x) => isChief(x) && fn(x), what);
const newChat = async (on = srv) => (await on.api('/chief/chats', { method: 'POST' })).data.id;
const chatOf = async (id, on = srv) => (await on.api(`/chief/chats/${id}`)).data;
const say = (id, body, on = srv) => on.api(`/chief/chats/${id}/messages`, { method: 'POST', body: typeof body === 'string' ? { text: body } : body });
const steer = (id, queuedId, on = srv) => on.api(`/chief/chats/${id}/queued/${queuedId}/steer`, { method: 'POST' });
const takeBack = (id, queuedId, on = srv) => on.api(`/chief/chats/${id}/queued/${queuedId}`, { method: 'DELETE' });
const quiet = (id, on = srv) => waitFor(async () => { const c = await chatOf(id, on); return !c.busy && !c.queued.length && !c.messages.at(-1)?.pending ? c : null; }, { what: 'the Chief to finish' });
const onDisk = (on = srv) => (fs.existsSync(path.join(on.data, 'chief-waiting-turns.json')) ? readData(on.data, 'chief-waiting-turns.json') : {});
const upload = async (name, text) => (await srv.api('/uploads?to=chief', { method: 'POST', raw: Buffer.from(text), headers: { 'X-File-Name': name } })).data;
// A tool call of the turn: its hook, as Claude Code runs it, and what it hands Claude (null for nothing).
const toolCall = async (turn) => (await hookCall(turn.settings, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: 'x'.repeat(2e6) })).hookSpecificOutput || null;

test('a message steered into the Chief\'s reply is read at its next tool call, in the same turn, and stands on that reply', async (t) => {
  const events = await feed(srv);
  t.after(() => { events.close(); srv.unhold(); });
  await events.wait('hello');
  const id = await newChat();
  srv.hold();
  await say(id, 'Plan my week');
  const turn = await chiefTurn(srv, 'the first turn');
  assert.equal(turn.settings?.hooks?.PostToolUse?.length, 1, 'a turn the owner started is given the hook');
  assert.equal(turn.settingsMode, 0o600, 'in a private file: it holds the Chief\'s key');
  const hook = turn.settings.hooks.PostToolUse[0].hooks[0];
  assert.deepEqual([hook.type, new URL(hook.url).pathname, hook.headers['X-Chief-Chat'], hook.headers['X-Bot-Dot']], ['http', '/api/chief/steer', id, '1']);
  assert.equal(await toolCall(turn), null, 'nothing steered: nothing said');

  const file = await upload('dentist.txt', 'Dr. Lee, Friday 9:00');
  const w = (await say(id, { text: 'Also book the dentist', attachments: [file], key: 'steer-chief-key1' })).data.queued[0];
  const s = await steer(id, w.id);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.deepEqual(s.data.queued.map((q) => [q.id, q.steering]), [[w.id, true]]);
  assert.deepEqual((await chatOf(id)).queued.map((q) => [q.id, q.steering]), [[w.id, true]]);
  await events.wait('queued', (d) => d.chatId === id && d.queued[0]?.steering === true);
  assert.equal(onDisk()[id][0].steering, true, 'marked on disk');
  assert.equal((await steer(id, w.id)).status, 200, 'pressed again: steered once');

  const read = await toolCall(turn);
  assert.equal(read.hookEventName, 'PostToolUse');
  assert.match(read.additionalContext, /I sent you another message while you work, and pressed Steer/);
  assert.ok(read.additionalContext.includes('Also book the dentist'));
  assert.ok(read.additionalContext.includes(file.file), 'told of its file');
  assert.equal(await toolCall(turn), null, 'read once');
  const said = await events.wait('chief_steered', (d) => d.chatId === id);
  assert.deepEqual(said.data.steered.map((x) => x.id), [w.id]);
  const going = await chatOf(id);
  assert.deepEqual(going.queued, []);
  assert.deepEqual(onDisk(), {});
  const reply = going.messages.at(-1);
  assert.equal(reply.pending, true);
  assert.deepEqual(reply.steered.map((x) => [x.id, x.text, x.attachments.map((a) => a.name), x.at]), [[w.id, 'Also book the dentist', ['dentist.txt'], w.at]]);
  assert.ok(Date.parse(reply.steered[0].readAt) >= Date.parse(w.at));
  // Read: Steer and Take back find it started; its key answers with the chat.
  assert.deepEqual([(await steer(id, w.id)).status, (await takeBack(id, w.id)).status], [409, 409]);
  assert.equal((await steer(id, 'w0000000000000000')).status, 404);
  const again = await say(id, { text: 'Also book the dentist', key: 'steer-chief-key1' });
  assert.deepEqual([again.status, again.data.again, again.data.queued], [200, true, []]);

  srv.reply('Week planned, dentist booked.');
  srv.unhold();
  srv.release(turn);
  const done = await quiet(id);
  assert.deepEqual(done.messages.map((m) => [m.role, m.text, (m.steered || []).map((x) => x.text)]), [['user', 'Plan my week', []], ['chief', 'Week planned, dentist booked.', ['Also book the dentist']]]);
  assert.equal(srv.runs().filter((x) => isChief(x) && x.botdot.env.CHIEF_CHAT_ID === id).length, 1, 'no turn of its own');
});

test('steered and not read before the reply ends: it starts as its own turn, once; Take back works until it is read', async (t) => {
  t.after(() => srv.unhold());
  const id = await newChat();
  srv.hold();
  await say(id, 'First');
  const turn = await chiefTurn(srv, 'the first turn', (x) => /First$/.test(x.stdin));
  const a = (await say(id, 'Steered, never read')).data.queued[0];
  const b = (await say(id, 'Steered, taken back')).data.queued[1];
  assert.equal((await steer(id, a.id)).status, 200);
  assert.equal((await steer(id, b.id)).status, 200);
  const back = await takeBack(id, b.id);
  assert.deepEqual([back.status, back.data.text], [200, 'Steered, taken back']);
  assert.deepEqual((await chatOf(id)).queued.map((q) => [q.text, q.steering]), [['Steered, never read', true]]);

  srv.reply('One.');
  srv.release(turn);
  const next = await chiefTurn(srv, "the steered message's own turn", (x) => /Steered, never read/.test(x.stdin));
  assert.ok(!/Steered, taken back/.test(next.stdin));
  srv.reply('Two.');
  srv.unhold();
  srv.release(next);
  const done = await quiet(id);
  assert.deepEqual(done.messages.map((m) => [m.role, m.text, !!m.steered]), [['user', 'First', false], ['chief', 'One.', false], ['user', 'Steered, never read', false], ['chief', 'Two.', false]]);
  assert.equal(srv.runs().filter((x) => isChief(x) && x.botdot.env.CHIEF_CHAT_ID === id).length, 2);
});

test('after a restart a steered message the reply did not read starts once; one it read starts nothing', async (t) => {
  let own = await startServer();
  t.after(async () => { own.unhold(); await own.stop(); });
  const id = await newChat(own);
  own.hold();
  await say(id, 'First', own);
  const turn = await chiefTurn(own, 'the first turn');
  const read = (await say(id, 'Read before', own)).data.queued[0];
  const unread = (await say(id, 'Not read', own)).data.queued[1];
  const waited = onDisk(own)[id];
  assert.equal((await steer(id, read.id, own)).status, 200);
  assert.equal((await toolCall(turn)).additionalContext.includes('Read before'), true);
  assert.equal((await steer(id, unread.id, own)).status, 200);
  // A crash after the reply was saved with it and before the list was: the read one is in both.
  own = await restartServer(own, (data) => {
    fs.rmSync(path.join(data, '..', 'fake', 'hold'), { force: true });
    fs.writeFileSync(path.join(data, 'chief-waiting-turns.json'), JSON.stringify({ [id]: waited.map((x) => ({ ...x, steering: true })) }));
  });
  const next = await own.nextRun((x) => isChief(x) && /Not read$/.test(x.stdin), "the unread message's turn");
  assert.ok(next);
  const done = await quiet(id, own);
  assert.deepEqual(done.messages.map((m) => [m.role, m.text, (m.steered || []).map((x) => x.text)]), [['user', 'First', []], ['chief', '', ['Read before']], ['user', 'Not read', []], ['chief', 'Done.', []]]);
  assert.deepEqual((await own.api(`/chief/chats/${id}/queued/${read.id}/steer`, { method: 'POST' })).status, 409);
  assert.equal(own.runs().filter((x) => isChief(x) && /Read before$/.test(x.stdin)).length, 0, 'the read one never starts');
});
