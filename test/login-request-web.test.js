// The "needs a login" dialog of the web page with the saved logins of other websites (VAULT-001): the markup
// of the line "Use another saved login", of its list and of the second question, cut out of public/app.js
// and run against stand-ins, every value escaped; then where the dialog puts them and what sends the answer.
// A long list has a search field (VAULT-004): its markup, its filter, and its wiring run against stand-in rows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webSource } = require('./web-source');
const { words } = require('./web-page');

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
const page = vm.createContext({ ...words, esc });
vm.runInContext(`${cut('const LOGIN_SEARCH_ABOVE', 'function openLoginRequest(r)')}\nthis.loginRequestOthers = loginRequestOthers; this.loginRequestConfirm = loginRequestConfirm; this.loginRequestMatches = loginRequestMatches;`, page);
const dialog = cut('function openLoginRequest(r)', 'async function saveLoginInBackground');

// As GET /api/vault/requests hands it out (docs/api.md "Login requests").
const REQUEST = {
  id: 'r1', kind: 'login', site: 'app.example.org', name: 'app.example.org', username: '', reason: 'To sign in.', from: 'bot',
  bot: { id: 'coder', name: 'Coder', color: '#7f77dd' },
  existing: [],
  others: [
    { id: 'l1', name: 'Portal', username: 'bart@example.com', site: 'portal.example.com' },
    { id: 'l2', name: 'Token only', username: '', site: 'api.example.net' },
  ],
};
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('web: without others the dialog is as before: no line, no list', () => {
  assert.equal(page.loginRequestOthers({ ...REQUEST, others: [] }), '');
  assert.equal(page.loginRequestOthers({ ...REQUEST, others: undefined }), '', 'an older server sends none');
});

test('web: one line "Use another saved login" opens the list: each login with its name, username and website', () => {
  const html = page.loginRequestOthers(REQUEST);
  assert.match(html, /<button type="button" class="link-btn" id="req-others-open" aria-expanded="false" aria-controls="req-others-list">Use another saved login<\/button>/);
  assert.match(html, /<fieldset id="req-others-list" hidden>/, 'the list is closed until the line is pressed');
  const rows = [...html.matchAll(/<div class="req-existing"><span>(.*?)<\/span><button type="button" class="btn sm" data-other="(.*?)">Use it<\/button><\/div>/g)].map((m) => [text(m[1]), m[2]]);
  assert.deepEqual(rows, [['🔑 Portal · bart@example.com portal.example.com', 'l1'], ['🔑 Token only api.example.net', 'l2']]);
  assert.doesNotMatch(html, /data-allow/, 'a row never answers by itself: its button opens the second question');
});

test('web: the second question names the login, its website and the requested host, and says the password goes there too', () => {
  const html = page.loginRequestConfirm(REQUEST, REQUEST.others[0]);
  const said = text(html);
  assert.match(said, /Use the login Portal saved for portal\.example\.com on app\.example\.org/);
  assert.match(said, /Its password will also be used on app\.example\.org , by Coder\./);
  assert.match(said, /web pages can try to trick bots into asking/);
  assert.match(html, /<button type="button" class="btn" data-back>Back<\/button>/);
  assert.match(html, /<button type="button" class="btn primary" id="req-confirm-yes">Use it on app\.example\.org<\/button>/);
  assert.match(html, /<div class="req-error" role="alert" hidden><\/div>/, "room for the server's sentence");
  assert.equal((html.match(/<button/g) || []).length, 2, 'Back and the one button that answers');
});

