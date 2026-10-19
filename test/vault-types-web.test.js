// The types of a Vault item on the web page (VAULT-005): the markup of an item's two lines, of the Type
// control and of the fields that follow it, cut out of public/app.js and run against stand-ins, every value
// escaped; then where the Vault's list, its editor and the "needs a login" dialog use them, and what they send.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webSource } = require('./web-source');

const PUBLIC = path.join(__dirname, '..', 'public');
const app = webSource();
const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
// A part of app.js, from one line of it up to another.
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = vm.createContext({ esc });
const NAMES = ['VAULT_TYPES', 'vaultType', 'vaultItemAddr', 'vaultItemLine', 'vaultTypeControl', 'vaultTypeFields', 'wireVaultType', 'vaultTypeBody'];
vm.runInContext(`${cut('const VAULT_TYPES = {', 'async function renderVault()')}\n${NAMES.map((n) => `this.${n} = ${n};`).join(' ')}`, page);
const list = cut('async function renderVault()', 'function openLoginEditor(login)');
const editor = cut('function openLoginEditor(login)', '// ---------- Bitwarden ----------');
const dialog = cut('function openLoginRequest(r)', 'async function saveLoginInBackground');

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// The fields of a piece of markup: [[label, name]], in order.
const fields = (html) => [...html.matchAll(/<label class="field">(.*?)<(?:input|select)[^>]* name="([a-z]+)"/gs)].map((m) => [text(m[1]), m[2]]);
const at = (source, s) => { const i = source.indexOf(s); assert.ok(i >= 0, `it has ${s}`); return i; };

// The words every app shows alike (its "about"); VaultTypesTest.kt holds the Android app's side.
const WORDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vault-types.json'), 'utf8'));

test('web: the three types have the words of the shared table, and an item its two lines', () => {
  const mine = Object.entries(page.VAULT_TYPES).map(([id, t]) => ({ id, label: t.label, username: t.username ?? null, optional: !!t.optional, secret: t.secret, icon: t.icon || '', none: t.none || '', saved: t.saved }));
  assert.deepEqual(JSON.parse(JSON.stringify(mine)), WORDS.types);
  assert.ok(page.vaultTypeControl('login').includes(`>${WORDS.control}<select name="type">`));
  for (const { item, rows } of WORDS.items) assert.deepEqual([page.vaultItemAddr(item), page.vaultItemLine(item)], rows, item.name);
});

// ---------- an item of the Vault's list ----------

test('web: a login-kind item shows its type before its address', () => {
  assert.equal(page.vaultItemAddr({ type: 'login', site: 'recipes.example.com' }), 'Login · recipes.example.com');
  assert.equal(page.vaultItemAddr({ type: 'api-token', site: 'pve.example.ts.net' }), 'API token · pve.example.ts.net');
  assert.equal(page.vaultItemAddr({ type: 'other', site: 'nas.example.net' }), 'Other · nas.example.net');
  assert.equal(page.vaultItemAddr({ site: 'old.example.org' }), 'Login · old.example.org', 'an item without a type is a login');
  assert.equal(page.vaultItemAddr({ type: 'ssh-key', site: 'new.example.org' }), 'Login · new.example.org', 'and so is one of a type this page does not know');
  assert.equal(page.vaultItemAddr({ type: 'toString', site: 'x.example.org' }), 'Login · x.example.org');
});

test('web: the line under it reads by type', () => {
  // A login, as before this task.
  assert.equal(page.vaultItemLine({ type: 'login', username: 'alice' }), '👤 alice · 🔒 secret saved');
  assert.equal(page.vaultItemLine({ username: '' }), '👤 (no username) · 🔒 secret saved', 'without a type: a login');
  assert.equal(page.vaultItemLine({ type: 'login', username: 'alice', hasTotp: true, insecureTls: true }), '👤 alice · 🔒 secret saved · two-step code · self-signed certificate OK');
  // An API token: its token ID, and "token saved".
  assert.equal(page.vaultItemLine({ type: 'api-token', username: 'root@pam!botdot' }), '🆔 root@pam!botdot · 🔒 token saved');
  assert.equal(page.vaultItemLine({ type: 'api-token', username: '' }), '🆔 (no token ID) · 🔒 token saved');
  assert.equal(page.vaultItemLine({ type: 'api-token', username: '', insecureTls: true }), '🆔 (no token ID) · 🔒 token saved · self-signed certificate OK');
  // Other: the secret alone, also when a username is still stored with it.
  assert.equal(page.vaultItemLine({ type: 'other', username: '' }), '🔒 secret saved');
  assert.equal(page.vaultItemLine({ type: 'other', username: 'kept-from-before' }), '🔒 secret saved');
});

