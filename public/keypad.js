// The keypad (ADR 029, #495): in a wide window the list gives way to every page of keys at once, one under the other
// (#508), one key per bot or group, and one chat on the right. This file holds its three rules and draws nothing:
//   - the pages: from the list's own order (pinned, categories A to Z, Other), so list and keypad never disagree.
//     The list draws its rows from these pages too.
//   - the digits (#366): a bot's own hotkey, else the free digits counted across the shown keys.
//   - a key press: what 1–9, Esc and Ctrl+K do.
//   - a move (#499): where a dragged key lands, as the place the list's drag gives a row.
// A plain <script>, as window.Keypad; the tests load it with require.

(function (root) {

const AZ = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
// The order the owner gave: by `order` in a category, A to Z where it is 0 (before the first move, like the server).
const byPlace = (a, b) => (a.order || Infinity) - (b.order || Infinity) || AZ(a.name, b.name);
// The pinned bots and groups share one order (#276, ADR 058); two with the same place (kept from before it): the bot first.
const byPin = (a, b) => a.pinned - b.pinned || !!a.members - !!b.members;
const isPinned = (x) => x.pinned > 0;
// The categories, A to Z: those of the bots and those of the groups. A category can hold groups and no bot.
const categoryNames = (bots, groups) => [...new Set([...bots.map((b) => b.group), ...groups.map((g) => g.category)].filter(Boolean))].sort(AZ);

// [{ name, kind: 'pinned' | 'category' | 'other', keys }]. A key is the bot or the group itself; a group has `members`.
// The pinned bots and groups in their one order; each category's bots by place, then its groups; Other last. No empty page.
function pages(bots, groups) {
  const placed = [...bots].sort(byPlace);
  const loose = placed.filter((b) => !isPinned(b)), looseGroups = groups.filter((g) => !isPinned(g));
  const inside = (cat) => [...loose.filter((b) => (b.group || '') === cat), ...looseGroups.filter((g) => (g.category || '') === cat).sort(byPlace)];
  const all = [
    { name: 'Pinned', kind: 'pinned', keys: [...placed.filter(isPinned), ...groups.filter(isPinned)].sort(byPin) },
    ...categoryNames(loose, looseGroups).map((name) => ({ name, kind: 'category', keys: inside(name) })),
    { name: 'Other', kind: 'other', keys: inside('') },
  ];
  return all.filter((p) => p.keys.length);
}

// Which key each digit opens (#366): Map(digit → bot or group). A bot with its own `hotkey` (1–9) has it wherever it
// stands on `pages`, also on a folded page; the digits no bot holds go, in reading order, to the `shown` keys that
// have none (bots without one, and groups), until they run out. A server without hotkeys: the first nine shown keys.
function digits(pages, shown) {
  const map = new Map();
  for (const p of pages) for (const x of p.keys) if (!x.members && x.hotkey >= 1 && x.hotkey <= 9 && !map.has(x.hotkey)) map.set(x.hotkey, x);
  const held = new Set(map.values());
  const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !map.has(d));
  for (const x of shown) { if (!free.length) break; if (!held.has(x)) map.set(free.shift(), x); }
  return map;
}
// The digit on a key: its own, or the free one it was given; 0: none.
const digitOf = (map, x) => { for (const [d, k] of map) if (k === x) return d; return 0; };

// What a key press does: { key, ctrl, alt, meta, shift, inField } on { digits } (the digits that open a key, as
// digits() gives them) → { action: 'open', digit }, { action: 'chief' }, { action: 'search' }, or null: the press is
// the browser's, or the field's. Esc and Ctrl+K work from a text field too; a digit never leaves one. Tab is the
// browser's: every page is shown, so there is none to move to (#508).
function press(e, { digits: used }) {
  const plain = !e.ctrl && !e.alt && !e.meta;
  if (e.key === 'Escape') return { action: 'chief' };
  if (e.ctrl && !e.alt && !e.meta && /^k$/i.test(e.key)) return { action: 'search' };
  if (!plain || e.inField) return null;
  if (/^[1-9]$/.test(e.key)) { const d = Number(e.key); return used.has(d) ? { action: 'open', digit: d } : null; }
  return null;
}

// Where a dragged key lands (#499): `key` (a bot or a group of `pages`) dropped on the page at index `to`, on its key
// at `at` (the key takes that one's place), or on its heading (no `at`: last there) → the place the list's drag gives it,
// as the server counts it (docs/api.md, Groups): { pinned: n } on Pinned, counted among the pinned bots and groups
// together (one order, #276), or { group, order: n } in a category (`group` "" is Other; the API's name of a bot's
// category), counted among its own kind: there the bots stand before the groups, so a bot dropped on a group is the
// last bot and a group dropped on a bot the first group. null: it stays where it is, or there is no such key or page.
const sameKey = (a, b) => !!a.members === !!b.members && a.id === b.id;
function move(pages, key, to, at) {
  const target = pages[to];
  const from = pages.findIndex((p) => p.keys.some((k) => sameKey(k, key)));
  if (!target || from < 0) return null;
  const kin = target.kind === 'pinned' ? () => true : (k) => !!k.members === !!key.members;
  const rest = target.keys.filter((k) => !sameKey(k, key));
  const before = at == null ? rest : rest.slice(0, at);
  const place = before.filter(kin).length + 1;
  if (from === to && place === target.keys.filter(kin).findIndex((k) => sameKey(k, key)) + 1) return null;
  return target.kind === 'pinned' ? { pinned: place } : { group: target.kind === 'other' ? '' : target.name, order: place };
}

// Puts `item` (one of `bots` or `groups`) at place `at` of the one order on Pinned (1 = first; 0 = not pinned) and
// numbers everything pinned 1, 2, 3… again, as the server does (lib/pins.js): what a move shows before it is saved.
function pin(bots, groups, item, at) {
  const others = [...bots, ...groups].filter((x) => isPinned(x) && x !== item).sort(byPin);
  if (at > 0) others.splice(Math.min(at, others.length + 1) - 1, 0, item);
  item.pinned = 0;
  others.forEach((x, i) => { x.pinned = i + 1; });
}

const api = { byPlace, byPin, categoryNames, pages, digits, digitOf, press, move, pin };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Keypad = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
