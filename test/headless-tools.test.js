// A bot's shell and file tools run with no screen (#134): run_shell, read_file and write_file are `docker exec` as box
// in its own folder, so a bot that only runs commands starts no desktop, X server, VNC or browser. The screen starts
// with its first tool that needs one, and again after it ended unused. Docker is a stand-in here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const util = require('node:util');
const childProcess = require('node:child_process');
const screensLib = require('../lib/computer-screens');
const { rpcClient } = require('./memory-helpers');
const { REAPED, IN_OWN_FOLDER } = require('./helpers');

// computers.js takes execFile when it loads, so it loads once, with a stand-in that records each call.
let calls = [];
let reply = () => ({ stdout: '', stderr: '' });
function fakeExecFile(file, args, opts, cb) {
  const call = { file, args, opts, input: undefined };
  calls.push(call);
  setImmediate(() => {
    const r = reply(call);
    cb(r.error || null, r.stdout ?? '', r.stderr ?? '');
  });
  return { stdin: { on() {}, end(input) { call.input = input; } } };
}
fakeExecFile[util.promisify.custom] = async (file, args, opts) => { calls.push({ file, args, opts }); return { stdout: '', stderr: '' }; };
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;
delete require.cache[require.resolve('../lib/computers')];

const SEAT = { bot: 'ops', screen: 2 };
const after = (args) => args.slice(args.indexOf(computers.containerName('ops')) + 1);

test('run_shell runs as box in its own folder, inside its time limit, with no screen started', async () => {
  calls = [];
  reply = () => ({ stdout: 'up 3 days\n', stderr: '' });
  const r = await computers.runShell(SEAT, { command: 'uptime' });
  assert.deepEqual(r, { code: 0, stdout: 'up 3 days\n', stderr: '', timedOut: false });
  assert.equal(calls.length, 1, 'one docker exec: no computer-server, no supervisord');
  const { args } = calls[0];
  assert.deepEqual(args.slice(0, 3), ['exec', '-u', 'box']);
  assert.deepEqual(after(args), ['timeout', '-k', '5', '120', ...REAPED, 'sh', '-c', IN_OWN_FOLDER, 'sh', '/workspace/ops', 'uptime']);
  assert.ok(args.includes('DISPLAY=:12'), 'its screen, for a program that wants it while it is on');
  await computers.runShell(SEAT, { command: 'sleep 1', timeoutSeconds: 5000 });
  assert.equal(after(calls[1].args)[3], '600', 'at most 600 s, as before');
  reply = () => ({ stdout: 'partial', stderr: '', error: Object.assign(new Error('Command failed'), { code: 124 }) });
  assert.equal((await computers.runShell(SEAT, { command: 'sleep 999' })).timedOut, true);
});

test('read_file and write_file take a path in its own folder, and the content goes on stdin only', async () => {
  calls = [];
  reply = () => ({ stdout: 'hello\n' });
  assert.equal((await computers.readFile(SEAT, { path: 'notes.txt' })).stdout, 'hello\n');
  const read = after(calls[0].args);
  assert.deepEqual(read.slice(4, 6), ['sh', '-c']);
  assert.match(read[6], /head -c 1048576 -- "\$2"/);
  assert.deepEqual(read.slice(7), ['sh', '/workspace/ops', 'notes.txt']);
  reply = () => ({});
  await computers.writeFile(SEAT, { path: '/tmp/a b.txt', content: 'secret-ish text' });
  const { args, input } = calls[1];
  assert.equal(args[1], '-i');
  assert.match(after(args)[6], /cat > "\$2"/);
  assert.deepEqual(after(args).slice(7), ['sh', '/workspace/ops', '/tmp/a b.txt']);
  assert.equal(input, 'secret-ish text');
  assert.ok(!args.some((a) => a.includes('secret-ish')), 'never on the command line');
});

