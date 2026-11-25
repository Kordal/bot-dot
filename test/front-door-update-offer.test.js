// The front door tells each account its update (#1690, ADR 271): POST /api/update/offer { state, version, from, when, plan,
// deadline, notes, busy? }, on a change and every minute (here every 100 ms), again after a failure, as it tells accounts
// what the off-site backups did. Only where the front door plans the switches, a machine of one account too. The card's
// buttons are its own routes with the owner's session, and after either it tells the account again at once. `busy` is
// the account's own idle answer, also in GET /front-door/update.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { waitFor } = require('./helpers');
const { startFrontDoor, standIn, zoneWhere, updateAnswers } = require('./front-door-helpers');
const store = require('../lib/front-door/store');

const cleanup = [];
after(async () => { for (const f of cleanup.reverse()) await f(); });

const note = (title) => `${title}\n- Point one\n- Point two\n`;
const notesDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-notes-'));
  for (const id of ['2026-10-20-old', '2026-10-21-first', '2026-10-22-second']) fs.writeFileSync(path.join(dir, `${id}.md`), note(`Note ${id}`));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// A machine with an admin (ann) and an owner (bob), or of one account. `answers`: what the account says now.
async function machine({ every = '100', one = false, requests: withRequests = true } = {}) {
  const requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  const status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  const answers = { idle: true, offer: 200, quietHours: { start: 22, end: 9, timeZone: zoneWhere(13, 19) } };
  const env = {
    FRONT_DOOR_STATUS: status, BOT_DOT_WHATS_NEW_DIR: notesDir(), FRONT_DOOR_SWITCH_EVERY_MS: '600000',
    FRONT_DOOR_UPDATE_TELL_MS: every, FRONT_DOOR_UPDATE_TELL_FIRST_MS: every,
    ...(withRequests ? { FRONT_DOOR_REQUESTS: requests } : {}),
    ...(one ? { FRONT_DOOR_ONE_ACCOUNT: 'bob', FRONT_DOOR_SETUP_KEY: crypto.randomBytes(32).toString('base64url') } : { FRONT_DOOR_ADMIN: 'ann' }),
  };
  const door = await startFrontDoor({ env });
  if (one) store.open(door.data).importAccount('bob', {});
  const answer = (req) => {
    const idle = updateAnswers({ idle: () => answers.idle, quietHours: () => answers.quietHours })(req);
    if (idle) return idle;
    if (req.url === '/api/version') return [200, { version: '0123456', whatsNew: '2026-10-20-old' }];
    if (req.url === '/api/update/offer') return answers.offer === 200 ? [200, { ok: true }] : [answers.offer, { error: 'no' }];
    return null;
  };
  const bob = await standIn(door, 'bob', { answer });
  const ann = one ? null : await standIn(door, 'ann', { answer });
  cleanup.push(async () => { bob.close(); ann?.close(); await door.stop(); fs.rmSync(requests, { recursive: true, force: true }); fs.rmSync(status, { recursive: true, force: true }); });
  const said = (name, value) => fs.writeFileSync(path.join(status, name), JSON.stringify(value));
  let versions = 0;
  const waits = (over = {}) => { const since = new Date().toISOString(); said('account-bob.json', { state: 'waiting', at: since, since, version: `abc${String(++versions).padStart(4, '0')}`, from: '0123456', ...over }); };
  const offers = () => bob.seen.filter((r) => r.url === '/api/update/offer').map((r) => ({ ...JSON.parse(r.body), room: r.headers['x-botdot-room'], account: r.headers['x-botdot-account'], method: r.method }));
  let b = null;
  const owner = async () => {
    if (b) return b;
    b = door.browser();
    const key = passkey.create({ rpId: door.rpId, origin: door.origin });
    const link = door.newLink();
    const options = await b.post(`${link.path}/options`, { name: 'bob' });
    const done = await b.post(link.path, { name: 'bob', credential: key.register(options.data.publicKey) });
    assert.equal(done.status, 201, done.text);
    return b;
  };
  if (!one) await owner();
  return { door, bob, answers, requests, status, said, waits, offers, owner, quiet: (ms = 600) => new Promise((r) => setTimeout(r, ms)) };
}

test('an account that waits is told: the version, when, the deadline, the titles and whether it is busy, as the front door', async () => {
  const m = await machine();
  m.answers.idle = false;
  m.waits();
  await waitFor(() => m.offers().some((o) => o.state === 'ready'), { what: 'the offer' });
  const o = m.offers().find((x) => x.state === 'ready');
  assert.equal(o.method, 'POST');
  assert.equal(o.room, '1', 'the account only takes it from the front door');
  assert.equal(o.account, 'bob');
  assert.match(o.version, /^abc000\d$/);
  assert.equal(o.from, '0123456');
  assert.equal(o.when, 'night', 'the default');
  assert.equal(o.plan, null);
  assert.ok(Date.parse(o.deadline) > Date.now(), 'the admin\'s deadline');
  assert.deepEqual(o.notes, [{ id: '2026-10-22-second', title: 'Note 2026-10-22-second' }, { id: '2026-10-21-first', title: 'Note 2026-10-21-first' }], 'the titles after what the account runs, newest first');
  assert.equal(o.busy, true, 'the account said it is not idle');
  assert.equal('switchAt' in o, false);
});

