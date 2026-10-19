// Shares of the machine on the admin page (#471, ADR 028): the admin sets the default share and one account's own,
// each asked of the machine with a request named as the account, which root's step applies; the page shows the
// machine's load and each account's use of its share, as root's step measured them (FRONT_DOOR_LOAD), and marks an
// account whose disk is full. Nothing of a share, a load or a use reaches an account.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const store = require('../lib/front-door/store');
const loadFiles = require('../lib/front-door/load');
const pages = require('../lib/front-door/pages');

let door, requests, load;
const stands = {};
const browsers = {};
before(async () => {
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  load = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-load-'));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_LOAD: load } });
  stands.ann = await standIn(door, 'ann', { answer: () => [200, { account: 'ann' }] });
  browsers.ann = await signUp('ann', door.firstLink);
  for (const name of ['bob', 'cat']) {
    stands[name] = await standIn(door, name, { answer: () => [200, { account: name }] });
    browsers[name] = await signUp(name, (await browsers.ann.post('/admin/links', {})).data.url);
    fs.rmSync(path.join(requests, name), { force: true });
  }
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  fs.rmSync(requests, { recursive: true, force: true });
  fs.rmSync(load, { recursive: true, force: true });
});

async function signUp(name, link) {
  const p = typeof link === 'string' ? new URL(link).pathname : link.path;
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, { name });
  const done = await b.post(p, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
const asked = (name) => fs.existsSync(path.join(requests, name));
const taken = () => { for (const f of fs.readdirSync(requests)) fs.rmSync(path.join(requests, f), { force: true }); };
const listed = async (name) => (await browsers.ann.get('/admin/accounts')).data.accounts.find((a) => a.name === name);
const write = (file, data) => fs.writeFileSync(path.join(load, file), JSON.stringify(data));

test('every account has the default share until the admin gives it its own', async () => {
  const r = await browsers.ann.get('/admin/share');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.share, store.DEFAULT_SHARE);
  for (const name of ['ann', 'bob', 'cat']) {
    const a = await listed(name);
    assert.deepEqual(a.share, store.DEFAULT_SHARE);
    assert.equal(a.ownShare, false);
  }
});

test('the admin sets the default share, and the machine is asked about every account that has it', async () => {
  taken();
  const own = await browsers.ann.post('/admin/accounts/cat/share', { cpu: 1, ram: 3, disk: 40 });
  assert.equal(own.status, 200, own.text);
  taken();
  const share = { cpu: 3, ram: 6, disk: 50 };
  const r = await browsers.ann.post('/admin/share', share);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.share, share);
  assert.deepEqual((await browsers.ann.get('/admin/share')).data.share, share);
  assert.ok(asked('ann') && asked('bob'), 'root\'s step applies it to them');
  assert.ok(!asked('cat'), 'cat keeps its own');
  assert.deepEqual((await listed('bob')).share, share);
  assert.deepEqual((await listed('cat')).share, { cpu: 1, ram: 3, disk: 40 });
  // Back to the default.
  taken();
  const back = await browsers.ann.post('/admin/accounts/cat/share', { default: true });
  assert.equal(back.status, 200, back.text);
  assert.deepEqual(back.data.share, share);
  assert.equal((await listed('cat')).ownShare, false);
  assert.ok(asked('cat'));
  taken();
});

test('the admin gives one account its own share, and the machine is asked about it alone', async () => {
  taken();
  const share = { cpu: 1, ram: 2, disk: 12 };
  const r = await browsers.ann.post('/admin/accounts/bob/share', share);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.share, share);
  assert.deepEqual(fs.readdirSync(requests), ['bob']);
  const bob = await listed('bob');
  assert.deepEqual(bob.share, share);
  assert.equal(bob.ownShare, true);
  // What root's step reads of it: the share in the front door's own data.
  const data = JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8'));
  assert.deepEqual(data.accounts.bob.share, share);
  taken();
});

