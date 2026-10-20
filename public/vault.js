// ---------- vault ----------

// Heuristic, a hint before a message with a password in it is sent: "password: x", "pass=x", "hasło - x",
// "my password is Tr0ub4dor&3", "PIN 4821". It matches a password, not the word: after a word that means
// "password" comes a separator (":", "=", or "-" with a space beside it) or "is" (or "is:"), and then one token
// of four characters or more that holds a digit or a symbol (a hyphen is none: "case-sensitive"); after ":" or
// "=" a plain word counts too when the message ends with it. So "my password is wrong again" and "the password reset page" send without a question.
// A PIN only counts when a number follows, so phrases like "pin the version" don't trigger it.
const SECRET_AFTER = /(?:\b(?:password|passwd|pwd|hasło|haslo|passcode)(?:(?:\s+is\b)?\s*([:=])|\s+-|-(?=\s)|\s+is\b)|\bpass\s*([:=]))\s*(\S{4,})/gi; // "pass" only with ":" or "=": not the verb
function looksLikeSecret(t) {
  const text = String(t ?? '');
  if (/\bpin\b\s*(code)?\s*(is|:|=|-)?\s*\d{4,8}\b/i.test(text)) return true;
  for (const m of text.matchAll(SECRET_AFTER)) {
    const token = m[3].replace(/[.,;:!?)"'…]+$/, ''); // the sentence's own punctuation is no symbol
    if (token.length >= 4 && /[^\p{L}\s-]/u.test(token)) return true;
    if ((m[1] || m[2]) && !text.slice(m.index + m[0].length).trim()) return true;
  }
  return false;
}

// ---------- vault item types ----------

// A login-kind item of the Vault is a login, an API token or any other secret (docs/api.md, "The Vault's
// items"). The type is a label and the fields its form asks for, nothing else. An item or a request without
// one, or with one this page does not know, is a login.
const VAULT_TYPES = {
  login: { label: 'Login', username: 'Username or email', secret: 'Password', icon: '👤', none: '(no username)', saved: 'secret saved' },
  'api-token': { label: 'API token', username: 'Token ID', optional: true, secret: 'Token', icon: '🆔', none: '(no token ID)', saved: 'token saved' },
  other: { label: 'Other', secret: 'Secret', saved: 'secret saved' },
};
const vaultType = (type) => (Object.hasOwn(VAULT_TYPES, type) ? type : 'login');

// A login-kind item in the Vault's list: its type before its address, and the line under it.
const vaultItemAddr = (l) => `${VAULT_TYPES[vaultType(l.type)].label} · ${esc(l.site)}`;
function vaultItemLine(l) {
  const t = VAULT_TYPES[vaultType(l.type)];
  return `${t.username ? `${t.icon} ${esc(l.username || t.none)} · ` : ''}🔒 ${t.saved}${l.hasTotp ? ' · two-step code' : ''}${l.insecureTls ? ' · self-signed certificate OK' : ''}${l.inComputer ? ' · usable in its computer' : ''}`;
}
// An SSH key of Bitwarden (kind `ssh-key`, docs/api.md): its fingerprint, and that bots use it without seeing it.
const vaultSshKeyLine = (l) => `${l.fingerprint ? `${esc(l.fingerprint)} · ` : ''}🔒 for SSH on a bot's computer, never shown to it`;

// The Type control, and the fields that hold the secret of a type, in the editor and in the "needs a login"
// dialog. username: what the username field starts with. isNew: a new item needs its secret; a saved one
// keeps it when the field is left empty. Other has the secret alone.
const vaultTypeControl = (type) => `<label class="field">Type<select name="type">${Object.entries(VAULT_TYPES).map(([value, t]) => `<option value="${value}"${value === vaultType(type) ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>`;
function vaultTypeFields(type, { username = '', isNew = true } = {}) {
  const t = VAULT_TYPES[vaultType(type)];
  const secret = `<label class="field">${t.secret}${isNew ? '' : ' <span class="hint">leave empty to keep the current one</span>'}<input type="password" name="password" autocomplete="new-password"${isNew ? ' required' : ' placeholder="••••••••"'}></label>`;
  if (!t.username) return `<div class="row one" data-type-fields>${secret}</div>`;
  return `<div class="row" data-type-fields><label class="field">${t.username}${t.optional ? ' <span class="hint">optional</span>' : ''}<input type="text" name="username" value="${esc(username)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>${secret}</div>`;
}

// The fields follow the Type control at once. What was typed stays: the secret, and the username also while
// Other shows no field for it, so a login changed to Other and back shows its username again.
function wireVaultType(form, { username = '', isNew = true } = {}) {
  let kept = username;
  form.type.onchange = () => {
    if (form.username) kept = form.username.value;
    const secret = form.password.value;
    $('[data-type-fields]', form).outerHTML = vaultTypeFields(form.type.value, { username: kept, isNew });
    form.password.value = secret;
  };
}

// What a form sends of its type: the type, and the username where the type has that field. Other sends none,
// so a new item has no username and a saved one keeps the one it has.
function vaultTypeBody(form) {
  const type = vaultType(form.type.value);
  return { type, ...(VAULT_TYPES[type].username ? { username: form.username.value } : {}) };
}

async function renderVault() {
  const root = $('#view-vault');
  root.dataset.ready = '1';
  let logins = [];
  try { [logins, state.bw] = await Promise.all([api('/vault'), api('/vault/bitwarden')]); } catch (e) { toast(e.message, true); }
  if (state.view !== 'vault') return;
  const bw = state.bw || {};
  const botName = (id) => { const b = state.bots.find((x) => x.id === id); return b ? `${b.name}` : id; };
  const locked = bw.configured && !bw.unlocked;
  root.innerHTML = `
    ${SUB_BACK}
    <div class="section-head">
      <div><h1>Vault</h1><p>${bw.configured ? `Your Bitwarden's <b>bot-dot</b> folder: logins, cards, identities and SSH keys your bots can use without ever seeing them.` : 'Saved logins your bots can use without ever seeing the password.'}</p></div>
      ${locked ? '' : `<div class="vault-add">${bw.unlocked ? '<button class="btn" id="add-ssh-key">＋ SSH key</button>' : ''}<button class="btn primary" id="add-login">＋ Add</button></div>`}
    </div>
    ${!bw.configured ? (bw.installed === false ? '<div class="req-note">To use Bitwarden, install its command-line tool first: <span class="mono">brew install bitwarden-cli</span>, then reload.</div>' : bitwardenSetupHTML()) : `
    <div class="card bw-bar">
      <span>🛡 Bitwarden · ${esc(bw.email || bw.server || '')} · ${bw.unlocked ? `unlocked · ${bw.items} item${bw.items === 1 ? '' : 's'} in bot-dot${bw.lastSync ? ` · synced ${esc(ago(bw.lastSync))}` : ''}` : '<b>locked</b>'}</span>
      <span class="grow"></span>
      ${bw.unlocked ? '<button class="btn sm" id="bw-sync">Sync</button><button class="btn sm" id="bw-lock">Lock</button>' : '<button class="btn sm primary" id="bw-unlock-btn">Unlock</button>'}
    </div>
    ${bw.error ? `<div class="req-note">${esc(bw.error)}</div>` : ''}`}
    ${locked ? '<div class="card empty"><div class="big">🔐</div>Unlock Bitwarden to see what bots can use.</div>' : `
    ${logins.length ? `<div class="grid">${logins.map((l) => {
      const kind = l.kind || 'login';
      const line = kind === 'card' ? `💳 ${esc(l.brand || 'Card')} •••• ${esc(l.last4)}${l.expiry ? ` · expires ${esc(l.expiry)}` : ''} · you approve each payment`
        : kind === 'identity' ? `🪪 ${esc(l.holder || '')}${l.email ? ` · ${esc(l.email)}` : ''}`
        : kind === 'ssh-key' ? vaultSshKeyLine(l)
        : vaultItemLine(l);
      return `
      <article class="card vault-item">
        <div class="bot-head"><div class="avatar" style="--bot-color:#6c7cff">${KIND_ICON[kind] || '🔑'}</div>
          <div style="flex:1;min-width:0"><div class="bot-name">${esc(l.name)}</div><div class="addr">${kind === 'login' ? vaultItemAddr(l) : kind === 'card' ? 'Payment card' : kind === 'ssh-key' ? 'SSH key' : 'Identity'}</div></div></div>
        <div class="bot-meta">
          <div>${line}</div>
          ${l.reprompt ? '<div class="faint">Asks for the master password again in Bitwarden, so bots can\'t use it.</div>' : ''}
          <div>${l.allowedBots.length ? `Can be used by: ${l.allowedBots.map((id) => esc(botName(id))).join(', ')}` : '<span class="faint">No bot may use it yet</span>'}</div>
        </div>
        <div class="bot-actions"><button class="btn" data-edit-login="${esc(l.id)}">${kind === 'login' ? 'Edit' : 'Bots…'}</button></div>
      </article>`;
    }).join('')}</div>`
      : `<div class="card empty"><div class="big">🔐</div>${bw.configured ? 'Nothing in the bot-dot folder yet. Move the logins, cards and identities bots may use into that folder in Bitwarden, or add a login here.' : 'No saved logins yet. Add one so a bot can sign in to a site for you.'}</div>`}`}`;
  const add = $('#add-login');
  if (add) add.onclick = () => openLoginEditor();
  const addKey = $('#add-ssh-key');
  if (addKey) addKey.onclick = () => openSshKeyEditor();
  $$('[data-edit-login]').forEach((b) => (b.onclick = () => {
    const l = logins.find((x) => x.id === b.dataset.editLogin);
    return (l.kind || 'login') === 'login' ? openLoginEditor(l) : openItemBots(l);
  }));
  wireBitwardenSetup(root);
  const u = $('#bw-unlock-btn'); if (u) u.onclick = () => { if (!bwUi.unlocking) openUnlock(); };
  const lk = $('#bw-lock'); if (lk) lk.onclick = () => whileBusy(lk, 'Locking…', async () => { try { await api('/vault/bitwarden/lock', { method: 'POST' }); toast('Locked'); } catch (e) { toast(e.message, true); } bwUi.prompted = true; renderVault(); showBitwardenBanner(); });
  const sy = $('#bw-sync'); if (sy) sy.onclick = () => whileBusy(sy, 'Syncing…', async () => { try { await api('/vault/bitwarden/sync', { method: 'POST' }); toast('Synced'); } catch (e) { toast(e.message, true); } renderVault(); });
}

function openLoginEditor(login) {
  const isNew = !login;
  const l = login || { name: '', site: '', username: '', allowedBots: [] };
  const m = openModal(`
    <form id="login-form" autocomplete="off">
      <div class="modal-head"><h2>${isNew ? 'Add to the Vault' : `Edit ${esc(l.name)}`}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        ${vaultTypeControl(l.type)}
        <div class="row">
          <label class="field">Name<input type="text" name="name" value="${esc(l.name)}" placeholder="e.g. Recipes"></label>
          <label class="field">Website or server <span class="hint">the secret is only used with this address</span><input type="text" name="site" value="${esc(l.site)}" placeholder="recipes.example.com or pve.example.ts.net" required></label>
        </div>
        ${vaultTypeFields(l.type, { username: l.username, isNew })}
        <label class="field">Additional exact hosts <input name="allowedHosts" value="${esc((l.allowedHosts || []).join(', '))}" placeholder="api.example.com, auth.example.com"><span class="hint">Only these hosts may receive this login. Subdomains are not included automatically.</span></label>
        <label class="toggle"><input type="checkbox" name="insecureTls" ${l.insecureTls ? 'checked' : ''}> Accept a self-signed certificate <span class="hint muted" style="font-weight:400">for your own servers, e.g. Proxmox or a NAS</span></label>
        <label class="toggle"><input type="checkbox" name="inComputer" ${l.inComputer ? 'checked' : ''}> Usable in its computer <span class="hint muted" style="font-weight:400">bots may use it in a command on the account's computer, e.g. for Proton Bridge there. Every bot on that computer could then read it: only for secrets that guard something on it</span></label>
        <div class="req-note">Bots can use this login to sign in on the website, or to call its API: they write <span class="mono">{{username}}</span> and <span class="mono">{{password}}</span> in the request and botdot fills them in, so they never see the secret.</div>
        <fieldset>
          <legend>Bots that may use it</legend>
          <div class="tool-toggles">${state.bots.map((b) => `<label title="${b.computer === 'linux' ? '' : 'This bot has no computer, so it can’t sign in to websites'}"><input type="checkbox" name="bot" value="${esc(b.id)}" ${l.allowedBots.includes(b.id) ? 'checked' : ''}>${botLabel(b)}${b.computer === 'linux' ? '' : ' <span class="faint">(no computer)</span>'}</label>`).join('')}</div>
        </fieldset>
        <div class="req-error" role="alert" hidden></div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" class="btn danger left" id="delete-login">Delete</button>'}
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>`);
  const form = $('#login-form', m);
  wireVaultType(form, { username: l.username, isNew });
  const del = $('#delete-login', m);
  if (del) del.onclick = () => {
    if (!confirm(state.bw?.configured ? `Delete "${l.name}"? It moves to Bitwarden's trash, where you can restore it for 30 days.` : `Delete "${l.name}" from the Vault?`)) return;
    whileBusy(del, 'Deleting…', async () => {
      try {
        await api(`/vault/${l.id}`, { method: 'DELETE' });
        m.close();
        toast('Deleted');
        renderVault();
      } catch (err) { toast(err.message, true); }
    });
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const refused = $('.req-error', form);
    refused.hidden = true;
    const body = {
      name: form.name.value.trim(),
      site: form.site.value.trim(),
      ...vaultTypeBody(form),
      allowedHosts: form.allowedHosts.value.split(',').map((s) => s.trim()).filter(Boolean),
      insecureTls: form.insecureTls.checked,
      inComputer: form.inComputer.checked,
      allowedBots: $$('input[name=bot]:checked', form).map((c) => c.value),
    };
    if (form.password.value) body.password = form.password.value;
    form.password.value = '';
    await whileBusy($('button[type=submit]', form), 'Saving…', async () => { try {
      await api(isNew ? '/vault' : `/vault/${l.id}`, { method: isNew ? 'POST' : 'PUT', body });
      m.close();
      toast(state.bw?.configured ? (isNew ? 'Saved to Bitwarden (bot-dot folder)' : 'Saved in Bitwarden') : 'Saved');
      renderVault();
    } catch (err) {
      // Refused: the server's sentence, in the form, which stays open with what was typed, except the secret.
      refused.textContent = err.message;
      refused.hidden = false;
    } });
  };
}

