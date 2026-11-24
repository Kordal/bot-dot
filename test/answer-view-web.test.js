// Answer views on the web page (#1624, ADR 264): a ```ui fence in a reply is read by the validator the apps share
// (public/answer-view.js, the cases of test/fixtures/ui-cases.json) and drawn by public/answer-view-draw.js, in the reply's
// own md(), in a bot's chat, the Chief's, a group's and a room's alike. A bot sets no colour or style; a picture comes
// through botdot; a view that can't be drawn is its code under its one-line alt; Copy, previews and notifications are text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, cut, esc, words } = require('./web-page');

const catalog = require('../lib/ui-catalog.json');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ui-cases.json'), 'utf8'));
const sourceOf = (c) => (c.repeat ? c.source.replace(c.repeat.mark, c.repeat.with.repeat(c.repeat.times)) : c.source);

const page = vm.createContext({ ...words, esc, URL, JSON, linkPaths: (html) => html, FILE_ICON: '<svg></svg>', $$: () => [], wireCharts() {} });
vm.runInContext(`${read('products.js')}
  ${read('blocks.js')}
  ${read('answer-view.js')}
  ${read('answer-text.js')}
  ${read('answer-view-draw.js')}
  ${cut('function md(src, botId)', '// Link bare web addresses after rendering')}
  this.md = md; this.draftSource = draftSource; this.AnswerViews = AnswerViews; this.mdPreview = mdPreview; this.previewLines = previewLines;`, page);
const { md, AnswerViews, previewLines } = page;
AnswerViews.use(catalog);

const reply = (view, before = 'Here it is.') => `${before}\n\n\`\`\`ui\n${typeof view === 'string' ? view : JSON.stringify(view)}\n\`\`\`\n\nAnything else?`;
const view = (root, alt = 'A view') => ({ alt, root });
const draw = (root, botId = 'shopper') => md(reply(view(root)), botId);
const QUIET = "Can't show this here";

test('the page asks for the catalog only from a server that has one, and without it a fence stays its code', async () => {
  const fresh = vm.createContext({ ...words, esc, URL, JSON });
  vm.runInContext(`${read('answer-view.js')}\n${read('answer-text.js')}\n${read('answer-view-draw.js')}\nthis.AnswerViews = AnswerViews;`, fresh);
  let asked = 0;
  const api = async (p) => { asked++; assert.equal(p, '/ui-catalog'); return catalog; };
  await fresh.AnswerViews.load(api, ['reply-draft']);
  assert.equal(asked, 0);
  assert.equal(fresh.AnswerViews.has(reply('{}')), false);
  await fresh.AnswerViews.load(api, ['ui-catalog']);
  assert.equal(asked, 1);
  assert.equal(fresh.AnswerViews.has(reply('{}')), true);
  const down = vm.createContext({ ...words, esc, URL, JSON });
  vm.runInContext(`${read('answer-view.js')}\n${read('answer-text.js')}\n${read('answer-view-draw.js')}\nthis.AnswerViews = AnswerViews;`, down);
  await down.AnswerViews.load(async () => { throw new Error('offline'); }, ['ui-catalog']);
  assert.equal(down.AnswerViews.ready(), false);
});

test('a reply keeps its text around a view, and the view is one box named by its alt', () => {
  const html = draw({ type: 'text', text: 'Hello' });
  assert.match(html, /^<p>Here it is\.<\/p>\n<div class="av" role="group" aria-label="A view" data-av="[a-z0-9]+">/);
  assert.match(html, /<p class="av-text t-neutral">Hello<\/p><\/div>\n<p>Anything else\?<\/p>$/);
});

