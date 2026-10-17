// The admin page's update (#473, ADR 028): one action updates the front door and every account together. The front
// door only asks for it, with an empty file named UPDATE in FRONT_DOOR_REQUESTS that no account can be named, and
// shows what root's step (install.sh) says back in FRONT_DOOR_STATUS: the version installed and the last update.
// Only the admin's session reaches it, and no botdot server sees any of it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const store = require('../lib/front-door/store');

let door, requests, status;
const stands = {};
before(async () => {
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status } });
  stands.ann = await standIn(door, 'ann');
  stands.bob = await standIn(door, 'bob');
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  fs.rmSync(requests, { recursive: true, force: true });
  fs.rmSync(status, { recursive: true, force: true });
});

async function signUp(name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
let annB = null, bobB = null;
const admin = async () => (annB ||= await signUp('ann', door.firstLink));
const bob = async () => (bobB ||= await signUp('bob', door.newLink()));
const seen = () => Object.values(stands).map((s) => s.seen.length).join();
const said = (name, value) => fs.writeFileSync(path.join(status, name), typeof value === 'string' ? value : JSON.stringify(value));
const asked = () => fs.readdirSync(requests);

test('the admin page has the update, one button for every account', async () => {
  const b = await admin();
  const page = await b.get('/admin');
  assert.match(page.text, /<h2>Update<\/h2>/);
  assert.match(page.text, /<button id="update" type="button">Update every account<\/button>/);
  const script = await b.get('/front-door/admin.js');
  assert.match(script.text, /'\/admin\/update'/);
  assert.match(script.text, /The front door and every account restart on the newest version/);
});

test('before root\'s step said anything, the page knows no version and no update', async () => {
  const b = await admin();
  const was = seen();
  const u = await b.get('/admin/update');
  assert.equal(u.status, 200, u.text);
  assert.deepEqual(u.data, { version: null, selfBuilt: false, asked: false, update: null });
  assert.equal(seen(), was, 'no botdot server saw it');
});

test('the version and the last update are what root\'s step wrote, field by field', async () => {
  const b = await admin();
  said('version.json', { version: 'abc1234', selfBuilt: true, at: '2026-10-16T10:00:00Z' });
  said('update.json', { state: 'updated', at: '2026-10-16T10:05:00Z', from: '0123456', to: 'abc1234', extra: 'not shown' });
  let u = (await b.get('/admin/update')).data;
  assert.deepEqual(u, { version: 'abc1234', selfBuilt: true, asked: false, update: { state: 'updated', at: '2026-10-16T10:05:00.000Z', from: '0123456', to: 'abc1234' } });

  said('update.json', { state: 'failed', at: '2026-10-16T10:05:00Z', from: 'abc1234', to: 'abc1234', error: 'Couldn\'t download it.\u001b[31m' });
  u = (await b.get('/admin/update')).data;
  assert.equal(u.update.state, 'failed');
  assert.equal(u.update.error, 'Couldn\'t download it. [31m', 'a line of plain text');

  // Anything else is not taken as it is.
  said('version.json', { version: '<b>1.0</b>', selfBuilt: 'yes' });
  said('update.json', { state: 'done', at: 'never' });
  u = (await b.get('/admin/update')).data;
  assert.deepEqual(u, { version: null, selfBuilt: false, asked: false, update: null });
  said('update.json', 'not JSON');
  assert.equal((await b.get('/admin/update')).data.update, null);
});

test('an update root\'s step never ended (the machine restarted) shows as stopped, not as going on forever', async () => {
  const b = await admin();
  said('update.json', { state: 'updating', at: new Date().toISOString(), from: 'abc1234' });
  assert.equal((await b.get('/admin/update')).data.update.state, 'updating');
  said('update.json', { state: 'updating', at: new Date(Date.now() - 4 * 3600_000).toISOString(), from: 'abc1234' });
  const u = (await b.get('/admin/update')).data;
  assert.equal(u.update.state, 'failed');
  assert.match(u.update.error, /didn't finish/);
  fs.rmSync(path.join(status, 'update.json'));
});

test('Update asks the machine once, with a file no account can be named, and says it is asked', async () => {
  const b = await admin();
  const was = seen();
  const first = await b.post('/admin/update', {});
  assert.equal(first.status, 202, first.text);
  assert.equal(first.data.asked, true);
  assert.deepEqual(asked(), ['UPDATE']);
  assert.ok(!store.ACCOUNT_NAME.test('UPDATE'), 'no account is named so');
  // Not hidden: systemd's DirectoryNotEmpty, which starts root's step, skips files whose name starts with a dot.
  assert.ok(!asked()[0].startsWith('.'));
  const again = await b.post('/admin/update', {});
  assert.equal(again.status, 202);
  assert.deepEqual(asked(), ['UPDATE'], 'one request, however often it is asked');
  assert.equal((await b.get('/admin/update')).data.asked, true);
  assert.equal(seen(), was, 'no botdot server saw it');
  assert.match(door.log.join(''), /the admin asked to update botdot: the front door and every account/);
  fs.rmSync(path.join(requests, 'UPDATE'));
  assert.equal((await b.get('/admin/update')).data.asked, false);
});

test('only the admin\'s session reaches the update: another account is answered as if there were none', async () => {
  const b = await bob();
  const was = stands.bob.seen.length;
  assert.equal((await b.get('/admin/update')).status, 404);
  assert.equal((await b.post('/admin/update', {})).status, 404);
  assert.deepEqual(asked().filter((f) => f === 'UPDATE'), []);
  assert.equal(stands.bob.seen.length, was, 'not passed to its botdot server either');
  const nobody = door.browser();
  assert.equal((await nobody.post('/admin/update', {})).status, 401);
  // A write from another site's page, without the header.
  const a = await admin();
  assert.equal((await a.post('/admin/update', {}, { 'X-Bot-Dot': '' })).status, 403);
  assert.deepEqual(asked().filter((f) => f === 'UPDATE'), []);
});

test('without a requests folder the front door cannot ask, and says how else to update', async () => {
  const other = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  try {
    const b = other.browser();
    const key = passkey.create({ rpId: other.rpId, origin: other.origin });
    const options = await b.post(`${other.firstLink.path}/options`, { name: 'ann' });
    await b.post(other.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) });
    const u = await b.post('/admin/update', {});
    assert.equal(u.status, 409);
    assert.match(u.data.error, /Run its installer again/);
  } finally { await other.stop(); }
});