test('it is told on a change, not on every look, and again after a failure', async () => {
  const m = await machine();
  m.waits();
  await waitFor(() => m.offers().some((o) => o.state === 'ready'), { what: 'the offer' });
  await m.quiet();
  const ready = () => m.offers().filter((o) => o.state === 'ready' && o.busy === false);
  assert.equal(ready().length, 1, 'once while nothing changes');
  // The account's idle answer changed: that is news.
  m.answers.idle = false;
  await waitFor(() => m.offers().some((o) => o.busy === true), { what: 'told it is busy' });
  // A failure (the account's server is down for a moment): told again, until it takes it.
  m.answers.offer = 500;
  m.answers.idle = true;
  await waitFor(() => m.offers().filter((o) => o.busy === false).length >= 2, { what: 'told after the change' });
  const before = m.offers().length;
  await waitFor(() => m.offers().length >= before + 2, { what: 'told again after failing' });
  m.answers.offer = 200;
  await waitFor(async () => { const n = m.offers().length; await m.quiet(400); return m.offers().length === n; }, { what: 'told once it took it' });
});

test('an account that waits for nothing is told none, once; one that is asked to switch is told it is moving', async () => {
  const m = await machine();
  await waitFor(() => m.offers().length > 0, { what: 'the first tell' });
  await m.quiet();
  assert.deepEqual(m.offers().map((o) => o.state), ['none']);
  m.waits();
  await waitFor(() => m.offers().some((o) => o.state === 'ready'), { what: 'ready' });
  fs.writeFileSync(path.join(m.requests, 'SWITCH-bob'), '');
  await waitFor(() => m.offers().some((o) => o.state === 'moving'), { what: 'moving' });
  const moving = m.offers().find((o) => o.state === 'moving');
  assert.equal('busy' in moving, false, 'not asked: the switch is on its way');
  fs.rmSync(path.join(m.requests, 'SWITCH-bob'));
  m.said('account-bob.json', { state: 'updated', at: new Date().toISOString() });
  await waitFor(() => m.offers().at(-1).state === 'none', { what: 'none once it has moved' });
});

test('nothing is told where the front door does not plan the switches', async () => {
  const m = await machine({ requests: false });
  m.waits();
  await m.quiet(900);
  assert.deepEqual(m.offers(), []);
});

test('a machine of one account tells its account too', async () => {
  const m = await machine({ one: true });
  m.waits();
  await waitFor(() => m.offers().some((o) => o.state === 'ready'), { what: 'the offer' });
  assert.equal(m.offers().find((o) => o.state === 'ready').account, 'bob');
});

test('GET /front-door/update has `busy` from the account\'s idle answer, and none when it could not ask or nothing waits', async () => {
  const m = await machine();
  const owner = await m.owner();
  assert.equal('busy' in (await owner.get('/front-door/update')).data, false, 'nothing waits');
  m.waits();
  m.answers.idle = false;
  assert.equal((await owner.get('/front-door/update')).data.busy, true);
  m.answers.idle = true;
  assert.equal((await owner.get('/front-door/update')).data.busy, false);
  m.answers.idle = null; // a server older than the route
  const old = (await owner.get('/front-door/update')).data;
  assert.equal('busy' in old, false);
  assert.equal(old.canUpdate, true, 'the rest as before');
});

test('the card\'s buttons are the front door\'s routes with the owner\'s session, and each tells the account again at once', async () => {
  // Nothing is told on a timer here: only the routes tell.
  const m = await machine({ every: '600000' });
  const owner = await m.owner();
  m.waits();
  m.answers.idle = false;
  assert.deepEqual(m.offers(), []);
  const tonight = await owner.post('/front-door/update', { plan: 'night' });
  assert.equal(tonight.status, 200, tonight.text);
  await waitFor(() => m.offers().length >= 1, { what: 'told at once after Tonight', timeout: 3000 });
  const t = m.offers().at(-1);
  assert.deepEqual([t.state, t.plan, t.busy], ['ready', 'night', true]);
  const now = await owner.post('/front-door/update/now', {});
  assert.equal(now.status, 202, now.text);
  await waitFor(() => m.offers().some((o) => o.state === 'moving'), { what: 'told at once after Now', timeout: 3000 });
  assert.equal(fs.existsSync(path.join(m.requests, 'SWITCH-bob')), true, 'the front door asked the machine, not the account');
  assert.equal(m.bob.seen.some((r) => /update\/(now|tonight)|^\/api\/update$/.test(r.url)), false, 'the account server was not asked to switch');
});
