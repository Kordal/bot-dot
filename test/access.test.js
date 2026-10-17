// Who may use a botdot server (seam 2, ADR 028): its account's owner only through the front door's socket, with
// the account the front door names; the Chief's tools with its key, and a bot's tools with its run's key. The old
// ways in (any user of the machine, a Tailscale login, the Mac owner key) are gone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('http');
const { startServer, makeBot, heldRun, self, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_ALLOWED_HOSTS: 'my-vm.example.ts.net', FUTURE_SERVICE_KEY: 'also-private' } }); });
after(() => srv.stop());

// A request straight to the botdot server's own port, as anything on its machine could send it.
const overTcp = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: srv.botdotPort, path, method, headers }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
  });
  req.on('error', reject);
  req.end();
});
// A request on the front door's socket, naming an account (or none).
const overSocket = (path, account, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ socketPath: srv.socket, path, headers: { Host: 'botdot.example.com', ...(account ? { 'X-Botdot-Account': account } : {}), ...headers } }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

test("through the front door's socket, the account it names is the owner", async () => {
  const r = await overSocket('/api/bots', srv.account);
  assert.equal(r.status, 200, r.body);
  assert.equal((await overSocket('/', srv.account)).status, 200, 'the web page too');
});

test('the socket refuses another account, or none', async () => {
  const other = await overSocket('/api/bots', 'someone-else');
  assert.equal(other.status, 403);
  assert.match(other.body, /another account/);
  assert.equal((await overSocket('/api/bots', null)).status, 403);
});

test('the front door names the host: any is taken on the socket', async () => {
  assert.equal((await overSocket('/api/bots', srv.account, { Host: 'whatever.example' })).status, 200);
});

test("the owner's requests that skip the front door are refused", async () => {
  for (const headers of [{}, { Host: 'my-vm.example.ts.net', 'Tailscale-User-Login': 'owner@example.com', 'X-Forwarded-For': '100.64.0.9' }, { 'X-Botdot-Account': srv.account }, { 'X-Owner-Key': 'anything' }]) {
    const r = await overTcp('/api/bots', headers);
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.match(r.body, /front door/);
  }
  assert.equal((await overTcp('/')).status, 403, 'the web page too');
  assert.equal((await overTcp('/api/backups')).status, 403);
});

test('the Mac owner key and its one-time link are gone', async () => {
  assert.equal((await overTcp('/owner-login?code=abc')).status, 403);
  const link = await srv.api('/owner/link', { method: 'POST' });
  assert.equal(link.status, 404);
});

test('the version answers on the port, for the image healthcheck', async () => {
  const r = await overTcp('/api/version');
  assert.equal(r.status, 200);
  const command = fs.readFileSync(require('node:path').join(__dirname, '../Dockerfile'), 'utf8').match(/^\s+CMD (curl[^\n]+)$/m)?.[1];
  assert.ok(command, 'image healthcheck command exists');
  const result = require('node:child_process').spawnSync('/bin/sh', ['-c', command], { env: { ...process.env, PORT: String(srv.botdotPort) }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});

test('features announce accounts and passkey sign-in', async () => {
  const { features } = (await srv.api('/version')).data;
  assert.ok(features.includes('accounts'));
  assert.ok(features.includes('passkeys'));
});

test("the socket's folder is private to the botdot server, and the folder is what keeps others out", () => {
  // The front door runs as another user (install.sh lets it through the folder alone), so the socket itself is open.
  assert.equal(fs.statSync(require('node:path').dirname(srv.socket)).mode & 0o077, 0);
  assert.equal(fs.statSync(srv.socket).mode & 0o777, 0o666);
});

test('a socket folder that everyone may enter is refused, and nobody reaches the owner through it', async () => {
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-test-'));
  fs.mkdirSync(path.join(dir, 'fd', 'tester'), { recursive: true, mode: 0o755 });
  fs.chmodSync(path.join(dir, 'fd', 'tester'), 0o755);
  const open = await startServer({ dir, wait: false });
  try {
    await waitFor(() => open.log.join('').includes('everyone on this machine could enter'), { what: 'the refusal' });
    assert.equal(fs.existsSync(path.join(dir, 'fd', 'tester', 'botdot.sock')), false, 'no socket is made there');
  } finally { await open.stop(); }
});

test("the Chief's tools get in on the port with their own key", async () => {
  assert.equal((await overTcp('/api/bots', { 'X-Chief-Key': srv.chiefKey })).status, 200);
  assert.equal((await overTcp('/api/bots', { 'X-Chief-Key': 'guess' })).status, 403);
});

test('changes need the X-Bot-Dot header (no cross-site requests)', async () => {
  const r = await srv.api('/bots', { method: 'POST', body: { name: 'X', prompt: 'x' }, headers: { 'X-Bot-Dot': '' } });
  assert.ok(r.status >= 400, `refused (${r.status})`);
});

test("a bot's tools need its own run's key, and it expires with the run", async () => {
  const bot = await makeBot(srv);
  assert.equal((await self(srv, 'made-up', 'teammates')).status, 403);
  assert.equal((await srv.api('/vault/session/logins', { headers: { 'X-Vault-Token': 'made-up' } })).status, 403);
  const { rec, run, token } = await heldRun(srv, bot);
  assert.equal((await self(srv, token, 'teammates')).data.ok, true);
  srv.release(rec);
  await srv.finished(run.id);
  assert.equal((await self(srv, token, 'teammates')).status, 403, 'the key ends with the run');
  srv.unhold();
});

test('spawned bots and the Chief receive no server keys, including future key names', async () => {
  const bot = await srv.api('/bots', { method: 'POST', body: { name: 'Environment probe', prompt: 'Check environment' } });
  assert.equal(bot.status, 201);
  await srv.api(`/bots/${bot.data.id}/run`, { method: 'POST', body: {} });
  const botRun = await srv.nextRun((r) => !!r.self);
  assert.deepEqual(botRun.keyNames, []);
  assert.deepEqual(botRun.procKeyNames, []);
  const chat = await srv.api('/chief/chats', { method: 'POST' });
  await srv.api(`/chief/chats/${chat.data.id}/messages`, { method: 'POST', body: { text: 'Check environment' } });
  const chiefRun = await srv.nextRun((r) => !!r.botdot);
  assert.deepEqual(chiefRun.keyNames, []);
  assert.deepEqual(chiefRun.procKeyNames, []);
});