test('web: the address and the username of an item are escaped', () => {
  for (const type of ['login', 'api-token', 'other', undefined]) {
    const l = { type, site: '<i>.example"', username: '<img src=x onerror=1>' };
    assert.doesNotMatch(page.vaultItemAddr(l) + page.vaultItemLine(l), /<i>|<img|example"/, String(type));
  }
  assert.match(page.vaultItemAddr({ site: '<i>.example' }), /^Login · &lt;i&gt;\.example$/);
  assert.match(page.vaultItemLine({ type: 'api-token', username: '<b>' }), /^🆔 &lt;b&gt; · /);
});

test('web: the list draws a login-kind item with these two lines, and a card and an identity as before', () => {
  assert.match(list, /: vaultItemLine\(l\);/);
  assert.match(list, /<div class="addr">\$\{kind === 'login' \? vaultItemAddr\(l\) : kind === 'card' \? 'Payment card' : kind === 'ssh-key' \? 'SSH key' : 'Identity'\}<\/div>/);
  assert.match(list, /const line = kind === 'card' \? `💳 /, 'a card keeps its line');
  assert.match(list, /: kind === 'identity' \? `🪪 /, 'an identity keeps its line');
  assert.match(list, /<button class="btn primary" id="add-login">＋ Add<\/button>/, 'the button is "＋ Add"');
  assert.doesNotMatch(list, /Add login/);
});

// ---------- the Type control and the fields that follow it ----------

test('web: the Type control has Login, API token and Other, the type of the item or the request chosen', () => {
  const options = (html) => [...html.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map((m) => [m[1], m[3], !!m[2]]);
  const html = page.vaultTypeControl(undefined);
  assert.match(html, /^<label class="field">Type<select name="type">/);
  assert.deepEqual(options(html), [['login', 'Login', true], ['api-token', 'API token', false], ['other', 'Other', false]], 'Login for a new item');
  assert.deepEqual(options(page.vaultTypeControl('api-token')).map((o) => o[2]), [false, true, false]);
  assert.deepEqual(options(page.vaultTypeControl('other')).map((o) => o[2]), [false, false, true]);
  assert.deepEqual(options(page.vaultTypeControl('ssh-key')).map((o) => o[2]), [true, false, false], 'a type this page does not know: Login');
});

test('web: the fields of each type: Login a username and a password, API token an optional token ID and a token, Other the secret alone', () => {
  assert.deepEqual(fields(page.vaultTypeFields('login')), [['Username or email', 'username'], ['Password', 'password']]);
  assert.deepEqual(fields(page.vaultTypeFields(undefined)), [['Username or email', 'username'], ['Password', 'password']], 'no type: a login');
  assert.deepEqual(fields(page.vaultTypeFields('api-token')), [['Token ID optional', 'username'], ['Token', 'password']]);
  assert.match(page.vaultTypeFields('api-token'), /Token ID <span class="hint">optional<\/span><input type="text" name="username"/);
  const other = page.vaultTypeFields('other', { username: 'kept-from-before' });
  assert.deepEqual(fields(other), [['Secret', 'password']]);
  assert.doesNotMatch(other, /name="username"|kept-from-before/, 'no username field, and the stored one is not drawn');
  assert.match(other, /^<div class="row one" data-type-fields>/, 'one field, across the form');
  assert.match(css, /\.row\.one \{ grid-template-columns: 1fr; \}/);
  for (const type of ['login', 'api-token', 'other']) {
    const html = page.vaultTypeFields(type);
    assert.equal((html.match(/<input /g) || []).length, type === 'other' ? 1 : 2);
    assert.match(html, /<input type="password" name="password" autocomplete="new-password" required>/, `${type}: the secret is never drawn, and a new item needs one`);
    assert.doesNotMatch(html, /token ID|Password, token or key|Username, email/, 'not the one form for everything');
  }
});

test('web: a saved item keeps its secret when the field is left empty; the username field starts with the stored one, escaped', () => {
  const saved = page.vaultTypeFields('login', { username: 'alice@example.com', isNew: false });
  assert.match(saved, /name="username" value="alice@example\.com"/);
  assert.match(saved, /Password <span class="hint">leave empty to keep the current one<\/span><input type="password" name="password" autocomplete="new-password" placeholder="••••••••">/);
  assert.doesNotMatch(saved, /required/);
  const evil = page.vaultTypeFields('api-token', { username: '"><img src=x onerror=1>' });
  assert.doesNotMatch(evil, /<img/);
  assert.match(evil, /value="&quot;&gt;&lt;img src=x onerror=1&gt;"/);
});

// A stand-in form: its username and secret fields are those of the markup last drawn into it.
function standIn(type, opts) {
  const form = { type: { value: type } };
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const draw = (html) => {
    form.html = html;
    form.password = { value: '' };
    const m = html.match(/name="username" value="([^"]*)"/);
    if (m) form.username = { value: unesc(m[1]) }; else delete form.username;
  };
  draw(page.vaultTypeFields(type, opts));
  page.$ = (sel, root) => (sel === '[data-type-fields]' && root === form ? { set outerHTML(html) { draw(html); } } : assert.fail(`unexpected ${sel}`));
  page.wireVaultType(form, opts);
  const choose = (t) => { form.type.value = t; form.type.onchange(); return fields(form.html); };
  return { form, choose };
}

test('web: the fields follow the choice at once, and what was typed stays', () => {
  const { form, choose } = standIn('login', { username: '' });
  form.username.value = 'root@pam!botdot';
  form.password.value = 'typed-secret';
  assert.deepEqual(choose('api-token'), [['Token ID optional', 'username'], ['Token', 'password']]);
  assert.equal(form.username.value, 'root@pam!botdot', 'the username is the token ID now');
  assert.equal(form.password.value, 'typed-secret', 'the secret stays in its field');
  assert.doesNotMatch(form.html, /typed-secret/, 'and is never written into the markup');
  assert.deepEqual(choose('other'), [['Secret', 'password']]);
  assert.equal(form.username, undefined);
  assert.equal(form.password.value, 'typed-secret');
  assert.deepEqual(choose('login'), [['Username or email', 'username'], ['Password', 'password']]);
  assert.equal(form.username.value, 'root@pam!botdot', 'back from Other: the username shows again');
});

test('web: a login changed to Other and back shows its stored username again', () => {
  const { form, choose } = standIn('other', { username: 'alice', isNew: false });
  assert.equal(form.username, undefined, 'Other: not shown');
  assert.deepEqual(choose('login'), [['Username or email', 'username'], ['Password leave empty to keep the current one', 'password']]);
  assert.equal(form.username.value, 'alice');
  assert.doesNotMatch(form.html, /required/, 'still a saved item');
});

test('web: Other sends no username; Login and API token send the type and the username', () => {
  const body = (type, username) => page.vaultTypeBody({ type: { value: type }, ...(username === undefined ? {} : { username: { value: username } }) });
  assert.deepEqual({ ...body('login', 'alice') }, { type: 'login', username: 'alice' });
  assert.deepEqual({ ...body('api-token', '') }, { type: 'api-token', username: '' });
  const other = body('other');
  assert.deepEqual({ ...other }, { type: 'other' });
  assert.equal('username' in other, false, 'no username in the body');
});

// ---------- the editor ----------

test('web: the editor is "Add to the Vault", Type is its first control, and the fields follow it', () => {
  assert.match(editor, /<h2>\$\{isNew \? 'Add to the Vault' : `Edit \$\{esc\(l\.name\)\}`\}<\/h2>/);
  assert.doesNotMatch(editor, /Add login/);
  const body = editor.slice(at(editor, '<div class="modal-body">'));
  assert.match(body, /^<div class="modal-body">\s*\$\{vaultTypeControl\(l\.type\)\}/, 'the first control');
  assert.ok(at(body, '${vaultTypeControl(l.type)}') < at(body, 'name="name"'));
  assert.ok(at(body, 'name="site"') < at(body, '${vaultTypeFields(l.type, { username: l.username, isNew })}'));
  assert.ok(at(body, '${vaultTypeFields(') < at(body, 'name="allowedHosts"'), 'the other fields stay');
  for (const name of ['name', 'site', 'allowedHosts', 'insecureTls', 'bot']) assert.match(body, new RegExp(`name="?${name}"?`));
  assert.match(editor, /wireVaultType\(form, \{ username: l\.username, isNew \}\);/);
  // A new item: no type yet, so Login is chosen.
  assert.match(editor, /const l = login \|\| \{ name: '', site: '', username: '', allowedBots: \[\] \};/);
});

test('web: the editor has "Usable in its computer", off for a new item, and sends it; the dialog of a bot\'s request has none', () => {
  const body = editor.slice(at(editor, '<div class="modal-body">'));
  assert.match(body, /<label class="toggle"><input type="checkbox" name="inComputer" \$\{l\.inComputer \? 'checked' : ''\}> Usable in its computer /);
  assert.ok(at(body, 'name="insecureTls"') < at(body, 'name="inComputer"'), 'right under the certificate');
  const submit = editor.slice(at(editor, 'form.onsubmit = async (e) => {'));
  assert.match(submit, /insecureTls: form\.insecureTls\.checked,\s*inComputer: form\.inComputer\.checked,/);
  assert.doesNotMatch(dialog, /inComputer/, 'a bot asking for a login cannot have it marked from there');
  assert.equal(page.vaultItemLine({ type: 'login', username: 'alice', inComputer: true }), '👤 alice · 🔒 secret saved · usable in its computer');
});

test('web: the note of the editor no longer explains where a token ID goes', () => {
  const note = editor.slice(at(editor, '<div class="req-note">'), at(editor, '<fieldset>'));
  assert.match(note, /so they never see the secret\.<\/div>/);
  assert.doesNotMatch(editor, /token ID in the first field|put the token ID/i);
});

test('web: the editor sends the chosen type, and for Other no username', () => {
  const submit = editor.slice(at(editor, 'form.onsubmit = async (e) => {'));
  assert.match(submit, /site: form\.site\.value\.trim\(\),\s*\.\.\.vaultTypeBody\(form\),/);
  assert.doesNotMatch(submit, /username: form\.username\.value/, 'the username comes with the type, or not at all');
});

test('web: the words of the editor fit every type', () => {
  assert.match(editor, /<button class="btn primary" type="submit">Save<\/button>/);
  assert.match(editor, /: 'Saved'\);/);
  assert.match(editor, /toast\('Deleted'\);/);
  assert.match(editor, /`Delete "\$\{l\.name\}" from the Vault\?`/);
  assert.doesNotMatch(editor, /Save login|Login saved|Login deleted|the saved login/);
});

