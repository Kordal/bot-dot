// Which boat.dev key a machine's calls use (#1617, ADR 263): the account's own key wins over the machine's, a machine is
// asked about with the key that made it, one made with the other key is let go and made again, and a machine of a bot's
// own is named, sized and rested as the account's is. boat.dev here is a fetch that remembers who asked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const boatLib = require('../lib/boat');
const { boatShown } = require('./helpers');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-own-key-lib-'));
const MACHINE = `boat_${'m'.repeat(16)}`;
const OWN = `boat_${'o'.repeat(16)}`;

function fakeBoat() {
  const machines = new Map(); // id -> { state, name, type, key }
  const calls = []; // { method, path, key, body }
  let n = 0;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, { method = 'GET', body, headers = {} } = {}) => {
    const p = new URL(url).pathname.replace(/^\/api\/v1/, '');
    const data = body ? JSON.parse(body) : null;
    const key = String(headers.Authorization || '').replace('Bearer ', '');
    calls.push({ method, path: p, key, body: data });
    if (p === '/sandboxes' && method === 'POST') {
      const id = `bx_${String(++n).padStart(8, 'a')}`;
      machines.set(id, { id, state: 'ready', name: data.name, type: data.type, key });
      return reply(202, { ok: true, sandbox: { id, state: 'provisioning' } });
    }
    const m = p.match(/^\/sandboxes\/(bx_[a-z0-9]+)(?:\/(.+))?$/);
    const box = m && machines.get(m[1]);
    if (!box || box.key !== key) return reply(404, { ok: false, code: 'not_found' }); // another account's machine
    if (!m[2] && method === 'GET') return reply(200, { ok: true, sandbox: { id: box.id, state: box.state } });
    if (!m[2] && method === 'DELETE') { machines.delete(box.id); return reply(200, { ok: true }); }
    if (!m[2]) return reply(200, { ok: true });
    if (m[2] === 'stop') { box.state = 'archived'; return reply(202, { ok: true }); }
    if (m[2] === 'resume') { box.state = 'ready'; return reply(202, { ok: true }); }
    if (m[2] === 'commands') return reply(200, { ok: true, exitCode: 0, stdout: `ran: ${boatShown(data.command)}`, stderr: '', timedOut: false });
    return reply(200, { ok: true });
  };
  const keysFor = (id) => [...new Set(calls.filter((c) => c.path.startsWith(`/sandboxes/${id}`)).map((c) => c.key))];
  return { fetch, machines, calls, keysFor };
}
const keys = (t, { machine = null, own = null } = {}) => {
  boatLib.setKey(machine);
  boatLib.setOwnKey(own);
  t.after(() => { boatLib.setKey(null); boatLib.setOwnKey(null); });
};
const make = (b, opts = {}) => boatLib.create(dir(), { kitOnStart: false, fetch: b.fetch, sleep: async () => {}, ownOf: () => false, ...opts });

test('the machine has the one key it was given, the account\'s own key wins, and either makes boat.dev ready', async (t) => {
  keys(t);
  assert.deepEqual([boatLib.configured(), boatLib.ownConfigured(), boatLib.machineConfigured()], [false, false, false]);
  boatLib.setKey(MACHINE);
  assert.deepEqual([boatLib.configured(), boatLib.ownConfigured(), boatLib.machineConfigured()], [true, false, true]);
  boatLib.setOwnKey(OWN);
  assert.deepEqual([boatLib.configured(), boatLib.ownConfigured(), boatLib.machineConfigured()], [true, true, true]);
  boatLib.setKey(null);
  assert.deepEqual([boatLib.configured(), boatLib.ownConfigured()], [true, true], 'its own key alone is enough');
  boatLib.setOwnKey(null);
  assert.equal(boatLib.configured(), false, 'without either, nothing changes: this machine');
});

test('with both keys, a new machine is made with the own key and is marked its own; without it, with the machine\'s', async (t) => {
  keys(t, { machine: MACHINE, own: OWN });
  const b = fakeBoat();
  const boat = make(b);
  await boat.runShell('coder', { command: 'ls' });
  const [made] = b.calls.filter((c) => c.method === 'POST' && c.path === '/sandboxes');
  assert.equal(made.key, OWN, 'the own key wins');
  assert.deepEqual(b.keysFor('bx_aaaaaaa1'), [OWN], 'every call about it goes with that key');
  assert.deepEqual(boat.ownMachines(), [{ id: 'bx_aaaaaaa1', box: boatLib.ACCOUNT }], 'marked as the account\'s own');
  keys(t, { machine: MACHINE });
  const c = fakeBoat();
  const plain = make(c);
  await plain.runShell('coder', { command: 'ls' });
  assert.equal(c.calls.find((x) => x.method === 'POST' && x.path === '/sandboxes').key, MACHINE);
});

