// ---------- setup ----------

// A checklist of what botdot needs: Claude (required), then the bots' computers, your phone, the
// time zone, and optional extras. Shown on first start and while Claude isn't signed in; also at its
// address, #setup. Signing in to Claude again later is in Settings → Claude.
const deviceTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

async function renderSetup(fresh = false) {
  const root = $('#view-setup');
  if (root.dataset.ready && !fresh) return;
  root.dataset.ready = '1';
  if (!state.setup || fresh) {
    if (!state.setup) root.innerHTML = `<div class="empty">${tr('Checking…')}</div>`;
    try { state.setup = await api(`/setup${fresh ? '?fresh' : ''}`); } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  drawSetup();
}

function setupItem({ state: st, icon, title, body, action = '' }) {
  const mark = st === 'ok' ? '✓' : st === 'todo' ? '!' : st === 'off' ? '–' : '·';
  return `<div class="card setup-item ${st}">
    <div class="setup-mark">${mark}</div>
    <div class="setup-body"><h3>${icon} ${title}</h3><div class="muted">${body}</div>${action ? `<div class="setup-actions">${action}</div>` : ''}</div>
  </div>`;
}

// The setup checklist's `claude` when the server could not ask Claude Code or could not read its answer: its
// `error`, a sentence. The sign-in is unknown then, never "not signed in" (docs/api.md, GET /api/setup).
const claudeUnknown = (c) => (c && c.error ? String(c.error) : '');
// Claude on an Anthropic API key as well as the subscription (#35; docs/api.md, Setup and updates). `using` says
// which one bots run on; a server that does not say has no key, and nothing of one is drawn.
const claudeHasKeys = (c) => !!c && c.installed !== false && (c.using === 'api-key' || c.using === 'subscription' || c.using === 'provider');
// On the key: the sentence that says so, and names a subscription that is signed in too as not used.
const claudeOnKey = (c) => `${tr('Bots run on your Anthropic API key {key}.', { key: `<b>${esc(c.apiKey || '')}</b>` })}${c.subscription === true ? ` ${c.email ? tr("Your Claude subscription ({email}) is signed in too; bots don't use it.", { email: `<b>${esc(c.email)}</b>` }) : tr("Your Claude subscription is signed in too; bots don't use it.")}` : ''}`;
// On the subscription: a saved key, named as not used.
const claudeKeyNote = (c) => (claudeHasKeys(c) && c.apiKey ? ` ${tr("An Anthropic API key ({key}) is saved too; bots don't use it.", { key: `<b>${esc(c.apiKey)}</b>` })}` : '');
// Another model provider (ADR 255). On it: the sentence that says so, and names a subscription that is signed in too as not used.
const claudeOnProvider = (c) => `${c.provider.key ? tr('Bots run on {name} ({key}).', { name: esc(c.provider.name), key: `<b>${esc(c.provider.key)}</b>` }) : tr('Bots run on {name}.', { name: esc(c.provider.name) })}${c.subscription === true ? ` ${c.email ? tr("Your Claude subscription ({email}) is signed in too; bots don't use it.", { email: `<b>${esc(c.email)}</b>` }) : tr("Your Claude subscription is signed in too; bots don't use it.")}` : ''}`;
// Not on it: a saved provider, named as not used.
const claudeProviderNote = (c) => (c.using !== 'provider' && c.provider ? ` ${tr("{name} is saved too; bots don't use it.", { name: esc(c.provider.name) })}` : '');
// What is said of how bots run, on a key or on a provider, or null for the subscription.
const claudeOnOwn = (c) => (c.using === 'api-key' ? claudeOnKey(c) : c.using === 'provider' && c.provider ? claudeOnProvider(c) : null);
// The key's links, none while signing in or while the key box is open (busy).
function claudeKeyActions(c, busy) {
  const here = typeof state === 'undefined' ? {} : state; // the page's state, where the page has one
  if (busy || here.setupProvider || !claudeHasKeys(c)) return [];
  const link = (id, text) => `<button class="link-btn" id="${id}">${text}</button>`;
  const sub = c.subscription === true ? [link('claude-use-sub', tr('Use the subscription instead'))] : [];
  const offered = !!(here.setup?.providers?.length || c.provider);
  const other = !offered ? []
    : c.using === 'provider' ? [link('claude-provider-new', tr('Change provider')), link('claude-provider-remove', tr('Remove the provider'))]
    : c.provider ? [link('claude-use-provider', tr('Use {name} instead', { name: esc(c.provider.name) }))]
    : [link('claude-provider-new', tr('Use another provider'))];
  if (c.using === 'api-key') return [...sub, link('claude-key-remove', tr('Remove the key')), ...other];
  if (c.using === 'provider') return [...sub, ...(c.apiKey ? [link('claude-use-key', tr('Use the API key instead'))] : []), ...other];
  return [c.apiKey ? link('claude-use-key', tr('Use the API key instead')) : link('claude-key-new', tr('Use an API key instead')), ...other];
}
// Where the key is pasted: a password field, so it is never shown. inCard: in Settings → Claude.
const claudeKeyBox = (inCard) => `<div class="${inCard ? 'setup-login" style="padding:0;margin:12px 0 0' : 'card setup-login'}">
      <form id="claude-key-form" class="setup-code"><input type="password" name="key" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false" required><button class="btn primary" type="submit">${tr('Save')}</button></form>
      <p class="muted settings-hint">${tr('Make one in the Claude Console (console.anthropic.com → API keys). botdot checks it with Anthropic, keeps it encrypted and never shows it again.')}</p>
      <button class="link-btn muted" id="claude-key-cancel">${tr('Cancel')}</button>
    </div>`;
// The same provider form in Setup and Settings → Claude.
const claudeProviderBox = (inCard) => {
  const presets = state.setup?.providers || [];
  const saved = state.setup?.claude?.provider?.preset;
  const id = inCard ? 'settings-provider' : 'setup-provider';
  return `<div class="${inCard ? 'setup-login' : 'card setup-login'}">
      <form id="claude-provider-form" class="setup-provider">
        <div class="field"><label for="${id}-preset">${tr('Provider')}</label><select name="preset" id="${id}-preset">${presets.map((p) => `<option value="${esc(p.id)}"${p.id === saved ? ' selected' : ''}>${esc(p.id === 'custom' ? tr('Other') : p.name)}</option>`).join('')}</select></div>
        <label class="field" data-provider-address hidden><span>${tr('Server address')}</span><input type="url" name="url" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <label class="field" data-provider-key><span>${tr('API key')}</span><input type="password" name="key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <div class="provider-roles" hidden>
          <div class="field"><span id="${id}-main">${tr('Main model')}</span>
            <button class="btn provider-main" type="button" data-model-role="main" aria-labelledby="${id}-main ${id}-value" aria-expanded="false" aria-controls="${id}-menu"><span id="${id}-value" data-main-name></span><span class="provider-chevron" aria-hidden="true"></span></button>
          </div>
          <div class="provider-helper">
            <div class="field"><span>${tr('Helper model')}</span><span data-helper-name></span></div>
            <button class="link-btn" type="button" data-model-role="helper" aria-label="${tr('Change helper model')}" aria-expanded="false" aria-controls="${id}-menu">${tr('Change')}</button>
          </div>
          <div class="provider-catalog" id="${id}-menu" hidden>
            <input type="search" role="combobox" aria-label="${tr('Search models')}" placeholder="${tr('Search models')}" aria-autocomplete="list" aria-controls="${id}-choices" aria-expanded="true" autocomplete="off">
            <div class="provider-choices" id="${id}-choices" role="listbox"></div>
            <p class="muted" data-model-empty role="status" hidden>${tr('No models match your search.')}</p>
          </div>
        </div>
        <p class="muted" data-provider-status role="status" hidden></p>
        <div class="provider-actions">
          <button class="link-btn muted" type="button" id="claude-provider-cancel">${tr('Cancel')}</button>
          <button class="btn primary" type="submit" data-provider-submit>${tr('Load models')}</button>
        </div>
      </form>
    </div>`;
};

function wireProviderForm(form, claude, save) {
  const presets = state.setup.providers;
  const address = $('[data-provider-address]', form);
  const key = $('[data-provider-key]', form);
  const roles = $('.provider-roles', form);
  const menu = $('.provider-catalog', form);
  const search = $('input', menu);
  const list = $('[role=listbox]', menu);
  const empty = $('[data-model-empty]', menu);
  const status = $('[data-provider-status]', form);
  const submit = $('[data-provider-submit]', form);
  const buttons = [...form.querySelectorAll('[data-model-role]')];
  $('.provider-chevron', form).innerHTML = ICON.back;
  const selectedPreset = () => presets.find((item) => item.id === form.preset.value);
  const supportsCatalog = state.features?.includes('provider-model-catalog');
  const saved = claude.provider;
  const reusesKey = () => supportsCatalog && !form.key.value.trim() && saved?.key && saved.preset === form.preset.value
    && (!selectedPreset().askUrl || form.url.value.trim().replace(/\/+$/, '') === saved.url);
  let catalog = null;
  let models = { main: '', helper: '' };
  let role = '';
  let visible = [];
  let active = -1;
  let pending = false;
  let saving = false;
  let revision = 0;

  const name = (id) => catalog?.models.find((item) => item.id === id)?.label || id;
  const ready = () => !!catalog?.models.length;
  function sync() {
    const p = selectedPreset();
    roles.hidden = !ready();
    $('[data-main-name]', form).textContent = name(models.main) || tr('Choose a model');
    $('[data-helper-name]', form).textContent = name(models.helper) || tr('Same as main model');
    const use = p.custom ? tr('Use this provider') : tr('Use {name}', { name: p.name });
    submit.textContent = saving ? tr('Checking…') : ready() ? use : tr('Load models');
    form.key.placeholder = reusesKey() ? tr('Saved key {key}', { key: saved.key }) : '';
    $('#claude-provider-cancel', form).disabled = saving;
    submit.disabled = pending || saving || (ready() ? !models.main
      : (!p.keyless && !form.key.value.trim() && !reusesKey()) || (p.askUrl && !form.url.value.trim()));
  }
  function say(message = '') {
    status.textContent = message;
    status.hidden = !message;
  }
  function dismiss(focus = false) {
    const current = buttons.find((button) => button.dataset.modelRole === role);
    current?.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    role = '';
    if (focus) current?.focus();
  }
  function filter() {
    const words = search.value.toLowerCase().trim().split(/[\s._:/-]+/).filter(Boolean);
    const choices = role === 'helper' ? [{ id: '', label: tr('Same as main model') }, ...catalog.models] : catalog.models;
    visible = choices.filter(({ id, label }) => words.every((word) => (label + ' ' + id).toLowerCase().includes(word)));
    active = -1;
    search.removeAttribute('aria-activedescendant');
    list.setAttribute('aria-label', role === 'main' ? tr('Main model') : tr('Helper model'));
    list.innerHTML = visible.map(({ id, label }, index) => `<div class="provider-option" id="${list.id}-${index}" role="option" data-index="${index}" aria-selected="${id === models[role]}"><span>${esc(label)}</span>${id === models[role] ? `<span aria-hidden="true">${ICON.copied}</span>` : ''}</div>`).join('');
    list.scrollTop = 0;
    empty.hidden = visible.length > 0;
  }
  function choose(index) {
    if (!visible[index]) return;
    models[role] = visible[index].id;
    dismiss(true);
    sync();
  }
  buttons.forEach((button) => {
    button.onclick = () => {
      if (saving) return;
      const next = button.dataset.modelRole;
      const wasOpen = role === next;
      dismiss();
      if (wasOpen) return;
      role = next;
      button.setAttribute('aria-expanded', 'true');
      button.parentElement.after(menu);
      menu.hidden = false;
      search.value = '';
      filter();
      search.focus();
    };
  });
  search.oninput = filter;
  search.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); dismiss(true); }
    if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 || visible.length === 1) choose(Math.max(0, active)); }
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    if (!visible.length) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    list.children[active]?.classList.remove('active');
    active = active < 0 ? (step > 0 ? 0 : visible.length - 1) : (active + step + visible.length) % visible.length;
    const option = list.children[active];
    option.classList.add('active');
    search.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  };
  list.onclick = (event) => {
    const option = event.target.closest('[data-index]');
    if (option) choose(Number(option.dataset.index));
  };
  function reset() {
    revision++;
    pending = false;
    catalog = null;
    dismiss();
    say();
    sync();
  }
  function fit() {
    const p = selectedPreset();
    address.hidden = !p.askUrl;
    form.url.required = !!p.askUrl;
    form.url.placeholder = p.url || 'https://…';
    key.hidden = !!p.keyless;
    form.key.required = !p.keyless && !supportsCatalog;
    if (p.askUrl && p.id === saved?.preset && saved.url) form.url.value = saved.url;
    reset();
  }
  form.preset.onchange = () => { form.url.value = ''; form.key.value = ''; fit(); };
  form.url.oninput = form.key.oninput = reset;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const p = selectedPreset();
    const body = { preset: p.id, key: form.key.value };
    if (p.askUrl) body.url = form.url.value;
    if (reusesKey()) body.reuseKey = true;
    if (ready()) {
      saving = true;
      form.preset.disabled = form.key.disabled = form.url.disabled = true;
      sync();
      await save({ ...body, big: models.main, small: models.helper || models.main });
      if (!form.isConnected) return;
      form.preset.disabled = form.key.disabled = form.url.disabled = false;
      saving = false;
      sync();
      return;
    }
    const request = ++revision;
    pending = true;
    say(tr('Loading models…'));
    sync();
    try {
      let result;
      if (supportsCatalog) result = await api('/setup/claude/provider/models', { method: 'POST', body });
      else {
        const previous = saved?.preset === p.id && (!saved.url || saved.url === form.url.value.trim().replace(/\/+$/, '')) ? saved : null;
        result = { main: previous?.big || p.big, helper: previous?.small || p.small,
          models: [...new Set([previous?.big, previous?.small, p.big, p.small].filter(Boolean))].map((id) => ({ id, label: id })) };
      }
      if (request !== revision || !form.isConnected) return;
      catalog = result;
      models = { main: result.main || '', helper: result.helper || '' };
      say(result.limited ? tr('Model list unavailable. Showing known models.')
        : ready() ? '' : tr('No models available from this provider.'));
    } catch (error) {
      if (request === revision && form.isConnected) say(error.message);
    } finally {
      if (request === revision && form.isConnected) {
        pending = false;
        sync();
        if (ready()) {
          if (!models.main) buttons[0].click();
          else buttons[0].focus();
        }
      }
    }
  };
  fit();
}

