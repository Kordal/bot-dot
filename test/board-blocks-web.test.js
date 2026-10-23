// The Board drawn from blocks on the web page (#394): the block kit (public/blocks.js) and what the Board draws
// with it: the Controls box, the headings' bots and source, the Live marker. Drawn in a browser by
// test/browser/board-blocks.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, esc } = require('./web-page');

const kitSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'blocks.js'), 'utf8');
const kit = () => {
  const ctx = vm.createContext({ esc, md: (s) => `<p>${esc(s)}</p>`, $$: () => [], $: () => null });
  vm.runInContext(`${kitSource}\nthis.kitStatus = kitStatus; this.kitCallout = kitCallout; this.kitClock = kitClock;`, ctx);
  return ctx;
};

test('web: a kpi says its number, unit and "of", its change since when, a sparkline and a bar', () => {
  const { kitKpi, kitClock } = kit();
  const since = Date.parse('2026-10-22T08:00:00Z');
  const html = kitKpi({ text: '21.5', unit: '°C', of: '4', points: [20.7, 21.5], delta: { text: '0.8', dir: 'up', good: true }, since: new Date(since).toISOString(), ratio: 0.62, sub: '2 need you', subColor: 'warn' }, '#e2a846', (c) => `var(--${c})`);
  assert.match(html, /<div class="kit-num">21\.5<small>°C<\/small><small class="of">of 4<\/small><\/div>/);
  assert.ok(html.includes(`<span class="kit-delta good">▲ 0.8 since ${kitClock(since)}</span>`), html);
  assert.ok(html.includes('<span class="kit-sub" style="color:var(--warn)">2 need you</span>'));
  assert.match(html, /<svg class="kit-spark"/);
  assert.match(html, /<div class="kit-bar"><i style="width:62%;--c:#e2a846"><\/i><\/div>/);
  assert.match(kitKpi({ text: '3', delta: { text: '2', dir: 'down', good: false } }, '#fff'), /<span class="kit-delta bad">▼ 2<\/span>/, 'no time: no "since"');
  assert.match(kitKpi({ text: '' }, '#fff'), /<span class="faint">·<\/span>/, 'nothing yet: a faint dot');
  assert.doesNotMatch(kitKpi({ text: '1', points: [1] }, '#fff'), /kit-spark/, 'one point: no line');
});

test('web: status pills and callouts by level, the text escaped', () => {
  const { kitStatus, kitCallout } = kit();
  assert.equal(kitStatus({ text: '<b>ok</b>', level: 'ok' }), '<span class="kit-pill ok">&lt;b&gt;ok&lt;/b&gt;</span>');
  assert.equal(kitStatus({ text: 'x', level: 'nonsense' }), '<span class="kit-pill info">x</span>');
  assert.equal(kitCallout({ text: 'Restart', title: 'Waiting', level: 'warn' }), '<div class="kit-callout warn"><b>Waiting</b><div class="md"><p>Restart</p></div></div>');
});

