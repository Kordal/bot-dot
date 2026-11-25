// The front door's plan for switching an account to the version it waits for (#1689, ADR 271): pure, from the owner's
// "when", what waits and since when, the deadline, the owner's "Tonight", the account's idle answer, their time zone and
// quiet hours, and the clock.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plan, needs, inNight, NIGHT_START, NIGHT_END, GRACE_MS, ASK_AGAIN_MS } = require('../lib/front-door/switch-plan');

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// 04:30 on Wednesday 25 November 2026 in Tokyo (UTC+9): 19:30 UTC the day before, 14:30 in New York (UTC-5, no daylight saving then).
const AT = Date.parse('2026-11-24T19:30:00Z');
const since = new Date(AT - 2 * DAY).toISOString();
const deadline = new Date(AT + 5 * DAY).toISOString(); // not yet
const past = new Date(AT - 3 * HOUR).toISOString(); // three hours ago
const base = { when: 'night', waiting: { version: 'abc1234', since, deadline }, tonight: false, idle: true, timeZone: 'Asia/Tokyo', quietHours: { start: 22, end: 7 }, lastAskAt: null, now: AT };
const at = (iso, extra = {}) => ({ ...base, now: Date.parse(iso), ...extra });
const decide = (extra) => plan({ ...base, ...extra });

test('nothing waits: nothing to switch', () => {
  assert.deepEqual(decide({ waiting: null }), { action: 'wait', why: 'nothing waits' });
});

test('"as soon as it\'s ready": at the first idle check, at any hour', () => {
  for (const timeZone of ['Asia/Tokyo', 'UTC', 'America/New_York']) {
    assert.deepEqual(decide({ when: 'ready', timeZone }), { action: 'switch', why: 'idle' }, timeZone);
  }
  assert.equal(decide({ when: 'ready', idle: false }).action, 'wait', 'busy: later');
  assert.equal(decide({ when: 'ready', idle: null }).action, 'wait', 'an account that does not answer counts as busy');
});

test('"at night, when idle": only inside the night window, and only when idle', () => {
  assert.deepEqual(decide(), { action: 'switch', why: 'idle, at night' });
  assert.deepEqual(decide({ idle: false }), { action: 'wait', why: 'busy' }, 'busy all window: the next night');
  assert.deepEqual(decide({ idle: null }), { action: 'wait', why: 'busy' });
  assert.deepEqual(decide({ timeZone: 'UTC' }), { action: 'wait', why: 'not night' }, '19:30 in UTC');
  assert.deepEqual(decide({ timeZone: 'America/New_York' }), { action: 'wait', why: 'not night' }, '14:30 there');
});

test('the night window is from 04:00 until the end of the owner\'s quiet hours, in their time zone', () => {
  const hours = (timeZone, quietHours) => {
    const out = [];
    for (let h = 0; h < 24; h++) if (inNight({ timeZone, quietHours, now: Date.UTC(2026, 10, 25, h, 30) })) out.push(h);
    return out;
  };
  assert.deepEqual(hours('UTC', { start: 22, end: 7 }), [4, 5, 6], '04:00 to 07:00');
  assert.deepEqual(hours('UTC', { start: 23, end: 9 }), [4, 5, 6, 7, 8], 'quiet hours that end at 09:00');
  assert.deepEqual(hours('UTC', null), [4, 5, 6], 'no quiet hours known: 07:00');
  assert.deepEqual(hours('UTC', { start: 8, end: 8 }), [4, 5, 6], 'a start that is the end is no quiet hours: 07:00');
  assert.deepEqual(hours('UTC', { start: 22, end: 3 }), [4, 5, 6], 'quiet hours that end before 04:00 leave no window: 07:00');
  assert.deepEqual(hours('UTC', { start: 22, end: 4 }), [4, 5, 6], 'ending at 04:00: the same');
  // Another zone moves the window on the clock: Tokyo is nine hours ahead of UTC.
  assert.deepEqual(hours('Asia/Tokyo', { start: 22, end: 7 }), [19, 20, 21], '04:00 to 07:00 in Tokyo is 19:00 to 22:00 UTC');
  assert.deepEqual(hours('America/New_York', { start: 22, end: 7 }), [9, 10, 11], '04:00 to 07:00 in New York (UTC-5)');
  assert.equal(NIGHT_START, 4);
  assert.equal(NIGHT_END, 7);
});

test('the edges of the window: 04:00 is in, the end of the quiet hours is out', () => {
  const tokyo = (clock, extra = {}) => plan(at(`2026-11-25T${clock}+09:00`, extra));
  assert.equal(tokyo('03:59:59').action, 'wait');
  assert.equal(tokyo('04:00:00').action, 'switch');
  assert.equal(tokyo('06:59:59').action, 'switch');
  assert.equal(tokyo('07:00:00').action, 'wait');
  assert.equal(tokyo('08:30:00', { quietHours: { start: 23, end: 9 } }).action, 'switch', 'quiet hours until 09:00');
  assert.equal(tokyo('09:00:00', { quietHours: { start: 23, end: 9 } }).action, 'wait');
});

