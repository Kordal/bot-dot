// The project's To-do (#692): the rules of what each filter shows. This file draws nothing (company-home.js does).
//   - All: every open item, You: the owner's open items, Bots: the bots' open items, Done: the done ones, newest first.
//   - Open items by their due day, the earliest first, those without one after them in the order they were added.
//   - A due day is today, tomorrow, late (before today) or later.
// A plain <script>, as window.CompanyTodo; the tests load it with require.

(function (root) {

const FILTERS = ['all', 'you', 'bots', 'done'];
// The Done filter shows this many.
const DONE = 30;

// Today on this device's calendar: "2026-10-29".
function today(at = new Date()) {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

function shown(todos, filter) {
  const all = Array.isArray(todos) ? todos : [];
  if (filter === 'done') return all.filter((t) => t.done).sort((a, b) => String(b.doneAt || b.at || '').localeCompare(String(a.doneAt || a.at || ''))).slice(0, DONE);
  const open = all.filter((t) => !t.done && (filter === 'you' ? !t.bot : filter === 'bots' ? !!t.bot : true));
  return open.map((t, i) => [t, i]).sort(([a, i], [b, j]) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || i - j).map(([t]) => t);
}

function dueKind(due, now = today()) {
  if (!due) return null;
  if (due === now) return 'today';
  if (due < now) return 'late';
  const d = new Date(`${now}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return due === d.toISOString().slice(0, 10) ? 'tomorrow' : 'later';
}

const api = { FILTERS, DONE, today, shown, dueKind };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.CompanyTodo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