// The key's links and box in root, for Setup and Settings → Claude; redraw draws root again from state.setup.
function wireClaudeKey(root, c, redraw) {
  const on = (sel, fn) => { const el = $(sel, root); if (el) el.onclick = fn; };
  const ask = async (call, said, keepOpen = false) => {
    try {
      const r = await call();
      state.setupKey = false;
      state.setupProvider = false;
      state.setup.claude = r.claude;
      if (state.modelProvider || r.claude.using === 'provider') {
        const cfg = await api('/settings').catch(() => null);
        if (cfg) {
          Object.assign(state, { settings: cfg.settings, models: cfg.models, efforts: cfg.efforts, catalog: cfg.catalog, modelProvider: cfg.provider });
          const settings = $('#view-settings');
          if (settings) {
            settings.innerHTML = '';
            if (panelPage() === 'settings') renderSettings();
          }
        }
      }
      toastClaude(r.claude, said);
    } catch (err) { toast(err.message, true); if (keepOpen) return; }
    redraw();
  };
  on('#claude-key-new', () => { state.setupKey = true; state.setupProvider = false; redraw(); });
  on('#claude-key-cancel', () => { state.setupKey = false; redraw(); });
  on('#claude-provider-new', () => { state.setupProvider = true; state.setupKey = false; redraw(); });
  on('#claude-provider-cancel', () => { state.setupProvider = false; redraw(); });
  on('#claude-use-provider', () => ask(() => api('/setup/claude/use', { method: 'PUT', body: { use: 'provider' } }), tr('Bots now run on {name}', { name: c.provider?.name || '' })));
  on('#claude-provider-remove', async () => {
    if (!(await askFirst(c.subscription === true ? tr('Remove the provider? Bots will run on your Claude subscription.') : tr("Remove the provider? Bots can't run until you sign in to Claude or save a key again."), tr('Remove')))) return;
    ask(() => api('/setup/claude/provider', { method: 'DELETE' }), tr('Provider removed'));
  });
  on('#claude-use-key', () => ask(() => api('/setup/claude/use', { method: 'PUT', body: { use: 'api-key' } }), tr('Bots now run on your API key')));
  on('#claude-use-sub', () => ask(() => api('/setup/claude/use', { method: 'PUT', body: { use: 'subscription' } }), tr('Bots now run on your Claude subscription')));
  on('#claude-key-remove', async () => {
    if (!(await askFirst(c.subscription === true ? tr('Remove the API key? Bots will run on your Claude subscription.') : tr("Remove the API key? Bots can't run until you sign in to Claude or save a key again."), tr('Remove')))) return;
    ask(() => api('/setup/claude/key', { method: 'DELETE' }), tr('API key removed'));
  });
  const pform = $('#claude-provider-form', root);
  if (pform) wireProviderForm(pform, c, (body) => ask(
    () => api('/setup/claude/provider', { method: 'PUT', body }), tr('Saved. Bots now run on it'), true,
  ));
  const form = $('#claude-key-form', root);
  if (form) {
    form.key.focus();
    form.onsubmit = (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = tr('Checking…');
      ask(() => api('/setup/claude/key', { method: 'PUT', body: { key: form.key.value } }), tr('Saved. Bots now run on your API key'));
    };
  }
}
// First start, or Claude is known not to be signed in: the page opens on Setup. Not for a check that could not tell.
const opensSetup = (s) => !!s && (!s.done || (!s.claude?.loggedIn && !claudeUnknown(s.claude)));
// Setup's Claude item: signed in, a check that could not tell (its sentence, and the way to sign in stays), or the step to do.
// keyOpen: the API key's box is open.
function claudeSetupItem(c, signingIn, keyOpen = false) {
  const signIn = c.installed === false || signingIn ? '' : `<button class="btn primary" id="claude-login">${tr('Sign in to Claude')}</button>`;
  const keys = claudeKeyActions(c, signingIn || keyOpen);
  const links = (list) => list.join(' · ');
  if (claudeUnknown(c)) return setupItem({ state: 'todo', icon: '✳︎', title: 'Claude', body: esc(claudeUnknown(c)), action: [signIn, links(keys)].filter(Boolean).join(' ') });
  if (claudeOnOwn(c)) return setupItem({ state: 'ok', icon: '✳︎', title: 'Claude', body: claudeOnOwn(c), action: links(keys) });
  return c.loggedIn
    ? setupItem({
      state: 'ok', icon: '✳︎', title: 'Claude',
      body: (c.fromEnv ? tr("Signed in with a token from the server's settings.") : c.email ? tr('Signed in with {email}.', { email: `<b>${esc(c.email)}</b>` }) : tr('Signed in.')) + claudeKeyNote(c) + claudeProviderNote(c),
      action: links([...(c.fromEnv ? [] : [`<button class="link-btn" id="claude-switch">${tr('Use another account')}</button>`, `<button class="link-btn" id="claude-logout">${tr('Sign out')}</button>`]), ...keys]),
    })
    : setupItem({
      state: 'todo', icon: '✳︎', title: tr('Sign in to Claude'),
      body: c.installed === false ? tr("Claude Code isn't installed on this machine, so bots can't run.") : `${tr('Your bots run on your Claude subscription. Sign in once; it stays signed in.')}${claudeHasKeys(c) ? ` ${tr('Or run them on an Anthropic API key.')}` : ''}${claudeKeyNote(c)}${claudeProviderNote(c)}`,
      action: [signIn, links(keys)].filter(Boolean).join(' '),
    });
}
// What the page says after a sign-in or a sign-out, from the status the server answered: its own sentence when
// that check could not tell.
function toastClaude(c, said) {
  if (claudeUnknown(c)) toast(claudeUnknown(c), true); else toast(said);
}

