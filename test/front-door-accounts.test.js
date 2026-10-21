// The admin page's accounts (#470, ADR 028): the admin lists the accounts, suspends, resumes and deletes one, and gives
// an owner who lost every device a sign-in link that makes a new passkey for the same account. Each change is asked of
// the machine with a request named as the account (FRONT_DOOR_REQUESTS), which install.sh's root step takes, reading
// what the account should be from the front door's data. No route of the admin page returns anything from inside an
// account.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

// What every stand-in botdot server answers with: anything from inside an account carries it.
const INSIDE = 'inside-the-account-7f3c';
let door, requests;
const stands = {};
const keys = {};
const userIds = {};
const browsers = {};
before(async () => {
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests } });
  stands.ann = await inside('ann');
  browsers.ann = await signUp('ann', door.firstLink);
  for (const name of ['bob', 'cat', 'dan']) {
    stands[name] = await inside(name);
    browsers[name] = await signUp(name, (await browsers.ann.post('/admin/links', {})).data.url);
    // The machine took the request and made the account.
    fs.rmSync(path.join(requests, name), { force: true });
  }
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  fs.rmSync(requests, { recursive: true, force: true });
});

const inside = (account) => standIn(door, account, { answer: () => [200, { account, secret: INSIDE, bots: [{ name: `${account}'s own bot` }] }] });
async function signUp(name, link) {
  const p = typeof link === 'string' ? new URL(link).pathname : link.path;
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, { name });
  assert.equal(options.status, 200, options.text);
  userIds[name] = options.data.publicKey.user.id;
  const done = await b.post(p, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  keys[name] = key;
  return b;
}
async function signIn(key) {
  const b = door.browser();
  const options = await b.post('/sign-in/options', {});
  const r = await b.post('/sign-in', { credential: key.signIn(options.data.publicKey) });
  return { b, r };
}
const seen = () => Object.values(stands).map((s) => s.seen.length).join();
const asked = (name) => fs.existsSync(path.join(requests, name));
const listed = async (name) => (await browsers.ann.get('/admin/accounts')).data.accounts.find((a) => a.name === name);

test("the admin page lists each account's name, when it was made, when it was last seen, and whether it runs", async () => {
  const page = await browsers.ann.get('/admin');
  assert.match(page.text, /<h2>Accounts<\/h2>/);
  const r = await browsers.ann.get('/admin/accounts');
  assert.equal(r.status, 200);
  const { accounts } = r.data;
  assert.deepEqual(accounts.map((a) => a.name), ['ann', 'bob', 'cat', 'dan']);
  for (const a of accounts) {
    assert.ok(Object.keys(a).every((k) => ['name', 'created', 'lastSeen', 'state', 'share', 'ownShare', 'use', 'admin', 'update'].includes(k)), JSON.stringify(a));
    assert.ok(Date.parse(a.created) <= Date.now());
    assert.equal(a.state, 'running', `${a.name}'s botdot server answers on its socket`);
  }
  assert.equal(accounts.find((a) => a.name === 'ann').admin, true);
  assert.ok(!accounts.find((a) => a.name === 'bob').admin);

  // Seen when a session reaches the account.
  assert.equal((await browsers.bob.get('/api/bots')).status, 200);
  const bob = await listed('bob');
  assert.ok(bob.lastSeen && Date.now() - Date.parse(bob.lastSeen) < 60_000, JSON.stringify(bob));

  // A botdot server that doesn't answer: not running.
  const stopped = await standIn(door, 'zed');
  stopped.close();
  const zed = await signUp('zed', (await browsers.ann.post('/admin/links', {})).data.url);
  fs.rmSync(path.join(requests, 'zed'), { force: true });
  assert.equal((await listed('zed')).state, 'stopped');
  assert.equal((await zed.get('/api/bots')).status, 502);
});

