// A pull request that changes nothing the installer reads skips its tests (test/installer*.test.js: two thirds of the
// server tests' time, docs/decisions/2026-11-23-pr-skips-installer-tests.md). tests.yml's `changes` job says which with
// INSTALLER_PATHS. This file keeps that list from drifting: whatever the installer tests read or load, and whatever
// install.yml watches, is in it. The file's name does not start with "installer": it is never one of those left out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseYaml } = require('./workflow-runners');
const { testFiles, skipsInstaller } = require('./run');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

const tests = parseYaml(fs.readFileSync(path.join(WORKFLOWS, 'tests.yml'), 'utf8'));
const which = tests.jobs.changes.steps.find((st) => st.id === 'which');

// The lines of INSTALLER_PATHS, as the workflow's grep -E reads them (these use only what JavaScript reads the same).
const filterLines = () => {
  const list = /INSTALLER_PATHS='([^']*)'/.exec(which.run);
  assert.ok(list, 'tests.yml: the changes job has INSTALLER_PATHS');
  return list[1].split('\n').map((l) => l.trim()).filter(Boolean);
};
const matcher = () => { const res = filterLines().map((l) => new RegExp(l)); return (file) => res.some((re) => re.test(file)); };

// Every file of the repository that is not generated or another app's: what a glob in a workflow can match.
function repoFiles(dir = '', out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (['.git', 'node_modules', 'android', 'ios', 'site', 'desktop'].includes(e.name) && !dir) continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) repoFiles(rel, out); else out.push(rel);
  }
  return out;
}
const globRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);

