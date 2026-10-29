// The Company's home as an office floor (#672, ADR 110): the rules of who sits where. This file draws nothing
// (company-home.js does):
//   - a room per team: its lead at the head, the team's asks as one count on the lead, the members that work or ask
//     at a desk (asks first), the idle ones as heads on a bench; a room of more than four bots spans two columns.
//   - the bots in no team, each on its own on the floor.
//   - a team's objective: the objective of the team's colour.
//   - "@Bot text" in Add a task: that bot's task.
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

// The floor: { rooms, loose }. rooms: one per team, in the company's order; loose: the bots in no team, each with `seat`.
function floor(company, bots, info) {
  const teams = company?.teams || [];
  const inTeam = new Set(teams.flatMap((t) => t.bots || []));
  return {
    rooms: teams.map((t) => room(t, bots, info)).filter(Boolean),
    loose: bots.filter((b) => !inTeam.has(b.id)).map((b) => ({ ...b, seat: seatOf(b, info) })),
  };
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

const api = { WIDE, room, floor, objectiveOf, task, seatOf };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.CompanyFloor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
