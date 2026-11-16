// The Team step follows the width of the project's screen, not the window's (#1501). With the Chief's chat docked
// beside it, a 1024 px window leaves the project's screen about 520 px: a side column of 300 px beside the cards cut a
// bot's name to "Q…" and broke its description one word per line. Below 760 px of that screen the side column goes
// under the cards, below 480 px the card's rows lose their indent; the window's width does not decide it any more.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// The body of the first at-rule whose head is `head`, braces matched.
function block(head) {
  const at = css.indexOf(`${head} {`);
  assert.ok(at >= 0, `style.css has "${head}"`);
  let i = css.indexOf('{', at), depth = 1;
  const from = i + 1;
  while (depth && ++i < css.length) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
  return css.slice(from, i);
}

test('the project\'s screen is a container named company', () => {
  assert.match(css, /#view-company \{ container-type: inline-size; container-name: company; \}/);
});

test('below 760 px of the project\'s screen the side column goes under the cards (#1501)', () => {
  const b = block('@container company (width < 760px)');
  assert.match(b, /\.co-team \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(b, /\.co-aside \{ position: static; \}/);
});

test('below 480 px the card\'s rows lose their indent, as on a phone (#1501)', () => {
  const b = block('@container company (width < 480px)');
  assert.match(b, /\.co-rows, \.co-preview \{ margin-left: 0; \}/);
  assert.match(b, /\.co-rows \{ grid-template-columns: 90px minmax\(0, 1fr\); \}/);
});

test('the window\'s width no longer decides the Team step\'s columns (#1501)', () => {
  for (const m of css.matchAll(/@media \([^)]*\) \{/g)) {
    const at = m.index;
    let i = css.indexOf('{', at), depth = 1;
    const from = i + 1;
    while (depth && ++i < css.length) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    assert.doesNotMatch(css.slice(from, i), /\.co-team \{ grid-template-columns/, `${m[0]} leaves .co-team's columns to the container`);
  }
  // A card's text column may shrink: it never holds the name and description at a few characters' width.
  assert.match(css, /\.co-card-title \{ flex: 1; min-width: 0; \}/);
});
