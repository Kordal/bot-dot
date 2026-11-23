// The account's own boat.dev key (#1617, ADR 263), through the account's server: checked with boat.dev as it is set and
// its answer said, kept encrypted and never sent back to the apps, the owner's alone to set and remove, and with it the
// owner (not the admin) moves the account's computer and chooses its size. Removing it asks about the machines it made.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./helpers');
const { fakeBoatHttp } = require('./fixtures/fake-boat-http');

const ADMIN = { 'X-Botdot-Room': '1' };
const OWN = 'boat_ownkey1234567890';
const MACHINE = 'boat_machinekey1234567';
let srv, boat, data;
const file = (n) => path.join(data, n);
const machinesFile = () => JSON.parse(fs.readFileSync(file('boat-machines.json'), 'utf8'));

before(async () => {
  boat = await fakeBoatHttp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-own-key-'));
  data = path.join(dir, 'data');
  fs.mkdirSync(data, { recursive: true });
  const bot = (id, name, extra = {}) => ({ id, name, prompt: 'Build things.', allowedTools: ['Read'], computer: 'linux', jobs: [], ...extra });
  fs.writeFileSync(file('bots.json'), JSON.stringify([bot('coder', 'Coder'), bot('writer', 'Writer', { computer: 'boat', computerPlace: 'boat' })]));
  srv = await startServer({ dir, env: { BOT_DOT_BOAT_URL: boat.url } });
});
after(async () => { await srv.stop(); boat.close(); });

const putKey = (key, opts = {}) => srv.api('/settings/boat-key', { method: 'PUT', body: { key }, ...opts });

test('nothing is set at first, and boat.dev is not ready', async () => {
  const r = await srv.api('/settings/boat-key');
  assert.deepEqual([r.status, r.data.set, r.data.machines, r.data.machineKey], [200, false, 0, false]);
  assert.equal((await srv.api('/version')).data.boat, false);
  const f = (await srv.api('/version')).data.features;
  assert.ok(f.includes('boat-own-key') && f.includes('bot-own-machine'));
  assert.deepEqual((await srv.api('/settings/computer')).data, { place: 'linux', boat: false, ownKey: false });
});

test("the key is checked with boat.dev, and what boat.dev answered is said; a key it doesn't take is not kept", async () => {
  const refused = await putKey('boat_refusedkey1234');
  assert.deepEqual([refused.status, refused.data.check, refused.data.error], [400, 'refused', 'boat.dev refused this key.']);
  const short = await putKey('x');
  assert.deepEqual([short.status, short.data.check], [400, 'refused'], 'not even a key');
  const billing = await putKey('boat_billingkey12345');
  assert.deepEqual([billing.status, billing.data.check, billing.data.error], [400, 'billing', 'boat.dev wants a plan or a payment method on this account first.']);
  const down = await putKey('boat_downkey1234567');
  assert.deepEqual([down.status, down.data.check, down.data.error], [502, 'unreachable', "boat.dev can't be reached. Try again."]);
  assert.equal((await putKey('')).status, 400, 'nothing pasted');
  assert.equal((await srv.api('/settings/boat-key')).data.set, false, 'none of them is kept');
  assert.equal(fs.existsSync(file('boat-key.json')), false);
});

test('the owner alone sets, replaces and removes it: not the Chief, not the front door', async () => {
  assert.equal((await srv.asChief('/settings/boat-key', { method: 'PUT', body: { key: OWN } })).status, 403);
  assert.equal((await putKey(OWN, { headers: ADMIN })).status, 403);
  assert.equal((await srv.asChief('/settings/boat-key', { method: 'DELETE' })).status, 403);
  assert.equal((await srv.api('/settings/boat-key', { method: 'DELETE', headers: ADMIN })).status, 403);
  assert.equal((await srv.api('/settings/boat-key')).data.set, false, 'nothing changed');
});

test('a good key is kept encrypted and never sent back; the apps see that one is set and its check', async () => {
  const r = await putKey(OWN);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.set, r.data.check, r.data.machines, r.data.machineKey], [true, 'ok', 0, false]);
  assert.ok(boat.seen.some((s) => s.path === '/me' && s.key === OWN), 'boat.dev was asked with it');

  const stored = fs.readFileSync(file('boat-key.json'), 'utf8');
  assert.ok(!stored.includes(OWN), 'encrypted in the account\'s data');
  assert.equal(fs.statSync(file('boat-key.json')).mode & 0o777, 0o600);
  for (const p of ['/settings/boat-key', '/settings/boat-key?fresh=1', '/settings/computer', '/settings/boat-size', '/version', '/status', '/bots', '/bots/coder', '/settings']) {
    const a = await srv.api(p);
    assert.ok(!JSON.stringify(a.data).includes(OWN) && !JSON.stringify(a.data).includes(OWN.slice(5, 14)), `${p} has no part of the key`);
  }
  assert.ok(!JSON.stringify((await putKey(OWN)).data).includes(OWN), 'nor the answer that saved it');
  assert.equal((await srv.api('/version')).data.boat, true, 'boat.dev is ready with the account\'s own key alone');
  assert.equal((await srv.api('/status')).data.boat, true);
});

