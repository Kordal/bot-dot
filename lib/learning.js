// What bots learn: their memory notes (kept in data/memory.db, see memory.js) and a history of changes
// to their main assignment, rules and skills (by the owner, the Chief or the bot itself), each of which can
// be undone. The history is stored in data/learning/<botId>.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const memoryLib = require('./memory');
const { noteLine, dayWords } = require('./prompt-text');
const { CHIEF_NOTES } = require('./chief-tools');

const MAX_HISTORY = 100;
const SHARED = memoryLib.SHARED;

// ---------- what is said about a memory change (docs/api.md, Memory, "The contract"; ADR 015) ----------
// One wording, the server's: the chip under a reply, the card of a change that waits, and the sentence a bot's
// memory tool answers with. No app and no model adds a word of its own.

const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
// Who said a note, as the owner reads it on a chip. What the owner said needs no word: the chip stands under their own message.
const CHIP_SOURCE = { owner: '', bot: ', its own conclusion', outside: ', after outside content' };
// The notes that left the pinned set, on a chip: "its own “The CI run takes 12 minutes.”".
const left = (list) => list.map((n) => (n.source === 'outside' ? `“${clip(n.text, 60)}” (after outside content)` : `its own “${clip(n.text, 60)}”`)).join(' and ');

// The whole line an app prints under a reply for a note that was saved, changed, pinned, removed or brought back.
// what: 'add', 'edit', 'pin', 'remove' or 'restore'. unpinned: the notes that left the pinned set for it (the note
// itself among them when a longer text no longer fits). wanted: it was to be pinned. A passing state names its end.
function chipOf(what, note, { unpinned = [], wanted = true } = {}) {
  const others = unpinned.filter((n) => n.id !== note.id);
  const all = note.owner === SHARED ? ' for all bots' : '';
  const tail = others.length ? ` · unpinned ${left(others)}` : '';
  const until = note.until ? ` until ${dayWords(note.until)}` : '';
  if (what === 'remove') return `Removed${all}: ${clip(note.text, 140)}`;
  if (what === 'restore') return `Restored${all}${until}: ${clip(note.text, 140)}${tail}`;
  if (what === 'pin') return `Pinned: ${clip(note.text, 140)}${tail}`;
  const notPinned = what === 'add' ? wanted && !note.pinned : unpinned.some((n) => n.id === note.id);
  return `${what === 'edit' ? 'Updated' : 'Remembered'}${all}${until}${CHIP_SOURCE[note.source] || ''}${notPinned ? ', not pinned' : ''}: ${clip(note.text, 140)}${tail}`;
}
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const erasedWords = (n) => `${count(n, 'note')} ${n === 1 ? 'was' : 'were'} erased`;
// The chip of a forget: a number, never a text (ADR 016).
const forgotChip = (notes, runs) => (notes ? `Forgot ${count(notes, 'note')}` : `Forgot what was said in ${count(runs, 'chat')}`);

// A change that waits for the owner, as its chip says it. p: the waiting change (memory.js pendingView).
function waitingChip(p) {
  if (p.action === 'erase') return `Asked to forget for good: ${[p.notes?.length ? count(p.notes.length, 'note') : '', p.runs?.length ? count(p.runs.length, 'chat') : ''].filter(Boolean).join(' and ')} (waiting for your OK)`;
  const text = clip(p.action === 'add' ? p.text : p.action === 'edit' ? p.text : p.current?.text, 120);
  if (p.guarded) return `Asked to ${p.action === 'remove' ? 'remove' : 'change'} what you said: ${text} (waiting for your OK)`;
  return `Asked to ${p.action === 'add' ? 'add to' : p.action === 'edit' ? 'change' : 'remove from'} the shared memory: ${text} (waiting for your OK)`;
}

// Whether a line is the chip of a change that waits, as waitingChip writes it, and has from the start. A chip of a
// done change begins with what was done (chipOf, chiefChip, forgotChip), never with "Asked to".
const isWaitingChip = (text) => /^Asked to [^]*\(waiting for your OK\)$/.test(String(text || ''));

