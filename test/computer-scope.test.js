// Two botdot apps on one Docker host (#19): each Docker helper names and labels its computer with its Compose project,
// lists, counts and erases only its own, and takes over the computers made before, named for the whole host.
// Docker is a stand-in here: the containers of two apps and one from before.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const childProcess = require('node:child_process');

// The stand-in Docker: containers by name, { bot, state, labels }.
let containers, calls;
function docker(args) {
  calls.push(args);
  const [cmd] = args;
  if (cmd === 'image') return '1';
  if (cmd === 'info') return '28';
  if (cmd === 'network' && args[1] === 'inspect') throw new Error('No such network');
  if (cmd === 'ps') {
    const all = [...containers].filter(([, c]) => !args.includes('status=running') || c.state === 'running');
    return all.map(([name, c]) => (args.at(-1).includes('.State') ? `${name}|${c.bot}|${c.state}` : `${name}|${c.bot}`)).join('\n');
  }
  if (cmd === 'rename') { containers.set(args[2], containers.get(args[1])); containers.delete(args[1]); return ''; }
  const name = args.find((a) => containers.has(a));
  if (cmd === 'inspect' && args[3]?.includes('.State.Status')) {
    if (!name) throw new Error('No such object');
    return `"${containers.get(name).state}"|"bot-dot/desktop:latest"|"sha256:image"`;
  }
  if (cmd === 'inspect' && args[3]?.includes('user-version')) return '2|2';
  if (cmd === 'inspect' && args[3]?.includes('.HostConfig.Runtime')) return 'runsc';
  if (cmd === 'run') {
    const labels = args.flatMap((a, i) => (args[i - 1] === '--label' ? [a] : []));
    const bot = labels.find((l) => l.startsWith('botdot.bot='))?.slice('botdot.bot='.length);
    containers.set(args[args.indexOf('--name') + 1], { bot, state: 'running', labels });
  }
  if (cmd === 'rm' && name) containers.delete(name);
  if (cmd === 'exec' && args.includes('python3')) return '{}';
  return '';
}
function fakeExecFile(file, args, opts, cb) {
  const reply = () => { try { cb(null, docker(args) ?? '', ''); } catch (e) { cb(e, '', e.message); } };
  return { stdin: { on() {}, end() { setImmediate(reply); } } };
}
fakeExecFile[util.promisify.custom] = async (file, args) => ({ stdout: docker(args) ?? '', stderr: '' });

// lib/computers.js as a helper of the Compose project `scope` loads it, or as botdot without a helper (null).
function load(scope) {
  const real = childProcess.execFile;
  childProcess.execFile = fakeExecFile;
  if (scope) process.env.BOT_DOT_COMPUTER_SCOPE = scope; else delete process.env.BOT_DOT_COMPUTER_SCOPE;
  delete require.cache[require.resolve('../lib/computers')];
  try { return require('../lib/computers'); } finally { childProcess.execFile = real; delete process.env.BOT_DOT_COMPUTER_SCOPE; }
}
const alpha = load('alpha');
const plain = load(null);

beforeEach(() => {
  calls = [];
  containers = new Map([
    ['botdot-alpha.a1', { bot: 'a1', state: 'running' }],
    ['botdot-beta.b1', { bot: 'b1', state: 'running' }],
    ['botdot-old1', { bot: 'old1', state: 'exited' }],
  ]);
});

test("a helper's computer carries its project's name; without a helper the name is the account computer's alone", () => {
  assert.equal(alpha.containerName('a1'), 'botdot-alpha.account.computer');
  assert.equal(plain.containerName('a1'), 'botdot.account.computer');
});

test("a helper lists only its own old computers, not another app's", async () => {
  assert.deepEqual(await alpha.listAll(), { a1: 'running' });
});

test("the account's computer is named and labelled with the project, and so is its network", async () => {
  await alpha.ensure();
  const run = calls.find((a) => a[0] === 'run');
  assert.equal(run[run.indexOf('--name') + 1], 'botdot-alpha.account.computer');
  assert.ok(run.includes('botdot.instance=alpha') && run.includes('botdot.computer=account'));
  assert.equal(run[run.indexOf('--network') + 1], 'botdot-alpha.account.computer-network');
  const net = calls.find((a) => a[0] === 'network' && a[1] === 'create');
  assert.ok(net.includes('botdot.instance=alpha') && net.at(-1) === 'botdot-alpha.account.computer-network');
});

test('a computer from before is taken over by the first helper, with its files; one of another app is left alone', async () => {
  assert.deepEqual(await alpha.adoptUnscoped(), ['old1']);
  assert.deepEqual([...containers.keys()].sort(), ['botdot-alpha.a1', 'botdot-alpha.old1', 'botdot-beta.b1']);
  assert.deepEqual(await alpha.listAll(), { a1: 'running', old1: 'stopped' });
  assert.deepEqual(await alpha.adoptUnscoped(), [], 'nothing is left to take over');
  assert.deepEqual(await plain.adoptUnscoped(), [], 'botdot without a helper takes nothing over');
});

test("erasing a bot's old computer removes only this app's, and the network of a computer taken over", async () => {
  await alpha.adoptUnscoped();
  assert.equal(await alpha.reset('old1'), 'erased');
  assert.ok(!containers.has('botdot-alpha.old1') && containers.has('botdot-beta.b1'));
  const removed = calls.filter((a) => a[0] === 'network' && a[1] === 'rm').map((a) => a[2]);
  assert.deepEqual(removed, ['botdot-alpha.old1-network', 'botdot-old1-network']);
  assert.equal(await alpha.reset('b1'), 'none', 'b1 is no computer of this app');
  assert.ok(containers.has('botdot-beta.b1'));
});
