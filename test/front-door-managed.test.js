// A managed machine (FRONT_DOOR_MANAGED, ADR 154, #983): the fleet console is its admin, so the front door has no admin
// page (/admin and /admin/… are 404) and no admin, and each account has a guaranteed share that a new one must fit
// beside the others'. One account (FRONT_DOOR_ONE_ACCOUNT) or several (FRONT_DOOR_FIRST_ACCOUNT), the first made with
// the setup key either way, on a public origin as on a tailnet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const capacity = require('../lib/front-door/capacity');

const GB = 2 ** 30;
const SETUP_KEY = crypto.randomBytes(32).toString('base64url');
const ORIGIN = 'https://bots.example.com';
// What a VPS's /proc/meminfo calls 12 and 24 GB: a little less.
const VPS6 = { cpus: 6, ramTotal: 11.7 * GB };
const VPS8 = { cpus: 8, ramTotal: 23.4 * GB };

function loadDir(t, m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-load-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'machine.json'), JSON.stringify({ at: new Date().toISOString(), load: 0.2, ramUsed: 2 * GB, diskTotal: 100 * GB, diskUsed: 20 * GB, ...m }));
  return dir;
}
async function signUp(door, p, body) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, body);
  if (options.status !== 200) return { b, done: options };
  return { b, key, done: await b.post(p, { ...body, credential: key.register(options.data.publicKey) }) };
}

test('room on a managed machine is its shares against what it has, less a reserve of 2 GB of RAM', () => {
  assert.equal(capacity.roomByShares(VPS6, []), 1, 'a Cloud VPS 6 holds one account');
  assert.equal(capacity.roomByShares(VPS8, []), 2, 'a Cloud VPS 8 two');
  assert.equal(capacity.roomByShares(VPS8, [{ cpu: 4, ram: 8 }]), 1);
  assert.equal(capacity.roomByShares(VPS8, [{ cpu: 4, ram: 8 }, { cpu: 4, ram: 8 }]), 0);
  assert.equal(capacity.roomByShares({ cpus: 4, ramTotal: 9.7 * GB }, []), 0, '8 GB of share and the reserve don\'t fit 9.7 GB');
  assert.equal(capacity.roomByShares({ cpus: 3, ramTotal: 64 * GB }, []), 0, 'nor 4 CPUs in 3');
  assert.equal(capacity.roomByShares({ cpus: 16, ramTotal: 64 * GB }, [{ cpu: 8, ram: 16 }], { cpu: 2, ram: 4 }), 4, 'a share of its own counts as it is');
  assert.equal(capacity.roomByShares(null, []), null, 'unknown while nothing is measured');
  assert.equal(capacity.roomByShares({ ramTotal: 24 * GB }, []), null);
  assert.deepEqual(capacity.MANAGED_SHARE, { cpu: 4, ram: 8, disk: 40 });
});

