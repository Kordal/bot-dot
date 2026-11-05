// The terms and the privacy policy an owner agrees to (#987): with FRONT_DOOR_TERMS_URL and FRONT_DOOR_PRIVACY_URL set,
// a sign-up makes no passkey until "I agree" is ticked, the account's record keeps the version and the time, the
// audit log has an entry for each agreement, and a sign-in after the version changed asks once more. Unset, nothing
// changes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const passkey = require('./fixtures/soft-passkey');
const store = require('../lib/front-door/store');
const termsLib = require('../lib/front-door/terms');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const TERMS = { FRONT_DOOR_TERMS_URL: 'https://botdot.example/terms', FRONT_DOOR_PRIVACY_URL: 'https://botdot.example/privacy', FRONT_DOOR_TERMS_VERSION: '2026-11' };

let door;
let plain;
const stands = [];
before(async () => {
  [door, plain] = await Promise.all([startFrontDoor({ env: TERMS }), startFrontDoor()]);
  for (const name of ['ann', 'bob', 'cat', 'dan']) stands.push(await standIn(door, name));
  stands.push(await standIn(plain, 'eve'));
});
after(async () => {
  await Promise.all([door?.stop(), plain?.stop()]);
  for (const s of stands) s.close();
});

const saved = (d) => JSON.parse(fs.readFileSync(path.join(d.data, 'front-door.json'), 'utf8'));
const agreements = (d) => fs.readFileSync(path.join(d.data, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.action === 'terms-agreed');

async function signUp(d, name, extra) {
  const b = d.browser();
  const key = passkey.create({ rpId: d.rpId, origin: d.origin });
  const link = d.newLink();
  const options = await b.post(`${link.path}/options`, { name, ...extra });
  assert.equal(options.status, 200, options.text);
  const made = await b.post(link.path, { name, ...extra, credential: key.register(options.data.publicKey) });
  assert.equal(made.status, 201, made.text);
  return { b, key };
}
async function signIn(d, key, b = d.browser()) {
  const options = await d.browser().post('/sign-in/options', {});
  return { b, r: await b.post('/sign-in', { credential: key.signIn(options.data.publicKey) }) };
}

test('the settings: both addresses or none, a version of a few plain characters, 1 unless said', () => {
  const warned = [];
  const warn = (l) => warned.push(l);
  assert.equal(termsLib.fromEnv({}, warn), null);
  assert.deepEqual(termsLib.fromEnv({ FRONT_DOOR_TERMS_URL: 'https://a/t', FRONT_DOOR_PRIVACY_URL: 'https://a/p' }, warn), { terms: 'https://a/t', privacy: 'https://a/p', version: '1' });
  assert.equal(warned.length, 0);
  assert.equal(termsLib.fromEnv({ FRONT_DOOR_TERMS_URL: 'https://a/t' }, warn), null, 'one address alone asks nothing');
  assert.equal(termsLib.fromEnv({ FRONT_DOOR_TERMS_URL: 'javascript:alert(1)', FRONT_DOOR_PRIVACY_URL: 'https://a/p' }, warn), null);
  assert.equal(termsLib.fromEnv({ ...TERMS, FRONT_DOOR_TERMS_VERSION: 'v 2 <b>' }, warn), null);
  assert.equal(warned.length, 3);
});

test('with both addresses set, sign-up makes no passkey until the box is ticked, and the record keeps the version and the time', async () => {
  const link = door.newLink();
  const page = await door.browser().get(link.path);
  assert.equal(page.status, 200);
  assert.match(page.text, /<input id="agree" name="agree" type="checkbox" required>/);
  assert.match(page.text, /I agree to the <a href="https:\/\/botdot\.example\/terms" target="_blank" rel="noopener noreferrer">Terms<\/a> and the <a href="https:\/\/botdot\.example\/privacy" target="_blank" rel="noopener noreferrer">Privacy policy<\/a>/);
  assert.match(page.headers['content-security-policy'], /default-src 'none'; script-src 'self'/, 'the page keeps its CSP');
  assert.ok(!/<script>|\son[a-z]+="/.test(page.text), 'no inline script or handler');

  const b = door.browser();
  for (const agree of [undefined, false, 'yes']) {
    const refused = await b.post(`${link.path}/options`, { name: 'ann', ...(agree === undefined ? {} : { agree }) });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /Tick the box/);
  }
  // A passkey made for the page, then sent without the box: no account.
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name: 'ann', agree: true });
  assert.equal(options.status, 200);
  const credential = key.register(options.data.publicKey);
  assert.equal((await b.post(link.path, { name: 'ann', credential })).status, 400);
  assert.equal(saved(door).accounts.ann, undefined);

  const started = Date.now();
  const made = await b.post(link.path, { name: 'ann', agree: true, credential });
  assert.equal(made.status, 201, made.text);
  const terms = saved(door).accounts.ann.terms;
  assert.equal(terms.version, '2026-11');
  assert.ok(Date.parse(terms.at) >= started - 1000 && Date.parse(terms.at) <= Date.now());
  const entry = agreements(door).find((e) => e.account === 'ann');
  assert.equal(entry.actor, 'front-door');
  assert.equal(entry.detail, 'version 2026-11 · at sign-up');

  // Signed in straight away: the version is the one in force.
  const { r } = await signIn(door, key);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.account, 'ann');
  assert.match(String(r.headers['set-cookie']), /botdot_session=/);
});

