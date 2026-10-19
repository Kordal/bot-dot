// One computer for the whole account (#104, ADR 035): every bot works on it, as the one user `box` with sudo. It
// starts once, whichever bot asks first, and a bot that is done with it, or is deleted, never turns it off or erases
// it: only a bot's old computer of its own goes. Docker is a stand-in here.
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const childProcess = require('node:child_process');
const dns = require('node:dns');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The account's share, as root's step writes it (install.sh): the helper reads it at each start (#108).
const shareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-share-'));
const SHARE = path.join(shareDir, 'share.json');
process.env.BOT_DOT_SHARE_FILE = SHARE;
delete process.env.BOT_DOT_COMPUTER_MEMORY;
const share = (text) => (text === null ? fs.rmSync(SHARE, { force: true }) : fs.writeFileSync(SHARE, text));

dns.promises.Resolver = class {
  setServers() {}
  async resolve4() { const e = new Error('timed out'); e.code = 'ETIMEOUT'; throw e; }
};

// The stand-in Docker: containers by name, { state, labels }. With refuseLimits, it has no CPU cgroup.
let containers, calls, screensUp, refuseLimits = false;
function docker(args) {
  calls.push(args);
  const [cmd] = args;
  if (cmd === 'image') return '2';
  if (cmd === 'info') return '28';
  if (cmd === 'network' && args[1] === 'inspect') throw new Error('No such network');
  const name = args.find((a) => containers.has(a));
  if (cmd === 'inspect') {
    if (!name) throw new Error('No such object');
    const c = containers.get(name);
    if (args[3]?.includes('.State.Status')) return `"${c.state}"|"bot-dot/desktop:latest"|"sha256:image"`;
    if (args[3]?.includes('user-version')) return c.versions;
    if (args[3]?.includes('.HostConfig.Runtime')) return 'runsc';
    if (args[3]?.includes('RestartPolicy')) return 'no';
    return '';
  }
  if (cmd === 'run' && refuseLimits && args.includes('--cpus')) throw new Error('Error response from daemon: NanoCPUs can not be set, as your kernel does not support CPU CFS scheduler or the cgroup is not mounted');
  if (cmd === 'run') containers.set(args[args.indexOf('--name') + 1], { state: 'running', versions: '2|2' });
  if (cmd === 'stop' && name) containers.get(name).state = 'exited';
  if (cmd === 'start' && name) containers.get(name).state = 'running';
  if (cmd === 'rm' && name) containers.delete(name);
  if (cmd === 'ps') return [...containers].filter(([n]) => n.startsWith('botdot-')).map(([n, c]) => `${n}|${n.slice(7)}|${c.state}`).join('\n');
  // A screen's computer-server answers once its supervisord was started (#105).
  if (cmd === 'exec' && args.includes('/usr/bin/supervisord')) screensUp.add(args.find((a) => a.startsWith('API_PORT=')).slice(9));
  if (cmd === 'exec' && args.includes('python3') && !args.includes('-I') && !screensUp.has(args.at(-1))) throw new Error('Connection refused');
  if (cmd === 'exec' && args.includes('python3')) return '{"ok": true}';
  return '';
}
function fakeExecFile(file, args, opts, cb) {
  setImmediate(() => { try { cb(null, docker(args) ?? '', ''); } catch (e) { cb(e, '', e.message); } });
  return { stdin: { on() {}, end() {} } };
}
fakeExecFile[util.promisify.custom] = async (file, args) => ({ stdout: docker(args) ?? '', stderr: '' });
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;

const ACCOUNT = 'botdot.account.computer';
const runs = () => calls.filter((a) => a[0] === 'run');
// Each bot's seat on it (#105): a1, b1 and c1 have screens 1, 2 and 3.
const seat = (bot) => ({ bot, screen: { a1: 1, b1: 2, c1: 3 }[bot] });

after(() => fs.rmSync(shareDir, { recursive: true, force: true }));
beforeEach(() => {
  share(null);
  calls = [];
  screensUp = new Set();
  // Two bots' old computers of their own, made before (#104): one still running.
  containers = new Map([['botdot-a1', { state: 'running', versions: '2|1' }], ['botdot-b1', { state: 'exited', versions: '2|1' }]]);
});

test("every bot's computer is the account's one computer, made once", async () => {
  await Promise.all([computers.ensure(seat('a1')), computers.ensure(seat('b1'))]);
  await computers.ensure(seat('c1'));
  assert.equal(runs().length, 1, 'one container for the account');
  assert.equal(runs()[0][runs()[0].indexOf('--name') + 1], ACCOUNT);
  assert.equal(computers.containerName('a1'), ACCOUNT);
  assert.equal(computers.containerName('b1'), ACCOUNT);
  assert.equal(containers.get('botdot-b1').state, 'exited', "a bot's old computer is not started");
  for (const id of ['a1', 'b1']) assert.equal((await computers.inspect(id)).state, 'running');
});

test('it runs as box, with sudo: Docker keeps its default capabilities, under its own network and firewall', async () => {
  await computers.ensure(seat('a1'));
  const run = runs()[0];
  assert.equal(run[run.indexOf('--user') + 1], 'box');
  assert.ok(run.includes('HOME=/home/box'));
  assert.ok(!run.includes('--cap-drop'), 'sudo and apt need setuid and the file capabilities');
  assert.ok(!run.includes('no-new-privileges'), 'sudo cannot raise privileges under no-new-privileges');
  assert.ok(!run.includes('--privileged') && !run.some((a) => /NET_ADMIN|SYS_ADMIN/.test(a)), 'root in it cannot change its firewall');
  assert.equal(run[run.indexOf('--network') + 1], `${ACCOUNT}-network`);
  assert.ok(run.includes('botdot.user-version=2'));
  assert.ok(run.includes('botdot.computer=account'));
  assert.ok(!run.some((a) => a.startsWith('botdot.bot=')), "it is no bot's own");
  assert.ok(calls.some((a) => a[0] === 'exec' && a.includes('--privileged') && a.includes(ACCOUNT)), 'botdot sets its firewall');
  const desktop = calls.find((a) => a[0] === 'exec' && a.includes('/usr/bin/supervisord'));
  assert.deepEqual(desktop.slice(0, 6), ['exec', '-d', '-u', 'box', '-e', 'HOME=/home/box']);
});

test("a bot that is done with it, or is reset or deleted, leaves the account's computer on", async () => {
  await computers.ensure(seat('a1'));
  await computers.stop('a1');
  assert.equal(containers.get(ACCOUNT).state, 'running');
  assert.equal(await computers.reset('a1'), 'erased', "its old computer of its own is erased");
  assert.ok(!containers.has('botdot-a1'));
  assert.ok(calls.some((a) => a[0] === 'network' && a[1] === 'rm' && a.includes('botdot-a1-network')));
  assert.equal(containers.get(ACCOUNT).state, 'running');
  assert.ok(!calls.some((a) => ['rm', 'stop'].includes(a[0]) && a.includes(ACCOUNT)), 'the account computer is never stopped or erased');
  assert.equal(await computers.reset('c1'), 'none', 'a bot without an old computer has nothing to erase');
});

test("old computers of the bots' own are stopped and kept when botdot starts", async () => {
  computers.watch(() => ['a1', 'b1']);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(containers.get('botdot-a1').state, 'exited');
  assert.ok(containers.has('botdot-a1') && containers.has('botdot-b1'));
});

test("every bot's commands, logins, keys and secrets reach the account's computer as box", async () => {
  await computers.ensure(seat('a1'));
  calls = [];
  await computers.request(seat('a1'), '/status');
  await computers.startProgram(seat('b1'), 'xterm');
  await computers.runWithLogin(seat('b1'), { command: 'true', username: 'u', password: 'p' });
  await computers.typeSecret(seat('a1'), { field: 'password', value: 'x', site: 'example.com' });
  for (const a of calls.filter((x) => x[0] === 'exec')) assert.ok(a.includes(ACCOUNT), a.join(' '));
  const program = calls.find((a) => a.includes('xterm'));
  assert.equal(program[program.indexOf('-u') + 1], 'box');
  const login = calls.find((a) => a.includes('BOTDOT_PASSWORD'));
  assert.equal(login[login.indexOf('-u') + 1], 'box');
  const secret = calls.find((a) => a.includes('-I'));
  assert.equal(secret[secret.indexOf('-u') + 1], 'browser', 'the bridge still answers only the browser user');
});

// Two bots at once (#105): each one's clicks, screenshots, programs, logins and typed secrets go to its own screen.
test("two bots working at once each reach only their own screen, browser and folder (#105)", async () => {
  await Promise.all([computers.ensure(seat('a1')), computers.ensure(seat('b1'))]);
  calls = [];
  await Promise.all([
    computers.request(seat('a1'), '/cmd', { command: 'left_click', params: { x: 1, y: 2 } }),
    computers.request(seat('b1'), '/cmd', { command: 'screenshot', params: {} }),
    computers.typeSecret(seat('a1'), { field: 'password', value: 'x', site: 'example.com' }),
    computers.typeSecret(seat('b1'), { op: 'where' }),
    computers.runWithLogin(seat('b1'), { command: 'ls', username: 'u', password: 'p' }),
  ]);
  const execs = calls.filter((a) => a[0] === 'exec');
  const http = execs.filter((a) => a.includes('python3') && !a.includes('-I')).map((a) => a.at(-1)).sort();
  assert.deepEqual(http, ['8111', '8112'], "each bot's computer-server");
  const secrets = execs.filter((a) => a.includes('-I')).map((a) => a.at(-1)).sort();
  assert.deepEqual(secrets, ['/run/botdot-browser/bridge-11.sock', '/run/botdot-browser/bridge-12.sock'], "each bot's own browser");
  const login = execs.find((a) => a.includes('BOTDOT_PASSWORD'));
  assert.ok(login.includes('DISPLAY=:12') && login.includes('/workspace/b1'));
  assert.deepEqual(computers.screenPorts(seat('a1')), {
    bot: 'a1', n: 11, display: ':11', vnc: 5911, novnc: 6111, api: 8111, browser: 47211, socket: '/run/botdot-browser/bridge-11.sock', workdir: '/workspace/a1',
  });
});

test("a deleted bot's screen ends on the running computer: its supervisord, X server, bridge and profile (#105)", async () => {
  await computers.ensure(seat('a1'));
  calls = [];
  await computers.freeScreen(seat('a1'));
  const [end] = calls.filter((a) => a[0] === 'exec');
  assert.deepEqual(end.slice(0, 6), ['exec', '-u', 'root', ACCOUNT, 'sh', '-c']);
  assert.deepEqual(end.slice(-3), ['sh', '11', 'a1']);
  const script = end[6];
  assert.match(script, /screen-\$n\.pid/);
  assert.match(script, /rm -rf "\/home\/browser\/profiles\/\$bot"/);
  assert.doesNotMatch(script, /workspace/, 'its folder stays');
  containers.get(ACCOUNT).state = 'exited';
  calls = [];
  await computers.freeScreen(seat('a1'));
  assert.ok(!calls.some((a) => a[0] === 'exec'), 'a computer that is off has no screens to end');
});

test("the account's computer gets the share's RAM and CPUs as its limits (#108)", async () => {
  share('{"cpu":3,"ram":6}\n');
  await computers.ensure(seat('a1'));
  const run = runs()[0];
  assert.equal(run[run.indexOf('--memory') + 1], '6g');
  assert.equal(run[run.indexOf('--memory-swap') + 1], '6g', 'no swap beyond it');
  assert.equal(run[run.indexOf('--cpus') + 1], '3');
});

test('a share written before #108 is read without its computers at once, and no share means no limits', async () => {
  share('{"computers":2}\n');
  await computers.ensure(seat('a1'));
  let run = runs()[0];
  assert.ok(!run.includes('--memory') && !run.includes('--cpus'), run.join(' '));
  containers.delete(ACCOUNT);
  calls = [];
  share('{"cpu":2,"ram":5,"computers":2}\n');
  await computers.ensure(seat('a1'));
  run = runs()[0];
  assert.equal(run[run.indexOf('--memory') + 1], '5g');
  assert.equal(run[run.indexOf('--cpus') + 1], '2');
  for (const bad of [null, 'not json', '{"cpu":0,"ram":-1}', '{"cpu":"2","ram":1.5}']) {
    containers.delete(ACCOUNT);
    calls = [];
    share(bad);
    await computers.ensure(seat('a1'));
    run = runs()[0];
    assert.ok(!run.includes('--memory') && !run.includes('--cpus'), `${bad}: ${run.join(' ')}`);
  }
});

test('a Docker that cannot set the limits still makes the computer, without them', async (t) => {
  share('{"cpu":2,"ram":5}\n');
  refuseLimits = true;
  t.after(() => { refuseLimits = false; });
  const warn = t.mock.method(console, 'warn', () => {});
  await computers.ensure(seat('a1'));
  assert.equal(runs().length, 2);
  assert.ok(!runs()[1].includes('--cpus') && !runs()[1].includes('--memory'));
  assert.equal(containers.get(ACCOUNT).state, 'running');
  assert.match(warn.mock.calls[0].arguments[0], /refused the share's limits/);
});

test('a changed share sizes the computer at its next start', async () => {
  share('{"cpu":2,"ram":5}\n');
  await computers.ensure(seat('a1'));
  containers.get(ACCOUNT).state = 'exited';
  calls = [];
  share('{"cpu":4,"ram":8}\n');
  await computers.ensure(seat('a1'));
  const update = calls.findIndex((a) => a[0] === 'update');
  assert.deepEqual(calls[update], ['update', '--memory', '8g', '--memory-swap', '8g', '--cpus', '4', ACCOUNT]);
  assert.ok(update < calls.findIndex((a) => a[0] === 'start'), 'before it starts');
  assert.equal(containers.get(ACCOUNT).state, 'running');
});

test('no start waits for a free computer: there is no such step', () => {
  assert.equal(computers.waiting, undefined);
});
