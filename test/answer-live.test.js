// Live numbers in an answer view (#1630, lib/answer-live.js, ADR 264 amendment, ADR 071): a data component that names a tile
// of the Board is filled in from it as a block of a page is, read again by the view's own validator, and left as the bot wrote
// it when the tile can't say. A route hands it to the owner's apps; the tile is the only source.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, feed } = require('./helpers');
const live = require('../lib/answer-live');
const AnswerView = require('../public/answer-view');
const catalog = require('../lib/ui-catalog.json');

const view = AnswerView.of(catalog);
const DISK = {
  tile: { id: 't_disk', title: 'Disk', reads: {} },
  data: { value: { used: 71, free: 29, runs: [{ name: 'build', secs: 41 }, { name: 'test', secs: 87 }, { name: 'lint', secs: 12 }] } },
  history: { 'value.used': [60, 65, 71] },
  times: { 'value.used': [1, 2, 3] },
};
const WAIT = { tile: { id: 't_wait', title: 'Waiting', approved: false, reads: {} }, data: { value: 3 }, history: {}, times: {} };
const PAGE = { tile: { id: 't_page', title: 'A page', kind: 'page', reads: {} }, data: { value: 5 }, history: {}, times: {} };
const board = { tile: (ref) => ({ t_disk: DISK, disk: DISK, t_wait: WAIT, waiting: WAIT, t_page: PAGE }[String(ref).toLowerCase()] || null) };
// What an app reads of a fence: the node as the validator keeps it.
const node = (n) => view.validate(JSON.stringify({ alt: 'A', root: n })).root;

test('the catalog says which components bind to a tile, and its version came with it', () => {
  assert.equal(catalog.version, 4);
  for (const type of live.BOUND) {
    assert.ok(catalog.components[type].props.tile, `${type} has tile`);
    assert.equal(catalog.components[type].since <= 3, true, 'a component an older app draws keeps drawing');
  }
  assert.ok(catalog.components.table.props.bind && catalog.components.table.props.columns.of.props.item);
  assert.ok(catalog.components.chart.props.series.of.props.bind && catalog.components.chart.props.item && catalog.components.chart.props.labelItem);
});

test('a view that names a tile keeps the tile and the path, and the values it was written with', () => {
  const kpi = node({ type: 'kpi', label: 'Disk', value: '70', unit: '%', tile: 'Disk', bind: 'value.used' });
  assert.deepEqual(kpi, { type: 'kpi', label: 'Disk', value: '70', unit: '%', tile: 'Disk', bind: 'value.used', noSource: true });
});

test('a kpi shows the tile\'s value, its recent values, and the tile\'s name as its source; the rest stays as written', () => {
  const written = node({ type: 'kpi', label: 'Disk', value: '70', unit: '%', sub: 'at noon', good: 'down', tile: 't_disk', bind: 'value.used', source: 'the bot' });
  const { nodes, tiles } = live.fill([written], board);
  assert.deepEqual(tiles, ['t_disk']);
  assert.deepEqual(nodes[0], { type: 'kpi', label: 'Disk', value: '71', unit: '%', sub: 'at noon', good: 'down', points: [60, 65, 71], tile: 't_disk', bind: 'value.used', source: 'Disk' });
});

test('a tile named by its title, and a kpi with no path reading the tile\'s own value', () => {
  const t = { tile: { id: 't_q', title: 'Queue', reads: {} }, data: { value: 12 }, history: {}, times: {} };
  const b = { tile: (ref) => (['queue', 't_q'].includes(String(ref).toLowerCase()) ? t : null) };
  const filled = live.fill([node({ type: 'kpi', label: 'Queue', value: '9', tile: 'Queue' })], b).nodes[0];
  assert.equal(filled.value, '12');
  assert.equal(filled.source, 'Queue');
  assert.equal(filled.noSource, undefined, 'a source it has');
});

test('a gauge and a sparkline', () => {
  const [gauge, spark] = live.fill([
    node({ type: 'gauge', label: 'Disk', value: 50, min: 0, max: 100, tile: 'disk', bind: 'value.used' }),
    node({ type: 'sparkline', points: [1, 2], tile: 'disk', bind: 'value.used', label: 'Disk' }),
  ], board).nodes;
  assert.equal(gauge.value, 71);
  assert.deepEqual(spark.points, [60, 65, 71]);
  assert.equal(gauge.source, 'Disk');
});

test('a chart reads a list of the tile, with the labels its rows name; a series with no path stays', () => {
  const [chart] = live.fill([node({
    type: 'chart', style: 'bar', title: 'Seconds', labels: ['a', 'b'], unit: 's', tile: 'Disk', item: 'secs', labelItem: 'name',
    series: [{ label: 'Secs', points: [1, 2], bind: 'value.runs' }, { label: 'Target', points: [30, 30] }],
  })], board).nodes;
  assert.deepEqual(chart.labels, ['build', 'test', 'lint']);
  assert.deepEqual(chart.series, [{ label: 'Secs', points: [41, 87, 12], bind: 'value.runs' }, { label: 'Target', points: [30, 30] }]);
  assert.equal(chart.title, 'Seconds');
  assert.equal(chart.source, 'Disk');
});