test('every case of the shared fixture that is drawn draws every component it holds, and every refusal is its code under its alt', () => {
  let drawn = 0, refused = 0;
  const walk = (n, f) => { if (n && typeof n === 'object') { if (typeof n.type === 'string') f(n); Object.values(n).forEach((v) => walk(v, f)); } };
  for (const c of fixture.cases) {
    const html = md(reply(sourceOf(c)), 'shopper');
    if (c.refused) {
      refused++;
      assert.doesNotMatch(html, /class="av"/, c.name);
      assert.match(html, /<div class="code-block"><pre><code>/, c.name);
      if (c.alt) assert.ok(html.includes(`<p class="av-alt">${esc(c.alt)}</p><div class="code-block">`), `${c.name}: its alt above the code`);
      continue;
    }
    drawn++;
    if (c.drawn.root.type === 'unknown') { assert.match(html, /<p class="av-unknown">/, c.name); continue; } // the alt above it
    assert.match(html, /class="av" role="group"/, c.name);
    let unknowns = 0;
    walk(c.drawn.root, (n) => { if (n.type === 'unknown') unknowns++; });
    assert.equal(html.split(QUIET).length - 1, unknowns, `${c.name}: only its unknown components are a quiet line`);
  }
  assert.ok(drawn >= 40 && refused >= 15);
});

test('every component of wave 1 has a drawing', () => {
  const seen = new Set();
  const walk = (n) => { if (n && typeof n === 'object') { if (typeof n.type === 'string') seen.add(n.type); Object.values(n).forEach(walk); } };
  fixture.cases.forEach((c) => walk(c.drawn));
  for (const name of Object.keys(catalog.components)) {
    assert.ok(seen.has(name), `a case draws ${name}`);
  }
  for (const c of fixture.cases) if (!c.refused) {
    const html = md(reply(sourceOf(c)), 'shopper');
    assert.doesNotMatch(html, /<script|onerror|javascript:|style="[^"]*(?:url|expression)/i, c.name);
  }
});

