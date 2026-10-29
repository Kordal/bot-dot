// The row of chats docked to the bottom of the Projects screen (#691): its rules. This file draws nothing (dock.js
// does):
//   - what this device keeps: the panels in their order, oldest left, newest right, and how high a phone's sheet is.
//   - a panel is { kind, id }: a bot's chat, or a team's; `open: true` when it stays expanded, not a bar (#714).
//   - how many panels the width holds; the older ones go under "+N" at the left end; the open one is always shown.
//   - a panel dragged sideways lands where its middle is.
// A plain <script>, as window.DockRow; the tests load it with require.

(function (root) {

const KINDS = /^[a-z][a-z-]{0,19}$/;
const MAX = 20; // panels kept: an older one than that is dropped
const ITEM = 340; // a panel's width, open or as a bar
const MIN = 300; // what a panel may narrow to, so one more fits (the style lets them shrink)
const GAP = 12; // the style's .dock gap (--sp-12)
const MORE = 44; // "+N"

const keyOf = (p) => `${p.kind}:${p.id}`;
const same = (a, b) => a.kind === b.kind && a.id === b.id;

// What this device kept, or an empty row: only what is well formed, each panel once.
function parse(raw) {
  let d;
  try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { d = null; }
  const items = [];
  for (const p of Array.isArray(d?.items) ? d.items : []) {
    if (!p || typeof p.kind !== 'string' || !KINDS.test(p.kind) || typeof p.id !== 'string' || !p.id || p.id.length > 100) continue;
    if (!items.some((x) => same(x, p))) items.push({ kind: p.kind, id: p.id, ...(p.open === true ? { open: true } : {}) });
  }
  return { items: items.slice(-MAX), sheet: d?.sheet === 'full' ? 'full' : 'half' };
}

// A panel opened: newest, at the right end. One that is in the row already stays where it is.
function add(items, p) {
  if (items.some((x) => same(x, p))) return items;
  return [...items, { kind: p.kind, id: p.id }].slice(-MAX);
}
const remove = (items, p) => items.filter((x) => !same(x, p));
// The panel expanded (on) or a bar again; the others as they are.
const expand = (items, p, on) => items.map((x) => (!same(x, p) || !!x.open === !!on ? x : on ? { ...x, open: true } : { kind: x.kind, id: x.id }));
// The panel at `from` put at `to`, the others keeping their order.
function move(items, from, to) {
  if (from === to || from < 0 || from >= items.length) return items;
  const out = items.slice();
  const [p] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, p);
  return out;
}

// How many panels a row this wide shows, each at least MIN wide: at least one, and room for "+N" when some don't fit.
function fit(count, width) {
  const all = Math.max(1, Math.floor((width + GAP) / (MIN + GAP)));
  if (count <= all) return count;
  return Math.max(1, Math.floor((width - MORE) / (MIN + GAP)));
}

// The row as drawn: the newest `n` shown, the rest under "+N" (newest first, as the menu lists them). The open panel
// is never hidden: when it would be, it moves to the right end, and `items` says the row's new order.
function split(items, n, open) {
  let list = items;
  const at = open ? list.findIndex((x) => same(x, open)) : -1;
  if (at !== -1 && at < list.length - n) list = move(list, at, list.length - 1);
  const cut = Math.max(0, list.length - n);
  return { items: list, shown: list.slice(cut), hidden: list.slice(0, cut).reverse() };
}

// Where a dragged panel lands among the shown ones: before the first whose middle is right of its own middle.
// middles: the shown panels' middles, left to right, the dragged one's among them at index `from`.
function dropAt(middles, from, x) {
  const others = middles.filter((_, i) => i !== from);
  return others.filter((m) => m < x).length;
}

// A phone's sheet after its grip was dragged by dy (up is negative): higher, lower, or closed from half.
function sheetAfter(sheet, dy) {
  if (dy < -40) return 'full';
  if (dy > 40) return sheet === 'full' ? 'half' : 'closed';
  return sheet;
}

const api = { parse, add, remove, expand, move, fit, split, dropAt, sheetAfter, keyOf, same, ITEM, MIN, GAP, MORE };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.DockRow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
