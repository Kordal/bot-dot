// What botdot has to tell the Chief while it replies waits for that reply to end, in a file of the data folder
// (ADR 009, OK-002): stopping botdot in between loses none of it, and each turn starts once. Against the stand-in
// for Claude.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, makeBot, waitFor, readData } = require('./helpers');

const CARRIES = { who: 'chief', text: 'the Chief carries on' };
const WEB = { allowedTools: ['Read', 'WebSearch', 'WebFetch'] };
const waiting = (srv) => (fs.existsSync(path.join(srv.data, 'chief-waiting-turns.json')) ? readData(srv.data, 'chief-waiting-turns.json') : {});
// The Chief's turns that botdot started about this, among the stand-in Claude's runs.
const isTold = (re) => (r) => !!r.botdot && /^botdot writes this, not the user/m.test(r.stdin) && re.test(r.stdin);
const toldOf = (srv, re) => srv.runs().filter(isTold(re));
const chatNow = async (srv, chat) => (await srv.api(`/chief/chats/${chat.id}`)).data;
const quiet = (srv, chat) => waitFor(async () => { const c = await chatNow(srv, chat); return c.busy ? null : c; }, { what: 'the Chief to finish' });

// The owner asks the Chief for something, and the Chief's reply is still being written (held): in that reply its
// tools ask for web access for `names`, and the owner says yes on each card before the reply has ended.
async function approvedWhileReplying(srv, names) {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: `Give ${names.join(' and ')} the web, and start them` } });
  const reply = await srv.nextRun((r) => r.botdot && /Give .* the web/.test(r.stdin), "the Chief's reply");
  for (const name of names) {
    const bot = await makeBot(srv, { name, allowedTools: ['Read'] });
    const change = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: WEB, headers: { 'X-Chief-Chat': chat.id } });
    const yes = await srv.api(`/asks/${change.data.pendingChange}`, { method: 'POST', body: { yes: true } });
    assert.deepEqual(yes.data.carriesOn, CARRIES, 'the answer says the Chief carries on, also while it waits');
  }
  return { chat, reply };
}

test('with the Chief replying, its turns about the answers wait on disk and start after that reply, one after the other', async (t) => {
  const srv = await startServer();
  t.after(async () => { srv.unhold(); await srv.stop(); });
  const { chat, reply } = await approvedWhileReplying(srv, ['Alpha', 'Beta']);
  assert.equal(toldOf(srv, /Alpha|Beta/).length, 0, 'nothing starts while the Chief replies');
  const kept = waiting(srv)[chat.id];
  assert.deepEqual(kept.map((w) => w.otherwise), ['Alpha can browse the web now.', 'Beta can browse the web now.']);
  assert.ok(kept.every((w) => w.prompt.includes(w.otherwise)), 'each with the prompt of its turn');
  assert.ok(kept.every((w) => !Number.isNaN(Date.parse(w.at))), 'each with the moment it began to wait');

  // The reply ends: the first turn starts, and the second waits behind it, since the moment it began to wait.
  srv.release(reply);
  const first = await srv.nextRun(isTold(/Alpha/), 'the turn about Alpha');
  assert.deepEqual(waiting(srv)[chat.id].map((w) => [w.otherwise, w.at]), [['Beta can browse the web now.', kept[1].at]]);
  srv.unhold();
  const second = await srv.nextRun(isTold(/Beta/), 'the turn about Beta');
  assert.ok(first.at <= second.at, 'in the order of the answers');
  const done = await quiet(srv, chat);
  assert.deepEqual(done.messages.map((m) => m.role), ['user', 'chief', 'chief', 'chief'], "the reply, then the two turns' replies");
  assert.deepEqual(waiting(srv), {}, 'nothing is left waiting');
  assert.deepEqual([toldOf(srv, /Alpha/).length, toldOf(srv, /Beta/).length], [1, 1]);
});

test('botdot stopped and started while a turn waits behind a reply: the turn still starts, once', async (t) => {
  let srv = await startServer();
  t.after(async () => { srv.unhold(); await srv.stop(); });
  const { chat } = await approvedWhileReplying(srv, ['Gamma']);
  assert.equal(waiting(srv)[chat.id].length, 1);

  // Stopped in the middle of the Chief's reply. What Claude answers from now on is not held.
  srv = await restartServer(srv, (data) => fs.rmSync(path.join(data, '..', 'fake', 'hold'), { force: true }));
  const turn = await srv.nextRun(isTold(/Gamma/), 'the turn about Gamma');
  assert.equal(turn.botdot.env.CHIEF_CHAT_ID, chat.id);
  assert.equal(turn.botdot.env.BOT_DOT_URL, `http://127.0.0.1:${srv.botdotPort}`, 'its tools reach the botdot that started it, on its own port');
  const done = await quiet(srv, chat);
  assert.deepEqual(done.messages.map((m) => [m.role, m.error || null]), [['user', null], ['chief', 'This reply was cut off because botdot was restarted.'], ['chief', null]]);
  assert.deepEqual(waiting(srv), {});

  // Started again: the turn is not started a second time. A turn that has waited for more than a day (botdot was
  // off, or its data came back from a backup) is not started either: its line is written in its place.
  srv = await restartServer(srv, (data) => fs.writeFileSync(path.join(data, 'chief-waiting-turns.json'), JSON.stringify({
    [chat.id]: [{ prompt: 'botdot writes this, not the user: nobody typed it. Delta waited too long.', otherwise: 'Delta can browse the web now.', at: new Date(Date.now() - 25 * 3600e3).toISOString() }],
  })));
  const later = await waitFor(async () => { const c = await chatNow(srv, chat); return c.messages.at(-1).notice ? c : null; }, { what: "botdot's line for the turn that is too old" });
  assert.equal(later.messages.at(-1).text, 'Delta can browse the web now.');
  assert.deepEqual([toldOf(srv, /Gamma/).length, toldOf(srv, /Delta/).length, later.busy], [1, 0, false]);
  assert.deepEqual(waiting(srv), {});
});
