// A bot's computer on boat.dev (#529, ADR 088): its commands and files go to a machine of its own there, through
// boat.dev's API with the admin's key. The machine is made or started on the first of them and stops after 30
// minutes unused; it has no screen, takes a Vault secret for one command (#560) and never on a command line; when
// boat.dev can't start it, the account's computer stands in for its commands and files, never for its secrets.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const boatLib = require('../lib/boat');
const screensLib = require('../lib/computer-screens');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-boat-'));
const KEY = `boat_${'x'.repeat(16)}`; // no real key

// boat.dev as far as botdot uses it: machines that are made, stopped, started again, and run commands and files.
function fakeBoat({ refuse = false } = {}) {
  const machines = new Map();
  const calls = [];
  let n = 0;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, { method = 'GET', headers, body } = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v1/, '');
    const data = body ? JSON.parse(body) : null;
    calls.push({ method, path: p, body: data, auth: headers.Authorization });
    if (refuse || headers.Authorization !== `Bearer ${KEY}`) return reply(401, { ok: false, code: 'unauthorized' });
    if (p === '/me') return reply(200, { ok: true, user: { login: 'x' } });
    if (p === '/limits') return reply(200, { ok: true, machineTypes: [{ type: 'small', available: true }, { type: 'default', available: true }, { type: 'large', available: false, reason: 'not during the free trial' }, { type: 'xlarge', available: false }] });
    if (p === '/sandboxes' && method === 'POST') {
      const id = `bx_${String(++n).padStart(8, 'a')}`;
      machines.set(id, { id, state: 'ready', type: data.type, files: new Map() });
      return reply(202, { ok: true, sandbox: { id, state: 'provisioning' } });
    }
    const m = p.match(/^\/sandboxes\/(bx_[a-z0-9]+)(?:\/(.+))?$/);
    const box = m && machines.get(m[1]);
    if (!box) return reply(404, { ok: false, code: 'not_found' });
    if (!m[2] && method === 'GET') return reply(200, { ok: true, sandbox: { id: box.id, state: box.state } });
    if (!m[2] && method === 'PATCH') return reply(200, { ok: true });
    if (m[2] === 'stop') { box.state = 'archived'; return reply(202, { ok: true }); }
    if (m[2] === 'resume') {
      if (data?.type === 'xlarge') return reply(403, { ok: false, code: 'machine_type_unavailable' });
      box.state = 'ready'; if (data?.type) box.type = data.type; return reply(202, { ok: true });
    }
    if (m[2] === 'files' && method === 'PUT') { box.files.set(data.path, data.content); return reply(200, { ok: true }); }
    if (m[2] === 'files') return reply(200, { ok: true, content: box.files.get(u.searchParams.get('path')) || '' });
    if (m[2] === 'commands') {
      if (box.state !== 'ready') return reply(409, { ok: false, code: 'sandbox_not_ready' });
      return reply(200, { ok: true, exitCode: data.command.includes('false') ? 1 : 0, stdout: `ran: ${data.command}`, stderr: '', timedOut: false });
    }
    return reply(400, { ok: false });
  };
  return { fetch, calls, machines };
}

test('the admin key is checked with one call to boat.dev before it is kept', async () => {
  const b = fakeBoat();
  assert.equal(await boatLib.checkKey(KEY, { fetch: b.fetch }), 'ok');
  assert.deepEqual(b.calls.map((c) => c.path), ['/me']);
  assert.equal(await boatLib.checkKey(`boat_${'y'.repeat(16)}`, { fetch: b.fetch }), 'refused');
  assert.equal(await boatLib.checkKey('no', { fetch: b.fetch }), 'refused', 'no call for what is no key');
  assert.equal(await boatLib.checkKey(KEY, { fetch: async () => { throw new Error('down'); } }), 'unreachable');
  assert.equal(await boatLib.checkKey(KEY, { fetch: async () => ({ ok: false, status: 402, json: async () => ({ code: 'billing_required' }) }) }), 'billing', 'a good key on an account without a plan');
});