// The card of a change that waits: its title, the line under it (why it waits) and the words of its two buttons.
// A guarded change touches what the owner said: it is never part of "Approve all".
function cardOf(p) {
  const why = p.source === 'outside' ? 'after reading outside content' : p.guarded ? 'in a run you did not start' : 'from its memory review';
  if (p.action === 'erase') return { title: 'Forget for good', meta: why, yes: 'Forget for good', no: 'Keep' };
  if (p.guarded) return { title: p.action === 'remove' ? 'Remove what you said' : 'Change what you said', meta: why, yes: p.action === 'remove' ? 'Remove it' : 'Change it', no: 'Keep it' };
  return { title: { add: 'Add to the shared memory', edit: 'Change in the shared memory', remove: 'Remove from the shared memory' }[p.action] || 'Change the shared memory', meta: why, yes: 'Approve', no: 'Decline' };
}
// What the card reads after the owner's answer.
const answerOf = (p, approved) => (p.action === 'erase' ? (approved ? 'Forgotten' : 'Kept') : p.guarded ? (!approved ? 'Kept' : p.action === 'remove' ? 'Removed' : 'Changed') : approved ? 'Approved' : 'Declined');

// ---------- what a run learned, as it is read (ADR 016) ----------
// A run's record keeps, of a memory change, its kind and a note's id: never a text. The chip an app prints, and
// the `text` an app from before the chips draws its own line from, are put together here when the run is read,
// from the note as it then stands, and stored nowhere. memory: the store (memory.js).
const KEPT = ['memory', 'memory-shared', 'memory-removed', 'memory-restored', 'memory-pin', 'memory-pending', 'forgot'];
function learnedView(x, memory) {
  if (!x || typeof x !== 'object') return x;
  // An entry from before this (a text and no id), and what is no note: as it was written.
  if (!KEPT.includes(x.kind) || (x.id === undefined && x.count === undefined && x.pending === undefined)) return x;
  const base = { kind: x.kind, ...(x.at ? { at: x.at } : {}) };
  const line = (chip, text = chip) => ({ ...base, text, chip });
  if (x.kind === 'forgot') { const chip = forgotChip(Number(x.count) || 0, Number(x.runs) || 0); return line(chip, chip.replace(/^Forgot /, '')); }
  if (x.kind === 'memory-pending') {
    const p = memory.getPending(x.pending);
    if (p) return line(waitingChip(p));
    const what = x.action === 'erase' ? 'forget for good' : x.guarded ? `${x.action === 'remove' ? 'remove' : 'change'} what you said` : `${x.action === 'add' ? 'add to' : x.action === 'edit' ? 'change' : 'remove from'} the shared memory`;
    return line(`Asked to ${what} (since answered)`);
  }
  const note = memory.getNote(x.id);
  const was = note ? null : memory.removedNote(x.id);
  const n = note || (was && { id: x.id, owner: was.owner, text: was.text, source: was.source, pinned: true });
  const verb = { 'memory-removed': 'Removed', 'memory-restored': 'Restored', 'memory-pin': 'Pinned' }[x.kind] || (x.what === 'edit' ? 'Updated' : 'Remembered');
  if (!n) {
    const chip = `${verb} a note, since ${memory.forgottenNote(x.id) ? 'forgotten' : 'removed'}`;
    return line(chip, /^memory(-shared)?$/.test(x.kind) ? chip.replace(/^\w+ /, '') : chip);
  }
  const unpinned = (Array.isArray(x.unpinned) ? x.unpinned : []).map((id) => memory.getNote(id)).filter(Boolean);
  if (x.kind === 'memory-removed') return line(`${chipOf('remove', n)}${note ? ' (since brought back)' : ''}`);
  if (x.kind === 'memory-restored') return line(`${chipOf('restore', n, { unpinned })}${note ? '' : ' (since removed)'}`);
  if (x.kind === 'memory-pin') return line(chipOf('pin', n, { unpinned }));
  // A note that was saved or changed: an app from before the chips prints "Remembered: <text>" itself.
  const chip = chipOf(x.what === 'edit' ? 'edit' : 'add', n, { unpinned: x.what === 'edit' && x.left ? [n, ...unpinned] : unpinned, wanted: x.wanted !== false });
  return line(`${chip}${note ? '' : ' (since removed)'}`, n.text);
}
// What a run did is no row under a reply (ADR 024, ADR 025): the apps are sent only what waits for the owner, from a
// run of today or of before. A memory change or a skill that waits; a job or a change to its instructions whose text
// ends with WAITS, as the server has written one that waits since the first runs. And a skill the bot wrote or
// changed, which no card asks about (ADR 050). An app used, a job changed and instructions updated are not sent.
// The record keeps all.
const WAITS = 'waiting for your approval';
const WAITING = ['memory-pending', 'skill-pending', 'skill', 'skill-updated'];
const learnedSent = (x) => WAITING.includes(x?.kind) || (['job', 'instructions'].includes(x?.kind) && String(x.text || '').endsWith(WAITS));
const learnedViews = (list, memory) => (Array.isArray(list) ? list.filter(learnedSent).map((x) => { try { return learnedView(x, memory); } catch { return { kind: x?.kind, text: '', at: x?.at }; } }) : list);

