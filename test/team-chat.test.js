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

test('a team gets its chat: its name, the lead first, its colour; renaming it renames the team; the owner cannot delete it', async () => {
  const g = await waitFor(() => teamChat(team.id), { what: 'the team chat' });
  assert.deepEqual([g.name, g.members, g.lead, g.color], ['Growth', [lead.id, writer.id, poster.id], lead.id, team.color]);
  const { features } = (await srv.api('/version')).data;
  assert.ok(features.includes('team-chats') && features.includes('team-chat-rename') && features.includes('team-chat-members'));
  // Renamed from its chat: the team in its project takes the name, and the chat follows it.
  const renamed = await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { name: '  Growth   crew ' } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.name, 'Growth crew');
  assert.equal((await srv.api('/company')).data.company.teams.find((t) => t.id === team.id).name, 'Growth crew');
  assert.equal((await teamChat(team.id)).name, 'Growth crew');
  // A team has a name: an empty one is refused, and nothing changes.
  const empty = await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { name: ' ' } });
  assert.equal(empty.status, 400);
  assert.equal((await teamChat(team.id)).name, 'Growth crew');
  assert.equal((await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { name: 'Growth' } })).status, 200);
  assert.equal((await srv.api(`/group-chats/${g.id}`, { method: 'DELETE' })).status, 409);
  // Its place in the list is still the owner's.
  assert.equal((await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { pinned: true } })).status, 200);
  await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { pinned: 0 } });
});

test("its members, changed in its chat, are its team's bots: added or taken out there, never emptied (team-chat-members)", async () => {
  const g = await teamChat(team.id);
  const outsider = (await srv.api('/bots')).data.find((b) => b.name === 'Outsider');
  const other = await srv.api('/company/teams', { method: 'POST', body: { name: 'Research', bots: [outsider.id] } });
  assert.equal(other.status, 200, JSON.stringify(other.data));
  const teamOf = async (id) => (await srv.api('/company')).data.company.teams.find((t) => t.id === id);
  const added = await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { members: [...g.members, outsider.id] } });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.deepEqual(added.data.members, [lead.id, writer.id, poster.id, outsider.id], 'the chat follows its team');
  assert.deepEqual((await teamOf(team.id)).bots, [lead.id, writer.id, poster.id, outsider.id]);
  assert.deepEqual((await teamOf(other.data.teams.at(-1).id)).bots, [outsider.id], 'it stays in its other team (ADR 199)');
  // Its lead taken out: the next bot leads, and the chat follows.
  const out = await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { members: [writer.id, poster.id, outsider.id] } });
  assert.equal(out.status, 200, JSON.stringify(out.data));
  assert.deepEqual([out.data.members, out.data.lead], [[writer.id, poster.id, outsider.id], writer.id]);
  // Emptied, the team would go with its chat: refused, and nothing changes.
  const empty = await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { members: [] } });
  assert.equal(empty.status, 400);
  assert.match(empty.data.error, /at least one bot/);
  assert.equal((await srv.api(`/group-chats/${g.id}`, { method: 'PUT', body: { members: ['gone-bot'] } })).status, 400);
  assert.deepEqual((await teamOf(team.id)).bots, [writer.id, poster.id, outsider.id]);
  // Back as it was for the tests below.
  assert.equal((await srv.api(`/company/teams/${team.id}`, { method: 'PUT', body: { bots: [lead.id, writer.id, poster.id], lead: lead.id } })).status, 200);
  await srv.api(`/company/teams/${other.data.teams.at(-1).id}`, { method: 'DELETE' });
  assert.deepEqual((await teamChat(team.id)).members, [lead.id, writer.id, poster.id]);
});

