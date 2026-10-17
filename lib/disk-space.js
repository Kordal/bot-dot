// The account's disk is its share of the machine (ADR 028): when it is full, a run fails, and says only "No space
// left on the server" (problems.js), never a size or a limit. The admin page marks the account (install.sh --load).
//
// So that the run's own record can still be written then, botdot keeps a spare file in its data folder while there is
// room, and removes it when a run fails on a full disk: the room it held is where that record goes.
const fs = require('fs');
const path = require('path');

const SPARE_BYTES = 32 * 1024 * 1024;
// Below this much room the disk counts as full; a spare is made only with plenty more.
const LOW_BYTES = 64 * 1024 * 1024;
const ROOM_FOR_SPARE = 1024 * 1024 * 1024;
const NO_SPACE_ERROR = /ENOSPC|no space left on (the )?device/i;

// dir: the data folder. spare: whether to keep a spare (only an account on a machine with shares, whose disk is its
// own: not the Mac, nor a test).
function create(dir, { spare: keep = !!process.env.BOT_DOT_ACCOUNT } = {}) {
  const spare = path.join(dir, '.spare');
  // How many bytes are free for botdot's own files, or null when it can't be told.
  function free() {
    try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; }
  }
  return {
    free,
    // Whether a failure was the disk's: what it said, or the room left.
    full(said = '') {
      if (NO_SPACE_ERROR.test(String(said))) return true;
      const room = free();
      return room !== null && room < LOW_BYTES;
    },
    // A spare, when there is none and room for it.
    keepSpare() {
      if (!keep) return;
      try {
        if (fs.existsSync(spare) || (free() ?? 0) < ROOM_FOR_SPARE) return;
        fs.writeFileSync(`${spare}.new`, Buffer.alloc(SPARE_BYTES), { mode: 0o600 });
        fs.renameSync(`${spare}.new`, spare);
      } catch { fs.rmSync(`${spare}.new`, { force: true }); }
    },
    // The spare's room, for a record that must still be written.
    useSpare() { fs.rmSync(spare, { force: true }); },
  };
}

module.exports = { create, NO_SPACE_ERROR, LOW_BYTES };