test("a bot's first command makes its machine, the next ones use it, and it stays the bot's across a restart", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const data = dir();
  const boat = boatLib.create(data, { fetch: b.fetch, sleep: async () => {}, account: '' });
  const r = await boat.runShell('coder', { command: 'git status', timeoutSeconds: 30 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'ran: git status');
  await boat.runShell('coder', { command: 'ls' });
  assert.equal(b.calls.filter((c) => c.path === '/sandboxes' && c.method === 'POST').length, 1, 'one machine for the bot');
  const made = b.calls.find((c) => c.path === '/sandboxes');
  assert.equal(made.body.name, 'botdot-coder');
  assert.equal(made.auth, `Bearer ${KEY}`);
  const failed = await boat.runShell('coder', { command: 'false' });
  assert.equal(failed.code, 1, 'its exit code comes back');
  const again = boatLib.create(data, { fetch: b.fetch, sleep: async () => {} });
  await again.runShell('coder', { command: 'pwd' });
  assert.equal(b.machines.size, 1, 'botdot started again: the same machine');
});

test('a file is written through boat.dev\'s file API and moved where the bot said', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {} });
  const r = await boat.writeFile('coder', { path: "notes/it's.md", content: 'hello' });
  assert.equal(r.code, 0);
  const put = b.calls.find((c) => c.method === 'PUT');
  assert.match(put.body.path, /^\/tmp\/botdot-[0-9a-f]{16}$/);
  assert.equal(Buffer.from(put.body.content, 'base64').toString(), 'hello');
  const mv = b.calls.filter((c) => c.path.endsWith('/commands')).at(-1).body.command;
  assert.ok(mv.includes(`mv -f -- ${put.body.path} 'notes/it'\\''s.md'`), 'the path is quoted for the shell');
});

test('a machine unused for 30 minutes stops, and the next command starts it again', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  let now = 1_000_000;
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, now: () => now, restAfterMs: 30 * 60_000 });
  await boat.runShell('coder', { command: 'ls' });
  now += 29 * 60_000;
  assert.deepEqual(await boat.restIdle(), [], 'still in use');
  now += 2 * 60_000;
  assert.deepEqual(await boat.restIdle(), ['coder']);
  const [box] = b.machines.values();
  assert.equal(box.state, 'archived');
  assert.equal(boat.isUp('coder'), false);
  const r = await boat.runShell('coder', { command: 'ls' });
  assert.equal(r.code, 0);
  assert.ok(b.calls.some((c) => c.path.endsWith('/resume')), 'started again, not made anew');
  assert.equal(b.machines.size, 1);
});

// The facade: which calls of a boat bot go to boat.dev, which are refused, and the account's computer standing in.
function facadeWith(boat, kind = 'boat') {
  const got = [];
  const record = (name) => async (...args) => { got.push(name); return { code: 0, stdout: 'on the account', stderr: '', timedOut: false }; };
  const raw = { ensure: record('ensure'), runShell: record('runShell'), readFile: record('readFile'), runWithLogin: record('runWithLogin'), request: record('request'), restScreen: async () => {}, inspect: async () => ({ state: 'running' }) };
  const f = screensLib.facade(raw, screensLib.create(dir()), { boat, kindOf: () => kind });
  return { f, got };
}

test("a boat bot's commands and Vault secrets go to boat.dev; its screen and placed files are refused", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const { f, got } = facadeWith(boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {} }));
  await f.ensureMachine('coder');
  assert.equal((await f.runShell('coder', { command: 'ls' })).stdout, 'ran: ls');
  const login = await f.runWithLogin('coder', { command: 'x', username: 'u', password: 'p4ssw0rd' });
  assert.equal(login.code, 0);
  assert.match(login.stdout, /timeout -k 5 120 sh -c 'x'/);
  assert.match((await f.placeFile('coder', { path: '/etc/x' })).error, /keeps no file of the Vault/);
  await assert.rejects(f.request('coder', {}), /no screen or browser/);
  await assert.rejects(f.ensure('coder'), /no screen or browser/);
  assert.deepEqual(got, [], "nothing reached the account's computer");
});

