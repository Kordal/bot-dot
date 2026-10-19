// The front door and the Android app's sign-in in the browser: the app opens the front door's own sign-in page in a
// Custom Tab, so the browser and the password manager the person uses there (Proton Pass, Bitwarden, Google's) answer
// the passkey for the site itself. The page hands the sign-in back to the app as a one-time code at
// botdot://signed-in?code=…, the way the Mac app's sheet does (#469), and only the app holding the secret whose
// SHA-256 the page carried turns it into its session. Another app on the phone may claim botdot:// and see the code;
// without the secret it signs nobody in. No FRONT_DOOR_ANDROID_KEYS and no assetlinks.json take part.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

// What the app makes before it opens the browser: a secret it keeps, and its SHA-256, which the page carries.
function handoff() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

let door;
const stands = {};
before(async () => {
  // Any domain, and no FRONT_DOOR_ANDROID_KEYS: the browser's passkey belongs to the site.
  door = await startFrontDoor({ env: { FRONT_DOOR_ANDROID_KEYS: '' } });
  stands.dana = await standIn(door, 'dana');
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

test("the Android app's sign-in in the browser comes back as a one-time code that only the app's secret turns into its session", async () => {
  const key = await signUp('dana');
  const h = handoff();
  const tab = door.browser();
  assert.equal((await tab.get(`/sign-in?app=android&handoff=${h.challenge}`)).status, 200);
  const options = await tab.post('/sign-in/options', {});
  // The browser signs with the site's own origin, not the app's.
  const r = await tab.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'android', handoff: h.challenge });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.account, 'dana');
  assert.match(r.data.code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.data.next, `botdot://signed-in?code=${r.data.code}`);
  assert.equal(r.headers['set-cookie'], undefined, "the browser's tab gets no session of its own");
  assert.equal((await tab.get('/api/bots')).status, 401);

  // Another app that caught the address has the code but not the secret: nothing, and the code is spent.
  const other = handoff();
  const stolen = await door.browser().post('/sign-in/handoff', { code: r.data.code, verifier: other.verifier });
  assert.equal(stolen.status, 401);
  assert.equal(stolen.headers['set-cookie'], undefined);
  assert.equal((await door.browser().post('/sign-in/handoff', { code: r.data.code, verifier: h.verifier })).status, 401, 'spent');

  // A new sign-in: the app's secret turns the code into a session of the Android app.
  const h2 = handoff();
  const o2 = await tab.post('/sign-in/options', {});
  const r2 = await tab.post('/sign-in', { credential: key.signIn(o2.data.publicKey), app: 'android', handoff: h2.challenge });
  assert.equal(r2.status, 200, r2.text);
  const phone = door.browser();
  const done = await phone.post('/sign-in/handoff', { code: r2.data.code, verifier: h2.verifier });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.account, 'dana');
  assert.match(String(done.headers['set-cookie']), /botdot_session=[^;]+; Path=\/; HttpOnly/);
  assert.equal((await phone.get('/api/bots')).data.account, 'dana');
  const saved = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.ok(Object.values(saved.sessions).some((s) => s.account === 'dana' && s.app === 'android'), 'a session of the Android app');
  assert.ok(!JSON.stringify(saved).includes(r2.data.code), 'the code is never kept on disk');
  assert.equal((await door.browser().post('/sign-in/handoff', { code: r2.data.code, verifier: h2.verifier })).status, 401, 'used once');
});

test('a hand-off is for the native apps only, and its challenge must be a SHA-256', async () => {
  const key = (await signUp('emil'));
  for (const [app, challenge] of [['web', handoff().challenge], [undefined, handoff().challenge], ['android', 'short'], ['android', 7]]) {
    const b = door.browser();
    const options = await b.post('/sign-in/options', {});
    assert.equal((await b.post('/sign-in', { credential: key.signIn(options.data.publicKey), app, handoff: challenge })).status, 400, `${app} ${challenge}`);
  }
});

test('a sign-up link opened from the Android app hands its new account back the same way', async () => {
  const link = door.newLink();
  const h = handoff();
  const tab = door.browser();
  assert.equal((await tab.get(`${link.path}?app=android&handoff=${h.challenge}`)).status, 200);
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await tab.post(`${link.path}/options`, { name: 'fern' });
  const made = await tab.post(link.path, { name: 'fern', credential: key.register(options.data.publicKey), app: 'android', handoff: h.challenge });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.headers['set-cookie'], undefined);
  assert.match(made.data.next, /^botdot:\/\/signed-in\?code=/);
  const phone = door.browser();
  const done = await phone.post('/sign-in/handoff', { code: made.data.code, verifier: h.verifier });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.account, 'fern');
});

// The page's own script, run with a stand-in for the browser: what it sends, and where it goes once signed in.
async function runPage(search, answer) {
  const script = (await door.browser().get('/front-door/passkey.js')).text;
  const sent = [];
  const went = [];
  const listeners = {};
  const link = { hidden: true, href: '' };
  const els = {
    'sign-in': { disabled: false, addEventListener: (ev, fn) => { listeners.signIn = fn; } },
    said: { textContent: '' },
    back: link,
  };
  const ctx = {
    location: { search, pathname: '/sign-in', replace: (u) => went.push(u) },
    URLSearchParams,
    document: { getElementById: (id) => els[id] || null },
    fetch: async (p, init) => {
      sent.push({ path: p, body: JSON.parse(init.body) });
      const data = p === '/sign-in/options' ? { publicKey: { challenge: 'AAAA' } } : answer;
      return { ok: true, json: async () => data };
    },
    navigator: { credentials: { get: async () => ({ id: 'k', rawId: new Uint8Array([1]).buffer, type: 'public-key', response: { clientDataJSON: new Uint8Array([2]).buffer } }) } },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    encodeURIComponent,
    Uint8Array,
    String,
    Object,
    Error,
  };
  vm.runInNewContext(script, ctx);
  await listeners.signIn();
  return { sent, went, link, said: els.said.textContent };
}

test("the page sends the Android app's browser back to the app with the code, and shows a way back by hand", async () => {
  const h = handoff();
  const { sent, went, link } = await runPage(`?app=android&handoff=${h.challenge}`, { ok: true, account: 'dana', code: 'c0de' });
  const signIn = sent.find((s) => s.path === '/sign-in');
  assert.equal(signIn.body.app, 'android');
  assert.equal(signIn.body.handoff, h.challenge);
  assert.deepEqual(went, ['botdot://signed-in?code=c0de']);
  // A browser that opens no app without a fresh tap (Chrome after a long passkey prompt) still has one to tap.
  assert.equal(link.hidden, false);
  assert.equal(link.href, 'botdot://signed-in?code=c0de');

  // The web page itself: its cookie, and the botdot page.
  const web = await runPage('', { ok: true, account: 'dana' });
  assert.equal(web.sent.find((s) => s.path === '/sign-in').body.app, 'web');
  assert.equal(web.sent.find((s) => s.path === '/sign-in').body.handoff, undefined);
  assert.deepEqual(web.went, ['/']);
  // Another app's name is a sign-in of the web page.
  const other = await runPage(`?app=ios&handoff=${h.challenge}`, { ok: true, account: 'dana' });
  assert.equal(other.sent.find((s) => s.path === '/sign-in').body.app, 'web');
});

test('the sign-in page has the way back to the app, hidden until it is needed', async () => {
  const page = await door.browser().get(`/sign-in?app=android&handoff=${handoff().challenge}`);
  assert.match(page.text, /<a [^>]*id="back"[^>]*hidden/);
});
