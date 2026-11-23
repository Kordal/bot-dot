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
  assert.ok(!b.machines.has('bx_aaaaaaa3'), "no new machine: the one the machine's key made before comes back, with its files");
  assert.equal(boat.ownMachines().length, 0);
  assert.equal(b.machines.get('bx_aaaaaaa1').key, MACHINE);
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

// ---------- the machine let go of when the other key comes into use (ADR 263) ----------
// A machine that is up goes on with the key it was made with until it rests; `clock` moves time on and rests it.
const makeIn = (b, d, opts = {}) => boatLib.create(d, { kitOnStart: false, fetch: b.fetch, sleep: async () => {}, ownOf: () => false, ...opts });
const clocked = () => {
  const c = { now: 0 };
  c.rest = (boat) => { c.now += boatLib.REST_AFTER_MS + 1; return boat.restIdle(); };
  return c;
};
const listed = (d) => JSON.parse(fs.readFileSync(path.join(d, 'boat-machines.json'), 'utf8'));

test("a machine made with the machine's key is kept, not forgotten, when the own key comes into use: erasing deletes it with that key", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const d = dir();
  const clock = clocked();
  const boat = makeIn(b, d, { now: () => clock.now });
  await boat.runShell('coder', { command: 'ls' });
  assert.equal(b.machines.get('bx_aaaaaaa1').key, MACHINE);

  boatLib.setOwnKey(OWN); // the account adds its own key
  await clock.rest(boat);
  await boat.runShell('coder', { command: 'pwd' }); // the next ensure of the account's machine
  assert.equal(b.machines.get('bx_aaaaaaa1').state, 'archived', 'stopped with the key it was made with');
  assert.equal(b.machines.get('bx_aaaaaaa2').key, OWN, 'a new one, made with the own key');
  const kept = listed(d);
  assert.equal(kept[boatLib.ACCOUNT].id, 'bx_aaaaaaa2');
  assert.equal(kept['@retired'].bx_aaaaaaa1.box, boatLib.ACCOUNT, 'the old one is kept, with where it was');
  assert.ok(!kept['@retired'].bx_aaaaaaa1.own, "made with the machine's key");
  assert.deepEqual(boat.ownMachines(), [{ id: 'bx_aaaaaaa2', box: boatLib.ACCOUNT }], "the machine key's is not the account's to remove with its key");

  // A botdot that started again still knows it.
  const again = makeIn(b, d);
  const r = await again.erase();
  assert.deepEqual([r.deleted, r.failed.length], [2, 0]);
  assert.equal(b.machines.size, 0, 'both are gone from boat.dev');
  const del = b.calls.filter((c) => c.method === 'DELETE').map((c) => [c.path, c.key]).sort();
  assert.deepEqual(del, [['/sandboxes/bx_aaaaaaa1', MACHINE], ['/sandboxes/bx_aaaaaaa2', OWN]], 'each with the key that made it');
  assert.deepEqual(listed(d), {}, 'nothing is left on the list');
});

test("a retired machine that boat.dev won't delete stays on the list for the next try, and the console's keepOwn leaves the own key's", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const d = dir();
  const clock = clocked();
  let refuse = true;
  const fetch = async (url, o = {}) => (refuse && o.method === 'DELETE' && String(url).endsWith('bx_aaaaaaa1') ? { ok: false, status: 500, json: async () => ({ ok: false, code: 'internal' }) } : b.fetch(url, o));
  const boat = makeIn({ fetch }, d, { now: () => clock.now });
  await boat.runShell('coder', { command: 'ls' });
  boatLib.setOwnKey(OWN);
  await clock.rest(boat);
  await boat.runShell('coder', { command: 'ls' });
  const r = await boat.erase({ keepOwn: true });
  assert.deepEqual([r.deleted, r.failed.map((f) => f.id)], [0, ['bx_aaaaaaa1']]);
  assert.ok(b.machines.has('bx_aaaaaaa2'), "the own key's machine stays for the machine the account moved to");
  assert.ok('bx_aaaaaaa1' in listed(d)['@retired'], 'the one boat.dev refused is still listed');
  refuse = false;
  const again = await boat.erase({ keepOwn: true });
  assert.deepEqual([again.deleted, again.failed.length], [1, 0]);
  assert.deepEqual([...b.machines.keys()], ['bx_aaaaaaa2']);
});

