// Groups: one chat with two to six bots, its members (CONTEXT.md: Group; ADR 018).
//
// A group is a record of its own: { id, name, members, category, pinned, order, createdAt, updatedAt }.
//   members   bot ids, in the group's order. A bot can be in several groups.
//   category  the folder of the list it sits in, as a bot's `group` names it ('' = none).
//   pinned    its place on the Pinned page, in the one order of the pinned bots and groups (1 = first; 0 = not
//             pinned; lib/pins.js, ADR 058).
//   order     its place among the groups of its category that aren't pinned (1 = first; 0 while pinned).
//   team      a team's chat (#697): the id of its team in the project (lib/company.js). Its name, its members (the
//             lead first, then the team's order), `lead` and `color` follow the team (syncTeams), any number of
//             bots; the owner and the Chief cannot rename it, change its members or delete it here: it goes with its
//             team. A message without a mention goes to `lead` first (lib/group-chat.js).
// A group's `order` is counted among groups only: a bot's `order` stays numbered among the bots, which is what an
// app from before groups reads it as. In the list a category's groups stand after its bots. `pinned` is one order
// for both kinds (#276): an app from before it sorts each kind by it, so it still shows the pinned bots, then the
// pinned groups, each in their order.
//
// The records are one file in the data folder (groups.json), so a restart keeps them and a backup carries them.
// The key of a group's chat is "group:<id>" wherever a chat has a key (lib/read.js CHAT). The owner's messages in
// a group are kept apart from the records, one file per group (messagesFile), and go with the group; a member's
// replies are runs of that member (lib/bots.js), which stay when the group goes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonfile');
const { shortName } = require('../public/mentions.js');
const pins = require('./pins');

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 6;
const ID = /^[\w-]{1,40}$/;
const chatOf = (id) => `group:${id}`;

// What is refused is said in the owner's words, with status 400.
const refuse = (message) => Object.assign(new Error(message), { status: 400 });

// What a request sent, as fields: a body that is no object (null, a text, a list) has none.
const fields = (input) => (input && typeof input === 'object' && !Array.isArray(input) ? input : {});
const cleanName = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const cleanCategory = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 40); // as a bot's `group` is kept

// The members a group is to have, checked: bot ids, in the order given. bots: every bot there is. tooFew: the
// refusal of fewer than two, which only a group that is there already may end with deleting it.
function checkMembers(members, bots, tooFew) {
  if (!Array.isArray(members)) throw refuse('Say which bots are in the group.');
  const ids = members.map((m) => String(m ?? '').trim());
  const found = [];
  for (const id of ids) {
    const bot = bots.find((b) => b.id === id);
    if (!bot) throw refuse(id ? `There is no bot "${id.slice(0, 40)}".` : "One of these bots doesn't exist.");
    if (found.includes(bot)) throw refuse(`${bot.name} is in the group twice.`);
    found.push(bot);
  }
  if (found.length < MIN_MEMBERS) throw refuse(tooFew);
  if (found.length > MAX_MEMBERS) throw refuse('A group has at most six bots.');
  // A mention gives a member the turn (ADR 019), so no two members may answer to the same one.
  const called = new Map(); // a mention name, in lower case -> the member that has it
  for (const bot of found) {
    const name = shortName(bot.name);
    if (!name) continue; // a name of signs alone: no mention names it, so none can mistake it
    const other = called.get(name.toLowerCase());
    if (other) throw refuse(`${other.name} and ${bot.name} would both be @${name} in the group. Rename one of them first.`);
    called.set(name.toLowerCase(), bot);
  }
  return found.map((b) => b.id);
}

