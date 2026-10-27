const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { executeFs } = require('../lib/principal-fs-worker');
test('principal files retain binary data and reject another principal or escaping links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'principal-files-'));
  try {
    const dir = path.join(root, 'workspaces', 'alice'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'private');
    executeFs(root, 'alice', 'writeFileSync', [file, Buffer.from([0, 255]), { mode: 0o600 }]);
    assert.deepEqual(executeFs(root, 'alice', 'readFileSync', [file]), Buffer.from([0, 255]));
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'escape'));
    assert.throws(() => executeFs(root, 'alice', 'readFileSync', [path.join(dir, 'escape', 'secret')]), { code: 'EACCES' });
    assert.throws(() => executeFs(root, 'alice', 'readFileSync', [path.join(root, 'workspaces', 'bob', 'secret')]), { code: 'EACCES' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
const { spawn, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { createPrincipalFs } = require('../lib/principal-fs');
const worker = path.resolve(__dirname, '../lib/principal-fs-worker.js');
function transport(root) {
  // Exercise the real worker boundary. Root-run Linux CI deliberately drops to
  // nobody; developer machines already have an unprivileged UID.
  const identity = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
  if (identity.uid) fs.chownSync(root, identity.uid, identity.gid);
  return {
    callSync(op, { principal, request }) {
      const requestFile = path.join(os.tmpdir(), `principal-request-${process.pid}-${Math.random()}`);
      fs.writeFileSync(requestFile, JSON.stringify({ root, principal, ...request }), { mode: 0o600, flag: 'wx' });
      const fd = fs.openSync(requestFile, 'r');
      fs.unlinkSync(requestFile);
      let result;
      try {
        result = spawnSync(process.execPath, [worker], { ...identity, stdio: ['ignore', 'pipe', 'pipe', fd], encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
      } finally { fs.closeSync(fd); }
      if (result.error) throw result.error;
      return JSON.parse(result.stdout);
    },
    spawnFsStream({ principal, op, args }) {
      const child = spawn(process.execPath, [worker], { ...identity, stdio: ['pipe','pipe','pipe','pipe'] });
      child.stdio[3].end(JSON.stringify({ root, principal, op, args }));
      return child;
    },
  };
}
test('filesystem facade preserves stat, dirent and binary semantics and streams files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'principal-facade-'));
  const api = createPrincipalFs({ dataDir: root, client: transport(root), enabled: true });
  try {
    const dir = path.join(root, 'homes', 'alice'); api.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'private');
    api.writeFileSync(file, Buffer.from([0, 255]), { mode: 0o600 });
    assert.equal(api.statSync(file).isFile(), true);
    assert.equal(api.statSync(file).mode & 0o777, 0o600);
    assert.equal(api.readdirSync(dir, { withFileTypes: true })[0].isFile(), true);
    assert.deepEqual(api.readFileSync(file), Buffer.from([0, 255]));
    assert.throws(() => api.chmodSync(file, 0o4755), { code: 'EACCES' });
    const big = path.join(dir, 'streamed');
    await pipeline(Readable.from((function* () { for (let i = 0; i < 64; i++) yield Buffer.alloc(65536, 42); })()), api.createWriteStream(big, { mode: 0o600 }));
    let size = 0;
    for await (const chunk of api.createReadStream(big)) { assert.equal(chunk[0], 42); size += chunk.length; }
    assert.equal(size, 4194304);
    await assert.rejects(async () => { for await (const chunk of api.createReadStream(path.join(dir, 'missing'))) void chunk; });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Chief workspace and cross-principal attachments preserve identity scope and private modes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'principal-copy-'));
  const api = createPrincipalFs({ dataDir: root, client: transport(root), enabled: true });
  try {
    const from = path.join(root, 'workspaces', '_chief', 'proposal');
    const to = path.join(root, 'workspaces', 'alice', 'proposal');
    api.mkdirSync(path.dirname(from), { recursive: true });
    api.mkdirSync(path.dirname(to), { recursive: true });
    api.writeFileSync(from, 'private proposal', { mode: 0o600 });
    assert.throws(() => api.readFileSync(path.dirname(from) + '/../../../server-secret'), { code: 'EACCES' });
    api.copyFileSync(from, to);
    assert.equal(api.readFileSync(to, 'utf8'), 'private proposal');
    assert.equal(api.statSync(to).mode & 0o777, 0o600);
    assert.throws(() => api.copyFileSync(from, to, fs.constants.COPYFILE_EXCL), { code: 'EEXIST' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preparing a workspace drops an empty git repository at its top and writes the git identity in the home, as its principal', { skip: spawnSync('git', ['--version']).error?.code === 'ENOENT' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'principal-git-'));
  const api = createPrincipalFs({ dataDir: root, client: transport(root), enabled: true });
  try {
    const dir = path.join(root, 'workspaces', 'alice');
    const home = path.join(root, 'homes', 'alice');
    fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(home, { recursive: true });
    if (process.getuid?.() === 0) for (const d of [path.join(root, 'workspaces'), dir, path.join(root, 'homes'), home]) fs.chownSync(d, 65534, 65534);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    if (process.getuid?.() === 0) spawnSync('chown', ['-R', '65534:65534', dir]);
    const identity = { file: path.join(home, '.botdot-gitconfig'), content: '[user]\n\tname = "Alice"\n' };
    api.prepareWorkspace(dir, identity);
    assert.equal(api.existsSync(path.join(dir, '.git')), false, 'the empty repository is gone');
    assert.equal(api.readFileSync(identity.file, 'utf8'), identity.content);
    assert.equal(api.statSync(identity.file).uid, process.getuid() === 0 ? 65534 : process.getuid());
    assert.throws(() => api.prepareWorkspace(dir, { file: path.join(root, 'homes', 'bob', '.botdot-gitconfig'), content: 'x' }), { code: 'EACCES' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('the workspace file manager lists a folder and counts what it holds in one call each, never following a link (#296)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'principal-list-'));
  const api = createPrincipalFs({ dataDir: root, client: transport(root), enabled: true });
  try {
    const dir = path.join(root, 'workspaces', 'alice');
    api.mkdirSync(path.join(dir, 'b-folder', 'inner'), { recursive: true });
    api.writeFileSync(path.join(dir, 'b-folder', 'inner', 'x.txt'), 'x');
    api.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    api.writeFileSync(path.join(dir, 'file10.txt'), '');
    api.writeFileSync(path.join(dir, 'file9.txt'), '');
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'z-link'));
    const listed = api.listDirSync(dir, 3);
    assert.equal(listed.total, 5);
    assert.deepEqual(listed.entries.map((e) => [e.name, e.type]), [['b-folder', 'folder'], ['a.txt', 'file'], ['file9.txt', 'file']]);
    assert.equal(listed.entries[1].size, 5);
    assert.ok(listed.entries[1].mtimeMs > 0);
    assert.equal(api.listDirSync(dir, 10).entries.at(-1).type, 'link');
    assert.deepEqual(api.countTreeSync(dir, 100), { files: 5, folders: 2, capped: false });
    assert.equal(api.countTreeSync(dir, 3).capped, true);
    assert.throws(() => api.listDirSync(path.join(dir, 'z-link'), 10), { code: 'EACCES' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('the Files view walks a tree for a copy and reads a small picture in one call each, never following a link (#603)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'principal-walk-'));
  const api = createPrincipalFs({ dataDir: root, client: transport(root), enabled: true });
  try {
    const dir = path.join(root, 'workspaces', 'alice');
    api.mkdirSync(path.join(dir, 'b', 'inner'), { recursive: true });
    api.writeFileSync(path.join(dir, 'b', 'inner', 'x.txt'), 'x');
    api.writeFileSync(path.join(dir, 'a.png'), 'png');
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'z-link'));
    const all = api.walkTreeSync(dir, 100);
    assert.deepEqual(all.entries.map((e) => [e.rel, e.type]), [['a.png', 'file'], ['b', 'folder'], ['z-link', 'link'], ['b/inner', 'folder'], ['b/inner/x.txt', 'file']]);
    assert.equal(all.capped, false);
    assert.equal(api.walkTreeSync(dir, 2).capped, true);
    assert.equal(api.listDirSync(dir, 10).entries.find((e) => e.name === 'b').items, 1);
    assert.deepEqual(api.readSmallSync(path.join(dir, 'a.png'), 10), { size: 3, data: Buffer.from('png').toString('base64') });
    assert.deepEqual(api.readSmallSync(path.join(dir, 'a.png'), 2), { size: 3 });
    assert.equal(api.readSmallSync(path.join(dir, 'b'), 10), null);
    assert.throws(() => api.readSmallSync(path.join(dir, 'z-link', 'x'), 10), { code: 'EACCES' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
