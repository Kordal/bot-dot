// The yes among answer buttons is filled with the colour of the bot that asks (docs/api.md, "yes"), with text
// that reads on it. The web page's own code cut out of public/ and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, esc } = require('./web-page');

function page() {
  const ctx = vm.createContext({ esc });
  vm.runInContext(`${cut('// The text colour that reads best on a filled colour', '// Several questions at once ([[ask: …]])')}\nObject.assign(this, { inkOn, choicesHTML });`, ctx);
  return ctx;
}

test('web: the yes is filled with the bot colour, the no stays plain', () => {
  const { choicesHTML } = page();
  const html = choicesHTML(['Yes please', 'No thanks'], 0, '#7f77dd');
  assert.match(html, /<button class="btn yes" data-choice="Yes please" style="--yes:#7f77dd;--yes-ink:#111">/);
  assert.match(html, /<button class="btn" data-choice="No thanks">/);
  assert.doesNotMatch(choicesHTML(['Pasta', 'Curry'], undefined, '#7f77dd'), /yes/, 'no yes, no fill');
  assert.doesNotMatch(choicesHTML(['Yes', 'No'], 0, ''), /class="btn yes"/, 'no colour, no fill');
});

test('web: the text on the fill is whichever of white and near-black reads better', () => {
  const { inkOn } = page();
  for (const c of ['#1d9e75', '#378add', '#7f77dd', '#d4537e', '#e24b4a', '#ef9f27', '#639922', '#888780', '#d85a30']) assert.equal(inkOn(c), '#111', c);
  assert.equal(inkOn('#1a237e'), '#fff', 'a dark colour gets white');
  assert.equal(inkOn('not a colour'), '#fff');
});
