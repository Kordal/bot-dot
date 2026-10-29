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
      <div class="modal-head"><h2>${tr('Let {name} do everything without checks?', { name: esc(name) })}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body"><p style="margin:0">${tr('It will run any command and change any file without asking you. You can change this back here at any time.')}</p></div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>${tr('Cancel')}</button>
        <button type="button" class="btn primary" id="allow-everything">${tr('Allow everything')}</button>
      </div>`);
    let yes = false;
    $('#allow-everything', m).onclick = () => { yes = true; m.close(); };
    m.addEventListener('close', () => resolve(yes), { once: true });
  });
}

// A bot's computer moves between this machine and boat.dev (#556): its files copied along, or not. true, false, or
// null for neither (the switch is taken back).
const COMPUTER_PLACE = {
  linux: [tr('Copy its files to this machine?'), tr("Copy the bots' files to this machine?")],
  boat: [tr('Copy its files to the External Virtual PC?'), tr("Copy the bots' files to the External Virtual PC?")],
};
// all: the bots' files, for the account's switch (settings.js); else one bot's.
function askMoveFiles(to, all = false) {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="modal-head"><h2>${COMPUTER_PLACE[to][all ? 1 : 0]}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-foot">
        <button type="button" class="btn" id="move-empty">${tr('Start empty')}</button>
        <button type="button" class="btn primary" id="move-copy">${tr('Copy files')}</button>
      </div>`);
    let answer = null;
    $('#move-empty', m).onclick = () => { answer = false; m.close(); };
    $('#move-copy', m).onclick = () => { answer = true; m.close(); };
    m.addEventListener('close', () => resolve(answer), { once: true });
  });
}
const isComputerMove = (from, to) => from !== to && !!COMPUTER_PLACE[from] && !!COMPUTER_PLACE[to];
// Its copy's line under Computer: how far it is, or why it failed, with Try again.
function computerMoveLine(b) {
  const mv = b.computerMove;
  if (!mv) return '';
  if (mv.state === 'copying') return mv.total ? tr('Copying files · {pct}%', { pct: Math.floor((mv.done / mv.total) * 100) }) : tr('Copying files…');
  return `<span class="danger-text">${tr('Files not copied: {why}', { why: esc(mv.error || tr('it failed')) })}</span> <button type="button" class="link-btn" data-bs-move-retry>${tr('Try again')}</button>`;
}

