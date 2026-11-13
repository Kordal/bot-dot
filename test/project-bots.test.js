// A bot may belong to a project without a team (ADR 233): the project keeps its own bots in no team, a bot put on one
// of its teams is no longer kept there too, a deleted bot leaves it, and the bot is told the project as any of its
// bots is (its scope, goal and to-do tools), with no team rules.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const companyLib = require('../lib/company');

const bots = { a: { name: 'Infra Admin', job: 'Keeps the servers up' }, b: { name: 'Writer', job: 'Writes posts' }, c: { name: 'Seller', job: 'Sells' } };
const of = (id) => bots[id] || null;
function store(teams = [{ id: 't1', name: 'Ops', bots: ['a'], lead: 'a' }]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bots-'));
  const file = path.join(dir, 'company.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'c1', name: 'Fernhill', start: 'x', phase: 'running', startedAt: '2026-10-01T00:00:00Z', goal: 'Ship it', teams }));
  return { s: companyLib.create({ file }), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('the project keeps its own bots in no team, and a bot on one of its teams is not kept there too', () => {
  const { s, done } = store();
  s.setBots(['b', 'a', 'b']);
  assert.deepEqual(s.read().bots, ['b'], 'a is on Ops already; b once');
  assert.deepEqual(companyLib.membersOf(s.read()), ['a', 'b']);
  assert.ok(s.inProject('b'));
  assert.ok(!s.inProject('c'));
  s.setTeam('t1', { bots: ['a', 'b'] });
  assert.equal(s.read().bots, undefined, 'b went to Ops');
  done();
});

test('a project with no team takes bots, and a deleted bot leaves it', () => {
  const { s, done } = store([]);
  s.setBots(['b', 'c']);
  assert.deepEqual(s.read().bots, ['b', 'c']);
  s.dropBot('b');
  assert.deepEqual(s.read().bots, ['c']);
  s.setBots([]);
  assert.equal(s.read().bots, undefined);
  done();
});

test('the list is checked: ids only, of bots that are there', () => {
  const { s, done } = store([]);
  assert.throws(() => s.setBots('b'), /bots is a list of bot ids/);
  assert.throws(() => s.setBots([1]), /bots is a list of bot ids/);
  assert.throws(() => s.setBots(['zz'], (id) => !!bots[id]), /One of those bots is gone/);
  done();
});

test("a bot in no team is told the project, its scope, goal and to-do, and no team's rules", () => {
  const { s, done } = store([]);
  s.setBots(['b']);
  const note = s.botNote('b', of);
  assert.match(note, /You are a bot of the owner's project "Fernhill", in none of its teams/);
  assert.match(note, /Your work here is for "Fernhill"/);
  assert.match(note, /Ship it/);
  assert.doesNotMatch(note, /You lead team|You are on team|split the work/);
  assert.match(s.todoNote('b'), /list_project_todos/);
  assert.equal(s.botNote('c', of), '', 'a bot of no project has none');
  assert.equal(s.botNote('b', of, { team: 't9', group: true }), '', "a team chat's note is of that team alone");
  done();
});

test("the Chief's note and a mention name the bots in no team", () => {
  const { s, done } = store();
  s.setBots(['b']);
  const name = (id) => of(id)?.name || id;
  assert.match(s.promptNote(name), /Its bots in no team: Writer \(b\)/);
  assert.match(s.mentionFacts(name).text, /Bots in no team: Writer/);
  done();
});
