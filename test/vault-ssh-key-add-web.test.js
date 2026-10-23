// The web page's way to add an SSH key (#160): "＋ SSH key" on the Vault while Bitwarden is unlocked, a dialog with a
// name, the private key pasted or read from its file (or none, to generate one) and the bots, and then the public key
// with a copy button. Cut out of public/app.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webSource } = require('./web-source');

const app = webSource();
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
};
const list = cut('async function renderVault()', 'function openLoginEditor(login)');
const editor = cut('function openSshKeyEditor()', 'function openSshPublicKey(');
const shown = cut('function openSshPublicKey(', '\n}\n');

test('web: the Vault offers "＋ SSH key" only while Bitwarden is unlocked', () => {
  assert.match(list, /\$\{bw\.unlocked \? '<button class="btn" id="add-file">＋ File<\/button><button class="btn" id="add-ssh-key">＋ SSH key<\/button>' : ''\}/);
  assert.match(list, /addKey\.onclick = \(\) => openSshKeyEditor\(\)/);
});

test('web: the dialog sends the pasted or picked key, or asks for a new one, and keeps no key after it', () => {
  assert.match(editor, /<textarea name="privateKey"/);
  assert.match(editor, /<input type="file" name="keyFile">/);
  assert.match(editor, /form\.privateKey\.value = await file\.text\(\)/, 'a picked file fills the field, read in the page');
  assert.match(editor, /\.\.\.\(privateKey \? \{ privateKey \} : \{ generate: true \}\)/, 'an empty field generates');
  assert.match(editor, /api\('\/vault\/ssh-keys', \{ method: 'POST', body \}\)/);
  assert.match(editor, /'Add key' : 'Generate new key'/);
  assert.match(editor, /setAside\(m, privateKey \? 'Adding the key…' : 'Generating a key…'/, "set aside while it saves; refused, it comes back with the server's sentence in the form (#478)");
  assert.match(editor, /const forget = \(\) => \{ if \(aside\) return; form\.privateKey\.value = '';/, 'closing it forgets the key, unless it is only set aside');
  assert.match(editor, /body\.privateKey = null;/, 'and the request keeps none after the answer');
});

test('web: afterwards the public key is shown, escaped, with a copy button, and never the private key', () => {
  assert.match(shown, /\$\{esc\(key\.publicKey\)\}/);
  assert.match(shown, /copyText\(key\.publicKey\)/);
  assert.match(shown, /authorized_keys/);
  assert.doesNotMatch(shown, /privateKey/);
});
