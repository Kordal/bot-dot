// Live numbers in an answer view (#1630, ADR 264 amendment, ADR 071): a data component of a ```ui fence (kpi, gauge, sparkline,
// chart, table) may carry `tile`, the id or the title of a tile of the Board, and `bind`, the path in that tile's data
// it reads. The tile is the source: its logins, its scripts and the owner's OK on a script, its refresh, the live feed's
// `dashboard`; a view adds no source of its own. The component keeps the values the bot wrote, which are what Copy, a
// notification, a room and any reader outside botdot show. The app asks here for the tile's own values, as a page's
// block gets them (lib/page-blocks.js: the same checks of a bound block, the same filling in, from lib/tile-blocks.js), and
// draws them over the written ones.
//
// fill() takes the nodes of a view as an app read them (the validator's own, with their written values) and gives each
// back, filled in and read again by the same validator (public/answer-view.js), so that every length and limit holds
// whatever the tile said; or null for a node it cannot fill: its tile is gone, waits for the owner's OK, has not read
// yet or doesn't have that path. The app then keeps the written values and says nothing (no error card).
const AnswerView = require('../public/answer-view');
const catalog = require('./ui-catalog.json');
const pb = require('./page-blocks');
const tb = require('./tile-blocks');
const { pickValue } = require('./pick');

const view = AnswerView.of(catalog);
const BOUND = ['kpi', 'gauge', 'sparkline', 'chart', 'table'];
const MAX_NODES = 40; // one request: the views of a screen have a few each
const POINTS = 60; // what a sparkline or a chart of one number keeps, as the catalog allows

const num = (v) => (v === '' || v == null || typeof v === 'boolean' ? NaN : Number(v));

// The bound block of a node, checked as a block of the tile is, with the tile's reads (lib/page-blocks.js bound()).
function boundOf(spec, type, board) {
  const b = pb.bound(spec, type, 'The component', board);
  return { b, got: board.tile(b.tile), block: pb.resolve(b, board) };
}

// What the tile says over a node's props: { props, got } or null.
function over(n, board) {
  const bind = typeof n.bind === 'string' && n.bind ? n.bind : 'value';
  switch (n.type) {
    case 'kpi': {
      const { block, got } = boundOf({ tile: n.tile, bind, good: n.good, points: POINTS }, 'kpi', board);
      if (!block?.text) return null;
      return { got, props: { value: block.text, ...(block.points?.length >= 2 ? { points: block.points } : {}) } };
    }
    case 'gauge': {
      const { b, got } = boundOf({ tile: n.tile, bind, min: n.min ?? 0, max: n.max ?? 100 }, 'gauge', board);
      const v = num(pickValue(got.data, b.bind));
      return Number.isFinite(v) ? { got, props: { value: v } } : null;
    }
    case 'sparkline': {
      const { block, got } = boundOf({ tile: n.tile, style: 'line', bind, points: POINTS }, 'chart', board);
      return block?.points?.length >= 2 ? { got, props: { points: block.points } } : null;
    }
    case 'chart': {
      const series = (n.series || []).map((s) => (s.bind ? { bind: s.bind, ...(s.label ? { label: s.label } : {}) } : null));
      if (!series.some(Boolean)) return null;
      // A bar, a line or an area is read the same way: each bound series is a list of the tile's data (numbers, or objects with `item`), else its recent values.
      const spec = { tile: n.tile, style: 'line', series: series.filter(Boolean), points: POINTS, ...(n.item ? { item: n.item } : {}), ...(n.labelItem ? { labelItem: n.labelItem } : {}) };
      const { block, got } = boundOf(spec, 'chart', board);
      const read = block?.series || [{ points: block?.points || [] }];
      let at = 0;
      const next = series.map((s, i) => {
        if (!s) return n.series[i];
        const points = read[at++]?.points || [];
        return points.length ? { ...n.series[i], points } : n.series[i];
      });
      if (next.every((s, i) => s === n.series[i])) return null;
      return { got, props: { series: next, ...(block.labels?.length ? { labels: block.labels } : {}) } };
    }
    case 'table': {
      const cols = n.columns || [];
      if (!cols.length) return null;
      const spec = { tile: n.tile, bind, columns: cols.map((c) => ({ label: c.label, ...(c.item ? { item: c.item } : {}) })) };
      const { block, got } = boundOf(spec, 'table', board);
      if (!block?.rows?.length) return null;
      return { got, props: { rows: block.rows.map((r) => r.map((c) => c.text)) } };
    }
    default:
      return null;
  }
}

// One node, filled in: the node as an app has it, with the tile's values and its name as its source; or null.
function fillNode(n, board) {
  if (!n || typeof n !== 'object' || !BOUND.includes(n.type) || typeof n.tile !== 'string' || !n.tile.trim()) return null;
  const got = board?.tile(n.tile);
  if (!got || got.tile.approved === false || got.tile.kind === 'page') return null; // gone, or its script waits for the owner's OK
  let r;
  try { r = over(n, board); } catch { return null; } // a path the tile doesn't read, a column it can't: the written values stay
  if (!r) return null;
  const { noSource: _, ...written } = n;
  const raw = { ...written, ...r.props, source: r.got.tile.title };
  // The same validator as the fence's, so that every length and limit holds whatever the tile said.
  const read = view.validate(JSON.stringify({ alt: 'x', root: raw }));
  return read.ok && read.root.type === n.type ? read.root : null;
}

// nodes: what an app read of a view (the nodes that carry a tile). Gives { nodes: [node | null], tiles: [ids] }: tiles, the
// ids of the tiles that were read, so that an app asks again when one of them changes on the live feed.
function fill(nodes, board) {
  const list = (Array.isArray(nodes) ? nodes : []).slice(0, MAX_NODES);
  const tiles = new Set();
  const out = list.map((n) => {
    const filled = fillNode(n, board);
    const id = typeof n?.tile === 'string' ? board?.tile(n.tile)?.tile.id : null;
    if (id) tiles.add(id); // also one that could not be filled yet: it may read next time
    return filled;
  });
  return { nodes: out, tiles: [...tiles] };
}

module.exports = { fill, fillNode, BOUND, MAX_NODES };
