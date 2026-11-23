// @ts-check
// The account's own boat.dev key (#1617, ADR 263): boat.dev bills the owner for the machines made with it, and the owner,
// not the admin, decides where the account's computer is and how big its External Virtual PC is. It is kept as the
// Composio key is (ADR 160, ADR 161): in the account's data, encrypted with the account's Vault key, and never sent to
// the apps once saved: they see that one is set and what its check said, never the key or a part of it. It never goes to
// a computer or to a boat.dev machine. It wins over the machine's key (lib/boat.js).
//
// boat-key.json: { key (encrypted), check, checkedAt }. The account's own server loads it as it starts.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');
const { encrypt, decrypt } = require('./vault');

// How long a check is taken as current before the settings ask boat.dev again (10 s each time they are opened otherwise).
const RECHECK_MS = 10 * 60_000;
const WORDS = {
  refused: 'boat.dev refused this key.',
  billing: 'boat.dev wants a plan or a payment method on this account first.',
  unreachable: "boat.dev can't be reached. Try again.",
};

// boat: lib/boat.js. checkKey(key): 'ok', 'refused', 'billing' or 'unreachable'.
function create(dataDir, { boat, checkKey = boat.checkKey, now = Date.now } = {}) {
  const file = path.join(dataDir, 'boat-key.json');
  const load = () => readJson(file, {});
  const save = (d) => writeJson(file, d, { mode: 0o600 });
  let checking = null;

  // The key into lib/boat.js, as the server starts (and whenever the file changes). A key that can't be opened (the Vault's
  // key is another one) counts as none, and is said once.
  function start() {
    const d = load();
    if (!d.key) { boat.setOwnKey(null); return false; }
    try { boat.setOwnKey(decrypt(d.key)); return true; } catch (e) {
      console.error(`[boat] the account's own boat.dev key can't be opened: ${e.message}`);
      boat.setOwnKey(null);
      return false;
    }
  }

  const isSet = () => !!load().key;
  // Whether this is the key there is (a key that can't be opened is none).
  function isSame(value) {
    const d = load();
    if (!d.key) return false;
    try { return decrypt(d.key) === String(value || '').trim(); } catch { return false; }
  }
  // What the apps see: that a key is set and its check, nothing of the key. A key boat.dev refused a call with since
  // is 'refused' whatever its check said.
  function status() {
    const d = load();
    if (!d.key) return { set: false };
    return { set: true, check: boat.isOwnRefused() ? 'refused' : d.check || null, ...(d.checkedAt ? { checkedAt: d.checkedAt } : {}) };
  }

  // A key to keep: checked with boat.dev first (as the installer and the admin page check one), kept only when it is
  // good. Throws { status, check, message } for a key boat.dev refused (400), one whose account has no plan yet (400) and
  // one it could not ask about (502). Replaces the key there is.
  async function set(value) {
    const k = String(value || '').trim();
    if (!k) throw Object.assign(new Error('Paste a boat.dev API key.'), { status: 400 });
    const check = await checkKey(k);
    if (check !== 'ok') throw Object.assign(new Error(WORDS[check] || WORDS.refused), { status: check === 'unreachable' ? 502 : 400, check });
    save({ key: encrypt(k), check, checkedAt: new Date(now()).toISOString() });
    boat.setOwnKey(k);
    return status();
  }

  // The check of the key there is, asked of boat.dev again when the last one is older than RECHECK_MS (or `force`): the
  // settings show it, so a key boat.dev started refusing says so. A boat.dev that can't be reached leaves the last check.
  async function refresh({ force = false } = {}) {
    const d = load();
    if (!d.key) return status();
    if (!force && d.checkedAt && now() - Date.parse(d.checkedAt) < RECHECK_MS) return status();
    if (checking) return checking;
    checking = (async () => {
      try {
        const k = decrypt(d.key);
        const check = await checkKey(k);
        if (check !== 'unreachable') {
          save({ ...load(), check, checkedAt: new Date(now()).toISOString() });
          // A key boat.dev refuses is still the account's own (its machines are, and removing it asks about them), a
          // key it takes again works again.
          if (check === 'ok') boat.setOwnKey(k);
        }
      } catch (e) { console.warn(`[boat] the account's own boat.dev key was not checked: ${e.message}`); }
      return status();
    })().finally(() => { checking = null; });
    return checking;
  }

  // The key gone, from the file and from lib/boat.js. The machines made with it are dealt with before (bots.js).
  function remove() {
    try { require('fs').rmSync(file, { force: true }); } catch { /* none */ }
    boat.setOwnKey(null);
  }

  return { start, isSet, isSame, status, set, refresh, remove };
}

module.exports = { create, WORDS };
