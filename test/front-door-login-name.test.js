// The login name: a sign-up link made for one account's name (the install's, or a machine of one
// account's setup key) lets its owner pick the name the passkey signs in with. The account keeps its own name (its
// Linux user, its socket); the login name is the passkey's, unique on the machine like an account's name.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

let door, stand, admin;
before(async () => {
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  stand = await standIn(door, 'ann');
});
after(async () => {
  await door?.stop();
  stand?.close();
});

test("the install's link makes the admin's account with the login name its owner picks", async () => {
  const b = door.browser();
  const link = door.firstLink.path;
  const page = await b.get(link);
  assert.match(page.text, /<input id="login" name="login" required [^>]*value="ann">/);

  assert.equal((await b.post(`${link}/options`, { name: 'ann', login: 'No Way' })).status, 400);
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link}/options`, { name: 'ann', login: 'bart' });
  assert.equal(options.status, 200, options.text);
  assert.equal(options.data.publicKey.user.name, 'bart');
  const made = await b.post(link, { name: 'ann', login: 'bart', credential: key.register(options.data.publicKey) });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.data.account, 'ann', "the account keeps the install's name");
  assert.equal((await b.get('/api/bots')).data.account, 'ann');
  admin = b;
});

test('a login name is taken for every other sign-up, and an ordinary sign-up names its passkey as its account', async () => {
  const url = (await admin.post('/admin/links', {})).data.url;
  const p = new URL(url).pathname;
  const page = await door.browser().get(`${p}?name=carol`);
  assert.doesNotMatch(page.text, /id="login"/, 'the name typed is the account and the login');
  assert.equal((await door.browser().post(`${p}/options`, { name: 'bart' })).status, 409, "the admin's login name");
  const options = await door.browser().post(`${p}/options`, { name: 'carol', login: 'other' });
  assert.equal(options.status, 200, options.text);
  assert.equal(options.data.publicKey.user.name, 'carol', 'no login of its own');
});

test("the admin's sign-in link makes a passkey with the account's login name", async () => {
  const made = await admin.post('/admin/accounts/ann/sign-in-link', {});
  assert.equal(made.status, 201, made.text);
  const p = new URL(made.data.url).pathname;
  const page = await door.browser().get(p);
  assert.match(page.text, /Make a new passkey for your account, bart\./);
  assert.match(page.text, /<input id="name" name="name" type="hidden" value="ann">/);
  const options = await door.browser().post(`${p}/options`, { name: 'ann', login: 'zed' });
  assert.equal(options.status, 200, options.text);
  assert.equal(options.data.publicKey.user.name, 'bart', 'its own, whatever the page sent');
});
