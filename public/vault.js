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
  return `${t.username ? `${t.icon} ${esc(l.username || t.none)} · ` : ''}🔒 ${t.saved}${l.hasTotp ? ` · ${tr('two-step code')}` : ''}`;
}
// An SSH key of Bitwarden (kind `ssh-key`, docs/api.md): its fingerprint, and that bots use it without seeing it.
const vaultSshKeyLine = (l) => `${l.fingerprint ? `${esc(l.fingerprint)} · ` : ''}🔒 ${tr("for SSH on a bot's computer, never shown to it")}`;
// A file of Bitwarden (kind `file`, #157): its file name and size, and that bots use it without seeing it.
const vaultFileSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toLocaleString(I18n.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`);
const vaultFileLine = (l) => `${esc(l.fileName || '')} · ${vaultFileSize(Number(l.size) || 0)} · 🔒 ${tr("for one command on a bot's computer, never shown to it")}`;

// The Type control, and the fields that hold the secret of a type, in the editor and in the "needs a login"
// dialog. username: what the username field starts with. isNew: a new item needs its secret; a saved one
// keeps it when the field is left empty. Other has the secret alone.
const vaultTypeControl = (type) => (!advanced() && vaultType(type) === 'login' ? '<input type="hidden" name="type" value="login">' : `<label class="field">${tr('Type')}<select name="type">${Object.entries(VAULT_TYPES).map(([value, t]) => `<option value="${value}"${value === vaultType(type) ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>`);
function vaultTypeFields(type, { username = '', isNew = true } = {}) {
  const t = VAULT_TYPES[vaultType(type)];
  // What a field means beyond its label is its tooltip, not a line beside it (#1190).
  const keep = isNew ? ' required' : ` placeholder="••••••••" title="${esc(tr('leave empty to keep the current one'))}"`;
  const secret = t.multiline
    ? `<label class="field">${t.secret}<span class="secret-input"><textarea name="password" class="mono masked" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false"${keep}></textarea>${revealButton()}</span></label><label class="field">${tr('Or pick its file')}<input type="file" name="secretFile"></label>`
    : `<label class="field">${t.secret}<span class="secret-input"><input type="password" name="password" autocomplete="new-password"${keep}>${revealButton()}</span></label>`;
  const about = [t.optional ? tr('optional') : '', t.hint || ''].filter(Boolean).join(', ');
  const user = t.username ? `<label class="field">${t.username}<input type="text" name="username" value="${esc(username)}"${about ? ` title="${esc(about)}"` : ''} autocomplete="off" autocapitalize="off" spellcheck="false"></label>` : '';
  // A secret of several lines takes the form's width, under its username.
  return `<div class="row${!t.username || t.multiline ? ' one' : ''}" data-type-fields>${user}${secret}</div>`;
}

// Show and Hide beside a secret the owner types: they see what they typed. One listener on the form, for its field
// also when it is drawn again for another type (wireVaultType).
const revealButton = () => `<button type="button" class="btn sm ghost" data-reveal aria-pressed="false">${tr('Show')}</button>`;
function revealOnClick(e) {
  const button = e.target.closest?.('[data-reveal]');
  if (!button) return;
  e.preventDefault();
  const field = button.parentElement.querySelector('input, textarea');
  const shown = button.getAttribute('aria-pressed') !== 'true';
  if (field.tagName === 'TEXTAREA') field.classList.toggle('masked', !shown); else field.type = shown ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(shown));
  button.textContent = shown ? tr('Hide') : tr('Show');
}

// A secret of several lines read from its file, as it is: its line breaks too.
function wireSecretFile(form) {
  if (!form.secretFile) return;
  form.secretFile.onchange = async () => {
    const file = form.secretFile.files[0];
    form.secretFile.value = '';
    if (!file) return;
    if (file.size > SECRET_FILE_MAX) { toast(tr('That file is too big for Passwords (64 KB at most).'), true); return; }
    form.password.value = await file.text();
  };
}

// The fields follow the Type control at once. What was typed stays: the secret, and the username also while
// Other shows no field for it, so a login changed to Other and back shows its username again. A type with its own
// address (a GitHub App's api.github.com) fills an empty address field.
function wireVaultType(form, { username = '', isNew = true } = {}) {
  let kept = username;
  form.addEventListener('click', revealOnClick);
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

// Passwords gets a search field once its list is longer than this, like the bot picker (groups.js).
const VAULT_SEARCH = 8;
const vaultUi = { query: '', items: [] };
// Whether an item is one the words searched for name: every word in its name, address, username, the hosts it
// may be used on, a card's brand and last digits, an identity's holder and e-mail, a file's name, or its category.
function vaultItemMatches(l, q) {
  if (!l) return false;
  const hay = [l.name, l.site, l.username, ...(l.allowedHosts || []), l.brand, l.last4, l.holder, l.email, l.fileName, l.category].map((v) => String(v ?? '').toLowerCase());
  return String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.some((h) => h.includes(w)));
}

// The list in its categories (ADR 213): the items without one first, then each category in alphabetical order, each
// group's items in the order the Vault lists them. test/fixtures/vault-search.json holds the cases Android checks too.
function vaultGroups(items) {
  const groups = new Map([['', []]]);
  for (const l of items) { const c = String(l.category || ''); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(l); }
  return [...groups].filter(([c, list]) => c !== '' || list.length)
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, undefined, { sensitivity: 'base' })))
    .map(([category, list]) => ({ category, items: list }));
}
// The categories in use, for the editors' suggestions.
const vaultCategories = () => vaultGroups(vaultUi.items).map((g) => g.category).filter(Boolean);
// The Category field of an editor, with the categories in use to pick from.
const vaultCategoryField = (category = '') => `<label class="field">${tr('Category')}<input type="text" name="category" value="${esc(category)}" list="vault-categories" maxlength="40" autocomplete="off"><datalist id="vault-categories">${vaultCategories().map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>`;
// The categories the owner folded, in this browser only.
const vaultFolded = new Set((() => { try { return JSON.parse(localStorage.getItem('vault-folded') || '[]'); } catch { return []; } })());
function saveVaultFolded() { try { localStorage.setItem('vault-folded', JSON.stringify([...vaultFolded])); } catch { /* private window */ } }

