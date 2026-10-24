// What a command, a screen or a program leaves on the account's computer ends with it (#535). After five days a
// computer held 1189 processes on no bot's screen: PID 1 was `sleep`, which reaps nothing, and the end of a screen
// ended only the programs it named. deploy/desktop/botdot-run runs here for real, on this machine's own processes, as
// it does around every command of botdot's in the computer; lib/computer-leftovers.js finds what is left anyway.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const util = require('node:util');
const childProcess = require('node:child_process');
const { startServer, makeBot, waitFor } = require('./helpers');
const leftovers = require('../lib/computer-leftovers');

const RUN = path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A process that runs: there, and not a zombie.
function alive(pid) {
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { return false; }
}
// The processes under `pid`: [pid, state] of each child.
function childrenOf(pid) {
  const out = [];
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const [state, ppid] = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ');
      if (Number(ppid) === pid) out.push([Number(p), state]);
    } catch { /* gone */ }
  }
  return out;
}
// botdot-run as lib/computers.js runs it: its own copy with python3 -c, named first.
const reaped = (flags, command) => ['-I', '-c', fs.readFileSync(RUN, 'utf8'), 'botdot-run', ...flags, '--', 'sh', '-c', command];
function start(flags, command, env = {}) {
  const child = childProcess.spawn('python3', reaped(flags, command), { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const ended = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, out })));
  return { child, ended, out: () => out };
}
const pidsIn = (text) => text.trim().split(/\s+/).filter(Boolean).map(Number);

test('a command ends as it did, its exit code passed on', async () => {
  assert.equal((await start([], 'exit 3').ended).code, 3);
  assert.equal((await start([], 'kill -TERM $$').ended).code, 128 + 15);
});

test('a process whose parent died comes to botdot-run, which reaps it as it ends: no zombie stays behind', async (t) => {
  // The inner shell starts a short sleep and ends at once: the sleep's parent is gone, and it ends 0.6 s later.
  const r = start([], 'sh -c "sleep 0.6 & echo \\$!"; sleep 1.5');
  t.after(() => r.child.kill('SIGKILL'));
  await waitFor(() => pidsIn(r.out()).length === 1);
  const [orphan] = pidsIn(r.out());
  await sleep(200);
  assert.deepEqual(childrenOf(r.child.pid).find(([pid]) => pid === orphan), [orphan, 'S'], 'it came to botdot-run');
  await sleep(800);
  assert.ok(!fs.existsSync(`/proc/${orphan}`), 'ended and reaped, not a zombie');
  assert.equal((await r.ended).code, 0);
});

test('what a command leaves running ends with it, also with setsid or nohup', async () => {
  const { code, out } = await start([], 'setsid sleep 60 & echo $!; nohup sleep 61 >/dev/null 2>&1 & echo $!; (sleep 62 &) ; sleep 0.2').ended;
  assert.equal(code, 0);
  const pids = pidsIn(out);
  assert.equal(pids.length, 2);
  for (const pid of pids) assert.ok(!alive(pid), `${pid} ended with the command`);
});

test('a command that runs out of time ends with what it started, setsid included', async () => {
  const r = childProcess.spawnSync('timeout', ['-k', '5', '1', 'python3', ...reaped([], 'setsid sleep 60 & echo $!; sleep 60')], { encoding: 'utf8' });
  assert.equal(r.status, 124);
  const [pid] = pidsIn(r.stdout);
  assert.ok(pid && !alive(pid), 'the setsid child is gone');
});

test('with --keep it stays while what it started runs, and a SIGTERM ends it all', async () => {
  const r = start(['--keep', '--screen', '97'], 'setsid sleep 60 & echo $!');
  await waitFor(() => pidsIn(r.out()).length === 1);
  const [pid] = pidsIn(r.out());
  await sleep(300);
  assert.equal(r.child.exitCode, null, 'it waits for the program');
  assert.ok(alive(pid));
  r.child.kill('SIGTERM');
  const ended = await r.ended;
  assert.notEqual(ended.code, null);
  assert.ok(!alive(pid), 'the program is gone');
});

test('100 short programs on one screen leave no zombie and no process behind', async () => {
  // Each cycle starts a program that forks and lets its first process go, as a browser's helpers do. Then all that is
  // under botdot-run is the command itself: no zombie, and nothing left of the 100.
  const r = start(['--keep'], 'for i in $(seq 1 100); do sh -c "sleep 0.05 & sleep 0.01 &"; done; sleep 0.5; ps -o stat= --ppid $PPID');
  const { code, out } = await r.ended;
  assert.equal(code, 0);
  assert.deepEqual(out.trim().split('\n').map((l) => l.trim()[0]), ['S'], 'only the command, and no zombie');
});

// ---------- the end of a screen: lib/computers.js STOP_SCREEN ----------

// computers.js takes execFile when it loads: once with a stand-in, to read the script a screen's rest runs as root.
function loadComputers() {
  const calls = [];
  const fake = (file, args, opts, cb) => { calls.push(args); setImmediate(() => cb(null, '', '')); return { stdin: { on() {}, end() {} } }; };
  fake[util.promisify.custom] = async (file, args) => {
    calls.push(args);
    return { stdout: args[0] === 'inspect' ? '"running"|"bot-dot/desktop:latest"|"sha256:image"' : '', stderr: '' };
  };
  const real = childProcess.execFile;
  childProcess.execFile = fake;
  delete require.cache[require.resolve('../lib/computers')];
  const computers = require('../lib/computers');
  childProcess.execFile = real;
  delete require.cache[require.resolve('../lib/computers')];
  return { computers, calls };
}

