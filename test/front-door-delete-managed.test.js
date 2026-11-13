// "Delete account" on a managed machine (#1313, ADR 241): the account that pays for the machine is deleted only once the
// fleet console has ended its subscription. The front door asks through the outbox the console's agent empties
// (delete-<account>.json), and reads the answer the agent writes beside it (delete-<account>.answer.json): "canceled"
// or "none" erase every account of the machine, which then answers only that it is deleted; "failed" erases nothing.
// Another account of a machine of several is deleted at once, as on a self-hosted machine (#1307).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const SETUP_KEY = crypto.randomBytes(32).toString('base64url');
const GB = 2 ** 30;

async function signUp(door, p, name) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(p, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
const outbox = (door) => path.join(door.data, 'outbox');
const answer = (door, account, state) => {
  fs.mkdirSync(outbox(door), { recursive: true });
  fs.writeFileSync(path.join(outbox(door), `delete-${account}.answer.json`), JSON.stringify({ state }));
};
const saved = (door) => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
const dirs = (t) => {
  const requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  const data = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fd-data-')), 'data');
  t.after(() => { fs.rmSync(requests, { recursive: true, force: true }); fs.rmSync(path.dirname(data), { recursive: true, force: true }); });
  return { requests, data };
};

async function oneAccount(t, { requests, data }) {
  const door = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_ADMIN: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_DATA: data } });
  door.data = data; // its data where the test put it, which a second front door finds again
  const s = await standIn(door, 'owner', { answer: () => [200, { account: 'owner' }] });
  t.after(async () => { await door.stop(); s.close(); });
  return door;
}

test('managed, one account: the owner is offered it, and is told the subscription goes first', async (t) => {
  const door = await oneAccount(t, dirs(t));
  const b = await signUp(door, `/sign-up/${SETUP_KEY}`, 'owner');
  const s = (await b.get('/front-door/session')).data;
  assert.equal(s.deleteAccount, true);
  assert.equal(s.deleteEndsSubscription, true);
  assert.deepEqual(s.deletesAlso, []);
  assert.equal(s.deletion, null);
  assert.equal(s.deleteAccountPage, undefined, 'no page of botdot.app any more (#1312)');
  const wrong = await b.post('/front-door/delete-account', { name: 'own' });
  assert.equal(wrong.status, 400);
  assert.ok(!fs.existsSync(path.join(outbox(door), 'delete-owner.json')), 'nothing asked without the name');
});

