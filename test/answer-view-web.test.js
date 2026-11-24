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

// ---------- wave 2: inputs and actions, with send-back (#1627, ADR 265) ----------

const FORM = { type: 'stack', children: [
  { type: 'text-input', label: 'Name', value: 'Ada', placeholder: 'Your name' },
  { type: 'textarea', label: 'Notes', value: 'a < b' },
  { type: 'number', label: 'Budget', value: 500, min: 0, max: 1000, step: 50, unit: 'EUR' },
  { type: 'slider', label: 'Volume', value: 30, min: 0, max: 100, unit: '%' },
  { type: 'range', label: 'Price', low: 20, high: 80 },
  { type: 'select', label: 'Region', options: ['EU', 'US'], value: 'US' },
  { type: 'multi-select', label: 'Channels', options: ['Email', 'Chat'], values: ['Chat'] },
  { type: 'radio', label: 'Plan', options: ['Free', 'Pro'], value: 'Pro' },
  { type: 'segmented', label: 'Size', options: ['S', 'M'] },
  { type: 'checkbox', label: 'Summary', checked: true },
  { type: 'toggle', label: 'Alerts' },
  { type: 'date', label: 'Start', value: '2026-12-01' },
  { type: 'time', label: 'At', value: '14:30' },
  { type: 'rating', label: 'Grade', max: 5, value: 4 },
] };

test('every input is a labelled control, drawn read-only until the chat wires it, with what the bot set', () => {
  const html = draw(FORM);
  assert.match(html, /<label class="av-field"><span class="av-label">Name<\/span><input type="text" class="av-in" value="Ada" placeholder="Your name" maxlength="200" disabled data-av-in="0\.0" data-kind="text-input" data-label="Name"><\/label>/);
  assert.match(html, /<textarea class="av-in" rows="3" maxlength="2000" disabled data-av-in="0\.1" data-kind="textarea" data-label="Notes">a &lt; b<\/textarea>/);
  assert.match(html, /<input type="number" class="av-in" value="500" min="0" max="1000" step="50" inputmode="decimal" disabled data-av-in="0\.2"/);
  assert.match(html, /<span class="av-unit">EUR<\/span>/);
  assert.match(html, /<input type="range" class="av-in" value="30" min="0" max="100" step="any" aria-valuetext="30 %" disabled data-av-in="0\.3"/);
  assert.match(html, /<fieldset class="av-field av-range" data-av-in="0\.4" data-kind="range" data-label="Price"><legend class="av-label">Price<\/legend>.*value="20".*aria-label="Price, from".*value="80".*aria-label="Price, to"/);
  assert.match(html, /<select class="av-in" disabled data-av-in="0\.5" data-kind="select" data-label="Region"><option value="">Choose<\/option><option value="EU">EU<\/option><option value="US" selected>US<\/option><\/select>/);
  assert.match(html, /<fieldset class="av-field" data-av-in="0\.6" data-kind="multi-select" data-label="Channels"><legend class="av-label">Channels<\/legend><div class="av-opts"><label class="av-opt"><input type="checkbox" class="av-in" value="Email" disabled><span>Email<\/span><\/label><label class="av-opt"><input type="checkbox" class="av-in" value="Chat" checked disabled>/);
  assert.match(html, /<fieldset class="av-field" data-av-in="0\.7" data-kind="radio" data-label="Plan"><legend class="av-label">Plan<\/legend><div class="av-opts"><label class="av-opt"><input type="radio" class="av-in" name="av-[\w-]+-0-7" value="Free" disabled>.*<input type="radio" class="av-in" name="av-[\w-]+-0-7" value="Pro" checked disabled>/);
  assert.match(html, /<fieldset class="av-field av-seg" data-av-in="0\.8" data-kind="segmented"/);
  assert.match(html, /<label class="av-field av-check"><input type="checkbox" class="av-in" checked disabled data-av-in="0\.9" data-kind="checkbox" data-label="Summary"><span>Summary<\/span><\/label>/);
  assert.match(html, /<label class="av-field av-check av-toggle"><input type="checkbox" role="switch" class="av-in" disabled data-av-in="0\.10" data-kind="toggle" data-label="Alerts"><span>Alerts<\/span><\/label>/);
  assert.match(html, /<input type="date" class="av-in" value="2026-12-01" disabled data-av-in="0\.11"/);
  assert.match(html, /<input type="time" class="av-in" value="14:30" disabled data-av-in="0\.12"/);
  assert.match(html, /<fieldset class="av-field av-rating" data-av-in="0\.13" data-kind="rating" data-label="Grade" data-max="5"><legend class="av-label">Grade<\/legend><div class="av-opts">(<label class="av-star"><input type="radio" class="av-in" name="av-[\w-]+-0-13" value="\d" (?:checked )?disabled><span class="sr-only">\d of 5<\/span><svg [^>]*aria-hidden="true">.*?<\/svg><\/label>){5}<\/div><\/fieldset>/);
  // every control is inside a label or a legend, and none carries a handler, a style or an id of the bot's
  assert.doesNotMatch(html, /\son\w+=|style=|<form/);
  assert.equal((html.match(/class="av-in"/g) || []).length, 1 + 1 + 1 + 1 + 2 + 1 + 2 + 2 + 2 + 1 + 1 + 1 + 1 + 5);
});

