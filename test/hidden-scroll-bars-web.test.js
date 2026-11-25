// Scroll bars are hidden on every pane. A pane that only scrolls sideways would then cut a long line off with
// nothing to show it goes on, so a script the owner approves, and code a bot shows, wrap their lines instead.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./web-page');

const css = read('style.css');
const rule = (selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} has a rule`);
  return css.slice(at, css.indexOf('}', at));
};

test('web: no scroll bar is drawn on any element', () => {
  assert.match(css, /html, body, \* \{ scrollbar-width: none; \}/);
  assert.match(css, /\*::-webkit-scrollbar \{ display: none;/);
});

test('web: scripts and code blocks wrap long lines rather than scroll them out of sight', () => {
  for (const selector of ['.need-body pre.nb', '.md pre', '.tile-script pre', '.tool pre']) {
    const r = rule(selector);
    assert.match(r, /white-space: pre-wrap/, `${selector} wraps`);
    assert.doesNotMatch(r, /overflow-x: auto/, `${selector} does not hide lines sideways`);
  }
});
