// "Delete account" in Settings (#1307): a signed-in owner deletes their own account the same way the admin does on the
// admin page, after typing its name. The front door forgets it, its passkeys, its sessions and its open sign-in links
// at once, asks the machine to erase the rest and keeps an audit entry by the account itself. The admin's own account,
// the only admin, is never deleted this way, and a machine of one account or a managed one offers it to nobody.
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
for (const [what, env] of [['a machine of one account', {}], ['a managed machine', { FRONT_DOOR_MANAGED: '1' }]]) {
  test(`${what} offers it to nobody: there the account is the machine`, async (t) => {
    const one = await startFrontDoor({ env: { ...env, FRONT_DOOR_ONE_ACCOUNT: 'solo', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
    const s = await standIn(one, 'solo', { answer: () => [200, { account: 'solo' }] });
    t.after(async () => { await one.stop(); s.close(); });
    const b = await signUp('solo', { path: `/sign-up/${SETUP_KEY}` }, one);
    assert.equal((await b.get('/front-door/session')).data.deleteAccount, false);
    assert.equal((await b.post('/front-door/delete-account', { name: 'solo' })).status, 404);
    assert.equal((await b.get('/front-door/session')).status, 200, 'still signed in');
  });
}

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
