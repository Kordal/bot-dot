// What's new (#219): a short note per release, written by hand in whats-new/ and shown once per person after an
// update, on the web page and in the Android app. A note is <date>-<name>.md: its first line the title, then 2 to 4
// points, each a line starting with "- ". The file's name is its id and sorts by date. What the account has seen is
// the id of the newest note it was shown, kept in data/whats-new.json, so the web page and the phone show it once.
const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

// Where the notes are: in the image, beside the code. A test names its own folder.
const DIR = process.env.BOT_DOT_WHATS_NEW_DIR || path.join(__dirname, '..', 'whats-new');
const ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TITLE_MAX = 80;
const POINT_MAX = 200;

// A note's text read as { title, points }, or { error } in plain words. Its text is plain: the apps draw it as text.
function parse(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const title = (lines.shift() || '').replace(/^#+\s*/, '');
  if (!title || title.startsWith('- ')) return { error: 'has no title on its first line' };
  if (title.length > TITLE_MAX) return { error: `has a title over ${TITLE_MAX} characters` };
  const stray = lines.find((l) => !l.startsWith('- '));
  if (stray) return { error: `has a line that is no point (points start with "- "): ${stray}` };
  const points = lines.map((l) => l.slice(2).trim());
  if (points.length < 2 || points.length > 4) return { error: `has ${points.length} points, not 2 to 4` };
  if (points.some((p) => !p)) return { error: 'has an empty point' };
  const long = points.find((p) => p.length > POINT_MAX);
  if (long) return { error: `has a point over ${POINT_MAX} characters: ${long}` };
  return { title, points };
}

// Every note in `dir`, oldest first: { id, title, points }, or { id, error } for one that can't be shown. A file
// whose name is no id is left out (a README, say). No folder: none.
function read(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((f) => f.endsWith('.md') && ID.test(f.slice(0, -3))).sort().map((f) => {
    const id = f.slice(0, -3);
    let text;
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return { id, error: e.message }; }
    return { id, ...parse(text) };
  });
}

// The id of the newest note in `dir`, or null: what a botdot server of this version ships (its /api/version).
const newest = (dir = DIR) => read(dir).filter((n) => !n.error).at(-1)?.id || null;

// The notes in `dir` after `id`, newest first, all of them (#380): what moving from a version whose newest note is
// `id` brings (#303). No id: none, since nothing says which notes that version has.
function after(id, { dir = DIR } = {}) {
  if (typeof id !== 'string' || !ID.test(id)) return [];
  return read(dir).filter((n) => !n.error && n.id > id).reverse().map(({ id: i, title, points }) => ({ id: i, title, points }));
}

// An account's What's new: the notes in `dir` it has not seen, and marking them seen. dataDir: the account's data.
function create({ dir, dataDir }) {
  const file = path.join(dataDir, 'whats-new.json');
  const notes = () => read(dir).filter((n) => !n.error);
  const newestId = () => notes().at(-1)?.id || '';
  // An account without a seen id (a new account, or a server that just got What's new) has seen every note up to
  // now: '' before the first note there is, so that one shows once it comes.
  const seenId = () => {
    const kept = readJson(file, null);
    if (typeof kept?.seen === 'string') return kept.seen;
    const baseline = newestId();
    writeJson(file, { seen: baseline });
    return baseline;
  };
  seenId(); // the baseline is taken when the server starts (after an update, or a new account), not when an app asks
  return {
    // The notes it has not seen, newest first, every one (#380): closing the pop-up marks them all seen, so one left
    // out would never show.
    unseen() {
      const seen = seenId();
      return notes().filter((n) => n.id > seen).reverse().map(({ id, title, points }) => ({ id, title, points }));
    },
    // Everything up to `id` counts as seen. Never back: an older id leaves what was seen as it is.
    seen(id) {
      if (typeof id !== 'string' || !notes().some((n) => n.id === id)) throw Object.assign(new Error('Say which note was seen (id).'), { status: 400 });
      if (id > seenId()) writeJson(file, { seen: id });
      return { ok: true };
    },
  };
}

module.exports = { create, parse, read, newest, after, DIR, ID };
