// The keypad (ADR 029, #495): in a wide window the list gives way to every page of keys at once, one under the other
// (#508), one key per bot or group, and one chat on the right. This file holds its three rules and draws nothing:
//   - the pages: from the list's own order (pinned, categories A to Z, Other), so list and keypad never disagree.
//     The list draws its rows from these pages too.
//   - the digits (#366): a bot's own hotkey, else the free digits counted across the shown keys.
//   - a key press: what 1–9, Esc and Ctrl+K do.
//   - a move (#499): where a dragged key lands, as the place the list's drag gives a row.
// A plain <script>, as window.Keypad; the tests load it with require.

(function (root) {

// The page's words (i18n.js, #645); English where they are not loaded (the tests require this file).
const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
const tr = typeof I18n === 'object' ? I18n.tr : fill;
const trn = typeof I18n === 'object' ? I18n.trn : (n, one, other, vars) => fill(n === 1 ? one : other, { n, ...vars });

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
    { name: tr('Pinned'), kind: 'pinned', keys: [...placed.filter(isPinned), ...groups.filter(isPinned)].sort(byPin) },
    ...categoryNames(loose, looseGroups).map((name) => ({ name, kind: 'category', keys: inside(name) })),
    { name: tr('Other'), kind: 'other', keys: inside('') },
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

// A key's status (#397): { kind, text }, the first that holds of
//   working  a run is going ("Working"; "Working ×2" while `runs`, the runs going, is 2 or more: ADR 062)
//   needs    it asks the owner something, or a card of its waits in Needs you ("Needs you")
//   unread   new replies the owner has not read ("2 unread")
//   done     its last run finished, and the owner has not opened its chat since ("Done")
//   failed   its last run did not, as the list says it ("Couldn't finish")
//   idle     anything else ("Idle"): no run yet, the owner stopped the last one, or has seen it finish.
// last: the status of its newest run ("success", "error", "stopped"…), null for none. seen: the owner read its chat
// after that run ended (seen(), from the chat's `readAt`).
// A key shows it as one line under its name (#664): a dot in the state's colour and its text; while it works, what it
// does now in place of "Working". The Android app draws the same line.
function status({ running = false, runs = 0, needs = false, unread = 0, last = null, seen = false } = {}) {
  if (running) return { kind: 'working', text: runs > 1 ? tr('Working ×{n}', { n: runs }) : tr('Working') };
  if (needs) return { kind: 'needs', text: tr('Needs you') };
  if (unread > 0) return { kind: 'unread', text: trn(unread, '{n} unread', '{n} unread') };
  if (last === 'success') return seen ? { kind: 'idle', text: tr('Idle') } : { kind: 'done', text: tr('Done') };
  if (last && last !== 'stopped' && last !== 'running') return { kind: 'failed', text: tr("Couldn't finish") };
  return { kind: 'idle', text: tr('Idle') };
}
// Whether the owner read a chat after its last run ended: `readAt` is the chat's read position (docs/api.md, New
// replies), `endedAt` when that run ended, both ISO times. A server without `readAt`: never, and Done stays.
const seen = (readAt, endedAt) => typeof readAt === 'string' && typeof endedAt === 'string' && !!endedAt && readAt >= endedAt;

// Each bot in one space (#838, ADR 132): Home's keys leave out every bot in a project's team and every team's chat
// (a group with `team`), which are that project's. A bot that leaves its team is Home's again, in its own category.
// projects: the projects as the apps load them, each with `teams` of { id, bots }.
// all: Home's filter is on All, the owner's choice on this device: every bot and chat stays.
function home(bots, groups, projects, all = false) {
  if (all) return { bots, groups };
  const teams = (projects || []).flatMap((p) => p.teams || []);
  const inTeam = new Set(teams.flatMap((t) => t.bots || []));
  const teamIds = new Set(teams.map((t) => t.id));
  return { bots: bots.filter((b) => !inTeam.has(b.id)), groups: groups.filter((g) => !(g.team && teamIds.has(g.team))) };
}
// Map(bot id → its project): the project whose team a bot is in (a bot is in at most one team, ADR 110).
function projectOf(projects) {
  const map = new Map();
  for (const p of projects || []) for (const t of p.teams || []) for (const id of t.bots || []) if (!map.has(id)) map.set(id, p);
  return map;
}
// What a space's Needs you lists: on Home (project null) every ask; in a project only those of its own bots. An ask
// names its bot (`bot.id`); a batch holds several, and is the project's when one of them is.
function asksOf(items, project, projects) {
  if (!project) return items;
  const of = projectOf(projects);
  const mine = (x) => of.get(x.bot?.id)?.id === project.id;
  return items.filter((x) => (x.kind === 'batch' ? (x.items || []).some(mine) : mine(x)));
}

const api = { byPlace, byPin, categoryNames, pages, digits, digitOf, press, move, pin, status, seen, home, projectOf, asksOf };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Keypad = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
