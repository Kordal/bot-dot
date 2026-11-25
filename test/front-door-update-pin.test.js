// Where an account's entry says `autoUpdate: false` (ADR 271, #1689): for every account only where the front door plans the
// switches (a machine of one account, or of several with an admin, and root's step taking requests). Elsewhere (a managed
// machine of several accounts, one of several that names no admin) no one asks for a switch, so every account waiting
// would wait for ever: the old rule stays, `false` for `manual` alone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../lib/front-door/store');
const { spawn } = require('child_process');
const { waitFor } = require('./helpers');

const tmp = (t, prefix = 'fd-pin-') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const WHENS = { ann: 'ready', bob: 'night', cat: 'manual' };
const fields = (file) => Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).accounts).map(([n, a]) => [n, [a.updateWhen, a.autoUpdate]]));
// A front-door.json as the version before kept it: no "when" in words, `autoUpdate: false` for `manual` alone.
function seed(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'front-door.json');
  const entry = (extra) => ({ created: '2026-10-01T10:00:00.000Z', userId: 'u', ...extra });
  fs.writeFileSync(file, JSON.stringify({ accounts: { ann: entry({}), bob: entry({ autoUpdate: true }), cat: entry({ autoUpdate: false }) } }));
  return file;
}

test('the store pins `autoUpdate: false` for every account only where the front door plans the switches', (t) => {
  const planning = path.join(tmp(t), 'a');
  const file = seed(planning);
  const door = store.open(planning, { plansSwitches: true });
  door.pinUpdates();
  assert.deepEqual(fields(file), { ann: ['night', false], bob: ['night', false], cat: ['manual', false] }, 'every account, each keeping its "when" in words');
  for (const [name, when] of Object.entries(WHENS)) door.setUpdateWhen(name, when);
  assert.deepEqual(fields(file), { ann: ['ready', false], bob: ['night', false], cat: ['manual', false] });
  assert.deepEqual(['ann', 'bob', 'cat'].map(door.autoUpdate), [true, true, false], 'what an older app shows is unchanged');

  const elsewhere = path.join(tmp(t), 'b');
  const kept = seed(elsewhere);
  const other = store.open(elsewhere);
  other.pinUpdates();
  assert.deepEqual(fields(kept), { ann: ['night', undefined], bob: ['night', undefined], cat: ['manual', false] }, '`false` for manual alone, as before');
  for (const [name, when] of Object.entries(WHENS)) other.setUpdateWhen(name, when);
  assert.deepEqual(fields(kept), { ann: ['ready', undefined], bob: ['night', undefined], cat: ['manual', false] });
  other.importAccount('dan', { updateWhen: 'ready' });
  other.importAccount('eve', { autoUpdate: false });
  assert.deepEqual(fields(kept).dan, ['ready', undefined], 'an import follows the rule too');
  assert.deepEqual(fields(kept).eve, ['manual', false]);
});

test('the start-time migration follows the machine\'s mode both ways: pinned where it plans, let go where it no longer does', (t) => {
  const dir = path.join(tmp(t), 'c');
  const file = seed(dir);
  store.open(dir, { plansSwitches: true }).pinUpdates();
  assert.deepEqual(fields(file), { ann: ['night', false], bob: ['night', false], cat: ['manual', false] });
  // The machine's mode changed (the admin is no longer named): its accounts no longer wait for a switch no one plans.
  store.open(dir, { plansSwitches: false }).pinUpdates();
  assert.deepEqual(fields(file), { ann: ['night', undefined], bob: ['night', undefined], cat: ['manual', false] }, 'only manual stays false, and nobody turned into manual');
  store.open(dir, { plansSwitches: true }).pinUpdates();
  assert.deepEqual(fields(file), { ann: ['night', false], bob: ['night', false], cat: ['manual', false] });
});

// The front door started on data the version before kept, in the mode `env` gives it: what its data says once it listens.
async function startedWith(t, env) {
  const dir = tmp(t);
  const data = path.join(dir, 'data');
  const file = seed(data);
  const log = [];
  const child = spawn(process.execPath, ['front-door.js'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, FRONT_DOOR_PORT: '0', FRONT_DOOR_ORIGIN: 'http://localhost:1', FRONT_DOOR_DATA: data, FRONT_DOOR_SOCKETS: path.join(dir, 's'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((r) => child.on('exit', r));
  child.stdout.on('data', (c) => log.push(String(c)));
  child.stderr.on('data', (c) => log.push(String(c)));
  try {
    await waitFor(async () => /The front door is at/.test(log.join('')), { timeout: 15_000, what: 'the front door to start' });
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
  return fields(file);
}

test('a managed machine of several accounts (a first account, no admin) keeps `autoUpdate: false` for manual alone', async (t) => {
  const requests = tmp(t, 'fd-requests-');
  const got = await startedWith(t, { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'ann', FRONT_DOOR_SETUP_KEY: 'k'.repeat(40), FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_ADMIN: 'ann' });
  assert.deepEqual(got, { ann: ['night', undefined], bob: ['night', undefined], cat: ['manual', false] }, 'a managed machine has no admin, so no one plans its switches: root\'s step switches the others');
});

test('a machine of several accounts that names no admin keeps `autoUpdate: false` for manual alone', async (t) => {
  const got = await startedWith(t, { FRONT_DOOR_REQUESTS: tmp(t, 'fd-requests-') });
  assert.deepEqual(got, { ann: ['night', undefined], bob: ['night', undefined], cat: ['manual', false] });
});

test('a machine with an admin pins every account, and one of one account does too', async (t) => {
  const withAdmin = await startedWith(t, { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: tmp(t, 'fd-requests-') });
  assert.deepEqual(withAdmin, { ann: ['night', false], bob: ['night', false], cat: ['manual', false] });
  const one = await startedWith(t, { FRONT_DOOR_ONE_ACCOUNT: 'ann', FRONT_DOOR_REQUESTS: tmp(t, 'fd-requests-') });
  assert.deepEqual(one, { ann: ['night', false], bob: ['night', false], cat: ['manual', false] });
});
