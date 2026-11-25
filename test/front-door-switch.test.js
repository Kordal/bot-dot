// The front door switches each account when it is idle, at the time its owner chose (#1689, ADR 271), on a machine of
// several accounts: each minute it asks each account that waits for its idle answer (GET /api/update/idle, as the front
// door, #1688) and, by lib/front-door/switch-plan.js, asks root's step for the switch with an empty file SWITCH-<name>
// (ADR 053). Its tick is every 100 ms here.
//
// Each test has a machine of its own, and writes what root's step would say only once nothing else could be asking: the
// front door asks the account about its idle answer from its tick, from its tells (POST /api/update/offer, which carry
// `busy`, #1690) and from a look, so a machine shared by the tests, or a state written while a tell is on its way,
// counts one test's asks in another's. What a test waits for is what the front door did (a file, a line of its log, the
// account told), never a time; a time is only the window of an assertion that nothing happens.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { waitFor } = require('./helpers');
const { startFrontDoor, standIn, zoneWhere, updateAnswers } = require('./front-door-helpers');

const DAY = 24 * 3600_000;
const TELL_NEVER = String(3600_000); // the front door's own tells (the first at 5 s, then each minute) would come at any step of a test

// A machine of the admin ann and the owner bob: the front door (its switch tick every `tick` ms, the default when null), the
// requests and status folders root's step and the front door share, and the stand-in accounts. Their answers are `now`'s:
// bob's idle answer (true, false or null for "no such route") and quiet hours.
async function machine(t, { tick = '100' } = {}) {
  const requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  const status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  const now = { idle: true, quietHours: { start: 22, end: 9, timeZone: zoneWhere(13, 19) } };
  const door = await startFrontDoor({ env: {
    FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status,
    FRONT_DOOR_UPDATE_TELL_FIRST_MS: TELL_NEVER, FRONT_DOOR_UPDATE_TELL_MS: TELL_NEVER,
    ...(tick ? { FRONT_DOOR_SWITCH_EVERY_MS: tick } : {}),
  } });
  const answer = () => updateAnswers({ idle: () => now.idle, quietHours: () => now.quietHours });
  const m = { door, requests, status, now, answer, ann: await standIn(door, 'ann', { answer: answer() }), bob: await standIn(door, 'bob', { answer: answer() }) };
  t.after(async () => {
    await door.stop();
    m.ann.close();
    m.bob.close();
    fs.rmSync(requests, { recursive: true, force: true });
    fs.rmSync(status, { recursive: true, force: true });
  });

  async function signUp(name, link) {
    const b = door.browser();
    const key = passkey.create({ rpId: door.rpId, origin: door.origin });
    const options = await b.post(`${link.path}/options`, { name });
    const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
    assert.equal(done.status, 201, done.text);
    return b;
  }
  let annB = null, bobB = null;
  m.admin = async () => (annB ||= await signUp('ann', door.firstLink));
  m.owner = async () => (bobB ||= await signUp('bob', door.newLink()));
  await m.owner();
  const said = (name, value) => fs.writeFileSync(path.join(status, name), JSON.stringify(value));
  let versions = 0; // each wait is for a version of its own: "Tonight" is kept for one
  Object.assign(m, {
    said,
    waits: (since = new Date(), version = `abc${String(++versions).padStart(4, '0')}`) => said('account-bob.json', { state: 'waiting', at: new Date(since).toISOString(), since: new Date(since).toISOString(), version, from: '0123456' }),
    asked: () => fs.readdirSync(requests).sort(),
    clear() { for (const f of fs.readdirSync(requests)) fs.rmSync(path.join(requests, f)); fs.rmSync(path.join(status, 'account-bob.json'), { force: true }); fs.rmSync(path.join(status, 'update.json'), { force: true }); },
    quiet: (ms = 600) => new Promise((r) => setTimeout(r, ms)),
    idleSeen: () => m.bob.seen.filter((r) => r.url === '/api/update/idle'),
    // The front door writes a request, then its log line, and its log reaches this side on a pipe of its own: what a test
    // says of the log it says after the line is there.
    logged: (re, what = `${re} in the front door's log`) => waitFor(() => re.test(door.log.join('')), { what }),
    // The account told its update state (POST /api/update/offer) as `state`: the end of what the front door does for a switch it asked.
    told: (state) => waitFor(() => m.bob.seen.some((r) => r.url === '/api/update/offer' && JSON.parse(r.body).state === state), { what: `the account told it is ${state}` }),
    // Its owner's choice. The front door tells the account of it (a tell takes the state when its turn comes, after the tells
    // before it, and asks the account's idle answer when something waits): done when the account has been told, so that the
    // state a test writes next is not the one that tell takes.
    async setWhen(when) {
      const offers = () => m.bob.seen.filter((r) => r.url === '/api/update/offer').length;
      const was = offers();
      assert.equal((await (await m.owner()).post('/front-door/update', { when })).status, 200);
      await waitFor(() => offers() > was, { what: 'the account told of the choice' });
    },
  });
  await m.setWhen('night'); // the default, as each test begins: bob's own choice is what the front door switches by
  return m;
}

