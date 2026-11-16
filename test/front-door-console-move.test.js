// An account moved between machines by the fleet console (ADR 253, install.sh's IMPORT- and DELETE-, in
// test/installer-offsite.test.js): `node front-door.js import-account --account NAME --record FILE --by console` makes
// the account with no passkey from what the other machine's front door kept of it, so that only a sign-in link lets
// its owner in, and `delete-account` has the running front door delete it as the admin page does: its boat.dev
// machines, its rooms and its usage go too. Each prints one line of JSON and keeps an
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
  const again2 = ask(door, env, 'delete-account', '--account', 'carl');
  assert.deepEqual(again2.said, { state: 'deleted', account: 'carl' }, 'asked again once deleted: deleted');
  const none = ask(door, env, 'delete-account', '--account', 'dora');
  assert.deepEqual([none.status, none.said.state, none.said.error], [3, 'refused', 'There is no account dora.']);

  const entries = JSON.parse(`[${fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').trim().split('\n').join(',')}]`).filter((e) => e.actor === 'console');
  assert.deepEqual(entries.map((e) => [e.action, e.account]), [['import', 'carl'], ['sign-in-link', 'carl'], ['console-refused', 'carl'], ['delete', 'carl'], ['console-refused', 'dora']]);
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

test('delete-account deletes as the admin page does: the account leaves its rooms and its boat.dev machines go', async (t) => {
  const http = require('http');
  const stub = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const env = { FRONT_DOOR_ADMIN: 'ann', BOT_DOT_BOAT_URL: `http://127.0.0.1:${stub.address().port}` };
  const door = await startFrontDoor({ env });
  const stands = { ann: await standIn(door, 'ann'), carl: await standIn(door, 'carl', { answer: (req) => (req.url === '/api/boat/erase' ? [200, { deleted: 2, failed: [] }] : null) }) };
  t.after(async () => { await door.stop(); for (const s of Object.values(stands)) s.close(); stub.close(); });
  const signUp = async (name, p) => {
    const b = door.browser();
    const key = passkey.create({ rpId: door.rpId, origin: door.origin });
    const options = await b.post(`${p}/options`, { name });
    assert.equal((await b.post(p, { name, credential: key.register(options.data.publicKey) })).status, 201);
    return b;
  };
  const ann = await signUp('ann', door.firstLink.path);
  const carl = await signUp('carl', new URL((await ann.post('/admin/links', {})).data.url).pathname);
  assert.equal((await ann.post('/admin/boat', { key: 'boat_goodkey12345' })).status, 200);
  assert.equal((await ann.post('/admin/rooms', { on: true })).status, 200);
  const room = (await ann.post('/front-door/rooms', { name: 'With carl' })).data.room;
  await ann.post(`/front-door/rooms/${room.id}/invite`, { account: 'carl' });
  await carl.post(`/front-door/rooms/${room.id}/accept`, {});

  // Asked without blocking this process, which holds carl's stand-in server.
  const { execFile } = require('child_process');
  const said = await new Promise((resolve, reject) => {
    execFile(process.execPath, ['front-door.js', 'delete-account', '--account', 'carl', '--by', 'console'], { cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data, ...env } }, (e, out) => (e ? reject(e) : resolve(JSON.parse(out))));
  });
  assert.deepEqual(said, { state: 'deleted', account: 'carl' });
  assert.equal(stands.carl.seen.filter((r) => r.url === '/api/boat/erase').length, 1, 'its boat.dev machines asked to go first');
  assert.deepEqual((await ann.get(`/front-door/rooms/${room.id}`)).data.room.members.map((m) => m.account), ['ann'], 'it left its room');
  const entry = JSON.parse(fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').trim().split('\n').at(-1));
  assert.deepEqual([entry.action, entry.actor, entry.account, entry.detail], ['delete', 'console', 'carl', 'boat.dev: 2 machines deleted']);
});

test('hold-account suspends an account for its move and release-account lets go of that hold only', async (t) => {
  const env = { FRONT_DOOR_ADMIN: 'ann' };
  const door = await startFrontDoor({ env });
  t.after(() => door.stop());
  const a = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await a.post(`${door.firstLink.path}/options`, { name: 'ann' });
  assert.equal((await a.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) })).status, 201);
  for (const name of ['carl', 'dora']) {
    const p = new URL((await a.post('/admin/links', {})).data.url).pathname;
    const b = door.browser();
    const k = passkey.create({ rpId: door.rpId, origin: door.origin });
    const o = await b.post(`${p}/options`, { name });
    assert.equal((await b.post(p, { name, credential: k.register(o.data.publicKey) })).status, 201);
  }
  assert.deepEqual(ask(door, env, 'hold-account', '--account', 'carl').said, { state: 'held', account: 'carl', changed: true });
  assert.ok(data(door).accounts.carl.suspended && data(door).accounts.carl.held);
  assert.deepEqual(ask(door, env, 'hold-account', '--account', 'carl').said, { state: 'held', account: 'carl', changed: false }, 'twice: the same hold');
  assert.deepEqual(ask(door, env, 'release-account', '--account', 'carl').said, { state: 'released', account: 'carl', changed: true });
  assert.ok(!data(door).accounts.carl.suspended && !data(door).accounts.carl.held);

  // dora suspended by the admin is held as she is, and a release leaves her suspended.
  assert.equal((await a.post('/admin/accounts/dora/suspend', { name: 'dora' })).status, 200);
  assert.equal(ask(door, env, 'hold-account', '--account', 'dora').said.changed, false);
  assert.equal(ask(door, env, 'release-account', '--account', 'dora').said.changed, false);
  assert.ok(data(door).accounts.dora.suspended, 'still the admin\'s suspension');
  const none = ask(door, env, 'hold-account', '--account', 'eve');
  assert.deepEqual([none.status, none.said.state], [3, 'refused']);
});