test('web: names, usernames and hosts are escaped', () => {
  const evil = { id: '"><b>', name: '<img src=x onerror=1>', username: '<u>', site: '<i>.example' };
  const r = { ...REQUEST, site: '<s>.example', bot: { name: '<Bot>' }, others: [evil] };
  for (const html of [page.loginRequestOthers(r), page.loginRequestConfirm(r, evil)]) {
    assert.doesNotMatch(html, /<img|<u>|<i>|<s>|<Bot>|"><b>/);
  }
  assert.match(page.loginRequestOthers(r), /data-other="&quot;&gt;&lt;b&gt;"/);
  assert.match(page.loginRequestConfirm(r, evil), /&lt;img src=x onerror=1&gt;/);
});

test('web: the line stands under the logins of this site and above the new-login fields', () => {
  const at = (s) => { const i = dialog.indexOf(s); assert.ok(i >= 0, `the dialog has ${s}`); return i; };
  assert.ok(at("<legend>${tr('Already in your Vault')}</legend>") < at('${loginRequestOthers(r)}'));
  assert.ok(at('${loginRequestOthers(r)}') < at('or save a new one:'));
  assert.ok(at('or save a new one:') < at('${vaultTypeFields(r.type'), 'the new-login fields, which follow the type (VAULT-005)');
  assert.match(dialog, /\$\{reusable\.length \|\| \(r\.others \|\| \[\]\)\.length \? `<div class="faint"[^`]*>\$\{tr\('or save a new one:'\)\}<\/div>` : ''\}/, 'and "or save a new one" only when there is a login to choose');
});

test('web: a row opens the second question inside the dialog; only its button sends the answer', () => {
  const pick = dialog.slice(dialog.indexOf("$$('[data-other]', m)"), dialog.indexOf("$('#req-decline', m).onclick"));
  assert.match(pick, /insertAdjacentHTML\('beforeend', loginRequestConfirm\(r, e\)\)/, 'drawn in the open dialog');
  assert.doesNotMatch(dialog, /\bconfirm\(/, 'not with the browser\'s confirm()');
  assert.match(pick, /form\.classList\.add\('confirming'\)/);
  assert.match(pick, /\$\('\[data-back\]', c\)\.onclick = \(\) => \{ c\.remove\(\); form\.classList\.remove\('confirming'\); \};/, 'Back returns to the dialog');
  // The answer is sent from the confirmation's button and nowhere else in the pick.
  const sends = [...pick.matchAll(/api\(`\/vault\/requests\/\$\{r\.id\}`/g)];
  assert.equal(sends.length, 1);
  assert.ok(pick.indexOf('yes.onclick = async () => {') < sends[0].index, 'inside the handler of the confirming button');
  assert.match(pick, /body: \{ action: 'allow', loginId: e\.id \}/);
  // The server's sentence (20 additional hosts) is shown in the dialog, which stays open.
  assert.match(pick, /catch \(err\) \{[\s\S]*box\.textContent = err\.message;[\s\S]*box\.hidden = false;/);
  assert.doesNotMatch(pick.slice(pick.indexOf('catch (err)')), /m\.close\(\)/);
});

test('web: while the second question is open, the rest of the dialog and its buttons are out of the way', () => {
  assert.match(css, /#login-request\.confirming \.modal-body > :not\(\.req-confirm\), #login-request\.confirming \.modal-foot \{ display: none; \}/);
  assert.match(css, /\.req-others \[hidden\], \.req-confirm \[hidden\] \{ display: none; \}/, 'a fieldset is a grid here: hidden must still hide it');
});

// ---------- the search of a long list (VAULT-004) ----------

const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, name: `Login ${i}`, username: `user${i}@example.com`, site: `site${i}.example.com` }));

test('web: more than 6 other logins get a search field above the rows; 6 or fewer get none', () => {
  const seven = page.loginRequestOthers({ ...REQUEST, others: many(7) });
  const field = seven.indexOf('<input type="search" id="req-others-search"');
  assert.ok(field > seven.indexOf('<legend>') && field < seven.indexOf('class="req-existing"'), 'inside the list, above its rows');
  assert.match(seven, /<div class="req-others-rows long">/, 'and the rows scroll');
  assert.match(seven, /<div class="req-others-none faint" hidden>No saved login matches\.<\/div>/, 'the empty line waits hidden');
  assert.equal((seven.match(/data-other=/g) || []).length, 7, 'the whole list is drawn');

  const six = page.loginRequestOthers({ ...REQUEST, others: many(6) });
  assert.doesNotMatch(six, /type="search"|req-others-none/);
  assert.match(six, /<div class="req-others-rows">/, 'no fixed height either');
  assert.equal((six.match(/data-other=/g) || []).length, 6);
});

test('web: the filter keeps a login when every typed word is in its name, username or website, whatever the case', () => {
  const e = { id: 'l1', name: 'Proxmox API token', username: 'root@pam', site: 'pve.home.example' };
  const keeps = (q) => page.loginRequestMatches(e, q);
  assert.ok(keeps('prox'), 'by name');
  assert.ok(keeps('root@'), 'by username');
  assert.ok(keeps('home.example'), 'by website');
  assert.ok(keeps('token pve'), 'two words, each in another field');
  assert.ok(keeps('  PROXMOX   Root '), 'another case, spaces around');
  assert.ok(!keeps('proxmox gmail'), 'every word must be there');
  assert.ok(!keeps('zzz'));
  assert.ok(keeps('') && keeps('   ') && keeps(undefined), 'nothing typed keeps every login');
  assert.ok(page.loginRequestMatches({ id: 'l2', name: 'Token only', username: '', site: 'api.example.net' }, 'token'), 'a login without a username');
  assert.ok(!page.loginRequestMatches({ id: 'l2', name: 'Token only' }, 'undefined'), 'a missing value is not text');
});

// The wiring of the field, cut out of the dialog and run against stand-in rows.
function searchWiring(others) {
  const src = dialog.slice(dialog.indexOf("const othersSearch = $('#req-others-search', m);"), dialog.indexOf("$$('[data-other]', m)"));
  assert.match(src, /othersSearch\.oninput/, 'the dialog wires the field');
  const field = { value: '' };
  // The rows stand in another order than the logins: a row is found by the login its button names.
  const rows = [...others].reverse().map((e) => ({ hidden: false, button: { dataset: { other: e.id } } }));
  const none = { hidden: true };
  const $ = (sel, root) => (sel === '#req-others-search' ? field : sel === '.req-others-none' ? none : sel === '[data-other]' ? root.button : assert.fail(`unexpected ${sel}`));
  const $$ = (sel) => (sel === '#req-others-list .req-existing' ? rows : assert.fail(`unexpected ${sel}`));
  vm.runInContext(`(function ($, $$, m, r) { ${src} })`, page)($, $$, {}, { others });
  const type = (q) => { field.value = q; field.oninput(); return rows.filter((x) => !x.hidden).map((x) => x.button.dataset.other).reverse(); };
  return { field, none, type };
}

test('web: typing hides the rows that do not match, clearing shows all, and no match shows one line', () => {
  const others = many(7);
  others[3] = { id: 'px', name: 'Proxmox', username: 'root@pam', site: 'pve.home.example' };
  const s = searchWiring(others);
  assert.deepEqual(s.type('PROX root'), ['px']);
  assert.equal(s.none.hidden, true);
  assert.deepEqual(s.type('example.com'), others.filter((e) => e.id !== 'px').map((e) => e.id));
  assert.deepEqual(s.type('nothing like it'), []);
  assert.equal(s.none.hidden, false, '"No saved login matches."');
  assert.equal(s.type('').length, 7, 'cleared: every row again');
  assert.equal(s.none.hidden, true);
});

test('web: Enter in the search field does not submit the form; other keys are left alone', () => {
  const s = searchWiring(many(7));
  const key = (k) => { let stopped = false; s.field.onkeydown({ key: k, preventDefault: () => { stopped = true; } }); return stopped; };
  assert.equal(key('Enter'), true);
  assert.equal(key('a'), false);
  assert.equal(key('Escape'), false, 'Escape still closes the dialog');
});

test('web: opening the list focuses the search field, and a filtered row opens the same second question', () => {
  const open = dialog.slice(dialog.indexOf('othersOpen.onclick'), dialog.indexOf('const othersSearch'));
  assert.match(open, /if \(!list\.hidden\) \$\('#req-others-search', m\)\?\.focus\(\);/, 'focused when opened; a short list has no field');
  // Rows are hidden, never redrawn: the buttons keep the handler that opens the second question.
  const wiring = dialog.slice(dialog.indexOf('const othersSearch'), dialog.indexOf("$$('[data-other]', m)"));
  assert.doesNotMatch(wiring, /innerHTML|insertAdjacentHTML|\.remove\(/);
});

test('web: a long list scrolls inside the dialog under a fixed greatest height', () => {
  assert.match(css, /\.req-others-rows\.long \{[^}]*max-height: 240px;[^}]*overflow-y: auto;/);
  assert.doesNotMatch(css, /\.req-others-rows \{[^}]*max-height/, 'a short list keeps its height');
  assert.match(css, /\.req-others input\[type=search\]/, 'the field looks like the other fields');
});
