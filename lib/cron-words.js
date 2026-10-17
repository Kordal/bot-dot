// A job's schedule in plain words: "0 8-21 * * *" is "Every hour, 08:00 to 21:00". The server says them once,
// as `when` on every job and in the schedule's preview, and each app shows them (docs/api.md). The table every
// app is tested against is test/fixtures/cron-words.json.
//
// A field is the set of values lib/cron.js gives it, so "*/15", "0-59/15" and "0,15,30,45" read the same.
// The first rule that fits gives the words:
//   - text that is not a schedule: "Invalid schedule";
//   - no time or no day that any year has, such as 31 February or the hours "21-8": "Never runs";
//   - one day of the year, how a one-time job is kept: "28 Sep at 07:00";
//   - daily at 02:00, the one listed time with a name of its own: "Nightly at 02:00";
//   - a repeating time, then the days, then the months: "Every 15 min, 08:00 to 18:45, Monday to Friday";
//   - up to six times of day, after the days: "Mondays at 10:00", "Monthly on day 5 at 10:00, in January and July";
//   - more of them in one minute of the hour: "7 times a day, from 01:00 to 21:00";
//   - anything else: "Custom schedule".
// Never the expression, never nothing. The words depend on the schedule alone, not on today: a schedule whose
// next run is more than a year away (Friday the 13th, 29 February) keeps its words.
const cron = require('./cron');

const INVALID = 'Invalid schedule';
const NEVER = 'Never runs';
const CUSTOM = 'Custom schedule';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// The week runs from Monday to Sunday; cron's Sunday is 0.
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const time = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
// "A", "A and B", "A, B and C".
const list = (items, last = 'and') => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`);
const inARow = (nums) => nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
// Three or more that follow each other are a span, "June to August"; the others are listed.
const span = (nums, name) => (nums.length >= 3 && inARow(nums) ? `${name(nums[0])} to ${name(nums.at(-1))}` : list(nums.map(name)));
// Every step-th value from `first`, `count` of them.
const inSteps = (nums, first, step, count) => nums.length === count && nums.every((n, i) => n === first + i * step);
const same = (nums, ...values) => nums.length === values.length && nums.every((n, i) => n === values[i]);

const daysOfMonth = (dom) => `${dom.length === 1 ? 'day' : 'days'} ${span(dom, String)}`;
// A day that has to be both, as the server asks when the day of the month and the weekday are restricted.
const onlyIf = (week) => `only if it is ${same(week, 0, 1, 2, 3, 4) ? 'a weekday' : same(week, 5, 6) ? 'a weekend day' : `a ${list(week.map((d) => WEEK[d]), 'or')}`}`;

// "Every 15 min, 08:00 to 18:45", "Hourly, at minute 5", "Every 2 hours": or null for times that do not repeat evenly.
function repeating(min, hour) {
  const allHours = hour.length === 24;
  const hours = inARow(hour); // one run of hours, a single hour too
  const [m0, m1, h0, h1] = [min[0], min.at(-1), hour[0], hour.at(-1)];
  if (min.length === 60) return allHours ? 'Every minute' : hours ? `Every minute, ${time(h0, 0)} to ${time(h1, 59)}` : null;
  if (min.length > 1) {
    const step = min[1] - m0;
    if (60 % step || m0 >= step || !inSteps(min, m0, step, 60 / step)) return null;
    if (allHours) return m0 === 0 ? `Every ${step} min` : null;
    return hours ? `Every ${step} min, ${time(h0, m0)} to ${time(h1, m1)}` : null;
  }
  const minute = m0 ? `, at minute ${m0}` : '';
  if (allHours) return `Hourly${minute}`;
  const step = hour.length > 1 ? hour[1] - h0 : 0;
  if (step >= 2 && 24 % step === 0 && inSteps(hour, 0, step, 24 / step)) return `Every ${step} hours${minute}`;
  return hours && hour.length >= 7 ? `Every hour, ${time(h0, m0)} to ${time(h1, m0)}` : null;
}

// The words of a schedule the server accepts and that runs: its fields as sorted values.
function words([min, hour, dom, mon, dow]) {
  const week = dow.map((d) => (d + 6) % 7).sort((a, b) => a - b); // from Monday
  const [anyDay, anyWeekday, oneTime] = [dom.length === 31, dow.length === 7, min.length === 1 && hour.length === 1];
  if (oneTime && anyDay && anyWeekday && mon.length === 12 && min[0] === 0 && hour[0] === 2) return 'Nightly at 02:00';
  const months = mon.length === 12 ? '' : `, in ${span(mon, (m) => MONTHS[m - 1])}`;
  // After a repeating time the days follow, in the singular: ", Monday to Friday", ", on day 13, only if it is a Friday".
  const daysAfter = anyDay
    ? (anyWeekday ? '' : `, ${span(week, (d) => WEEK[d])}`)
    : `, on ${daysOfMonth(dom)}${anyWeekday ? '' : `, ${onlyIf(week)}`}`;
  const often = repeating(min, hour);
  if (often) return often + daysAfter + months;
  const times = hour.flatMap((h) => min.map((m) => time(h, m)));
  if (times.length > 6) return min.length === 1 ? `${times.length} times a day, from ${times[0]} to ${times.at(-1)}${daysAfter}${months}` : null;
  // Before fixed times the days come first, in the plural: "Mondays at 10:00".
  const at = `at ${list(times)}${months}`;
  if (!anyDay) return `Monthly on ${daysOfMonth(dom)}${anyWeekday ? ' ' : `, ${onlyIf(week)}, `}${at}`;
  const days = anyWeekday ? 'Daily'
    : same(week, 0, 1, 2, 3, 4) ? 'Weekdays'
      : same(week, 5, 6) ? 'Weekends'
        : week.length >= 3 && inARow(week) ? span(week, (d) => WEEK[d])
          : list(week.map((d) => `${WEEK[d]}s`));
  return `${days} ${at}`;
}

// The schedule `expr` in words.
function describe(expr) {
  let fields;
  // Only whole numbers ever match a minute, an hour or a day, whatever else a field lets through ("0-59/1.5").
  try { fields = cron.parse(expr).map((set) => [...set].filter(Number.isInteger).sort((a, b) => a - b)); } catch { return INVALID; }
  const [min, hour, dom, mon, dow] = fields;
  // It never runs when a field holds nothing, or when none of its months has even the first of its days.
  // Any other schedule runs in some year: each day of the year falls on each weekday, 29 February too.
  if (fields.some((f) => !f.length) || !mon.some((m) => dom[0] <= MONTH_DAYS[m - 1])) return NEVER;
  if ([min, hour, dom, mon].every((f) => f.length === 1) && dow.length === 7) return `${dom[0]} ${MONTHS[mon[0] - 1].slice(0, 3)} at ${time(hour[0], min[0])}`;
  return words(fields) || CUSTOM;
}

module.exports = { describe, INVALID, NEVER, CUSTOM };
