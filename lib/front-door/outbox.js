// @ts-check
// A managed machine's Feedback outbox (ADR 164): the fleet console is its admin (ADR 154), so each report an owner
// sends is also written whole, screenshots as base64, to one file of its own here, feedback-<id>.json, which the
// console's agent sends on and removes. A file is written under a hidden name and renamed, so the agent never reads
// half of one. A request to delete the account goes the same way (#1313). Nothing else of the front door's data is
// in this folder.
const fs = require('fs');
const path = require('path');

// At most this many reports wait for the agent: past it the console has been away long enough that the owner is
// better told to try later than the disk filled (each file holds up to about 20 MB).
const WAITING_MAX = 100;
const FILE = /^feedback-[0-9a-f]{32}\.json$/;

/** @param {string} dir */
function create(dir, { waitingMax = WAITING_MAX } = {}) {
  const waiting = () => {
    try { return fs.readdirSync(dir).filter((n) => FILE.test(n)).length; } catch { return 0; }
  };
  return {
    dir,
    full: () => waiting() >= waitingMax,
    waiting,
    // report: as the store keeps it ({ id, account, created, kind, text, app, version }); shots: [{ type, bytes }].
    put(report, shots = []) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const { id, account, created, kind, text, app, version } = report;
      const body = { id, account, created, kind, text, app, version, screenshots: shots.map((s) => ({ type: s.type, data: s.bytes.toString('base64') })) };
      const name = `feedback-${id}.json`;
      const hidden = path.join(dir, `.${name}.tmp`);
      try {
        fs.writeFileSync(hidden, JSON.stringify(body), { mode: 0o600 });
        fs.renameSync(hidden, path.join(dir, name));
      } catch (e) { fs.rmSync(hidden, { force: true }); throw e; }
    },
    // An owner's request to delete their account (#1313, ADR 241): it rides the same file and route as a report, as
    // kind `deletion`, so a console's agent of any version brings it. Never refused for a full outbox.
    deletion({ id, account, created, app = 'web', version = null }) {
      this.put({ id, account, created, kind: 'deletion', text: `Delete the account ${account}`, app, version });
    },
  };
}

module.exports = { create, WAITING_MAX };
