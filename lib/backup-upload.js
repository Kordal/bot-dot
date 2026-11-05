// A backup's upload for a restore, streamed to disk with no cap of its own (#1020): it is bounded by the disk's free
// space, of which RESERVE stays free so botdot and the restore's own unpacking still have room.
const fs = require('node:fs');
const path = require('node:path');
const RESERVE = 512 * 1024 * 1024;
// The free space is looked at again after every CHECK_EVERY bytes of a body without a Content-Length.
const CHECK_EVERY = 64 * 1024 * 1024;
const gb = (n) => `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB`;
// The bytes an upload may still take in the folder, or Infinity where the disk can't be asked.
function room(dir) {
  try { const st = fs.statfsSync(dir); return Math.max(0, st.bavail * st.bsize - RESERVE); } catch { return Infinity; }
}
const noRoom = (needs, free) => Object.assign(new Error(needs
  ? `There isn't room on the disk for this backup: it needs ${gb(needs)} and ${gb(free)} is free. Free some space and try again.`
  : 'The disk filled up during the upload. Free some space and try again.'), { status: 507 });
// free: the room in the folder (room()), steerable in a test.
function save(req, file, { free = room } = {}) {
  const dir = path.dirname(file);
  const length = Number(req.headers['content-length']);
  if (length > free(dir)) { req.resume(); return Promise.reject(noRoom(length, free(dir))); }
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file, { mode: 0o600, flags: 'wx' });
    let size = 0, checked = 0, failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out); req.resume();
      out.destroy();
      out.once('close', () => { fs.rmSync(file, { force: true }); reject(error); });
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (length > 0 || size - checked < CHECK_EVERY) return;
      checked = size;
      if (free(dir) <= 0) fail(noRoom(0));
    });
    req.on('aborted', () => fail(new Error('Backup upload aborted')));
    req.on('error', fail);
    out.on('error', (e) => fail(e.code === 'ENOSPC' ? noRoom(0) : e));
    out.on('finish', () => { if (!failed) resolve(); });
    req.pipe(out);
  });
}
module.exports = { save, room, RESERVE };