test('managed, one account: the console is asked first, and a failure to cancel erases nothing', async (t) => {
  const d = dirs(t);
  const door = await oneAccount(t, d);
  const b = await signUp(door, `/sign-up/${SETUP_KEY}`, 'owner');
  fs.rmSync(path.join(d.requests, 'owner'), { force: true });

  const asked = await b.post('/front-door/delete-account', { name: 'owner' });
  assert.equal(asked.status, 202, asked.text);
  assert.equal(asked.data.pending, true);
  const request = JSON.parse(fs.readFileSync(path.join(outbox(door), 'delete-owner.json'), 'utf8'));
  assert.equal(request.account, 'owner');
  assert.deepEqual(request.accounts, ['owner']);
  assert.ok(Date.now() - Date.parse(request.requested) < 60_000);
  assert.equal(fs.statSync(path.join(outbox(door), 'delete-owner.json')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(outbox(door)), ['delete-owner.json'], 'nothing hidden left behind');
  assert.equal((await b.get('/front-door/session')).data.deletion, 'pending');
  assert.equal((await b.post('/front-door/delete-account', { name: 'owner' })).status, 202, 'asked again while it waits: the same request');

  // The agent took the request; the console couldn't cancel the subscription.
  fs.rmSync(path.join(outbox(door), 'delete-owner.json'));
  answer(door, 'owner', 'failed');
  const s = await b.get('/front-door/session');
  assert.equal(s.status, 200);
  assert.equal(s.data.deletion, 'failed');
  assert.ok(saved(door).accounts.owner, 'the account is kept');
  assert.ok(!fs.existsSync(path.join(d.requests, 'owner')), 'the machine erases nothing');
  assert.equal((await b.get('/api/bots')).data.account, 'owner', 'it works as before');

  // Tried again: the failure goes, and the console is asked anew.
  assert.equal((await b.post('/front-door/delete-account', { name: 'owner' })).status, 202);
  assert.deepEqual(fs.readdirSync(outbox(door)), ['delete-owner.json']);
  assert.equal((await b.get('/front-door/session')).data.deletion, 'pending');
});

for (const state of ['canceled', 'none']) {
  test(`managed, one account: the console's "${state}" erases the account, and the machine says it is deleted from then on`, async (t) => {
    const d = dirs(t);
    const door = await oneAccount(t, d);
    const b = await signUp(door, `/sign-up/${SETUP_KEY}`, 'owner');
    fs.rmSync(path.join(d.requests, 'owner'), { force: true });
    assert.equal((await b.post('/front-door/delete-account', { name: 'owner' })).status, 202);
    fs.rmSync(path.join(outbox(door), 'delete-owner.json'));
    answer(door, 'owner', state);

    const s = await b.get('/front-door/session');
    assert.equal(s.status, 401, 'as an ended session: the apps leave for their sign-in');
    assert.equal(s.data.signIn, '/sign-in');
    assert.equal(s.data.deleted, '/front-door/deleted');
    assert.ok(!saved(door).accounts.owner, 'the front door forgot it');
    assert.ok(saved(door).deleted.owner, 'and keeps it deleted');
    assert.ok(fs.existsSync(path.join(d.requests, 'owner')), 'root\'s step is asked to erase it');
    assert.deepEqual(fs.readdirSync(outbox(door)), [], 'the request and the answer are gone');
    const gone = JSON.parse(fs.readFileSync(path.join(door.data, 'machine-deleted.json'), 'utf8'));
    assert.equal(gone.by, 'owner');
    assert.equal(gone.billing, state);

    assert.equal((await b.get('/api/bots')).status, 401);
    const page = await door.browser().get('/', { Accept: 'text/html' });
    assert.equal(page.status, 410);
    assert.match(page.text, /Your account is deleted\./);
    assert.equal((await door.browser().get('/front-door/deleted')).status, 200);
    assert.equal((await door.browser().get(`/sign-up/${SETUP_KEY}`, { Accept: 'text/html' })).status, 410, 'the setup key makes nothing again');
    const signIn = await door.browser().post('/sign-in/options', {});
    assert.equal(signIn.status, 401);
    assert.equal(signIn.data.error, 'This account is deleted.');
  });
}

test('managed: a machine its owner deleted stays deleted when the front door starts again', async (t) => {
  const d = dirs(t);
  const first = await oneAccount(t, d);
  const b = await signUp(first, `/sign-up/${SETUP_KEY}`, 'owner');
  await b.post('/front-door/delete-account', { name: 'owner' });
  answer(first, 'owner', 'canceled');
  assert.equal((await b.get('/front-door/session')).status, 401);
  await first.stop();
  const again = await oneAccount(t, d);
  assert.equal((await again.browser().get(`/sign-up/${SETUP_KEY}`, { Accept: 'text/html' })).status, 410);
});

test('managed, several: another account goes at once; the first takes the machine and every account with it', async (t) => {
  const d = dirs(t);
  const load = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-load-'));
  t.after(() => fs.rmSync(load, { recursive: true, force: true }));
  fs.writeFileSync(path.join(load, 'machine.json'), JSON.stringify({ at: new Date().toISOString(), load: 0.2, cpus: 18, ramTotal: 35 * GB, ramUsed: 2 * GB, diskTotal: 500 * GB, diskUsed: 20 * GB }));
  const door = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_ADMIN: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, FRONT_DOOR_LOAD: load, FRONT_DOOR_REQUESTS: d.requests } });
  const stands = await Promise.all(['owner', 'bea', 'cat'].map((n) => standIn(door, n, { answer: () => [200, { account: n }] })));
  t.after(async () => { await door.stop(); for (const s of stands) s.close(); });
  const owner = await signUp(door, `/sign-up/${SETUP_KEY}`, 'owner');
  const bea = await signUp(door, door.newLink().path, 'bea');
  await signUp(door, door.newLink().path, 'cat');
  for (const n of fs.readdirSync(d.requests)) fs.rmSync(path.join(d.requests, n), { force: true });

  const s = (await bea.get('/front-door/session')).data;
  assert.equal(s.deleteAccount, true);
  assert.equal(s.deleteEndsSubscription, false, 'bea pays for nothing');
  const done = await bea.post('/front-door/delete-account', { name: 'bea' });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.deleted, '/front-door/deleted');
  assert.ok(!saved(door).accounts.bea);
  assert.ok(fs.existsSync(path.join(d.requests, 'bea')));
  assert.ok(!fs.existsSync(outbox(door)) || !fs.readdirSync(outbox(door)).some((n) => n.startsWith('delete-')), 'no console asked');

  const o = (await owner.get('/front-door/session')).data;
  assert.equal(o.deleteEndsSubscription, true);
  assert.deepEqual(o.deletesAlso, ['cat']);
  assert.equal((await owner.post('/front-door/delete-account', { name: 'owner' })).status, 202);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outbox(door), 'delete-owner.json'), 'utf8')).accounts.sort(), ['cat', 'owner']);
  answer(door, 'owner', 'canceled');
  assert.equal((await owner.get('/front-door/session')).status, 401);
  assert.deepEqual(Object.keys(saved(door).accounts), [], 'every account is gone');
  assert.ok(fs.existsSync(path.join(d.requests, 'owner')) && fs.existsSync(path.join(d.requests, 'cat')));
  const entries = fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.action === 'delete');
  assert.deepEqual(entries.map((e) => [e.account, e.actor]).sort(), [['bea', 'bea'], ['cat', 'owner'], ['owner', 'owner']]);
  assert.match(entries.find((e) => e.account === 'cat').detail, /subscription cancelled/);
});