function drawSetup() {
  const root = $('#view-setup');
  const s = state.setup;
  const c = s.claude || {};
  const a = s.access || {};
  const dev = deviceTimezone();
  const now = new Date().toLocaleTimeString(I18n.locale, { timeZone: s.timezone, hour: '2-digit', minute: '2-digit' });
  const signingIn = !!state.setupLogin;

  const unknown = !!claudeUnknown(c);
  const keyOpen = !!state.setupKey && !signingIn;
  const claude = claudeSetupItem(c, signingIn, keyOpen) + (keyOpen ? claudeKeyBox(false) : '') + (state.setupProvider && !signingIn ? claudeProviderBox(false) : '');
  const loginBox = signingIn ? `<div class="card setup-login">
      <ol>
        <li><a class="btn primary" href="${esc(state.setupLogin.url)}" target="_blank" rel="noopener">${tr('Open the sign-in page')}</a><span class="muted">${tr('Sign in, allow access, and copy the code it shows.')}</span></li>
        <li><form id="claude-code-form" class="setup-code"><input type="text" name="code" placeholder="${tr('Paste the code here')}" autocomplete="off" autocapitalize="off" spellcheck="false" required><button class="btn primary" type="submit">${tr('Sign in')}</button></form></li>
      </ol>
      <button class="link-btn muted" id="claude-cancel">${tr('Cancel')}</button>
    </div>` : '';

  const computers = !s.docker?.ok
    ? setupItem({ state: 'off', icon: '🖥', title: tr('Bot computers'), body: tr("{why}, so bots can't have their own desktop. Everything else works.", { why: esc(s.docker?.error || tr('Docker is not available')) }) })
    : setupItem({ state: 'ok', icon: '🖥', title: tr('Bot computers'), body: s.docker.image ? tr('Ready. Any bot can get its own desktop with a browser (turn it on in the bot’s settings).') : tr('Ready. The desktop downloads the first time a bot needs one, which takes a few minutes once.') });

  // Without Advanced (ADR 205): the phone is a QR code to scan, and nothing about Tailscale, Docker or the extras.
  const adv = advanced();
  const scan = a.qr ? `<div class="setup-qr">${a.qr}</div>` : '';
  let phone;
  if (!adv && a.qr) {
    phone = setupItem({ state: 'ok', icon: '📱', title: tr('Your phone'), body: `${tr('Scan this with your phone, open it, and choose <b>Add to Home Screen</b>.')}${scan}` });
  } else if (!adv) {
    phone = setupItem({ state: 'off', icon: '📱', title: tr('Your phone'), body: tr('botdot opens only on this computer for now. Whoever set up botdot can make it reach your phone.') });
  } else if (a.tailnet) {
    phone = setupItem({
      state: 'ok', icon: '📱', title: tr('Your phone'),
      body: tr('Private on your tailnet at {address}, and only your passkey signs in to your account.<br>On your phone, open it and choose <b>Add to Home Screen</b> to use it like an app.', { address: `<b>https://${esc(a.host)}</b>` }),
    });
  } else if (a.public) {
    phone = setupItem({ state: 'ok', icon: '📱', title: tr('Your phone'), body: tr('Open {address} on your phone and choose <b>Add to Home Screen</b>.', { address: `<b>https://${esc(a.public)}</b>` }) });
  } else if (a.tailnetHost) {
    phone = setupItem({ state: 'ok', icon: '📱', title: tr('Your phone'), body: tr('Also private on your tailnet at {address}. Open it on your phone and choose <b>Add to Home Screen</b>.', { address: `<b>https://${esc(a.tailnetHost)}</b>` }) });
  } else {
    phone = setupItem({
      state: 'off', icon: '📱', title: tr('Your phone'),
      body: a.docker ? tr('botdot only opens on this machine for now. To use it from your phone, privately, run the installer again: it sets up Tailscale for you.')
        : tr('botdot only opens on this machine for now. To use it from your phone, privately, install {tailscale}, then run {command} and add the address it shows to {setting}.', { tailscale: '<a href="https://tailscale.com/download" target="_blank" rel="noopener">Tailscale</a>', command: `<span class="mono">tailscale serve --bg ${esc(a.port)}</span>`, setting: '<span class="mono">BOT_DOT_ALLOWED_HOSTS</span>' }),
    });
  }

  const tz = setupItem({
    state: 'ok', icon: '🕒', title: tr('Time zone'),
    body: `${tr("Schedules run on {zone} time (it's {time} there).", { zone: `<b>${esc(s.timezone)}</b>`, time: esc(now) })}${dev && dev !== s.timezone ? ` ${tr('Your device is on {zone}.', { zone: esc(dev) })}` : ''}`,
    action: dev && dev !== s.timezone ? `<button class="btn sm" id="tz-use">${tr('Use {zone}', { zone: esc(dev) })}</button>` : '',
  });

  const bw = s.bitwarden || {};
  const extras = [
    setupItem({ state: bw.configured ? 'ok' : 'off', icon: '🛡', title: 'Bitwarden', body: bw.configured ? (bw.unlocked ? tr('Connected. Bots use its logins and cards without seeing them.') : tr('Connected, locked: unlock it when botdot asks. Bots use its logins and cards without seeing them.')) : tr('Let bots use your logins, cards and identities without ever seeing them.'), action: `<button class="btn sm" data-setup-go="vault">${bw.configured ? tr('Open') : tr('Set up')}</button>` }),
  ];

  root.innerHTML = `
    ${PAGE_BACK}
    <div class="section-head"><div><h1>${tr('Setup')}</h1>${unknown || c.loggedIn ? '' : `<p>${tr('One step and botdot is ready.')}</p>`}</div></div>
    ${claude}${loginBox}
    ${chiefNameSetupItem(s)}
    ${adv ? computers : ''}${phone}${tz}
    ${adv ? `<h3 class="page-sub">${tr('Extras')}</h3>
    ${extras.join('')}` : ''}
    ${state.bots.length ? '' : `<p class="muted settings-hint">${tr('Moving from another botdot?')} <button type="button" class="link-btn" id="restore-open">${tr('Restore a backup')}</button></p>`}
    <div class="settings-foot"><button class="btn primary" id="setup-done" ${c.loggedIn || unknown ? '' : 'disabled'}>${s.done ? tr('Back to your bots') : tr('Meet your Chief of Staff')}</button></div>`;

  const redraw = () => drawSetup();
  const onClick = (sel, fn) => { const el = $(sel, root); if (el) el.onclick = fn; };
  wireClaudeKey(root, c, redraw);
  onClick('#restore-open', openRestoreDialog);
  onClick('#claude-login', async (e) => {
    e.target.disabled = true;
    e.target.textContent = tr('Starting…');
    try { state.setupLogin = await api('/setup/claude/login', { method: 'POST' }); } catch (err) { toast(err.message, true); }
    redraw();
  });
  onClick('#claude-switch', async () => {
    try { state.setupLogin = await api('/setup/claude/login', { method: 'POST' }); state.setup.claude = { ...c, loggedIn: false }; } catch (err) { toast(err.message, true); }
    redraw();
  });
  onClick('#claude-logout', async () => {
    // Ask with a fresh count of what's running, since signing out stops it.
    let running = 0;
    try { running = (await api('/setup')).running || 0; } catch { /* ask anyway */ }
    const stops = running ? `\n\n${trn(running, 'A bot is working right now; it will be stopped.', '{n} bots are working right now; they will be stopped.')}` : '';
    if (!(await askFirst(`${tr("Sign out of Claude? Bots can't run until you sign in again.")}${stops}`, tr('Sign out')))) return;
    try {
      const r = await api('/setup/claude', { method: 'DELETE' });
      state.setup.claude = r.claude;
      toastClaude(r.claude, tr('Signed out of Claude'));
    } catch (err) { toast(err.message, true); }
    renderSetup(true);
  });
  onClick('#claude-cancel', async () => {
    state.setupLogin = null;
    api('/setup/claude/login', { method: 'DELETE' }).catch(() => {});
    renderSetup(true);
  });
  const form = $('#claude-code-form', root);
  if (form) {
    form.code.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = tr('Signing in…');
      try {
        const r = await api('/setup/claude/code', { method: 'POST', body: { code: form.code.value } });
        state.setupLogin = null;
        state.setup.claude = r.claude;
        toastClaude(r.claude, r.claude.email ? tr('Signed in to Claude as {email}', { email: r.claude.email }) : tr('Signed in to Claude'));
      } catch (err) {
        state.setupLogin = null; // a code works once: start over
        toast(err.message, true);
      }
      renderSetup(true);
    };
  }
  onClick('#tz-use', async () => {
    try { await api('/setup', { method: 'PUT', body: { timezone: dev } }); toast(tr('Schedules now run on {zone} time', { zone: dev })); } catch (err) { toast(err.message, true); }
    renderSetup(true);
  });
  $$('[data-setup-go]', root).forEach((b) => (b.onclick = () => setView(b.dataset.setupGo)));
  onClick('#setup-done', finishSetup);
}

