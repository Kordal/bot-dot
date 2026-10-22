// make staging REF=<branch> (deploy/staging.sh): a self-built staging server moved to another branch.
// It runs in a copy of the script beside a stand-in installer, with stand-ins for git, docker, make and df.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'deploy', 'staging.sh');

// A stand-in for the machine's Docker: an image store in a file. It logs what changes the store (tag, rm,
// builder prune) and refuses, as Docker does without force, to remove an image a container uses or a bare id
// that has more than one name. `docker __build REF` is what the stand-in make images does for each image.
const dockerStub = `#!${process.execPath}
const fs = require('node:fs');
const [store, log] = [process.env.STUB_STORE, process.env.STUB_DOCKER_LOG];
const s = JSON.parse(fs.readFileSync(store, 'utf8'));
const save = () => fs.writeFileSync(store, JSON.stringify(s));
const a = process.argv.slice(2);
const byRef = (r) => s.images.find((i) => i.id === r || i.tags.includes(r));
const repo = (t) => t.slice(0, t.lastIndexOf(':'));
const flag = (n) => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
if (a[0] === 'info') { console.log(process.env.STUB_DIR); process.exit(0); }
if (a[0] === 'image' && a[1] === 'inspect') { const i = byRef(a.at(-1)); if (!i) process.exit(1); console.log(i.id); process.exit(0); }
if (a[0] === 'image' && a[1] === 'ls') {
  const filters = []; a.forEach((x, k) => { if (x === '--filter') filters.push(a[k + 1]); });
  const only = a.length > 2 && !a.at(-1).startsWith('-') && a.at(-2) !== '--filter' && a.at(-2) !== '--format' ? a.at(-1) : null;
  let rows = s.images;
  if (filters.includes('dangling=true')) rows = rows.filter((i) => !i.tags.length);
  if (filters.includes('label=dev.botdot.self-built=true')) rows = rows.filter((i) => i.self);
  if (only) { for (const i of rows) for (const t of i.tags) if (repo(t) === only) console.log(t + ' ' + i.id); process.exit(0); }
  for (const i of rows) console.log(i.id);
  process.exit(0);
}
if (a[0] !== '__build') fs.appendFileSync(log, 'docker ' + a.join(' ') + '\\n');
if (a[0] === 'tag') { const i = byRef(a[1]); for (const o of s.images) o.tags = o.tags.filter((t) => t !== a[2]); i.tags.push(a[2]); save(); process.exit(0); }
if (a[0] === 'image' && a[1] === 'rm') {
  const r = a[2]; const i = byRef(r);
  if (!i) process.exit(1);
  if (i.tags.includes(r) && i.tags.length > 1) { i.tags = i.tags.filter((t) => t !== r); save(); process.exit(0); }
  if (i.id === r && i.tags.length > 1) process.exit(1);
  if (s.used.includes(i.id)) process.exit(1);
  s.images = s.images.filter((x) => x !== i); save(); process.exit(0);
}
if (a[0] === '__build') {
  s.n = (s.n || 0) + 1;
  for (const o of s.images) o.tags = o.tags.filter((t) => t !== a[1]);
  // Docker's containerd image store drops the image a build took the name of, unless another name holds it.
  if (process.env.STUB_DROPS_REPLACED) s.images = s.images.filter((o) => o.tags.length || !o.self || s.used.includes(o.id) || /old|used/.test(o.id));
  s.images.push({ id: 'sha256:' + repo(a[1]).replace(/\\W/g, '') + '-b' + s.n, tags: [a[1]], self: true }); save(); process.exit(0);
}
`;

// What the machine's Docker holds before a deploy: the running images, their previous ones, an earlier build's
// nameless leftover, a stopped bot's computer from an older build, and images that are not botdot's.
const machine = () => ({
  images: [
    { id: 'sha256:server-1', tags: ['bot-dot/server:latest'], self: true },
    { id: 'sha256:server-0', tags: ['bot-dot/server:previous'], self: true },
    { id: 'sha256:server-old', tags: [], self: true },
    { id: 'sha256:desktop-1', tags: ['bot-dot/desktop:latest'], self: true },
    { id: 'sha256:desktop-0', tags: ['bot-dot/desktop:previous'], self: true },
    { id: 'sha256:desktop-used', tags: [], self: true },
    { id: 'sha256:foreign', tags: ['nginx:latest'], self: false },
    { id: 'sha256:foreign-nameless', tags: [], self: false },
  ],
  used: ['sha256:desktop-used'],
});

