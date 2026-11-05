// @ts-check
// The machine's Composio key (ADR 160): on a managed machine, the fleet console's operator's key of a Composio project
// made for this machine, which an account's Connectors use while the account has no key of its own. It arrives the
// way the installer's keys do (install-keys.json, lib/front-door/install-keys.js), is kept in composio.json beside
// front-door.json, the front door's alone (mode 600), and is never answered.
//
// Each account's botdot server is handed it (POST /api/connectors/machine-key), keeps it in memory only, and, while one
// is set, is handed it again every minute, so that one that started again has it back within a minute.
const fs = require('fs');
const path = require('path');

// dir: the front door's data folder.
function open(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, 'composio.json');
  /** @type {{ key: string | null }} */
  let data = { key: null };
  try { const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (typeof saved?.key === 'string') data = { key: saved.key }; } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') console.error(`[front door] composio.json: ${/** @type {any} */ (e).message}`);
  }
  function save() {
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }
  const shown = () => ({ keySet: !!data.key });
  // What each account is handed.
  const forAccounts = () => ({ key: data.key });
  /** @param {string | null} key */
  function set(key) {
    data = { key: key || null };
    save();
    return shown();
  }
  return { shown, forAccounts, set };
}

module.exports = { open };