test("when boat.dev can't start the machine, the account's computer runs the command and says so", async () => {
  const b = fakeBoat({ refuse: true });
  boatLib.setKey(null); // no key at all: the same
  const { f, got } = facadeWith(boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {} }));
  await f.ensureMachine('coder');
  const r = await f.runShell('coder', { command: 'ls' });
  assert.equal(r.stdout, 'on the account');
  assert.match(r.error, /ran on the account's computer/);
  assert.deepEqual(got, ['ensure', 'runShell']);
  assert.match((await f.runWithLogin('coder', { command: 'x' })).error, /couldn't start your machine, and botdot uses a saved secret nowhere else/, "its Vault secrets don't go to the account's computer");
  assert.match((await f.readFile('coder', { path: 'a' })).error, /ran on the account's computer/, 'a file read says so too');
  assert.deepEqual(got, ['ensure', 'runShell', 'readFile']);
});

test("a machine that boat.dev can't start again mid-run hands over to the account's computer", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  let down = false;
  const fetch = (url, opts) => (down ? Promise.reject(new Error('down')) : b.fetch(url, opts));
  const boat = boatLib.create(dir(), { fetch, sleep: async () => {}, now: () => (down ? 1e13 : 1e6) });
  const { f, got } = facadeWith(boat);
  await f.ensureMachine('coder');
  assert.equal((await f.runShell('coder', { command: 'ls' })).stdout, 'ran: ls');
  await boat.restIdle(); // still keyed, but boat.dev is down from here on
  down = true;
  await boat.restIdle();
  const r = await f.runShell('coder', { command: 'ls' });
  assert.equal(r.stdout, 'on the account');
  assert.match(r.error, /ran on the account's computer/);
  assert.deepEqual(got, ['runShell']);
});

test('a command right after an idle stop waits for the stop, then starts the machine again', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  let now = 1_000_000;
  let release;
  const held = new Promise((r) => { release = r; });
  // boat.dev answers the stop only once let go, and says running for a moment after it
  let stops = 0;
  const fetch = async (url, opts) => {
    if (url.endsWith('/stop')) { stops++; await held; const r = await b.fetch(url, opts); [...b.machines.values()][0].state = 'running'; setTimeout(() => { [...b.machines.values()][0].state = 'archived'; }, 0); return r; }
    return b.fetch(url, opts);
  };
  const boat = boatLib.create(dir(), { fetch, sleep: () => new Promise((r) => setTimeout(r, 1)), now: () => now, restAfterMs: 60_000 });
  await boat.runShell('coder', { command: 'ls' });
  now += 120_000;
  const resting = boat.restIdle();
  const ran = boat.runShell('coder', { command: 'pwd' });
  release();
  await resting;
  const r = await ran;
  assert.equal(r.code, 0);
  assert.equal(stops, 1);
  assert.ok(b.calls.some((c) => c.path.endsWith('/resume')), 'started again after the stop, not run on a stopping machine');
});

test("without a key, idle machines are kept in mind and stopped once a key is back", async () => {
  boatLib.setKey(KEY);
  const b = fakeBoat();
  let now = 1_000_000;
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, now: () => now, restAfterMs: 60_000 });
  await boat.runShell('coder', { command: 'ls' });
  boatLib.setKey(null);
  now += 120_000;
  assert.deepEqual(await boat.restIdle(), []);
  boatLib.setKey(KEY);
  assert.deepEqual(await boat.restIdle(), ['coder']);
  boatLib.setKey(null);
});

test("a bot on the account's computer is not touched by boat.dev", async () => {
  const b = fakeBoat();
  const { f, got } = facadeWith(boatLib.create(dir(), { fetch: b.fetch }), 'linux');
  await f.ensureMachine('helper');
  await f.runShell('helper', { command: 'ls' });
  assert.deepEqual(got, ['ensure', 'runShell']);
  assert.equal(b.calls.length, 0);
});

