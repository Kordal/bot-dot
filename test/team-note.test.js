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
  assert.match(note, /The owner talks to the team through you/);
  assert.match(note, /answer it yourself only from what the owner already said or decided/);
  assert.match(note, /every member's question in one message, each with the member's name, and pass the owner's answer on with message_bot/);
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
  assert.match(member, /name the lead and ask it, not the owner/);
  assert.match(lead, /The owner talks to the team through you/);
  assert.doesNotMatch(member, /send what the lead asks for back/);
  done();
});

test('a member is told who leads it and to ask the lead, not the owner, for what it needs from the owner (ADR 148); a bot in no team, or no project, is told nothing', () => {
  const { s, file, done } = store(company());
  const note = s.botNote('m1', of);
  assert.match(note, /^You are on team "Growth" in the owner's project "Fernhill"\. Lead Finder \(id l1\) leads it\./);
  assert.match(note, /Also on it: Lead Finder \(id l1\) \(lead\): Finds people who may buy; Support \(id m2\)\./);
  assert.match(note, /When you need something from the owner \(a decision, an answer, a file, a login\), ask the lead with message_bot \(priority: true\), not the owner/);
  assert.match(note, /Ask the owner directly only when they wrote to you themselves or the lead can't be messaged/);
  assert.match(note, /A card only the owner can answer \(ask_permission, ask_override, ask_skill\) is still yours to ask for: then tell the lead/);
  assert.doesNotMatch(note, /ask the owner directly, not the lead/);
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

// The fixed words are short (about 920 characters for a lead, 810 for a member, ADR 148), and with every text of the owner's
// at its longest, made of "<" that prints longer, the whole note stays bounded: the bot's prompt is at its cap.
test("the note's length is bounded", () => {
  const { s, done } = store(company({ goal: '' }));
  const fixed = (id) => s.botNote(id, () => null).replace(/\n?Your team: .*|\n?Also on it: .*/g, '');
  assert.ok(fixed('l1').length <= 920, `lead ${fixed('l1').length}`);
  assert.ok(fixed('m1').length <= 810, `member ${fixed('m1').length}`);
  const long = (n) => '<a'.repeat(n);
  const ids = Array.from({ length: 40 }, (_, i) => `b${String(i).padStart(7, '0')}`);
  const many = Object.fromEntries(ids.map((id) => [id, { name: long(60), job: long(200) }]));
  const big = store(company({ name: long(80), goal: long(300), teams: [{ id: 't1', name: long(60), bots: ids, lead: ids[0] }] }));
  const lead = big.s.botNote(ids[0], (id) => many[id]);
  const member = big.s.botNote(ids[1], (id) => many[id]);
  assert.match(lead, /; and 33 more\./, 'six members named');
  assert.ok(!/<a/.test(lead), 'no tag');
  assert.ok(lead.length <= 1950, `lead ${lead.length}`);
  assert.ok(member.length <= 1900, `member ${member.length}`);
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

// #1089: a note reads company.json once, however many projects there are, not once more per project.
test('a note reads the projects once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-note-'));
  const file = path.join(dir, 'company.json');
  const projects = ['c1', 'c2', 'c3'].map((id) => company({ id, name: id }));
  fs.writeFileSync(file, JSON.stringify({ projects }));
  const s = companyLib.create({ file });
  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (f, ...rest) { if (f === file) reads++; return real.call(this, f, ...rest); };
  try {
    const note = s.botNote('l1', of);
    assert.equal(note.match(/^You lead team/gm).length, 3, 'one per project');
    assert.equal(reads, 1, 'botNote');
    reads = 0; s.decisionsNote('l1'); assert.equal(reads, 1, 'decisionsNote');
    reads = 0; s.promptNote(); assert.equal(reads, 1, 'promptNote');
  } finally { fs.readFileSync = real; fs.rmSync(dir, { recursive: true, force: true }); }
});

// #1080: the project's "Never without asking" reaches every team bot on every run, as the owner edits it, and a bot
// whose card at Create said it asks never is not told it.
test('every team bot is told the never-without-asking list as it is now', () => {
  const { s, done } = store(company({ never: ['E-mail someone new', 'Spend money'] }));
  for (const id of ['l1', 'm1', 'm2']) assert.match(s.botNote(id, of), /Never do these without asking the owner first: E-mail someone new; Spend money\./);
  assert.doesNotMatch(s.botNote('m1', of), /replaces/);
  s.patch({ never: ['Spend money'] });
  assert.doesNotMatch(s.botNote('m1', of), /E-mail someone new/);
  assert.match(s.botNote('m1', of), /Never do these without asking the owner first: Spend money\./);
  s.patch({ never: [] });
  assert.doesNotMatch(s.botNote('m1', of), /without asking/);
  done();
});

test('a bot holding the list Create copied is told the note replaces it, or that it is lifted', () => {
  const { s, done } = store(company({ never: ['Spend money'] }));
  assert.match(s.botNote('m1', of, { copied: true }), /Spend money\. This is the owner's list as it is now: it replaces the one in your own rules\./);
  s.patch({ never: [] });
  assert.match(s.botNote('m1', of, { copied: true }), /The owner lifted the project's list of what never to do without asking: the one in your own rules no longer holds\./);
  done();
});

test("a bot whose card said it asks never is not told the list; a member's owner text is on one line", () => {
  const { s, done } = store(company({ never: ['Spend\nmoney <b>'], proposal: [{ key: 'k1', name: 'Support', description: 'x', asksFirst: 'never', bot: 'm2' }, { key: 'k2', name: 'Outreach', description: 'y', asksFirst: 'rules', bot: 'm1' }] }));
  assert.doesNotMatch(s.botNote('m2', of), /without asking/);
  const note = s.botNote('m1', of);
  assert.match(note, /Never do these without asking the owner first: Spend money/);
  assert.ok(!/<b>/.test(note), 'no tag');
  done();
});

test('a team bot works for its project and never asks which app, also when its rules name several', () => {
  const { s, done } = store(company({ kind: 'site', start: 'fernhill.app', name: 'Fernhill' }));
  const note = s.botNote('m1', of);
  assert.match(note, /Your work here is for "Fernhill" \(fernhill\.app\): a request naming no other app, site or repo is about it; don't ask which, even if your own rules name others\./);
  done();
});

test('in a team chat a bot of several projects is told only that team\'s project; elsewhere, to work for the one the chat is about', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-note-'));
  const file = path.join(dir, 'company.json');
  fs.writeFileSync(file, JSON.stringify({ projects: [
    { id: 'p1', name: 'Qwotz', start: 'x', teams: [{ id: 't1', name: 'Testing', bots: ['b1'], lead: 'b1' }] },
    { id: 'p2', name: 'Mealwise', start: 'y', teams: [{ id: 't2', name: 'Kitchen', bots: ['b2', 'b1'], lead: 'b2' }] },
  ] }));
  const s = companyLib.create({ file });
  const inChat = s.botNote('b1', () => null, { group: true, team: 't1' });
  assert.match(inChat, /You lead team "Testing" in the owner's project "Qwotz"/);
  assert.doesNotMatch(inChat, /Mealwise/);
  assert.doesNotMatch(inChat, /several projects/);
  const own = s.botNote('b1');
  assert.match(own, /Qwotz/);
  assert.match(own, /Mealwise/);
  assert.match(own, /You are on teams of several projects: work for the one this chat or the owner's message is about/);
  fs.rmSync(dir, { recursive: true, force: true });
});
