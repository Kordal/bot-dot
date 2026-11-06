// How many more accounts the machine takes, and a maximum (#912): room is what a new account takes against the RAM and
// disk the machine has free, as root's step measured them (FRONT_DOOR_LOAD); a sign-up link on a full machine makes no
// account and stays open; the admin's install link always works; the maximum and each refused sign-up are in the
// audit log.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const capacity = require('../lib/front-door/capacity');

const GB = 2 ** 30;
let door, load;
const stands = {};
const browsers = {};
const dirs = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; };
before(async () => {
  load = tmp('fd-load-');
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_LOAD: load } });
  stands.ann = await standIn(door, 'ann', { answer: () => [200, { account: 'ann' }] });
  browsers.ann = await signUp(door, 'ann', door.firstLink);
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const pathOf = (link) => (typeof link === 'string' ? new URL(link).pathname : link.path);
async function signUp(d, name, link) {
  const r = await trySignUp(d, name, link);
  assert.equal(r.done.status, 201, r.done.text);
  return r.b;
}
async function trySignUp(d, name, link) {
  const p = pathOf(link);
  const b = d.browser();
  const key = passkey.create({ rpId: d.rpId, origin: d.origin });
  const options = await b.post(`${p}/options`, { name });
  if (options.status !== 200) return { b, options, done: options };
  return { b, options, done: await b.post(p, { name, credential: key.register(options.data.publicKey) }) };
}
// The machine as root's step measured it now, in GB.
const machine = (dir, { ram, ramUsed, disk, diskUsed }) => fs.writeFileSync(path.join(dir, 'machine.json'),
  JSON.stringify({ at: new Date().toISOString(), cpus: 8, load: 0.5, ramTotal: ram * GB, ramUsed: ramUsed * GB, diskTotal: disk * GB, diskUsed: diskUsed * GB }));
const capacityNow = async () => {
  const r = await browsers.ann.get('/admin/capacity');
  assert.equal(r.status, 200, r.text);
  return r.data;
};
const audit = async (action) => (await browsers.ann.get(`/admin/audit?action=${action}`)).data.entries;

test('room is the new accounts that fit the RAM and disk free now, and unknown without a measurement', () => {
  const m = { ramTotal: 32 * GB, ramUsed: 8 * GB, diskTotal: 200 * GB, diskUsed: 120 * GB };
  // RAM: 24 GB free, 8 accounts of 3 GB; disk: 80 GB free, 8 accounts of 10 GB.
  assert.equal(capacity.room(m), 8);
  // The tighter of the two.
  assert.equal(capacity.room({ ...m, ramUsed: 27 * GB }), 1, '5 GB of RAM free');
  assert.equal(capacity.room({ ...m, diskUsed: 175 * GB }), 2, '25 GB of disk free');
  assert.equal(capacity.room({ ...m, diskUsed: 195 * GB }), 0, 'less than 10 GB of disk free');
  // Never less than none.
  assert.equal(capacity.room({ ...m, ramUsed: 40 * GB }), 0);
  // Nothing measured: unknown.
  assert.equal(capacity.room(null), null);
  assert.equal(capacity.room({ ramTotal: 32 * GB, diskTotal: 200 * GB }), null);
  // Full: no room, or the maximum reached; unknown room refuses nothing.
  assert.equal(capacity.full({ room: 0, max: null, accounts: 1 }), true);
  assert.equal(capacity.full({ room: null, max: null, accounts: 9 }), false);
  assert.equal(capacity.full({ room: null, max: 2, accounts: 2 }), true);
  assert.equal(capacity.full({ room: 3, max: 3, accounts: 2 }), false);
});

test('with no load measured, room is unknown and a sign-up link makes an account', async () => {
  const c = await capacityNow();
  assert.deepEqual(c, { room: null, max: null, accounts: 1, full: false });
  stands.bob = await standIn(door, 'bob', { answer: () => [200, { account: 'bob' }] });
  browsers.bob = await signUp(door, 'bob', (await browsers.ann.post('/admin/links', {})).data.url);
  assert.equal((await capacityNow()).accounts, 2);
});

test('room follows the RAM and disk the machine has free', async () => {
  machine(load, { ram: 16, ramUsed: 4, disk: 100, diskUsed: 60 });
  assert.deepEqual(await capacityNow(), { room: 4, max: null, accounts: 2, full: false });
  machine(load, { ram: 16, ramUsed: 4, disk: 100, diskUsed: 85 });
  assert.equal((await capacityNow()).room, 1);
  machine(load, { ram: 16, ramUsed: 14, disk: 100, diskUsed: 60 });
  assert.deepEqual(await capacityNow(), { room: 0, max: null, accounts: 2, full: true });
});

