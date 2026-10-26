// @ts-check
// The machine's group router (#513): what picks who answers a message without a mention in an account's group (ADR
// 081, lib/group-router.js). Haiku, on each account's own Claude sign-in, until the admin chooses Jev, which needs the
// admin's OpenRouter key. Kept in group-router.json beside front-door.json, the front door's alone (mode 600). The key
// is never answered: the admin page is told only whether one is set. Choosing Haiku drops it.
//
// Each account's botdot server is handed the choice and the key (POST /api/group-router), keeps them in memory only,
// and is handed them again every minute, so that one that started again has them back within a minute (Haiku
// meanwhile, which is safe).
const fs = require('fs');
const path = require('path');

const ROUTERS = ['haiku', 'jev'];
const MAX_REPLAYS = 60; // replays an hour, at most (lib/replay.js MAX_PER_HOUR)
// A number of replays an hour, or null when it is none.
/** @param {unknown} n @returns {number | null} */
const replaysOf = (n) => (Number.isInteger(n) && /** @type {number} */ (n) >= 0 && /** @type {number} */ (n) <= MAX_REPLAYS ? /** @type {number} */ (n) : null);
const fail = (status, message) => Object.assign(new Error(message), { status });

// dir: the front door's data folder.
function open(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, 'group-router.json');
  // wakeGate: the admin's switch of the wake gate (ADR 083), off until switched on, handed with the router's choice.
  // replaysPerHour: how fast the accounts' replays go (lib/replay.js, ADR 101), 0 (none) until the admin sets it.
  /** @type {{ router: string, key: string | null, wakeGate: boolean, replaysPerHour: number }} */
  let data = { router: 'haiku', key: null, wakeGate: false, replaysPerHour: 0 };
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (ROUTERS.includes(saved?.router)) data = { router: saved.router, key: saved.router === 'jev' && typeof saved.key === 'string' ? saved.key : null, wakeGate: saved.wakeGate === true, replaysPerHour: replaysOf(saved.replaysPerHour) ?? 0 };
  } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') console.error(`[front door] group-router.json: ${/** @type {any} */ (e).message}`);
  }
  if (data.router === 'jev' && !data.key) data = { ...data, router: 'haiku', key: null };
  function save() {
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }
  // What the admin page is shown.
  const shown = () => ({ router: data.router, keySet: !!data.key, wakeGate: data.wakeGate, replaysPerHour: data.replaysPerHour });
  // What each account is handed.
  const forAccounts = () => ({ ...data });
  // The admin's choice. key: a new key, already checked (check), or undefined to keep the one set. Jev without a key
  // set or given is refused. wakeGate: true or false, or undefined to keep it. replaysPerHour: 0 to 60, or undefined to
  // keep it.
  /** @param {string} router @param {string} [key] @param {boolean} [wakeGate] @param {number} [replaysPerHour] */
  function set(router, key, wakeGate, replaysPerHour) {
    if (!ROUTERS.includes(router)) throw fail(400, 'Choose Haiku or Jev.');
    if (router === 'jev' && !key && !data.key) throw fail(400, 'Jev needs an OpenRouter key.');
    const replays = replaysPerHour === undefined ? data.replaysPerHour : replaysOf(replaysPerHour);
    if (replays === null) throw fail(400, `Replays an hour are a whole number from 0 to ${MAX_REPLAYS}.`);
    const gate = typeof wakeGate === 'boolean' ? wakeGate : data.wakeGate;
    data = router === 'jev' ? { router, key: key || data.key, wakeGate: gate, replaysPerHour: replays } : { router, key: null, wakeGate: gate, replaysPerHour: replays };
    save();
    return shown();
  }
  return { shown, forAccounts, set };
}

module.exports = { open, ROUTERS, MAX_REPLAYS };
