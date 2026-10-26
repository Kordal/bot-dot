const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('the Docker helper accepts fixed computer operations and rejects arbitrary Docker requests', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-'));
  const socket = path.join(dir, 'helper.sock');
  const calls = [];
  const cleaned = { removed: 1, skipped: 2, failed: 0, bytes: 3 };
  const server = createServer({ computers: { inspect: async (id) => { calls.push(id); return { state: 'running' }; }, waiting: () => true,
    resetAll: async (...args) => { calls.push(['resetAll', ...args]); return 'erased'; }, updateAll: async (...args) => { calls.push(['updateAll', ...args]); return 'updated'; },
    copyOld: async (...args) => { calls.push(['copyOld', ...args]); return null; } }, updates: { clean: async (...args) => { calls.push(['clean', ...args]); return cleaned; } } });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = (value) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/call' }, (res) => {
      let data = ''; res.on('data', (b) => { data += b; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(JSON.stringify(value));
  });
  assert.equal((await call({ operation: 'inspect', args: ['test-bot'] })).data.value.state, 'running');
  for (const value of [
    { operation: 'exec', args: ['host', 'sh'] },
    { operation: 'inspect', args: ['../../host'] },
    // No computer waits for a free one: the account has one (#108).
    { operation: 'waiting', args: ['test-bot'] },
    { operation: 'inspect', args: ['test-bot'], mounts: ['/:/host'] },
    { operation: 'ensure', args: ['test-bot', { image: 'evil', mounts: ['/:/host'] }] },
    { operation: 'ensure', args: ['test-bot', 'internet'] },
    { operation: 'reconfigure', args: ['test-bot', 'lan'] },
    { operation: 'request', args: ['test-bot', '//evil.example/', {}] },
    { operation: 'constructor', args: [] },
    { operation: 'update.apply', args: [{ project: 'another-project' }] },
    // The cleanup takes no argument: which images go is the helper's rule, never the caller's.
    { operation: 'update.clean', args: ['ghcr.io/kordal/bot-dot:latest'] },
    { operation: 'update.clean', args: [{ force: true }] },
    { operation: 'update.prune', args: [] },
    // The account's computer (#107): a reset and an update take nothing, a copy only the bot whose old computer it is.
    { operation: 'resetAll', args: ['test-bot'] },
    { operation: 'updateAll', args: [{ image: 'evil' }] },
    { operation: 'copyOld', args: [] },
    { operation: 'copyOld', args: ['../../host'] },
    { operation: 'copyOld', args: ['test-bot', '/etc'] },
  ]) assert.equal((await call(value)).status, 400, JSON.stringify(value));
  assert.deepEqual((await call({ operation: 'update.clean', args: [] })).data.value, cleaned);
  for (const value of [{ operation: 'resetAll', args: [] }, { operation: 'updateAll', args: [] }, { operation: 'copyOld', args: ['test-bot'] }]) {
    assert.equal((await call(value)).status, 200, JSON.stringify(value));
  }
  // A computer erased or made again is followed by the cleanup of the desktop it ran on (#191).
  assert.deepEqual(calls, ['test-bot', ['clean'], ['resetAll'], ['clean'], ['updateAll'], ['clean'], ['copyOld', 'test-bot']]);
});

test("owner edits and power settings never turn off the account's computer (#104)", async (t) => {
  const { startServer, makeBot, waitFor } = require('./helpers');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-power-'));
  const socket = path.join(dir, 'helper.sock');
  let state = 'none';
  // The helper is the external service boundary. Model its observable power state.
  const helper = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const { operation } = JSON.parse(body);
    let value = null;
    if (operation === 'ensure') state = 'running';
    if (operation === 'stop') state = 'stopped';
    if (operation === 'inspect') value = { state };
    if (operation === 'details') {
      // Status can arrive after asynchronous owner-request work has completed.
      await new Promise(r => setTimeout(r, 50));
      value = { state };
    }
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  await new Promise(r => helper.listen(socket, r));
  const srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
  t.after(async () => { await srv.stop(); await new Promise(r => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const bot = await makeBot(srv, { computer: 'linux' });
  const status = async () => (await srv.api(`/bots/${bot.id}/computer`)).data.state;
  await status(); // settle initial creation's power handling
  assert.equal((await srv.api(`/bots/${bot.id}/computer`, { method: 'POST', body: { action: 'start' } })).status, 200);
  for (const body of [{ description: 'Edited while the owner uses the computer' }, { group: 'Home' }]) {
    assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body })).status, 200);
    assert.equal(await status(), 'running', JSON.stringify(body));
  }
  for (const body of [{ systemPrompt: 'Owner-approved rules' }, { prompt: 'Owner-approved wording change' }]) {
    const proposal = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body });
    assert.equal(proposal.status, 200);
    assert.ok(proposal.data.pendingChange);
    assert.equal((await srv.api(`/asks/${proposal.data.pendingChange}`, { method: 'POST', body: { yes: true } })).status, 200);
    assert.equal(await status(), 'running', 'approving a change must preserve manual power');
  }
  for (const [body, expected] of [[{ computerAlwaysOn: true }, 'running'], [{ computerAlwaysOn: false }, 'running'], [{ computer: 'none' }, 'running']]) {
    assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body })).status, 200);
    await waitFor(async () => (await status()) === expected, { what: `explicit power change to ${expected}` });
  }
  // Every bot with a computer shows the state of the account's computer, which they all work on.
  const other = await makeBot(srv, { name: 'Second', computer: 'linux' });
  assert.deepEqual((await srv.api('/computers')).data, { [other.id]: 'running' });
});

