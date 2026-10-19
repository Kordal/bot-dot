// An SSH key of the owner's Bitwarden on the web page's Vault (#44): "SSH key" under its name, its fingerprint and
// that a bot never sees it, and the Bots… dialog that says what sharing it does. Cut out of public/app.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webSource } = require('./web-source');

const app = webSource();
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = vm.createContext({ esc });
vm.runInContext(`${cut('const vaultSshKeyLine =', 'async function renderVault()')}\n${cut('const KIND_ICON =', '\n\n')}\nthis.vaultSshKeyLine = vaultSshKeyLine; this.KIND_ICON = KIND_ICON; this.ITEM_BOTS_HINT = ITEM_BOTS_HINT;`, page);
const list = cut('async function renderVault()', 'function openLoginEditor(login)');
const bots = cut('function openItemBots(item)', '// ---------- Needs you');

test('web: an SSH key reads as one, with its fingerprint, escaped', () => {
  assert.equal(page.vaultSshKeyLine({ fingerprint: 'SHA256:abc' }), "SHA256:abc · 🔒 for SSH on a bot's computer, never shown to it");
  assert.equal(page.vaultSshKeyLine({}), "🔒 for SSH on a bot's computer, never shown to it");
  assert.doesNotMatch(page.vaultSshKeyLine({ fingerprint: '<img src=x>' }), /<img/);
  assert.equal(page.KIND_ICON['ssh-key'], '🗝️');
});

test('web: the list draws an SSH key with its own line and "SSH key", and opens the Bots… dialog for it', () => {
  assert.match(list, /: kind === 'ssh-key' \? vaultSshKeyLine\(l\)/);
  assert.match(list, /kind === 'ssh-key' \? 'SSH key'/);
  assert.match(list, /\$\{kind === 'login' \? 'Edit' : 'Bots…'\}/, 'only a login has the editor');
  assert.match(page.ITEM_BOTS_HINT['ssh-key'], /every bot on that computer could read it/);
  assert.match(bots, /ITEM_BOTS_HINT\[item\.kind\] \|\| ITEM_BOTS_HINT\.identity/);
  assert.equal(page.ITEM_BOTS_HINT.card, 'Bots that may pay with this card. You still approve every payment in a pop-up.', 'a card keeps its words');
  assert.equal(page.ITEM_BOTS_HINT.identity, 'Bots that may type these details into forms.', 'and an identity');
});
