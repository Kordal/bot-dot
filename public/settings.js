// ---------- learning ----------

const LEARN_ICON = { 'memory-pending': '⏳', 'skill-pending': '⏳', instructions: '✏️', skill: '✦', 'skill-updated': '✦', job: '⏰', connector: '🔌' };
// What a chip opens: a job the bot's jobs, a change to its task, its rules, a skill or a connected app its
// settings. Memory has no screen: a chip about a note opens nothing.
const learnedOpens = (kind) => (kind === 'job' ? 'botjobs' : kind === 'instructions' || kind === 'connector' || String(kind).startsWith('skill') ? 'botsettings' : '');

// What a run learned, a chip each under its reply. The line is the server's (docs/api.md, "What a run learned"):
// `chip`, whole, and the page adds no word to it. An item without one, a kind that has no chip (a job, a connected
// app), is drawn from its `text`. A memory change that is done is never sent (ADR 024).
function learnedChips(r) {
  const items = (r.learned || []).map((x) => ({ kind: x.kind, line: said(x.chip) || said(x.text) })).filter((x) => x.line);
  if (!items.length) return '';
  return `<div class="actions">${items.map((x) => {
    const line = `${LEARN_ICON[x.kind] || '🧠'} ${esc(x.line)}`;
    return learnedOpens(x.kind) ? `<button class="action-chip" data-learned="${esc(x.kind)}">${line}</button>` : `<span class="action-chip said">${line}</span>`;
  }).join('')}</div>`;
}

// ---------- model & reasoning ----------

const modelLabel = (id) => (!id ? "Claude Code's default" : state.models?.find((x) => x.id === id)?.label || id);
const effortLabel = (id) => (!id ? "Claude Code's default" : state.efforts?.find((x) => x.id === id)?.label || id);
// Whether a model takes a reasoning level (from Anthropic's model list; unknown names are assumed to).
const takesEffort = (id) => { const m = state.models?.find((x) => x.id === id); return m ? m.effort !== false : !/haiku/i.test(id || ''); };
const llmSummary = (model, effort) => (model || effort ? `${modelLabel(model)}${effort && takesEffort(model) ? ` · ${effortLabel(effort)}` : ''}` : "Claude Code's choice");