test('the front door keeps the boat.dev key to itself: the admin page sees only that one is set', () => {
  const store = require('../lib/front-door/boat').open(dir());
  assert.deepEqual(store.shown(), { keySet: false });
  assert.deepEqual(store.set(KEY), { keySet: true });
  assert.equal(JSON.stringify(store.shown()).includes(KEY), false);
  assert.deepEqual(store.forAccounts(), { key: KEY }, 'each account is handed it');
  assert.deepEqual(store.set(null), { keySet: false });
});

test('an account takes the key only as a key, and says boat.dev is ready once it has one', () => {
  assert.throws(() => boatLib.setKey('no spaces allowed'), /no boat.dev key/);
  assert.equal(boatLib.setKey(KEY), true);
  assert.equal(boatLib.configured(), true);
  assert.equal(boatLib.setKey(null), false);
  assert.equal(boatLib.configured(), false);
});

test("the account's size makes new machines, and moves a bot's machine to it the next time it starts (#539)", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  let size = 'small';
  let now = 1_000_000;
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, now: () => now, restAfterMs: 60_000, size: () => size });
  await boat.runShell('coder', { command: 'ls' });
  const [box] = b.machines.values();
  assert.equal(box.type, 'small', 'made at the chosen size');
  size = 'large';
  await boat.runShell('coder', { command: 'ls' });
  assert.equal(box.type, 'small', 'a running machine keeps its size');
  now += 120_000;
  await boat.restIdle();
  await boat.runShell('coder', { command: 'ls' });
  assert.equal(box.type, 'large', 'started again at the new size');
  assert.equal(b.machines.size, 1, 'the same machine, its files kept');
  size = 'xlarge'; // boat.dev won't make it now
  now += 120_000;
  await boat.restIdle();
  assert.equal((await boat.runShell('coder', { command: 'ls' })).code, 0, 'it starts at its old size');
  assert.equal(box.type, 'large');
  size = 'nonsense';
  now += 120_000;
  await boat.restIdle();
  await boat.runShell('coder', { command: 'ls' });
  assert.equal(box.type, 'default', 'what is no size is the default one');
});

test('the sizes say which ones boat.dev makes now, with its reason', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const sizes = await boatLib.sizes({ fetch: b.fetch, now: () => 5e12 });
  assert.deepEqual(sizes.map((s) => [s.id, s.available]), [['small', true], ['default', true], ['large', false], ['xlarge', false]]);
  assert.equal(sizes.find((s) => s.id === 'large').reason, 'not during the free trial');
  assert.deepEqual(Object.keys(sizes[0]).sort(), ['available', 'cpus', 'diskGB', 'id', 'memoryGB', 'perHour']);
});

test("an account's size is one of boat.dev's sizes, the default one until chosen", () => {
  const settings = require('../lib/settings').create(dir());
  assert.equal(settings.get().boatSize, 'default');
  assert.equal(settings.update({ boatSize: 'large' }).boatSize, 'large');
  assert.throws(() => settings.update({ boatSize: 'huge' }), /boatSize must be one of small, default, large, xlarge/);
  assert.equal(settings.get().boatSize, 'large');
});

test("a bot's machine is described as the owner sees it: not made yet, on, stopped, each at its size", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  let now = 0;
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, now: () => now, restAfterMs: 1000, size: () => 'small' });
  assert.deepEqual(boat.info('coder'), { state: 'none', size: 'small', text: 'boat.dev · 2 CPUs · 4 GB · not made yet' });
  await boat.runShell('coder', { command: 'ls' });
  assert.deepEqual(boat.info('coder'), { state: 'running', size: 'small', text: 'boat.dev · 2 CPUs · 4 GB · on' });
  now = 5000;
  await boat.restIdle();
  assert.equal(boat.info('coder').state, 'stopped');
  assert.equal(boat.info('coder').text, 'boat.dev · 2 CPUs · 4 GB · stopped');
});

