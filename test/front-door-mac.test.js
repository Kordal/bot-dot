// The front door and the Mac app (ADR 028, #469): the Mac app signs in on the front door's own page, in a browser
// sheet (AuthenticationServices' ASWebAuthenticationSession), which hands the sign-in back to the app as a one-time
// code that only the app that asked can turn into its session. And the Mac's local botdot server: a front door with
// exactly one account, no sign-up links and no admin page, whose one passkey is made with the setup key only the
// Mac app holds.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

// What the Mac app makes before it opens the sheet: a secret it keeps, and its SHA-256, which the page carries.
function handoff() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
// The code at the end of the page's work, from the address it sends the sheet to.
const codeOf = (r) => r.data?.code;

let door;
const stands = {};
before(async () => {
  door = await startFrontDoor();
  stands.ann = await standIn(door, 'ann');
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
});

async function signUp(name) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const link = door.newLink();
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal((await b.post(link.path, { name, credential: key.register(options.data.publicKey) })).status, 201);
  return key;
}

// The sign-in page in the Mac app's sheet: the same passkey, signing in with the hand-off's challenge.
async function signInInSheet(key, h, b = door.browser()) {
  const options = await b.post('/sign-in/options', {});
  return { b, r: await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'mac', handoff: h.challenge }) };
}

test("the Mac app's sign-in comes back as a one-time code, and only the app that asked turns it into its session", async () => {
  const key = await signUp('ann');
  const h = handoff();
  const page = await door.browser().get(`/sign-in?app=mac&handoff=${h.challenge}`);
  assert.equal(page.status, 200);
  const { b: sheet, r } = await signInInSheet(key, h);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.account, 'ann');
  assert.match(codeOf(r), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.headers['set-cookie'], undefined, 'the sheet gets no session of its own');
  assert.equal((await sheet.get('/api/bots')).status, 401);

  // The app, with its secret: its own session, for the Mac.
  const app = door.browser();
  const done = await app.post('/sign-in/handoff', { code: codeOf(r), verifier: h.verifier });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.account, 'ann');
  assert.match(String(done.headers['set-cookie']), /botdot_session=[^;]+; Path=\/; HttpOnly/);
  const bots = await app.get('/api/bots');
  assert.equal(bots.status, 200);
  assert.equal(bots.data.account, 'ann');
  const saved = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.ok(Object.values(saved.sessions).some((s) => s.account === 'ann' && s.app === 'mac'), 'a session of the Mac app');
  assert.ok(!JSON.stringify(saved).includes(codeOf(r)), 'the code is never kept on disk');

  // Used once.
  assert.equal((await door.browser().post('/sign-in/handoff', { code: codeOf(r), verifier: h.verifier })).status, 401);
});

test('a hand-off code with the wrong secret signs nobody in, and is spent by it', async () => {
  const key = await signUp('bea');
  const h = handoff();
  const { r } = await signInInSheet(key, h);
  const stranger = await door.browser().post('/sign-in/handoff', { code: codeOf(r), verifier: handoff().verifier });
  assert.equal(stranger.status, 401);
  assert.equal(stranger.headers['set-cookie'], undefined);
  // The right secret, too late: the code is gone.
  assert.equal((await door.browser().post('/sign-in/handoff', { code: codeOf(r), verifier: h.verifier })).status, 401);
  // A made-up code, and writes without X-Bot-Dot.
  assert.equal((await door.browser().post('/sign-in/handoff', { code: 'x'.repeat(43), verifier: h.verifier })).status, 401);
  assert.equal((await door.browser().post('/sign-in/handoff', { code: codeOf(r), verifier: h.verifier }, { 'X-Bot-Dot': '' })).status, 403);
});

test('a hand-off is only for the Mac app, and its challenge must be a SHA-256', async () => {
  const key = await signUp('cleo');
  const b = door.browser();
  let options = await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'web', handoff: handoff().challenge })).status, 400);
  options = await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'mac', handoff: 'short' })).status, 400);
});

test('the page script sends the sheet back to the Mac app with the code, and only to it', async () => {
  const script = await door.browser().get('/front-door/passkey.js');
  assert.match(script.text, /botdot:\/\/signed-in\?code=/);
  assert.match(script.text, /handoff/);
});

// ---------- one account: the Mac's local botdot server ----------

const SETUP_KEY = crypto.randomBytes(32).toString('base64url');