// ---------- Bitwarden ----------

const bwUi = { prompted: false, snoozed: new Set() };
const KIND_ICON = { login: '🔑', card: '💳', identity: '🪪', 'ssh-key': '🗝️' };
// What sharing a card, an identity or an SSH key lets a bot do, above its bots.
const ITEM_BOTS_HINT = {
  card: 'Bots that may pay with this card. You still approve every payment in a pop-up.',
  identity: 'Bots that may type these details into forms.',
  'ssh-key': "Bots that may use this key for SSH from the account's computer. botdot loads it into an ssh-agent there for one command: no file holds the key, but every bot on that computer could read it meanwhile.",
};

function bitwardenSetupHTML() {
  return `
    <div class="card setup-card">
      <h3>Use your Bitwarden</h3>
      <p class="muted" style="margin:0">Bots will use the logins, payment cards and identities in a folder called <b>bot-dot</b> in your Bitwarden, and nothing else in it.
      You approve every card payment in a pop-up. Your master password is only used to unlock (after each restart of botdot) and is never saved.</p>
      <ol>
        <li>In the Bitwarden web vault, open <b>Settings → Security → Keys → View API key</b>.</li>
        <li>Copy the <b>client_id</b> and <b>client_secret</b> here.</li>
      </ol>
      <form id="bw-setup" autocomplete="off" style="display:grid;gap:10px">
        <div class="row">
          <label class="field">Server<select name="server"><option value="us">bitwarden.com (US)</option><option value="eu">bitwarden.eu (EU)</option><option value="custom">Self-hosted…</option></select></label>
          <label class="field hidden" id="bw-url-field">Address<input type="text" name="serverUrl" placeholder="https://vault.example.com"></label>
        </div>
        <div class="row">
          <label class="field">client_id<input type="text" name="clientId" placeholder="user.xxxxxxxx-…" autocomplete="off" spellcheck="false"></label>
          <label class="field">client_secret<input type="password" name="clientSecret" autocomplete="new-password"></label>
        </div>
        <div><button class="btn primary">Connect Bitwarden</button></div>
      </form>
    </div>`;
}