function staging(t, { ref = 'feature-x', freeGb = 100, dirty = '', env = {}, images = machine(), buildFails = false, installFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-staging-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'src');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'calls.log');
  const dockerLog = path.join(dir, 'docker.log');
  const store = path.join(dir, 'docker.json');
  fs.mkdirSync(path.join(src, 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(src, '.git'));
  fs.mkdirSync(bin);
  fs.writeFileSync(store, JSON.stringify(images));
  fs.copyFileSync(script, path.join(src, 'deploy', 'staging.sh'));
  fs.writeFileSync(path.join(src, 'install.sh'), `echo "install.sh BOT_DOT_IMAGE=$BOT_DOT_IMAGE BOT_DOT_COMPUTER_IMAGE=$BOT_DOT_COMPUTER_IMAGE" >> "${log}"\n${installFails ? 'exit 1\n' : ''}`);
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub('git', `echo "git $*" >> "${log}"\ncase "$1" in status) printf '%s' '${dirty}' ;; rev-parse) echo abc1234 ;; esac`);
  fs.writeFileSync(path.join(bin, 'docker'), dockerStub, { mode: 0o755 });
  stub('make', `echo "make $*" >> "${log}"\n${buildFails ? 'exit 2' : 'for a; do case "$a" in *_IMAGE=*) docker __build "\${a#*=}" ;; esac; done'}`);
  stub('df', `echo "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "/dev/sda1 0 0 ${freeGb * 1048576} 0% /"`);
  const args = ref === null ? [] : [ref];
  const r = spawnSync('sh', [path.join(src, 'deploy', 'staging.sh'), ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, BOT_DOT_DIR: dir, STUB_DIR: dir, STUB_STORE: store, STUB_DOCKER_LOG: dockerLog, ...env },
  });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
  const after = JSON.parse(fs.readFileSync(store, 'utf8'));
  const named = Object.fromEntries(after.images.flatMap((i) => i.tags.map((tag) => [tag, i.id])));
  return { ...r, calls: read(log), docker: read(dockerLog), ids: after.images.map((i) => i.id).sort(), named };
}

test('staging takes the branch, builds both images and installs them, in that order', (t) => {
  const { status, calls, stdout } = staging(t);
  assert.equal(status, 0);
  assert.deepEqual(calls, [
    'git status --porcelain --untracked-files=no',
    'git fetch origin',
    'git checkout feature-x',
    'git pull --ff-only origin feature-x',
    'git rev-parse --short HEAD',
    'make images SERVER_IMAGE=bot-dot/server:latest COMPUTER_IMAGE=bot-dot/desktop:latest',
    'install.sh BOT_DOT_IMAGE=bot-dot/server:latest BOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest',
  ]);
  assert.match(stdout, /Building feature-x at abc1234/);
  assert.doesNotMatch(stdout, /Warning/);
});

test('staging without a branch says how to name one and does nothing', (t) => {
  const { status, stderr, calls } = staging(t, { ref: null });
  assert.equal(status, 1);
  assert.match(stderr, /make staging REF=<branch>/);
  assert.deepEqual(calls, []);
});

test('too little free disk stops staging before git or the build', (t) => {
  const { status, stderr, calls } = staging(t, { freeGb: 10 });
  assert.equal(status, 1);
  assert.match(stderr, /Only 10 GB free on .*at least 15 GB/);
  assert.deepEqual(calls, []);
});

test('little free disk warns and goes on; the limits can be set', (t) => {
  const low = staging(t, { freeGb: 20 });
  assert.equal(low.status, 0);
  assert.match(low.stdout, /Warning: only 20 GB free/);
  const set = staging(t, { freeGb: 20, env: { STAGING_MIN_GB: '30' } });
  assert.equal(set.status, 1);
  assert.match(set.stderr, /at least 30 GB/);
});

test('a checkout with changes of its own is not moved', (t) => {
  const { status, stderr, calls } = staging(t, { dirty: ' M server.js' });
  assert.equal(status, 1);
  assert.match(stderr, /changes of its own/);
  assert.deepEqual(calls, ['git status --porcelain --untracked-files=no']);
});

