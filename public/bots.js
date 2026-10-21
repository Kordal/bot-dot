// ---------- bots ----------

function openModal(html) {
  const m = $('#modal');
  m.innerHTML = html;
  m.showModal();
  $$('[data-dismiss]', m).forEach((b) => (b.onclick = () => m.close()));
  return m;
}

// The question before a bot gets the permission mode "Everything allowed" (bypassPermissions): whether the
// owner said yes. Closing it any other way is a no.
function askEverythingAllowed(name) {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="modal-head"><h2>Let ${esc(name)} do everything without checks?</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body"><p style="margin:0">It will run any command and change any file without asking you. You can change this back here at any time.</p></div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button type="button" class="btn primary" id="allow-everything">Allow everything</button>
      </div>`);
    let yes = false;
    $('#allow-everything', m).onclick = () => { yes = true; m.close(); };
    m.addEventListener('close', () => resolve(yes), { once: true });
  });
}

function openRunDialog(botId) {
  const bot = botId && state.bots.find((b) => b.id === botId);
  const m = openModal(`
    <form method="dialog" id="run-form">
      <div class="modal-head"><h2>${bot ? `Run ${botLabel(bot)}` : 'Run a bot'}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        ${bot ? '' : `<label class="field">Bot<select name="bot">${state.bots.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}: ${esc(b.description.slice(0, 60))}</option>`).join('')}</select></label>`}
        <label class="field">Task <span class="hint">Edit it for this run only. {{date}} gets filled in.</span>
          <textarea name="prompt" rows="6"></textarea></label>
        <div class="faint" id="run-mode-info" style="font-size:12px"></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Cancel</button><button class="btn primary" type="submit">▶ Start run</button></div>
    </form>`);
  const form = $('#run-form', m);
  const sync = () => {
    const b = bot || state.bots.find((x) => x.id === form.bot.value);
    form.prompt.value = b.prompt;
    $('#run-mode-info', m).textContent = `Permission mode: ${b.permissionMode} (${MODE_INFO[b.permissionMode] || ''}) · Tools: ${b.allowedTools.join(', ') || 'default'}`;
  };
  if (form.bot) form.bot.onchange = sync;
  sync();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const id = bot ? bot.id : form.bot.value;
    const b = state.bots.find((x) => x.id === id);
    try {
      await api(`/bots/${id}/run`, { method: 'POST', body: { prompt: form.prompt.value === b.prompt ? undefined : form.prompt.value } });
      m.close();
      toast(`${b.name} started`);
      await refresh();
      setView('bot', id);
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- a bot's settings (its own page; every change saves by itself) ----------

// What a bot may do, as plain switches. Each adds or removes Claude Code tools; the exact list is under Advanced.
const PERMS = [
  { key: 'files', label: 'Can change files', hint: 'create and edit files in its folder', tools: ['Edit', 'Write'] },
  { key: 'web', label: 'Can browse the web', hint: 'search, and read web pages', tools: ['WebSearch', 'WebFetch'] },
  { key: 'bash', label: 'Can run commands', hint: 'any shell command in its folder', tools: ['Bash'] },
  { key: 'helpers', label: 'Can use helpers', hint: 'start helpers that work in parallel within one run', tools: ['Agent', 'Task'] },
];

// The page's form, in the shape the API takes. sel: the picked skills, apps and teammates.
function readBotForm(form, sel) {
  return {
    name: form.name.value,
    color: form.color.value,
    description: form.description.value,
    group: form.group.value.trim(),
    prompt: form.prompt.value,
    systemPrompt: form.systemPrompt.value,
    computer: form.computer.checked ? 'linux' : 'none',
    skills: [...sel.skills],
    disabledSkills: readDisabledSkills(form),
    connectors: [...sel.connectors],
    mayMessageAll: sel.others.every((id) => sel.mayMessage.has(id)),
    mayMessage: [...sel.mayMessage],
    othersMayAsk: form.othersMayAsk.checked,
    allowedTools: form.tools.value.split('\n').map((s) => s.trim()).filter(Boolean),
    permissionMode: form.permissionMode.value,
    ...readLlmFields(form, 'bot'),
  };
}

// Switched-off machine/built-in skills: unticked switches, plus earlier ones that aren't shown right now.
function readDisabledSkills(form) {
  let before = [];
  try { before = JSON.parse(form.dataset.disabled || '[]'); } catch { /* none */ }
  return form._sysOff ? [...form._sysOff] : before; // the Skills list sets it once loaded; until then keep as is
}

// A row that folds open (Skills, Apps, May message): what's picked in one line, and a tap on the row
// shows everything with a checkbox. Ticking saves (onChange). items: [{ id, label, desc }].
// action: { label, run(id) } puts a button on each item instead of a checkbox (e.g. Revoke); it's taken off the list once run() succeeds.
// More about a library skill, for when its name is clicked: where it came from, what it has, who uses it.
function skillMoreHTML(k) {
  const bot = (id) => (isChief({ id }) ? 'the Chief' : botById(id)?.name || 'a deleted bot');
  const from = k.source === 'github' ? `Installed by you from ${k.sourceUrl || 'GitHub'}` : k.createdBy?.startsWith('bot:') ? `Written by ${bot(k.createdBy.slice(4))}` : k.createdBy === 'chief' ? 'Written by the Chief' : 'Written by you';
  const lines = [
    from,
    k.fileCount > 1 ? `${k.fileCount} files${k.scripts?.length ? `, with scripts it can run (${k.scripts.slice(0, 3).join(', ')}${k.scripts.length > 3 ? ', …' : ''})` : ''}` : '',
    k.allowedTools?.length ? `Tools it uses: ${k.allowedTools.join(', ')}` : '',
    k.usedBy?.length ? `Used by ${k.usedBy.map(bot).join(', ')}` : 'No bot uses it yet',
  ].filter(Boolean);
  return `${lines.map(esc).join('<br>')}${k.instructions ? `<span class="pick-instructions">${esc(k.instructions.slice(0, 600))}${k.instructions.length > 600 ? '…' : ''}</span>` : ''}`;
}

function foldPicker(box, items, selected, onChange, { none = 'None', empty = 'Nothing to choose yet.', action = null, sum = null } = {}) {
  const row = box.closest('.bs-row');
  const label = (id) => items.find((x) => x.id === id)?.label || id;
  const summary = () => (sum ? sum() : [...selected].map(label).join(', ')) || none;
  let open = row.classList.contains('open');
  const draw = () => {
    row.classList.toggle('open', open);
    row.setAttribute('aria-expanded', open);
    const text = (x) => `<span class="grow"><span class="skill-name">${esc(x.label)}</span>${x.desc ? `<span class="desc">${esc(x.desc)}</span>` : ''}${x.more ? `<span class="pick-more">${x.more}</span>` : ''}</span>`;
    // Items can come in groups (a heading where the group changes), and with more to show when their name is clicked.
    const head = (x, i) => (x.group && x.group !== items[i - 1]?.group ? `<div class="pick-group">${esc(x.group)}</div>` : '');
    box.innerHTML = `<div class="faint bs-sum">${esc(summary())}</div>${open ? `<div class="pick-list">${items.length ? items.map((x, i) => head(x, i) + (action
      ? `<div class="skill-pick static-row">${text(x)}<button type="button" class="btn sm" data-pick-action="${esc(x.id)}">${esc(action.label)}</button></div>`
      : x.more
        ? `<div class="skill-pick has-more"><input type="checkbox" value="${esc(x.id)}" ${selected.has(x.id) ? 'checked' : ''} aria-label="${esc(x.label)}">${text(x)}</div>`
        : `<label class="skill-pick"><input type="checkbox" value="${esc(x.id)}" ${selected.has(x.id) ? 'checked' : ''}>${text(x)}</label>`)).join('') : `<div class="faint">${esc(empty)}</div>`}</div>` : ''}`;
    $$('.has-more > .grow', box).forEach((t) => (t.onclick = () => t.parentElement.classList.toggle('open')));
    $$('input', box).forEach((c) => (c.onchange = () => { c.checked ? selected.add(c.value) : selected.delete(c.value); onChange(); $('.bs-sum', box).textContent = summary(); }));
    $$('[data-pick-action]', box).forEach((btn) => (btn.onclick = async () => {
      btn.disabled = true;
      if (await action.run(btn.dataset.pickAction)) { items = items.filter((x) => x.id !== btn.dataset.pickAction); selected.delete(btn.dataset.pickAction); draw(); } else btn.disabled = false;
    }));
  };
  const toggle = () => { open = !open; draw(); };
  row.classList.add('bs-fold');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.onclick = (e) => { if (!e.target.closest('.pick-list')) toggle(); };
  row.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); toggle(); } };
  draw();
}