test("a machine made with the machine's key goes on with it while it is up; once it rests, the own key makes a new one", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  let now = 0;
  const boat = make(b, { now: () => now });
  await boat.runShell('coder', { command: 'ls' });
  assert.equal(b.machines.get('bx_aaaaaaa1').key, MACHINE);
  assert.deepEqual(boat.ownMachines(), [], "the machine's, not the account's to keep or delete");

  boatLib.setOwnKey(OWN); // the account adds its own key
  await boat.runShell('coder', { command: 'pwd' });
  assert.equal(b.machines.size, 1, 'the one that is up goes on, with the key it was made with');
  assert.ok(b.calls.filter((c) => c.path.startsWith('/sandboxes/bx_aaaaaaa1')).every((c) => c.key === MACHINE));

  now = boatLib.REST_AFTER_MS + 1;
  await boat.restIdle();
  assert.equal(b.machines.get('bx_aaaaaaa1').state, 'archived', 'rested with the key it was made with');
  await boat.runShell('coder', { command: 'pwd' });
  assert.equal(b.machines.size, 2, 'a new machine, made with the own key');
  assert.equal(b.machines.get('bx_aaaaaaa2').key, OWN);
  assert.deepEqual(boat.ownMachines(), [{ id: 'bx_aaaaaaa2', box: boatLib.ACCOUNT }]);

  // The other way: the own key goes (its machines were dealt with) and the machine's is left: the same, once it rests.
  await boat.dropOwn({ deleteThem: true });
  boatLib.setOwnKey(null);
  await boat.runShell('coder', { command: 'pwd' });
  assert.equal(b.machines.get('bx_aaaaaaa3').key, MACHINE, 'made with the machine\'s key again');
});

test("removing the key: its machines are deleted with it or only let go, and the machine's key's are not touched", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const boat = make(b, { ownOf: (id) => id === 'writer' });
  await boat.runShell('coder', { command: 'ls' }); // the account's machine, made with the machine's key
  boatLib.setOwnKey(OWN);
  await boat.runShell('writer', { command: 'ls' }); // a machine of its own, made with the own key
  assert.deepEqual(boat.ownMachines(), [{ id: 'bx_aaaaaaa2', box: 'writer' }]);

  const kept = await boat.dropOwn({ deleteThem: false });
  assert.deepEqual([kept.deleted, kept.left, kept.failed.length], [0, 1, 0]);
  assert.deepEqual(boat.ownMachines(), []);
  assert.equal(b.machines.size, 2, 'left at boat.dev');

  await boat.runShell('writer', { command: 'ls' });
  assert.deepEqual(boat.ownMachines(), [{ id: 'bx_aaaaaaa3', box: 'writer' }]);
  const gone = await boat.dropOwn({ deleteThem: true });
  assert.deepEqual([gone.deleted, gone.left, gone.failed.length], [1, 0, 0]);
  assert.ok(!b.machines.has('bx_aaaaaaa3'), 'deleted at boat.dev');
  assert.ok(b.machines.has('bx_aaaaaaa1'), "the machine's key's machine is not touched");
  assert.ok(b.calls.filter((c) => c.method === 'DELETE').every((c) => c.key === OWN));
});

test('a machine boat.dev will not delete stays on the list and is said; the others go all the same', async (t) => {
  keys(t, { own: OWN });
  const b = fakeBoat();
  let failFor = null;
  const fetch = async (url, o = {}) => (o.method === 'DELETE' && String(url).endsWith(failFor || '/-') ? { ok: false, status: 500, json: async () => ({ ok: false, code: 'internal' }) } : b.fetch(url, o));
  const boat = make({ ...b, fetch }, { ownOf: () => true });
  await boat.runShell('coder', { command: 'ls' });
  await boat.runShell('writer', { command: 'ls' });
  failFor = 'bx_aaaaaaa1';
  const r = await boat.dropOwn({ deleteThem: true });
  assert.deepEqual([r.deleted, r.failed.length], [1, 1]);
  assert.deepEqual(boat.ownMachines().map((m) => m.id), ['bx_aaaaaaa1'], 'it stays on the list, to try again');
});

