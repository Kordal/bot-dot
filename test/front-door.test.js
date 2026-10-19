// The front door over HTTP (seam 1, ADR 028): sign-up links, passkey sign-up and sign-in, sessions, that a
// signed-in person reaches their own account's botdot server and nothing else, and that a job's call reaches its
// account's botdot server without a session, with wrong keys slowed down (ADR 026). Two stand-in botdot servers listen
// on their accounts' sockets; a software passkey (fixtures/soft-passkey.js) stands in for the browser's.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

let door;
const stands = {};
before(async () => {
  door = await startFrontDoor();
  stands.ann = await standIn(door, 'ann');
  stands.bob = await standIn(door, 'bob');
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
});

// A browser of its own: its cookie jar, its passkey.
const browser = () => door.browser();

// Signs up with a sign-up link as `name`; returns the browser, signed in, and its passkey (alg: as soft-passkey's).
// d: the front door, this file's own by default.
async function signUp(name, link = null, alg = 'ES256', d = door) {
  link ||= d.newLink();
  const b = d.browser();
  const key = passkey.create({ rpId: d.rpId, origin: d.origin, alg });
  const page = await b.get(link.path);
  assert.equal(page.status, 200);
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return { b, key };
}

async function signIn(key, b = browser(), over = {}) {
  const options = await b.post('/sign-in/options', {});
  assert.equal(options.status, 200, options.text);
  return { b, r: await b.post('/sign-in', { credential: key.signIn(options.data.publicKey, over) }) };
}

test('the first start prints a sign-up link, and its page says the admin can reach everything', async () => {
  assert.ok(door.firstLink, `printed a link:\n${door.log.join('')}`);
  const page = await browser().get(door.firstLink.path);
  assert.equal(page.status, 200);
  assert.match(page.text, /admin of this machine can technically reach everything in your account/i);
});

test('a sign-up link makes the account and its passkey, signs it in, and works once', async () => {
  const link = door.newLink();
  const { b } = await signUp('ann', link);
  const r = await b.get('/api/bots');
  assert.equal(r.status, 200);
  assert.equal(r.data.account, 'ann', "passed to ann's botdot server, naming ann");
  // Used: neither its page nor a second sign-up works.
  assert.equal((await browser().get(link.path)).status, 410);
  const again = await browser().post(`${link.path}/options`, { name: 'carl' });
  assert.equal(again.status, 410);
});

test('a sign-up link ends after 7 days', async () => {
  const link = door.newLink({ ageDays: 7.01 });
  assert.equal((await browser().get(link.path)).status, 410);
  assert.equal((await browser().post(`${link.path}/options`, { name: 'dora' })).status, 410);
  const fresh = door.newLink({ ageDays: 6.9 });
  assert.equal((await browser().get(fresh.path)).status, 200);
});

test('an account name is taken once', async () => {
  await signUp('eve');
  const r = await browser().post(`${door.newLink().path}/options`, { name: 'eve' });
  assert.equal(r.status, 409);
  const bad = await browser().post(`${door.newLink().path}/options`, { name: '../bob' });
  assert.equal(bad.status, 400);
});

test('a passkey made for another site, or with a wrong challenge, makes no account', async () => {
  const link = door.newLink();
  const b = browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name: 'fay' });
  const wrongOrigin = await b.post(link.path, { name: 'fay', credential: key.register(options.data.publicKey, { origin: 'https://evil.example' }) });
  assert.equal(wrongOrigin.status, 400);
  const options2 = await b.post(`${link.path}/options`, { name: 'fay' });
  const wrongRp = await b.post(link.path, { name: 'fay', credential: key.register(options2.data.publicKey, { rpId: 'evil.example' }) });
  assert.equal(wrongRp.status, 400);
  const wrongChallenge = await b.post(link.path, { name: 'fay', credential: key.register(options2.data.publicKey, { challenge: 'bm9wZQ' }) });
  assert.equal(wrongChallenge.status, 400);
  assert.equal((await b.get('/api/bots')).status, 401, 'not signed in');
  // The link still works after the failed tries.
  assert.equal((await b.get(link.path)).status, 200);
});

test('a browser signs in with the passkey and keeps its own session; signing out ends only that one', async () => {
  const { b: first, key } = await signUp('gus');
  const stand = await standIn(door, 'gus');
  try {
    const { b: second, r } = await signIn(key);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.account, 'gus');
    assert.equal((await second.get('/api/bots')).data.account, 'gus');
    assert.equal((await second.post('/sign-out', {})).status, 200);
    assert.equal((await second.get('/api/bots')).status, 401, 'signed out');
    assert.equal((await first.get('/api/bots')).status, 200, 'the other session goes on');
  } finally { stand.close(); }
});

