// A bot's or the Chief's plan on the web page (docs/api.md, "The plan"; ADR 057): the steps of its work, above the
// message box while it works, folded into its reply when it is done, and "Stopped at step N of M" when it was stopped
// or failed, until the owner dismisses it. The steps are the server's plain text, drawn as text here.
// A plain <script>, as window.Plan, loaded before app.js; the tests load it the same way.

(function (root) {

const MANY = 6; // a plan longer than this folds the steps that are done into one row
const NARROW = '(max-width: 640px)'; // where the plan starts folded to its one line
const FOLD_KEY = 'botdot.plan.fold'; // the fold of each chat's plan, as the owner left it: { [chat]: true | false }
const DISMISS_KEY = 'botdot.plan.dismissed'; // the stopped plans the owner dismissed, by their id (the newest 50)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (key, empty) => { try { return JSON.parse(localStorage.getItem(key)) ?? empty; } catch { return empty; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: it is remembered while the page is open */ } };

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';

// The steps of a plan as the server sends it, each { text, status, doing? }; [] for anything else.
const STATUSES = ['done', 'doing', 'todo'];
const steps = (plan) => (Array.isArray(plan?.steps) ? plan.steps : []).filter((s) => s && typeof s.text === 'string' && s.text)
  .map((s) => ({ text: s.text, status: STATUSES.includes(s.status) ? s.status : 'todo', doing: typeof s.doing === 'string' ? s.doing : '' }));
// How far it is: the steps done, all of them, and the step it is on (1-based: the one at work, else the first not done).
function progress(plan) {
  const list = steps(plan);
  const done = list.filter((s) => s.status === 'done').length;
  const at = list.findIndex((s) => s.status === 'doing');
  const next = at >= 0 ? at : list.findIndex((s) => s.status !== 'done');
  return { done, total: list.length, step: next >= 0 ? next + 1 : list.length };
}
const has = (plan) => steps(plan).length > 0;
const finished = (plan) => { const p = progress(plan); return p.total > 0 && p.done === p.total; };

// The fold of a chat's plan: as the owner left it there, else folded on a narrow screen.
const folded = (chat) => { const kept = read(FOLD_KEY, {})[chat]; return typeof kept === 'boolean' ? kept : !!root.matchMedia?.(NARROW).matches; };
const setFolded = (chat, on) => { const all = read(FOLD_KEY, {}); all[chat] = !!on; write(FOLD_KEY, all); };
const dismissed = (id) => read(DISMISS_KEY, []).includes(id);
const dismiss = (id) => { const all = read(DISMISS_KEY, []).filter((x) => x !== id); all.push(id); write(DISMISS_KEY, all.slice(-50)); };

const mark = (s) => (s.status === 'done' ? CHECK : '<i aria-hidden="true"></i>');
const row = (s) => `<li class="plan-step ${s.status}"><span class="plan-mark">${mark(s)}</span><span>${esc(s.text)}${s.status === 'doing' && s.doing ? `<em>${esc(s.doing)}</em>` : ''}</span></li>`;

// The plan of the work that is going on. who: whose plan, for the region's label; fold: drawn as its one line;
// showDone: the steps that are done are shown also in a long plan.
function liveHTML(plan, { who = '', fold = false, showDone = false } = {}) {
  const list = steps(plan);
  if (!list.length) return '';
  const p = progress(plan);
  const now = list[p.step - 1];
  const bar = `<div class="plan-bar" aria-hidden="true"><span style="width:${Math.round((p.done / p.total) * 100)}%"></span></div>`;
  const label = `${who ? `${who}'s plan` : 'Plan'}`;
  if (fold) {
    return `<section class="plan-card folded" aria-label="${esc(label)}">
      <button type="button" class="plan-head" data-plan-fold aria-expanded="false"><i class="plan-spin" aria-hidden="true"></i><b>Plan</b><span class="plan-count">step ${p.step} of ${p.total}</span><span class="plan-now">${esc(now?.doing || now?.text || '')}</span>${CHEVRON}</button>
      ${bar}
    </section>`;
  }
  // A long plan folds its done steps into one row, until the owner shows them.
  const hide = !showDone && list.length > MANY && p.done > 1;
  const shown = hide ? list.filter((s) => s.status !== 'done') : list;
  return `<section class="plan-card" aria-label="${esc(label)}">
    <button type="button" class="plan-head" data-plan-fold aria-expanded="true"><b>Plan</b><span class="plan-count">${p.done} of ${p.total} done</span>${CHEVRON}</button>
    ${bar}
    <ol class="plan-steps${list.length > MANY ? ' long' : ''}">
      ${hide ? `<li class="plan-step done"><span class="plan-mark">${CHECK}</span><button type="button" class="plan-show" data-plan-show>${p.done} steps done · show</button></li>` : ''}
      ${shown.map(row).join('')}
    </ol>
  </section>`;
}

// The plan of work that was stopped, or failed, before its steps were done: how far it got, with Dismiss.
function stoppedHTML(plan, { who = '' } = {}) {
  const list = steps(plan);
  if (!list.length) return '';
  const p = progress(plan);
  const now = list[p.step - 1];
  const left = list.slice(p.step).filter((s) => s.status !== 'done').length;
  const label = `${who ? `${who}'s plan` : 'Plan'}, stopped`;
  return `<section class="plan-card stopped" aria-label="${esc(label)}">
    <div class="plan-head"><b>Plan</b><span class="plan-count">Stopped at step ${p.step} of ${p.total}</span></div>
    <ol class="plan-steps">
      ${p.done ? `<li class="plan-step done"><span class="plan-mark">${CHECK}</span><span>${p.done === 1 ? '1 step done' : `${p.done} steps done`}</span></li>` : ''}
      ${now && now.status !== 'done' ? `<li class="plan-step cut"><span class="plan-mark">${CROSS}</span><span>${esc(now.text)}</span></li>` : ''}
      ${left ? `<li class="plan-step left"><span class="plan-mark"><i aria-hidden="true"></i></span><span>${left === 1 ? '1 step not started' : `${left} steps not started`}</span></li>` : ''}
    </ol>
    <div class="plan-actions"><button type="button" class="btn" data-plan-dismiss>Dismiss</button></div>
  </section>`;
}

// The plan under a reply that is done: folded to "Plan · 5 of 5 done", its steps inside.
function replyHTML(plan) {
  const list = steps(plan);
  if (!list.length) return '';
  const p = progress(plan);
  return `<details class="plan-fold"><summary>${finished(plan) ? CHECK : ''}Plan · ${p.done} of ${p.total} done</summary><ol>${list.map((s) => `<li class="${s.status}">${esc(s.text)}</li>`).join('')}</ol></details>`;
}

// Draw a chat's plan into its slot above the message box. view: null for none, or { kind: 'live' | 'stopped', plan,
// id (the run's or the reply's, for Dismiss), who }. chat: the chat's key ('bot:<id>', 'chief:<id>'), whose fold is
// kept. onDismiss(): the stopped plan was dismissed, for the chat to draw its reply again.
const showing = new Map(); // slot -> { chat, id, showDone }
function draw(slot, chat, view, onDismiss) {
  if (!slot) return;
  if (!view || !has(view.plan)) { slot.innerHTML = ''; showing.delete(slot); return; }
  const was = showing.get(slot);
  const showDone = !!(was && was.chat === chat && was.id === view.id && was.showDone);
  showing.set(slot, { chat, id: view.id, showDone });
  const html = view.kind === 'stopped' ? stoppedHTML(view.plan, view) : liveHTML(view.plan, { who: view.who, fold: folded(chat), showDone });
  if (slot._html === html) return; // nothing changed: the spinner goes on as it is
  slot._html = html;
  slot.innerHTML = html;
  const again = () => { slot._html = null; draw(slot, chat, view, onDismiss); };
  const fold = slot.querySelector('[data-plan-fold]');
  if (fold) fold.onclick = () => { setFolded(chat, !folded(chat)); again(); };
  const show = slot.querySelector('[data-plan-show]');
  if (show) show.onclick = () => { showing.get(slot).showDone = true; again(); };
  const gone = slot.querySelector('[data-plan-dismiss]');
  if (gone) gone.onclick = () => { dismiss(view.id); draw(slot, chat, null); onDismiss?.(); };
}

root.Plan = { steps, progress, has, finished, folded, setFolded, dismissed, dismiss, liveHTML, stoppedHTML, replyHTML, draw, MANY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
