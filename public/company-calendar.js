// The project's calendar (#695, ADR 116): the rules of the floor's Calendar tile and its month. This file draws nothing
// (company-calendar-view.js does):
//   - the week: Monday to Sunday of today's week, the days with something on them marked.
//   - next: what is still to come from today, the earliest first, done to-dos and past check-ins left out.
//   - the month: whole weeks from the Monday on or before its 1st to the Sunday on or after its last day.
// Days are "YYYY-MM-DD" strings; the server sends each item on its day (docs/api.md, The calendar).
// A plain <script>, as window.CompanyCalendar; the tests load it with require.

(function (root) {

// The tile lists this many items to come.
const NEXT = 5;
// A day of the month shows this many items, then "+N".
const IN_DAY = 2;

const two = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
const at = (day) => new Date(`${day}T12:00:00Z`);
function addDays(day, n) { const d = at(day); d.setUTCDate(d.getUTCDate() + n); return dayOf(d); }
// Today on this device's calendar.
const today = (now = new Date()) => `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
// The Monday on or before a day.
const monday = (day) => addDays(day, -((at(day).getUTCDay() + 6) % 7));

// The seven days of a day's week, Monday first.
const week = (day) => Array.from({ length: 7 }, (_, i) => addDays(monday(day), i));

// The month of "YYYY-MM": its days in whole weeks, each { day, out } (out: of the month before or after).
function month(ym) {
  const first = `${ym}-01`;
  const next = at(first); next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(dayOf(next), -1);
  const days = [];
  for (let d = monday(first); d <= last || days.length % 7; d = addDays(d, 1)) days.push({ day: d, out: d.slice(0, 7) !== ym });
  return days;
}
// The month after (n 1) or before (n -1) "YYYY-MM".
function shift(ym, n) { const d = at(`${ym}-01`); d.setUTCMonth(d.getUTCMonth() + n); return dayOf(d).slice(0, 7); }

// The items by their day: Map day -> [items], in the order the server sent them.
function byDay(items) {
  const out = new Map();
  for (const x of Array.isArray(items) ? items : []) { if (!out.has(x.day)) out.set(x.day, []); out.get(x.day).push(x); }
  return out;
}

// What is still to come from `now` (a day): open items only, today's first.
const next = (items, now, n = NEXT) => (Array.isArray(items) ? items : []).filter((x) => x.day >= now && !x.done).slice(0, n);

// Whether an item is the owner's to change on the calendar: only events are; a to-do, a check-in and a job have their
// own places.
const editable = (x) => x.kind === 'event';

const api = { NEXT, IN_DAY, addDays, today, monday, week, month, shift, byDay, next, editable };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.CompanyCalendar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
