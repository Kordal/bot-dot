// The table block on the web page (#396, public/blocks.js): sorted by its header, searched, filtered on one column and
// paged, all in the page; a list in a narrow box; what the owner chose stays when the table is drawn again with new
// rows; every word is text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, esc } = require('./web-page');

const kitSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'blocks.js'), 'utf8');
const kit = () => {
  const ctx = vm.createContext({ esc, md: (s) => `<p>${esc(s)}</p>`, $$: () => [], $: () => null });
  vm.runInContext(`${kitSource}\nthis.kitTableView = kitTableView; this.kitTable = kitTable; this.kitTableBody = kitTableBody; this.kitTableState = kitTableState; this.pageBlockHTML = pageBlockHTML; this.pageHTML = pageHTML;`, ctx);
  return ctx;
};
const plain = (x) => JSON.parse(JSON.stringify(x));

const T = {
  type: 'table', text: 'Features', pageSize: 2,
  head: [{ label: 'Feature', type: 'text' }, { label: 'State', type: 'status' }, { label: 'Ref', type: 'ref' }, { label: 'Runs', type: 'number' }],
  rows: [
    [{ text: 'Copy button' }, { text: 'Done', level: 'ok' }, { text: '#285 · PR #288', refs: [{ text: '#285', url: 'https://github.com/o/r/issues/285' }, { text: 'PR #288' }], n: 285 }, { text: '3', n: 3 }],
    [{ text: 'Rooms' }, { text: 'In progress', level: 'info' }, { text: '#371', refs: [{ text: '#371' }], n: 371 }, { text: '12', n: 12 }],
    [{ text: 'Board kit' }, { text: 'Done', level: 'ok' }, { text: '#394', refs: [{ text: '#394' }], n: 394 }, { text: '' }],
  ],
  filter: { column: 1, options: ['Done', 'In progress'] },
};

test('web: a table sorts by a column (numbers as numbers, empty last), searches every cell, filters and pages', () => {
  const { kitTableView } = kit();
  const names = (st) => plain(kitTableView(T, st).rows.map((r) => r[0].text));
  assert.deepEqual(names({}), ['Copy button', 'Rooms'], 'as written, a page of two');
  assert.deepEqual(plain(kitTableView(T, { page: 1 })).rows.map((r) => r[0].text), ['Board kit']);
  assert.equal(kitTableView(T, { page: 9 }).page, 1, 'a page past the end is the last');
  assert.deepEqual(names({ sort: { column: 3, dir: 'desc' } }), ['Rooms', 'Copy button']);
  assert.deepEqual(names({ sort: { column: 3, dir: 'asc' }, page: 1 }), ['Board kit'], 'an empty cell last');
  assert.deepEqual(names({ sort: { column: 0, dir: 'asc' } }), ['Board kit', 'Copy button']);
  assert.deepEqual(names({ filter: 'done', sort: { column: 0, dir: 'desc' } }), ['Copy button', 'Board kit']);
  assert.deepEqual(names({ filter: 'Gone' }), ['Copy button', 'Rooms'], 'a filter its rows no longer have is All');
  assert.deepEqual(names({ q: 'pr #288' }), ['Copy button']);
  const v = kitTableView(T, { q: 'o', filter: 'Done' });
  assert.deepEqual([v.matching, v.total, v.pages], [2, 3, 1]);
  assert.deepEqual(plain(kitTableView({ ...T, sort: { column: 2, dir: 'desc' } }, {}).sort), { column: 2, dir: 'desc' }, 'the bot\'s own sort until the owner picks one');
});

