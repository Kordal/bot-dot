// The web page and the admin page ask with their own dialog, never the browser's confirm() or prompt(): the Mac app's
// WKWebView answers no without showing them, so the step that waited for a yes never happened (Delete bot did nothing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pages = require('../lib/front-door/pages');

const PUBLIC = path.join(__dirname, '..', 'public');
const NATIVE = /(?<![\w.$])(?:window\.)?(confirm|prompt)\s*\(/;
// Comments are not calls.
const code = (src) => src.split('\n').map((line, i) => [i + 1, line.replace(/\/\/.*$/, '')]).filter(([, line]) => !/^\s*\*/.test(line));

test("no script of the web page or the admin page calls the browser's confirm() or prompt()", () => {
  const found = [];
  for (const name of fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.js'))) {
    for (const [n, line] of code(fs.readFileSync(path.join(PUBLIC, name), 'utf8'))) if (NATIVE.test(line)) found.push(`public/${name}:${n}`);
  }
  for (const [n, line] of code(pages.ADMIN_SCRIPT)) if (NATIVE.test(line)) found.push(`ADMIN_SCRIPT:${n}`);
  assert.deepEqual(found, [], 'ask with askFirst() or askName() (public/app.js), or the admin script\'s askFirst()');
});

test('Delete bot asks with askFirst, and its row says Deleting… and is pressed once until the server answers', () => {
  const bots = fs.readFileSync(path.join(PUBLIC, 'bots.js'), 'utf8');
  const del = bots.slice(bots.indexOf("const del = $('#delete-bot', root);"), bots.indexOf('// "Duplicate" (#227)'));
  assert.match(del, /if \(del\.disabled\) return;/);
  assert.match(del, /await askFirst\(warning, tr\('Delete'\)\)/);
  assert.match(del, /label\.textContent = on \? tr\('Deleting…'\) : was;/);
  assert.ok(del.indexOf('busy(true)') < del.indexOf("method: 'DELETE'"), 'busy before the call');
  assert.match(del, /catch \(err\) \{ busy\(false\);/, 'a refusal gives the row back');
});
