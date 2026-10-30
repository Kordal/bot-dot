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

// A login-kind item of the Vault is a login, an API token, any other secret or a GitHub App (docs/api.md, "The
// Vault's items"). The type is a label and the fields its form asks for; a GitHub App is also used by its token
// alone, which botdot makes from its key (#155). An item or a request without one, or with one this page does not
// know, is a login. multiline: its secret is a masked box of several lines, which can be read from a file (a
// private key), as a one-line field would lose its line breaks. site: the address a new one starts with.
const VAULT_TYPES = {
  login: { label: tr('Login'), username: tr('Username or email'), secret: tr('Password'), icon: '👤', none: tr('(no username)'), saved: tr('secret saved') },
  'api-token': { label: tr('API token'), username: tr('Token ID'), optional: true, secret: tr('Token'), icon: '🆔', none: tr('(no token ID)'), saved: tr('token saved') },
  other: { label: tr('Other'), secret: tr('Secret'), saved: tr('secret saved'), multiline: true },
  'github-app': { label: 'GitHub App', username: 'App ID', secret: tr('Private key (.pem)'), icon: '🐙', none: tr('(no App ID)'), saved: tr('key saved'), multiline: true, site: 'api.github.com', hint: tr('add /installation ID if it is installed on several accounts') },
};
const SECRET_FILE_MAX = 64 * 1024; // a secret read from a file: a private key is a few KB
const vaultType = (type) => (Object.hasOwn(VAULT_TYPES, type) ? type : 'login');