test('a form has one Send under it, and a view with only buttons has none; a quiet line waits for "Sent: …"', () => {
  const form = draw(FORM);
  assert.match(form, /<div class="av-actions"><button type="button" class="btn primary av-send" data-av-send disabled>Send<\/button><\/div><p class="av-sent" role="status" hidden><\/p><\/div>$/m);
  assert.match(form, /<div class="av" role="group" aria-label="A view" data-av="[a-z0-9]+" data-av-act="form">/);
  const buttons = draw({ type: 'button', label: 'Yes' });
  assert.match(buttons, /data-av-act="press"/);
  assert.doesNotMatch(buttons, /av-send/);
  assert.match(buttons, /<p class="av-sent" role="status" hidden><\/p>/);
  const plain = draw({ type: 'text', text: 'Hi' });
  assert.doesNotMatch(plain, /data-av-act|av-sent/);
  // links and copy are not sent: a view of them is no form
  assert.doesNotMatch(draw({ type: 'stack', children: [{ type: 'link', label: 'Open', url: 'https://example.com' }, { type: 'copy', label: 'Copy', text: 'x' }] }), /data-av-act/);
});

test('buttons say what they send, in a tone, and a button that says "Approve" is a button like any other', () => {
  const html = draw({ type: 'stack', children: [
    { type: 'button', label: 'Yes, go ahead', send: 'Yes, go ahead with the cheaper plan', tone: 'accent' },
    { type: 'button', label: 'Approve', tone: 'bad' },
    { type: 'button-group', label: 'Choose', children: [{ type: 'button', label: 'A' }, { type: 'button', label: 'B', send: 'Option "B"' }] },
  ] });
  // What a button sends is written on it, not in a tooltip: it differs from the label, so the owner reads it before pressing (touch and keyboard too).
  assert.match(html, /<button type="button" class="btn av-btn t-accent" disabled data-av-press="0\.0" data-say="Yes, go ahead with the cheaper plan"><span class="av-btn-l">Yes, go ahead<\/span><span class="av-btn-say">Sends: Yes, go ahead with the cheaper plan<\/span><\/button>/);
  assert.match(html, /<button type="button" class="btn av-btn t-bad" disabled data-av-press="0\.1" data-say="Approve">Approve<\/button>/);
  assert.match(html, /<div class="av-btns" role="group" aria-label="Choose"><button type="button" class="btn av-btn t-neutral" disabled data-av-press="0\.2\.0" data-say="A">A<\/button><button type="button" class="btn av-btn t-neutral" disabled data-av-press="0\.2\.1" data-say="Option &quot;B&quot;"><span class="av-btn-l">B<\/span><span class="av-btn-say">Sends: Option &quot;B&quot;<\/span><\/button><\/div>/);
  assert.doesNotMatch(html, /title=/, 'no tooltip: it shows on neither touch nor keyboard');
  // nothing in it asks the server for anything: no address, no form, no handler
  assert.doesNotMatch(html, /href=|action=|formaction|<form|\son\w+=/);
});

