// Minimal 5-field cron: "min hour day-of-month month day-of-week".
// Supports *, numbers, lists (1,2), ranges (1-5) and steps (*/15, 1-10/2).

const RANGES = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6],  // day of week (0 = Sunday; 7 also accepted)
];

function parseField(field, [min, max]) {
  const values = new Set();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    let lo, hi;
    if (rangePart === '*') {
      [lo, hi] = [min, max];
    } else if (rangePart.includes('-')) {
      [lo, hi] = rangePart.split('-').map(Number);
    } else {
      lo = Number(rangePart);
      hi = stepPart ? max : lo;
    }
    if (![lo, hi, step].every(Number.isFinite) || step < 1) throw new Error(`Bad cron field "${field}"`);
    // Refused at the first value out of range: a field like "0-16000000" or "Infinity" ends here, not after
    // millions of values or never.
    for (let v = lo; v <= hi; v += step) {
      const value = max === 6 && v === 7 ? 0 : v;
      if (value < min || value > max) throw new Error(`Value ${value} out of range in "${field}"`);
      values.add(value);
    }
  }
  return values;
}

// Parsed expressions, kept (jobs are checked every few seconds and listed often).
const parsedCache = new Map();
function parse(expr) {
  const key = String(expr || '').trim();
  let p = parsedCache.get(key);
  if (!p) {
    p = parseExpr(key);
    if (parsedCache.size > 500) parsedCache.clear();
    parsedCache.set(key, p);
  }
  return p;
}

function parseExpr(expr) {
  const fields = String(expr || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Cron needs 5 fields: min hour day month weekday');
  const parsed = fields.map((f, i) => parseField(f, RANGES[i]));
  // A job at a fixed time of day, not every minute or every hour: one whose minute and hour are not "*" (due).
  parsed.fixed = !fields[0].startsWith('*') && !fields[1].startsWith('*');
  return parsed;
}

function matches(expr, date = new Date()) {
  return matchesParsed(parse(expr), date);
}

function matchesParsed(p, date) {
  return matchesLocal(p, date.getTime() - date.getTimezoneOffset() * 60_000);
}

// local: a local time as milliseconds, read with the UTC getters. It can be a time the clock jumped over.
function matchesLocal([min, hour, dom, mon, dow], local) {
  const d = new Date(local);
  return (
    min.has(d.getUTCMinutes()) &&
    hour.has(d.getUTCHours()) &&
    dom.has(d.getUTCDate()) &&
    mon.has(d.getUTCMonth() + 1) &&
    dow.has(d.getUTCDay())
  );
}

// Whether a job on this schedule starts at this minute: as matches, but a job at a fixed time starts once a day
// when daylight saving time moves the clock, as in classic cron. In the hour the clock repeats only the first copy
// of its time counts; a time the clock jumps over is due at the jump. A job whose minute or hour is "*" goes by the
// clock: in both copies of a repeated hour, and not in a skipped one.
const MIN = 60_000;
// The start of the minute `date` is in. Not setSeconds: in the hour the clock repeats it moves back to the first copy.
const minuteOf = (date) => new Date(Math.floor(new Date(date).getTime() / MIN) * MIN);
const SHIFT = 3 * 3600_000; // no clock moves by more than this
const offsetAt = (t) => -new Date(t).getTimezoneOffset(); // minutes ahead of UTC
function due(expr, date = new Date()) {
  return dueParsed(parse(expr), date);
}

function dueParsed(p, date) {
  const t = minuteOf(date).getTime();
  const offset = offsetAt(t);
  if (matchesLocal(p, t + offset * MIN)) return !(p.fixed && repeated(t, offset));
  if (!p.fixed) return false;
  // The clock jumped forward at this minute: the local minutes it jumped over come due now.
  const jump = offset - offsetAt(t - MIN);
  for (let k = 1; k <= jump; k++) if (matchesLocal(p, t + (offset - k) * MIN)) return true;
  return false;
}

// Whether this minute's local time came once already: the clock went back since, and an earlier minute showed it.
function repeated(t, offset) {
  const before = offsetAt(t - SHIFT);
  if (before <= offset) return false;
  return offsetAt(t - (before - offset) * MIN) === before;
}

// The next minute after `from` at which a job on this schedule starts (due), searching up to ~1 year ahead.
function next(expr, from = new Date()) {
  const p = parse(expr);
  let d = nextMatch(p, from);
  if (!p.fixed) return d;
  while (d && repeated(d.getTime(), offsetAt(d))) d = nextMatch(p, d);
  return jumpDue(p, from, d ? d.getTime() : from.getTime() + 525600 * MIN) || d;
}

// The first minute after `from`, up to `until`, at which the clock jumps forward over a time of this job, or null.
// Looked for a day at a time: no clock moves twice in a day.
function jumpDue(p, from, until) {
  const DAY = 1440 * MIN;
  for (let a = minuteOf(from).getTime(); a < until; a += DAY) {
    let b = Math.min(a + DAY, until);
    if (offsetAt(b) <= offsetAt(a)) continue;
    let lo = a;
    while (b - lo > MIN) { const mid = lo + Math.floor((b - lo) / 2 / MIN) * MIN; if (offsetAt(mid) === offsetAt(a)) lo = mid; else b = mid; }
    if (dueParsed(p, new Date(b))) return new Date(b);
  }
  return null;
}

// Next matching minute after `from`, searching up to ~1 year ahead. Skips whole months, days and hours
// that can't match instead of trying every minute.
function nextMatch([min, hour, dom, mon, dow], from) {
  // Minutes of time, not of the clock: a repeated hour is gone through twice.
  const d = minuteOf(from);
  const end = d.getTime() + 525600 * MIN;
  d.setTime(d.getTime() + MIN);
  while (d.getTime() <= end) {
    if (!mon.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    if (!dom.has(d.getDate()) || !dow.has(d.getDay())) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!min.has(d.getMinutes())) { d.setTime(d.getTime() + MIN); continue; }
    return d;
  }
  return null;
}

module.exports = { parse, matches, due, next, minuteOf };
