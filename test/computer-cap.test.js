// The account's share of the machine caps how many of its bots' computers run at once (#471, ADR 028): the next one
// waits, first come first, and starts when another stops. Root writes the cap (install.sh, share/share.json); the
// account never sees it. Docker is a stand-in here, with computers that run until they are stopped.
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const childProcess = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-share-'));
const shareFile = path.join(dir, 'share.json');
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const cap = (computers) => (computers === null ? fs.rmSync(shareFile, { force: true }) : fs.writeFileSync(shareFile, JSON.stringify({ computers })));

// The stand-in Docker: which computers exist, and which of them run.
let made, running;
const bot = (args) => args.find((a) => /^botdot-[a-z0-9]+$/.test(a))?.slice(7);
function docker(args) {
  const [cmd] = args;
  if (cmd === 'image') return '1';
  if (cmd === 'info') return '28';
  if (cmd === 'network' && args[1] === 'inspect') throw new Error('No such network');
  if (cmd === 'ps') return [...running].join('\n');
  if (cmd === 'inspect' && args[3]?.includes('.State.Status')) {
    const id = bot(args);
    if (!made.has(id)) throw new Error('No such object');
    return `"${running.has(id) ? 'running' : 'exited'}"|"bot-dot/desktop:latest"|"sha256:image"`;
  }
  if (cmd === 'inspect' && args[3]?.includes('user-version')) return '2|1';
  if (cmd === 'inspect' && args[3]?.includes('.HostConfig.Runtime')) return 'runsc';
  if (cmd === 'run') { const id = args[args.indexOf('--label') + 1].slice('botdot.bot='.length); made.add(id); running.add(id); }
  if (cmd === 'start') running.add(bot(args));
  if (cmd === 'stop') running.delete(bot(args));
  if (cmd === 'exec' && args.includes('python3')) return '{}';
  return '';
}
function fakeExecFile(file, args, opts, cb) {
  const reply = () => { try { cb(null, docker(args) ?? '', ''); } catch (e) { cb(e, '', e.message); } };
  return { stdin: { on() {}, end() { setImmediate(reply); } } };
}
fakeExecFile[util.promisify.custom] = async (file, args) => ({ stdout: docker(args) ?? '', stderr: '' });
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
process.env.BOT_DOT_SHARE_FILE = shareFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
delete process.env.BOT_DOT_SHARE_FILE;
childProcess.execFile = realExecFile;

const tick = () => new Promise((r) => setTimeout(r, 30));
// Until bot `id`'s start waits for a free computer: what the run's working line reads, not a time that a busy
// machine may pass before a start that never waits has finished.
const untilWaiting = async (id, done = () => false) => {
  while (!computers.waiting(id) && !done()) await new Promise((r) => setImmediate(r));
  return 'waiting';
};
const settled = (p, id) => {
  let over = false;
  const result = p.then(() => 'started', (e) => `failed: ${e.message}`).finally(() => { over = true; });
  return Promise.race([result, untilWaiting(id, () => over).then(() => (over ? result : 'waiting'))]);
};

beforeEach(() => { made = new Set(); running = new Set(); cap(2); });

test('as many computers as the share allows start at once, and the next waits until one stops', async () => {
  await computers.ensure('one');
  await computers.ensure('two');
  const three = computers.ensure('three');
  assert.equal(await settled(three, 'three'), 'waiting');
  assert.equal(computers.waiting('three'), true, 'its run says "Waiting for a free computer"');
  assert.ok(!running.has('three'));
  await computers.stop('one');
  await three;
  assert.ok(running.has('three'), 'it starts when one stops');
  assert.equal(computers.waiting('three'), false);
  assert.deepEqual([...running].sort(), ['three', 'two']);
});

test('a computer that runs already never waits, and the cap counts no computer twice', async () => {
  await computers.ensure('one');
  await computers.ensure('two');
  assert.equal(await settled(computers.ensure('one', 'lan'), 'one'), 'started', 'its own computer is no other one');
});

test('the computers that wait start first come first', async () => {
  cap(1);
  await computers.ensure('one');
  const two = computers.ensure('two');
  await untilWaiting('two');
  const three = computers.ensure('three');
  await untilWaiting('three');
  await computers.stop('one');
  await two;
  assert.equal(await settled(three, 'three'), 'waiting', 'the first that waited goes first');
  await computers.stop('two');
  await three;
  assert.ok(running.has('three'));
});

test('a computer stopped while it waits never starts', async () => {
  cap(1);
  await computers.ensure('one');
  const two = computers.ensure('two');
  await untilWaiting('two');
  await computers.stop('two');
  assert.match(await two.then(() => 'started', (e) => `failed: ${e.message}`), /failed: Stopped while waiting for a free computer/);
  await computers.stop('one');
  await tick();
  assert.ok(!running.has('two'));
  assert.equal(computers.waiting('two'), false);
});

test('a bigger share lets a waiting computer start, and without a share nothing waits', async () => {
  cap(1);
  await computers.ensure('one');
  const two = computers.ensure('two');
  assert.equal(await settled(two, 'two'), 'waiting');
  cap(2);
  await computers.stop('nobody'); // anything that stops wakes the waiting ones; else they look every few seconds
  await two;
  cap(null);
  await computers.ensure('three');
  await computers.ensure('four');
  assert.equal(running.size, 4);
});
