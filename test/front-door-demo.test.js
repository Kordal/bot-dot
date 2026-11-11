const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startFrontDoor } = require('./front-door-helpers');
const code = 'review-' + 'a'.repeat(32);
const hash = crypto.createHash('sha256').update(code).digest('hex');

test('a dedicated demo accepts its code repeatedly, rejects a wrong code and hands a native app its own session', async (t) => {
  const door = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'demo', FRONT_DOOR_DEMO_CODE_SHA256: hash } });
  t.after(door.stop);
  assert.match((await door.browser().get('/sign-in')).text, /Demo access code/);
  assert.equal((await door.browser().post('/sign-in', { demoCode: 'wrong' })).status, 401);
  for (let n = 0; n < 2; n++) {
    const b = door.browser();
    assert.equal((await b.post('/sign-in', { demoCode: code })).status, 200);
    assert.equal((await b.get('/front-door/session')).data.account, 'demo');
  }
  const verifier = crypto.randomBytes(32).toString('base64url');
  const native = await door.browser().post('/sign-in', { demoCode: code, app: 'android', handoff: crypto.createHash('sha256').update(verifier).digest('base64url') });
  assert.equal(native.status, 200);
  assert.match(native.data.next, /^botdot:\/\/signed-in/);
  const app = door.browser();
  assert.equal((await app.post('/sign-in/handoff', { code: native.data.code, verifier })).status, 200);
  const audit = require('node:fs').readFileSync(require('node:path').join(door.data, 'audit.jsonl'), 'utf8');
  assert.ok(audit.includes('demo-sign-in'));
  assert.ok(!audit.includes(code));
});

test('a normal machine never offers or accepts a demo code', async (t) => {
  const door = await startFrontDoor();
  t.after(door.stop);
  assert.doesNotMatch((await door.browser().get('/sign-in')).text, /Demo access code/);
  assert.equal((await door.browser().post('/sign-in', { demoCode: code })).status, 401);
});


test('a customer account cannot be converted into a demo, while a demo survives a restart', (t) => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-account-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = require('../lib/front-door/store').open(dir);
  store.createOnlyAccount({ name: 'owner', userId: 'customer', passkey: { id: 'key', alg: 'ES256', jwk: {}, signCount: 0 } });
  assert.throws(() => store.createDemoAccount('owner'), /customer account/);
  const demoDir = dir + '/demo';
  const demos = require('../lib/front-door/store').open(demoDir);
  demos.createDemoAccount('demo');
  require('../lib/front-door/store').open(demoDir).createDemoAccount('demo');
  assert.equal(demos.accountCount(), 1);
});