test('a button that a bot made to send the server\'s "Approved. Go ahead." posts its label, and the page shows it', () => {
  const html = draw({ type: 'stack', children: [{ type: 'button', label: 'Thanks', send: 'Approved. Go ahead.' }, { type: 'button', label: 'Build it.' }] });
  assert.match(html, /<button type="button" class="btn av-btn t-neutral" disabled data-av-press="0\.0" data-say="Thanks">Thanks<\/button>/);
  assert.doesNotMatch(html, /Approved\. Go ahead|Build it/);
  assert.match(html, /<p class="av-unknown">Can't show this here<\/p>/);
});

test('a link opens an https address in a new tab and says so; Copy holds its text for the page to copy', () => {
  const html = draw({ type: 'stack', children: [{ type: 'link', label: 'Read the offer', url: 'https://example.com/offer' }, { type: 'copy', label: 'Copy the code', text: 'npm i\nnpm test' }] });
  assert.match(html, /<a class="btn av-ln" href="https:\/\/example\.com\/offer" target="_blank" rel="noopener noreferrer">Read the offer<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/);
  assert.match(html, /<button type="button" class="btn av-copy" data-av-copy="npm i\nnpm test">Copy the code<\/button>/);
  // never an address that is no https one, even if the tree said so
  const bad = draw({ type: 'link', label: 'x', url: 'javascript:alert(1)' });
  assert.doesNotMatch(bad, /javascript:|<a /);
  assert.doesNotMatch(draw({ type: 'link', label: 'x', url: 'http://example.com' }), /<a /);
});

test('inputs read as text in Copy: the label and its value, a choice with its options, a switch as a tick', () => {
  const text = AnswerViews.text(reply(view({ type: 'stack', children: FORM.children.concat([{ type: 'button', label: 'Yes' }, { type: 'link', label: 'Terms', url: 'https://example.com/t' }, { type: 'copy', label: 'Code', text: 'abc' }]) }, 'A form'), 'Fill it in.'));
  assert.match(text, /\*\*Name:\*\* Ada\n\n\*\*Notes:\*\* a < b\n\n\*\*Budget:\*\* 500 EUR\n\n\*\*Volume:\*\* 30 %\n\n\*\*Price:\*\* 20 to 80/);
  assert.match(text, /\*\*Region:\*\* US \(options: EU, US\)\n\n\*\*Channels:\*\* Chat \(options: Email, Chat\)\n\n\*\*Plan:\*\* Pro \(options: Free, Pro\)\n\n\*\*Size:\*\* \(options: S, M\)/);
  assert.match(text, /- \[x\] Summary\n\n- \[ \] Alerts\n\n\*\*Start:\*\* 2026-12-01\n\n\*\*At:\*\* 14:30\n\n\*\*Grade:\*\* 4\/5\n\n\[Yes\]\n\n\[Terms\]\(https:\/\/example\.com\/t\)\n\n\*\*Code\*\*\n\n```\nabc\n```/);
});

test('a send is read from the owner\'s next message: what a view says it sent, whether this page sent it or an earlier visit did', () => {
  const says = ['Yes, go ahead', 'Option B'];
  assert.equal(AnswerViews.sentFrom('Yes, go ahead', { says }), 'Yes, go ahead');
  assert.equal(AnswerViews.sentFrom('  Option B \r\n', { says }), 'Option B');
  assert.equal(AnswerViews.sentFrom('Something else', { says }), null);
  assert.equal(AnswerViews.sentFrom(null, { says }), null);
  const labels = ['Name', 'Budget'];
  assert.equal(AnswerViews.sentFrom('Name: Ada\nBudget: 500', { labels }), 'Name: Ada\nBudget: 500');
  assert.equal(AnswerViews.sentFrom('Name: Ada', { labels }), null, 'a message that lacks an input is no send of the form');
  assert.equal(AnswerViews.sentFrom('Budget: 500\nName: –', { labels }), 'Budget: 500\nName: –');
  assert.equal(AnswerViews.sentFrom('anything', {}), null);
});

test('who may send: only the newest bot message that is whole, and only until what it said was sent', () => {
  const bubbles = [{ from: 'bot', id: 'a' }, { from: 'me' }, { from: 'bot', id: 'b' }, { from: 'bot', id: 'c', working: true }, { from: 'bot', id: 'd', problem: true }];
  assert.equal(AnswerViews.newest(bubbles), 'b', 'a reply still being written, or a failed one, is not the newest message');
  assert.equal(AnswerViews.newest([{ from: 'me' }]), null);
  assert.equal(AnswerViews.newest([{ from: 'bot', id: 'x', folded: true }]), null, 'a message between bots is no one\'s question to answer');
  assert.deepEqual(plain(AnswerViews.stateOf({ newest: true, sent: null })), { state: 'open' });
  assert.deepEqual(plain(AnswerViews.stateOf({ newest: true, sent: 'Yes' })), { state: 'sent', said: 'Yes' });
  assert.deepEqual(plain(AnswerViews.stateOf({ newest: false, sent: 'Yes' })), { state: 'sent', said: 'Yes' });
  assert.deepEqual(plain(AnswerViews.stateOf({ newest: false, sent: null })), { state: 'closed' });
});

test('a view is open again when the owner takes a waiting send back: the chat is the truth, and what was posted counts only until the chat shows it', () => {
  const says = ['Yes'];
  const read = (mine, pending) => plain(AnswerViews.sendOf({ mine, says, pending }));
  // posted, and the chat does not show it yet (the send is on its way): sent
  assert.deepEqual(read([], 'Yes'), { sent: 'Yes', pending: 'Yes' });
  // the chat shows it (a bubble, or a waiting one): the chat says it now, and the post is forgotten
  assert.deepEqual(read(['Yes'], 'Yes'), { sent: 'Yes', pending: null });
  assert.deepEqual(read(['Yes'], null), { sent: 'Yes', pending: null });
  // the owner took it back: nothing after the view is its send, so it is open again
  assert.deepEqual(read([], null), { sent: null, pending: null });
  // something else the owner wrote first does not hide the send after it, nor stand for one
  assert.deepEqual(read(['wait, one question', 'Yes'], null), { sent: 'Yes', pending: null });
  assert.deepEqual(read(['wait, one question'], null), { sent: null, pending: null });
  // a form's message is read by its labels
  assert.deepEqual(plain(AnswerViews.sendOf({ mine: ['Name: Ada'], labels: ['Name'], pending: 'Name: Ada' })), { sent: 'Name: Ada', pending: null });
});

// The owner's bubble is drawn with its mentions and its /command as chips, so its text is not the message: a view reads what
// was sent from the bubble's data-text (the message as written), and only without one from what is drawn.
const bubbleOf = (text, shown) => ({ dataset: { text }, textContent: shown, querySelector: () => null });
page.$ = (sel, el) => (sel === '.clamp' && el.clamp ? el.clamp : null);

test('a button whose send holds a @mention stays sent: the bubble\'s own text is read, not the chip drawn for it', () => {
  const html = draw({ type: 'button', label: 'Hand it on', send: '@Writer, take it' });
  assert.match(html, /data-say="@Writer, take it"/);
  const says = ['@Writer, take it'];
  // drawn, the mention is a chip with no "@": that text is no send of the button
  assert.equal(AnswerViews.sentFrom('Writer, take it', { says }), null);
  const bubble = bubbleOf('@Writer, take it', 'Writer, take it');
  assert.equal(AnswerViews.textOf(bubble), '@Writer, take it');
  assert.deepEqual(plain(AnswerViews.sendOf({ mine: [bubble].map(AnswerViews.textOf), says, pending: null })), { sent: '@Writer, take it', pending: null });
});

test('a form whose label holds a @mention stays sent', () => {
  const html = draw({ type: 'text-input', label: '@Writer note' });
  assert.match(html, /data-label="@Writer note"/);
  const labels = ['@Writer note'];
  assert.equal(AnswerViews.sentFrom('Writer note: ok', { labels }), null);
  const bubble = bubbleOf('@Writer note: ok', 'Writer note: ok');
  assert.deepEqual(plain(AnswerViews.sendOf({ mine: [bubble].map(AnswerViews.textOf), labels, pending: null })), { sent: '@Writer note: ok', pending: null });
});

test('a send that starts like a /command stays sent', () => {
  const says = ['/btw check the build'];
  const bubble = bubbleOf('/btw check the build', 'btw check the build');
  assert.equal(AnswerViews.sendOf({ mine: [AnswerViews.textOf(bubble)], says, pending: null }).sent, '/btw check the build');
});

test('a bubble without data-text is read from its drawn text, its .clamp first', () => {
  const clamp = { textContent: 'Yes' };
  assert.equal(AnswerViews.textOf({ dataset: {}, textContent: 'Yes, extra', clamp }), 'Yes');
  assert.equal(AnswerViews.textOf({ dataset: {}, textContent: 'Plain' }), 'Plain');
  assert.equal(AnswerViews.textOf({ dataset: { text: '' }, textContent: 'drawn' }), '', 'an empty message is its own text');
});

test('every owner bubble the page draws carries its message as data-text, escaped', () => {
  const sites = { 'bot-chat.js': 2, 'chief.js': 2, 'groups.js': 2, 'rooms.js': 1, 'replies.js': 2 };
  for (const [file, n] of Object.entries(sites)) {
    const src = read(file);
    const owner = src.match(/<div class="bubble from-me[^"]*"[^>]*>/g) || [];
    assert.equal(owner.length, n, `${file} draws ${n} owner bubbles`);
    for (const b of owner) assert.match(b, / data-text="\$\{esc\([^"]+\)\}"/, `${file}: ${b}`);
  }
});

