// One look on every app (#447): the colour tokens of the web page (public/style.css) and Android (Paper in Theme.kt)
// are the same set, with the same value. Both are dark only (#14), so the value is the dark one. A token one
// app has alone is named below with its reason; any other token missing in an app, or with another value there, fails.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = {
  web: 'public/style.css',
  android: 'android/app/src/main/java/dev/botdot/app/ui/Theme.kt',
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Tokens only some apps have. fig-ink: the web page's figures mix their deep shade towards it; the apps compute
// that shade in their figure code (FigureDef.deep).
const ONLY = { web: ['figInk'], android: [] };

// `line-2` → `line2`, `warn-line` → `warnLine`: the apps' names for the web page's.
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

// The block of `text` that starts at `head` and ends at the bracket that closes it.
function block(text, head, open = '{', close = '}') {
  const a = text.indexOf(head);
  assert.ok(a >= 0, `has ${head}`);
  let depth = 0;
  for (let i = text.indexOf(open, a); i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(a, i + 1);
  }
  assert.fail(`${head} is closed`);
}

// { name: '#rrggbb' } of each app: its dark value.
function web(css) {
  assert.doesNotMatch(css, /prefers-color-scheme|data-theme/, 'style.css: one theme, no light one');
  return Object.fromEntries([...block(css, ':root {').matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{8}|#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)]
    .map(([, k, v]) => [camel(k), long(v)]));
}

function android(kt) {
  assert.doesNotMatch(kt, /LightPaper|isSystemInDarkTheme|lightColorScheme/, 'Theme.kt: one Paper, no light one');
  // 0xAARRGGBB → '#rrggbb', or '#rrggbbaa' when it is not opaque.
  return Object.fromEntries([...block(kt, 'val DarkPaper = Paper(', '(', ')').matchAll(/(\w+)\s*=\s*Color\(0x([0-9a-f]{2})([0-9a-f]{6})\)/gi)]
    .map(([, k, a, v]) => [k, `#${v}${a.toLowerCase() === 'ff' ? '' : a}`.toLowerCase()]));
}

function long(hex) {
  const h = hex.toLowerCase();
  return h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h;
}

const themes = () => ({ web: web(read(FILES.web)), android: android(read(FILES.android)) });

// What differs between the apps' themes: one line per token that is missing in an app or has another value.
function differences(t) {
  const out = [];
  const names = new Set(Object.values(t).flatMap((x) => Object.keys(x)));
  for (const name of [...names].sort()) {
    const has = Object.keys(t).filter((app) => t[app][name]);
    const owners = Object.keys(t).filter((app) => ONLY[app].includes(name));
    if (owners.length) {
      for (const app of owners.filter((a) => !has.includes(a))) out.push(`${name}: missing in ${app} (${FILES[app]})`);
      if (has.some((app) => !owners.includes(app))) out.push(`${name}: only ${owners.join(', ')} should have it, but ${has.join(', ')} do`);
      continue;
    }
    for (const app of Object.keys(t).filter((a) => !has.includes(a))) out.push(`${name}: missing in ${app} (${FILES[app]})`);
    const values = new Set(has.map((app) => t[app][name]));
    if (values.size > 1) out.push(`${name}: ${has.map((app) => `${app} ${t[app][name]}`).join(', ')}`);
  }
  return out;
}

test('the web page and Android have the same colour tokens with the same values', () => {
  assert.deepEqual(differences(themes()), []);
});

test('the accents are tokens of every app: the dot, the mention blue and the warning line', () => {
  const t = themes();
  for (const app of Object.keys(t)) {
    assert.equal(t[app].dot, '#d85a30', `${app}: dot`);
    assert.equal(t[app].mention, '#378add', `${app}: mention`);
    assert.equal(t[app].warnLine, '#ef9f27', `${app}: warnLine`);
  }
});

test('a token changed in one app alone, or missing there, is found', () => {
  const t = themes();
  const changed = structuredClone(t);
  changed.android.mention = '#000000';
  assert.deepEqual(differences(changed), ['mention: web #378add, android #000000']);
  const missing = structuredClone(t);
  delete missing.android.warnLine;
  assert.deepEqual(differences(missing), [`warnLine: missing in android (${FILES.android})`]);
  const shared = structuredClone(t);
  shared.android.figInk = shared.web.figInk;
  assert.deepEqual(differences(shared), ['figInk: only web should have it, but web, android do']);
});
