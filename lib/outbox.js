// Files a bot gives the owner with its reply (a PDF, a spreadsheet, a Word document…). The bot makes
// the file in its workspace and calls attach_file; botdot copies it to data/files/<runId>/, out of
// the bot's reach, so it stays as it was sent. The run lists it (meta.files) and the apps download it
// from /api/files/<runId>/<name>. Files older than 90 days are removed.
const fs = require('./principal-fs');
const path = require('path');
const { safeName, inWorkspace } = require('./uploads');

const MAX_FILES = 10; // per reply
const KEEP_DAYS = 90;

function create(dataDir) {
  const DIR = path.join(dataDir, 'files');
  const RUN_RE = /^[\w-]+$/;

  // Copy a file from the bot's workspace for this run. `p` is relative to the workspace or absolute
  // inside it. Returns what the run lists: { name, file, size }.
  function attach(runId, workspace, p, { already = [] } = {}) {
    if (!RUN_RE.test(runId)) throw new Error('Unknown run');
    if (already.length >= MAX_FILES) throw new Error(`You can attach at most ${MAX_FILES} files to one reply.`);
    const { abs, size } = inWorkspace(workspace, p);
    const name = freeName(path.basename(abs), already);
    fs.mkdirSync(path.join(DIR, runId), { recursive: true });
    fs.copyFileSync(abs, path.join(DIR, runId, name));
    return { name, file: `${runId}/${name}`, size };
  }

  // A file made by botdot itself for this run (a screenshot of the bot's computer), from its bytes.
  function attachData(runId, fileName, data, { already = [] } = {}) {
    if (!RUN_RE.test(runId)) throw new Error('Unknown run');
    if (already.length >= MAX_FILES) throw new Error(`You can attach at most ${MAX_FILES} files to one reply.`);
    if (!data?.length) throw new Error('The file is empty.');
    const name = freeName(fileName, already);
    fs.mkdirSync(path.join(DIR, runId), { recursive: true });
    fs.writeFileSync(path.join(DIR, runId, name), data);
    return { name, file: `${runId}/${name}`, size: data.length };
  }

  // The same name twice in one reply: the second becomes "name-2.pdf".
  function freeName(base, already) {
    const first = safeName(base);
    const taken = new Set(already.map((f) => f.name));
    let name = first;
    for (let i = 2; taken.has(name); i++) name = first.replace(/(\.[^.]+)?$/, `-${i}$1`);
    return name;
  }

  // The stored file for a download, or null.
  function find(runId, name) {
    if (!RUN_RE.test(String(runId)) || String(name) !== safeName(name)) return null;
    const abs = path.join(DIR, runId, name);
    return fs.existsSync(abs) ? abs : null;
  }

  // Remove the files of runs older than KEEP_DAYS. Returns how many runs' files went.
  function prune(now = Date.now()) {
    let n = 0;
    let runs = [];
    try { runs = fs.readdirSync(DIR); } catch { return 0; }
    for (const r of runs) {
      const dir = path.join(DIR, r);
      try {
        if (now - fs.statSync(dir).mtimeMs > KEEP_DAYS * 24 * 3600_000) { fs.rmSync(dir, { recursive: true, force: true }); n++; }
      } catch { /* next time */ }
    }
    return n;
  }

  return { attach, attachData, find, prune, DIR, MAX_FILES, KEEP_DAYS };
}

module.exports = { create };
