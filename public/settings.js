// ---------- learning ----------

const LEARN_ICON = { 'memory-pending': '⏳', 'skill-pending': '⏳', instructions: '✏️', skill: '✦', 'skill-updated': '✦', job: '⏰', connector: '🔌' };
// What a chip opens: a job the bot's jobs, a change to its task, its rules, a skill or a connected app its
// settings. Memory has no screen: a chip about a note opens nothing.
const learnedOpens = (kind) => (kind === 'job' ? 'botjobs' : kind === 'instructions' || kind === 'connector' || String(kind).startsWith('skill') ? 'botsettings' : '');

// What a run learned, a chip each under its reply. The line is the server's (docs/api.md, "What a run learned"):
// `chip`, whole, and the page adds no word to it. An item without one, a kind that has no chip (a job, a connected
// app), is drawn from its `text`. A memory change that is done is never sent (ADR 024).
function learnedChips(r) {
  const items = (r.learned || []).map((x) => ({ kind: x.kind, line: said(x.chip) || said(x.text), skill: said(x.skill) })).filter((x) => x.line);
  if (!items.length) return '';
  return `<div class="actions">${items.map((x) => {
    const line = `${LEARN_ICON[x.kind] || '🧠'} ${esc(x.line)}`;
    return learnedOpens(x.kind) ? `<button class="action-chip" data-learned="${esc(x.kind)}"${x.skill ? ` data-skill="${esc(x.skill)}"` : ''}>${line}</button>` : `<span class="action-chip said">${line}</span>`;
  }).join('')}</div>`;
}
// A tap on a chip of botId's: a skill's opens its settings on that skill (renderBotSettings), the others what learnedOpens says.
function openLearned(el, botId) {
  const view = learnedOpens(el.dataset.learned);
  if (!view) return;
  if (String(el.dataset.learned).startsWith('skill')) state.openSkill = { bot: botId, name: el.dataset.skill || '' };
  setView(view, botId);
}

// ---------- model & reasoning ----------

const modelLabel = (id) => (!id ? tr("Claude Code's default") : state.models?.find((x) => x.id === id)?.label || id);
const effortLabel = (id) => (!id ? tr("Claude Code's default") : state.efforts?.find((x) => x.id === id)?.label || id);
// Whether a model takes a reasoning level (from Anthropic's model list; unknown names are assumed to).
const takesEffort = (id) => { const m = state.models?.find((x) => x.id === id); return m ? m.effort !== false : !/haiku/i.test(id || ''); };
const llmSummary = (model, effort) => (model || effort ? `${modelLabel(model)}${effort && takesEffort(model) ? ` · ${effortLabel(effort)}` : ''}` : tr("Claude Code's choice"));
// The value of a Model row of the Chief or a bot, which nothing set follows the default.
const llmValue = (model, effort) => (model || effort ? llmSummary(model, effort) : tr('Default'));

