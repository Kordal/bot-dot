// Start from scratch (#788) sits right under the new-project field and its source chips, not at the page's foot (#849).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { read } = require('./web-page');

test('web: Start from scratch follows the sources, and nothing pushes it to the foot', () => {
  const draw = read('company.js').match(/function drawStart\(root\) \{[\s\S]*?\n  \}/)[0];
  assert.match(draw, /<div id="co-sources">[\s\S]*?<\/div>\s*\$\{[^}]*project-empty[^`]*`<button[^>]*data-start-empty/, 'right after the source chips');
  const css = read('style.css');
  const rule = css.match(/\.co-empty \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /margin-top: auto/);
  assert.match(rule, /align-self: center/);
});

test('Android: Start from scratch is in the field\'s column, above the bottom spacer', () => {
  const kt = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/dev/botdot/app/ui/CompanyScreen.kt'), 'utf8');
  const form = kt.match(/private fun StartForm\([\s\S]*?\n\}\n/)[0];
  const scratch = form.indexOf('tr("Start from scratch")');
  const bottom = form.indexOf('Spacer(Modifier.weight(1.4f))');
  assert.ok(scratch > 0 && bottom > 0 && scratch < bottom, 'the button comes before the bottom spacer');
});