test('a sign-up link on a full machine makes no account, says so, stays open, and works once there is room', async () => {
  machine(load, { ram: 16, ramUsed: 4, disk: 100, diskUsed: 95 });
  const { url } = (await browsers.ann.post('/admin/links', {})).data;
  const page = await door.browser().get(pathOf(url));
  assert.equal(page.status, 409);
  assert.match(page.text, /This machine is full/);
  assert.doesNotMatch(page.text, /Create my passkey/);
  const tried = await trySignUp(door, 'cat', url);
  assert.equal(tried.options.status, 409, tried.options.text);
  assert.equal(tried.options.data.full, true);
  assert.match(tried.options.data.error, /full/);
  const post = await door.browser().post(pathOf(url), { name: 'cat', credential: {} });
  assert.equal(post.status, 409);
  assert.ok(!(await browsers.ann.get('/admin/accounts')).data.accounts.some((a) => a.name === 'cat'));
  const links = (await browsers.ann.get('/admin/links')).data.links;
  assert.equal(links[0].state, 'open', 'the link stays open for later');
  // Refused sign-ups are in the audit log, one for this link however often it is opened.
  const refused = await audit('sign-up-refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].actor, 'front-door');
  assert.equal(refused[0].detail, 'no room on the machine');
  // Room again: the same link makes the account.
  machine(load, { ram: 16, ramUsed: 4, disk: 100, diskUsed: 60 });
  stands.cat = await standIn(door, 'cat', { answer: () => [200, { account: 'cat' }] });
  await signUp(door, 'cat', url);
  assert.equal((await capacityNow()).accounts, 3);
});

test('the maximum is kept, refuses sign-ups once reached, and is refused outside whole numbers or null', async () => {
  fs.rmSync(path.join(load, 'machine.json'), { force: true });
  for (const bad of [{}, { max: '3' }, { max: 1.5 }, { max: -1 }, { max: 100001 }, { max: true }]) {
    const r = await browsers.ann.post('/admin/capacity', bad);
    assert.equal(r.status, 400, `${JSON.stringify(bad)}: ${r.text}`);
    assert.equal(r.data.error, capacity.MAX_RULE);
  }
  const set = await browsers.ann.post('/admin/capacity', { max: 3 });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual(set.data, { room: null, max: 3, accounts: 3, full: true });
  const data = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.equal(data.maxAccounts, 3);
  const { url } = (await browsers.ann.post('/admin/links', {})).data;
  assert.equal((await trySignUp(door, 'dan', url)).options.status, 409);
  assert.equal((await audit('sign-up-refused'))[0].detail, 'the maximum of 3 accounts');
  const none = await browsers.ann.post('/admin/capacity', { max: null });
  assert.deepEqual(none.data, { room: null, max: null, accounts: 3, full: false });
  assert.equal(JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).maxAccounts, undefined);
  const entries = await audit('max-accounts');
  assert.deepEqual(entries.map((e) => [e.actor, e.detail]), [['ann', 'none'], ['ann', '3 accounts']]);
});

test("only the admin reaches the capacity, and a write needs the web page's header", async () => {
  for (const r of [await browsers.bob.get('/admin/capacity'), await browsers.bob.post('/admin/capacity', { max: 1 })]) assert.equal(r.status, 404, r.text);
  const bare = await browsers.ann.post('/admin/capacity', { max: 1 }, { 'X-Bot-Dot': '' });
  assert.equal(bare.status, 403, bare.text);
  assert.equal((await capacityNow()).max, null);
  assert.ok(!stands.bob.seen.some((s) => /capacity/.test(s.url)), 'nothing of it reaches a botdot server');
});

test("the admin page draws the room and the maximum under Sign-ups", async () => {
  const page = await browsers.ann.get('/admin');
  assert.match(page.text, /<section id="sign-up-links">[\s\S]*<form id="capacity"[\s\S]*<\/section>/);
  assert.match(page.text, /name="max" type="number"/);
  assert.match((await browsers.ann.get('/front-door/admin.js')).text, /'GET', '\/admin\/capacity'/);
});

test("the admin's install link works on a full machine", async () => {
  const full = tmp('fd-load-');
  machine(full, { ram: 4, ramUsed: 3, disk: 10, diskUsed: 9 });
  const d = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'eve', FRONT_DOOR_LOAD: full } });
  const stand = await standIn(d, 'eve', { answer: () => [200, { account: 'eve' }] });
  try {
    const eve = await signUp(d, 'eve', d.firstLink);
    const c = (await eve.get('/admin/capacity')).data;
    assert.equal(c.room, 0);
    assert.equal(c.full, true);
    const { url } = (await eve.post('/admin/links', {})).data;
    assert.equal((await d.browser().get(pathOf(url))).status, 409);
  } finally {
    stand.close();
    await d.stop();
  }
});
