// Settings on the web page (#635): one flat list of rows, a label left and its value right with › where the row opens
// something. A row with more to it (the model, Usage, Backups, Updates, Sign-ins) opens under itself, closed whenever
// Settings opens; no card has a heading, and no line of help stands under a title or a field.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cut, read } = require('./web-page');

const settings = cut('function renderSettings()', '// ---------- installing the app ----------')
  + cut('// ---------- backups ----------', '// Setup → Restore a backup')
  + cut('// ---------- when this account switches to a new version ----------', '// ---------- signing out everywhere ----------')
  + cut('// ---------- signing out everywhere ----------', 'async function signOutEverywhere()');

test('web: every row of Settings with more to it opens under itself, its label as the summary, closed when Settings opens', () => {
  for (const [title, id] of [['Model', 'settings-model'], ['Backups', 'backups-card'], ['Updates', 'update-card'], ['Sign-ins', 'sign-out-card']]) {
    assert.match(settings, new RegExp(`<details class="bs-row bs-more" id="${id}"`), id);
    assert.match(settings, new RegExp(`<summary[^>]*><b>${title}</b>`), title);
  }
  assert.match(settings, /'<details class="bs-row bs-more" id="usage-card"><\/details>'/);
  assert.match(read('usage.js'), /<summary [^>]*><b>Usage<\/b><span class="bs-chev" aria-hidden="true">›<\/span><\/summary>/);
  assert.doesNotMatch(settings, /<details[^>]*bs-more[^>]*\sopen/, 'closed when Settings opens');
  assert.match(read('style.css'), /\.bs-more\[open\] > summary > \.bs-chev \{ transform: rotate\(90deg\); \}|\.bs-more\[open\] > summary > \.bs-chev/);
});

test('web: Settings has no heading over its rows and no line of help under its title or a field', () => {
  assert.doesNotMatch(settings, /settings-hint|<p>Defaults for your team/);
  assert.doesNotMatch(cut('function renderSettings()', '// ---------- installing the app'), /class="page-sub"/, 'no heading over a group of rows');
  assert.match(settings, /<div class="section-head set-title">\$\{BACK_BTN\}<h1>Settings<\/h1><span class="saved-note" role="status"><\/span><\/div>/);
  // What a row is about, where its label may not say it, is its tooltip and a screen reader's description.
  assert.match(cut('const tipAttrs = ', '\n'), /title="\$\{esc\(tip\)\}" aria-description="\$\{esc\(tip\)\}"/);
});

test('web: "Saved" stands at the top right for two seconds after a change, one helper for every settings screen', () => {
  const helper = cut('function flashSaved(root)', '// ---------- settings ----------');
  assert.match(helper, /root\.closest\('#panel'\) \? \$\('#panel \.panel-head'\) : \$\('\.set-title', root\)/, "in the panel's head, or beside Settings' title");
  assert.match(helper, /note\.textContent = 'Saved';/);
  assert.match(helper, /setTimeout\(\(\) => note\.classList\.remove\('on'\), 2000\)/);
  assert.match(helper, /setAttribute\('role', 'status'\)/, 'a screen reader says it too');
  for (const file of ['settings.js', 'bots.js', 'groups.js']) assert.match(read(file), /flashSaved\(/, file);
  assert.doesNotMatch(read('settings.js') + read('bots.js'), /Changes save by themselves|id="bs-saved"/);
  const css = read('style.css');
  assert.match(css, /\.saved-note \{[^}]*opacity: 0;/);
  assert.match(css, /\.saved-note\.on \{ opacity: 1; \}/);
});
