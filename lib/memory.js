// What bots remember, in data/memory.db (the SQLite built into Node 22.13+; no extra packages).
//
// - Notes: what a bot knows, its own or shared by all bots (owner "_shared"). A small pinned set goes
//   into every run; the rest is found with recall, so memory no longer fills up. Each note keeps who
//   saved it and in which run.
// - Past runs: one searchable entry per finished run (and per Chief reply): what was asked, the reply,
//   its steps in plain words, what it learned. Raw web page, email and tool output is not kept.
//   Built from data/runs and the Chief's chats, so it can always be rebuilt; those files stay as they are.
//
// Search uses SQLite full-text search (FTS5, with word stemming), then weighs in recency and pins.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { inert, noteLine, sourceOf, dayOf, lookupLine } = require('./prompt-text'); // a note printed into a prompt is text, never markup (ADR 014)

const PIN_LIMITS = { notes: 30, chars: 10000 }; // pinned notes per bot, and for the shared memory
const MAX_NOTE_CHARS = 400;
const MAX_NOTES = 1000; // per bot: a safety net, not a working limit
const SHARED = '_shared';
// Who said a note (ADR 015): the owner, a bot by itself, or a bot after its run read outside content. The botdot
// server sets it at every save; no tool argument, request body or note text does.
const SOURCES = ['owner', 'bot', 'outside'];
// The schema is `CREATE TABLE IF NOT EXISTS`, which never changes a table that exists. What a table needs beyond
// what it was first made with is listed here, and added at start in one place (the loop over COLUMNS in create()).
const SCHEMA_VERSION = '4'; // 2: who said a note, and a waiting change that is guarded (ADR 015); 3: a note's end, and what a forget that waits names (ADR 016); 4: a past run whose reply was not sent to the owner
const COLUMNS = {
  runs: { quiet: 'INTEGER NOT NULL DEFAULT 0' }, // 1: its reply is the private one of a quiet run (reporting.js finishReport), which the owner was not sent
  notes: { source: 'TEXT', until: 'TEXT' }, // source: null until the first start has looked at a note from before (backfillSources). until: the day a passing state ends
  note_versions: { source: 'TEXT', until: 'TEXT' },
  pending: { source: 'TEXT', guarded: 'INTEGER NOT NULL DEFAULT 0', until: 'TEXT', detail: 'TEXT' }, // detail: the ids a forget that waits names, never a text
};
// 2: Chief replies got the ids of their messages; 3: sections; 4: what a run learned is kinds and note ids, never
// a note's text (ADR 016). From 3 to 4 only the entries that held such a text are made again (backfill).
// 5: the private reply of a quiet run is indexed, marked as not sent to the owner (`quiet`). From 4 to 5 only the
// entries of runs that ended well with no reply in the index are made again.
const INDEX_VERSION = '5';
const REMOVED_DAYS = 30; // a removed note, and an earlier version, can be brought back for this long; then it is purged (ADR 016)
// A run's mark in the index (`excluded`): 0 = read by bots and the Chief; 1 = the owner's "Don't recall", which they
// can take back; 2 = left out by a forget, for good.
const FORGOTTEN = 2;
const SECTION = 1500; // characters in a section of a long reply
// Of a past run, where the lookup looks for the request's words: in what was asked and what was replied. Not in
// its steps and in what it learned, which are botdot's own words ("searched the web for", "memory: note").
const LOOKUP_COLUMNS = 'asked reply';
// What botdot itself wrote into a past run's entry, which is nobody's word about anything: the request of a job's
// run ("(the scheduled job "Tide check")" keeps the job's name), and how a run that failed ended.
const saidOf = (r) => `${String(r.asked || '').replace(/^\((?:the scheduled (?:script )?job "(.*)"|its main assignment)\)$/s, '$1')} ${String(r.reply || '').replace(/^\(didn't finish: [\w-]+\)/, '')}`;

// Filler words that say nothing about what's being looked for (English and Polish).
const STOP = new Set([
  ...'a an and are as at be but by did do does for from had has have he her his how i if in is it its me my no not of on or our she so that the their them then there they this to was we were what when where which who why will with you your'.split(' '),
  ...'a aby ale bo być był była było by co czy dla do gdy gdzie i ich ja jak jaki jest jej jego już kiedy mi mnie na nie o od po przez się są ta tak te ten to tu u w we z za ze że'.split(' '),
]);

const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const cleanText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// A long text in sections of about `size` characters, cut at a paragraph, line or sentence where it can.
// at: where each section starts in the text.
function sections(text, size = SECTION, max = 200) {
  const raw = String(text || '');
  const out = [];
  for (let start = 0; start < raw.length && out.length < max;) {
    let end = Math.min(raw.length, start + size);
    if (end < raw.length) {
      const w = raw.slice(start, end);
      const half = Math.floor(size / 2);
      let k = w.lastIndexOf('\n\n');
      if (k < half) k = w.lastIndexOf('\n');
      if (k < half) k = w.lastIndexOf('. ') + 1;
      if (k >= half) end = start + k;
    }
    const t = cleanText(raw.slice(start, end));
    if (t) out.push({ at: start, text: t });
    start = end;
  }
  return out;
}
// What makes two notes the same note: their topic and text, whatever the capitals (in any language), the spacing
// and the punctuation at the end. "Use pnpm" and "Use pnpm." are one note; so are "Mieszka w Łodzi" and "mieszka w łodzi".
const plain = (t) => cleanText(t).normalize('NFKC').toLowerCase().replace(/[\s.!?…,;:。]+$/u, '');
const sameKey = (text, topic = '') => `${plain(topic)}\u0001${plain(text)}`;
// The words of a text that say what it is about, for telling notes that look alike.
const meaningful = (t) => [...new Set((String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1 && !STOP.has(w)))];
// A calendar day "2026-10-11" that exists, or null.
function calendarDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? m[0] : null;
}
// What a run learned, as the index and a model get it (ADR 016): its kind and a note's id, one line each, and never
// a note's text. What is no note (a job, a skill, a connected app) keeps its own line, which botdot wrote.
const MEMORY_KINDS = /^(memory|memory-shared|memory-pending|memory-pin|memory-removed|memory-restored|forgot)$/;
function learnedLine(x) {
  if (!x || !x.kind) return '';
  if (!MEMORY_KINDS.test(x.kind)) return clip(x.text, 200);
  if (x.kind === 'forgot' && Number.isInteger(x.count)) return `forgot: ${x.count} note${x.count === 1 ? '' : 's'}`;
  return x.id && /^[\w-]{1,40}$/.test(String(x.id)) ? `${x.kind}: note ${x.id}` : x.kind;
}
const learnedLines = (list) => (Array.isArray(list) ? list : []).map(learnedLine).filter(Boolean).join('\n');
// A run step in plain words, for the index: the words are decided with every other word for a step (working-line.js).
const { describeStep } = require('./working-line');

// One word as FTS5 looks for it: as a prefix; a short word ("co", "vm") only whole, since as a prefix it would
// match half the dictionary.
const ftsWord = (w) => (w.length < 3 ? `"${w}"` : `"${w}"*`);
// Free text → an FTS5 query: its first `max` distinct meaningful words, any of them (best matches rank first).
// A search takes 12; the lookup before a run takes every word of the request, up to LOOKUP.words.
const ftsQuery = (q, max = 12) => meaningful(q).slice(0, max).map(ftsWord).join(' OR ');

// The lookup before a run (relevantFor): its numbers, each in this one place.
const LOOKUP = {
  words: 40, // the distinct meaningful words of the request that are looked for
  rare: 3, // a word is rare when at most this many of the bot's notes and past runs hold it: one such word is enough
  notes: 3, // up to this many notes come first,
  runs: 2, // then up to this many past runs
  embedMs: 1500, // meaning search answers within this, or the lookup goes by words alone: a run never waits longer
  // A note found by meaning alone, with no word of the request or one ordinary word, is handed over when it is
  // this close to the request and stands out among the bot's notes by this much: closer than their average by
  // `standsOut`. A bot with fewer than `pool` notes has no average to speak of: there the note has to be closer
  // than `similar` by `standsOut` itself. Measured on bge-m3 (MEM-005's completion notes): a greeting is 0.45 to
  // 0.6 close to any note, a paraphrase 0.55 to 0.68 to its own, so closeness alone tells too little; a
  // paraphrase stands 0.13 to 0.29 above the average, small talk under 0.13.
  similar: 0.55,
  standsOut: 0.13,
  pool: 5,
  embedChars: 1000, // of the request, what is compared by meaning
};
// A word in the form its inflections share ("sensors" and "sensor", "anomalies" and "anomaly"): what the index's
// stemmer does, roughly, for counting which words of a request an item holds.
const stem = (w) => (w.length > 3 ? w.replace(/ie[sd]$/, 'y').replace(/sses$/, 'ss').replace(/(?<![su])s$/, '').replace(/(ing|ed)$/, '') : w);
// Whether a text's word `t` is the request's word `w`, as the index matched it: the same stem, the request's word
// as its start (the index looks for prefixes), or a longer form of it by a letter or two.
function sameWord(w, t) {
  const a = stem(w);
  const b = stem(t);
  return a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b) && a.length - b.length <= 2);
}
// Which of `words` a text holds.
function wordsIn(words, text) {
  const has = meaningful(text);
  return words.filter((w) => has.some((t) => sameWord(w, t)));
}
// `promise`, or `otherwise` when it has not answered within `ms` (or failed).
function within(ms, promise, otherwise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(otherwise), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => otherwise), late]).finally(() => clearTimeout(timer));
}