// A login-kind item in the Vault's list: its type before its address, and the line under it.
const vaultItemAddr = (l) => `${VAULT_TYPES[vaultType(l.type)].label} · ${esc(l.site)}`;
function vaultItemLine(l) {
  const t = VAULT_TYPES[vaultType(l.type)];
  return `${t.username ? `${t.icon} ${esc(l.username || t.none)} · ` : ''}🔒 ${t.saved}${l.hasTotp ? ` · ${tr('two-step code')}` : ''}${l.insecureTls ? ` · ${tr('self-signed certificate OK')}` : ''}${l.inComputer ? ` · ${tr('usable in its computer')}` : ''}`;
}
// An SSH key of Bitwarden (kind `ssh-key`, docs/api.md): its fingerprint, and that bots use it without seeing it.
const vaultSshKeyLine = (l) => `${l.fingerprint ? `${esc(l.fingerprint)} · ` : ''}🔒 ${tr("for SSH on a bot's computer, never shown to it")}`;
// A file of Bitwarden (kind `file`, #157): its file name and size, and that bots use it without seeing it.
const vaultFileSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toLocaleString(I18n.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`);
const vaultFileLine = (l) => `${esc(l.fileName || '')} · ${vaultFileSize(Number(l.size) || 0)} · 🔒 ${tr("for one command on a bot's computer, never shown to it")}`;

// The Type control, and the fields that hold the secret of a type, in the editor and in the "needs a login"
// dialog. username: what the username field starts with. isNew: a new item needs its secret; a saved one
// keeps it when the field is left empty. Other has the secret alone.
const vaultTypeControl = (type) => `<label class="field">${tr('Type')}<select name="type">${Object.entries(VAULT_TYPES).map(([value, t]) => `<option value="${value}"${value === vaultType(type) ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>`;
function vaultTypeFields(type, { username = '', isNew = true } = {}) {
  const t = VAULT_TYPES[vaultType(type)];
  const keep = isNew ? '' : ` <span class="hint">${tr('leave empty to keep the current one')}</span>`;
  const secret = t.multiline
    ? `<label class="field">${t.secret}${keep}<textarea name="password" class="mono masked" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false"${isNew ? ' required' : ' placeholder="••••••••"'}></textarea></label><label class="field">${tr('Or pick its file')}<input type="file" name="secretFile"></label>`
    : `<label class="field">${t.secret}${keep}<input type="password" name="password" autocomplete="new-password"${isNew ? ' required' : ' placeholder="••••••••"'}></label>`;
  const user = t.username ? `<label class="field">${t.username}${t.optional ? ` <span class="hint">${tr('optional')}</span>` : ''}${t.hint ? ` <span class="hint">${t.hint}</span>` : ''}<input type="text" name="username" value="${esc(username)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>` : '';
  // A secret of several lines takes the form's width, under its username.
  return `<div class="row${!t.username || t.multiline ? ' one' : ''}" data-type-fields>${user}${secret}</div>`;
}

// A secret of several lines read from its file, as it is: its line breaks too.
function wireSecretFile(form) {
  if (!form.secretFile) return;
  form.secretFile.onchange = async () => {
    const file = form.secretFile.files[0];
    form.secretFile.value = '';
    if (!file) return;
    if (file.size > SECRET_FILE_MAX) { toast(tr('That file is too big for the Vault (64 KB at most).'), true); return; }
    form.password.value = await file.text();
  };
}

// The fields follow the Type control at once. What was typed stays: the secret, and the username also while
// Other shows no field for it, so a login changed to Other and back shows its username again. A type with its own
// address (a GitHub App's api.github.com) fills an empty address field.
function wireVaultType(form, { username = '', isNew = true } = {}) {
  let kept = username;
  wireSecretFile(form);
  form.type.onchange = () => {
    if (form.username) kept = form.username.value;
    const secret = form.password.value;
    const t = VAULT_TYPES[vaultType(form.type.value)];
    $('[data-type-fields]', form).outerHTML = vaultTypeFields(form.type.value, { username: kept, isNew });
    form.password.value = secret;
    wireSecretFile(form);
    if (t.site && form.site && !form.site.value.trim()) form.site.value = t.site;
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
      <div><h1 title="${esc(bw.configured ? tr("Your Bitwarden's bot-dot folder: logins, cards, identities, SSH keys and files your bots can use without ever seeing them.") : tr('Saved logins your bots can use without ever seeing the password.'))}">${tr('Vault')}</h1></div>
      ${locked ? '' : `<div class="vault-add">${bw.unlocked ? `<button class="btn" id="add-file">＋ ${tr('File')}</button><button class="btn" id="add-ssh-key">＋ ${tr('SSH key')}</button>` : ''}<button class="btn primary" id="add-login">＋ ${tr('Add')}</button></div>`}
    </div>
    ${!bw.configured ? (bw.installed === false ? `<div class="req-note">${tr('To use Bitwarden, install its command-line tool first: {command}, then reload.', { command: '<span class="mono">brew install bitwarden-cli</span>' })}</div>` : bitwardenSetupHTML()) : `
    <div class="card bw-bar">
      <span>🛡 Bitwarden · ${esc(bw.email || bw.server || '')} · ${bw.unlocked ? `${tr('unlocked')} · ${trn(bw.items, '{n} item in bot-dot', '{n} items in bot-dot')}${bw.lastSync ? ` · ${tr('synced {ago}', { ago: esc(ago(bw.lastSync)) })}` : ''}` : `<b>${tr('locked')}</b>`}</span>
      <span class="grow"></span>
      ${bw.unlocked ? `<button class="btn sm" id="bw-sync">${tr('Sync')}</button><button class="btn sm" id="bw-lock">${tr('Lock')}</button>` : `<button class="btn sm primary" id="bw-unlock-btn">${tr('Unlock')}</button>`}
    </div>
    ${bw.error ? `<div class="req-note">${esc(bw.error)}</div>` : ''}`}
    ${locked ? `<div class="card empty"><div class="big">🔐</div>${tr('Unlock Bitwarden to see what bots can use.')}</div>` : `
    ${logins.length ? `<div class="grid">${logins.map((l) => {
      const kind = l.kind || 'login';
      const line = kind === 'card' ? `💳 ${esc(l.brand || tr('Card'))} •••• ${esc(l.last4)}${l.expiry ? ` · ${tr('expires {date}', { date: esc(l.expiry) })}` : ''} · ${tr('you approve each payment')}`
        : kind === 'identity' ? `🪪 ${esc(l.holder || '')}${l.email ? ` · ${esc(l.email)}` : ''}`
        : kind === 'ssh-key' ? vaultSshKeyLine(l)
        : kind === 'file' ? vaultFileLine(l)
        : vaultItemLine(l);
      return `
      <article class="card vault-item">
        <div class="bot-head"><div class="avatar" style="--bot-color:#6c7cff">${KIND_ICON[kind] || '🔑'}</div>
          <div style="flex:1;min-width:0"><div class="bot-name">${esc(l.name)}</div><div class="addr">${kind === 'login' ? vaultItemAddr(l) : kind === 'card' ? tr('Payment card') : kind === 'ssh-key' ? tr('SSH key') : kind === 'file' ? tr('File') : tr('Identity')}</div></div></div>
        <div class="bot-meta">
          <div>${line}</div>
          ${l.reprompt ? `<div class="faint">${tr("Asks for the master password again in Bitwarden, so bots can't use it.")}</div>` : ''}
          <div>${l.allowedBots.length ? tr('Can be used by: {bots}', { bots: l.allowedBots.map((id) => esc(botName(id))).join(', ') }) : `<span class="faint">${tr('No bot may use it yet')}</span>`}</div>
          ${(l.placedIn || []).map((f) => `<div class="vault-placed">📍 ${f.written === false ? tr('Allowed, not written yet: {path}', { path: `<span class="mono">${esc(f.where)}</span>` }) : tr('Placed in {path}', { path: `<span class="mono">${esc(f.where)}</span>` })} (${esc(botName(f.botId))}${f.at ? `, ${esc(ago(f.at))}` : ''}) <button class="btn sm" data-remove-file="${esc(f.id)}" data-where="${esc(f.where)}">${tr('Remove the file')}</button></div>`).join('')}
        </div>
        <div class="bot-actions"><button class="btn" data-edit-login="${esc(l.id)}">${kind === 'login' ? tr('Edit') : tr('Bots…')}</button></div>
      </article>`;
    }).join('')}</div>`
      : `<div class="card empty"><div class="big">🔐</div>${bw.configured ? tr('Nothing in the bot-dot folder yet. Move the logins, cards and identities bots may use into that folder in Bitwarden, or add a login here.') : tr('No saved logins yet. Add one so a bot can sign in to a site for you.')}</div>`}`}`;
  const add = $('#add-login');
  if (add) add.onclick = () => openLoginEditor();
  const addKey = $('#add-ssh-key');
  if (addKey) addKey.onclick = () => openSshKeyEditor();
  const addFile = $('#add-file');
  if (addFile) addFile.onclick = () => openFileEditor();
  $$('[data-edit-login]').forEach((b) => (b.onclick = () => {
    const l = logins.find((x) => x.id === b.dataset.editLogin);
    return (l.kind || 'login') === 'login' ? openLoginEditor(l) : openItemBots(l);
  }));
  // A secret kept in a file (#253): botdot deletes it where it wrote it, and the bot must ask on a card to write it again.
  $$('[data-remove-file]').forEach((b) => (b.onclick = () => {
    if (!confirm(tr("Remove {path}? The bot can't write it again without asking you on a card.", { path: b.dataset.where }))) return;
    whileBusy(b, tr('Removing…'), async () => {
      try { const r = await api(`/vault/secret-files/${encodeURIComponent(b.dataset.removeFile)}`, { method: 'DELETE' }); toast(r?.say || tr('Removed'), !!r?.byHand); } catch (e) { toast(e.message, true); }
      renderVault();
    });
  }));
  wireBitwardenSetup(root);
  const u = $('#bw-unlock-btn'); if (u) u.onclick = () => { if (!bwUi.unlocking) openUnlock(); };
  // Lock and Sync run on with the corner pill (#478), and the Vault is drawn again when they end.
  const lk = $('#bw-lock'); if (lk) lk.onclick = async () => { await inBackground(tr('Locking…'), () => api('/vault/bitwarden/lock', { method: 'POST' }), { ok: tr('Locked') }); bwUi.prompted = true; renderVault(); showBitwardenBanner(); };
  const sy = $('#bw-sync'); if (sy) sy.onclick = async () => { await inBackground(tr('Syncing…'), () => api('/vault/bitwarden/sync', { method: 'POST' }), { ok: tr('Synced'), retry: () => sy.click() }); renderVault(); };
}

// onSaved(entry): a new login saved, as the Vault answers it (a project's Logins adds it there, #804).
function openLoginEditor(login, { onSaved } = {}) {
  const isNew = !login;
  const l = login || { name: '', site: '', username: '', allowedBots: [] };
  const m = openModal(`
    <form id="login-form" autocomplete="off">
      <div class="modal-head"><h2>${isNew ? tr('Add to the Vault') : esc(tr('Edit {name}', { name: l.name }))}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        ${vaultTypeControl(l.type)}
        <div class="row">
          <label class="field">${tr('Name')}<input type="text" name="name" value="${esc(l.name)}" placeholder="${esc(tr('e.g. Recipes'))}"></label>
          <label class="field" title="${esc(tr('The secret is only used with this address'))}">${tr('Website or server')}<input type="text" name="site" value="${esc(l.site)}" placeholder="recipes.example.com or pve.example.ts.net" required></label>
        </div>
        ${vaultTypeFields(l.type, { username: l.username, isNew })}
        <label class="field" title="${esc(tr('Only these hosts may receive this login. Subdomains are not included automatically.'))}">${tr('Additional exact hosts')}<input name="allowedHosts" value="${esc((l.allowedHosts || []).join(', '))}" placeholder="api.example.com, auth.example.com"></label>
        <label class="toggle" title="${esc(tr('For your own servers, e.g. Proxmox or a NAS'))}"><input type="checkbox" name="insecureTls" ${l.insecureTls ? 'checked' : ''}> ${tr('Accept a self-signed certificate')}</label>
        <label class="toggle"><input type="checkbox" name="inComputer" ${l.inComputer ? 'checked' : ''}> ${tr('Usable in its computer')} <span class="hint muted" style="font-weight:400">${tr("bots may use it in a command on the account's computer, e.g. for Proton Bridge there. Every bot on that computer could then read it: only for secrets that guard something on it")}</span></label>
        <div class="req-note">${tr('Bots can use this login to sign in on the website, or to call its API: they write {username} and {password} in the request and botdot fills them in, so they never see the secret.', { username: '<span class="mono">{{username}}</span>', password: '<span class="mono">{{password}}</span>' })}</div>
        <fieldset>
          <legend>${tr('Bots that may use it')}</legend>
          <div class="tool-toggles">${state.bots.map((b) => `<label title="${b.computer === 'linux' ? '' : esc(tr('This bot has no computer, so it can’t sign in to websites'))}"><input type="checkbox" name="bot" value="${esc(b.id)}" ${l.allowedBots.includes(b.id) ? 'checked' : ''}>${botLabel(b)}${b.computer === 'linux' ? '' : ` <span class="faint">${tr('(no computer)')}</span>`}</label>`).join('')}</div>
        </fieldset>
        <div class="req-error" role="alert" hidden></div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : `<button type="button" class="btn danger left" id="delete-login">${tr('Delete')}</button>`}
        <button type="button" class="btn" data-dismiss>${tr('Cancel')}</button>
        <button class="btn primary" type="submit">${tr('Save')}</button>
      </div>
    </form>`);
  const form = $('#login-form', m);
  wireVaultType(form, { username: l.username, isNew });
  const del = $('#delete-login', m);
  if (del) del.onclick = () => {
    if (!confirm(state.bw?.configured ? tr("Delete \"{name}\"? It moves to Bitwarden's trash, where you can restore it for 30 days.", { name: l.name }) : tr('Delete "{name}" from the Vault?', { name: l.name }))) return;
    whileBusy(del, tr('Deleting…'), async () => {
      try {
        await api(`/vault/${l.id}`, { method: 'DELETE' });
        m.close();
        toast(tr('Deleted'));
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
    // The editor goes away at once (#478). Refused: it comes back with the server's sentence and what was typed,
    // except the secret.
    let saved = null;
    if (await setAside(m, tr('Saving…'), () => api(isNew ? '/vault' : `/vault/${l.id}`, { method: isNew ? 'POST' : 'PUT', body }).then((r) => (saved = r)),
      { ok: state.bw?.configured ? (isNew ? tr('Saved to Bitwarden (bot-dot folder)') : tr('Saved in Bitwarden')) : tr('Saved') })) { renderVault(); if (onSaved && saved?.id) onSaved(saved); }
  };
}

// ---------- Bitwarden ----------

const bwUi = { prompted: false, snoozed: new Set() };
const KIND_ICON = { login: '🔑', card: '💳', identity: '🪪', 'ssh-key': '🗝️', file: '📄' };
// What sharing a file means (#157): it is written in the computer for the length of one command.
const FILE_SHARE_NOTE = tr("Bots that may use this file in a command on the account's computer. botdot puts it there for that one command and removes it afterwards, but every bot on that computer could read it meanwhile.");
// What sharing a card, an identity, an SSH key or a file lets a bot do, above its bots.
const ITEM_BOTS_HINT = {
  card: tr('Bots that may pay with this card. You still approve every payment in a pop-up.'),
  identity: tr('Bots that may type these details into forms.'),
  'ssh-key': tr("Bots that may use this key for SSH from the account's computer. botdot loads it into an ssh-agent there for one command: no file holds the key, but every bot on that computer could read it meanwhile."),
  file: FILE_SHARE_NOTE,
};

function bitwardenSetupHTML() {
  return `
    <div class="card setup-card">
      <h3>${tr('Use your Bitwarden')}</h3>
      <p class="muted" style="margin:0">${tr('Bots will use the logins, payment cards and identities in a folder called {folder} in your Bitwarden, and nothing else in it.', { folder: '<b>bot-dot</b>' })}
      ${tr('You approve every card payment in a pop-up. Your master password is only used to unlock (after each restart of botdot) and is never saved.')}</p>
      <ol>
        <li>${tr('In the Bitwarden web vault, open {path}.', { path: '<b>Settings → Security → Keys → View API key</b>' })}</li>
        <li>${tr('Copy the {id} and {secret} here.', { id: '<b>client_id</b>', secret: '<b>client_secret</b>' })}</li>
      </ol>
      <form id="bw-setup" autocomplete="off" style="display:grid;gap:10px">
        <div class="row">
          <label class="field">${tr('Server')}<select name="server"><option value="us">bitwarden.com (US)</option><option value="eu">bitwarden.eu (EU)</option><option value="custom">${tr('Self-hosted…')}</option></select></label>
          <label class="field hidden" id="bw-url-field">${tr('Address')}<input type="text" name="serverUrl" placeholder="https://vault.example.com"></label>
        </div>
        <div class="row">
          <label class="field">client_id<input type="text" name="clientId" placeholder="user.xxxxxxxx-…" autocomplete="off" spellcheck="false"></label>
          <label class="field">client_secret<input type="password" name="clientSecret" autocomplete="new-password"></label>
        </div>
        <div><button class="btn primary">${tr('Connect Bitwarden')}</button></div>
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
    btn.disabled = true; btn.textContent = tr('Connecting…');
    try {
      await api('/vault/bitwarden/setup', { method: 'POST', body: { server: f.server.value, serverUrl: f.serverUrl.value, clientId: f.clientId.value, clientSecret: f.clientSecret.value } });
      f.clientSecret.value = '';
      toast(tr('Connected. Now unlock it.'));
      state.bw = await api('/vault/bitwarden');
      openUnlock();
      renderVault();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = tr('Connect Bitwarden'); }
  };
}

function openUnlock(reason = '') {
  const s = state.bw || {};
  const m = openModal(`
    <form id="bw-unlock" autocomplete="off">
      <div class="modal-head"><h2>🔐 ${tr('Unlock Bitwarden')}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${reason ? `${esc(reason)} ` : ''}${tr("Bots can use the {folder} folder of {vault} once it's unlocked. It stays unlocked until botdot restarts or you lock it.", { folder: '<b>bot-dot</b>', vault: esc(s.email || tr('your vault')) })}</p>
        <label class="field">${tr('Master password')}<input type="password" name="password" autocomplete="current-password" required></label>
        <div class="req-note">🛡 ${tr("Used once to unlock and then forgotten: it isn't saved, and the AI never sees it.")}</div>
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>${tr('Not now')}</button><button class="btn primary">${tr('Unlock')}</button></div>
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
  unlockPill('busy', tr('Unlocking Password Manager…'));
  try {
    const r = await api('/vault/bitwarden/unlock', { method: 'POST', body: { password } });
    state.bw = { ...state.bw, ...r };
    unlockPill('ok', r.moved ? trn(r.moved, 'Unlocked. Moved {n} saved login into Bitwarden.', 'Unlocked. Moved {n} saved logins into Bitwarden.') : tr('Unlocked'));
    showBitwardenBanner();
    if (state.view === 'vault') renderVault();
  } catch (err) {
    unlockPill('err', /not right/i.test(err.message) ? tr('Wrong master password') : err.message);
  } finally { bwUi.unlocking = false; }
}

// The corner pill (app.js); tapping an error opens the unlock dialog again unless `retry` says otherwise.
const unlockPill = (kind, text, retry = () => openUnlock()) => cornerPill(kind, text, retry);

async function pollBitwarden() {
  bwUi.polledAt = Date.now();
  try { state.bw = await api('/vault/bitwarden'); } catch { return; }
  showBitwardenBanner();
  const s = state.bw;
  if (!s.configured || s.unlocked || bwUi.unlocking || $('#modal').open) return;
  // Right after a restart, and whenever a bot is waiting for a login.
  if (s.wantedBy && !bwUi.snoozed.has(s.wantedBy.id)) { bwUi.snoozed.add(s.wantedBy.id); return openUnlock(tr('{name} needs a saved login.', { name: s.wantedBy.name })); }
  if (!bwUi.prompted) { bwUi.prompted = true; openUnlock(); }
}

function showBitwardenBanner() { showNeeds(); }

// A bot wants to pay: the owner approves this card on this site (for this run, 15 minutes).
function openCardApproval(r) {
  loginReq.shown = r.id;
  const m = openModal(`
    <div class="modal-head"><h2>💳 ${tr('{name} wants to pay', { name: botLabel(r.bot) })}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <div class="req-site">
        <div class="muted" style="font-size:12.5px">${tr('On')}</div>
        <div class="site">${esc(r.site)}</div>
        <div class="muted" style="font-size:12.5px">${r.card?.name ? tr('with {card}', { card: esc(r.card.name) }) : tr('with a card')}${r.card?.last4 ? ` (${esc(r.card.brand || tr('card'))} •••• ${esc(r.card.last4)})` : ''}</div>
      </div>
      ${r.amount ? `<div class="req-reason"><span class="muted">${tr('Amount:')}</span> <b>${esc(r.amount)}</b></div>` : ''}
      ${r.reason ? `<div class="req-reason"><span class="muted">${tr('The bot says:')}</span> “${esc(r.reason)}”</div>` : ''}
      <div class="req-note">${tr("If you approve, botdot types the card details into the bot's browser on this site only (the bot never sees them). This covers this run on {site} for 15 minutes. Only approve a purchase you asked for, and check the site is the one you expect.", { site: esc(r.site) })}</div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn danger left" id="card-decline">${tr('Decline')}</button>
      <button type="button" class="btn" id="card-later">${tr('Later')}</button>
      <button type="button" class="btn primary" id="card-approve">${tr('Approve payment')}</button>
    </div>`);
  m.dataset.request = r.id;
  const answer = async (action) => {
    try {
      await api(`/vault/requests/${r.id}`, { method: 'POST', body: { action } });
      m.close();
      toast(action === 'approve' ? tr('Approved. {name} will continue.', { name: r.bot.name }) : tr('Declined'));
    } catch (e) { toast(e.message, true); }
  };
  $('#card-approve', m).onclick = () => whileBusy($('#card-approve', m), tr('Approving…'), () => answer('approve'));
  $('#card-decline', m).onclick = () => whileBusy($('#card-decline', m), tr('Declining…'), () => answer('decline'));
  $('#card-later', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  $('[data-dismiss]', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  m.addEventListener('close', () => { loginReq.shown = null; delete m.dataset.request; pollLoginRequests(); }, { once: true });
}

function openItemBots(item) {
  const m = openModal(`
    <form id="item-bots">
      <div class="modal-head"><h2>${KIND_ICON[item.kind] || '🔑'} ${esc(item.name)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${ITEM_BOTS_HINT[item.kind] || ITEM_BOTS_HINT.identity} ${tr('Change the details themselves in Bitwarden.')}</p>
        ${botCheckboxes(item.allowedBots).replaceAll(SKILLS_OFF_ATTR(), '')}
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>${tr('Cancel')}</button><button class="btn primary">${tr('Save')}</button></div>
    </form>`);
  $('#item-bots', m).onsubmit = async (e) => {
    e.preventDefault();
    const allowedBots = $$('input[name=bot]:checked', m).map((c) => c.value);
    if (await setAside(m, tr('Saving…'), () => api(`/vault/${item.id}`, { method: 'PUT', body: { allowedBots } }))) renderVault();
  };
}

// An SSH key the owner adds (#160, docs/api.md `POST /api/vault/ssh-keys`): an OpenSSH private key pasted or read from
// its file, or a new one botdot makes. The private key goes to the server once and is never shown again; the public
// key comes back, with a copy button, for a server's authorized_keys.
// onSaved(key): told of the key once it is saved, as the login editor's is (#808).
function openSshKeyEditor({ onSaved } = {}) {
  const m = openModal(`
    <form id="ssh-key-form" autocomplete="off">
      <div class="modal-head"><h2>🗝️ ${tr('Add an SSH key')}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <label class="field">${tr('Name')}<input type="text" name="name" placeholder="${esc(tr('e.g. Home servers'))}" maxlength="100" required></label>
        <label class="field" title="${esc(tr('OpenSSH format, without a passphrase'))}">${tr('Private key')}<textarea name="privateKey" class="mono" rows="6" spellcheck="false" autocapitalize="off" placeholder="${esc(tr('Leave empty to generate a new key'))}"></textarea></label>
        <label class="field">${tr('Or pick its file')} <input type="file" name="keyFile"></label>
        <div class="req-note">${tr("Saved in your Bitwarden's bot-dot folder as an SSH key. Bots use it for SSH from the account's computer and never see it, and you can't see it here again.")}</div>
        <fieldset>
          <legend>${tr('Bots that may use it')}</legend>
          <div class="tool-toggles">${state.bots.map((b) => `<label><input type="checkbox" name="bot" value="${esc(b.id)}">${botLabel(b)}</label>`).join('')}</div>
        </fieldset>
        <div class="req-error" role="alert" hidden></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>${tr('Cancel')}</button>
        <button class="btn primary" type="submit">${tr('Generate new key')}</button>
      </div>
    </form>`);
  const form = $('#ssh-key-form', m);
  const submit = $('button[type=submit]', form);
  const label = () => { submit.textContent = form.privateKey.value.trim() ? tr('Add key') : tr('Generate new key'); };
  form.privateKey.oninput = label;
  form.keyFile.onchange = async () => {
    const file = form.keyFile.files[0];
    form.keyFile.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) { toast(tr('That file is too big for an SSH private key.'), true); return; }
    form.privateKey.value = await file.text();
    if (!form.name.value.trim()) form.name.value = file.name;
    label();
  };
  // Closed, the key is forgotten; set aside while it saves (#478), it stays until the server answers.
  let aside = false;
  const forget = () => { if (aside) return; form.privateKey.value = ''; m.removeEventListener('close', forget); };
  m.addEventListener('close', forget);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const refused = $('.req-error', form);
    refused.hidden = true;
    const privateKey = form.privateKey.value.trim();
    const body = { name: form.name.value.trim(), allowedBots: $$('input[name=bot]:checked', form).map((c) => c.value), ...(privateKey ? { privateKey } : { generate: true }) };
    // The editor goes away at once (#478); its public key opens once it is saved. Refused: it comes back with
    // the server's sentence and what was given.
    aside = true;
    let key = null;
    const saved = await setAside(m, privateKey ? tr('Adding the key…') : tr('Generating a key…'), async () => { key = await api('/vault/ssh-keys', { method: 'POST', body }); },
      { ok: privateKey ? tr('Key added') : tr('Key made') });
    aside = false;
    body.privateKey = null;
    if (!saved) return;
    form.privateKey.value = '';
    renderVault();
    onSaved?.(key);
    // Its public key opens now, or once the dialog opened meanwhile closes.
    const modal = $('#modal');
    if (!modal.open) openSshPublicKey(key, !privateKey);
    else modal.addEventListener('close', () => openSshPublicKey(key, !privateKey), { once: true });
  };
}

// The public key of the SSH key just added, to copy into a server's authorized_keys.
function openSshPublicKey(key, generated) {
  const m = openModal(`
    <div class="modal-head"><h2>🗝️ ${esc(key.name)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <p class="muted wrap-any" style="margin:0">${generated ? tr('botdot made this key and saved it in Bitwarden.') : tr('Saved in Bitwarden.')} ${tr('To let it in, add its public key to {file} on the server.', { file: '<span class="mono">~/.ssh/authorized_keys</span>' })}</p>
      <label class="field">${tr('Public key')}<textarea class="mono" rows="4" readonly>${esc(key.publicKey)}</textarea></label>
      <div class="faint wrap-any">${esc(key.fingerprint)}</div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-dismiss>${tr('Done')}</button><button type="button" class="btn primary" id="copy-public-key">${tr('Copy public key')}</button></div>`);
  $('#copy-public-key', m).onclick = async () => toast((await copyText(key.publicKey)) ? tr('Copied') : tr("Couldn't copy"));
}

// A file the owner adds (#157, docs/api.md `POST /api/vault/files`): any file picked here (#231), at most 64 KB, read in the page
// and sent once as base64. Only its name and size are shown again.
const VAULT_FILE_MAX = 64 * 1024;
function openFileEditor() {
  const m = openModal(`
    <form id="file-form" autocomplete="off">
      <div class="modal-head"><h2>📄 ${tr('Add a file')}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <label class="field">${tr('File')} <span class="hint">${tr('any file, at most 64 KB')}</span><input type="file" name="file" required></label>
        <label class="field">${tr('Name')}<input type="text" name="name" placeholder="${esc(tr("Optional: the file's name"))}" maxlength="100"></label>
        <div class="req-note">${tr("Saved in your Bitwarden's bot-dot folder. Bots never see what is in it, and you can't see it here again.")}</div>
        <fieldset>
          <legend>${tr('Bots that may use it')}</legend>
          <p class="muted" style="margin:0 0 6px">${esc(FILE_SHARE_NOTE)}</p>
          <div class="tool-toggles">${state.bots.map((b) => `<label><input type="checkbox" name="bot" value="${esc(b.id)}">${botLabel(b)}</label>`).join('')}</div>
        </fieldset>
        <div class="req-error" role="alert" hidden></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>${tr('Cancel')}</button>
        <button class="btn primary" type="submit">${tr('Add file')}</button>
      </div>
    </form>`);
  const form = $('#file-form', m);
  const refused = $('.req-error', form);
  const refuse = (text) => { refused.textContent = text; refused.hidden = false; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    refused.hidden = true;
    const file = form.file.files[0];
    if (!file) return refuse(tr('Pick the file.'));
    if (file.size > VAULT_FILE_MAX) return refuse(tr('That file is {size} KB. A file in the Vault can be at most 64 KB.', { size: Math.ceil(file.size / 1024) }));
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const body = { name: form.name.value.trim(), fileName: file.name, content: btoa(binary), allowedBots: $$('input[name=bot]:checked', form).map((c) => c.value) };
    // The editor goes away at once (#478). Refused: it comes back with the server's sentence and the file picked.
    const saved = await setAside(m, tr('Adding the file…'), () => api('/vault/files', { method: 'POST', body }));
    body.content = null;
    if (!saved) return;
    form.file.value = '';
    renderVault();
  };
}
