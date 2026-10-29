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

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const time = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

// The words of each language (ADR 108). Polish puts a day or a month in another case after "od", "do" and "w",
// which the dictionary's one text per English key can't say, so each language here has its own phrases. The week
// runs from Monday to Sunday (index 0 is Monday); a month's index 0 is January.
const EN = (() => {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return {
    invalid: INVALID, never: NEVER, custom: CUSTOM, and: 'and', or: 'or',
    span: (a, b) => `${a} to ${b}`,
    months: { span: (a, b) => `in ${MONTHS[a]} to ${MONTHS[b]}`, list: (l) => `in ${l(MONTHS)}` },
    // After a repeating time the days follow, in the singular: ", Monday to Friday".
    daysAfter: { span: (a, b) => `${WEEK[a]} to ${WEEK[b]}`, list: (l) => l(WEEK) },
    // Before fixed times the days come first, in the plural: "Mondays at 10:00".
    daysBefore: { span: (a, b) => `${WEEK[a]} to ${WEEK[b]}`, list: (l) => l(WEEK.map((d) => `${d}s`)) },
    daily: 'Daily', weekdays: 'Weekdays', weekends: 'Weekends', nightly: 'Nightly at 02:00',
    daysOfMonth: (n, text) => `${n === 1 ? 'day' : 'days'} ${text}`,
    onDays: (text) => `on ${text}`,
    onlyIf: (which) => `only if it is ${which}`, weekday: 'a weekday', weekendDay: 'a weekend day', aDay: (l) => `a ${l(WEEK)}`,
    at: (times) => `at ${times}`,
    monthly: (days) => `Monthly on ${days}`,
    once: (day, month, at) => `${day} ${MONTHS[month].slice(0, 3)} at ${at}`,
    everyMinute: 'Every minute', everyMin: (n) => `Every ${n} min`, hourly: 'Hourly', everyHour: 'Every hour', everyHours: (n) => `Every ${n} hours`,
    between: (a, b) => `${a} to ${b}`, atMinute: (m) => `at minute ${m}`,
    timesADay: (n, a, b) => `${n} times a day, from ${a} to ${b}`,
  };
})();
const PL = (() => {
  const MONTH_OF = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const MONTH_IN = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'];
  const DAY = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
  const DAY_OF = ['poniedziałku', 'wtorku', 'środy', 'czwartku', 'piątku', 'soboty', 'niedzieli'];
  const DAYS = ['poniedziałki', 'wtorki', 'środy', 'czwartki', 'piątki', 'soboty', 'niedziele'];
  const inDays = (l) => `w ${l(DAYS)}`.replace(/^w w/, 'we w'); // "we wtorki"
  return {
    invalid: 'Nieprawidłowy harmonogram', never: 'Nigdy się nie uruchamia', custom: 'Własny harmonogram', and: 'i', or: 'lub',
    span: (a, b) => `od ${a} do ${b}`,
    months: { span: (a, b) => `od ${MONTH_OF[a]} do ${MONTH_OF[b]}`, list: (l) => `w ${l(MONTH_IN)}` },
    daysAfter: { span: (a, b) => `od ${DAY_OF[a]} do ${DAY_OF[b]}`, list: inDays },
    daysBefore: { span: (a, b) => `Od ${DAY_OF[a]} do ${DAY_OF[b]}`, list: (l) => { const s = inDays(l); return s[0].toUpperCase() + s.slice(1); } },
    daily: 'Codziennie', weekdays: 'W dni robocze', weekends: 'W weekendy', nightly: 'Co noc o 02:00',
    daysOfMonth: (n, text) => `${n === 1 ? 'dnia' : 'dni'} ${text}`,
    onDays: (text) => text,
    onlyIf: (which) => `tylko gdy to ${which}`, weekday: 'dzień roboczy', weekendDay: 'dzień weekendu', aDay: (l) => l(DAY),
    at: (times) => `o ${times}`,
    monthly: (days) => `Co miesiąc ${days}`,
    once: (day, month, at) => `${day} ${MONTH_OF[month]} o ${at}`,
    everyMinute: 'Co minutę', everyMin: (n) => `Co ${n} min`, hourly: 'Co godzinę', everyHour: 'Co godzinę', everyHours: (n) => `Co ${n} godz.`,
    between: (a, b) => `od ${a} do ${b}`, atMinute: (m) => `w minucie ${m}`,
    timesADay: (n, a, b) => `${n} razy dziennie, od ${a} do ${b}`,
  };
})();
const PHRASES = { en: EN, pl: PL };

const inARow = (nums) => nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
// Every step-th value from `first`, `count` of them.
const inSteps = (nums, first, step, count) => nums.length === count && nums.every((n, i) => n === first + i * step);
const same = (nums, ...values) => nums.length === values.length && nums.every((n, i) => n === values[i]);

