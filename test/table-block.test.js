// The table block (#396, lib/tile-blocks.js tableOf): on a bot's page with its own rows or bound to a tile's list, and
// on a tile of the Board. botdot checks its columns and fills in each cell (a status's level, a reference's links, a
// number or date to sort by); the apps sort, search, filter and page it. A document and a download get a plain table.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pb = require('../lib/page-blocks');
const tb = require('../lib/tile-blocks');

const fence = (type, v) => `\`\`\`${type}\n${typeof v === 'string' ? v : JSON.stringify(v)}\n\`\`\``;
const COLUMNS = [
  { label: 'Feature' },
  { label: 'State', type: 'status', levels: { Done: 'ok', 'In progress': 'info', Planned: 'plan' } },
  { label: 'Ref', type: 'ref', link: 'https://github.com/owner/repo/issues/{n}' },
  { label: 'Changed', type: 'date' },
  { label: 'Runs', type: 'number', unit: 'x' },
];

test("a page's own table: its cells filled in, its filter's options, its sort, and a list or objects as rows", () => {
  const md = fence('table', {
    title: 'Features', columns: COLUMNS, filter: 'State', sort: { column: 'runs', dir: 'desc' }, pageSize: 2,
    rows: [['Copy button', 'Done', '#285 · PR #288', '2026-10-20T10:00:00Z', 3], { Feature: 'Rooms', State: 'In progress', Ref: '#371', Runs: '1,200' }, ['Paging', 'blocked', 'ADR 062', '', 'n/a']],
  });
  const [{ block: b }] = pb.render(md, null).parts;
  assert.equal(b.type, 'table');
  assert.equal(b.text, 'Features');
  assert.equal(b.label, undefined);
  assert.deepEqual(b.head, [{ label: 'Feature', type: 'text' }, { label: 'State', type: 'status' }, { label: 'Ref', type: 'ref' }, { label: 'Changed', type: 'date' }, { label: 'Runs', type: 'number' }]);
  assert.deepEqual(b.sort, { column: 4, dir: 'desc' });
  assert.equal(b.pageSize, 3, 'at least three rows a page');
  const [copy, rooms, paging] = b.rows;
  assert.deepEqual(copy[1], { text: 'Done', level: 'ok' });
  assert.deepEqual(copy[2], { text: '#285 · PR #288', refs: [{ text: '#285', url: 'https://github.com/owner/repo/issues/285' }, { text: 'PR #288', url: 'https://github.com/owner/repo/issues/288' }], n: 285 });
  assert.equal(copy[3].n, Date.parse('2026-10-20T10:00:00Z'));
  assert.match(copy[3].text, /ago|Oct/);
  assert.deepEqual(copy[4], { text: '3 x', n: 3 });
  assert.deepEqual(rooms[1], { text: 'In progress', level: 'info' });
  assert.deepEqual(rooms[4], { text: '1200 x', n: 1200 });
  assert.deepEqual(rooms[3], { text: '' }, 'a cell the row does not have is empty');
  assert.deepEqual(paging[1], { text: 'blocked', level: 'err' }, 'a level from the words when the column does not name it');
  assert.deepEqual(paging[2], { text: 'ADR 062', refs: [{ text: 'ADR 062' }], n: 62 }, 'no #: no link');
  assert.deepEqual(paging[4], { text: 'n/a' });
  assert.deepEqual(b.filter, { column: 1, options: ['Done', 'In progress', 'blocked'] }, 'the levels in their order, only those its rows have, then the others');
});