test("a session reaches only its own account's botdot server", async () => {
  const { b: ann } = await signUp('ann2');
  const before = stands.bob.seen.length;
  // Naming another account in the request changes nothing: the front door says whose it is.
  const r = await ann.get('/api/bots', { 'X-Botdot-Account': 'bob' });
  assert.notEqual(r.data?.account, 'bob');
  assert.equal(stands.bob.seen.length, before, "nothing of ann2's reached bob's botdot server");
});

test("the session cookie stays with the front door: the botdot server doesn't get it", async () => {
  const { b } = await signUp('hal');
  const stand = await standIn(door, 'hal');
  try {
    const r = await b.get('/api/bots', { Cookie: `${b.cookie()}; theme=dark` });
    assert.equal(r.data.account, 'hal');
    assert.doesNotMatch(String(r.data.cookie), /botdot_session/);
  } finally { stand.close(); }
});

test('a request without a session never reaches a botdot server', async () => {
  const counts = () => Object.values(stands).map((s) => s.seen.length).join();
  const was = counts();
  const b = browser();
  const api = await b.get('/api/bots');
  assert.equal(api.status, 401);
  assert.equal(api.data.signIn, '/sign-in');
  const page = await b.get('/');
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, '/sign-in');
  assert.equal((await b.get('/api/bots', { Cookie: 'botdot_session=made-up' })).status, 401);
  assert.equal(counts(), was);
});

test('a WebSocket without a session is refused; with one it reaches its account', async () => {
  const { b } = await signUp('ivy');
  const stand = await standIn(door, 'ivy');
  try {
    assert.match(await door.upgrade('/computer/x/websockify', {}), /^HTTP\/1\.1 401/);
    const answer = await door.upgrade('/computer/x/websockify', { Cookie: b.cookie() });
    assert.match(answer, /^HTTP\/1\.1 101/);
    assert.match(answer, /account: ivy/i);
  } finally { stand.close(); }
});

test("an account whose botdot server isn't running gets a sentence", async () => {
  const { b } = await signUp('jon');
  const r = await b.get('/api/bots');
  assert.equal(r.status, 502);
  assert.match(r.data.error, /botdot server isn.t running/);
});

test('version without a session is the front door’s, and announces accounts and passkeys', async () => {
  const r = await browser().get('/api/version');
  assert.equal(r.status, 200);
  assert.equal(r.data.app, 'bot-dot');
  assert.ok(r.data.features.includes('accounts'));
  assert.ok(r.data.features.includes('passkeys'));
});

test('a wrong signature, an unknown passkey and another site are refused', async () => {
  const { key } = await signUp('kim');
  assert.equal((await signIn(key, browser(), { signature: Buffer.alloc(70, 1) })).r.status, 401);
  assert.equal((await signIn(key, browser(), { origin: 'https://evil.example' })).r.status, 401);
  const stranger = passkey.create({ rpId: door.rpId, origin: door.origin });
  assert.equal((await signIn(stranger, browser())).r.status, 401);
  assert.equal((await signIn(key)).r.status, 200, 'the right one still signs in');
});

test('a challenge is used once', async () => {
  const { key } = await signUp('lea');
  const b = browser();
  const options = await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: key.signIn(options.data.publicKey) })).status, 200);
  assert.equal((await b.post('/sign-in', { credential: key.signIn(options.data.publicKey) })).status, 401);
});

test('writes to the front door need X-Bot-Dot, and a foreign host is refused', async () => {
  const b = browser();
  assert.equal((await b.post('/sign-in/options', {}, { 'X-Bot-Dot': '' })).status, 403);
  assert.equal((await b.get('/sign-in', { Host: 'evil.example' })).status, 403);
});

test('repeated failed sign-ins are slowed down', async () => {
  const slow = await startFrontDoor();
  try {
    const stranger = passkey.create({ rpId: slow.rpId, origin: slow.origin });
    const b = slow.browser();
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const options = await b.post('/sign-in/options', {});
      if (options.status === 429) { statuses.push(429); continue; }
      statuses.push((await b.post('/sign-in', { credential: stranger.signIn(options.data.publicKey) })).status);
    }
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.ok(statuses.slice(5).every((s) => s === 429), `then slowed down: ${statuses}`);
    const r = await b.post('/sign-in/options', {});
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) >= 1);
    assert.match(r.data.error, /Try again in/);
    // Wrong sign-up links count too.
    assert.equal((await slow.browser().get('/sign-up/not-a-link')).status, 429);
  } finally { await slow.stop(); }
});

