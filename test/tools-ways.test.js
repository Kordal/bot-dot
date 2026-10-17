// The two ways of installing a registry tool (lib/tools-worker.js install(), ADR 007): every file copied from a
// cache in the container, and, only after the data folder refused that copy (a Mac's disk shared into Docker),
// hard links from a cache on the data folder that is gone when the install ends. The worker is started as the
// tests' own user, with the stand-in for micromamba (fixtures/fake-micromamba.js), which refuses the copy when
// told to and hard-links from its cache as the real one does. The real micromamba runs both ways in tools-real.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const worker = require('../lib/tools-worker');

let dir, data, cache, micromamba;
const onData = () => path.join(data, 'tools', '.cache');
const folder = (bot) => path.join(data, 'tools', bot);
const steer = (how) => fs.writeFileSync(path.join(cache, 'fake.json'), JSON.stringify(how));
const installs = () => (fs.existsSync(path.join(cache, 'calls.jsonl')) ? fs.readFileSync(path.join(cache, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []).filter((c) => !c.args.includes('--dry-run'));
const walk = (at) => fs.readdirSync(at, { withFileTypes: true }).flatMap((e) => [path.join(at, e.name), ...(e.isDirectory() ? walk(path.join(at, e.name)) : [])]);
const marker = (bot, tool) => JSON.parse(fs.readFileSync(path.join(folder(bot), tool, worker.MARKER), 'utf8'));
const approvedAt = () => new Date().toISOString();

// One operation of the worker, as the tests' installer starts it (lib/tools.js): its answer.
function work(operation, payload) {
  return new Promise((resolve, reject) => {
    const checked = worker.request(operation, payload, { root: data, cache, micromamba });
    if (checked.op === 'install') fs.mkdirSync(folder(checked.bot), { recursive: true, mode: 0o750 });
    const child = worker.spawn(checked);
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => { out += text; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', () => { try { resolve(JSON.parse(out)); } catch (e) { reject(e); } });
  });
}
const listOf = async (name) => (await work('toolResolve', { name })).list;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-tools-ways-'));
  data = path.join(dir, 'data');
  cache = path.join(dir, 'tools-cache');
  fs.mkdirSync(path.join(data, 'tools'), { recursive: true });
  fs.mkdirSync(cache);
  micromamba = path.join(dir, 'micromamba');
  fs.writeFileSync(micromamba, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, 'fixtures', 'fake-micromamba.js')}" "$@"\n`, { mode: 0o755 });
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a data folder that takes the copy gets one install, the first way, and no cache of its own', async () => {
  // What an install that was stopped left on the data folder goes with the next one.
  fs.mkdirSync(path.join(onData(), 'pkgs', 'left'), { recursive: true });
  const done = await work('toolInstall', { principal: 'bot1', tool: 'gh', list: await listOf('gh'), approvedAt: approvedAt() });
  assert.deepEqual({ ok: done.ok, commands: done.commands, way: done.way }, { ok: true, commands: ['gh'], way: 'copy' });
  const [call, ...more] = installs();
  assert.deepEqual(more, [], 'one install');
  assert.ok(call.args.includes('--always-copy'));
  assert.equal(call.env.MAMBA_ROOT_PREFIX, path.join(cache, 'mamba'), 'the cache is not in the data folder');
  assert.equal(marker('bot1', 'gh').way, 'copy');
  assert.ok(!fs.existsSync(onData()));
});

