// An account moved between machines by the fleet console (ADR 253, install.sh's IMPORT- and DELETE-, in
// test/installer-offsite.test.js): `node front-door.js import-account --account NAME --record FILE --by console` makes
// the account with no passkey from what the other machine's front door kept of it, so that only a sign-in link lets
// its owner in, and `delete-account` deletes it as the admin page does. Each prints one line of JSON and keeps an
// audit entry by the console.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const GB = 2 ** 30;
const SETUP_KEY = crypto.randomBytes(32).toString('base64url');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-move-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function ask(door, env, ...args) {
  const r = spawnSync(process.execPath, ['front-door.js', ...args, '--by', 'console'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data, ...env },
    encoding: 'utf8',
  });
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1, `one line:\n${r.stdout}${r.stderr}`);
  return { status: r.status, said: JSON.parse(r.stdout) };
}
const data = (door) => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
// The other machine's front-door.json: carl, with a passkey and a session that must not come along.
function record(t, extra = {}) {
  const file = path.join(tmp(t), 'front-door.json');
  fs.writeFileSync(file, JSON.stringify({
    accounts: { carl: { created: '2026-10-01T10:00:00.000Z', userId: 'old-user-id', terms: { version: '2', at: '2026-10-01T10:00:00.000Z' }, autoUpdate: false, share: { cpu: 1, ram: 2, disk: 12 }, suspended: '2026-11-01T00:00:00.000Z', ...extra } },
    passkeys: { k1: { account: 'carl', alg: -7, jwk: {}, signCount: 0 } },
    sessions: { h1: { account: 'carl' } },
  }));
  return file;
}

test('managed, several: an imported account has what the other machine kept of it but no passkey, and a sign-in link lets its owner in', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const load = tmp(t);
  fs.writeFileSync(path.join(load, 'machine.json'), JSON.stringify({ at: new Date().toISOString(), cpus: 12, ramTotal: 23.4 * GB, ramUsed: 2 * GB, diskTotal: 400 * GB, diskUsed: 20 * GB }));
  const door = await startFrontDoor({ env: { ...env, FRONT_DOOR_LOAD: load } });
  const carl = await standIn(door, 'carl');
  t.after(async () => { await door.stop(); carl.close(); });

  const made = ask(door, { ...env, FRONT_DOOR_LOAD: load }, 'import-account', '--account', 'carl', '--record', record(t));
  assert.deepEqual([made.status, made.said], [0, { state: 'imported', account: 'carl' }]);
  const kept = data(door);
  const { userId, imported, ...rest } = kept.accounts.carl;
  assert.deepEqual(rest, { created: '2026-10-01T10:00:00.000Z', terms: { version: '2', at: '2026-10-01T10:00:00.000Z' }, autoUpdate: false });
  assert.notEqual(userId, 'old-user-id', 'a user handle of its own here');
  assert.match(imported, /^\d{4}-/);
  assert.deepEqual(Object.values(kept.passkeys || {}).filter((k) => k.account === 'carl'), [], 'no passkey comes along');
  assert.deepEqual(Object.values(kept.sessions || {}).filter((s) => s.account === 'carl'), [], 'nor a session');

  const link = ask(door, env, 'sign-in-link', '--account', 'carl');
  assert.equal(link.said.state, 'made');
  const p = new URL(link.said.url).pathname;
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, { name: 'carl' });
  const done = await b.post(p, { name: 'carl', credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  assert.equal((await b.get('/api/bots')).status, 200, 'carl is in, on a passkey made here');

  const again = ask(door, env, 'import-account', '--account', 'carl', '--record', record(t));
  assert.deepEqual([again.status, again.said.state, again.said.error], [3, 'refused', 'This machine has an account carl already.']);

  const gone = ask(door, env, 'delete-account', '--account', 'carl');
  assert.deepEqual(gone.said, { state: 'deleted', account: 'carl' });
  assert.ok(!data(door).accounts.carl);
  assert.ok(data(door).deleted.carl, 'named for root\'s step to erase');
  assert.equal((await b.get('/api/bots')).status, 401, 'its session ends');
  const none = ask(door, env, 'delete-account', '--account', 'carl');
  assert.equal(none.said.state, 'refused');

  const entries = JSON.parse(`[${fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').trim().split('\n').join(',')}]`).filter((e) => e.actor === 'console');
  assert.deepEqual(entries.map((e) => [e.action, e.account]), [['import', 'carl'], ['sign-in-link', 'carl'], ['console-refused', 'carl'], ['delete', 'carl'], ['console-refused', 'carl']]);
});

test('managed, several: an import with no room for its share is refused', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const load = tmp(t);
  fs.writeFileSync(path.join(load, 'machine.json'), JSON.stringify({ at: new Date().toISOString(), cpus: 6, ramTotal: 11.7 * GB, ramUsed: 2 * GB, diskTotal: 200 * GB, diskUsed: 20 * GB }));
  const door = await startFrontDoor({ env: { ...env, FRONT_DOOR_LOAD: load } });
  t.after(() => door.stop());
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`/sign-up/${SETUP_KEY}/options`, { name: 'owner' });
  assert.equal((await b.post(`/sign-up/${SETUP_KEY}`, { name: 'owner', credential: key.register(options.data.publicKey) })).status, 201);
  const full = ask(door, { ...env, FRONT_DOOR_LOAD: load }, 'import-account', '--account', 'carl', '--record', record(t));
  assert.deepEqual([full.status, full.said.state, full.said.error], [3, 'refused', 'This machine has no room for another account\'s share.']);
  assert.ok(!data(door).accounts.carl);
});

test('managed, one account: only its one account is imported, and only while the machine has none', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'carl', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const door = await startFrontDoor({ env });
  t.after(() => door.stop());
  const other = ask(door, env, 'import-account', '--account', 'dora', '--record', record(t));
  assert.deepEqual([other.status, other.said.error], [3, 'This machine holds one account, carl, and takes no other.']);
  const made = ask(door, env, 'import-account', '--account', 'carl', '--record', '/nonexistent');
  assert.deepEqual(made.said, { state: 'imported', account: 'carl' }, 'a record it can\'t read makes the account as new');
  assert.equal((await door.browser().get(`/sign-up/${SETUP_KEY}`)).status === 200, false, 'the setup key\'s page is closed once it exists');
  const twice = ask(door, env, 'import-account', '--account', 'carl', '--record', record(t));
  assert.equal(twice.said.state, 'refused');
});

test('a name that is no account\'s is refused', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'carl', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const door = await startFrontDoor({ env });
  t.after(() => door.stop());
  for (const kind of ['import-account', 'delete-account']) {
    const r = ask(door, env, kind, '--account', '../etc');
    assert.equal(r.status, 3);
    assert.deepEqual(Object.keys(r.said).sort(), ['error', 'state']);
  }
});
