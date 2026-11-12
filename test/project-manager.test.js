// The Project Manager (ADR 217): the Chief in a project's own chat writes in a team's chat, the team's turns know the
// message is the Chief's and not the owner's, the team's answer comes back to that chat as a turn of the Chief's,
// and a turn there is told the project's teams. Against a real botdot server and the stand-in for Claude.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName } = require('../public/mentions.js');
const chatHistory = require('../lib/chat-history');

let srv;
after(() => srv?.stop());

const reply = (bot, text) => fs.writeFileSync(path.join(srv.out, `result-${shortName(bot.name)}.txt`), text);
const teamChat = async (teamId) => (await srv.api('/group-chats')).data.find((g) => g.team === teamId) || null;

let lead, writer, team, pmChat, projectId;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'off', BOT_DOT_LEAD_DELAY_MS: 'off' } });
  lead = await makeBot(srv, { name: 'Planner', emoji: '🗂️', prompt: 'Plans the launch.' });
  writer = await makeBot(srv, { name: 'Copy', emoji: '📝', prompt: 'Writes the posts.' });
  await srv.api('/company', { method: 'POST', body: { start: 'A meal planner' } });
  projectId = (await srv.api('/company')).data.company.id;
  const r = await srv.api('/company/teams', { method: 'POST', body: { name: 'Launch', bots: [lead.id, writer.id], lead: lead.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  team = r.data.teams[0];
  pmChat = (await srv.api('/company/chief-chat', { method: 'POST' })).data.chatId;
  await waitFor(() => teamChat(team.id), { what: 'the team chat' });
});

test('the server says a project has its Project Manager', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-manager'));
});