test("a machine made with the own key is kept the same way when the own key goes, and removing the key deletes it with that key", async (t) => {
  keys(t, { machine: MACHINE, own: OWN });
  const b = fakeBoat();
  const d = dir();
  const clock = clocked();
  const boat = makeIn(b, d, { now: () => clock.now });
  await boat.runShell('coder', { command: 'ls' }); // made with the own key
  boatLib.setOwnKey(null); // the key is out (botdot starts again without it): the machine's is in use
  const later = makeIn(b, d, { now: () => clock.now });
  await later.runShell('coder', { command: 'ls' });
  assert.equal(b.machines.get('bx_aaaaaaa2').key, MACHINE);
  assert.deepEqual(later.ownMachines(), [{ id: 'bx_aaaaaaa1', box: boatLib.ACCOUNT, retired: true }], "still the account's, and counted");

  boatLib.setOwnKey(OWN); // the owner has it again, and removes it, deleting its machines
  const boat2 = later;
  const r = await boat2.dropOwn({ deleteThem: true });
  assert.deepEqual([r.deleted, r.left, r.failed.length], [1, 0, 0]);
  assert.ok(!b.machines.has('bx_aaaaaaa1'), 'the retired one is deleted with the own key');
  assert.deepEqual(boat2.ownMachines(), []);
  assert.ok(b.machines.has('bx_aaaaaaa2'), "the machine key's machine is not touched");
  assert.ok(!('@retired' in listed(d)), 'and it is off the list');
});

test("'Keep them' lets a retired own machine go from the list; it stays at boat.dev", async (t) => {
  keys(t, { machine: MACHINE, own: OWN });
  const b = fakeBoat();
  const clock = clocked();
  const d = dir();
  const first = makeIn(b, d, { now: () => clock.now });
  await first.runShell('coder', { command: 'ls' });
  boatLib.setOwnKey(null);
  const boat2 = makeIn(b, d, { now: () => clock.now });
  await boat2.runShell('coder', { command: 'ls' });
  boatLib.setOwnKey(OWN);
  const r = await boat2.dropOwn({ deleteThem: false });
  assert.deepEqual([r.deleted, r.left, r.failed.length], [0, 1, 0]);
  assert.ok(b.machines.has('bx_aaaaaaa1'), "stays at boat.dev, on the owner's account");
  assert.deepEqual(boat2.ownMachines(), []);
});