function renderBotSettings(force = false) {
  const root = $('#view-botsettings');
  const bot = state.bots.find((b) => b.id === state.botId);
  if (!bot) { if (state.bots.length) leaveBot(); return; }
  if (!force && root.dataset.bot === bot.id) { drawBotSettingsLive(bot); return; } // don't wipe what's being typed
  root.dataset.bot = bot.id;
  const b = bot;
  const docker = state.status?.docker?.ok;
  const knownTools = new Set(PERMS.flatMap((p) => p.tools));
  const has = (p) => p.tools.every((t) => b.allowedTools.includes(t));
  root.innerHTML = `
    <form id="bot-form" class="bot-settings" autocomplete="off">
      <div class="section-head"><div><h1>Settings</h1><p>Changes save by themselves. <span class="faint" id="bs-saved"></span></p></div></div>
      <div class="card settings-card">
        <label class="field">Name<input type="text" name="name" value="${esc(b.name)}" required maxlength="60"></label>
        <div class="field">Colour<div class="swatches">${BOT_COLORS.map(([c, n]) => `<label class="swatch" title="${n}"><input type="radio" name="color" value="${c}" ${b.color === c ? 'checked' : ''} aria-label="${n}"><i style="--c:${c}"></i></label>`).join('')}</div></div>
        <label class="field">What it does<input type="text" name="description" value="${esc(b.description)}" placeholder="One line, shown in the list"></label>
        <div class="field">Category
          <div class="group-picker" id="group-picker"></div>
          <input type="hidden" name="group" value="${esc(b.group || '')}">
        </div>
        <label class="field">Main assignment <span class="hint">what it does when a job runs it, and its guide for your messages</span>
          <textarea name="prompt" rows="5" required>${esc(b.prompt)}</textarea></label>
      </div>

      <div class="card settings-card bs-rows">
        <div class="bs-row ${docker || b.computer === 'linux' ? '' : 'hidden'}">
          <span class="bs-icon">🖥</span>
          <div class="grow"><b>Uses the computer</b><div class="faint">Its own screen and browser on the account's computer, with sudo there, like every bot that uses it.${b.computer === 'linux' ? ' <button type="button" class="link-btn" data-bs-screen>See its screen</button>' : ''}</div></div>
          <label class="switch"><input type="checkbox" name="computer" ${b.computer === 'linux' ? 'checked' : ''} ${docker || b.computer === 'linux' ? '' : 'disabled'} aria-label="Uses the computer"><span></span></label>
        </div>
        <div class="bs-row">
          <span class="bs-icon">📌</span>
          <div class="grow"><b>Pinned below the Chief</b></div>
          <label class="switch"><input type="checkbox" id="bs-pinned" ${b.pinned > 0 ? 'checked' : ''} aria-label="Pinned below the Chief"><span></span></label>
        </div>
        <div class="bs-row" id="bs-skills">
          <span class="bs-icon">✦</span>
          <div class="grow"><b>Skills</b>${b.useSkills === false ? '<div class="faint">Skills are off for this bot. <button type="button" class="link-btn" data-skills-on>Turn them on</button></div>' : '<div id="skill-picks"><span class="faint">Loading…</span></div>'}</div>
          ${b.useSkills === false ? '' : '<span class="faint bs-chev">›</span>'}
        </div>
        <div class="bs-row hidden" id="bs-apps">
          <span class="bs-icon">🔌</span>
          <div class="grow"><b>Apps</b><div id="app-picks"></div></div>
          <span class="faint bs-chev">›</span>
        </div>
        <div class="bs-row ${state.bots.length > 1 ? '' : 'hidden'}">
          <span class="bs-icon">💬</span>
          <div class="grow"><b>May message</b><div id="bot-picks"></div></div>
          <span class="faint bs-chev">›</span>
        </div>
        <div class="bs-row ${state.bots.length > 1 ? '' : 'hidden'}">
          <span class="bs-icon">🔓</span>
          <div class="grow"><b>Other bots may ask it</b><div class="faint">Off keeps it to you: other bots don't see it among their teammates and can't message it.</div></div>
          <label class="switch"><input type="checkbox" name="othersMayAsk" ${b.othersMayAsk !== false ? 'checked' : ''} aria-label="Other bots may ask it"><span></span></label>
        </div>
        <button type="button" class="bs-row bs-link" data-bs-jobs>
          <span class="bs-icon">⏰</span>
          <div class="grow"><b>Scheduled jobs</b><div class="faint" id="bs-jobs"></div></div>
          <span class="faint">›</span>
        </button>
        <div class="bs-row" id="bs-always">
          <span class="bs-icon">✓</span>
          <div class="grow"><b>Always approved</b><div id="always-picks"></div></div>
          <span class="faint bs-chev">›</span>
        </div>
      </div>

      <details class="card settings-card bs-advanced" id="bs-advanced">
        <summary><h3 class="page-sub" style="margin:0">Advanced</h3><span class="faint">What it may do, model, rules</span></summary>
        <div class="field">What it may do
          ${PERMS.map((p) => `<label class="toggle"><input type="checkbox" data-perm="${p.key}" ${has(p) ? 'checked' : ''}> ${p.label} <span class="hint muted" style="font-weight:400">${p.hint}</span></label>`).join('')}
          <details class="bs-exact" ${b.allowedTools.some((t) => !knownTools.has(t) && !['Read', 'Grep', 'Glob'].includes(t)) || !['dontAsk', 'acceptEdits'].includes(b.permissionMode) ? 'open' : ''}>
            <summary class="faint">Exact tools and permission mode</summary>
            <label class="field">Allowed tools <span class="hint">one per line, e.g. Bash(pytest:*) or mcp__github</span>
              <textarea class="mono" name="tools" rows="4">${esc(b.allowedTools.join('\n'))}</textarea></label>
            <label class="field">Permission mode<select name="permissionMode">${Object.entries(MODE_INFO).map(([k, v]) => `<option value="${k}" ${k === b.permissionMode ? 'selected' : ''}>${k}: ${v}</option>`).join('')}</select></label>
          </details>
        </div>
        <div class="field">Model and reasoning
          ${llmFieldsHTML('bot', { model: b.model, effort: b.effort }, `Default (${llmSummary(state.settings?.defaultModel, state.settings?.defaultEffort)})`)}
        </div>
        <label class="field">Personality / rules <span class="hint">added to Claude Code's system prompt</span>
          <textarea name="systemPrompt" rows="3">${esc(b.systemPrompt)}</textarea></label>
      </details>
      <div class="bs-foot">${state.features.includes('duplicate-bot') ? `<button type="button" class="link-btn" id="duplicate-bot">Duplicate ${esc(b.name)}</button>` : ''}<button type="button" class="link-btn danger-text" id="delete-bot">Delete ${esc(b.name)}</button></div>
    </form>`;

  const form = $('#bot-form', root);
  form.dataset.disabled = JSON.stringify(b.disabledSkills || []);
  const others = state.bots.filter((x) => x.id !== b.id).map((x) => x.id);
  const sel = { skills: new Set(b.skills || []), connectors: new Set(b.connectors || []), mayMessage: new Set(b.mayMessageAll ? others : b.mayMessage || []), others };
  let saved = readBotForm(form, sel);
  let chain = Promise.resolve();
  let timer = null;
  // Send only what changed since the last save, one save at a time.
  const save = () => {
    clearTimeout(timer);
    chain = chain.then(async () => {
      const now = readBotForm(form, sel);
      const changes = Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved[k])));
      if (!Object.keys(changes).length) return;
      const note = $('#bs-saved', root);
      note.textContent = 'Saving…';
      try {
        const updated = await api(`/bots/${b.id}`, { method: 'PUT', body: changes });
        saved = { ...saved, ...changes };
        const i = state.bots.findIndex((x) => x.id === b.id);
        if (i >= 0) state.bots[i] = { ...state.bots[i], ...updated };
        note.textContent = 'Saved.';
        renderContacts();
        drawPanelHead(); // its name is the back button's
        if (state.view === 'bot' && state.botId === b.id) renderBotChat(); // and the chat's, beside the panel
      } catch (e) { note.textContent = ''; toast(e.message, true); }
    });
  };
  const saveSoon = () => { clearTimeout(timer); timer = setTimeout(save, 300); };
  form.addEventListener('change', (e) => { if (!e.target.matches('[data-perm]')) saveSoon(); });
  // "Everything allowed" asks first. Until the answer the select is back at its earlier mode, so that no
  // save, this one or another field's, carries the new one; Cancel leaves it there and saves nothing.
  let mode = form.permissionMode.value;
  form.permissionMode.addEventListener('change', async (e) => {
    const select = e.target;
    if (select.value !== 'bypassPermissions') { mode = select.value; return; }
    e.stopPropagation(); // not the form's listener above: nothing is saved before the answer
    select.value = mode;
    if (!(await askEverythingAllowed(form.name.value.trim() || b.name))) return;
    select.value = mode = 'bypassPermissions';
    saveSoon();
  });
  form.onsubmit = (e) => { e.preventDefault(); save(); };

  $('[data-bs-jobs]', root).onclick = () => setView('botjobs', b.id);
  const scr = $('[data-bs-screen]', root);
  if (scr) scr.onclick = () => openScreen(b.id);
  groupPicker($('#group-picker', root), form.group, saveSoon);
  // Saved on its own (not with the form), so a stale form never moves it.
  $('#bs-pinned', root).onchange = (e) => pinBot(state.bots.find((x) => x.id === b.id) || b, e.target.checked ? state.bots.filter((x) => x.pinned > 0 && x.id !== b.id).length + 1 : 0);
  wireLlmFields(form, 'bot');

  // The switches under "What it may do" add or remove their tools in the exact list (and the mode for files).
  const syncPerms = () => {
    const tools = new Set(form.tools.value.split('\n').map((s) => s.trim()).filter(Boolean));
    $$('[data-perm]', form).forEach((c) => { c.checked = PERMS.find((p) => p.key === c.dataset.perm).tools.every((t) => tools.has(t)); });
  };
  $$('[data-perm]', form).forEach((c) => (c.onchange = () => {
    const p = PERMS.find((x) => x.key === c.dataset.perm);
    const tools = form.tools.value.split('\n').map((s) => s.trim()).filter(Boolean).filter((t) => !p.tools.includes(t));
    if (c.checked) tools.push(...p.tools);
    form.tools.value = tools.join('\n');
    if (p.key === 'files') {
      if (c.checked && form.permissionMode.value === 'dontAsk') form.permissionMode.value = 'acceptEdits';
      if (!c.checked && form.permissionMode.value === 'acceptEdits') form.permissionMode.value = 'dontAsk';
      mode = form.permissionMode.value;
    }
    saveSoon();
  }));
  form.tools.addEventListener('input', syncPerms);

  // Advanced stays open or closed as you last left it (this browser).
  const adv = $('#bs-advanced', root);
  try { adv.open = localStorage.getItem('botdot.bs.advanced') === '1'; } catch { /* private mode */ }
  adv.addEventListener('toggle', () => { try { localStorage.setItem('botdot.bs.advanced', adv.open ? '1' : '0'); } catch { /* private mode */ } });

  const on = $('[data-skills-on]', root);
  if (on) on.onclick = async () => {
    try { await api(`/bots/${b.id}`, { method: 'PUT', body: { useSkills: true } }); await refresh(); renderBotSettings(true); } catch (e) { toast(e.message, true); }
  };

  // Skills from your library: its own chips, and new ones written or imported for it right here.
  let ownSkills = []; // skills this bot wrote, which go with it when it's deleted
  const loadSkills = () => api('/skills').then(({ library, machine, builtin }) => {
    ownSkills = library.filter((k) => k.createdBy === `bot:${b.id}`);
    // One list: your library's skills (which it gets), and the ones from your Claude account and
    // Claude Code that every bot has unless you switch them off here.
    const box = $('#skill-picks', root);
    if (!box) return;
    const off = new Set(b.disabledSkills || []);
    const sys = [...machine.map((k) => ({ ...k, from: 'from your Claude account' })), ...(builtin || []).map((k) => ({ ...k, from: 'built into Claude Code' }))];
    const everyBot = 'Every bot has it unless you switch it off here.';
    // In each group the ones it has come first (as saved, so rows don't jump while you tick them).
    const has = new Set(b.skills || []);
    const first = (list, active) => [...list.filter(active), ...list.filter((k) => !active(k))];
    const items = [
      ...first(library, (k) => has.has(k.name)).map((k) => ({ id: `lib:${k.name}`, label: k.name, desc: k.description, group: 'Your skills', more: skillMoreHTML(k) })),
      ...['from your Claude account', 'built into Claude Code'].flatMap((from) => first(sys.filter((k) => k.from === from), (k) => !off.has(k.name))).map((k) => ({
        id: `sys:${k.name}`, label: k.name, desc: k.description,
        group: k.from === 'built into Claude Code' ? 'Built into Claude Code' : 'From your Claude account',
        more: esc(k.from === 'built into Claude Code' ? `Comes with Claude Code. ${everyBot}` : `Installed in your Claude account. ${everyBot}`),
      })),
    ];
    const on = new Set([...[...sel.skills].map((n) => `lib:${n}`), ...sys.filter((k) => !off.has(k.name)).map((k) => `sys:${k.name}`)]);
    form._sysOff = sys.filter((k) => off.has(k.name)).map((k) => k.name);
    const sum = () => {
      const lib = library.filter((k) => on.has(`lib:${k.name}`)).map((k) => k.name);
      const count = (from) => sys.filter((k) => k.from === from && on.has(`sys:${k.name}`)).length;
      const acc = count('from your Claude account'), built = count('built into Claude Code');
      return [...lib, acc ? `${acc} from your Claude account` : '', built ? `${built} built into Claude Code` : ''].filter(Boolean).join(', ');
    };
    foldPicker(box, items, on, () => {
      sel.skills.clear();
      library.forEach((k) => on.has(`lib:${k.name}`) && sel.skills.add(k.name));
      form._sysOff = sys.filter((k) => !on.has(`sys:${k.name}`)).map((k) => k.name);
      saveSoon();
    }, { empty: 'No skills yet. Ask the Chief to write one.', sum });
  }).catch(() => { const box = $('#skill-picks', root); if (box) box.innerHTML = '<span class="faint">Couldn\'t load skills.</span>'; });
  loadSkills();

  // Connected apps (Composio): shown once any are connected, or this bot already has some.
  api('/connectors').then((d) => {
    const apps = [...new Map(d.connections.filter((c) => c.status === 'ACTIVE').map((c) => [c.toolkit, c.app || { slug: c.toolkit, name: c.toolkit }])).values()];
    for (const s of sel.connectors) if (!apps.some((a) => a.slug === s)) apps.push({ slug: s, name: s }); // e.g. apps without sign-in
    if (!d.configured || !apps.length) return;
    $('#bs-apps', root).classList.remove('hidden');
    foldPicker($('#app-picks', root), apps.map((a) => ({ id: a.slug, label: a.name })), sel.connectors, saveSoon);
  }).catch(() => {});

  foldPicker($('#bot-picks', root), state.bots.filter((x) => x.id !== b.id).map((x) => ({ id: x.id, label: x.name, desc: x.description.slice(0, 120) })), sel.mayMessage, saveSoon,
    { none: 'Nobody', sum: () => (others.length > 1 && others.every((id) => sel.mayMessage.has(id)) ? 'Everyone' : [...sel.mayMessage].map((id) => botById(id)?.name || id).join(', ')) });
  // The jobs you said to always approve: their later changes need no OK. Untick one and it asks again.
  const trusted = (b.jobs || []).filter((j) => j.alwaysApprove);
  const alwaysBox = $('#always-picks', root);
  $('#bs-always', root).classList.toggle('hidden', !trusted.length);
  const trustedOn = new Set(trusted.map((j) => j.id));
  if (trusted.length) foldPicker(alwaysBox, trusted.map((j) => ({ id: j.id, label: j.name, desc: jobLine(j) })), trustedOn, () => {}, {
    action: { label: 'Revoke', run: async (id) => {
      try { await api(`/bots/${b.id}/jobs/${id}`, { method: 'PUT', body: { alwaysApprove: false } }); } catch (e) { toast(e.message, true); return false; }
      toast('Revoked: its next change waits for your OK');
      if (!trustedOn.size || (trustedOn.size === 1 && trustedOn.has(id))) $('#bs-always', root).classList.add('hidden');
      refresh();
      return true;
    } },
  });

  drawBotSettingsLive(b);

  const dup = $('#duplicate-bot', root);
  if (dup) dup.onclick = () => openDuplicate(b);

  $('#delete-bot', root).onclick = async () => {
    // Its screen on the account's computer ends and its browser's logins go; the computer, which the other bots use,
    // stays, and so does its folder there (#109).
    const hasComputer = b.computer === 'linux';
    const ownOnly = ownSkills.filter((k) => !k.usedBy.some((x) => x !== b.id)).length;
    const gone = [
      hasComputer ? "its screen and its browser's logins on the account's computer" : '',
      'its memory',
      ownOnly ? `the ${ownOnly === 1 ? 'skill' : `${ownOnly} skills`} it wrote` : '',
    ].filter(Boolean);
    const kept = hasComputer ? ` Its folder /workspace/${b.id} on the account's computer is kept, and so is the computer, which the other bots use.` : '';
    const warning = `Delete ${b.name}?\n\nThis also erases ${gone.length > 1 ? `${gone.slice(0, -1).join(', ')} and ${gone[gone.length - 1]}` : gone[0]}. This can't be undone.\n\nIts run history is kept.${kept}`;
    if (!confirm(warning)) return;
    let r;
    try { r = await api(`/bots/${b.id}`, { method: 'DELETE' }); } catch (err) { return toast(err.message, true); }
    // `computer` is about its old computer of its own from before the account's computer (#104), if it still had one.
    toast(r.computer === 'erased' ? 'Bot and its old computer deleted' : r.computer === 'failed' ? "Bot deleted, but its old computer couldn't be erased (is Docker running?)" : 'Bot deleted', r.computer === 'failed');
    delete root.dataset.bot;
    leaveBot();
    await refresh();
  };
}

