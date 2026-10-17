// Search on the Skills page: public/skills-search.js loaded the way the browser loads it (a plain
// script, no module), and the page loads it after app.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const page = vm.createContext({});
vm.runInContext(pub('skills-search.js'), page);
const { skillMatches } = page.SkillSearch;

test('skills search: every word typed must be in the skill, in any order and case', () => {
  const text = 'weekly-report Written by Fleet Doctor How I like my weekly reports';
  assert.equal(skillMatches(text, 'weekly'), true);
  assert.equal(skillMatches(text, 'REPORT fleet'), true);
  assert.equal(skillMatches(text, '  doctor   weekly '), true);
  assert.equal(skillMatches(text, 'weekly invoice'), false);
  assert.equal(skillMatches(text, 'invoice'), false);
});

test('skills search: an empty box matches everything', () => {
  for (const q of ['', '   ', null, undefined]) assert.equal(skillMatches('anything', q), true);
  assert.equal(skillMatches('', 'x'), false);
});

test('skills search: the page loads it after app.js', () => {
  const html = pub('index.html');
  assert.ok(html.indexOf('/skills-search.js') > html.indexOf('/app.js'));
});
