// A bot's live runs above its message box on the web page (#501). With two or three runs going at once (ADR 062)
// each is a row in the look of the plan card (plan.js): a spinner in the bot's colour, what it was asked, what it
// is doing now (its working line, in the server's words), how long it has run, and Stop for that run. With one
// run the status line under the chat says it, as before (opening-line.js); this card is not drawn then.
// A row whose run ended shows a check, then folds away. `/btw` side runs and script runs are not listed: they are
// not counted in the bot's `runningCount` either.
// A plain <script>, as window.LiveRuns; the tests load it the same way.

(function (root) {

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The runs of a bot that are listed: those going, not a side question or a script, in the order they started.
function listed(runs, botId) {
  return (Array.isArray(runs) ? runs : [])
    .filter((r) => r && r.botId === botId && r.status === 'running' && r.kind !== 'script' && r.btw !== true)
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)) || String(a.id).localeCompare(String(b.id)));
}

// What a run was asked, as one line: its job's name, its main assignment, or the first line of its message.
function ask(r) {
  if (r?.jobName) return String(r.jobName);
  if (r?.customPrompt === false && !r.continues) return 'Main assignment'; // a run that carries on has its request as its prompt
  const first = String(r?.prompt || '').trim().split('\n')[0].trim();
  return first || (r?.trigger === 'schedule' ? 'Scheduled run' : 'Working');
}

// How long a run has gone: "18s", "4m 05s", "1h 02m".
function elapsed(startedAt, now = Date.now()) {
  const t = Date.parse(startedAt);
  const s = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : 0;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
}

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// One row. r: { id, ask, line, held, done, gone, startedAt }. line: what it is doing now ('' says "Working").
function rowHTML(r, now = Date.now()) {
  const kind = r.done ? 'done' : r.held ? 'held' : 'doing';
  const mark = r.done ? CHECK : r.held ? '<i></i>' : '<i class="plan-spin"></i>';
  const doing = r.done ? 'Done' : r.held ? root.OpeningLine?.WAITING || 'Waiting for your OK' : String(r.line || '').trim() || 'Working';
  return `<div class="live-run ${kind}${r.gone ? ' gone' : ''}" data-live-run="${esc(r.id)}">`
    + `<span class="live-mark">${mark}</span>`
    + `<span class="live-what"><span class="live-ask">${esc(r.ask)}</span><em>${esc(doing)}</em></span>`
    + `<time data-since="${esc(r.startedAt || '')}">${esc(elapsed(r.startedAt, now))}</time>`
    + `<button type="button" data-stop-live="${esc(r.id)}">Stop</button></div>`;
}

// The card: '' with fewer than two rows (the status line says it then).
function html(rows, color, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length < 2) return '';
  return `<div class="live-runs" role="status" style="--c:${root.Unread ? root.Unread.tint(color) : esc(color || '')}">${rows.map((r) => rowHTML(r, now)).join('')}</div>`;
}

// What the card holds as runs go and end: the live runs, and for a moment those that just ended.
// rows(live) takes the live rows, [{ id, ask, line, held, startedAt }], and answers the rows to draw, in the order
// the runs started: [] when there are fewer than two (the status line says it then). A run that was a row of the
// card drawn last and is not live any more stays, `done`, for DONE ms, then `gone` (its fold) for GONE ms, then
// leaves; onChange is called at each step, so the page draws again. With one run left the status line takes over
// after the fold.
const DONE = 700;
const GONE = 900;
function keeper(onChange = () => {}, clock = { now: () => Date.now(), later: (f, ms) => setTimeout(f, ms) }) {
  let drawn = new Map(); // id -> the row as last drawn on the card
  const ending = new Map(); // id -> { row, at }
  const order = (a, b) => String(a.startedAt).localeCompare(String(b.startedAt)) || String(a.id).localeCompare(String(b.id));
  function rows(live) {
    const now = clock.now();
    const ids = new Set(live.map((r) => r.id));
    for (const [id, row] of drawn) {
      if (ids.has(id) || ending.has(id)) continue;
      ending.set(id, { row, at: now });
      clock.later(onChange, DONE);
      clock.later(onChange, DONE + GONE);
    }
    for (const [id, e] of [...ending]) if (ids.has(id) || now - e.at >= DONE + GONE) ending.delete(id);
    const out = live.concat([...ending.values()].map((e) => ({ ...e.row, done: true, gone: now - e.at >= DONE }))).sort(order);
    if (out.length < 2) { drawn = new Map(); ending.clear(); return []; }
    drawn = new Map(live.map((r) => [r.id, r]));
    return out;
  }
  return { rows };
}

const api = { listed, ask, elapsed, rowHTML, html, keeper, DONE, GONE };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.LiveRuns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