test("labels the bot wrote don't stay under the tile's points when the tile names none", () => {
  const [chart] = live.fill([node({ type: 'chart', labels: ['Mon', 'Tue', 'Wed'], series: [{ points: [1, 2, 3], bind: 'value.used' }], tile: 'Disk' })], board).nodes;
  assert.deepEqual(chart.series[0].points, [60, 65, 71]);
  assert.equal(chart.labels, undefined);
});

test("a chart of one number shows the tile's recent values", () => {
  const [chart] = live.fill([node({ type: 'chart', title: 'Used', series: [{ points: [1, 2, 3], bind: 'value.used' }], tile: 'Disk' })], board).nodes;
  assert.deepEqual(chart.series[0].points, [60, 65, 71]);
});

test("a table reads the tile's list: each column names a field of a row", () => {
  const [table] = live.fill([node({
    type: 'table', title: 'Runs', tile: 'Disk', bind: 'value.runs',
    columns: [{ label: 'Step', item: 'name' }, { label: 'Secs', item: 'secs', align: 'right' }],
    rows: [['x', '1']],
  })], board).nodes;
  assert.deepEqual(table.rows, [['build', '41'], ['test', '87'], ['lint', '12']]);
  assert.deepEqual(table.columns, [{ label: 'Step', item: 'name' }, { label: 'Secs', align: 'right', item: 'secs' }]);
});

test('what the tile says is read again by the validator: lengths hold', () => {
  const t = { tile: { id: 't_x', title: 'T'.repeat(300), reads: {} }, data: { value: 'v'.repeat(500) }, history: {}, times: {} };
  const out = live.fill([node({ type: 'kpi', label: 'K', value: '1', tile: 'x' })], { tile: () => t }).nodes[0];
  assert.equal(out.value.length, 40);
  assert.equal(out.source.length, 120);
});

test('a tile that is gone, waits for the owner, is a page, has no such path or no value leaves the written values: null, never an error', () => {
  const kpi = (tile, bind) => node({ type: 'kpi', label: 'K', value: '1', tile, bind });
  const { nodes, tiles } = live.fill([
    kpi('Nope'), kpi('waiting'), kpi('t_page'), kpi('disk', 'value.missing'), kpi('disk', 'elsewhere.x'),
    node({ type: 'gauge', label: 'G', value: 1, tile: 'disk', bind: 'value.free.x' }),
    node({ type: 'table', columns: [{ label: 'A' }], rows: [['a']], tile: 'disk', bind: 'value.used' }),
    node({ type: 'text', text: 'hi' }), node({ type: 'kpi', label: 'K', value: '1' }), null,
  ], board);
  assert.deepEqual(nodes, Array(10).fill(null));
  assert.deepEqual(tiles.sort(), ['t_disk', 't_page', 't_wait'], 'those that exist are watched: they may read next time');
});

test('one request holds a few nodes only, and what is not a list is nothing', () => {
  const one = node({ type: 'kpi', label: 'K', value: '1', tile: 'disk', bind: 'value.used' });
  assert.equal(live.fill(Array(100).fill(one), board).nodes.length, live.MAX_NODES);
  assert.deepEqual(live.fill('nope', board), { nodes: [], tiles: [] });
  assert.deepEqual(live.fill(undefined, null), { nodes: [], tiles: [] });
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('the owner asks the server: the Board\'s tile, live, and the feed says when it changes; features name it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('ui-live'));
  const bot = await makeBot(srv);
  const tile = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Queue', bot: bot.id, value: 5 } })).data;
  const ask = (body) => srv.api('/dashboard/live', { method: 'POST', body });
  const node = view.validate(JSON.stringify({ alt: 'A', root: { type: 'kpi', label: 'Queue', value: '1', tile: tile.id } })).root;
  let r = await ask({ bot: bot.id, nodes: [node] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.tiles, [tile.id]);
  assert.equal(r.data.nodes[0].value, '5');
  assert.equal(r.data.nodes[0].source, 'Queue');

  const feedOn = await feed(srv);
  await srv.asChief(`/dashboard/tiles/${tile.id}/value`, { method: 'PUT', body: { value: 7 } });
  await feedOn.wait('dashboard', (d) => d.tile?.id === tile.id);
  feedOn.close();
  r = await ask({ nodes: [{ ...node, tile: 'queue' }] });
  assert.equal(r.data.nodes[0].value, '7');

  assert.deepEqual((await ask({ nodes: [{ ...node, tile: 'Gone' }] })).data, { nodes: [null], tiles: [] });
  assert.deepEqual((await ask({})).data, { nodes: [], tiles: [] });
  assert.equal((await srv.asChief('/dashboard/live', { method: 'POST', body: { nodes: [node] } })).status, 403, 'the owner only');
});