test('with the own key the owner chooses where the account\'s computer is and its size; the admin does not', async () => {
  assert.deepEqual((await srv.api('/settings/computer')).data, { place: 'linux', boat: true, ownKey: true });
  const admin = await srv.api('/settings/computer', { method: 'PUT', body: { place: 'boat' }, headers: ADMIN });
  assert.equal(admin.status, 403, 'the admin\'s page does not move it');
  assert.match(admin.data.error, /^Not done: /);
  assert.equal((await srv.asChief('/settings/computer', { method: 'PUT', body: { place: 'boat' } })).status, 403, 'not the Chief');
  const moved = await srv.api('/settings/computer', { method: 'PUT', body: { place: 'boat' } });
  assert.deepEqual([moved.status, moved.data.place, moved.data.ownKey], [200, 'boat', true]);
  assert.equal((await srv.api('/settings/computer', { method: 'PUT', body: { place: 'linux' } })).data.place, 'linux');

  const sizes = await srv.api('/settings/boat-size');
  assert.equal(sizes.data.ownKey, true);
  assert.equal((await srv.api('/settings/boat-size', { method: 'PUT', body: { size: 'large' }, headers: ADMIN })).status, 403);
  assert.equal((await srv.asChief('/settings/boat-size', { method: 'PUT', body: { size: 'large' } })).status, 403);
  const size = await srv.api('/settings/boat-size', { method: 'PUT', body: { size: 'large' } });
  assert.deepEqual([size.status, size.data.size], [200, 'large']);
  assert.equal((await srv.api('/settings/boat-size', { method: 'PUT', body: { size: 'huge' } })).status, 400);
});

test("the machine's key and the own key: the own one wins, and the admin's choices stay the admin's without it", async () => {
  assert.equal((await srv.api('/boat', { method: 'POST', body: { key: MACHINE }, headers: ADMIN })).status, 200);
  const both = await srv.api('/settings/boat-key');
  assert.deepEqual([both.data.set, both.data.machineKey], [true, true]);
  // Removed, the machine's key stays and the admin chooses again.
  const gone = await srv.api('/settings/boat-key', { method: 'DELETE' });
  assert.deepEqual([gone.status, gone.data.removed, gone.data.set], [200, true, false]);
  assert.equal(fs.existsSync(file('boat-key.json')), false, 'gone from the data');
  const back = await srv.api('/settings/computer');
  assert.deepEqual([back.data.boat, back.data.ownKey], [true, false], "the machine's key keeps boat.dev ready");
  assert.equal((await srv.api('/settings/computer', { method: 'PUT', body: { place: 'boat' } })).status, 403, 'the owner no longer');
  assert.equal((await srv.api('/settings/computer', { method: 'PUT', body: { place: 'boat' }, headers: ADMIN })).data.place, 'boat', 'the admin again');
  assert.equal((await srv.api('/settings/boat-size', { method: 'PUT', body: { size: 'small' } })).status, 403);
  assert.equal((await srv.api('/settings/boat-size', { method: 'PUT', body: { size: 'small' }, headers: ADMIN })).data.size, 'small');
  assert.equal((await srv.api('/settings/computer', { method: 'PUT', body: { place: 'linux' }, headers: ADMIN })).data.place, 'linux');
  assert.equal((await srv.api('/boat', { method: 'POST', body: { key: null }, headers: ADMIN })).status, 200);
  assert.equal((await srv.api('/version')).data.boat, false, 'neither: nothing changes');
});