// The pinned groups in their order, and the groups of a category that aren't pinned in theirs.
const pinnedOf = (all) => all.filter((g) => g.pinned > 0).sort((a, b) => a.pinned - b.pinned);
const inCategory = (all, category) => all.filter((g) => !(g.pinned > 0) && g.category === category)
  .sort((a, b) => (a.order || Infinity) - (b.order || Infinity) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
const number = (list, field) => list.forEach((g, i) => { g[field] = i + 1; });

// Gives a group its place, as a bot is given one (lib/bots.js placePinned, placeInGroup). input: any of
// { category, pinned, order }. pinned: a place in the one order of the pinned bots and groups (the others make
// room), true (last, or where it already is) or 0 (not pinned). order: a place among the groups of its category;
// without one a group that moved there, or was unpinned, goes last. The groups it left close the gap.
// everyBot: every bot, for the one order. Returns the pinned bots' new places (pins.place), or null.
function place(all, group, input, everyBot = []) {
  let botPins = null;
  const was = { category: group.category, pinned: group.pinned };
  if ('category' in input) group.category = cleanCategory(input.category);
  if ('pinned' in input) {
    const want = input.pinned;
    const at = pins.place(everyBot, all, { kind: 'group', id: group.id }, want);
    pins.apply(all, at.groups);
    botPins = at.bots;
  }
  if (group.pinned > 0) group.order = 0;
  else {
    const moved = was.pinned > 0 || group.category !== was.category || !(group.order > 0);
    if (moved || 'order' in input) {
      const others = inCategory(all, group.category).filter((g) => g !== group);
      const n = 'order' in input ? Math.floor(Number(input.order)) : 0;
      others.splice(n > 0 ? Math.min(n, others.length + 1) - 1 : others.length, 0, group);
      number(others, 'order');
    }
  }
  if (was.category !== group.category || group.pinned > 0) number(inCategory(all, was.category), 'order');
  return botPins;
}

// bots: () => every bot there is. setBotPins(at): the pinned bots' new places (a Map of id -> place) after a group
// was pinned, moved or unpinned, for the bots' store to save. changed: the groups were saved. removed(id): a group
// is gone, for what is kept under its chat elsewhere (its read position).
function create(dataDir, { bots, setBotPins = () => {}, changed = () => {}, removed = () => {} }) {
  const file = path.join(dataDir, 'groups.json');
  const messagesDir = path.join(dataDir, 'group-messages');
  // The owner's messages in a group, kept by who takes them: one file per group, gone with the group.
  const messagesFile = (id) => (ID.test(id) ? path.join(messagesDir, `${id}.json`) : null);
  // The files the owner attached to messages in a group (ADR 020): kept once, in a folder of the group's own
  // (<data>/group-files/<id>/uploads/), which no bot reads. A member's run is handed its own copy. Gone with the group.
  const filesDir = (id) => (ID.test(id) ? path.join(dataDir, 'group-files', id) : null);

  // Kept in memory: only this process writes the file. Callers get their own copy.
  let kept = null;
  const load = () => {
    if (!kept) {
      const saved = readJson(file, []);
      kept = (Array.isArray(saved) ? saved : []).filter((g) => g && typeof g.id === 'string' && ID.test(g.id) && Array.isArray(g.members));
      shareThePins();
    }
    return structuredClone(kept);
  };
  const save = (all) => { writeJson(file, all); kept = structuredClone(all); changed(); };
  // Once, on the first start with one order for the pinned bots and groups (#276): the pinned groups were numbered
  // among the groups and stood after the pinned bots, so they keep that place, after the last pinned bot.
  function shareThePins() {
    const marker = path.join(dataDir, pins.PINS_FILE);
    if (fs.existsSync(marker)) return;
    const after = Math.max(0, ...bots().map((b) => b.pinned || 0));
    if (after && kept.some((g) => g.pinned > 0)) {
      for (const g of kept) if (g.pinned > 0) g.pinned += after;
      writeJson(file, kept);
    }
    writeJson(marker, { shared: 1 });
  }

  const list = () => load();
  const get = (id) => load().find((g) => g.id === id) || null;
  // The groups a bot is a member of.
  const ofBot = (botId) => load().filter((g) => g.members.includes(botId));

  // The teams' chats (#697): one group for each team of the project, kept in step with it. teams: the project's
  // teams as lib/company.js keeps them, [{ id, name, color, bots, lead }] ([] when there is no project). A team's
  // chat is made when its team is, follows its name, lead and bots, and is deleted with it, its messages too.
  // A bot that is gone is left out. Returns whether anything changed.
  function syncTeams(teams) {
    const list = Array.isArray(teams) ? teams.filter((t) => t && typeof t.id === 'string' && Array.isArray(t.bots)) : [];
    const known = new Set(bots().map((b) => b.id));
    let all = load();
    const gone = all.filter((g) => g.team && !list.some((t) => t.id === g.team)).map((g) => g.id);
    for (const id of gone) remove(id);
    if (gone.length) all = load();
    let changed = false;
    const now = new Date().toISOString();
    for (const t of list) {
      const members = [...new Set([t.lead, ...t.bots])].filter((id) => typeof id === 'string' && known.has(id));
      const want = { name: cleanName(t.name) || 'Team', members, team: t.id, lead: members.includes(t.lead) ? t.lead : members[0] || null, color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : null };
      const g = all.find((x) => x.team === t.id);
      if (!g) {
        let id;
        do id = crypto.randomUUID().slice(0, 8); while (all.some((x) => x.id === id));
        const made = { id, ...want, category: '', pinned: 0, order: 0, createdAt: now, updatedAt: now };
        all.push(made);
        place(all, made, {});
        changed = true;
        continue;
      }
      if (['name', 'lead', 'color'].some((k) => g[k] !== want[k]) || JSON.stringify(g.members) !== JSON.stringify(want.members)) {
        Object.assign(g, want, { updatedAt: now });
        changed = true;
      }
    }
    if (changed) save(all);
    return changed || gone.length > 0;
  }
  const TEAM_OWN = "This is a team's chat: it follows its team in Projects.";

  // A new group, from a name and two to six bots: last in the category of the first bot given.
  function make(input) {
    input = fields(input);
    const everyBot = bots();
    const name = cleanName(input.name);
    if (!name) throw refuse('Give the group a name.');
    const members = checkMembers(input.members, everyBot, 'A group has at least two bots.');
    const all = load();
    const now = new Date().toISOString();
    let id;
    do id = crypto.randomUUID().slice(0, 8); while (all.some((g) => g.id === id));
    const group = { id, name, members, category: cleanCategory(everyBot.find((b) => b.id === members[0]).group), pinned: 0, order: 0, createdAt: now, updatedAt: now };
    all.push(group);
    place(all, group, {});
    save(all);
    return structuredClone(group);
  }

  // A change to a group: any of { name, members, category, order, pinned }. `members` is the whole list as it is
  // to be, so it adds a member, takes one out and changes their order. Returns the group, or null when there is none.
  function update(id, input) {
    input = fields(input);
    const all = load();
    const group = all.find((g) => g.id === id);
    if (!group) return null;
    if (group.team && ('name' in input || 'members' in input)) throw refuse(TEAM_OWN);
    if ('name' in input) {
      const name = cleanName(input.name);
      if (!name) throw refuse('Give the group a name.');
      group.name = name;
    }
    if ('members' in input) group.members = checkMembers(input.members, bots(), 'A group has at least two bots. Add another, or delete the group.');
    const where = Object.fromEntries(['category', 'pinned', 'order'].filter((k) => k in input).map((k) => [k, input[k]]));
    const botPins = Object.keys(where).length ? place(all, group, where, bots()) : null;
    group.updatedAt = new Date().toISOString();
    save(all);
    if (botPins) setBotPins(botPins);
    return structuredClone(group);
  }

  // Deletes a group: its record, and the owner's messages in it. No bot and no run goes with it.
  function remove(id) {
    const all = load();
    const group = all.find((g) => g.id === id);
    if (!group) return false;
    const next = all.filter((g) => g !== group);
    const at = pins.place(bots(), next); // the pinned ones after it close the gap, bots and groups
    pins.apply(next, at.groups);
    number(inCategory(next, group.category), 'order');
    save(next);
    if (group.pinned > 0) setBotPins(at.bots);
    try { fs.rmSync(messagesFile(id), { force: true }); } catch (e) { console.error(`[groups] ${id}: ${e.message}`); }
    try { fs.rmSync(filesDir(id), { recursive: true, force: true }); } catch (e) { console.error(`[groups] ${id}: ${e.message}`); }
    removed(id);
    return true;
  }

  // The pinned groups' new places (a Map of id -> place) after a bot was pinned, moved, unpinned or deleted.
  function setPins(at) {
    const all = load();
    if (pins.apply(all, at)) save(all);
  }

  // A bot was deleted: it leaves every group it was in. A group keeps its record and its chat, also with one
  // member left, or none: only the owner deletes a group.
  function botLeft(botId) {
    const all = load();
    const left = all.filter((g) => g.members.includes(botId));
    if (!left.length) return [];
    const now = new Date().toISOString();
    for (const g of left) { g.members = g.members.filter((m) => m !== botId); g.updatedAt = now; }
    save(all);
    return left.map((g) => g.id);
  }

  // A category was renamed, or removed (to = ''): its groups move with it, in their order, last in the new one.
  function renameCategory(from, to) {
    const all = load();
    const moving = inCategory(all, String(from || '')).concat(pinnedOf(all).filter((g) => g.category === String(from || '')));
    if (!from || !moving.length) return 0;
    for (const g of moving) place(all, g, { category: to });
    save(all);
    return moving.length;
  }

  return { list, get, ofBot, create: make, update, remove, botLeft, renameCategory, setPins, syncTeams, TEAM_OWN, messagesFile, filesDir };
}

module.exports = { create, chatOf, MIN_MEMBERS, MAX_MEMBERS };
