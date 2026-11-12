// A lead or the Project Manager relays what a member waits for: each turn is told what of its bots waits in Needs
// you right now, read from the cards, so a chat that still says "it waits for your OK" after the owner's yes is
// never repeated (the owner: "Still asking while I already accepted"). Against a real botdot server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor, heldRun, self } = require('./helpers');

let srv, lead, writer, pmChat;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'off', BOT_DOT_LEAD_DELAY_MS: 'off' } });
  lead = await makeBot(srv, { name: 'Planner', emoji: '🗂️', prompt: 'Plans the launch.' });
  writer = await makeBot(srv, { name: 'Copy', emoji: '📝', prompt: 'Writes the posts.', allowedTools: ['Read'] });
  await srv.api('/company', { method: 'POST', body: { start: 'A meal planner' } });
  const r = await srv.api('/company/teams', { method: 'POST', body: { name: 'Launch', bots: [lead.id, writer.id], lead: lead.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  pmChat = (await srv.api('/company/chief-chat', { method: 'POST' })).data.chatId;
});
after(() => srv?.stop());

test("the lead and the Project Manager are told what of their bots waits in Needs you, and nothing once it is answered", async () => {
  const held = await heldRun(srv, writer, 'Push the post to GitHub');
  const r = await self(srv, held.token, 'ask', { kind: 'permission', permission: 'commands', reason: 'To push the post' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  srv.release(held.rec); await srv.finished(held.run.id); srv.unhold();

  const leadRun = await heldRun(srv, lead, 'Where is the post?');
  assert.match(leadRun.rec.system, /What of your teammates waits in Needs you right now: Copy waits for the owner's OK to run commands \[card \w+\]\. Nothing else of theirs waits there/);
  srv.release(leadRun.rec); await srv.finished(leadRun.run.id); srv.unhold();
  await srv.api(`/chief/chats/${pmChat}/messages`, { method: 'POST', body: { text: 'Is anything waiting for me?' } });
  let turn = await srv.nextRun((x) => x.stdin.includes('Is anything waiting for me?'), "the Chief's turn");
  assert.match(turn.stdin, /What of the project's bots waits in Needs you right now: Copy waits for the owner's OK to run commands \[card \w+\]\./);

  const [card] = (await srv.api('/asks')).data.filter((a) => a.botId === writer.id);
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).data.ok, true);
  await waitFor(async () => !(await srv.api('/asks')).data.some((a) => a.botId === writer.id), { what: 'the card answered' });
  const again = await heldRun(srv, lead, 'And now?');
  assert.match(again.rec.system, /Nothing of your teammates \(Copy\) waits in Needs you right now\. Never say that a teammate's card waits there/);
  srv.release(again.rec); await srv.finished(again.run.id); srv.unhold();
  await srv.api(`/chief/chats/${pmChat}/messages`, { method: 'POST', body: { text: 'Anything left for me?' } });
  turn = await srv.nextRun((x) => x.stdin.includes('Anything left for me?'), "the Chief's turn");
  assert.match(turn.stdin, /Nothing of the project's bots waits in Needs you right now/);
});
