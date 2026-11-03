// callSync reaches the broker from one thread of the server's own (ADR 144), not from a node process started for
// each call: on hq under gVisor that start cost 350-500 ms per call and held the server for seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const cp = require('node:child_process');

test('callSync answers from the broker, says its refusals, and starts no process', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-sync-'));
  const socket = path.join(dir, 'broker.sock');
  let silent = 0;
  const server = net.createServer((connection) => {
    connection.setEncoding('utf8');
    let buf = '';
    connection.on('data', (chunk) => {
      buf += chunk; const i = buf.indexOf('\n'); if (i < 0) return;
      const request = JSON.parse(buf.slice(0, i));
      if (request.operation === 'silent') { silent++; return; }
      if (request.operation === 'bad') return connection.end(JSON.stringify({ error: { message: 'Invalid principal', code: 'EACCES' } }) + '\n');
      connection.end(JSON.stringify({ value: { echo: request } }) + '\n');
    });
    connection.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const old = process.env.BOT_DOT_PRIVILEGE_SOCKET; process.env.BOT_DOT_PRIVILEGE_SOCKET = socket;
  t.after(() => { if (old === undefined) delete process.env.BOT_DOT_PRIVILEGE_SOCKET; else process.env.BOT_DOT_PRIVILEGE_SOCKET = old; });

  // The broker answers on this thread's event loop, which callSync holds: it runs in a child process here.
  const code = `
    const cp = require('node:child_process'); let spawned = 0;
    for (const k of ['spawnSync', 'spawn', 'execFileSync']) { const f = cp[k]; cp[k] = (...a) => { spawned++; return f(...a); }; }
    const c = require('./lib/privilege-client');
    const out = { first: c.callSync('files', { principal: 'b1', request: { op: 'statSync', args: ['/x'] } }) };
    const start = Date.now(); for (let i = 0; i < 100; i++) c.callSync('ping'); out.hundredMs = Date.now() - start;
    try { c.callSync('bad'); } catch (e) { out.refused = { message: e.message, code: e.code }; }
    try { c.callSync('silent', {}, { timeout: 300 }); } catch (e) { out.late = e.message; }
    out.after = c.callSync('ping');
    out.spawned = spawned;
    process.stdout.write(JSON.stringify(out));`;
  const child = cp.spawn(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, BOT_DOT_SLOW_SYNC_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
  const status = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(status, 0, stderr);
  const out = JSON.parse(stdout);
  assert.deepEqual(out.first, { echo: { operation: 'files', principal: 'b1', request: { op: 'statSync', args: ['/x'] } } });
  assert.deepEqual(out.refused, { message: 'Invalid principal', code: 'EACCES' });
  assert.deepEqual(out.after, { echo: { operation: 'ping' } });
  assert.equal(out.spawned, 0, 'no process is started for a call');
  assert.ok(out.hundredMs < 5000, `100 calls took ${out.hundredMs} ms`);
  assert.equal(out.late, 'The privilege broker took too long');
  assert.equal(silent, 1, 'the call that was given up on reached the broker');
  console.log(`100 calls: ${out.hundredMs} ms`);
});

test('callSync without a broker fails at once instead of waiting', () => {
  const code = `const c=require('./lib/privilege-client'); const s=Date.now(); try { c.callSync('ping'); process.exit(41); } catch(e) { process.stdout.write(JSON.stringify({ message: e.message, ms: Date.now()-s })); }`;
  const p = cp.spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, BOT_DOT_PRIVILEGE_SOCKET: '' }, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  const out = JSON.parse(p.stdout);
  assert.match(out.message, /socket is required/);
  assert.ok(out.ms < 5000);
});