test('a changed version asks once at the next sign-in, and the account opens after the box is ticked', async () => {
  const { key } = await signUp(door, 'bob', { agree: true });
  // The version in force is newer than the one bob agreed to.
  const d = saved(door);
  d.accounts.bob.terms = { version: '2025-01', at: '2025-01-01T00:00:00.000Z' };
  fs.writeFileSync(path.join(door.data, 'front-door.json'), JSON.stringify(d));

  const page = await door.browser().get('/sign-in');
  assert.match(page.text, /<form id="agree-again" hidden><label class="agree"><input id="agree" name="agree" type="checkbox" required>/);

  const { b, r } = await signIn(door, key);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.ok, false);
  assert.match(r.data.agreement, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(r.data.terms, { terms: TERMS.FRONT_DOOR_TERMS_URL, privacy: TERMS.FRONT_DOOR_PRIVACY_URL, version: '2026-11' });
  assert.equal(r.headers['set-cookie'], undefined, 'no session before the agreement');
  assert.equal((await b.get('/api/bots')).status, 401);

  assert.equal((await b.post('/sign-in/agree', { agreement: r.data.agreement })).status, 400, 'not ticked');
  assert.equal((await b.post('/sign-in/agree', { agreement: 'x'.repeat(43), agree: true })).status, 401, 'not a sign-in that waits');
  const before = agreements(door).length;
  const done = await b.post('/sign-in/agree', { agreement: r.data.agreement, agree: true });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.account, 'bob');
  assert.equal((await b.get('/api/bots')).data.account, 'bob');
  assert.equal(saved(door).accounts.bob.terms.version, '2026-11');
  const entries = agreements(door);
  assert.equal(entries.length, before + 1);
  assert.equal(entries.at(-1).account, 'bob');
  assert.equal(entries.at(-1).detail, 'version 2026-11 · at sign-in');
  assert.equal((await b.post('/sign-in/agree', { agreement: r.data.agreement, agree: true })).status, 401, 'used once');

  // Asked once: the next sign-in opens the account.
  const again = await signIn(door, key);
  assert.equal(again.r.data.account, 'bob');
  assert.match(String(again.r.headers['set-cookie']), /botdot_session=/);
});

test("an app's sign-in after a changed version hands its code back once the box is ticked", async () => {
  const { key } = await signUp(door, 'cat', { agree: true });
  const d = saved(door);
  delete d.accounts.cat.terms; // an account from before the machine asked
  fs.writeFileSync(path.join(door.data, 'front-door.json'), JSON.stringify(d));
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const sheet = door.browser();
  const options = await sheet.post('/sign-in/options', {});
  const r = await sheet.post('/sign-in', { credential: key.signIn(options.data.publicKey), app: 'android', handoff: challenge });
  assert.ok(r.data.agreement);
  const done = await sheet.post('/sign-in/agree', { agreement: r.data.agreement, agree: true });
  assert.match(done.data.code, /^[A-Za-z0-9_-]{43}$/);
  const app = door.browser();
  assert.equal((await app.post('/sign-in/handoff', { code: done.data.code, verifier })).data.account, 'cat');
});

test("the admin's sign-in link asks for the box when the account hasn't agreed to the version in force", async () => {
  await signUp(door, 'dan', { agree: true });
  const d = saved(door);
  d.accounts.dan.terms = { version: 'old', at: '2025-01-01T00:00:00.000Z' };
  fs.writeFileSync(path.join(door.data, 'front-door.json'), JSON.stringify(d));
  const { url } = store.open(door.data).newSignInLink({ origin: door.origin, account: 'dan' });
  const at = new URL(url).pathname;
  const b = door.browser();
  assert.match((await b.get(at)).text, /name="agree" type="checkbox" required/);
  assert.equal((await b.post(`${at}/options`, { name: 'dan' })).status, 400);
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${at}/options`, { name: 'dan', agree: true });
  const made = await b.post(at, { name: 'dan', agree: true, credential: key.register(options.data.publicKey) });
  assert.equal(made.status, 201, made.text);
  assert.equal(saved(door).accounts.dan.terms.version, '2026-11');
  assert.equal(agreements(door).at(-1).detail, "version 2026-11 · with the admin's sign-in link");
});

test('with no addresses set, sign-up and sign-in work exactly as today', async () => {
  const link = plain.newLink();
  const page = await plain.browser().get(link.path);
  assert.ok(!page.text.includes('name="agree"'), 'no box');
  assert.ok(!(await plain.browser().get('/sign-in')).text.includes('agree-again'));
  const { key } = await signUp(plain, 'eve');
  assert.equal(saved(plain).accounts.eve.terms, undefined);
  const { r } = await signIn(plain, key);
  assert.equal(r.data.account, 'eve');
  assert.equal(r.data.agreement, undefined);
  assert.match(String(r.headers['set-cookie']), /botdot_session=/);
  assert.equal((await plain.browser().post('/sign-in/agree', { agreement: 'x'.repeat(43), agree: true })).status, 401);
  assert.equal(agreements(plain).length, 0);
});

test('one account: the setup key asks for the box too, and its agreement is kept in the audit log', async () => {
  const SETUP_KEY = crypto.randomBytes(32).toString('base64url');
  const one = await startFrontDoor({ env: { ...TERMS, FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY } });
  const stand = await standIn(one, 'owner');
  try {
    const at = `/sign-up/${SETUP_KEY}`;
    const b = one.browser();
    assert.match((await b.get(at)).text, /name="agree" type="checkbox" required/);
    assert.equal((await b.post(`${at}/options`, { name: 'owner' })).status, 400);
    const key = passkey.create({ rpId: one.rpId, origin: one.origin });
    const options = await b.post(`${at}/options`, { name: 'owner', agree: true });
    const made = await b.post(at, { name: 'owner', agree: true, credential: key.register(options.data.publicKey) });
    assert.equal(made.status, 201, made.text);
    assert.equal(saved(one).accounts.owner.terms.version, '2026-11');
    assert.equal(agreements(one).at(-1).detail, 'version 2026-11 · at sign-up');
  } finally {
    await one.stop();
    stand.close();
  }
});
