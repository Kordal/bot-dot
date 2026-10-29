// The scales (#721): font sizes, weights, radii and spacings of the web page, the bots' page kit and the admin page
// are tokens of one scale, and a new literal fails (scripts/check-css-tokens.js, also part of make lint).
const test = require('node:test');
const assert = require('node:assert/strict');
const { literals, FILES } = require('../scripts/check-css-tokens');

const SCALES = ['--fs-12', '--fs-14', '--fs-16', '--fs-20', '--fs-24', '--fs-32', '--sp-4', '--sp-8', '--sp-12', '--sp-16',
  '--sp-24', '--sp-32', '--sp-48', '--sp-64', '--sp-96', '--r-8', '--r-14', '--r-pill'];
// The value each token is set to in css: { '--fs-12': '12px', ... }.
const tokens = (css) => Object.fromEntries([...css.matchAll(/(--(?:fs|sp|r)-[\w]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

test('every style keeps to the scales', () => {
  for (const [name, read] of Object.entries(FILES)) assert.deepEqual(literals(read()), [], name);
});

test('the kit and the admin page have the same scales as the web page', () => {
  const [web, ...others] = Object.values(FILES).map((read) => tokens(read()));
  assert.deepEqual(Object.keys(web).sort(), [...SCALES].sort());
  for (const t of others) assert.deepEqual(t, web);
});

test('a literal off the scales is found, with its line', () => {
  const css = '.a { padding: var(--sp-8); }\n.b { gap: 10px; border-radius: 50%; margin: 0 1px; }\n.c { font: 500 var(--fs-14)/20px var(--font); }\n.d { font-size: 13px; font-weight: 700; }';
  assert.deepEqual(literals(css).map((f) => `${f.line} ${f.prop}`), ['2 gap', '3 font', '4 font-size', '4 font-weight']);
});

test('what may stay a literal is not found', () => {
  const css = '@font-face { font-family: X; font-weight: 100 900; }\n.a { margin: 0 auto; padding: .5em 1px; border-radius: 50%; font: inherit; font-weight: 600; }\n.b { --pad: 10px; gap: calc(var(--sp-8) * -1); }';
  assert.deepEqual(literals(css), []);
});

test('the Projects sections are held until their own tickets land', () => {
  const css = '/* ---------- the Company (#669) ---------- */\n.co-a { gap: 10px; }\n/* ---------- the Board ---------- */\n.b { gap: 10px; }';
  assert.deepEqual(literals(css).map((f) => f.line), [4]);
});
