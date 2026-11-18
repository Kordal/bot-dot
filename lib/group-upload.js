// Copy a group file into a bot's principal without holding the file in memory.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const fs = require('./principal-fs');
const { safeName, uploadPath } = require('./uploads');

function discard(workspace, files) {
  for (const f of files) {
    for (const rel of [f.file, f.readable].filter(Boolean)) {
      try { fs.rmSync(path.join(workspace, rel), { force: true }); }
      catch (error) { console.error(`[groups] Could not remove a file that wasn't handed to a bot: ${error.message}`); }
    }
  }
}

async function copy(workspace, source, signal) {
  const name = safeName(source.name);
  const dir = path.join(workspace, 'uploads');
  const partial = path.join(dir, `.upload-${randomUUID()}.part`);
  fs.mkdirSync(dir, { recursive: true });
  const stage = (from, to) => pipeline(fs.createReadStream(from), fs.createWriteStream(to, { flags: 'wx', mode: 0o644 }), { signal });
  try {
    await stage(source.abs, partial);
    if (source.readable) await stage(source.readable, `${partial}.txt`);
    signal.throwIfAborted();
    let file, dest;
    do { file = uploadPath(name); dest = path.join(workspace, file); } while (fs.existsSync(dest) || fs.existsSync(`${dest}.txt`));
    const result = { name, file, size: fs.statSync(partial).size, readable: source.readable ? `${file}.txt` : null };
    fs.renameSync(partial, dest);
    try { if (result.readable) fs.renameSync(`${partial}.txt`, `${dest}.txt`); }
    catch (error) { discard(workspace, [result]); throw error; }
    return result;
  } finally {
    fs.rmSync(partial, { force: true });
    fs.rmSync(`${partial}.txt`, { force: true });
  }
}

module.exports = { copy, discard };
