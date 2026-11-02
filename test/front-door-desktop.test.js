// The front door and the desktop app's sign-in (ADR 137): the Tauri app opens the front door's own sign-in page in the
// system browser, so the browser and its password manager answer the passkey, and takes the sign-in back at
// botdot://signed-in?code=…, the way the Android app does. Only the app holding the secret gets the session.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
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
  stand = await standIn(door, 'dana');
});
after(async () => {
  await door?.stop();
  stand?.close();
});

async function signUp(name) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const link = door.newLink();
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal((await b.post(link.path, { name, credential: key.register(options.data.publicKey) })).status, 201);
  return key;
}

test("the desktop app's sign-in in the browser comes back as a code, and its secret makes a session of the desktop app", async () => {
  const key = await signUp('dana');
  const h = handoff();
  const browser = door.browser();
  assert.equal((await browser.get(`/sign-in?app=desktop&handoff=${h.challenge}`)).status, 200);
  const options = await browser.post('/sign-in/options', {});
  const r = await browser.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'desktop', handoff: h.challenge });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.next, `botdot://signed-in?code=${r.data.code}`);
  assert.equal(r.headers['set-cookie'], undefined, 'the browser gets no session of its own');

  const app = door.browser();
  const done = await app.post('/sign-in/handoff', { code: r.data.code, verifier: h.verifier });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.account, 'dana');
  assert.match(String(done.headers['set-cookie']), /botdot_session=[^;]+; Path=\/; HttpOnly/);
  assert.equal((await app.get('/api/bots')).data.account, 'dana');
  const saved = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.ok(Object.values(saved.sessions).some((s) => s.account === 'dana' && s.app === 'desktop'), 'a session of the desktop app');
});

test('a sign-up link opened from the desktop app hands its new account back the same way', async () => {
  const link = door.newLink();
  const h = handoff();
  const browser = door.browser();
  assert.equal((await browser.get(`${link.path}?app=desktop&handoff=${h.challenge}`)).status, 200);
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await browser.post(`${link.path}/options`, { name: 'fern' });
  const made = await browser.post(link.path, { name: 'fern', credential: key.register(options.data.publicKey), app: 'desktop', handoff: h.challenge });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.headers['set-cookie'], undefined);
  assert.match(made.data.next, /^botdot:\/\/signed-in\?code=/);
});

test('the sign-in page treats the desktop app as a native app, and an unknown app as the web page', async () => {
  const script = (await door.browser().get('/front-door/passkey.js')).text;
  const run = async (search) => {
    const sent = [];
    const went = [];
    const listeners = {};
    const els = { 'sign-in': { disabled: false, addEventListener: (ev, fn) => { listeners.signIn = fn; } }, said: { textContent: '' }, back: { hidden: true, href: '' } };
    vm.runInNewContext(script, {
      location: { search, pathname: '/sign-in', replace: (u) => went.push(u) },
      URLSearchParams,
      document: { getElementById: (id) => els[id] || null },
      fetch: async (p, init) => {
        sent.push({ path: p, body: JSON.parse(init.body) });
        return { ok: true, json: async () => (p === '/sign-in/options' ? { publicKey: { challenge: 'AAAA' } } : { ok: true, code: 'the-code' }) };
      },
      navigator: { credentials: { get: async () => ({ id: 'k', rawId: new Uint8Array([1]).buffer, type: 'public-key', response: { clientDataJSON: new Uint8Array([2]).buffer } }) } },
      atob: (t) => Buffer.from(t, 'base64').toString('binary'),
      btoa: (t) => Buffer.from(t, 'binary').toString('base64'),
      encodeURIComponent, Uint8Array, String, Object, Error,
    });
    await listeners.signIn();
    return { signIn: sent.find((x) => x.path === '/sign-in').body, went };
  };
  const native = await run('?app=desktop&handoff=abc');
  assert.equal(native.signIn.app, 'desktop');
  assert.equal(native.signIn.handoff, 'abc');
  assert.deepEqual(native.went, ['botdot://signed-in?code=the-code']);
  const other = await run('?app=fridge&handoff=abc');
  assert.equal(other.signIn.app, 'web');
  assert.equal(other.signIn.handoff, undefined);
});

test('the admin page names feedback from the desktop app', async () => {
  const script = (await door.browser().get('/front-door/admin.js')).text;
  assert.ok(script.includes("desktop: 'desktop app'"), 'the name of the app in a report');
});
