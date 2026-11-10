// The owner talks to a team through its lead (ADR 148): a member asks its lead for what it needs from the owner, and
// the lead passes the answer on. Every bot may message every other (ADR 192), inside a team or not.
process.env.BOT_DOT_RUNS_MAX = '1';
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, self, writeData, waitFor } = require('./helpers');

let srv; let lead; let member; let outsider;
before(async () => {
  srv = await startServer();
  lead = await makeBot(srv, { name: 'Lead Finder', emoji: '🧭', mayMessage: [] });
  member = await makeBot(srv, { name: 'Outreach', emoji: '✉️', mayMessage: [] });
  outsider = await makeBot(srv, { name: 'Weather', emoji: '☀️', mayMessage: [] });
  writeData(path.join(srv.data, 'company.json'), {
    id: 'c1', name: 'Fernhill', start: 'fernhill.app', phase: 'running', startedAt: '2026-10-01T00:00:00Z', goal: '100 paying parents',
    teams: [{ id: 't1', name: 'Growth', bots: [lead.id, member.id], lead: lead.id }],
  });
});
after(() => { srv.unhold(); return srv.stop(); });

// A held run of `bot` (its run token stays valid), found by its own prompt: a note sent to it starts runs of its own.
let n = 0;
async function held(bot, fn) {
  const prompt = `Team check ${++n}`;
  srv.hold();
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } })).data;
  const rec = await srv.nextRun((x) => x.self?.env && x.stdin.includes(prompt), `a run of ${bot.name}`);
  try { await fn({ rec, token: rec.self.env.RUN_TOKEN }); } finally {
    srv.unhold(); srv.release(rec); await srv.finished(run.id);
    await waitFor(async () => !(await srv.api('/runs?limit=50')).data.some((r) => r.status === 'running' || r.status === 'queued'), { what: 'every run ended' });
  }
}

test('a member messages its lead, and is told to ask it for what it needs from the owner', async () => {
  await held(member, async (h) => {
    assert.equal(h.rec.self.env.SELF_TEAM, '1');
    assert.match(h.rec.system, /ask the lead with message_bot \(priority: true\), not the owner/);
    assert.doesNotMatch(h.rec.system, new RegExp(`Bots you may not message yet: [^\\n]*Lead Finder`));
    const r = await self(srv, h.token, 'message', { to: lead.id, message: 'Which school list should I use? The owner has to pick.', priority: false });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });
});

test('a lead messages its members to pass the owner\'s answer on', async () => {
  await held(lead, async (h) => {
    assert.match(h.rec.system, /The owner talks to the team through you/);
    const r = await self(srv, h.token, 'message', { to: member.id, message: 'The owner picked the Leeds list.', priority: false });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });
});

test('a bot outside every team is told nothing of a lead, and messages any bot', async () => {
  await held(outsider, async (h) => {
    assert.equal(h.rec.self.env.SELF_TEAM, '1');
    assert.doesNotMatch(h.rec.system, /The owner talks to the team through you/);
    assert.equal((await self(srv, h.token, 'message', { to: member.id, message: 'hi', priority: false })).data.ok, true);
  });
});
