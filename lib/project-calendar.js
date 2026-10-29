// The project's calendar (#695, ADR 116): what falls on each day between two days, read from the project and its
// bots, never stored. The owner's, the Chief's and the bots' events (company.events), the check-ins of days 30, 60
// and 90, the to-dos with a due day (a repeating one also on the days it will come back) and the scheduled jobs of
// the project's bots from now on. Each app draws the items as they come; days are this machine's calendar days.
const { isDay, addDays, nextDue, today, routineName } = require('./company');
const jobsLib = require('./jobs');

// The longest range one call answers, in days, and the most items of one kind it gives.
const SPAN = 62;
const MAX_ITEMS = 400;
// A job that runs more often than this on a day is one item of that day with its count.
const MAX_RUNS = 96;

const two = (n) => String(n).padStart(2, '0');
const timeOf = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
// The next local midnight after `d`.
const nextMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

// The range asked for, made whole: from today's Monday for five weeks when none is given, never longer than SPAN.
function rangeOf({ from, to } = {}, now = new Date()) {
  const t = today(now);
  const monday = addDays(t, -((new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7));
  const f = isDay(from) ? from : monday;
  let e = isDay(to) && to >= f ? to : addDays(f, 34);
  if (e > addDays(f, SPAN - 1)) e = addDays(f, SPAN - 1);
  return { from: f, to: e };
}

// The days of 30, 60 and 90 of a running project: day 1 the day it started.
function checkins(c) {
  if (!c?.startedAt || c.phase !== 'running') return [];
  const first = today(new Date(c.startedAt));
  return [30, 60, 90].map((n) => {
    const k = c.checkins.find((x) => x.day === n);
    return { kind: 'checkin', day: addDays(first, n - 1), n, ...(k ? { decision: k.decision } : {}) };
  });
}

// A dated to-do on its day; an open repeating one also on the days it will come back (`ahead`), up to `to`.
function todos(c, from, to) {
  const out = [];
  for (const t of c.todos || []) {
    if (!t.due) continue;
    const item = (day, ahead = false) => ({ kind: 'todo', id: t.id, day, title: t.text, ...(t.bot ? { bot: t.bot } : {}), done: !!t.done && !ahead, ...(t.repeat ? { repeat: t.repeat } : {}), ...(ahead ? { ahead: true } : {}) });
    if (t.due >= from && t.due <= to) out.push(item(t.due));
    if (t.done || !t.repeat) continue;
    let d = t.due;
    for (let i = 0; i < 400; i++) {
      d = nextDue(t.repeat, d, d);
      if (d > to) break;
      if (d >= from) out.push(item(d, true));
    }
  }
  return out;
}

// The runs to come of a bot's switched-on, approved jobs: one item a day for each, at its first time that day, with
// `runs` when it starts more than once that day. Never before `now`: a job's past is its runs, not its schedule.
// A routine its team made before #754 is named for its time ("Fridays 11:00"): it shows what its bot does instead.
function jobs(bot, from, to, now, routine = null) {
  const out = [];
  const titleOf = (j) => (routine?.routines && j.name === routine.routines && j.cron === routine.cron ? routineName(routine) : j.name);
  const end = new Date(`${addDays(to, 1)}T00:00:00`);
  const start = new Date(Math.max(new Date(`${from}T00:00:00`).getTime() - 60_000, now.getTime()));
  for (const j of bot.jobs || []) {
    if (!j.enabled || !j.approved) continue;
    let at = jobsLib.nextRun(j, start);
    while (at && at < end && out.length < MAX_ITEMS) {
      const day = today(at);
      const first = at;
      let runs = 1;
      const midnight = nextMidnight(at);
      for (let n = jobsLib.nextRun(j, at); n && n < midnight && runs < MAX_RUNS; n = jobsLib.nextRun(j, n)) runs++;
      out.push({ kind: 'job', id: j.id, day, time: timeOf(first), title: titleOf(j), bot: bot.id, ...(runs > 1 ? { runs } : {}) });
      if (j.at) break;
      at = jobsLib.nextRun(j, new Date(midnight.getTime() - 60_000));
    }
  }
  return out;
}

// Everything between `from` and `to` (both days included), by day and time; the day's untimed items before the
// timed ones. `bots(id)` gives a bot of the project, or null for one that is gone.
function items(c, { from, to, bots = () => null, now = new Date() } = {}) {
  if (!c) return [];
  const ids = [...new Set((c.teams || []).flatMap((t) => t.bots))];
  const all = [
    ...(c.events || []).filter((e) => e.day >= from && e.day <= to).map((e) => ({ kind: 'event', id: e.id, day: e.day, ...(e.time ? { time: e.time } : {}), title: e.title, by: e.by })),
    ...checkins(c).filter((k) => k.day >= from && k.day <= to),
    ...todos(c, from, to),
    ...ids.map(bots).filter(Boolean).flatMap((b) => jobs(b, from, to, now, (c.proposal || []).find((p) => p.bot === b.id))),
  ];
  return all.sort((a, b) => a.day.localeCompare(b.day) || (a.time || '').localeCompare(b.time || '')).slice(0, MAX_ITEMS);
}

// How one item reads in a tool's answer: "2026-10-30 18:00 Launch posts go out (event e1a2, added by Launch Poster)".
function itemLine(x, nameOf = (b) => b) {
  const who = (id) => (id === 'you' ? 'the owner' : id === 'chief' ? 'the Chief of Staff' : nameOf(id));
  const when = `${x.day}${x.time ? ` ${x.time}` : ''}`;
  if (x.kind === 'event') return `${when} ${x.title} (event ${x.id}, added by ${who(x.by)})`;
  if (x.kind === 'checkin') return `${when} Day ${x.n} check-in${x.decision ? ` (the owner chose ${x.decision})` : ''}`;
  if (x.kind === 'todo') return `${when} To-do: ${x.title} (${[x.bot ? `for ${nameOf(x.bot)}` : 'for the owner', x.ahead ? 'comes back' : x.done ? 'done' : `id ${x.id}`].join(', ')})`;
  return `${when} Job "${x.title}" of ${nameOf(x.bot)}${x.runs ? ` (${x.runs} runs that day)` : ''}`;
}

module.exports = { SPAN, MAX_ITEMS, rangeOf, items, itemLine };