function openRunDialog(botId) {
  const bot = botId && state.bots.find((b) => b.id === botId);
  const m = openModal(`
    <form method="dialog" id="run-form">
      <div class="modal-head"><h2>${bot ? tr('Run {name}', { name: botLabel(bot) }) : tr('Run a bot')}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        ${bot ? '' : `<label class="field">${tr('Bot')}<select name="bot">${state.bots.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}: ${esc(b.description.slice(0, 60))}</option>`).join('')}</select></label>`}
        <label class="field">${tr('Task')} <span class="hint">${tr('Edit it for this run only. {{date}} gets filled in.')}</span>
          <textarea name="prompt" rows="6"></textarea></label>
        <div class="faint" id="run-mode-info" style="font-size:12px"></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>${tr('Cancel')}</button><button class="btn primary" type="submit">▶ ${tr('Start run')}</button></div>
    </form>`);
  const form = $('#run-form', m);
  const sync = () => {
    const b = bot || state.bots.find((x) => x.id === form.bot.value);
    form.prompt.value = b.prompt;
    $('#run-mode-info', m).textContent = tr('Permission mode: {mode} ({info}) · Tools: {tools}', { mode: b.permissionMode, info: MODE_INFO[b.permissionMode] || '', tools: b.allowedTools.join(', ') || tr('default') });
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
      toast(tr('{name} started', { name: b.name }));
      await refresh();
      setView('bot', id);
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- a bot's settings (its own page; every change saves by itself) ----------

// What a bot may do, as plain switches. Each adds or removes Claude Code tools; the exact list is under Advanced.
const PERMS = [
  { key: 'files', label: tr('Can change files'), hint: tr('create and edit files in its folder'), tools: ['Edit', 'Write'] },
  { key: 'web', label: tr('Can browse the web'), hint: tr('search, and read web pages'), tools: ['WebSearch', 'WebFetch'] },
  { key: 'bash', label: tr('Can run commands'), hint: tr('any shell command in its folder'), tools: ['Bash'] },
  { key: 'helpers', label: tr('Can use helpers'), hint: tr('start helpers that work in parallel within one run'), tools: ['Agent', 'Task'] },
];

// A bot's Shared rooms row (#316, ADR 060): on a botdot with `room-settings` that sends the bot's `rooms`, while the
// front door has shared rooms on (rooms.js). Who may mention it: only its owner, or anyone in the room.
const ROOM_WHO = [['owner', tr('Only you')], ['anyone', tr('Anyone in the room')]];
const showsRoomSettings = (b) => state.features.includes('room-settings') && !!b.rooms && typeof b.rooms === 'object' && typeof rooms !== 'undefined' && rooms.on;

// The page's form, in the shape the API takes. sel: the picked skills, apps and teammates.
function readBotForm(form, sel) {
  return {
    name: form.name.value,
    color: form.color.value,
    description: form.description.value,
    group: form.group.value.trim(),
    prompt: form.prompt.value,
    systemPrompt: form.systemPrompt.value,
    computer: form.computer.type === 'select-one' ? form.computer.value : form.computer.checked ? 'linux' : 'none', // one choice once boat.dev is set up (#541)
    skills: [...sel.skills],
    disabledSkills: readDisabledSkills(form),
    connectors: [...sel.connectors],
    mayMessageAll: sel.others.every((id) => sel.mayMessage.has(id)),
    mayMessage: [...sel.mayMessage],
    othersMayAsk: form.othersMayAsk.checked,
    ...(form.allowRooms ? { rooms: { allowRooms: form.allowRooms.checked, whoMayMention: form.roomsWho.value } } : {}),
    ...(hotkeyChanged(form) ? { hotkey: Number(form.hotkey.value) } : {}),
    allowedTools: form.tools.value.split('\n').map((s) => s.trim()).filter(Boolean),
    permissionMode: form.permissionMode.value,
    ...readLlmFields(form, 'bot'),
  };
}

// The key was chosen on this page (#366): only then is it sent, so a page drawn earlier never takes back a digit the
// Chief has given another bot since.
const hotkeyChanged = (form) => !!form.hotkey && [...form.hotkey.options].find((o) => o.defaultSelected)?.value !== form.hotkey.value;

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
  const bot = (id) => (isChief({ id }) ? tr('the Chief') : botById(id)?.name || tr('a deleted bot'));
  const from = k.source === 'github' ? tr('Installed by you from {source}', { source: k.sourceUrl || 'GitHub' }) : k.createdBy?.startsWith('bot:') ? tr('Written by {name}', { name: bot(k.createdBy.slice(4)) }) : k.createdBy === 'chief' ? tr('Written by the Chief') : tr('Written by you');
  const lines = [
    from,
    k.fileCount > 1 ? (k.scripts?.length ? trn(k.fileCount, '{n} file, with scripts it can run ({scripts})', '{n} files, with scripts it can run ({scripts})', { scripts: `${k.scripts.slice(0, 3).join(', ')}${k.scripts.length > 3 ? ', …' : ''}` }) : trn(k.fileCount, '{n} file', '{n} files')) : '',
    k.allowedTools?.length ? tr('Tools it uses: {tools}', { tools: k.allowedTools.join(', ') }) : '',
    k.usedBy?.length ? tr('Used by {names}', { names: k.usedBy.map(bot).join(', ') }) : tr('No bot uses it yet'),
  ].filter(Boolean);
  return `${lines.map(esc).join('<br>')}${k.instructions ? `<span class="pick-instructions">${esc(k.instructions.slice(0, 600))}${k.instructions.length > 600 ? '…' : ''}</span>` : ''}`;
}

// What you said to always approve for a bot, in its settings: the jobs, whose later changes need no OK, and the
// actions in connected apps, with any details (`alwaysAllowed`, #474). Revoke one and it asks again.
function drawAlwaysApproved(b, root) {
  const trusted = [
    ...(b.jobs || []).filter((j) => j.alwaysApprove).map((j) => ({ id: `job ${j.id}`, label: j.name, desc: jobLine(j) })),
    ...(b.alwaysAllowed || []).map((g) => ({ id: `app ${g.action}`, label: g.label })),
  ];
  $('#bs-always', root).classList.toggle('hidden', !trusted.length);
  const trustedOn = new Set(trusted.map((x) => x.id));
  if (trusted.length) foldPicker($('#always-picks', root), trusted, trustedOn, () => {}, {
    action: { label: tr('Revoke'), run: async (id) => {
      const [kind, what] = [id.slice(0, id.indexOf(' ')), id.slice(id.indexOf(' ') + 1)];
      try {
        if (kind === 'job') await api(`/bots/${b.id}/jobs/${what}`, { method: 'PUT', body: { alwaysApprove: false } });
        else await api(`/bots/${b.id}/connector-actions`, { method: 'DELETE', body: { action: what } });
      } catch (e) { toast(e.message, true); return false; }
      toast(kind === 'job' ? tr('Revoked: its next change waits for your OK') : tr('Revoked: it asks you again'));
      if (trustedOn.size <= 1) $('#bs-always', root).classList.add('hidden');
      refresh();
      return true;
    } },
  });
}

function foldPicker(box, items, selected, onChange, { none = tr('None'), empty = tr('Nothing to choose yet.'), action = null, sum = null } = {}) {
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
    box.innerHTML = `<div class="bs-sum">${esc(summary())}</div>${open ? `<div class="pick-list">${items.length ? items.map((x, i) => head(x, i) + (action
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
  box.classList.add('bs-picks'); // its summary right of the label, its list under the row (style.css)
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.onclick = (e) => { if (!e.target.closest('.pick-list')) toggle(); };
  row.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); toggle(); } };
  draw();
}

// Its own key on the keypad (#366): a digit that opens its chat in a wide window, wherever it stands. A digit another
// bot holds says whose it is, and choosing it moves it here.
function hotkeyRow(b) {
  const holder = (d) => state.bots.find((x) => x.id !== b.id && x.hotkey === d);
  const option = (d) => `<option value="${d}" ${(b.hotkey || 0) === d ? 'selected' : ''}>${d}${holder(d) ? ` (${tr('now {name}', { name: esc(holder(d).name) })})` : ''}</option>`;
  return `<label class="bs-row"${tipAttrs(tr('Its digit on the keypad in a wide window, wherever it stands. Without one it gets a free digit by its place.'))}><b>${tr('Key')}</b>
          <select name="hotkey" aria-label="${esc(tr('Key on the keypad'))}"><option value="0" ${b.hotkey ? '' : 'selected'}>${tr('By its place')}</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(option).join('')}</select>${CHEV}
        </label>`;
}
function renderBotSettings(force = false) {
  const root = $('#view-botsettings');
  const bot = state.bots.find((b) => b.id === state.botId);
  if (!bot) { if (state.bots.length) leaveBot(); return; }
  // Opened from a skill's chip, or its address: the Skills open on that skill (openSkill below).
  const focus = state.openSkill?.bot === bot.id ? state.openSkill : null;
  if (focus) { delete state.openSkill; force = true; }
  if (!force && root.dataset.bot === bot.id) { drawBotSettingsLive(bot); return; } // don't wipe what's being typed
  root.dataset.bot = bot.id;
  const b = bot;
  const docker = state.status?.docker?.ok;
  // A bot's computer: its screen on the account's computer, or a machine of its own on boat.dev once the admin set
  // a key there (ADR 088).
  const hasComputer = b.computer === 'linux' || b.computer === 'boat';
  // Where it is, this machine or the External Virtual PC, is the account's choice in Settings (#579): here only whether.
  const accountComputer = state.features.includes('account-computer');
  const boatChoice = !accountComputer && state.features.includes('boat-computer') && (state.status?.boat || b.computer === 'boat');
  const mayHave = docker || hasComputer || (accountComputer && !!state.status?.boat);
  const knownTools = new Set(PERMS.flatMap((p) => p.tools));
  const has = (p) => p.tools.every((t) => b.allowedTools.includes(t));
  // Its head (figure, name, what it does), colour, category chips (no label: the chips say it, #728) and main
  // assignment, then its rows in groups, each group one raised surface.
  root.innerHTML = `
    <form id="bot-form" class="bot-settings" autocomplete="off">
      <div class="set-head">
        <span id="bs-figure"></span>
        <div class="set-name">
          <input type="text" name="name" value="${esc(b.name)}" required maxlength="60" aria-label="${esc(tr('Name'))}">
          <input type="text" name="description" value="${esc(b.description)}" placeholder="${esc(tr('What it does'))}" aria-label="${esc(tr('What it does'))}"${tipAttrs(tr('One line, shown in the list'))}>
        </div>
      </div>
      <div class="swatches" role="radiogroup" aria-label="${esc(tr('Colour'))}">${BOT_COLORS.map(([c, n]) => `<label class="swatch" title="${n}"><input type="radio" name="color" value="${c}" ${b.color === c ? 'checked' : ''} aria-label="${n}"><i style="--c:${c}"></i></label>`).join('')}</div>
      <div class="group-picker" id="group-picker" role="group" aria-label="${esc(tr('Category'))}"></div>
      <input type="hidden" name="group" value="${esc(b.group || '')}">
      <label class="field">${tr('Main assignment')}
        <textarea name="prompt" rows="4" required${tipAttrs(tr('What it does when a job runs it, and its guide for your messages'))}>${esc(b.prompt)}</textarea></label>
      <div id="bs-undo"></div>

      <div class="set-list">
        <label class="bs-row" title="${esc(tr('Pinned below the Chief'))}"><b>${tr('Pinned')}</b>
          <span class="switch"><input type="checkbox" id="bs-pinned" ${b.pinned > 0 ? 'checked' : ''} aria-label="${esc(tr('Pinned below the Chief'))}"><span></span></span></label>
        ${state.features.includes('bot-hotkeys') ? hotkeyRow(b) : ''}
        <details class="bs-row bs-more" id="bs-model">
          <summary><b>${tr('Model')}</b><span class="bs-val" data-llm-val>${esc(llmValue(b.model, b.effort))}</span>${CHEV}</summary>
          <div class="bs-body">${llmFieldsHTML('bot', { model: b.model, effort: b.effort }, tr('Default ({model})', { model: llmSummary(state.settings?.defaultModel, state.settings?.defaultEffort) }))}</div>
        </details>
      </div>

      <div class="set-list">
        <div class="bs-row" id="bs-skills">
          <div class="grow"><b>${tr('Skills')}</b>${b.useSkills === false ? `<span class="bs-val">${tr('Off')} <button type="button" class="link-btn" data-skills-on>${tr('Turn on')}</button></span>` : `<div id="skill-picks"><span class="faint">${tr('Loading…')}</span></div>`}</div>
          ${b.useSkills === false ? '' : CHEV}
        </div>
        <div class="bs-row hidden" id="bs-apps">
          <div class="grow"><b>${tr('Apps')}</b><div id="app-picks"></div></div>${CHEV}
        </div>
        <button type="button" class="bs-row bs-link" data-bs-jobs><b>${tr('Jobs')}</b><span class="bs-val" id="bs-jobs"></span>${CHEV}</button>
        ${state.features.includes('bot-files') ? `<button type="button" class="bs-row bs-link" id="bs-files" data-bs-files><b>${tr('Files')}</b>${CHEV}</button>` : ''}
        ${state.features.includes('pages') ? `<details class="bs-row bs-more" id="bs-pages">
          <summary${tipAttrs(tr('Reports, memos and overviews it made for you. Open one to keep it up to date.'))}><b>${tr('Pages')}</b><span class="bs-val" id="bs-pages-val"></span>${CHEV}</summary>
          <div class="bs-body pg-list" id="page-list"><span class="faint">${tr('Loading…')}</span></div>
        </details>` : ''}
        ${boatChoice ? `<label class="bs-row"><b>${tr('Computer')}</b>
          <select name="computer" aria-label="${esc(tr('Computer'))}"><option value="none">${tr('None')}</option><option value="linux" ${b.computer === 'linux' ? 'selected' : ''} ${docker || b.computer === 'linux' ? '' : 'disabled'}>${tr('This machine')}</option><option value="boat" ${b.computer === 'boat' ? 'selected' : ''}>${tr('External Virtual PC')}</option></select>${CHEV}
        </label>` : `<label class="bs-row ${mayHave ? '' : 'hidden'}"${accountComputer ? '' : tipAttrs(tr("Its own screen and browser on the account's computer, with sudo there, like every bot that uses it."))}><b>${tr('Uses the computer')}</b>
          <span class="switch"><input type="checkbox" name="computer" ${hasComputer ? 'checked' : ''} ${mayHave ? '' : 'disabled'} aria-label="${esc(tr('Uses the computer'))}"><span></span></span></label>`}
        <div class="bs-row bs-note" id="bs-move">${computerMoveLine(b)}</div>
        ${hasComputer ? `<button type="button" class="bs-row bs-link" data-bs-screen><b>${tr('Its screen')}</b>${CHEV}</button>` : ''}
      </div>

      <div class="set-list ${state.bots.length > 1 || showsRoomSettings(b) ? '' : 'hidden'}">
        <div class="bs-row ${state.bots.length > 1 ? '' : 'hidden'}">
          <div class="grow"><b>${tr('May message')}</b><div id="bot-picks"></div></div>${CHEV}
        </div>
        <label class="bs-row ${state.bots.length > 1 ? '' : 'hidden'}"${tipAttrs(tr("Off keeps it to you: other bots don't see it among their teammates and can't message it."))}><b>${tr('Other bots may ask it')}</b>
          <span class="switch"><input type="checkbox" name="othersMayAsk" ${b.othersMayAsk !== false ? 'checked' : ''} aria-label="${esc(tr('Other bots may ask it'))}"><span></span></span></label>
        ${showsRoomSettings(b) ? `<label class="bs-row" id="bs-rooms"${tipAttrs(tr('It may join rooms with other accounts on this machine. There it only talks: no tools, no notes, nothing of yours.'))}><b>${tr('Shared rooms')}</b>
          <span class="switch"><input type="checkbox" name="allowRooms" ${b.rooms.allowRooms ? 'checked' : ''} aria-label="${esc(tr('Shared rooms'))}"><span></span></span></label>
        <label class="bs-row bs-rooms-who ${b.rooms.allowRooms ? '' : 'hidden'}"><b>${tr('Who may mention it')}</b>
          <select name="roomsWho" aria-label="${esc(tr('Who may mention it'))}">${ROOM_WHO.map(([v, label]) => `<option value="${v}" ${b.rooms.whoMayMention === v ? 'selected' : ''}>${label}</option>`).join('')}</select>${CHEV}</label>` : ''}
      </div>

      <div class="set-list">
        <div class="bs-row" id="bs-always">
          <div class="grow"><b>${tr('Always approved')}</b><div id="always-picks"></div></div>${CHEV}
        </div>
        <div class="bs-row" id="bs-overrides"${tipAttrs(tr('It may do these though its rules say no. Revoke one and it asks you again.'))}>
          <div class="grow"><b>${tr('Rules you lifted')}</b><div id="override-picks"></div></div>${CHEV}
        </div>
        <details class="bs-row bs-more" id="bs-advanced">
          <summary><b>${tr('What it may do')}</b>${CHEV}</summary>
          <div class="bs-body">
            ${PERMS.map((p) => `<label class="toggle"${tipAttrs(p.hint)}><input type="checkbox" data-perm="${p.key}" ${has(p) ? 'checked' : ''}> ${p.label}</label>`).join('')}
            <details class="bs-exact" ${b.allowedTools.some((t) => !knownTools.has(t) && !['Read', 'Grep', 'Glob'].includes(t)) || !['dontAsk', 'acceptEdits'].includes(b.permissionMode) ? 'open' : ''}>
              <summary class="faint">${tr('Exact tools and permission mode')}</summary>
              <label class="field">${tr('Allowed tools')}
                <textarea class="mono" name="tools" rows="4" placeholder="${esc(tr('One per line, e.g. Bash(pytest:*) or mcp__github'))}">${esc(b.allowedTools.join('\n'))}</textarea></label>
              <label class="field">${tr('Permission mode')}<select name="permissionMode">${Object.entries(MODE_INFO).map(([k, v]) => `<option value="${k}" ${k === b.permissionMode ? 'selected' : ''}>${k}: ${v}</option>`).join('')}</select></label>
            </details>
          </div>
        </details>
        <details class="bs-row bs-more" id="bs-rules">
          <summary${tipAttrs(tr("Its personality and rules, added to Claude Code's system prompt."))}><b>${tr('Rules')}</b><span class="bs-val">${esc(b.systemPrompt.split('\n')[0])}</span>${CHEV}</summary>
          <div class="bs-body"><textarea name="systemPrompt" rows="3" aria-label="${esc(tr('Personality and rules'))}">${esc(b.systemPrompt)}</textarea></div>
        </details>
      </div>

      <div class="set-list">
        ${state.features.includes('duplicate-bot') ? `<button type="button" class="bs-row bs-link" id="duplicate-bot"><b>${tr('Duplicate')}</b>${CHEV}</button>` : ''}
        <button type="button" class="bs-row bs-link bs-danger" id="delete-bot" aria-label="${esc(tr('Delete {name}', { name: b.name }))}"><b>${tr('Delete bot')}</b></button>
      </div>
    </form>`;

  const form = $('#bot-form', root);
  form.dataset.disabled = JSON.stringify(b.disabledSkills || []);
  const others = state.bots.filter((x) => x.id !== b.id).map((x) => x.id);
  const sel = { skills: new Set(b.skills || []), connectors: new Set(b.connectors || []), mayMessage: new Set(b.mayMessageAll ? others : b.mayMessage || []), others };
  let saved = readBotForm(form, sel);
  let chain = Promise.resolve();
  let timer = null;
  let moveFiles = false; // the owner's "Copy files" for the computer's next save (#556)
  // Send only what changed since the last save, one save at a time.
  const save = () => {
    clearTimeout(timer);
    chain = chain.then(async () => {
      const now = readBotForm(form, sel);
      const changes = Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved[k])));
      if (!Object.keys(changes).length) return;
      const copy = 'computer' in changes && moveFiles; // its files go along (#556)
      moveFiles = false;
      try {
        const updated = await api(`/bots/${b.id}`, { method: 'PUT', body: { ...changes, ...(copy ? { moveFiles: true } : {}) } });
        saved = { ...saved, ...changes };
        const i = state.bots.findIndex((x) => x.id === b.id);
        if (i >= 0) state.bots[i] = { ...state.bots[i], ...updated };
        flashSaved(root);
        $('[data-llm-val]', root).textContent = llmValue(saved.model, saved.effort);
        renderContacts();
        drawPanelHead(); // its name is the back button's
        if (state.view === 'bot' && state.botId === b.id) renderBotChat(); // and the chat's, beside the panel
      } catch (e) { toast(e.message, true); }
    });
  };
  const saveSoon = () => { clearTimeout(timer); timer = setTimeout(save, 300); };
  form.addEventListener('change', (e) => { if (!e.target.matches('[data-perm]')) saveSoon(); });
  if (form.allowRooms) form.allowRooms.addEventListener('change', () => $('.bs-rooms-who', root).classList.toggle('hidden', !form.allowRooms.checked));
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
  // A switch between this machine and boat.dev asks first whether its files go along (#556). Until the answer the
  // select is back at the saved computer, so no other field's save carries the new one; ✕ leaves it there.
  if (form.computer.type === 'select-one') form.computer.addEventListener('change', async (e) => {
    const select = e.target;
    const to = select.value;
    if (!isComputerMove(saved.computer, to)) return;
    e.stopPropagation();
    select.value = saved.computer;
    const copy = await askMoveFiles(to);
    if (copy === null) return;
    select.value = to;
    moveFiles = copy;
    saveSoon();
  });
  wireMoveRetry(root, b.id);

  $('[data-bs-jobs]', root).onclick = () => setView('botjobs', b.id);
  const scr = $('[data-bs-screen]', root);
  if (scr) scr.onclick = () => openScreen(b.id);
  groupPicker($('#group-picker', root), form.group, saveSoon);
  // Saved on its own (not with the form), so a stale form never moves it.
  $('#bs-pinned', root).onchange = async (e) => {
    await pinBot(state.bots.find((x) => x.id === b.id) || b, e.target.checked ? state.bots.filter((x) => x.pinned > 0 && x.id !== b.id).length + 1 : 0);
    flashSaved(root);
  };
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
    // In each group the ones it has come first (as saved, so rows don't jump while you tick them).
    const has = new Set(b.skills || []);
    const first = (list, active) => [...list.filter(active), ...list.filter((k) => !active(k))];
    const items = [
      ...first(library, (k) => has.has(k.name)).map((k) => ({ id: `lib:${k.name}`, label: k.name, desc: k.description, group: tr('Your skills'), more: skillMoreHTML(k) })),
      ...['from your Claude account', 'built into Claude Code'].flatMap((from) => first(sys.filter((k) => k.from === from), (k) => !off.has(k.name))).map((k) => ({
        id: `sys:${k.name}`, label: k.name, desc: k.description,
        group: k.from === 'built into Claude Code' ? tr('Built into Claude Code') : tr('From your Claude account'),
        more: esc(k.from === 'built into Claude Code' ? tr('Comes with Claude Code. Every bot has it unless you switch it off here.') : tr('Installed in your Claude account. Every bot has it unless you switch it off here.')),
      })),
    ];
    const on = new Set([...[...sel.skills].map((n) => `lib:${n}`), ...sys.filter((k) => !off.has(k.name)).map((k) => `sys:${k.name}`)]);
    form._sysOff = sys.filter((k) => off.has(k.name)).map((k) => k.name);
    const sum = () => {
      const lib = library.filter((k) => on.has(`lib:${k.name}`)).map((k) => k.name);
      const count = (from) => sys.filter((k) => k.from === from && on.has(`sys:${k.name}`)).length;
      const acc = count('from your Claude account'), built = count('built into Claude Code');
      return [...lib, acc ? tr('{n} from your Claude account', { n: acc }) : '', built ? tr('{n} built into Claude Code', { n: built }) : ''].filter(Boolean).join(', ');
    };
    foldPicker(box, items, on, () => {
      sel.skills.clear();
      library.forEach((k) => on.has(`lib:${k.name}`) && sel.skills.add(k.name));
      form._sysOff = sys.filter((k) => !on.has(`sys:${k.name}`)).map((k) => k.name);
      saveSoon();
    }, { empty: tr('No skills yet. Ask the Chief to write one.'), sum });
    if (focus) openSkill(root, focus.name);
  }).catch(() => { const box = $('#skill-picks', root); if (box) box.innerHTML = `<span class="faint">${tr("Couldn't load skills.")}</span>`; });
  if (focus) { $('#bs-skills', root).classList.add('open'); if (b.useSkills === false) openSkill(root, ''); }
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
    { none: tr('Nobody'), sum: () => (others.length > 1 && others.every((id) => sel.mayMessage.has(id)) ? tr('Everyone') : [...sel.mayMessage].map((id) => botById(id)?.name || id).join(', ')) });
  drawAlwaysApproved(b, root);

  drawBotSettingsLive(b); // and the rules you lifted

  // Its files: the Files view (#603, files.js), over the whole page.
  const files = $('[data-bs-files]', root);
  if (files) files.onclick = () => Files.open(b);
  if ($('#page-list', root) && typeof Pages !== 'undefined') Pages.drawList(b, $('#page-list', root), $('#bs-pages-val', root)); // public/pages.js (#346)

  const dup = $('#duplicate-bot', root);
  if (dup) dup.onclick = () => openDuplicate(b);
  drawUndo(root, b);

  $('#delete-bot', root).onclick = async () => {
    // Its screen on the account's computer ends and its browser's logins go; the computer, which the other bots use,
    // stays, and so does its folder there (#109).
    const hasComputer = b.computer === 'linux';
    const ownOnly = ownSkills.filter((k) => !k.usedBy.some((x) => x !== b.id)).length;
    const gone = [
      hasComputer ? tr("its screen and its browser's logins on the account's computer") : '',
      tr('its memory'),
      ownOnly ? trn(ownOnly, 'the skill it wrote', 'the {n} skills it wrote') : '',
    ].filter(Boolean);
    const kept = hasComputer ? ` ${tr("Its folder {folder} on the account's computer is kept, and so is the computer, which the other bots use.", { folder: `/workspace/${b.id}` })}` : '';
    const what = gone.length > 1 ? tr('{list} and {last}', { list: gone.slice(0, -1).join(', '), last: gone[gone.length - 1] }) : gone[0];
    const warning = `${tr("Delete {name}?\n\nThis also erases {what}. This can't be undone.\n\nIts run history is kept.", { name: b.name, what })}${kept}`;
    if (!confirm(warning)) return;
    let r;
    try { r = await api(`/bots/${b.id}`, { method: 'DELETE' }); } catch (err) { return toast(err.message, true); }
    // `computer` is about its old computer of its own from before the account's computer (#104), if it still had one.
    toast(r.computer === 'erased' ? tr('Bot and its old computer deleted') : r.computer === 'failed' ? tr("Bot deleted, but its old computer couldn't be erased (is Docker running?)") : tr('Bot deleted'), r.computer === 'failed');
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
    <div class="modal-head"><h2>${esc(tr('Duplicate {name}?', { name: b.name }))}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <label class="field">${tr('Name')}<input id="dup-name" maxlength="60" value="${esc(plan.name)}"></label>
      <p style="margin:12px 0 4px">${tr('The copy gets:')}</p>
      <ul style="margin:0;padding-left:20px">${plan.copies.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <p class="hint" style="margin:12px 0 0">${esc(tr('Not copied: {what}.', { what: plan.notCopied }))}</p>
      ${plan.vaultLocked ? `<p class="hint" style="margin:8px 0 0">${tr('Bitwarden is locked: unlock it first, so the copy can use the same Vault entries.')}</p>` : ''}
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-dismiss>${tr('Cancel')}</button>
      <button type="button" class="btn primary" id="dup-go" ${plan.vaultLocked ? 'disabled' : ''}>${tr('Duplicate')}</button>
    </div>`);
  // The dialog goes away at once and the copy is made with the corner pill (#478); refused (a name in use, say), it
  // comes back as it was. The copy's chat opens when the owner is still where they asked for it.
  $('#dup-go', m).onclick = async () => {
    const name = $('#dup-name', m).value;
    const from = [state.view, state.botId].join('/');
    let made;
    if (!(await setAside(m, tr('Duplicating {name}…', { name: b.name }), async () => { made = await api(`/bots/${b.id}/duplicate`, { method: 'POST', body: { name } }); }, { ok: () => tr('{name} made', { name: made.name }) }))) return;
    await refresh();
    if ([state.view, state.botId].join('/') === from && !$('#modal').open) setView('bot', made.id);
  };
}