test("a seat may carry its bot's name, which its commits on the computer carry (#547)", () => {
  const { validate } = require('../lib/docker-helper');
  assert.equal(validate('screenState', [{ bot: 'ops', screen: 2, name: 'Claude Coder' }]), true);
  assert.equal(validate('runShell', [{ bot: 'ops', screen: 2, name: 'Ops' }, { command: 'git log' }]), true);
  for (const name of [42, 'x'.repeat(201), null]) assert.equal(validate('screenState', [{ bot: 'ops', screen: 2, name }]), false, String(name));
  assert.equal(validate('screenState', [{ bot: 'ops', screen: 2, image: 'evil' }]), false);
});

test("the bridge to the bot's workspace (#545) goes through the helper: bringOut, listUploads and putUpload, the file's bytes whole", async (t) => {
  const { createServer, validate } = require('../lib/docker-helper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-bridge-'));
  const socket = path.join(dir, 'helper.sock');
  const calls = [];
  const server = createServer({ updates: {}, computers: {
    bringOut: async (seat, opts) => { calls.push(['bringOut', seat, opts]); return { code: 0, stdout: 'size 3\nYWJj\n' }; },
    listUploads: async (seat) => { calls.push(['listUploads', seat]); return { code: 0, stdout: 'a.pdf\n' }; },
    putUpload: async (seat, { name, data }) => { calls.push(['putUpload', seat, name, Buffer.isBuffer(data), data.toString('hex')]); return { code: 0 }; },
  } });
  await new Promise((r) => server.listen(socket, r));
  const before = process.env.BOT_DOT_HELPER_SOCKET;
  process.env.BOT_DOT_HELPER_SOCKET = socket;
  t.after(async () => {
    if (before === undefined) delete process.env.BOT_DOT_HELPER_SOCKET; else process.env.BOT_DOT_HELPER_SOCKET = before;
    await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true });
  });
  // lib/computer-screens.js's facade on a machine with the helper (hq): every call the bridge makes is there.
  const computers = require('../lib/helper-client').computers({});
  const seat = { bot: 'desk', screen: 2, name: 'Desk' };
  assert.deepEqual(await computers.bringOut(seat, { script: 'echo the script' }), { code: 0, stdout: 'size 3\nYWJj\n' });
  assert.deepEqual(await computers.listUploads(seat), { code: 0, stdout: 'a.pdf\n' });
  const data = Buffer.from([0, 1, 2, 255, 254, 10]);
  assert.deepEqual(await computers.putUpload(seat, { name: '20261025120000-ab12-cv.pdf', data }), { code: 0 });
  assert.deepEqual(calls, [
    ['bringOut', seat, { script: 'echo the script' }],
    ['listUploads', seat],
    ['putUpload', seat, '20261025120000-ab12-cv.pdf', true, '000102fffe0a'],
  ]);
  // A file up to uploads.js's 25 MB fits in one call.
  const big = Buffer.alloc(25 * 1024 * 1024, 7);
  assert.deepEqual(await computers.putUpload(seat, { name: 'big.bin', data: big }), { code: 0 });

  // Only a plain name in uploads/, never a path, a hidden file or bytes that are not base64.
  for (const name of ['../x', 'a/b', '.part', '', 'x'.repeat(256), 'a\0b']) assert.equal(validate('putUpload', [seat, { name, data: 'YWJj' }]), false, name);
  assert.equal(validate('putUpload', [seat, { name: 'a.pdf', data: 'not base64!' }]), false);
  assert.equal(validate('putUpload', [seat, { name: 'a.pdf', data: 'YWJj', path: '/etc' }]), false);
  assert.equal(validate('bringOut', [seat, { script: '' }]), false);
  assert.equal(validate('bringOut', [seat, { script: 'x', image: 'evil' }]), false);
  assert.equal(validate('listUploads', [seat, '/etc']), false);
  assert.equal(validate('listUploads', ['desk']), false, 'a seat, not a bare bot');
});

test('a file uploaded into the bot\'s folder on the computer from its Workspace (#576) goes through the helper: putFile, bytes whole, an empty file too', async (t) => {
  const { createServer, validate } = require('../lib/docker-helper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-putfile-'));
  const socket = path.join(dir, 'helper.sock');
  const calls = [];
  const server = createServer({ updates: {}, computers: {
    putFile: async (seat, { script, data }) => { calls.push([seat, script, Buffer.isBuffer(data), data.toString('hex')]); return { code: 0, stdout: 'ok a.bin\n' }; },
  } });
  await new Promise((r) => server.listen(socket, r));
  const before = process.env.BOT_DOT_HELPER_SOCKET;
  process.env.BOT_DOT_HELPER_SOCKET = socket;
  t.after(async () => {
    if (before === undefined) delete process.env.BOT_DOT_HELPER_SOCKET; else process.env.BOT_DOT_HELPER_SOCKET = before;
    await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true });
  });
  const computers = require('../lib/helper-client').computers({});
  const seat = { bot: 'desk', screen: 2, name: 'Desk' };
  assert.deepEqual(await computers.putFile(seat, { script: 'cat > x', data: Buffer.from([0, 255, 10]) }), { code: 0, stdout: 'ok a.bin\n' });
  assert.deepEqual(await computers.putFile(seat, { script: 'cat > y', data: Buffer.alloc(0) }), { code: 0, stdout: 'ok a.bin\n' });
  assert.deepEqual(calls, [[seat, 'cat > x', true, '00ff0a'], [seat, 'cat > y', true, '']]);
  assert.equal(validate('putFile', [seat, { script: '', data: '' }]), false);
  assert.equal(validate('putFile', [seat, { script: 'x', data: 'not base64!' }]), false);
  assert.equal(validate('putFile', [seat, { script: 'x', data: '', path: '/etc' }]), false);
  assert.equal(validate('putFile', ['desk', { script: 'x', data: '' }]), false, 'a seat, not a bare bot');
});
