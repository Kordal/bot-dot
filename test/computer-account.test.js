// One computer for the whole account (#104, ADR 035): every bot works on it, as the one user `box` with sudo. It
// starts once, whichever bot asks first, and a bot that is done with it, or is deleted, never turns it off or erases
// it: only a bot's old computer of its own goes. Docker is a stand-in here.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const childProcess = require('node:child_process');
const dns = require('node:dns');

dns.promises.Resolver = class {
  setServers() {}
  async resolve4() { const e = new Error('timed out'); e.code = 'ETIMEOUT'; throw e; }
};

// The stand-in Docker: containers by name, { state, labels }.
let containers, calls;
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
  if (cmd === 'run') containers.set(args[args.indexOf('--name') + 1], { state: 'running', versions: '2|2' });
  if (cmd === 'stop' && name) containers.get(name).state = 'exited';
  if (cmd === 'start' && name) containers.get(name).state = 'running';
  if (cmd === 'rm' && name) containers.delete(name);
  if (cmd === 'ps') return [...containers].filter(([n]) => n.startsWith('botdot-')).map(([n, c]) => `${n}|${n.slice(7)}|${c.state}`).join('\n');
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
beforeEach(() => {
  calls = [];
  // Two bots' old computers of their own, made before (#104): one still running.
  containers = new Map([['botdot-a1', { state: 'running', versions: '2|1' }], ['botdot-b1', { state: 'exited', versions: '2|1' }]]);
});

test("every bot's computer is the account's one computer, made once", async () => {
  await Promise.all([computers.ensure('a1'), computers.ensure('b1')]);
  await computers.ensure('c1');
  assert.equal(runs().length, 1, 'one container for the account');
  assert.equal(runs()[0][runs()[0].indexOf('--name') + 1], ACCOUNT);
  assert.equal(computers.containerName('a1'), ACCOUNT);
  assert.equal(computers.containerName('b1'), ACCOUNT);
  assert.equal(containers.get('botdot-b1').state, 'exited', "a bot's old computer is not started");
  for (const id of ['a1', 'b1']) assert.equal((await computers.inspect(id)).state, 'running');
});

test('it runs as box, with sudo: Docker keeps its default capabilities, under its own network and firewall', async () => {
  await computers.ensure('a1');
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
  await computers.ensure('a1');
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
  await computers.ensure('a1');
  calls = [];
  await computers.request('a1', '/status');
  await computers.startProgram('b1', 'xterm');
  await computers.runWithLogin('b1', { command: 'true', username: 'u', password: 'p' });
  await computers.typeSecret('a1', { field: 'password', value: 'x', site: 'example.com' });
  for (const a of calls.filter((x) => x[0] === 'exec')) assert.ok(a.includes(ACCOUNT), a.join(' '));
  const program = calls.find((a) => a.includes('xterm'));
  assert.equal(program[program.indexOf('-u') + 1], 'box');
  const login = calls.find((a) => a.includes('BOTDOT_PASSWORD'));
  assert.equal(login[login.indexOf('-u') + 1], 'box');
  const secret = calls.find((a) => a.includes('-I'));
  assert.equal(secret[secret.indexOf('-u') + 1], 'browser', 'the bridge still answers only the browser user');
});

test('no start waits for a free computer: there is one', async () => {
  assert.equal(await computers.waiting('a1'), false);
});