test('web: one chart code: lines with gridlines, axes and a legend, bars, stacked bars and horizontal bars', () => {
  const { kitChart } = kit();
  const two = kitChart({ text: 'last hour', unit: '%', points: [1, 2], times: [0, 60e3], series: [{ label: 'CPU', points: [1, 2], color: 'ok' }, { label: 'RAM', points: [3, 4] }] }, '#111', (c) => `var(--${c})`);
  assert.match(two, /<g class="grid">(<line [^>]+\/>){3}<\/g>/, 'three dashed gridlines');
  assert.match(two, /<span class="kit-legend"><span><i style="background:var\(--ok\)"><\/i>CPU<\/span><span><i style="background:var\(--mention\)"><\/i>RAM<\/span><\/span>/);
  assert.match(two, /<span class="kit-y top">4 %<\/span><span class="kit-y bottom">1 %<\/span>/);
  assert.match(two, /<div class="kit-x"><span>\d\d:\d\d<\/span><span>\d\d:\d\d<\/span><\/div>/);
  const data = JSON.parse(two.match(/data-chart="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(data.series.map((s) => s.points), [[1, 2], [3, 4]], 'what the tooltip reads');
  assert.equal((two.match(/<polyline /g) || []).length, 2);
  assert.doesNotMatch(kitChart({ points: [1, 2] }, '#111', undefined, { axes: false }), /kit-y|kit-x/, 'no axes on a small face');
  assert.equal((kitChart({ style: 'bar', points: [1, 2, 3], labels: ['a', 'b', 'c'] }, '#111').match(/<rect /g) || []).length, 3);
  assert.equal((kitChart({ style: 'stacked', series: [{ points: [1, 2] }, { points: [3, null] }] }, '#111').match(/<rect /g) || []).length, 3, 'a gap draws nothing');
  assert.match(kitChart({ style: 'hbar', bars: [{ label: 'Inbox', text: '14', ratio: 1 }] }, '#111'), /<div class="kit-hbar"><span class="l">Inbox<\/span><span class="track"><i style="width:100%;--c:#111"><\/i><\/span><span class="n">14<\/span><\/div>/);
  assert.match(kitChart({ points: [5] }, '#111'), /class="faint">·</, 'one point: nothing to draw');
});

const boardKit = () => {
  const ctx = vm.createContext({ botById: (id) => ({ b1: { name: 'Home Helper' }, b2: { name: 'Server Watch' } }[id]), setInterval() {}, state: {}, localStorage: { getItem: () => null } });
  vm.runInContext(`${cut('// A tile whose face is one number', 'function tileHTML(')}\n${cut('// The tiles under one heading as they are drawn', 'function renderDashboard() {')}\nthis.out = { isKpiTile, isControlRow, boardRuns, sectionBots, sectionSource, ageWords, newestAt };`, ctx);
  return ctx.out;
};

test('web: switches and buttons that follow each other are the rows of one Controls box', () => {
  const { boardRuns, isControlRow, isKpiTile } = boardKit();
  const sw = (id, more = {}) => ({ id, kind: 'switch', look: { face: [] }, ...more });
  const val = { id: 'v', kind: 'value', look: { face: [{ type: 'value', text: '3' }] } };
  const runs = boardRuns([sw('a'), { id: 'b', kind: 'button', look: { face: [] } }, val, sw('c'), sw('d', { size: 'wide' }), sw('e', { look: { face: [{ type: 'switch' }] } })]);
  assert.deepEqual(JSON.parse(JSON.stringify(runs.map((r) => (r.rows ? r.rows.map((t) => t.id) : r.tile.id)))), [['a', 'b'], 'v', ['c'], 'd', 'e'], 'a wide one, or one with blocks of its own, stays a tile');
  assert.equal(isControlRow({ kind: 'value', look: { face: [] } }), false);
  assert.equal(isKpiTile(val), true);
  assert.equal(isKpiTile({ kind: 'custom', look: { face: [{ type: 'kpi' }, { type: 'callout' }] } }), false);
});

test('web: a heading names its bots, and where its values come from when that is one', () => {
  const { sectionBots, sectionSource } = boardKit();
  assert.equal(sectionBots([{ bot: 'b1' }, { bot: 'b2' }, { bot: 'b1' }, { bot: 'gone' }, {}]), 'Home Helper, Server Watch');
  assert.equal(sectionSource([{ source: 'script · 30 s' }, {}, { source: 'script · 30 s' }]), 'script · 30 s');
  assert.equal(sectionSource([{ source: 'script · 30 s' }, { source: 'http · 1 min' }]), '');
});

test('web: the refresh button says the age of the newest value', () => {
  const { ageWords, newestAt } = boardKit();
  assert.equal(ageWords(65), '1 min ago', 'a tile and a heading say only how long ago it read');
  assert.equal(ageWords(3.7), '3s ago');
  assert.equal(ageWords(-2), '0s ago', 'a clock a little ahead');
  assert.equal(ageWords(125), '2 min ago');
  assert.equal(ageWords(7300), '2 h ago');
  assert.equal(newestAt([{ at: '2026-10-22T08:00:00Z' }, { at: null }, { at: '2026-10-22T09:00:00Z' }]), Date.parse('2026-10-22T09:00:00Z'));
  assert.equal(newestAt([]), 0);
});

test('web: the kit is loaded before the Board, and the Board draws its blocks with it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('<script src="/blocks.js"></script>') < html.indexOf('<script src="/board.js"></script>'));
  const blocks = cut('function blockHTML(b, t, where) {', 'const fmtNum = ');
  for (const call of ['kitKpi(b', 'kitStatus(b)', 'kitCallout(b)', 'kitChart(b']) assert.ok(blocks.includes(call), call);
});

test('web: the refresh button beside the Board title reads every tile now (#452)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'board.js'), 'utf8');
  assert.match(src, /data-board-refresh aria-label="Refresh"/);
  assert.match(src, /api\('\/dashboard\/refresh', \{ method: 'POST', body: \{ all: true \} \}\)/);
  assert.doesNotMatch(src, /Live · updated/, 'no label beside it, the arrows say it');
});
