// The Who and Due menus of a project's "Add a task" open under that row (#1511). Their box used to be the whole
// page, so the Due menu opened at the page's top right, away from its button and often off screen (Firefox).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const home = fs.readFileSync(path.join(PUBLIC, 'company-home.js'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');

test('web: the menus are drawn in a box of their own with the "Add a task" row', () => {
  const panel = home.slice(home.indexOf('function todoPanelHTML'), home.indexOf('function', home.indexOf('function todoPanelHTML') + 10));
  assert.match(panel, /<div class="cf-add-wrap"><form class="co-ask small cf-add" id="cf-add">[\s\S]*?<\/form>\s*\$\{menuHTML\(c\)\}<\/div>/, 'the row and its menu share one box');
});

test('web: that box places the menus right under the row, Due at its right and Who at its left', () => {
  assert.match(css, /\.cf-add-wrap \{ position: relative; \}/);
  assert.match(css, /\.cf-add-wrap > \.cf-menu \{ top: calc\(100% \+ var\(--sp-4\)\); \}/);
  assert.match(css, /\.cf-add-wrap > \.cf-menu:not\(\.cf-when-menu\) \{ right: auto; left: 0; \}/);
});
