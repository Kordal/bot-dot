// Settings → Claude: which account botdot uses, with sign out, use another account, and sign in
// when it isn't signed in, or the Anthropic API key bots run on instead (#35), same as the phone app. Loaded after app.js and uses its helpers ($, api,
// esc, toast, state, claudeUnknown, toastClaude). Adds its card under Appearance each time the Settings page is drawn.

(() => {
  const drawSettings = renderSettings;
  renderSettings = function () {
    drawSettings();
    const updates = $('#updates-card');
    if (!updates || $('#claude-card')) return;
    updates.insertAdjacentHTML('beforebegin', `<div class="card settings-card" id="claude-card">
      <h3 class="page-sub" style="margin-top:0">✳︎ Claude</h3>
      <p class="muted settings-hint" style="margin:0">Checking…</p>
    </div>`);
    loadClaudeCard();
  };
})();

// fresh: ask the server for the status first.
async function loadClaudeCard(fresh = true) {
  const card = $('#claude-card');
  if (!card) return;
  if (fresh || !state.setup) {
    try { state.setup = await api('/setup'); } catch (e) { card.querySelector('p').textContent = e.message; return; }
  }
  const c = state.setup.claude || {};
  const signingIn = !!state.setupLogin;
  const keyOpen = !!state.setupKey && !signingIn; // the API key's box (#35)
  // A check that could not tell says its own sentence, never "Not signed in"; the way to sign in stays.
  const unknown = claudeUnknown(c);
  const body = c.installed === false ? "Claude Code isn't installed on this machine, so bots can't run."
    : unknown ? esc(unknown)
    : c.using === 'api-key' ? claudeOnKey(c)
    : (!c.loggedIn ? "Not signed in, so bots can't run."
      : c.fromEnv ? "Signed in with a token from the server's settings."
      : c.email ? `Signed in with <b>${esc(c.email)}</b>.` : 'Signed in.') + claudeKeyNote(c);
  const keys = claudeKeyActions(c, signingIn || keyOpen).join(' · ');
  const action = signingIn || c.installed === false ? ''
    : c.using === 'api-key' ? keys
    : unknown || !c.loggedIn ? ['<button class="btn primary" id="claude-login">Sign in to Claude</button>', keys].filter(Boolean).join(' ')
    : [...(c.fromEnv ? [] : ['<button class="link-btn" id="claude-switch">Use another account</button>', '<button class="link-btn" id="claude-logout">Sign out</button>']), ...(keys ? [keys] : [])].join(' · ');
  const steps = signingIn ? `<div class="setup-login" style="padding:0;margin:12px 0 0">
      <ol>
        <li><a class="btn primary" href="${esc(state.setupLogin.url)}" target="_blank" rel="noopener">Open the sign-in page</a><span class="muted">Sign in, allow access, and copy the code it shows.</span></li>
        <li><form id="claude-code-form" class="setup-code"><input type="text" name="code" placeholder="Paste the code here" autocomplete="off" autocapitalize="off" spellcheck="false" required><button class="btn primary" type="submit">Sign in</button></form></li>
      </ol>
      <button class="link-btn muted" id="claude-cancel">Cancel</button>
    </div>` : '';
  card.innerHTML = `
    <h3 class="page-sub" style="margin-top:0">✳︎ Claude</h3>
    <p class="muted settings-hint" style="margin:0">${body}</p>
    ${action ? `<div class="setup-actions">${action}</div>` : ''}
    ${steps}${keyOpen ? claudeKeyBox(true) : ''}`;

  const onClick = (sel, fn) => { const el = $(sel, card); if (el) el.onclick = fn; };
  wireClaudeKey(card, c, () => loadClaudeCard(false));
  onClick('#claude-login', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Starting…';
    try { state.setupLogin = await api('/setup/claude/login', { method: 'POST' }); } catch (err) { toast(err.message, true); }
    loadClaudeCard(false);
  });
  onClick('#claude-switch', async () => {
    try { state.setupLogin = await api('/setup/claude/login', { method: 'POST' }); state.setup.claude = { ...c, loggedIn: false }; } catch (err) { toast(err.message, true); }
    loadClaudeCard(false);
  });
  onClick('#claude-logout', async () => {
    // Ask with a fresh count of what's running, since signing out stops it.
    let running = 0;
    try { running = (await api('/setup')).running || 0; } catch { /* ask anyway */ }
    const stops = running ? `\n\n${running === 1 ? 'A bot is working right now; it will be stopped.' : `${running} bots are working right now; they will be stopped.`}` : '';
    if (!confirm(`Sign out of Claude? Bots can't run until you sign in again.${stops}`)) return;
    try {
      const r = await api('/setup/claude', { method: 'DELETE' });
      state.setup.claude = r.claude;
      toastClaude(r.claude, 'Signed out of Claude');
    } catch (err) { toast(err.message, true); }
    loadClaudeCard();
  });
  onClick('#claude-cancel', () => {
    state.setupLogin = null;
    api('/setup/claude/login', { method: 'DELETE' }).catch(() => {});
    loadClaudeCard();
  });
  const form = $('#claude-code-form', card);
  if (form) {
    form.code.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const r = await api('/setup/claude/code', { method: 'POST', body: { code: form.code.value } });
        state.setupLogin = null;
        state.setup.claude = r.claude;
        toastClaude(r.claude, `Signed in to Claude${r.claude.email ? ` as ${r.claude.email}` : ''}`);
      } catch (err) {
        state.setupLogin = null; // a code works once: start over
        toast(err.message, true);
      }
      loadClaudeCard();
    };
  }
}
