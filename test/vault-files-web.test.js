// The web page's way to add a file (#157): "＋ File" on the Vault while Bitwarden is unlocked, a dialog with the .pem,
// a name and the bots, saying every bot on the computer could read the file while its command runs; the list then
// shows the file's name and size, never what is in it. Cut out of public/app.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webSource } = require('./web-source');

const app = webSource();
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
};
const list = cut('async function renderVault()', 'function openLoginEditor(login, ');
const editor = cut('function openFileEditor()', '\n}\n');

test('web: the Vault offers "＋ File" only while Bitwarden is unlocked, and lists a file by its name and size', () => {
  assert.match(list, /\$\{bw\.unlocked \? `<button class="btn" id="add-file">＋ \$\{tr\('File'\)\}<\/button>/);
  assert.match(list, /addFile\.onclick = \(\) => openFileEditor\(\)/);
  assert.match(list, /kind === 'file' \? vaultFileLine\(l\)/);
  assert.match(app, /const vaultFileLine = \(l\) => `\$\{esc\(l\.fileName \|\| ''\)\} · \$\{vaultFileSize/);
  assert.match(app, /file: '📄'/);
  assert.match(app, /^\s+file: FILE_SHARE_NOTE,$/m, 'its Bots… dialog says what sharing it means');
});

test('web: the dialog takes any file up to 64 KB, sends it as base64, says who can read it, and shows a refusal in the form', () => {
  assert.match(editor, /<span class="hint">\$\{tr\('any file, at most 64 KB'\)\}<\/span><input type="file" name="file" required>/, 'no accept: any file (#231)');
  assert.doesNotMatch(editor, /\.pem/);
  assert.match(editor, /file\.size > VAULT_FILE_MAX/);
  assert.match(editor, /content: btoa\(binary\)/);
  assert.match(editor, /api\('\/vault\/files', \{ method: 'POST', body \}\)/);
  assert.match(editor, /\$\{esc\(FILE_SHARE_NOTE\)\}/);
  assert.match(app, /every bot on that computer could read it meanwhile/);
  assert.match(editor, /setAside\(m, tr\('Adding the file…'\), \(\) => api\('\/vault\/files'/, "set aside while it saves; refused, it comes back with the server's sentence in the form (#478)");
});