function wireBitwardenSetup(root) {
  const f = $('#bw-setup', root);
  if (!f) return;
  f.server.onchange = () => $('#bw-url-field', root).classList.toggle('hidden', f.server.value !== 'custom');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button.primary', f);
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      await api('/vault/bitwarden/setup', { method: 'POST', body: { server: f.server.value, serverUrl: f.serverUrl.value, clientId: f.clientId.value, clientSecret: f.clientSecret.value } });
      f.clientSecret.value = '';
      toast('Connected. Now unlock it.');
      state.bw = await api('/vault/bitwarden');
      openUnlock();
      renderVault();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Connect Bitwarden'; }
  };
}

function openUnlock(reason = '') {
  const s = state.bw || {};
  const m = openModal(`
    <form id="bw-unlock" autocomplete="off">
      <div class="modal-head"><h2>🔐 Unlock Bitwarden</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${reason ? `${esc(reason)} ` : ''}Bots can use the <b>bot-dot</b> folder of ${esc(s.email || 'your vault')} once it's unlocked. It stays unlocked until botdot restarts or you lock it.</p>
        <label class="field">Master password<input type="password" name="password" autocomplete="current-password" required></label>
        <div class="req-note">🛡 Used once to unlock and then forgotten: it isn't saved, and the AI never sees it.</div>
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Not now</button><button class="btn primary">Unlock</button></div>
    </form>`);
  const f = $('#bw-unlock', m);
  setTimeout(() => f.password.focus(), 50);
  f.onsubmit = (e) => {
    e.preventDefault();
    const pw = f.password.value;
    f.password.value = '';
    m.close();
    unlockInBackground(pw);
  };
  m.addEventListener('close', () => { f.password.value = ''; }, { once: true });
}

