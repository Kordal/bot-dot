// The Company's home (#672, ADR 110): a running company drawn as an office floor, with its rules in company-floor.js.
// The header: its name and "Day N of 90". The floor: the whiteboard of objectives, the Chief of Staff in a small glass
// office beside it, one room per team, the bots in no team on their own, and a dashed "New team". The panel beside it
// is You (what waits for the owner, their tasks, Add a task), or the team whose room was clicked. A narrow window has
// the floor in one column and the panel under it. Everything shown is the bots' states, asks and working lines the
// page already has: nothing new is asked of the server but the company's own routes.
(() => {
  const CROWN = '<svg class="cf-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 3 7l5 4 4-6 4 6 5-4-1 10z"/></svg>';
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const YOU = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  // The team whose room was clicked: the panel shows it in place of You. null: You.
  let teamOpen = null;

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
      <div class="cf-room-head"><i class="cf-dot"></i>${esc(team.name)}<span class="cf-n">${1 + r.desks.length + r.bench.length}</span></div>
      <div class="cf-lead">${deskHTML(r.lead, { lead: true, crown: !r.solo, count: r.count })}</div>
      ${r.desks.length ? `<div class="cf-desks">${r.desks.map((b) => deskHTML(b)).join('')}</div>` : ''}
      ${bench}
    </section>`;
  }
  const kpiHTML = (o) => {
    const ratio = o.target > 0 ? Math.max(0, Math.min(1, o.current / o.target)) : 0;
    return `<div class="cf-kpi" style="--c:${esc(o.color)}"><div class="cf-kpi-name"><i class="cf-dot"></i>${esc(o.name)}</div><div class="cf-kpi-num">${esc(String(o.current))}<span> / ${esc(String(o.target))}</span></div><div class="cf-bar"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div></div>`;
  };
  function floorHTML(c, f) {
    const line = chiefLine();
    const board = c.objectives.length ? `<div class="cf-board">${c.objectives.map(kpiHTML).join('')}</div>` : `<div class="cf-board empty">${esc(c.goal || '')}</div>`;
    const chief = `<button type="button" class="cf-chief" data-cf-chief><span class="cf-over">${line ? bubble(line, 'line') : ''}</span><span class="cf-table"><i></i></span><span class="cf-head">${chiefFigure()}</span><span class="cf-name">${esc(chiefTitle())}</span></button>`;
    const loose = f.loose.map((b) => `<div class="cf-loose">${deskHTML(b, { count: f.info.asks(b.id) })}</div>`).join('');
    return `<div class="cf-floor">${board}${chief}${f.rooms.map(roomHTML).join('')}${loose}<button type="button" class="cf-new" data-cf-new>${Company.ICON.plus}${tr('New team')}</button></div>`;
  }

  // ---------- the panel: You, or a team ----------
  function youHTML(c) {
    const waits = needs();
    const asking = state.bots.filter((b) => question(b));
    const todos = [...c.todos.filter((t) => !t.done), ...c.todos.filter((t) => t.done).slice(-5)];
    const head = (b) => (b ? botFigure(colorOf(b), 'idle', 'sm', outfitOf(b)) : chiefFigure('sm'));
    const rows = [
      ...waits.map((x, i) => `<div class="cf-row">${head(x.bot)}<span class="cf-row-text">${esc(needLine(x))}</span><button type="button" class="btn sm" data-cf-need="${i}">${answersInline(x) ? tr('Approve') : tr('Review')}</button></div>`),
      ...asking.map((b) => `<div class="cf-row">${head(b)}<span class="cf-row-text">${esc(question(b))}</span><button type="button" class="btn sm" data-cf-reply="${esc(b.id)}">${tr('Reply')}</button></div>`),
      ...todos.map((t) => `<label class="cf-row cf-todo${t.done ? ' done' : ''}"><input type="checkbox" data-cf-todo="${esc(t.id)}"${t.done ? ' checked' : ''}>${t.bot && botById(t.bot) ? head(botById(t.bot)) : ''}<span class="cf-row-text">${esc(t.text)}</span></label>`),
    ].join('');
    const n = waits.length + asking.length;
    return `<div class="cf-panel-head"><span class="cf-you">${YOU}</span><h2>${tr('You')}</h2>${n ? `<span class="cf-count">${n}</span>` : ''}</div>
      <div class="cf-rows">${rows}</div>
      <form class="co-ask small cf-add" id="cf-add"><input name="task" autocomplete="off" maxlength="300" placeholder="${tr('Add a task')}" aria-label="${tr('Add a task')}" /><button type="submit" class="co-go">${tr('Add')}</button></form>`;
  }
  function teamHTML(c, team) {
    const o = CompanyFloor.objectiveOf(team, c.objectives);
    const members = team.bots.map(botById).filter(Boolean);
    return `<div class="cf-panel-head" style="--c:${esc(team.color)}"><i class="cf-dot"></i><h2>${esc(team.name)}</h2><button type="button" class="icon-btn" data-cf-close aria-label="${tr('Close')}">${X}</button></div>
      ${o ? `<div class="cf-team-kpi"><span>${esc(o.name)}</span><b>${esc(String(o.current))}<span> / ${esc(String(o.target))}</span></b></div>` : ''}
      <div class="cf-rows">${members.map((b) => `<div class="cf-row">
        <button type="button" class="cf-member" data-cf-bot="${esc(b.id)}">${botFigure(b.color, b.state, 'sm', b.outfit)}${b.id === team.lead && members.length > 1 ? CROWN : ''}<span class="cf-row-text"><b>${esc(b.name)}</b><span>${esc(lineOf(b))}</span></span></button>
        ${b.id === team.lead ? `<span class="cf-lead-chip">${CROWN}${tr('Lead')}</span>` : `<button type="button" class="btn sm ghost" data-cf-lead="${esc(b.id)}">${tr('Make lead')}</button>`}
      </div>`).join('')}</div>`;
  }

  // ---------- drawing and wiring ----------
  function home(root, c) {
    const known = info();
    const f = { ...CompanyFloor.floor(c, state.bots, known), info: known };
    const team = teamOpen && c.teams.find((t) => t.id === teamOpen);
    if (!team) teamOpen = null;
    const typed = $('#cf-add input', root);
    const kept = typed ? { value: typed.value, focus: document.activeElement === typed } : null;
    root.innerHTML = `<div class="cf-home">
      <header class="cf-top"><h1>${esc(c.name || c.start)}</h1>${c.day ? `<span class="cf-day">${tr('Day {n} of 90', { n: c.day })}</span>` : ''}</header>
      <div class="cf-main">${floorHTML(c, f)}<aside class="cf-panel">${team ? teamHTML(c, team) : youHTML(c)}</aside></div>
    </div>`;
    const add = $('#cf-add', root);
    if (add && kept) { add.task.value = kept.value; if (kept.focus) add.task.focus(); }
    wire(root, c);
  }
  function openTeam(id) { teamOpen = teamOpen === id ? null : id; Company.redraw(); }
  function wire(root, c) {
    $$('[data-cf-bot]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); setView('bot', b.dataset.cfBot); }));
    $$('[data-cf-team]', root).forEach((r) => {
      r.onclick = () => openTeam(r.dataset.cfTeam);
      r.onkeydown = (e) => { if (e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTeam(r.dataset.cfTeam); } };
    });
    $('[data-cf-chief]', root).onclick = () => setView('chief');
    $('[data-cf-new]', root).onclick = () => newTeam(c);
    $('[data-cf-close]', root)?.addEventListener('click', () => openTeam(null));
    const waits = needs();
    $$('[data-cf-need]', root).forEach((b) => (b.onclick = () => { const x = waits[Number(b.dataset.cfNeed)]; if (answersInline(x)) answerNeed(x, true, b); else openNeed(x); }));
    $$('[data-cf-reply]', root).forEach((b) => (b.onclick = () => setView('bot', b.dataset.cfReply)));
    $$('[data-cf-todo]', root).forEach((box) => (box.onchange = () => send(`/company/todos/${encodeURIComponent(box.dataset.cfTodo)}`, 'PUT', { done: box.checked })));
    $$('[data-cf-lead]', root).forEach((b) => (b.onclick = () => send(`/company/teams/${encodeURIComponent(teamOpen)}`, 'PUT', { lead: b.dataset.cfLead })));
    const add = $('#cf-add', root);
    if (add) add.onsubmit = async (e) => {
      e.preventDefault();
      const t = CompanyFloor.task(add.task.value, state.bots);
      if (!t.text) return;
      const button = add.querySelector('.co-go');
      if (button.disabled) return;
      button.disabled = true;
      const typed = add.task.value;
      add.task.value = ''; // before the answer: the floor drawn again keeps what the field holds
      if (!(await send('/company/todos', 'POST', t.bot ? { text: t.text, bot: t.bot } : { text: t.text }))) { const now = $('#cf-add input'); if (now) now.value = typed; }
      button.disabled = false;
    };
  }
  // A change to the company: the answer is the company as it is now. What the server refuses is said in its words.
  async function send(path, method, body) {
    try { Company.changed({ company: await api(path, { method, body }) }); return true; } catch (e) { toast(e.message, true); Company.redraw(); return false; }
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
      done: async (picked, name) => { Company.changed({ company: await api('/company/teams', { method: 'POST', body: { name, bots: picked } }) }); },
    });
  }

  Company.steps.home = home;
  // The floor also shows the bots' states, what waits for the owner, the Chief's line and the open team.
  Company.steps.sig = () => [teamOpen, chiefLine(), state.bots.map((b) => [b.id, b.name, b.color, b.state, !!b.running, question(b), b.running ? liveLine(b) : keyStatus(b).text]), needs().map((x) => x.key)];
})();