test('after a deploy the running and the previous image stay, older ones of botdot go, the cache is trimmed', (t) => {
  const { status, stdout, ids, named, docker } = staging(t);
  assert.equal(status, 0);
  assert.deepEqual(named, {
    'bot-dot/server:latest': 'sha256:botdotserver-b1',
    'bot-dot/server:previous': 'sha256:server-1',
    'bot-dot/desktop:latest': 'sha256:botdotdesktop-b2',
    'bot-dot/desktop:previous': 'sha256:desktop-1',
    'nginx:latest': 'sha256:foreign',
  });
  // The previous previous and the earlier nameless build go; a stopped computer's image and foreign ones stay.
  assert.deepEqual(ids, ['sha256:botdotdesktop-b2', 'sha256:botdotserver-b1', 'sha256:desktop-1', 'sha256:desktop-used', 'sha256:foreign', 'sha256:foreign-nameless', 'sha256:server-1']);
  assert.ok(docker.includes('docker builder prune --all --force --keep-storage 15gb'));
  assert.ok(!docker.some((c) => /system prune|image prune|-f(orce)? sha|rm -f|rm --force/.test(c)), docker.join('\n'));
  assert.match(stdout, /^Removed 3 old images and trimmed the build cache to 15 GB: 0\.0 GB freed\./m);
});

test('five deploys in a row leave the same images each time: two of each of botdot\'s, and the rest untouched', (t) => {
  let images = machine();
  const counts = [];
  for (let n = 0; n < 5; n++) {
    const run = staging(t, { images });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.ids.filter((id) => /server/.test(id)).length, 2);
    assert.equal(run.ids.filter((id) => /desktop/.test(id) && id !== 'sha256:desktop-used').length, 2);
    for (const id of ['sha256:desktop-used', 'sha256:foreign', 'sha256:foreign-nameless']) assert.ok(run.ids.includes(id), id);
    counts.push(run.ids.length);
    // The next deploy starts from what this one left; its builds get new ids.
    images = { images: run.ids.map((id) => ({ id, tags: Object.keys(run.named).filter((tag) => run.named[tag] === id), self: !/foreign/.test(id) })), used: ['sha256:desktop-used'], n: 2 * (n + 1) };
  }
  assert.deepEqual(counts, [7, 7, 7, 7, 7]);
});

test('the build cache limit can be set', (t) => {
  const { status, docker, stdout } = staging(t, { env: { STAGING_CACHE_GB: '6' } });
  assert.equal(status, 0);
  assert.ok(docker.includes('docker builder prune --all --force --keep-storage 6gb'));
  assert.match(stdout, /build cache to 6 GB/);
});

test('a failed build or a failed install removes no image and no cache, and keeps the running one named', (t) => {
  for (const fail of [{ buildFails: true }, { installFails: true }]) {
    const { status, docker, named, ids } = staging(t, fail);
    assert.notEqual(status, 0);
    assert.deepEqual(docker, ['docker tag bot-dot/server:latest bot-dot/server:before-deploy', 'docker tag bot-dot/desktop:latest bot-dot/desktop:before-deploy']);
    assert.equal(named['bot-dot/server:previous'], 'sha256:server-0');
    assert.equal(named['bot-dot/desktop:previous'], 'sha256:desktop-0');
    assert.equal(named['bot-dot/server:before-deploy'], 'sha256:server-1');
    for (const id of ['sha256:server-1', 'sha256:server-old', 'sha256:desktop-1', 'sha256:desktop-used']) assert.ok(ids.includes(id), id);
  }
});

test('after a failed deploy the next one keeps what ran before it as previous, not the build that failed', (t) => {
  const failed = machine();
  failed.images.find((i) => i.id === 'sha256:server-1').tags = ['bot-dot/server:before-deploy'];
  failed.images.push({ id: 'sha256:server-failed', tags: ['bot-dot/server:latest'], self: true });
  const { status, named, ids, docker } = staging(t, { images: failed });
  assert.equal(status, 0);
  assert.ok(!docker.includes('docker tag bot-dot/server:latest bot-dot/server:before-deploy'));
  assert.equal(named['bot-dot/server:previous'], 'sha256:server-1');
  assert.ok(!ids.includes('sha256:server-failed'));
});

test('a Docker whose build drops the image it renamed still keeps the one that ran as previous', (t) => {
  const { status, named } = staging(t, { env: { STUB_DROPS_REPLACED: '1' } });
  assert.equal(status, 0);
  assert.equal(named['bot-dot/server:previous'], 'sha256:server-1');
  assert.equal(named['bot-dot/desktop:previous'], 'sha256:desktop-1');
  assert.equal(named['bot-dot/server:before-deploy'], undefined);
});

test('the first deploy, with no images yet, keeps the new ones and tags no previous', (t) => {
  const { status, named, docker } = staging(t, { images: { images: [], used: [] } });
  assert.equal(status, 0);
  assert.deepEqual(Object.keys(named).sort(), ['bot-dot/desktop:latest', 'bot-dot/server:latest']);
  assert.ok(!docker.some((c) => c.startsWith('docker tag')));
});
