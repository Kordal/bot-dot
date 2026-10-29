// Depth by lightness (#723): on black a shadow does not read, so higher is lighter. The listed parts take a surface
// (--raise, --raise-2, --fill) and the light on its top edge (--lift) instead of a 1px border; a 1px line stays only
// between rows with no surface of their own, and focus rings stay.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { rulesOf } = require('./css-rules');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const rules = rulesOf(css);
// The declarations of the rules whose selector is exactly `sel`, a later one over an earlier one.
const rule = (sel) => {
  const rs = rules.filter((x) => x.selector === sel);
  assert.ok(rs.length, `has ${sel}`);
  return Object.assign({}, ...rs.map((r) => Object.fromEntries(Object.entries(r.decls).map(([k, v]) => [k, v.value]))));
};
const ringless = (d, sel) => {
  for (const k of ['border', 'border-top', 'border-bottom', 'border-left', 'border-right']) assert.doesNotMatch(d[k] || '', /1px/, `${sel}: no 1px ${k}`);
};

test('the surfaces are tokens of :root, and the same as Android\'s', () => {
  const root = rule(':root');
  assert.equal(root['--raise'], '#0f0f0f');
  assert.equal(root['--raise-2'], '#171717');
  assert.equal(root['--fill'], '#232323');
  assert.equal(root['--hi'], '#ffffff0f');
  assert.equal(root['--lift'], 'inset 0 1px 0 var(--hi)');
});

test('raised parts have a lighter surface and the light on their top edge, no border', () => {
  for (const sel of ['.key.active', '.kp-needs', '.composer-box', '.kp-chief', '.card', '.chat-menu', '.mention-list', '.doc-menu', '.reply-chip', '.plan-card', '.mail-card', '.tile']) {
    const d = rule(sel);
    ringless(d, sel);
    assert.match(`${d.background || ''} ${d['--key-bg'] || ''}`, /var\(--raise-2\)/, `${sel}: on --raise-2`);
    assert.match(d['box-shadow'] || '', /var\(--lift\)/, `${sel}: lit from above`);
  }
});

test('Needs you has a warn dot before its text where the tinted frame was', () => {
  const d = rule('.kp-need-text b::before');
  assert.equal(d.background, 'var(--warn)');
  assert.equal(d['border-radius'], '50%');
  assert.ok(!rules.some((x) => x.selector === '.kp-need + .kp-need'), 'no line between its rows');
});

test('the chat pane and the panes beside it are lighter, with no line between them', () => {
  assert.equal(rule('.panel').background, 'var(--raise)');
  assert.equal(rule('.doc-viewer').background, 'var(--raise)');
  ringless(rule('.panel'), '.panel');
  assert.doesNotMatch(rule('.sidebar')['border-right'] || '', /1px/, 'no line right of the list');
  const wide = css.slice(css.indexOf('@media (min-width: 1001px)'));
  assert.match(wide, /\.app:not\(\.place-company\) \.main \{ background: var\(--raise\); \}/, 'the chat beside the keypad is a lighter pane');
});

test('a secondary button is filled, chips are surfaces, fields sink', () => {
  const btn = rule('.btn');
  assert.equal(btn.border, '0');
  assert.equal(btn.background, 'var(--fill)');
  for (const sel of ['.gchip', '.pg-chips span', '.b-choice .seg button']) { ringless(rule(sel), sel); }
  const field = rules.find((x) => x.selector === 'textarea' && x.decls.border);
  assert.equal(field.decls.border.value, '0');
  assert.match(field.decls['box-shadow'].value, /var\(--sink\)/);
  assert.match(css, /input:focus-visible, select:focus-visible, textarea:focus-visible \{ outline: 2px solid/, 'the focus ring stays');
});

test('chat runs and answers have no frame', () => {
  const d = rule('.chat-thread .bubble.from-bot:not(.problem)');
  assert.equal(d.border, '0');
  assert.equal(d.background, 'none');
});

test('the 1px borders outside the Projects screens are fewer than 50 (115 before #723)', () => {
  const ours = css.slice(0, css.indexOf('/* ---------- the Company (#669'));
  const n = (ours.replace(/\/\*[\s\S]*?\*\//g, '').match(/border(-[a-z]+)?: *[^;}]*1px/g) || []).length;
  assert.ok(n < 50, `${n} borders of 1px`);
});
