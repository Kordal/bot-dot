// A bot may be in several teams of one project (ADR 184): adding it to a team keeps it in its others, each team keeps
// its own lead, the bot is told each team (or the group's team alone in a team chat), and a lead of several teams names
// which one its report is for.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const companyLib = require('../lib/company');
const Keypad = require('../public/keypad');

const bots = { a: { name: 'Infra Admin', job: 'Keeps the servers up' }, b: { name: 'Writer', job: 'Writes posts' }, c: { name: 'Seller', job: 'Sells' } };
const of = (id) => bots[id] || null;
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-many-'));
  const file = path.join(dir, 'company.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'c1', name: 'Fernhill', start: 'x', phase: 'running', startedAt: '2026-10-01T00:00:00Z',
    teams: [{ id: 't1', name: 'Ops', bots: ['a'], lead: 'a' }, { id: 't2', name: 'Content', bots: ['b'], lead: 'b' }] }));
  return { s: companyLib.create({ file }), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a bot added to a second team stays in its first, and each team keeps its lead', () => {
  const { s, done } = store();
  s.setTeam('t2', { bots: ['b', 'a'] });
  let c = s.read();
  assert.deepEqual(c.teams.map((t) => [t.name, t.bots, t.lead]), [['Ops', ['a'], 'a'], ['Content', ['b', 'a'], 'b']]);
  s.addTeam({ name: 'Sales', bots: ['c', 'a'] });
  c = s.read();
  assert.deepEqual(c.teams.map((t) => t.bots), [['a'], ['b', 'a'], ['c', 'a']]);
  assert.deepEqual(s.teamsOf('a').map((t) => t.name), ['Ops', 'Content', 'Sales']);
  assert.equal(s.teamOf('a').name, 'Ops', 'the team it leads stands for it');
  // Leaving one team keeps the others; a deleted bot leaves every team.
  s.setTeam('t2', { bots: ['b'] });
  assert.deepEqual(s.teamsOf('a').map((t) => t.name), ['Ops', 'Sales']);
  s.dropBot('a');
  assert.deepEqual(s.read().teams.map((t) => [t.name, t.bots]), [['Content', ['b']], ['Sales', ['c']]]);
  done();
});

test('the bot is told each of its teams, or the team of the chat alone', () => {
  const { s, done } = store();
  s.setTeam('t2', { bots: ['b', 'a'] });
  const note = s.botNote('a', of);
  assert.match(note, /You lead team "Ops" in the owner's project "Fernhill"\./);
  assert.match(note, /You are on team "Content" in the owner's project "Fernhill"\. Writer \(id b\) leads it\./);
  assert.match(note, /on several of the project's teams/);
  assert.match(note, /split the work among its members with message_bot/, 'the lead rules, as it leads Ops');
  assert.match(note, /send what the lead asks for back to the lead/, 'the member rules, as it is on Content');
  const inChat = s.botNote('a', of, { group: true, team: 't2' });
  assert.match(inChat, /You are on team "Content"/);
  assert.doesNotMatch(inChat, /Ops|several of the project's teams|split the work/);
  done();
});

test('a lead of several teams names which one its rhythm and report are for', () => {
  const { s, done } = store();
  s.setTeam('t2', { bots: ['b', 'a'], lead: 'a' });
  assert.throws(() => s.setReport('a', 'weekly'), /You lead several teams \("Ops", "Content"\): say which with team/);
  s.setReport('a', 'weekly', 'content');
  s.postReport('a', 'All posts out.', 't2');
  const c = s.read();
  assert.deepEqual(c.teams.map((t) => [t.name, t.report || null, t.lastReport?.text || null]), [['Ops', null, null], ['Content', 'weekly', 'All posts out.']]);
  assert.throws(() => s.setReport('a', 'daily', 'Sales'), /You lead no team called "Sales"/);
  assert.throws(() => s.setReport('b', 'daily'), /You lead no team/);
  done();
});

test("a member's ask is drawn under its lead, unless it leads one of its teams", () => {
  const project = { teams: [{ id: 't1', bots: ['a'], lead: 'a' }, { id: 't2', bots: ['b', 'a', 'c'], lead: 'b' }] };
  assert.equal(Keypad.leadOf(project, 'a'), null);
  assert.equal(Keypad.leadOf(project, 'c'), 'b');
  assert.equal(Keypad.leadOf(project, 'b'), null);
  assert.equal(Keypad.leadOf(project, 'z'), null);
});
