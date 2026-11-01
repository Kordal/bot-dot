// A command's limits (ADR 131): deploy/desktop/botdot-run runs here for real, on this machine's own processes, with
// what it reads of them from /proc. There are no cgroups per command under gVisor, so a command's memory is added up
// from its processes and the time is counted here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { waitFor } = require('./helpers');

const RUN = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-run'), 'utf8');
const LINUX = { skip: process.platform !== 'linux' && 'reads /proc' };
const alive = (pid) => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { return false; } };
const pidsIn = (text) => (text.match(/\d+/g) || []).map(Number);
function start(flags, argv) {
  const child = childProcess.spawn('python3', ['-I', '-c', RUN, 'botdot-run', ...flags, '--', ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const ended = new Promise((resolve) => child.on('close', (code) => resolve({ code, out, err })));
  return { child, ended, out: () => out };
}
// A process that holds about `mb` megabytes, also when it is started in the background.
const HOG = (mb) => `python3 -c "b=bytearray(${mb}*1024*1024); import time; time.sleep(60)"`;

test('a memory hog is stopped by its cap with all it started, and says why', LINUX, async () => {
  const r = start(['--memory', String(50e6), '--grace', '0.3'], ['sh', '-c', `setsid sleep 60 & echo $!; ${HOG(120)}`]);
  await waitFor(() => pidsIn(r.out()).length === 1);
  const [pid] = pidsIn(r.out());
  const { code, err } = await r.ended;
  assert.equal(code, 137);
  assert.match(err, /stopped: this command used more than 0\.1 GB of memory/);
  assert.ok(!alive(pid), 'what it left in the background ended too');
});

test('its memory is what all its processes hold together', LINUX, async () => {
  const { code } = await start(['--memory', String(100e6), '--grace', '0.3'], ['sh', '-c', `${HOG(60)} & ${HOG(60)} & wait`]).ended;
  assert.equal(code, 137);
});

test('a command under its cap ends as it did', LINUX, async () => {
  const { code, err } = await start(['--memory', String(1e9)], ['sh', '-c', 'sleep 2.5; exit 4']).ended;
  assert.equal(code, 4);
  assert.equal(err, '');
});

test('a run that outlives --seconds is stopped by it', LINUX, async () => {
  const { code, err } = await start(['--seconds', '1', '--grace', '0.3'], ['sh', '-c', 'sleep 60']).ended;
  assert.equal(code, 137);
  assert.match(err, /ran for more than 1 seconds/);
});

// Claude Code runs its commands as shells of their own, each in a process group of its own, and goes on after one ends.
const PROGRAM = (shell) => ['python3', '-c', `import subprocess,sys,time
p = subprocess.Popen(['sh', '-c', ${JSON.stringify(shell)}], stderr=subprocess.PIPE, start_new_session=True)
other = subprocess.Popen(['sleep', '60'])
print(p.pid, other.pid, flush=True)
p.wait()
print(p.stderr.read().decode(), flush=True)
print('still here', flush=True)
other.kill()`];

test('with --commands the limits end one command, it is told so, and the program goes on', LINUX, async () => {
  const r = start(['--seconds', '1', '--grace', '0.3', '--commands', '^sh '], PROGRAM('setsid sleep 60 & echo $!; sleep 60'));
  const { code, out, err } = await r.ended;
  assert.equal(code, 0);
  assert.match(out, /stopped: this command ran for more than 1 seconds/, 'the bot reads it where it reads the command');
  assert.match(out, /still here/);
  assert.match(err, /stopped:/);
});

test('with --commands a process that lost its parent counts as a command', LINUX, async () => {
  const r = start(['--memory', String(50e6), '--grace', '0.3', '--commands', '^nothing'], ['sh', '-c', `sh -c '${HOG(120)} & echo $!'; sleep 8; echo done`]);
  await waitFor(() => pidsIn(r.out()).length >= 1);
  const [pid] = pidsIn(r.out());
  await waitFor(() => !alive(pid), { timeout: 7000 });
  const { code, out } = await r.ended;
  assert.equal(code, 0);
  assert.match(out, /done/);
});
