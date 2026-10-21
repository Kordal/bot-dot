// Each account's owner chooses when their account switches to a new version (#259, ADR 053). The front door keeps the
// owner's "Update automatically", shows what root's step says of the account (STATUS/account-<name>.json), and asks for
// one account's switch with an empty file SWITCH-<name>: from its owner's Settings, from the admin page, or by itself
// past the admin's deadline. No botdot server sees any of it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const DAY = 24 * 3600_000;
let door, requests, status;
const stands = {};
before(async () => {
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status } });
  stands.ann = await standIn(door, 'ann');
  // bob's botdot server is the version before the front door's: it answers as that version does.
  stands.bob = await standIn(door, 'bob', { answer: (req) => (req.url === '/api/version' ? [200, { version: '0123456', features: ['accounts'] }] : null) });
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
const said = (name, value) => fs.writeFileSync(path.join(status, name), typeof value === 'string' ? value : JSON.stringify(value));
const asked = () => fs.readdirSync(requests).sort();
const clear = () => { for (const f of fs.readdirSync(requests)) fs.rmSync(path.join(requests, f)); };
const kept = () => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
const seen = () => Object.values(stands).map((s) => s.seen.length).join();

test("every account's owner chooses, the admin's own too (#274)", async () => {
  const b = await bob();
  const a = await admin();
  assert.equal((await b.get('/front-door/session')).data.updates, true);
  assert.equal((await a.get('/front-door/session')).data.updates, true);
  const own = await a.get('/front-door/update');
  assert.equal(own.status, 200, own.text);
  assert.equal(own.data.autoUpdate, true);
  clear();
  const off = await a.post('/front-door/update', { autoUpdate: false });
  assert.equal(off.data.autoUpdate, false);
  assert.equal(kept().accounts.ann.autoUpdate, false, "the admin's account keeps it as any other");
  const since = new Date().toISOString();
  said('account-ann.json', { state: 'waiting', at: since, since, version: 'abc1234' });
  const now = await a.post('/front-door/update/now', {});
  assert.equal(now.status, 202, now.text);
  assert.deepEqual(asked(), ['SWITCH-ann']);
  clear();
  fs.rmSync(path.join(status, 'account-ann.json'));
  await a.post('/front-door/update', { autoUpdate: true });
  assert.equal((await door.browser().get('/front-door/update')).status, 401, 'nobody signed in');
});

test('"Update automatically" is on until its owner turns it off, and the front door keeps it', async () => {
  const b = await bob();
  const was = seen();
  let u = await b.get('/front-door/update');
  assert.equal(u.status, 200, u.text);
  assert.deepEqual(u.data, { autoUpdate: true, asked: false, canUpdate: false, ready: null, last: null });
  u = await b.post('/front-door/update', { autoUpdate: false });
  assert.equal(u.status, 200, u.text);
  assert.equal(u.data.autoUpdate, false);
  assert.equal(kept().accounts.bob.autoUpdate, false, 'as root\'s step reads it');
  assert.equal((await b.post('/front-door/update', { autoUpdate: 'no' })).status, 400);
  assert.equal((await b.post('/front-door/update', { autoUpdate: true })).data.autoUpdate, true);
  assert.equal(kept().accounts.bob.autoUpdate, undefined, 'on is no field');
  await b.post('/front-door/update', { autoUpdate: false });
  assert.equal(seen(), was, 'no botdot server saw any of it');
});

test('a version that waits shows when it came and its deadline, and "Update now" asks the machine once', async () => {
  const b = await bob();
  clear();
  const since = new Date(Date.now() - DAY).toISOString();
  said('account-bob.json', { state: 'waiting', at: since, since, version: 'abc1234', from: '0123456', extra: 'not shown' });
  let u = (await b.get('/front-door/update')).data;
  assert.deepEqual(u.ready, { version: 'abc1234', from: '0123456', since, deadline: new Date(Date.parse(since) + 7 * DAY).toISOString() });
  assert.equal(u.canUpdate, true);
  assert.equal(u.last, null);

  const now = await b.post('/front-door/update/now', {});
  assert.equal(now.status, 202, now.text);
  assert.deepEqual(asked(), ['SWITCH-bob'], 'a file no account can be named');
  assert.equal(fs.readFileSync(path.join(requests, 'SWITCH-bob'), 'utf8').trim().length > 0, true);
  assert.equal(now.data.asked, true);
  assert.equal(now.data.canUpdate, false);
  assert.equal((await b.post('/front-door/update/now', {})).status, 409, 'asked already');

  // Root's step switched it.
  clear();
  said('account-bob.json', { state: 'updated', at: new Date().toISOString() });
  u = (await b.get('/front-door/update')).data;
  assert.equal(u.ready, null);
  assert.equal(u.last.state, 'updated');
  assert.equal((await b.post('/front-door/update/now', {})).status, 409, 'nothing to switch to');
});