// The Vault on the bot's machine (#560, ADR 092): the secret goes through the file API, never in a command.
test('a login reaches the command through a file of its own that goes before the command starts', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {} });
  const secret = "s3cr'et pass";
  const r = await boat.runWithLogin('coder', { command: 'git push', username: 'x-access-token', password: secret, timeoutSeconds: 60 });
  assert.equal(r.code, 0);
  const put = b.calls.find((c) => c.method === 'PUT');
  assert.match(put.body.path, /^\/tmp\/botdot-secret-[0-9a-f]{16}$/);
  assert.equal(Buffer.from(put.body.content, 'base64').toString(), "export BOTDOT_USERNAME='x-access-token'\nexport BOTDOT_PASSWORD='s3cr'\\''et pass'\n");
  const sent = b.calls.filter((c) => c.path.endsWith('/commands')).map((c) => c.body.command);
  assert.ok(sent.every((c) => !c.includes('s3cr')), 'no secret on a command line');
  assert.ok(sent[0].includes(`. ${put.body.path}; a=$?; rm -f -- ${put.body.path}; [ $a = 0 ] || exit 1; exec timeout -k 5 60 sh -c 'git push'`), 'read, removed, then the command');
  assert.equal(b.calls.find((c) => c.path.endsWith('/commands')).body.timeoutSeconds, 90, "boat.dev's limit leaves room after the command's");
});

test('several logins each get their variables, and a name that makes no variable runs nothing', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {} });
  await boat.runWithLogin('coder', { command: 'x', env: { BOTDOT_OVH_KEY_USERNAME: 'a', BOTDOT_OVH_KEY_PASSWORD: 'b' } });
  assert.equal(Buffer.from(b.calls.find((c) => c.method === 'PUT').body.content, 'base64').toString(), "export BOTDOT_OVH_KEY_USERNAME='a'\nexport BOTDOT_OVH_KEY_PASSWORD='b'\n");
  const before = b.calls.length;
  const r = await boat.runWithLogin('coder', { command: 'x', env: { 'A;rm': 'b' } });
  assert.match(r.error, /no variable/);
  assert.equal(b.calls.slice(before).filter((c) => c.method === 'PUT' || c.path.endsWith('/commands')).length, 0);
});

test('an SSH key goes into an ssh-agent of the command and its file before the command starts', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {} });
  const r = await boat.runWithSshKey('coder', { command: 'git push', privateKey: 'KEYDATA', timeoutSeconds: 30 });
  assert.equal(r.code, 0);
  const put = b.calls.find((c) => c.method === 'PUT');
  assert.equal(Buffer.from(put.body.content, 'base64').toString(), 'KEYDATA\n', 'ending in a newline, as ssh-add wants');
  const cmd = b.calls.find((c) => c.path.endsWith('/commands')).body.command;
  assert.ok(!cmd.includes('KEYDATA'));
  assert.ok(cmd.indexOf(`ssh-add -q ${put.body.path} 2>/dev/null; a=$?; rm -f -- ${put.body.path}`) < cmd.indexOf("timeout -k 5 30 sh -c 'git push'"));
  assert.match(cmd, /ssh-agent -k/, 'the agent ends with the command');
});

test('a file is there for the command alone and goes when it ends', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {} });
  const r = await boat.runWithFile('coder', { command: 'cat "$BOTDOT_FILE" | wc -c', fileName: 'key.pem', content: Buffer.from('PEM').toString('base64') });
  assert.equal(r.code, 0);
  const put = b.calls.find((c) => c.method === 'PUT');
  assert.equal(Buffer.from(put.body.content, 'base64').toString(), 'PEM');
  const cmd = b.calls.find((c) => c.path.endsWith('/commands')).body.command;
  assert.ok(cmd.includes(`BOTDOT_FILE=${put.body.path}.d/key.pem timeout`));
  assert.ok(cmd.trimEnd().endsWith(`rm -rf -- ${put.body.path}.d; exit $s`));
  await boat.runWithFile('coder', { command: 'x', fileName: '../etc/passwd', content: '' });
  assert.ok(b.calls.filter((c) => c.path.endsWith('/commands')).some((c) => /\.d\/file timeout/.test(c.body.command)), 'a name that is no file name is "file"');
});

