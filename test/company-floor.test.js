// The Company's office floor (public/company-floor.js, #672): who gets a desk, the two-column room, the lead's count,
// the bots in no team, a team's objective and "@Bot task". Pure functions, run in node as the page loads them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Floor = require('../public/company-floor.js');

const bot = (id) => ({ id, name: id[0].toUpperCase() + id.slice(1), color: '#378add' });
// info from two lists: the bots that work, and what waits for the owner per bot.
const info = (working = [], asks = {}) => ({ working: (id) => working.includes(id), asks: (id) => asks[id] || 0 });
const ids = (list) => list.map((b) => b.id);

test('room: the lead at the head, the others that ask or work at a desk (asks first), the idle ones on the bench', () => {
  const bots = ['lead', 'idle1', 'work', 'asks', 'idle2'].map(bot);
  const r = Floor.room({ id: 't', bots: ['lead', 'idle1', 'work', 'asks', 'idle2'], lead: 'lead' }, bots, info(['work', 'asks'], { asks: 1 }));
  assert.equal(r.lead.id, 'lead');
  assert.deepEqual(ids(r.desks), ['asks', 'work']);
  assert.deepEqual(r.desks.map((b) => b.seat), ['asks', 'working']);
  assert.deepEqual(ids(r.bench), ['idle1', 'idle2']);
});

test('room: an idle lead stays at the head; it is never on the bench', () => {
  const bots = ['a', 'b'].map(bot);
  const r = Floor.room({ id: 't', bots: ['a', 'b'], lead: 'b' }, bots, info());
  assert.equal(r.lead.id, 'b');
  assert.equal(r.lead.seat, 'idle');
  assert.deepEqual(ids(r.bench), ['a']);
  assert.deepEqual(r.desks, []);
});

test("room: the lead's count is everything the team's bots wait on, its own too", () => {
  const bots = ['a', 'b', 'c'].map(bot);
  assert.equal(Floor.room({ id: 't', bots: ['a', 'b', 'c'], lead: 'a' }, bots, info([], { a: 1, b: 2 })).count, 3);
  assert.equal(Floor.room({ id: 't', bots: ['a', 'b', 'c'], lead: 'a' }, bots, info(['a'])).count, 0);
});

test('room: more than four bots span two columns; a one-bot team is solo (its lead has no crown)', () => {
  const bots = ['a', 'b', 'c', 'd', 'e'].map(bot);
  assert.equal(Floor.room({ id: 't', bots: ['a', 'b', 'c', 'd'], lead: 'a' }, bots, info()).wide, false);
  assert.equal(Floor.room({ id: 't', bots: ['a', 'b', 'c', 'd', 'e'], lead: 'a' }, bots, info()).wide, true);
  assert.equal(Floor.room({ id: 't', bots: ['a'], lead: 'a' }, bots, info()).solo, true);
  assert.equal(Floor.room({ id: 't', bots: ['a', 'b'], lead: 'a' }, bots, info()).solo, false);
});

test('room: a bot that is gone is left out; a lead that is gone gives the head to the first bot; none left, no room', () => {
  const bots = ['a', 'b'].map(bot);
  const r = Floor.room({ id: 't', bots: ['gone', 'b', 'a'], lead: 'gone' }, bots, info());
  assert.equal(r.lead.id, 'b');
  assert.deepEqual(ids(r.bench), ['a']);
  assert.equal(Floor.room({ id: 't', bots: ['gone'], lead: 'gone' }, bots, info()), null);
});

test('floor: one room per team in order, and the bots in no team on their own', () => {
  const bots = ['a', 'b', 'c', 'd'].map(bot);
  const f = Floor.floor({ teams: [{ id: 't2', bots: ['c'], lead: 'c' }, { id: 't1', bots: ['a', 'b'], lead: 'a' }] }, bots, info(['d']));
  assert.deepEqual(f.rooms.map((r) => r.team.id), ['t2', 't1']);
  assert.deepEqual(ids(f.loose), ['d']);
  assert.equal(f.loose[0].seat, 'working');
  assert.deepEqual(Floor.floor(null, bots, info()).rooms, []);
});

test("objectiveOf: the team's objective is the one of its colour, in any case", () => {
  const objectives = [{ id: 'o1', color: '#34c759' }, { id: 'o2', color: '#ff7a45' }];
  assert.equal(Floor.objectiveOf({ color: '#FF7A45' }, objectives).id, 'o2');
  assert.equal(Floor.objectiveOf({ color: '#3aa0ff' }, objectives), null);
  assert.equal(Floor.objectiveOf({ color: '#34c759' }, []), null);
});

test('task: "@Bot text" gives the bot the task, the longest name that fits; anything else is the owner\'s', () => {
  const bots = [{ id: 'lf', name: 'Lead Finder' }, { id: 'l', name: 'Lead' }, { id: 'qa', name: 'QA' }];
  assert.deepEqual(Floor.task('@Lead Finder find 20 leads', bots), { text: 'find 20 leads', bot: 'lf' });
  assert.deepEqual(Floor.task('@lead check the list', bots), { text: 'check the list', bot: 'l' });
  assert.deepEqual(Floor.task('  @qa  test v2.3 ', bots), { text: 'test v2.3', bot: 'qa' });
  assert.deepEqual(Floor.task('@QAx test', bots), { text: '@QAx test', bot: null });
  assert.deepEqual(Floor.task('@QA', bots), { text: '@QA', bot: null });
  assert.deepEqual(Floor.task('Review notes for v2.3', bots), { text: 'Review notes for v2.3', bot: null });
});