// The words in one language: "A", "A and B", "A, B and C"; and three or more that follow each other as a span,
// "June to August", the others listed.
function speaker(P) {
  const list = (items, last = P.and) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`);
  const pick = (nums, way) => (nums.length >= 3 && inARow(nums) ? way.span(nums[0], nums.at(-1)) : way.list((names) => list(nums.map((n) => names[n]))));
  const daysOfMonth = (dom) => P.daysOfMonth(dom.length, dom.length >= 3 && inARow(dom) ? P.span(dom[0], dom.at(-1)) : list(dom.map(String)));
  // A day that has to be both, as the server asks when the day of the month and the weekday are restricted.
  const onlyIf = (week) => P.onlyIf(same(week, 0, 1, 2, 3, 4) ? P.weekday : same(week, 5, 6) ? P.weekendDay : P.aDay((names) => list(week.map((d) => names[d]), P.or)));

  // "Every 15 min, 08:00 to 18:45", "Hourly, at minute 5", "Every 2 hours": or null for times that do not repeat evenly.
  function repeating(min, hour) {
    const allHours = hour.length === 24;
    const hours = inARow(hour); // one run of hours, a single hour too
    const [m0, m1, h0, h1] = [min[0], min.at(-1), hour[0], hour.at(-1)];
    if (min.length === 60) return allHours ? P.everyMinute : hours ? `${P.everyMinute}, ${P.between(time(h0, 0), time(h1, 59))}` : null;
    if (min.length > 1) {
      const step = min[1] - m0;
      if (60 % step || m0 >= step || !inSteps(min, m0, step, 60 / step)) return null;
      if (allHours) return m0 === 0 ? P.everyMin(step) : null;
      return hours ? `${P.everyMin(step)}, ${P.between(time(h0, m0), time(h1, m1))}` : null;
    }
    const minute = m0 ? `, ${P.atMinute(m0)}` : '';
    if (allHours) return `${P.hourly}${minute}`;
    const step = hour.length > 1 ? hour[1] - h0 : 0;
    if (step >= 2 && 24 % step === 0 && inSteps(hour, 0, step, 24 / step)) return `${P.everyHours(step)}${minute}`;
    return hours && hour.length >= 7 ? `${P.everyHour}, ${P.between(time(h0, m0), time(h1, m0))}` : null;
  }

  // The words of a schedule the server accepts and that runs: its fields as sorted values.
  function words([min, hour, dom, mon, dow]) {
    const week = dow.map((d) => (d + 6) % 7).sort((a, b) => a - b); // from Monday
    const [anyDay, anyWeekday, oneTime] = [dom.length === 31, dow.length === 7, min.length === 1 && hour.length === 1];
    if (oneTime && anyDay && anyWeekday && mon.length === 12 && min[0] === 0 && hour[0] === 2) return P.nightly;
    const months = mon.length === 12 ? '' : `, ${pick(mon.map((m) => m - 1), P.months)}`;
    // After a repeating time the days follow: ", Monday to Friday", ", on day 13, only if it is a Friday".
    const daysAfter = anyDay
      ? (anyWeekday ? '' : `, ${pick(week, P.daysAfter)}`)
      : `, ${P.onDays(daysOfMonth(dom))}${anyWeekday ? '' : `, ${onlyIf(week)}`}`;
    const often = repeating(min, hour);
    if (often) return often + daysAfter + months;
    const times = hour.flatMap((h) => min.map((m) => time(h, m)));
    if (times.length > 6) return min.length === 1 ? `${P.timesADay(times.length, times[0], times.at(-1))}${daysAfter}${months}` : null;
    // Before fixed times the days come first: "Mondays at 10:00".
    const at = `${P.at(list(times))}${months}`;
    if (!anyDay) return `${P.monthly(daysOfMonth(dom))}${anyWeekday ? ' ' : `, ${onlyIf(week)}, `}${at}`;
    const days = anyWeekday ? P.daily
      : same(week, 0, 1, 2, 3, 4) ? P.weekdays
        : same(week, 5, 6) ? P.weekends
          : pick(week, P.daysBefore);
    return `${days} ${at}`;
  }
  return words;
}

// The schedule `expr` in words, in English (what every job's `when` says) or in the owner's language.
function describe(expr, lang = 'en') {
  const P = PHRASES[lang] || EN;
  let fields;
  // Only whole numbers ever match a minute, an hour or a day, whatever else a field lets through ("0-59/1.5").
  try { fields = cron.parse(expr).map((set) => [...set].filter(Number.isInteger).sort((a, b) => a - b)); } catch { return P.invalid; }
  const [min, hour, dom, mon, dow] = fields;
  // It never runs when a field holds nothing, or when none of its months has even the first of its days.
  // Any other schedule runs in some year: each day of the year falls on each weekday, 29 February too.
  if (fields.some((f) => !f.length) || !mon.some((m) => dom[0] <= MONTH_DAYS[m - 1])) return P.never;
  if ([min, hour, dom, mon].every((f) => f.length === 1) && dow.length === 7) return P.once(dom[0], mon[0] - 1, time(hour[0], min[0]));
  return speaker(P)(fields) || P.custom;
}

module.exports = { describe, INVALID, NEVER, CUSTOM };
