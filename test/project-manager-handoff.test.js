// The Project Manager's status of a hand-off in a team (#1509): the team's answer comes with botdot's own record of who
// a bot asked and still waits for, never only the bot's word; and when that hand-off comes back, the manager is told,
// so a "has not answered" said before is corrected.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor, self } = require('./helpers');
const { shortName } = require('../public/mentions.js');

let srv, web, writer, team, pmChat;
const reply = (bot, text) => fs.writeFileSync(path.join(srv.out, `result-${shortName(bot.name)}.txt`), text);
const teamChat = async (teamId) => (await srv.api('/group-chats')).data.find((g) => g.team === teamId) || null;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'off', BOT_DOT_LEAD_DELAY_MS: 'off' } });
  web = await makeBot(srv, { name: 'QA Web', emoji: '🌐', prompt: 'Logs the weather.' });
  writer = await makeBot(srv, { name: 'QA Writer', emoji: '✍️', prompt: 'Writes.' });
  await srv.api('/company', { method: 'POST', body: { start: 'Weather in Brussels' } });
  team = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Weather', bots: [web.id, writer.id], lead: web.id } })).data.teams[0];
  pmChat = (await srv.api('/company/chief-chat', { method: 'POST' })).data.chatId;
  await waitFor(() => teamChat(team.id), { what: 'the team chat' });
});
after(() => srv?.stop());

test("the lead hands on, the member answers \"Done\": the Chief is told botdot's record, then that the hand-off came back", async () => {
  reply(web, 'I sent QA Writer the confirmation request (step 4 done).');
  reply(writer, 'Done.');
  srv.hold();
  const asChief = (p, opts = {}) => srv.asChief(p, { ...opts, headers: { 'X-Chief-Chat': pmChat, ...opts.headers } });
  assert.equal((await asChief(`/company/teams/${team.id}/message`, { method: 'POST', body: { text: 'Do step 4 of the plan.' } })).status, 201);
  const turn = await srv.nextRun((x) => x.self?.env && x.args.includes('🌐 QA Web'), "the lead's turn in the team chat");
  // The lead hands on to QA Writer and waits for its answer.
  assert.equal((await self(srv, turn.self.env.RUN_TOKEN, 'message', { to: writer.id, message: 'Please confirm step 4.', priority: true })).data.ok, true);
  srv.release(turn);
  // The Chief's turn about the team's answer: the lead's words, and botdot's record that it waits for QA Writer.
  const told = await srv.nextRun((x) => x.stdin.includes('<team-answer>') && x.stdin.includes('has answered your message'), "the Chief's turn about the team's answer");
  assert.match(told.stdin, /I sent QA Writer the confirmation request/);
  assert.match(told.stdin, /What botdot records of their hand-offs \(its own record, not the bots' words\):\n- 🌐 QA Web asked ✍️ QA Writer at \d\d:\d\d and waits for its answer: none has come yet\./);
  assert.match(told.stdin, /say that as what the bot says/);
  assert.match(told.stdin, /Never say a teammate has not answered unless this record says it waits/);
  srv.release(told);
  // QA Writer answers "Done": QA Web's follow-up runs, and its result comes back to the Chief, who corrects itself.
  const asked = await srv.nextRun((x) => x.self?.env && x.args.includes('✍️ QA Writer'), "QA Writer's run");
  srv.release(asked);
  const follow = await srv.nextRun((x) => x.self?.env && x.args.includes('🌐 QA Web') && x.stdin.includes('This was the task you asked them for'), "QA Web's follow-up");
  reply(web, 'QA Writer confirmed step 4: Done.');
  srv.release(follow);
  const back = await srv.nextRun((x) => x.stdin.includes('has finished what it handed on'), "the Chief's turn about the hand-off that came back");
  assert.match(back.stdin, /🌐 QA Web, of the team Weather in the project "Weather in Brussels", has finished what it handed on/);
  assert.match(back.stdin, /<team-answer>\n[\s\S]*QA Writer confirmed step 4: Done\.[\s\S]*<\/team-answer>/);
  assert.match(back.stdin, /If you told the owner earlier that this hand-off was not sent, not answered or not done, say now plainly that it came back/);
  srv.release(back);
  srv.unhold();
});

test('an answer with no hand-off waiting says so: the Chief may not say a teammate has not answered', async () => {
  reply(web, 'All set, nothing to hand on.');
  srv.hold();
  const asChief = (p, opts = {}) => srv.asChief(p, { ...opts, headers: { 'X-Chief-Chat': pmChat, ...opts.headers } });
  assert.equal((await asChief(`/company/teams/${team.id}/message`, { method: 'POST', body: { text: 'Anything left?' } })).status, 201);
  const turn = await srv.nextRun((x) => x.self?.env && x.args.includes('🌐 QA Web') && x.stdin.includes('Anything left?'), "the lead's turn");
  srv.release(turn);
  const told = await srv.nextRun((x) => x.stdin.includes('All set, nothing to hand on.') && x.stdin.includes('<team-answer>'), "the Chief's turn");
  assert.match(told.stdin, /botdot records no hand-off of theirs that still waits for an answer\./);
  srv.release(told);
  srv.unhold();
});
