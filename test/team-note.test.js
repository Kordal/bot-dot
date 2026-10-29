// A team bot knows its project (#693, ADR 114): every bot in a team is told the project, its 90-day goal, its team,
// the lead and the members' jobs; the lead is also told what leading means. A bot in no team is told nothing.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, writeData } = require('./helpers');
const companyLib = require('../lib/company');

const bots = { l1: { name: 'Lead Finder', job: 'Finds people who may buy' }, m1: { name: 'Outreach', job: 'Writes the first emails' }, m2: { name: 'Support', job: '' } };
const company = (over = {}) => ({ id: 'c1', name: 'Fernhill', start: 'fernhill.app', phase: 'running', startedAt: '2026-10-01T00:00:00Z', goal: '100 paying parents',
  teams: [{ id: 't1', name: 'Growth', bots: ['l1', 'm1', 'm2'], lead: 'l1' }], ...over });

function store(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-note-'));
  const file = path.join(dir, 'company.json');
  if (c) fs.writeFileSync(file, JSON.stringify(c));
  return { s: companyLib.create({ file }), file, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const of = (id) => bots[id] || null;

test('the lead is told the project, the goal, its team with their jobs and what leading means', () => {
  const { s, done } = store(company());
  const note = s.botNote('l1', of);
  assert.match(note, /^You lead team "Growth" in the owner's project "Fernhill"\./);
  assert.match(note, /90-day goal: 100 paying parents/);
  assert.match(note, /Your team: Outreach \(id m1\): Writes the first emails; Support \(id m2\)\./);
  assert.match(note, /split the work among its members with message_bot/);
  assert.match(note, /collect what they send back into one reply/);
  assert.match(note, /never approve anything for the owner/);
  assert.match(note, /may still message any member directly/);
  done();
});

test('in a turn in a group the lead and a member are told to work there by naming, never with message_bot (#759)', () => {
  const { s, done } = store(company());
  const lead = s.botNote('l1', of, { group: true });
  assert.match(lead, /split the work among the members of this group by naming each in your reply/);
  assert.match(lead, /a bot not on them is not in this group/);
  assert.doesNotMatch(lead, /message_bot/);
  const member = s.botNote('m1', of, { group: true });
  assert.match(member, /answer the lead in this group, in your reply/);
  assert.doesNotMatch(member, /send what the lead asks for back/);
  done();
});

test('a member is told who leads it and to ask the owner directly; a bot in no team, or no project, is told nothing', () => {
  const { s, file, done } = store(company());
  const note = s.botNote('m1', of);
  assert.match(note, /^You are on team "Growth" in the owner's project "Fernhill"\. Lead Finder \(id l1\) leads it\./);
  assert.match(note, /Also on it: Lead Finder \(id l1\) \(lead\): Finds people who may buy; Support \(id m2\)\./);
  assert.match(note, /ask the owner directly, not the lead/);
  assert.doesNotMatch(note, /As the lead/);
  assert.equal(s.botNote('x9', of), '');
  fs.rmSync(file);
  assert.equal(s.botNote('l1', of), '');
  done();
});

test('the note follows the team: a new lead, a new goal, a bot that leaves', () => {
  const { s, done } = store(company());
  s.setTeam('t1', { lead: 'm1' });
  assert.match(s.botNote('m1', of), /^You lead team/);
  assert.match(s.botNote('l1', of), /Outreach \(id m1\) leads it/);
  s.patch({ goal: '50 schools' });
  assert.match(s.botNote('l1', of), /90-day goal: 50 schools/);
  s.dropBot('m2');
  assert.equal(s.botNote('m2', of), '');
  assert.doesNotMatch(s.botNote('m1', of), /Support/);
  done();
});

// The fixed words are short (about 500 characters for a lead, 200 for a member), and with every text of the owner's
// at its longest, made of "<" that prints longer, the whole note stays bounded: the bot's prompt is at its cap.
test("the note's length is bounded", () => {
  const { s, done } = store(company({ goal: '' }));
  const fixed = (id) => s.botNote(id, () => null).replace(/\n?Your team: .*|\n?Also on it: .*/g, '');
  assert.ok(fixed('l1').length <= 520, `lead ${fixed('l1').length}`);
  assert.ok(fixed('m1').length <= 260, `member ${fixed('m1').length}`);
  const long = (n) => '<a'.repeat(n);
  const ids = Array.from({ length: 40 }, (_, i) => `b${String(i).padStart(7, '0')}`);
  const many = Object.fromEntries(ids.map((id) => [id, { name: long(60), job: long(200) }]));
  const big = store(company({ name: long(80), goal: long(300), teams: [{ id: 't1', name: long(60), bots: ids, lead: ids[0] }] }));
  const lead = big.s.botNote(ids[0], (id) => many[id]);
  const member = big.s.botNote(ids[1], (id) => many[id]);
  assert.match(lead, /; and 33 more\./, 'six members named');
  assert.ok(!/<a/.test(lead), 'no tag');
  assert.ok(lead.length <= 1400, `lead ${lead.length}`);
  assert.ok(member.length <= 1300, `member ${member.length}`);
  big.done();
  done();
});

let srv; let lead; let member; let alone;
before(async () => {
  srv = await startServer();
  lead = await makeBot(srv, { name: 'Lead Finder', description: 'Finds people who may buy' });
  member = await makeBot(srv, { name: 'Outreach', description: 'Writes the first emails' });
  alone = await makeBot(srv, { name: 'Weather' });
  writeData(path.join(srv.data, 'company.json'), company({ teams: [{ id: 't1', name: 'Growth', bots: [lead.id, member.id], lead: lead.id }] }));
});
after(async () => { await srv.stop(); });

let asked = 0;
async function promptOf(bot) {
  const prompt = `Is there news? (${++asked})`;
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  await srv.finished(r.data.id);
  return (await srv.nextRun((x) => x.stdin.includes(prompt), prompt)).system;
}

test("a run of a team bot carries its note; a bot in no team's does not", async () => {
  const l = await promptOf(lead);
  assert.ok(l.includes(`You lead team "Growth" in the owner's project "Fernhill".`), 'the lead');
  assert.ok(l.includes(`Your team: Outreach (id ${member.id}): Writes the first emails.`));
  const m = await promptOf(member);
  assert.ok(m.includes(`Lead Finder (id ${lead.id}) leads it.`), 'the member');
  assert.doesNotMatch(await promptOf(alone), /team "Growth"|project "Fernhill"/, 'alone');
});