// Unlocking takes a few seconds: it runs in the background with a small pill in the corner, so the
// bots stay usable meanwhile.
async function unlockInBackground(password) {
  if (bwUi.unlocking) return;
  bwUi.unlocking = true;
  unlockPill('busy', 'Unlocking Password Manager…');
  try {
    const r = await api('/vault/bitwarden/unlock', { method: 'POST', body: { password } });
    state.bw = { ...state.bw, ...r };
    unlockPill('ok', r.moved ? `Unlocked. Moved ${r.moved} saved login${r.moved === 1 ? '' : 's'} into Bitwarden.` : 'Unlocked');
    showBitwardenBanner();
    if (state.view === 'vault') renderVault();
  } catch (err) {
    unlockPill('err', /not right/i.test(err.message) ? 'Wrong master password' : err.message);
  } finally { bwUi.unlocking = false; }
}

// retry: what tapping an error pill does (by default, open the unlock dialog again).
function unlockPill(kind, text, retry = () => openUnlock()) {
  let el = $('#unlock-pill');
  if (!el) { el = document.createElement('div'); el.id = 'unlock-pill'; document.body.append(el); }
  clearTimeout(unlockPill.timer);
  el.className = `unlock-pill ${kind}`;
  el.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>${kind === 'err' ? '<button type="button" class="x" aria-label="Close">✕</button>' : ''}`;
  el.onclick = kind === 'err' ? (e) => { el.remove(); if (!e.target.closest('.x')) retry(); } : null;
  if (kind === 'ok') unlockPill.timer = setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 400); }, 2500);
}

async function pollBitwarden() {
  bwUi.polledAt = Date.now();
  try { state.bw = await api('/vault/bitwarden'); } catch { return; }
  showBitwardenBanner();
  const s = state.bw;
  if (!s.configured || s.unlocked || bwUi.unlocking || $('#modal').open) return;
  // Right after a restart, and whenever a bot is waiting for a login.
  if (s.wantedBy && !bwUi.snoozed.has(s.wantedBy.id)) { bwUi.snoozed.add(s.wantedBy.id); return openUnlock(`${s.wantedBy.name} needs a saved login.`); }
  if (!bwUi.prompted) { bwUi.prompted = true; openUnlock(); }
}

function showBitwardenBanner() { showNeeds(); }

// A bot wants to pay: the owner approves this card on this site (for this run, 15 minutes).
function openCardApproval(r) {
  loginReq.shown = r.id;
  const m = openModal(`
    <div class="modal-head"><h2>💳 ${botLabel(r.bot)} wants to pay</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <div class="req-site">
        <div class="muted" style="font-size:12.5px">On</div>
        <div class="site">${esc(r.site)}</div>
        <div class="muted" style="font-size:12.5px">with ${esc(r.card?.name || 'a card')}${r.card?.last4 ? ` (${esc(r.card.brand || 'card')} •••• ${esc(r.card.last4)})` : ''}</div>
      </div>
      ${r.amount ? `<div class="req-reason"><span class="muted">Amount:</span> <b>${esc(r.amount)}</b></div>` : ''}
      ${r.reason ? `<div class="req-reason"><span class="muted">The bot says:</span> “${esc(r.reason)}”</div>` : ''}
      <div class="req-note">If you approve, botdot types the card details into the bot's browser on this site only (the bot never sees them). This covers this run on ${esc(r.site)} for 15 minutes. Only approve a purchase you asked for, and check the site is the one you expect.</div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn danger left" id="card-decline">Decline</button>
      <button type="button" class="btn" id="card-later">Later</button>
      <button type="button" class="btn primary" id="card-approve">Approve payment</button>
    </div>`);
  m.dataset.request = r.id;
  const answer = async (action) => {
    try {
      await api(`/vault/requests/${r.id}`, { method: 'POST', body: { action } });
      m.close();
      toast(action === 'approve' ? `Approved. ${r.bot.name} will continue.` : 'Declined');
    } catch (e) { toast(e.message, true); }
  };
  $('#card-approve', m).onclick = () => whileBusy($('#card-approve', m), 'Approving…', () => answer('approve'));
  $('#card-decline', m).onclick = () => whileBusy($('#card-decline', m), 'Declining…', () => answer('decline'));
  $('#card-later', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  $('[data-dismiss]', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  m.addEventListener('close', () => { loginReq.shown = null; delete m.dataset.request; pollLoginRequests(); }, { once: true });
}

function openItemBots(item) {
  const m = openModal(`
    <form id="item-bots">
      <div class="modal-head"><h2>${KIND_ICON[item.kind] || '🔑'} ${esc(item.name)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${ITEM_BOTS_HINT[item.kind] || ITEM_BOTS_HINT.identity} Change the details themselves in Bitwarden.</p>
        ${botCheckboxes(item.allowedBots).replaceAll(' disabled title="Skills are turned off for this bot"', '')}
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  $('#item-bots', m).onsubmit = async (e) => {
    e.preventDefault();
    await whileBusy($('.modal-foot .primary', m), 'Saving…', async () => { try { await api(`/vault/${item.id}`, { method: 'PUT', body: { allowedBots: $$('input[name=bot]:checked', m).map((c) => c.value) } }); m.close(); toast('Saved'); renderVault(); } catch (err) { toast(err.message, true); } });
  };
}

// An SSH key the owner adds (#160, docs/api.md `POST /api/vault/ssh-keys`): an OpenSSH private key pasted or read from
// its file, or a new one botdot makes. The private key goes to the server once and is never shown again; the public
// key comes back, with a copy button, for a server's authorized_keys.
function openSshKeyEditor() {
  const m = openModal(`
    <form id="ssh-key-form" autocomplete="off">
      <div class="modal-head"><h2>🗝️ Add an SSH key</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <label class="field">Name<input type="text" name="name" placeholder="e.g. Home servers" maxlength="100" required></label>
        <label class="field">Private key <span class="hint">OpenSSH format, without a passphrase. Leave empty to generate a new key</span><textarea name="privateKey" class="mono" rows="6" spellcheck="false" autocapitalize="off" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea></label>
        <label class="field">Or pick its file <input type="file" name="keyFile"></label>
        <div class="req-note">Saved in your Bitwarden's bot-dot folder as an SSH key. Bots use it for SSH from the account's computer and never see it, and you can't see it here again.</div>
        <fieldset>
          <legend>Bots that may use it</legend>
          <div class="tool-toggles">${state.bots.map((b) => `<label><input type="checkbox" name="bot" value="${esc(b.id)}">${botLabel(b)}</label>`).join('')}</div>
        </fieldset>
        <div class="req-error" role="alert" hidden></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" type="submit">Generate new key</button>
      </div>
    </form>`);
  const form = $('#ssh-key-form', m);
  const submit = $('button[type=submit]', form);
  const label = () => { submit.textContent = form.privateKey.value.trim() ? 'Add key' : 'Generate new key'; };
  form.privateKey.oninput = label;
  form.keyFile.onchange = async () => {
    const file = form.keyFile.files[0];
    form.keyFile.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) { toast('That file is too big for an SSH private key.', true); return; }
    form.privateKey.value = await file.text();
    if (!form.name.value.trim()) form.name.value = file.name;
    label();
  };
  m.addEventListener('close', () => { form.privateKey.value = ''; }, { once: true });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const refused = $('.req-error', form);
    refused.hidden = true;
    const privateKey = form.privateKey.value.trim();
    const body = { name: form.name.value.trim(), allowedBots: $$('input[name=bot]:checked', form).map((c) => c.value), ...(privateKey ? { privateKey } : { generate: true }) };
    await whileBusy(submit, privateKey ? 'Adding…' : 'Generating…', async () => { try {
      const key = await api('/vault/ssh-keys', { method: 'POST', body });
      form.privateKey.value = '';
      m.close();
      renderVault();
      openSshPublicKey(key, !privateKey);
    } catch (err) {
      // Refused: the server's sentence, in the form, which stays open with what was given.
      refused.textContent = err.message;
      refused.hidden = false;
    } });
  };
}

// The public key of the SSH key just added, to copy into a server's authorized_keys.
function openSshPublicKey(key, generated) {
  const m = openModal(`
    <div class="modal-head"><h2>🗝️ ${esc(key.name)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <p class="muted wrap-any" style="margin:0">${generated ? 'botdot made this key and saved it in Bitwarden.' : 'Saved in Bitwarden.'} To let it in, add its public key to <span class="mono">~/.ssh/authorized_keys</span> on the server.</p>
      <label class="field">Public key<textarea class="mono" rows="4" readonly>${esc(key.publicKey)}</textarea></label>
      <div class="faint wrap-any">${esc(key.fingerprint)}</div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-dismiss>Done</button><button type="button" class="btn primary" id="copy-public-key">Copy public key</button></div>`);
  $('#copy-public-key', m).onclick = async () => toast((await copyText(key.publicKey)) ? 'Copied' : "Couldn't copy");
}