test('a wrong sign-up link is refused and counted', async () => {
  const fresh = await startFrontDoor();
  try {
    const b = fresh.browser();
    assert.equal((await b.get('/sign-up/not-a-link')).status, 410);
  } finally { await fresh.stop(); }
});

test('the data folder and the sessions in it are private', () => {
  const mode = (p) => fs.statSync(p).mode & 0o777;
  assert.equal(mode(door.data), 0o700);
  for (const f of fs.readdirSync(door.data)) assert.equal(mode(path.join(door.data, f)) & 0o077, 0, f);
});

test('passkeys of the three kinds browsers offer sign up and sign in', async () => {
  for (const alg of ['EdDSA', 'RS256']) {
    const { key } = await signUp(`kind-${alg.toLowerCase()}`, door.newLink(), alg);
    const { r } = await signIn(key);
    assert.equal(r.status, 200, `${alg}: ${r.text}`);
  }
});

test('a copied passkey, whose count did not go up, and one used without the person verified, are refused', async () => {
  const { key } = await signUp('nia');
  assert.equal((await signIn(key, browser(), { count: 5 })).r.status, 200);
  assert.equal((await signIn(key, browser(), { count: 5 })).r.status, 401, 'the same count again: a copy');
  assert.equal((await signIn(key, browser(), { count: 3 })).r.status, 401, 'a lower one');
  assert.equal((await signIn(key, browser(), { count: 6, unverified: true })).r.status, 401);
  assert.equal((await signIn(key, browser(), { count: 7 })).r.status, 200);
});

test('a body that is too large is refused', async () => {
  const r = await browser().post('/sign-in', { credential: { id: 'x'.repeat(70 * 1024) } });
  assert.equal(r.status, 413);
});

test('a client holds only so many challenges: the oldest ends', async () => {
  const { key } = await signUp('ora');
  const b = browser();
  const first = await b.post('/sign-in/options', {});
  for (let i = 0; i < 20; i++) await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: key.signIn(first.data.publicKey) })).status, 401);
  const last = await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: key.signIn(last.data.publicKey) })).status, 200);
});

// ---------- calls (ADR 026) ----------

// A call as a sender sends it: no cookie, the job's key in Authorization, a body of text. d: the front door.
const call = (p, { key, body = 'motion', d = door, headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: d.port, method: 'POST', path: p, headers: { Host: `localhost:${d.port}`, 'Content-Type': 'text/plain', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => { let data = null; try { data = JSON.parse(text); } catch { /* text */ } resolve({ status: res.statusCode, headers: res.headers, data }); });
  });
  req.on('error', reject);
  req.end(body);
});
// A botdot server that takes a call with the key "right" only, as botdot checks a job's key.
const KEYED = { answer: (req) => (req.url.endsWith('/call') && req.headers.authorization === 'Bearer right' ? [202, { runId: 'r1' }] : [401, { error: 'Wrong key.' }]) };

test("a call reaches its account's botdot server without a session, as the job's call, with only what a call needs", async () => {
  await signUp('pat');
  const stand = await standIn(door, 'pat', KEYED);
  try {
    const others = Object.values(stands).map((s) => s.seen.length).join();
    const r = await call('/call/pat/b123/j456', {
      key: 'right', body: '{"camera":"garage"}',
      headers: { 'X-Forwarded-For': '203.0.113.9', Cookie: 'theme=dark', 'X-Chief-Key': 'k', 'X-Run-Token': 't', 'Tailscale-User-Login': 'a@b.c', 'X-Botdot-Account': 'bob' },
    });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    assert.equal(r.data.runId, 'r1');
    const got = stand.seen.at(-1);
    assert.equal(got.method, 'POST');
    assert.equal(got.url, '/api/bots/b123/jobs/j456/call');
    assert.equal(got.body, '{"camera":"garage"}');
    assert.equal(got.headers.authorization, 'Bearer right');
    assert.equal(got.headers['x-botdot-account'], 'pat');
    assert.equal(got.headers['x-forwarded-for'], '203.0.113.9', 'the sender, as Caddy or Serve in front named it');
    for (const h of ['cookie', 'x-chief-key', 'x-run-token', 'tailscale-user-login']) assert.equal(got.headers[h], undefined, h);
    assert.equal(Object.values(stands).map((s) => s.seen.length).join(), others, "no other account's botdot server saw it");
    // A signed call's signature, in either form (#37), reaches it too; the botdot server checks it.
    const signed = { 'X-Botdot-Timestamp': '1800000000', 'X-Botdot-Signature-256': `sha256=${'a'.repeat(64)}`, 'X-Hub-Signature-256': `sha256=${'b'.repeat(64)}`, 'X-GitHub-Event': 'push' };
    assert.equal((await call('/call/pat/b123/j456', { key: 'right', body: '{}', headers: signed })).status, 202);
    const passed = stand.seen.at(-1).headers;
    assert.deepEqual([passed['x-botdot-timestamp'], passed['x-botdot-signature-256'], passed['x-hub-signature-256'], passed['x-github-event']], ['1800000000', `sha256=${'a'.repeat(64)}`, `sha256=${'b'.repeat(64)}`, undefined]);
  } finally { stand.close(); }
});