test("erasing the account deletes each machine with the key that made it", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const boat = make(b, { ownOf: () => true });
  await boat.runShell('old', { command: 'ls' }); // the machine's key
  boatLib.setOwnKey(OWN);
  await boat.runShell('coder', { command: 'ls' }); // the own key
  const r = await boat.erase();
  assert.deepEqual([r.deleted, r.failed.length], [2, 0]);
  assert.equal(b.machines.size, 0);
  const del = b.calls.filter((c) => c.method === 'DELETE');
  assert.deepEqual(del.map((c) => [c.path, c.key]).sort(), [['/sandboxes/bx_aaaaaaa1', MACHINE], ['/sandboxes/bx_aaaaaaa2', OWN]]);
});

test("an account the console moved keeps the machines its own key made; the machine's key's go", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const boat = make(b, { ownOf: () => true });
  await boat.runShell('old', { command: 'ls' }); // the machine's key
  boatLib.setOwnKey(OWN);
  await boat.runShell('coder', { command: 'ls' }); // the own key
  const r = await boat.erase({ keepOwn: true });
  assert.deepEqual([r.deleted, r.failed.length], [1, 0]);
  assert.deepEqual([...b.machines.keys()], ['bx_aaaaaaa2'], 'the own key\'s machine stays at boat.dev');
});

test("a bot's own machine is named for the instance, account, bot and id, has the account's size and rests after 30 minutes", async (t) => {
  keys(t, { own: OWN });
  const b = fakeBoat();
  let now = 0;
  const boat = make(b, { account: 'Kordal', instance: 'ab12cd', nameOf: (id) => (id === 'writer' ? 'Writer Bot' : null), ownOf: (id) => id === 'writer', size: () => 'large', now: () => now });
  await boat.runShell('writer', { command: 'ls' });
  await boat.runShell('coder', { command: 'ls' });
  const [own, shared] = [...b.machines.values()];
  assert.equal(own.name, 'botdot-ab12cd-kordal-writer-bot-writer');
  assert.equal(own.type, 'large', "the account's size");
  assert.equal(shared.name, 'botdot-ab12cd-kordal');
  assert.equal(boatLib.REST_AFTER_MS, 30 * 60_000);
  assert.equal(boat.info('writer').shared, false);
  now = boatLib.REST_AFTER_MS + 1;
  assert.deepEqual((await boat.restIdle()).sort(), ['@account', 'writer'].sort());
  assert.ok(b.calls.filter((c) => c.path.endsWith('/stop')).every((c) => c.key === OWN), 'rested with the own key');
});

test("the commands of a bot's own machine start in its home; the account's own key never goes to a machine", async (t) => {
  keys(t, { own: OWN });
  const b = fakeBoat();
  const boat = make(b, { ownOf: (id) => id === 'writer' });
  await boat.runShell('writer', { command: 'env' });
  await boat.runShell('coder', { command: 'env' });
  const sent = b.calls.filter((c) => c.path.endsWith('/commands')).map((c) => JSON.stringify(c.body));
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => !s.includes(OWN)), 'no command, header or file on a machine has the key');
  assert.match(boatShown(JSON.parse(sent[0]).command), /^env$/);
  assert.match(boatShown(JSON.parse(sent[1]).command), /workspace\/coder/);
});

test("without any key boat.dev says whose to add, and a key boat.dev refuses is shown as refused", async (t) => {
  keys(t);
  const boat = make(fakeBoat());
  await assert.rejects(boat.runShell('coder', { command: 'ls' }), /add your own in Settings → Computer/);
  keys(t, { own: OWN });
  const refuser = make(fakeBoat(), { fetch: async () => ({ ok: false, status: 401, json: async () => ({ ok: false }) }) });
  assert.equal(boatLib.isOwnRefused(), false);
  await assert.rejects(refuser.runShell('coder', { command: 'ls' }), /your boat\.dev key/);
  assert.equal(boatLib.isOwnRefused(), true);
  boatLib.setOwnKey(OWN);
  assert.equal(boatLib.isOwnRefused(), false, 'a key set again starts clean');
});
