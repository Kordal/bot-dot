// Settings rows in groups (#728): the rows of a bot's settings, the Chief's and Settings stand in a few groups, each
// one raised surface (#723) with no line between its rows, and a bot's category chips have no "Category" label over
// them. The page's own code and styles (test/web-page.js, test/css-rules.js); the Android app's, read as text (its
// build and unit tests run in `make android-test`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cut, read } = require('./web-page');
const { rulesAt, winner } = require('./css-rules');

const LIST = { tag: 'div', classes: ['set-list'], index: 2 };
const ROW = { tag: 'label', classes: ['bs-row'], index: 2 };
const LINK = { tag: 'button', classes: ['bs-row', 'bs-link'], index: 3 };

test('web: a group of rows is one raised surface, and no row draws a line, in a wide window and on a phone', () => {
  for (const wide of [1440, 390]) {
    // Without the fields' rules (:is() of inputs, which test/css-rules.js does not read): they hold no row.
    const rules = rulesAt(read('style.css'), wide).filter((r) => !r.selector.includes(':is('));
    assert.equal(winner(rules, [LIST], 'background').value, 'var(--raise-2)', `${wide}`);
    assert.equal(winner(rules, [LIST], 'box-shadow').value, 'var(--lift)', `${wide}: its light on the top edge`);
    assert.equal(winner(rules, [LIST], 'border-radius').value, 'var(--r-14)', `${wide}`);
    for (const row of [ROW, LINK]) assert.equal(winner(rules, [LIST, row], 'border-top'), null, `${wide}: no line over ${row.tag}.${row.classes.join('.')}`);
    assert.equal(winner(rules, [LIST, LINK], 'border').value, '0', `${wide}`);
  }
});

test('web: two groups stand a larger gap apart than two rows, which have none', () => {
  assert.match(read('style.css'), /\n\.set-list \+ \.set-list, \* \+ \.set-list \{ margin-top: var\(--sp-24\); \}/);
  assert.match(read('style.css'), /\n\.set-list \{ display: flex; flex-direction: column; padding: 0 var\(--sp-16\);/, 'no gap between its rows');
});

test("web: a bot's settings are four groups of rows and its delete, and its category chips have no label", () => {
  const draw = cut('function renderBotSettings(', '// The bits of the settings page that follow');
  const groups = draw.split('<div class="set-list').slice(1);
  assert.equal(groups.length, 5, 'how it runs; what it uses; the other bots; what you allowed it; duplicate and delete');
  const has = (i, ...words) => words.forEach((w) => assert.ok(groups[i].includes(w), `group ${i + 1} has ${w}`));
  has(0, "tr('Pinned')", 'hotkeyRow(b)', 'id="bs-model"');
  has(1, 'id="bs-skills"', 'id="bs-apps"', 'data-bs-jobs', 'id="bs-files"', 'id="bs-pages"', "tr('Uses the computer')", 'data-bs-screen');
  has(2, "tr('May message')", "tr('Other bots may ask it')", 'id="bs-rooms"');
  has(3, 'id="bs-always"', 'id="bs-overrides"', 'id="bs-advanced"', 'id="bs-rules"');
  has(4, 'id="delete-bot"');
  assert.match(groups[2], /^ \$\{state\.bots\.length > 1 \|\| showsRoomSettings\(b\) \? '' : 'hidden'\}">/, 'a group with nothing to show is not drawn');
  assert.match(draw, /<div class="group-picker" id="group-picker" role="group" aria-label="\$\{esc\(tr\('Category'\)\)\}"><\/div>/, 'its name only for a screen reader');
  assert.doesNotMatch(draw, /<div class="field">\$\{tr\('Category'\)\}/);
});

test("web: the Chief's settings are two groups and Settings three", () => {
  const chief = cut('function renderChiefSettings(', '// The Chief\'s lasting grants');
  assert.equal(chief.split('<div class="set-list"').length - 1, 2);
  assert.match(chief, /id="chief-always"[\s\S]*?<\/div>\s*<\/div>\s*<div class="set-list">\$\{state\.features\.includes\('chief-jobs'\)/, 'how it runs, then what it does and has');
  const settings = cut('function renderSettings(', 'drawInstallCard();');
  assert.equal(settings.split('<div class="set-list"').length - 1, 4, 'the pages it opens; how bots run; this device; the account');
});

test('android: settings rows stand in groups on a raised surface, with no line between them', () => {
  const ui = (f) => fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/dev/botdot/app/ui', f), 'utf8');
  const forms = ui('Forms.kt');
  assert.match(forms, /fun SettingsGroup\(modifier: Modifier = Modifier, content: @Composable \(\) -> Unit\) \{\s*Column\(modifier\.fillMaxWidth\(\)\.raised\(Radius\.card\)\.padding\(horizontal = Space\.s16\)\)/);
  assert.match(forms, /fun Rule\(\) \{ if \(!LocalInGroup\.current\)/, 'no line in a group');
  assert.match(forms, /Unfold\(open\)[^\n]*\n\s*Rule\(\)/, 'a fold row draws its line through Rule');
  const bot = ui('BotSettingsScreen.kt');
  assert.equal(bot.match(/SettingsGroup \{/g).length, 4, 'how it runs; what it uses; the other bots; what you allowed it');
  assert.equal(bot.match(/SwitchRow\(tr\("Pinned below the Chief"\)/g).length, 1, 'Pinned moved to the first group');
  assert.doesNotMatch(bot, /Section\(tr\("Other bots"\)\)|Section\(tr\("Shared rooms"\)\)|Section\(tr\("What it can do"\)\)/, 'rows, not sections with a title');
  assert.equal(ui('ChiefSettingsScreen.kt').match(/SettingsGroup \{/g).length, 2);
  assert.equal(ui('SettingsScreen.kt').match(/SettingsGroup \{/g).length, 3);
  assert.match(ui('FilesScreen.kt'), /if \(LocalInGroup\.current\) \{ LinkRow\(tr\("Files"\)/, 'in a group, Files is a row like the others');
});
