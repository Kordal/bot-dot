// Reading and writing botdot's JSON files safely.
//   writeJson: a temp file, then a rename, so a crash mid-write leaves the old file whole.
//   readJson: a missing file is `fallback`. A damaged one is kept aside as <file>.broken-<time> and logged,
//   then `fallback` too, so the next save can't overwrite what was in it. Other errors (permissions, disk) throw.
const fs = require('fs');
const path = require('path');

function writeJson(file, value, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
  try { return JSON.parse(text); } catch (e) {
    const kept = `${file}.broken-${Date.now()}`;
    try { fs.renameSync(file, kept); } catch { /* it stays where it is */ }
    console.error(`[data] ${path.basename(file)} couldn't be read (${e.message}); kept as ${path.basename(kept)}`);
    return fallback;
  }
}

module.exports = { writeJson, readJson };
