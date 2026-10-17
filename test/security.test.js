// The security audit's findings (issue #9) stay fixed: the Chief can't do the owner's part, whatever
// it sends, and bad requests get an answer without taking botdot down.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { startServer, makeBot, waitFor, ROOT } = require('./helpers');
const identity = require('../lib/identity');

let srv, chiefEnv;
before(async () => {
  srv = await startServer();
  // One Chief turn, to learn how its tools reach botdot (the stand-in Claude records its MCP settings).
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Hi' } });
  const rec = await srv.nextRun((x) => x.botdot, 'a Chief turn');
  chiefEnv = rec.botdot.env;
});
after(() => srv.stop());

const asChief = (p, opts = {}) => srv.api(p, { ...opts, headers: { 'X-Chief-Key': chiefEnv.BOT_DOT_CHIEF_KEY, ...opts.headers } });
const SCRIPT_JOB = { name: 'No-op', kind: 'script', cron: '0 0 1 1 *', script: ':', enabled: false, assessment: 'No AI needed.' };

// One tool call through the Chief's real MCP server, as Claude Code makes it.
function mcpCall(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'lib', 'mcp-server.js')], { env: { ...process.env, ...chiefEnv }, stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      const line = out.split('\n').find((l) => l.includes('"id":1'));
      if (line) { child.kill(); resolve(JSON.parse(line).result); }
    });
    child.on('error', reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })}\n`);
  });
}

test('S3: extra fields in a Chief tool call are refused', async () => {
  const r = await mcpCall('create_bot', { name: 'Audit probe', prompt: 'Do nothing', jobs: [SCRIPT_JOB] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /unknown field "jobs"/);
  assert.ok(!(await srv.api('/bots')).data.some((b) => b.name === 'Audit probe'), 'no bot was made');
});

test("S3: the Chief's script jobs wait for the owner, however they're sent", async () => {
  const created = await asChief('/bots', { method: 'POST', body: { name: 'Probe', prompt: 'Do nothing', jobs: [SCRIPT_JOB], _by: 'you' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.jobs[0].approved, false);
  const bot = created.data;
  const added = await asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { ...SCRIPT_JOB, alwaysApprove: true, _by: 'you' } });
  assert.equal(added.data.approved, false);
  assert.equal(added.data.alwaysApprove, false);
  // Approving is the owner's.
  const approve = await asChief(`/bots/${bot.id}/jobs/${added.data.id}/approve`, { method: 'POST', body: { _by: 'you' } });
  assert.equal(approve.status, 403);
  assert.equal((await srv.api(`/bots/${bot.id}/jobs/${added.data.id}/approve`, { method: 'POST', body: {} })).data.approved, true);
});

test('S3: the Chief can only use its own tools, not the owner controls', async () => {
  for (const [p, method] of [['/settings', 'GET'], ['/backups', 'GET'], ['/asks/x', 'POST'], ['/vault/requests/x', 'POST'], ['/memory/pending/x', 'POST'], ['/setup', 'PUT'], ['/updates/apply', 'POST']]) {
    const r = await asChief(p, { method, body: method === 'GET' ? undefined : {} });
    assert.equal(r.status, 403, `${method} ${p}`);
  }
  assert.equal((await asChief('/bots')).status, 200);
  // Of the settings, only quiet hours are the Chief's.
  const q = await asChief('/settings/quiet-hours', { method: 'PUT', body: { start: 23 } });
  assert.equal(q.status, 200);
  assert.equal(q.data.quietHours.start, 23);
  assert.equal((await asChief('/settings/quiet-hours', { method: 'PUT', body: { start: 24 } })).status, 400);
  // No checks at all is for the owner to switch on.
  const bot = await makeBot(srv);
  const r = await asChief(`/bots/${bot.id}`, { method: 'PUT', body: { ...bot, permissionMode: 'bypassPermissions' } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /only be set by the user/);
});

test('S3: a wrong Chief key is just the owner without the key (it can’t be guessed into)', async () => {
  const r = await srv.api('/bots', { method: 'POST', body: { name: 'Owner bot', prompt: 'x', jobs: [SCRIPT_JOB] }, headers: { 'X-Chief-Key': 'wrong' } });
  assert.equal(r.data.jobs[0].approved, true);
});

// A raw HTTP request, to send what fetch won't. Resolves with the status line.
function raw(text) {
  return new Promise((resolve) => {
    const s = net.connect(srv.port, '127.0.0.1', () => s.write(text));
    let out = '';
    s.on('data', (c) => { out += c; });
    s.on('close', () => resolve(out.split('\r\n')[0]));
    s.on('error', () => resolve(''));
    setTimeout(() => s.destroy(), 3000);
  });
}

test('S5: bad addresses and oversized bodies get an answer, and botdot keeps running', async () => {
  assert.match(await raw('GET /%zz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'), / 400 /);
  assert.match(await raw('GET //x HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'), /^HTTP\/1.1 \d{3} /);
  assert.match(await raw('GET /computer/abc/%zz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'), / 404 /);
  const big = await srv.api('/setup', { method: 'PUT', raw: Buffer.alloc(2e6, 32) });
  assert.equal(big.status, 413);
  assert.equal((await srv.api('/version')).status, 200);
  assert.equal(srv.log.join('').includes('URIError'), false);
});

test('pages come with the browser safety headers', async () => {
  const res = await fetch(`${srv.base}/`);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  await res.arrayBuffer();
});

// S2: the socket table lookup (identity.js) for the user behind a connection from this machine.
test('S2: every loopback address counts as this machine', () => {
  for (const a of ['127.0.0.1', '127.0.0.2', '127.255.1.9', '::1', '::ffff:127.0.0.2']) assert.equal(identity.isThisMachine(a), true, a);
  for (const a of ['100.64.1.2', '8.8.8.8', '::ffff:10.9.9.9']) assert.equal(identity.isThisMachine(a), false, a);
});

test('S2: the user is found by both ends of the connection, and never guessed', () => {
  const head = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
  const row = (local, rem, uid) => `   0: ${local} ${rem} 01 00000000:00000000 00:00000000 00000000 ${uid}        0 1`;
  const tcp = [head,
    row('0100007F:128B', '0200007F:D431', 0), // botdot's own end of the connection
    row('0200007F:D431', '0100007F:128B', 61000), // the bot's end: 127.0.0.2:54321 → 127.0.0.1:4747
    row('0100007F:D431', '0100007F:1F90', 0), // same client port, another connection
  ].join('\n');
  assert.equal(identity.uidInTables([tcp, ''], '127.0.0.2', 54321, '127.0.0.1', 4747), 61000);
  assert.equal(identity.uidInTables([tcp, ''], '127.0.0.3', 54321, '127.0.0.1', 4747), null, 'not there: unknown');
  const tcp6 = [head, row('0000000000000000FFFF00000200007F:D431', '0000000000000000FFFF00000100007F:128B', 61001)].join('\n');
  assert.equal(identity.uidInTables(['', tcp6], '::ffff:127.0.0.2', 54321, '::ffff:127.0.0.1', 4747), 61001);
  const two = [head, row('0200007F:D431', '0100007F:128B', 61000), row('0200007F:D431', '0100007F:128B', 61001)].join('\n');
  assert.equal(identity.uidInTables([two], '127.0.0.2', 54321, '127.0.0.1', 4747), null, 'ambiguous: unknown');
});

test('S2: the Chief key reaches only the Chief', async () => {
  assert.match(chiefEnv.BOT_DOT_CHIEF_KEY, /^[0-9a-f]{48}$/);
  const bot = await makeBot(srv, { name: 'Key check' });
  await waitFor(async () => (await srv.api(`/bots/${bot.id}`)).status === 200);
  const { heldRun } = require('./helpers');
  const { rec, run } = await heldRun(srv, bot);
  assert.equal(JSON.stringify(rec.self).includes(chiefEnv.BOT_DOT_CHIEF_KEY), false);
  srv.release(rec);
  await srv.finished(run.id);
});