test('a call to an account that does not exist, or to no call address, reaches no botdot server', async () => {
  const counts = () => Object.values(stands).map((s) => s.seen.length).join();
  const was = counts();
  const r = await call('/call/nobody-here/b1/j1', { key: 'right' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'Wrong key.', 'as a wrong key: a sender without the key learns nothing');
  assert.equal((await call('/call/ann/b1', { key: 'right' })).status, 404);
  assert.notEqual((await call('/call/../ann/b1/j1', { key: 'right' })).status, 202);
  assert.equal((await call('/call/Ann/b1/j1', { key: 'right' })).status, 404);
  assert.equal(counts(), was);
});

test("a call to an account whose botdot server isn't running gets a sentence", async () => {
  await signUp('quinn');
  const r = await call('/call/quinn/b1/j1', { key: 'right' });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /isn.t running/);
});

test('repeated wrong keys are slowed down, and a sign-in is not', async () => {
  const slow = await startFrontDoor();
  try {
    await signUp('rex', null, 'ES256', slow);
    const stand = await standIn(slow, 'rex', KEYED);
    try {
      const statuses = [];
      for (let i = 0; i < 7; i++) statuses.push((await call('/call/rex/b1/j1', { key: 'wrong', d: slow })).status);
      assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
      assert.ok(statuses.slice(5).every((s) => s === 429), `then slowed down: ${statuses}`);
      const seen = stand.seen.length;
      const r = await call('/call/rex/b1/j1', { key: 'right', d: slow });
      assert.equal(r.status, 429, 'the right key waits too');
      assert.ok(Number(r.headers['retry-after']) >= 1);
      assert.match(r.data.error, /wrong key.*Try again in/);
      assert.equal(stand.seen.length, seen, 'a slowed-down call reaches no botdot server');
      // Calls to accounts that don't exist count, each client on its own, and sign-ins have their own count.
      const other = { 'X-Forwarded-For': '198.51.100.7' };
      for (let i = 0; i < 5; i++) assert.equal((await call('/call/nobody-here/b1/j1', { key: 'x', d: slow, headers: other })).status, 401);
      assert.equal((await call('/call/rex/b1/j1', { key: 'right', d: slow, headers: other })).status, 429);
      assert.equal((await call('/call/rex/b1/j1', { key: 'right', d: slow, headers: { 'X-Forwarded-For': '198.51.100.8' } })).status, 202);
      assert.equal((await slow.browser().post('/sign-in/options', {})).status, 200);
    } finally { stand.close(); }
  } finally { await slow.stop(); }
});

test("a session's own request to a job's call is refused: a call goes to its call address, where it is counted", async () => {
  const { b } = await signUp('sam');
  const stand = await standIn(door, 'sam', KEYED);
  try {
    const r = await b.post('/api/bots/b1/jobs/j1/call', {}, { Authorization: 'Bearer right' });
    assert.equal(r.status, 404);
    assert.equal(stand.seen.length, 0);
    await b.get('/api/bots/b1/jobs/j1/call/setup');
    assert.equal(stand.seen.at(-1).url, '/api/bots/b1/jobs/j1/call/setup', 'other routes pass on as before');
  } finally { stand.close(); }
});

