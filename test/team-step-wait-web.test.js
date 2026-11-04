// The Team step while the Chief proposes the team: the Chief at full size with one status line, a longer wait said
// as such, a failure with its reason and Try again, and a "busy" answer (the page reloaded meanwhile) waited out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./web-page');

test('web: the Team step shows the Chief at work, with a machine-readable state', () => {
  const js = read('company-team.js');
  const team = js.match(/function team\(root, c\) \{[\s\S]*?loadApps\(\);/)[0];
  assert.match(team, /data-state="proposing" aria-busy="true" role="status">\$\{botFigure\(CHIEF_COLOR, 'working', 'lg', Figure\.CHIEF\)\}/, 'the working Chief, not the idle one');
  assert.match(team, /tr\('Almost there…'\) : tr\('Putting your team together…'\)/);
  assert.match(team, /data-state="failed" role="alert">[\s\S]*data-again>\$\{tr\('Try again'\)\}/);
  const propose = js.match(/async function propose\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(propose, /setTimeout\(\(\) => \{ if \(ui\.asking && state\.company\?\.id === id\) Company\.redraw\(\); \}, LONG\)/, 'the long line comes without a redraw from elsewhere');
  assert.match(propose, /if \(e\.state === 'busy'\) \{[^}]*await Company\.load\(\); \}/, 'a busy answer waits and reads the project again');
  assert.match(propose, /finally \{ clearTimeout\(long\); \}/);
});

test('web: a head on a setup step fills its avatar (the icons\' 16 px rule shrank it)', () => {
  const css = read('style.css');
  assert.match(css, /\.co-start svg \{ width: 16px; height: 16px;/);
  assert.match(css, /\.co-start \.avatar\.head svg \{ width: 100%; height: 100%; \}/);
  assert.match(css, /\.co-wait \.avatar\.lg \{ width: 96px; height: 96px; \}/);
});

test('Android: the Team step says the same while the Chief proposes', () => {
  const kt = require('fs').readFileSync(require('path').join(__dirname, '..', 'android/app/src/main/java/dev/botdot/app/ui/CompanyTeam.kt'), 'utf8');
  assert.match(kt, /ChiefAtWork\(if \(long\) tr\("Almost there…"\) else tr\("Putting your team together…"\)\)/);
});