test("a machine's name on boat.dev tells the account and the bot it belongs to", () => {
  assert.equal(boatLib.machineName('d9aa2f01', { account: 'alice', botName: 'Coder' }), 'botdot-alice-coder-d9aa2f01');
  assert.equal(boatLib.machineName('d9aa2f01', { account: 'alice', botName: 'Pan Łukasz & Co.' }), 'botdot-alice-pan-lukasz-co-d9aa2f01', 'only letters, digits and dashes');
  assert.equal(boatLib.machineName('d9aa2f01', { account: 'alice' }), 'botdot-alice-d9aa2f01');
  assert.equal(boatLib.machineName('d9aa2f01', {}), 'botdot-d9aa2f01', 'a single-account server');
  const long = boatLib.machineName('d9aa2f01', { account: 'alice', botName: 'x'.repeat(300) });
  assert.ok(long.length <= 120 && long.endsWith('-d9aa2f01'), "boat.dev's limit, the bot id kept");
});

test('a machine made under the old name takes the new one on its next start, by its id, its disk untouched', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const data = dir();
  let name = 'Coder';
  const first = boatLib.create(data, { fetch: b.fetch, sleep: async () => {}, account: 'alice', nameOf: () => name });
  await first.runShell('d9aa2f01', { command: 'ls' });
  const made = b.calls.find((c) => c.path === '/sandboxes' && c.method === 'POST');
  assert.equal(made.body.name, 'botdot-alice-coder-d9aa2f01');
  assert.equal(b.calls.filter((c) => c.method === 'PATCH').length, 0, 'a new machine is named when made');
  // An older botdot named it botdot-<bot id> and kept no name.
  const file = path.join(data, 'boat-machines.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = saved.d9aa2f01.id;
  delete saved.d9aa2f01.name;
  fs.writeFileSync(file, JSON.stringify(saved));
  b.machines.get(id).state = 'archived';
  const again = boatLib.create(data, { fetch: b.fetch, sleep: async () => {}, account: 'alice', nameOf: () => name });
  await again.runShell('d9aa2f01', { command: 'ls' });
  assert.equal(b.calls.filter((c) => c.path === '/sandboxes' && c.method === 'POST').length, 1, 'no new machine');
  const renamed = b.calls.filter((c) => c.method === 'PATCH' && c.body.name);
  assert.deepEqual(renamed.map((c) => [c.path, c.body.name]), [[`/sandboxes/${id}`, 'botdot-alice-coder-d9aa2f01']]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).d9aa2f01.name, 'botdot-alice-coder-d9aa2f01');
  // Renamed once; a bot that is renamed renames its machine on the next start.
  b.machines.get(id).state = 'archived';
  name = 'Writer';
  const third = boatLib.create(data, { fetch: b.fetch, sleep: async () => {}, account: 'alice', nameOf: () => name });
  await third.runShell('d9aa2f01', { command: 'ls' });
  assert.deepEqual(b.calls.filter((c) => c.method === 'PATCH' && c.body.name).map((c) => c.body.name), ['botdot-alice-coder-d9aa2f01', 'botdot-alice-writer-d9aa2f01']);
});

test("a refused rename doesn't stop the machine; it is tried again on the next start", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  const data = dir();
  const fetch = async (url, opts = {}) => (opts.method === 'PATCH' ? { ok: false, status: 400, json: async () => ({ ok: false, code: 'invalid_name' }) } : b.fetch(url, opts));
  const file = path.join(data, 'boat-machines.json');
  const first = boatLib.create(data, { fetch: b.fetch, sleep: async () => {}, account: '' });
  await first.runShell('d9aa2f01', { command: 'ls' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.d9aa2f01.name = 'botdot-d9aa2f01-old';
  fs.writeFileSync(file, JSON.stringify(saved));
  const again = boatLib.create(data, { fetch, sleep: async () => {}, account: 'alice', nameOf: () => 'Coder' });
  const r = await again.runShell('d9aa2f01', { command: 'ls' });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).d9aa2f01.name, 'botdot-d9aa2f01-old', 'kept, so the next start tries again');
});
