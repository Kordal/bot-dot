// A project's board as a free canvas (#783, ADR 124): the rules of where its tiles stand. This file draws nothing
// (company-home.js does); the server keeps a layout by the same rules (lib/company.js), so the page and botdot agree.
//   - a layout is { [tile]: [x, y, w, h] } on a canvas W wide, in its units; an app scales it to its width.
//   - a tile is `days`, `goal:<id>`, `room:<team>`, `chief`, `bot:<id>`, `suggest`, `new-team`, `calendar`, `todo`,
//     `card:<id>` or `new-card`; its kind (the part before `:`) gives its smallest and its first size.
//   - no two tiles overlap: one the moved or resized tile would cover slides down below it, with GAP between them,
//     and so on for what that one covers. Nothing is pulled up.
//   - a tile with no place yet goes to the first free spot: the highest, then the leftmost.
// A plain <script>, as window.BoardCanvas; the server and the tests load it with require.

(function (root) {

const W = 1200;
const GAP = 16;
const MAX_H = 4000;
const MAX_TILES = 200;
const KINDS = {
  days: { min: [480, 96], size: [1200, 140] },
  goal: { min: [320, 160], size: [592, 260] },
  room: { min: [240, 200], size: [592, 320] },
  chief: { min: [140, 160], size: [188, 200] },
  bot: { min: [140, 160], size: [188, 200] },
  suggest: { min: [280, 140], size: [392, 180] },
  'new-team': { min: [140, 56], size: [392, 64] },
  calendar: { min: [420, 260], size: [792, 340] },
  todo: { min: [280, 280], size: [392, 560] },
  card: { min: [240, 140], size: [392, 220] },
  'new-card': { min: [200, 56], size: [392, 64] },
};
const ID = /^([a-z-]+)(?::([A-Za-z0-9_-]{1,64}))?$/;

// The kind of a tile, or null for an id that is none. A kind with an id after `:` needs it; one without has none.
function kindOf(id) {
  const m = ID.exec(String(id || ''));
  if (!m || !KINDS[m[1]]) return null;
  const named = ['goal', 'room', 'bot', 'card'].includes(m[1]);
  return named === !!m[2] ? m[1] : null;
}

// A rectangle kept on the canvas and no smaller than its kind allows: whole units, inside 0..W, at most MAX_H high.
function fit(id, r) {
  const [mw, mh] = KINDS[kindOf(id)].min;
  const w = Math.min(W, Math.max(mw, Math.round(r[2])));
  const h = Math.min(MAX_H, Math.max(mh, Math.round(r[3])));
  return [Math.min(W - w, Math.max(0, Math.round(r[0]))), Math.max(0, Math.round(r[1])), w, h];
}

// Two rectangles closer than GAP on both axes.
const hits = (a, b) => a[0] < b[0] + b[2] + GAP && b[0] < a[0] + a[2] + GAP && a[1] < b[1] + b[3] + GAP && b[1] < a[1] + a[3] + GAP;

// The layout with no overlap: `first` (the tile just moved or resized) stays where it is; every other, from the top,
// slides down below whatever it would cover. Without `first`, the highest tile stays.
function settle(layout, first) {
  const out = {};
  const placed = [];
  const put = (id, r) => { out[id] = r; placed.push(r); };
  if (first && layout[first]) put(first, [...layout[first]]);
  const rest = Object.keys(layout).filter((id) => id !== first).sort((a, b) => layout[a][1] - layout[b][1] || layout[a][0] - layout[b][0]);
  for (const id of rest) {
    const r = [...layout[id]];
    for (let under = placed.filter((p) => hits(r, p)); under.length; under = placed.filter((p) => hits(r, p))) {
      r[1] = Math.max(...under.map((p) => p[1] + p[3] + GAP));
    }
    put(id, r);
  }
  return out;
}

// The first free spot for a tile of this size: the highest, then the leftmost, that covers nothing.
function spot(layout, w, h) {
  const rs = Object.values(layout);
  const ys = [0, ...rs.map((r) => r[1] + r[3] + GAP)].sort((a, b) => a - b);
  const xs = [0, ...rs.map((r) => r[0] + r[2] + GAP)].filter((x) => x + w <= W).sort((a, b) => a - b);
  for (const y of ys) for (const x of xs) if (!rs.some((r) => hits([x, y, w, h], r))) return [x, y];
  return [0, ys[ys.length - 1]];
}

// The layout of the tiles shown: each of `ids` where the layout has it, the others at the first free spot in their
// kind's first size (`sizes` may give another, such as what it measures now). Tiles not shown are left out.
function complete(layout, ids, sizes = {}) {
  const out = {};
  for (const id of ids) if (layout?.[id]) out[id] = fit(id, layout[id]);
  const set = settle(out);
  for (const id of ids) {
    if (set[id]) continue;
    const [w, h] = fit(id, [0, 0, ...(sizes[id] || KINDS[kindOf(id)].size)]).slice(2);
    set[id] = [...spot(set, w, h), w, h];
  }
  return set;
}

// A layout from where the tiles stand now ({ [tile]: [x, y, w, h] } in pixels, `width` the canvas's): scaled to W.
function measured(rects, width) {
  const k = W / (width || W);
  const out = {};
  for (const [id, r] of Object.entries(rects)) if (kindOf(id)) out[id] = fit(id, r.map((v) => v * k));
  return settle(out);
}

// The tile moved by (dx, dy) or, from an edge, resized: `edge` any of 'e', 's', 'w', 'n' together ('se' the corner).
function drag(layout, id, edge, dx, dy) {
  const [x, y, w, h] = layout[id];
  let r;
  if (!edge) r = [x + dx, y + dy, w, h];
  else {
    r = [x, y, w, h];
    if (edge.includes('e')) r[2] = w + dx;
    if (edge.includes('s')) r[3] = h + dy;
    if (edge.includes('w')) { r[2] = w - dx; r[0] = x + w - fit(id, r)[2]; }
    if (edge.includes('n')) { r[3] = h - dy; r[1] = y + h - fit(id, r)[3]; }
  }
  return settle({ ...layout, [id]: fit(id, r) }, id);
}

// The bottom of the lowest tile: how high the canvas is.
const height = (layout) => Math.max(0, ...Object.values(layout).map((r) => r[1] + r[3]));

// A layout as sent to botdot: { tile: [x, y, w, h] } with known ids and numbers, at most MAX_TILES; null for none.
// Throws a message for anything else.
function check(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('layout is { tile: [x, y, w, h] }.');
  const ids = Object.keys(v);
  if (ids.length > MAX_TILES) throw new Error(`A layout has at most ${MAX_TILES} tiles.`);
  const out = {};
  for (const id of ids) {
    if (!kindOf(id)) throw new Error(`${id} is no tile.`);
    const r = v[id];
    if (!Array.isArray(r) || r.length !== 4 || r.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new Error(`${id} is [x, y, w, h].`);
    out[id] = fit(id, r);
  }
  return out;
}

const api = { W, GAP, KINDS, kindOf, fit, hits, settle, spot, complete, measured, drag, height, check };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.BoardCanvas = api;

})(typeof window === 'undefined' ? globalThis : window);