test('a suspended account: its owner sees only "Your account is paused by the admin", and resume brings it back', async () => {
  const bob = browsers.bob;
  const r = await browsers.ann.post('/admin/accounts/bob/suspend', {});
  assert.equal(r.status, 200, r.text);
  assert.ok(asked('bob'), 'the machine is asked to stop bob');
  assert.equal((await listed('bob')).state, 'suspended');
  assert.equal((await browsers.ann.post('/admin/accounts/bob/suspend', {})).status, 409, 'once');

  const was = seen();
  const home = await bob.get('/');
  assert.equal(home.status, 503);
  assert.match(home.headers['content-type'], /^text\/html/);
  assert.match(home.text, /Your account is paused by the admin\./);
  assert.ok(!home.text.includes('<script'), 'nothing else on it');
  const api = await bob.get('/api/bots');
  assert.equal(api.status, 503);
  assert.deepEqual(api.data, { error: 'Your account is paused by the admin.', paused: true });
  assert.equal((await bob.post('/api/bots', { name: 'x' })).status, 503);
  assert.match(await door.upgrade('/api/bots/x/screen', { Cookie: bob.cookie() }), /^HTTP\/1\.1 503/);
  // A call to it, from anyone: its botdot server isn't running, and nothing more.
  const call = await door.request('POST', '/call/bob/b1/j1', { body: {}, headers: { Authorization: 'Bearer k' } });
  assert.equal(call.status, 502);
  assert.doesNotMatch(call.text, /paused/);
  // Signing in again works, and lands on the same answer.
  const again = await signIn(keys.bob);
  assert.equal(again.r.status, 200);
  assert.equal((await again.b.get('/api/bots')).data.paused, true);
  assert.equal(seen(), was, "no request reached any botdot server while bob's account is suspended");
  // The admin and the other accounts carry on.
  assert.equal((await browsers.cat.get('/api/bots')).data.account, 'cat');

  fs.rmSync(path.join(requests, 'bob')); // the machine stopped it
  const resumed = await browsers.ann.post('/admin/accounts/bob/resume', {});
  assert.equal(resumed.status, 200, resumed.text);
  assert.ok(asked('bob'), 'the machine is asked to start bob again');
  assert.equal((await browsers.ann.post('/admin/accounts/bob/resume', {})).status, 409, 'once');
  // Until bob's botdot server answers again, its page says it is starting.
  stands.bob.close();
  const startingPage = await bob.get('/');
  assert.equal(startingPage.status, 503);
  assert.match(startingPage.text, /Your account is starting/);
  assert.equal((await bob.get('/api/bots')).data.starting, true);
  assert.equal((await listed('bob')).state, 'starting');
  stands.bob = await inside('bob');
  fs.rmSync(path.join(requests, 'bob'));
  // As it was: the same session reaches bob's own botdot server.
  const back = await bob.get('/api/bots');
  assert.equal(back.status, 200);
  assert.equal(back.data.account, 'bob');
  assert.equal((await listed('bob')).state, 'running');
});

test("the admin's own account is neither suspended nor deleted from the admin page", async () => {
  const s = await browsers.ann.post('/admin/accounts/ann/suspend', {});
  assert.equal(s.status, 409);
  assert.match(s.data.error, /your own account/);
  const d = await browsers.ann.post('/admin/accounts/ann/delete', { name: 'ann' });
  assert.equal(d.status, 409);
  assert.equal((await listed('ann')).state, 'running');
  assert.ok(!asked('ann'));
  assert.equal((await browsers.ann.post('/admin/accounts/nobody/suspend', {})).status, 404);
  assert.equal((await browsers.ann.post('/admin/accounts/nobody/delete', { name: 'nobody' })).status, 404);
});

