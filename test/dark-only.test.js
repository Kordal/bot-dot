// Dark only (#14): the web page, the front door's pages and Android are dark whatever the system says, and there is
// no choice of look left. The colour values themselves are in text-contrast.test.js and tests/theme-parity.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ANDROID = 'android/app/src/main';

test('the web page is dark, and has no light theme or choice of look', () => {
  const css = read('public/style.css');
  assert.doesNotMatch(css, /prefers-color-scheme|data-theme|color-scheme: light/);
  assert.match(css, /:root \{[^}]*--bg: #000000;[^}]*color-scheme: dark;/);
  const html = read('public/index.html');
  assert.doesNotMatch(html, /prefers-color-scheme|theme\.js/);
  assert.match(html, /<meta name="theme-color" content="#000000" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black" \/>/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'public/theme.js')), 'no saved look to apply');
  const app = read('public/app.js');
  assert.doesNotMatch(app, /Appearance|applyTheme|data-theme-pick|botdot\.theme|dataset\.theme/);
});

test("the front door's pages are dark", () => {
  const pages = read('lib/front-door/pages.js');
  assert.doesNotMatch(pages, /prefers-color-scheme|color-scheme: light/);
  assert.match(pages, /:root \{ color-scheme: dark; --bg: #141413;/);
});

test('Android is dark whatever the system says, with light icons on its bars', () => {
  const theme = read(`${ANDROID}/java/dev/botdot/app/ui/Theme.kt`);
  assert.doesNotMatch(theme, /isSystemInDarkTheme|LightPaper|lightColorScheme/);
  assert.match(theme, /val p = DarkPaper/);
  assert.ok(!fs.existsSync(path.join(ROOT, `${ANDROID}/res/values-night`)), 'one window theme');
  const xml = read(`${ANDROID}/res/values/themes.xml`);
  assert.match(xml, /parent="android:Theme\.Material\.NoActionBar"/);
  assert.match(xml, /<color name="paper_bg">#000000<\/color>/);
  assert.match(read(`${ANDROID}/java/dev/botdot/app/MainActivity.kt`), /enableEdgeToEdge\(SystemBarStyle\.dark\(Color\.TRANSPARENT\), SystemBarStyle\.dark\(Color\.TRANSPARENT\)\)/);
  for (const f of ['BotFigure.kt', 'FigureClock.kt']) assert.doesNotMatch(read(`${ANDROID}/java/dev/botdot/app/ui/${f}`), /LocalPaper\.current == DarkPaper/, f);
});
