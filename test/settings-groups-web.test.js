// Settings rows in groups (#728): every list of rows is one raised surface with no line between its rows, a bot's
// rows stand in three lists (how it runs, what it uses, who and what it may) before Duplicate and Delete, and its
// category chips need no "Category" label above them. The page's own code, cut out of public/app.js
// (test/web-page.js); the stylesheet read as text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cut, read } = require('./web-page');

// The one rule whose selector is exactly `sel`, as written in public/style.css.
const rule = (css, sel) => {
  const m = css.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(m, sel);
  return m[1];
};

test('web: a list of settings rows is one raised surface, with no line between its rows', () => {
  const css = read('style.css');
  const list = rule(css, '.set-list');
  assert.match(list, /background: var\(--raise-2\)/);
  assert.match(list, /box-shadow: var\(--lift\)/, 'the light on its top edge');
  assert.match(list, /border-radius: var\(--r-14\)/);
  for (const sel of ['.bs-row', '.bs-link']) assert.doesNotMatch(rule(css, sel), /border-top/, `${sel} has no line`);
  assert.doesNotMatch(css, /\.(bs-row|bs-link|bs-body)[^{}]*\{[^}]*border-top: 1px/, 'no line under a row anywhere');
});

test("web: a bot's rows stand in three lists, each with its own, and the category chips have no label above them", () => {
  const settings = cut('function renderBotSettings(', '// The bits of the settings page that follow');
  const lists = settings.split('<div class="set-list">').slice(1);
  assert.equal(lists.length, 4, 'three lists of rows, then Duplicate and Delete');
  const holds = (list, ids) => ids.forEach((id) => assert.ok(list.includes(id), id));
  holds(lists[0], ['bs-pinned', 'hotkeyRow(b)', 'id="bs-model"', 'id="bs-rules"']);
  holds(lists[1], ['id="bs-skills"', 'id="bs-apps"', 'data-bs-jobs', 'id="bs-files"', 'id="bs-pages"', 'id="bs-move"', 'data-bs-screen']);
  holds(lists[2], ['May message', 'othersMayAsk', 'id="bs-rooms"', 'id="bs-always"', 'id="bs-overrides"', 'id="bs-advanced"']);
  holds(lists[3], ['id="delete-bot"']);
  assert.doesNotMatch(settings, /<div class="field">\$\{tr\('Category'\)\}/);
  assert.match(settings, /<div class="group-picker" id="group-picker" role="group" aria-label="\$\{esc\(tr\('Category'\)\)\}">/, 'a screen reader still hears it');
});
