// @ts-check
// The machine's boat.dev key (#529, ADR 087): what a bot whose computer is on boat.dev works with (lib/boat.js). Set by
// the admin, checked with one call before it is kept, kept in boat.json beside front-door.json, the front door's alone
// (mode 600). The key is never answered: the admin page is told only whether one is set.
//
// Each account's botdot server is handed it (POST /api/boat), keeps it in memory only, and, while one is set, is
// handed it again every minute, so that one that started again has it back within a minute (its boat bots work on the account's computer
// meanwhile).
const fs = require('fs');
const path = require('path');

// dir: the front door's data folder.
function open(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, 'boat.json');
  /** @type {{ key: string | null }} */
  let data = { key: null };
  try { const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (typeof saved?.key === 'string') data = { key: saved.key }; } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') console.error(`[front door] boat.json: ${/** @type {any} */ (e).message}`);
  }
  function save() {
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }
  // What the admin page is shown.
  const shown = () => ({ keySet: !!data.key });
  // What each account is handed.
  const forAccounts = () => ({ key: data.key });
  // A new key, already checked, or null to remove it.
  /** @param {string | null} key */
  function set(key) {
    data = { key: key || null };
    save();
    return shown();
  }
  return { shown, forAccounts, set };
}

module.exports = { open };