test('an unknown component is one quiet line, and a view whose root is unknown is its alt above that line', () => {
  const html = draw({ type: 'stack', children: [{ type: 'text', text: 'Before' }, { type: 'map', center: 'Warsaw' }, { type: 'text', text: 'After' }] });
  assert.equal(html.split(QUIET).length - 1, 1);
  assert.match(html, /Before<\/p><p class="av-unknown">Can't show this here<\/p><p class="av-text t-neutral">After/);
  const root = md(reply(view({ type: 'map' }, 'A map of Warsaw')));
  assert.match(root, /<p class="av-alt">A map of Warsaw<\/p><p class="av-unknown">Can't show this here<\/p>/);
  assert.doesNotMatch(root, /class="av"/);
});

test('a fence that is refused is its code, with its alt as a quiet line above it', () => {
  const html = md(reply('{"alt": "Sales by month", "root": '), 'shopper');
  assert.match(html, /<p class="av-alt">Sales by month<\/p><div class="code-block"><pre><code>\{&quot;alt&quot;: &quot;Sales by month&quot;, &quot;root&quot;: <\/code><\/pre>/);
  // no alt, no line
  assert.doesNotMatch(md(reply('{"root": {"type": "text", "text": "x"}}')), /av-alt/);
});

test('a fence that never closes stays code once the reply has ended, with its alt', () => {
  const html = md('Wait.\n\n```ui\n{"alt": "A chart", "root": {"type": "chart"', 'shopper');
  assert.match(html, /<p class="av-alt">A chart<\/p><div class="code-block">/);
  assert.doesNotMatch(html, /Drawing a view/);
});

test('a reply still being written waits for its fence to close: a quiet "Drawing a view…", and its text before it', () => {
  const open = 'Here is the chart.\n\n```ui\n{"alt": "Sales", "root": {"type": "chart", "series": [{"points": [1, 2';
  const parts = AnswerViews.parts(open, { done: false });
  assert.equal(parts.length, 2);
  assert.ok(parts[0].startsWith('<p>Here is the chart.</p>') && parts[1].startsWith('<p class="av-drawing" role="status">'));
  assert.match(parts[1], /Drawing a view…/);
  assert.doesNotMatch(parts.join(''), /code-block|Sales/);
  // closed: the view
  const whole = AnswerViews.parts(`${open}]}], "source": "x"}}\n\`\`\``, { done: false });
  assert.match(whole.join(''), /class="av"/);
  // the text still being written is a draft as ever (an unclosed code block of its own is code)
  assert.match(AnswerViews.parts('```ui\n{"alt":"A","root":{"type":"text","text":"x"}}\n```\n\n```js\nlet a', { done: false }).join(''), /<code>let a<\/code>/);
  // the draft's diffing works on stable parts
  assert.deepEqual(AnswerViews.parts(open, { done: false }), AnswerViews.parts(open, { done: false }));
});

test('at most three views in a reply: the fourth stays code under its alt', () => {
  const one = '```ui\n{"alt": "One", "root": {"type": "text", "text": "x"}}\n```';
  const html = md([one, one, one, one].join('\n\ntext\n\n'), 'shopper');
  assert.equal(html.split('class="av"').length - 1, 3);
  assert.match(html, /<p class="av-alt">One<\/p><div class="code-block">/);
});

test('layout: stack, row, grid, card, section, tabs, accordion, divider and spacer', () => {
  const html = draw({ type: 'stack', gap: 'l', children: [
    { type: 'row', children: [{ type: 'badge', text: 'New', tone: 'good' }] },
    { type: 'grid', columns: 3, children: [{ type: 'text', text: 'a' }] },
    { type: 'card', title: 'Plan', tone: 'warn', children: [{ type: 'text', text: 'b' }] },
    { type: 'section', title: 'Why', lead: 'Short', children: [{ type: 'text', text: 'c' }] },
    { type: 'divider', label: 'or' }, { type: 'divider' }, { type: 'spacer', size: 'l' },
  ] });
  assert.match(html, /class="av-stack gap-l"/);
  assert.match(html, /<div class="av-row gap-m"><span class="av-badge t-good">New<\/span>/);
  assert.match(html, /<div class="pb-grid av-grid gap-m" style="--cols:3">/);
  assert.match(html, /<section class="av-card t-warn" aria-label="Plan"><div class="av-card-title">Plan<\/div>/);
  assert.match(html, /<section class="av-section" aria-label="Why"><h3>Why<\/h3><p class="av-lead">Short<\/p>/);
  assert.match(html, /<div class="av-divider" role="separator"><span>or<\/span><\/div><hr class="av-divider">/);
  assert.match(html, /<div class="av-spacer l" aria-hidden="true">/);
});

test('tabs work by keyboard: a tablist of buttons, the first selected, the others hidden', () => {
  const html = draw({ type: 'tabs', children: [
    { type: 'tab', label: 'One', children: [{ type: 'text', text: 'first' }] },
    { type: 'tab', label: 'Two', children: [{ type: 'text', text: 'second' }] },
  ] });
  assert.match(html, /<div role="tablist" class="av-tablist"><button type="button" role="tab" class="av-tab" aria-selected="true" tabindex="0" data-tab="0">One<\/button><button type="button" role="tab" class="av-tab" aria-selected="false" tabindex="-1" data-tab="1">Two<\/button><\/div>/);
  assert.match(html, /<div role="tabpanel" class="av-tabpanel" aria-label="One" tabindex="0">.*first.*<div role="tabpanel" class="av-tabpanel" aria-label="Two" tabindex="0" hidden>.*second/);
});

test('an accordion is details and summary, opened by its `open`', () => {
  const html = draw({ type: 'accordion', children: [{ type: 'panel', title: 'A', open: true, children: [{ type: 'text', text: 'x' }] }, { type: 'panel', title: 'B', children: [] }] });
  assert.match(html, /<details class="av-panel" data-av-key="[\w.]+" open><summary>A<\/summary>/);
  assert.match(html, /<details class="av-panel" data-av-key="[\w.]+"><summary>B<\/summary>/);
});

test('text: headings, text with its lines, lists, quote, code with Copy, key-values and steps with a word for each state', () => {
  const html = draw({ type: 'stack', children: [
    { type: 'heading', text: 'Title', level: 1 }, { type: 'text', text: 'one\ntwo', tone: 'bad' },
    { type: 'list', items: ['a', 'b'], ordered: true }, { type: 'quote', text: 'Q', by: 'Ada' },
    { type: 'code', text: 'a < b', lang: 'js' },
    { type: 'key-value', title: 'Facts', items: [{ key: 'Plan', value: 'Pro' }] },
    { type: 'steps', items: [{ title: 'Set up', state: 'done' }, { title: 'Test', state: 'current' }, { title: 'Ship' }] },
  ] });
  assert.match(html, /<h1 class="av-heading">Title<\/h1><p class="av-text t-bad">one<br>two<\/p><ol class="av-list"><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(html, /<blockquote class="av-quote">Q<cite>Ada<\/cite><\/blockquote>/);
  assert.match(html, /<div class="code-block"><pre><code>a &lt; b<\/code><\/pre><button type="button" class="copy-btn code-copy"/);
  assert.match(html, /<dl class="av-kv"><div><dt>Plan<\/dt><dd>Pro<\/dd><\/div><\/dl>/);
  assert.match(html, /<span class="sr-only">Done: <\/span><b>Set up<\/b>.*<span class="sr-only">Current: <\/span><b>Test<\/b>.*<span class="sr-only">To do: <\/span><b>Ship<\/b>/);
});

test('a table is a table with its columns lined up, a source under it, or a quiet "No source"', () => {
  const t = { type: 'table', title: 'Plans', columns: [{ label: 'Plan' }, { label: 'Price' }], rows: [['Free', '0'], ['Pro', '12']] };
  const html = draw({ type: 'stack', children: [{ ...t, source: 'pricing page' }, t] });
  assert.match(html, /<div class="av-title">Plans<\/div><div class="md-table"><table><thead><tr><th scope="col">Plan<\/th><th scope="col" class="num">Price<\/th><\/tr><\/thead><tbody><tr><td>Free<\/td><td class="num">0<\/td>/);
  assert.match(html, /<p class="av-source">Source: pricing page<\/p>/);
  assert.match(html, /<p class="av-source none">No source<\/p>/);
});

test('the data components: kpis and stat rows, progress, status, timeline, comparison, checklist and callout', () => {
  const html = draw({ type: 'stack', children: [
    { type: 'hero', title: 'Q3', eyebrow: 'Report', lead: 'Good', tags: ['a'] },
    { type: 'stat-row', children: [{ type: 'kpi', label: 'Users', value: '1200', unit: 'k', source: 'GA' }, { type: 'kpi', label: 'Churn', value: '3%' }] },
    { type: 'progress', label: 'Done', value: 40, text: '4 of 10', tone: 'good' }, { type: 'status', text: 'Late', tone: 'bad' },
    { type: 'timeline', items: [{ when: 'Mon', title: 'Kickoff', text: 'x', tone: 'good' }] },
    { type: 'comparison', options: ['A', 'B'], pick: 1, rows: [{ label: 'Price', values: ['1', '2'] }] },
    { type: 'checklist', title: 'To do', items: [{ text: 'Write', done: true }, { text: 'Send' }] },
    { type: 'callout', title: 'Note', text: 'l1\nl2', tone: 'warn' },
  ] });
  assert.match(html, /<header class="pb-hero"><div class="pb-eyebrow">Report<\/div><div class="pb-title">Q3<\/div>/);
  assert.match(html, /<div class="av-statrow"><div class="pb-card av-kpi"><div class="kit-kpi ">[\s\S]*Users[\s\S]*1200<small>k<\/small>[\s\S]*<p class="av-source">Source: GA<\/p><\/div><div class="pb-card av-kpi">[\s\S]*<p class="av-source none">No source<\/p>/);
  assert.match(html, /role="progressbar" aria-label="Done" aria-valuemin="0" aria-valuemax="100" aria-valuenow="40" aria-valuetext="4 of 10"/);
  assert.match(html, /<span class="kit-pill err">Late<\/span>/);
  assert.match(html, /<ol class="av-timeline"><li class="t-good"><span class="mark" aria-hidden="true"><\/span><small>Mon<\/small><b>Kickoff<\/b>/);
  assert.match(html, /<th scope="col" class="pick">B<small>Recommended<\/small><\/th>.*<th scope="row">Price<\/th><td>1<\/td><td class="pick">2<\/td>/);
  assert.match(html, /<li class="task"><input type="checkbox" disabled checked aria-label="Write"> Write<\/li><li class="task"><input type="checkbox" disabled aria-label="Send"> Send<\/li>/);
  assert.match(html, /<div class="kit-callout warn"><b>Note<\/b><div>l1 l2<\/div><\/div>/);
});

test('every chart has a Data toggle with its numbers as a table, and its source or "No source"', () => {
  const html = draw({ type: 'stack', children: [
    { type: 'chart', title: 'Sales', style: 'bar', labels: ['Jan', 'Feb'], series: [{ label: 'EU', points: [10, 20.5] }, { label: 'US', points: [5, null] }], unit: 'k', source: 'sales.csv' },
    { type: 'pie', slices: [{ label: 'A', value: 1 }, { label: 'B', value: 3 }], donut: true },
    { type: 'scatter', series: [{ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }], xLabel: 'Age', yLabel: 'Pay' },
    { type: 'histogram', values: [1, 2, 2, 9], bins: 2 },
    { type: 'sparkline', label: 'Load', points: [1, 3, 2] },
    { type: 'gauge', label: 'Disk', value: 40, unit: '%', source: 'df' },
  ] });
  const toggles = html.match(/<details class="av-data"[^>]*><summary>Data<\/summary>.*?<\/details>/g);
  assert.equal(toggles.length, 6);
  assert.match(toggles[0], /<th scope="col"><span class="sr-only">Label<\/span><\/th><th scope="col" class="num">EU<\/th><th scope="col" class="num">US<\/th>.*<td>Jan<\/td><td class="num">10 k<\/td><td class="num">5 k<\/td>.*<td>Feb<\/td><td class="num">20.5 k<\/td><td class="num"><\/td>/);
  assert.match(toggles[1], /<td>B<\/td><td class="num">3<\/td><td class="num">75%<\/td>/);
  assert.match(toggles[2], /<th scope="col" class="num">Age<\/th>|<th scope="col">Age<\/th>/);
  assert.match(toggles[3], /1 to 5.*3.*5 to 9.*1/);
  assert.match(html, /<p class="av-source">Source: sales\.csv<\/p>/);
  assert.equal(html.split('No source').length - 1, 4);
  // the drawing is named for a screen reader, the series are theme tokens, and a bot's chart has no colour of its own
  assert.match(html, /<div class="av-plot" role="img" aria-label="Sales">/);
  assert.match(html, /style="fill:var\(--av-s0\)"/);
  assert.match(html, /<circle class="av-s1" r="15\.9155"/);
  assert.match(html, /role="meter" aria-label="Disk" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100" aria-valuetext="40 %"/);
  assert.doesNotMatch(html, /#[0-9a-f]{3,6}\b/i);
});

test('a horizontal bar chart draws a bar for each point, and a line chart a line for each series', () => {
  const hbar = draw({ type: 'chart', style: 'hbar', labels: ['A', 'B'], series: [{ points: [2, 4] }], source: 's' });
  assert.match(hbar, /<div class="kit-hbar"><span class="l">A<\/span><span class="track"><i style="width:50%;--c:[^"]+"><\/i>/);
  const line = draw({ type: 'chart', labels: ['a', 'b', 'c'], series: [{ label: 'x', points: [1, 2, 3] }, { label: 'y', points: [3, 2, 1] }], source: 's' });
  assert.equal((line.match(/<polyline /g) || []).length, 2);
  assert.match(line, /class="kit-plot axes" data-chart="/);
});

test('pictures come through botdot, or from the bot\'s own files; video, sound and files only from them', () => {
  const html = draw({ type: 'stack', children: [
    { type: 'image', src: 'https://cdn.example.com/a.png', alt: 'A cat', caption: 'Mia' },
    { type: 'image', src: 'out/b.png', alt: 'A dog' },
    { type: 'gallery', items: [{ src: './c.jpg', alt: 'C' }] },
    { type: 'video', src: 'clips/v.mp4', alt: 'A demo', caption: 'Demo' },
    { type: 'audio', src: 'notes.mp3', title: 'Memo' },
    { type: 'file', src: 'out/report.pdf', title: 'Report' },
    { type: 'link-card', url: 'https://example.com/a', title: 'A page', text: 'About', image: 'https://cdn.example.com/p.jpg' },
  ] });
  assert.match(html, /<img alt="A cat" loading="lazy" decoding="async" src="\/api\/product-image\?url=https%3A%2F%2Fcdn\.example\.com%2Fa\.png">/);
  assert.match(html, /<img alt="A dog" loading="lazy" decoding="async" src="\/api\/bots\/shopper\/path\?path=out%2Fb\.png">/);
  assert.match(html, /src="\/api\/bots\/shopper\/path\?path=c\.jpg"/);
  assert.match(html, /<video controls preload="metadata" playsinline aria-label="A demo" src="\/api\/bots\/shopper\/path\?path=clips%2Fv\.mp4"><\/video>/);
  assert.match(html, /<audio controls preload="none" aria-label="Memo" src="\/api\/bots\/shopper\/path\?path=notes\.mp3">/);
  assert.match(html, /<a class="av-file" href="\/api\/bots\/shopper\/path\?path=out%2Freport\.pdf" download="report\.pdf">/);
  assert.match(html, /<a class="av-link" href="https:\/\/example\.com\/a" target="_blank" rel="noopener noreferrer" data-site-icon>.*product-image/);
  // never straight from a host
  assert.doesNotMatch(html, /(?:src|poster)="https?:/);
  // a reply that is no bot's (the Chief's, a room's) has no files to play: a quiet box with what it shows
  const none = draw({ type: 'stack', children: [{ type: 'video', src: 'v.mp4', alt: 'A demo' }, { type: 'image', src: 'b.png', alt: 'A dog' }] }, '');
  assert.match(none, /<span class="av-missing">A demo<\/span>/);
  assert.doesNotMatch(none, /<video|<img/);
  assert.match(none, /<span class="av-ph" aria-hidden="true">A dog<\/span><\/span>/);
});

test('product cards in a view are the reply\'s own', () => {
  const html = draw({ type: 'products', items: [{ name: 'Lift Pro', url: 'https://shop.example/a', price: '€379', was: '€399', store: 'shop' }, { name: 'Frame' }] });
  assert.match(html, /<div class="products"><div class="pc-pick">/);
  assert.match(html, /<em>−5%<\/em>/);
  assert.match(html, /data-product-save="shopper"/);
});

test('nothing a bot writes is markup, and it sets no colour, size or style', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const html = draw({ type: 'stack', children: [
    { type: 'heading', text: evil }, { type: 'text', text: evil, tone: 'red;background:url(x)' }, { type: 'badge', text: evil, color: 'red', style: 'x' },
    { type: 'table', columns: [{ label: evil }], rows: [[evil]], source: evil },
    { type: 'chart', title: evil, labels: [evil], series: [{ label: evil, points: [1, 2], color: 'red' }], source: evil, style: 'line', stroke: '#f00' },
    { type: 'link-card', url: 'javascript:alert(1)', title: evil }, { type: 'link-card', url: 'https://x.dev/"><script>', title: 'ok' },
  ] });
  assert.doesNotMatch(html, /<img src=x|<script|javascript:|onerror=alert\(1\)>|color:red|background:url/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
  assert.equal((html.match(/style="/g) || []).length, (html.match(/style="(?:--cols:\d|fill:var\(--av-s\d\)|background:var\(--av-s\d\)|stroke:var\(--av-s\d\)|--c:[^";]+|width:[\d.]+%)/g) || []).length, 'only the theme\'s own tokens and measures are styles');
});

test('Copy, a preview and a notification are text: the alt, and for Copy the view as Markdown with its tables as tables', () => {
  const tree = { type: 'stack', children: [
    { type: 'heading', text: 'Plans' },
    { type: 'table', columns: [{ label: 'Plan' }, { label: 'Price' }], rows: [['Free', '0'], ['A|B', '12']], source: 'site' },
    { type: 'chart', title: 'Sales', labels: ['Jan', 'Feb'], series: [{ label: 'EU', points: [1, 2] }], source: 'csv' },
    { type: 'kpi', label: 'Users', value: '12', unit: 'k' }, { type: 'checklist', items: [{ text: 'Do', done: true }] },
  ] };
  const text = reply(view(tree, 'Plans and sales'), 'Before.');
  assert.equal(AnswerViews.alt(text), 'Before.\n\nPlans and sales\n\nAnything else?');
  assert.equal(AnswerViews.text(text), `Before.

Plans and sales

## Plans

| Plan | Price |
| --- | --- |
| Free | 0 |
| A\\|B | 12 |

*Source: site*

**Sales**

|  | EU |
| --- | --- |
| Jan | 1 |
| Feb | 2 |

*Source: csv*

**Users:** 12 k

- [x] Do

Anything else?`);
  // a reply without a fence is itself
  assert.equal(AnswerViews.text('Plain **words**'), 'Plain **words**');
  // a fence that is code keeps its code, under its alt; the preview has the alt alone
  const broken = 'Hi\n\n```ui\n{"alt": "A map", "root": {"type"\n```';
  assert.equal(AnswerViews.alt(broken), 'Hi\n\nA map');
  assert.match(AnswerViews.text(broken), /^Hi\n\nA map\n\n```ui\n\{"alt"/);
  // the page's previews (a project's overview) say the alt, even for a reply that is only a view
  assert.deepEqual(plain(previewLines(reply(view({ type: 'text', text: 'x' }, 'Three options compared'), 'Here.'))), ['Here.', 'Three options compared', 'Anything else?']);
  assert.deepEqual(plain(previewLines('```ui\n{"alt": "Sales by month", "root": {"type": "text", "text": "x"}}\n```')), ['Sales by month']);
});
const plain = (v) => JSON.parse(JSON.stringify(v));

test('a push and a room\'s notice say the alt of a view, as the phone does', () => {
  const { plain: say } = require('../lib/push');
  assert.equal(say(reply(view({ type: 'text', text: 'x' }, 'Sales by month'), 'Done.')), 'Done.\nSales by month\nAnything else?');
  assert.equal(say('```ui\n{"alt": "A chart", "root": {"type": "chart"\n'), 'A chart');
  assert.equal(say('## Plain'), 'Plain');
});

test('the Data toggle and a panel the owner opened stay open when the chat is drawn again', () => {
  // the toggle's state is kept by its key; drawn from the same view it has the same key
  const a = draw({ type: 'chart', series: [{ points: [1, 2] }], source: 's' });
  const b = draw({ type: 'chart', series: [{ points: [1, 2] }], source: 's' });
  assert.equal(a, b);
});
