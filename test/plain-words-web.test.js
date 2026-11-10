// Plain words on the web page (ADR 200): an answer without botdot's sentence says what to do, never its status; and
// without Advanced a new password is a login alone, and the Apps marketplace leaves out the apps that need a key or a
// developer app of the owner's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, words, esc } = require('./web-page');

test('web: a status without a sentence is said in words, never its number', () => {
  const ctx = vm.createContext({ ...words });
  vm.runInContext(`${cut('const statusWords = ', '\n\n')}; this.statusWords = statusWords;`, ctx);
  const said = [401, 403, 404, 413, 500, 504].map((s) => ctx.statusWords(s));
  assert.deepEqual(said, ['Sign in again, then try once more.', "botdot doesn't allow that here.", "botdot couldn't do that. Try again.", 'That is too big for botdot.', "botdot didn't finish that. Try again in a moment.", "botdot didn't finish that. Try again in a moment."]);
  for (const s of said) assert.doesNotMatch(s, /\d/);
  for (const f of ['files.js', 'company.js', 'chief.js', 'company-settings.js', 'settings.js', 'rooms.js']) assert.doesNotMatch(read(f), /Upload failed \(\{status\}\)|botdot answered \{status\}|couldn't do that \(\{status\}\)/, f);
});

test('web: without Advanced a new password has no Type, says Website, and asks for no hosts', () => {
  const vault = read('vault.js');
  for (const adv of [false, true]) {
    const ctx = vm.createContext({ ...words, esc, advanced: () => adv });
    const start = vault.indexOf('const VAULT_TYPES = {'), end = vault.indexOf('function vaultTypeFields');
    vm.runInContext(`${vault.slice(start, end)}; this.vaultTypeControl = vaultTypeControl;`, ctx);
    const html = ctx.vaultTypeControl('login');
    if (adv) assert.match(html, /<select name="type">/);
    else assert.equal(html, '<input type="hidden" name="type" value="login">');
    assert.match(ctx.vaultTypeControl('api-token'), /<select name="type">/, 'an API token keeps its choice');
  }
  assert.match(vault, /\$\{advanced\(\) \? tr\('Website or server'\) : tr\('Website'\)\}/);
  assert.match(vault, /<label class="field"\$\{advanced\(\) \? '' : ' style="display:none"'\} title="\$\{esc\(tr\('Only these hosts/);
});

test('web: without Advanced the marketplace leaves out apps that need a key or a developer app', () => {
  assert.match(read('connectors.js'), /conn\.catalog\.filter\(\(t\) => advanced\(\) \|\| connectedSlugs\.has\(t\.slug\) \|\| !\['developer', 'key'\]\.includes\(t\.connect\)\)/);
});
