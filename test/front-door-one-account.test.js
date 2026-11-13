// The front door's hand-off (ADR 028, #469): a native app signs in on the front door's own page, in a browser, which
// hands the sign-in back to the app as a one-time code that only the app that asked can turn into its session. And a
// front door of one account (FRONT_DOOR_ONE_ACCOUNT, as `npm start` runs it): no sign-up links and no admin page, whose
// one passkey is made with the setup key only its starter holds.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

// What the app makes before it opens the browser: a secret it keeps, and its SHA-256, which the page carries.
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

// The sign-in page in the app's browser: the same passkey, signing in with the hand-off's challenge.
async function signInInSheet(key, h, b = door.browser()) {
  const options = await b.post('/sign-in/options', {});
  return { b, r: await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'android', handoff: h.challenge }) };
}

test("an app's sign-in comes back as a one-time code, and only the app that asked turns it into its session", async () => {
  const key = await signUp('ann');
  const h = handoff();
  const page = await door.browser().get(`/sign-in?app=android&handoff=${h.challenge}`);
  assert.equal(page.status, 200);
  const { b: sheet, r } = await signInInSheet(key, h);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.account, 'ann');
  assert.match(codeOf(r), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.headers['set-cookie'], undefined, 'the sheet gets no session of its own');
  assert.equal((await sheet.get('/api/bots')).status, 401);

  // The app, with its secret: its own session.
  const app = door.browser();
  const done = await app.post('/sign-in/handoff', { code: codeOf(r), verifier: h.verifier });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.account, 'ann');
  assert.match(String(done.headers['set-cookie']), /botdot_session=[^;]+; Path=\/; HttpOnly/);
  const bots = await app.get('/api/bots');
  assert.equal(bots.status, 200);
  assert.equal(bots.data.account, 'ann');
  const saved = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.ok(Object.values(saved.sessions).some((s) => s.account === 'ann' && s.app === 'android'), 'a session of the app');
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

test('a hand-off is only for the Android and desktop apps (the native Mac app is gone, ADR 142), and its challenge must be a SHA-256', async () => {
  const key = await signUp('cleo');
  const b = door.browser();
  let options = await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'web', handoff: handoff().challenge })).status, 400);
  options = await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'mac', handoff: handoff().challenge })).status, 400);
  options = await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'android', handoff: 'short' })).status, 400);
});

test('the page script sends the browser back to the app with the code', async () => {
  const script = await door.browser().get('/front-door/passkey.js');
  assert.match(script.text, /botdot:\/\/signed-in\?code=/);
  assert.match(script.text, /handoff/);
});

// ---------- one account ----------

const SETUP_KEY = crypto.randomBytes(32).toString('base64url');

