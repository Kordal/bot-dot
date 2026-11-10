// Passwords' search and its Bitwarden row on the web page: which items a search finds (the cases in
// test/fixtures/vault-search.json, which VaultTypesTest.kt checks for the Android app too), that a long list has
// the field and a short one not, and that the Bitwarden row keeps its name apart from the account line.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webSource } = require('./web-source');

const app = webSource();
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
};
const page = vm.createContext({});
vm.runInContext(`${cut('const VAULT_SEARCH = ', 'async function renderVault()')}\nthis.VAULT_SEARCH = VAULT_SEARCH; this.vaultItemMatches = vaultItemMatches;`, page);
const list = cut('async function renderVault()', 'function openLoginEditor(login, ');
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vault-search.json'), 'utf8'));

test('web: a search finds an item by any word of its name, address, username, hosts, card, holder or file', () => {
  for (const { query, found } of CASES.cases) {
    assert.deepEqual(CASES.items.filter((l) => page.vaultItemMatches(l, query)).map((l) => l.id), found, `"${query}"`);
  }
  assert.equal(page.vaultItemMatches(undefined, 'x'), false, 'a row without its item is hidden');
});

test('web: a list longer than the bot picker has the search field, which keeps what was typed and filters the rows', () => {
  assert.equal(page.VAULT_SEARCH, 8);
  assert.match(list, /logins\.length > VAULT_SEARCH \? `<input type="search" id="vault-search"/);
  assert.match(list, /value="\$\{esc\(vaultUi\.query\)\}"/);
  assert.match(list, /id="vault-none" hidden>\$\{tr\('No matches'\)\}/);
  assert.match(list, /search\.oninput = filter/);
  assert.match(list, /row\.hidden = !vaultItemMatches\(/);
});

test('web: the Bitwarden row names its account and item count, and its name never runs under them', () => {
  assert.match(list, /trn\(bw\.items, '\{n\} item', '\{n\} items'\)/);
  assert.doesNotMatch(app, /items in bot-dot/);
  assert.match(css, /\.bs-row\.bw-bar > b \{ flex: none; \}/);
  assert.match(css, /\.bs-row\.bw-bar > \.bs-val \{ flex: 1 1 auto; max-width: none; \}/);
});
