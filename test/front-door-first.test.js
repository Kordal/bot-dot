// The front door of a fresh install (#466, ADR 028): until the first account exists, its pages say only "Open the
// link from your server's install"; the install's link makes the admin's account and no other; and the install asks
// the front door for that link on its command line.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const ROOT = path.join(__dirname, '..');
const OPEN_THE_LINK = "Open the link from your server's install";

let door, stand;
before(async () => {
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'admin' } });
  stand = await standIn(door, 'admin');
});
after(async () => {
  await door?.stop();
  stand?.close();
});

// `node front-door.js sign-up-link …` on this front door's data, as install.sh runs it.
const cli = (...args) => spawnSync(process.execPath, ['front-door.js', 'sign-up-link', ...args], {
  cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data },
});

test('before the first account, every page says only to open the link from the install', async () => {
  const b = door.browser();
  const home = await b.get('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.location, '/sign-in');
  const page = await b.get('/sign-in');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`<main><h1>bot<span>·</span>dot</h1>\n<p>${OPEN_THE_LINK}.</p><p id="said"`), page.text);
  assert.doesNotMatch(page.text, /<button|<form|<input/, 'no way to sign in is offered');
  const version = await b.get('/api/version');
  assert.equal(version.data.frontDoor, true);
});

test("the link a start prints is the admin's: it makes the account the install named, and no other", async () => {
  assert.ok(door.firstLink, `printed a link:\n${door.log.join('')}`);
  assert.match(door.log.join(''), /Sign-up link for the first account, admin, which is the admin's/);
  const b = door.browser();
  const page = await b.get(door.firstLink.path);
  assert.equal(page.status, 200);
  assert.match(page.text, /Your account's name: <b>admin<\/b>/, 'the name is set and cannot be changed');
  assert.match(page.text, /<input id="name" name="name" type="hidden" value="admin">/);
  assert.match(page.text, /admin of this machine can technically reach everything in your account/i);

  const other = await b.post(`${door.firstLink.path}/options`, { name: 'mallory' });
  assert.equal(other.status, 400);
  assert.equal(other.data.error, 'This sign-up link is for the account admin.');

  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${door.firstLink.path}/options`, { name: 'admin' });
  assert.equal(options.status, 200, options.text);
  const made = await b.post(door.firstLink.path, { name: 'admin', credential: key.register(options.data.publicKey) });
  assert.equal(made.status, 201, made.text);
  assert.equal((await b.get('/api/bots')).data.account, 'admin', "the session reaches the admin's botdot server");

  // From now on the sign-in page signs people in.
  const signIn = await door.browser().get('/sign-in');
  assert.ok(!signIn.text.includes(OPEN_THE_LINK));
  assert.match(signIn.text, /<button id="sign-in"/);
});

test('the install asks for a link for one account on the command line, and none for an account that exists', () => {
  const made = cli('--account', 'carol');
  assert.equal(made.status, 0, made.stderr);
  const url = made.stdout.match(/^(https?:\/\/\S+\/sign-up\/\S+)$/m)?.[1];
  assert.ok(url, made.stdout);
  assert.ok(url.startsWith(`${door.origin}/sign-up/`));

  const taken = cli('--account', 'admin');
  assert.equal(taken.status, 3, `${taken.stdout}${taken.stderr}`);
  assert.match(taken.stderr, /The account admin exists already\./);
  assert.equal(taken.stdout, '');

  const bad = cli('--account', 'Not A Name');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /An account's name is 2 to 24 lowercase letters, digits and dashes, starting with a letter\./);
});

test("an account's name is at most 24 characters, so that its Linux user's name fits", async () => {
  const link = door.newLink();
  const b = door.browser();
  assert.equal((await b.post(`${link.path}/options`, { name: `a${'b'.repeat(23)}` })).status, 200);
  const long = await b.post(`${link.path}/options`, { name: `a${'b'.repeat(24)}` });
  assert.equal(long.status, 400);
  assert.match(long.data.error, /2 to 24 lowercase letters/);
});
