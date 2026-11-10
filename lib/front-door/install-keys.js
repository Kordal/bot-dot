// @ts-check
// The keys the installer took (install.sh): the admin's OpenRouter key, which makes Jev the decision model (#513), and
// the boat.dev key, the External Virtual PC's (#529), and the Composio key of the admin's own account (ADR 160), each
// already checked as the admin page or the Connectors page checks it. install.sh leaves them in install-keys.json in the
// front door's data folder; the front door takes them into group-router.json and boat.json and removes the file, so that
// a key the admin changes later on the admin page stays as the admin set it. The Composio key is the machine's (ADR 206):
// kept in composio-key.json, where the admin page sets it too, and handed to every account without a key of its own.
const fs = require('fs');
const path = require('path');

const KEY = /^[A-Za-z0-9_-]{8,300}$/;

// dir: the front door's data folder; groupRouter, boat: its stores (lib/front-door/group-router.js, boat.js), null on a
// machine of one account. What it took: { openrouter, boat, composio }, each true or false; null when there was nothing.
/** @param {string} dir @param {{ groupRouter: any, boat: any }} stores */
function take(dir, { groupRouter, boat }) {
  const file = path.join(dir, 'install-keys.json');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') console.error(`[front door] install-keys.json: ${/** @type {any} */ (e).message}`);
    return null;
  }
  let keys = {};
  try { keys = JSON.parse(text) || {}; } catch { console.error("[front door] install-keys.json isn't JSON: its keys are set on the admin page"); }
  const took = { openrouter: false, boat: false, composio: false };
  if (groupRouter && typeof keys.openrouter === 'string' && KEY.test(keys.openrouter)) {
    groupRouter.set('jev', keys.openrouter);
    took.openrouter = true;
  }
  if (boat && typeof keys.boat === 'string' && KEY.test(keys.boat)) {
    boat.set(keys.boat);
    took.boat = true;
  }
  if (typeof keys.composio === 'string' && KEY.test(keys.composio)) {
    setComposio(dir, keys.composio);
    took.composio = true;
  }
  fs.rmSync(file, { force: true });
  return took;
}

// The machine's Composio key (ADR 206), or null. composioState: { key } while there is one, { key: null } once the
// admin removed it (the accounts that took it remove theirs), null when none was ever set.
const composioFile = (dir) => path.join(dir, 'composio-key.json');
/** @param {string} dir @returns {{ key: string | null } | null} */
function composioState(dir) {
  try {
    const { key } = JSON.parse(fs.readFileSync(composioFile(dir), 'utf8'));
    return { key: typeof key === 'string' && KEY.test(key) ? key : null };
  } catch { return null; }
}
/** @param {string} dir */
function composio(dir) { return composioState(dir)?.key || null; }
/** @param {string} dir @param {string | null} key */
function setComposio(dir, key) {
  const tmp = composioFile(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ key: key || null }), { mode: 0o600 });
  fs.renameSync(tmp, composioFile(dir));
}

module.exports = { take, composio, composioState, setComposio, KEY };