// The question for the Chief's name in the first-run setup (#41), until setup is done. Its value is the name the
// Chief has, empty for "Chief of Staff"; Done sends it. Later the owner asks the Chief for another name.
function chiefNameSetupItem(s) {
  if (s.done) return '';
  const name = s.chiefName && s.chiefName !== 'Chief of Staff' ? s.chiefName : '';
  return setupItem({
    state: s.chiefNameAsked ? 'ok' : 'todo', icon: '🧭', title: tr('Name your Chief of Staff'),
    body: tr('It runs your team of bots and talks with you. Leave it empty to keep “Chief of Staff”. You can ask it for another name any time.'),
    action: `<input type="text" id="chief-name" class="setup-name" maxlength="40" placeholder="${tr('Chief of Staff')}" autocomplete="off" value="${esc(name)}">`,
  });
}
// Done: setup is done, with the name asked above. A name the server refuses (a bot's) keeps Setup open with its
// sentence; a server that could not be reached does not hold the owner up.
async function finishSetup() {
  const field = $('#chief-name');
  try {
    state.setup = { ...state.setup, ...(await api('/setup', { method: 'PUT', body: { done: true, ...(field ? { chiefName: field.value } : {}) } })) };
  } catch (err) {
    if (err.status === 400) { toast(err.message, true); return; }
  }
  setView('chief');
}
// ---------- end of the setup question
