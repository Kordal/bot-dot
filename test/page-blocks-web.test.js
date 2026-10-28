// A bot's page with blocks on the web page (#395): public/blocks.js draws its parts, the kit between its Markdown, with
// every word escaped; the viewer draws them, redraws them from the live feed, and copies the page as text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, esc, words } = require('./web-page');

const kitSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'blocks.js'), 'utf8');
const kit = () => {
  const ctx = vm.createContext({ ...words, esc, md: (s) => `<p>${esc(s)}</p>`, $$: () => [], $: () => null });
  vm.runInContext(`${kitSource}\nthis.pageBlockHTML = pageBlockHTML; this.pageHTML = pageHTML;`, ctx);
  return ctx;
};

test('web: a hero, kpis and charts on cards, pills and a callout, and the words stay text', () => {
  const { pageBlockHTML } = kit();
  const hero = pageBlockHTML({ type: 'hero', eyebrow: 'Report', title: '<i>Features</i>', lead: 'What is done', tags: ['weekly'] });
  assert.match(hero, /<div class="pb-eyebrow">Report<\/div><div class="pb-title">&lt;i&gt;Features&lt;\/i&gt;<\/div><p class="pb-lead">What is done<\/p><div class="pb-tags"><span>weekly<\/span><\/div>/);
  const kpi = pageBlockHTML({ type: 'kpi', text: '42', of: '58', label: 'Done', points: [30, 42], delta: { text: '12', dir: 'up', good: true } });
  assert.match(kpi, /^<div class="pb-card"><div class="kit-kpi has-spark">/);
  assert.match(kpi, /style="--c:var\(--mention\)"/, 'the accent without a colour of its own');
  assert.match(pageBlockHTML({ type: 'kpi', text: '1', color: 'warn', sub: 'x', subColor: 'ok', points: [1, 2] }), /style="color:var\(--ok-text\)"/);
  assert.match(pageBlockHTML({ type: 'chart', text: 'Closed', style: 'bar', points: [1, 2], labels: ['a', 'b'] }), /^<div class="pb-card"><div class="kit-chart">/);
  assert.equal(pageBlockHTML({ type: 'status', text: 'ok', level: 'ok' }), '<span class="kit-pill ok">ok</span>');
  assert.match(pageBlockHTML({ type: 'callout', text: 'x', level: 'warn' }), /^<div class="kit-callout warn">/);
});

test('web: a grid side by side, a row of pills, and a quiet line for a block that cannot be drawn', () => {
  const { pageBlockHTML, pageHTML } = kit();
  assert.match(pageBlockHTML({ type: 'grid', columns: 3, blocks: [{ type: 'kpi', text: '1' }, { type: 'kpi', text: '2' }] }), /^<div class="pb-grid" style="--cols:3">(<div class="pb-card">.*){2}/s);
  assert.match(pageBlockHTML({ type: 'grid', columns: 9, blocks: [{ type: 'kpi', text: '1' }] }), /--cols:4/);
  assert.equal(pageBlockHTML({ type: 'grid', blocks: [{ type: 'status', text: 'a', level: 'ok' }, { type: 'status', text: 'b', level: 'err' }] }), '<div class="pb-pills"><span class="kit-pill ok">a</span><span class="kit-pill err">b</span></div>');
  assert.equal(pageBlockHTML({ type: 'error', text: 'Block 2: "<x>"' }), '<div class="pb-error" title="Block 2: &quot;&lt;x&gt;&quot;">This block could not be drawn</div>');
  assert.equal(pageBlockHTML({ type: 'something new' }), '<div class="pb-error" title="">This block could not be drawn</div>', 'a block of a newer server');
  const html = pageHTML([{ md: '# Top <b>x</b>' }, { block: { type: 'status', text: 's', level: 'ok' } }]);
  assert.equal(html, '<p># Top &lt;b&gt;x&lt;/b&gt;</p><div class="pb" data-pb="1"><span class="kit-pill ok">s</span></div>');
});

test('web: the viewer draws a page\'s parts, redraws its blocks from the live feed, and copies it as text', () => {
  const viewer = read('viewer.js');
  assert.match(viewer, /v\.parts && typeof pageHTML === 'function' \? `<article class="md dv-md dv-page">\$\{pageHTML\(v\.parts, c\.src\)\}<\/article>`/);
  assert.match(viewer, /withQuery\(c\.src, 'blocks=1'\)/);
  assert.match(viewer, /cur\.mode === 'rendered' && cur\.view\?\.plain/);
  assert.match(read('feed.js'), /DocViewer\.tileChanged\(d\.tile\?\.id\)/);
  assert.match(read('document.js'), /text: v\.plain \|\| v\.text/, 'Open as document writes the blocks out');
});