// Model + reasoning selects. inherit: label for the "use the default" choice ('' = Claude Code's default).
function llmFieldsHTML(prefix, { model = '', effort = '' }, inherit = '') {
  const models = state.models || [];
  const known = models.some((x) => x.id === model);
  const groups = [...new Set(models.map((x) => x.group))];
  const modelOpts = [
    `<option value="" ${!model ? 'selected' : ''}>${esc(inherit || "Claude Code's default")}</option>`,
    ...groups.map((g) => `<optgroup label="${esc(g)}">${models.filter((x) => x.group === g).map((x) => `<option value="${esc(x.id)}" ${x.id === model ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>`),
    `<option value="__custom" ${model && !known ? 'selected' : ''}>Another model…</option>`,
  ].join('');
  const effortOpts = [`<option value="" ${!effort ? 'selected' : ''}>${esc(inherit || "Claude Code's default")}</option>`, ...(state.efforts || []).map((x) => `<option value="${esc(x.id)}" ${x.id === effort ? 'selected' : ''}>${esc(x.label)}</option>`)].join('');
  return `
    <div class="llm-fields" data-llm="${prefix}">
      <div class="row">
        <label class="field">Model<select name="${prefix}Model">${modelOpts}</select></label>
        <label class="field">Reasoning level<select name="${prefix}Effort">${effortOpts}</select></label>
      </div>
      <input type="text" class="mono ${model && !known ? '' : 'hidden'}" name="${prefix}ModelCustom" value="${model && !known ? esc(model) : ''}" placeholder="Full model name, e.g. claude-opus-4-8" autocomplete="off" spellcheck="false">
      <div class="llm-note" data-llm-note></div>
    </div>`;
}

function wireLlmFields(form, prefix) {
  const box = $(`[data-llm="${prefix}"]`, form);
  const m = form[`${prefix}Model`];
  const e = form[`${prefix}Effort`];
  const custom = form[`${prefix}ModelCustom`];
  const update = () => {
    custom.classList.toggle('hidden', m.value !== '__custom');
    const id = m.value === '__custom' ? custom.value.trim() : m.value;
    const info = state.models?.find((x) => x.id === id);
    const noEffort = !!id && !takesEffort(id);
    e.disabled = noEffort;
    const effort = state.efforts?.find((x) => x.id === e.value);
    const bits = [];
    if (info?.note) bits.push(esc(info.note));
    if (noEffort) bits.push(`${esc(info?.label || id)} doesn't use reasoning levels.`);
    else if (effort) bits.push(`<b>${esc(effort.label)}:</b> ${esc(effort.note)}`);
    $('[data-llm-note]', box).innerHTML = bits.join(' ');
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

// ---------- settings ----------

function catalogLine() {
  const c = state.catalog || {};
  if (c.error) return `<span class="warn-text">${esc(c.error)}</span>`;
  if (c.source === 'docs') return `Model list from Anthropic's docs, checked ${esc(ago(c.checkedAt))}. Reasoning levels from your Claude Code.`;
  return 'Built-in model list (not checked online yet).';
}

// The checkup's two switches in the Chief's settings (docs/api.md, The Chief's checkup), from a server that has
// it. Its days and its time have no control: the line says them in the server's words, and the Chief changes them.
const CHECKUP_HTML = `
    <div class="card settings-card bs-rows hidden" id="chief-checkup">
      <div class="bs-row">
        <div class="grow"><b>Checkup</b><div class="faint" data-checkup-when></div></div>
        <label class="switch"><input type="checkbox" data-checkup="on" aria-label="Checkup"><span></span></label>
      </div>
      <div class="bs-row">
        <div class="grow"><b>Web search</b><div class="faint">Lets a checkup search the web to check a proposal. It never opens a page.</div></div>
        <label class="switch"><input type="checkbox" data-checkup="webSearch" aria-label="Web search"><span></span></label>
      </div>
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
  $('[data-checkup-when]', box).textContent = `${c.when}. Ask the Chief to change it.`;
}

async function loadCheckup() {
  if (!state.features.includes('checkup')) return;
  try { state.checkup = (await api('/settings/checkup')).checkup; } catch { /* the switches stay as they were, or away */ }
  drawCheckup();
}

// A refused or failed change puts the switch back: it is drawn again from what the server last said.
async function setCheckup(key, value) {
  try { state.checkup = (await api('/settings/checkup', { method: 'PUT', body: { [key]: value } })).checkup; }
  catch (err) { toast(err.message, true); }
  drawCheckup();
}

// The Chief's settings (its figure and name in its chat): its model and reasoning, your rules for it, the
// checkup's switches, its previous chats. Its instructions and tools are botdot's.
function renderChiefSettings() {
  const root = $('#view-chiefsettings');
  if (root.dataset.ready) renderChatList();
  if (!state.settings || root.dataset.ready) return;
  root.dataset.ready = '1';
  const s = state.settings;
  root.innerHTML = `
    <div class="section-head"><div><h1>Settings</h1><p>Changes save by themselves.</p></div></div>
    <form class="card settings-card" id="chief-form" autocomplete="off">
      <h3 class="page-sub" style="margin-top:0">Model and reasoning</h3>
      <p class="muted settings-hint">What the Chief uses to plan, create and manage your bots.</p>
      ${llmFieldsHTML('chief', { model: s.chiefModel, effort: s.chiefEffort }, 'Same as the default')}
      <h3 class="page-sub">Your rules for it</h3>
      <textarea name="chiefRules" rows="4" maxlength="4000" placeholder="e.g. Always ask me before creating a bot. Talk to me like a colleague: short and direct.">${esc(s.chiefRules || '')}</textarea>
    </form>
    <h3 class="page-sub">Skills</h3>
    <div class="card settings-card bs-rows">
      <div class="bs-row" id="chief-skills">
        <span class="bs-icon">✦</span>
        <div class="grow"><b>Your skills for it</b><div class="faint">From your library, beside its own. Only you change them.</div><div id="chief-skill-picks"><span class="faint">Loading…</span></div></div>
        <span class="faint bs-chev">›</span>
      </div>
    </div>${CHECKUP_HTML}
    <h3 class="page-sub">Previous chats</h3>
    <div class="card settings-card settings-links" id="chief-chats"></div>`;
  renderChatList();
  drawChiefSkills(root);
  $$('[data-checkup]', root).forEach((box) => (box.onchange = () => setCheckup(box.dataset.checkup, box.checked)));
  loadCheckup();
  const form = $('#chief-form', root);
  wireLlmFields(form, 'chief');
  form.onsubmit = (e) => e.preventDefault();
  form.onchange = async () => {
    const c = readLlmFields(form, 'chief');
    try {
      const r = await api('/settings', { method: 'PUT', body: { chiefModel: c.model, chiefEffort: c.effort, chiefRules: form.chiefRules.value } });
      state.settings = r.settings;
      toast('Saved. The Chief uses it from its next reply.');
    } catch (err) { toast(err.message, true); }
  };
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
        toast('Saved. The Chief uses it from its next reply.');
      } catch (err) { toast(err.message, true); }
    }, { empty: 'No skills in your library yet.' });
  }).catch(() => { box.innerHTML = '<span class="faint">Couldn\'t load skills.</span>'; });
}

// The pages that open from Settings.
const SETTINGS_PAGES = [
  ['runs', 'Activity', '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>'],
  ['skills', 'Skills', '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>'],
  ['connectors', 'Connectors', '<svg viewBox="0 0 24 24"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/></svg>'],
  ['vault', 'Vault', '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'],
];

// The links to the pages above. Drawn again on every refresh, also while the form below keeps its edits, so that
// "Activity" always names the tasks that the number on the Settings button counts (markMore).
function drawSettingsLinks(root) {
  const box = $('#settings-links', root);
  if (!box) return;
  const running = runningTasks();
  box.innerHTML = SETTINGS_PAGES.map(([view, label, icon]) => `
      <button type="button" class="settings-link" data-go="${view}">${icon}<span class="grow">${label}</span>${view === 'runs' && running ? `<span class="pill accent pulse">${tasksRunning(running)}</span>` : ''}<span class="faint">›</span></button>`).join('');
  $$('[data-go]', box).forEach((b) => (b.onclick = () => setView(b.dataset.go)));
}

function renderSettings() {
  const root = $('#view-settings');
  if (!state.settings) { root.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (root.querySelector('#settings-form')) return drawSettingsLinks(root); // don't wipe unsaved edits on refresh
  const s = state.settings;
  const custom = state.bots.filter((b) => b.model || b.effort);
  root.innerHTML = `
    ${PAGE_BACK}
    <div class="section-head"><div><h1>Settings</h1><p>Defaults for your team. Each bot can override them in its own settings.</p></div></div>
    <div class="card settings-card settings-links" id="settings-links"></div>
    <form id="settings-form" autocomplete="off">
      <div class="card settings-card">
        <h3 class="page-sub" style="margin-top:0">Default model and reasoning</h3>
        <p class="muted settings-hint">Used by every bot that doesn't choose its own. A higher reasoning level thinks longer before answering: better results on hard tasks, but slower.</p>
        ${llmFieldsHTML('default', { model: s.defaultModel, effort: s.defaultEffort })}
        <div class="catalog-line">${catalogLine()} <button type="button" class="link-btn" id="refresh-models">Check for new models</button></div>
      </div>
    </form>
    <div class="card settings-card">
      <h3 class="page-sub" style="margin-top:0">Bots with their own choice</h3>
      ${custom.length
        ? custom.map((b) => `<button type="button" class="settings-bot" data-edit-bot="${esc(b.id)}"><span>${botLabel(b)}</span><span class="muted">${esc(llmSummary(b.model, b.effort))}</span></button>`).join('')
        : '<p class="muted settings-hint" style="margin:0">None: every bot uses the default. Change a bot in its settings (⚙ in its chat).</p>'}
    </div>
    <div class="card settings-card bs-rows" id="install-card" hidden></div>
    ${pushCardHTML()}
    <div class="card settings-card" id="backups-card">
      <h3 class="page-sub" style="margin-top:0">Backups</h3>
      <p class="muted settings-hint" style="margin:0">Checking…</p>
    </div>
    <div class="card settings-card" id="update-card" hidden></div>
    ${signOutCardHTML()}`;
  drawInstallCard();
  loadUpdateCard();
  wirePushCard(root);
  const signOut = $('#sign-out-everywhere', root);
  if (signOut) signOut.onclick = signOutEverywhere;
  drawSettingsLinks(root);
  loadBackupsCard();
  const form = $('#settings-form', root);
  wireLlmFields(form, 'default');
  $('#refresh-models', root).onclick = async (e) => {
    e.target.textContent = 'Checking…';
    try {
      const r = await api('/settings/refresh-models', { method: 'POST' });
      Object.assign(state, { models: r.models, efforts: r.efforts, catalog: r.catalog });
      toast(r.catalog.error ? r.catalog.error : 'Model list is up to date', !!r.catalog.error);
    } catch (err) { toast(err.message, true); }
    root.innerHTML = '';
    renderSettings();
  };
  $$('[data-edit-bot]', root).forEach((b) => (b.onclick = () => setView('botsettings', b.dataset.editBot)));
  // Saves by itself, like a bot's settings.
  form.onsubmit = (e) => e.preventDefault();
  form.onchange = async () => {
    const d = readLlmFields(form, 'default');
    try {
      const r = await api('/settings', { method: 'PUT', body: { defaultModel: d.model, defaultEffort: d.effort } });
      state.settings = r.settings;
      toast('Saved. New runs use it.');
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- installing the app ----------

// Settings → "Install app" (issue #163, install.js): the browser's own install dialog where it offers one (Chrome,
// Edge), the way to do it in Safari, and nothing once botdot is installed or opened as the app.
const INSTALL_HINTS = {
  ios: 'Tap Share, then “Add to Home Screen”.',
  'mac-safari': 'In Safari’s menu: File, then “Add to Dock”.',
};
function drawInstallCard() {
  const card = $('#install-card');
  if (!card) return;
  const how = Install.state(window);
  card.hidden = !how;
  if (!how) { card.innerHTML = ''; return; }
  card.innerHTML = `
      <div class="bs-row">
        <span class="bs-icon">📲</span>
        <div class="grow"><b>Install app</b><div class="faint">${how === 'button' ? 'botdot in its own window, with its own icon.' : esc(INSTALL_HINTS[how])}</div></div>
        ${how === 'button' ? '<button type="button" class="btn sm" id="install-app">Install</button>' : ''}
      </div>`;
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
  const head = '<h3 class="page-sub" style="margin-top:0">Notifications on this device</h3>';
  if (Push.needsHomeScreen(navigator)) {
    return `<div class="card settings-card" id="push-card">${head}
      <p class="muted settings-hint" style="margin:0">Add to Home Screen first: tap Share, then “Add to Home Screen”, and open botdot from there. Then turn this on in its Settings.</p></div>`;
  }
  if (!Push.supported(window)) {
    return `<div class="card settings-card" id="push-card">${head}
      <p class="muted settings-hint" style="margin:0">This browser can't show botdot's notifications.</p></div>`;
  }
  return `<div class="card settings-card bs-rows" id="push-card">
      <div class="bs-row">
        <span class="bs-icon">🔔</span>
        <div class="grow"><b>Notifications on this device</b><div class="faint">Replies, and what needs you, as the phone app shows them.</div></div>
        <label class="switch"><input type="checkbox" id="push-on" disabled aria-label="Notifications on this device"><span></span></label>
      </div>
    </div>`;
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
      toast(on ? 'Notifications are on for this device.' : 'Notifications are off for this device.');
    } catch (err) {
      toast(err.message || "Couldn't change notifications.", true);
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
// says this account chooses (its session's `updates`): not on a machine of one account, nor for the admin's account.
async function loadUpdateCard() {
  if (!state.features.includes('accounts')) return;
  let u = null;
  try {
    const session = await fetch('/front-door/session').then((r) => (r.ok ? r.json() : null));
    if (session?.updates === true) u = await fetch('/front-door/update').then((r) => (r.ok ? r.json() : null));
  } catch { /* nothing to show */ }
  drawUpdateCard(u);
}

function updateCardText(u) {
  const day = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  if (u.asked || u.last?.state === 'switching') return 'Moving to the new version. Your bots restart in a minute or two.';
  if (u.ready) return `A new version${u.ready.version ? ` (${u.ready.version})` : ''} is ready. Your account moves to it by itself on ${day(u.ready.deadline)}, or now if you choose.`;
  if (u.last && (u.last.state === 'kept' || u.last.state === 'failed')) return `The last move to a new version didn't happen: ${u.last.error || 'the admin can see why'}.`;
  return u.autoUpdate ? 'Your account moves to each new version when the admin updates botdot.' : 'Your account is on the newest version the admin installed.';
}

function drawUpdateCard(u) {
  const card = $('#update-card');
  if (!card) return;
  card.hidden = !u;
  if (!u) { card.innerHTML = ''; return; }
  card.innerHTML = `
      <h3 class="page-sub" style="margin-top:0">Updates</h3>
      <div class="bs-rows"><div class="bs-row">
        <div class="grow"><b>Update automatically</b><div class="faint">Off: when the admin updates, your bots keep working on the version they run until you choose, up to a deadline the admin sets.</div></div>
        <label class="switch"><input type="checkbox" id="auto-update" aria-label="Update automatically"${u.autoUpdate ? ' checked' : ''}><span></span></label>
      </div></div>
      <p class="muted settings-hint" id="update-said">${esc(updateCardText(u))}</p>
      ${u.canUpdate ? '<button type="button" class="btn" id="update-now">Update now</button>' : ''}`;
  const box = $('#auto-update', card);
  box.onchange = async () => {
    box.disabled = true;
    try { drawUpdateCard(await frontDoorPost('/front-door/update', { autoUpdate: box.checked })); toast(box.checked ? 'Your account updates automatically.' : 'You choose when your account updates.'); } catch (err) {
      toast(err.message, true);
      box.checked = !box.checked;
      box.disabled = false;
    }
  };
  const now = $('#update-now', card);
  if (now) now.onclick = async () => {
    if (!confirm('Update now? Your account moves to the new version: your bots restart, and work still running stops.')) return;
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
  try { res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify(body) }); } catch { throw new Error("Can't reach botdot."); }
  const data = await res.json().catch(() => ({}));
  // A session that ended signs in again, as every other call does.
  if (res.status === 401) { location.assign('/sign-in'); throw new Error('Sign in first.'); }
  if (!res.ok) throw new Error(typeof data.error === 'string' && data.error.trim() ? data.error : `botdot answered ${res.status}`);
  return data;
}

// ---------- signing out everywhere ----------

// Settings → "Sign out everywhere" (ADR 028): the front door ends every session of the account, in every browser
// and app, this one too, and the page opens its sign-in. Only behind a front door (`accounts` in features).
const signOutCardHTML = () => (state.features.includes('accounts') ? `
    <div class="card settings-card" id="sign-out-card">
      <h3 class="page-sub" style="margin-top:0">Sign-ins</h3>
      <p class="muted settings-hint">Signs out this browser and every browser and app signed in to your account. Each signs in again with your passkey.</p>
      <button type="button" class="btn" id="sign-out-everywhere">Sign out everywhere</button>
    </div>` : '');

async function signOutEverywhere() {
  if (!confirm('Sign out everywhere? Every browser and app signed in to your account, this one too, signs in again with your passkey.')) return;
  let res;
  // The front door's own route, not botdot's: no botdot server, and so no Chief or bot, reaches a session.
  try { res = await fetch('/sign-out-everywhere', { method: 'POST', headers: { 'X-Bot-Dot': '1' } }); } catch { toast("Can't reach botdot.", true); return; }
  if (res.ok || res.status === 401) { location.assign('/sign-in'); return; }
  const data = await res.json().catch(() => ({}));
  toast(typeof data.error === 'string' && data.error.trim() ? data.error : `Couldn't sign out (${res.status}).`, true);
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
}

// ---------- feedback ----------

// Beside Settings (#216, ADR 048): a bug or a feature request for the admin of this machine, who reads it on the admin
// page. It goes to the front door, never to botdot, and holds only what is typed and added here: since #223 (ADR 048)
// up to three screenshots, when the front door says it takes them. A failed send keeps the text and the screenshots.
const FEEDBACK_KINDS = [['bug', 'Bug'], ['feature', 'Feature request']];
const FEEDBACK_SHOTS = { max: 3, bytes: 5 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] };
let feedbackShots = false; // whether the front door takes screenshots (its session's feedbackScreenshots)
function openFeedback() {
  const m = openModal(`
    <form id="feedback-form" autocomplete="off">
      <div class="modal-head"><h2>Feedback</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${feedbackShots ? 'The admin of this machine reads it and sees each screenshot whole, as it is. Only what you write and add here is sent.' : 'The admin of this machine reads it. Only what you write here is sent.'}</p>
        <div class="feedback-kinds">${FEEDBACK_KINDS.map(([v, label], i) => `<label><input type="radio" name="kind" value="${v}"${i ? '' : ' checked'}> ${label}</label>`).join('')}</div>
        <label class="field">What happened, or what you would like<textarea name="text" rows="6" required></textarea></label>
        ${feedbackShots ? `<div class="feedback-shots hidden" id="feedback-shots"></div>
        <div><button type="button" class="btn sm" id="feedback-add">Add screenshot</button><input type="file" id="feedback-file" accept="${FEEDBACK_SHOTS.types.join(',')}" multiple hidden></div>` : ''}
        <p class="req-note hidden" id="feedback-said" role="alert"></p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" id="feedback-send">Send</button>
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
    if (m._shots.length >= FEEDBACK_SHOTS.max) { refused.push(`At most ${FEEDBACK_SHOTS.max} screenshots go in one report.`); break; }
    if (!FEEDBACK_SHOTS.types.includes(file.type)) refused.push(`${file.name} isn't a PNG, JPEG or WebP picture.`);
    else if (file.size > FEEDBACK_SHOTS.bytes) refused.push(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB: each screenshot can be at most 5 MB.`);
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
  box.innerHTML = m._shots.map((s, i) => `<span class="feedback-shot"><img src="${esc(s.url)}" alt="Screenshot ${i + 1}"><button type="button" data-unshot="${i}" aria-label="Remove screenshot ${i + 1}" title="Remove">×</button></span>`).join('');
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
  const kept = m._shots?.length ? 'Your text and screenshots are still here.' : 'Your text is still here.';
  const fail = (text) => { if (!shown()) return toast(text, true); said.textContent = text; said.classList.remove('hidden'); };
  go.disabled = true;
  said.classList.add('hidden');
  try {
    const body = { kind: f.kind.value, text: f.text.value };
    if (m._shots?.length) {
      try { body.screenshots = await Promise.all(m._shots.map(async (s) => ({ data: await fileBase64(s.file) }))); } catch { return fail(`Couldn't read a screenshot. Remove it and add it again.`); }
    }
    let res;
    try {
      res = await fetch('/front-door/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify(body) });
    } catch { return fail(`Couldn't send: can't reach botdot. ${kept}`); }
    if (res.ok) { if (shown()) m.close(); toast('Sent'); return; }
    const data = await res.json().catch(() => ({}));
    fail(typeof data.error === 'string' && data.error.trim() ? data.error : `Couldn't send (${res.status}). ${kept}`);
  } finally { go.disabled = false; }
}

// ---------- backups ----------

// Settings → Backups (lib/backup.js): nightly, encrypted with your passphrase, the last few kept.
async function loadBackupsCard() {
  const card = $('#backups-card');
  if (!card) return;
  let b;
  try { b = await api('/backups'); } catch (e) { card.querySelector('p').textContent = e.message; return; }
  const head = '<h3 class="page-sub" style="margin-top:0">Backups</h3>';
  if (!b.configured) {
    card.innerHTML = `${head}
      <p class="muted settings-hint">Set a passphrase and botdot backs up every night. Keep it safe, e.g. in Bitwarden: without it a backup can't be opened.</p>
      <form id="backup-pass" class="backup-pass" autocomplete="off">
        <input type="password" name="p1" placeholder="Passphrase" minlength="8" required autocomplete="new-password">
        <input type="password" name="p2" placeholder="Again" minlength="8" required autocomplete="new-password">
        <button class="btn primary sm">Turn on</button>
      </form>`;
    $('#backup-pass', card).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.p1.value !== f.p2.value) return toast("The two don't match", true);
      try { await api('/backups/passphrase', { method: 'PUT', body: { passphrase: f.p1.value } }); f.reset(); toast('Backups are on'); await api('/backups/now', { method: 'POST' }); } catch (err) { toast(err.message, true); }
      loadBackupsCard();
    };
    return;
  }
  const last = b.last ? `Last backup ${esc(ago(b.last.at))} · ${b.count} kept` : 'No backup yet';
  card.innerHTML = `${head}
    <p class="muted settings-hint" style="margin:0">${b.running ? 'Backing up…' : last}. Every night at 03:00.</p>
    ${b.error ? `<div class="req-note">${esc(b.error)}</div>` : ''}
    <div class="backup-actions">
      <button class="btn sm" id="backup-now" ${b.running ? 'disabled' : ''}>Back up now</button>
      ${b.last ? `<a class="btn sm" href="/api/backups/${encodeURIComponent(b.last.name)}" download>Download</a>` : ''}
      <button class="link-btn" id="backup-change">Change passphrase</button>
    </div>`;
  $('#backup-now', card).onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Backing up…';
    try { await api('/backups/now', { method: 'POST' }); toast('Backed up'); } catch (err) { toast(err.message, true); }
    loadBackupsCard();
  };
  $('#backup-change', card).onclick = async () => {
    const p = prompt('New backup passphrase (at least 8 characters). Older backups still need the old one.');
    if (!p) return;
    try { await api('/backups/passphrase', { method: 'PUT', body: { passphrase: p } }); toast('Passphrase changed. The next backups use it.'); } catch (err) { toast(err.message, true); }
  };
}

