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
  await makeBot(srv, { name: 'Outsider', emoji: '🔎', prompt: 'Researches anything.' });
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

const setRoute = (answer) => fs.writeFileSync(path.join(srv.out, 'route.txt'), answer);

test('a message that names nobody goes to the router as in any group; the member it picks answers, and the lead has no turn (#759)', async () => {
  const g = await teamChat(team.id);
  setRoute('{"members":[3]}'); // the group's order: Scheduler, Writer, Poster
  reply(srv, poster, 'Posting it now.');
  const before = ranOf(srv, lead).length;
  const sent = await srv.api(`/group-chats/${g.id}/messages`, { method: 'POST', body: { text: 'Post the launch on the forums.' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const c = await settled(g, sent.data.id);
  assert.deepEqual(c.items.filter((x) => x.type === 'reply' && x.run.groupMessageId === sent.data.id).map((x) => x.run.botId), [poster.id]);
  assert.equal(ranOf(srv, lead).length, before, 'the lead had no turn');
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'group-messages', `${g.id}.json`), 'utf8')).find((m) => m.id === sent.data.id);
  assert.deepEqual(kept.routed.picked, [poster.id]);
  assert.equal(kept.lead, undefined);
});

test('a message the router cannot place goes to the lead alone; the lead hands on by naming a member', async () => {
  const g = await teamChat(team.id);
  setRoute('{"members":[]}');
  reply(srv, lead, '@Writer please draft 3 launch posts.');
  reply(srv, writer, 'Here are the 3 posts.');
  reply(srv, poster, 'PASS');
  const posterBefore = ranOf(srv, poster).length;
  const sent = await srv.api(`/group-chats/${g.id}/messages`, { method: 'POST', body: { text: 'Get the launch posts ready.' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const c = await settled(g, sent.data.id);
  const replies = c.items.filter((x) => x.type === 'reply').map((x) => x.run.botId);
  assert.deepEqual(replies.slice(-2), [lead.id, writer.id], 'the lead, then the member it named');
  assert.equal(ranOf(srv, poster).length, posterBefore, 'nobody else had a turn');
  const ran = ranOf(srv, lead).at(-1);
  assert.match(ran.system, /it came to you as the lead: this turn is yours\. Never pass on it/);
  assert.match(ran.system, /· the team's lead: you\] 📅 Scheduler/);
  assert.doesNotMatch(ran.system, /reply with the single word PASS/);
  // It hands on by naming members, with no message_bot and no list of bots outside the team (#759).
  assert.match(ran.system, /split the work among the members of this group by naming each in your reply/);
  assert.doesNotMatch(ran.system, /with message_bot \(priority: true\)|Teammates you may message/);
  assert.doesNotMatch(ran.system, /Outsider/, 'a bot that is not on the team is not named');
  assert.equal(ran.self.env.SELF_TEAM, '0', 'no message_bot in a turn in a group');
  assert.match(ranOf(srv, writer).at(-1).system, /answer the lead in this group, in your reply/);
  assert.match(ranOf(srv, writer).at(-1).system, /· the team's lead\] 📅 Scheduler/);
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'group-messages', `${g.id}.json`), 'utf8')).find((m) => m.id === sent.data.id);
  assert.equal(kept.lead, lead.id);
  assert.equal(kept.routed.fell, 'unsure');
  assert.deepEqual(kept.to, [lead.id]);
});

test('the lead in its own chat still splits the work with message_bot among its teammates', async () => {
  reply(srv, lead, 'On it.');
  const r = await srv.api(`/bots/${lead.id}/run`, { method: 'POST', body: { prompt: 'Plan the demo week.' } });
  assert.ok(r.status < 300, JSON.stringify(r.data));
  const ran = await waitFor(() => ranOf(srv, lead).find((x) => !x.system.includes('You are in a group')), { what: "the lead's own run" });
  assert.match(ran.system, /split the work among its members with message_bot \(priority: true\)/);
  assert.match(ran.system, /Teammates you may message with message_bot/);
  assert.equal(ran.self.env.SELF_TEAM, '1');
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
