// A session ends after 90 days unused, and the admin signs an account out everywhere (#914): a session keeps when it
// was last used, written at most every 5 minutes; one unused for 90 days reaches its account no more, one in use goes
// on whatever its age, and one kept before #914 counts from its creation. "Sign out everywhere" on the admin page ends
// every session of one account, in every app, and no other's, and is in the audit log; on the admin's own account it
// signs the admin out too.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const store = require('../lib/front-door/store');

const DAY = 24 * 3600_000;
const MIN = 60_000;

test('a session unused for 90 days ends; one used yesterday goes on, whatever its age', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-sessions-'));
  try {
    const d = store.open(dir);
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    d.createOnlyAccount({ name: 'bob', userId: 'u1', passkey: { id: 'k1', alg: -7, jwk: {}, signCount: 0 }, now: t0 });
    const used = d.newSession('bob', 'android', t0);
    const unused = d.newSession('bob', 'web', t0);
    assert.equal(store.SESSION_DAYS, 90);
    // Used every 80 days, it goes on past 90 days of age.
    for (const day of [80, 160, 240]) assert.equal(d.sessionAccount(used, t0 + day * DAY), 'bob', `used on day ${day}`);
    assert.equal(d.sessionAccount(used, t0 + 240 * DAY + DAY), 'bob', 'used yesterday');
    assert.equal(d.sessionApp(used, t0 + 241 * DAY), 'android');
    // Unused for 90 days: it reaches its account no more, and is gone from the file.
    assert.equal(d.sessionApp(unused, t0 + 90 * DAY), null);
    assert.equal(d.sessionAccount(unused, t0 + 90 * DAY), null);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'front-door.json'), 'utf8')).sessions).length, 1);
    assert.equal(d.sessionAccount(unused, t0), null, 'an ended session never comes back');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a use is written at most every 5 minutes; a session kept before #914 counts from its creation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-sessions-'));
  try {
    const d = store.open(dir);
    const file = path.join(dir, 'front-door.json');
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    d.createOnlyAccount({ name: 'bob', userId: 'u1', passkey: { id: 'k1', alg: -7, jwk: {}, signCount: 0 }, now: t0 });
    const token = d.newSession('bob', 'web', t0);
    const kept = () => Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).sessions)[0];
    const writes = () => fs.statSync(file).mtimeMs + ':' + fs.statSync(file).ino;
    assert.equal(kept().lastUsed, undefined, 'a new session: its creation is its last use');
    let before = writes();
    for (const m of [1, 2, 4]) d.sessionAccount(token, t0 + m * MIN);
    assert.equal(kept().lastUsed, undefined);
    assert.equal(writes(), before, 'no write within 5 minutes');
    d.sessionAccount(token, t0 + 5 * MIN);
    assert.equal(kept().lastUsed, new Date(t0 + 5 * MIN).toISOString());
    before = writes();
    d.sessionAccount(token, t0 + 9 * MIN);
    assert.equal(kept().lastUsed, new Date(t0 + 5 * MIN).toISOString());
    assert.equal(writes(), before);
    d.sessionAccount(token, t0 + 10 * MIN);
    assert.equal(kept().lastUsed, new Date(t0 + 10 * MIN).toISOString());

    // Kept before #914: { account, app, created } and no lastUsed.
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const crypto = require('crypto');
    const old = 'an-old-session';
    data.sessions[crypto.createHash('sha256').update(old).digest('hex')] = { account: 'bob', app: 'web', created: new Date(t0).toISOString() };
    fs.writeFileSync(file, JSON.stringify(data));
    const fresh = store.open(dir);
    assert.equal(fresh.sessionAccount(old, t0 + 89 * DAY), 'bob');
    assert.equal(fresh.sessionAccount(old, t0 + 89 * DAY + 5 * MIN), 'bob', 'its use on day 89 carries it');
    assert.equal(fresh.sessionAccount(old, t0 + 178 * DAY), 'bob');
    const older = 'an-older-session';
    const again = JSON.parse(fs.readFileSync(file, 'utf8'));
    again.sessions[crypto.createHash('sha256').update(older).digest('hex')] = { account: 'bob', app: 'web', created: new Date(t0).toISOString() };
    fs.writeFileSync(file, JSON.stringify(again));
    assert.equal(store.open(dir).sessionAccount(older, t0 + 90 * DAY), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

let door;
const stands = {};
const keys = {};
before(async () => {
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  for (const name of ['ann', 'bob', 'cat']) stands[name] = await standIn(door, name, { answer: () => [200, { account: name }] });
  await signUp('ann', door.firstLink);
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
});

let admin;
async function signUp(name, link) {
  const p = typeof link === 'string' ? new URL(link).pathname : link.path;
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, { name });
  const r = await b.post(p, { name, credential: key.register(options.data.publicKey) });
  assert.equal(r.status, 201, r.text);
  keys[name] = key;
  if (name === 'ann') admin = b;
  return b;
}
async function signIn(name, app) {
  const b = door.browser();
  const options = await b.post('/sign-in/options', {});
  const r = await b.post('/sign-in', { credential: keys[name].signIn(options.data.publicKey), ...(app ? { app } : {}) });
  assert.equal(r.status, 200, r.text);
  return b;
}
const reaches = async (b) => (await b.get('/api/bots')).status;

