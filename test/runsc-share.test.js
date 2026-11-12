// The runtime an account's Docker runs gVisor through (install.sh runsc_share, ADR 152): as a sandbox is made, runsc
// sees the share's RAM as the machine's and runs on the share's CPUs; every other call is runsc as it is. Run here with
// stand-ins for runsc, unshare, mount and taskset that write down what they were asked.
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('reads /proc/meminfo')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = fs.readFileSync(path.join(__dirname, '..', 'install.sh'), 'utf8');
const wrapper = /^runsc_share\(\) \{\n  cat > "\$1\.new" <<'SCRIPT'\n([\s\S]*?)\nSCRIPT\n/m.exec(script)[1];
const machineKb = Number(/^MemTotal:\s+(\d+)/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]);
const allowed = /^Cpus_allowed_list:\s+(\S+)/m.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1]
  .split(',').flatMap((r) => { const [a, b = a] = r.split('-').map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); });

function run(t, share, args, { unshare = true } = {}) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-runsc-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const bin = path.join(top, 'bin');
  const dir = path.join(top, 'accounts', 'ann', 'share');
  const tmp = path.join(top, 'tmp');
  const log = path.join(top, 'log');
  for (const d of [bin, dir, tmp]) fs.mkdirSync(d, { recursive: true });
  const stand = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
  stand('runsc', 'exit 0');
  stand('taskset', 'shift 2; exec "$@"');
  stand('mount', `cat "$2" >> "${log}"`);
  if (unshare) stand('unshare', '[ "$1" = -m ] && shift; exec "$@"');
  else stand('unshare', 'exit 1');
  fs.writeFileSync(path.join(dir, 'runsc'), wrapper.replace('@RUNSC@', path.join(bin, 'runsc')), { mode: 0o755 });
  if (share) fs.writeFileSync(path.join(dir, 'share.json'), JSON.stringify(share));
  const done = spawnSync(path.join(dir, 'runsc'), args, { env: { PATH: `${bin}:/usr/bin:/bin`, TMPDIR: tmp }, encoding: 'utf8' });
  assert.equal(done.status, 0, done.stderr);
  return { lines: fs.readFileSync(log, 'utf8').trim().split('\n'), left: fs.readdirSync(tmp) };
}

test("a sandbox is made seeing the share's RAM as the machine's, on as many CPUs as the share", (t) => {
  const { lines, left } = run(t, { cpu: 1, ram: 1 }, ['--ignore-cgroups', 'create', '--bundle', '/b', 'id1']);
  assert.ok(lines.includes('unshare -m true'), lines.join('\n'));
  assert.ok(lines.some((l) => /^mount --bind \S+ \/proc\/meminfo$/.test(l)), lines.join('\n'));
  assert.ok(lines.includes('MemTotal:       1048576 kB'), 'the share\'s GB, in kB as /proc/meminfo has it');
  assert.ok(lines.some((l) => /^MemFree:/.test(l)), 'the rest of /proc/meminfo is kept');
  const pinned = lines.find((l) => l.startsWith('taskset '));
  assert.match(pinned, /^taskset -c \d+ /);
  assert.ok(allowed.includes(Number(pinned.split(' ')[2])), 'one of the CPUs it may run on');
  assert.equal(lines.at(-1), 'runsc --ignore-cgroups create --bundle /b id1');
  assert.deepEqual(left, [], 'the file goes once it is mounted');
});

test('any other call is runsc as it is', (t) => {
  for (const args of [['--root', '/r', 'state', 'id1'], ['exec', 'id1', 'ls'], ['--version']]) {
    assert.deepEqual(run(t, { cpu: 1, ram: 1 }, args).lines, [`runsc ${args.join(' ')}`]);
  }
});

test('a share no smaller than the machine, or none, leaves the sandbox as runsc sizes it', (t) => {
  const big = run(t, { cpu: allowed.length, ram: Math.ceil(machineKb / 1048576) }, ['create', 'id1']);
  assert.deepEqual(big.lines.filter((l) => !l.startsWith('unshare -m true')), ['runsc create id1']);
  assert.deepEqual(big.left, []);
  assert.deepEqual(run(t, null, ['create', 'id1']).lines, ['runsc create id1']);
});

test("without a mount namespace of its own runsc still runs, on the share's CPUs", (t) => {
  const { lines, left } = run(t, { cpu: 1, ram: 1 }, ['create', 'id1'], { unshare: false });
  assert.ok(!lines.some((l) => l.startsWith('mount ')));
  assert.match(lines.find((l) => l.startsWith('taskset ')), /^taskset -c \d+ \S+\/runsc create id1$/);
  assert.equal(lines.at(-1), 'runsc create id1');
  assert.deepEqual(left, []);
});

