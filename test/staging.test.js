// make staging REF=<branch> (deploy/staging.sh): a self-built staging server moved to another branch.
// It runs in a copy of the script beside a stand-in installer, with stand-ins for git, docker, make and df.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'deploy', 'staging.sh');

function staging(t, { ref = 'feature-x', freeGb = 100, dirty = '', env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-staging-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'src');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'calls.log');
  fs.mkdirSync(path.join(src, 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(src, '.git'));
  fs.mkdirSync(bin);
  fs.copyFileSync(script, path.join(src, 'deploy', 'staging.sh'));
  fs.writeFileSync(path.join(src, 'install.sh'), `echo "install.sh BOT_DOT_IMAGE=$BOT_DOT_IMAGE BOT_DOT_COMPUTER_IMAGE=$BOT_DOT_COMPUTER_IMAGE" >> "${log}"\n`);
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub('git', `echo "git $*" >> "${log}"\ncase "$1" in status) printf '%s' '${dirty}' ;; rev-parse) echo abc1234 ;; esac`);
  stub('docker', `echo "${dir}"`);
  stub('make', `echo "make $*" >> "${log}"`);
  stub('df', `echo "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "/dev/sda1 0 0 ${freeGb * 1048576} 0% /"`);
  const args = ref === null ? [] : [ref];
  const r = spawnSync('sh', [path.join(src, 'deploy', 'staging.sh'), ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, BOT_DOT_DIR: dir, ...env },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { ...r, calls };
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
