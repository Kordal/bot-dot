const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// A project's overview showed "Needs you" and its Review button with nothing waiting (2026-11-15).
test('the project overview shows Needs you only when something waits (web)', () => {
  const home = read('public', 'company-home.js');
  const body = home.slice(home.indexOf('function overviewHome('), home.indexOf('function teamHome('));
  assert.match(body, /\$\{items\.length \? `<section class="po-section"><h2>\$\{tr\('Needs you'\)\}/);
  assert.doesNotMatch(body, /\$\('\[data-po-needs\]', root\)\.onclick/); // the button is not there when nothing waits
});

test('the project overview shows Needs you only when something waits (Android)', () => {
  const kt = read('android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app', 'ui', 'CompanyHome.kt');
  const at = kt.indexOf('Text(tr("Needs you")');
  assert.ok(at > 0);
  const before = kt.slice(kt.lastIndexOf('\n', kt.lastIndexOf('\n', at) - 1), at);
  assert.match(before, /if \(here\.isNotEmpty\(\) \|\| chiefAsks\.isNotEmpty\(\)\)/);
});