// Setup → Restore a backup: upload it, check the passphrase, and botdot restarts with it.
function openRestoreDialog() {
  const m = openModal(`
    <form id="restore-form" autocomplete="off">
      <div class="modal-head"><h2>Restore a backup</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">Your bots, chats, memory, vault and settings come back. Afterwards, sign in to Claude (and Bitwarden) again. What's here now is kept aside, not deleted.</p>
        <label class="field">Backup file<input type="file" name="file" accept=".bdb" required></label>
        <label class="field">Its passphrase<input type="password" name="passphrase" required autocomplete="off"></label>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" id="restore-go">Restore</button>
      </div>
    </form>`);
  $('#restore-form', m).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const go = $('#restore-go', m);
    go.disabled = true;
    try {
      go.textContent = 'Uploading…';
      const up = await fetch('/api/backups/upload', { method: 'POST', headers: { 'X-Bot-Dot': '1', 'Content-Type': 'application/octet-stream' }, body: f.file.files[0] }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; });
      go.textContent = 'Checking…';
      const r = await api('/backups/restore', { method: 'POST', body: { file: up.file, passphrase: f.passphrase.value } });
      f.passphrase.value = '';
      go.textContent = 'Restarting…';
      toast(`Restoring ${r.bots} bot${r.bots === 1 ? '' : 's'} from ${new Date(r.createdAt).toLocaleString()}. botdot restarts.`);
      // Back up again: reload then (to the setup page, to sign in to Claude).
      const wait = setInterval(async () => { try { await api('/version'); clearInterval(wait); location.reload(); } catch { /* still restarting */ } }, 2000);
    } catch (err) { toast(err.message, true); go.disabled = false; go.textContent = 'Restore'; }
  };
}