test("one account: no sign-up link, the setup key makes the account's one passkey once, and the Mac app is signed in by it", async () => {
  const mac = await startFrontDoor({ env: { FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const owner = await standIn(mac, 'owner');
  try {
    assert.equal(mac.firstLink, null, `no sign-up link printed:\n${mac.log.join('')}`);
    // A sign-up link made some other way opens nothing.
    const link = mac.newLink();
    assert.equal((await mac.browser().get(link.path)).status, 410);
    assert.equal((await mac.browser().post(`${link.path}/options`, { name: 'other' })).status, 410);
    // The command that prints one says why it doesn't.
    const cmd = spawnSync(process.execPath, ['front-door.js', 'sign-up-link'], {
      cwd: path.join(__dirname, '..'),
      env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: mac.origin, FRONT_DOOR_DATA: mac.data, FRONT_DOOR_ONE_ACCOUNT: 'owner' },
      encoding: 'utf8',
    });
    assert.notEqual(cmd.status, 0);
    assert.match(cmd.stderr, /one account/i);
    assert.doesNotMatch(cmd.stdout, /sign-up\//);

    // The setup key opens the sign-up page, which asks for no name: the account is the one.
    const h = handoff();
    const sheet = mac.browser();
    const page = await sheet.get(`/sign-up/${SETUP_KEY}?app=mac&handoff=${h.challenge}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /admin of this machine can technically reach everything/i);
    assert.match(page.text, /Your account's name: <b>owner<\/b>/);
    assert.match(page.text, /<input id="name" name="name" type="hidden" value="owner">/, 'shown, not a field to type in');
    const key = passkey.create({ rpId: mac.rpId, origin: mac.origin });
    const options = await sheet.post(`/sign-up/${SETUP_KEY}/options`, { name: 'someone-else' });
    assert.equal(options.status, 200, options.text);
    assert.equal(options.data.publicKey.user.name, 'owner');
    const made = await sheet.post(`/sign-up/${SETUP_KEY}`, { name: 'someone-else', credential: key.register(options.data.publicKey), app: 'mac', handoff: h.challenge });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.data.account, 'owner');
    assert.equal(made.headers['set-cookie'], undefined);

    const app = mac.browser();
    assert.equal((await app.post('/sign-in/handoff', { code: codeOf(made), verifier: h.verifier })).status, 200);
    assert.equal((await app.get('/api/bots')).data.account, 'owner');

    // Once: the key opens nothing now, and the account has the one passkey, which signs in.
    assert.equal((await mac.browser().get(`/sign-up/${SETUP_KEY}`)).status, 410);
    const h2 = handoff();
    const b = mac.browser();
    const o = await b.post('/sign-in/options', {});
    const again = await b.post('/sign-in', { credential: key.signIn(o.data.publicKey), app: 'mac', handoff: h2.challenge });
    assert.equal(again.status, 200, again.text);

    // No admin page: without a session it is the sign-in page, with one it is the account's own botdot server's.
    const admin = await mac.browser().get('/admin');
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.location, '/sign-in');
    assert.equal((await app.get('/admin')).data.account, 'owner');
    // And no Feedback (#216): there is no admin page to read it.
    assert.deepEqual((await app.get('/front-door/session')).data, { admin: false, feedback: false, feedbackScreenshots: false, updates: false });
    const sent = await app.post('/front-door/feedback', { kind: 'bug', text: 'Approve button does nothing on my phone' });
    assert.equal(sent.status, 404);
    assert.equal(owner.seen.filter((r) => r.url === '/front-door/feedback').length, 0, 'never passed on');
  } finally { await mac.stop(); owner.close(); }
});

test('one account without a setup key, or with a short one, makes no account at all', async () => {
  for (const env of [{ FRONT_DOOR_ONE_ACCOUNT: 'owner' }, { FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: 'short' }]) {
    const mac = await startFrontDoor({ env });
    try {
      assert.equal(mac.firstLink, null);
      assert.equal((await mac.browser().get('/sign-up/short')).status, 410);
      assert.equal((await mac.browser().get(`/sign-up/${SETUP_KEY}`)).status, 410);
    } finally { await mac.stop(); }
  }
});

test('a setup key is nothing without one account: a machine of several accounts takes only sign-up links', async () => {
  const several = await startFrontDoor({ env: { FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  try {
    assert.ok(several.firstLink);
    assert.equal((await several.browser().get(`/sign-up/${SETUP_KEY}`)).status, 410);
  } finally { await several.stop(); }
});

test('a bad name for the one account stops the front door at once', async () => {
  const r = spawnSync(process.execPath, ['front-door.js'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: 'http://localhost:1', FRONT_DOOR_DATA: path.join(door.data, '..', 'bad'), FRONT_DOOR_SOCKETS: door.sockets, FRONT_DOOR_ONE_ACCOUNT: '../root' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FRONT_DOOR_ONE_ACCOUNT/);
});