test('managed, one account on a public origin: no admin page, and the setup key makes the one account', async (t) => {
  const door = await startFrontDoor({ env: { FRONT_DOOR_ORIGIN: ORIGIN, FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_ADMIN: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const owner = await standIn(door, 'owner');
  t.after(async () => { await door.stop(); owner.close(); });
  assert.equal(door.firstLink, null, `no sign-up link printed:\n${door.log.join('')}`);
  assert.equal((await door.browser().get('/admin')).status, 404, 'no admin page, not even the sign-in page');
  assert.equal((await door.browser().get('/admin/capacity')).status, 404);

  const { b, done } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  assert.equal(done.status, 201, done.text);
  assert.equal(done.data.account, 'owner');
  assert.equal((await door.browser().get(`/sign-up/${SETUP_KEY}`)).status, 410, 'the key works once');

  // Signed in, and named in FRONT_DOOR_ADMIN, the account is still no admin.
  assert.equal((await b.get('/admin')).status, 404);
  assert.equal((await b.get('/admin/accounts')).status, 404);
  assert.equal(owner.seen.filter((r) => r.url.startsWith('/admin')).length, 0, 'never passed on to the account');
  assert.deepEqual((await b.get('/front-door/session')).data, { account: 'owner', admin: false, feedback: true, feedbackScreenshots: true, updates: false, rooms: false, roomLinks: false });
  assert.equal((await b.get('/api/bots')).data.account, 'owner');
});

test('managed, several accounts: the first from the setup key, the next from a link only while its share fits', async (t) => {
  const load = loadDir(t, VPS8);
  const door = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_ADMIN: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, FRONT_DOOR_LOAD: load } });
  t.after(() => door.stop());
  assert.equal(door.firstLink, null, `no sign-up link of its own:\n${door.log.join('')}`);

  // The setup key makes the first account, whatever name the page sends.
  const first = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'someone' });
  assert.equal(first.done.status, 400, 'the key is for the first account alone');
  const made = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  assert.equal(made.done.status, 201, made.done.text);
  assert.equal((await door.browser().get(`/sign-up/${SETUP_KEY}`)).status, 410, 'then the key opens nothing');
  assert.match(door.log.join(''), /account owner was made with the setup key/);
  assert.equal((await made.b.get('/admin')).status, 404, 'the first account is no admin');

  const saved = () => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.ok(!saved().share, 'the default share is not written: it is the managed one');

  // Root's step makes the later links (#985): an 8-CPU, 24 GB machine holds a second share of 4 CPUs and 8 GB…
  const bea = await signUp(door, door.newLink().path, { name: 'bea' });
  assert.equal(bea.done.status, 201, bea.done.text);
  // …and no third.
  const link = door.newLink();
  const page = await door.browser().get(link.path);
  assert.equal(page.status, 409);
  assert.match(page.text, /This machine is full/);
  const cleo = await signUp(door, link.path, { name: 'cleo' });
  assert.equal(cleo.done.status, 409);
  assert.equal(cleo.done.data.full, true);
  assert.deepEqual(Object.keys(saved().accounts).sort(), ['bea', 'owner']);
  assert.match(door.log.join(''), /a sign-up link made no account: no room on the machine/);
});

test('managed, several: a Cloud VPS 6 takes no second account', async (t) => {
  const load = loadDir(t, VPS6);
  const door = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, FRONT_DOOR_LOAD: load } });
  t.after(() => door.stop());
  assert.equal((await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' })).done.status, 201);
  assert.equal((await signUp(door, door.newLink().path, { name: 'bea' })).done.status, 409);
});

test('the command that prints a sign-up link works on a managed machine of several, for root\'s step', async (t) => {
  const door = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  t.after(() => door.stop());
  const cmd = spawnSync(process.execPath, ['front-door.js', 'sign-up-link', '--account', 'bea'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data, FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner' },
    encoding: 'utf8',
  });
  assert.equal(cmd.status, 0, cmd.stderr);
  assert.match(cmd.stdout, /\/sign-up\/[A-Za-z0-9_-]+/);
});

test('a managed machine without a first account, or a setup key, makes no account from the key', async (t) => {
  const door = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  t.after(() => door.stop());
  assert.equal(door.firstLink, null);
  assert.equal((await door.browser().get(`/sign-up/${SETUP_KEY}`)).status, 410);
  const bad = spawnSync(process.execPath, ['front-door.js'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data, FRONT_DOOR_SOCKETS: door.sockets, FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'Not A Name' },
    encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /FRONT_DOOR_FIRST_ACCOUNT is an account's name/);
});

// ADR 162: the fleet console's keys reach a managed machine of one account as the installer's do (install-keys.json):
// the account is handed the decision model with Jev's key, and the Composio key as the installer's (ADR 160).
test("managed, one account: the console's keys in install-keys.json are taken, and Jev's is handed to the account", async (t) => {
  const { waitFor } = require('./helpers');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-keys-'));
  const file = path.join(data, 'install-keys.json');
  fs.writeFileSync(file, JSON.stringify({ openrouter: 'sk-or-v1-fromtheconsole', boat: null, composio: 'ak_fromtheconsole' }), { mode: 0o600 });
  const door = await startFrontDoor({ env: { FRONT_DOOR_DATA: data, FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, BOT_DOT_ROUTER_HAND_MS: '300' } });
  const owner = await standIn(door, 'owner');
  t.after(async () => { await door.stop(); owner.close(); fs.rmSync(data, { recursive: true, force: true }); });
  assert.equal((await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' })).done.status, 201);
  const last = (url) => owner.seen.filter((r) => r.url === url).map((r) => JSON.parse(r.body)).at(-1);
  await waitFor(() => (last('/api/group-router')?.key ? true : null), { what: "Jev's key to be handed" });
  assert.deepEqual([last('/api/group-router').router, last('/api/group-router').key], ['jev', 'sk-or-v1-fromtheconsole']);
  // The Composio key waits for the first account as the installer's does (ADR 160, test/front-door-install-keys.test.js).
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'composio-key.json'), 'utf8')).key, 'ak_fromtheconsole');
  assert.equal(owner.seen.find((r) => r.url === '/api/group-router').headers['x-botdot-room'], '1', 'as the front door itself');
  assert.ok(!fs.existsSync(file), 'the file is taken');
});

