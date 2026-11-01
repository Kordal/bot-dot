// What no command of botdot's owns any more ends (ADR 131). deploy/desktop/botdot-sweep reads a stand-in /proc here, as
// it reads the computer's; test/computer-limits.test.js has botdot-run itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const SWEEP = path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-sweep');
const ROOT = process.getuid() === 0 ? {} : { skip: 'needs root to give the stand-in /proc its owners' };
const HZ = 100;

// A stand-in /proc: its processes as [pid, parent, user, name, started seconds after boot, argv].
function proc(t, list, uptime = 10_000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-proc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'uptime'), `${uptime} 0`);
  for (const [pid, parent, uid, name, started, argv] of list) {
    const d = path.join(dir, String(pid));
    fs.mkdirSync(d);
    const rest = Array(40).fill('0');
    rest[0] = 'S'; rest[1] = String(parent); rest[19] = String(started * HZ); rest[21] = '10';
    fs.writeFileSync(path.join(d, 'stat'), `${pid} (${name}) ${rest.join(' ')}`);
    fs.writeFileSync(path.join(d, 'cmdline'), (argv || [name]).join('\0'));
    fs.chownSync(d, uid, uid);
  }
  return dir;
}

test('a process with no botdot-run above it, old enough, of box or browser, is what gets ended', ROOT, (t) => {
  // box and browser are read from the passwd of the machine: tests run as root in an image without them use `daemon`.
  const source = fs.readFileSync(SWEEP, 'utf8').replace('USERS = ("box", "browser")', 'USERS = ("daemon",)').replace('os.kill(pid, sig)', 'pass');
  const uid = Number(childProcess.execFileSync('id', ['-u', 'daemon'], { encoding: 'utf8' }));
  const dir = proc(t, [
    [1, 0, uid, 'docker-init', 0],
    [7, 1, uid, 'sleep', 0, ['sleep', 'infinity']],
    [20, 1, uid, 'node', 1000, ['node', 'tsc', '--noEmit']], // left behind: this one ends
    [30, 1, uid, 'python3', 1000, ['python3', '-I', '-c', 'x', 'botdot-run', '--']],
    [31, 30, uid, 'sh', 1000, ['sh', '-c', 'server']], // under a live botdot-run
    [40, 1, 0, 'tailscaled', 1000], // root's
    [50, 1, uid, 'ssh-agent', 1000],
    [60, 1, uid, 'node', 9900, ['node', 'young']], // not old enough
  ]);
  const said = JSON.parse(childProcess.execFileSync('python3', ['-I', '-c', source, dir, '35', '0'], { encoding: 'utf8' }));
  assert.deepEqual(said.ended.map((p) => p.pid), [20]);
  assert.equal(said.ended[0].name, 'node');
  assert.ok(said.ended[0].minutes >= 150);
  assert.deepEqual(said.long, { count: 1, oldestSeconds: 9000 }, 'the botdot-run above counts as a long command');
});

test('every call that carries a command names its run for the helper, and a run id is all a helper takes for its end', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', 'lib', 'docker-helper.js'), 'utf8');
  for (const call of ['runShell', 'runWithLogin', 'runWithSshKey', 'runWithFile']) assert.match(helper, new RegExp(`case '${call}':.*'run'\\]\\) && runId\\(args\\[1\\]\\.run\\)`));
  assert.match(helper, /case 'endRun': return args\.length === 1 && typeof args\[0\] === 'string' && runId\(args\[0\]\)/);
});
