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
const claudeHasKeys = (c) => !!c && c.installed !== false && (c.using === 'api-key' || c.using === 'subscription');
// On the key: the sentence that says so, and names a subscription that is signed in too as not used.
const claudeOnKey = (c) => `${tr('Bots run on your Anthropic API key {key}.', { key: `<b>${esc(c.apiKey || '')}</b>` })}${c.subscription === true ? ` ${c.email ? tr("Your Claude subscription ({email}) is signed in too; bots don't use it.", { email: `<b>${esc(c.email)}</b>` }) : tr("Your Claude subscription is signed in too; bots don't use it.")}` : ''}`;
// On the subscription: a saved key, named as not used.
const claudeKeyNote = (c) => (claudeHasKeys(c) && c.apiKey ? ` ${tr("An Anthropic API key ({key}) is saved too; bots don't use it.", { key: `<b>${esc(c.apiKey)}</b>` })}` : '');
// The key's links, none while signing in or while the key box is open (busy).
function claudeKeyActions(c, busy) {
  if (busy || !claudeHasKeys(c)) return [];
  if (c.using === 'api-key') return [...(c.subscription === true ? [`<button class="link-btn" id="claude-use-sub">${tr('Use the subscription instead')}</button>`] : []), `<button class="link-btn" id="claude-key-remove">${tr('Remove the key')}</button>`];
  return [c.apiKey ? `<button class="link-btn" id="claude-use-key">${tr('Use the API key instead')}</button>` : `<button class="link-btn" id="claude-key-new">${tr('Use an API key instead')}</button>`];
}
// Where the key is pasted: a password field, so it is never shown. inCard: in Settings → Claude.
const claudeKeyBox = (inCard) => `<div class="${inCard ? 'setup-login" style="padding:0;margin:12px 0 0' : 'card setup-login'}">
      <form id="claude-key-form" class="setup-code"><input type="password" name="key" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false" required><button class="btn primary" type="submit">${tr('Save')}</button></form>
      <p class="muted settings-hint">${tr('Make one in the Claude Console (console.anthropic.com → API keys). botdot checks it with Anthropic, keeps it encrypted and never shows it again.')}</p>
      <button class="link-btn muted" id="claude-key-cancel">${tr('Cancel')}</button>
    </div>`;
// The key's links and box in root, for Setup and Settings → Claude; redraw draws root again from state.setup.
function wireClaudeKey(root, c, redraw) {
  const on = (sel, fn) => { const el = $(sel, root); if (el) el.onclick = fn; };
  const ask = async (call, said) => {
    try {
      const r = await call();
      state.setupKey = false;
      state.setup.claude = r.claude;
      toastClaude(r.claude, said);
    } catch (err) { toast(err.message, true); }
    redraw();
  };
  on('#claude-key-new', () => { state.setupKey = true; redraw(); });
  on('#claude-key-cancel', () => { state.setupKey = false; redraw(); });
  on('#claude-use-key', () => ask(() => api('/setup/claude/use', { method: 'PUT', body: { use: 'api-key' } }), tr('Bots now run on your API key')));
  on('#claude-use-sub', () => ask(() => api('/setup/claude/use', { method: 'PUT', body: { use: 'subscription' } }), tr('Bots now run on your Claude subscription')));
  on('#claude-key-remove', () => {
    if (!confirm(c.subscription === true ? tr('Remove the API key? Bots will run on your Claude subscription.') : tr("Remove the API key? Bots can't run until you sign in to Claude or save a key again."))) return;
    ask(() => api('/setup/claude/key', { method: 'DELETE' }), tr('API key removed'));
  });
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
  if (c.using === 'api-key') return setupItem({ state: 'ok', icon: '✳︎', title: 'Claude', body: claudeOnKey(c), action: links(keys) });
  return c.loggedIn
    ? setupItem({
      state: 'ok', icon: '✳︎', title: 'Claude',
      body: (c.fromEnv ? tr("Signed in with a token from the server's settings.") : c.email ? tr('Signed in with {email}.', { email: `<b>${esc(c.email)}</b>` }) : tr('Signed in.')) + claudeKeyNote(c),
      action: links([...(c.fromEnv ? [] : [`<button class="link-btn" id="claude-switch">${tr('Use another account')}</button>`, `<button class="link-btn" id="claude-logout">${tr('Sign out')}</button>`]), ...keys]),
    })
    : setupItem({
      state: 'todo', icon: '✳︎', title: tr('Sign in to Claude'),
      body: c.installed === false ? tr("Claude Code isn't installed on this machine, so bots can't run.") : `${tr('Your bots run on your Claude subscription. Sign in once; it stays signed in.')}${claudeHasKeys(c) ? ` ${tr('Or run them on an Anthropic API key.')}` : ''}${claudeKeyNote(c)}`,
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
  const claude = claudeSetupItem(c, signingIn, keyOpen) + (keyOpen ? claudeKeyBox(false) : '');
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

  let phone;
  if (a.tailnet) {
    phone = setupItem({
      state: 'ok', icon: '📱', title: tr('Your phone'),
      body: tr('Private on your tailnet at {address}, and only your passkey signs in to your account.<br>On your phone, open it and choose <b>Add to Home Screen</b> to use it like an app.', { address: `<b>https://${esc(a.host)}</b>` }),
    });
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
    setupItem({ state: bw.configured ? 'ok' : 'off', icon: '🛡', title: `Bitwarden <span class="setup-opt">${tr('optional')}</span>`, body: bw.configured ? (bw.unlocked ? tr('Connected. Bots use its logins and cards without seeing them.') : tr('Connected, locked: unlock it when botdot asks. Bots use its logins and cards without seeing them.')) : tr('Let bots use your logins, cards and identities without ever seeing them.'), action: `<button class="btn sm" data-setup-go="vault">${bw.configured ? tr('Open') : tr('Set up')}</button>` }),
  ];

  root.innerHTML = `
    ${PAGE_BACK}
    <div class="section-head"><div><h1>${tr('Setup')}</h1>${unknown ? '' : `<p>${c.loggedIn ? tr('botdot is ready. The rest is up to you.') : tr('One step and botdot is ready.')}</p>`}</div></div>
    ${claude}${loginBox}
    ${chiefNameSetupItem(s)}
    ${computers}${phone}${tz}
    <h3 class="page-sub">${tr('Extras')}</h3>
    ${extras.join('')}
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
    if (!confirm(`${tr("Sign out of Claude? Bots can't run until you sign in again.")}${stops}`)) return;
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
