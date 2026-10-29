// The company's decisions log (#694): the owner's decisions with a reason and a day, written down on the screen, by
// the Chief in a turn the owner started, by a team's lead from the owner's message, and by botdot at a check-in. Every
// bot in a team reads the last few in its run and the rest with list_project_decisions.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, writeData, heldRun, self } = require('./helpers');
const companyLib = require('../lib/company');

let srv; let lead; let member; let loose;
before(async () => {
  srv = await startServer();
  lead = await makeBot(srv, { name: 'Outreach', emoji: '📣' });
  member = await makeBot(srv, { name: 'Lead Finder', emoji: '🔎' });
  loose = await makeBot(srv, { name: 'Support Triage', emoji: '🧰' });
  await srv.api('/company', { method: 'POST', body: { start: 'fernhill.app' } });
  const c = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), {
    ...c, phase: 'running', startedAt: new Date(Date.now() - 30 * 86_400_000 - 3_600_000).toISOString(),
    teams: [{ id: 't1', name: 'Growth', bots: [lead.id, member.id], lead: lead.id }],
  });
});
after(async () => { await srv.stop(); });

test('the owner adds and removes a decision; the Chief logs one only in a turn the owner started', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('company-decisions'));
  assert.equal((await srv.api('/company/decisions', { method: 'POST', body: { text: '  ' } })).status, 400);
  let r = await srv.api('/company/decisions', { method: 'POST', body: { text: 'Launch in Polish first', why: 'Most of the first users are Polish', by: 'checkin' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const d = r.data.decisions.at(-1);
  assert.deepEqual([d.text, d.why, d.by], ['Launch in Polish first', 'Most of the first users are Polish', 'you']);
  assert.ok(d.at && d.id);
  // No turn of the owner's is going: the Chief's call logs nothing.
  r = await srv.asChief('/company/decisions', { method: 'POST', body: { text: 'Hire a designer' } });
  assert.equal(r.status, 403);
  assert.equal((await srv.api('/company')).data.company.decisions.length, 1);
  assert.equal((await srv.asChief(`/company/decisions/${d.id}`, { method: 'DELETE' })).status, 403);
  r = await srv.api('/company/decisions', { method: 'POST', body: { text: 'No paid ads before day 60' } });
  r = await srv.api(`/company/decisions/${r.data.decisions.at(-1).id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.decisions.map((x) => x.text), ['Launch in Polish first']);
  assert.equal((await srv.api('/company/decisions/nope', { method: 'DELETE' })).status, 404);
});

test("in a turn the owner started, the Chief logs the owner's decision", async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'We stay free until day 60, write it down' } });
  const turn = await srv.nextRun((x) => x.stdin.includes('stay free until day 60'), "the Chief's turn");
  try {
    const r = await srv.asChief('/company/decisions', { method: 'POST', headers: { 'X-Chief-Chat': c.id }, body: { text: 'Stay free until day 60' } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.deepEqual([r.data.decisions.at(-1).text, r.data.decisions.at(-1).by], ['Stay free until day 60', 'chief']);
  } finally { srv.unhold(); srv.release(turn); }
  const last = (await srv.api('/company')).data.company.decisions.at(-1);
  await srv.api(`/company/decisions/${last.id}`, { method: 'DELETE' });
});

test("a check-in's answer is logged as a decision", async () => {
  const r = await srv.api('/company/checkins', { method: 'POST', body: { day: 30, decision: 'change' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data.company.decisions.at(-1);
  assert.deepEqual([d.text, d.by, d.day, d.decision], ['Day 30 check-in: Change direction', 'checkin', 30, 'change']);
});

test("a team's bots get the last decisions in their run and read them with a tool; a bot in no team does not", async () => {
  let { rec, token } = await heldRun(srv, member, 'What next?');
  assert.equal(rec.self.env.SELF_DECISIONS, '1', 'a member reads, and does not log');
  assert.match(rec.system, /The owner's decisions for the project "Fernhill"/);
  assert.match(rec.system, /- \d{4}-\d{2}-\d{2}: Day 30 check-in: Change direction\n- \d{4}-\d{2}-\d{2}: Launch in Polish first \(why: Most of the first users are Polish\)/);
  let r = await self(srv, token, 'decisions', { action: 'list' });
  assert.equal(r.data.ok, true);
  assert.deepEqual(r.data.decisions.map((x) => x.text), ['Day 30 check-in: Change direction', 'Launch in Polish first']);
  assert.equal((await self(srv, token, 'decisions', { action: 'list', limit: 1 })).data.decisions.length, 1);
  r = await self(srv, token, 'decisions', { action: 'add', text: 'Skip the blog' });
  assert.equal(r.data.ok, false, 'a member does not log');
  srv.release(rec);

  ({ rec, token } = await heldRun(srv, loose, 'Hello'));
  assert.equal(rec.self.env.SELF_DECISIONS, '0');
  assert.doesNotMatch(rec.system, /The owner's decisions for the project/);
  assert.equal((await self(srv, token, 'decisions', { action: 'list' })).data.ok, false);
  srv.release(rec);
});

test("the team's lead logs a decision the owner told it in its chat", async () => {
  const { rec, token } = await heldRun(srv, lead, 'We stop cold e-mails, they annoy people');
  assert.equal(rec.self.env.SELF_DECISIONS, '2');
  const r = await self(srv, token, 'decisions', { action: 'add', text: 'Stop cold e-mails', why: 'They annoy people' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual([r.data.decision.text, r.data.decision.by, r.data.decision.bot], ['Stop cold e-mails', 'bot', lead.id]);
  srv.release(rec);
  assert.equal((await srv.api('/company')).data.company.decisions.at(-1).text, 'Stop cold e-mails');
});

test('the record keeps the last 100 decisions and the Chief is told the newest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-'));
  const file = path.join(dir, 'company.json');
  const many = Array.from({ length: 105 }, (_, i) => ({ id: `d${i}`, text: `Decision ${i}`, at: '2026-10-29T08:00:00Z', by: i % 2 ? 'chief' : 'nobody' }));
  fs.writeFileSync(file, JSON.stringify({ id: 'abc', start: 'x', phase: 'running', startedAt: '2026-10-01T09:00:00Z', teams: [{ id: 't', name: 'T', bots: ['b1'] }], decisions: [...many, { text: '' }, 'x'] }));
  const s = companyLib.create({ file, now: () => new Date('2026-10-29T09:00:00Z') });
  const c = s.read();
  assert.equal(c.decisions.length, 100);
  assert.equal(c.decisions[0].text, 'Decision 5');
  assert.deepEqual(c.decisions.slice(-2).map((d) => d.by), ['chief', 'you'], 'an unknown writer is the owner');
  assert.match(s.promptNote(), /latest decisions, newest first[^\n]*log_project_decision\):\n- 2026-10-29: Decision 104\n- 2026-10-29: Decision 103/);
  assert.equal(s.decisionsNote('b1').split('\n').length, 6, 'a bot is told the last five');
  assert.equal(s.decisionsNote('nobody'), '');
  fs.rmSync(dir, { recursive: true, force: true });
});
