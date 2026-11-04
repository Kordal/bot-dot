// The admin page's audit log (#911, ADR 141): every action the admin takes on the admin page, and the front door's
// security events (an account made, a passkey added from a sign-in link, a client starting to be slowed down), each
// one entry { at, actor, action, account?, detail? } in audit.jsonl, through the front door's own routes. GET
// /admin/audit filters by account and action and pages with before, for the admin's session alone. No entry holds a
// key, a session, a link or a passkey.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const BOAT_KEY = 'boat_secretkey12345';
const JEV_KEY = 'sk-or-secretkey12345';
let door, requests, stub;
const stands = {};
before(async () => {
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  // boat.dev and OpenRouter, which take every key.
  stub = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(req.url.startsWith('/sandboxes') ? '{"sandboxes":[]}' : '{"answers":{"ok":true}}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${stub.address().port}`;
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests, BOT_DOT_BOAT_URL: at, BOT_DOT_OPENROUTER_URL: at } });
  stands.ann = await standIn(door, 'ann');
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  stub?.close();
  fs.rmSync(requests, { recursive: true, force: true });
});

const keys = {};
async function signUp(name, link) {
  const b = door.browser();
  const key = (keys[name] = passkey.create({ rpId: door.rpId, origin: door.origin }));
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
let annB = null;
const admin = async () => (annB ||= await signUp('ann', door.firstLink));
const audit = async (q = '') => {
  const r = await (await admin()).get(`/admin/audit${q}`);
  assert.equal(r.status, 200, r.text);
  return r.data;
};
const newest = async () => (await audit()).entries[0];

test('each admin action writes one entry, the admin as its actor', async () => {
  const a = await admin();
  const bob = await signUp('bob', door.newLink());
  stands.bob = await standIn(door, 'bob');
  const count = async () => (await audit('?limit=200')).entries.length;
  // [what the admin does, the entry it writes]
  const steps = [
    [() => a.post('/admin/links', {}), { action: 'link-made', detail: /^until 20\d\d-\d\d-\d\d \d\d:\d\d UTC$/ }],
    [async () => { const l = (await a.get('/admin/links')).data.links.find((x) => x.state === 'open'); return a.post(`/admin/links/${l.id}/revoke`, {}); }, { action: 'link-revoked', detail: /^made 20\d\d-\d\d-\d\d \d\d:\d\d UTC$/ }],
    [() => a.post('/admin/update/days', { days: 9 }), { action: 'update-days', detail: '9 days' }],
    [() => a.post('/admin/update', {}), { action: 'update', detail: 'the front door and every account' }],
    [() => a.post('/admin/rooms', { on: true }), { action: 'rooms', detail: 'on' }],
    [() => a.post('/admin/group-router', { router: 'jev', key: JEV_KEY, wakeGate: true }), { action: 'decision-model', detail: 'Jev, a new key · wake gate on' }],
    [() => a.post('/admin/group-router', { router: 'haiku', wakeGate: false }), { action: 'decision-model', detail: 'Haiku · wake gate off' }],
    [() => a.post('/admin/replays', { replaysPerHour: 4 }), { action: 'replays', detail: '4 an hour' }],
    [() => a.post('/admin/boat', { key: BOAT_KEY }), { action: 'boat-key-set' }],
    [() => a.post('/admin/boat', { key: null }), { action: 'boat-key-removed' }],
    [() => a.post('/admin/share', { cpu: 3, ram: 6, disk: 40 }), { action: 'default-share', detail: '3 CPUs · 6 GB RAM · 40 GB disk' }],
    [() => a.post('/admin/accounts/bob/share', { cpu: 1, ram: 3, disk: 20 }), { action: 'share', account: 'bob', detail: '1 CPU · 3 GB RAM · 20 GB disk' }],
    [() => a.post('/admin/accounts/bob/share', { default: true }), { action: 'share', account: 'bob', detail: 'the default, 3 CPUs · 6 GB RAM · 40 GB disk' }],
    [() => a.post('/admin/accounts/bob/suspend', {}), { action: 'suspend', account: 'bob' }],
    [() => a.post('/admin/accounts/bob/resume', {}), { action: 'resume', account: 'bob' }],
    [() => a.post('/admin/accounts/bob/sign-in-link', {}), { action: 'sign-in-link', account: 'bob', detail: /^until 20\d\d-\d\d-\d\d \d\d:\d\d UTC$/ }],
    [() => a.post('/admin/accounts/bob/delete', { name: 'bob' }), { action: 'delete', account: 'bob' }],
  ];
  for (const [act, want] of steps) {
    const was = await count();
    const r = await act();
    assert.ok(r.status < 300, `${want.action}: ${r.status} ${r.text}`);
    assert.equal(await count(), was + 1, `${want.action}: one entry`);
    const e = await newest();
    assert.equal(e.actor, 'ann');
    assert.equal(e.action, want.action);
    assert.equal(e.account, want.account);
    if (want.detail instanceof RegExp) assert.match(e.detail, want.detail); else assert.equal(e.detail, want.detail);
    assert.ok(!Number.isNaN(Date.parse(e.at)));
  }
  // What failed writes none.
  const was = await count();
  assert.equal((await a.post('/admin/accounts/ann/suspend', {})).status, 409);
  assert.equal((await a.post('/admin/accounts/nobody/resume', {})).status, 404);
  assert.equal(await count(), was);
  // A deleted account's entries stay.
  assert.ok((await audit('?account=bob')).entries.length >= 7);
  assert.equal((await bob.get('/admin/audit')).status, 401, "bob's session ended with his account");
});

test("an account made, a passkey added from the admin's sign-in link and a client slowed down are the front door's entries", async () => {
  const a = await admin();
  await signUp('cat', door.newLink());
  stands.cat = await standIn(door, 'cat');
  assert.deepEqual(await newest(), { ...(await newest()), actor: 'front-door', action: 'account-made', account: 'cat', detail: 'from a sign-up link' });
  const link = (await a.post('/admin/accounts/cat/sign-in-link', {})).data;
  await signUp('cat', { path: new URL(link.url).pathname });
  const added = await newest();
  assert.equal(added.actor, 'front-door');
  assert.equal(added.action, 'passkey-added');
  assert.equal(added.account, 'cat');
  // A client that keeps failing to sign in: one entry when it starts to wait, none for each try before or after.
  const away = door.browser();
  const from = { 'X-Forwarded-For': '203.0.113.9' };
  for (let i = 0; i < 6; i++) await away.post('/sign-in', { credential: { id: 'nope', response: {} } }, from);
  const slowed = (await audit('?action=slowed-down')).entries;
  assert.equal(slowed.length, 1);
  assert.equal(slowed[0].actor, 'front-door');
  assert.equal(slowed[0].detail, '203.0.113.9 · after failed sign-ins');
  assert.equal(slowed[0].account, undefined);
});

test('GET /admin/audit filters by account and by action and pages with before; another session gets 404', async () => {
  const a = await admin();
  for (let i = 0; i < 3; i++) await a.post('/admin/replays', { replaysPerHour: i });
  const all = await audit('?limit=200');
  assert.equal(all.more, false);
  assert.deepEqual(all.entries.map((e) => e.at), [...all.entries.map((e) => e.at)].sort().reverse(), 'newest first');
  assert.ok(all.actions.includes('slowed-down') && all.actions.includes('delete'));
  assert.ok(all.accounts.includes('cat'));
  const replays = await audit('?action=replays');
  assert.ok(replays.entries.length >= 3 && replays.entries.every((e) => e.action === 'replays'));
  const cat = await audit('?account=cat&action=account-made');
  assert.deepEqual(cat.entries.map((e) => [e.account, e.action]), [['cat', 'account-made']]);
  const page1 = await audit('?limit=2');
  assert.equal(page1.entries.length, 2);
  assert.equal(page1.more, true);
  const page2 = await audit(`?limit=2&before=${encodeURIComponent(page1.entries[1].at)}`);
  assert.deepEqual(page2.entries, all.entries.slice(2, 4));
  // Another account's session, and no session.
  const dan = await signUp('dan', door.newLink());
  const other = await dan.get('/admin/audit');
  assert.equal(other.status, 404);
  assert.doesNotMatch(other.text, /account-made|replays/);
  assert.equal((await door.browser().get('/admin/audit')).status, 401);
});

test('no entry holds a key, a session, a link or a passkey', async () => {
  const a = await admin();
  const link = (await a.post('/admin/links', {})).data.url;
  const signIn = (await a.post('/admin/accounts/cat/sign-in-link', {})).data.url;
  const file = fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8');
  assert.equal(fs.statSync(path.join(door.data, 'audit.jsonl')).mode & 0o777, 0o600);
  const secrets = [BOAT_KEY, JEV_KEY, new URL(link).pathname.split('/').pop(), new URL(signIn).pathname.split('/').pop(), ...Object.values(keys).map((k) => k.id)];
  const cookie = a.cookie().split('=').pop();
  for (const s of [...secrets, cookie]) assert.ok(!file.includes(s), `the audit log holds ${s.slice(0, 6)}…`);
  assert.doesNotMatch(file, /sign-up\/|https?:\/\//);
  const store = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  for (const id of Object.keys(store.signUpLinks || {})) assert.ok(!file.includes(id), 'nor the hash of a link');
});