// The sentence a bot's memory tool answers with, for the bot to relay (`say`).
const place = (note) => (note.owner === SHARED ? 'the shared memory (every bot reads it)' : 'your memory');
// No row under the reply says it (ADR 024): the model tells the owner, whom the Chief calls the user.
const leftLine = (list, who = 'owner') => (list.length ? ` To make room, ${list.length === 1 ? 'this note' : 'these notes'} left the pinned set and stay${list.length === 1 ? 's' : ''} searchable. Tell the ${who} which: ${list.map((n) => `[${n.id}] “${clip(n.text, 80)}”`).join(', ')}.` : '');
// The notes that look like the one just saved, each as its line with whose it is, who said it and when.
const alikeLines = (list) => (list.length ? `\nNotes that look alike (a hint; yours was saved):\n${list.map((n) => noteLine(n, { before: [n.owner === SHARED ? 'shared' : 'yours'] })).join('\n')}\nIf yours replaces one of them, update that one (update_memory) and remove the other (remove_note), so that one note is left.` : '');
// What a forget cannot reach: a change that waits for the owner and would save a text with the same words. It is
// no note, so no forget names it; the owner's "Decline" on its card is what takes it away.
// Another bot's waiting change is named without its text (`hidden`): no bot reads it before the owner's yes.
const waitingLine = (list, who) => {
  if (!list?.length) return '';
  const one = list.length === 1;
  const shown = list.filter((p) => !p.hidden).map((p) => `“${clip(p.text, 100)}”`);
  const hidden = list.length - shown.length;
  const what = [shown.join('; '), hidden ? `${shown.length ? 'and ' : ''}${hidden === 1 ? 'one of another bot\'s' : `${hidden} of other bots'`} with those words, whose text you are not shown` : ''].filter(Boolean).join(' ');
  return `\nNot erased, and no forget reaches ${one ? 'it' : 'them'}: ${one ? 'a change' : 'changes'} to memory that wait${one ? 's' : ''} for the ${who}'s OK on a card in Needs you and would save ${what}. Tell the ${who} to decline ${one ? 'that card' : 'those cards'} if it holds what they want forgotten.`;
};
const SAY = {
  saved: (note, { unpinned = [], wanted = true, similar = [] } = {}) => `Saved to ${place(note)} as [${note.id}]${note.pinned ? ', pinned' : wanted
    ? ', searchable with recall but not pinned: the pinned set is full of what the owner said or pinned. Tell the owner that; they decide which pinned note can go'
    : ', searchable with recall'}.${note.until ? ` It holds until ${note.until}; botdot removes it the day after.` : ''}${leftLine(unpinned)}${alikeLines(similar)}`,
  already: (note) => `That note is already there as [${note.id}]${note.until ? `, and holds until ${note.until}` : ''}; nothing new was saved.`,
  updated: (note, { unpinned = [] } = {}) => `Updated note [${note.id}]. The earlier version is kept in its history.${unpinned.some((n) => n.id === note.id) ? ' It no longer fits with the pinned notes, so it stays searchable with recall instead. Tell the owner that.' : ''}${leftLine(unpinned.filter((n) => n.id !== note.id))}`,
  removed: (note) => `Removed note [${note.id}]. No bot reads it any more. For 30 days the owner can have it brought back; then it is gone.`,
  restored: (note, { unpinned = [] } = {}) => `Brought back note [${note.id}]: “${clip(note.text, 120)}”${note.pinned ? ', pinned' : ', searchable with recall'}.${leftLine(unpinned)}`,
  // A forget: what was erased and left out, and what still looks like it holds the same thing.
  forgot: ({ erased = [], leftOut = [], still = { notes: [], runs: [] } }) => {
    const done = erased.length || leftOut.length
      ? `Forgotten for good: ${count(erased.length, 'note')} erased with ${erased.length === 1 ? 'its' : 'their'} history, and ${count(leftOut.length, 'past run')} left out of what you, other bots and the Chief read (this run among them). The owner still sees those chats in their own history. Tell the owner that ${erasedWords(erased.length)} and ${count(leftOut.length, 'past run')} ${leftOut.length === 1 ? 'was' : 'were'} left out.`
      : 'Nothing was erased: none of those ids is a note of yours, a shared note or a past run of yours.';
    const notes = still.notes.map((n) => `[${n.id}] ${n.removed ? '(removed) ' : n.earlier ? '(an earlier version) ' : ''}“${clip(n.text, 100)}”`);
    const runs = still.runs.map((r) => `run ${r.runId} (${String(r.at || '').slice(0, 10)}): ${clip(r.asked, 100)}`);
    const more = notes.length || runs.length
      ? `\nThese still match the words you gave:${notes.length ? `\nNotes: ${notes.join('; ')}` : ''}${runs.length ? `\nPast runs: ${runs.join('; ')}` : ''}\nCall forget again with those that hold what the owner wants forgotten, and leave the others. Then tell the owner what was forgotten and what you could not reach.`
      : still.waiting?.length ? '' : '\nNothing else of yours matches those words. Tell the owner what was forgotten, and that their own chat history still shows it.';
    return `${done}${more}${waitingLine(still.waiting, 'owner')}`;
  },
  forgetWaits: (p) => `Not done: a forget erases for good, and ${p.source === 'outside' ? 'this run has read outside content' : 'the owner did not start this run'}. It waits for the owner on a card in Needs you ("Forget for good" or "Keep"). Nothing is erased until then. Tell the owner that.`,
  pinned: (note, { unpinned = [] } = {}) => `Pinned [${note.id}].${leftLine(unpinned)}`,
  unpinned: (note) => `Unpinned [${note.id}]; it stays searchable.`,
  waits: (p) => (p.guarded
    ? `Not done yet: note [${p.noteId}] is what the owner said, and ${p.source === 'outside' ? 'this run has read outside content' : 'the owner did not start this run'}. The change waits for the owner's OK on a card in Needs you. Tell the owner that, and carry on.`
    : `Not done yet: ${p.source === 'outside' ? 'this run read outside content (web pages, commands, apps, files, other bots…)' : 'this is your memory review'}, so a change to the shared memory waits for the owner's OK on a card in Needs you. They have been asked; carry on.`),
  refused: (note) => `Not done: note [${note.id}] is what the owner said. A scheduled run and the memory review leave it as it is, and no card was made. Only the owner changes it, by telling you in chat.`,
};
// ---------- what is said about the Chief's memory changes (ADR 017) ----------
// The Chief files a note for everyone, for itself or with bots. Its chip names the place, and is written from
// what the store answered: nothing here reads what the Chief asked for.
const listed = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
// what: 'add', 'edit', 'remove' or 'restore'. notes: the note, or for a note filed with several bots the note
// each of them got. names: { bot id: its name }. unpinned, wanted: as chipOf.
function chiefChip(what, notes, { names = {}, unpinned = [], wanted = true } = {}) {
  const list = Array.isArray(notes) ? notes : [notes];
  const n = list[0];
  const nameOf = (x) => names[x.owner] || 'a bot';
  const own = n.owner === CHIEF_NOTES;
  const where = own ? 'myself' : n.owner === SHARED ? 'all bots' : listed(list.map(nameOf));
  const until = n.until ? ` until ${dayWords(n.until)}` : '';
  const text = clip(n.text, 140);
  if (what === 'remove') return `Removed for ${where}: ${text}`;
  const mine = new Set(list.map((x) => x.id));
  const others = unpinned.filter((x) => !mine.has(x.id));
  if (what === 'restore') return `Restored for ${where}${until}: ${text}${others.length ? ` · unpinned ${left(others)}` : ''}`;
  const loose = what === 'add' ? (wanted ? list.filter((x) => !x.pinned) : []) : list.filter((x) => unpinned.some((u) => u.id === x.id));
  const notPinned = !loose.length ? '' : loose.length === list.length ? ', not pinned' : `, not pinned for ${listed(loose.map(nameOf))}`;
  return `${what === 'edit' ? 'Updated' : own ? 'Noted' : 'Remembered'} for ${where}${until}${n.source === 'outside' ? CHIP_SOURCE.outside : ''}${notPinned}: ${text}${others.length ? ` · unpinned ${left(others)}` : ''}`;
}

// The sentences the Chief's memory tools answer with, for the Chief to pass on (`say`).
const whereOf = (note, names = {}) => (note.owner === SHARED ? 'the shared notes (every bot reads them)' : note.owner === CHIEF_NOTES ? 'your own notes' : `${names[note.owner] || 'that bot'}'s notes`);
const asWhose = (source) => (source === 'owner' ? " It is recorded as the user's own word." : ' It is recorded as saved after outside content, not as the user\'s own word: this turn had already read a bot\'s text, a file or something from elsewhere.');
const CHIEF_SAY = {
  // saved, already: [{ note, name }] (name: the bot's, where it went to a bot). missing: [{ bot, why }].
  filed: ({ saved = [], already = [], missing = [], source = 'owner', wanted = true, unpinned = [] }) => {
    const at = (x) => (x.note.owner === SHARED ? 'for everyone' : x.note.owner === CHIEF_NOTES ? 'in your own notes' : `with ${x.name}`);
    const lines = [];
    if (saved.length) {
      const loose = wanted ? saved.filter((x) => !x.note.pinned) : [];
      lines.push(`Saved ${saved.map((x) => `${at(x)} as [${x.note.id}]`).join(', ')}.${saved.some((x) => x.name) ? ' It is in that bot\'s instructions from its next run; nothing was started.' : ''}${asWhose(source)}`
        + `${saved[0].note.until ? ` It holds until ${saved[0].note.until}; botdot removes it the day after.` : ''}`
        + `${loose.length ? ` Not pinned ${loose.map(at).join(', ')}: the pinned set there is full of what the user said or pinned, so it is found with recall only. Tell the user that; they decide which pinned note can go.` : ''}${leftLine(unpinned, 'user')}`);
    }
    if (already.length) lines.push(`Already there, nothing new was saved: ${already.map((x) => `${at(x)} as [${x.note.id}]`).join(', ')}.`);
    for (const m of missing) lines.push(`Not saved for "${m.bot}": ${m.why}`);
    return lines.join('\n');
  },
  updated: (note, { names, unpinned = [], source = 'owner' } = {}) => `Updated note [${note.id}] in ${whereOf(note, names)}. The earlier version is kept for 30 days.${asWhose(source)}${unpinned.some((n) => n.id === note.id) ? ' It no longer fits with the pinned notes there, so it is found with recall only. Tell the user that.' : ''}${leftLine(unpinned.filter((n) => n.id !== note.id), 'user')}`,
  unchanged: (note) => `Note [${note.id}] already says that; nothing changed.`,
  removed: (note, { names } = {}) => `Removed note [${note.id}] from ${whereOf(note, names)}. No bot reads it any more. For 30 days it can be brought back with restore_note; then it is gone.`,
  restored: (note, { names, unpinned = [] } = {}) => `Brought back note [${note.id}] in ${whereOf(note, names)}: “${clip(note.text, 120)}”${note.pinned ? ', pinned' : ', found with recall'}.${leftLine(unpinned, 'user')}`,
  alreadyBack: (note) => `Nothing to bring back: the same note is already there as [${note.id}].`,
  // A change to what the user said, or a forget, in a turn that has read something that is not theirs.
  waits: (p) => (p.action === 'erase'
    ? 'Not done: a forget erases for good, and this turn has already read a bot\'s text, a file or something from elsewhere. It waits for the user on a card in Needs you ("Forget for good" or "Keep"). Nothing is erased until then. Tell the user that.'
    : `Not done yet: note [${p.noteId}] is what the user said, and this turn has already read a bot's text, a file or something from elsewhere. The change waits for the user's OK on a card in Needs you. Tell the user that.`),
  forgot: ({ erased = [], leftOut = [], still = { notes: [], runs: [] }, unknown = [] }) => {
    const done = erased.length || leftOut.length
      ? `Forgotten for good: ${count(erased.length, 'note')} erased with ${erased.length === 1 ? 'its' : 'their'} history, and ${count(leftOut.length, 'chat')} left out of what you and every bot read (this reply among them). The user still sees those chats in their own history. Tell the user that ${erasedWords(erased.length)} and ${count(leftOut.length, 'chat')} ${leftOut.length === 1 ? 'was' : 'were'} left out.`
      : 'Nothing was erased: none of those ids is a note or a past run.';
    const notes = still.notes.map((n) => `[${n.id}] ${n.removed ? '(removed) ' : n.earlier ? '(an earlier version) ' : ''}“${clip(n.text, 100)}”`);
    const runs = still.runs.map((r) => `run ${r.runId} (${String(r.at || '').slice(0, 10)}): ${clip(r.asked, 100)}`);
    const more = notes.length || runs.length
      ? `\nThese still match the words you gave:${notes.length ? `\nNotes: ${notes.join('; ')}` : ''}${runs.length ? `\nPast runs and chats: ${runs.join('; ')}` : ''}\nCall forget again with those that hold what the user wants forgotten, and leave the others. Then tell the user what was forgotten and what you could not reach.`
      : still.waiting?.length ? '' : '\nNothing else matches those words. Tell the user what was forgotten, and that their own chat history still shows it.';
    return `${done}${more}${waitingLine(still.waiting, 'user')}${unknown.length ? `\nNot found, and left as they are: ${unknown.join(', ')}.` : ''}`;
  },
  notNow: 'Not done: you change memory only in a turn the user started by writing to you. Nothing was saved, changed or erased. Say what you would have done; the user can tell you to.',
};
const FIELDS = { prompt: 'main assignment', systemPrompt: 'personality / rules' };

function create(dataDir) {
  const DIR = path.join(dataDir, 'learning');
  fs.mkdirSync(DIR, { recursive: true });
  const memory = memoryLib.create(dataDir);
  memory.migrateFrom(DIR); // once: notes from the old per-bot files move into memory.db

  const file = (botId) => {
    if (!/^[\w-]+$/.test(String(botId))) throw new Error('Bad bot id');
    return path.join(DIR, `${botId}.json`);
  };
  const load = (botId) => {
    try { return { history: [], ...JSON.parse(fs.readFileSync(file(botId), 'utf8')) }; } catch { return { history: [] }; }
  };
  const save = (botId, d) => {
    const tmp = file(botId) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ history: d.history }, null, 2));
    fs.renameSync(tmp, file(botId));
  };
  const newId = () => crypto.randomUUID().slice(0, 6);
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

  // ---------- memory notes (delegated to memory.db) ----------

  const addNote = (botId, text, opts = {}) => memory.addNote(botId, text, opts);
  const editNote = (botId, id, text, opts = {}) => memory.editNote(botId, id, text, opts);
  const removeNote = (botId, id, opts = {}) => memory.removeNote(botId, id, opts);

  // The pinned notes as the bot sees them on every run (and how many more it can search for).
  const memoryForPrompt = (botId) => memory.forPrompt(botId);

  // ---------- history of task / rules / skill changes ----------

  // field: 'prompt' | 'systemPrompt' | 'skill:<name>' (a skill the bot wrote; before '' = it was created).
  function recordChange(botId, { field, before, after, by = 'you', runId = null, reason = '' }) {
    if ((!FIELDS[field] && !/^skill:[a-z0-9][a-z0-9-]{0,63}$/.test(field)) || before === after) return null;
    const d = load(botId);
    const change = { id: newId(), field, before: String(before || ''), after: String(after || ''), by, runId, reason: clean(reason).slice(0, 300), at: new Date().toISOString() };
    d.history.unshift(change);
    d.history = d.history.slice(0, MAX_HISTORY);
    save(botId, d);
    return change;
  }

  const get = (botId) => ({ memory: memory.notesOf(botId), history: load(botId).history });
  const findChange = (botId, id) => load(botId).history.find((c) => c.id === id) || null;
  const removeAll = (botId) => { memory.removeOwner(botId); fs.rmSync(file(botId), { force: true }); };

  return {
    addNote, editNote, removeNote, memoryForPrompt, recordChange, get, findChange, removeAll, memory, FIELDS,
    // MAX_NOTES / MAX_TOTAL_CHARS are the pinned set's limits (everything else stays searchable).
    LIMITS: { MAX_NOTES: memoryLib.PIN_LIMITS.notes, MAX_NOTE_CHARS: memoryLib.MAX_NOTE_CHARS, MAX_TOTAL_CHARS: memoryLib.PIN_LIMITS.chars },
  };
}

module.exports = { create, chiefChip, CHIEF_SAY, chipOf, forgotChip, waitingChip, cardOf, answerOf, learnedView, learnedViews, learnedSent, WAITS, isWaitingChip, SAY };
