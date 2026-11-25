// The front door switches each account when it is idle, at the time its owner chose (#1689, ADR 271), on a machine of
// several accounts: each minute it asks each account that waits for its idle answer (GET /api/update/idle, as the front
// door, #1688) and, by lib/front-door/switch-plan.js, asks root's step for the switch with an empty file SWITCH-<name>
// (ADR 053). Its tick is every 100 ms here.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { waitFor } = require('./helpers');
const { startFrontDoor, standIn, zoneWhere, updateAnswers } = require('./front-door-helpers');

const DAY = 24 * 3600_000;
let door, requests, status, ann, bob;
// What the stand-in accounts answer now: bob's idle answer (true, false or null for "no such route") and quiet hours.
const now = { idle: true, quietHours: { start: 22, end: 9, timeZone: 'UTC' } };
before(async () => {
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status, FRONT_DOOR_SWITCH_EVERY_MS: '100' } });
  ann = await standIn(door, 'ann', { answer: updateAnswers({ idle: () => now.idle, quietHours: () => now.quietHours }) });
  bob = await standIn(door, 'bob', { answer: updateAnswers({ idle: () => now.idle, quietHours: () => now.quietHours }) });
});
after(async () => {
  await door?.stop();
  ann?.close();
  bob?.close();
  fs.rmSync(requests, { recursive: true, force: true });
  fs.rmSync(status, { recursive: true, force: true });
});

async function signUp(name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
let annB = null, bobB = null;
const admin = async () => (annB ||= await signUp('ann', door.firstLink));
const owner = async () => (bobB ||= await signUp('bob', door.newLink()));
const said = (name, value) => fs.writeFileSync(path.join(status, name), JSON.stringify(value));
let versions = 0; // each wait is for a version of its own: "Tonight" is kept for one
const waits = (since = new Date(), version = `abc${String(++versions).padStart(4, '0')}`) => said('account-bob.json', { state: 'waiting', at: new Date(since).toISOString(), since: new Date(since).toISOString(), version, from: '0123456' });
const asked = () => fs.readdirSync(requests).sort();
const clear = () => { for (const f of fs.readdirSync(requests)) fs.rmSync(path.join(requests, f)); fs.rmSync(path.join(status, 'account-bob.json'), { force: true }); fs.rmSync(path.join(status, 'update.json'), { force: true }); };
const quiet = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const idleSeen = () => bob.seen.filter((r) => r.url === '/api/update/idle');
const setWhen = async (when) => assert.equal((await (await owner()).post('/front-door/update', { when })).status, 200);
beforeEach(async () => {
  clear();
  now.idle = true;
  now.quietHours = { start: 22, end: 9, timeZone: zoneWhere(13, 19) };
  await setWhen('night'); // the default, as each test begins
  bob.seen.length = 0;
});

test('"as soon as it\'s ready": switched at the first idle check; busy, it is asked again until it is idle', async () => {
  await setWhen('ready');
  now.idle = false;
  waits();
  await waitFor(() => idleSeen().length >= 2, { what: 'the account asked more than once' });
  assert.deepEqual(asked(), [], 'busy: it never forces');
  const first = idleSeen()[0];
  assert.equal(first.method, 'GET');
  assert.equal(first.headers['x-botdot-room'], '1', 'as the front door, which the account\'s server needs');
  assert.equal(first.headers['x-botdot-account'], 'bob');
  now.idle = true;
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'the switch asked' });
  assert.deepEqual(asked(), ['SWITCH-bob']);
  assert.match(door.log.join(''), /asked to switch the account bob to the new version: idle\n/);
  const a = await admin();
  const entry = (await a.get('/admin/audit?action=update-switch')).data.entries[0];
  assert.deepEqual([entry.actor, entry.action, entry.account, entry.detail], ['front-door', 'update-switch', 'bob', 'idle']);
});

test('the account\'s own verdict decides, and one that says nothing counts as busy', async () => {
  await setWhen('ready');
  waits();
  now.idle = null; // a botdot server older than the route
  await waitFor(() => idleSeen().length >= 2, { what: 'asked' });
  assert.deepEqual(asked(), []);
  // A server that is not there at all.
  bob.close();
  await quiet(300);
  assert.deepEqual(asked(), [], 'not answering');
  // Its server answers again, idle.
  Object.assign(bob, await standIn(door, 'bob', { answer: updateAnswers({ idle: () => now.idle, quietHours: () => now.quietHours }) }));
  now.idle = true;
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'the switch asked once it answers idle' });
});

test('"at night, when idle" (the default): not by day, and by night when it is idle', async () => {
  waits();
  await quiet();
  assert.deepEqual(asked(), [], 'it is day in the owner\'s time zone');
  now.quietHours = { start: 22, end: 9, timeZone: zoneWhere(5, 7) };
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'switched in the night' });
  assert.match(door.log.join(''), /to the new version: idle, at night\n/);
});

test('busy all night: not switched, and tried again', async () => {
  now.quietHours = { start: 22, end: 9, timeZone: zoneWhere(5, 7) };
  now.idle = false;
  waits();
  await waitFor(() => idleSeen().length >= 3, { what: 'asked again and again' });
  assert.deepEqual(asked(), []);
});