// Model + reasoning selects. inherit: label for the "use the default" choice ('' = Claude Code's default).
function llmFieldsHTML(prefix, { model = '', effort = '' }, inherit = '') {
  const models = state.models || [];
  const known = models.some((x) => x.id === model);
  const groups = [...new Set(models.map((x) => x.group))];
  const modelOpts = [
    `<option value="" ${!model ? 'selected' : ''}>${esc(inherit || tr("Claude Code's default"))}</option>`,
    ...groups.map((g) => `<optgroup label="${esc(g)}">${models.filter((x) => x.group === g).map((x) => `<option value="${esc(x.id)}" ${x.id === model ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>`),
    `<option value="__custom" ${model && !known ? 'selected' : ''}>${tr('Another model…')}</option>`,
  ].join('');
  const effortOpts = [`<option value="" ${!effort ? 'selected' : ''}>${esc(inherit || tr("Claude Code's default"))}</option>`, ...(state.efforts || []).map((x) => `<option value="${esc(x.id)}" ${x.id === effort ? 'selected' : ''}>${esc(x.label)}</option>`)].join('');
  return `
    <div class="llm-fields" data-llm="${prefix}">
      <div class="row">
        <label class="field">${tr('Model')}<select name="${prefix}Model">${modelOpts}</select></label>
        <label class="field">${tr('Reasoning level')}<select name="${prefix}Effort">${effortOpts}</select></label>
      </div>
      <input type="text" class="mono ${model && !known ? '' : 'hidden'}" name="${prefix}ModelCustom" value="${model && !known ? esc(model) : ''}" placeholder="${esc(tr('Full model name, e.g. claude-opus-4-8'))}" autocomplete="off" spellcheck="false">
    </div>`;
}

// What a model and a reasoning level are like is no line under them (#635): it is each select's tooltip, and its
// description for a screen reader.
function wireLlmFields(form, prefix) {
  const m = form[`${prefix}Model`];
  const e = form[`${prefix}Effort`];
  const custom = form[`${prefix}ModelCustom`];
  const describe = (el, text) => { el.title = text; el.setAttribute('aria-description', text); };
  const update = () => {
    custom.classList.toggle('hidden', m.value !== '__custom');
    const id = m.value === '__custom' ? custom.value.trim() : m.value;
    const info = state.models?.find((x) => x.id === id);
    const noEffort = !!id && !takesEffort(id);
    e.disabled = noEffort;
    const effort = state.efforts?.find((x) => x.id === e.value);
    describe(m, info?.note || '');
    describe(e, noEffort ? tr("{model} doesn't use reasoning levels.", { model: info?.label || id }) : effort ? `${effort.label}: ${effort.note}` : '');
  };
  m.onchange = update;
  e.onchange = update;
  custom.oninput = update;
  update();
}

function readLlmFields(form, prefix) {
  const m = form[`${prefix}Model`].value;
  const model = m === '__custom' ? form[`${prefix}ModelCustom`].value.trim() : m;
  return { model, effort: model && !takesEffort(model) ? '' : form[`${prefix}Effort`].value };
}

// ---------- the rows of a settings screen ----------

// Every settings screen is one flat list of rows (#635): a label left, its value right and muted, a › where the row
// opens something, a switch where it is on or off. A blank gap parts two lists. What a row is about, when its label
// alone may not say it, is its tooltip and its description for a screen reader, never a line under it.
const CHEV = '<span class="bs-chev" aria-hidden="true">›</span>';
const tipAttrs = (tip) => (tip ? ` title="${esc(tip)}" aria-description="${esc(tip)}"` : '');

// A change on a settings screen saves by itself: "Saved" stands at the screen's top right for two seconds after it,
// in the panel's head for a chat's settings and its jobs, beside the title on Settings. A status, so a screen
// reader says it too. root: the screen's section.
function flashSaved(root) {
  const head = root.closest('#panel') ? $('#panel .panel-head') : $('.set-title', root);
  if (!head) return;
  let note = $('.saved-note', head);
  if (!note) {
    note = document.createElement('span');
    note.className = 'saved-note';
    note.setAttribute('role', 'status');
    head.insertBefore(note, $('.panel-close', head)); // left of the panel's close; at the end of Settings' title
  }
  note.textContent = tr('Saved');
  note.classList.add('on');
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => note.classList.remove('on'), 2000);
}

// ---------- settings ----------

// Under the model list's "Check for new models": only a check that failed says so. Where the list comes from is
// the button's tooltip.
function catalogLine() {
  const c = state.catalog || {};
  if (c.error) return `<span class="warn-text">${esc(c.error)}</span>`;
  return '';
}
function catalogTip() {
  const c = state.catalog || {};
  return c.source === 'docs' ? tr("Model list from Anthropic's docs, checked {ago}. Reasoning levels from your Claude Code.", { ago: ago(c.checkedAt) }) : tr('Built-in model list, not checked online yet.');
}

// The checkup's two switches in the Chief's settings (docs/api.md, The Chief's checkup), from a server that has
// it. Its days and its time have no control: the row shows them in the server's words, and the Chief changes them.
const CHECKUP_HTML = `
      <div class="bs-group hidden" id="chief-checkup">
        <label class="bs-row" title="${esc(tr('Ask the Chief to change when.'))}"><b>${tr('Checkup')}</b><span class="bs-val" data-checkup-when></span>
          <span class="switch"><input type="checkbox" data-checkup="on" aria-label="${esc(tr('Checkup'))}"><span></span></span></label>
        <label class="bs-row"${tipAttrs(tr('Lets a checkup search the web to check a proposal. It never opens a page.'))}><b>${tr('Web search')}</b>
          <span class="switch"><input type="checkbox" data-checkup="webSearch" aria-label="${esc(tr('Web search'))}"><span></span></span></label>
      </div>`;

// The switches as the server has them; Web search is there but can't be used while checkups are off.
function drawCheckup() {
  const box = $('#chief-checkup');
  if (!box) return;
  const c = state.features.includes('checkup') ? state.checkup : null;
  box.classList.toggle('hidden', !c);
  if (!c) return;
  const [on, web] = ['on', 'webSearch'].map((k) => $(`[data-checkup="${k}"]`, box));
  on.checked = !!c.on;
  web.checked = !!c.webSearch;
  web.disabled = !c.on;
  $('[data-checkup-when]', box).textContent = c.when;
}

async function loadCheckup() {
  if (!state.features.includes('checkup')) return;
  try { state.checkup = (await api('/settings/checkup')).checkup; } catch { /* the switches stay as they were, or away */ }
  drawCheckup();
}

// A refused or failed change puts the switch back: it is drawn again from what the server last said.
async function setCheckup(key, value) {
  try { state.checkup = (await api('/settings/checkup', { method: 'PUT', body: { [key]: value } })).checkup; flashSaved($('#view-chiefsettings')); }
  catch (err) { toast(err.message, true); }
  drawCheckup();
}

// The Chief's settings (its figure and name in its chat): its name, its model and reasoning, your rules for it, the
// checkup's switches, its previous chats. Its instructions and tools are botdot's.
function renderChiefSettings() {
  const root = $('#view-chiefsettings');
  if (root.dataset.ready) renderChatList();
  if (root.dataset.ready && !root.dataset.always) loadChiefAlways(root);
  if (!state.settings || root.dataset.ready) return;
  root.dataset.ready = '1';
  const s = state.settings;
  // One form for what PUT /settings takes (its fields are named chief…): the rules at the top, the model in its row.
  root.innerHTML = `
    <form id="chief-form" autocomplete="off">
      <div class="set-head">
        ${chiefFigure('lg')}
        <div class="set-name">${state.features.includes('chief-name')
          ? `<input type="text" id="chief-rename" maxlength="40" placeholder="${esc(tr('Chief of Staff'))}" autocomplete="off" aria-label="${esc(tr('Name'))}" value="${esc(chiefName() === CHIEF_ROLE ? '' : chiefName())}">`
          : `<b>${esc(chiefTitle())}</b>`}</div>
      </div>
      <label class="field">${tr('Your rules for it')}<textarea name="chiefRules" rows="4" maxlength="4000" placeholder="${esc(tr('e.g. Always ask me before creating a bot. Talk to me like a colleague: short and direct.'))}">${esc(s.chiefRules || '')}</textarea></label>
      <div class="set-list">
        <details class="bs-row bs-more" id="chief-model">
          <summary${tipAttrs(tr('What the Chief uses to plan, create and manage your bots.'))}><b>${tr('Model')}</b><span class="bs-val" data-llm-val>${esc(llmValue(s.chiefModel, s.chiefEffort))}</span>${CHEV}</summary>
          <div class="bs-body">${llmFieldsHTML('chief', { model: s.chiefModel, effort: s.chiefEffort }, tr('Same as the default'))}</div>
        </details>
        <div class="bs-row" id="chief-skills"${tipAttrs(tr('From your library, beside its own. Only you change them.'))}>
          <div class="grow"><b>${tr('Skills')}</b><div id="chief-skill-picks"><span class="faint">${tr('Loading…')}</span></div></div>${CHEV}
        </div>
        <div class="bs-row hidden" id="chief-always"${tipAttrs(tr('What you said to always allow on its cards. Revoke one and it asks you again.'))}>
          <div class="grow"><b>${tr('Always approved')}</b><div id="chief-always-picks"></div></div>${CHEV}
        </div>
      </div>
      <div class="set-list">${state.features.includes('chief-jobs') ? `
        <details class="bs-row bs-more" id="chief-jobs">
          <summary${tipAttrs(tr('It looks things up on a schedule and tells you here; it changes nothing. Easiest: ask it, e.g. "every weekday at 8 tell me what\'s new on Hacker News".'))}><b>${tr('Jobs')}</b><span class="bs-val" id="chief-jobs-val"></span>${CHEV}</summary>
          <div class="bs-body" id="chief-job-list"><span class="faint">${tr('Loading…')}</span></div>
        </details>` : ''}${typeof Pages !== 'undefined' && Pages.showsChief() ? `
        <details class="bs-row bs-more" id="chief-pages">
          <summary${tipAttrs(tr('Reports, memos and overviews it made for you. Open one to keep it up to date.'))}><b>${tr('Pages')}</b><span class="bs-val" id="chief-pages-val"></span>${CHEV}</summary>
          <div class="bs-body pg-list" id="chief-page-list"><span class="faint">${tr('Loading…')}</span></div>
        </details>` : ''}${state.features.includes('chief-files') ? `
        <button type="button" class="bs-row bs-link" id="chief-files" data-chief-files><b>${tr('Files')}</b>${CHEV}</button>` : ''}${CHECKUP_HTML}
        <details class="bs-row bs-more" id="chief-chats-row">
          <summary><b>${tr('Previous chats')}</b>${CHEV}</summary>
          <div class="bs-body settings-links" id="chief-chats"></div>
        </details>
      </div>
    </form>`;
  renderChatList();
  drawChiefSkills(root);
  loadChiefAlways(root);
  if ($('#chief-page-list', root)) Pages.drawList({ id: Pages.CHIEF, name: chiefTitle() }, $('#chief-page-list', root), $('#chief-pages-val', root)); // public/pages.js (#384)
  drawChiefFiles(root);
  drawChiefJobs();
  $$('[data-checkup]', root).forEach((box) => (box.onchange = () => setCheckup(box.dataset.checkup, box.checked)));
  loadCheckup();
  const rename = $('#chief-rename', root);
  if (rename) rename.onchange = () => renameChief(rename);
  const form = $('#chief-form', root);
  wireLlmFields(form, 'chief');
  form.onsubmit = (e) => e.preventDefault();
  // Only the fields PUT /settings takes: the switches and picks in the rows save on their own.
  form.onchange = async (e) => {
    if (!String(e.target.name || '').startsWith('chief')) return;
    const c = readLlmFields(form, 'chief');
    try {
      const r = await api('/settings', { method: 'PUT', body: { chiefModel: c.model, chiefEffort: c.effort, chiefRules: form.chiefRules.value } });
      state.settings = r.settings;
      $('[data-llm-val]', root).textContent = llmValue(r.settings.chiefModel, r.settings.chiefEffort);
      flashSaved(root);
    } catch (err) { toast(err.message, true); }
  };
}

// The Chief's lasting grants, "Always allow" on its cards (#381): the actions in connected apps (ADR 047) and the
// types of change after the web (ADR 055), from a server that has each. Asked again each time its settings open
// (the Chief may have removed one by chat, a card may have added one); hidden while there is none. app.js
// clears root.dataset.always while they are closed.
const CHIEF_ALWAYS = [
  { feature: 'chief-connectors', path: '/chief/connector-actions', key: 'action', desc: tr('In a connected app, with any details.'),
    list: (r) => (r.grants || (r.actions || []).map((action) => ({ action, label: action }))).map((g) => ({ id: g.action, label: g.label })) },
  { feature: 'more-always', path: '/chief/after-web', key: 'type', desc: tr('Also after it read the web in a chat.'),
    list: (r) => (r.types || []).map((t) => ({ id: t.type, label: t.label[0].toUpperCase() + t.label.slice(1) })) },
];
async function loadChiefAlways(root) {
  root.dataset.always = '1';
  const row = $('#chief-always', root);
  const kinds = CHIEF_ALWAYS.filter((k) => state.features.includes(k.feature));
  const lists = await Promise.all(kinds.map((k) => api(k.path).then(k.list).catch(() => [])));
  const items = kinds.flatMap((k, i) => lists[i].map((x) => ({ ...x, id: `${k.path} ${x.id}`, desc: k.desc })));
  row.classList.toggle('hidden', !items.length);
  if (!items.length) return;
  const on = new Set(items.map((x) => x.id));
  foldPicker($('#chief-always-picks', root), items, on, () => {}, {
    action: { label: tr('Revoke'), run: async (id) => {
      const k = CHIEF_ALWAYS.find((x) => id.startsWith(`${x.path} `));
      try { await api(k.path, { method: 'DELETE', body: { [k.key]: id.slice(k.path.length + 1) } }); } catch (e) { toast(e.message, true); return false; }
      toast(tr('Revoked: it asks you again'));
      if (on.size <= 1) row.classList.add('hidden');
      return true;
    } },
  });
}

// Its files and workspace (#383): the Files view (#603, files.js), as a bot's.
const chiefAsBot = () => ({ id: '_chief', name: chiefTitle(), base: '/chief', computer: 'none' });
function drawChiefFiles(root) {
  const link = $('[data-chief-files]', root);
  if (link) link.onclick = () => Files.open(chiefAsBot());
}

// Renames the Chief from its settings, as a bot is renamed (#379): empty gives back the role's own name. The feed's
// chief_name redraws the other places too; a refused name (a bot's, too long) puts the field back.
async function renameChief(field) {
  try {
    const { name } = await api('/settings/chief-name', { method: 'PUT', body: { name: field.value.trim() } });
    if (takeChiefName(name)) { renderContacts(); drawChiefName(); drawPanelHead(); }
    field.value = chiefName() === CHIEF_ROLE ? '' : chiefName();
    flashSaved($('#view-chiefsettings'));
  } catch (err) {
    field.value = chiefName() === CHIEF_ROLE ? '' : chiefName();
    toast(err.message, true);
  }
}

// Its own jobs (#408): each with when it runs, a switch and Remove. Drawn again from the feed's chief_jobs, which
// carries the whole list, or read from the server.
async function drawChiefJobs(jobs = null) {
  const box = $('#chief-job-list');
  if (!box) return;
  try { jobs ||= (await api('/chief/jobs')).jobs; } catch { box.innerHTML = `<span class="faint">${tr("Couldn't load its jobs.")}</span>`; return; }
  box.innerHTML = jobs.length ? jobs.map((j) => `
      <div class="bs-row" data-chief-job="${esc(j.id)}">
        <div class="grow"><b>${esc(j.name)}</b><span class="bs-val">${esc(j.when)}${j.on ? '' : ` · ${tr('paused')}`}</span><div class="faint">${esc(j.task.length > 160 ? `${j.task.slice(0, 160)}…` : j.task)}</div>
          <button type="button" class="link-btn danger-text" data-chief-job-remove>${tr('Remove')}</button></div>
        <label class="switch"><input type="checkbox" data-chief-job-on ${j.on ? 'checked' : ''} aria-label="${esc(tr('{name} on', { name: j.name }))}"><span></span></label>
      </div>`).join('') : `<div class="faint">${tr('None yet.')}</div>`;
  const count = $('#chief-jobs-val');
  if (count) count.textContent = jobs.length ? String(jobs.length) : '';
  $$('[data-chief-job]', box).forEach((row) => {
    const id = row.dataset.chiefJob;
    $('[data-chief-job-on]', row).onchange = (e) => api(`/chief/jobs/${encodeURIComponent(id)}`, { method: 'PUT', body: { on: e.target.checked } })
      .then(() => flashSaved($('#view-chiefsettings'))).catch((err) => { toast(err.message, true); drawChiefJobs(); });
    $('[data-chief-job-remove]', row).onclick = () => api(`/chief/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => { toast(tr('Removed.')); drawChiefJobs(); }).catch((err) => toast(err.message, true));
  });
}