test('a switch that didn\'t happen says why, and may be asked again; one that never ended shows as failed', async () => {
  const b = await bob();
  clear();
  said('account-bob.json', { state: 'kept', at: '2026-10-21T10:00:00Z', error: 'Its new botdot server didn\'t start.\u001b[31m' });
  let u = (await b.get('/front-door/update')).data;
  assert.deepEqual(u.last, { state: 'kept', at: '2026-10-21T10:00:00.000Z', error: 'Its new botdot server didn\'t start. [31m' });
  assert.equal(u.canUpdate, true);
  said('account-bob.json', { state: 'switching', at: new Date(Date.now() - 4 * 3600_000).toISOString() });
  u = (await b.get('/front-door/update')).data;
  assert.equal(u.last.state, 'failed');
  assert.match(u.last.error, /didn't finish/);
  said('account-bob.json', { state: 'switching', at: new Date().toISOString() });
  assert.equal((await b.get('/front-door/update')).data.canUpdate, false, 'while it switches');
  for (const wrong of ['not JSON', { state: 'done' }, { state: 'waiting', since: 'never' }]) {
    said('account-bob.json', wrong);
    u = (await b.get('/front-door/update')).data;
    assert.equal(u.ready, null);
    assert.equal(u.last, null);
  }
  fs.rmSync(path.join(status, 'account-bob.json'));
});

test('past the deadline the front door asks for the switch itself, and the admin sets the deadline', async () => {
  const a = await admin();
  const b = await bob();
  clear();
  const since = new Date(Date.now() - 3 * DAY).toISOString();
  said('account-bob.json', { state: 'waiting', at: since, since, version: 'abc1234' });
  await b.get('/front-door/update');
  assert.deepEqual(asked(), [], 'within the 7 days');
  assert.equal((await a.post('/admin/update/days', { days: 0 })).status, 400);
  assert.equal((await a.post('/admin/update/days', { days: 61 })).status, 400);
  const set = await a.post('/admin/update/days', { days: 2 });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.data.days, 2);
  assert.equal((await a.get('/admin/update')).data.days, 2);
  assert.deepEqual(asked(), ['SWITCH-bob'], 'past the 2 days now');
  assert.match(door.log.join(''), /bob waited past its deadline/);
  clear();
  await a.post('/admin/update/days', { days: 7 });
  fs.rmSync(path.join(status, 'account-bob.json'));
});

test('the admin page lists what waits on each account, and its "Update now" asks for that account alone', async () => {
  const a = await admin();
  await bob();
  clear();
  const since = new Date().toISOString();
  said('account-bob.json', { state: 'waiting', at: since, since, version: 'abc1234' });
  const { accounts } = (await a.get('/admin/accounts')).data;
  assert.equal(accounts.find((x) => x.name === 'ann').update.autoUpdate, true, "the admin's own has one too (#274)");
  const listed = accounts.find((x) => x.name === 'bob').update;
  assert.equal(listed.autoUpdate, false);
  assert.equal(listed.ready.version, 'abc1234');
  const now = await a.post('/admin/accounts/bob/update', {});
  assert.equal(now.status, 202, now.text);
  assert.deepEqual(asked(), ['SWITCH-bob']);
  assert.equal((await a.post('/admin/accounts/ann/update', {})).status, 409, "the admin's own waits for nothing");
  assert.equal((await (await bob()).post('/admin/accounts/bob/update', {})).status, 404, 'only the admin');
  const page = (await a.get('/front-door/admin.js')).text;
  assert.match(page, /Update now/);
  assert.match(page, /waits for its owner on /);
  assert.match((await a.get('/admin')).text, /id="update-days"/);
  clear();
  fs.rmSync(path.join(status, 'account-bob.json'));
});

test("an update's accounts that wait are named as waiting, with the version they run", async () => {
  const a = await admin();
  said('update.json', { state: 'updated', at: '2026-10-21T10:05:00Z', from: '0123456', to: 'abc1234', accounts: [
    { name: 'ann', result: 'updated' },
    { name: 'bob', result: 'waiting', version: '0123456', error: 'not shown' },
  ] });
  assert.deepEqual((await a.get('/admin/update')).data.update.accounts, [{ name: 'ann', result: 'updated' }, { name: 'bob', result: 'waiting', version: '0123456' }]);
  fs.rmSync(path.join(status, 'update.json'));
});

test('the front door on the new version serves an account still on the version before as any other', async () => {
  const b = await bob();
  const since = new Date().toISOString();
  said('account-bob.json', { state: 'waiting', at: since, since, version: 'abc1234', from: '0123456' });
  // Its own botdot server answers, as the version it runs.
  const version = await b.get('/api/version');
  assert.equal(version.status, 200, version.text);
  assert.equal(version.data.version, '0123456');
  const passed = await b.post('/api/bots', { name: 'x' });
  assert.equal(passed.status, 200);
  assert.equal(stands.bob.seen.at(-1).headers['x-botdot-account'], 'bob');
  const ws = await door.upgrade('/api/stream', { Cookie: b.cookie() });
  assert.match(ws, /^HTTP\/1\.1 101/);
  assert.match(ws, /Account: bob/);
  // And the front door's own routes are the same for it.
  assert.equal((await b.get('/front-door/session')).data.updates, true);
  assert.equal((await b.get('/front-door/update')).data.ready.from, '0123456');
  fs.rmSync(path.join(status, 'account-bob.json'));
});

test('a suspended account asks nothing, and the front door asks for no switch of it past the deadline', async () => {
  const a = await admin();
  const b = await bob();
  clear();
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  said('account-bob.json', { state: 'waiting', at: since, since, version: 'abc1234' });
  assert.equal((await a.post('/admin/accounts/bob/suspend', {})).status, 200);
  clear(); // the suspend's own request
  assert.equal((await b.post('/front-door/update/now', {})).status, 503);
  await a.get('/admin/accounts');
  assert.deepEqual(asked(), []);
  assert.equal((await a.post('/admin/accounts/bob/resume', {})).status, 200);
  clear();
  fs.rmSync(path.join(status, 'account-bob.json'));
});
