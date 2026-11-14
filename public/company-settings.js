// Project settings (#701): the gear beside a project's name opens them, from a server with `project-settings`. One
// page of rows, each a label and the field that changes it, saved as it is changed: General (name, colour, the site or
// idea it started from, its sources, its folder: #702), Team
// (each team's name, bots and lead; a new team), Reports (each lead's rhythm, the morning standup), Rules (what the
// team never does without asking, the owner's time) and Archive or delete. A wide window has the sections listed on
// the left; a phone has them as a row of tabs. A change from elsewhere (the Chief, another window) shows at once,
// except while a field here has the focus: then once it loses it.
(() => {
  const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const CROWN = '<svg class="ps-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 3 7l5 4 4-6 4 6 5-4-1 10z"/></svg>';
  // lib/company.js PROJECT_COLORS.
  const COLORS = ['#ff6b35', '#34c759', '#3aa0ff', '#8e7cff', '#ffb020', '#ff5c8a', '#2ec4b6', '#b07cff'];
  const SECTIONS = [['general', () => tr('General')], ['team', () => tr('Team')], ['reports', () => (state.features || []).includes('project-updates') ? tr('Project updates') : tr('Reports')], ['rules', () => tr('Rules')], ['archive', () => tr('Archive or delete')]];
  const RHYTHMS = [['', () => tr('Off')], ['daily', () => tr('Daily')], ['twice-weekly', () => tr('Twice a week')], ['weekly', () => tr('Weekly')]];
  // The team being edited: its id, 'new' for a new one, or null; and what its editor holds.
  const botWrites = new Set();
  let editing = null;
  let draft = null;
  // A change that came while a field had the focus: drawn once it loses it.
  let pending = false;
  // The add field to give the focus back to once the page is drawn again (adding several in a row).
  let refocus = null;
  // The Vault's logins, for the Logins row's Add (#804): null until read, and its menu open or not.
  let vaultLogins = null;
  let loginMenu = false;

  const row = (label, value, cls = '') => `<div class="ps-row${cls ? ` ${cls}` : ''}"><span class="ps-label">${label}</span><div class="ps-value">${value}</div></div>`;
  const section = (key, title, body, cls = '') => `<section class="ps-card${cls ? ` ${cls}` : ''}" id="ps-${key}" data-ps-section="${key}"><h2>${title}</h2>${body}</section>`;
  const nameOf = (c) => c.name || c.start;
  const field = (name, value, max, extra = '') => `<input class="ps-input" data-ps-field="${name}" value="${esc(value || '')}" maxlength="${max}" autocomplete="off" aria-label="${esc(extra)}" />`;
  const seg = (attr, list, on, extra = '') => `<div class="ps-seg" role="group">${list.map(([v, label]) => `<button type="button"${extra} ${attr}="${esc(v)}" aria-pressed="${v === on}" class="${v === on ? 'on' : ''}">${label()}</button>`).join('')}</div>`;
  // A field of the page has the focus: drawing it again would take what is being typed.
  const typing = (root) => { const el = document.activeElement; return !!el && root.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !['checkbox', 'radio'].includes(el.type); };
  const face = (b) => `<span class="ps-face">${botFigure(colorOf(b), b.state, 'sm', outfitOf(b), b.id)}</span>`;

  function generalHTML(c) {
    const swatches = `<div class="ps-swatches">${COLORS.map((col) => `<button type="button" class="ps-swatch${col === c.color ? ' on' : ''}" style="--c:${col}" data-ps-color="${col}" aria-pressed="${col === c.color}" aria-label="${col}">${col === c.color ? esc(nameOf(c).charAt(0).toUpperCase()) : ''}</button>`).join('')}</div>`;
    const sources = `<ul class="ps-list">${c.sources.map((s) => `<li><span class="ps-item">${esc(s.name)}</span><button type="button" class="icon-btn" data-ps-unsource="${esc(s.id)}" aria-label="${tr('Remove')}">${X}</button></li>`).join('')}</ul>
      <div class="ps-adds"><button type="button" class="btn sm" data-ps-add-files>${PLUS}${tr('Add files')}</button><button type="button" class="btn sm" data-ps-add-link>${PLUS}${tr('Add a link')}</button><input type="file" multiple hidden data-ps-files /></div>
      <form class="ps-add hidden" data-ps-link-form><input class="ps-input" name="url" autocomplete="off" maxlength="1000" placeholder="https://" aria-label="${tr('Add a link')}" /></form>`;
    return section('general', tr('General'), row(tr('Name'), field('name', c.name, 80, tr('Name')))
      + row(tr('Color'), swatches)
      + row(tr('Site or idea'), field('start', c.start, 500, tr('Site or idea')))
      + row(tr('Sources'), sources, 'top')
      + (c.folder ? row(tr('Folder'), `<span class="ps-path" title="${esc(c.folder.path)}">${esc(c.folder.path)}</span><button type="button" class="btn sm" data-ps-folder>${tr('Open')}</button>`) : '')
      + loginsHTML(c));
  }

  // The Vault logins the project's cards call its own servers with (#804): each with Remove; Add picks another of the
  // Vault's logins, or makes a new one.
  function loginsHTML(c) {
    if (!(state.features || []).includes('project-logins')) return '';
    const mine = c.logins || [];
    const ids = mine.map((l) => l.id);
    const more = (vaultLogins || []).filter((l) => (l.kind || 'login') === 'login' && !ids.includes(l.id));
    const menu = loginMenu ? `<div class="pc-menu ps-login-menu" role="menu">${more.map((l) => `<button type="button" role="menuitem" data-ps-login="${esc(l.id)}">${esc(l.name)}</button>`).join('')}<button type="button" role="menuitem" class="ps-login-new" data-ps-login-new>${tr('New login…')}</button></div>` : '';
    const list = `<ul class="ps-list">${mine.map((l) => `<li><span class="ps-item" title="${esc(l.site || '')}">${esc(l.name || l.id)}</span><button type="button" class="icon-btn" data-ps-unlogin="${esc(l.id)}" aria-label="${tr('Remove')}">${X}</button></li>`).join('')}</ul>
      <div class="ps-adds ps-login-add"><button type="button" class="btn sm" data-ps-add-login aria-expanded="${loginMenu}">${PLUS}${tr('Add')}</button>${menu}</div>`;
    return `<div id="ps-logins">${row(tr('Logins'), list, 'top')}</div>`;
  }

  function teamHTML(c) {
    const teams = c.teams.map((t) => {
      if (editing === t.id) return editorHTML(c, t);
      const members = t.bots.map(botById).filter(Boolean);
      return `<div class="ps-row ps-team" style="--c:${esc(t.color)}"><span class="ps-label"><i class="ps-dot"></i>${esc(t.name)}</span><div class="ps-value"><span class="ps-faces">${members.map((b) => `<span class="ps-face-wrap" title="${esc(b.name)}">${face(b)}${b.id === t.lead && members.length > 1 ? CROWN : ''}</span>`).join('')}</span><button type="button" class="btn sm ghost" data-ps-edit-team="${esc(t.id)}">${tr('Edit')}</button></div></div>`;
    }).join('');
    const add = editing === 'new' ? editorHTML(c, null) : `<div class="ps-adds"><button type="button" class="btn sm" data-ps-new-team>${PLUS}${tr('New team')}</button></div>`;
    return section('team', tr('Team'), leadHTML(c) + teams + ownHTML(c) + add);
  }

  // Who talks to the project's teams for the owner (ADR 230): a bot the owner picks, in its own chat, or the Chief in
  // the project's own chat. The project's bots come first.
  function leadHTML(c) {
    if (!(state.features || []).includes('project-lead')) return '';
    const mine = new Set([...c.teams.flatMap((t) => t.bots), ...(c.bots || [])]);
    const bots = [...(state.bots || [])].sort((a, b) => (mine.has(b.id) - mine.has(a.id)) || a.name.localeCompare(b.name));
    const opt = (v, label) => `<option value="${esc(v)}"${(c.lead || '') === v ? ' selected' : ''}>${esc(label)}</option>`;
    return row(tr('Project Manager'), `<select class="ps-input" data-ps-project-lead aria-label="${tr('Project Manager')}">${opt('', chiefTitle())}${bots.map((b) => opt(b.id, b.name)).join('')}</select>`);
  }
  // The project's own bots in no team (ADR 233), each with ✕ to take it out of the project. They are added on the
  // project's page.
  function ownHTML(c) {
    const own = (c.bots || []).map(botById).filter(Boolean);
    if (!own.length) return '';
    return row(tr('Bots'), `<span class="ps-own">${own.map((b) => `<span class="ps-own-bot">${face(b)}<span>${esc(b.name)}</span><button type="button" class="icon-btn" data-ps-unbot="${esc(b.id)}" aria-label="${esc(tr('Remove {name}', { name: b.name }))}" title="${esc(tr('Remove {name}', { name: b.name }))}">${X}</button></span>`).join('')}</span>`, 'top');
  }
  // A team's editor: its name, which bots are in it (a bot may be in several teams, ADR 199), its lead.
  function editorHTML(c, t) {
    if (!draft) draft = t ? { name: t.name, bots: [...t.bots], lead: t.lead } : { name: '', bots: [], lead: '' };
    const lead = draft.bots.includes(draft.lead) ? draft.lead : draft.bots[0] || '';
    const bots = state.bots;
    return `<div class="ps-editor" data-ps-editor>
      ${row(tr('Name'), `<input class="ps-input" data-ps-team-name value="${esc(draft.name)}" maxlength="60" autocomplete="off" aria-label="${tr('Name')}" />`)}
      ${row(tr('Bots'), `<div class="ps-pick">${bots.map((b) => `<button type="button" class="ps-bot${draft.bots.includes(b.id) ? ' on' : ''}" data-ps-member="${esc(b.id)}" aria-pressed="${draft.bots.includes(b.id)}">${face(b)}<span>${esc(b.name)}</span></button>`).join('')}</div>`, 'top')}
      ${draft.bots.length > 1 ? row(tr('Lead'), `<select class="ps-input" data-ps-lead aria-label="${tr('Lead')}">${draft.bots.map(botById).filter(Boolean).map((b) => `<option value="${esc(b.id)}"${b.id === lead ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`) : ''}
      <div class="ps-actions">${t ? `<button type="button" class="btn ghost danger" data-ps-delete-team="${esc(t.id)}">${tr('Delete team')}</button>` : ''}<span class="grow"></span><button type="button" class="btn ghost" data-ps-cancel-team>${tr('Cancel')}</button><button type="button" class="btn primary" data-ps-save-team${draft.name.trim() && draft.bots.length ? '' : ' disabled'}>${tr('Save')}</button></div>
    </div>`;
  }

  function reportsHTML(c) {
    if ((state.features || []).includes('project-updates')) {
      const every = c.updates?.every || 'existing';
      const choices = [...(every === 'existing' ? [['existing', () => tr('Existing schedules')]] : []), ...RHYTHMS.map(([key, name]) => [key || 'off', name])];
      const select = `<select class="ps-input" data-ps-updates aria-label="${tr('Project updates')}">${choices.map(([key, name]) => `<option value="${key}"${key === every ? ' selected' : ''}>${name()}</option>`).join('')}</select>`;
      return section('reports', tr('Project updates'), row(tr('Project updates'), select)
        + `<p class="ps-hint">${tr('One update in the primary conversation. Questions and approvals stay in Needs you.')}</p>`
        + (every === 'existing' ? `<p class="ps-hint">${tr('Existing report times stay combined until you choose a new rhythm.')}</p>` : '')
        + (c.updates?.schedules || []).map((s) => `<p class="ps-hint">${esc(s)}</p>`).join('')
        + (c.lastUpdate?.error ? `<p class="ps-hint">${tr('The last project update could not be delivered.')}</p>` : ''));
    }
    const leads = c.teams.map((t) => row(esc(t.name), seg('data-ps-report', RHYTHMS, t.report || '', ` data-ps-team="${esc(t.id)}"`))).join('');
    const standup = `<input class="ps-input ps-time" type="time" data-ps-standup-time value="${esc(c.standup.time)}" aria-label="${tr('Standup time')}"${c.standup.on ? '' : ' disabled'} /><label class="switch"><input type="checkbox" data-ps-standup-on ${c.standup.on ? 'checked' : ''} aria-label="${tr('Morning standup')}"><span></span></label>`;
    return section('reports', tr('Reports'), leads + row(tr('Morning standup'), standup));
  }

  function rulesHTML(c) {
    const never = `<ul class="ps-list">${c.never.map((n, i) => `<li><span class="ps-item">${esc(n)}</span><button type="button" class="icon-btn" data-ps-unnever="${i}" aria-label="${tr('Remove')}">${X}</button></li>`).join('')}</ul>
      ${c.never.length < 10 ? `<form class="ps-add" data-ps-never-form><input class="ps-input" name="text" autocomplete="off" maxlength="80" placeholder="${tr('Add')}" aria-label="${tr('Never without asking')}" /></form>` : ''}`;
    return section('rules', tr('Rules'), row(tr('Never without asking'), never, 'top') + row(tr('Time'), field('time', c.time, 80, tr('Time'))));
  }

  function archiveHTML(c) {
    return section('archive', tr('Archive or delete'), row(tr('Archive project'), `<button type="button" class="btn sm" data-ps-archive>${c.archived ? tr('Unarchive') : tr('Archive')}</button>`)
      + row(tr('Delete project'), `<button type="button" class="btn sm danger" data-ps-delete>${tr('Delete')}</button>`), 'ps-danger');
  }

  function draw(root, c) {
    if (root.querySelector('.ps-page') && typing(root)) { pending = true; return; }
    pending = false;
    const scroll = root.querySelector('.ps-main')?.scrollTop || 0;
    if (editing && editing !== 'new' && !c.teams.some((t) => t.id === editing)) { editing = null; draft = null; }
    root.innerHTML = `<div class="ps-page">
      <header class="ps-top"><button type="button" class="icon-btn" data-ps-back aria-label="${tr('Back')}">${BACK}</button><h1>${esc(nameOf(c))}</h1></header>
      <nav class="ps-nav" aria-label="${tr('Project settings')}">${SECTIONS.map(([k, label]) => `<button type="button" data-ps-go="${k}">${label()}</button>`).join('')}</nav>
      <div class="ps-main">${generalHTML(c)}${teamHTML(c)}${reportsHTML(c)}${rulesHTML(c)}${archiveHTML(c)}</div>
    </div>`;
    const main = $('.ps-main', root);
    if (main) main.scrollTop = scroll;
    wire(root, c);
    if (refocus) { $(refocus, root)?.focus(); refocus = null; }
  }

  // ---------- saving ----------
  async function call(path, method, body) {
    try { Company.changed({ company: await api(Company.at(path), { method, body }) }); return true; } catch (e) { toast(e.message, true); Company.redraw(); return false; }
  }
  const patch = (body) => call('/company', 'PATCH', body);

  function wire(root, c) {
    $('[data-ps-back]', root).onclick = () => Company.closeSettings();
    $$('[data-ps-go]', root).forEach((b) => (b.onclick = () => $(`#ps-${b.dataset.psGo}`, root)?.scrollIntoView({ block: 'start', behavior: 'smooth' })));
    // Enter saves the field (by leaving it), Escape puts back what it held.
    const enter = (el) => (el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } else if (e.key === 'Escape') { el.value = el.defaultValue; el.blur(); } });
    $$('[data-ps-field]', root).forEach((el) => {
      enter(el);
      el.onchange = () => { const v = el.value.trim(); if (el.dataset.psField === 'start' && !v) { el.value = c.start; return; } patch({ [el.dataset.psField]: v }); };
    });
    $$('[data-ps-color]', root).forEach((b) => (b.onclick = () => patch({ color: b.dataset.psColor })));
    // Sources.
    $$('[data-ps-unsource]', root).forEach((b) => (b.onclick = () => patch({ sources: c.sources.filter((s) => s.id !== b.dataset.psUnsource) })));
    const files = $('[data-ps-files]', root);
    $('[data-ps-add-files]', root).onclick = () => files.click();
    files.onchange = () => { upload([...files.files], c); files.value = ''; };
    // Its logins (#804).
    const ids = (c.logins || []).map((l) => l.id);
    $$('[data-ps-unlogin]', root).forEach((b) => (b.onclick = () => patch({ logins: ids.filter((x) => x !== b.dataset.psUnlogin) })));
    const addLogin = $('[data-ps-add-login]', root);
    if (addLogin) addLogin.onclick = async (e) => {
      e.stopPropagation();
      loginMenu = !loginMenu;
      if (loginMenu) { try { vaultLogins = await api('/vault'); } catch (err) { toast(err.message, true); loginMenu = false; } }
      Company.redraw();
      if (loginMenu) document.addEventListener('click', () => { if (loginMenu) { loginMenu = false; Company.redraw(); } }, { once: true });
    };
    $$('[data-ps-login]', root).forEach((b) => (b.onclick = () => { loginMenu = false; patch({ logins: [...ids, b.dataset.psLogin] }); }));
    const newLogin = $('[data-ps-login-new]', root);
    if (newLogin) newLogin.onclick = () => { loginMenu = false; Company.redraw(); openLoginEditor(null, { onSaved: (l) => patch({ logins: [...((state.company?.id === c.id ? state.company.logins : c.logins) || []).map((x) => x.id), l.id] }) }); };
    // Its folder (#702) in Files, alone.
    const folder = $('[data-ps-folder]', root);
    if (folder) folder.onclick = () => Files.openFolder({ folder: c.folder.name, name: nameOf(c), color: c.color });
    const linkForm = $('[data-ps-link-form]', root);
    $('[data-ps-add-link]', root).onclick = () => { linkForm.classList.remove('hidden'); linkForm.url.focus(); };
    // An add field gives up the focus as it saves, so the page is drawn with what it added, and takes it back after.
    const added = (input, sel) => { input.value = ''; refocus = sel; input.blur(); };
    linkForm.onsubmit = (e) => {
      e.preventDefault();
      const url = linkForm.url.value.trim();
      added(linkForm.url, '[data-ps-link-form] input');
      if (url) patch({ sources: [...c.sources, { kind: 'link', url, name: url.replace(/^https?:\/\//i, '') }] });
    };
    wireTeam(root, c);
    $('[data-ps-updates]', root)?.addEventListener('change', (e) => call('/company/updates', 'PUT', { every: e.target.value }));
    // Legacy reports and the standup.
    $$('[data-ps-report]', root).forEach((b) => (b.onclick = () => call(`/company/teams/${encodeURIComponent(b.dataset.psTeam)}`, 'PUT', { report: b.dataset.psReport || null })));
    const on = $('[data-ps-standup-on]', root);
    if (on) on.onchange = () => call('/company/standup', 'PUT', { on: on.checked });
    const time = $('[data-ps-standup-time]', root);
    if (time) time.onchange = () => { if (time.value) call('/company/standup', 'PUT', { time: time.value }); };
    // Rules.
    $$('[data-ps-unnever]', root).forEach((b) => (b.onclick = () => patch({ never: c.never.filter((_, i) => i !== Number(b.dataset.psUnnever)) })));
    const neverForm = $('[data-ps-never-form]', root);
    if (neverForm) neverForm.onsubmit = (e) => { e.preventDefault(); const t = neverForm.text.value.trim(); added(neverForm.text, '[data-ps-never-form] input'); if (t) patch({ never: [...c.never, t] }); };
    // Archive or delete.
    $('[data-ps-archive]', root).onclick = () => patch({ archived: !c.archived });
    $('[data-ps-delete]', root).onclick = () => Company.deleteProject(c);
  }

  function wireTeam(root, c) {
    if (!root.dataset.psWired) {
      root.dataset.psWired = '1';
      root.addEventListener('focusout', () => setTimeout(() => { if (pending && !typing(root)) Company.redraw(); }, 0));
    }
    // Teams.
    $$('[data-ps-edit-team]', root).forEach((b) => (b.onclick = () => { editing = b.dataset.psEditTeam; draft = null; Company.redraw(); }));
    const newTeam = $('[data-ps-new-team]', root);
    if (newTeam) newTeam.onclick = () => { editing = 'new'; draft = null; Company.redraw(); $('[data-ps-team-name]', root)?.focus(); };
    const ed = $('[data-ps-editor]', root);
    if (ed) {
      const name = $('[data-ps-team-name]', ed);
      const ready = () => { $('[data-ps-save-team]', ed).disabled = !(draft.name.trim() && draft.bots.length); };
      name.oninput = () => { draft.name = name.value; ready(); };
      name.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-ps-save-team]', ed).click(); } };
      $$('[data-ps-member]', ed).forEach((b) => (b.onclick = () => {
        const id = b.dataset.psMember;
        draft.bots = draft.bots.includes(id) ? draft.bots.filter((x) => x !== id) : [...draft.bots, id];
        Company.redraw();
      }));
      const lead = $('[data-ps-lead]', ed);
      if (lead) lead.onchange = () => { draft.lead = lead.value; };
      $('[data-ps-cancel-team]', ed).onclick = () => { editing = null; draft = null; Company.redraw(); };
      $('[data-ps-save-team]', ed).onclick = async () => {
        const body = { name: draft.name.trim(), bots: draft.bots, lead: draft.bots.includes(draft.lead) ? draft.lead : draft.bots[0] };
        const was = editing;
        name.blur(); ed.inert = true;
        editing = null; draft = null;
        if (!(await call(was === 'new' ? '/company/teams' : `/company/teams/${encodeURIComponent(was)}`, was === 'new' ? 'POST' : 'PUT', body))) { editing = was; draft = body; Company.redraw(); }
      };
      const del = $('[data-ps-delete-team]', ed);
      if (del) del.onclick = async () => {
        const t = c.teams.find((x) => x.id === del.dataset.psDeleteTeam);
        if (!t || !(await askFirst(tr('Delete the team {name}? Its bots stay.', { name: t.name }), tr('Delete')))) return;
        editing = null; draft = null;
        call(`/company/teams/${encodeURIComponent(t.id)}`, 'DELETE');
      };
    }
    // One removal at a time: each sends the whole list, so a second one waits for the first one's answer.
    $$('[data-ps-unbot]', root).forEach((b) => (b.onclick = () => {
      setBots(c, (c.bots || []).filter((id) => id !== b.dataset.psUnbot)).catch((e) => toast(e.message, true));
    }));
    $$('[data-ps-unbot], [data-cf-add-bot]', root).forEach((b) => (b.disabled = botWrites.has(c.id)));
    const projectLead = $('[data-ps-project-lead]', root);
    if (projectLead) projectLead.onchange = () => patch({ lead: projectLead.value || null });
  }

  // Files added as sources: uploaded for the Chief, as the start screen does, then saved with the others.
  async function upload(list, c) {
    const added = [];
    for (const file of list.slice(0, 20 - c.sources.length)) {
      if (file.size > 25 * 1024 * 1024) { toast(tr('{name} is over 25 MB.', { name: file.name }), true); continue; }
      try {
        const r = await fetch('/api/uploads?to=chief', { method: 'POST', headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || statusWords(r.status));
        added.push({ kind: 'file', name: file.name, upload: d });
      } catch (e) { toast(`${file.name}: ${e.message}`, true); }
    }
    if (added.length) patch({ sources: [...(state.company?.id === c.id ? state.company.sources : c.sources), ...added] });
  }

  async function setBots(c, bots) {
    if (botWrites.has(c.id)) throw new Error(tr('Saving…'));
    const path = c.id ? `/company/bots?project=${encodeURIComponent(c.id)}` : '/company/bots';
    botWrites.add(c.id); Company.redraw();
    try { Company.changed({ company: await api(path, { method: 'PUT', body: { bots } }) }); }
    finally { botWrites.delete(c.id); Company.redraw(); }
  }

  Company.teamSettings = {
    html: teamHTML, wire: wireTeam, setBots, busy: (id) => botWrites.has(id), sig: () => [editing, draft, [...botWrites]],
    hold(root) { pending = typing(root); return pending; },
  };
  Company.steps.settings = (root, c) => draw(root, c);
  Company.steps.settingsClosed = () => { editing = null; draft = null; pending = false; loginMenu = false; };
})();