test('a session unused for 90 days lands on sign-in', async () => {
  await signUp('cat', (await admin.post('/admin/links', {})).data.url);
  const cat = await signIn('cat');
  assert.equal(await reaches(cat), 200);
  // Its last use, 91 days ago, as the front door keeps it.
  const file = path.join(door.data, 'front-door.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const long = new Date(Date.now() - 91 * DAY).toISOString();
  for (const s of Object.values(data.sessions)) if (s.account === 'cat') { s.created = long; s.lastUsed = long; }
  fs.writeFileSync(file, JSON.stringify(data));
  const r = await cat.get('/api/bots');
  assert.equal(r.status, 401);
  assert.equal(r.data.signIn, '/sign-in');
  const page = await cat.get('/');
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, '/sign-in');
  assert.equal(await reaches(admin), 200, "the admin's session goes on");
  assert.equal(await reaches(await signIn('cat')), 200, 'the passkey signs in again');
});

test('the admin signs one account out everywhere, in every app, and no other', async () => {
  await signUp('bob', (await admin.post('/admin/links', {})).data.url);
  const bobs = [await signIn('bob'), await signIn('bob', 'android'), await signIn('bob', 'desktop')];
  const cat = await signIn('cat');
  for (const b of [...bobs, cat]) assert.equal(await reaches(b), 200);

  // Only the admin, with X-Bot-Dot, and only an account that exists.
  assert.equal((await bobs[0].post('/admin/accounts/cat/sign-out', {})).status, 404);
  assert.equal((await admin.post('/admin/accounts/cat/sign-out', {}, { 'X-Bot-Dot': '' })).status, 403);
  assert.equal((await admin.post('/admin/accounts/nobody/sign-out', {})).status, 404);
  assert.equal(await reaches(cat), 200);

  const r = await admin.post('/admin/accounts/bob/sign-out', {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.ok, true);
  assert.ok(r.data.ended >= 4, JSON.stringify(r.data), "bob's sign-up session and the three sign-ins");
  assert.equal(r.data.signIn, undefined);
  assert.equal(r.headers['set-cookie'], undefined, "the admin's own cookie stays");
  for (const b of bobs) {
    const after = await b.get('/api/bots');
    assert.equal(after.status, 401);
    assert.equal(after.data.signIn, '/sign-in');
  }
  assert.equal(await reaches(cat), 200, "another account's session goes on");
  assert.equal(await reaches(admin), 200, "the admin's goes on");
  assert.equal(await reaches(await signIn('bob')), 200, 'the passkey signs in again');

  const entries = (await admin.get('/admin/audit?action=sign-out')).data.entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].account, 'bob');
  assert.equal(entries[0].actor, 'ann');
  assert.match(entries[0].detail, /^\d+ sessions?$/);
});

test("on the admin's own account the admin is signed out too", async () => {
  const other = await signIn('ann', 'android');
  const r = await admin.post('/admin/accounts/ann/sign-out', {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.signIn, '/sign-in');
  assert.match(String(r.headers['set-cookie']), /Max-Age=0/);
  assert.equal((await admin.get('/admin/accounts')).status, 401);
  assert.equal(await reaches(other), 401);
  admin = await signIn('ann');
  assert.equal((await admin.get('/admin/accounts')).status, 200);
  const entries = (await admin.get('/admin/audit?action=sign-out&account=ann')).data.entries;
  assert.equal(entries.length, 1);
});
