// Tidy up on the web page (board-tidy): the button beside a running project's gear sends the board as it is seen and
// opens the project's Chief chat beside it. Android draws the same button (ui/ProjectTree.kt TidyButton).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the button is drawn only with board-tidy and a running project, after the gear', () => {
  const co = read('public/company.js');
  const html = co.slice(co.indexOf('const tidyHTML = () =>'), co.indexOf('async function tidyBoard'));
  assert.match(html, /includes\('board-tidy'\)/);
  assert.match(html, /phase === 'running'/);
  assert.match(html, /data-project-tidy/);
  const home = read('public/company-home.js');
  assert.ok(home.indexOf('Company.gearHTML()') < home.indexOf('Company.tidyHTML()'), 'after the gear');
});

test('a tap sends the board as seen and opens the chat the server names', () => {
  const co = read('public/company.js');
  const tap = co.slice(co.indexOf('async function tidyBoard'), co.indexOf('async function openProjectChief'));
  assert.match(tap, /\/company\/layout\/tidy/);
  assert.match(tap, /BoardView\?\.seen\(c\)/);
  assert.match(tap, /Dock\.openChief\(r\.chatId\)/);
  assert.match(co, /\$\$\('\[data-project-tidy\]', root\)/);
  assert.match(read('public/board-canvas-view.js'), /window\.BoardView = \{[^}]*\bseen\b/);
});

test('Android draws it from the same feature and calls the same route', () => {
  const kt = read('android/app/src/main/java/dev/botdot/app/ui/ProjectTree.kt');
  assert.match(kt, /ManyProjects\.TIDY in features/);
  assert.match(read('android/shared/src/commonMain/kotlin/dev/botdot/app/data/ManyProjects.kt'), /TIDY = "board-tidy"/);
  assert.match(read('android/shared/src/commonMain/kotlin/dev/botdot/app/data/Api.kt'), /\/company\/layout\/tidy/);
});

test('the Chief is told how to tidy: the whole board at once, and back', () => {
  const tool = read('lib/mcp-server.js');
  const t = tool.slice(tool.indexOf("name: 'arrange_project_board'"), tool.indexOf("name: 'suggest_company_bot'"));
  assert.match(t, /Tidy up the board\./);
  assert.match(t, /back: true/);
  assert.match(t, /\[\[choices: Put it back\]\]/);
});
