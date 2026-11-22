// @ts-check
// A managed machine's inbox (ADR 259, #1572): the outbox's way in reverse. The fleet console's agent writes the statuses
// of this machine's own reports to one file here, feedback-statuses.json, whole under a hidden name and renamed over the
// old one, and only into this folder once it exists: the front door makes it (owned by its user, mode 700) and the agent
// never does. The file is outside the front door's trust: it is read without following a link, only as a regular file of
// at most MAX_BYTES, every field is checked as the relay's answer is (feedback-relay.js cleanStatus), and it is removed
// only once what it says has been applied. Nothing else of the front door's data is in this folder.
const fs = require('fs');
const path = require('path');
const { cleanStatus } = require('./feedback-relay');

const NAME = 'feedback-statuses.json';
// Past this the file is taken for unreadable: 100 reports' statuses are a few tens of KB.
const MAX_BYTES = 1024 * 1024;
// A report's own id, as the outbox's file names carry it (not a relay id).
const REPORT_ID = /^[0-9a-f]{32}$/;

/** @param {fs.Stats} s */
const same = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;

/** @param {string} dir @param {{ maxBytes?: number }} [options] */
function create(dir, { maxBytes = MAX_BYTES } = {}) {
  const file = path.join(dir, NAME);

  // The folder: made when it is missing, and kept the front door's own (mode 700). A link or a file in its place is an
  // error, said in words: nothing is read through it.
  function ensure() {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (!st.isDirectory()) throw new Error(`${dir} is not a folder`);
    if ((st.mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
  }

  // The file's bytes and what they were when read, or null when there is no file. Throws in plain words for what can't be
  // read: a link, a folder, a pipe, a file past maxBytes.
  /** @returns {{ bytes: Buffer, stamp: string } | null} */
  function read() {
    let st;
    try { st = fs.lstatSync(file); } catch (e) { if (/** @type {any} */ (e).code === 'ENOENT') return null; throw e; }
    if (!st.isFile()) throw new Error(`${NAME} is ${st.isSymbolicLink() ? 'a link' : st.isDirectory() ? 'a folder' : 'something'}, not a regular file`);
    if (st.size > maxBytes) throw new Error(`${NAME} is larger than ${maxBytes} bytes`);
    // O_NOFOLLOW and O_NONBLOCK: a link swapped in after the check above is refused, and a pipe does not hold the front door.
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile()) throw new Error(`${NAME} is something, not a regular file`);
      if (opened.size > maxBytes) throw new Error(`${NAME} is larger than ${maxBytes} bytes`);
      const bytes = fs.readFileSync(fd);
      if (bytes.length > maxBytes) throw new Error(`${NAME} is larger than ${maxBytes} bytes`);
      return { bytes, stamp: same(opened) };
    } finally { fs.closeSync(fd); }
  }

  return {
    dir,
    file,
    ensure,
    // Reads the file, checks it whole, hands what passes to apply(statuses), and removes the file once that returned.
    // statuses: { <report id>: { status, fixedIn?, issue?, note? } }, only entries of a well-formed id and a status that
    // cleanStatus keeps, each field only in its shape; the last of an id listed twice. Returns null when there is no file,
    // else { entries, kept, result } (what the list held, what passed, what apply returned). Throws, leaving the file, when
    // it can't be read or parsed or apply throws: never half applied. JSON that is no list holds nothing to apply and is
    // taken as an empty one. A file the agent replaced meanwhile is not removed: it is the console's newer word.
    /** @param {(statuses: Record<string, { status: string, fixedIn?: string, issue?: string, note?: string }>) => any} apply */
    take(apply) {
      const got = read();
      if (!got) return null;
      let list;
      try { list = JSON.parse(got.bytes.toString('utf8')); } catch { throw new Error(`${NAME} is not JSON`); }
      /** @type {Record<string, { status: string, fixedIn?: string, issue?: string, note?: string }>} */
      const statuses = {};
      const entries = Array.isArray(list) ? list.length : 0;
      if (Array.isArray(list)) {
        for (const e of list) {
          if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.id !== 'string' || !REPORT_ID.test(e.id)) continue;
          const s = cleanStatus(e);
          if (s) statuses[e.id] = s;
        }
      }
      const result = apply(statuses);
      try {
        if (same(fs.lstatSync(file)) === got.stamp) fs.unlinkSync(file);
      } catch (e) { if (/** @type {any} */ (e).code !== 'ENOENT') throw e; }
      return { entries, kept: Object.keys(statuses).length, result };
    },
  };
}

module.exports = { create, NAME, MAX_BYTES };
