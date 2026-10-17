// The admin page (#467, ADR 028): web only, at /admin on the front door, reached by the admin's session alone. The
// admin makes, lists and revokes sign-up links there; a link opened makes a new account, which the front door asks
// the machine to make (a request in FRONT_DOOR_REQUESTS that install.sh's root step takes), and until that account's
// botdot server answers, its pages say that it is being made.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

let door, requests;
const stands = {};
before(async () => {
  requests = path.join(require('os').tmpdir(), `fd-requests-${process.pid}`);
  fs.mkdirSync(requests, { recursive: true });
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests } });
  // The admin's account was made by the install: its botdot server runs.
  stands.ann = await standIn(door, 'ann');
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  fs.rmSync(requests, { recursive: true, force: true });
});

async function signUp(name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}

let annB = null;
const admin = async () => (annB ||= await signUp('ann', door.firstLink));
const seen = () => Object.values(stands).map((s) => s.seen.length).join();

test("the admin's session gets the admin page, web only, from the front door itself", async () => {
  const b = await admin();
  const was = seen();
  const page = await b.get('/admin');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.text, /Sign-up links/);
  assert.match(page.text, /<button id="new-link"/);
  assert.match(page.text, /<script src="\/front-door\/admin\.js"><\/script>/);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  const script = await b.get('/front-door/admin.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  assert.equal(seen(), was, 'no botdot server saw it');
});

test('the admin makes a sign-up link, sees it open, and it makes an account once', async () => {
  const b = await admin();
  const made = await b.post('/admin/links', {});
  assert.equal(made.status, 201, made.text);
  assert.match(made.data.url, new RegExp(`^${door.origin}/sign-up/[A-Za-z0-9_-]{20,}$`));
  const id = made.data.link.id;
  assert.equal(made.data.link.state, 'open');

  const list = await b.get('/admin/links');
  assert.equal(list.status, 200);
  const row = list.data.links.find((l) => l.id === id);
  assert.equal(row.state, 'open');
  assert.ok(Date.parse(row.expires) - Date.parse(row.created) === 7 * 24 * 3600_000, 'for 7 days');
  assert.ok(!JSON.stringify(list.data).includes(new URL(made.data.url).pathname.split('/').pop()), 'the list never holds what lets someone in');

  // Opened: bob's page says, before the passkey is made, that the admin can reach everything.
  const path_ = new URL(made.data.url).pathname;
  const page = await door.browser().get(path_);
  assert.equal(page.status, 200);
  assert.ok(page.text.indexOf('The admin of this machine can technically reach everything in your account.') < page.text.indexOf('Create my passkey'));
  await signUp('bob', { path: path_ });

  const after_ = (await b.get('/admin/links')).data.links.find((l) => l.id === id);
  assert.equal(after_.state, 'used');
  assert.equal(after_.account, 'bob');
  assert.ok(after_.usedAt);
  assert.equal((await door.browser().get(path_)).status, 410, 'it works once');
});

test('a revoked link makes no account, and the list says it ended', async () => {
  const b = await admin();
  const made = await b.post('/admin/links', {});
  const link = { path: new URL(made.data.url).pathname };
  const revoked = await b.post(`/admin/links/${made.data.link.id}/revoke`, {});
  assert.equal(revoked.status, 200, revoked.text);
  assert.equal(revoked.data.link.state, 'ended');
  assert.ok(revoked.data.link.revokedAt);
  assert.equal((await door.browser().get(link.path)).status, 410);
  assert.equal((await door.browser().post(`${link.path}/options`, { name: 'carl' })).status, 410);
  const row = (await b.get('/admin/links')).data.links.find((l) => l.id === made.data.link.id);
  assert.equal(row.state, 'ended');

  assert.equal((await b.post(`/admin/links/${made.data.link.id}/revoke`, {})).status, 409, 'once');
  assert.equal((await b.post(`/admin/links/${'0'.repeat(64)}/revoke`, {})).status, 404);
});

test('a link that ran out is listed as ended', async () => {
  const b = await admin();
  door.newLink({ ageDays: 8 });
  const { links } = (await b.get('/admin/links')).data;
  assert.ok(links.some((l) => l.state === 'ended' && !l.revokedAt), JSON.stringify(links));
  assert.ok(links.every((l, i) => i === 0 || links[i - 1].created >= l.created), 'newest first');
});

test('no other session reaches /admin, and nothing of it is passed to a botdot server', async () => {
  const link = (await (await admin()).post('/admin/links', {})).data.url;
  stands.dora = await standIn(door, 'dora');
  const dora = await signUp('dora', { path: new URL(link).pathname });
  const was = seen();
  for (const [method, p] of [['GET', '/admin'], ['GET', '/admin/links'], ['POST', '/admin/links'], ['POST', `/admin/links/${'a'.repeat(64)}/revoke`], ['GET', '/admin/anything']]) {
    const r = method === 'GET' ? await dora.get(p) : await dora.post(p, {});
    assert.equal(r.status, 404, `${method} ${p}: ${r.text}`);
  }
  // Without a session: sign in first, as everywhere.
  const none = door.browser();
  assert.equal((await none.get('/admin')).status, 302);
  assert.equal((await none.get('/admin/links')).status, 401);
  assert.equal((await none.post('/admin/links', {})).status, 401);
  assert.equal(seen(), was, 'no botdot server saw any of it');
});

test("the admin's writes need the web page's header, as every write of the front door's", async () => {
  const b = await admin();
  const r = await b.post('/admin/links', {}, { 'X-Bot-Dot': '' });
  assert.equal(r.status, 403);
});

test('a new account is asked of the machine, and until its botdot server answers, its pages say it is being made', async () => {
  const b = await admin();
  const link = (await b.post('/admin/links', {})).data.url;
  const eve = await signUp('eve', { path: new URL(link).pathname });
  assert.ok(fs.existsSync(path.join(requests, 'eve')), 'the request for eve is there');
  assert.ok(!fs.existsSync(path.join(requests, 'ann')), "none for the install's own account, whose botdot server runs");

  const home = await eve.get('/');
  assert.equal(home.status, 503);
  assert.match(home.headers['content-type'], /^text\/html/);
  assert.match(home.text, /Your account is being made/);
  assert.match(home.text, /<meta http-equiv="refresh" content="\d+">/);
  const api = await eve.get('/api/bots');
  assert.equal(api.status, 503);
  assert.equal(api.data.making, true);

  // Made: the machine took the request, and eve's botdot server answers.
  fs.rmSync(path.join(requests, 'eve'));
  stands.eve = await standIn(door, 'eve');
  const ready = await eve.get('/api/bots');
  assert.equal(ready.status, 200);
  assert.equal(ready.data.account, 'eve');
});

test('a session never reaches another account, whatever it names', async () => {
  const b = await admin();
  const r = await b.get('/api/bots', { 'X-Botdot-Account': 'bob' });
  assert.equal(r.data.account, 'ann');
  const c = await b.get('/api/bots', { Cookie: `${b.cookie()}; botdot_account=eve` });
  assert.equal(c.data.account, 'ann');
});