test("delete asks for the account's name typed, then erases it from the front door and asks the machine to erase the rest", async () => {
  const wrong = await browsers.ann.post('/admin/accounts/cat/delete', { name: 'ca' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /Type the account's name, cat/);
  assert.equal((await browsers.ann.post('/admin/accounts/cat/delete', {})).status, 400);
  assert.ok(await listed('cat'), 'still there');
  assert.equal((await browsers.cat.get('/api/bots')).data.account, 'cat');

  const done = await browsers.ann.post('/admin/accounts/cat/delete', { name: 'cat' });
  assert.equal(done.status, 200, done.text);
  assert.ok(asked('cat'), 'the machine is asked to erase cat');
  assert.equal(await listed('cat'), undefined);
  const data = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.ok(data.deleted.cat, 'root\'s step reads that cat was deleted');
  assert.ok(!Object.values(data.passkeys).some((k) => k.account === 'cat'));
  assert.ok(!Object.values(data.sessions).some((s) => s.account === 'cat'));

  // Its sessions and its passkey let nobody in.
  const was = seen();
  assert.equal((await browsers.cat.get('/api/bots')).status, 401);
  assert.equal((await signIn(keys.cat)).r.status, 401);
  assert.equal(seen(), was);

  // Its name is taken until the machine has erased it, then free.
  const link = (await browsers.ann.post('/admin/links', {})).data.url;
  const p = new URL(link).pathname;
  assert.equal((await door.browser().post(`${p}/options`, { name: 'cat' })).status, 409);
  fs.rmSync(path.join(requests, 'cat'));
  fs.rmSync(path.join(door.sockets, 'cat'), { recursive: true, force: true }); // root's step erased it
  stands.cat.close();
  await signUp('cat', link);
  assert.ok(asked('cat'), 'a new account cat is asked of the machine');
  assert.ok(!JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).deleted.cat);
});

test('a sign-in link makes a new passkey for the same account, once, and ends its other sessions', async () => {
  const made = await browsers.ann.post('/admin/accounts/dan/sign-in-link', {});
  assert.equal(made.status, 201, made.text);
  assert.match(made.data.url, new RegExp(`^${door.origin}/sign-up/[A-Za-z0-9_-]{20,}$`));
  assert.equal(made.data.link.signIn, true);
  assert.equal(made.data.link.for, 'dan');
  assert.equal(Date.parse(made.data.link.expires) - Date.parse(made.data.link.created), 24 * 3600_000, 'for 1 day');
  const row = (await browsers.ann.get('/admin/links')).data.links.find((l) => l.id === made.data.link.id);
  assert.equal(row.state, 'open');
  assert.equal(row.signIn, true);

  const p = new URL(made.data.url).pathname;
  const page = await door.browser().get(p);
  assert.equal(page.status, 200);
  assert.match(page.text, /Make a new passkey for your account, dan\./);
  assert.equal((await door.browser().post(`${p}/options`, { name: 'bob' })).status, 400, 'for dan alone');

  const phone = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await phone.post(`${p}/options`, { name: 'dan' });
  assert.equal(options.status, 200, options.text);
  assert.equal(options.data.publicKey.user.id, userIds.dan, "made for dan's own user handle");
  const done = await phone.post(p, { name: 'dan', credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  assert.equal(done.data.account, 'dan');
  // The same account, as it was.
  assert.equal((await phone.get('/api/bots')).data.account, 'dan');
  assert.equal((await signIn(key)).r.status, 200, 'the new passkey signs in to dan');
  // The lost devices' sessions end; dan's first passkey still signs in.
  assert.equal((await browsers.dan.get('/api/bots')).status, 401);
  assert.equal((await signIn(keys.dan)).r.status, 200);

  assert.equal((await door.browser().get(p)).status, 410, 'it works once');
  assert.equal((await browsers.ann.get('/admin/links')).data.links.find((l) => l.id === made.data.link.id).state, 'used');
  assert.equal((await browsers.ann.post('/admin/accounts/nobody/sign-in-link', {})).status, 404);
  // The admin's own: allowed, and also from the machine's command line, for an admin who lost every device.
  assert.equal((await browsers.ann.post('/admin/accounts/ann/sign-in-link', {})).status, 201);
  const env = { ...process.env, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data };
  const printed = execFileSync(process.execPath, ['front-door.js', 'sign-in-link', '--account', 'ann'], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  assert.match(printed, new RegExp(`^${door.origin}/sign-up/\\S+\\n\\(works once, until `));
  let status = 0;
  try { execFileSync(process.execPath, ['front-door.js', 'sign-in-link', '--account', 'nobody'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' }); } catch (e) { status = e.status; }
  assert.equal(status, 3);
});

test('no route of the admin page returns anything from inside an account, nor reaches a botdot server', async () => {
  const link = await browsers.ann.post('/admin/accounts/dan/sign-in-link', {});
  const routes = [
    ['GET', '/admin'], ['GET', '/admin/links'], ['GET', '/admin/accounts'], ['GET', '/front-door/admin.js'],
    ['POST', '/admin/links'], ['POST', `/admin/links/${link.data.link.id}/revoke`],
    ['POST', '/admin/accounts/dan/suspend'], ['GET', '/admin/accounts'], ['POST', '/admin/accounts/dan/resume'],
    ['POST', '/admin/accounts/dan/sign-in-link'], ['POST', '/admin/accounts/ann/delete'], ['POST', '/admin/accounts/dan/delete'],
    ['GET', '/admin/anything'], ['GET', '/admin/accounts/dan'], ['GET', '/admin/accounts/dan/bots'], ['POST', '/admin/accounts/dan/bots'],
  ];
  const was = seen();
  for (const [method, p] of routes) {
    const r = method === 'GET' ? await browsers.ann.get(p) : await browsers.ann.post(p, {});
    assert.ok(r.status < 500, `${method} ${p}: ${r.status}`);
    assert.ok(!r.text.includes(INSIDE) && !r.text.includes('own bot'), `${method} ${p} returned something from inside an account: ${r.text.slice(0, 200)}`);
  }
  assert.equal(seen(), was, 'no botdot server saw any request of the admin page');
  // dan's own account is still there: nothing above deleted it without its name typed.
  assert.ok(await listed('dan'));
});
