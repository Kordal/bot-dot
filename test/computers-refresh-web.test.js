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

// 2026-11-10: a bot made after the page loaded showed "isn't made yet" on its running computer: opening its
// computer takes the server's state from /api/bots/:id/computer into state.computers before the screen is drawn.
test("opening a bot's computer takes its state from the server's answer", () => {
  const computers = fs.readFileSync(path.join(__dirname, '..', 'public', 'computers.js'), 'utf8');
  const describe = computers.slice(computers.indexOf('const describe = () =>'), computers.indexOf('describe();'));
  assert.match(describe, /if \(d\.state\) state\.computers = \{ \.\.\.state\.computers, \[botId\]: d\.state === 'none' \? undefined : d\.state \};/);
  assert.ok(describe.indexOf('state.computers') < describe.indexOf('frame();'));
});
