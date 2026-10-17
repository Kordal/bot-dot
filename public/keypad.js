// The keypad (ADR 029, #495): in a wide window the list gives way to every page of keys at once, one under the other
// (#508), one key per bot or group, and one chat on the right. This file holds its three rules and draws nothing:
//   - the pages: from the list's own order (pinned, categories A to Z, Other), so list and keypad never disagree.
//     The list draws its rows from these pages too.
//   - a key press: what 1–9, Esc and Ctrl+K do, the digits counted across the pages.
//   - a move (#499): where a dragged key lands, as the place the list's drag gives a row.
// A plain <script>, as window.Keypad; the tests load it with require.

(function (root) {

const AZ = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
// The order the owner gave: by `order` in a category, A to Z where it is 0 (before the first move, like the server).
const byPlace = (a, b) => (a.order || Infinity) - (b.order || Infinity) || AZ(a.name, b.name);
const byPin = (a, b) => a.pinned - b.pinned;
const isPinned = (x) => x.pinned > 0;
// The categories, A to Z: those of the bots and those of the groups. A category can hold groups and no bot.
const categoryNames = (bots, groups) => [...new Set([...bots.map((b) => b.group), ...groups.map((g) => g.category)].filter(Boolean))].sort(AZ);

// [{ name, kind: 'pinned' | 'category' | 'other', keys }]. A key is the bot or the group itself; a group has `members`.
// Pinned bots then pinned groups; each category's bots by place, then its groups; Other last. No empty page.
function pages(bots, groups) {
  const placed = [...bots].sort(byPlace);
  const loose = placed.filter((b) => !isPinned(b)), looseGroups = groups.filter((g) => !isPinned(g));
  const inside = (cat) => [...loose.filter((b) => (b.group || '') === cat), ...looseGroups.filter((g) => (g.category || '') === cat).sort(byPlace)];
  const all = [
    { name: 'Pinned', kind: 'pinned', keys: [...placed.filter(isPinned).sort(byPin), ...groups.filter(isPinned).sort(byPin)] },
    ...categoryNames(loose, looseGroups).map((name) => ({ name, kind: 'category', keys: inside(name) })),
    { name: 'Other', kind: 'other', keys: inside('') },
  ];
  return all.filter((p) => p.keys.length);
}

// What a key press does: { key, ctrl, alt, meta, shift, inField } on { keys } (how many keys the keypad shows, on
// all its pages) → { action: 'open', key } (its index, counted across the pages), { action: 'chief' },
// { action: 'search' }, or null: the press is the browser's, or the field's. Esc and Ctrl+K work from a text field
// too; a digit never leaves one. Tab is the browser's: every page is shown, so there is none to move to (#508).
function press(e, { keys }) {
  const plain = !e.ctrl && !e.alt && !e.meta;
  if (e.key === 'Escape') return { action: 'chief' };
  if (e.ctrl && !e.alt && !e.meta && /^k$/i.test(e.key)) return { action: 'search' };
  if (!plain || e.inField) return null;
  if (/^[1-9]$/.test(e.key)) { const n = Number(e.key) - 1; return n < keys ? { action: 'open', key: n } : null; }
  return null;
}

// Where a dragged key lands (#499): `key` (a bot or a group of `pages`) dropped on the page at index `to`, on its key
// at `at` (the key takes that one's place), or on its heading (no `at`: last there) → the place the list's drag gives it,
// counted among its own kind as the server counts it (docs/api.md, Groups): { pinned: n } on Pinned, or
// { group, order: n } in a category (`group` "" is Other; the API's name of a bot's category). On a page the bots
// stand before the groups, so a bot dropped on a group is the last bot and a group dropped on a bot the first group.
// null: it stays where it is, or there is no such key or page.
const sameKey = (a, b) => !!a.members === !!b.members && a.id === b.id;
function move(pages, key, to, at) {
  const target = pages[to];
  const from = pages.findIndex((p) => p.keys.some((k) => sameKey(k, key)));
  if (!target || from < 0) return null;
  const kin = (k) => !!k.members === !!key.members;
  const rest = target.keys.filter((k) => !sameKey(k, key));
  const before = at == null ? rest : rest.slice(0, at);
  const place = before.filter(kin).length + 1;
  if (from === to && place === target.keys.filter(kin).findIndex((k) => sameKey(k, key)) + 1) return null;
  return target.kind === 'pinned' ? { pinned: place } : { group: target.kind === 'other' ? '' : target.name, order: place };
}

const api = { byPlace, byPin, categoryNames, pages, press, move };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Keypad = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
