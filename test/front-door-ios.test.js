// The front door and the iOS app's sign-in (#965, ADR 242): the app opens the front door's own sign-in page in an
// ASWebAuthenticationSession sheet with `app=ios`, so iCloud Keychain answers the passkey, and takes the sign-in back at
// botdot://signed-in?code=…, as the desktop app does. Only the app holding the secret gets the session.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

function handoff() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

let door;
let stand;
before(async () => {
  door = await startFrontDoor({ env: { FRONT_DOOR_ANDROID_KEYS: '' } });
  stand = await standIn(door, 'ivy');
});
after(async () => {
  await door?.stop();
  stand?.close();
});

test("a hand-off with app ios is accepted, and its secret makes a session of the iOS app", async () => {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const link = door.newLink();
  const made = await b.post(`${link.path}/options`, { name: 'ivy' });
  assert.equal((await b.post(link.path, { name: 'ivy', credential: key.register(made.data.publicKey) })).status, 201);

  const h = handoff();
  const sheet = door.browser();
  assert.equal((await sheet.get(`/sign-in?app=ios&handoff=${h.challenge}`)).status, 200);
  const options = await sheet.post('/sign-in/options', {});
  const r = await sheet.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'ios', handoff: h.challenge });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.next, `botdot://signed-in?code=${r.data.code}`);
  assert.equal(r.headers['set-cookie'], undefined, 'the sheet gets no session of its own');

  const app = door.browser();
  const wrong = await door.browser().post('/sign-in/handoff', { code: 'not-a-code', verifier: h.verifier });
  assert.equal(wrong.status, 401);
  const done = await app.post('/sign-in/handoff', { code: r.data.code, verifier: h.verifier });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.account, 'ivy');
  assert.match(String(done.headers['set-cookie']), /botdot_session=[^;]+; Path=\/; HttpOnly/);
  const saved = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.ok(Object.values(saved.sessions).some((s) => s.account === 'ivy' && s.app === 'ios'), 'a session of the iOS app');
});

test('the sign-in page treats the iOS app as a native app, and the admin page names its feedback', async () => {
  const passkeyScript = (await door.browser().get('/front-door/passkey.js')).text;
  assert.ok(passkeyScript.includes("['android', 'desktop', 'ios'].includes(asked.get('app'))"), 'ios hands the sign-in back');
  const admin = (await door.browser().get('/front-door/admin.js')).text;
  assert.ok(admin.includes("ios: 'iOS app'"), 'the name of the app in a report');
});
