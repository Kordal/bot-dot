// A project's page gets the depth pass (#1188, #723): the board has no frame and no graph paper, its tiles are raised
// surfaces with no 1px border, the "new" buttons are quiet filled pills, the objectives are compact sparkline cards,
// and the team rows come before the objectives and the board, with or without a saved layout. In the Team step a
// bot's head is drawn at its avatar's size, not as a 16px icon (#1189).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { rulesOf } = require('./css-rules');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const css = read('style.css');
const rules = rulesOf(css);
const rule = (sel) => {
  const rs = rules.filter((x) => x.selector === sel);
  assert.ok(rs.length, `has ${sel}`);
  return Object.assign({}, ...rs.map((r) => Object.fromEntries(Object.entries(r.decls).map(([k, v]) => [k, v.value]))));
};

test('the board has no frame and no graph paper', () => {
  const d = rule('.cf-floor');
  for (const k of ['border', 'background', 'background-color', 'background-image', 'padding']) assert.equal(d[k], undefined, `.cf-floor: no ${k}`);
});

test('the board\'s tiles and the objectives are raised surfaces with no 1px border', () => {
  for (const sel of ['.cf-goal', '.cf-room', '.cf-cal', '.cf-files', '.cf-panel', '.pc-card']) {
    const d = rule(sel);
    assert.doesNotMatch(d.border || '', /1px/, `${sel}: no 1px border`);
    assert.match(d.background || '', /var\(--raise-2\)/, `${sel}: on --raise-2`);
    assert.match(d['box-shadow'] || '', /var\(--lift\)/, `${sel}: lit from above`);
  }
});

test('New card, New team and "+" on a team\'s row are filled buttons, not dashed outlines', () => {
  for (const sel of ['.pc-new', '.cf-new', '.sp-new']) {
    const d = rule(sel);
    assert.doesNotMatch(`${d.border || ''} ${d['border-style'] || ''}`, /dashed/, `${sel}: not dashed`);
    assert.equal(d.background, 'var(--fill)', `${sel}: filled`);
    assert.equal(d['min-height'], '44px', `${sel}: a 44px target`);
  }
  const join = rule('.sp-keys .sp-join');
  assert.equal(join['--key-bg'], 'var(--fill)');
  assert.deepEqual([join.width, join.height, join['border-radius']], ['44px', '44px', '50%']);
  assert.ok(!rules.some((x) => /sp-join/.test(x.selector) && /dashed/.test(x.decls.border?.value || '')), 'no dashed "+"');
});

test('an objective is a compact card with a sparkline, no day axis under it', () => {
  assert.equal(rule('.cf-plot').height, '40px');
  assert.equal(rule('.cf-chart > .cf-days').display, 'none');
  assert.equal(rule('.cf-tick').display, 'none');
  assert.match(rule('.cf-goals')['grid-template-columns'], /240px/);
});

test('the team rows come before the objectives and the board', () => {
  const src = read('company-home.js');
  const home = src.slice(src.indexOf('root.innerHTML = `<div class="cf-home">'));
  const at = (s) => { const i = home.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('${teamsHTML(c)}') < at('goalsHTML(c)'), 'teams before the objectives');
  assert.ok(at('goalsHTML(c)') < at('floorHTML(c, f)'), 'the objectives before the board');
  assert.ok(at('checkinHTML(c.checkin)') < at('${teamsHTML(c)}'), 'a check-in that waits for the owner before the teams');
  // A saved layout keeps its tiles where they are; the rows stand above its canvas.
  const view = read('board-canvas-view.js');
  const build = view.slice(view.indexOf('function build('), view.indexOf('const scaleOf'));
  assert.match(build, /home\.append\(wrap\)/);
  assert.doesNotMatch(build, /teams\.before\(wrap\)/);
});

test('a bot\'s head in the Team step is its avatar\'s size, not a 16px icon', () => {
  const d = rule('.co-team .avatar svg');
  assert.deepEqual([d.width, d.height], ['100%', '100%']);
});

test('on an arranged board New card is its tile, a button as tall as a button; in the phone\'s column its own width', () => {
  // `.bc-tile > *` gives a tile's pieces min-height 0: the button keeps its 44px target over it.
  const t = rule('.bc-tile > .pc-new');
  assert.equal(t['align-self'], 'stretch');
  assert.equal(t['min-height'], '44px');
  assert.equal(rule('.bc-column .bc-tile > .pc-new')['align-self'], 'flex-start');
  // Opened into its ask, its tile is drawn at the ask's height for as long as it is open, and not saved so.
  const view = read('board-canvas-view.js');
  assert.match(view, /function opened\(canvas, layout\)/);
  assert.match(view, /B\.grown\(layout, 'new-card'/);
});

test('the cards are wired on an arranged board too: their row is gone, their pieces stand in the tiles', () => {
  const src = read('project-cards.js');
  const guard = src.slice(src.indexOf('function wire('), src.indexOf('function wire(') + 300);
  assert.match(guard, /\[data-pc-new\]/);
  assert.match(guard, /\[data-pc-card\]/);
});
