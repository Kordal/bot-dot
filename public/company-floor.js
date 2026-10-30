// The Company's home as an office floor (#672, ADR 110): the rules of who sits where. This file draws nothing
// (company-home.js does):
//   - a room per team: its lead at the head, the team's asks as one count on the lead, the members that work or ask
//     at a desk (asks first), the idle ones as heads on a bench; a room of more than four bots spans two columns.
//   - only the project's own bots: those of its teams. A bot of the account in none of them is not on it (#816).
//   - a team's objective: the objective of the team's colour.
//   - "@Bot text" in Add a task: that bot's task.
//   - how each objective is shown (#690): its display, its pace against the line to the target, its chart.
// A plain <script>, as window.CompanyFloor; the tests load it with require.

(function (root) {

// A room of more than this many bots spans two columns of the floor.
const WIDE = 4;

// How a bot sits: 'asks' while something of it waits for the owner, 'working' while a run of it goes, else 'idle'.
// info.asks(id): how many things of the bot wait for the owner (its question, its cards); info.working(id).
const seatOf = (b, info) => (info.asks(b.id) > 0 ? 'asks' : info.working(b.id) ? 'working' : 'idle');

// One team's room: { team, lead, count, desks, bench, wide, solo }. lead: its lead bot, with `seat`; count: what the
// team's bots wait on, all of it, shown on the lead; desks: the other bots that ask or work, those that ask first;
// bench: the idle ones. Bots the team names that are gone are left out; a team left with none has no room.
function room(team, bots, info) {
  const byId = new Map(bots.map((b) => [b.id, b]));
  const members = (team.bots || []).map((id) => byId.get(id)).filter(Boolean).map((b) => ({ ...b, seat: seatOf(b, info) }));
  if (!members.length) return null;
  const lead = members.find((b) => b.id === team.lead) || members[0];
  const others = members.filter((b) => b !== lead);
  const count = members.reduce((n, b) => n + info.asks(b.id), 0);
  return {
    team, lead, count,
    desks: [...others.filter((b) => b.seat === 'asks'), ...others.filter((b) => b.seat === 'working')],
    bench: others.filter((b) => b.seat === 'idle'),
    wide: members.length > WIDE,
    solo: members.length === 1,
  };
}

// The floor: { rooms }, one per team, in the company's order. The account's other bots belong to no project: they
// stay in Bots and are not drawn on any project's floor (#816).
function floor(company, bots, info) {
  return { rooms: (company?.teams || []).map((t) => room(t, bots, info)).filter(Boolean) };
}

// A team's objective: the one of its colour (a new team and a new objective take the same colours in the same order),
// or null.
const objectiveOf = (team, objectives) => (objectives || []).find((o) => o.color && team?.color && o.color.toLowerCase() === team.color.toLowerCase()) || null;

// "@Bot text": { text, bot } with the bot whose name follows the @ (the longest that fits, any case), and the rest as
// the task. Anything else is the owner's own task: { text, bot: null }.
function task(input, bots) {
  const text = String(input || '').trim();
  if (!text.startsWith('@')) return { text, bot: null };
  const after = text.slice(1);
  const fits = (bots || [])
    .filter((b) => b.name && after.toLowerCase().startsWith(b.name.toLowerCase()) && /^(\s|$)/.test(after.slice(b.name.length)))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!fits) return { text, bot: null };
  const rest = after.slice(fits.name.length).trim();
  return rest ? { text: rest, bot: fits.id } : { text, bot: null };
}

// ---------- how an objective is shown (#690) ----------
const DAYS = 90;
// The owner's or the Chief's pick, else a pace chart for an objective with a target and its status for one without.
const displayOf = (o) => (['pace', 'bar', 'status'].includes(o?.display) ? o.display : o?.target > 0 ? 'pace' : 'status');

// Where an objective with a target stands against the straight line from 0 on day 1 to `target` on day 90: 'ahead'
// once it is a tenth of the target past the line (or past it at all on day 1, when the line is at 0), 'on' at or past
// the line, else 'behind'. null without a target or a day.
function pace(o, day) {
  if (!(o?.target > 0) || !day) return null;
  const expected = (o.target * (Math.min(day, DAYS) - 1)) / (DAYS - 1);
  const state = o.current >= expected + o.target / 10 || (expected === 0 && o.current > 0) ? 'ahead' : o.current >= expected ? 'on' : 'behind';
  return { state, expected };
}

// The pace chart in a box of 0..100 both ways (y down, as SVG draws it): `line`, the pace from 0 on day 1 to the
// target on day 90; `actual`, the points of the objective's history up to today and `current` today; `ticks`, the x of
// days 30, 60 and 90. The top of the box is the target or the highest value, whichever is more.
function chart(o, day) {
  const today = Math.max(1, Math.min(day || 1, DAYS));
  const points = [...(o.history || []).filter((h) => h.day < today), { day: today, value: o.current }];
  const top = Math.max(o.target, ...points.map((p) => p.value)) || 1;
  const x = (d) => ((d - 1) / (DAYS - 1)) * 100;
  const y = (v) => 100 - (Math.max(0, v) / top) * 100;
  return {
    line: [x(1), y(0), x(DAYS), y(o.target)],
    actual: points.map((p) => [x(p.day), y(p.value)]),
    ticks: [30, 60, 90].map((d) => ({ day: d, x: x(d) })),
  };
}

// Day 1 of a running company, when an objective's chart would be a flat line: the home shows where it starts instead.
const firstDay = (company) => company?.phase === 'running' && (company.day || 0) <= 1;
// The date of the first check-in (day 30), from the day the company started.
const checkinDate = (startedAt) => (startedAt ? new Date(new Date(startedAt).getTime() + 29 * 86_400_000) : null);
// How many of an objective's steps are done.
const stepsDone = (o) => (o?.steps?.length ? o.steps.filter((x) => x.done).length : 0);

// A decision as the owner types it (#694): "Launch in Polish first because most users are Polish" is the decision and
// its reason, split at the first "because" (Polish "bo", "ponieważ") or dash between words. { text, why }.
function decision(input) {
  const typed = String(input || '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s+(?:because|bo|ponieważ|[—–-])\s+(.+)$/i.exec(typed);
  return m ? { text: m[1].replace(/[,;:]$/, '').trim(), why: m[2] } : { text: typed, why: '' };
}

const api = { WIDE, room, floor, objectiveOf, task, seatOf, decision, displayOf, pace, chart, firstDay, checkinDate, stepsDone };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.CompanyFloor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