test('"as soon as it\'s ready": switched at the first idle check; busy, it is asked again until it is idle', async (t) => {
  const m = await machine(t);
  const { door, now, asked, idleSeen } = m;
  await m.setWhen('ready');
  now.idle = false;
  m.waits();
  await waitFor(() => idleSeen().length >= 2, { what: 'the account asked more than once' });
  assert.deepEqual(asked(), [], 'busy: it never forces');
  const first = idleSeen()[0];
  assert.equal(first.method, 'GET');
  assert.equal(first.headers['x-botdot-room'], '1', 'as the front door, which the account\'s server needs');
  assert.equal(first.headers['x-botdot-account'], 'bob');
  now.idle = true;
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'the switch asked' });
  assert.deepEqual(asked(), ['SWITCH-bob']);
  await m.logged(/asked to switch the account bob to the new version: idle\n/);
  const a = await m.admin();
  const entry = (await a.get('/admin/audit?action=update-switch')).data.entries[0];
  assert.deepEqual([entry.actor, entry.action, entry.account, entry.detail], ['front-door', 'update-switch', 'bob', 'idle']);
});

test('the account\'s own verdict decides, and one that says nothing counts as busy', async (t) => {
  const m = await machine(t);
  const { door, now, asked, idleSeen } = m;
  await m.setWhen('ready');
  m.waits();
  now.idle = null; // a botdot server older than the route
  await waitFor(() => idleSeen().length >= 2, { what: 'asked' });
  assert.deepEqual(asked(), []);
  // A server that is not there at all.
  m.bob.close();
  await m.quiet(300);
  assert.deepEqual(asked(), [], 'not answering');
  // Its server answers again, idle.
  Object.assign(m.bob, await standIn(door, 'bob', { answer: m.answer() }));
  now.idle = true;
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'the switch asked once it answers idle' });
});

test('"at night, when idle" (the default): not by day, and by night when it is idle', async (t) => {
  const m = await machine(t);
  m.waits();
  await m.quiet();
  assert.deepEqual(m.asked(), [], 'it is day in the owner\'s time zone');
  m.now.quietHours = { start: 22, end: 9, timeZone: zoneWhere(5, 7) };
  await waitFor(() => m.asked().includes('SWITCH-bob'), { what: 'switched in the night' });
  await m.logged(/to the new version: idle, at night\n/);
});

test('busy all night: not switched, and tried again', async (t) => {
  const m = await machine(t);
  m.now.quietHours = { start: 22, end: 9, timeZone: zoneWhere(5, 7) };
  m.now.idle = false;
  m.waits();
  await waitFor(() => m.idleSeen().length >= 3, { what: 'asked again and again' });
  assert.deepEqual(m.asked(), []);
});

test('"when I say": never, until its owner says Tonight for this version; then at night when idle', async (t) => {
  const m = await machine(t);
  const b = await m.owner();
  await m.setWhen('manual');
  m.now.quietHours = { start: 22, end: 9, timeZone: zoneWhere(5, 7) };
  m.waits();
  await m.quiet();
  assert.deepEqual(m.asked(), [], 'the owner decides');
  assert.equal(m.idleSeen().length, 0, 'and no one is asked');
  assert.equal((await b.get('/front-door/update')).data.plan, null);
  // Tonight.
  const u = await b.post('/front-door/update', { plan: 'night' });
  assert.equal(u.status, 200, u.text);
  assert.equal(u.data.plan, 'night');
  assert.equal(u.data.when, 'manual', '"Tonight" is not a "when": the choice stays');
  assert.equal((await b.get('/front-door/update')).data.plan, 'night');
  await waitFor(() => m.asked().includes('SWITCH-bob'), { what: 'switched in the night' });
  // Kept per version: the next version waits for the owner again.
  m.clear();
  m.waits(new Date(), 'def5678');
  assert.equal((await b.get('/front-door/update')).data.plan, null);
  await m.quiet();
  assert.deepEqual(m.asked(), []);
});

test('"Tonight" by day waits for the night; it asks nothing of a version that does not wait, and takes only "night"', async (t) => {
  const m = await machine(t);
  const b = await m.owner();
  await m.setWhen('manual');
  assert.equal((await b.post('/front-door/update', { plan: 'night' })).status, 409, 'nothing waits');
  m.waits();
  for (const wrong of ['now', '', null, true, ['night']]) assert.equal((await b.post('/front-door/update', { plan: wrong })).status, 400, JSON.stringify(wrong));
  assert.equal((await b.post('/front-door/update', { plan: 'night' })).data.plan, 'night');
  await m.quiet();
  assert.deepEqual(m.asked(), [], 'it is day');
  // With `when` in the same call, `when` is chosen too.
  const both = await b.post('/front-door/update', { when: 'ready', plan: 'night' });
  assert.deepEqual([both.data.when, both.data.plan], ['ready', 'night']);
  await m.setWhen('manual');
  assert.equal((await m.door.browser().post('/front-door/update', { plan: 'night' })).status, 401, 'nobody signed in');
});