test('a reference takes only a web address; a status its own level; a link must hold {n}', () => {
  const md = fence('table', { columns: [{ label: 'Ref', type: 'ref' }, { label: 'S', type: 'status' }], rows: [[{ text: 'PR #1', url: 'javascript:alert(1)' }, { text: 'Up', level: 'warn' }], [{ text: 'PR #2', url: 'https://example.com/2' }, 'Planned']] });
  const { rows } = pb.render(md, null).parts[0].block;
  assert.deepEqual(rows[0][0].refs, [{ text: 'PR #1' }]);
  assert.deepEqual(rows[0][1], { text: 'Up', level: 'warn' });
  assert.deepEqual(rows[1][0].refs, [{ text: 'PR #2', url: 'https://example.com/2' }]);
  assert.equal(rows[1][1].level, 'plan');
  const bad = (v) => pb.inspect(fence('table', v), null).problems[0] || '';
  assert.match(bad({ columns: [{ label: 'R', type: 'ref', link: 'https://x.com/issues/' }], rows: [] }), /link is an address with \{n\}/);
  assert.match(bad({ columns: [{ label: 'R', type: 'ref', link: 'javascript:{n}' }], rows: [] }), /link is an address/);
  assert.match(bad({ columns: [{ label: 'A', type: 'money' }], rows: [] }), /type is one of text, number, date, status, ref/);
  assert.match(bad({ columns: [], rows: [] }), /columns is 1 to 8/);
  assert.match(bad({ columns: ['A'] }), /give its rows/);
  assert.match(bad({ columns: ['A'], rows: [], filter: 'B' }), /there's no column "B" \(there are A\)/);
  assert.match(bad({ columns: ['A'], rows: [1] }), /a row is a list of its cells/);
  assert.match(bad({ columns: ['A'], rows: Array(501).fill([]) }), /at most 500 rows/);
  assert.match(bad('{"columns":["A"],"rows":[["x"]], "grid": 1}'), /^$/, 'a fine table');
  assert.match(pb.inspect(fence('grid', { blocks: [{ type: 'table', columns: ['A'], rows: [] }] }), null).problems[0], /a grid holds kpi, chart, status, callout/);
});

test("a page's table bound to a tile reads the tile's list, and is drawn again with what the tile read next", () => {
  const tile = { tile: { id: 't_gh', title: 'Issues', reads: {} }, data: { value: { items: [{ title: 'B', state: 'open', number: 2 }, { title: 'A', state: 'closed', number: 1 }] } }, history: {}, times: {} };
  const board = { tile: (ref) => (ref === 'Issues' || ref === 't_gh' ? tile : null) };
  const md = fence('table', { tile: 'Issues', bind: 'value.items', title: 'Open work', columns: [{ label: 'Title', item: 'title' }, { label: 'State', item: 'state', type: 'status' }, { label: '#', item: 'number', type: 'ref' }], filter: 'State' });
  let r = pb.render(md, board);
  assert.deepEqual(r.tiles, ['t_gh']);
  let b = r.parts[0].block;
  assert.equal(b.text, 'Open work');
  assert.deepEqual(b.rows.map((x) => x[0].text), ['B', 'A']);
  assert.deepEqual(b.rows[1][1], { text: 'closed', level: 'ok' });
  assert.deepEqual(b.filter, { column: 1, options: ['open', 'closed'] });
  tile.data = { value: { items: [{ title: 'C', state: 'open', number: 3 }] } };
  b = pb.render(md, board).parts[0].block;
  assert.deepEqual(b.rows.map((x) => x[0].text), ['C']);
  assert.equal(b.filter, undefined, 'one option: no filter');
  assert.match(pb.inspect(fence('table', { tile: 'Nope', columns: ['A'] }), board).problems[0], /there's no tile "Nope"/);
});

test('a tile of the Board shows a table of its list, keyed for the apps to keep the owner\'s sort', () => {
  const t = { id: 't1', kind: 'value', read: { type: 'http', url: 'https://x' } };
  const checked = tb.check({ face: [{ type: 'table', bind: 'value', label: 'Deploys', columns: [{ label: 'App', item: 'app' }, { label: 'Took', item: 's', type: 'number', unit: 's' }], sort: 'Took', search: false }] }, t);
  assert.deepEqual(checked.face[0], { type: 'table', columns: [{ label: 'App', item: 'app', type: 'text' }, { label: 'Took', item: 's', type: 'number', unit: 's' }], label: 'Deploys', sort: { column: 1, dir: 'asc' }, pageSize: 10, search: false, bind: 'value' });
  const look = tb.look({ ...t, ...checked }, { data: { value: [{ app: 'web', s: 41 }, { app: 'api', s: 12.5 }] } });
  assert.deepEqual(look.face[0], {
    type: 'table', key: 'f0', text: 'Deploys', head: [{ label: 'App', type: 'text' }, { label: 'Took', type: 'number' }],
    rows: [[{ text: 'web' }, { text: '41 s', n: 41 }], [{ text: 'api' }, { text: '12.5 s', n: 12.5 }]], pageSize: 10, sort: { column: 1, dir: 'asc' }, search: false,
  });
  assert.deepEqual(tb.look({ ...t, ...checked }, { data: { value: 'not a list' } }).face[0].rows, []);
  assert.throws(() => tb.check({ face: [{ type: 'table', bind: 'other', columns: ['A'] }] }, t), /must start with "value"/);
});

test('a date to come is its day; out of botdot the table is a plain table of what it shows', () => {
  const soon = Date.UTC(2099, 0, 5);
  const md = `# Plan\n\n${fence('table', { title: 'Due', columns: [{ label: 'What' }, { label: 'Due', type: 'date' }, { label: 'Ref', type: 'ref' }], rows: [['Ship | it', new Date(soon).toISOString(), '#1 · #2']] })}`;
  const { rows } = pb.render(md, null).parts[1].block;
  assert.deepEqual(rows[0][1], { text: '5 Jan', n: soon });
  assert.equal(pb.plain(md, null), '# Plan\n\n**Due**\n\n| What | Due | Ref |\n| --- | --- | --- |\n| Ship \\| it | 5 Jan | #1 · #2 |\n');
});
