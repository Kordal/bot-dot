const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('policy changes stay ordered when an earlier Docker inspection is slow', async (t) => {
  const childProcess = require('node:child_process');
  const { promisify } = require('node:util');
  const { EventEmitter } = require('node:events');
  const { setImmediate } = require('node:timers/promises');
  const inspecting = Promise.withResolvers();
  const release = Promise.withResolvers();
  const applied = [];
  let inspected = false;
  // Docker is the external boundary. Hold its first inspection while subsequent CLI
  // calls may finish; no computer-module functions or queue internals are replaced.
  const originalExec = childProcess.execFile;
  const exec = (_cmd, _args, _opts, callback) => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => {};
    queueMicrotask(() => callback(null, '{}', ''));
    return child;
  };
  exec[promisify.custom] = async (_cmd, args) => {
    if (args[0] === 'inspect' && args.at(-1).includes('json .State.Status')) {
      if (!inspected) { inspected = true; inspecting.resolve(); await release.promise; }
      return { stdout: '"running"|"fixture"|"id"' };
    }
    if (args[0] === 'inspect' && args.at(-1).includes('user-version')) return { stdout: '2|1' };
    if (args[0] === 'inspect') return { stdout: 'true' };
    if (args[0] === 'exec' && args.includes('--privileged')) applied.push(args[args.indexOf('-c') + 1]);
    return { stdout: 'fixture' };
  };
  childProcess.execFile = exec;
  t.after(() => { childProcess.execFile = originalExec; delete require.cache[require.resolve('../lib/computers')]; });
  const computers = require('../lib/computers');
  const grant = computers.reconfigure('policy-race', 'lan');
  await inspecting.promise;
  const revoke = computers.reconfigure('policy-race', 'internet');
  await setImmediate(); // let unblocked Docker replies finish before releasing the earlier one
  release.resolve();
  await Promise.all([grant, revoke]);
  assert.ok(applied.length > 0);
  assert.match(applied.at(-1), /192\.168\.0\.0\/16/, 'the final firewall blocks LAN destinations');
});

test('the Docker helper accepts fixed computer operations and rejects arbitrary Docker requests', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-'));
  const socket = path.join(dir, 'helper.sock');
  const calls = [];
  const cleaned = { removed: 1, skipped: 2, failed: 0, bytes: 3 };
  const server = createServer({ computers: { inspect: async (id) => { calls.push(id); return { state: 'running' }; }, waiting: (id) => id === 'test-bot' }, updates: { clean: async (...args) => { calls.push(['clean', ...args]); return cleaned; } } });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = (value) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/call' }, (res) => {
      let data = ''; res.on('data', (b) => { data += b; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(JSON.stringify(value));
  });
  assert.equal((await call({ operation: 'inspect', args: ['test-bot'] })).data.value.state, 'running');
  // Whether a bot's computer waits for a free one (#471): its run says so.
  assert.equal((await call({ operation: 'waiting', args: ['test-bot'] })).data.value, true);
  for (const value of [
    { operation: 'exec', args: ['host', 'sh'] },
    { operation: 'inspect', args: ['../../host'] },
    { operation: 'waiting', args: ['../../host'] },
    { operation: 'waiting', args: ['test-bot', 'other'] },
    { operation: 'inspect', args: ['test-bot'], mounts: ['/:/host'] },
    { operation: 'ensure', args: ['test-bot', { image: 'evil', mounts: ['/:/host'] }] },
    { operation: 'reconfigure', args: ['test-bot', 'unrestricted'] },
    { operation: 'request', args: ['test-bot', '//evil.example/', {}] },
    { operation: 'constructor', args: [] },
    { operation: 'update.apply', args: [{ project: 'another-project' }] },
    // The cleanup takes no argument: which images go is the helper's rule, never the caller's.
    { operation: 'update.clean', args: ['ghcr.io/kordal/bot-dot:latest'] },
    { operation: 'update.clean', args: [{ force: true }] },
    { operation: 'update.prune', args: [] },
  ]) assert.equal((await call(value)).status, 400, JSON.stringify(value));
  assert.deepEqual((await call({ operation: 'update.clean', args: [] })).data.value, cleaned);
  assert.deepEqual(calls, ['test-bot', ['clean']]);
});

test('owner starts and live policy changes send the saved egress policy to the helper', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const { startServer, makeBot, heldRun, waitFor } = require('./helpers');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-policy-'));
  const socket = path.join(dir, 'helper.sock');
  const calls = [];
  let pendingStart, releaseStart, activePolicy = 'internet';
  const computers = {
    inspect: async () => ({ state: pendingStart ? 'none' : 'running' }),
    ensure: async (...args) => { calls.push(args); if (pendingStart) await pendingStart; activePolicy = args[1]; },
    reconfigure: async (...args) => { calls.push(args); if (pendingStart) await pendingStart; activePolicy = args[1]; },
    listAll: async () => ({}), setRestartPolicy: async () => {}, stop: async () => {},
    dockerStatus: async () => ({ ok: true, image: true }),
  };
  const helper = createServer({ computers, updates: { status: async () => ({ supported: true, available: false }) } });
  await new Promise((r) => helper.listen(socket, r));
  const srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
  t.after(async () => { releaseStart?.(); await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const bot = await makeBot(srv, { computer: 'linux', computerEgress: 'lan' });
  await heldRun(srv, bot);
  assert.equal((await srv.api(`/bots/${bot.id}/computer`, { method: 'POST', body: { action: 'start' } })).status, 200);
  assert.deepEqual(calls.at(-1), [bot.id, 'lan']);
  assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { computerEgress: 'internet' } })).status, 200);
  assert.deepEqual(calls.at(-1), [bot.id, 'internet']);
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { computerEgress: 'lan' } });
  calls.length = 0;
  pendingStart = new Promise((r) => { releaseStart = r; });
  const starting = srv.api(`/bots/${bot.id}/computer`, { method: 'POST', body: { action: 'start' } });
  await waitFor(() => calls.some(([, policy]) => policy === 'lan'), { timeout: 1000 });
  const changing = srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { computerEgress: 'internet' } });
  await waitFor(() => calls.some(([, policy]) => policy === 'internet'), { timeout: 1000, what: 'pending-start revocation reaching the helper' });
  releaseStart();
  assert.equal((await starting).status, 200);
  assert.equal((await changing).status, 200);
  assert.equal(activePolicy, 'internet');
});

test('owner edits preserve a manually started computer and explicit power changes still apply', async (t) => {
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
  for (const body of [{ computerEgress: 'lan' }, { computerEgress: 'internet' }, { description: 'Edited while the owner uses the computer' }]) {
    assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body })).status, 200);
    assert.equal(await status(), 'running', JSON.stringify(body));
  }
  for (const body of [{ computerEgress: 'lan' }, { prompt: 'Owner-approved wording change' }]) {
    const proposal = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body });
    assert.equal(proposal.status, 200);
    assert.ok(proposal.data.pendingChange);
    assert.equal((await srv.api(`/asks/${proposal.data.pendingChange}`, { method: 'POST', body: { yes: true } })).status, 200);
    assert.equal(await status(), 'running', 'approving a change must preserve manual power');
  }
  for (const [body, expected] of [[{ computerAlwaysOn: true }, 'running'], [{ computerAlwaysOn: false }, 'stopped'], [{ computerAlwaysOn: true }, 'running'], [{ computer: 'none' }, 'stopped']]) {
    assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body })).status, 200);
    await waitFor(async () => (await status()) === expected, { what: `explicit power change to ${expected}` });
  }
});
