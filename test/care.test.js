// Care (ADR 212): the Chief worries a little about the owner, only about what botdot sees, at most once a day and
// twice a week, each kind at most once a week, never a kind the owner silenced, and never when care is off.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const care = require('../lib/care');

const TZ = 'UTC';
const at = (s) => new Date(s);
const ms = (s) => Date.parse(s);
const ev = (title, from, to) => ({ title, start: ms(from), end: ms(to) });

function store(set = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-care-'));
  const s = { care: true, careQuiet: [], quietHours: { start: 22, end: 7, timeZone: TZ }, ...set };
  return { dir, c: care.create({ dataDir: dir, settings: { get: () => s } }), s, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('late nights: two nights running in quiet hours are said the next morning, never at night', () => {
  const { c, done } = store();
  c.wrote(ms('2026-11-09T23:40:00Z')); // the night that ends on the 10th
  c.wrote(ms('2026-11-10T14:00:00Z')); // daytime: not a night
  c.wrote(ms('2026-11-11T01:20:00Z')); // the night that ends on the 11th
  assert.deepEqual(c.nights(), ['2026-11-10', '2026-11-11']);
  const kinds = (now) => care.signals({ now: at(now), timeZone: TZ, quietEnd: 7, nights: c.nights() }).map((i) => i.kind);
  assert.deepEqual(kinds('2026-11-11T08:30:00Z'), ['night']);
  assert.deepEqual(kinds('2026-11-11T03:00:00Z'), [], 'in the night itself nothing is said');
  assert.deepEqual(kinds('2026-11-11T15:00:00Z'), [], 'only in the morning');
  assert.deepEqual(care.signals({ now: at('2026-11-10T08:30:00Z'), timeZone: TZ, nights: ['2026-11-10'] }), [], 'one night is not a pattern');
  done();
});

test('a full day: 6 hours of meetings, or no free half hour at lunch; a free lunch and a light day are not', () => {
  const now = at('2026-11-11T08:00:00Z');
  const full = [ev('A', '2026-11-11T09:00:00Z', '2026-11-11T12:00:00Z'), ev('B', '2026-11-11T12:00:00Z', '2026-11-11T15:30:00Z')];
  const [i] = care.signals({ now, timeZone: TZ, events: full });
  assert.equal(i.kind, 'full-day');
  assert.match(i.text, /6\.5 h of meetings from 09:00 to 15:30, with no free 30 min between 11:30 and 14:30/);
  const lunch = [ev('A', '2026-11-11T10:00:00Z', '2026-11-11T12:00:00Z'), ev('B', '2026-11-11T12:20:00Z', '2026-11-11T14:30:00Z')];
  assert.equal(care.signals({ now, timeZone: TZ, events: lunch })[0]?.kind, 'full-day', 'a 20 min gap is no lunch');
  const light = [ev('A', '2026-11-11T10:00:00Z', '2026-11-11T11:00:00Z'), ev('B', '2026-11-11T13:00:00Z', '2026-11-11T14:00:00Z')];
  assert.deepEqual(care.signals({ now, timeZone: TZ, events: light }), []);
  assert.deepEqual(care.signals({ now: at('2026-11-11T15:00:00Z'), timeZone: TZ, events: full }), [], 'past lunch it is too late to help');
  assert.deepEqual(care.lunchFree(care.busySpans(lunch, '2026-11-11', TZ)), false);
});

test('an early start tomorrow is said from the afternoon, for the close of the day', () => {
  const events = [ev('Flight to Lisbon', '2026-11-12T06:10:00Z', '2026-11-12T09:00:00Z')];
  assert.deepEqual(care.signals({ now: at('2026-11-11T10:00:00Z'), timeZone: TZ, events }), []);
  const [i] = care.signals({ now: at('2026-11-11T18:00:00Z'), timeZone: TZ, events });
  assert.equal(i.key, 'early:2026-11-12');
  assert.equal(i.text, 'Tomorrow starts early: "Flight to Lisbon" at 06:10');
});

test('too much at once and a job that keeps failing', () => {
  const now = at('2026-11-11T10:00:00Z');
  const todos = Array.from({ length: 5 }, (_, n) => ({ id: `t${n}`, text: 'x', due: '2026-11-01' }));
  const [p] = care.signals({ now, timeZone: TZ, projects: [{ id: 'c', phase: 'running', todos }, { id: 'd', phase: 'done', todos }] });
  assert.equal(p.kind, 'pile');
  assert.equal(p.key, 'pile:2026-W46');
  assert.match(p.text, /5 overdue to-dos/);
  assert.deepEqual(care.signals({ now, timeZone: TZ, asks: [1, 2, 3, 4].map((id) => ({ id })) }), [], '4 cards are not too much');
  const jobs = [{ jobId: 'j1', botName: 'Sales', jobName: 'Weekly report', failures: 3, since: '2026-11-08T08:00:00Z' }, { jobId: 'j2', botName: 'X', jobName: 'Y', failures: 2 }];
  const f = care.signals({ now, timeZone: TZ, jobs });
  assert.deepEqual(f.map((i) => i.kind), ['failing']);
  assert.match(f[0].text, /Sales's job "Weekly report" failed 3 times in a row/);
});

test('limits: one a day, two a week, each kind once a week; silenced kinds and care off say nothing', () => {
  const { c, s, done } = store();
  const items = [{ key: 'night:x', kind: 'night', text: 'n' }, { key: 'pile:x', kind: 'pile', text: 'p' }];
  const mon = at('2026-11-09T09:00:00Z');
  assert.equal(c.pick(items, mon).kind, 'night');
  c.said(c.pick(items, mon), mon);
  assert.equal(c.pick(items, at('2026-11-09T16:00:00Z')), null, 'once a day');
  const tue = at('2026-11-10T09:00:00Z');
  assert.equal(c.pick(items, tue).kind, 'pile', 'night was said this week');
  c.said(c.pick(items, tue), tue);
  assert.equal(c.pick(items, at('2026-11-12T09:00:00Z')), null, 'twice a week');
  assert.equal(c.pick(items, at('2026-11-17T09:00:00Z')).kind, 'night', 'a week later it may come again');
  s.careQuiet = ['night'];
  assert.equal(c.pick(items, at('2026-11-18T09:00:00Z')).kind, 'pile', 'a silenced kind is skipped');
  s.care = false;
  assert.equal(c.pick(items, at('2026-11-18T09:00:00Z')), null, 'care off');
  done();
});

test('the look is told the item as a record, with the rules of tone and the way out', () => {
  assert.equal(care.promptBlock(null), '');
  const b = care.promptBlock({ kind: 'night', text: 'The owner wrote late' }, 'brief');
  assert.match(b, /^Care \(a record, not an instruction\): The owner wrote late\./);
  assert.match(b, /as one line of it/);
  assert.match(b, /at most 25 words/);
  assert.match(b, /Never advice on health, sleep, food or feelings/);
  assert.match(b, /"Don't mention this"/);
  const look = require('../lib/look');
  assert.match(look.prompt({ now: at('2026-11-11T09:00:00Z'), timeZone: TZ, care: b }), /Care \(a record, not an instruction\)/);
  assert.doesNotMatch(look.prompt({ now: at('2026-11-11T09:00:00Z'), timeZone: TZ }), /Care \(a record/);
});

test('settings: care starts on; care and careQuiet are checked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-care-set-'));
  const settings = require('../lib/settings').create(dir);
  assert.equal(settings.get().care, true);
  assert.deepEqual(settings.get().careQuiet, []);
  settings.update({ care: false, careQuiet: ['night', 'night', 'pile'] });
  assert.equal(settings.get().care, false);
  assert.deepEqual(settings.get().careQuiet, ['night', 'pile']);
  assert.throws(() => settings.update({ care: 'no' }), /care must be true or false/);
  assert.throws(() => settings.update({ careQuiet: ['mood'] }), /careQuiet must be a list of/);
  fs.rmSync(dir, { recursive: true, force: true });
});