test('"when I say": never, until its owner says Tonight for this version; then at night when idle', async () => {
  const b = await owner();
  await setWhen('manual');
  now.quietHours = { start: 22, end: 9, timeZone: zoneWhere(5, 7) };
  waits();
  await quiet();
  assert.deepEqual(asked(), [], 'the owner decides');
  assert.equal(idleSeen().length, 0, 'and no one is asked');
  assert.equal((await b.get('/front-door/update')).data.plan, null);
  // Tonight.
  const u = await b.post('/front-door/update', { plan: 'night' });
  assert.equal(u.status, 200, u.text);
  assert.equal(u.data.plan, 'night');
  assert.equal(u.data.when, 'manual', '"Tonight" is not a "when": the choice stays');
  assert.equal((await b.get('/front-door/update')).data.plan, 'night');
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'switched in the night' });
  // Kept per version: the next version waits for the owner again.
  clear();
  waits(new Date(), 'def5678');
  assert.equal((await b.get('/front-door/update')).data.plan, null);
  await quiet();
  assert.deepEqual(asked(), []);
});

test('"Tonight" by day waits for the night; it asks nothing of a version that does not wait, and takes only "night"', async () => {
  const b = await owner();
  await setWhen('manual');
  assert.equal((await b.post('/front-door/update', { plan: 'night' })).status, 409, 'nothing waits');
  waits();
  for (const wrong of ['now', '', null, true, ['night']]) assert.equal((await b.post('/front-door/update', { plan: wrong })).status, 400, JSON.stringify(wrong));
  assert.equal((await b.post('/front-door/update', { plan: 'night' })).data.plan, 'night');
  await quiet();
  assert.deepEqual(asked(), [], 'it is day');
  // With `when` in the same call, `when` is chosen too.
  const both = await b.post('/front-door/update', { when: 'ready', plan: 'night' });
  assert.deepEqual([both.data.when, both.data.plan], ['ready', 'night']);
  await setWhen('manual');
  assert.equal((await door.browser().post('/front-door/update', { plan: 'night' })).status, 401, 'nobody signed in');
});

test('past the deadline: the first idle check whatever the choice or the hour; a day past it, switched anyway', async () => {
  await setWhen('manual');
  now.idle = false;
  waits(Date.now() - 7.1 * DAY);
  await waitFor(() => idleSeen().length >= 2, { what: 'asked: the owner\'s choice no longer counts' });
  assert.deepEqual(asked(), [], 'busy, within the 24 hours');
  now.idle = true;
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'switched at the first idle check' });
  assert.match(door.log.join(''), /to the new version: idle, past the deadline\n/);
  clear();
  now.idle = false;
  const before = idleSeen().length;
  waits(Date.now() - 8.1 * DAY);
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'switched anyway' });
  assert.match(door.log.join(''), /to the new version: past the deadline\n/);
  assert.equal(idleSeen().length, before, 'no one is asked: it switches whatever it answers');
});

test('a look at the admin page or Settings switches at once the account a day past its deadline, and waits for no account to answer', async () => {
  const a = await admin();
  const b = await owner();
  await setWhen('manual');
  now.idle = false;
  waits(Date.now() - 8.1 * DAY);
  await b.get('/front-door/update');
  assert.ok(asked().includes('SWITCH-bob'), 'asked by the look itself');
  clear();
  waits(Date.now() - 7.1 * DAY);
  const before = idleSeen().length;
  await a.get('/admin/accounts');
  assert.deepEqual(asked(), [], 'past the deadline, not a day: it needs the idle answer, which the tick asks');
  assert.equal(idleSeen().length, before, 'a look asks no account');
});

test('nothing is switched while an update is asked or going, and the switch is not asked twice', async () => {
  await setWhen('ready');
  waits();
  fs.writeFileSync(path.join(requests, 'UPDATE'), '');
  await quiet();
  assert.deepEqual(asked(), ['UPDATE'], 'the admin\'s update is asked: root\'s step does its part first');
  fs.rmSync(path.join(requests, 'UPDATE'));
  said('update.json', { state: 'updating', at: new Date().toISOString(), from: '0123456', to: 'abc1234', phase: 'download' });
  await quiet();
  assert.deepEqual(asked(), [], 'going');
  fs.rmSync(path.join(status, 'update.json'));
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'switched once the update has ended' });
  // Asked, and root's step has not taken it yet: nothing more is asked.
  const text = fs.readFileSync(path.join(requests, 'SWITCH-bob'), 'utf8');
  await quiet(400);
  assert.equal(fs.readFileSync(path.join(requests, 'SWITCH-bob'), 'utf8'), text, 'the same request');
  // Taken and the account says it is switching: not asked again either.
  fs.rmSync(path.join(requests, 'SWITCH-bob'));
  said('account-bob.json', { state: 'switching', at: new Date().toISOString() });
  await quiet(400);
  assert.deepEqual(asked(), []);
});

test('a suspended account is not asked, and an account that does not wait is not either', async () => {
  const a = await admin();
  await setWhen('ready');
  clear();
  await quiet(400);
  assert.equal(idleSeen().length, 0, 'nothing waits');
  waits();
  assert.equal((await a.post('/admin/accounts/bob/suspend', {})).status, 200);
  clear();
  waits();
  const before = idleSeen().length;
  await quiet(400);
  assert.deepEqual(asked(), []);
  assert.equal(idleSeen().length, before);
  assert.equal((await a.post('/admin/accounts/bob/resume', {})).status, 200);
  clear();
});