const setRoute = (answer) => fs.writeFileSync(path.join(srv.out, 'route.txt'), answer);
// What the lead answers on its last word (ADR 201): a run told it has the last word answers this.
const LAST_WORD = 'the last word as its lead';
const lastWord = (text) => fs.writeFileSync(path.join(srv.out, 'result-if-told.json'), JSON.stringify(text ? { [LAST_WORD]: text } : {}));
// The line ends with the lead's last word: settled only once the team's answer is there (between the members' last
// turn and the lead's, nobody is at work and nobody is next for a moment).
const answered = async (g, id) => { await waitFor(async () => (await chatOf(g)).items.find((x) => x.id === id)?.answer, { timeout: 20_000, what: `the team's answer to ${id}` }); return settled(g, id); };
const keptOf = (g, id) => JSON.parse(fs.readFileSync(path.join(srv.data, 'group-messages', `${g.id}.json`), 'utf8')).find((m) => m.id === id);

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
  lastWord('Writer has the 3 posts ready, above.');
  const posterBefore = ranOf(srv, poster).length;
  const sent = await srv.api(`/group-chats/${g.id}/messages`, { method: 'POST', body: { text: 'Get the launch posts ready.' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const c = await answered(g, sent.data.id);
  const mine = c.items.filter((x) => x.type === 'reply' && x.run.groupMessageId === sent.data.id).map((x) => x.run);
  assert.deepEqual(mine.map((r) => r.botId), [lead.id, writer.id, lead.id], 'the lead, the member it named, then the lead\'s last word (ADR 201)');
  assert.equal(c.items.find((x) => x.id === sent.data.id).answer, mine[2].id, 'its last word is the team\'s answer');
  assert.match(ranOf(srv, lead).at(-1).system, /you have the last word as its lead: this turn is yours\. Never pass on it/);
  lastWord(null);
  assert.equal(ranOf(srv, poster).length, posterBefore, 'nobody else had a turn');
  const ran = ranOf(srv, lead).at(-2); // the turn the message came to it with, before its last word
  assert.match(ran.system, /it came to you as the lead: this turn is yours\. Never pass on it/);
  assert.match(ran.system, /botdot gives you the last word, to write the team's one answer/);
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

test('two members the router picks answer to the lead, and the lead writes the team\'s one answer last (ADR 201)', async () => {
  const g = await teamChat(team.id);
  setRoute('{"members":[2,3]}'); // Writer and Poster: not the lead
  reply(srv, writer, 'A forum post needs a short title.');
  reply(srv, poster, '@Writer the forum allows 60 characters in a title.');
  lastWord('We post on Thursday with a 60-character title. Writer drafts it today.');
  const sent = await srv.api(`/group-chats/${g.id}/messages`, { method: 'POST', body: { text: 'What does a forum launch post need?' } });
  const c = await answered(g, sent.data.id);
  const mine = c.items.filter((x) => x.type === 'reply' && x.run.groupMessageId === sent.data.id).map((x) => x.run);
  // Writer, Poster (which tells Writer a fact: Writer corrects its part), Writer again, then the lead's last word.
  assert.deepEqual(mine.map((r) => r.botId), [writer.id, poster.id, writer.id, lead.id]);
  const m = c.items.find((x) => x.id === sent.data.id);
  assert.equal(m.answer, mine.at(-1).id);
  assert.ok(keptOf(g, sent.data.id).turns.find((t) => t.runId === m.answer).closing);
  const first = ranOf(srv, writer).at(-2).system;
  assert.match(first, /You speak to the team's lead, not to the owner/);
  // The owner reads the team's chat (ADR 218): a member asks the owner itself, never through the lead.
  assert.match(first, /ask the owner yourself, at the end of your reply, as one recommendation and one yes or no question\. Never ask the lead or another member to ask the owner for you\./);
  assert.match(first, /never to have it ask the owner something for you/);
  assert.doesNotMatch(first, /goes to the lead, which asks/);
  assert.doesNotMatch(first, /The owner reads every member's reply/);
  assert.match(ranOf(srv, poster).at(-1).system, /name that member with the fact, so that it corrects its own part: never correct it for the owner/);
  const closing = ranOf(srv, lead).at(-1).system;
  assert.match(closing, /Write the team's one answer to the owner/);
  assert.match(closing, /never hand the owner options the team can choose between/);
  assert.match(closing, /A member that asked the owner in its reply has asked already: never ask it again/);
  assert.match(closing, /Decide as a team what is technical, can be undone and costs nothing/);
  assert.doesNotMatch(closing, /reply with the single word PASS/);
  lastWord(null);
});

test('one member alone answers for the team: the lead has no last word and nothing is folded', async () => {
  const g = await teamChat(team.id);
  setRoute('{"members":[3]}');
  reply(srv, poster, 'Posted.');
  const before = ranOf(srv, lead).length;
  const sent = await srv.api(`/group-chats/${g.id}/messages`, { method: 'POST', body: { text: 'Post it on the forum.' } });
  const c = await settled(g, sent.data.id);
  assert.equal(ranOf(srv, lead).length, before);
  assert.equal(c.items.find((x) => x.id === sent.data.id).answer, undefined);
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