// "Duplicate" (#227): the server's list of what the copy gets, a name to change, then the copy, whose chat opens.
async function openDuplicate(b) {
  let plan;
  try { plan = await api(`/bots/${b.id}/duplicate`); } catch (e) { return toast(e.message, true); }
  const m = openModal(`
    <div class="modal-head"><h2>Duplicate ${esc(b.name)}?</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <label class="field">Name<input id="dup-name" maxlength="60" value="${esc(plan.name)}"></label>
      <p style="margin:12px 0 4px">The copy gets:</p>
      <ul style="margin:0;padding-left:20px">${plan.copies.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <p class="hint" style="margin:12px 0 0">Not copied: ${esc(plan.notCopied)}.</p>
      ${plan.vaultLocked ? '<p class="hint" style="margin:8px 0 0">Bitwarden is locked: unlock it first, so the copy can use the same Vault entries.</p>' : ''}
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-dismiss>Cancel</button>
      <button type="button" class="btn primary" id="dup-go" ${plan.vaultLocked ? 'disabled' : ''}>Duplicate</button>
    </div>`);
  $('#dup-go', m).onclick = async () => {
    $('#dup-go', m).disabled = true;
    let made;
    try { made = await api(`/bots/${b.id}/duplicate`, { method: 'POST', body: { name: $('#dup-name', m).value } }); } catch (e) { $('#dup-go', m).disabled = false; return toast(e.message, true); }
    m.close();
    toast(`${made.name} made`);
    await refresh();
    setView('bot', made.id);
  };
}