async function renderVault() {
  const root = $('#view-vault');
  root.dataset.ready = '1';
  let logins = [];
  try { [logins, state.bw] = await Promise.all([api('/vault'), api('/vault/bitwarden')]); } catch (e) { toast(e.message, true); }
  if (state.view !== 'vault') return;
  vaultUi.items = logins;
  const bw = state.bw || {};
  const botName = (id) => { const b = state.bots.find((x) => x.id === id); return b ? `${b.name}` : id; };
  const locked = bw.configured && !bw.unlocked;
  // One list like Settings (#1190): Bitwarden is a row, every item a row that opens it, a file a bot placed a row
  // with its Remove. What an item holds is on its row's tooltip and in its editor, not under its name.
  const kindLabel = (kind) => (kind === 'card' ? tr('Payment card') : kind === 'ssh-key' ? tr('SSH key') : kind === 'file' ? tr('File') : tr('Identity'));
  const row = (l) => {
    const kind = l.kind || 'login';
    const line = kind === 'card' ? `💳 ${esc(l.brand || tr('Card'))} •••• ${esc(l.last4)}${l.expiry ? ` · ${tr('expires {date}', { date: esc(l.expiry) })}` : ''} · ${tr('you approve each payment')}`
      : kind === 'identity' ? `🪪 ${esc(l.holder || '')}${l.email ? ` · ${esc(l.email)}` : ''}`
      : kind === 'ssh-key' ? vaultSshKeyLine(l)
      : kind === 'file' ? vaultFileLine(l)
      : vaultItemLine(l);
    const about = `${kind === 'login' ? vaultItemAddr(l) : kindLabel(kind)} · ${line}${l.allowedBots.length ? ` · ${tr('Can be used by: {bots}', { bots: l.allowedBots.map((id) => esc(botName(id))).join(', ') })}` : ''}`;
    const value = l.reprompt ? `<span class="bs-val bs-warn">${tr("Bots can't use it")}</span>`
      : kind !== 'login' && !l.allowedBots.length ? `<span class="bs-val bs-warn">${tr('No bot yet')}</span>`
      : `<span class="bs-val">${esc(kind === 'card' ? `•••• ${l.last4 || ''}` : kind === 'identity' ? l.holder || '' : kind === 'ssh-key' ? tr('SSH key') : kind === 'file' ? l.fileName || '' : l.site || '')}</span>`;
    return `<button type="button" class="bs-row bs-link vault-item" data-edit-login="${esc(l.id)}" title="${about.replace(/\p{Extended_Pictographic}\uFE0F?\s?/gu, '').replace(/"/g, '&quot;')}" aria-label="${esc(kind === 'login' ? tr('Edit {name}', { name: l.name }) : `${l.name}: ${tr('Bots…')}`)}"><b>${esc(l.name)}</b>${value}${CHEV}</button>`;
  };
  const placed = logins.flatMap((l) => (l.placedIn || []).map((f) => ({ ...f, item: l.name })));
  root.innerHTML = `
    ${subBack()}
    <div class="section-head">
      <div><h1 title="${esc(bw.configured ? tr("Your Bitwarden's bot-dot folder: logins, cards, identities, SSH keys and files your bots can use without ever seeing them.") : tr('Saved logins your bots can use without ever seeing the password.'))}">${tr('Passwords')}</h1></div>
      ${locked ? '' : `<div class="vault-add">${bw.unlocked && advanced() ? `<button class="btn" id="add-file">＋ ${tr('File')}</button><button class="btn" id="add-ssh-key">＋ ${tr('SSH key')}</button>` : ''}<button class="btn primary" id="add-login">＋ ${tr('Add')}</button></div>`}
    </div>
    ${!bw.configured ? (bw.installed === false ? `<div class="req-note">${tr('To use Bitwarden, install its command-line tool first: {command}, then reload.', { command: '<span class="mono">brew install bitwarden-cli</span>' })}</div>` : bitwardenSetupHTML()) : `
    <div class="set-list"><div class="bs-row bw-bar">
      <b>Bitwarden</b>
      <span class="bs-val${bw.unlocked ? '' : ' bs-warn'}" title="${esc(bw.unlocked && bw.lastSync ? tr('synced {ago}', { ago: ago(bw.lastSync) }) : '')}">${bw.unlocked ? `${esc(bw.email || bw.server || '')} · ${trn(bw.items, '{n} item', '{n} items')}` : tr('locked')}</span>
      ${bw.unlocked ? `<button class="btn sm" id="bw-sync">${tr('Sync')}</button><button class="btn sm" id="bw-lock">${tr('Lock')}</button>` : `<button class="btn sm primary" id="bw-unlock-btn">${tr('Unlock')}</button>`}
    </div></div>
    ${bw.error ? `<div class="req-note">${esc(bw.error)}</div>` : ''}`}
    ${!locked && logins.length > VAULT_SEARCH ? `<input type="search" id="vault-search" class="vault-search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${tr('Search')}" aria-label="${tr('Search')}" value="${esc(vaultUi.query)}">` : ''}
    ${locked ? '' : logins.length ? `${vaultGroups(logins).map((g) => `<section class="vault-group" data-cat="${esc(g.category)}">${g.category ? `<button type="button" class="vault-cat" aria-expanded="${!vaultFolded.has(g.category)}"><b>${esc(g.category)}</b>${CHEV}</button>` : ''}<div class="set-list vault-list"${vaultFolded.has(g.category) ? ' hidden' : ''}>${g.items.map(row).join('')}</div></section>`).join('')}<div class="set-empty" id="vault-none" hidden>${tr('No matches')}</div>${placed.length ? `<div class="set-list vault-placed">${placed.map((f) => `<div class="bs-row"><b class="mono" title="${esc(f.item)}">${esc(f.where)}</b><span class="bs-val">${f.written === false ? tr('not written yet') : `${esc(botName(f.botId))}${f.at ? ` · ${esc(ago(f.at))}` : ''}`}</span><button class="btn sm" data-remove-file="${esc(f.id)}" data-where="${esc(f.where)}">${tr('Remove the file')}</button></div>`).join('')}</div>` : ''}`
      : `<div class="set-empty">${bw.configured ? tr('The bot-dot folder is empty') : tr('No saved logins yet')}</div>`}`;
  // The search of a long list: the rows filter as you type, by name, address, username and the rest a row
  // stands for; what you typed stays when the page draws again after a save.
  // A folded category shows what a search finds in it, and a group with nothing found goes while the search is there.
  const search = $('#vault-search');
  const filter = () => {
    if (!search) return;
    vaultUi.query = search.value;
    const searching = !!search.value.trim();
    let left = 0;
    $$('.vault-group').forEach((group) => {
      let found = 0;
      $$('.vault-list [data-edit-login]', group).forEach((row) => {
        row.hidden = !vaultItemMatches(logins.find((x) => x.id === row.dataset.editLogin), search.value);
        if (!row.hidden) found++;
      });
      group.hidden = !found;
      $('.vault-list', group).hidden = !searching && vaultFolded.has(group.dataset.cat);
      left += found;
    });
    $('#vault-none').hidden = left > 0;
  };
  // A category's heading folds it, and the fold is kept for the next visit.
  $$('.vault-cat').forEach((head) => (head.onclick = () => {
    const group = head.closest('.vault-group');
    const cat = group.dataset.cat;
    const open = head.getAttribute('aria-expanded') !== 'true';
    if (open) vaultFolded.delete(cat); else vaultFolded.add(cat);
    saveVaultFolded();
    head.setAttribute('aria-expanded', String(open));
    $('.vault-list', group).hidden = !open && !(search && search.value.trim());
  }));
  if (search) {
    search.oninput = filter;
    search.onkeydown = (e) => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; filter(); } };
    filter();
  }
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
  $$('[data-remove-file]').forEach((b) => (b.onclick = async () => {
    if (!(await askFirst(tr("Remove {path}? The bot can't write it again without asking you on a card.", { path: b.dataset.where }), tr('Remove')))) return;
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
      <div class="modal-head"><h2>${isNew ? tr('Add to Passwords') : esc(tr('Edit {name}', { name: l.name }))}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        ${vaultTypeControl(l.type)}
        <div class="row">
          <label class="field">${tr('Name')}<input type="text" name="name" value="${esc(l.name)}" placeholder="${esc(tr('e.g. Recipes'))}"></label>
          <label class="field" title="${esc(tr('The secret is only used with this address'))}">${advanced() ? tr('Website or server') : tr('Website')}<input type="text" name="site" value="${esc(l.site)}" placeholder="${advanced() ? 'recipes.example.com or pve.example.ts.net' : 'recipes.example.com'}" required></label>
        </div>
        ${vaultTypeFields(l.type, { username: l.username, isNew })}
        ${vaultCategoryField(l.category)}
        <label class="field"${advanced() ? '' : ' style="display:none"'} title="${esc(tr('Only these hosts may receive this login. Subdomains are not included automatically.'))}">${tr('Additional exact hosts')}<input type="text" name="allowedHosts" value="${esc((l.allowedHosts || []).join(', '))}" placeholder="api.example.com, auth.example.com"></label>
        <div class="req-note"${advanced() ? '' : ' hidden'}>${tr('Bots can use this login to sign in on the website, or to call its API: they write {username} and {password} in the request and botdot fills them in, so they never see the secret.', { username: '<span class="mono">{{username}}</span>', password: '<span class="mono">{{password}}</span>' })}</div>
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
  if (del) del.onclick = async () => {
    if (!(await askFirst(state.bw?.configured ? tr("Delete \"{name}\"? It moves to Bitwarden's trash, where you can restore it for 30 days.", { name: l.name }) : tr('Delete "{name}" from Passwords?', { name: l.name }), tr('Delete')))) return;
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
      category: form.category.value.trim(),
      allowedHosts: form.allowedHosts.value.split(',').map((s) => s.trim()).filter(Boolean),
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

// Bitwarden not connected yet (#1190): one row of the Vault's list, which opens its form and a link to where the
// API key is, in the web vault of the server picked.
const BW_KEYS = { us: 'https://vault.bitwarden.com/#/settings/security/security-keys', eu: 'https://vault.bitwarden.eu/#/settings/security/security-keys' };
function bitwardenSetupHTML() {
  return `
    <div class="set-list"><details class="bs-row bs-more" id="bw-connect">
      <summary title="${esc(tr('Bots will use the logins, payment cards and identities in a folder called {folder} in your Bitwarden, and nothing else in it.', { folder: 'bot-dot' }))}"><b>Bitwarden</b><span class="bs-val">${tr('Not connected')}</span>${CHEV}</summary>
      <form id="bw-setup" class="bs-body" autocomplete="off">
        <div class="row">
          <label class="field">${tr('Server')}<select name="server"><option value="us">bitwarden.com (US)</option><option value="eu">bitwarden.eu (EU)</option><option value="custom">${tr('Self-hosted…')}</option></select></label>
          <label class="field hidden" id="bw-url-field">${tr('Address')}<input type="text" name="serverUrl" placeholder="https://vault.example.com"></label>
        </div>
        <a class="bs-row bs-link" id="bw-key-link" href="${BW_KEYS.us}" target="_blank" rel="noopener"><b>${tr('Get the API key')}</b><span class="bs-val">${tr('Settings → Security → Keys')}</span>${CHEV}</a>
        <div class="row">
          <label class="field">client_id<input type="text" name="clientId" placeholder="user.xxxxxxxx-…" autocomplete="off" spellcheck="false"></label>
          <label class="field">client_secret<input type="password" name="clientSecret" autocomplete="new-password"></label>
        </div>
        <div><button class="btn primary">${tr('Connect Bitwarden')}</button></div>
      </form>
    </details></div>`;
}

function wireBitwardenSetup(root) {
  const f = $('#bw-setup', root);
  if (!f) return;
  f.server.onchange = () => {
    $('#bw-url-field', root).classList.toggle('hidden', f.server.value !== 'custom');
    const link = $('#bw-key-link', root);
    link.hidden = !BW_KEYS[f.server.value];
    if (BW_KEYS[f.server.value]) link.href = BW_KEYS[f.server.value];
  };
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

// host: the card of a locked Bitwarden in the chat of the bot that wants it, where it opens in place of a dialog.
function openUnlock(reason = '', host = null) {
  const s = state.bw || {};
  const m = (host ? (html) => openInline(host, html) : openModal)(`
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
  // A bot that waits for it: in its card, when its chat is on screen; elsewhere Needs you and the banner say it.
  if (s.wantedBy) {
    const card = $$('.chat-needs .need-card[data-need="bitwarden"]').find((el) => el.offsetParent);
    if (card && !bwUi.snoozed.has(s.wantedBy.id)) { bwUi.snoozed.add(s.wantedBy.id); openUnlock(tr('{name} needs a saved login.', { name: s.wantedBy.name }), card); }
    return;
  }
  if (!bwUi.prompted) { bwUi.prompted = true; openUnlock(); }
}

function showBitwardenBanner() { showNeeds(); }

// A bot wants to pay: the owner approves this card on this site (for this run, 15 minutes).
function openCardApproval(r, host = null) {
  loginReq.shown = r.id;
  const m = (host ? (html) => openInline(host, html) : openModal)(`
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
        ${vaultCategoryField(item.category)}
        ${botCheckboxes(item.allowedBots).replaceAll(SKILLS_OFF_ATTR(), '')}
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>${tr('Cancel')}</button><button class="btn primary">${tr('Save')}</button></div>
    </form>`);
  $('#item-bots', m).onsubmit = async (e) => {
    e.preventDefault();
    const allowedBots = $$('input[name=bot]:checked', m).map((c) => c.value);
    const category = $('input[name=category]', m).value.trim();
    if (await setAside(m, tr('Saving…'), () => api(`/vault/${item.id}`, { method: 'PUT', body: { allowedBots, category } }))) renderVault();
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
    if (file.size > VAULT_FILE_MAX) return refuse(tr('That file is {size} KB. A file in Passwords can be at most 64 KB.', { size: Math.ceil(file.size / 1024) }));
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