// newId: where a new note's id comes from, six hex characters; a test hands in its own.
// clock: what day and time it is, for a note's end and the purge; a test hands in its own.
function create(dataDir, { newId = () => crypto.randomUUID().slice(0, 6), clock = () => new Date() } = {}) {
  const FILE = path.join(dataDir, 'memory.db');
  const db = new DatabaseSync(FILE);
  // Only this user may read it (it holds what bots were asked and replied).
  const lockDown = () => { for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`]) { try { fs.chmodSync(f, 0o600); } catch { /* not there yet */ } } };
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, text TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 1, pin_locked INTEGER NOT NULL DEFAULT 0,
      by TEXT, run_id TEXT, created_at TEXT, updated_at TEXT, used_at TEXT, uses INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS notes_owner ON notes(owner);
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, owner UNINDEXED, text, topic, tokenize = 'porter unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY, bot_id TEXT, bot_name TEXT, at TEXT, trigger TEXT, job TEXT, status TEXT,
      asked TEXT, reply TEXT, steps TEXT, learned TEXT, excluded INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS runs_bot ON runs(bot_id, at);
    CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(run_id UNINDEXED, bot_id UNINDEXED, asked, reply, steps, learned, tokenize = 'porter unicode61 remove_diacritics 2');
    -- A long reply in sections (at: where each starts in the reply), so its end is searchable too.
    CREATE TABLE IF NOT EXISTS run_parts (run_id TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (run_id, n));
    CREATE VIRTUAL TABLE IF NOT EXISTS parts_fts USING fts5(run_id UNINDEXED, n UNINDEXED, text, tokenize = 'porter unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    -- Earlier versions of notes (edited or deleted): facts keep their history, and can be brought back.
    CREATE TABLE IF NOT EXISTS note_versions (
      vid INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT, owner TEXT, text TEXT, topic TEXT, by TEXT, run_id TEXT,
      valid_from TEXT, valid_to TEXT, change TEXT, reason TEXT, changed_by TEXT, pinned INTEGER);
    CREATE INDEX IF NOT EXISTS versions_note ON note_versions(note_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS versions_fts USING fts5(vid UNINDEXED, owner UNINDEXED, text, tokenize = 'porter unicode61 remove_diacritics 2');
    -- Meaning-based search (optional): one vector per note and per past run, from bge-m3 via llama.cpp.
    CREATE TABLE IF NOT EXISTS embeddings (kind TEXT NOT NULL, ref TEXT NOT NULL, model TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (kind, ref));
    -- Changes to the shared memory waiting for the owner's OK (from runs that read web pages, email…).
    CREATE TABLE IF NOT EXISTS pending (
      id TEXT PRIMARY KEY, action TEXT, owner TEXT, note_id TEXT, text TEXT, topic TEXT, pinned INTEGER,
      by TEXT, run_id TEXT, bot_id TEXT, reason TEXT, at TEXT);
    -- Forgetting (ADR 016). Ids only, never a text: the runs that wrote each note, the runs a forget left out for good (no rebuild of the index
    -- brings one back), the notes it erased (their ids are not given out again, and a chip can say "since
    -- forgotten"), and an erase that has begun, which the next start completes.
    CREATE TABLE IF NOT EXISTS left_out (run_id TEXT PRIMARY KEY, at TEXT);
    -- Every run that wrote a note or said its sentence again: a forget leaves them all out, also the first of two
    -- runs that said the same thing, and one whose earlier version has been purged since.
    CREATE TABLE IF NOT EXISTS note_runs (note_id TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY (note_id, run_id));
    CREATE TABLE IF NOT EXISTS forgotten_notes (note_id TEXT PRIMARY KEY, at TEXT);
    CREATE TABLE IF NOT EXISTS erasing (id INTEGER PRIMARY KEY AUTOINCREMENT, notes TEXT, runs TEXT, at TEXT);
  `);
  // The one place that adds a column to a table that exists: what COLUMNS names and the table lacks. A second
  // start finds nothing missing and changes nothing.
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const has = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of Object.entries(columns)) if (!has.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  lockDown();
  // Each statement is compiled once and kept.
  const statements = new Map();
  const q = (sql) => { let st = statements.get(sql); if (!st) { st = db.prepare(sql); statements.set(sql, st); } return st; };
  const now = () => clock().toISOString();
  const today = () => dayOf(clock()); // in the server's time zone: the owner's, which schedules follow
  const getMeta = (k) => q('SELECT value FROM meta WHERE key = ?').get(k)?.value ?? null;
  const setMeta = (k, v) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  // One transaction; inside one already, `fn` is part of it.
  let inTx = false;
  const tx = (fn) => {
    if (inTx) return fn();
    db.exec('BEGIN');
    inTx = true;
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { inTx = false; }
  };
  if (getMeta('schema_version') !== SCHEMA_VERSION) setMeta('schema_version', SCHEMA_VERSION);

  // ---------- notes ----------

  const view = (n) => n && ({ id: n.id, owner: n.owner, text: n.text, topic: n.topic, pinned: !!n.pinned, pinLocked: !!n.pin_locked, source: sourceOf(n.source), ...(n.until ? { until: n.until } : {}), by: n.by, runId: n.run_id, at: n.updated_at, createdAt: n.created_at, usedAt: n.used_at, uses: n.uses, versions: n.versions || 0 });
  // The end of a passing state as it is saved: a calendar day, today or later. '' or nothing: the note has no end.
  function endDay(until) {
    if (until === undefined || until === null || String(until).trim() === '') return null;
    const day = calendarDay(until);
    if (!day) throw new Error('Give the end as a calendar day, like 2026-10-11.');
    if (day < today()) throw new Error(`That end, ${day}, is in the past (today is ${today()}). Give the day it ends, or save it without an end.`);
    return day;
  }
  const indexNote = (n) => {
    q('DELETE FROM notes_fts WHERE id = ?').run(n.id);
    q('INSERT INTO notes_fts (id, owner, text, topic) VALUES (?, ?, ?, ?)').run(n.id, n.owner, n.text, n.topic || '');
  };
  const getNote = (id) => q('SELECT * FROM notes WHERE id = ?').get(String(id));
  // A run wrote this note, or said its sentence again (note_runs): kept for a forget, by ids alone.
  const wroteIn = (noteId, runId) => { if (noteId && runId) q('INSERT OR IGNORE INTO note_runs (note_id, run_id) VALUES (?, ?)').run(String(noteId), String(runId)); };
  const notesOf = (owner) => q('SELECT n.*, (SELECT COUNT(*) FROM note_versions v WHERE v.note_id = n.id) AS versions FROM notes n WHERE owner = ? ORDER BY pinned DESC, updated_at DESC').all(owner);
  const countNotes = (owner) => q('SELECT COUNT(*) AS n FROM notes WHERE owner = ?').get(owner).n;
  const pinnedOf = (owner) => q('SELECT * FROM notes WHERE owner = ? AND pinned = 1 ORDER BY created_at').all(owner);

  // Make room in the pinned set for `adding` more characters (and `notes` more notes). What the owner said is
  // never unpinned for it, nor a note the owner pinned themselves (pin_locked), nor `keep`. What leaves: notes saved
  // after outside content first, then a bot's own conclusions, the oldest first (ADR 015). They stay searchable.
  // Nothing changes unless it then fits. Returns the notes that were unpinned, or null when there's no room.
  function makeRoom(owner, adding, { notes = 1, keep = null } = {}) {
    const pinned = pinnedOf(owner);
    let count = pinned.length + notes;
    let chars = pinned.reduce((s, n) => s + n.text.length, 0) + adding;
    const fits = () => count <= PIN_LIMITS.notes && chars <= PIN_LIMITS.chars;
    const victims = [];
    const mayGo = q(`SELECT * FROM notes WHERE owner = ? AND pinned = 1 AND pin_locked = 0 AND COALESCE(source, 'bot') != 'owner'
                     ORDER BY CASE COALESCE(source, 'bot') WHEN 'outside' THEN 0 ELSE 1 END, updated_at ASC, created_at ASC`).all(owner);
    for (const v of mayGo) {
      if (fits()) break;
      if (v.id === keep) continue;
      victims.push(v);
      count--;
      chars -= v.text.length;
    }
    if (!fits()) return null; // what's left is the owner's: can't make room
    for (const v of victims) q('UPDATE notes SET pinned = 0 WHERE id = ?').run(v.id);
    return victims.map((v) => view({ ...v, pinned: 0 }));
  }

  // A new note's id. One key serves every owner's notes, so an id that a note has, or an earlier version of one
  // (it can be brought back under it), is drawn again: one bot's save never fails on another's note.
  function freshId() {
    for (let tries = 0; tries < 50; tries++) {
      const id = String(newId());
      if (!getNote(id) && !q('SELECT 1 FROM note_versions WHERE note_id = ? LIMIT 1').get(id) && !q('SELECT 1 FROM forgotten_notes WHERE note_id = ?').get(id)) return id;
    }
    throw new Error("Couldn't save the note just now. Try again.");
  }

  // Up to three notes of `owners` that look like this one: they share two words that say what a note is about,
  // or one that few notes have. A hint for whoever saves, never a reason not to save.
  function similarTo(text, topic, owners, not = null) {
    const mine = meaningful(`${topic} ${text}`);
    const match = ftsQuery(`${topic} ${text}`);
    if (!match || !owners.length) return [];
    const ph = owners.map(() => '?').join(',');
    const rows = q(`SELECT n.* FROM notes_fts JOIN notes n ON n.id = notes_fts.id WHERE notes_fts MATCH ? AND notes_fts.owner IN (${ph})
                    ORDER BY bm25(notes_fts, 0, 0, 1.0, 0.6) LIMIT 20`).all(match, ...owners);
    const alike = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
    const rare = (w) => q(`SELECT COUNT(*) AS n FROM notes_fts WHERE notes_fts MATCH ? AND owner IN (${ph})`).get(`"${w}"`, ...owners).n <= 3;
    return rows.filter((r) => r.id !== not)
      .map((r) => ({ r, shared: mine.filter((w) => meaningful(`${r.topic} ${r.text}`).some((x) => alike(w, x))) }))
      .filter((x) => x.shared.length >= 2 || (x.shared.length === 1 && rare(x.shared[0])))
      .sort((a, b) => b.shared.length - a.shared.length)
      .slice(0, 3).map((x) => view(x.r));
  }

  // source: who says it ('owner', 'bot' or 'outside'), decided by the caller on the server and never by a model.
  // similarIn: the owners whose notes may be named as looking alike (a bot's own and the shared ones).
  // Returns { note, duplicate, unpinned, similar }: `unpinned` are the notes that left the pinned set for it.
  // until: the day a passing state ends (endDay), or nothing.
  function addNote(owner, text, { by = 'bot', runId = null, topic = '', pinned = true, locked = false, id = null, createdAt = null, source = 'bot', similarIn = null, until = null } = {}) {
    text = cleanText(text);
    topic = cleanText(topic).slice(0, 40);
    source = sourceOf(source);
    until = endDay(until);
    if (!text) throw new Error('The note is empty');
    if (text.length > MAX_NOTE_CHARS) throw new Error(`Keep a note under ${MAX_NOTE_CHARS} characters`);
    return tx(() => {
      const key = sameKey(text, topic);
      const same = q('SELECT * FROM notes WHERE owner = ?').all(owner).find((n) => sameKey(n.text, n.topic) === key);
      if (same) {
        // The same sentence again makes no second note. Said by the owner, the note is theirs from now on and
        // carries today's date, whoever saved it first; said by anyone else, nothing changes.
        if (source === 'owner') {
          const fits = () => { const p = pinnedOf(owner); return p.length < PIN_LIMITS.notes && p.reduce((s, n) => s + n.text.length, 0) + same.text.length <= PIN_LIMITS.chars; };
          // A bot's note that had left the pinned set is pinned again where that unpins nothing.
          const pin = same.pinned || (pinned && sourceOf(same.source) !== 'owner' && fits()) ? 1 : 0;
          q('UPDATE notes SET source = ?, by = ?, run_id = COALESCE(?, run_id), updated_at = ?, pinned = ? WHERE id = ?').run('owner', by, runId, now(), pin, same.id);
        }
        wroteIn(same.id, runId); // whoever says it again: that run holds the sentence too
        // Said again with an end, the note ends then: by the owner always, by anyone else unless it is the owner's.
        if (until && until !== same.until && (source === 'owner' || sourceOf(same.source) !== 'owner')) q('UPDATE notes SET until = ? WHERE id = ?').run(until, same.id);
        return { note: view(getNote(same.id)), duplicate: true, unpinned: [], similar: [] };
      }
      if (q('SELECT COUNT(*) AS n FROM notes WHERE owner = ?').get(owner).n >= MAX_NOTES) throw new Error('Memory is very full. Merge or remove older notes first (update_memory / remove_note).');
      const similar = similarTo(text, topic, similarIn || [...new Set([owner, SHARED])]);
      let unpinned = [];
      let pin = pinned ? 1 : 0;
      if (pin) {
        const r = makeRoom(owner, text.length);
        if (r === null) pin = 0; // no room: keep it searchable instead
        else unpinned = r;
      }
      const t = createdAt || now();
      const n = { id: id || freshId(), owner, text, topic, pinned: pin, pin_locked: locked && pin ? 1 : 0, source, by, run_id: runId, created_at: t, updated_at: t, until };
      q('INSERT INTO notes (id, owner, text, topic, pinned, pin_locked, source, by, run_id, created_at, updated_at, until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(n.id, n.owner, n.text, n.topic, n.pinned, n.pin_locked, n.source, n.by, n.run_id, n.created_at, n.updated_at, n.until);
      indexNote(n);
      wroteIn(n.id, n.run_id);
      onChange(n.id);
      return { note: view(getNote(n.id)), duplicate: false, unpinned, similar };
    });
  }

  // Keep the version being replaced or deleted (with when it stopped being true, and why).
  function keepVersion(n, change, { by, reason = '' } = {}) {
    const r = q(`INSERT INTO note_versions (note_id, owner, text, topic, by, run_id, valid_from, valid_to, change, reason, changed_by, pinned, source, until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(n.id, n.owner, n.text, n.topic || '', n.by, n.run_id, n.updated_at || n.created_at, now(), change, cleanText(reason).slice(0, 300), by || null, n.pinned ? 1 : 0, sourceOf(n.source), n.until || null);
    q('INSERT INTO versions_fts (vid, owner, text) VALUES (?, ?, ?)').run(Number(r.lastInsertRowid), n.owner, n.text);
    embedDirty = true;
  }

  // A new text or topic for a note: one current note, and the text it had as one dated version.
  // source: who says the new text; left out, the note keeps its own (bringing an earlier version back does).
  // What was saved after outside content stays so when a bot rewrites it by itself: only the owner's word lifts it.
  // Returns { note, unpinned }: the notes that left the pinned set, the note itself among them when it no longer fits;
  // and `unchanged: true` when the note already said that.
  // until: a new end (endDay), '' for none; left out or null, the note keeps its own.
  function changeNote(owner, id, text, { by = 'bot', topic, runId, reason = '', source, until } = {}) {
    const n = getNote(id);
    if (!n || n.owner !== owner) throw new Error(`No note with id ${id}`);
    const next = text === undefined ? n.text : cleanText(text);
    if (!next) throw new Error('The note is empty');
    if (next.length > MAX_NOTE_CHARS) throw new Error(`Keep a note under ${MAX_NOTE_CHARS} characters`);
    const t = topic === undefined ? n.topic : cleanText(topic).slice(0, 40);
    const end = until === undefined || until === null ? n.until || null : endDay(until); // only '' takes an end away
    if (next === n.text && t === n.topic && end === (n.until || null)) return { note: view(n), unpinned: [], unchanged: true };
    const had = sourceOf(n.source);
    const says = source === undefined || (sourceOf(source) === 'bot' && had === 'outside') ? had : sourceOf(source);
    return tx(() => {
      // A longer pinned note must still fit the pinned set. If it can't, it stays searchable instead, unless it was
      // what the owner said or the owner pinned it: such a note is never unpinned by itself, so the owner decides what goes.
      let pinned = n.pinned;
      let unpinned = [];
      if (pinned && next.length > n.text.length) {
        const room = makeRoom(owner, next.length - n.text.length, { notes: 0, keep: id });
        if (room) unpinned = room;
        else if (n.pin_locked) throw new Error('This note is pinned and a longer text no longer fits with the pinned notes. Keep it as short as it was, and save what you wanted to add as a new note with remember.');
        else if (had === 'owner') throw new Error('This note is what the owner said, and a longer text no longer fits with the pinned notes. Keep it as short as it was, and save what you wanted to add as a new note with remember.');
        else pinned = 0;
      }
      keepVersion(n, 'edited', { by, reason });
      q('UPDATE notes SET text = ?, topic = ?, pinned = ?, source = ?, by = ?, run_id = COALESCE(?, run_id), updated_at = ?, until = ? WHERE id = ?').run(next, t, pinned, says, by, runId || null, now(), end, id);
      const fresh = getNote(id);
      indexNote(fresh);
      wroteIn(id, runId);
      onChange(fresh.id);
      return { note: view(fresh), unpinned: n.pinned && !pinned ? [view(fresh), ...unpinned] : unpinned };
    });
  }
  const editNote = (...args) => changeNote(...args).note;

  // The owner pins (and so locks it in) or unpins a note. A bot pinning its own note doesn't lock it.
  // Returns { note, unpinned }: the notes that left the pinned set to make room for it.
  function pinNote(id, pinned, { byBot = false } = {}) {
    const n = getNote(id);
    if (!n) throw new Error('Note not found');
    let unpinned = [];
    tx(() => {
      if (pinned) {
        if (!n.pinned) {
          const room = makeRoom(n.owner, n.text.length);
          if (room === null) throw new Error(byBot ? 'Not pinned: there is no room among the pinned notes. The note stays searchable, and recall and the lookup before each run find it; nothing else to do.' : `The pinned set is full of notes the owner said or pinned. Unpin one first (up to ${PIN_LIMITS.notes} notes).`);
          unpinned = room;
        }
        q('UPDATE notes SET pinned = 1, pin_locked = ? WHERE id = ?').run(byBot ? n.pin_locked : 1, id);
      } else q('UPDATE notes SET pinned = 0, pin_locked = 0 WHERE id = ?').run(id);
    });
    return { note: view(getNote(id)), unpinned };
  }
  const setPinned = (...args) => pinNote(...args).note;

  function removeNote(owner, id, { by = null, reason = '' } = {}) {
    const n = getNote(id);
    if (!n || (owner && n.owner !== owner)) throw new Error(`No note with id ${id}`);
    tx(() => {
      keepVersion(n, 'deleted', { by, reason });
      q('DELETE FROM notes WHERE id = ?').run(id);
      q('DELETE FROM notes_fts WHERE id = ?').run(id);
    });
    onChange(id);
    return view(n);
  }

  // A passing state whose day is over is removed, with "ended" as the reason: from the day after its end no model
  // reads it, also when botdot was not running on that day (ADR 016). Asked before notes are handed out, and at start.
  function endPast(day = today()) {
    const over = q('SELECT id FROM notes WHERE until IS NOT NULL AND until < ?').all(day);
    for (const { id } of over) removeNote(null, id, { by: 'botdot', reason: 'ended' });
    return over.length;
  }

  const versionView = (v) => v && ({ vid: v.vid, noteId: v.note_id, owner: v.owner, text: v.text, topic: v.topic, source: sourceOf(v.source), ...(v.until ? { until: v.until } : {}), by: v.by, validFrom: v.valid_from, validTo: v.valid_to, change: v.change, reason: v.reason, changedBy: v.changed_by });
  const history = (noteId) => q('SELECT * FROM note_versions WHERE note_id = ? ORDER BY vid DESC').all(String(noteId)).map(versionView);
  // A removed note: the last version of a note that is no more. It can be brought back until it is purged.
  const REMOVED = "v.change = 'deleted' AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = v.note_id) AND v.vid = (SELECT MAX(vid) FROM note_versions w WHERE w.note_id = v.note_id)";
  const deletedOf = (owner) => q(`SELECT v.* FROM note_versions v WHERE v.owner = ? AND ${REMOVED} ORDER BY v.vid DESC LIMIT 30`).all(owner).map(versionView);
  // The removed notes of `owners`, those that match `query` first, or the latest without one. No model is handed
  // them unless a run the owner started asks (server.js).
  function removedOf(owners, { query = '', limit = 20, offset = 0 } = {}) {
    if (!owners.length) return [];
    endPast();
    limit = Math.min(Math.max(1, Math.floor(Number(limit)) || 20), 25); // as recall: 25 at most
    offset = Math.max(0, Math.floor(Number(offset)) || 0);
    const ph = owners.map(() => '?').join(',');
    const match = ftsQuery(query);
    const rows = match
      ? q(`SELECT v.* FROM versions_fts JOIN note_versions v ON v.vid = versions_fts.vid WHERE versions_fts MATCH ? AND v.owner IN (${ph}) AND ${REMOVED} ORDER BY bm25(versions_fts, 0, 0, 1.0), v.vid DESC LIMIT ? OFFSET ?`).all(match, ...owners, limit, offset)
      : q(`SELECT v.* FROM note_versions v WHERE v.owner IN (${ph}) AND ${REMOVED} ORDER BY v.vid DESC LIMIT ? OFFSET ?`).all(...owners, limit, offset);
    return rows.map(versionView);
  }
  // How many removed notes of `owners` there are, those that match `query` or all of them: recall's total.
  function countRemoved(owners, { query = '' } = {}) {
    if (!owners.length) return 0;
    const ph = owners.map(() => '?').join(',');
    const match = ftsQuery(query);
    return match
      ? q(`SELECT COUNT(*) AS c FROM versions_fts JOIN note_versions v ON v.vid = versions_fts.vid WHERE versions_fts MATCH ? AND v.owner IN (${ph}) AND ${REMOVED}`).get(match, ...owners).c
      : q(`SELECT COUNT(*) AS c FROM note_versions v WHERE v.owner IN (${ph}) AND ${REMOVED}`).get(...owners).c;
  }
  const removedNote = (noteId) => versionView(q(`SELECT v.* FROM note_versions v WHERE v.note_id = ? AND ${REMOVED}`).get(String(noteId ?? '')));

  // Bring an earlier version back: as the note's text again, or the removed note itself.
  // Returns { note, unpinned }: a pinned note that comes back into a full pinned set makes room as a new one does,
  // and the notes that left the pinned set for it are said, as for every unpin (ADR 015).
  function restoreNote(vid, { by = 'you' } = {}) {
    const v = q('SELECT * FROM note_versions WHERE vid = ?').get(Number(vid));
    if (!v) throw new Error('That version is gone');
    const n = getNote(v.note_id);
    // The text comes back as whoever said it then: a version keeps its source.
    if (n) { const r = changeNote(n.owner, n.id, v.text, { by, topic: v.topic, reason: 'Brought back an earlier version', source: sourceOf(v.source) }); return { note: r.note, unpinned: r.unpinned }; }
    // A passing state comes back with its end while that day is not over; after it, as a note without one.
    // When the same sentence was saved again meanwhile, that note is answered and nothing is brought back: its id
    // is not the version's (the callers say so).
    const r = addNote(v.owner, v.text, { by, topic: v.topic, id: v.note_id, pinned: !!v.pinned, runId: v.run_id, source: sourceOf(v.source), until: v.until && v.until >= today() ? v.until : null });
    return { note: r.note, unpinned: r.unpinned };
  }
  const restore = (...args) => restoreNote(...args).note;

  // A deleted bot is forgotten (ADR 016): its notes, their versions, what waits for the owner about them or from
  // it, and its indexed runs, with their vectors. Its run files stay in the run history; backfill leaves them out.
  function removeOwner(owner) {
    tx(() => {
      q('DELETE FROM note_runs WHERE note_id IN (SELECT id FROM notes WHERE owner = ? UNION SELECT note_id FROM note_versions WHERE owner = ?)').run(owner, owner);
      q("DELETE FROM embeddings WHERE kind = 'note' AND ref IN (SELECT id FROM notes WHERE owner = ?)").run(owner);
      q("DELETE FROM embeddings WHERE kind = 'old' AND ref IN (SELECT CAST(vid AS TEXT) FROM note_versions WHERE owner = ?)").run(owner);
      q('DELETE FROM notes WHERE owner = ?').run(owner);
      q('DELETE FROM notes_fts WHERE owner = ?').run(owner);
      q('DELETE FROM note_versions WHERE owner = ?').run(owner);
      q('DELETE FROM versions_fts WHERE owner = ?').run(owner);
      q('DELETE FROM pending WHERE owner = ? OR bot_id = ?').run(owner, owner);
      forgetRunsOfBot(owner);
    });
    sweepDirty = true;
    vectors = null;
  }

  // ---------- forgetting (ADR 016) ----------

  const idList = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? '').trim()).filter((x) => /^[\w-]{1,80}$/.test(x)))];
  const parseList = (json) => { try { return idList(JSON.parse(json || '[]')); } catch { return []; } };

  // "Left out": the one function that says whether a past run is read by no bot and no tool of the Chief. run: a
  // run's record, its entry in the index, or its id. It is left out when the owner marked it ("Don't recall") or a
  // forget left it out; the record's own marks answer first, then what this database holds, so a run is left out
  // from the moment the forget is committed, whatever its file says.
  function leftOut(run) {
    if (!run) return false;
    if (typeof run === 'object' && (run.excludedFromMemory || run.forgotten || run.excluded)) return true;
    const id = String(typeof run === 'object' ? run.run_id ?? run.id ?? '' : run);
    if (!id) return false;
    return !!q('SELECT 1 FROM left_out WHERE run_id = ?').get(id) || !!q('SELECT 1 FROM runs WHERE run_id = ? AND excluded != 0').get(id);
  }
  const forgottenRun = (id) => !!q('SELECT 1 FROM left_out WHERE run_id = ?').get(String(id));
  // A reply of the Chief's is known by its place in its chat ("chief-<chat>-<n>"), and a message that comes in
  // above a reply that is still being written moves it (chief.js): what was recorded under the id it had while
  // it was written (the notes it saved, a forget that left it out, a change that waits) follows it to the id it ends with.
  function renameRun(from, to) {
    from = String(from); to = String(to);
    if (from === to) return;
    tx(() => {
      q('UPDATE OR IGNORE note_runs SET run_id = ? WHERE run_id = ?').run(to, from);
      q('DELETE FROM note_runs WHERE run_id = ?').run(from);
      q('UPDATE OR IGNORE left_out SET run_id = ? WHERE run_id = ?').run(to, from);
      q('DELETE FROM left_out WHERE run_id = ?').run(from);
      for (const table of ['notes', 'note_versions', 'pending']) q(`UPDATE ${table} SET run_id = ? WHERE run_id = ?`).run(to, from);
      // And among the runs that asked again for a change that waits (askersOf).
      for (const p of q("SELECT id, detail FROM pending WHERE action != 'erase' AND detail IS NOT NULL").all()) {
        const askers = askersOf(p);
        if (askers.includes(from)) q('UPDATE pending SET detail = ? WHERE id = ?').run(JSON.stringify({ askers: [...new Set(askers.map((r) => (r === from ? to : r)))] }), p.id);
      }
    });
  }
  const forgottenRuns = () => q('SELECT run_id FROM left_out').all().map((r) => r.run_id);
  // The runs that asked again for an addition or a change that already waited (propose): ids in the waiting
  // change's `detail`, never a text. Each said the sentence, as the run that asked first did (`run_id`).
  const askersOf = (p) => { try { return idList(JSON.parse(p.detail || '{}').askers); } catch { return []; } };
  const forgottenNote = (id) => !!q('SELECT 1 FROM forgotten_notes WHERE note_id = ?').get(String(id ?? ''));

  // Inside one transaction: the notes with every version, their search rows, vectors and waiting changes go, and
  // the runs that wrote them, with the runs named, are left out for good.
  function eraseNow(noteIds, runIds) {
    const t = now();
    const runs = new Set(runIds);
    const erased = [];
    const said = new Set(); // the duplicate keys of every text an erased note had, each with whose note it was
    for (const id of noteIds) {
      const n = getNote(id);
      const versions = q('SELECT vid, run_id, owner, text, topic FROM note_versions WHERE note_id = ?').all(id);
      if (!n && !versions.length) { q('DELETE FROM note_runs WHERE note_id = ?').run(id); continue; }
      if (n?.run_id) runs.add(n.run_id);
      for (const x of [n, ...versions]) if (x) said.add(`${x.owner}\u0002${sameKey(x.text, x.topic)}`).add(`${SHARED}\u0002${sameKey(x.text, x.topic)}`);
      for (const r of q('SELECT run_id FROM note_runs WHERE note_id = ?').all(id)) runs.add(r.run_id);
      q('DELETE FROM note_runs WHERE note_id = ?').run(id);
      for (const v of versions) {
        if (v.run_id) runs.add(v.run_id);
        q('DELETE FROM versions_fts WHERE vid = ?').run(v.vid);
        q("DELETE FROM embeddings WHERE kind = 'old' AND ref = ?").run(String(v.vid));
        forgetVectors(`old:${v.vid}`);
      }
      q('DELETE FROM note_versions WHERE note_id = ?').run(id);
      q('DELETE FROM notes WHERE id = ?').run(id);
      q('DELETE FROM notes_fts WHERE id = ?').run(id);
      q("DELETE FROM embeddings WHERE kind = 'note' AND ref = ?").run(id);
      forgetVectors(`note:${id}`);
      q("DELETE FROM pending WHERE note_id = ? AND action != 'erase'").run(id);
      q('INSERT OR REPLACE INTO forgotten_notes (note_id, at) VALUES (?, ?)').run(id, t);
      erased.push(id);
    }
    // An addition that waits has no note yet, so no id names it: one that would save a text an erased note had
    // (the duplicate key, sameKey) goes with it, where it would be saved to the notes that note was in or to the
    // shared ones, which every bot reads. Else a later yes, "Approve all" among them, would put the forgotten
    // sentence back into a prompt. The runs that asked for it said the sentence too, and are left out with the
    // runs that wrote the note. An addition to another bot's own notes is not this forget's to take: what still
    // matches names it (stillMatching).
    if (said.size) {
      for (const p of q("SELECT id, owner, text, topic, run_id, detail FROM pending WHERE action = 'add'").all()) {
        if (!said.has(`${p.owner}\u0002${sameKey(p.text, p.topic)}`)) continue;
        for (const r of [p.run_id, ...askersOf(p)]) if (r) runs.add(r);
        q('DELETE FROM pending WHERE id = ?').run(p.id);
      }
    }
    // A forget that waits and names an erased note no longer names it; one that names nothing else is gone.
    for (const p of q("SELECT id, detail FROM pending WHERE action = 'erase'").all()) {
      let d;
      try { d = JSON.parse(p.detail || '{}'); } catch { d = {}; }
      const notes = idList(d.notes).filter((id) => !erased.includes(id));
      const left = idList(d.runs);
      if (notes.length === idList(d.notes).length) continue;
      if (!notes.length && !left.length) q('DELETE FROM pending WHERE id = ?').run(p.id);
      else q('UPDATE pending SET detail = ?, note_id = ? WHERE id = ?').run(JSON.stringify({ notes, runs: left }), notes[0] || null, p.id);
    }
    const fresh = [...runs].filter((id) => !forgottenRun(id)); // those a forget had left out already are not counted again
    for (const id of fresh) {
      q('INSERT OR IGNORE INTO left_out (run_id, at) VALUES (?, ?)').run(id, t);
      q('UPDATE runs SET excluded = ? WHERE run_id = ?').run(FORGOTTEN, id);
      q("DELETE FROM embeddings WHERE (kind = 'run' AND ref = ?) OR (kind = 'part' AND ref LIKE ?)").run(id, `${id}:%`);
      forgetVectors(`run:${id}`);
      forgetVectors(`part:${id}:`, true);
    }
    return { erased, leftOut: fresh };
  }
  // An erase that has begun (`erasing` holds the ids it names, never a text) is done in one transaction, which
  // takes its entry with it: botdot stopped in between, the next start finds the entry and completes it.
  function finishErase(entry) {
    const row = q('SELECT * FROM erasing WHERE id = ?').get(entry);
    if (!row) return { erased: [], leftOut: [] };
    return tx(() => { const done = eraseNow(parseList(row.notes), parseList(row.runs)); q('DELETE FROM erasing WHERE id = ?').run(entry); return done; });
  }
  // Forget: erase these notes for good and leave these runs out. Returns { erased: note ids, leftOut: run ids }.
  // Which notes and runs a caller may name is the caller's to check (server.js).
  function erase({ notes = [], runs = [] } = {}) {
    const entry = Number(q('INSERT INTO erasing (notes, runs, at) VALUES (?, ?, ?)').run(JSON.stringify(idList(notes)), JSON.stringify(idList(runs)), now()).lastInsertRowid);
    return finishErase(entry);
  }
  function completeErases() {
    let done = 0;
    for (const { id } of q('SELECT id FROM erasing ORDER BY id').all()) { finishErase(id); done++; }
    return done;
  }

  // What still matches after a forget: notes (current, earlier versions and removed ones) and runs that are not
  // left out, by the words of `about`, the best matches only. not: run ids that are no answer (the asking run).
  // And the changes that wait for the owner whose new text holds those words (`waiting`, only when there are
  // some): a waiting change is no note and no forget names it, but a yes would save its text. waitingBy: the bot
  // that asks; null for the Chief. A bot is handed the text of its own waiting changes only: another bot's is
  // named without its text (`hidden`), since what waits for the owner's yes is read by no other bot before it.
  function stillMatching({ about, owners = [], runsOf = [], not = [], waitingBy = null }) {
    if (!ftsQuery(about)) return { notes: [], runs: [] };
    const hits = rank({ query: about, notesOf: owners, runsOf, limit: 25, history: true, removed: true, scores: true }, new Map()).filter((r) => !(r.kind === 'run' && not.includes(r.runId)));
    const best = hits[0]?.score || 0;
    const notes = new Map();
    const runs = [];
    for (const r of hits) {
      if (r.score < best / 2 || notes.size + runs.length >= 10) break;
      if (r.kind === 'run') runs.push({ runId: r.runId, at: r.at, asked: r.asked });
      else if (r.kind === 'note') notes.set(r.id, { id: r.id, owner: r.owner, text: r.text });
      else if (!notes.has(r.noteId)) notes.set(r.noteId, { id: r.noteId, owner: r.owner, text: r.text, ...(getNote(r.noteId) ? { earlier: true } : { removed: true }) });
    }
    const waiting = waitingFor(about, owners, waitingBy);
    return { notes: [...notes.values()], runs, ...(waiting.length ? { waiting } : {}) };
  }
  // The waiting additions and changes to the notes of `owners` whose text holds at least half of the words of
  // `about`, as the search matches a word: a word of three letters or more also as the start of a longer one.
  function waitingFor(about, owners, by = null) {
    const words = meaningful(about).slice(0, 12);
    if (!words.length || !owners.length) return [];
    const holds = (text, w) => meaningful(text).some((x) => x === w || (w.length >= 3 && x.startsWith(w)));
    return q("SELECT * FROM pending WHERE action IN ('add', 'edit') ORDER BY at").all()
      .filter((p) => owners.includes(p.owner))
      .filter((p) => words.filter((w) => holds(`${p.topic} ${p.text}`, w)).length >= Math.ceil(words.length / 2))
      .slice(0, 5).map((p) => ({ id: p.id, action: p.action, owner: p.owner, ...(!by || p.bot_id === by ? { text: p.text } : { hidden: true }) }));
  }

  // Pinned notes as the bot sees them on every run, plus a hint about the rest. For a prompt only: the lines
  // and the topics are neutralised (inert), so a note cannot close the block it is printed in.
  // Each line says who said the note and when (prompt-text.js noteLine, ADR 015).
  // The block is bounded as it is printed: the pinned set's characters, and LINE_EXTRA a note for its id, its
  // topic, who said it and the date. Notes written in plain words always fit. A note so full of "<" that its printed line does not is
  // left out of the block and counted with the notes found by recall; it stays pinned in the store.
  const LINE_EXTRA = 115; // "- [id] (", a topic of 40, ", after outside content", ", 2026-10-07", ", until 2026-10-11" and ") " are 107
  function forPrompt(owner) {
    endPast();
    const rest = q('SELECT topic FROM notes WHERE owner = ? AND pinned = 0').all(owner);
    const topics = [...new Set(rest.map((r) => r.topic).filter(Boolean))].slice(0, 12);
    const pinned = pinnedOf(owner);
    const lines = [];
    const ids = [];
    let room = PIN_LIMITS.chars + PIN_LIMITS.notes * LINE_EXTRA;
    for (const n of pinned) {
      const line = inert(noteLine(view(n)));
      if (line.length > room) continue;
      room -= line.length;
      lines.push(line);
      ids.push(n.id);
    }
    return {
      ids, // of the notes in `text`: a run keeps which pinned notes it was given
      text: lines.join('\n'),
      more: rest.length + (pinned.length - lines.length),
      topics: topics.map((t) => inert(t).slice(0, 40)),
    };
  }

  // Someone else wants to know when a note changes (the meaning-search index).
  let onChange = () => {};
  const setOnChange = (fn) => { onChange = fn; };

  // ---------- changes to the shared memory that wait for the owner ----------

  // source: who would be saying the new text, kept until the owner answers. guarded: a change or removal of what
  // the owner said, by a run the owner did not start or one that had read outside content (ADR 015). A change that
  // waits is guarded for as long as its note is the owner's, whenever the note became so (guardedNow).
  // A forget that waits (action 'erase', ADR 016) names notes and runs by their ids and holds no text; it is always guarded.
  function propose({ action, owner, noteId = null, text = '', topic = '', pinned = true, by = null, runId = null, botId = null, reason = '', source = 'bot', guarded = false, until = null, notes = [], runs = [] }) {
    if (action === 'erase') {
      const d = { notes: idList(notes), runs: idList(runs) };
      if (!d.notes.length && !d.runs.length) throw new Error('Say which notes or runs to forget, by their ids.');
      const detail = JSON.stringify(d);
      const asked = q("SELECT * FROM pending WHERE action = 'erase' AND COALESCE(bot_id, '') = ? AND detail = ?").get(botId || '', detail);
      if (asked) return pendingView(asked);
      const e = { id: crypto.randomUUID().slice(0, 8), action, owner, note_id: d.notes[0] || null, text: '', topic: '', pinned: 0, by, run_id: runId, bot_id: botId, reason: cleanText(reason).slice(0, 300), at: now(), source: sourceOf(source), guarded: 1, detail };
      q('INSERT INTO pending (id, action, owner, note_id, text, topic, pinned, by, run_id, bot_id, reason, at, source, guarded, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(e.id, e.action, e.owner, e.note_id, e.text, e.topic, e.pinned, e.by, e.run_id, e.bot_id, e.reason, e.at, e.source, e.guarded, e.detail);
      return pendingView(e);
    }
    // The end the change would set: a day; '' to take a note's end away; null to leave it as it is.
    const end = until === undefined || until === null ? null : String(until).trim() === '' ? '' : endDay(until);
    if (action === 'add' || action === 'edit') {
      text = cleanText(text);
      if (!text) throw new Error('The note is empty');
      if (text.length > MAX_NOTE_CHARS) throw new Error(`Keep a note under ${MAX_NOTE_CHARS} characters`);
    }
    if (action !== 'add' && !getNote(noteId)) throw new Error(`No note with id ${noteId}`);
    const key = sameKey(text, topic);
    const same = q('SELECT * FROM pending WHERE action = ? AND owner = ? AND COALESCE(note_id, \'\') = ?').all(action, owner, noteId || '').find((p) => sameKey(p.text, p.topic) === key);
    if (same) {
      // The same change asked again is still one card, and it keeps what the newer one says beside the text: an end
      // it gives, who would be saying it, and that it touches what the owner said. Two things are never loosened
      // by asking again: "after outside content" stays unless the owner says the sentence, as on a note (ADR 015),
      // and a guarded change stays guarded. The card stays the first asker's (`by`, `bot_id`, `run_id`); a run
      // that asks again is kept by its id (askersOf), so that a forget of the sentence leaves it out too.
      const src = sourceOf(same.source) === 'outside' && sourceOf(source) !== 'owner' ? 'outside' : sourceOf(source);
      const askers = [...new Set([...askersOf(same), runId].filter((r) => r && r !== same.run_id).map(String))];
      q('UPDATE pending SET source = ?, guarded = ?, until = ?, detail = ? WHERE id = ?').run(src, same.guarded || guarded ? 1 : 0, end === null ? same.until : end, askers.length ? JSON.stringify({ askers }) : same.detail, same.id);
      return pendingView(q('SELECT * FROM pending WHERE id = ?').get(same.id));
    }
    const p = { id: crypto.randomUUID().slice(0, 8), action, owner, note_id: noteId, text, topic: cleanText(topic).slice(0, 40), pinned: pinned ? 1 : 0, by, run_id: runId, bot_id: botId, reason: cleanText(reason).slice(0, 300), at: now(), source: sourceOf(source), guarded: guarded ? 1 : 0, until: end };
    q('INSERT INTO pending (id, action, owner, note_id, text, topic, pinned, by, run_id, bot_id, reason, at, source, guarded, until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, p.action, p.owner, p.note_id, p.text, p.topic, p.pinned, p.by, p.run_id, p.bot_id, p.reason, p.at, p.source, p.guarded, p.until);
    return pendingView(p);
  }
  // What a forget that waits would erase and leave out, as they stand now, for its card: nothing is approved unseen.
  function eraseView(p) {
    let d;
    try { d = JSON.parse(p.detail || '{}'); } catch { d = {}; }
    const notes = idList(d.notes).map((id) => { const n = view(getNote(id)); const gone = n ? null : removedNote(id); return n || (gone && { id, owner: gone.owner, text: gone.text, topic: gone.topic, source: gone.source, removed: true }); }).filter(Boolean);
    const runs = idList(d.runs).map((id) => { const r = getRun(id); return r ? { runId: id, at: r.at, asked: clip(r.asked, 240) } : { runId: id }; });
    const chats = runs.length ? `${runs.length} chat${runs.length === 1 ? '' : 's'}` : '';
    return { notes, runs, text: [...notes.map((n) => n.text), ...(chats ? [notes.length ? `and ${chats} left out` : `${chats}, left out of what bots read`] : [])].join(' · ') };
  }
  // Whether a waiting change touches what the owner said: it was asked for as such, or its note has become the
  // owner's while it waited (they said the same sentence, or changed the note themselves).
  const guardedNow = (p) => !!p.guarded || p.action === 'erase' || (p.action !== 'add' && !!p.note_id && sourceOf(getNote(p.note_id)?.source) === 'owner');
  const pendingView = (p) => p && ({ id: p.id, action: p.action, owner: p.owner, noteId: p.note_id, text: p.text, topic: p.topic, source: sourceOf(p.source), ...(p.until ? { until: p.until } : {}), ...(guardedNow(p) ? { guarded: true } : {}), by: p.by, runId: p.run_id, botId: p.bot_id, reason: p.reason, at: p.at, current: p.note_id ? view(getNote(p.note_id)) : null, ...(p.action === 'erase' ? eraseView(p) : {}) });
  const pending = () => q('SELECT * FROM pending ORDER BY at').all().map(pendingView);
  const getPending = (id) => pendingView(q('SELECT * FROM pending WHERE id = ?').get(String(id)));
  // The owner's answer. The change is made as whoever asked for it would have said it: a waiting change keeps its
  // source. A guarded change is to what the owner said, and the owner has now read and approved the new text: the
  // note stays the owner's.
  function settle(id, approve) {
    const p = q('SELECT * FROM pending WHERE id = ?').get(String(id));
    if (!p) throw new Error('That request is gone');
    // Every run that asked for it wrote the note it becomes (note_runs), the ones that asked again too.
    const done = (r) => { q('DELETE FROM pending WHERE id = ?').run(p.id); if (r?.note?.id && ['add', 'edit'].includes(p.action)) for (const run of askersOf(p)) wroteIn(r.note.id, run); return r; };
    if (!approve) return done({ declined: true });
    const source = sourceOf(p.source);
    // A day that has passed while the change waited is no end any more: the note would be removed the moment it is saved.
    const end = p.until && p.until < today() ? null : p.until;
    if (p.action === 'add') return done(addNote(p.owner, p.text, { by: p.by, runId: p.run_id, topic: p.topic, pinned: !!p.pinned, source, similarIn: [], until: end || null }));
    // The owner's yes to a forget: the notes it names are erased, and its runs left out with the run that asked.
    if (p.action === 'erase') { const d = eraseView(p); return done(erase({ notes: d.notes.map((n) => n.id), runs: [...d.runs.map((r) => r.runId), p.run_id].filter(Boolean) })); }
    if (!getNote(p.note_id)) { done(); throw new Error('That note was deleted in the meantime'); }
    // If the change can't be made (e.g. it doesn't fit the pinned notes), the request stays for the owner.
    if (p.action === 'edit') return done(changeNote(p.owner, p.note_id, p.text, { by: p.by, topic: p.topic || undefined, runId: p.run_id, reason: p.reason, source: guardedNow(p) ? undefined : source, until: end === null ? undefined : end }));
    return done({ note: removeNote(p.owner, p.note_id, { by: p.by, reason: p.reason }) });
  }

  const touch = (ids) => { const t = now(); for (const id of ids) q('UPDATE notes SET uses = uses + 1, used_at = ? WHERE id = ?').run(t, id); };

  // ---------- past runs ----------

  // cleaned: its rows in the search tables and its vectors are gone already (a rebuild that deleted many at once).
  function indexRun(meta, steps = [], { cleaned = false } = {}) {
    if (!meta || !meta.id || meta.status === 'running') return;
    const asked = meta.kind === 'script'
      ? `(the scheduled script job "${meta.jobName || ''}")`
      // A run that carries on with a request after the owner's OK (`continues` and no job, ADR 009) keeps that request.
      : (meta.customPrompt === false && !(meta.continues && !meta.jobId)) || !meta.prompt ? `(${meta.jobName ? `the scheduled job "${meta.jobName}"` : 'its main assignment'})` : clip(meta.prompt, 1500);
    // A quiet run (reporting.js finishReport) has no reply for the owner and keeps its own in rawResult: that
    // private reply is indexed, so the bot finds what it did, and the entry says that it was not sent (`quiet`).
    const said = String(meta.result || '').trim() ? String(meta.result) : '';
    const kept = meta.status === 'success' && !said && String(meta.rawResult || '').trim() ? String(meta.rawResult) : '';
    const whole = said || kept;
    const reply = meta.status === 'success' ? clip(whole, 6000) : clip(`(didn't finish: ${meta.status}) ${meta.error || ''}`, 600);
    const stepText = [...new Set(steps.filter(Boolean))].slice(0, 40).join('\n');
    // What it learned: kinds and note ids, never a note's text (learnedLine). A forgotten note is not found here.
    const learned = learnedLines(meta.learned);
    const before = q('SELECT asked, reply, learned, excluded FROM runs WHERE run_id = ?').get(meta.id);
    // Left out by a forget stays so through every rebuild: left_out keeps it, whatever the run's file says.
    const excluded = meta.forgotten || before?.excluded === FORGOTTEN || forgottenRun(meta.id) ? FORGOTTEN : meta.excludedFromMemory || before?.excluded ? 1 : 0;
    const parts = meta.status === 'success' && whole.length > SECTION ? sections(whole) : [];
    tx(() => {
      embedDirty = true;
      // A run that is new to the index has nothing in the search tables, and nothing is deleted for it: those
      // tables have no index on a run's id, so each delete reads every row (some 70 s per 10,000 runs, once).
      // That holds because a run leaves the index in one transaction (dropRun), and a start clears what an
      // older botdot left half-removed (backfill).
      if (before && !cleaned) {
        const oldParts = q('SELECT text FROM run_parts WHERE run_id = ? ORDER BY n').all(meta.id).map((p) => p.text);
        // Its vectors stay while what they were made from does (e.g. when the whole index is rebuilt).
        if (before.asked !== asked || before.reply !== reply || (before.learned || '') !== learned) { q("DELETE FROM embeddings WHERE kind = 'run' AND ref = ?").run(meta.id); forgetVectors(`run:${meta.id}`); }
        if (before.asked !== asked || oldParts.join('\n') !== parts.map((p) => p.text).join('\n')) { q("DELETE FROM embeddings WHERE kind = 'part' AND ref LIKE ?").run(`${meta.id}:%`); forgetVectors(`part:${meta.id}:`, true); }
        if (excluded === FORGOTTEN) q("DELETE FROM embeddings WHERE (kind = 'run' AND ref = ?) OR (kind = 'part' AND ref LIKE ?)").run(meta.id, `${meta.id}:%`);
        sweepDirty = true; // it may have fewer sections now
        q('DELETE FROM runs_fts WHERE run_id = ?').run(meta.id);
        q('DELETE FROM run_parts WHERE run_id = ?').run(meta.id);
        q('DELETE FROM parts_fts WHERE run_id = ?').run(meta.id);
      }
      parts.forEach((p, n) => {
        q('INSERT INTO run_parts (run_id, n, at, text) VALUES (?, ?, ?, ?)').run(meta.id, n, p.at, p.text);
        q('INSERT INTO parts_fts (run_id, n, text) VALUES (?, ?, ?)').run(meta.id, n, p.text);
      });
      q(`INSERT INTO runs (run_id, bot_id, bot_name, at, trigger, job, status, asked, reply, steps, learned, excluded, quiet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET bot_id = excluded.bot_id, bot_name = excluded.bot_name, at = excluded.at, trigger = excluded.trigger, job = excluded.job,
           status = excluded.status, asked = excluded.asked, reply = excluded.reply, steps = excluded.steps, learned = excluded.learned, excluded = MAX(runs.excluded, excluded.excluded), quiet = excluded.quiet`)
        .run(meta.id, meta.botId, meta.botName || '', meta.startedAt, meta.trigger || 'manual', meta.jobName || '', meta.status, asked, reply, stepText, learned, excluded, kept ? 1 : 0);
      q('INSERT INTO runs_fts (run_id, bot_id, asked, reply, steps, learned) VALUES (?, ?, ?, ?, ?, ?)').run(meta.id, meta.botId, asked, reply, stepText, learned);
    });
  }

  // A bot's runs since a date (for its memory review), newest first.
  const runsSince = (botId, since, limit = 25) => q('SELECT * FROM runs WHERE bot_id = ? AND excluded = 0 AND at > ? ORDER BY at DESC LIMIT ?').all(botId, since || '', limit).filter((r) => !leftOut(r));
  const countRunsSince = (botId, since) => q("SELECT COUNT(*) AS n FROM runs WHERE bot_id = ? AND excluded = 0 AND at > ? AND COALESCE(job, '') != 'Memory review'").get(botId, since || '').n;

  // The weekly memory review: when, and on which model.
  // Opus: the review also turns how-to notes into skills, which a light model does poorly.
  const REVIEW_DEFAULTS = { enabled: true, day: 0, time: '03:30', model: 'claude-opus-5-5', minRuns: 3 };
  function reviewSettings() {
    try {
      const { budget, ...s } = JSON.parse(getMeta('review') || '{}'); // budget: from when it had a spending cap
      if (s.model === 'haiku' && !s.picked) delete s.model; // Haiku was the old default, not a choice
      return { ...REVIEW_DEFAULTS, ...s };
    } catch { return { ...REVIEW_DEFAULTS }; }
  }
  function setReviewSettings(input = {}) {
    const s = reviewSettings();
    if (input.enabled !== undefined) s.enabled = !!input.enabled;
    if (input.day !== undefined) { const d = Number(input.day); if (!(d >= 0 && d <= 6)) throw new Error('Pick a day of the week'); s.day = d; }
    if (input.time !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time))) throw new Error('Time looks like 03:30'); s.time = String(input.time); }
    if (input.model !== undefined) s.model = /^[A-Za-z0-9][A-Za-z0-9.\-_:[\]]{0,80}$/.test(String(input.model)) ? String(input.model) : s.model;
    s.picked = true; // saved from Settings or by the Chief: the model is now the owner's choice
    setMeta('review', JSON.stringify(s));
    return s;
  }
  const lastReview = (botId) => getMeta(`review_at_${botId}`);
  const setLastReview = (botId, at) => setMeta(`review_at_${botId}`, at);

  const hasRun = (id) => !!q('SELECT 1 FROM runs WHERE run_id = ?').get(id);
  const getRun = (id) => q('SELECT * FROM runs WHERE run_id = ?').get(String(id)) || null;
  // The ids of a bot's newest runs of the job of that name, the newest first, runs that are left out among them:
  // the caller reads which one ended last and whether it may be handed on.
  const lastRunOfJob = (botId, job, limit = 5) => (job ? q('SELECT run_id FROM runs WHERE bot_id = ? AND job = ? ORDER BY at DESC, run_id DESC LIMIT ?').all(botId, String(job), limit).map((r) => r.run_id) : []);
  // The owner's "Don't recall", and its taking back. A run a forget left out stays left out: that mark is for good.
  function setExcluded(id, excluded) {
    const r = q('UPDATE runs SET excluded = ? WHERE run_id = ? AND excluded != ?').run(excluded ? 1 : 0, String(id), FORGOTTEN);
    embedDirty = true;
    return r.changes > 0;
  }
  // A run leaves the index, with its sections (their vectors are swept up by embedPending).
  // In one transaction: a run that is in no `runs` row has no row in a search table either (indexRun counts on it).
  function dropRun(id) {
    sweepDirty = true;
    tx(() => { for (const t of ['runs', 'runs_fts', 'run_parts', 'parts_fts']) q(`DELETE FROM ${t} WHERE run_id = ?`).run(id); });
  }
  // A deleted Chief chat: its replies leave the index (they're stored as "chief-<chatId>-<n>").
  function forgetChat(chatId) {
    const ids = q("SELECT run_id FROM runs WHERE bot_id = 'chief' AND run_id LIKE ?").all(`chief-${chatId}-%`).map((r) => r.run_id);
    for (const id of ids) dropRun(id);
    return ids.length;
  }
  function forgetRunsOfBot(botId) {
    for (const { run_id: id } of q('SELECT run_id FROM runs WHERE bot_id = ?').all(botId)) dropRun(id);
  }

  // Index every finished run and Chief reply that isn't in yet (e.g. the first start, a lost memory.db,
  // or after INDEX_VERSION changed). Runs older than the retention period stay out.
  // chiefReplies: the Chief's replies as run records ({ ...meta, steps }); replies of deleted chats leave.
  // saveExcluded(id): marks a run left out of recall in its own file, so that survives a rebuild too.
  // listRuns may give just { id, startedAt, status } of each run, with readMeta to read the ones not yet in.
  // botExists(id): a deleted bot's runs are not indexed, and those still in leave (ADR 016).
  // Returns how many were added; `rebuilt` gets how many entries were made again for a new INDEX_VERSION.
  function backfill({ listRuns, readMeta = null, readEvents, stepsOf, chiefReplies = null, saveExcluded = null, botExists = () => true, rebuilt = () => {} }) {
    if (saveExcluded && !getMeta('exclusions_saved')) {
      for (const { run_id: id } of q('SELECT run_id FROM runs WHERE excluded = 1').all()) { try { saveExcluded(id); } catch { /* its file is gone */ } }
      setMeta('exclusions_saved', now());
    }
    let had = getMeta('index_version');
    if (had === '3') {
      // From 3 to 4 (ADR 016): what a run learned was indexed as text, a note's among it. Only the entries that hold
      // such a text are made again, from their run's file, before anything is started: no reader meets a half-made
      // index. An entry whose file is gone loses the text. A second start finds the version and makes nothing again.
      const all = readMeta ? null : new Map(listRuns().map((r) => [r.id, r]));
      const held = q("SELECT run_id, steps FROM runs WHERE COALESCE(learned, '') != ''").all();
      for (const r of held) {
        let m = null;
        try { m = readMeta ? readMeta(r.run_id) : all.get(r.run_id); } catch { /* a damaged run file */ }
        if (m && m.status !== 'running') { try { indexRun(m, String(r.steps || '').split('\n')); continue; } catch { /* below */ } }
        tx(() => {
          q("UPDATE runs SET learned = '' WHERE run_id = ?").run(r.run_id);
          const row = getRun(r.run_id);
          q('DELETE FROM runs_fts WHERE run_id = ?').run(r.run_id);
          q('INSERT INTO runs_fts (run_id, bot_id, asked, reply, steps, learned) VALUES (?, ?, ?, ?, ?, ?)').run(row.run_id, row.bot_id, row.asked, row.reply, row.steps, '');
          q("DELETE FROM embeddings WHERE kind = 'run' AND ref = ?").run(r.run_id);
        });
      }
      setMeta('index_version', '4');
      rebuilt(held.length);
      had = '4';
    }
    if (had === '4') {
      // From 4 to 5: a quiet run was indexed without its reply. Only the entries of runs that ended well with no
      // reply are made again, from their run's file; one whose file is gone stays as it is. Their old rows leave
      // the search table in one statement: one read of that table, however many runs there are.
      const all = readMeta ? null : new Map(listRuns().map((r) => [r.id, r]));
      const again = [];
      for (const r of q("SELECT run_id, steps FROM runs WHERE status = 'success' AND COALESCE(reply, '') = '' AND bot_id != 'chief'").all()) {
        try {
          const m = readMeta ? readMeta(r.run_id) : all.get(r.run_id);
          if (m && m.status === 'success' && !String(m.result || '').trim() && String(m.rawResult || '').trim()) again.push([m, String(r.steps || '').split('\n')]);
        } catch { /* a damaged run file: its entry stays */ }
      }
      tx(() => {
        const ids = JSON.stringify(again.map(([m]) => m.id));
        for (const t of ['runs_fts', 'run_parts', 'parts_fts']) q(`DELETE FROM ${t} WHERE run_id IN (SELECT value FROM json_each(?))`).run(ids);
        q("DELETE FROM embeddings WHERE kind = 'run' AND ref IN (SELECT value FROM json_each(?))").run(ids);
        for (const [m, steps] of again) indexRun(m, steps, { cleaned: true });
        setMeta('index_version', INDEX_VERSION);
      });
      vectors = null;
    } else if (had !== INDEX_VERSION) {
      // All rebuilt from the run files and chats (version 2 changed the Chief's ids, version 3 added sections).
      tx(() => { db.exec("DELETE FROM runs_fts; DELETE FROM run_parts; DELETE FROM parts_fts; DELETE FROM runs WHERE bot_id = 'chief';"); setMeta('index_version', INDEX_VERSION); });
    }
    // A deleted bot's runs are in no index.
    for (const { bot_id: id } of q("SELECT DISTINCT bot_id FROM runs WHERE bot_id != 'chief'").all()) if (!botExists(id)) forgetRunsOfBot(id);
    const days = retentionDays();
    const cutoff = days ? new Date(Date.now() - days * 864e5).toISOString() : '';
    // What's in already, read once (the checks per run add up over years of runs).
    const inRuns = new Set(q('SELECT run_id FROM runs').all().map((r) => r.run_id));
    const inFts = new Set(q('SELECT run_id FROM runs_fts').all().map((r) => r.run_id));
    // Rows a botdot from before left in the search tables for a run it had half removed (it was stopped in
    // between): they go, or indexing that run again, which deletes nothing for a new run, would double them.
    for (const id of inFts) if (!inRuns.has(id)) { dropRun(id); inFts.delete(id); }
    const indexed = (id) => inRuns.has(id) && inFts.has(id);
    let added = 0;
    for (const e of listRuns()) {
      if (e.status === 'running' || (cutoff && (e.startedAt || '') < cutoff) || indexed(e.id) || (e.botId && !botExists(e.botId))) continue;
      try {
        const m = readMeta ? readMeta(e.id) : e;
        if (!m || m.status === 'running') continue;
        indexRun(m, stepsOf(readEvents(m.id)));
        added++;
      } catch { /* a damaged run file: skip it */ }
    }
    if (chiefReplies) {
      const alive = new Set();
      for (const m of chiefReplies()) {
        alive.add(m.id);
        if ((cutoff && (m.startedAt || '') < cutoff) || indexed(m.id)) continue;
        try { indexRun(m, m.steps || []); added++; } catch { /* skip it */ }
      }
      for (const { run_id: id } of q("SELECT run_id FROM runs WHERE bot_id = 'chief'").all()) {
        if (!alive.has(id)) dropRun(id);
      }
    }
    return added;
  }

  const retentionDays = () => Number(getMeta('retention_days') || 365);
  function setRetentionDays(days) {
    const d = Math.round(Number(days));
    if (!(d === 0 || (d >= 7 && d <= 3650))) throw new Error('Keep past runs searchable for 7 days to 10 years, or 0 for always');
    setMeta('retention_days', d);
    prune();
    return d;
  }
  // Past runs older than the retention period leave the index (their run files stay on the Activity page).
  // And what was removed leaves for good (ADR 016): a passing state past its end is removed, and a version that
  // stopped being true more than REMOVED_DAYS ago, a removed note among them, is in no table. at: the clock.
  function prune({ at = clock() } = {}) {
    const t = new Date(at).getTime();
    endPast(dayOf(new Date(t)));
    purgeRemoved(t);
    const days = retentionDays();
    if (!days) return 0;
    const cutoff = new Date(t - days * 864e5).toISOString();
    const old = q('SELECT run_id FROM runs WHERE at < ?').all(cutoff).map((r) => r.run_id);
    for (const id of old) dropRun(id);
    return old.length;
  }
  function purgeRemoved(t = clock().getTime()) {
    const cutoff = new Date(t - REMOVED_DAYS * 864e5).toISOString();
    const old = q('SELECT vid FROM note_versions WHERE valid_to < ?').all(cutoff);
    if (!old.length) return 0;
    tx(() => {
      for (const { vid } of old) {
        q('DELETE FROM note_versions WHERE vid = ?').run(vid);
        q('DELETE FROM versions_fts WHERE vid = ?').run(vid);
        q("DELETE FROM embeddings WHERE kind = 'old' AND ref = ?").run(String(vid));
        forgetVectors(`old:${vid}`);
      }
      // A note that is in no table any more has no runs to remember.
      q('DELETE FROM note_runs WHERE note_id NOT IN (SELECT id FROM notes) AND note_id NOT IN (SELECT note_id FROM note_versions)').run();
    });
    return old.length;
  }

  // ---------- search ----------

  const runItem = (r) => ({ runId: r.run_id, botId: r.bot_id, botName: r.bot_name, at: r.at, trigger: r.trigger, job: r.job, status: r.status, asked: clip(r.asked, 240), ...(r.quiet ? { notSent: true } : {}) });
  // Where a section is in its reply: which of how many, and the character it starts at (for read_run).
  const sectionOf = (runId, n, at) => ({ part: n + 1, parts: q('SELECT COUNT(*) AS c FROM run_parts WHERE run_id = ?').get(runId).c, from: at });

  // notesOf: note owners to search (e.g. [botId, '_shared']); runsOf: bot ids whose runs to search, or 'all'.
  // history: also earlier versions of notes (what was true before), ranked like current ones. Without it,
  // only what's true now.
  async function search(opts) {
    const { query, notesOf: owners = [], runsOf = [], kinds = ['notes', 'runs'], days = 0, history = false } = opts;
    return rank(opts, await semanticHits({ query, owners, runsOf, kinds, days, history })); // near: Map "kind:id" -> similarity, or empty
  }

  // One page of a search, with how many there are in all: { results, total, offset, limit }. limit: 25 at most.
  // With a query: the matches, best first; `total` counts what the search weighed (up to 40 notes, 60 runs and 10
  // earlier versions by words, and what meaning search adds). Without one: everything, in a fixed order that no
  // lookup changes: the notes, the newest change first, then the past runs, the newest first. Pages of it that
  // are read one after another hold each note once.
  async function page(opts) {
    const { query, notesOf: owners = [], runsOf = [], kinds = ['notes', 'runs'], days = 0, history = false } = opts;
    const limit = Math.min(Math.max(1, Math.floor(Number(opts.limit)) || 8), 25);
    const offset = Math.max(0, Math.floor(Number(opts.offset)) || 0);
    if (!String(query || '').trim()) return { ...everything({ owners, runsOf, kinds, days, limit, offset }), offset, limit };
    const all = ranked(opts, await semanticHits({ query, owners, runsOf, kinds, days, history }));
    return { results: all.slice(offset, offset + limit).map(({ kind, item }) => ({ kind, ...item })), total: all.length, offset, limit };
  }
  // Every note of `owners` and every past run of `runsOf` that is not left out, in the fixed order of page().
  function everything({ owners, runsOf, kinds, days, limit, offset }) {
    endPast();
    const since = days > 0 ? new Date(Date.now() - days * 864e5).toISOString() : '';
    const sinceArgs = since ? [since] : [];
    const noteWhere = kinds.includes('notes') && owners.length ? `n.owner IN (${owners.map(() => '?').join(',')}) ${since ? 'AND n.updated_at >= ?' : ''}` : null;
    const bots = runsOf === 'all' ? [] : runsOf;
    const runWhere = kinds.includes('runs') && (runsOf === 'all' || runsOf.length) ? `r.excluded = 0 ${runsOf === 'all' ? '' : `AND r.bot_id IN (${bots.map(() => '?').join(',')})`} ${since ? 'AND r.at >= ?' : ''}` : null;
    const notes = noteWhere ? q(`SELECT COUNT(*) AS c FROM notes n WHERE ${noteWhere}`).get(...owners, ...sinceArgs).c : 0;
    const runs = runWhere ? q(`SELECT COUNT(*) AS c FROM runs r WHERE ${runWhere}`).get(...bots, ...sinceArgs).c : 0;
    const results = [];
    if (noteWhere && offset < notes) {
      for (const n of q(`SELECT n.* FROM notes n WHERE ${noteWhere} ORDER BY n.updated_at DESC, n.id LIMIT ? OFFSET ?`).all(...owners, ...sinceArgs, limit, offset)) results.push({ kind: 'note', ...view(n) });
    }
    if (runWhere && results.length < limit) {
      for (const r of q(`SELECT r.* FROM runs r WHERE ${runWhere} ORDER BY r.at DESC, r.run_id LIMIT ? OFFSET ?`).all(...bots, ...sinceArgs, limit - results.length, Math.max(0, offset - notes))) results.push({ kind: 'run', ...runItem(r), excerpt: clip(r.reply, 300) });
    }
    return { results, total: notes + runs };
  }

  // The ranking itself, given what meaning search found (an empty Map: words alone). scores: keep each score.
  // removed: with history, also notes that were removed (no model is handed those unless a run the owner started asks).
  function rank({ limit = 8, scores = false, ...opts }, near) {
    return ranked(opts, near).slice(0, Math.min(Math.max(1, limit), 25)).map(({ kind, item, score }) => ({ kind, ...item, ...(scores ? { score } : {}) }));
  }
  // Everything the search weighs, best first: { kind, item, score, body } each. body: the text of a note or a run
  // that the words were found in, for counting them (the lookup).
  // words: how many of the query's words are looked for. skip: what is left out in the query itself, before any
  // limit: { pinned: true } the pinned notes, { runId } that run, { job } the runs of the job of that name.
  // runColumns: the columns of a past run the words are looked for in (all of them without it).
  function ranked({ query, notesOf: owners = [], runsOf = [], kinds = ['notes', 'runs'], days = 0, history = false, removed = false, words = 12, skip = null, runColumns = '' }, near) {
    endPast();
    const live = (v) => removed || !!getNote(v.note_id);
    const match = ftsQuery(query, words);
    const since = days > 0 ? new Date(Date.now() - days * 864e5).toISOString() : '';
    const results = [];
    // The clock is read once: read for each item, it moves on between two of them, and two searches order them differently.
    const at = Date.now();
    const recency = (iso) => { const age = (at - new Date(iso).getTime()) / 864e5; return Math.exp(-Math.max(0, age) / 90); };

    if (kinds.includes('notes') && owners.length) {
      const ph = owners.map(() => '?').join(',');
      const rows = match
        ? q(`SELECT n.*, bm25(notes_fts, 0, 0, 1.0, 0.6) AS rank FROM notes_fts JOIN notes n ON n.id = notes_fts.id
             WHERE notes_fts MATCH ? AND notes_fts.owner IN (${ph}) ${since ? 'AND n.updated_at >= ?' : ''} ${skip?.pinned ? 'AND n.pinned = 0' : ''} ORDER BY rank LIMIT 40`).all(match, ...owners, ...(since ? [since] : []))
        : q(`SELECT n.*, 0 AS rank FROM notes n WHERE n.owner IN (${ph}) ${since ? 'AND n.updated_at >= ?' : ''} ${skip?.pinned ? 'AND n.pinned = 0' : ''} ORDER BY n.updated_at DESC LIMIT 20`).all(...owners, ...(since ? [since] : []));
      // Pinned and often-recalled notes rank a little higher.
      for (const r of rows) results.push({ kind: 'note', rel: -r.rank, rec: recency(r.updated_at), boost: (r.pinned ? 0.1 : 0) + 0.05 * Math.min(r.uses || 0, 10) / 10, item: view(r), body: `${r.topic || ''} ${r.text}` });
      // Earlier versions ("where did the owner live before?"), dated, when asked for.
      if (match && history) {
        const old = q(`SELECT v.*, bm25(versions_fts, 0, 0, 1.0) AS rank FROM versions_fts JOIN note_versions v ON v.vid = versions_fts.vid
                       WHERE versions_fts MATCH ? AND v.owner IN (${ph}) ${since ? 'AND v.valid_to >= ?' : ''} ORDER BY rank LIMIT 10`).all(match, ...owners, ...(since ? [since] : []));
        for (const v of old) if (live(v)) results.push({ kind: 'old', rel: -v.rank, rec: recency(v.valid_to), boost: 0, item: versionView(v) });
      }
    }
    if (kinds.includes('runs') && (runsOf === 'all' || runsOf.length)) {
      // What is left out goes in the query itself, before its limit: a run that is left out (excluded: the owner's
      // mark, and a forget's), and for the lookup the run that asks and the runs of its own job.
      const botFilter = `${runsOf === 'all' ? '' : `AND r.bot_id IN (${runsOf.map(() => '?').join(',')})`} ${skip?.runId ? 'AND r.run_id != ?' : ''} ${skip?.job ? "AND COALESCE(r.job, '') != ?" : ''}`;
      const args = [...(runsOf === 'all' ? [] : runsOf), ...(skip?.runId ? [String(skip.runId)] : []), ...(skip?.job ? [String(skip.job)] : []), ...(since ? [since] : [])];
      const rows = match
        ? q(`SELECT r.*, bm25(runs_fts, 0, 0, 2.0, 1.0, 0.6, 1.2) AS rank, snippet(runs_fts, -1, '«', '»', '…', 28) AS snip
             FROM runs_fts JOIN runs r ON r.run_id = runs_fts.run_id
             WHERE runs_fts MATCH ? AND r.excluded = 0 ${botFilter} ${since ? 'AND r.at >= ?' : ''} ORDER BY rank LIMIT 60`).all(runColumns ? `{${runColumns}} : (${match})` : match, ...args)
        : q(`SELECT r.*, 0 AS rank, '' AS snip FROM runs r WHERE r.excluded = 0 ${botFilter} ${since ? 'AND r.at >= ?' : ''} ORDER BY r.at DESC LIMIT 20`).all(...args);
      // The best matching section of each long reply: it can match what the start of the reply doesn't.
      const best = new Map();
      if (match) {
        const parts = q(`SELECT p.run_id, p.n, p.at AS pos, p.text AS body, bm25(parts_fts, 0, 0, 1.0) AS rank, snippet(parts_fts, 2, '«', '»', '…', 40) AS snip
                         FROM parts_fts JOIN run_parts p ON p.run_id = parts_fts.run_id AND p.n = CAST(parts_fts.n AS INTEGER) JOIN runs r ON r.run_id = p.run_id
                         WHERE parts_fts MATCH ? AND r.excluded = 0 ${botFilter} ${since ? 'AND r.at >= ?' : ''} ORDER BY rank LIMIT 80`).all(match, ...args);
        for (const p of parts) if (!best.has(p.run_id)) best.set(p.run_id, p);
      }
      const seen = new Set(rows.map((r) => r.run_id));
      for (const id of best.keys()) if (!seen.has(id)) rows.push({ ...getRun(id), rank: 0, snip: '' });
      for (const r of rows) {
        if (leftOut(r)) continue;
        const p = best.get(r.run_id);
        const fromPart = p && -p.rank >= -r.rank;
        results.push({
          kind: 'run', rel: Math.max(-r.rank, p ? -p.rank : 0), rec: recency(r.at), boost: 0,
          item: { ...runItem(r), excerpt: fromPart ? p.snip : r.snip || clip(r.reply, 300), ...(fromPart ? sectionOf(r.run_id, p.n, p.pos) : {}) },
          body: `${saidOf(r)} ${p ? p.body : ''}`,
        });
      }
    }
    // Items only meaning-search found (e.g. "went down" for "crashed") join in.
    if (near.size) {
      const have = new Set(results.map((x) => `${x.kind}:${x.kind === 'run' ? x.item.runId : x.kind === 'old' ? x.item.vid : x.item.id}`));
      for (const [key, sim] of near) {
        if (have.has(key)) continue;
        const [kind, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        if (kind === 'note') { const n = getNote(ref); if (n) results.push({ kind: 'note', rel: 0, rec: recency(n.updated_at), boost: n.pinned ? 0.1 : 0, item: view(n), body: `${n.topic || ''} ${n.text}` }); }
        if (kind === 'old') { const v = q('SELECT * FROM note_versions WHERE vid = ?').get(Number(ref)); if (v && live(v)) results.push({ kind: 'old', rel: 0, rec: recency(v.valid_to), boost: 0, item: versionView(v) }); }
        if (kind === 'run') {
          const r = getRun(ref);
          const p = near.parts?.get(ref);
          if (r && !leftOut(r)) results.push({ kind: 'run', rel: 0, rec: recency(r.at), boost: 0, item: { ...runItem(r), excerpt: p ? clip(p.text, 600) : clip(r.reply, 300), ...(p ? sectionOf(r.run_id, p.n, p.at) : {}) } });
        }
      }
    }
    // Relevance first, then how recent, then pins. Notes and runs are scored against their own kind
    // (long runs would otherwise crowd out short notes), and notes, being chosen on purpose, get a head start.
    // Without a query: newest first.
    const top = { note: 1e-9, run: 1e-9, old: 1e-9 };
    for (const x of results) top[x.kind] = Math.max(top[x.kind], x.rel);
    // Each kind against its own best: their word scores come from different indexes (the versions index is
    // small, so its scores run low and would put every earlier version below every current note).
    const norm = (x) => x.rel / top[x.kind];
    // How well it matches (meaning and words together, when meaning search is on), then scaled up a
    // little for recent, pinned, often-used notes, so those extras never lift a weak match.
    const sim = (x) => near.get(`${x.kind}:${x.kind === 'run' ? x.item.runId : x.kind === 'old' ? x.item.vid : x.item.id}`) || 0;
    const kindBonus = (x) => (x.kind === 'run' ? 0 : 0.1); // notes and their versions were chosen on purpose
    const relevance = (x) => (near.size ? 0.6 * sim(x) + 0.4 * (x.rel ? norm(x) : 0) : norm(x));
    const scored = results.map((x) => ({
      ...x,
      score: !match && !near.size ? x.rec + x.boost : relevance(x) * (1 + 0.3 * x.rec + x.boost + kindBonus(x)),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  // The lookup (CONTEXT.md): a few memories that fit a run's request, for its prompt, next to the pinned notes.
  // - Every distinct meaningful word of the request is looked for, up to LOOKUP.words.
  // - Left out in the query itself, before any limit: pinned notes (already in the prompt), the run that asks, a
  //   job's own earlier runs (it would only repeat itself; it is handed its last run instead) and runs that are
  //   left out. Removed notes are in no table the lookup reads.
  // - With meaning search on, notes are also compared by meaning, under LOOKUP.embedMs; past runs by words only.
  // - The floor: an item is kept when it holds two of the request's words, or one that is rare in this bot's
  //   memory (LOOKUP.rare), or, for a note, when it is close to the request by meaning and stands out among the
  //   bot's notes (LOOKUP.similar and standsOut). Small talk brings nothing.
  // - Up to LOOKUP.notes notes come first, then up to LOOKUP.runs runs, within `limit` items and `chars`
  //   characters as `print` prints them. A newer note that holds the same words of the request stands before an
  //   older one; when it is cut, for want of a place or of room, no older note takes its place, and the run it
  //   may have corrected arrives only beside another note that corrects it.
  async function relevantFor({ botId, text, runId = null, job = '', limit = 5, chars = 1500, print = lookupLine }) {
    const words = meaningful(text).slice(0, LOOKUP.words);
    const owners = [botId, SHARED];
    const near = await within(LOOKUP.embedMs, semanticHits({ query: clip(text, LOOKUP.embedChars), owners, runsOf: [], kinds: ['notes'], days: 0, unpinned: true, lookup: true, timeoutMs: LOOKUP.embedMs }), new Map());
    if (!words.length && !near.size) return [];
    // A word of the request is rare when few of this bot's notes and past runs hold it.
    const rarity = new Map();
    const rare = (w) => {
      if (!rarity.has(w)) {
        const most = LOOKUP.rare + 1;
        const inNotes = q('SELECT COUNT(*) AS c FROM (SELECT 1 FROM notes_fts WHERE notes_fts MATCH ? AND owner IN (?, ?) LIMIT ?)').get(ftsWord(w), botId, SHARED, most).c;
        const inRuns = inNotes >= most ? 0 : q(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM runs_fts JOIN runs r ON r.run_id = runs_fts.run_id WHERE runs_fts MATCH ? AND r.bot_id = ? AND r.excluded = 0 LIMIT ?)`).get(`{${LOOKUP_COLUMNS}} : (${ftsWord(w)})`, botId, most).c;
        rarity.set(w, inNotes + inRuns <= LOOKUP.rare);
      }
      return rarity.get(w);
    };
    const key = (x) => `${x.kind}:${x.kind === 'run' ? x.item.runId : x.item.id}`;
    const hits = ranked({ query: text, notesOf: owners, runsOf: [botId], words: LOOKUP.words, skip: { pinned: true, runId, job }, runColumns: LOOKUP_COLUMNS }, near)
      .map((x) => ({ ...x, held: wordsIn(words, x.body), at: x.item.at || '' }))
      .filter((x) => x.held.length >= 2 || (x.held.length === 1 && rare(x.held[0])) || (x.kind === 'note' && !!near.fits?.has(key(x))));
    // "The same words, said later": a note that is newer than `b` and holds every word of the request that `b` holds.
    const corrects = (a, b) => a.kind === 'note' && b.held.length > 0 && a.at > b.at && b.held.every((w) => a.held.includes(w));
    // Such a note stands before the note it may correct, so the slots and the budget reach it first. (No circle:
    // each is newer than the one it corrects.)
    const notes = [];
    const placed = new Set();
    const place = (b) => {
      if (placed.has(b)) return;
      placed.add(b);
      for (const a of hits) if (a.kind === 'note' && !placed.has(a) && corrects(a, b)) place(a);
      notes.push(b);
    };
    for (const x of hits) if (x.kind === 'note') place(x);
    const out = [];
    const kept = []; // the notes that are handed over
    const cut = []; // the notes that are not: no place among the three, or no room in the budget
    const tight = []; // those of them the budget had no room for
    let used = 0;
    const fits = (x) => {
      const item = { kind: x.kind, ...x.item };
      const size = inert(print(item)).length + 1; // as it is printed, with its line break
      if (out.length >= limit || used + size > chars) return false;
      used += size;
      out.push(item);
      return true;
    };
    // Notes have their own places and stand first: no run ever takes a note's. A note the budget has no room
    // for is cut, and what it may correct is cut with it: a smaller, older note does not take its place.
    for (const x of notes) {
      if (kept.length < LOOKUP.notes && !tight.some((a) => corrects(a, x)) && fits(x)) { kept.push(x); continue; }
      if (kept.length < LOOKUP.notes) tight.push(x);
      cut.push(x);
    }
    // A run whose correction was cut does not arrive without it: it is handed over only when no cut note
    // corrects it, or a note that does is among those handed over.
    let runs = 0;
    for (const x of hits) {
      if (x.kind !== 'run' || runs >= LOOKUP.runs) continue;
      if (cut.some((a) => corrects(a, x)) && !kept.some((a) => corrects(a, x))) continue;
      if (fits(x)) runs++;
    }
    return out;
  }

  // The owner's search box: what was asked and replied in every chat (runs and the Chief's replies), runs left out
  // of recall too. Every word must match (the last one may be half typed); the best matches, then the newest.
  function searchChats(query, limit = 20) {
    const match = ftsQuery(query).split(' OR ').filter(Boolean).join(' AND ');
    if (!match) return [];
    const rows = q(`SELECT r.run_id, r.bot_id, r.bot_name, r.at, r.trigger, snippet(runs_fts, -1, '«', '»', '…', 16) AS snip, bm25(runs_fts, 0, 0, 1.0, 1.0, 0, 0) AS rank
              FROM runs_fts JOIN runs r ON r.run_id = runs_fts.run_id WHERE runs_fts MATCH ? ORDER BY rank LIMIT 200`).all(`{asked reply} : (${match})`);
    // Replies longer than what the index keeps whole: their sections, after the matches above.
    const seen = new Set(rows.map((r) => r.run_id));
    for (const r of q(`SELECT r.run_id, r.bot_id, r.bot_name, r.at, r.trigger, snippet(parts_fts, 2, '«', '»', '…', 16) AS snip
                       FROM parts_fts JOIN runs r ON r.run_id = parts_fts.run_id WHERE parts_fts MATCH ? ORDER BY bm25(parts_fts, 0, 0, 1.0) LIMIT 200`).all(`{text} : (${match})`)) {
      if (!seen.has(r.run_id)) { seen.add(r.run_id); rows.push(r); }
    }
    return rows
      .map((r, i) => ({ ...r, score: 1 / (1 + i / 10) + Math.exp(-(Date.now() - Date.parse(r.at)) / 864e5 / 30) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => ({ runId: r.run_id, botId: r.bot_id, botName: r.bot_name, at: r.at, trigger: r.trigger, snippet: r.snip }));
  }

  // ---------- meaning-based search (optional; llama.cpp's llama-server with bge-m3, see embed.js) ----------
  // Off by default outside the Docker image (semanticDefault). Vectors are made in the background; search falls
  // back to words alone whenever the embedding server isn't ready.
  const embedder = require('./embed').create(dataDir);
  // Vectors from another model (e.g. the earlier Ollama setup) can't be compared: drop them.
  q('DELETE FROM embeddings WHERE model != ?').run(embedder.MODEL_NAME);
  // On or off is the owner's choice once they made one. Until then it is on where botdot was given both the
  // program and the model, as its Docker image does (EMBED_SERVER_BIN and EMBED_MODEL_FILE), and off elsewhere.
  const semanticDefault = () => !!(process.env.EMBED_SERVER_BIN && process.env.EMBED_MODEL_FILE);
  const semanticSettings = () => { try { return { enabled: semanticDefault(), ...JSON.parse(getMeta('semantic') || '{}') }; } catch { return { enabled: semanticDefault() }; } };
  function setSemanticSettings(input = {}) {
    const s = { enabled: input.enabled === undefined ? semanticSettings().enabled : !!input.enabled };
    setMeta('semantic', JSON.stringify(s));
    embedDirty = true;
    embedder.want(s.enabled).catch((e) => { semLast = { ok: false, error: e.message, at: now() }; });
    return s;
  }
  if (semanticSettings().enabled) embedder.want(true).catch((e) => { semLast = { ok: false, error: e.message, at: now() }; });

  const embed = (texts, kind, timeoutMs) => embedder.embed(texts, timeoutMs);
  const toBlob = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength);
  const fromBlob = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };

  let semLast = { ok: null, error: null, at: null };
  // What still needs doing, so the check every few seconds does nothing when nothing changed:
  // embedDirty: something may lack a vector; sweepDirty: something was removed, its vector may be left over.
  let embedDirty = true;
  let sweepDirty = true;

  // The vectors, kept in memory once meaning search has been used ("kind:ref" -> Float32Array, or null for none).
  let vectors = null;
  function vectorOf(kind, ref) {
    if (!vectors) {
      vectors = new Map();
      for (const r of q('SELECT kind, ref, vec FROM embeddings').all()) vectors.set(`${r.kind}:${r.ref}`, fromBlob(r.vec));
    }
    const key = `${kind}:${ref}`;
    if (!vectors.has(key)) { const r = q('SELECT vec FROM embeddings WHERE kind = ? AND ref = ?').get(kind, String(ref)); vectors.set(key, r ? fromBlob(r.vec) : null); }
    return vectors.get(key);
  }
  // Drop kept vectors: one key, or (prefix) every key starting with it.
  function forgetVectors(key, prefix = false) {
    if (!vectors) return;
    if (!prefix) { vectors.delete(key); return; }
    for (const k of vectors.keys()) if (k.startsWith(key)) vectors.delete(k);
  }
  // The text a note's or run's vector is made from, or null when it's gone or left out of recall.
  function embedText(kind, ref) {
    if (kind === 'note') { const n = q('SELECT text, topic FROM notes WHERE id = ?').get(ref); return n ? `${n.topic ? `${n.topic}: ` : ''}${n.text}` : null; }
    if (kind === 'old') { const v = q('SELECT text, topic FROM note_versions WHERE vid = ?').get(Number(ref)); return v ? `${v.topic ? `${v.topic}: ` : ''}${v.text}` : null; }
    if (kind === 'part') {
      const i = ref.lastIndexOf(':');
      const p = q('SELECT p.text, r.asked FROM run_parts p JOIN runs r ON r.run_id = p.run_id WHERE p.run_id = ? AND p.n = ? AND r.excluded = 0').get(ref.slice(0, i), Number(ref.slice(i + 1)));
      return p ? `${clip(p.asked, 200)}\n${p.text}` : null; // what was asked, for context
    }
    const r = q('SELECT asked, reply, learned FROM runs WHERE run_id = ? AND excluded = 0').get(ref);
    return r ? clip(`${r.asked}\n${r.reply}\n${r.learned || ''}`, 2000) : null;
  }
  // Embed what's missing, a batch at a time (called every few seconds while it's on).
  let embedding = false;
  async function embedPending(batch = 8) {
    if (!semanticSettings().enabled || embedding || (!embedDirty && !sweepDirty) || !(await embedder.ready())) return 0;
    embedding = true;
    try {
      // Vectors of notes, runs and sections that are gone (deleted, pruned, a removed bot's).
      if (sweepDirty) {
        sweepDirty = false;
        q(`DELETE FROM embeddings WHERE (kind = 'note' AND ref NOT IN (SELECT id FROM notes)) OR (kind = 'run' AND ref NOT IN (SELECT run_id FROM runs))
             OR (kind = 'part' AND ref NOT IN (SELECT run_id || ':' || n FROM run_parts)) OR (kind = 'old' AND ref NOT IN (SELECT CAST(vid AS TEXT) FROM note_versions))`).run();
        vectors = null;
      }
      if (!embedDirty) return 0;
      const notes = q("SELECT n.id FROM notes n LEFT JOIN embeddings e ON e.kind = 'note' AND e.ref = n.id WHERE e.ref IS NULL LIMIT ?").all(batch);
      const runs = q("SELECT r.run_id FROM runs r LEFT JOIN embeddings e ON e.kind = 'run' AND e.ref = r.run_id WHERE e.ref IS NULL AND r.excluded = 0 ORDER BY r.at DESC LIMIT ?").all(batch);
      const parts = q("SELECT p.run_id || ':' || p.n AS ref FROM run_parts p JOIN runs r ON r.run_id = p.run_id LEFT JOIN embeddings e ON e.kind = 'part' AND e.ref = p.run_id || ':' || p.n WHERE e.ref IS NULL AND r.excluded = 0 ORDER BY r.at DESC, p.n LIMIT ?").all(batch);
      const olds = q("SELECT v.vid FROM note_versions v LEFT JOIN embeddings e ON e.kind = 'old' AND e.ref = CAST(v.vid AS TEXT) WHERE e.ref IS NULL ORDER BY v.vid DESC LIMIT ?").all(batch);
      const items = [...notes.map((n) => ({ kind: 'note', ref: n.id })), ...olds.map((v) => ({ kind: 'old', ref: String(v.vid) })), ...runs.map((r) => ({ kind: 'run', ref: r.run_id })), ...parts.map((p) => ({ kind: 'part', ref: p.ref }))];
      for (const i of items) i.text = embedText(i.kind, i.ref);
      if (!items.length) { embedDirty = false; semLast = { ok: true, error: null, at: now() }; return 0; }
      const vecs = await embed(items.map((i) => i.text), 'doc', 120_000);
      // Only what hasn't changed (or gone, or been left out) while its vector was being made.
      const kept = items.map((it, i) => [it, vecs[i]]).filter(([it]) => embedText(it.kind, it.ref) === it.text);
      tx(() => { for (const [it, vec] of kept) q('INSERT OR REPLACE INTO embeddings (kind, ref, model, vec) VALUES (?, ?, ?, ?)').run(it.kind, it.ref, embedder.MODEL_NAME, toBlob(vec)); });
      for (const [it, vec] of kept) vectors?.set(`${it.kind}:${it.ref}`, Float32Array.from(vec));
      semLast = { ok: true, error: null, at: now() };
      return kept.length;
    } catch (e) {
      semLast = { ok: false, error: e.message, at: now() };
      return 0;
    } finally { embedding = false; }
  }

  // Map "kind:id" -> similarity (0..1) for the best matches by meaning, or an empty map.
  const SIM_MIN = 0.5; // bge-m3: below this it's usually unrelated
  // unpinned: only notes that are not pinned (the lookup: left out here, before the limit). timeoutMs: how long
  // the embedding server may take with the query. lookup: the result also gets `fits`, the keys of the notes that
  // are close enough to the request by meaning alone (LOOKUP.similar, standsOut and pool).
  async function semanticHits({ query, owners, runsOf, kinds, days, history = false, unpinned = false, lookup = false, timeoutMs = 4000 }) {
    const out = new Map();
    if (!semanticSettings().enabled || !String(query || '').trim() || !(await embedder.ready())) return out;
    let qv;
    try { [qv] = await embed([String(query)], 'query', timeoutMs); } catch (e) { semLast = { ok: false, error: e.message, at: now() }; return out; }
    const since = days > 0 ? new Date(Date.now() - days * 864e5).toISOString() : '';
    const sim = (kind, ref) => { const v = vectorOf(kind, ref); return v ? dot(qv, v) : 0; };
    const keep = (rows, kind) => rows.map((r) => [`${kind}:${r.ref}`, sim(kind, r.ref)]).filter(([, v]) => v >= SIM_MIN).sort((a, b) => b[1] - a[1]).slice(0, 30);
    if (kinds.includes('notes') && owners.length) {
      const all = q(`SELECT e.ref, n.pinned FROM embeddings e JOIN notes n ON e.kind = 'note' AND n.id = e.ref WHERE n.owner IN (${owners.map(() => '?').join(',')}) ${since ? 'AND n.updated_at >= ?' : ''}`).all(...owners, ...(since ? [since] : []));
      const kept = keep(unpinned ? all.filter((r) => !r.pinned) : all, 'note');
      for (const [k, v] of kept) out.set(k, v);
      if (lookup) {
        // How close the request is to this bot's notes on average, the pinned ones among them: what a note has to stand out from.
        const average = all.length >= LOOKUP.pool ? all.reduce((sum, r) => sum + sim('note', r.ref), 0) / all.length : null;
        out.fits = new Set(kept.filter(([, v]) => (average === null ? v >= LOOKUP.similar + LOOKUP.standsOut : v >= LOOKUP.similar && v - average >= LOOKUP.standsOut)).map(([k]) => k));
      }
      if (history) {
        const old = q(`SELECT e.ref FROM embeddings e JOIN note_versions v ON e.kind = 'old' AND e.ref = CAST(v.vid AS TEXT) WHERE v.owner IN (${owners.map(() => '?').join(',')}) ${since ? 'AND v.valid_to >= ?' : ''}`).all(...owners, ...(since ? [since] : []));
        for (const [k, v] of keep(old, 'old')) out.set(k, v);
      }
    }
    if (kinds.includes('runs') && (runsOf === 'all' || runsOf.length)) {
      const filter = runsOf === 'all' ? '' : `AND r.bot_id IN (${runsOf.map(() => '?').join(',')})`;
      const rows = q(`SELECT e.ref FROM embeddings e JOIN runs r ON e.kind = 'run' AND r.run_id = e.ref WHERE r.excluded = 0 ${filter} ${since ? 'AND r.at >= ?' : ''}`).all(...(runsOf === 'all' ? [] : runsOf), ...(since ? [since] : []));
      for (const [k, v] of keep(rows, 'run')) out.set(k, v);
      // Sections of long replies count for their run; out.parts keeps the best one, for its excerpt.
      out.parts = new Map();
      const parts = q(`SELECT e.ref, p.run_id, p.n, p.at, p.text FROM embeddings e JOIN run_parts p ON e.kind = 'part' AND e.ref = p.run_id || ':' || p.n JOIN runs r ON r.run_id = p.run_id
                       WHERE r.excluded = 0 ${filter} ${since ? 'AND r.at >= ?' : ''}`).all(...(runsOf === 'all' ? [] : runsOf), ...(since ? [since] : []));
      for (const p of parts) {
        const v = sim('part', p.ref);
        if (v < SIM_MIN || v <= (out.parts.get(p.run_id)?.sim ?? 0)) continue;
        out.parts.set(p.run_id, { n: p.n, at: p.at, text: p.text, sim: v });
        if (v > (out.get(`run:${p.run_id}`) || 0)) out.set(`run:${p.run_id}`, v);
      }
    }
    return out;
  }

  async function semanticStatus() {
    const counts = {
      // Only vectors of what recall can find (a left-out run keeps its vector, for when it's back in).
      done: q("SELECT COUNT(*) AS n FROM embeddings e JOIN notes n ON e.kind = 'note' AND n.id = e.ref").get().n
        + q("SELECT COUNT(*) AS n FROM embeddings e JOIN runs r ON e.kind = 'run' AND r.run_id = e.ref WHERE r.excluded = 0").get().n
        + q("SELECT COUNT(*) AS n FROM embeddings e JOIN run_parts p ON e.kind = 'part' AND e.ref = p.run_id || ':' || p.n JOIN runs r ON r.run_id = p.run_id WHERE r.excluded = 0").get().n
        + q("SELECT COUNT(*) AS n FROM embeddings e JOIN note_versions v ON e.kind = 'old' AND e.ref = CAST(v.vid AS TEXT)").get().n,
      total: q('SELECT COUNT(*) AS n FROM notes').get().n + q('SELECT COUNT(*) AS n FROM runs WHERE excluded = 0').get().n
        + q('SELECT COUNT(*) AS n FROM run_parts p JOIN runs r ON r.run_id = p.run_id WHERE r.excluded = 0').get().n + q('SELECT COUNT(*) AS n FROM note_versions').get().n,
    };
    return { ...semanticSettings(), ...counts, ...(await embedder.status()), last: semLast };
  }

  // Download the model (only when the owner clicks it); botdot's Docker image already has it.
  const pullModel = () => embedder.download();

  // Notes that change get a fresh vector.
  const dropNoteVector = (id) => { q("DELETE FROM embeddings WHERE kind = 'note' AND ref = ?").run(id); forgetVectors(`note:${id}`); embedDirty = true; };

  const stats = () => ({
    runs: q('SELECT COUNT(*) AS n FROM runs WHERE excluded = 0').get().n,
    excluded: q('SELECT COUNT(*) AS n FROM runs WHERE excluded = 1').get().n,
    oldest: q('SELECT MIN(at) AS at FROM runs').get().at,
    retentionDays: retentionDays(),
  });

  // ---------- moving over from the old memory files (data/learning/<bot>.json) ----------

  function migrateFrom(learningDir) {
    if (getMeta('migrated_learning')) return 0;
    let moved = 0;
    const files = fs.existsSync(learningDir) ? fs.readdirSync(learningDir).filter((f) => f.endsWith('.json')) : [];
    const backup = path.join(learningDir, 'before-memory-db');
    for (const f of files) {
      const file = path.join(learningDir, f);
      let d;
      try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      if (!Array.isArray(d.memory) || !d.memory.length) continue;
      const owner = f.slice(0, -5);
      fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
      fs.copyFileSync(file, path.join(backup, f));
      for (const n of d.memory) {
        try { addNote(owner, n.text, { by: n.by || 'bot', runId: n.runId || null, id: n.id, createdAt: n.at, pinned: true, source: n.by === 'you' ? 'owner' : 'bot' }); moved++; } catch { /* skip a bad note */ }
      }
      delete d.memory; // the history of task/rules/skill changes stays in the file
      fs.writeFileSync(file, JSON.stringify(d, null, 2));
    }
    setMeta('migrated_learning', now());
    return moved;
  }

  // ---------- who said the notes from before (ADR 015) ----------

  // Once, at the first start with a source: every note, version and waiting change that has none gets one.
  // The owner where the owner typed it; otherwise by the run that saved it, where that run's file still exists
  // (sourceOfRun(runId, text, noteId) answers 'owner', 'bot' or 'outside', or null when it cannot tell); otherwise the bot.
  // A second start finds none without a source and changes nothing. Returns how many it set.
  function backfillSources(sourceOfRun = () => null) {
    if (getMeta('sources_at')) return 0;
    const said = (r) => {
      if (r.by === 'you') return 'owner';
      let s = null;
      try { s = r.run_id ? sourceOfRun(r.run_id, r.text, r.note) : null; } catch { /* a damaged run file: it cannot tell */ }
      return SOURCES.includes(s) ? s : 'bot';
    };
    return tx(() => {
      let set = 0;
      for (const [table, key, note] of [['notes', 'id', 'id'], ['note_versions', 'vid', 'note_id'], ['pending', 'id', 'note_id']]) {
        for (const r of q(`SELECT ${key} AS k, ${note} AS note, by, run_id, text FROM ${table} WHERE source IS NULL`).all()) { q(`UPDATE ${table} SET source = ? WHERE ${key} = ?`).run(said(r), r.k); set++; }
      }
      setMeta('sources_at', now());
      return set;
    });
  }

  onChange = dropNoteVector; // a changed or deleted note loses its old vector
  completeErases(); // an erase botdot was stopped in the middle of (ADR 016), before anything reads

  return {
    addNote, editNote, changeNote, setPinned, pinNote, removeNote, removeOwner, history, deletedOf, removedOf, countRemoved, removedNote, restore, propose, pending, getPending, settle, backfillSources, setOnChange, getMeta, setMeta, getNote: (id) => view(getNote(id)), notesOf: (owner) => { endPast(); return notesOf(owner).map(view); }, countNotes, forPrompt, touch,
    restoreNote, erase, completeErases, leftOut, renameRun, forgottenRun, forgottenRuns, forgottenNote, stillMatching, endPast, purgeRemoved,
    indexRun, getRun, setExcluded, forgetRunsOfBot, forgetChat, runsSince, countRunsSince, reviewSettings, setReviewSettings, lastReview, setLastReview, backfill, prune, retentionDays, setRetentionDays,
    snapshot: (file) => db.exec(`VACUUM INTO '${String(file).replace(/'/g, "''")}'`), // a consistent copy, for backups
    search, page, lastRunOfJob, searchChats, relevantFor, stats, migrateFrom, semanticSettings, setSemanticSettings, semanticStatus, embedPending, pullModel, dropNoteVector, PIN_LIMITS, MAX_NOTE_CHARS, SHARED,
  };
}

module.exports = { create, describeStep, ftsQuery, LOOKUP, sameWord, sameKey, learnedLines, calendarDay, PIN_LIMITS, MAX_NOTE_CHARS, SHARED, SOURCES, SCHEMA_VERSION, INDEX_VERSION, REMOVED_DAYS };
