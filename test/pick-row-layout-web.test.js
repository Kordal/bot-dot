// A pick in a bot's settings (Skills, Apps, May message): its checkbox and its name side by side in one row, the
// name shown. The skill importer's list once shared the class `.skill-pick`, and its `flex-direction: column` and
// `max-height` stacked every pick's name under its checkbox, where the Apps list lost it from view.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./web-page');
const { rulesAt, winner } = require('./css-rules');

const css = read('style.css');
const rules = rulesAt(css, 1400);
const PICK = [
  { tag: 'div', classes: ['bs-row', 'bs-fold', 'open'], index: 2 },
  { tag: 'div', classes: ['grow'], index: 1 },
  { tag: 'div', classes: ['bs-picks'], index: 2, attrs: { id: 'app-picks' } },
  { tag: 'div', classes: ['pick-list'], index: 2 },
  { tag: 'label', classes: ['skill-pick'], index: 1 },
];

test('a pick in bot settings is one row: checkbox beside its name', () => {
  assert.equal(winner(rules, PICK, 'display').value, 'flex');
  const dir = winner(rules, PICK, 'flex-direction');
  assert.ok(!dir || dir.value === 'row', `flex-direction ${dir?.value} from ${dir?.selector}`);
  assert.equal(winner(rules, PICK, 'max-height'), null, 'no height cap that hides its name');
});

test('the list of picks takes the whole row width, not just the label column', () => {
  assert.equal(winner(rules, PICK.slice(0, 4), 'grid-column').value, '1 / -1');
});

test('the skill importer keeps its own list class', () => {
  assert.match(read('skills.js'), /<div class="skill-pick-list">/);
  assert.equal(winner(rules, [{ tag: 'div', classes: ['skill-pick-list'], index: 1 }], 'flex-direction').value, 'column');
});