// Feedback on a managed machine (ADR 164): kept as anywhere, and written whole to the outbox the console's agent empties.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);

test('managed: a report goes to the outbox whole, screenshots as base64, under its own name', async (t) => {
  const door = await startFrontDoor({ env: { FRONT_DOOR_ORIGIN: ORIGIN, FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const owner = await standIn(door, 'owner');
  t.after(async () => { await door.stop(); owner.close(); });
  const { b, done } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  assert.equal(done.status, 201, done.text);

  const sent = await b.post('/front-door/feedback', { kind: 'bug', text: '  Approve does nothing  ', screenshots: [{ data: PNG.toString('base64') }] });
  assert.equal(sent.status, 201, sent.text);
  const dir = path.join(door.data, 'outbox');
  assert.deepEqual(fs.readdirSync(dir), [`feedback-${sent.data.id}.json`], 'one file, nothing hidden left behind');
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, `feedback-${sent.data.id}.json`)).mode & 0o777, 0o600);
  const kept = JSON.parse(fs.readFileSync(path.join(dir, `feedback-${sent.data.id}.json`), 'utf8'));
  assert.deepEqual({ ...kept, created: undefined }, { id: sent.data.id, account: 'owner', created: undefined, kind: 'bug', text: 'Approve does nothing', app: 'web', version: null, screenshots: [{ type: 'image/png', data: PNG.toString('base64') }] });
  assert.ok(Date.now() - Date.parse(kept.created) < 60_000);
  assert.equal(owner.seen.filter((r) => r.url.includes('feedback')).length, 0, 'no botdot server saw it');

  const plain = await b.post('/front-door/feedback', { kind: 'feature', text: 'A dark theme' });
  assert.equal(plain.status, 201, plain.text);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, `feedback-${plain.data.id}.json`), 'utf8')).screenshots, []);
});

test('managed: a report the outbox can\'t take is not kept, and the owner is told to try later', async (t) => {
  const door = await startFrontDoor({ env: { FRONT_DOOR_ORIGIN: ORIGIN, FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const owner = await standIn(door, 'owner');
  t.after(async () => { await door.stop(); owner.close(); });
  const { b } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  // A file where the folder should be: nothing can be written there.
  fs.writeFileSync(path.join(door.data, 'outbox'), 'not a folder');
  const sent = await b.post('/front-door/feedback', { kind: 'bug', text: 'Lost?' });
  assert.equal(sent.status, 503, sent.text);
  assert.match(sent.data.error, /Try again later/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).feedback, [], 'not kept either');
});

test('the outbox counts the reports that wait and says when it is full', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fd-outbox-')), 'outbox');
  const box = require('../lib/front-door/outbox').create(dir, { waitingMax: 2 });
  assert.equal(box.full(), false, 'no folder yet');
  box.put({ id: 'a'.repeat(32), account: 'owner', created: new Date().toISOString(), kind: 'bug', text: 'x', app: 'web', version: null });
  assert.equal(box.full(), false);
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), '');
  box.put({ id: 'b'.repeat(32), account: 'owner', created: new Date().toISOString(), kind: 'bug', text: 'y', app: 'web', version: null });
  assert.equal(box.waiting(), 2);
  assert.equal(box.full(), true);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});