test('a share that is not one is refused, and nothing is asked of the machine', async () => {
  taken();
  for (const bad of [{}, { cpu: 0, ram: 4, disk: 20 }, { cpu: 1.5, ram: 4, disk: 20 }, { cpu: 1, ram: 1, disk: 20 },
    { cpu: 1, ram: 4097, disk: 20 }, { cpu: 1, ram: 4, disk: 11 }, { cpu: '2', ram: 4, disk: 20 }]) {
    for (const route of ['/admin/share', '/admin/accounts/bob/share']) {
      const r = await browsers.ann.post(route, bad);
      assert.equal(r.status, 400, `${route} ${JSON.stringify(bad)}: ${r.text}`);
      assert.equal(r.data.error, store.SHARE_RULE);
    }
  }
  assert.deepEqual(fs.readdirSync(requests), []);
  assert.equal((await browsers.ann.post('/admin/accounts/zed/share', { cpu: 1, ram: 4, disk: 20 })).status, 404);
});

test("only the admin sets a share or sees the load, and an account's own sessions never do", async () => {
  for (const [method, route, body] of [['GET', '/admin/share'], ['POST', '/admin/share', { cpu: 64, ram: 64, disk: 900 }], ['POST', '/admin/accounts/bob/share', { cpu: 64, ram: 64, disk: 900 }]]) {
    const r = method === 'GET' ? await browsers.bob.get(route) : await browsers.bob.post(route, body);
    assert.equal(r.status, 404, `${route}: ${r.text}`);
  }
  assert.ok(!stands.bob.seen.some((s) => /share|admin/.test(s.url)), 'nothing of it reaches a botdot server');
  assert.notDeepEqual((await listed('bob')).share, { cpu: 64, ram: 64, disk: 900 });
});

test("the admin page shows the machine's load and each account's use of its share, as root's step measured them", async () => {
  const at = new Date().toISOString();
  write('machine.json', { at, cpus: 4, load: 1.5, ramTotal: 8e9, ramUsed: 3e9, diskTotal: 64e9, diskUsed: 20e9, extra: 'not passed on' });
  write('account-cat.json', { at, cpu: 0.4, ram: 2.5e9, computers: 1, diskSize: 32e9, diskUsed: 9e9, full: false, inside: 'nothing' });
  const r = await browsers.ann.get('/admin/share');
  assert.deepEqual(r.data.machine, { at, cpus: 4, load: 1.5, ramTotal: 8e9, ramUsed: 3e9, diskTotal: 64e9, diskUsed: 20e9 });
  assert.deepEqual((await listed('cat')).use, { at, cpu: 0.4, ram: 2.5e9, computers: 1, diskSize: 32e9, diskUsed: 9e9 });
  assert.equal((await listed('bob')).use, null, 'nothing measured of bob');

  // A full disk is marked.
  write('account-bob.json', { at, cpu: 0, ram: 1e9, computers: 0, diskSize: 12e9, diskUsed: 12e9, full: true });
  assert.equal((await listed('bob')).use.full, true);

  // A reading that is old is nothing.
  write('account-cat.json', { at: new Date(Date.now() - loadFiles.STALE_MS - 1000).toISOString(), cpu: 1 });
  assert.equal((await listed('cat')).use, null);

  // The page draws it.
  const page = await browsers.ann.get('/admin');
  assert.match(page.text, /<h2>The machine<\/h2>/);
  assert.match(page.text, /<form id="default-share"/);
});