// The library skills you gave the Chief (settings.chiefSkills): ticked as a bot's are in its settings, saved at once.
function drawChiefSkills(root) {
  const box = $('#chief-skill-picks', root);
  api('/skills').then(({ library }) => {
    const has = new Set(state.settings.chiefSkills || []);
    const items = [...library.filter((k) => has.has(k.name)), ...library.filter((k) => !has.has(k.name))]
      .map((k) => ({ id: k.name, label: k.name, desc: k.description, more: skillMoreHTML(k) }));
    foldPicker(box, items, has, async () => {
      try {
        const r = await api('/settings', { method: 'PUT', body: { chiefSkills: [...has] } });
        state.settings = r.settings;
        flashSaved($('#view-chiefsettings'));
      } catch (err) { toast(err.message, true); }
    }, { empty: tr('No skills in your library yet.') });
  }).catch(() => { box.innerHTML = `<span class="faint">${tr("Couldn't load skills.")}</span>`; });
}

// The pages that open from Settings. They are its first rows; Pages is every bot's pages (#361).
const SETTINGS_PAGES = [['runs', tr('Activity')], ['skills', tr('Skills')], ['pages', tr('Pages')], ['connectors', tr('Connectors')], ['vault', tr('Vault')]];

// The rows to the pages above. Drawn again on every refresh, also while the rows below keep their edits, so that
// Activity always shows the tasks running now.
function drawSettingsLinks(root) {
  const box = $('#settings-links', root);
  if (!box) return;
  const running = runningTasks();
  box.innerHTML = SETTINGS_PAGES.filter(([view]) => view !== 'pages' || (typeof Pages !== 'undefined' && Pages.showsAll())).map(([view, label]) => `
      <button type="button" class="bs-row bs-link" data-go="${view}"><b>${label}</b>${view === 'runs' && running ? `<span class="bs-val">${trn(running, '{n} running', '{n} running')}</span>` : ''}${CHEV}</button>`).join('');
  $$('[data-go]', box).forEach((b) => (b.onclick = () => setView(b.dataset.go)));
}

