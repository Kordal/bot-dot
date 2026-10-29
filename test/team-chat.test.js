// A team's chat (#697): each team of the project has a group chat that follows the team; a message that names nobody
// goes to the lead, who hands parts on by naming members; @name reaches that member. Against a real botdot server and
// the stand-in for Claude (test/fixtures/fake-claude.js), which answers by the bot's name.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName } = require('../public/mentions.js');
const { turnNote } = require('../lib/group-chat');

let srv;
after(() => srv?.stop());

const reply = (on, bot, text) => fs.writeFileSync(path.join(on.out, `result-${shortName(bot.name)}.txt`), text);
const ranOf = (on, bot) => on.runs().filter((x) => x.who === shortName(bot.name));
const groups = async () => (await srv.api('/group-chats')).data;
const teamChat = async (teamId) => (await groups()).find((g) => g.team === teamId) || null;
const chatOf = async (g) => (await srv.api(`/group-chats/${g.id}/chat`)).data;
const settled = (g, id) => waitFor(async () => {
  const c = await chatOf(g);
  const m = c.items.find((x) => x.type === 'message' && x.id === id);
  return m && !c.working.length && !m.next.length && !m.waitsFor.length ? c : null;
}, { timeout: 20_000, what: `the line of message ${id} to end` });

let lead, writer, poster, team;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'on' } });
  lead = await makeBot(srv, { name: 'Scheduler', emoji: '📅', prompt: 'Books the demo calls.' });
  writer = await makeBot(srv, { name: 'Writer', emoji: '📝', prompt: 'Writes the posts.' });
  poster = await makeBot(srv, { name: 'Poster', emoji: '📣', prompt: 'Posts the launch.' });
  await srv.api('/company', { method: 'POST', body: { start: 'An app for parents' } });
  const r = await srv.api('/company/teams', { method: 'POST', body: { name: 'Growth', bots: [writer.id, lead.id, poster.id], lead: lead.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  team = r.data.teams[0];
});

test('a team gets its chat: its name, the lead first, its colour; the owner cannot rename it, change its members or delete it', async () => {
  const g = await waitFor(() => teamChat(team.id), { what: 'the team chat' });
  assert.deepEqual([g.name, g.members, g.lead, g.color], ['Growth', [lead.id, writer.id, poster.id], lead.id, team.color]);
  assert.ok((await srv.api('/version')).data.features.includes('team-chats'));
  for (const body of [{ name: 'Other' }, { members: [lead.id, writer.id] }]) {
    const r = await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.data.error, /team's chat/);
  }
  assert.equal((await srv.api(`/group-chats/${g.id}`, { method: 'DELETE' })).status, 409);
  // Its place in the list is still the owner's.
  assert.equal((await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { pinned: true } })).status, 200);
  await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { pinned: 0 } });
});

test('a message that names nobody goes to the lead alone, never to the router; the lead hands on by naming a member', async () => {
  const g = await teamChat(team.id);
  reply(srv, lead, '@Writer please draft 3 launch posts.');
  reply(srv, writer, 'Here are the 3 posts.');
  reply(srv, poster, 'PASS');
  const sent = await srv.api(`/group-chats/${g.id}/messages`, { method: 'POST', body: { text: 'Get the launch posts ready.' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.deepEqual(sent.data.to, [lead.id]);
  const c = await settled(g, sent.data.id);
  const replies = c.items.filter((x) => x.type === 'reply').map((x) => x.run.botId);
  assert.deepEqual(replies, [lead.id, writer.id], 'the lead, then the member it named');
  assert.equal(ranOf(srv, poster).length, 0, 'nobody else had a turn');
  const ran = ranOf(srv, lead).at(-1);
  assert.match(ran.system, /it came to you as the lead: this turn is yours\. Never pass on it/);
  assert.match(ran.system, /· the team's lead: you\] 📅 Scheduler/);
  assert.doesNotMatch(ran.system, /reply with the single word PASS/);
  assert.match(ranOf(srv, writer).at(-1).system, /· the team's lead\] 📅 Scheduler/);
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'group-messages', `${g.id}.json`), 'utf8')).find((m) => m.id === sent.data.id);
  assert.equal(kept.lead, lead.id);
  assert.equal(kept.routed, undefined, 'the router was not asked');
});

test('@member reaches that member, not the lead', async () => {
  const g = await teamChat(team.id);
  reply(srv, poster, 'Posted.');
  const before = ranOf(srv, lead).length;
  const sent = await srv.api(`/group-chats/${g.id}/messages`, { method: 'POST', body: { text: '@Poster post it now.' } });
  assert.deepEqual(sent.data.to, [poster.id]);
  await settled(g, sent.data.id);
  assert.equal(ranOf(srv, lead).length, before);
});

test('the chat follows the team: a new lead, a renamed team, a bot that joins or leaves, and it goes with the team', async () => {
  await srv.api(`/company/teams/${team.id}`, { method: 'PUT', body: { lead: writer.id, name: 'Launch', bots: [lead.id, writer.id] } });
  let g = await waitFor(async () => { const x = await teamChat(team.id); return x?.name === 'Launch' ? x : null; }, { what: 'the renamed chat' });
  assert.deepEqual([g.members, g.lead], [[writer.id, lead.id], writer.id]);
  // A deleted bot leaves the team and its chat.
  await srv.api(`/bots/${lead.id}`, { method: 'DELETE' });
  g = await waitFor(async () => { const x = await teamChat(team.id); return x && x.members.length === 1 ? x : null; }, { what: 'the bot to leave the chat' });
  assert.deepEqual(g.members, [writer.id]);
  await srv.api(`/company/teams/${team.id}`, { method: 'DELETE' });
  await waitFor(async () => !(await teamChat(team.id)), { what: 'the chat to go with its team' });
  assert.equal(fs.existsSync(path.join(srv.data, 'group-messages', `${g.id}.json`)), false);
});

test('only a team chat names its lead in a turn', () => {
  const members = [{ id: 'a', name: 'Lead' }, { id: 'b', name: 'Member' }];
  assert.doesNotMatch(turnNote(members[1], { group: { name: 'Dev' }, members, mentioned: false }), /team's lead/);
  assert.match(turnNote(members[1], { group: { name: 'Dev', team: 't1', lead: 'a' }, members, mentioned: false }), /the team's lead\] Lead/);
});
