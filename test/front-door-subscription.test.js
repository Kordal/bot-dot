// Settings' "Subscription" on a managed machine (ADR 234): the front door's session names the billing page the fleet
// console gave the installer (FRONT_DOOR_SUBSCRIPTION_URL), `{account}` filled in; only https, only managed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const sub = require('../lib/front-door/subscription');

const SETUP_KEY = 's'.repeat(40);

test('the address is taken only on a managed machine and only when it is https', () => {
  const said = [];
  const warn = (l) => said.push(l);
  assert.equal(sub.fromEnv({}, true, warn), null, 'unset: no row');
  assert.equal(said.length, 0, 'and nothing said');
  assert.equal(sub.fromEnv({ FRONT_DOOR_SUBSCRIPTION_URL: 'https://billing.example/p/{account}' }, true, warn), 'https://billing.example/p/{account}');
  assert.equal(sub.fromEnv({ FRONT_DOOR_SUBSCRIPTION_URL: 'https://billing.example/p' }, false, warn), null, 'a self-hosted machine has none');
  for (const bad of ['http://billing.example/p', 'javascript:alert(1)', 'billing.example', 'https://']) {
    assert.equal(sub.fromEnv({ FRONT_DOOR_SUBSCRIPTION_URL: bad }, true, warn), null, bad);
  }
  assert.equal(said.length, 5, 'each wrong one is said');
});

test("{account} is the account's name, URL-encoded", () => {
  assert.equal(sub.page('https://billing.example/p?a={account}', 'ann'), 'https://billing.example/p?a=ann');
  assert.equal(sub.page('https://billing.example/{account}/{account}', 'a-b'), 'https://billing.example/a-b/a-b');
  assert.equal(sub.page('https://billing.example/p', 'ann'), 'https://billing.example/p', 'one page for every account');
  assert.equal(sub.page('HTTPS://Billing.Example/p', 'ann'), 'https://billing.example/p', 'normalised for the apps');
  assert.equal(sub.page(null, 'ann'), null);
  assert.equal(sub.page('https://billing.example/p', null), null);
});

async function session(env) {
  const door = await startFrontDoor({ env: { FRONT_DOOR_ONE_ACCOUNT: 'solo', FRONT_DOOR_SETUP_KEY: SETUP_KEY, ...env } });
  const s = await standIn(door, 'solo', { answer: () => [200, { account: 'solo' }] });
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`/sign-up/${SETUP_KEY}/options`, { name: 'solo' });
  const done = await b.post(`/sign-up/${SETUP_KEY}`, { name: 'solo', credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  const data = (await b.get('/front-door/session')).data;
  await door.stop(); s.close();
  return data;
}

test("a managed machine's session names its account's billing page", async () => {
  const data = await session({ FRONT_DOOR_MANAGED: '1', FRONT_DOOR_SUBSCRIPTION_URL: 'https://billing.example/manage?account={account}' });
  assert.equal(data.subscriptionPage, 'https://billing.example/manage?account=solo');
});

test('a managed machine without one, and a self-hosted machine with one, name none', async () => {
  assert.equal((await session({ FRONT_DOOR_MANAGED: '1' })).subscriptionPage, null);
  assert.equal((await session({ FRONT_DOOR_SUBSCRIPTION_URL: 'https://billing.example/manage' })).subscriptionPage, null);
});
