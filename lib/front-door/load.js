// The machine's load and each account's use of its share, as root's step writes them (install.sh --load, every
// minute): one file for the machine, machine.json, and one per account, account-<account>.json, in FRONT_DOOR_LOAD.
// The front door never runs as root and never looks inside an account: it reads these files and shows them on the
// admin page, and nothing else (ADR 028). A file older than STALE_MS, or one that can't be read, is shown as nothing.
const fs = require('fs');
const path = require('path');
const { ACCOUNT_NAME } = require('./store');

const STALE_MS = 5 * 60_000;
// The numbers each file may hold, and nothing else is passed on.
const MACHINE = ['cpus', 'load', 'ramTotal', 'ramUsed', 'diskTotal', 'diskUsed'];
const ACCOUNT = ['cpu', 'ram', 'computers', 'diskSize', 'diskUsed'];

function read(file, keys, now) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const at = Date.parse(data?.at);
  if (!Number.isFinite(at) || now - at > STALE_MS) return null;
  const out = { at: new Date(at).toISOString() };
  for (const k of keys) if (Number.isFinite(data[k]) && data[k] >= 0) out[k] = data[k];
  // An account's disk is full: its runs fail with "No space left on the server".
  if (data.full === true) out.full = true;
  return out;
}

// dir: FRONT_DOOR_LOAD, or null (a machine of one account, or one without root's step): nothing is known.
function create(dir, { now = Date.now } = {}) {
  return {
    machine: () => (dir ? read(path.join(dir, 'machine.json'), MACHINE, now()) : null),
    account: (name) => (dir && ACCOUNT_NAME.test(name) ? read(path.join(dir, `account-${name}.json`), ACCOUNT, now()) : null),
  };
}

module.exports = { create, STALE_MS };