test('removing the key asks about the machines it made; the key stays when boat.dev cannot delete one', async () => {
  assert.equal((await putKey(OWN)).status, 200);
  // Machines made with it, as botdot lists them: the account's, and one of a bot's own.
  const made = ['bx_0000000a', 'bx_0000000b'];
  for (const id of made) boat.machines.set(id, { key: OWN, name: id });
  const list = { '@account': { id: made[0], own: true }, writer: { id: made[1], own: true } };
  await srv.stop();
  fs.writeFileSync(file('boat-machines.json'), JSON.stringify(list));
  srv = await startServer({ dir: path.dirname(data), env: { BOT_DOT_BOAT_URL: boat.url } });

  const st = await srv.api('/settings/boat-key');
  assert.deepEqual([st.data.set, st.data.machines], [true, 2], 'the key survived the restart, and it counts its machines');
  const ask = await srv.api('/settings/boat-key', { method: 'DELETE' });
  assert.deepEqual([ask.status, ask.data.machines], [409, 2], 'it asks');
  assert.equal((await srv.api('/settings/boat-key')).data.set, true);

  boat.state.failDelete = true;
  const stays = await srv.api('/settings/boat-key?machines=delete', { method: 'DELETE' });
  assert.equal(stays.status, 502, stays.text);
  assert.equal((await srv.api('/settings/boat-key')).data.set, true, 'the key stays, to try again');
  assert.ok(Object.keys(machinesFile()).length, 'the machines stay on the list');

  boat.state.failDelete = false;
  const done = await srv.api('/settings/boat-key?machines=delete', { method: 'DELETE' });
  assert.deepEqual([done.status, done.data.removed, done.data.deleted], [200, true, 2]);
  assert.equal(boat.machines.size, 0, 'deleted at boat.dev, with the key that made them');
  assert.ok(boat.seen.filter((s) => s.method === 'DELETE').every((s) => s.key === OWN));
  assert.deepEqual(machinesFile(), {});
  assert.equal((await srv.api('/settings/boat-key')).data.set, false);
});

test('"Keep them" lets go of the machines and leaves them at boat.dev', async () => {
  assert.equal((await putKey(OWN)).status, 200);
  boat.machines.set('bx_0000000c', { key: OWN, name: 'kept' });
  await srv.stop();
  fs.writeFileSync(file('boat-machines.json'), JSON.stringify({ writer: { id: 'bx_0000000c', own: true } }));
  srv = await startServer({ dir: path.dirname(data), env: { BOT_DOT_BOAT_URL: boat.url } });
  const kept = await srv.api('/settings/boat-key?machines=keep', { method: 'DELETE' });
  assert.deepEqual([kept.status, kept.data.removed, kept.data.deleted, kept.data.left], [200, true, 0, 1]);
  assert.ok(boat.machines.has('bx_0000000c'), 'still at boat.dev');
  assert.deepEqual(machinesFile(), {});
  assert.equal((await srv.api('/settings/boat-key', { method: 'DELETE' })).data.removed, false, 'nothing to remove');
});

test('a key stored here is read again when the server starts, and works', async () => {
  assert.equal((await putKey(OWN)).status, 200);
  await srv.stop();
  srv = await startServer({ dir: path.dirname(data), env: { BOT_DOT_BOAT_URL: boat.url } });
  assert.equal((await srv.api('/version')).data.boat, true);
  assert.deepEqual((await srv.api('/settings/computer')).data.ownKey, true);
});

test("the front door's erase, as an account is deleted, deletes its machines with the own key, and answers what it could not", async () => {
  assert.equal((await srv.api('/settings/boat-key')).data.set, true);
  boat.machines.set('bx_0000000d', { key: OWN, name: 'one' });
  boat.machines.set('bx_0000000e', { key: OWN, name: 'two' });
  await srv.stop();
  fs.writeFileSync(file('boat-machines.json'), JSON.stringify({ '@account': { id: 'bx_0000000d', own: true }, writer: { id: 'bx_0000000e', own: true } }));
  srv = await startServer({ dir: path.dirname(data), env: { BOT_DOT_BOAT_URL: boat.url } });
  assert.equal((await srv.api('/boat/erase', { method: 'POST', body: {} })).status, 403, 'not the owner');
  assert.equal((await srv.asChief('/boat/erase', { method: 'POST', body: {}, headers: ADMIN })).status, 403, 'not the Chief');
  boat.seen.length = 0;
  const r = await srv.api('/boat/erase', { method: 'POST', body: {}, headers: ADMIN });
  assert.deepEqual([r.status, r.data.deleted, r.data.failed], [200, 2, []]);
  assert.ok(!boat.machines.has('bx_0000000d') && !boat.machines.has('bx_0000000e'));
  assert.ok(boat.seen.filter((s) => s.method === 'DELETE').length === 2 && boat.seen.filter((s) => s.method === 'DELETE').every((s) => s.key === OWN), 'with the key that made them');
});
