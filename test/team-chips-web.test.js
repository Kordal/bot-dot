// A team's chat is one tap from the project's page (overview-board, ADR 245): a chip per team under the title, on the
// web page and in the Android app, and Team stays beside the title (ADR 238). The browser check is test/browser/team-chips.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the board draws the chips under the title and keeps Team', () => {
  const home = read('public/company-home.js');
  const chips = home.slice(home.indexOf('function teamChipsHTML'), home.indexOf('function fieldHTML'));
  assert.match(chips, /data-cf-team-chat/, 'a chip opens the team chat the same way a team row does');
  assert.match(chips, /Keypad\.teamWaits/, 'Needs you from the same waits as the rows');
  assert.match(chips, /if \(!shown\.length\) return ''/, 'no teams, no strip');
  assert.match(home, /\$\{one \? teamChipsHTML\(c\) \+ needsTileHTML\(c\)/, 'only on the board of overview-board');
  assert.match(home, /\$\('\.cf-top', root\)\.insertAdjacentHTML\('beforeend', `<button type="button" class="btn sm" data-po-team>/, 'Team stays');
});

test('the strip survives the board canvas, which removes what it does not know', () => {
  const view = read('public/board-canvas-view.js');
  assert.equal(view.split('.cf-top, .cf-teamchips, .sp-needs, .cf-needs, .sp-teams').length - 1, 2, 'kept above the canvas and not picked up as a tile');
});

test('Android draws the same chips from the shared rule', () => {
  const kt = read('android/app/src/main/java/dev/botdot/app/ui/CompanyHome.kt');
  assert.match(kt, /if \(one && !overview && !teamView\) \{[\s\S]*ProjectRules\.teamChips/);
  assert.match(kt, /fun TeamChips\(/);
  assert.match(read('android/shared/src/commonMain/kotlin/dev/botdot/app/data/ProjectDesk.kt'), /fun teamChips\(/);
});
