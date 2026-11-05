// @ts-check
// The keys the installer took (install.sh): the admin's OpenRouter key, which makes Jev the decision model (#513), and
// the boat.dev key, the External Virtual PC's (#529), each already checked as the admin page checks it, and on a managed
// machine the machine's Composio key (ADR 160). install.sh leaves them in install-keys.json in the front door's data
// folder; the front door takes them into group-router.json, boat.json and composio.json and removes the file, so that a
// key the admin changes later on the admin page stays as the admin set it. On a managed machine, which has no admin
// page, the fleet console's agent leaves the same file when the operator sets or replaces a key (ADR 160).
const fs = require('fs');
const path = require('path');

const KEY = /^[A-Za-z0-9_-]{8,300}$/;

// dir: the front door's data folder; groupRouter, boat, composio: its stores (lib/front-door/group-router.js, boat.js,
// composio.js), each null where the machine has none.
// What it took: { openrouter, boat, composio }, each true or false; null when there was nothing to take.
/** @param {string} dir @param {{ groupRouter: any, boat: any, composio?: any }} stores */
function take(dir, { groupRouter, boat, composio = null }) {
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
  if (composio && typeof keys.composio === 'string' && KEY.test(keys.composio)) {
    composio.set(keys.composio);
    took.composio = true;
  }
  fs.rmSync(file, { force: true });
  return took;
}

module.exports = { take };
