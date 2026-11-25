// @ts-check
// When the front door asks root's step to switch an account to the version it waits for (#1689, ADR 271). Pure, like
// night-update.js: it is given what the front door knows and the account's answers, and says `switch` or `wait`. The
// front door asks it every minute for each account that waits, and carries out a `switch` with SWITCH-<name> (ADR 053).
//
//   ready   the first idle check.
//   night   an idle check inside the night: 04:00 until the end of the owner's quiet hours (07:00 when they have none),
//           in their quiet hours' time zone. Busy all night: the next night.
//   manual  nothing, unless the owner chose "Tonight" for this version: then as `night`.
//   Whatever the choice, from the deadline (ADR 053) on the owner's choice no longer counts: the first idle check; and
//   24 hours after the deadline it switches anyway (the runs it cuts off carry on, ADR 140). An account that does not
//   answer counts as busy, but not past that.
const NIGHT_START = 4; // the hour the night begins
const NIGHT_END = 7; // the hour it ends when the owner has no quiet hours, or theirs end before it begins
const GRACE_MS = 24 * 3600_000; // how long after the deadline a busy account is waited for
const ASK_AGAIN_MS = 15 * 60_000; // a switch asked is given this long before it is asked again

const time = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);

// Whether the switch was asked less than ASK_AGAIN_MS ago.
const justAsked = (lastAskAt, now) => { const at = time(lastAskAt); return !Number.isNaN(at) && now - at < ASK_AGAIN_MS; };

// The hour (0-23) it is in a time zone; the machine's own when the zone is none or is not one.
function hourIn(timeZone, now) {
  try {
    if (typeof timeZone === 'string' && timeZone) return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  } catch { /* not a time zone */ }
  return new Date(now).getHours();
}

// The hour the night ends: the owner's quiet hours' end. None (`quietHours` missing, or its start the same as its end:
// no hour is quiet) or one that ends by the hour the night begins leave no night, and it is 07:00.
function nightEnd(quietHours) {
  const q = quietHours && typeof quietHours === 'object' ? quietHours : null;
  if (!q || !Number.isInteger(q.end) || q.end < 0 || q.end > 23 || q.start === q.end) return NIGHT_END;
  return q.end > NIGHT_START ? q.end : NIGHT_END;
}

// Whether it is night for the owner at `now` (ms): from NIGHT_START until the end of their quiet hours, in their
// quiet hours' time zone.
function inNight({ timeZone, quietHours, now }) {
  const hour = hourIn(timeZone, now);
  return hour >= NIGHT_START && hour < nightEnd(quietHours);
}

// What the front door must still ask to decide, so that it asks no more than it needs: 'nothing' (decided to wait, no
// one is asked), 'switch' (decided to switch, no one is asked), 'idle' (the account's idle answer decides) or 'night'
// (its time zone and quiet hours, then its idle answer). The same input as plan's, `idle` and `timeZone` aside.
function needs(input) {
  const { when, waiting, tonight = false, lastAskAt = null, now } = input;
  const deadline = time(waiting?.deadline);
  if (!waiting || Number.isNaN(deadline)) return 'nothing';
  if (justAsked(lastAskAt, now)) return 'nothing';
  if (now >= deadline + GRACE_MS) return 'switch';
  if (now >= deadline) return 'idle';
  if (when === 'ready') return 'idle';
  if (when === 'night' || tonight) return 'night';
  return 'nothing';
}

// The decision: { action: 'switch' | 'wait', why }. `why` is what the front door writes in its log and audit entry.
// when: the owner's choice; waiting: { version, since, deadline } (ISO) or null; tonight: they chose "Tonight" for this
// version; idle: the account's own answer, true, false, or null when it did not answer; timeZone and quietHours: the
// owner's, from the account's settings; lastAskAt: when the switch was last asked (ISO) or null; now: ms.
function plan(input) {
  const { when, waiting, tonight = false, idle = null, timeZone, quietHours, now } = input;
  const need = needs(input);
  if (need === 'switch') return { action: 'switch', why: 'past the deadline' };
  if (!waiting) return { action: 'wait', why: 'nothing waits' };
  if (need === 'nothing') return { action: 'wait', why: justAsked(input.lastAskAt, now) ? 'asked' : 'the owner decides' };
  const late = now >= time(waiting.deadline);
  if (!late && need === 'night' && !inNight({ timeZone, quietHours, now })) return { action: 'wait', why: 'not night' };
  if (idle !== true) return { action: 'wait', why: 'busy' };
  if (late) return { action: 'switch', why: 'idle, past the deadline' };
  return { action: 'switch', why: need === 'night' ? 'idle, at night' : 'idle' };
}

module.exports = { plan, needs, inNight, nightEnd, hourIn, NIGHT_START, NIGHT_END, GRACE_MS, ASK_AGAIN_MS };