test("the owner's copy of the account's files reads the machine that was let go of, once; the new one is what it writes to", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const clock = clocked();
  const boat = makeIn(b, dir(), { now: () => clock.now });
  await boat.runShell('coder', { command: 'ls' }); // the files are on the machine key's machine
  await clock.rest(boat); // it rests
  boatLib.setOwnKey(OWN); // the owner adds the key and moves the computer with "Copy files", before any bot runs again
  const sent = () => b.calls.filter((c) => c.path.endsWith('/commands')).map((c) => [c.path.split('/')[2], c.key]);

  await boat.moveFiles('coder', { op: 'pack' }, { own: false, source: true });
  assert.deepEqual(sent().at(-1), ['bx_aaaaaaa1', MACHINE], 'the pack ran on the old machine, with the key that made it');
  assert.equal(b.machines.get('bx_aaaaaaa1').state, 'ready', 'started for the copy, with its own key');
  assert.ok(b.calls.filter((c) => c.path === '/sandboxes/bx_aaaaaaa1/resume').every((c) => c.key === MACHINE));
  assert.equal(b.machines.size, 1, 'no new machine was made to read from');
  await boat.moveFiles('coder', { op: 'read', offset: 0, length: 10 }, { own: false, source: true });
  assert.deepEqual(sent().at(-1), ['bx_aaaaaaa1', MACHINE]);
  assert.equal(b.machines.size, 1);

  // The new side of a copy to the account's machine here is the machine in use, made with the own key.
  await boat.moveFiles('coder', { op: 'write', offset: 0, data: '' }, { own: false });
  assert.equal(b.machines.size, 2);
  assert.equal(b.machines.get('bx_aaaaaaa2').key, OWN);
  assert.equal(sent().at(-1)[0], 'bx_aaaaaaa2');

  // The old one rests once unused, and its tidying step does not start it again.
  await clock.rest(boat);
  assert.equal(b.machines.get('bx_aaaaaaa1').state, 'archived');
  const before = b.calls.length;
  assert.deepEqual(await boat.moveFiles('coder', { op: 'drop' }, { own: false, source: true }), { code: 0 });
  assert.equal(b.calls.length, before, 'asked nothing');

  // Once the copy succeeded the next one is from the machine in use: the old one is not read twice.
  boat.copiedFrom('coder', false);
  await boat.moveFiles('coder', { op: 'pack' }, { own: false, source: true });
  assert.equal(sent().at(-1)[0], 'bx_aaaaaaa2');
});

test("a copy from a machine that was let go of and is gone says so", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const clock = clocked();
  const boat = makeIn(b, dir(), { now: () => clock.now });
  await boat.runShell('coder', { command: 'ls' });
  await clock.rest(boat);
  boatLib.setOwnKey(OWN);
  b.machines.delete('bx_aaaaaaa1'); // boat.dev dropped it
  await assert.rejects(boat.moveFiles('coder', { op: 'pack' }, { own: false, source: true }), /earlier machine on boat\.dev is gone/);
});

test("a bot's own machine that was let go of is read for its copy the same way, by that bot's id", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const clock = clocked();
  const boat = makeIn(b, dir(), { now: () => clock.now, ownOf: (id) => id === 'writer' });
  await boat.runShell('writer', { command: 'ls' });
  await clock.rest(boat);
  boatLib.setOwnKey(OWN);
  await boat.moveFiles('writer', { op: 'pack' }, { own: true, source: true });
  assert.equal(b.calls.filter((c) => c.path.endsWith('/commands')).at(-1).path, '/sandboxes/bx_aaaaaaa1/commands');
  assert.equal(b.machines.size, 1);
});

test("a replay's copy made with the own key goes off the list when the key is removed, deleted or only let go of", async (t) => {
  keys(t, { own: OWN });
  const b = fakeBoat();
  const fakeFork = b.fetch;
  const d = dir();
  const boat = makeIn({ fetch: b.fetch }, d);
  await boat.runShell('coder', { command: 'ls' });
  // A copy on the list, as fork() leaves it while a replay runs.
  fs.writeFileSync(path.join(d, 'boat-replays.json'), JSON.stringify({ bx_f0000001: { dir: '/home/user', at: new Date().toISOString(), own: true } }));
  b.machines.set('bx_f0000001', { id: 'bx_f0000001', state: 'ready', key: OWN });

  const kept = makeIn({ fetch: fakeFork }, d);
  assert.deepEqual(kept.forksLeft(), ['bx_f0000001']);
  await kept.dropOwn({ deleteThem: false });
  assert.deepEqual(kept.forksLeft(), [], "off the list: with no key a sweep could never delete it, and boat.dev's own net stops it");
  assert.ok(b.machines.has('bx_f0000001'));

  fs.writeFileSync(path.join(d, 'boat-replays.json'), JSON.stringify({ bx_f0000001: { dir: '/home/user', at: new Date().toISOString(), own: true } }));
  const gone = makeIn({ fetch: fakeFork }, d);
  const r = await gone.dropOwn({ deleteThem: true });
  assert.deepEqual([r.failed.length, gone.forksLeft()], [0, []]);
  assert.ok(!b.machines.has('bx_f0000001'), 'deleted with the own key');

  // One boat.dev fails to delete counts as a machine that failed: the key stays, to try again.
  b.machines.set('bx_f0000001', { id: 'bx_f0000001', state: 'ready', key: OWN });
  fs.writeFileSync(path.join(d, 'boat-replays.json'), JSON.stringify({ bx_f0000001: { dir: '/home/user', at: new Date().toISOString(), own: true } }));
  const failing = makeIn({ fetch: async (url, o = {}) => (o.method === 'DELETE' ? { ok: false, status: 500, json: async () => ({ ok: false, code: 'internal' }) } : b.fetch(url, o)) }, d);
  const f = await failing.dropOwn({ deleteThem: true });
  assert.deepEqual([f.failed.map((x) => x.id), failing.forksLeft()], [['bx_f0000001'], ['bx_f0000001']]);
});

