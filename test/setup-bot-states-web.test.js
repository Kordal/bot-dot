// The Setup page's card "How a bot shows what it's doing" (#1699): one row for each line a bot's key can say, in the
// order a new owner meets them. Each row is the bot's tile (public/figure.js, drawn from lib/figure.json), the status
// line as Home draws it (Keypad.status, keyState in public/list.js) and one sentence of what it means. The part of
// public/setup.js that draws the card, cut out and run against the real Figure, Keypad and words.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, cut, esc, words } = require('./web-page');
const { webSource } = require('./web-source');

const lib = vm.createContext({ ...words });
for (const f of ['figure.js', 'keypad.js']) vm.runInContext(read(f), lib);
lib.Figure.use(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'figure.json'), 'utf8')));

const BOT_COLORS = [['#1d9e75', 'Teal'], ['#378add', 'Blue'], ['#7f77dd', 'Purple'], ['#d4537e', 'Pink'], ['#e24b4a', 'Red'], ['#ef9f27', 'Amber'], ['#639922', 'Green'], ['#888780', 'Grey']];
const botFigure = (color, st = 'idle', size = '', outfit = null) => `<div class="avatar head ${size}">${lib.Figure.svg(st, color, outfit)}</div>`;
const src = [cut('const keyState = ', '// section: on a phone'), cut('// The six lines a bot', '\nasync function renderSetup')].join('\n');

const card = () => {
  const ctx = vm.createContext({ ...words, esc, BOT_COLORS, botFigure, Keypad: lib.Keypad });
  return vm.runInContext(`${src}\nbotStatesCard()`, ctx);
};
const rows = (html) => [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((m) => m[0]);
const tileOf = (row) => row.match(/<svg class="fig fig-(\w+)/)[1];
const kindOf = (row) => row.match(/<span class="key-st (\w+)"/)[1];
const wordsOf = (row) => row.match(/<span class="key-st[^>]*><span>([^<]*)<\/span>/)[1];
const meaningOf = (row) => row.match(/<span class="state-meaning">([^<]*)<\/span>/)[1];

test('the card has a title and six rows', () => {
  const html = card();
  assert.match(html, /^<section class="card bot-states"/);
  assert.match(html, /<h3 id="bot-states-title">How a bot shows what it(&#39;|')s doing<\/h3>/);
  assert.equal(rows(html).length, 6);
});

test('the rows go working, needs, unread, done, failed, idle, each with the tile state of the issue', () => {
  const r = rows(card());
  assert.deepEqual(r.map(kindOf), ['working', 'needs', 'unread', 'done', 'failed', 'idle']);
  assert.deepEqual(r.map(tileOf), ['working', 'needs_you', 'idle', 'idle', 'failed', 'idle']);
});

test('the status line is the words Home uses, and a working bot says what it does now', () => {
  assert.deepEqual(rows(card()).map(wordsOf), ['Checking your inbox', 'Needs you', '2 unread', 'Done', 'Couldn\'t finish', 'Watching, last 07:12'].map((s) => esc(s)));
});

test('each row has its sentence of meaning', () => {
  assert.deepEqual(rows(card()).map(meaningOf), [
    'Working on a task. The line says what it does right now.',
    'It asks you something or waits for your OK. Open its chat to answer.',
    'New replies you haven&#39;t read yet.',
    'Finished. Its chat has the result.',
    'The last task stopped. Its chat says why.',
    'Nothing to do now. Its job runs again on schedule.',
  ].map((s) => s.replace('&#39;', "'")).map((s) => esc(s)));
});

test('the tiles are the real figure, in the six example colours, each with its icon, and nothing is clickable', () => {
  const html = card();
  const want = [['#378add', 'working', 'mail'], ['#1d9e75', 'needs_you', 'plane'], ['#7f77dd', 'idle', 'news'], ['#ef9f27', 'idle', 'receipt'], ['#e24b4a', 'failed', 'globe'], ['#639922', 'idle', 'tag']];
  rows(html).forEach((r, i) => assert.ok(r.includes(lib.Figure.svg(want[i][1], want[i][0], { icon: want[i][2] })), `${want[i]}`));
  assert.equal(new Set(rows(html).map((r) => r.match(/<svg[\s\S]*?<\/svg>/)[0])).size, 6, 'six different tiles');
  assert.doesNotMatch(html, /<(button|a)\b|onclick|data-go|tabindex/);
});

test('the Setup page puts the card after the checklist and before the foot button', () => {
  const draw = cut('  root.innerHTML = `\n    ${PAGE_BACK}', 'const redraw = () => drawSetup();');
  assert.ok(draw.indexOf('${botStatesCard()}') > draw.indexOf("${adv ? `<h3 class=\"page-sub\">") && draw.indexOf('${botStatesCard()}') < draw.indexOf('settings-foot'));
  assert.ok(webSource().includes('function botStatesCard('));
});

test('the card has its words in Polish, the line\'s words the ones Home has', () => {
  const pl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'i18n', 'pl', 'web.json'), 'utf8'));
  for (const s of ['How a bot shows what it\'s doing', 'Checking your inbox', 'Working on a task. The line says what it does right now.', 'It asks you something or waits for your OK. Open its chat to answer.', 'New replies you haven\'t read yet.', 'Finished. Its chat has the result.', 'The last task stopped. Its chat says why.', 'Nothing to do now. Its job runs again on schedule.', 'Needs you', 'Done', 'Couldn\'t finish', 'Watching, last {time}']) assert.ok(typeof pl[s] === 'string' && pl[s], s);
  assert.ok(pl['{n} unread'].few);
});

test('the dot of a tile in the card is cut out in the card\'s colour, nowhere else', () => {
  const css = read('style.css');
  assert.match(css, /\.bot-states \.fig \.t-cut\s*\{\s*fill:\s*var\(--raise-2\)/);
  assert.match(css, /grid-template-columns:\s*32px 128px 1fr/);
});
