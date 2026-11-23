// What a Chief message is about (ADR 223): a team's answer told to the Project Manager, and a reply that wrote to
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

let lead, ads, launch, adsTeam, pmChat, projectId, projectColor;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'off', BOT_DOT_LEAD_DELAY_MS: 'off', BOT_DOT_LOOK_ON_DEMAND: '1' } });
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // the tests run at any hour
  lead = await makeBot(srv, { name: 'Planner', emoji: '🗂️', prompt: 'Plans the launch.' });
  ads = await makeBot(srv, { name: 'Adman', emoji: '📣', prompt: 'Runs the ads.' });
  await srv.api('/company', { method: 'POST', body: { start: 'Mug shop' } });
  const company = (await srv.api('/company')).data.company;
  projectId = company.id;
  projectColor = company.color;
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
  assert.deepEqual(m.about.project, { id: projectId, name: 'Mug shop', color: projectColor });
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

test("a bot's result told to the Chief is about the bot's one project, with no team; none in the project's own chat (ADR 260)", async () => {
  await idle(pmChat);
  const other = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  const run = (chatId) => srv.asChief(`/bots/${ads.id}/run`, { method: 'POST', headers: { 'X-Chief-Chat': chatId }, body: { task: 'Check the ads.' } });
  reply(ads, 'The ads run fine.');
  assert.equal((await run(other)).status < 300, true);
  const chat = await waitFor(async () => { const c = await chatOf(other); return c.messages.some((m) => m.role === 'chief' && m.about && !m.pending) ? c : null; }, { what: 'the reply about the result' });
  assert.deepEqual(chat.messages.find((m) => m.role === 'chief' && m.about).about, { project: { id: projectId, name: 'Mug shop', color: projectColor } });
  await idle(other);
  reply(ads, 'The ads run fine again.');
  const before = (await chatOf(pmChat)).messages.length;
  assert.equal((await run(pmChat)).status < 300, true);
  const own = await waitFor(async () => { const c = await chatOf(pmChat); return c.messages.length > before && c.messages.some((m, i) => i >= before && m.role === 'chief' && !m.pending) && !c.busy ? c : null; }, { what: 'the reply in the project chat' });
  assert.deepEqual(own.messages.slice(before).filter((m) => m.about), [], "the project's own chat names it in its header");
});

test("a look's [[project: …]] line labels its message with that project, except in the project's own chat; an unknown one gives none (ADR 260)", async () => {
  const other = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  await srv.api(`/chief/chats/${other}/messages`, { method: 'POST', body: { text: 'Hello' } });
  await idle(other);
  srv.reply('Mug shop: the launch is on Friday.\n[[project: mug SHOP]]');
  let r = (await srv.api('/chief/look', { method: 'POST' })).data;
  assert.equal(r.posted, true);
  assert.equal(r.chatId, other);
  let m = (await chatOf(other)).messages.findLast((x) => x.unasked);
  assert.equal(m.text, 'Mug shop: the launch is on Friday.');
  assert.deepEqual(m.about, { project: { id: projectId, name: 'Mug shop', color: projectColor } });

  srv.reply('Nowhere: nothing here.\n[[project: Nowhere]]');
  r = (await srv.api('/chief/look', { method: 'POST' })).data;
  m = (await chatOf(other)).messages.findLast((x) => x.unasked);
  assert.equal(m.text, 'Nowhere: nothing here.');
  assert.equal(m.about, undefined);

  await srv.api(`/chief/chats/${pmChat}/messages`, { method: 'POST', body: { text: 'Hello again' } });
  await idle(pmChat);
  srv.reply('Mug shop: the shop is open.\n[[project: Mug shop]]');
  r = (await srv.api('/chief/look', { method: 'POST' })).data;
  assert.equal(r.chatId, pmChat);
  m = (await chatOf(pmChat)).messages.findLast((x) => x.unasked);
  assert.equal(m.text, 'Mug shop: the shop is open.');
  assert.equal(m.about, undefined, "its header names the project");
});
