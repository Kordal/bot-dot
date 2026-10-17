// Text reads on every background (#445): each text token in public/style.css is at least 4.5:1 (WCAG AA)
// on bg, panel and sunk, in light and in dark, and muted stays stronger than faint.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./web-page');

const css = read('style.css');

// The tokens of a block of style.css: `--name: #rrggbb;` → { name: '#rrggbb' }.
function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map(([, k, v]) => [k, v.toLowerCase()]));
}

const light = tokens(css.match(/:root \{([^}]*)\}/)[1]);
const dark = { ...light, ...tokens(css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)[1]) };
const darkBySystem = { ...light, ...tokens(css.match(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/)[1]) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = ['text', 'muted', 'faint', 'err', 'ok-text', 'warn-text'];
const BACKGROUNDS = ['bg', 'panel', 'sunk'];

for (const [mode, t] of [['light', light], ['dark', dark]]) {
  test(`every text token is at least 4.5:1 on bg, panel and sunk (${mode})`, () => {
    for (const fg of TEXT) {
      for (const bg of BACKGROUNDS) {
        assert.ok(t[fg] && t[bg], `--${fg} and --${bg} are set`);
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= 4.5, `--${fg} ${t[fg]} on --${bg} ${t[bg]} is ${r.toFixed(2)}:1`);
      }
    }
  });
}

test('the dark theme by system setting is the same as the chosen one', () => {
  assert.deepEqual(darkBySystem, dark);
});

test('muted is stronger than faint: darker in light, lighter in dark', () => {
  assert.ok(luminance(light.muted) < luminance(light.faint), `${light.muted} is darker than ${light.faint}`);
  assert.ok(luminance(dark.muted) > luminance(dark.faint), `${dark.muted} is lighter than ${dark.faint}`);
});

test('ok and warn words take the text shades, while dots, fills and borders keep the old colours', () => {
  assert.doesNotMatch(css, /[^-]color: var\(--(ok|warn)\)/, 'no text in --ok or --warn');
  assert.match(css, /\.pill\.ok \{ background: var\(--ok-soft\); color: var\(--ok-text\); \}/);
  assert.match(css, /\.pill\.warn \{ background: var\(--warn-soft\); color: var\(--warn-text\); \}/);
  assert.match(css, /\.switch input:checked \+ span \{ background: var\(--ok\); \}/);
  assert.match(css, /\.pip\.in-control \{ border-color: var\(--warn\); \}/);
  const app = read('app.js');
  assert.match(app, /style="color:\$\{tintOf\(b\.color, t, true\)\}"/, "a tile's value in ok or warn is words");
});
