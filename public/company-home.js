// The Company's home (#672, ADR 110): a running company drawn as an office floor, with its rules in company-floor.js.
// The header: its name and "Day N of 90". The floor: the Chief of Staff in a small glass office, one room per team, the
// bots in no team on their own, and a dashed "New team". The panel beside it is the To-do (#692: what waits for the
// owner and the project's to-do, filtered All, You, Bots or Done, and Add a task with who it is for, its day and how it
// repeats), or the team whose room was clicked. A narrow window has the floor in one column and the panel under it.
// Everything shown is the bots' states, asks and working lines the page already has: nothing new is asked of the
// server but the company's own routes. Under the header (#673): days 30, 60 and 90 on a line, the check-in that waits
// above the floor, the week's plan at the top of You, and the bot the Chief suggests as a dashed card on the floor.
// Above the floor (#690): each objective as the owner picked under "Show as" (a pace chart by default, a bar, or its
// status and steps), and on day 1 where it starts in place of a chart. The floor has the teams in its main area and
// the Chief, the bots in no team and "New team" in a narrow column. At the floor's end, the Calendar tile (#695,
// company-calendar-view.js).
(() => {
  const CROWN = '<svg class="cf-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 3 7l5 4 4-6 4 6 5-4-1 10z"/></svg>';
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const YOU = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  // The team whose room was clicked: the panel shows it in place of You. null: You.
  let teamOpen = null;
  // The week's plan has its Change field open (#673).
  let changing = false;
  // The objective whose "Show as" menu is open (#690), or null.
  let menuFor = null;

  // ---------- what the page knows of each bot ----------
  // What waits for the owner: the cards of Needs you (needs.js) and the bots that ask a question (unread.js).
  const needs = () => (typeof needsItems === 'function' ? batched(needsItems()) : []);
  const botOfNeed = (x) => x.bot?.id || null;
  const question = (b) => Unread.asks(b, !!b.running);
  function info() {
    const waits = new Map();
    for (const x of needs()) { const id = botOfNeed(x); if (id) waits.set(id, (waits.get(id) || 0) + 1); }
    return {
      asks: (id) => (waits.get(id) || 0) + (question(botById(id) || {}) ? 1 : 0),
      working: (id) => !!botById(id)?.running,
    };
  }
  // A bot's line: what it does now while it works, its question while it asks, else its state in a word.
  const lineOf = (b) => question(b) || (b.running ? liveLine(b) || tr('Working') : keyStatus(b).text);
  // What the Chief does now, while it replies: its working line in one of its chats.
  const chiefLine = () => (state.chiefBusy ? [...chiefTurns.values()].find(Boolean) || tr('Working') : '');

  // ---------- the floor ----------
  const bubble = (text, kind = '') => `<span class="cf-bubble${kind ? ` ${kind}` : ''}">${esc(text)}</span>`;
  // A desk: the monitor lit in the bot's colour while it works or asks, the head under it, the name. lead: the bigger desk.
  function deskHTML(b, { lead = false, crown = false, count = 0 } = {}) {
    const on = b.seat !== 'idle';
    const over = count ? bubble(String(count), 'count') : b.seat === 'asks' ? bubble('!', 'asks') : b.running ? bubble(liveLine(b) || '…', liveLine(b) ? 'line' : 'dot') : '';
    return `<button type="button" class="cf-desk${lead ? ' lead' : ''}${on ? ' on' : ''}" style="--c:${esc(b.color)}" data-cf-bot="${esc(b.id)}" title="${esc(`${b.name} · ${lineOf(b)}`)}">
      <span class="cf-over">${over}</span>
      <span class="cf-table"><i></i></span>
      <span class="cf-head">${botFigure(b.color, b.state, lead ? 'lg' : '', b.outfit)}${crown ? CROWN : ''}</span>
      <span class="cf-name">${esc(b.name)}</span>
    </button>`;
  }
  function roomHTML(r) {
    const { team } = r;
    const bench = r.bench.length ? `<div class="cf-bench">${r.bench.map((b) => `<button type="button" class="cf-sit" data-cf-bot="${esc(b.id)}" title="${esc(`${b.name} · ${lineOf(b)}`)}">${botFigure(b.color, b.state, 'sm', b.outfit)}</button>`).join('')}</div>` : '';
    return `<section class="cf-room${r.wide ? ' wide' : ''}${teamOpen === team.id ? ' here' : ''}" style="--c:${esc(team.color)}" data-cf-team="${esc(team.id)}" tabindex="0" aria-label="${esc(team.name)}">
      <div class="cf-room-head"><i class="cf-dot"></i><button type="button" class="cf-team-name" data-cf-team-chat="${esc(team.id)}">${esc(team.name)}</button><span class="cf-n">${1 + r.desks.length + r.bench.length}</span></div>
      <div class="cf-lead">${deskHTML(r.lead, { lead: true, crown: !r.solo, count: r.count })}</div>
      ${r.desks.length ? `<div class="cf-desks">${r.desks.map((b) => deskHTML(b)).join('')}</div>` : ''}
      ${bench}
    </section>`;
  }
  // ---------- the objectives (#690): each as its display shows it ----------
  const DISPLAYS = [['pace', () => tr('Pace chart')], ['bar', () => tr('Bar')], ['status', () => tr('Status')]];
  const PACE = { ahead: () => tr('Ahead'), on: () => tr('On track'), behind: () => tr('Behind') };
  const SHOW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M6 15l4-4 3 3 5-6"/></svg>';
  const numHTML = (o) => `<div class="cf-goal-num">${esc(String(o.current))}<span> / ${esc(String(o.target))}</span></div>`;
  const paceHTML = (p) => (p ? `<span class="cf-pace${p.state === 'behind' ? ' behind' : ''}">${PACE[p.state]()}</span>` : '');
  // Day 1: no chart yet, where it starts: the number to reach, the day, the first check-in.
  function startHTML(o, c) {
    const at = CompanyFloor.checkinDate(c.startedAt);
    return `<div class="cf-goal-start">${numHTML(o)}<div class="cf-goal-facts"><span>${tr('Day {n} of 90', { n: c.day || 1 })}</span>${at ? `<span>${tr('Check-in {date}', { date: esc(at.toLocaleDateString(I18n.locale, { day: 'numeric', month: 'short' })) })}</span>` : ''}</div></div>`;
  }
  function chartHTML(o, c) {
    const k = CompanyFloor.chart(o, c.day);
    const pts = k.actual.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const [tx, ty] = k.actual.at(-1);
    return `<div class="cf-chart"><div class="cf-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${k.ticks.slice(0, 2).map((t) => `<line class="cf-tick" x1="${t.x.toFixed(2)}" y1="0" x2="${t.x.toFixed(2)}" y2="100"/>`).join('')}
        <line class="cf-base" x1="0" y1="100" x2="100" y2="100"/>
        <line class="cf-to" x1="${k.line[0]}" y1="${k.line[1]}" x2="${k.line[2]}" y2="${k.line[3].toFixed(2)}"/>
        ${k.actual.length > 1 ? `<polyline class="cf-actual" points="${pts}"/>` : ''}
      </svg><i class="cf-now" style="left:${tx.toFixed(2)}%;top:${ty.toFixed(2)}%"></i></div>
      <div class="cf-days"><b style="left:0">${tr('Day {n}', { n: 1 })}</b>${k.ticks.map((t) => `<span style="left:${t.x.toFixed(2)}%">${tr('Day {n}', { n: t.day })}</span>`).join('')}</div>
    </div>`;
  }
  function stepsHTML(o) {
    if (!o.steps?.length) return `<label class="cf-step${o.done ? ' done' : ''}"><input type="checkbox" data-cf-done="${esc(o.id)}"${o.done ? ' checked' : ''}><span>${tr('Done')}</span></label>`;
    return `<div class="cf-steps">${o.steps.map((x, i) => `<label class="cf-step${x.done ? ' done' : ''}"><input type="checkbox" data-cf-step="${esc(o.id)}" data-i="${i}"${x.done ? ' checked' : ''}><span>${esc(x.text)}</span></label>`).join('')}</div>`;
  }
  function goalHTML(o, c) {
    const show = CompanyFloor.displayOf(o);
    const numeric = o.target > 0;
    const p = CompanyFloor.pace(o, c.day);
    const ratio = numeric ? Math.max(0, Math.min(1, o.current / o.target)) : 0;
    let body;
    if (show === 'status' && !numeric) body = stepsHTML(o);
    else if (show === 'status') body = `<div class="cf-goal-status">${paceHTML(p) || `<span class="cf-pace">${tr('On track')}</span>`}<span class="cf-num">${esc(String(o.current))} / ${esc(String(o.target))}</span></div>`;
    else if (!numeric) body = stepsHTML(o);
    else if (CompanyFloor.firstDay(c)) body = startHTML(o, c);
    else if (show === 'bar') body = `<div class="cf-goal-info">${numHTML(o)}${paceHTML(p)}</div><div class="cf-bar big"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div>`;
    else body = `<div class="cf-goal-info">${numHTML(o)}${paceHTML(p)}</div>${chartHTML(o, c)}`;
    const count = o.steps?.length ? `<span class="cf-n">${CompanyFloor.stepsDone(o)}/${o.steps.length}</span>` : '';
    const menu = menuFor === o.id ? `<div class="cf-menu" role="menu">${DISPLAYS.map(([k, label]) => `<button type="button" role="menuitemradio" aria-checked="${show === k}" data-cf-display="${k}">${label()}</button>`).join('')}</div>` : '';
    return `<section class="cf-goal ${show}" style="--c:${esc(o.color)}" data-cf-goal="${esc(o.id)}">
      <div class="cf-goal-head"><i class="cf-dot"></i><h2>${esc(o.name)}</h2>${count}<button type="button" class="icon-btn" data-cf-show="${esc(o.id)}" aria-label="${tr('Show as')}" aria-expanded="${menuFor === o.id}">${SHOW}</button>${menu}</div>
      <div class="cf-goal-body">${body}</div>
    </section>`;
  }
  const goalsHTML = (c) => (c.objectives.length ? `<div class="cf-goals${c.objectives.length === 1 ? ' one' : ''}">${c.objectives.map((o) => goalHTML(o, c)).join('')}</div>` : '');
  // ---------- the 90 days (#673): the timeline, the check-in, the week's plan, a new bot ----------
  const DECIDED = { keep: () => tr('Keep going'), change: () => tr('Change direction'), stop: () => tr('Stop') };
  const byChief = () => `<span class="cf-by">${chiefFigure('sm')}${esc(chiefTitle())}</span>`;
  // Days 30, 60 and 90 on a thin line, filled up to today; an answered day in the colour of its answer.
  function lineHTML(c) {
    const marks = [30, 60, 90].map((d) => {
      const k = c.checkins.find((x) => x.day === d);
      const cls = [k && k.decision, c.checkin?.day === d && 'due', d <= c.day && 'past'].filter(Boolean).join(' ');
      return `<span class="cf-mark${cls ? ` ${cls}` : ''}" style="left:${((d / 90) * 100).toFixed(2)}%"${k ? ` title="${esc(DECIDED[k.decision]())}"` : ''}><i></i><b>${tr('Day {n}', { n: d })}</b></span>`;
    }).join('');
    return `<div class="cf-line"><i class="cf-line-fill" style="width:${((Math.min(c.day - 1, 90) / 90) * 100).toFixed(2)}%"></i>${marks}</div>`;
  }
  function checkinHTML(k) {
    return `<section class="cf-card cf-checkin"><div class="cf-card-head"><h2>${tr('Day {n} check-in', { n: k.day })}</h2>${byChief()}</div>
      <div class="cf-rows">${k.objectives.map((o) => `<div class="cf-row" style="--c:${esc(o.color)}"><i class="cf-dot"></i><span class="cf-row-text">${esc(o.name)}</span><span class="cf-num">${esc(String(o.current))} / ${esc(String(o.target))}</span><span class="cf-pace${o.onTrack ? '' : ' behind'}">${o.onTrack ? tr('On track') : tr('Behind')}</span></div>`).join('')}</div>
      <div class="cf-actions"><button type="button" class="btn ghost" data-cf-checkin="stop">${tr('Stop')}</button><span class="grow"></span><button type="button" class="btn" data-cf-checkin="change">${tr('Change direction')}</button><button type="button" class="btn primary" data-cf-checkin="keep">${tr('Keep going')}</button></div>
    </section>`;
  }
  function planHTML(c) {
    const p = c.plan;
    if (!p?.items.length) return '';
    const colorOfItem = (x) => c.objectives.find((o) => o.id === x.objective)?.color;
    // The team that does it (#696): its name in its colour.
    const teamOfItem = (x) => c.teams.find((t) => t.id === x.team);
    const teamChip = (t) => (t ? `<span class="cf-plan-team" style="--t:${esc(t.color)}">${esc(t.name)}</span>` : '');
    const actions = p.approved ? ''
      : changing ? `<form class="co-ask small" id="cf-change"><input name="text" autocomplete="off" maxlength="1000" aria-label="${tr('Change')}" /><button type="submit" class="co-go">${tr('Send')}</button></form>`
        : `<div class="cf-actions"><span class="grow"></span><button type="button" class="btn ghost sm" data-cf-plan-change>${tr('Change')}</button><button type="button" class="btn primary sm" data-cf-plan-approve>${tr('Approve')}</button></div>`;
    return `<section class="cf-plan${p.approved ? ' approved' : ''}"><div class="cf-card-head"><h3>${tr('This week')}</h3>${byChief()}</div>
      <ol class="cf-plan-items">${p.items.map((x) => `<li${colorOfItem(x) ? ` style="--c:${esc(colorOfItem(x))}"` : ''}><span class="cf-row-text">${esc(x.text)}</span>${teamChip(teamOfItem(x))}${colorOfItem(x) ? '<i class="cf-dot"></i>' : ''}</li>`).join('')}</ol>
      ${actions}
    </section>`;
  }
  // The morning standup (#698): each team's lead's three lines, merged by the Chief, in the team's colour. What
  // blocks a team and waits for the owner is an ask, with Reply into the lead's chat.
  const DONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
  const BLOCKED = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16v.5"/></svg>';
  const standupAsks = (c) => (c.standupToday?.leads || []).filter((l) => l.asks && botById(l.bot));
  function standupHTML(c) {
    const s = c.standupToday;
    const leads = (s?.leads || []).filter((l) => l.at && c.teams.some((t) => t.id === l.team));
    if (!leads.length) return '';
    const row = (kind, icon, text, extra = '') => (text ? `<div class="cf-su ${kind}">${icon}<span class="cf-row-text">${esc(text)}</span>${extra}</div>` : '');
    return `<section class="cf-plan cf-standup"><div class="cf-card-head"><h3>${tr('Standup')}</h3>${byChief()}</div>
      ${leads.map((l) => {
        const t = c.teams.find((x) => x.id === l.team);
        const reply = l.asks && botById(l.bot) ? `<button type="button" class="btn sm" data-cf-standup-reply="${esc(l.team)}">${tr('Reply')}</button>` : '';
        return `<div class="cf-su-team" style="--c:${esc(t.color)}"><div class="cf-su-name"><i class="cf-dot"></i>${esc(t.name)}</div>
          ${row('done', DONE, l.done)}${row('next', NEXT, l.next)}${row(`blocked${l.asks ? ' asks' : ''}`, BLOCKED, l.blocked, reply)}</div>`;
      }).join('')}
    </section>`;
  }
  // The bot the Chief suggests: a dashed card on the floor, in the colour of the team it would join.
  function suggestionHTML(c, s) {
    const color = c.teams.find((t) => t.id === s.team)?.color || '#8e7cff';
    return `<div class="cf-suggest" style="--c:${esc(color)}">${botFigure(color, 'idle', 'lg')}<div class="cf-suggest-text"><b>${esc(s.name)}</b>${s.why ? `<span>${esc(s.why)}</span>` : ''}</div>
      <div class="cf-actions"><button type="button" class="icon-btn" data-cf-suggest-no aria-label="${tr('Dismiss')}">${X}</button><button type="button" class="btn primary sm" data-cf-suggest-add>${Company.ICON.plus}${tr('Add')}</button></div></div>`;
  }

  // The teams in the main area; the Chief, the bots in no team, a suggested bot and "New team" in a narrow column.
  function floorHTML(c, f) {
    const line = chiefLine();
    const chief = `<button type="button" class="cf-chief" data-cf-chief><span class="cf-over">${line ? bubble(line, 'line') : ''}</span><span class="cf-table"><i></i></span><span class="cf-head">${chiefFigure()}</span><span class="cf-name">${esc(chiefTitle())}</span></button>`;
    const loose = f.loose.map((b) => `<div class="cf-loose">${deskHTML(b, { count: f.info.asks(b.id) })}</div>`).join('');
    const rooms = f.rooms.length ? `<div class="cf-rooms">${f.rooms.map(roomHTML).join('')}</div>` : '';
    return `<div class="cf-floor${rooms ? '' : ' bare'}">${rooms}<div class="cf-side">${chief}${loose}${c.suggestion ? suggestionHTML(c, c.suggestion) : ''}<button type="button" class="cf-new" data-cf-new>${Company.ICON.plus}${tr('New team')}</button></div>${c.phase === 'running' && Company.calendar && (state.features || []).includes('project-calendar') ? Company.calendar.tile(c) : ''}</div>`;
  }

  // ---------- the panel: the To-do (#692), or a team ----------
  // The To-do's filter (All, You, Bots, Done) and what the Add field will give the new item: who it is for (null:
  // the owner), its due day and how it repeats. `menu` is the open picker under the field: 'who', 'when' or null.
  let filter = 'all';
  const fresh = () => ({ bot: null, due: '', repeat: null });
  let pick = fresh();
  let menu = null;
  const CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';
  const FILTER = { all: () => tr('All'), you: () => tr('You'), bots: () => tr('Bots'), done: () => tr('Done') };
  const RHYTHMS = [['', () => tr('None')], ['day', () => tr('Daily')], ['week', () => tr('Weekly')], ['month', () => tr('Monthly')], ['days', () => tr('Custom')]];
  // A weekday's short name in the interface's language, Sunday 0 (1 November 2026 was a Sunday).
  const weekday = (d) => new Date(Date.UTC(2026, 10, 1 + d)).toLocaleDateString(I18n.locale, { weekday: 'short', timeZone: 'UTC' });
  const rhythmLabel = (r) => (r.every === 'day' || (r.every === 'week' && r.days?.length === 7) ? tr('Daily')
    : r.every === 'week' ? (r.days || []).map(weekday).join(', ') : r.every === 'month' ? tr('Monthly') : tr('Every {n} days', { n: r.n }));
  function dueLabel(due) {
    const kind = CompanyTodo.dueKind(due, CompanyTodo.today());
    if (kind === 'today') return tr('Today');
    if (kind === 'tomorrow') return tr('Tomorrow');
    return new Date(`${due}T12:00:00Z`).toLocaleDateString(I18n.locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  // The bots an item may be for: the project's, or every bot while it has no team.
  const projectBots = (c) => { const ids = new Set(c.teams.flatMap((t) => t.bots)); const in_ = state.bots.filter((b) => ids.has(b.id)); return in_.length ? in_ : state.bots; };
  const head = (b) => (b ? botFigure(colorOf(b), 'idle', 'sm', outfitOf(b)) : chiefFigure('sm'));
  const you = `<span class="cf-you sm">${YOU}</span>`;
  // An item's chip: how it repeats, else that its bot works now, else its due day.
  function chipOf(t) {
    if (t.repeat) return `<span class="cf-chip">${esc(rhythmLabel(t.repeat))}</span>`;
    if (!t.done && t.bot && botById(t.bot)?.running) return `<span class="cf-chip work">${tr('Working')}</span>`;
    if (t.due) return `<span class="cf-chip${!t.done && CompanyTodo.dueKind(t.due, CompanyTodo.today()) === 'late' ? ' late' : ''}">${esc(dueLabel(t.due))}</span>`;
    return '';
  }
  const todoHTML = (t) => `<div class="cf-row cf-todo${t.done ? ' done' : ''}">${t.bot && botById(t.bot) ? head(botById(t.bot)) : you}<span class="cf-row-text">${esc(t.text)}</span>${chipOf(t)}<input type="checkbox" data-cf-todo="${esc(t.id)}"${t.done ? ' checked' : ''} aria-label="${tr('Done')}"><button type="button" class="icon-btn cf-del" data-cf-del="${esc(t.id)}" aria-label="${tr('Delete')}">${X}</button></div>`;
  function menuHTML(c) {
    if (menu === 'who') {
      return `<div class="cf-menu" role="menu"><button type="button" role="menuitem" data-cf-pick="">${you}<span>${tr('You')}</span></button>${projectBots(c).map((b) => `<button type="button" role="menuitem" data-cf-pick="${esc(b.id)}">${head(b)}<span>${esc(b.name)}</span></button>`).join('')}</div>`;
    }
    if (menu !== 'when') return '';
    const r = pick.repeat;
    const days = r?.every === 'week' ? `<div class="cf-days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="${r.days.includes(d) ? 'on' : ''}" data-cf-day="${d}">${esc(weekday(d))}</button>`).join('')}</div>` : '';
    const n = r?.every === 'days' ? `<label class="cf-every">${tr('Every {n} days', { n: `<input type="number" min="2" max="365" value="${r.n}" data-cf-n aria-label="${tr('Days')}">` })}</label>` : '';
    return `<div class="cf-menu cf-when-menu"><input type="date" value="${esc(pick.due)}" data-cf-due aria-label="${tr('Due')}">
      <div class="kit-seg">${RHYTHMS.map(([k, label]) => `<button type="button" class="${(r?.every || '') === k ? 'on' : ''}" data-cf-rhythm="${k}">${label()}</button>`).join('')}</div>${days}${n}</div>`;
  }
  function todoPanelHTML(c) {
    const asks = filter === 'all' || filter === 'you';
    const waits = asks ? needs() : [];
    const asking = asks ? state.bots.filter((b) => question(b)) : [];
    const items = CompanyTodo.shown(c.todos, filter);
    const rows = [
      ...waits.map((x, i) => `<div class="cf-row">${head(x.bot)}<span class="cf-row-text">${esc(needLine(x))}</span><button type="button" class="btn sm" data-cf-need="${i}">${answersInline(x) ? tr('Approve') : tr('Review')}</button></div>`),
      ...asking.map((b) => `<div class="cf-row">${head(b)}<span class="cf-row-text">${esc(question(b))}</span><button type="button" class="btn sm" data-cf-reply="${esc(b.id)}">${tr('Reply')}</button></div>`),
      ...items.map(todoHTML),
    ].join('');
    const n = filter === 'done' ? 0 : waits.length + asking.length + items.length + (asks ? standupAsks(c).length : 0);
    const who = pick.bot && botById(pick.bot);
    const when = pick.repeat ? rhythmLabel(pick.repeat) : pick.due ? dueLabel(pick.due) : '';
    return `<div class="cf-panel-head"><h2>${tr('To-do')}</h2>${n ? `<span class="cf-count">${n}</span>` : ''}</div>
      <div class="kit-seg cf-filters" role="tablist">${CompanyTodo.FILTERS.map((k) => `<button type="button" role="tab" class="${filter === k ? 'on' : ''}" aria-selected="${filter === k}" data-cf-filter="${k}">${FILTER[k]()}</button>`).join('')}</div>
      ${asks ? planHTML(c) + standupHTML(c) : ''}
      <div class="cf-rows">${rows}</div>
      <form class="co-ask small cf-add" id="cf-add"><button type="button" class="cf-who" data-cf-who aria-label="${esc(who ? who.name : tr('You'))}">${who ? head(who) : you}</button><input name="task" autocomplete="off" maxlength="300" placeholder="${tr('Add a task')}" aria-label="${tr('Add a task')}" /><button type="button" class="cf-when${when ? ' set' : ''}" data-cf-when aria-label="${tr('Due')}">${when ? esc(when) : CAL}</button><button type="submit" class="co-go">${tr('Add')}</button></form>
      ${menuHTML(c)}
      ${decisionsHTML(c)}`;
  }
  // The owner's decisions (#694): the last few, newest first, with their reason and day; Add a decision under them.
  const DECISIONS_SHOWN = 5;
  function decisionText(d) {
    if (d.by === 'checkin' && d.day && DECIDED[d.decision]) return `${tr('Day {n} check-in', { n: d.day })}: ${DECIDED[d.decision]()}`;
    return d.text;
  }
  function decisionsHTML(c) {
    const shown = (c.decisions || []).slice(-DECISIONS_SHOWN).reverse();
    const day = (at) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
    return `<section class="cf-decisions"><h3>${tr('Decisions')}</h3>
      ${shown.length ? `<ul class="cf-decision-list">${shown.map((d) => `<li class="cf-decision"><span class="cf-row-text">${esc(decisionText(d))}${d.why ? `<span>${esc(d.why)}</span>` : ''}</span><time>${esc(day(d.at))}</time><button type="button" class="icon-btn" data-cf-decision-x="${esc(d.id)}" aria-label="${tr('Remove')}">${X}</button></li>`).join('')}</ul>` : ''}
      <form class="co-ask small cf-add" id="cf-decide"><input name="decision" autocomplete="off" maxlength="600" placeholder="${tr('Add a decision')}" aria-label="${tr('Add a decision')}" /><button type="submit" class="co-go">${tr('Add')}</button></form>
    </section>`;
  }
  // How often the lead reports (#696), and its latest report.
  const REPORT_RHYTHMS = [['', () => tr('Off')], ['daily', () => tr('Daily')], ['twice-weekly', () => tr('Twice a week')], ['weekly', () => tr('Weekly')]];
  function reportHTML(team) {
    const r = team.lastReport;
    const by = r && botById(r.bot);
    return `<div class="cf-report-head"><span class="co-k">${tr('Reports')}</span><select class="co-asks" data-cf-report aria-label="${tr('Reports')}">${REPORT_RHYTHMS.map(([k, label]) => `<option value="${k}"${(team.report || '') === k ? ' selected' : ''}>${label()}</option>`).join('')}</select></div>
      ${r ? `<div class="cf-report">${by ? botFigure(by.color, 'idle', 'sm', by.outfit) : ''}<div class="cf-report-text">${esc(r.text)}<span class="cf-report-at">${esc(msgTime(r.at))}</span></div></div>` : ''}`;
  }
  function teamHTML(c, team) {
    const o = CompanyFloor.objectiveOf(team, c.objectives);
    const members = team.bots.map(botById).filter(Boolean);
    return `<div class="cf-panel-head" style="--c:${esc(team.color)}"><i class="cf-dot"></i><h2>${esc(team.name)}</h2><button type="button" class="icon-btn" data-cf-close aria-label="${tr('Close')}">${X}</button></div>
      ${o ? `<div class="cf-team-kpi"><span>${esc(o.name)}</span><b>${esc(String(o.current))}<span> / ${esc(String(o.target))}</span></b></div>` : ''}
      <div class="cf-rows">${members.map((b) => `<div class="cf-row">
        <button type="button" class="cf-member" data-cf-bot="${esc(b.id)}">${botFigure(b.color, b.state, 'sm', b.outfit)}${b.id === team.lead && members.length > 1 ? CROWN : ''}<span class="cf-row-text"><b>${esc(b.name)}</b><span>${esc(lineOf(b))}</span></span></button>
        ${b.id === team.lead ? `<span class="cf-lead-chip">${CROWN}${tr('Lead')}</span>` : `<button type="button" class="btn sm ghost" data-cf-lead="${esc(b.id)}">${tr('Make lead')}</button>`}
      </div>`).join('')}</div>
      ${reportHTML(team)}`;
  }

  // ---------- drawing and wiring ----------
  function home(root, c) {
    const known = info();
    const f = { ...CompanyFloor.floor(c, state.bots, known), info: known };
    const team = teamOpen && c.teams.find((t) => t.id === teamOpen);
    if (!team) teamOpen = null;
    // What the fields hold, and which has the focus: the floor drawn again keeps them.
    const kept = ['#cf-add input', '#cf-change input', '#cf-decide input'].map((sel) => { const el = $(sel, root); return el && { sel, value: el.value, focus: document.activeElement === el }; }).filter(Boolean);
    root.innerHTML = `<div class="cf-home">
      <header class="cf-top"><h1>${Company.pickHTML(c.name || c.start)}</h1>${c.day ? `<span class="cf-day">${tr('Day {n} of 90', { n: c.day })}</span>` : ''}</header>
      ${c.day ? lineHTML(c) : ''}
      ${c.checkin ? checkinHTML(c.checkin) : ''}
      ${goalsHTML(c)}
      <div class="cf-main">${floorHTML(c, f)}<aside class="cf-panel">${team ? teamHTML(c, team) : todoPanelHTML(c)}</aside></div>
    </div>`;
    for (const k of kept) { const el = $(k.sel, root); if (el) { el.value = k.value; if (k.focus) el.focus(); } }
    wire(root, c);
  }
  function openTeam(id) { teamOpen = teamOpen === id ? null : id; Company.redraw(); }
  function wire(root, c) {
    Company.wirePick(root);
    $$('[data-cf-bot]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); setView('bot', b.dataset.cfBot); }));
    // The team's name opens its chat, docked in the bottom row (#697).
    $$('[data-cf-team-chat]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openTeamChat(b.dataset.cfTeamChat); }));
    $$('[data-cf-team]', root).forEach((r) => {
      r.onclick = () => openTeam(r.dataset.cfTeam);
      r.onkeydown = (e) => { if (e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTeam(r.dataset.cfTeam); } };
    });
    $('[data-cf-chief]', root).onclick = () => setView('chief');
    $('[data-cf-new]', root).onclick = () => newTeam(c);
    Company.calendar?.wire(root); // the Calendar tile (#695, company-calendar-view.js)
    $('[data-cf-close]', root)?.addEventListener('click', () => openTeam(null));
    const waits = needs();
    $$('[data-cf-need]', root).forEach((b) => (b.onclick = () => { const x = waits[Number(b.dataset.cfNeed)]; if (answersInline(x)) answerNeed(x, true, b); else openNeed(x); }));
    $$('[data-cf-reply]', root).forEach((b) => (b.onclick = () => setView('bot', b.dataset.cfReply)));
    // Reply to a standup's ask: the lead's chat, with what blocks the team quoted in the box.
    $$('[data-cf-standup-reply]', root).forEach((b) => (b.onclick = () => {
      const l = c.standupToday?.leads.find((x) => x.team === b.dataset.cfStandupReply);
      if (!l) return;
      setView('bot', l.bot);
      const box = $('#view-bot textarea');
      if (box) { box.value = `${tr('Standup: {text}', { text: l.blocked })}\n`; box.dispatchEvent(new Event('input')); box.focus(); }
    }));
    $$('[data-cf-todo]', root).forEach((box) => (box.onchange = () => send(`/company/todos/${encodeURIComponent(box.dataset.cfTodo)}`, 'PUT', { done: box.checked })));
    $$('[data-cf-del]', root).forEach((b) => (b.onclick = () => send(`/company/todos/${encodeURIComponent(b.dataset.cfDel)}`, 'DELETE')));
    $$('[data-cf-filter]', root).forEach((b) => (b.onclick = () => { filter = b.dataset.cfFilter; Company.redraw(); }));
    $('[data-cf-who]', root)?.addEventListener('click', () => { menu = menu === 'who' ? null : 'who'; Company.redraw(); });
    $('[data-cf-when]', root)?.addEventListener('click', () => { menu = menu === 'when' ? null : 'when'; Company.redraw(); });
    $$('[data-cf-pick]', root).forEach((b) => (b.onclick = () => { pick.bot = b.dataset.cfPick || null; menu = null; Company.redraw(); $('#cf-add input')?.focus(); }));
    $('[data-cf-due]', root)?.addEventListener('change', (e) => { pick.due = e.target.value; Company.redraw(); });
    $$('[data-cf-rhythm]', root).forEach((b) => (b.onclick = () => {
      const k = b.dataset.cfRhythm;
      const on = pick.due ? new Date(`${pick.due}T12:00:00Z`) : new Date();
      pick.repeat = !k ? null : k === 'week' ? { every: 'week', days: [pick.due ? on.getUTCDay() : on.getDay()] } : k === 'days' ? { every: 'days', n: 2 } : { every: k };
      Company.redraw();
    }));
    $$('[data-cf-day]', root).forEach((b) => (b.onclick = () => {
      const d = Number(b.dataset.cfDay);
      const days = pick.repeat.days.includes(d) ? pick.repeat.days.filter((x) => x !== d) : [...pick.repeat.days, d];
      if (days.length) pick.repeat = { ...pick.repeat, days };
      Company.redraw();
    }));
    $('[data-cf-n]', root)?.addEventListener('change', (e) => { pick.repeat = { ...pick.repeat, n: Math.max(2, Math.min(365, Math.round(Number(e.target.value)) || 2)) }; Company.redraw(); });
    $$('[data-cf-lead]', root).forEach((b) => (b.onclick = () => send(`/company/teams/${encodeURIComponent(teamOpen)}`, 'PUT', { lead: b.dataset.cfLead })));
    $('[data-cf-report]', root)?.addEventListener('change', (e) => send(`/company/teams/${encodeURIComponent(teamOpen)}`, 'PUT', { report: e.target.value || null }));
    $$('[data-cf-checkin]', root).forEach((b) => (b.onclick = () => checkin(c.checkin, b.dataset.cfCheckin, b)));
    $('[data-cf-plan-approve]', root)?.addEventListener('click', (e) => { e.currentTarget.disabled = true; send('/company/plan/approve', 'POST', {}); });
    $('[data-cf-plan-change]', root)?.addEventListener('click', () => { changing = true; Company.redraw(); $('#cf-change input')?.focus(); });
    const change = $('#cf-change', root);
    if (change) {
      change.text.onkeydown = (e) => { if (e.key === 'Escape') { changing = false; Company.redraw(); } };
      change.onsubmit = async (e) => {
        e.preventDefault();
        const text = change.text.value.trim();
        if (!text) return;
        changing = false;
        change.text.value = '';
        if (!(await send('/company/plan/change', 'POST', { text }))) { changing = true; Company.redraw(); const now = $('#cf-change input'); if (now) now.value = text; }
      };
    }
    $$('[data-cf-show]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); menuFor = menuFor === b.dataset.cfShow ? null : b.dataset.cfShow; Company.redraw(); }));
    $$('[data-cf-display]', root).forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const id = b.closest('[data-cf-goal]').dataset.cfGoal;
      menuFor = null;
      send(`/company/objectives/${encodeURIComponent(id)}`, 'PUT', { display: b.dataset.cfDisplay });
    }));
    $$('[data-cf-done]', root).forEach((box) => (box.onchange = () => send(`/company/objectives/${encodeURIComponent(box.dataset.cfDone)}`, 'PUT', { done: box.checked })));
    $$('[data-cf-step]', root).forEach((box) => (box.onchange = () => {
      const o = c.objectives.find((x) => x.id === box.dataset.cfStep);
      if (!o) return;
      send(`/company/objectives/${encodeURIComponent(o.id)}`, 'PUT', { steps: o.steps.map((x, i) => (i === Number(box.dataset.i) ? { ...x, done: box.checked } : x)) });
    }));
    $('[data-cf-suggest-add]', root)?.addEventListener('click', (e) => { e.currentTarget.disabled = true; send('/company/suggestion/add', 'POST', {}); });
    $('[data-cf-suggest-no]', root)?.addEventListener('click', () => send('/company/suggestion', 'DELETE'));
    $$('[data-cf-decision-x]', root).forEach((b) => (b.onclick = () => send(`/company/decisions/${encodeURIComponent(b.dataset.cfDecisionX)}`, 'DELETE')));
    const decide = $('#cf-decide', root);
    if (decide) decide.onsubmit = async (e) => {
      e.preventDefault();
      const d = CompanyFloor.decision(decide.decision.value);
      const button = decide.querySelector('.co-go');
      if (!d.text || button.disabled) return;
      button.disabled = true;
      const typed = decide.decision.value;
      decide.decision.value = '';
      if (!(await send('/company/decisions', 'POST', d.why ? d : { text: d.text }))) { const now = $('#cf-decide input'); if (now) now.value = typed; }
      button.disabled = false;
    };
    const add = $('#cf-add', root);
    if (add) add.onsubmit = async (e) => {
      e.preventDefault();
      const t = CompanyFloor.task(add.task.value, state.bots);
      if (!t.text) return;
      const button = add.querySelector('.co-go');
      if (button.disabled) return;
      button.disabled = true;
      const typed = add.task.value;
      const was = pick;
      const bot = t.bot || pick.bot;
      add.task.value = ''; // before the answer: the floor drawn again keeps what the field holds
      pick = fresh();
      menu = null;
      const body = { text: t.text, ...(bot ? { bot } : {}), ...(was.due ? { due: was.due } : {}), ...(was.repeat ? { repeat: was.repeat } : {}) };
      if (!(await send('/company/todos', 'POST', body))) { pick = was; Company.redraw(); const now = $('#cf-add input'); if (now) now.value = typed; }
      button.disabled = false;
    };
  }
  // A change to the company: the answer is the company as it is now. What the server refuses is said in its words.
  async function send(path, method, body) {
    try { Company.changed({ company: await api(Company.at(path), { method, body }) }); return true; } catch (e) { toast(e.message, true); Company.redraw(); return false; }
  }
  // The owner's answer at a check-in. Change direction opens a new chat with the Chief, the words started for them;
  // Stop says how many jobs it switched off.
  async function checkin(k, decision, button) {
    if (!k || button.disabled) return;
    button.disabled = true;
    let d;
    try { d = await api(Company.at('/company/checkins'), { method: 'POST', body: { day: k.day, decision } }); } catch (e) { toast(e.message, true); button.disabled = false; return; }
    Company.changed({ company: d.company });
    if (decision === 'stop') toast(trn(d.paused || 0, "Switched off {n} job of the project's bots.", "Switched off {n} jobs of the project's bots."));
    if (decision === 'change') {
      openChiefChat(null);
      const box = $('#view-chief form')?.text;
      if (box) { box.value = `${tr('Day {n} check-in: I want to change direction.', { n: k.day })} `; box.dispatchEvent(new Event('input')); box.focus(); }
    }
  }
  // "New team": a name and its bots, the first picked its lead; the bots in no team are offered first.
  function newTeam(c) {
    const inTeam = new Set(c.teams.flatMap((t) => t.bots));
    openBotPicker({
      title: tr('New team'),
      name: '',
      placeholder: '',
      bots: [...state.bots].sort((a, b) => inTeam.has(a.id) - inTeam.has(b.id)),
      max: 40,
      action: tr('Create'),
      hint: () => '',
      done: async (picked, name) => { Company.changed({ company: await api(Company.at('/company/teams'), { method: 'POST', body: { name, bots: picked } }) }); },
    });
  }

  // A click outside the open "Show as" menu, or Escape, closes it.
  const closeMenu = () => { if (menuFor) { menuFor = null; Company.redraw(); } };
  document.addEventListener('click', (e) => { if (menuFor && !e.target.closest?.('.cf-menu')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  Company.steps.home = home;
  // What waits for the owner of one bot, as its desk counts it: the tree of projects shows it too (#689).
  Company.asksOf = (id) => info().asks(id);
  // The floor also shows the bots' states, what waits for the owner, the Chief's line and the open team.
  Company.steps.sig = () => [Company.calendar?.sig(), teamOpen, changing, menuFor, filter, menu, pick, chiefLine(), state.bots.map((b) => [b.id, b.name, b.color, b.state, !!b.running, question(b), b.running ? liveLine(b) : keyStatus(b).text]), needs().map((x) => x.key)];
})();