// ---------- wave 3 (#1629): the long tail of components ----------

test('a tree is nested lists, as deep as its items say and never more than one level at a time', () => {
  const html = draw({ type: 'tree', title: 'Plan', items: [
    { text: 'Plan', depth: 0 }, { text: 'Research', depth: 1, note: 'two weeks' }, { text: 'Interviews', depth: 2, tone: 'good' }, { text: 'Deep', depth: 5 }, { text: 'Build', depth: 0 }] });
  assert.match(html, /<div class="av-block"><div class="av-title">Plan<\/div><ul class="av-tree">/);
  // Plan > Research > (Interviews > Deep, since the depth 5 is read as 3), then Build beside Plan
  assert.match(html, /<li class="t-neutral"><span class="av-tree-t">Plan<\/span><ul><li class="t-neutral"><span class="av-tree-t">Research<\/span><small>two weeks<\/small><ul><li class="t-good"><span class="av-tree-t">Interviews<\/span><ul><li class="t-neutral"><span class="av-tree-t">Deep<\/span><\/li><\/ul><\/li><\/ul><\/li><\/ul><\/li><li class="t-neutral"><span class="av-tree-t">Build<\/span><\/li><\/ul>/);
});

test('a calendar is a month table with a mark on each day that has an event, and its events listed in date order under it', () => {
  const html = draw({ type: 'calendar', title: 'Plans', month: '2026-11', events: [
    { date: '2026-11-17', title: 'Release', tone: 'good' }, { date: '2026-11-03', title: 'Standup' }, { date: '2026-12-01', title: 'Next month' }, { date: 'soon', title: 'Someday' }] });
  assert.match(html, /<table class="av-month"><caption>[^<]*2026[^<]*<\/caption>/);
  assert.equal(html.split('<th scope="col"').length - 1, 7);
  // 30 days; November 2026 starts on a Sunday, so six empty cells come first
  assert.equal(html.split('<td class="empty"').length - 1 >= 6, true);
  assert.match(html, /<td class="has t-neutral"><span aria-hidden="true">3<\/span><span class="sr-only">3[^<]*: Standup<\/span><\/td>/);
  assert.match(html, /<td class="has t-good">/);
  assert.equal((html.match(/<td class="(?:has|day)/g) || []).length, 30);
  // the agenda: by date, the day that is no day last, the other month's event too
  assert.match(html, /<ol class="av-agenda"><li class="t-neutral"><time datetime="2026-11-03">[^<]*<\/time> Standup<\/li><li class="t-good"><time datetime="2026-11-17">[^<]*<\/time> Release<\/li><li class="t-neutral"><time datetime="2026-12-01">[^<]*<\/time> Next month<\/li><li class="t-neutral"><span>soon<\/span> Someday<\/li><\/ol>/);
  // a month that is no month: only the list
  const bad = draw({ type: 'calendar', month: 'November', events: [{ date: '2026-11-03', title: 'Standup' }] });
  assert.doesNotMatch(bad, /<table/);
  assert.match(bad, /<ol class="av-agenda">/);
});

test('a kanban is a section for each column, a list of its cards under its title, and no handle to move one', () => {
  const html = draw({ type: 'kanban', title: 'Sprint', columns: [
    { title: 'To do', cards: [{ title: 'Write', text: 'for Monday', tone: 'warn' }, { title: 'Book' }] }, { title: 'Done', cards: [] }] });
  assert.match(html, /<div class="av-block"><div class="av-title">Sprint<\/div><div class="av-kanban">/);
  assert.match(html, /<section class="av-col" aria-label="To do"><h4>To do<small> 2<\/small><\/h4><ul><li class="t-warn"><b>Write<\/b><span>for Monday<\/span><\/li><li class="t-neutral"><b>Book<\/b><\/li><\/ul><\/section>/);
  assert.match(html, /<section class="av-col" aria-label="Done"><h4>Done<small> 0<\/small><\/h4><\/section>/);
  assert.doesNotMatch(html, /draggable|<button|tabindex/);
});

test('a heatmap shades each cell by its number, shows the number, has its Data and its source', () => {
  const html = draw({ type: 'heatmap', title: 'Visits', rows: ['Mon', 'Tue'], columns: ['9', '12'], values: [[0, 10], [5, null]], unit: 'visits', source: 'analytics.csv' });
  assert.match(html, /<figure class="av-chart pb-card"><div class="av-plot" role="group" aria-label="Visits">/);
  assert.match(html, /<table class="av-heat">/);
  assert.match(html, /<th scope="row">Mon<\/th><td style="--i:0">0<\/td><td style="--i:1">10<\/td>/);
  assert.match(html, /<th scope="row">Tue<\/th><td style="--i:0.5">5<\/td><td class="none"><\/td>/);
  assert.match(html, /<details class="av-data"[^>]*><summary>Data<\/summary>.*<td class="num">10 visits<\/td>/);
  assert.match(html, /<p class="av-source">Source: analytics.csv<\/p>/);
  assert.match(draw({ type: 'heatmap', rows: ['A'], columns: ['x'], values: [[1]] }), /<p class="av-source none">No source<\/p>/);
});

test('an alert says its tone in a word as well as a colour, an empty state holds its buttons, and a countdown is a timer of its own', () => {
  const alert = draw({ type: 'alert', title: 'Heads up', text: 'The report is late.' });
  assert.match(alert, /<div class="av-alert t-warn" role="group" aria-label="Warning"><span class="av-alert-i" aria-hidden="true">!<\/span><div><b>Heads up<\/b>The report is late\.<\/div><\/div>/);
  assert.match(draw({ type: 'alert', text: 'Saved.', tone: 'good' }), /av-alert t-good" role="group" aria-label="Done"/);
  assert.match(draw({ type: 'alert', text: 'x', tone: 'bad' }), /aria-label="Problem"/);
  assert.match(draw({ type: 'alert', text: 'x', tone: 'accent' }), /aria-label="Note"/);
  const empty = draw({ type: 'empty-state', title: 'No invoices yet', text: 'Add one.', children: [{ type: 'button', label: 'Add one', send: 'Add an invoice' }] });
  assert.match(empty, /<div class="av-empty"><b>No invoices yet<\/b><span>Add one\.<\/span><div class="av-btns" role="group">.*data-av-press="0\.0" data-say="Add an invoice"/);
  const count = draw({ type: 'countdown', label: 'Launch', to: '2026-12-31T18:00', tone: 'accent' });
  assert.match(count, /<div class="av-countdown t-accent" role="timer" aria-label="Launch" data-av-count="2026-12-31T18:00"><span class="av-count-l">Launch<\/span><time class="av-count-n">[^<]*<\/time><\/div>/);
  // a moment that is no moment is its label and what it said
  assert.match(draw({ type: 'countdown', label: 'Soon', to: 'next Friday' }), /<div class="av-countdown t-neutral"><span class="av-count-l">Soon<\/span><span class="av-count-n">next Friday<\/span><\/div>/);
});

test('a poll and a quiz are buttons that post their own words, and a view with only them is one to press', () => {
  const poll = draw({ type: 'poll', question: 'Which day?', options: ['Monday', 'Tuesday'] });
  assert.match(poll, /data-av-act="press"/);
  assert.match(poll, /<div class="av-poll" role="group" aria-label="Which day\?"><b class="av-q">Which day\?<\/b><div class="av-btns"><button type="button" class="btn av-btn av-choice t-neutral" disabled data-av-press="0\.0" data-say="Monday">Monday<\/button><button[^>]*data-av-press="0\.1" data-say="Tuesday">Tuesday<\/button><\/div><\/div>/);
  const quiz = draw({ type: 'quiz', question: 'Capital?', options: ['Kraków', 'Warsaw'], answer: 1, explain: 'Since 1596.' });
  assert.match(quiz, /<div class="av-poll av-quiz" role="group" aria-label="Capital\?" data-correct="Warsaw" data-explain="Since 1596\.">/);
  assert.match(quiz, /<p class="av-reveal" role="status" hidden><\/p>/);
  assert.doesNotMatch(poll, /av-reveal|data-correct/);
  // a poll's choice that is not a quiz's answer index in range reveals no right or wrong
  assert.doesNotMatch(draw({ type: 'quiz', question: 'Q', options: ['A', 'B'], answer: 5 }), /data-correct/);
});

test('a quiz says whether the choice that was sent was right, once it was sent, and what the answer is when it was not', () => {
  const v = AnswerViews.verdict;
  const n = { type: 'quiz', question: 'Capital?', options: ['Kraków', 'Warsaw'], answer: 1, explain: 'Since 1596.' };
  assert.deepEqual(plain(v(n, 'Warsaw')), { right: true, text: 'Correct. Since 1596.' });
  assert.deepEqual(plain(v(n, 'Kraków')), { right: false, text: 'Not quite. The answer is Warsaw. Since 1596.' });
  assert.equal(v(n, 'Something else'), null);
  assert.equal(v({ ...n, answer: 5 }, 'Warsaw'), null);
  assert.deepEqual(plain(v({ ...n, explain: undefined }, 'Warsaw')), { right: true, text: 'Correct.' });
});

test('the new components are text too: Copy and export give an outline, an agenda, columns, a table, a question and its choices', () => {
  const tx = (root) => AnswerViews.text(reply(view(root, 'Alt')), { done: true });
  const has = (root, re) => assert.match(tx(root), re);
  has({ type: 'tree', title: 'Plan', items: [{ text: 'A', depth: 0 }, { text: 'B', depth: 3, note: 'n' }] }, /\*\*Plan\*\*\n\n- A\n {2}- B \(n\)/);
  has({ type: 'calendar', title: 'Plans', month: '2026-11', events: [{ date: '2026-11-17', title: 'b' }, { date: '2026-11-03', title: 'a' }] }, /\*\*Plans\*\*\n\n\*\*2026-11\*\*\n\n- 2026-11-03: a\n- 2026-11-17: b/);
  has({ type: 'kanban', columns: [{ title: 'To do', cards: [{ title: 'Write', text: 'now' }] }, { title: 'Done' }] }, /\*\*To do\*\*\n\n- Write: now\n\n\*\*Done\*\*/);
  has({ type: 'heatmap', rows: ['Mon'], columns: ['9', '12'], values: [[1, null]], source: 's.csv' }, /\| {2}\| 9 \| 12 \|\n\| --- \| --- \| --- \|\n\| Mon \| 1 \| {2}\|\n\n\*Source: s\.csv\*/);
  has({ type: 'alert', title: 'Late', text: 'The report.' }, /> \*\*Late\*\* The report\./);
  has({ type: 'empty-state', title: 'Nothing', text: 'Yet.', children: [{ type: 'button', label: 'Add' }] }, /\*\*Nothing\*\*\n\nYet\.\n\n\[Add\]/);
  has({ type: 'countdown', label: 'Launch', to: '2026-12-31' }, /\*\*Launch:\*\* 2026-12-31/);
  has({ type: 'poll', question: 'Which?', options: ['A', 'B'] }, /\*\*Which\?\*\*\n\n- A\n- B/);
  // the answer of a quiz is not in its copy
  assert.doesNotMatch(tx({ type: 'quiz', question: 'Q?', options: ['A', 'B'], answer: 1, explain: 'because' }), /because/);
});

test('once a poll or a quiz was sent, the choice that went is marked, and a quiz says whether it was right; before, it says nothing', () => {
  // the page's $$ over stand-in elements: each holds the parts a selector finds in it
  const el = (props = {}, parts = {}) => ({ dataset: {}, hidden: true, textContent: '', attrs: {}, parts, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { this.attrs[k] = undefined; }, ...props });
  const choice = (say) => el({ dataset: { avPress: 'x', say } });
  const [a, b] = [choice('Kraków'), choice('Warsaw')];
  const reveal = el();
  const quiz = el({ dataset: { correct: 'Warsaw', explain: 'Since 1596.' } }, { '[data-av-press]': [a, b], '.av-reveal': [reveal] });
  const av = el({}, { '.av-poll': [quiz] });
  const saved = page.$$;
  page.$$ = (sel, root) => root.parts[sel] || [];
  page.$ = (sel, root) => (root.parts[sel] || [])[0] || null;
  try {
    AnswerViews.mark(av, { state: 'open' });
    assert.equal(reveal.hidden, true);
    assert.equal(a.attrs['aria-pressed'], undefined);
    AnswerViews.mark(av, { state: 'sent', said: 'Kraków' });
    assert.equal(reveal.hidden, false);
    assert.equal(reveal.textContent, 'Not quite. The answer is Warsaw. Since 1596.');
    assert.deepEqual([a.attrs['aria-pressed'], b.attrs['aria-pressed'], a.attrs['data-result'], b.attrs['data-result']], ['true', 'false', 'wrong', 'right']);
    AnswerViews.mark(av, { state: 'sent', said: 'Warsaw' });
    assert.deepEqual([reveal.textContent, b.attrs['data-result'], a.attrs['data-result']], ['Correct. Since 1596.', 'right', undefined]);
    // taking the send back opens it again
    AnswerViews.mark(av, { state: 'open' });
    assert.deepEqual([reveal.hidden, b.attrs['aria-pressed'], b.attrs['data-result']], [true, undefined, undefined]);
  } finally { page.$$ = saved; page.$ = undefined; }
});

test('a view that names a tile (#1630) is drawn with its written values; an open chat swaps in the tile\'s live ones, and what the tile can\'t say leaves them', async () => {
  const lv = vm.createContext({ ...words, esc, URL, JSON, linkPaths: (html) => html, FILE_ICON: '<svg></svg>', wireCharts() {}, document: { addEventListener() {} }, $$: () => [] });
  vm.runInContext(`${read('products.js')}\n${read('blocks.js')}\n${read('answer-view.js')}\n${read('answer-text.js')}\n${read('answer-view-draw.js')}\n${cut('function md(src, botId)', '// Link bare web addresses after rendering')}\nthis.md = md; this.AnswerViews = AnswerViews;`, lv);
  const asked = [];
  const answer = { nodes: [], tiles: ['t_q'] };
  await lv.AnswerViews.load(async (p, o) => { asked.push({ p, body: o.body }); assert.equal(o.method, 'POST'); return answer; }, ['ui-live']);
  lv.AnswerViews.use(catalog);

  const kpi = { type: 'kpi', label: 'Queue', value: '5', unit: ' jobs', source: 'the bot', tile: 'Queue', bind: 'value' };
  const text = { type: 'text', text: 'Hi' };
  const html = lv.md(reply(view({ type: 'stack', children: [text, kpi, { type: 'table', columns: [{ label: 'A' }], rows: [['x']], tile: 'Queue' }] })), 'shopper');
  assert.match(html, /<div class="av" [^>]*data-av-live>/);
  assert.equal((html.match(/<div class="av-live" data-av-at="0\.\d">/g) || []).length, 2, 'the two that bind each have their own box, by their path');
  assert.match(html, /av-kpi[^]*?>5</, 'the written value shows first');
  assert.doesNotMatch(html, /data-av-live[^>]*>[^]*<p class="av-text[^]*av-live[^]*Hi/);
  const plainReply = lv.md(reply(view({ type: 'kpi', label: 'K', value: '1' })), 'shopper');
  assert.doesNotMatch(plainReply, /av-live/, 'a view that binds nothing has no box and asks nothing');

  // A chat that wired its views asks, once, with the nodes that bind; the answer is drawn into their boxes only.
  const key = /data-av="([a-z0-9]+)"/.exec(html)[1];
  const boxes = [{ dataset: { avAt: '0.1' }, innerHTML: '' }, { dataset: { avAt: '0.2' }, innerHTML: '' }];
  const chat = { parentElement: null, matches: () => false };
  const av = { dataset: { av: key }, parentElement: chat, matches: (s) => s === '.av[data-av-live]' };
  lv.$$ = (sel) => (sel === '.av[data-av-live]' ? [av] : sel === `.av[data-av="${key}"]` ? [av] : sel === '.av-live' ? boxes : []);
  answer.nodes = [{ ...kpi, value: '7', source: 'Queue' }, null];
  lv.AnswerViews.wireChat(chat, async () => true);
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 1);
  assert.equal(asked[0].p, '/dashboard/live');
  assert.deepEqual(Array.from(asked[0].body.nodes, (n) => n.type), ['kpi', 'table'], 'only the nodes that bind, as they were written');
  assert.match(boxes[0].innerHTML, /av-kpi[^]*?>7</, 'the live value over the written one');
  assert.match(boxes[0].innerHTML, /Source: Queue/, "the tile's name is the source");
  assert.match(boxes[1].innerHTML, /<td>x<\/td>/, 'a tile that could not be read: the written table stays');
  assert.match(boxes[1].innerHTML, /av-source none/, 'with the quiet source line as before, and no error');
  assert.equal(asked[0].body.bot, 'shopper', "whose reply it is: of tiles of one title, that bot's first");

  // Asked again when the live feed says that tile changed; not for another tile, and not in a document or a room (no chat).
  lv.AnswerViews.tileChanged('t_other');
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 1);
  answer.nodes = [{ ...kpi, value: '9', source: 'Queue' }, null];
  lv.AnswerViews.tileChanged('t_q');
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 2);
  assert.match(boxes[0].innerHTML, />9</);
  lv.AnswerViews.tileChanged(undefined);
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 3, 'the Board changed: every view that binds asks');
  const loose = { dataset: { av: key }, parentElement: { parentElement: null }, matches: () => true };
  lv.$$ = (sel) => (sel === '.av[data-av-live]' ? [loose] : []);
  lv.AnswerViews.wire({ matches: () => false });
  lv.AnswerViews.tileChanged('t_q');
  await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 3, 'outside a chat of the owner a view shows what was written');
});

test('a server that does not say ui-live is never asked', async () => {
  const lv = vm.createContext({ ...words, esc, URL, JSON, document: { addEventListener() {} }, $$: () => [] });
  vm.runInContext(`${read('answer-view.js')}\n${read('answer-text.js')}\n${read('answer-view-draw.js')}\nthis.AnswerViews = AnswerViews;`, lv);
  await lv.AnswerViews.load(async () => { throw new Error('asked'); }, ['ui-catalog']).catch(() => {});
  lv.AnswerViews.use(catalog);
  lv.AnswerViews.tileChanged('t_q'); // nothing to ask with, nothing thrown
});
