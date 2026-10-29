// Bots after Projects (#757): from the Projects screen, or a chat docked on it, Bots opens the Chief's chat. Whether
// the Projects screen is up is asked before the place changes, since a docked chat only counts on Projects.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./web-page');

test('web: Bots from the Projects screen or a chat docked on it opens the Chief', () => {
  const choose = read('company.js').match(/function choose\(p\) \{[\s\S]*?\n  \}/)[0];
  assert.match(choose, /const onProjects = state\.view === 'company' \|\| \(typeof Dock !== 'undefined' && Dock\.docked\(\)\);\n[\s\S]*place = p === 'company'/, 'asked before the place changes');
  assert.match(choose, /else if \(onProjects\) \{ setView\('chief'\); showList\(\); renderContacts\(\); \}/);
});

test('Android: Bots from the Company, or a chat opened on it, goes back to the Chief', () => {
  const kt = require('fs').readFileSync(require('path').join(__dirname, '..', 'android/app/src/main/java/dev/botdot/app/MainActivity.kt'), 'utf8');
  assert.match(kt, /else if \(route == "company" \|\| runCatching \{ nav\.getBackStackEntry\("company"\) \}\.isSuccess\) nav\.popBackStack\("home", inclusive = false\)/);
});