// Settings: the pages it opens, then the account's own settings, a row each; a row with more to it opens under it.
function renderSettings() {
  const root = $('#view-settings');
  if (!state.settings) { root.innerHTML = `<div class="empty">${tr('Loading…')}</div>`; return; }
  if (root.querySelector('#settings-form')) return drawSettingsLinks(root); // don't wipe unsaved edits on refresh
  const s = state.settings;
  const custom = state.bots.filter((b) => b.model || b.effort);
  root.innerHTML = `
    <div class="section-head set-title">${BACK_BTN}<h1>${tr('Settings')}</h1><span class="saved-note" role="status"></span></div>
    <div class="set-list" id="settings-links"></div>
    <div class="set-list">
      <details class="bs-row bs-more" id="settings-model">
        <summary${tipAttrs(tr('The model and reasoning level of every bot without a choice of its own.'))}><b>${tr('Model')}</b><span class="bs-val" data-llm-val>${esc(llmSummary(s.defaultModel, s.defaultEffort))}</span>${CHEV}</summary>
        <form class="bs-body" id="settings-form" autocomplete="off">
          ${llmFieldsHTML('default', { model: s.defaultModel, effort: s.defaultEffort })}
          <div class="catalog-line">${catalogLine()} <button type="button" class="link-btn" id="refresh-models"${tipAttrs(catalogTip())}>${tr('Check for new models')}</button></div>
        </form>
      </details>
      ${custom.length ? `<details class="bs-row bs-more">
        <summary><b>${tr('Bots with their own model')}</b><span class="bs-val">${custom.length}</span>${CHEV}</summary>
        <div class="bs-body">${custom.map((b) => `<button type="button" class="settings-bot" data-edit-bot="${esc(b.id)}"><span>${botLabel(b)}</span><span class="muted">${esc(llmSummary(b.model, b.effort))}</span></button>`).join('')}</div>
      </details>` : `<div class="bs-row"${tipAttrs(tr('Every bot uses the default. Change a bot in its settings.'))}><b>${tr('Bots with their own model')}</b><span class="bs-val">${tr('None')}</span></div>`}
      ${state.features.includes('boat-size') && state.status?.boat ? `<details class="bs-row bs-more" id="boat-size-card">
        <summary><b>${tr('Computer')}</b><span class="bs-val" id="computer-place-val"></span>${CHEV}</summary>
        <div class="bs-body">
          ${state.features.includes('account-computer') ? `<label class="field">${tr('Where')}<select id="computer-place" disabled><option value="linux">${tr('This machine')}</option><option value="boat">${tr('External Virtual PC')}</option></select></label>` : ''}
          <label class="field" id="boat-size-field">${tr('Size')}<select id="boat-size" disabled${tipAttrs(tr('Each machine takes it when it starts next.'))}><option>${tr('Loading…')}</option></select></label>
        </div>
      </details>` : ''}
      ${state.features.includes('token-usage') ? '<details class="bs-row bs-more" id="usage-card"></details>' : ''}
    </div>
    <div class="set-list">
      <label class="bs-row"><b>${tr('Language')}</b><select id="settings-language" aria-label="${esc(tr('Language'))}">${LANGUAGE_NAMES.map(([id, name]) => `<option value="${id}"${id === (s.language || 'en') ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
      ${pushCardHTML()}
      <div class="bs-group" id="install-card" hidden></div>
    </div>
    <div class="set-list">
      <details class="bs-row bs-more" id="backups-card">
        <summary><b>${tr('Backups')}</b><span class="bs-val">${tr('Checking…')}</span>${CHEV}</summary>
      </details>
      <details class="bs-row bs-more" id="update-card" hidden></details>
      ${signOutCardHTML()}
    </div>`;
  drawInstallCard();
  loadUpdateCard();
  wirePushCard(root);
  const signOut = $('#sign-out-everywhere', root);
  if (signOut) signOut.onclick = signOutEverywhere;
  drawSettingsLinks(root);
  loadBackupsCard();
  loadComputerPlace(root);
  loadBoatSize(root);
  if ($('#usage-card', root) && typeof Usage !== 'undefined') Usage.open($('#usage-card', root)); // public/usage.js (#301)
  wireLanguage(root);
  const form = $('#settings-form', root);
  wireLlmFields(form, 'default');
  $('#refresh-models', root).onclick = async (e) => {
    e.target.textContent = tr('Checking…');
    try {
      const r = await api('/settings/refresh-models', { method: 'POST' });
      Object.assign(state, { models: r.models, efforts: r.efforts, catalog: r.catalog });
      toast(r.catalog.error ? r.catalog.error : tr('Model list is up to date'), !!r.catalog.error);
    } catch (err) { toast(err.message, true); }
    root.innerHTML = '';
    renderSettings();
    $('#settings-model', root).open = true; // the row the button is in stays open
  };
  $$('[data-edit-bot]', root).forEach((b) => (b.onclick = () => setView('botsettings', b.dataset.editBot)));
  // Saves by itself, like a bot's settings.
  form.onsubmit = (e) => e.preventDefault();
  form.onchange = async () => {
    const d = readLlmFields(form, 'default');
    try {
      const r = await api('/settings', { method: 'PUT', body: { defaultModel: d.model, defaultEffort: d.effort } });
      state.settings = r.settings;
      $('[data-llm-val]', root).textContent = llmSummary(r.settings.defaultModel, r.settings.defaultEffort);
      flashSaved(root);
    } catch (err) { toast(err.message, true); }
  };
}

// The interface's language (#645, ADR 108): saved by itself; the page then loads again in it. A language's own name
// is never translated.
const LANGUAGE_NAMES = [['en', 'English'], ['pl', 'Polski']];
function wireLanguage(root) {
  const pick = $('#settings-language', root);
  if (!pick) return;
  if (!state.features.includes('language')) { pick.closest('.bs-row').hidden = true; return; }
  pick.onchange = async () => {
    const to = pick.value;
    pick.disabled = true;
    try {
      state.settings = (await api('/settings', { method: 'PUT', body: { language: to } })).settings;
      flashSaved(root);
      await I18n.sync(api, state.features);
    } catch (err) { toast(err.message, true); pick.value = state.settings.language || 'en'; }
    pick.disabled = false;
  };
}

// Where the account's computer is (#579): this machine or its External Virtual PC on boat.dev, for every bot with a
// computer. A switch asks once whether the bots' files go along.
async function loadComputerPlace(root) {
  const pick = $('#computer-place', root);
  if (!pick) return;
  let place;
  try { ({ place } = await api('/settings/computer')); } catch { return; }
  const show = () => {
    pick.value = place;
    $('#boat-size-field', root).hidden = place !== 'boat';
    $('#computer-place-val', root).textContent = pick.selectedOptions[0]?.textContent || '';
  };
  show();
  pick.disabled = false;
  pick.onchange = async () => {
    const to = pick.value;
    pick.value = place; // back at the saved one until the answer
    const copy = state.bots.some((b) => b.computer === 'linux' || b.computer === 'boat') ? await askMoveFiles(to, true) : false;
    if (copy === null) return;
    try {
      ({ place } = await api('/settings/computer', { method: 'PUT', body: { place: to, moveFiles: copy } }));
      show();
      flashSaved($('#view-settings'));
      await refresh();
    } catch (err) { toast(err.message, true); }
  };
}

// The size of the account's boat.dev machines (#539): the sizes boat.dev makes now, and the chosen one even when not.
const boatSizeLabel = (s) => `${s.id[0].toUpperCase()}${s.id.slice(1)} · ${s.cpus} CPU · ${s.memoryGB} GB`;
async function loadBoatSize(root) {
  const pick = $('#boat-size', root);
  if (!pick) return;
  let r;
  try { r = await api('/settings/boat-size'); } catch { $('#boat-size-card', root).hidden = true; return; }
  pick.innerHTML = r.sizes.filter((s) => s.available || s.id === r.size).map((s) => `<option value="${esc(s.id)}"${s.id === r.size ? ' selected' : ''}>${esc(boatSizeLabel(s))}</option>`).join('');
  pick.disabled = false;
  pick.onchange = async () => {
    try {
      await api('/settings/boat-size', { method: 'PUT', body: { size: pick.value } });
      flashSaved($('#view-settings'));
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- installing the app ----------

// Settings → "Install app" (issue #163, install.js): the browser's own install dialog where it offers one (Chrome,
// Edge), the way to do it in Safari, and nothing once botdot is installed or opened as the app.
const INSTALL_HINTS = {
  ios: tr('Tap Share, then “Add to Home Screen”.'),
  'mac-safari': tr('In Safari’s menu: File, then “Add to Dock”.'),
};
function drawInstallCard() {
  const card = $('#install-card');
  if (!card) return;
  const how = Install.state(window);
  card.hidden = !how;
  if (!how) { card.innerHTML = ''; return; }
  // The way in Safari is what the row opens: without it the row can't be followed.
  card.innerHTML = how === 'button' ? `
      <div class="bs-row"${tipAttrs(tr('botdot in its own window, with its own icon.'))}><b>${tr('Install app')}</b><button type="button" class="btn sm" id="install-app">${tr('Install')}</button></div>` : `
      <details class="bs-row bs-more"><summary><b>${tr('Install app')}</b>${CHEV}</summary><div class="bs-body">${esc(INSTALL_HINTS[how])}</div></details>`;
  const button = $('#install-app', card);
  if (button) button.onclick = () => Install.install(window).catch(() => false);
}
Install.onChange(window, drawInstallCard);

// ---------- notifications on this device ----------

// Settings → "Notifications on this device" (issue #87, push.js): botdot sends this browser what the phone app shows.
// The browser's permission is asked when the switch is turned on, never on load. In Safari on an iPhone or iPad the
// switch is replaced by the way there: Web Push comes only to botdot added to the Home Screen.
function pushCardHTML() {
  if (!state.features.includes('web-push')) return '';
  // The switch is for this device only: its label says "Notifications", its name for a screen reader says the rest.
  if (Push.needsHomeScreen(navigator)) {
    return `<details class="bs-row bs-more" id="push-card"><summary><b>${tr('Notifications')}</b><span class="bs-val">${tr('Home Screen first')}</span>${CHEV}</summary>
      <div class="bs-body">${tr('Tap Share, then “Add to Home Screen”, and open botdot from there. Then turn this on in its Settings.')}</div></details>`;
  }
  if (!Push.supported(window)) {
    return `<div class="bs-row" id="push-card"${tipAttrs(tr("This browser can't show botdot's notifications."))}><b>${tr('Notifications')}</b><span class="bs-val">${tr('Not in this browser')}</span></div>`;
  }
  return `<label class="bs-row" id="push-card" title="${esc(tr('On this device'))}"><b>${tr('Notifications')}</b>
      <span class="switch"><input type="checkbox" id="push-on" disabled aria-label="${esc(tr('Notifications on this device'))}"><span></span></span></label>`;
}

function wirePushCard(root) {
  const box = $('#push-on', root);
  if (!box) return;
  Push.isOn(window).catch(() => false).then((on) => { box.checked = on; box.disabled = false; });
  box.onchange = async () => {
    const on = box.checked;
    box.disabled = true;
    try {
      await (on ? Push.turnOn(window, api) : Push.turnOff(window, api));
      flashSaved($('#view-settings'));
    } catch (err) {
      toast(err.message || tr("Couldn't change notifications."), true);
    }
    box.checked = await Push.isOn(window).catch(() => false);
    box.disabled = false;
  };
}

// A tap on a notification of this browser (sw.js): the chat or the card it is about.
function openTarget(target) {
  const to = Push.viewOf(target);
  if (!to) return;
  if (to.view === 'chief') openChiefChat(to.id || state.chatId || null);
  else setView(to.view, to.id || undefined);
}

// ---------- when this account switches to a new version ----------

// Settings → "Updates" (#259, ADR 053): the owner's "Update automatically" and, when the admin installed a version this
// account waits for, "Update now". Both are the front door's own routes, never botdot's, and only where the front door
// says this account chooses (its session's `updates`): not on a machine of one account. While a version waits, its
// What's new under them (#303): the notes the front door says it brings, kept for the card's next drawings.
let updateNotes = [];
async function loadUpdateCard() {
  if (!state.features.includes('accounts')) return;
  let u = null;
  try {
    const session = await fetch('/front-door/session').then((r) => (r.ok ? r.json() : null));
    if (session?.updates === true) u = await fetch('/front-door/update').then((r) => (r.ok ? r.json() : null));
    // An older front door has no such route: no notes.
    const notes = u?.ready ? await fetch('/front-door/update/notes').then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
    updateNotes = Array.isArray(notes?.entries) ? notes.entries.filter((e) => e && typeof e.title === 'string' && Array.isArray(e.points)) : [];
  } catch { /* nothing to show */ }
  drawUpdateCard(u);
}

function updateNotesHTML(u) {
  if (!u.ready || !updateNotes.length) return '';
  return `<div class="whats-new update-notes"><h3 class="page-sub">${tr("What's new")}</h3>${whatsNewNotesHTML(updateNotes)}</div>`;
}

function updateCardText(u) {
  const day = (iso) => new Date(iso).toLocaleDateString(I18n.locale, { weekday: 'long', month: 'short', day: 'numeric' });
  if (u.asked || u.last?.state === 'switching') return tr('Moving to the new version. Your bots restart in a minute or two.');
  if (u.ready) return tr('A new version{version} is ready. Your account moves to it by itself on {day}, or now if you choose.', { version: u.ready.version ? ` (${u.ready.version})` : '', day: day(u.ready.deadline) });
  if (u.last && (u.last.state === 'kept' || u.last.state === 'failed')) return tr("The last move to a new version didn't happen: {why}.", { why: u.last.error || tr('the admin can see why') });
  return '';
}

function drawUpdateCard(u) {
  const card = $('#update-card');
  if (!card) return;
  card.hidden = !u;
  if (!u) { card.innerHTML = ''; return; }
  // What the switch's two ways mean is its tooltip; what is happening now (a version waits, a move failed) is said.
  card.innerHTML = `
      <summary><b>${tr('Updates')}</b><span class="bs-val">${u.ready ? tr('New version') : u.autoUpdate ? tr('Automatic') : ''}</span>${CHEV}</summary>
      <div class="bs-body">
        <label class="bs-row"${tipAttrs(tr("On: always use the latest botdot version. Off: update when you're ready, before the admin's deadline."))}><b>${tr('Update automatically')}</b>
          <span class="switch"><input type="checkbox" id="auto-update" aria-label="${esc(tr('Update automatically'))}"${u.autoUpdate ? ' checked' : ''}><span></span></span></label>
        ${updateCardText(u) ? `<p class="muted" id="update-said">${esc(updateCardText(u))}</p>` : ''}
        ${u.canUpdate ? `<div><button type="button" class="btn" id="update-now">${tr('Update now')}</button></div>` : ''}
        ${updateNotesHTML(u)}
      </div>`;
  const box = $('#auto-update', card);
  box.onchange = async () => {
    box.disabled = true;
    try { drawUpdateCard(await frontDoorPost('/front-door/update', { autoUpdate: box.checked })); flashSaved($('#view-settings')); } catch (err) {
      toast(err.message, true);
      box.checked = !box.checked;
      box.disabled = false;
    }
  };
  const now = $('#update-now', card);
  if (now) now.onclick = async () => {
    if (!confirm(tr('Update now? Your account moves to the new version: your bots restart, and work still running stops.'))) return;
    now.disabled = true;
    try { drawUpdateCard(await frontDoorPost('/front-door/update/now', {})); } catch (err) { toast(err.message, true); now.disabled = false; }
  };
  // While it moves, the card follows it.
  clearTimeout(drawUpdateCard.next);
  if (u.asked || u.last?.state === 'switching') drawUpdateCard.next = setTimeout(loadUpdateCard, 10_000);
}

// A POST to one of the front door's own routes: its answer, or throws its sentence.
async function frontDoorPost(path, body) {
  let res;
  try { res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify(body) }); } catch { throw new Error(tr("Can't reach botdot.")); }
  const data = await res.json().catch(() => ({}));
  // A session that ended signs in again, as every other call does.
  if (res.status === 401) { location.assign('/sign-in'); throw new Error(tr('Sign in first.')); }
  if (!res.ok) throw new Error(typeof data.error === 'string' && data.error.trim() ? data.error : tr('botdot answered {status}', { status: res.status }));
  return data;
}

// ---------- signing out everywhere ----------

// Settings → "Sign out everywhere" (ADR 028): the front door ends every session of the account, in every browser
// and app, this one too, and the page opens its sign-in. Only behind a front door (`accounts` in features).
const signOutCardHTML = () => (state.features.includes('accounts') ? `
    <details class="bs-row bs-more" id="sign-out-card">
      <summary><b>${tr('Sign-ins')}</b>${CHEV}</summary>
      <div class="bs-body"><div><button type="button" class="btn" id="sign-out-everywhere">${tr('Sign out everywhere')}</button></div></div>
    </details>` : '');

async function signOutEverywhere() {
  if (!confirm(tr('Sign out everywhere? Every browser and app signed in to your account, this one too, signs in again with your passkey.'))) return;
  let res;
  // The front door's own route, not botdot's: no botdot server, and so no Chief or bot, reaches a session.
  try { res = await fetch('/sign-out-everywhere', { method: 'POST', headers: { 'X-Bot-Dot': '1' } }); } catch { toast(tr("Can't reach botdot."), true); return; }
  if (res.ok || res.status === 401) { location.assign('/sign-in'); return; }
  const data = await res.json().catch(() => ({}));
  toast(typeof data.error === 'string' && data.error.trim() ? data.error : tr("Couldn't sign out ({status}).", { status: res.status }), true);
}

// ---------- the way to the admin page ----------

// Beside Settings, for the admin's session only (ADR 028): an icon that opens the front door's admin page, /admin,
// which is drawn on the web only. The front door says whose session this is; anything else (no front door, another
// account, no answer) shows nothing. It also says whether Feedback goes anywhere (#216): then its icon shows too.
async function showAdminLink() {
  if (!state.features.includes('accounts')) return;
  let session = null;
  try {
    const res = await fetch('/front-door/session');
    if (res.ok) session = await res.json();
  } catch { /* nothing to show */ }
  $('#admin-link').classList.toggle('hidden', session?.admin !== true);
  $('#feedback-btn')?.classList.toggle('hidden', session?.feedback !== true);
  feedbackShots = session?.feedbackScreenshots === true;
  if (typeof setRoomsOn === 'function') setRoomsOn(session?.rooms === true, session?.account, session?.roomLinks === true); // shared rooms (rooms.js, ADR 060; links ADR 068)
}

// ---------- feedback ----------

// Beside Settings (#216, ADR 048): a bug or a feature request for the admin of this machine, who reads it on the admin
// page. It goes to the front door, never to botdot, and holds only what is typed and added here: since #223 (ADR 048)
// up to three screenshots, when the front door says it takes them. A failed send keeps the text and the screenshots.
const FEEDBACK_KINDS = [['bug', tr('Bug')], ['feature', tr('Feature request')]];
const FEEDBACK_SHOTS = { max: 3, bytes: 5 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] };
let feedbackShots = false; // whether the front door takes screenshots (its session's feedbackScreenshots)
function openFeedback() {
  const m = openModal(`
    <form id="feedback-form" autocomplete="off">
      <div class="modal-head"><h2>${tr('Feedback')}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${feedbackShots ? tr('The admin of this machine reads it and sees each screenshot whole, as it is. Only what you write and add here is sent.') : tr('The admin of this machine reads it. Only what you write here is sent.')}</p>
        <div class="feedback-kinds">${FEEDBACK_KINDS.map(([v, label], i) => `<label><input type="radio" name="kind" value="${v}"${i ? '' : ' checked'}> ${label}</label>`).join('')}</div>
        <label class="field">${tr('What happened, or what you would like')}<textarea name="text" rows="6" required></textarea></label>
        ${feedbackShots ? `<div class="feedback-shots hidden" id="feedback-shots"></div>
        <div><button type="button" class="btn sm" id="feedback-add">${tr('Add screenshot')}</button><input type="file" id="feedback-file" accept="${FEEDBACK_SHOTS.types.join(',')}" multiple hidden></div>` : ''}
        <p class="req-note hidden" id="feedback-said" role="alert"></p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>${tr('Cancel')}</button>
        <button class="btn primary" id="feedback-send">${tr('Send')}</button>
      </div>
    </form>`);
  m._shots = [];
  $('#feedback-form', m).onsubmit = (e) => { e.preventDefault(); sendFeedback(m); };
  const add = $('#feedback-add', m), input = $('#feedback-file', m);
  if (add && input) {
    add.onclick = () => input.click();
    input.onchange = () => { addFeedbackShots(m, [...input.files]); input.value = ''; };
  }
  // The previews' addresses are let go with the form.
  m.addEventListener('close', () => { for (const s of m._shots) URL.revokeObjectURL(s.url); m._shots = []; }, { once: true });
}

// Screenshots chosen for the form: each a PNG, JPEG or WebP of at most 5 MB, at most three. One that isn't is refused
// in a sentence, and the others stay. The front door checks each again, by its bytes.
function addFeedbackShots(m, files) {
  const refused = [];
  for (const file of files) {
    if (m._shots.length >= FEEDBACK_SHOTS.max) { refused.push(trn(FEEDBACK_SHOTS.max, 'At most {n} screenshot goes in one report.', 'At most {n} screenshots go in one report.')); break; }
    if (!FEEDBACK_SHOTS.types.includes(file.type)) refused.push(tr("{name} isn't a PNG, JPEG or WebP picture.", { name: file.name }));
    else if (file.size > FEEDBACK_SHOTS.bytes) refused.push(tr('{name} is {size} MB: each screenshot can be at most 5 MB.', { name: file.name, size: (file.size / 1024 / 1024).toLocaleString(I18n.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
    else m._shots.push({ file, url: URL.createObjectURL(file) });
  }
  drawFeedbackShots(m);
  const said = $('#feedback-said', m);
  said.textContent = refused.join(' ');
  said.classList.toggle('hidden', !refused.length);
}

function drawFeedbackShots(m) {
  const box = $('#feedback-shots', m);
  if (!box) return;
  box.classList.toggle('hidden', !m._shots.length);
  box.innerHTML = m._shots.map((s, i) => `<span class="feedback-shot"><img src="${esc(s.url)}" alt="${esc(tr('Screenshot {n}', { n: i + 1 }))}"><button type="button" data-unshot="${i}" aria-label="${esc(tr('Remove screenshot {n}', { n: i + 1 }))}" title="${esc(tr('Remove'))}">×</button></span>`).join('');
  $$('[data-unshot]', box).forEach((b) => (b.onclick = () => {
    const [gone] = m._shots.splice(Number(b.dataset.unshot), 1);
    if (gone) URL.revokeObjectURL(gone.url);
    $('#feedback-said', m)?.classList.add('hidden');
    drawFeedbackShots(m);
  }));
  const add = $('#feedback-add', m);
  if (add) add.disabled = m._shots.length >= FEEDBACK_SHOTS.max;
}

// A file's bytes as base64, as the front door takes a screenshot.
async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function sendFeedback(m) {
  const f = $('#feedback-form', m);
  const go = $('#feedback-send', m);
  const said = $('#feedback-said', m);
  // The form may have been closed meanwhile, and another dialog opened in its place: that one is left alone.
  const shown = () => $('#feedback-form', m) === f;
  const kept = m._shots?.length;
  const fail = (text) => { if (!shown()) return toast(text, true); said.textContent = text; said.classList.remove('hidden'); };
  go.disabled = true;
  said.classList.add('hidden');
  try {
    const body = { kind: f.kind.value, text: f.text.value };
    if (m._shots?.length) {
      try { body.screenshots = await Promise.all(m._shots.map(async (s) => ({ data: await fileBase64(s.file) }))); } catch { return fail(tr("Couldn't read a screenshot. Remove it and add it again.")); }
    }
    let res;
    try {
      res = await fetch('/front-door/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify(body) });
    } catch { return fail(kept ? tr("Couldn't send: can't reach botdot. Your text and screenshots are still here.") : tr("Couldn't send: can't reach botdot. Your text is still here.")); }
    if (res.ok) { if (shown()) m.close(); toast(tr('Sent')); return; }
    const data = await res.json().catch(() => ({}));
    fail(typeof data.error === 'string' && data.error.trim() ? data.error : kept ? tr("Couldn't send ({status}). Your text and screenshots are still here.", { status: res.status }) : tr("Couldn't send ({status}). Your text is still here.", { status: res.status }));
  } finally { go.disabled = false; }
}

// ---------- backups ----------

// Settings → Backups (lib/backup.js): nightly, encrypted with your passphrase, the last few kept.
async function loadBackupsCard() {
  const card = $('#backups-card');
  if (!card) return;
  let b;
  try { b = await api('/backups'); } catch (e) { card.querySelector('.bs-val').textContent = e.message; return; }
  const head = (value) => `<summary><b>${tr('Backups')}</b><span class="bs-val">${esc(value)}</span>${CHEV}</summary>`;
  // Off: a passphrase turns them on. The one line kept says what losing it costs.
  if (!b.configured) {
    card.innerHTML = `${head(tr('Off'))}
      <div class="bs-body">
      <p class="muted">${tr("Without the passphrase a backup can't be opened: keep it safe.")}</p>
      <form id="backup-pass" class="backup-pass" autocomplete="off">
        <input type="password" name="p1" placeholder="${esc(tr('Passphrase'))}" minlength="8" required autocomplete="new-password">
        <input type="password" name="p2" placeholder="${esc(tr('Again'))}" minlength="8" required autocomplete="new-password">
        <button class="btn primary sm">${tr('Turn on')}</button>
      </form>
      </div>`;
    $('#backup-pass', card).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.p1.value !== f.p2.value) return toast(tr("The two don't match"), true);
      try { await api('/backups/passphrase', { method: 'PUT', body: { passphrase: f.p1.value } }); f.reset(); toast(tr('Backups are on')); await api('/backups/now', { method: 'POST' }); } catch (err) { toast(err.message, true); }
      loadBackupsCard();
    };
    return;
  }
  const last = b.last ? esc(tr('Last backup {ago} · {count} kept', { ago: ago(b.last.at), count: b.count })) : tr('No backup yet');
  card.innerHTML = `${head(tr('03:00 daily'))}
    <div class="bs-body">
    <p class="muted">${b.running ? tr('Backing up…') : last}</p>
    ${b.error ? `<div class="req-note">${esc(b.error)}</div>` : ''}
    <div class="backup-actions">
      <button class="btn sm" id="backup-now" ${b.running ? 'disabled' : ''}>${tr('Back up now')}</button>
      ${b.last ? `<a class="btn sm" href="/api/backups/${encodeURIComponent(b.last.name)}" download>${tr('Download')}</a>` : ''}
      <button class="link-btn" id="backup-change">${tr('Change passphrase')}</button>
    </div>
    </div>`;
  $('#backup-now', card).onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = tr('Backing up…');
    try { await api('/backups/now', { method: 'POST' }); toast(tr('Backed up')); } catch (err) { toast(err.message, true); }
    loadBackupsCard();
  };
  $('#backup-change', card).onclick = async () => {
    const p = prompt(tr('New backup passphrase (at least 8 characters). Older backups still need the old one.'));
    if (!p) return;
    try { await api('/backups/passphrase', { method: 'PUT', body: { passphrase: p } }); toast(tr('Passphrase changed. The next backups use it.')); } catch (err) { toast(err.message, true); }
  };
}

// Setup → Restore a backup: upload it, check the passphrase, and botdot restarts with it.
function openRestoreDialog() {
  const m = openModal(`
    <form id="restore-form" autocomplete="off">
      <div class="modal-head"><h2>${tr('Restore a backup')}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${tr("Your bots, chats, memory, vault and settings come back. Afterwards, sign in to Claude (and Bitwarden) again. What's here now is kept aside, not deleted.")}</p>
        <label class="field">${tr('Backup file')}<input type="file" name="file" accept=".bdb" required></label>
        <label class="field">${tr('Its passphrase')}<input type="password" name="passphrase" required autocomplete="off"></label>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>${tr('Cancel')}</button>
        <button class="btn primary" id="restore-go">${tr('Restore')}</button>
      </div>
    </form>`);
  $('#restore-form', m).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const go = $('#restore-go', m);
    go.disabled = true;
    try {
      go.textContent = tr('Uploading…');
      const up = await fetch('/api/backups/upload', { method: 'POST', headers: { 'X-Bot-Dot': '1', 'Content-Type': 'application/octet-stream' }, body: f.file.files[0] }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || tr('Upload failed')); return d; });
      go.textContent = tr('Checking…');
      const r = await api('/backups/restore', { method: 'POST', body: { file: up.file, passphrase: f.passphrase.value } });
      f.passphrase.value = '';
      go.textContent = tr('Restarting…');
      toast(trn(r.bots, 'Restoring {n} bot from {date}. botdot restarts.', 'Restoring {n} bots from {date}. botdot restarts.', { date: new Date(r.createdAt).toLocaleString(I18n.locale) }));
      // Back up again: reload then (to the setup page, to sign in to Claude).
      const wait = setInterval(async () => { try { await api('/version'); clearInterval(wait); location.reload(); } catch { /* still restarting */ } }, 2000);
    } catch (err) { toast(err.message, true); go.disabled = false; go.textContent = tr('Restore'); }
  };
}