test('the load files are read by name only, and an account name is the only file name taken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-load-'));
  try {
    const at = new Date().toISOString();
    fs.writeFileSync(path.join(dir, 'machine.json'), JSON.stringify({ at, cpus: 2 }));
    const read = loadFiles.create(dir);
    assert.equal(read.account('../machine'), null);
    assert.equal(read.account('machine'), null, 'an account named machine has a file of its own, not the machine\'s');
    assert.equal(loadFiles.create(null).machine(), null);
    fs.writeFileSync(path.join(dir, 'account-ann.json'), 'not json');
    assert.equal(read.account('ann'), null);
    fs.writeFileSync(path.join(dir, 'account-ann.json'), JSON.stringify({ at, cpu: -1, ram: 'a lot', full: 'yes' }));
    assert.deepEqual(read.account('ann'), { at }, 'only numbers, and full only when it is true');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a share has no computers at once (#108): an old store and an old admin page are read without it', async () => {
  // An older admin page still sends it: the share is taken without it.
  taken();
  const r = await browsers.ann.post('/admin/accounts/bob/share', { cpu: 2, ram: 4, computers: 3, disk: 20 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.share, { cpu: 2, ram: 4, disk: 20 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).accounts.bob.share, { cpu: 2, ram: 4, disk: 20 });
  taken();
  // A store written before it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-old-'));
  try {
    fs.writeFileSync(path.join(dir, 'front-door.json'), JSON.stringify({
      share: { cpu: 3, ram: 6, computers: 3, disk: 50 },
      accounts: { ann: { created: '2026-10-01T00:00:00.000Z' }, bob: { created: '2026-10-01T00:00:00.000Z', share: { cpu: 1, ram: 3, computers: 1, disk: 40 } } },
    }));
    const old = store.open(dir);
    assert.deepEqual(old.defaultShare(), { cpu: 3, ram: 6, disk: 50 });
    assert.deepEqual(old.listAccounts().map((a) => a.share), [{ cpu: 3, ram: 6, disk: 50 }, { cpu: 1, ram: 3, disk: 40 }]);
    assert.deepEqual(old.setAccountShare('ann', null), { cpu: 3, ram: 6, disk: 50 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // Nor does the admin page ask for it or show it.
  assert.doesNotMatch(pages.ADMIN_SCRIPT + pages.admin(), /at once|name="computers"|'computers'/i);
});

test('the admin page script draws a share and a use as text, and an account never sees a limit', () => {
  // It runs as it is in a browser.
  assert.doesNotThrow(() => new Function(pages.ADMIN_SCRIPT));
  assert.match(pages.ADMIN_SCRIPT, /'Disk full'|' Disk full'/);
  assert.doesNotMatch(pages.ADMIN_SCRIPT, /innerHTML/);
  // The pages an account's owner sees say nothing of a share.
  for (const html of [pages.signIn(), pages.signUp(), pages.making(), pages.starting(), pages.paused()]) {
    assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ''), /share|load|limit|quota|GB|CPU/i);
  }
});

test("the default RAM is half the machine's, at least 5 GB, once root's step measured it (#126)", () => {
  const GiB = 2 ** 30;
  assert.equal(store.defaultRam(null), store.DEFAULT_SHARE.ram, 'unknown: the fixed default');
  assert.equal(store.defaultRam(15.6 * GiB), 8, 'a 16 GB machine (as /proc/meminfo has it)');
  assert.equal(store.defaultRam(4 * GiB), 5, 'never below the fixed default');
  assert.equal(store.defaultRam(64 * GiB), 32);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-ram-'));
  try {
    fs.writeFileSync(path.join(dir, 'front-door.json'), JSON.stringify({ accounts: { ann: { created: '2026-10-01T00:00:00.000Z' } } }));
    let ram = null;
    const s = store.open(dir, { machineRam: () => ram });
    assert.deepEqual(s.defaultShare(), store.DEFAULT_SHARE);
    ram = 15.6 * GiB;
    assert.deepEqual(s.defaultShare(), { ...store.DEFAULT_SHARE, ram: 8 });
    assert.deepEqual(s.listAccounts()[0].share, { ...store.DEFAULT_SHARE, ram: 8 });
    // A default the admin set stays theirs.
    s.setDefaultShare({ cpu: 2, ram: 6, disk: 30 });
    assert.equal(s.defaultShare().ram, 6);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(pages.ADMIN_SCRIPT, /Near its RAM: its site may stall\. Give it more RAM\./);
});
