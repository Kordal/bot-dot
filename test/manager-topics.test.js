// What a Chief message is about (ADR 222): a team's answer told to the Project Manager, and a reply that wrote to
// one team, carry that team (and its project, outside the project's own chat), for the apps to draw above it. Against
// a real botdot server and the stand-in for Claude.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName } = require('../public/mentions.js');

let srv;
after(async () => { srv?.unhold(); await srv?.stop(); });

const reply = (bot, text) => fs.writeFileSync(path.join(srv.out, `result-${shortName(bot.name)}.txt`), text);
const teamChat = async (teamId) => (await srv.api('/group-chats')).data.find((g) => g.team === teamId) || null;
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const idle = (id) => waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.messages.some((m) => m.pending) ? c : null; }, { what: 'the Chief to finish' });
const write = (chatId, team, text) => srv.asChief(`/company/teams/${encodeURIComponent(team)}/message`, { method: 'POST', headers: { 'X-Chief-Chat': chatId }, body: { text } });

let lead, ads, launch, adsTeam, pmChat, projectId;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'off', BOT_DOT_LEAD_DELAY_MS: 'off' } });
  lead = await makeBot(srv, { name: 'Planner', emoji: '🗂️', prompt: 'Plans the launch.' });
  ads = await makeBot(srv, { name: 'Adman', emoji: '📣', prompt: 'Runs the ads.' });
  await srv.api('/company', { method: 'POST', body: { start: 'Mug shop' } });
  projectId = (await srv.api('/company')).data.company.id;
  launch = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Launch', bots: [lead.id], lead: lead.id } })).data.teams.at(-1);
  adsTeam = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Ads', bots: [ads.id], lead: ads.id } })).data.teams.at(-1);
  pmChat = (await srv.api('/company/chief-chat', { method: 'POST' })).data.chatId;
  await waitFor(() => teamChat(launch.id), { what: 'the team chat' });
  await waitFor(() => teamChat(adsTeam.id), { what: 'the ads chat' });
});

test("a team's answer told to the Project Manager is about that team, with no project in the project's own chat", async () => {
  reply(lead, 'The shop opens Friday.');
  assert.equal((await write(pmChat, 'Launch', 'When do we open?')).status, 201);
  const chat = await waitFor(async () => { const c = await chatOf(pmChat); return c.messages.some((m) => m.role === 'chief' && m.about && !m.pending) ? c : null; }, { what: 'the told reply' });
  const m = chat.messages.find((x) => x.role === 'chief' && x.about);
  assert.deepEqual(m.about, { team: { id: launch.id, name: 'Launch', color: launch.color } });
  await idle(pmChat);
});

test('in another Chief chat the same answer names its project too', async () => {
  const other = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  reply(ads, 'Ads are ready.');
  assert.equal((await write(other, 'Ads', 'Are the ads ready?')).status, 201);
  const chat = await waitFor(async () => { const c = await chatOf(other); return c.messages.some((m) => m.about && !m.pending) ? c : null; }, { what: 'the told reply' });
  const m = chat.messages.find((x) => x.about);
  assert.deepEqual(m.about.team, { id: adsTeam.id, name: 'Ads', color: adsTeam.color });
  assert.deepEqual(m.about.project, { id: projectId, name: 'Mug shop' });
  await idle(other);
});

test("the owner's message and the reply that wrote to one team are about it; to two teams, about none", async () => {
  await idle(pmChat);
  srv.hold();
  await srv.api(`/chief/chats/${pmChat}/messages`, { method: 'POST', body: { text: 'Mug prices: 49 and 55.' } });
  await srv.nextRun((r) => r.stdin.includes('Mug prices: 49 and 55.'), "the Chief's turn");
  assert.equal((await write(pmChat, 'Launch', 'Prices are 49 and 55.')).status, 201);
  let c = await chatOf(pmChat);
  const asked = () => c.messages.findLast((m) => m.role === 'user');
  assert.equal(asked().about?.team.id, launch.id);
  assert.equal(c.messages.at(-1).about?.team.id, launch.id);
  assert.equal((await write(pmChat, 'Ads', 'Prices are 49 and 55.')).status, 201);
  c = await chatOf(pmChat);
  assert.equal(asked().about, undefined);
  assert.equal(c.messages.at(-1).about, undefined);
  srv.unhold();
});