test('web: the table draws its header with the arrow, pills, links, the list for a phone and the footer', () => {
  const { kitTable, kitTableState } = kit();
  kitTableState('k').sort = { column: 0, dir: 'desc' };
  const html = kitTable(T, 'k');
  assert.match(html, /<div class="kit-table" data-tkey="k">/);
  assert.match(html, /<b>Features<\/b><span class="kit-count">3<\/span>/);
  assert.match(html, /<input class="kit-find" type="search" placeholder="Search" value=""/);
  assert.match(html, /<div class="kit-seg" role="group"><button type="button" data-tfilter="" class="on">All<\/button><button type="button" data-tfilter="Done" class="">Done<\/button>/);
  assert.match(html, /<th class=" on"><button type="button" data-tsort="0">Feature<span class="ar">▼<\/span><\/button><\/th>/);
  assert.match(html, /<th class="r "><button type="button" data-tsort="3">Runs<\/button><\/th>/);
  assert.match(html, /<span class="kit-pill info">In progress<\/span>/);
  assert.match(html, /<span class="kit-ref"><a href="https:\/\/github.com\/o\/r\/issues\/285" target="_blank" rel="noopener noreferrer">#285<\/a> · PR #288<\/span>/);
  assert.match(html, /<div class="kit-tlist"><div class="kit-trow"><div class="n">Rooms<span><span class="kit-ref">#371<\/span><\/span><\/div><span class="kit-pill info">In progress<\/span><\/div>/);
  assert.match(html, /<span>2 of 3<\/span><span class="kit-pager"><button type="button" data-tpage="-1" disabled aria-label="Previous">‹<\/button>1 \/ 2<button type="button" data-tpage="1"  aria-label="Next">›<\/button><\/span>/);
  assert.doesNotMatch(kitTable({ ...T, search: false, filter: undefined }, 'k2'), /kit-find|kit-seg/);
  assert.match(kitTable({ ...T, rows: [] }, 'k3'), /No rows/);
});

test('web: drawn again with new rows, a table keeps the sort, search, filter and page the owner chose', () => {
  const { kitTable, kitTableState } = kit();
  const st = kitTableState('page#2');
  Object.assign(st, { q: 'room', filter: 'In progress', sort: { column: 3, dir: 'desc' } });
  const html = kitTable({ ...T, rows: [...T.rows, [{ text: 'Rooms on Android' }, { text: 'In progress', level: 'info' }, { text: '' }, { text: '1', n: 1 }]] }, 'page#2');
  assert.match(html, /value="room"/);
  assert.match(html, /data-tfilter="In progress" class="on"/);
  assert.match(html, /<span>2 of 2 · 4 in all<\/span>/);
  assert.ok(html.indexOf('>Rooms<') < html.indexOf('>Rooms on Android<'));
});

test('web: every word of a table stays text, and a link only goes to a web address', () => {
  const { kitTable } = kit();
  const html = kitTable({ type: 'table', text: '<b>x</b>', head: [{ label: '<i>', type: 'text' }, { label: 'R', type: 'ref' }], rows: [[{ text: '<img src=x>' }, { text: '#1', refs: [{ text: '#1', url: 'javascript:alert(1)' }] }]], pageSize: 10 }, 'e');
  assert.doesNotMatch(html, /<img|<i>|<b>x|javascript:/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('web: a page and the Board draw tables with a key of their own, and wire them', () => {
  const { pageHTML } = kit();
  assert.match(pageHTML([{ block: T }], '/bots/b/pages/p'), /<div class="pb" data-pb="0"><div class="pb-card"><div class="kit-table" data-tkey="\/bots\/b\/pages\/p#0">/);
  const viewer = read('viewer.js');
  assert.match(viewer, /pageBlockHTML\(p\.block, `\$\{c\.src\}#\$\{i\}`\)/);
  assert.match(viewer, /wireCharts\(el\);\s*wireTables\(el\);/);
  const board = read('board.js');
  assert.match(board, /case 'table':\s*return kitTable\(b, `\$\{t\.id\}:\$\{where\}:\$\{b\.key\}`\);/);
  assert.match(board, /wireCharts\(root\);\s*wireTables\(root\);/);
  assert.match(read('style.css'), /@container ktable \(max-width: 560px\) \{\s*\.kit-tbl \{ display: none; \}/);
});
