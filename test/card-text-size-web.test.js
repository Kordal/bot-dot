// A card's text size on the web (card-text-size): a small A and a large A at the top of its menu step it through
// botdot's sizes, and every piece of the card's text is drawn at its own size times --pc-text, set on the card.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { rulesOf } = require('./css-rules');
const { TEXT_SIZES } = require('../lib/project-cards');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const src = read('project-cards.js');
const rules = rulesOf(read('style.css'));
const decl = (sel, k) => rules.filter((r) => r.selector.split(/,\s*/).includes(sel)).map((r) => r.decls[k]?.value).filter(Boolean).at(-1);

test('the web steps through the sizes botdot keeps, once botdot says it keeps them', () => {
  assert.match(src, new RegExp(`const SIZES = \\[${TEXT_SIZES.join(', ')}\\];`));
  assert.match(src, /includes\('card-text-size'\)/);
  assert.match(src, /send\(at\(k\.id\), 'PUT', \{ textSize: to \}\)/);
  assert.match(src, /e\.stopPropagation\(\);\n\s+const k = /, 'a step keeps the menu open');
  assert.match(src, /style="--pc-text:\$\{sizeOf\(c\)\}"/);
});

test("every piece of a card's text grows with --pc-text; its icons do not", () => {
  assert.equal(decl('.pc-card', '--pc-text'), '1');
  for (const [sel, fs] of [['.pc-card .pc-title', 14], ['.pc-card .pc-list li', 14], ['.pc-card .pc-table', 14], ['.pc-card .pc-big b', 32], ['.pc-card .pc-sub', 12], ['.pc-card .pc-ref', 12], ['.pc-card .pc-bar small', 12], ['.pc-card .kit-pill', 12]]) {
    assert.equal(decl(sel, 'font-size'), `calc(var(--fs-${fs}) * var(--pc-text))`, sel);
  }
  assert.ok(!rules.some((r) => /pc-icon/.test(r.selector) && /pc-text/.test(JSON.stringify(r.decls))));
});