test('past the deadline: the first idle check whatever the choice or the hour; a day past it, switched anyway', async (t) => {
  const m = await machine(t);
  const { now, asked, idleSeen } = m;
  await m.setWhen('manual');
  now.idle = false;
  m.waits(Date.now() - 7.1 * DAY);
  await waitFor(() => idleSeen().length >= 2, { what: 'asked: the owner\'s choice no longer counts' });
  assert.deepEqual(asked(), [], 'busy, within the 24 hours');
  now.idle = true;
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'switched at the first idle check' });
  await m.logged(/to the new version: idle, past the deadline\n/);
  // What the front door does for the switch it asked ends when it has told the account: only then is the next wait written.
  await m.told('moving');
  m.clear();
  now.idle = false;
  const before = idleSeen().length;
  m.waits(Date.now() - 8.1 * DAY);
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'switched anyway' });
  await m.logged(/to the new version: past the deadline\n/);
  assert.equal(idleSeen().length, before, 'no one is asked: it switches whatever it answers');
});

test('a look at the admin page or Settings switches at once the account a day past its deadline, and waits for no account to answer', async (t) => {
  // The tick is the default minute here, as are the front door's tells: only the look can ask anything, and a look that is
  // not the cause of the switch is no longer mistaken for the tick's.
  const m = await machine(t, { tick: null });
  const a = await m.admin();
  const b = await m.owner();
  await m.setWhen('manual');
  m.now.idle = false;
  m.waits(Date.now() - 8.1 * DAY);
  await b.get('/front-door/update');
  assert.ok(m.asked().includes('SWITCH-bob'), 'asked by the look itself');
  await m.told('moving');
  m.clear();
  m.waits(Date.now() - 7.1 * DAY);
  const before = m.idleSeen().length;
  await a.get('/admin/accounts');
  assert.deepEqual(m.asked(), [], 'past the deadline, not a day: it needs the idle answer, which the tick asks');
  assert.equal(m.idleSeen().length, before, 'a look asks no account');
});

test('nothing is switched while an update is asked or going, and the switch is not asked twice', async (t) => {
  const m = await machine(t);
  const { requests, status, said, asked } = m;
  await m.setWhen('ready');
  // The update is asked before the version waits, and each is ended before the next begins: the tick looks at the state
  // each 100 ms, and what it finds between two writes is a state of its own.
  fs.writeFileSync(path.join(requests, 'UPDATE'), '');
  m.waits();
  await m.quiet();
  assert.deepEqual(asked(), ['UPDATE'], 'the admin\'s update is asked: root\'s step does its part first');
  said('update.json', { state: 'updating', at: new Date().toISOString(), from: '0123456', to: 'abc1234', phase: 'download' });
  fs.rmSync(path.join(requests, 'UPDATE'));
  await m.quiet();
  assert.deepEqual(asked(), [], 'going');
  fs.rmSync(path.join(status, 'update.json'));
  await waitFor(() => asked().includes('SWITCH-bob'), { what: 'switched once the update has ended' });
  // Asked, and root's step has not taken it yet: nothing more is asked.
  const text = fs.readFileSync(path.join(requests, 'SWITCH-bob'), 'utf8');
  await m.quiet(400);
  assert.equal(fs.readFileSync(path.join(requests, 'SWITCH-bob'), 'utf8'), text, 'the same request');
  // Taken and the account says it is switching: not asked again either.
  said('account-bob.json', { state: 'switching', at: new Date().toISOString() });
  fs.rmSync(path.join(requests, 'SWITCH-bob'));
  await m.quiet(400);
  assert.deepEqual(asked(), []);
});

test('a suspended account is not asked, and an account that does not wait is not either', async (t) => {
  const m = await machine(t);
  const a = await m.admin();
  await m.setWhen('ready');
  await m.quiet(400);
  assert.equal(m.idleSeen().length, 0, 'nothing waits');
  // Suspended before the version waits: the tick that finds the wait finds the account suspended.
  assert.equal((await a.post('/admin/accounts/bob/suspend', {})).status, 200);
  m.waits();
  const before = m.idleSeen().length;
  await m.quiet(400);
  assert.deepEqual(m.asked().filter((f) => f.startsWith('SWITCH-')), [], 'the suspension itself is asked of root\'s step, not a switch');
  assert.equal(m.idleSeen().length, before);
  // And it is the suspension that kept it: resumed, it is switched.
  assert.equal((await a.post('/admin/accounts/bob/resume', {})).status, 200);
  await waitFor(() => m.asked().includes('SWITCH-bob'), { what: 'switched once resumed' });
});