test("the Project Manager's message goes to the lead, as the Chief's, and the team's answer comes back to its chat", async () => {
  reply(lead, 'The launch post goes out Friday.');
  const asChief = (p, opts = {}) => srv.asChief(p, { ...opts, headers: { 'X-Chief-Chat': pmChat, ...opts.headers } });
  const sent = await asChief(`/company/teams/${encodeURIComponent('launch')}/message`, { method: 'POST', body: { text: 'When does the launch post go out?' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.equal(sent.data.by, 'chief');
  assert.deepEqual(sent.data.to, [lead.id], 'a message that names nobody goes to the lead');
  // The lead's turn is told the Project Manager wrote it, and is no run the owner started.
  const turn = await srv.nextRun((x) => x.args.includes(`${lead.emoji} ${lead.name}`), "the lead's turn");
  assert.match(turn.system + turn.stdin, /The Project Manager wrote the message below, not the owner/);
  const g = await teamChat(team.id);
  const chat = await waitFor(async () => {
    const c = (await srv.api(`/group-chats/${g.id}/chat`)).data;
    return c.items.some((x) => x.type === 'reply') && !c.working.length ? c : null;
  }, { what: "the lead's reply" });
  const m = chat.items.find((x) => x.type === 'message');
  assert.equal(m.by, 'chief', 'the apps draw it as the Chief\'s');
  const run = chat.items.find((x) => x.type === 'reply').run;
  assert.equal(chatHistory.ownerStarted((await srv.api(`/runs/${run.id}`)).data), false);
  // The team's answer: a turn of the Chief's in the project's own chat, told the lead's words as bots' text.
  const told = await srv.nextRun((x) => x.stdin.includes('<team-answer>'), "the Chief's turn about the team's answer");
  assert.match(told.stdin, /Launch, a team of the project, has answered your message/);
  assert.match(told.stdin, /The launch post goes out Friday\./);
  // The Chief reads the team's chat: who said what.
  const lines = await asChief(`/company/teams/${team.id}/chat`);
  assert.equal(lines.status, 200, JSON.stringify(lines.data));
  assert.deepEqual(lines.data.lines.map((l) => l.who), ['Project Manager', lead.name]);
});

test('a team that is not there, and the owner writing through the route, are refused', async () => {
  const none = await srv.asChief('/company/teams/nope/message', { method: 'POST', headers: { 'X-Chief-Chat': pmChat }, body: { text: 'Hi' } });
  assert.equal(none.status, 404);
  assert.match(none.data.error, /Its teams: "Launch"/);
  const owner = await srv.api(`/company/teams/${team.id}/message`, { method: 'POST', body: { text: 'Hi' } });
  assert.equal(owner.status, 403);
});

test("botdot's turns may write to teams a few times in a row, then the Chief tells the owner", async () => {
  fs.writeFileSync(path.join(srv.out, `result-${shortName(lead.name)}.txt`), 'PASS');
  let last;
  for (let i = 0; i < 4; i++) last = await srv.asChief(`/company/teams/${team.id}/message`, { method: 'POST', headers: { 'X-Chief-Chat': pmChat }, body: { text: `Ping ${i}` } });
  assert.equal(last.status, 429);
  assert.match(last.data.error, /Tell the owner where it stands/);
});

test("the owner's message in the project's own chat tells the Chief it is the Project Manager, with its teams", async () => {
  const r = await srv.api(`/chief/chats/${pmChat}/messages`, { method: 'POST', body: { text: 'How is the launch going?' } });
  assert.ok(r.status < 300, JSON.stringify(r.data));
  const turn = await srv.nextRun((x) => x.stdin.includes('How is the launch going?'), "the Chief's turn");
  assert.match(turn.stdin, /you are its Project Manager/);
  assert.match(turn.stdin, new RegExp(`"Launch" \\(team id ${team.id}\\): lead 🗂️ Planner \\(id ${lead.id}\\); members 📝 Copy \\(id ${writer.id}\\)`));
  assert.match(turn.stdin, new RegExp(`project id ${projectId}`));
  assert.match(turn.stdin, /My message: How is the launch going\?/);
});

test('the owner picks a bot as the project lead: it runs the project chat in its name, and the Chief is back with none (ADR 227)', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-lead'));
  const boss = await makeBot(srv, { name: 'Boss', emoji: '🧭', prompt: 'Runs the meal planner launch.' });
  assert.equal((await srv.api('/company', { method: 'PATCH', body: { lead: 'no-such-bot' } })).status, 400);
  const set = await srv.api('/company', { method: 'PATCH', body: { lead: boss.id } });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal(set.data.lead, boss.id);
  // Its chat in the Chief's list says who leads, for the apps to draw its head and name.
  assert.equal((await srv.api('/chief')).data.chats.find((c) => c.id === pmChat)?.lead, boss.id);
  // The owner's turn there speaks as the lead.
  await srv.api(`/chief/chats/${pmChat}/messages`, { method: 'POST', body: { text: 'Who leads this?' } });
  const turn = await srv.nextRun((x) => x.stdin.includes('Who leads this?'), "the lead's turn in the project chat");
  assert.match(turn.stdin, new RegExp(`The owner made 🧭 Boss \\(bot id ${boss.id}\\) the project's lead: in this chat you speak as that bot`));
  assert.match(turn.stdin, /Its job: Runs the meal planner launch\./);
  // Its message in a team's chat is drawn as the lead's, and the team's turn is told who wrote it.
  const sent = await srv.asChief(`/company/teams/${team.id}/message`, { method: 'POST', headers: { 'X-Chief-Chat': pmChat }, body: { text: 'Status of the posts?' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.deepEqual([sent.data.by, sent.data.as], ['chief', boss.id]);
  const team1 = await srv.nextRun((x) => x.stdin.includes('Status of the posts?') || x.args.includes('Status of the posts?'), "the team's turn");
  assert.match(team1.system + team1.stdin, /the Project Manager, the project's lead\] 🧭 Boss/);
  // None again, or its bot deleted: the Chief is the Project Manager.
  assert.equal((await srv.api('/company', { method: 'PATCH', body: { lead: null } })).data.lead, undefined);
  assert.equal((await srv.api('/chief')).data.chats.find((c) => c.id === pmChat)?.lead, undefined);
  await srv.api('/company', { method: 'PATCH', body: { lead: boss.id } });
  assert.equal((await srv.api(`/bots/${boss.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await srv.api('/company')).data.company.lead, undefined);
});