test("an answer for an account that doesn't pay for the machine erases nothing", async (t) => {
  const d = dirs(t);
  const door = await oneAccount(t, d);
  const b = await signUp(door, `/sign-up/${SETUP_KEY}`, 'owner');
  answer(door, 'mallory', 'canceled');
  assert.equal((await b.get('/front-door/session')).status, 200);
  assert.ok(saved(door).accounts.owner);
  assert.ok(!fs.existsSync(path.join(door.data, 'machine-deleted.json')));
});

test('the deletion lib: answers are read only as the agent writes them, never through a link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-deletion-'));
  try {
    const box = path.join(root, 'outbox');
    const del = require('../lib/front-door/deletion').create(box, root);
    assert.equal(del.state('owner'), null);
    assert.deepEqual(del.granted(), [], 'no folder yet');
    del.ask('owner', ['owner']);
    assert.equal(del.state('owner'), 'pending');
    fs.writeFileSync(path.join(box, 'delete-owner.answer.json'), '{"state":"maybe"}');
    assert.equal(del.state('owner'), 'pending', 'an answer that is none of the three is not one');
    assert.deepEqual(del.granted(), []);
    fs.writeFileSync(path.join(root, 'secret.json'), '{"state":"canceled"}');
    fs.rmSync(path.join(box, 'delete-owner.answer.json'));
    fs.symlinkSync(path.join(root, 'secret.json'), path.join(box, 'delete-owner.answer.json'));
    assert.deepEqual(del.granted(), [], 'a link is no answer');
    fs.rmSync(path.join(box, 'delete-owner.answer.json'));
    fs.writeFileSync(path.join(box, 'delete-Bad.answer.json'), '{"state":"canceled"}');
    assert.deepEqual(del.granted(), [], 'nor a name that is no account');
    assert.throws(() => del.ask('../x', []));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
