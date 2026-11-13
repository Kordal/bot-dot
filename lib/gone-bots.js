// The bots the owner deleted, by name, for a while: the Chief and every bot are told they are gone on each turn.
// Deleting a bot takes its settings, memory, jobs, teams, groups and projects with it, but not what others still
// say of it: the Chief's resumed chat, the shared memory, earlier chats and runs a lookup brings back, a group's
// messages. Without this line, those read as if it still worked for the owner, and it was proposed, named and
// messaged. A name a bot has again is not gone. The list is in DATA_DIR/gone-bots.json.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');
const { inert, oneLine } = require('./prompt-text');

const KEEP_DAYS = 90; // the notes and chats that name it are from before; long after, few still do
const MAX = 20;
const DAY = 24 * 60 * 60 * 1000;

const words = (text) => String(text || '').toLowerCase();
// Whether a text names `name` as a word of its own: "Anna" in "ask Anna", not in "Annabel".
function names(text, name) {
  const n = words(name).trim();
  if (!n) return false;
  const t = words(text);
  for (let at = t.indexOf(n); at !== -1; at = t.indexOf(n, at + 1)) {
    const before = t[at - 1];
    const after = t[at + n.length];
    if (!(before && /[\p{L}\p{N}_]/u.test(before)) && !(after && /[\p{L}\p{N}_]/u.test(after))) return true;
  }
  return false;
}

function create(dataDir, { now = () => Date.now() } = {}) {
  const file = path.join(dataDir, 'gone-bots.json');
  const fresh = (list) => list.filter((g) => g && g.id && g.name && now() - Date.parse(g.at) < KEEP_DAYS * DAY);
  // What is older than KEEP_DAYS leaves the file as it is read, not only at the next deletion.
  const load = () => {
    const x = readJson(file, []);
    const all = Array.isArray(x) ? x : [];
    const kept = fresh(all);
    if (kept.length !== all.length) try { writeJson(file, kept); } catch (e) { console.error(`[gone-bots] ${e.message}`); } // a run still starts
    return kept;
  };

  // A bot was deleted: { id, name, emoji }.
  function add(bot) {
    if (!bot?.id || !String(bot.name || '').trim()) return;
    const list = load().filter((g) => g.id !== bot.id);
    list.push({ id: bot.id, name: String(bot.name), emoji: String(bot.emoji || ''), at: new Date(now()).toISOString() });
    writeJson(file, list.slice(-MAX));
  }

  // The deleted bots whose name no bot has now, newest last. existing: the bots there are now.
  const list = (existing = []) => {
    const taken = new Set(existing.map((b) => words(b.name).trim()));
    const ids = new Set(existing.map((b) => b.id));
    return load().filter((g) => !ids.has(g.id) && !taken.has(words(g.name).trim()));
  };

  // What a run is told, or ''. existing: the bots there are now. chief: the Chief is also told which bots' instructions
  // and jobs still name one, so that it offers the owner to change them.
  function note(existing = [], { chief = false } = {}) {
    const gone = list(existing);
    if (!gone.length) return '';
    const label = (g) => `${inert(oneLine(g.name, 80))} (id ${g.id}, deleted ${g.at.slice(0, 10)})`;
    const lines = [
      `Bots the owner deleted: ${gone.map(label).join(', ')}. They are gone for good: never propose, name as available, message or hand work to them, and don't make one again unless the owner asks. Notes, earlier messages and earlier runs that name them are from before they were deleted.`,
    ];
    if (chief) {
      const still = [];
      for (const b of existing) {
        const where = [];
        if (gone.some((g) => names(b.prompt, g.name) || names(b.systemPrompt, g.name))) where.push('instructions');
        for (const j of b.jobs || []) if (gone.some((g) => names(j.prompt, g.name))) where.push(`job "${inert(oneLine(j.name, 60))}"`);
        if (where.length) still.push(`${inert(oneLine(b.name, 80))} (id ${b.id}): ${where.join(', ')}`);
      }
      if (still.length) lines.push(`Still named there, so the owner may want them changed (offer it once, when it fits): ${still.slice(0, 10).join('; ')}.`);
    }
    return lines.join('\n');
  }

  return { add, list, note, FILE: file };
}

module.exports = { create, names, KEEP_DAYS, MAX };