test('the changes job gives the installer output: true on every event but a pull request, false for a change it does not read', () => {
  assert.equal(tests.jobs.changes.outputs.installer, '${{ steps.which.outputs.installer }}');
  assert.match(which.run, /else\s+PHONES=true INSTALLER=true\s+fi/, 'a call from a workflow, and a run by hand, run every test');
  assert.match(which.run, /INSTALLER=false/);
  // The pull request's own step, run on a diff.
  const run = (files) => {
    const script = which.run.replace('git diff --name-only HEAD^1 HEAD', `printf '%s\\n' ${files.map((f) => `'${f}'`).join(' ')}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-changes-'));
    try {
      const out = path.join(dir, 'out');
      const r = spawnSync('bash', ['-eo', 'pipefail', '-c', script], { env: { PATH: process.env.PATH, EVENT: 'pull_request', GITHUB_OUTPUT: out }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  assert.equal(run(['lib/jobs.js', 'public/app.js', 'docs/api.md']).installer, 'false');
  assert.equal(run(['lib/jobs.js', 'install.sh']).installer, 'true');
  assert.equal(run(['lib/front-door/store.js']).installer, 'true');
  assert.equal(run(['test/installer-keys.test.js']).installer, 'true');
  assert.equal(run(['android/app/build.gradle.kts']).installer, 'false');
  assert.equal(run(['lib/jobs.js']).server, 'true', 'the rest of the filter is as it was');
  // The one that is not a pull request.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-changes-'));
  try {
    const out = path.join(dir, 'out');
    const r = spawnSync('bash', ['-eo', 'pipefail', '-c', which.run], { env: { PATH: process.env.PATH, EVENT: 'workflow_call', SERVER: 'true', ANDROID: 'true', GITHUB_OUTPUT: out }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(out, 'utf8'), /^installer=true$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the server tests leave the installer's out exactly when `changes` says it is not needed", () => {
  const step = tests.jobs['server-tests'].steps.find((st) => /npm test/.test(st.run || ''));
  assert.equal(step.env.BOT_DOT_SKIP_INSTALLER_TESTS, "${{ needs.changes.outputs.installer != 'true' && '1' || '' }}");
  assert.match(step.run, /--test-shard=\$\{\{ matrix\.shard \}\}\/4/, 'the shards still split what is left');
});

test('every path install.yml watches is in the installer filter', () => {
  const watched = parseYaml(fs.readFileSync(path.join(WORKFLOWS, 'install.yml'), 'utf8')).on.pull_request.paths;
  assert.ok(watched.length > 10, watched.join(', '));
  const files = repoFiles();
  const inFilter = matcher();
  for (const glob of watched) {
    const hit = files.filter((f) => globRe(glob).test(f));
    assert.ok(hit.length, `${glob} in install.yml matches no file`);
    for (const f of hit) assert.ok(inFilter(f), `${f} (${glob} in install.yml) is not in INSTALLER_PATHS of tests.yml`);
  }
  assert.ok(inFilter('.github/workflows/tests.yml'));
});

test('every file the installer tests read, and every one install.sh runs, is in the installer filter', () => {
  const inFilter = matcher();
  const sources = fs.readdirSync(__dirname).filter((n) => /^installer.*\.js$/.test(n) || n === 'helpers.js').map((n) => `test/${n}`);
  const must = new Set(['install.sh', 'test/linux.js', 'test/run.js', 'test/helpers.js', 'test/fixtures/fake-docker.js', '.dockerignore', 'Dockerfile', 'compose.yaml', 'compose.front-door.yaml', 'front-door.js', 'package.json']);
  for (const f of sources) must.add(f);

  // A file read by name: path.join(ROOT, 'a', 'b'), path.join(__dirname, '..', 'a'), read('a').
  // (A file's own read(f) counts when it is the one of the repository: `const read = (f) => fs.readFileSync(path.join(ROOT, f)`.)
  for (const f of sources.filter((s) => s.startsWith('test/installer'))) {
    const own = /const read = \(f\) => fs\.readFileSync\(path\.join\(ROOT, f\)/.test(read(f));
    const named = new RegExp(`path\\.join\\((?:ROOT|__dirname, '\\.\\.')((?:, '[^']+')+)\\)${own ? "|\\bread\\('([^']+)'\\)" : ''}`, 'g');
    for (const m of read(f).matchAll(named)) {
      const rel = m[2] || [...m[1].matchAll(/'([^']+)'/g)].map((p) => p[1]).join('/');
      if (/\.[a-z]+$/.test(rel) && !rel.includes('$')) must.add(rel);
    }
  }

  // What install.sh runs on the repository's own source, out of comments: through the image (/opt/bot-dot/…, image_file),
  // in the release check (check_node, mounted from lib/), by the key check (take_key LIB, loaded as ./lib/LIB).
  const code = read('install.sh').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const entries = new Set();
  for (const m of code.matchAll(/(?:image_file |\/opt\/bot-dot\/)((?:lib|deploy)\/[\w./-]+\.(?:js|sh))/g)) must.add(m[1]);
  for (const m of code.matchAll(/image_file ([\w./-]+\.(?:js|sh|yaml))/g)) must.add(m[1]);
  for (const m of code.matchAll(/check_node ([\w-]+\.js)/g)) entries.add(`lib/${m[1]}`);
  for (const m of code.matchAll(/take_key ([\w-]+) /g)) entries.add(`lib/${m[1]}.js`);
  for (const m of code.matchAll(/for f in ([\w -]+); do\s*\n\s*image_file "lib\/\$f\.js"/g)) for (const n of m[1].split(' ')) entries.add(`lib/${n}.js`);
  for (const m of code.matchAll(/(?:^|\s)((?:lib)\/[\w-]+\.js)/gm)) entries.add(m[1]);
  // What the tests load themselves.
  for (const f of sources) for (const m of read(f).matchAll(/require\('\.\.\/(lib\/[\w./-]+)'\)/g)) entries.add(m[1].endsWith('.js') ? m[1] : `${m[1]}.js`);
  assert.ok(entries.has('lib/signed-image.js') && entries.has('lib/boat.js') && entries.has('lib/image-layers.js'), [...entries].join(', '));

  // Each is loaded as the installer runs it (from the repository's root), and what it loads in turn is the same.
  for (const entry of entries) {
    assert.ok(fs.existsSync(path.join(ROOT, entry)), `${entry} is named by the installer but is not in the repository`);
    const r = spawnSync(process.execPath, ['-e', "require('./' + process.argv[1]); console.log(JSON.stringify(Object.keys(require.cache)))", entry], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, `${entry} does not load: ${r.stderr}`);
    for (const abs of JSON.parse(r.stdout)) {
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (!rel.startsWith('..') && !rel.startsWith('node_modules')) must.add(rel);
    }
  }
  for (const f of must) {
    assert.ok(f === 'test/run.js' || fs.existsSync(path.join(ROOT, f)), `${f} is read by the installer's tests but is not in the repository`);
    assert.ok(inFilter(f), `${f} is read or loaded by the installer's tests but is not in INSTALLER_PATHS of tests.yml`);
  }
});

test('the filter does not hold what the installer tests never touch (a pull request that changes it should be quick)', () => {
  const inFilter = matcher();
  for (const f of ['server.js', 'lib/jobs.js', 'lib/routes/bots.js', 'public/app.js', 'test/jobs.test.js', 'docs/api.md', 'CONTEXT.md', 'whats-new/x.md']) assert.equal(inFilter(f), false, f);
});

test('BOT_DOT_SKIP_INSTALLER_TESTS leaves the installer files out of what npm test runs, and nothing else', () => {
  const all = testFiles({});
  assert.deepEqual(all, { files: ['test/*.test.js', 'tests/*.test.js'], left: 0 }, 'by default, everything');
  for (const off of ['', '0']) assert.equal(skipsInstaller({ BOT_DOT_SKIP_INSTALLER_TESTS: off }), false, JSON.stringify(off));
  assert.equal(skipsInstaller({ BOT_DOT_SKIP_INSTALLER_TESTS: '1' }), true);

  const installer = fs.readdirSync(__dirname).filter((n) => /^installer.*\.test\.js$/.test(n));
  assert.ok(installer.length >= 14, installer.join(', '));
  const some = testFiles({ BOT_DOT_SKIP_INSTALLER_TESTS: '1' });
  assert.equal(some.left, installer.length);
  assert.equal(some.files.some((f) => /\/installer[^/]*\.test\.js$/.test(f)), false);
  const everyone = [...fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).map((n) => `test/${n}`), ...fs.readdirSync(path.join(ROOT, 'tests')).filter((n) => n.endsWith('.test.js')).map((n) => `tests/${n}`)];
  assert.deepEqual([...some.files].sort(), everyone.filter((f) => !/^test\/installer/.test(f)).sort(), 'every other test file stays, and this one with them');
  assert.ok(some.files.includes('test/ci-installer-filter.test.js'));
});

test('npm test says which files it left out, runs the rest, and keeps --test-shard working', () => {
  // A scratch repository with three test files, one of them the installer's: the real run.js, on it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-run-'));
  try {
    fs.mkdirSync(path.join(dir, 'test')); fs.mkdirSync(path.join(dir, 'tests'));
    fs.copyFileSync(path.join(__dirname, 'run.js'), path.join(dir, 'test', 'run.js'));
    fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), "require('node:test').test('a', () => { console.log('RAN a'); });\n");
    fs.writeFileSync(path.join(dir, 'test', 'b.test.js'), "require('node:test').test('b', () => { console.log('RAN b'); });\n");
    fs.writeFileSync(path.join(dir, 'test', 'installer-x.test.js'), "require('node:test').test('x', () => { console.log('RAN installer-x'); });\n");
    const run = (env, ...args) => spawnSync(process.execPath, [path.join(dir, 'test', 'run.js'), ...args], { cwd: dir, env: { ...process.env, NODE_TEST_CONTEXT: undefined, ...env }, encoding: 'utf8' });
    const on = run({ BOT_DOT_SKIP_INSTALLER_TESTS: '1' });
    assert.equal(on.status, 0, on.stdout + on.stderr);
    assert.match(on.stdout, /The installer tests \(1 files, test\/installer\*\.test\.js\) are left out/);
    assert.match(on.stdout, /RAN a/); assert.match(on.stdout, /RAN b/);
    assert.doesNotMatch(on.stdout, /RAN installer-x/);
    const off = run({ BOT_DOT_SKIP_INSTALLER_TESTS: '' });
    assert.equal(off.status, 0, off.stdout + off.stderr);
    assert.doesNotMatch(off.stdout, /left out/);
    assert.match(off.stdout, /RAN installer-x/);
    // A shard of what is left (two files, so two shards here; CI uses four): the shards together run the same files, once each.
    const ran = [1, 2].map((n) => { const r = run({ BOT_DOT_SKIP_INSTALLER_TESTS: '1' }, `--test-shard=${n}/2`); assert.equal(r.status, 0, r.stdout + r.stderr); return [...r.stdout.matchAll(/RAN (\S+)/g)].map((m) => m[1]); });
    assert.deepEqual(ran.flat().sort(), ['a', 'b']);
    assert.equal(ran[0].length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
