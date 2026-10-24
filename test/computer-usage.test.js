// The account's computer shows what each bot uses of it (#109): the memory and CPU of the processes of its screen
// and of the commands it started, so the owner sees which bot eats the machine. deploy/desktop/botdot-usage counts
// them inside the computer, by the screen in their environment (SCREEN, or DISPLAY :n) or their parent's;
// lib/computers.js hands them on by screen, computer-screens.js by bot, and the server words them for the apps and
// the Chief. The Chief's computer tools act on the account's computer: a restart asks first while bots work on it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const childProcess = require('node:child_process');
const { startServer, makeBot, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const USAGE = path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-usage');
const PAGE = Number(childProcess.execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim());

// A /proc of its own: each process its stat (ppid, CPU ticks, resident pages), environment and command line.
function fakeProc(procs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-usage-proc-'));
  for (const { pid, ppid = 1, comm = 'x', ticks = 0, rss = 0, env = [], cmd = [comm], state = 'S' } of procs) {
    fs.mkdirSync(path.join(dir, String(pid)));
    const rest = [state, ppid, 0, 0, 0, 0, 0, 0, 0, 0, 0, ticks, 0, 0, 0, 0, 0, 0, 0, 0, 0, rss];
    fs.writeFileSync(path.join(dir, String(pid), 'stat'), `${pid} (${comm}) ${rest.join(' ')}\n`);
    fs.writeFileSync(path.join(dir, String(pid), 'environ'), env.map((e) => `${e}\0`).join(''));
    fs.writeFileSync(path.join(dir, String(pid), 'cmdline'), cmd.map((e) => `${e}\0`).join(''));
  }
  fs.mkdirSync(path.join(dir, 'self')); // not a process
  return dir;
}
const usage = (proc, wait = '0') => JSON.parse(childProcess.execFileSync('python3', ['-I', USAGE, proc, wait], { encoding: 'utf8' }));

test('botdot-usage counts each process for the screen in its environment, or its parent\'s, or on its command line', (t) => {
  const proc = fakeProc([
    { pid: 1, comm: 'sleep', rss: 10 },
    { pid: 20, comm: 'supervisord', rss: 100, env: ['HOME=/home/box', 'SCREEN=11'] },
    { pid: 21, ppid: 20, comm: 'Xvnc', rss: 200, cmd: ['Xvnc', ':11', '-geometry', '1024x768'] },
    // A command of the bot's through `docker exec`, with its screen's DISPLAY, and what it started under sudo.
    { pid: 30, ppid: 0, comm: 'sh', rss: 50, env: ['DISPLAY=:12'] },
    { pid: 31, ppid: 30, comm: 'apt', rss: 300 },
    // Its browser, as the browser user: the launcher names the display.
    { pid: 40, ppid: 0, comm: 'camoufox-browse', rss: 400, cmd: ['/usr/local/bin/camoufox-browser', '--serve', ':12', 'scout'] },
    // The one shared screen of before #105 is no bot's.
    { pid: 50, ppid: 0, comm: 'Xvnc', rss: 7, env: ['DISPLAY=:1'] },
  ]);
  t.after(() => fs.rmSync(proc, { recursive: true, force: true }));
  const u = usage(proc);
  assert.deepEqual(u.screens['11'], { memoryBytes: 300 * PAGE, cpuPercent: 0, processes: 2 });
  assert.deepEqual(u.screens['12'], { memoryBytes: 750 * PAGE, cpuPercent: 0, processes: 3 });
  assert.deepEqual(u.other, { memoryBytes: 17 * PAGE, cpuPercent: 0, processes: 2, zombies: 0,
    top: [{ name: 'Xvnc', parent: '', processes: 1, cpuPercent: 0 }, { name: 'sleep', parent: 'sleep', processes: 1, cpuPercent: 0 }] });
  assert.deepEqual(Object.keys(u.screens).sort(), ['11', '12']);
});

// What is left behind on no bot's screen can be told before a restart wipes it (#535): how many are zombies, and the
// largest groups by name and parent's name.
test("botdot-usage says of what runs on no bot's screen how many are zombies, and its largest groups", (t) => {
  const zombies = Array.from({ length: 7 }, (_, i) => ({ pid: 100 + i, comm: 'camoufox-bin', state: 'Z' }));
  const proc = fakeProc([
    { pid: 1, comm: 'sleep', rss: 10 },
    ...zombies,
    { pid: 200, ppid: 0, comm: 'node', rss: 5 },
    { pid: 201, ppid: 200, comm: 'retry.sh', rss: 1 },
    { pid: 202, ppid: 200, comm: 'retry.sh', rss: 1 },
    { pid: 20, comm: 'supervisord', env: ['SCREEN=11'] },
  ]);
  t.after(() => fs.rmSync(proc, { recursive: true, force: true }));
  const { other } = usage(proc);
  assert.equal(other.processes, 11);
  assert.equal(other.zombies, 7);
  assert.deepEqual(other.top.slice(0, 2), [{ name: 'camoufox-bin', parent: 'sleep', processes: 7, cpuPercent: 0 }, { name: 'retry.sh', parent: 'node', processes: 2, cpuPercent: 0 }]);
  assert.equal(other.top.length, 4, 'the screen\'s own are not among them');
});

// A busy loop gets one CPU fully only on an idle machine: on a loaded one it gets what the scheduler gives it. So
// the measure is held against the CPU the loop really had over the same time, read from its /proc/<pid>/stat.
test('botdot-usage measures CPU over its wait: 100 is one CPU fully used', async (t) => {
  // Screen 93: test/computer-leftovers.test.js, which may run at the same time, ends what carries SCREEN=97.
  const busy = childProcess.spawn('python3', ['-c', 'while True: pass'], { env: { ...process.env, SCREEN: '93' }, stdio: 'ignore' });
  t.after(() => busy.kill('SIGKILL'));
  await new Promise((r) => setTimeout(r, 200));
  const HZ = Number(childProcess.execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  const ticks = () => { const f = fs.readFileSync(`/proc/${busy.pid}/stat`, 'utf8').slice(0, -1).split(') ')[1].split(' '); return Number(f[11]) + Number(f[12]); };
  const [t0, w0] = [ticks(), performance.now()];
  const u = await new Promise((resolve, reject) => childProcess.execFile('python3', ['-I', USAGE, '/proc', '0.5'], { encoding: 'utf8' },
    (e, out) => (e ? reject(e) : resolve(JSON.parse(out)))));
  const had = ((ticks() - t0) / HZ / ((performance.now() - w0) / 1000)) * 100; // its share of one CPU, in percent
  const said = u.screens['93'].cpuPercent;
  // The wait of botdot-usage is a part of the time measured here, so the two differ by what the loop got around it.
  assert.ok(said >= Math.floor(had / 3) && said < 130, `botdot-usage said ${said}, the loop had ${had.toFixed(0)}`);
  assert.ok(u.screens['93'].memoryBytes > 0);
});

// ---------- lib/computers.js: by screen ----------
test('computers.usage runs botdot-usage as root in the account\'s computer and hands on its screens by number', async () => {
  const calls = [];
  const said = { screens: { 11: { memoryBytes: 5, cpuPercent: 1.5, processes: 2 }, 13: { memoryBytes: 7, cpuPercent: 0, processes: 1 } }, other: { memoryBytes: 1, cpuPercent: 0, processes: 1 } };
  const answer = (args) => {
    if (args[0] === 'inspect') return '"running"|"bot-dot/desktop:latest"|"sha256:image"';
    if (args[0] === 'exec') return JSON.stringify(said);
    return '';
  };
  const fake = (file, args, opts, cb) => { calls.push(args); setImmediate(() => cb(null, answer(args), '')); return { stdin: { on() {}, end() {} } }; };
  fake[util.promisify.custom] = async (file, args) => { calls.push(args); return { stdout: answer(args), stderr: '' }; };
  const real = childProcess.execFile;
  childProcess.execFile = fake;
  delete require.cache[require.resolve('../lib/computers')];
  const computers = require('../lib/computers');
  childProcess.execFile = real;
  delete require.cache[require.resolve('../lib/computers')];

  const u = await computers.usage();
  assert.deepEqual(u, { state: 'running', screens: [{ screen: 1, memoryBytes: 5, cpuPercent: 1.5, processes: 2 }, { screen: 3, memoryBytes: 7, cpuPercent: 0, processes: 1 }], other: { ...said.other, zombies: 0, top: [] } });
  const exec = calls.find((a) => a[0] === 'exec');
  assert.deepEqual(exec.slice(0, 6), ['exec', '-u', 'root', '-w', '/', 'botdot.account.computer']);
  assert.ok(exec.includes('-I') && exec.includes(fs.readFileSync(USAGE, 'utf8')), "botdot's own copy, in Python's isolated mode");
});

test('the screens of the account\'s computer are handed on by bot', async () => {
  const screens = require('../lib/computer-screens');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-usage-screens-'));
  try {
    const kept = screens.create(dir);
    kept.of('coder'); kept.of('scout');
    const out = screens.facade({ usage: async () => ({ state: 'running', screens: [{ screen: 2, memoryBytes: 9, cpuPercent: 3, processes: 1 }, { screen: 40, memoryBytes: 1, cpuPercent: 0, processes: 1 }], other: { memoryBytes: 1, cpuPercent: 0, processes: 1 } }) }, kept);
    assert.deepEqual(await out.usage(), { state: 'running', bots: { scout: { memoryBytes: 9, cpuPercent: 3, processes: 1 } }, other: { memoryBytes: 2, cpuPercent: 0, processes: 2 } }, "a screen that is no bot's counts as the computer's own");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the server, the apps and the Chief ----------
let asked = [];
let state = 'running';
let used = {};
let srv; let helper; let dir;
let coder; let scout;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-usage-'));
  const socket = path.join(dir, 'helper.sock');
  helper = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    asked.push([operation, ...args]);
    let value = null;
    if (operation === 'inspect') value = { state };
    if (operation === 'details') value = { state, outdated: false, diskBytes: 1 };
    if (operation === 'health') value = { state, status: 'running', exitCode: 0, error: '', oomKilled: true, restartCount: 0, lastStartError: null };
    if (operation === 'usage') value = { state, screens: Object.entries(used).map(([screen, u]) => ({ screen: Number(screen), ...u })), other: { memoryBytes: 300e6, cpuPercent: 1, processes: 4 } };
    if (operation === 'restartAll') value = 'restarted';
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  await new Promise((r) => helper.listen(socket, r));
  srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
  coder = await makeBot(srv, { name: 'Coder', computer: 'linux' });
  scout = await makeBot(srv, { name: 'Scout', computer: 'linux' });
  await makeBot(srv, { name: 'No Desk' });
  // Their screens, as their first computer tools gave them: Coder 1, Scout 2.
  await srv.stop();
  fs.writeFileSync(path.join(srv.data, 'computer-screens.json'), JSON.stringify({ [coder.id]: 1, [scout.id]: 2 }));
  srv = await startServer({ dir: srv.dir, env: { BOT_DOT_HELPER_SOCKET: socket } });
});
after(async () => { await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

const chief = (t) => rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
const ops = (name) => asked.filter(([op]) => op === name);

test('the server announces the use per bot in its features', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('computer-usage'));
});

test("a bot's computer says what each bot uses of it, most memory first, in the server's words", async () => {
  state = 'running';
  used = { 1: { memoryBytes: 450e6, cpuPercent: 2.4, processes: 6 }, 2: { memoryBytes: 1.6e9, cpuPercent: 87.6, processes: 30 } };
  const d = (await srv.api(`/bots/${coder.id}/computer`)).data;
  assert.deepEqual(d.usage.bots.map((b) => [b.name, b.memoryBytes, b.cpuPercent]), [['Scout', 1.6e9, 87.6], ['Coder', 450e6, 2.4]]);
  assert.equal(d.usage.bots[0].text, '1.6 GB memory · 88% CPU');
  assert.equal(d.usage.bots[1].text, '450 MB memory · 2% CPU');
  assert.equal(d.usage.other.text, '300 MB memory · 1% CPU');
  assert.match(d.usage.text, /one CPU/);
  assert.doesNotMatch(JSON.stringify(d.usage), /share|limit|of \d/i, 'no share or limit in an account (AGENTS.md rule 5)');
});

test('a bot with no screen yet, or nothing on it, uses nothing; a stopped computer has no use to show', async () => {
  used = { 1: { memoryBytes: 450e6, cpuPercent: 0.2, processes: 6 } };
  const d = (await srv.api(`/bots/${scout.id}/computer`)).data;
  assert.deepEqual(d.usage.bots.map((b) => [b.name, b.text]), [['Coder', '450 MB memory · 0% CPU'], ['Scout', 'nothing running']]);
  state = 'stopped';
  assert.equal((await srv.api(`/bots/${scout.id}/computer`)).data.usage, undefined);
  state = 'running';
});

test('computer_status is the account\'s computer, with each bot\'s memory and CPU', async (t) => {
  used = { 2: { memoryBytes: 2.1e9, cpuPercent: 140, processes: 40 } };
  const status = await chief(t).json('computer_status', {});
  assert.equal(status.oomKilled, true);
  assert.deepEqual(status.usage.bots.map((b) => [b.name, b.text]), [['Scout', '2.1 GB memory · 140% CPU'], ['Coder', 'nothing running']]);
  // As before, for one bot: it is the same computer.
  assert.deepEqual((await chief(t).json('computer_status', { id: coder.id })).usage.bots[0].name, 'Scout');
  const { tools } = await chief(t).request('tools/list');
  const described = Object.fromEntries(tools.map((x) => [x.name, x.description]));
  for (const tool of ['computer_status', 'computer_logs', 'restart_computer']) assert.match(described[tool], /account's computer/, tool);
  assert.deepEqual(tools.find((x) => x.name === 'restart_computer').inputSchema.required ?? [], [], 'the account\'s computer: no bot to name');
});

test('restart_computer restarts the account\'s computer at once while no bot works on it', async (t) => {
  asked = [];
  const r = await chief(t).json('restart_computer', {});
  assert.deepEqual(r, { ok: true, state: 'running' });
  assert.equal(ops('restartAll').length, 1);
});

test('while bots work on it, restart_computer asks the owner first on a card, and their yes restarts it', async (t) => {
  const { rec, run } = await heldRun(srv, scout);
  t.after(() => { srv.unhold(); });
  asked = [];
  const said = await chief(t).json('restart_computer', {});
  assert.equal(said.held, true);
  assert.equal(ops('restartAll').length, 0, 'nothing is restarted on the Chief\'s word while Scout works');
  const [card] = (await srv.api('/asks?chief-action=1')).data.filter((a) => a.kind === 'chief-action' && a.title === "Restart the account's computer");
  assert.ok(card, 'a card in Needs you');
  assert.match(card.meta, /Scout/);
  assert.match(card.meta, /kept/);
  assert.equal(card.text, "Asks to restart the account's computer");
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 200);
  assert.equal(ops('restartAll').length, 1, "the owner's yes restarts it, though Scout works");
  srv.release(rec);
  await srv.finished(run.id);
});

test("the Chief's restart of a bot's computer is the account's, and the apps' 'Turn off' is gone from the API too", async (t) => {
  asked = [];
  const r = await srv.asChief(`/bots/${coder.id}/computer/restart`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(ops('restartAll').length, 1);
  assert.equal(ops('stop').length, 0);
  const off = await srv.api(`/bots/${coder.id}/computer`, { method: 'POST', body: { action: 'stop' } });
  assert.equal(off.status, 409, 'an older app\'s Turn off still answers, and turns nothing off');
});

test('the Docker helper takes the use and the restart with no argument', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const hdir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-usage-helper-'));
  const socket = path.join(hdir, 'helper.sock');
  const calls = [];
  const server = createServer({ computers: { usage: async (...a) => { calls.push(['usage', ...a]); return {}; }, restartAll: async (...a) => { calls.push(['restartAll', ...a]); return 'restarted'; } }, updates: {} });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(hdir, { recursive: true, force: true }); });
  const call = (value) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/call' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(JSON.stringify(value));
  });
  for (const value of [{ operation: 'usage', args: ['coder'] }, { operation: 'restartAll', args: [{ hard: true }] }]) assert.equal(await call(value), 400, JSON.stringify(value));
  for (const value of [{ operation: 'usage', args: [] }, { operation: 'restartAll', args: [] }]) assert.equal(await call(value), 200, JSON.stringify(value));
  assert.deepEqual(calls, [['usage'], ['restartAll']]);
});
