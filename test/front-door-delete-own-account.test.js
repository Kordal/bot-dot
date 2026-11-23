// "Delete account" in Settings (#1307): a signed-in owner deletes their own account the same way the admin does on the
// admin page, after typing its name. The front door forgets it, its passkeys, its sessions and its open sign-in links
// at once, asks the machine to erase the rest and keeps an audit entry by the account itself. The admin's own account,
// the only admin, is never deleted this way, a machine of one account offers it to nobody, and a managed one asks the
// fleet console for it (#1313).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

let door, requests, status;
const stands = {};
const keys = {};
const browsers = {};
before(async () => {
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status } });
  stands.ann = await inside('ann');
  browsers.ann = await signUp('ann', door.firstLink);
  for (const name of ['bob', 'cat']) {
    stands[name] = await inside(name);
    browsers[name] = await signUp(name, (await browsers.ann.post('/admin/links', {})).data.url);
    fs.rmSync(path.join(requests, name), { force: true }); // the machine took the request and made the account
  }
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  fs.rmSync(requests, { recursive: true, force: true });
  fs.rmSync(status, { recursive: true, force: true });
});

const inside = (account) => standIn(door, account, { answer: () => [200, { account }] });
async function signUp(name, link, d = door) {
  const p = typeof link === 'string' ? new URL(link).pathname : link.path;
  const b = d.browser();
  const key = passkey.create({ rpId: d.rpId, origin: d.origin });
  const options = await b.post(`${p}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(p, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  keys[name] = key;
  return b;
}
async function signIn(key, d = door) {
  const b = d.browser();
  const options = await b.post('/sign-in/options', {});
  return b.post('/sign-in', { credential: key.signIn(options.data.publicKey) });
}
const asked = (name) => fs.existsSync(path.join(requests, name));
const saved = () => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));

test('the session says who may delete their own account: every account but the admin\'s', async () => {
  assert.equal((await browsers.bob.get('/front-door/session')).data.deleteAccount, true);
  assert.equal((await browsers.bob.get('/front-door/session')).data.deleteAccountPage, null, 'a self-hosted machine names no page (#1312)');
  const ann = (await browsers.ann.get('/front-door/session')).data;
  assert.equal(ann.admin, true);
  assert.equal(ann.deleteAccount, false, 'the only admin is not offered it');
});

test("the admin's own account can't be deleted in Settings", async () => {
  const r = await browsers.ann.post('/front-door/delete-account', { name: 'ann' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /admin's account/);
  assert.ok(!asked('ann'));
  assert.equal((await browsers.ann.get('/front-door/session')).status, 200, 'still signed in');
});

test('deleting needs a session, the X-Bot-Dot header and the account name typed exactly', async () => {
  assert.equal((await door.browser().post('/front-door/delete-account', { name: 'cat' })).status, 401);
  const wrong = await browsers.cat.post('/front-door/delete-account', { name: 'ca' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /Type your account's name, cat/);
  assert.equal((await browsers.cat.post('/front-door/delete-account', {})).status, 400);
  assert.equal((await browsers.cat.post('/front-door/delete-account', { name: 'bob' })).status, 400, "another account's name deletes nothing");
  assert.equal((await browsers.cat.post('/front-door/delete-account', { name: 'cat' }, { 'X-Bot-Dot': '' })).status, 403);
  assert.ok(!asked('cat') && !asked('bob'));
  assert.equal((await browsers.cat.get('/api/bots')).data.account, 'cat');
});

test('an owner deletes their own account: it is gone at once, the machine is asked to erase it, and the audit log says who', async () => {
  const other = door.browser();
  assert.equal((await signIn(keys.bob)).status, 200);
  const done = await browsers.bob.post('/front-door/delete-account', { name: 'bob' });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.deleted, '/front-door/deleted');
  assert.match(String(done.headers['set-cookie']), /Max-Age=0|Expires=Thu, 01 Jan 1970/i, 'the cookie is cleared');
  assert.ok(asked('bob'), 'the machine is asked to erase bob');
  const data = saved();
  assert.ok(data.deleted.bob, "root's step reads that bob was deleted");
  assert.ok(!data.accounts.bob);
  assert.ok(!Object.values(data.passkeys).some((k) => k.account === 'bob'), 'its passkeys are gone');
  assert.ok(!Object.values(data.sessions).some((s) => s.account === 'bob'), 'every session of it is gone');
  assert.equal((await browsers.bob.get('/api/bots')).status, 401);
  assert.equal((await other.get('/api/bots')).status, 401);
  assert.equal((await signIn(keys.bob)).status, 401, 'its passkey signs in no more');
  assert.equal((await browsers.cat.get('/api/bots')).data.account, 'cat', 'no other account is touched');

  const entry = (await browsers.ann.get('/admin/audit?account=bob&action=delete')).data.entries[0];
  assert.equal(entry.actor, 'bob', 'the owner, not the admin, deleted it');

  // Its name is taken until the machine has erased it, as with the admin's delete.
  const p = new URL((await browsers.ann.post('/admin/links', {})).data.url).pathname;
  assert.equal((await door.browser().post(`${p}/options`, { name: 'bob' })).status, 409);

  const page = await door.browser().get('/front-door/deleted');
  assert.equal(page.status, 200);
  assert.match(page.text, /Your account is deleted\./);
  assert.match(page.text, /14 days/);
});

const SETUP_KEY = 'k'.repeat(40);
test('a machine of one account offers it to nobody: there the account is the machine', async (t) => {
  const one = await startFrontDoor({ env: { FRONT_DOOR_ONE_ACCOUNT: 'solo', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const s = await standIn(one, 'solo', { answer: () => [200, { account: 'solo' }] });
  t.after(async () => { await one.stop(); s.close(); });
  const b = await signUp('solo', { path: `/sign-up/${SETUP_KEY}` }, one);
  const session = (await b.get('/front-door/session')).data;
  assert.equal(session.deleteAccount, false);
  assert.equal(session.deletionRequest, false);
  assert.equal(session.deleteAccountPage, null);
  assert.equal((await b.post('/front-door/delete-account', { name: 'solo' })).status, 404);
  assert.equal((await b.get('/front-door/session')).status, 200, 'still signed in');
});

// #1313 (ADR 241): on a managed machine Delete asks the fleet console, through the Feedback outbox, and the account is
// suspended and signed out at once; the console's resume drops the request.
test('a managed machine asks the console to delete the account, and suspends it meanwhile', async (t) => {
  const one = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'solo', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const s = await standIn(one, 'solo', { answer: () => [200, { account: 'solo' }] });
  t.after(async () => { await one.stop(); s.close(); });
  const b = await signUp('solo', { path: `/sign-up/${SETUP_KEY}` }, one);
  const session = (await b.get('/front-door/session')).data;
  assert.equal(session.deleteAccount, true);
  assert.equal(session.deletionRequest, true);
  assert.equal(session.deleteAccountPage, null);
  assert.equal((await b.post('/front-door/delete-account', { name: 'other' })).status, 400, 'the name typed must match');

  const done = await b.post('/front-door/delete-account', { name: 'solo', app: 'android', version: '1.2.3' });
  assert.equal(done.status, 200, done.text);
  assert.deepEqual(done.data, { ok: true, requested: true, deleted: '/front-door/deleting' });
  const dir = path.join(one.data, 'outbox');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^feedback-[0-9a-f]{32}\.json$/, 'the agent of any version brings it');
  const sent = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  assert.deepEqual({ ...sent, created: undefined }, { id: files[0].slice(9, 41), account: 'solo', created: undefined, kind: 'deletion', text: 'Delete the account solo', app: 'android', version: '1.2.3', screenshots: [] });

  assert.equal((await b.get('/front-door/session')).status, 401, 'signed out');
  const state = JSON.parse(fs.readFileSync(path.join(one.data, 'front-door.json'), 'utf8')).accounts.solo;
  assert.ok(state.suspended && state.deleting === state.suspended, 'suspended, marked as being deleted');
  const page = await one.browser().get('/front-door/deleting');
  assert.equal(page.status, 200);
  assert.match(page.text, /Your account is being deleted\./);

  const store = require('../lib/front-door/store').open(one.data);
  assert.ok(store.deletingSince('solo'));
  store.setSuspended('solo', false);
  assert.equal(store.deletingSince('solo'), null, 'a resume drops the request');
});

test("a delete bound to an account's userId never deletes one made again with the same name", () => {
  const store = require('../lib/front-door/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-bound-'));
  try {
    const doors = store.open(dir);
    const key = { id: 'k1', alg: -7, jwk: {}, signCount: 0 };
    doors.createOnlyAccount({ name: 'eve', userId: 'new-one', passkey: key });
    assert.throws(() => doors.deleteAccount('eve', Date.now(), 'old-one'), (e) => e.status === 409);
    assert.ok(doors.accountExists('eve'), 'the new eve stays');
    doors.deleteAccount('eve', Date.now(), 'new-one');
    assert.ok(!doors.accountExists('eve'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Its boat.dev machines (ADR 263) are deleted once the request is committed and the account is suspended, never before:
// the console's erase of the machine takes the account's own key with it, so it could not delete what that key made.
async function managed(t, answers) {
  const one = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'solo', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const stateWhenAsked = [];
  const s = await standIn(one, 'solo', {
    answer: (req) => {
      if (req.url !== '/api/boat/erase') return [200, { account: 'solo' }];
      const account = JSON.parse(fs.readFileSync(path.join(one.data, 'front-door.json'), 'utf8')).accounts.solo;
      stateWhenAsked.push({ suspended: !!account.suspended, deleting: !!account.deleting, outbox: fs.existsSync(path.join(one.data, 'outbox')) ? fs.readdirSync(path.join(one.data, 'outbox')).length : 0 });
      return answers.shift() || [200, { deleted: 0, failed: [] }];
    },
  });
  t.after(async () => { await one.stop(); s.close(); });
  const b = await signUp('solo', { path: `/sign-up/${SETUP_KEY}` }, one);
  return { one, s, b, stateWhenAsked, erases: () => s.seen.filter((r) => r.url === '/api/boat/erase') };
}

test('a deletion request that the outbox refuses deletes no machine on boat.dev', async (t) => {
  const { one, b, erases } = await managed(t, []);
  fs.writeFileSync(path.join(one.data, 'outbox'), 'a file where the folder goes'); // the outbox can't be written
  const done = await b.post('/front-door/delete-account', { name: 'solo' });
  assert.equal(done.status, 503, done.text);
  assert.equal(erases().length, 0, 'its machines on boat.dev are untouched');
  assert.equal((await b.get('/front-door/session')).status, 200, 'still signed in: not suspended');
  const state = JSON.parse(fs.readFileSync(path.join(one.data, 'front-door.json'), 'utf8')).accounts.solo;
  assert.ok(!state.suspended && !state.deleting);
  fs.rmSync(path.join(one.data, 'outbox'));
  assert.equal((await b.post('/front-door/delete-account', { name: 'solo' })).status, 200, 'it works once the outbox does');
  assert.equal(erases().length, 1);
});

test('a request is in the outbox and the account suspended before its machines on boat.dev are deleted, and a second request deletes nothing', async (t) => {
  const { b, erases, stateWhenAsked } = await managed(t, [[200, { deleted: 2, failed: [{ id: 'bx_aaaaaaa1', error: 'boat.dev answered 500 (internal)' }] }]]);
  const done = await b.post('/front-door/delete-account', { name: 'solo' });
  assert.equal(done.status, 200, done.text);
  assert.deepEqual(done.data, { ok: true, requested: true, deleted: '/front-door/deleting', boat: 'boat.dev: 1 machine not deleted (boat.dev answered 500 (internal)), 2 deleted' });
  assert.equal(erases().length, 1);
  assert.deepEqual(stateWhenAsked, [{ suspended: true, deleting: true, outbox: 1 }], 'asked once the request was kept and the account suspended');
  assert.deepEqual(JSON.parse(erases()[0].body || '{}'), {}, 'every machine goes, with the key that made it');

  assert.equal((await b.post('/front-door/delete-account', { name: 'solo' })).status, 401, 'signed out: the owner asks no more');
  assert.equal(erases().length, 1);
});

test("the console's resume drops the request; the account asks again and its machines are asked about again", async (t) => {
  const { one, b, erases, stateWhenAsked } = await managed(t, [[200, { deleted: 1, failed: [] }], [200, { deleted: 0, failed: [] }]]);
  assert.equal((await b.post('/front-door/delete-account', { name: 'solo' })).status, 200);
  assert.equal(erases().length, 1);

  // The console resumes it instead of erasing the machine: the request is dropped, and the machines that were deleted
  // stay deleted (the owner asked for it). Nothing asks the account's machines a second time by itself.
  const store = require('../lib/front-door/store').open(one.data);
  store.setSuspended('solo', false);
  assert.equal(store.deletingSince('solo'), null);
  assert.equal(erases().length, 1);

  const again = one.browser();
  const options = await again.post('/sign-in/options', {});
  const si = await again.post('/sign-in', { credential: keys.solo.signIn(options.data.publicKey) });
  assert.equal((await again.post('/sign-in/agree', { agreement: si.data.agreement, feedback: false })).status, 200, 'signed in again');
  assert.equal((await again.post('/front-door/delete-account', { name: 'solo' })).status, 200, 'a new request is taken');
  assert.equal(erases().length, 2, 'and its machines are asked about again');
  assert.equal(stateWhenAsked.length, 2);
  assert.ok(stateWhenAsked.every((s) => s.suspended && s.deleting && s.outbox >= 1));
});
