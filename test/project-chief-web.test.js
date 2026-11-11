// The Chief's head beside a project's gear (project-chief): drawn only from a server that has it, in the header after
// the gear, opening the project's own Chief chat in the column (Dock.openChief), made on the first tap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test("the head is drawn only with project-chief, after the gear, with what waits there as its number", () => {
  const co = read('company.js');
  const html = co.slice(co.indexOf('const chiefHTML = () =>'), co.indexOf('async function openProjectChief'));
  assert.match(html, /includes\('project-chief'\)/);
  assert.match(html, /data-project-chief/);
  assert.match(html, /co-chief-n/);
  const waiting = co.slice(co.indexOf('function chiefWaiting'), co.indexOf('const chiefHTML'));
  assert.match(waiting, /Unread\.count/);
  assert.match(waiting, /a\?\.chatId === id/);
  const home = read('company-home.js');
  assert.ok(home.indexOf('Company.gearHTML()') < home.indexOf('Company.chiefHTML()'), 'after the gear');
});

test('a tap opens the chat in the column; with none yet it asks the server to make it first', () => {
  const co = read('company.js');
  const open = co.slice(co.indexOf('async function openProjectChief'), co.indexOf('function wirePick'));
  assert.match(open, /if \(c\.chiefChat\) return Dock\.openChief\(c\.chiefChat\)/);
  assert.match(open, /\/company\/chief-chat/);
  assert.match(open, /Dock\.openChief\(r\.chatId\)/);
  assert.match(co, /\$\$\('\[data-project-chief\]', root\)/);
});
