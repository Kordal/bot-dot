// The Company's Team and Start steps (#671; docs/api.md, "The Company"): the Chief's proposed bots as cards the
// owner edits (rename, remove, Routines, Asks first, Connect), "Add existing bot" (Duplicate), "Change the team…" with
// Undo, and "Create N bots"; then the Start step while the bots are made. Drawn into Company.steps.team and .start.
(() => {
  const I = {
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h12v9H6z M9 11V8a3 3 0 0 1 6 0v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  };
  const ASKS = [['rules', () => tr('Project rules')], ['every', () => tr('Every action')], ['never', () => tr('Never')]];
  const APP_NAMES = { gmail: 'Gmail', googlecalendar: 'Google Calendar', github: 'GitHub', slack: 'Slack', notion: 'Notion', googledocs: 'Google Docs', googlesheets: 'Google Sheets', linkedin: 'LinkedIn', hubspot: 'HubSpot', stripe: 'Stripe' };
  const appName = (slug) => APP_NAMES[slug] || slug.charAt(0).toUpperCase() + slug.slice(1);
  // What this page holds beside the company: the Chief at work, the open parts and a half-typed line.
  const ui = { asking: false, failed: '', sending: false, adding: false, renaming: null, draft: '', creating: false, apps: null };

  async function loadApps() {
    if (ui.apps) return;
    ui.apps = new Set();
    try { for (const c of (await api('/connectors')).connections || []) if (c.status === 'ACTIVE') ui.apps.add(c.toolkit); } catch { /* none connected */ }
    Company.redraw();
  }
  const took = (c) => { state.company = c; Company.redraw(); };
  async function call(path, body, method = 'POST') {
    try { took(await api(path, { method, ...(body ? { body } : {}) })); return true; } catch (e) { toast(e.message, true); return false; }
  }
  async function propose() {
    ui.asking = true; ui.failed = '';
    try { took(await api('/company/proposal', { method: 'POST' })); } catch (e) { ui.failed = e.message; }
    ui.asking = false;
    Company.redraw();
  }
  const save = (proposal) => call('/company', { proposal }, 'PATCH');
  const edit = (c, key, change) => save(c.proposal.map((p) => (p.key === key ? { ...p, ...change } : p)));

  // ---------- Team ----------
  function team(root, c) {
    if (!c.proposal) {
      if (!ui.asking && !ui.failed) propose();
      root.innerHTML = ui.failed
        ? `<div class="co-start"><p class="co-given">${esc(ui.failed)}</p><div><button type="button" class="btn" data-again>${tr('Try again')}</button></div></div>`
        : `<div class="co-start co-wait" aria-busy="true">${chiefFigure('lg')}</div>`;
      const again = $('[data-again]', root);
      if (again) again.onclick = () => { ui.failed = ''; propose(); };
      return;
    }
    loadApps();
    const n = c.proposal.length;
    root.innerHTML = `<div class="co-team">
      <div class="co-cards">${c.proposal.map((p) => card(c, p)).join('')}
        <button type="button" class="btn co-addbot" data-add-bot>${Company.ICON.plus}${tr('Add a bot')}</button>
      </div>
      <aside class="co-aside">
        <section class="co-panel">
          <button type="button" class="btn co-existing" data-existing aria-expanded="${ui.adding}">${Company.ICON.plus}${tr('Add existing bot')}</button>
          ${ui.adding ? existing(c) : ''}
          ${c.teamChat?.length ? `<div class="co-chat">${c.teamChat.map((m) => (m.who === 'you' ? `<div class="co-said">${esc(m.text)}</div>` : `<div class="co-reply">${chiefFigure('sm')}<span>${esc(m.text)}</span>${m.undo && c.canUndo ? `<button type="button" class="co-undo" data-undo>${tr('Undo')}</button>` : ''}</div>`)).join('')}</div>` : ''}
          <form class="co-ask small" id="co-change"><input name="text" autocomplete="off" maxlength="300" placeholder="${tr('Change the team…')}" aria-label="${tr('Change the team…')}" ${ui.sending ? 'disabled' : ''} /><button type="submit" class="co-go${ui.sending ? ' spin' : ''}" aria-label="${tr('Send')}" ${ui.sending ? 'disabled' : ''}>${Company.ICON.go}</button></form>
        </section>
        ${c.never.length ? `<section class="co-panel"><h2>${tr('Never without asking')}</h2><ul class="co-never">${c.never.map((t, i) => `<li>${I.lock}<span>${esc(t)}</span><button type="button" class="icon-btn sm" data-unnever="${i}" aria-label="${tr('Remove')}">${Company.ICON.x}</button></li>`).join('')}</ul></section>` : ''}
        <section class="co-panel"><h2>${tr('Project memory')}</h2><div class="co-facts">${I.check}${trn(c.facts || 0, '{n} fact', '{n} facts')}</div></section>
      </aside>
    </div>
    <div class="co-foot"><button type="button" class="btn ghost" data-back>${I.back}${tr('Back')}</button><button type="button" class="co-go" data-create ${n ? '' : 'disabled'}>${trn(n, 'Create {n} bot', 'Create {n} bots')}</button></div>`;
    wire(root, c);
  }

  function card(c, p) {
    const missing = p.connects.filter((a) => ui.apps && !ui.apps.has(a));
    const chips = (list, icon) => (list.length ? list.map((x) => `<span class="co-tag-chip">${icon}${esc(x)}</span>`).join('') : `<span class="co-none">${tr('None')}</span>`);
    const name = ui.renaming === p.key
      ? `<form class="co-rename" data-rename-form><input name="name" value="${esc(p.name)}" maxlength="60" aria-label="${tr('Name')}" /></form>`
      : `<b>${esc(p.name)}</b><button type="button" class="icon-btn sm" data-rename aria-label="${tr('Rename')}">${I.pen}</button>`;
    return `<article class="co-card" data-key="${esc(p.key)}">
      <div class="co-card-head">${botFigure(p.color, 'idle')}<div class="co-card-title"><div class="co-card-name">${name}</div>${p.description ? `<div class="co-card-job">${esc(p.description)}</div>` : ''}</div><button type="button" class="icon-btn" data-remove aria-label="${tr('Remove')}">${I.trash}</button></div>
      <div class="co-rows">
        <span class="co-k">${tr('Owns')}</span><div class="co-v">${chips(p.owns, Company.ICON.file)}</div>
        <span class="co-k">${tr('Connects')}</span><div class="co-v">${p.connects.length ? p.connects.map((a) => `<span class="co-tag-chip${missing.includes(a) ? ' off' : ''}">${Company.ICON.link}${esc(appName(a))}</span>`).join('') : `<span class="co-none">${tr('None')}</span>`}</div>
        <span class="co-k">${tr('Routines')}</span><div class="co-v">${p.routines ? `<label class="co-routine"><span class="switch"><input type="checkbox" data-routine ${p.routinesOn ? 'checked' : ''} aria-label="${esc(p.routines)}"><span></span></span>${esc(p.routines)}</label>` : `<span class="co-none">${tr('None')}</span>`}</div>
        ${p.from ? '' : `<span class="co-k">${tr('Asks first')}</span><div class="co-v"><select class="co-asks" data-asks aria-label="${tr('Asks first')}">${ASKS.map(([k, label]) => `<option value="${k}" ${p.asksFirst === k ? 'selected' : ''}>${label()}</option>`).join('')}</select></div>`}
      </div>
      ${p.preview || missing.length ? `<div class="co-preview"><span class="co-when">${c.kind === 'site' ? tr('Yesterday') : tr('Week one')}</span><span class="co-preview-text">${esc(p.preview || '—')}</span>${missing.map((a) => `<button type="button" class="btn sm" data-connect-app="${esc(a)}">${tr('Connect {app}', { app: esc(appName(a)) })}</button>`).join('')}</div>` : ''}
    </article>`;
  }

  // The account's bots, each with Duplicate, or Added when its copy is in the team.
  function existing(c) {
    const list = (state.bots || []).filter((b) => !c.proposal.some((p) => p.bot === b.id));
    if (!list.length) return '';
    return `<ul class="co-existing-list">${list.map((b) => {
      const added = c.proposal.some((p) => p.from === b.id);
      return `<li>${botFigure(b.color, 'idle', 'sm', b.outfit, b.id)}<div><b>${esc(b.name)}</b>${b.description ? `<span>${esc(b.description)}</span>` : ''}</div><button type="button" class="btn sm" data-duplicate="${esc(b.id)}" ${added ? 'disabled' : ''}>${added ? tr('Added') : tr('Duplicate')}</button></li>`;
    }).join('')}</ul>`;
  }

  function wire(root, c) {
    const form = $('#co-change', root);
    form.text.value = ui.draft;
    form.text.oninput = () => { ui.draft = form.text.value; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = form.text.value.trim();
      if (!text || ui.sending) return;
      ui.sending = true;
      Company.redraw();
      try { const next = await api('/company/proposal/chat', { method: 'POST', body: { text } }); ui.draft = ''; state.company = next; } catch (err) { toast(err.message, true); }
      ui.sending = false;
      Company.redraw();
      $('#co-change input')?.focus();
    };
    // "Add a bot" is said to the Chief, who designs it.
    $('[data-add-bot]', root).onclick = () => { ui.draft = tr('Add a bot that '); const input = $('#co-change input'); input.value = ui.draft; input.focus(); };
    $('[data-existing]', root).onclick = () => { ui.adding = !ui.adding; Company.redraw(); };
    $$('[data-duplicate]', root).forEach((b) => (b.onclick = () => { b.disabled = true; call('/company/proposal/duplicate', { bot: b.dataset.duplicate }); }));
    $$('[data-undo]', root).forEach((b) => (b.onclick = () => call('/company/proposal/undo')));
    $$('[data-unnever]', root).forEach((b) => (b.onclick = () => call('/company', { never: c.never.filter((_, i) => i !== Number(b.dataset.unnever)) }, 'PATCH')));
    $('[data-back]', root).onclick = () => Company.go('about');
    $('[data-create]', root).onclick = () => create();
    $$('.co-card', root).forEach((el) => {
      const key = el.dataset.key;
      const p = c.proposal.find((x) => x.key === key);
      $('[data-remove]', el).onclick = () => save(c.proposal.filter((x) => x.key !== key));
      const rename = $('[data-rename]', el);
      if (rename) rename.onclick = () => { ui.renaming = key; Company.redraw(); $(`.co-card[data-key="${CSS.escape(key)}"] input`)?.select(); };
      const rf = $('[data-rename-form]', el);
      if (rf) {
        const done = (keep) => { ui.renaming = null; const v = rf.name.value.trim(); if (keep && v && v !== p.name) edit(c, key, { name: v }); else Company.redraw(); };
        rf.onsubmit = (e) => { e.preventDefault(); done(true); };
        rf.name.onkeydown = (e) => { if (e.key === 'Escape') done(false); };
        rf.name.onblur = () => { if (ui.renaming === key) done(true); };
      }
      const routine = $('[data-routine]', el);
      if (routine) routine.onchange = () => edit(c, key, { routinesOn: routine.checked });
      const asks = $('[data-asks]', el);
      if (asks) asks.onchange = () => edit(c, key, { asksFirst: asks.value });
      $$('[data-connect-app]', el).forEach((b) => (b.onclick = () => connectApp(b.dataset.connectApp, () => { ui.apps.add(b.dataset.connectApp); Company.redraw(); })));
    });
  }

  // ---------- Start ----------
  async function create() {
    if (ui.creating) return;
    ui.creating = true;
    Company.go('start');
    try { state.company = await api('/company/start', { method: 'POST' }); } catch (e) { toast(e.message, true); ui.creating = false; return Company.go('team'); }
    ui.creating = false;
    Company.redraw();
  }
  function start(root, c) {
    const running = c.phase === 'running';
    // A made bot as the list has it, else as it was proposed (the list hears of it a moment later).
    const botOf = (id) => { const b = (state.bots || []).find((x) => x.id === id); const p = (c.proposal || []).find((x) => x.bot === id); return { name: b?.name || p?.name || '', color: b?.color || p?.color, outfit: b?.outfit || null }; };
    const rows = running
      ? c.teams.map((t) => `<li class="co-made-team"><span class="co-dot" style="background:${esc(t.color)}"></span><b>${esc(t.name)}</b></li>${t.bots.map((id) => { const b = botOf(id); return `<li>${botFigure(b.color, 'idle', 'sm', b.outfit, id)}<span>${esc(b.name)}</span>${id === t.lead && t.bots.length > 1 ? `<span class="co-lead">${tr('Lead')}</span>` : ''}${I.check}</li>`; }).join('')}`).join('')
      : (c.proposal || []).map((p) => `<li>${botFigure(p.color, 'working', 'sm')}<span>${esc(p.name)}</span></li>`).join('');
    root.innerHTML = `<div class="co-start co-made"><h1>${running ? tr('Team ready') : tr('Creating your team')}</h1><ul class="co-made-list">${rows}</ul>
      ${running && Company.steps.home ? `<div><button type="button" class="co-go" data-home>${tr('Open')} ${Company.ICON.go}</button></div>` : ''}</div>`;
    const home = $('[data-home]', root);
    if (home) home.onclick = () => Company.go(null);
  }
  Company.steps.team = team;
  Company.steps.start = start;
})();