// The bits of the settings page that follow the bot while it's open: its jobs.
// The rules you lifted for it with "Allow always for this bot" (#253). Revoke takes one back at once. Drawn again
// only when the list changed, e.g. after a yes on a card while the settings are open.
function drawOverrides(root, b) {
  const lifted = b.overrides || [];
  const ids = lifted.map((o) => o.id).join(' ');
  const row = $('#bs-overrides', root);
  if (!row || row.dataset.ids === ids) return;
  row.dataset.ids = ids;
  row.classList.toggle('hidden', !lifted.length);
  const liftedOn = new Set(lifted.map((o) => o.id));
  if (lifted.length) foldPicker($('#override-picks', root), lifted.map((o) => ({ id: o.id, label: o.action, desc: tr('Its rule: {rule}', { rule: o.rule }) })), liftedOn, () => {}, {
    action: { label: tr('Revoke'), run: async (id) => {
      try { await api(`/bots/${b.id}/overrides/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { toast(e.message, true); return false; }
      toast(tr('Revoked: it asks you again'));
      if (liftedOn.size <= 1) row.classList.add('hidden');
      refresh();
      return true;
    } },
  });
}

// "Try again" on a copy of its files that failed (#556).
function wireMoveRetry(root, botId) {
  const retry = $('[data-bs-move-retry]', root);
  if (retry) retry.onclick = async () => {
    retry.disabled = true;
    try { await api(`/bots/${botId}/computer/move`, { method: 'POST' }); } catch (e) { retry.disabled = false; toast(e.message, true); }
  };
}
// Undo of the change a card made to its main assignment or rules, while nothing changed them since (`undo`, #596).
function drawUndo(root, bot) {
  const box = $('#bs-undo', root);
  if (!box) return;
  box.innerHTML = bot.undo ? `<button type="button" class="link-btn" data-bs-undo>${tr('Undo last change')}</button>` : '';
  const btn = $('[data-bs-undo]', box);
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    try { await api(`/bots/${bot.id}/learning/undo`, { method: 'POST', body: { changeId: bot.undo } }); await refresh(); renderBotSettings(true); } catch (e) { btn.disabled = false; toast(e.message, true); }
  };
}

// The Skills of a bot's settings, open, on the skill called name: its row open and in view. A skill it no longer
// has, or none, leaves the Skills in view.
function openSkill(root, name) {
  const row = $('#bs-skills', root);
  const pick = name && $$('#skill-picks .skill-pick', root).find((el) => ['lib:', 'sys:'].some((k) => $('input', el)?.value === k + name));
  if (pick?.classList.contains('has-more')) pick.classList.add('open');
  requestAnimationFrame(() => (pick || row)?.scrollIntoView({ block: pick ? 'center' : 'start' }));
}
function drawBotSettingsLive(bot) {
  const root = $('#view-botsettings');
  const fig = $('#bs-figure', root);
  const look = JSON.stringify([bot.color, bot.state, bot.outfit || null]);
  if (fig && fig.dataset.look !== look) { fig.dataset.look = look; fig.innerHTML = botFigure(bot.color, bot.state, 'lg', bot.outfit); }
  drawOverrides(root, bot);
  drawUndo(root, bot);
  const mv = $('#bs-move', root);
  if (mv) { mv.innerHTML = computerMoveLine(bot); wireMoveRetry(root, bot.id); }
  const jobs = bot.jobs || [];
  const waiting = jobs.filter(jobWaits).length;
  const jl = $('#bs-jobs', root);
  if (jl) jl.textContent = !jobs.length ? '' : waiting ? trn(waiting, '{n} waiting for your OK', '{n} waiting for your OK') : bot.nextRunAt ? tr('{n} · next {time}', { n: jobs.length, time: shortTime(bot.nextRunAt) }) : String(jobs.length);
  const row = jl?.closest('.bs-row');
  if (row && !jobs.length) row.title = tr('None yet. Ask it, or the Chief, e.g. "check the news every morning at 8".');
  else if (row) row.removeAttribute('title');
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
    <div class="section-head"><h1${tipAttrs(tr('{name} runs these on its own. Easiest: ask it or the Chief, e.g. "check the news every morning at 8".', { name: bot.name }))}>${tr('Jobs')}</h1></div>
    <div class="job-list" id="job-list">${jobs.map((j) => jobCardHTML(j)).join('') || `<div class="card empty" style="padding:28px 20px" id="jobs-empty">${tr('No jobs yet.')}</div>`}</div>
    <div style="margin-top:12px"><button type="button" class="btn" id="job-add">＋ ${tr('Add job')}</button></div>`;
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