test("web: a refused save shows the server's sentence in the form, which stays open without the secret", () => {
  assert.match(editor, /<div class="req-error" role="alert" hidden><\/div>\s*<\/div>\s*<div class="modal-foot">/, 'room for the sentence, in the form');
  const submit = editor.slice(at(editor, 'form.onsubmit = async (e) => {'));
  assert.ok(at(submit, "form.password.value = '';") < at(submit, 'await api('), 'the secret is gone before the answer');
  const refused = submit.slice(at(submit, 'catch (err) {'));
  assert.match(refused, /refused\.textContent = err\.message;\s*refused\.hidden = false;/);
  assert.doesNotMatch(refused, /m\.close\(\)|renderVault\(\)|innerHTML/, 'the form stays open as it is');
  assert.match(submit, /const refused = \$\('\.req-error', form\);\s*refused\.hidden = true;/, 'an earlier sentence goes with the next try');
  assert.match(css, /\.req-error \{[^}]*color: var\(--err\);/);
});

// ---------- the "needs a login" dialog ----------

test('web: the dialog has the Type control above its new-login fields, set from the type of the request', () => {
  assert.ok(at(dialog, 'or save a new one:') < at(dialog, '${vaultTypeControl(r.type)}'));
  assert.match(dialog, /\$\{vaultTypeControl\(r\.type\)\}\s*\$\{vaultTypeFields\(r\.type, \{ username: r\.username \}\)\}/, 'the fields right under it');
  assert.ok(at(dialog, '${vaultTypeFields(r.type') < at(dialog, 'name="insecureTls"'));
  assert.match(dialog, /wireVaultType\(form, \{ username: r\.username \}\);/, 'and they follow the choice');
  assert.doesNotMatch(dialog, /Username, email or token ID|Password, token or key/);
  assert.match(dialog, /needs a login<\/h2>/, 'the heading stays');
});

test('web: Save in the dialog sends the chosen type, and for Other no username', () => {
  assert.match(dialog, /const body = \{ action: 'save', name: form\.name\.value\.trim\(\), \.\.\.vaultTypeBody\(form\), password: form\.password\.value, insecureTls: form\.insecureTls\.checked \};/);
  // Other has no username field to put the cursor in.
  assert.match(dialog, /\(r\.username \|\| !form\.username \? form\.password : form\.username\)\.focus\(\)/);
});

test('web: a save that failed opens the dialog again with the chosen type and the typed username', () => {
  const saving = cut('async function saveLoginInBackground(r, body)', '// ---------- presence ----------');
  assert.match(saving, /openLoginRequest\(\{ \.\.\.x, type: body\.type, username: body\.username \?\? x\.username \}\)/, 'Other sent no username: the one of the request stays');
  assert.match(saving, /body\.password = body\.unlockPassword = null;/, 'never the secret');
});