test("one account: no sign-up link, the setup key makes the account's one passkey once, and the app is signed in by it", async () => {
  const one = await startFrontDoor({ env: { FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const owner = await standIn(one, 'owner');
  try {
    assert.equal(one.firstLink, null, `no sign-up link printed:\n${one.log.join('')}`);
    // A sign-up link made some other way opens nothing.
    const link = one.newLink();
    assert.equal((await one.browser().get(link.path)).status, 410);
    assert.equal((await one.browser().post(`${link.path}/options`, { name: 'other' })).status, 410);
    // The command that prints one says why it doesn't.
    const cmd = spawnSync(process.execPath, ['front-door.js', 'sign-up-link'], {
      cwd: path.join(__dirname, '..'),
      env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: one.origin, FRONT_DOOR_DATA: one.data, FRONT_DOOR_ONE_ACCOUNT: 'owner' },
      encoding: 'utf8',
    });
    assert.notEqual(cmd.status, 0);
    assert.match(cmd.stderr, /one account/i);
    assert.doesNotMatch(cmd.stdout, /sign-up\//);

    // The setup key opens the sign-up page, which asks for no name: the account is the one.
    const h = handoff();
    const sheet = one.browser();
    const page = await sheet.get(`/sign-up/${SETUP_KEY}?app=android&handoff=${h.challenge}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /admin of this machine can technically reach everything/i);
    assert.match(page.text, /<input id="name" name="name" type="hidden" value="owner">/, "the account's name is set");
    assert.match(page.text, /<input id="login" name="login" required [^>]*value="owner">/, 'the login name is a field, the account\'s name at first');
    // The desktop app sends the computer's user name, which the page offers instead, made into a name.
    const offered = await sheet.get(`/sign-up/${SETUP_KEY}?name=Bart.Kordal&app=desktop&handoff=${h.challenge}`);
    assert.match(offered.text, /<input id="login" name="login" required [^>]*value="bart-kordal">/);
    const odd = await sheet.get(`/sign-up/${SETUP_KEY}?name=${encodeURIComponent('<9>')}`);
    assert.match(odd.text, /<input id="login" name="login" required [^>]*value="owner">/, 'no name in it: the account\'s own');
    // A login name that isn't one is refused.
    const bad = await sheet.post(`/sign-up/${SETUP_KEY}/options`, { name: 'owner', login: 'Bart!' });
    assert.equal(bad.status, 400);
    const key = passkey.create({ rpId: one.rpId, origin: one.origin });
    const options = await sheet.post(`/sign-up/${SETUP_KEY}/options`, { name: 'someone-else', login: 'bart' });
    assert.equal(options.status, 200, options.text);
    assert.equal(options.data.publicKey.user.name, 'bart', 'the passkey is named as its owner chose');
    assert.equal(options.data.publicKey.user.displayName, 'bart');
    // The passkey made for one login name makes no account with another.
    const swapped = await sheet.post(`/sign-up/${SETUP_KEY}`, { name: 'owner', login: 'eve', credential: passkey.create({ rpId: one.rpId, origin: one.origin }).register(options.data.publicKey), app: 'android', handoff: h.challenge });
    assert.equal(swapped.status, 400);
    const again1 = await sheet.post(`/sign-up/${SETUP_KEY}/options`, { name: 'owner', login: 'bart' });
    const made = await sheet.post(`/sign-up/${SETUP_KEY}`, { name: 'someone-else', login: 'bart', credential: key.register(again1.data.publicKey), app: 'android', handoff: h.challenge });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.data.account, 'owner');
    assert.equal(made.headers['set-cookie'], undefined);

    const app = one.browser();
    assert.equal((await app.post('/sign-in/handoff', { code: codeOf(made), verifier: h.verifier })).status, 200);
    assert.equal((await app.get('/api/bots')).data.account, 'owner');

    // Once: the key opens nothing now, and the account has the one passkey, which signs in.
    assert.equal((await one.browser().get(`/sign-up/${SETUP_KEY}`)).status, 410);
    const h2 = handoff();
    const b = one.browser();
    const o = await b.post('/sign-in/options', {});
    const again = await b.post('/sign-in', { credential: key.signIn(o.data.publicKey), app: 'android', handoff: h2.challenge });
    assert.equal(again.status, 200, again.text);

    // No admin page: without a session it is the sign-in page, with one it is the account's own botdot server's.
    const admin = await one.browser().get('/admin');
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.location, '/sign-in');
    assert.equal((await app.get('/admin')).data.account, 'owner');
    // And no Feedback (#216): there is no admin page to read it.
    assert.deepEqual((await app.get('/front-door/session')).data, { account: 'owner', admin: false, deleteAccount: false, deleteAccountPage: null, subscriptionPage: null, feedback: false, feedbackScreenshots: false, updates: false, rooms: false, roomLinks: false });
    const sent = await app.post('/front-door/feedback', { kind: 'bug', text: 'Approve button does nothing on my phone' });
    assert.equal(sent.status, 404);
    assert.equal(owner.seen.filter((r) => r.url === '/front-door/feedback').length, 0, 'never passed on');
  } finally { await one.stop(); owner.close(); }
});

test('one account without a setup key, or with a short one, makes no account at all', async () => {
  for (const env of [{ FRONT_DOOR_ONE_ACCOUNT: 'owner' }, { FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: 'short' }]) {
    const one = await startFrontDoor({ env });
    try {
      assert.equal(one.firstLink, null);
      assert.equal((await one.browser().get('/sign-up/short')).status, 410);
      assert.equal((await one.browser().get(`/sign-up/${SETUP_KEY}`)).status, 410);
    } finally { await one.stop(); }
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