test('a refused copy is tried again with hard links from a cache on the data folder, and that cache is gone afterwards', async () => {
  const list = await listOf('jq');
  const before = installs().length;
  steer({ refuse: 'copy' });
  const done = await work('toolInstall', { principal: 'bot1', tool: 'jq', list, approvedAt: approvedAt() });
  steer({});
  assert.deepEqual({ ok: done.ok, version: done.version, commands: done.commands, way: done.way }, { ok: true, version: '1.8.2', commands: ['jq'], way: 'links' });

  // The first way first, as on a Docker volume; the second only after its copy was refused.
  const [first, second, ...more] = installs().slice(before);
  assert.deepEqual(more, []);
  const prefix = path.join(folder('bot1'), 'jq');
  const common = ['--skip-run-link-scripts', '--safety-checks', 'enabled', '--extra-safety-checks'];
  assert.deepEqual(first.args.slice(7), ['--skip-run-link-scripts', '--always-copy', '--safety-checks', 'enabled', '--extra-safety-checks']);
  assert.equal(first.env.MAMBA_ROOT_PREFIX, path.join(cache, 'mamba'));
  assert.deepEqual(second.args.slice(0, 5), ['create', '-y', '--no-rc', '-p', prefix], 'at the same fixed place');
  assert.deepEqual(second.args.slice(7), common, 'the same checks, and no --always-copy: hard links');
  assert.equal(second.env.MAMBA_ROOT_PREFIX, onData(), 'its cache is on the data folder, where a hard link can be made');
  assert.equal(second.env.HOME, path.join(cache, 'home'), 'its home stays where it was');
  for (const call of [first, second]) assert.deepEqual(call.list, ['@EXPLICIT', ...list.map((p) => `${p.url}#sha256:${p.sha256}`)], 'exactly the approved list, both times');
  assert.deepEqual(Object.keys(second.env).filter((k) => !['PWD', 'OLDPWD', 'SHLVL', '_', '__CF_USER_TEXT_ENCODING'].includes(k)).sort(), ['HOME', 'LANG', 'MAMBA_ROOT_PREFIX', 'PATH'], 'the same four names, no secret');

  // The cache is gone, so nothing of the tool is linked to anything any more and nothing is left to back up.
  assert.ok(!fs.existsSync(onData()), 'no cache stays on the data folder');
  assert.deepEqual(fs.readdirSync(path.join(data, 'tools')).sort(), ['bot1']);
  const files = walk(prefix).filter((f) => fs.lstatSync(f).isFile());
  assert.ok(files.length >= 5);
  for (const f of files) assert.equal(fs.lstatSync(f).nlink, 1, `${f} is still linked to another file`);
  assert.ok(!fs.existsSync(path.join(prefix, 'bin', 'half')), 'nothing of the refused first try is left');
  assert.equal(fs.statSync(path.join(prefix, 'bin', 'jq')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(prefix, 'lib', 'libgomp.so.1')).mode & 0o777, 0o644);
  assert.equal(execFileSync(path.join(folder('bot1'), 'bin', 'jq'), ['--version'], { encoding: 'utf8' }).trim(), 'jq of jq 1.8.2 (botdot test tool)');
  assert.equal(marker('bot1', 'jq').way, 'links', 'the folder records how it was placed');
  assert.equal(execFileSync(path.join(folder('bot1'), 'bin', 'gh'), ['--version'], { encoding: 'utf8' }).trim(), 'gh of gh 2.101.0 (botdot test tool)', 'the tool placed the first way is untouched');
});

test('when the second way fails too, its reason is given and nothing is left of either try', async () => {
  const list = await listOf('tree');
  const state = () => walk(folder('bot1')).sort();
  const before = state();
  steer({ refuse: 'copy', fail: 'links' });
  const failed = await work('toolInstall', { principal: 'bot1', tool: 'tree', list, approvedAt: approvedAt() });
  steer({});
  assert.deepEqual(failed.error, { message: 'critical libmamba filesystem error: cannot create hard link: Operation not supported', cause: 'other' });
  assert.deepEqual(state(), before, "the bot's folder is as it was");
  assert.ok(!fs.existsSync(onData()), 'and no cache stays on the data folder');
});

test('a failure that is not a refused copy is not tried a second way', async () => {
  const list = await listOf('tree');
  const before = installs().length;
  steer({ fail: 'disk' });
  const failed = await work('toolInstall', { principal: 'bot1', tool: 'tree', list, approvedAt: approvedAt() });
  steer({});
  assert.deepEqual(failed.error, { message: 'The disk is full.', cause: 'disk' });
  assert.equal(installs().length - before, 1, 'one try');
  assert.ok(!fs.existsSync(onData()));
});

test('an install that ended well is done, whatever it printed: it is not made again the second way', async () => {
  const before = installs().length;
  steer({ mention: 'copy' });
  const done = await work('toolInstall', { principal: 'bot1', tool: 'tree', list: await listOf('tree'), approvedAt: approvedAt() });
  steer({});
  assert.deepEqual({ ok: done.ok, way: done.way }, { ok: true, way: 'copy' });
  assert.equal(installs().length - before, 1, 'one install');
});

test('removing tools also removes a cache that a stopped install left on the data folder', async () => {
  fs.mkdirSync(path.join(onData(), 'pkgs', 'left'), { recursive: true });
  const keep = [{ tool: 'gh', list: marker('bot1', 'gh').list }];
  assert.deepEqual((await work('toolRemove', { principal: 'bot1', keep })).removed.sort(), ['jq', 'tree']);
  assert.ok(!fs.existsSync(onData()));
  assert.deepEqual(fs.readdirSync(folder('bot1')).sort(), ['bin', 'gh']);
});