test('the Docker helper takes the shell and file calls only in their fixed shape', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-shell-'));
  const socket = path.join(where, 'helper.sock');
  const ok = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });
  const server = createServer({ computers: { runShell: ok, readFile: ok, writeFile: ok }, updates: {} });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(where, { recursive: true, force: true }); });
  const status = (operation, args) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/call' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(JSON.stringify({ operation, args }));
  });
  assert.equal(await status('runShell', [SEAT, { command: 'ls' }]), 200);
  assert.equal(await status('runShell', [SEAT, { command: 'ls', timeoutSeconds: 601 }]), 400);
  assert.equal(await status('runShell', [SEAT, { command: 'ls', env: {} }]), 400);
  assert.equal(await status('runShell', ['ops', { command: 'ls' }]), 400, 'a seat, never a bare id');
  assert.equal(await status('readFile', [SEAT, { path: 'a.txt' }]), 200);
  assert.equal(await status('readFile', [SEAT, { path: 'a\0b' }]), 400);
  assert.equal(await status('writeFile', [SEAT, { path: 'a.txt', content: '' }]), 200);
  assert.equal(await status('writeFile', [SEAT, { path: 'a.txt' }]), 400);
});

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-headless-'));

test('commands and files start no screen and keep none on; a screen tool starts it, also after it ended', async () => {
  const got = [];
  let clock = 0;
  const record = (name) => async (...args) => { got.push(name); return name; };
  const raw = {
    ensure: record('ensure'), restScreen: record('restScreen'), request: record('request'),
    runShell: record('runShell'), readFile: record('readFile'), writeFile: record('writeFile'), runWithLogin: record('runWithLogin'),
  };
  const c = screensLib.facade(raw, screensLib.create(dir()), { restAfterMs: 1000, now: () => clock });
  await c.runShell('ops', { command: 'ls' });
  await c.readFile('ops', { path: 'a' });
  await c.writeFile('ops', { path: 'a', content: '' });
  await c.runWithLogin('ops', { command: 'true' });
  assert.deepEqual(got, ['runShell', 'readFile', 'writeFile', 'runWithLogin'], 'no screen started');
  clock = 5000;
  assert.deepEqual(await c.restIdle(), [], 'nothing to end: no screen was on');
  got.length = 0;
  await c.request('ops', '/cmd', { command: 'screenshot' });
  await c.request('ops', '/cmd', { command: 'screenshot' });
  assert.deepEqual(got, ['ensure', 'request', 'request'], 'its first screen tool starts it, once');
  clock = 7000;
  await c.runShell('ops', { command: 'ls' });
  assert.deepEqual(await c.restIdle(), ['ops'], 'a command does not keep the screen on');
  got.length = 0;
  await c.request('ops', '/cmd', { command: 'screenshot' });
  assert.deepEqual(got, ['ensure', 'request'], 'the screen that ended starts again, in the same run');
});

test('a screen still on from before botdot started ends too when nothing uses it', async () => {
  const data = dir();
  screensLib.create(data).of('old');
  const rested = [];
  let clock = 0;
  const c = screensLib.facade({ restScreen: async (s) => { rested.push(s.bot); } }, screensLib.create(data), { restAfterMs: 1000, now: () => clock });
  clock = 1500;
  assert.deepEqual(await c.restIdle(), ['old']);
  assert.deepEqual(rested, ['old']);
});

test('run_shell, read_file and write_file go to their own routes, not the screen', async (t) => {
  const asked = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      asked.push({ path: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/session/computer/shell') return res.end(JSON.stringify({ ok: true, stdout: 'hi\n', stderr: '', exitCode: 0 }));
      if (req.url === '/session/computer/read') return res.end(JSON.stringify({ ok: true, content: 'file text' }));
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot.account.computer' });
  await mcp.request('initialize', {});
  const shell = await mcp.request('tools/call', { name: 'run_shell', arguments: { command: 'echo hi' } });
  assert.equal(shell.content[0].text, 'stdout:\nhi\n\nexit code: 0');
  const read = await mcp.request('tools/call', { name: 'read_file', arguments: { path: 'a.txt' } });
  assert.equal(read.content[0].text, 'file text');
  const wrote = await mcp.request('tools/call', { name: 'write_file', arguments: { path: 'a.txt', content: 'x' } });
  assert.equal(wrote.content[0].text, 'Wrote a.txt');
  assert.ok(!asked.some((a) => a.path === '/session/computer/cmd'), 'nothing went to the screen');
  assert.deepEqual(asked.find((a) => a.path === '/session/computer/shell').body, { command: 'echo hi', timeoutSeconds: 120 });
  assert.deepEqual(asked.find((a) => a.path === '/session/computer/write').body, { path: 'a.txt', content: 'x' });
});