test("a copy reads the layers of the account's files oldest first: the machine let go of, then the one bots wrote on since", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const clock = clocked();
  const boat = makeIn(b, dir(), { now: () => clock.now });
  assert.equal(boat.sourceLayers('coder', false), undefined, 'no machine yet: the one in use');
  await boat.runShell('coder', { command: 'ls' });
  assert.equal(boat.sourceLayers('coder', false), undefined, 'nothing let go of');
  await clock.rest(boat);
  boatLib.setOwnKey(OWN);
  assert.deepEqual(boat.sourceLayers('coder', false), ['retired'], 'let go of, and no machine in use yet: nothing was made to read from');
  assert.equal(b.machines.size, 1);

  await boat.runShell('coder', { command: 'pwd' }); // bots work on the new machine
  assert.deepEqual(boat.sourceLayers('coder', false), ['retired', 'live']);
  const sent = () => b.calls.filter((c) => c.path.endsWith('/commands')).at(-1).path.split('/')[2];
  await boat.moveFiles('coder', { op: 'pack' }, { own: false, source: true, layer: 'retired' });
  assert.equal(sent(), 'bx_aaaaaaa1');
  await boat.moveFiles('coder', { op: 'pack' }, { own: false, source: true, layer: 'live' });
  assert.equal(sent(), 'bx_aaaaaaa2', 'the files bots wrote since are copied too');

  boat.copiedFrom('coder', false);
  assert.equal(boat.sourceLayers('coder', false), undefined, 'copied once: from the one in use from now on');
});

test("when the key that made a retired machine is in use again, it is the box's machine again: its files are not left behind", async (t) => {
  keys(t, { machine: MACHINE });
  const b = fakeBoat();
  const d = dir();
  const clock = clocked();
  const boat = makeIn(b, d, { now: () => clock.now });
  await boat.runShell('coder', { command: 'ls' }); // the admin's key made the account's machine, with its files
  boatLib.setOwnKey(OWN);
  await clock.rest(boat);
  await boat.runShell('coder', { command: 'ls' }); // retired: a new one is made with the own key
  assert.equal(b.machines.size, 2);
  assert.ok('bx_aaaaaaa1' in listed(d)['@retired']);

  // The owner removes the key, deleting what it made: the account's earlier machine comes back, not a third.
  const gone = await boat.dropOwn({ deleteThem: true });
  assert.equal(gone.deleted, 1);
  boatLib.setOwnKey(null);
  await boat.runShell('coder', { command: 'pwd' });
  assert.deepEqual([...b.machines.keys()], ['bx_aaaaaaa1'], 'no new machine');
  assert.equal(listed(d)[boatLib.ACCOUNT].id, 'bx_aaaaaaa1');
  assert.ok(!('@retired' in listed(d)));
  assert.equal(b.machines.get('bx_aaaaaaa1').state, 'ready', 'started again with its own key');
  assert.deepEqual(b.keysFor('bx_aaaaaaa1'), [MACHINE]);
});
