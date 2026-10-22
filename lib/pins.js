// One order for everything pinned (#276, ADR 057): a bot's `pinned` and a group's count in one sequence, 1 = first
// on the Pinned page right below the Chief. The bots are kept in bots.json and the groups in groups.json; these
// rules number both, and each store saves its own.

const PINS_FILE = 'pins.json'; // in the data folder: { shared: 1 } once the groups' places were moved into the one order

// Two with the same place (one file written before the other one, or kept from before one order): the bot first,
// as the Pinned page stood then.
const byPin = (a, b) => a.pinned - b.pinned || (a.kind === b.kind ? 0 : a.kind === 'bot' ? -1 : 1);
const entries = (kind, list) => list.filter((x) => x.pinned > 0).map((x) => ({ kind, id: x.id, pinned: x.pinned }));

// Puts `item` ({ kind: 'bot' | 'group', id }) at a place in the one order and numbers everything pinned 1, 2, 3…
// again. want: a place (1 = first; past the end = last), true (last, or where it already is), false or 0 (unpin).
// Without an item it only closes the gaps. bots, groups: every bot and every group, with their `pinned` now.
// Returns { bots, groups }: Maps of id -> place, for every one pinned before or after (0: no longer pinned).
function place(bots, groups, item = null, want = 0) {
  const all = [...entries('bot', bots), ...entries('group', groups)].sort(byPin);
  const me = item && all.find((x) => x.kind === item.kind && x.id === item.id);
  const others = all.filter((x) => x !== me);
  if (item) {
    const n = want === true ? (me ? all.indexOf(me) + 1 : Infinity) : Math.floor(Number(want)) || 0;
    if (n > 0) others.splice(Math.min(n, others.length + 1) - 1, 0, me || { ...item });
  }
  const at = { bots: new Map(), groups: new Map() };
  const of = (kind) => (kind === 'bot' ? at.bots : at.groups);
  if (me) of(me.kind).set(me.id, 0);
  else if (item) of(item.kind).set(item.id, 0);
  others.forEach((x, i) => of(x.kind).set(x.id, i + 1));
  return at;
}

// Gives each of `list` its place from `at` (place's bots or groups). Returns whether any place changed.
function apply(list, at) {
  let changed = false;
  for (const x of list) {
    if (!at.has(x.id) || x.pinned === at.get(x.id)) continue;
    x.pinned = at.get(x.id);
    changed = true;
  }
  return changed;
}

module.exports = { place, apply, PINS_FILE };
