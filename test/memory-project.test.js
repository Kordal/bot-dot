// A note a bot saves in a project's team chat is of that project; in another project's team chat it is left out of
// what the run is handed (2026-11-12, team-bot-memory-project). Elsewhere every note is handed, as before.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scratchMemory } = require('./memory-helpers');

test("a note of one project's team chat stays out of another project's; untagged and shared notes stay everywhere", (t) => {
  const { memory: m } = scratchMemory(t);
  const mine = m.addNote('alpha', 'Beszel runs on OVH prod.', { project: 'qwotz' }).note;
  m.addNote('alpha', 'Agents still missing on netcup and Proxmox.', { project: 'homelab', topic: 'servers' });
  m.addNote('alpha', 'The owner prefers short replies.');
  const shared = m.addNote('_shared', 'The owner lives in Brussels.', { project: 'qwotz' }).note;
  assert.equal(mine.project, 'qwotz');
  assert.equal(shared.project, undefined, 'a shared note is about the owner, never a project');
  const inQwotz = m.forPrompt('alpha', { project: 'qwotz' }).text;
  assert.match(inQwotz, /Beszel runs on OVH prod/);
  assert.match(inQwotz, /short replies/);
  assert.doesNotMatch(inQwotz, /netcup/);
  const own = m.forPrompt('alpha').text;
  assert.match(own, /netcup/);
  assert.match(own, /Beszel/);
  m.addNote('alpha', 'Unpinned homelab detail.', { project: 'homelab', pinned: false, topic: 'homelab' });
  assert.ok(!m.forPrompt('alpha', { project: 'qwotz' }).topics.includes('homelab'), "another project's topics are not hinted");
  assert.ok(m.forPrompt('alpha').topics.includes('homelab'));
});

// Against a real botdot server and the stand-in for Claude: a bot on teams of two projects saves a note in one
// team's chat; the other project's team chat is not handed it, its own chat is.
const { startServer, makeBot, waitFor } = require('./helpers');
const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;

test("a note saved in one project's team chat is that project's, and stays out of the other's team chat", async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const bot = await makeBot(srv, { name: 'Infra Admin', emoji: '🗄️', prompt: 'Looks after servers.' });
  await srv.api('/company', { method: 'POST', body: { start: 'Qwotz' } });
  await srv.api('/company/teams', { method: 'POST', body: { name: 'IT', bots: [bot.id], lead: bot.id } });
  const second = (await srv.api('/company', { method: 'POST', body: { start: 'Homelab' } })).data;
  const secondId = second.id || second.company?.id || (await srv.api('/company/list')).data.projects[1].id;
  await srv.api(at('/company/teams', secondId), { method: 'POST', body: { name: 'Racks', bots: [bot.id], lead: bot.id } });
  const [first] = (await srv.api('/company/list')).data.projects.map((c) => c.id);
  const chats = await waitFor(async () => { const g = (await srv.api('/group-chats')).data.filter((x) => x.team); return g.length === 2 ? g : null; }, { what: 'both team chats' });
  const chatOf = async (pid) => { const c = (await srv.api(at('/company', pid))).data.company; return chats.find((g) => g.team === c.teams[0].id); };
  const turn = async (g, text) => {
    srv.hold();
    await srv.api(`/group-chats/${g.id}/messages`, { method: 'POST', body: { text } });
    return srv.nextRun((x) => x.self?.env && x.stdin.includes(text), text);
  };
  const inHomelab = await turn(await chatOf(secondId), 'Check the racks.');
  const saved = (await srv.api('/self/session/memory', { method: 'POST', headers: { 'X-Run-Token': inHomelab.self.env.RUN_TOKEN }, body: { action: 'add', text: 'Agents still missing on netcup and Proxmox.' } })).data;
  assert.equal(saved.note?.project, secondId, JSON.stringify(saved));
  srv.release(inHomelab);
  const inQwotz = await turn(await chatOf(first), 'Check Qwotz monitoring.');
  assert.doesNotMatch(inQwotz.system, /netcup/, "another project's note is not handed to this team chat");
  srv.release(inQwotz);
  srv.hold();
  await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Anything on the servers?' } });
  const own = await srv.nextRun((x) => x.self?.env && x.stdin.includes('Anything on the servers?'), 'its own chat');
  assert.match(own.system, /netcup/, 'its own chat is handed every note');
  srv.release(own);
});