// The bits of the settings page that follow the bot while it's open: its jobs.
function drawBotSettingsLive(bot) {
  const root = $('#view-botsettings');
  const jobs = bot.jobs || [];
  const waiting = jobs.filter(jobWaits).length;
  const jl = $('#bs-jobs', root);
  if (jl) jl.textContent = !jobs.length ? 'None. Ask it, or the Chief, e.g. "check the news every morning at 8".'
    : waiting ? `${waiting} waiting for your OK`
      : `${jobs.length} job${jobs.length === 1 ? '' : 's'}${bot.nextRunAt ? ` · next ${shortTime(bot.nextRunAt)}` : ''}`;
}

// ---------- a bot's scheduled jobs (their own page; each change saves by itself) ----------

function renderBotJobs(force = false) {
  const root = $('#view-botjobs');
  const bot = state.bots.find((b) => b.id === state.botId);
  if (!bot) { if (state.bots.length) leaveBot(); return; }
  if (!force && root.dataset.bot === bot.id) {
    // Don't wipe what's being typed: an open panel takes only what the server now says of each job, its pill and its line.
    for (const card of $$('.job-card', root)) { const j = (bot.jobs || []).find((x) => x.id === card.dataset.job); if (j) drawJobLine(card, j); }
    return;
  }
  root.dataset.bot = bot.id;
  const jobs = bot.jobs || [];
  root.innerHTML = `
    <div class="section-head"><div><h1>Scheduled jobs</h1><p>${botLabel(bot)} runs these on its own. Changes save by themselves. Easiest: ask it or the Chief, e.g. "check the news every morning at 8".</p></div></div>
    <div class="job-list" id="job-list">${jobs.map((j) => jobCardHTML(j)).join('') || `<div class="card empty" style="padding:28px 20px" id="jobs-empty">No jobs yet.</div>`}</div>
    <div style="margin-top:12px"><button type="button" class="btn" id="job-add">＋ Add job</button></div>`;
  $$('.job-card', root).forEach((card) => wireJobCard(card, bot));
  $('#job-add', root).onclick = async () => {
    let job;
    try { job = await api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: '', kind: 'ai', cron: '0 9 * * *', prompt: '' } }); } catch (e) { return toast(e.message, true); }
    $('#jobs-empty', root)?.remove();
    const list = $('#job-list', root);
    list.insertAdjacentHTML('beforeend', jobCardHTML(job, true));
    wireJobCard(list.lastElementChild, bot);
    const name = list.lastElementChild.querySelector('[name=jobName]');
    name.focus();
    name.select();
    refresh();
  };
}