test('"Sign out everywhere" ends every session of the account, and no other account\'s', async () => {
  const { b: first, key } = await signUp('pia');
  const { b: other } = await signUp('quin');
  const stands2 = [await standIn(door, 'pia'), await standIn(door, 'quin')];
  try {
    const { b: second } = await signIn(key);
    const { b: third } = await signIn(key);
    assert.equal((await second.get('/api/bots')).status, 200);
    // Without X-Bot-Dot, or without a session, nothing ends.
    assert.equal((await second.post('/sign-out-everywhere', {}, { 'X-Bot-Dot': '' })).status, 403);
    const none = await browser().post('/sign-out-everywhere', {});
    assert.equal(none.status, 401);
    assert.equal(none.data.signIn, '/sign-in');
    assert.equal((await first.get('/api/bots')).status, 200);
    const r = await second.post('/sign-out-everywhere', {});
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.data, { ok: true, ended: 3 });
    for (const b of [first, second, third]) {
      const after = await b.get('/api/bots');
      assert.equal(after.status, 401);
      assert.equal(after.data.signIn, '/sign-in');
    }
    assert.equal((await other.get('/api/bots')).data.account, 'quin', "another account's session goes on");
    // The passkey still signs in again.
    assert.equal((await signIn(key)).r.status, 200);
  } finally { for (const s of stands2) s.close(); }
});

// botdot's release key (the app on botdot's releases page), as the Android release workflow checks each release.
const RELEASE_KEY = (() => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'android.yml'), 'utf8');
  return workflow.match(/certificate SHA-256 digest: ([0-9a-f]{64})\$/)[1].toUpperCase().match(/../g).join(':');
})();
const appOriginOf = (fingerprint) => `android:apk-key-hash:${Buffer.from(fingerprint.split(':').join(''), 'hex').toString('base64url')}`;

test("the Android app's passkey signs in from the app named in FRONT_DOOR_ANDROID_KEYS, and the front door says so for Android", async () => {
  const fingerprint = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase()).join(':');
  const appOrigin = appOriginOf(fingerprint);
  const own = await startFrontDoor({ env: { FRONT_DOOR_ANDROID_KEYS: `${fingerprint}, not-a-fingerprint, ${RELEASE_KEY.toLowerCase()}` } });
  try {
    // Asked without a session: what Android's Credential Manager reads to trust the app with this site's passkeys.
    const links = await own.browser().get('/.well-known/assetlinks.json');
    assert.equal(links.status, 200, links.text);
    assert.deepEqual(links.data, [{
      relation: ['delegate_permission/common.get_login_creds'],
      target: { namespace: 'android_app', package_name: 'dev.botdot.app', sha256_cert_fingerprints: [RELEASE_KEY, fingerprint] },
    }], 'the release key once, then the ones named');
    // A wrong entry is said at start, not left out in silence (#82).
    assert.match(own.log.join(''), /FRONT_DOOR_ANDROID_KEYS: "not-a-fingerprint" is no SHA-256 fingerprint/);
    assert.match(own.log.join(''), /the Android app signs in as botdot's release build and with 1 more key from FRONT_DOOR_ANDROID_KEYS/);
    const link = own.newLink();
    const web = own.browser();
    const key = passkey.create({ rpId: own.rpId, origin: own.origin });
    const options = await web.post(`${link.path}/options`, { name: 'rae' });
    assert.equal((await web.post(link.path, { name: 'rae', credential: key.register(options.data.publicKey) })).status, 201);
    // The same passkey, used in the app: the origin is the app's signing key.
    const phone = own.browser();
    const o = await phone.post('/sign-in/options', {});
    const r = await phone.post('/sign-in', { credential: key.signIn(o.data.publicKey, { origin: appOrigin }), app: 'android' });
    assert.equal(r.status, 200, r.text);
    const o2 = await phone.post('/sign-in/options', {});
    const stranger = `android:apk-key-hash:${Buffer.alloc(32, 9).toString('base64url')}`;
    assert.equal((await phone.post('/sign-in', { credential: key.signIn(o2.data.publicKey, { origin: stranger }), app: 'android' })).status, 401, 'another app');
  } finally { await own.stop(); }
});

test("without FRONT_DOOR_ANDROID_KEYS the app from botdot's releases still signs in, and no other build (#82)", async () => {
  const { key } = await signUp('sol');
  const links = await browser().get('/.well-known/assetlinks.json');
  assert.equal(links.status, 200, links.text);
  assert.deepEqual(links.data[0].target.sha256_cert_fingerprints, [RELEASE_KEY]);
  assert.match(door.log.join(''), /FRONT_DOOR_ANDROID_KEYS is not set: the Android app signs in only as botdot's release build/);
  assert.equal((await signIn(key, browser(), { origin: appOriginOf(RELEASE_KEY) })).r.status, 200, 'the release build');
  const stranger = `android:apk-key-hash:${Buffer.alloc(32, 9).toString('base64url')}`;
  assert.equal((await signIn(key, browser(), { origin: stranger })).r.status, 401, 'a build with another key');
});