test('a time zone that is not one is the machine\'s clock', () => {
  const now = Date.UTC(2026, 10, 25, 5, 30);
  const hour = new Date(now).getHours();
  for (const timeZone of [undefined, null, '', 'Mars/Olympus']) {
    assert.equal(inNight({ timeZone, quietHours: { start: 22, end: 7 }, now }), hour >= 4 && hour < 7, String(timeZone));
  }
});

test('"when I say": it waits for the owner, unless they chose "Tonight" for this version: then as at night', () => {
  assert.deepEqual(decide({ when: 'manual' }), { action: 'wait', why: 'the owner decides' });
  assert.deepEqual(decide({ when: 'manual', tonight: true }), { action: 'switch', why: 'idle, at night' });
  assert.deepEqual(decide({ when: 'manual', tonight: true, idle: false }), { action: 'wait', why: 'busy' });
  assert.deepEqual(decide({ when: 'manual', tonight: true, timeZone: 'UTC' }), { action: 'wait', why: 'not night' });
});

test('"Tonight" is as good as "at night" for the other choices', () => {
  for (const when of ['night', 'ready']) assert.equal(decide({ when, tonight: true }).action, 'switch', when);
  assert.deepEqual(decide({ when: 'night', tonight: true, timeZone: 'UTC' }), { action: 'wait', why: 'not night' });
});

test('from the deadline on: the first idle check, whatever the choice and the hour', () => {
  const late = { waiting: { version: 'abc1234', since, deadline: past } };
  for (const when of ['ready', 'night', 'manual']) {
    for (const timeZone of ['Asia/Tokyo', 'UTC']) {
      assert.deepEqual(decide({ ...late, when, timeZone }), { action: 'switch', why: 'idle, past the deadline' }, `${when} ${timeZone}`);
    }
  }
  assert.deepEqual(decide({ ...late, when: 'manual', idle: false }), { action: 'wait', why: 'busy' });
  assert.deepEqual(decide({ ...late, when: 'manual', idle: null }), { action: 'wait', why: 'busy' }, 'one that does not answer counts as busy');
  assert.equal(decide({ when: 'manual', idle: true }).action, 'wait', 'before the deadline it is the owner\'s');
});

test('24 hours after the deadline it switches anyway, busy or not answering', () => {
  const justUnder = { waiting: { version: 'abc1234', since, deadline: new Date(AT - GRACE_MS + 60_000).toISOString() } };
  const exactly = { waiting: { version: 'abc1234', since, deadline: new Date(AT - GRACE_MS).toISOString() } };
  for (const idle of [false, null]) {
    assert.equal(decide({ ...justUnder, when: 'manual', idle }).action, 'wait', `a minute short, ${idle}`);
    assert.deepEqual(decide({ ...exactly, when: 'manual', idle }), { action: 'switch', why: 'past the deadline' }, `24 hours, ${idle}`);
  }
  assert.equal(GRACE_MS, DAY);
  assert.deepEqual(decide({ ...exactly, when: 'night', idle: false, timeZone: 'UTC' }), { action: 'switch', why: 'past the deadline' }, 'at any hour');
});

test('it does not ask again at once: the last ask is not forgotten', () => {
  const lastAskAt = new Date(AT - ASK_AGAIN_MS + 1000).toISOString();
  assert.deepEqual(decide({ lastAskAt }), { action: 'wait', why: 'asked' });
  assert.equal(decide({ lastAskAt: new Date(AT - ASK_AGAIN_MS).toISOString() }).action, 'switch', 'long enough ago');
  const exactly = { waiting: { version: 'abc1234', since, deadline: new Date(AT - 2 * DAY).toISOString() } };
  assert.equal(decide({ ...exactly, lastAskAt }).action, 'wait', 'also past the grace');
  assert.equal(decide({ lastAskAt: 'not a time' }).action, 'switch');
});

test('what a decision needs to ask the account: nothing, its idle answer, or its time zone and quiet hours too', () => {
  const need = (extra) => needs({ ...base, ...extra });
  assert.equal(need({ waiting: null }), 'nothing');
  assert.equal(need({ when: 'manual' }), 'nothing', 'the owner decides: no one is asked');
  assert.equal(need({ lastAskAt: new Date(AT - 1000).toISOString() }), 'nothing');
  assert.equal(need({ when: 'ready' }), 'idle');
  assert.equal(need({ when: 'night' }), 'night');
  assert.equal(need({ when: 'manual', tonight: true }), 'night');
  const late = { waiting: { version: 'abc1234', since, deadline: past } };
  assert.equal(need({ ...late, when: 'manual' }), 'idle', 'past the deadline the hour does not matter');
  assert.equal(need({ ...late, when: 'night' }), 'idle');
  assert.equal(need({ waiting: { version: 'abc1234', since, deadline: new Date(AT - GRACE_MS).toISOString() } }), 'switch', 'asks no one: it switches');
});
