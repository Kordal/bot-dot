// #1107: a refresh of the web page draws the lists without waiting for the computers' state, which docker answers
// and can be slow; the state comes on its own and draws again only when it changed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test("a refresh's awaited reads leave out /computers", () => {
  const read = app.slice(app.indexOf('async function readAll()'), app.indexOf('function render()'));
  const awaited = read.match(/await Promise\.all\(\[[^\n]*\]\)/)[0];
  assert.doesNotMatch(awaited, /\/computers/);
  assert.match(read, /const computersRead = api\('\/computers'\)/);
  assert.match(read, /computersRead\.then\(\(c\) => \{\n\s+if \(!c \|\| !latest\(\) \|\| JSON\.stringify\(c\) === JSON\.stringify\(state\.computers \|\| \{\}\)\) return;/);
});
