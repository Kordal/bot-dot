// Storage (docs/api.md, Storage): Settings shows what the account's files take on the disk, in groups, with the
// folders and files worth showing and the largest files. One walk counts a folder (lib/storage-walk.js on botdot,
// deploy/desktop/botdot-sizes on the computer: the same answer), a check runs in the background and is kept, a delete
// through Files takes its file out of the last check at once, and only the owner clears the caches.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, makeBot, waitFor } = require('./helpers');
const { sizeTree, } = require('../lib/storage-walk');
const { takeOut } = require('../lib/storage');

const SIZES = path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-sizes');
const MB = 1024 * 1024;
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes, 1)); };

function sample() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-storage-'));
  write(path.join(dir, 'big.bin'), 3 * MB);
  write(path.join(dir, 'node_modules', 'a', 'lib.js'), 2 * MB);
  write(path.join(dir, 'node_modules', 'b', 'tiny.js'), 10);
  write(path.join(dir, 'notes.md'), 100);
  fs.symlinkSync('/etc', path.join(dir, 'link'));
  return dir;
}

test('a walk answers the size, the folders and files worth showing, and the largest files, never following a link', (t) => {
  const dir = sample();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = sizeTree(dir);
  assert.ok(r.bytes >= 5 * MB, `${r.bytes}`);
  assert.equal(r.files, 5, 'the link is counted as an entry, never walked');
  assert.deepEqual(r.kids.map((k) => k.name), ['big.bin', 'node_modules']);
  const nm = r.kids[1];
  assert.equal(nm.dir, true);
  assert.deepEqual(nm.kids.map((k) => k.name), ['a'], 'a folder under 1 MB is left out');
  assert.ok(nm.rest > 0, 'what is left out is its rest');
  assert.deepEqual(r.largest.map((f) => f.path).slice(0, 2), ['big.bin', 'node_modules/a/lib.js']);
  assert.equal(r.capped, false);
  assert.equal(sizeTree(dir, { cap: 2 }).capped, true);
  assert.deepEqual(sizeTree(dir, { skip: ['node_modules'] }).kids.map((k) => k.name), ['big.bin']);
  assert.equal(sizeTree(path.join(dir, 'none')).missing, true);
});

test('the computer\'s walk (botdot-sizes) answers the same as botdot\'s', (t) => {
  const dir = sample();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const py = JSON.parse(execFileSync('python3', ['-I', SIZES, dir, path.join(dir, 'none')], { encoding: 'utf8' }));
  assert.deepEqual(py[dir], sizeTree(dir));
  assert.equal(py[path.join(dir, 'none')].missing, true);
});

test('a node taken out of a tree makes every node on its way smaller', () => {
  const tree = { bytes: 10, kids: [{ name: 'a', bytes: 8, dir: true, kids: [{ name: 'b', bytes: 5, dir: false }] }] };
  const gone = takeOut(tree, 'a/b');
  assert.equal(gone.name, 'b');
  assert.equal(tree.bytes, 5);
  assert.equal(tree.kids[0].bytes, 3);
  assert.deepEqual(tree.kids[0].kids, []);
  assert.equal(takeOut(tree, 'a/none'), null);
});

let srv; let bot;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Researcher', emoji: '🔎' });
});
after(async () => { await srv.stop(); });

const checked = async (fresh = false) => {
  if (fresh) await srv.api('/storage/check', { method: 'POST' });
  let view;
  await waitFor(async () => { view = (await srv.api('/storage')).data; return !view.checking && view.checkedAt; }, 20_000);
  return view;
};
const group = (v, id) => v.groups.find((g) => g.id === id);

test('Storage groups the account\'s files: a bot\'s folder, its uploads, its caches, the runs; largest first', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('storage'));
  const ws = path.join(srv.data, 'workspaces', bot.id);
  write(path.join(ws, 'reports', 'big.bin'), 4 * MB);
  write(path.join(ws, 'uploads', 'photo.jpg'), 2 * MB);
  write(path.join(srv.data, 'homes', bot.id, '.cache', 'pip', 'wheel.whl'), 3 * MB);
  write(path.join(srv.data, 'homes', bot.id, '.claude', 'session.jsonl'), 2 * MB);
  const v = await checked(true);
  assert.deepEqual(v.groups.map((g) => g.id), ['computer', 'bots', 'projects', 'uploads', 'chats', 'caches', 'other']);
  assert.equal(v.total, v.groups.reduce((n, g) => n + g.bytes, 0));
  const mine = group(v, 'bots').kids.find((k) => k.bot === bot.id);
  assert.equal(mine.name, 'Researcher');
  assert.deepEqual(mine.place, { bot: bot.id, root: 'server' });
  assert.equal(mine.path, '');
  assert.ok(!mine.kids.some((k) => k.name === 'uploads'), 'uploads are a group of their own');
  const up = group(v, 'uploads').kids.find((k) => k.bot === bot.id);
  assert.equal(up.path, 'uploads');
  assert.ok(up.bytes >= 2 * MB);
  const caches = group(v, 'caches');
  assert.ok(caches.bytes >= 3 * MB);
  assert.deepEqual(caches.kids[0].kids.map((k) => k.name), ['.cache/pip']);
  assert.ok(group(v, 'chats').bytes >= 2 * MB, 'a bot\'s home without its caches is its chats');
  assert.equal(v.largest[0].name, 'big.bin');
  assert.deepEqual(v.largest[0].place, { bot: bot.id, root: 'server' });
  assert.equal(v.largest[0].path, 'reports/big.bin');
  assert.equal(v.largest[0].owner, 'Researcher');
  assert.equal(v.computer, 'none');
});

test('a file deleted through Files leaves the last check at once', async () => {
  const before = await checked();
  const bots = group(before, 'bots').bytes;
  const r = await srv.api(`/bots/${bot.id}/workspace?path=${encodeURIComponent('reports/big.bin')}`, { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const v = (await srv.api('/storage')).data;
  assert.equal(v.checkedAt, before.checkedAt, 'no new check');
  assert.ok(!v.largest.some((f) => f.path === 'reports/big.bin'));
  assert.ok(group(v, 'bots').bytes <= bots - 4 * MB);
});

test('the Chief reads Storage and asks for a check; only the owner clears the caches, which empties them', async () => {
  const chief = await srv.asChief('/storage');
  assert.equal(chief.status, 200);
  assert.ok(Array.isArray(chief.data.groups));
  assert.equal((await srv.asChief('/storage/check', { method: 'POST' })).status, 202);
  await checked();
  assert.equal((await srv.asChief('/storage/clear-caches', { method: 'POST' })).status, 403);
  const r = await srv.api('/storage/clear-caches', { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.freed >= 3 * MB);
  assert.equal(group(r.data, 'caches').bytes, 0);
  assert.equal(fs.existsSync(path.join(srv.data, 'homes', bot.id, '.cache', 'pip')), false);
  assert.ok(fs.existsSync(path.join(srv.data, 'homes', bot.id, '.claude', 'session.jsonl')), 'only the caches go');
  const audit = fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(audit.some((l) => l.action === 'storage.caches-cleared'));
});