test("start_program's program carries its screen and runs under botdot-run --keep", async () => {
  const { computers, calls } = loadComputers();
  await computers.startProgram({ bot: 'scout', screen: 87 }, 'python3 -m http.server 8080');
  const a = calls.find((x) => x[0] === 'exec');
  assert.ok(a.includes('SCREEN=97') && a.includes('DISPLAY=:97'));
  const at = a.indexOf('botdot-run');
  assert.deepEqual(a.slice(at + 1, at + 5), ['--keep', '--screen', '97', '--']);
  assert.equal(a.at(-1), 'python3 -m http.server 8080');
});

test("a screen that rests or ends takes its programs with it, setsid included; a bot's command goes on", async (t) => {
  const { computers, calls } = loadComputers();
  await computers.restScreen({ bot: 'scout', screen: 87 });
  const rest = calls.find((x) => x[0] === 'exec' && x.includes('sh'));
  const script = rest[rest.indexOf('-c') + 1];
  assert.deepEqual(rest.slice(rest.indexOf('-c') + 2), ['sh', '97', 'scout']);

  // A program start_program started, with what it left in a session of its own; one more of the screen's, not under
  // botdot-run (as on a screen started before #535); and a bot's command on the same display.
  const program = start(['--keep', '--screen', '97'], 'setsid sleep 60 & echo $!', { SCREEN: '97', DISPLAY: ':97' });
  const stray = childProcess.spawn('sleep', ['61'], { env: { ...process.env, SCREEN: '97' }, stdio: 'ignore' });
  const command = childProcess.spawn('sleep', ['62'], { env: { ...process.env, DISPLAY: ':97' }, stdio: 'ignore' });
  t.after(() => { for (const c of [program.child, stray, command]) c.kill('SIGKILL'); });
  await waitFor(() => pidsIn(program.out()).length === 1);
  const [left] = pidsIn(program.out());

  const r = childProcess.spawnSync('sh', ['-c', script, 'sh', '97', 'scout'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  await program.ended;
  assert.ok(!alive(left), "the program's own child is gone");
  await waitFor(() => !alive(stray.pid));
  assert.ok(alive(command.pid), "the bot's command, which carries only the display, goes on");
});

// ---------- lib/computer-leftovers.js ----------

const other = (processes, cpuPercent = 0) => ({ state: 'running', other: { processes, cpuPercent, memoryBytes: processes * 4e5, zombies: processes - 2, top: [{ name: 'camoufox-bin', parent: 'sleep', processes: processes - 2, cpuPercent: 0 }] } });

test('what is left on no bot\'s screen for three checks in a row is logged once, with its largest groups', async () => {
  let now = other(1189, 598);
  const said = [];
  const w = leftovers.create({ usage: async () => now, warn: (line) => said.push(line), now: () => Date.parse('2026-10-24T11:40:00Z') });
  assert.equal(await w.check(), null);
  assert.equal(await w.check(), null);
  const found = await w.check();
  assert.equal(found.since, '2026-10-24T11:40:00.000Z');
  assert.equal(found.processes, 1189);
  await w.check();
  assert.equal(said.length, 1, 'once');
  assert.match(said[0], /1189 processes \(1187 zombies\), 598% CPU\. Largest: 1187× camoufox-bin under sleep/);
  now = other(4, 1);
  assert.equal(await w.check(), null, 'gone once it is small again');
  assert.equal(w.found(), null);
});

test('one high check is no leftover, nor is what runs while a bot works, nor a computer that is off', async () => {
  let now = other(500);
  let busy = false;
  const said = [];
  const w = leftovers.create({ usage: async () => now, busy: () => busy, warn: (line) => said.push(line) });
  await w.check();
  now = other(3);
  await w.check();
  now = other(500);
  await w.check();
  await w.check();
  assert.equal(w.found(), null, 'the count starts again after a low check');
  busy = true;
  await w.check();
  await w.check();
  assert.equal(w.found(), null, 'a bot at work: not counted');
  busy = false;
  now = { state: 'stopped' };
  assert.equal(await w.check(), null);
  now = other(10, 150);
  await w.check(); await w.check(); await w.check();
  assert.ok(w.found(), 'more than one CPU on no bot\'s screen is left behind too');
  assert.equal(said.length, 1);
});

test("the computer's status says in plain words what was left behind, and the Chief reads its largest groups", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-leftovers-'));
  const socket = path.join(dir, 'helper.sock');
  let used = { processes: 1189, cpuPercent: 598, memoryBytes: 489e6, zombies: 1180, top: [{ name: 'camoufox-bin', parent: 'sleep', processes: 1180, cpuPercent: 2 }] };
  const helper = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const { operation } = JSON.parse(body);
    const value = {
      inspect: { state: 'running' },
      details: { state: 'running', outdated: false, diskBytes: 1 },
      health: { state: 'running', status: 'running', exitCode: 0, error: '', oomKilled: false, restartCount: 0, lastStartError: null },
      usage: { state: 'running', screens: [], other: used },
      listAll: {},
      'update.status': { supported: false },
    }[operation] ?? null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  await new Promise((r) => helper.listen(socket, r));
  const srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket, BOT_DOT_LEFTOVERS_MS: '30' } });
  t.after(async () => { await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const bot = await makeBot(srv, { name: 'Media Watcher', computer: 'linux' });
  const status = async () => (await srv.api(`/bots/${bot.id}/computer`)).data.usage.other;
  await waitFor(async () => (await status()).leftSince, { timeout: 10_000 });
  const o = await status();
  assert.equal(o.text, 'Left behind: 1189 processes, 489 MB memory, 598% CPU');
  assert.equal(o.zombies, 1180);
  assert.deepEqual(o.top, used.top);
  used = { processes: 4, cpuPercent: 1, memoryBytes: 300e6, zombies: 0, top: [] };
  assert.equal((await status()).text, '300 MB memory · 1% CPU', 'once it is small again, the plain line');
});
