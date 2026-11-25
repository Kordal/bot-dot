// lib/embed-share.js (ADR 275): the proxy in front of the machine's one llama-server. A socket for each account's folder,
// only /health and /v1/embeddings let through, the accounts taking turns at the slots, and nothing kept. A stub
// llama-server on a port stands in for the real one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { create, scheduler, SOCKET_NAME } = require('../lib/embed-share');

const dirs = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The stub llama-server. `held`: requests it has not answered yet, answered by hand with answer(); `seen`: what it was asked.
async function llama(t, { hold = false, status = 200 } = {}) {
  const seen = [];
  const held = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    seen.push({ method: req.method, url: req.url, body: raw, headers: req.headers });
    const respond = () => {
      if (req.url.startsWith('/health')) { res.writeHead(status, { 'Content-Type': 'application/json' }); return res.end('{"status":"ok"}'); }
      const input = JSON.parse(raw).input;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: [text.length, 0, 0] })) }));
    };
    if (hold && !req.url.startsWith("/health")) held.push({ respond, req, res }); else respond();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; });
  return { port: server.address().port, seen, held };
}

// Asking over a socket: { status, json }.
function ask(file, method, url, body, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath: file, path: url, method, agent: false, signal, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, text, json }); });
    });
    req.on('error', reject);
    req.end(data);
  });
}

// A proxy over a folder that has the accounts' folders already.
async function proxy(t, accounts, options = {}) {
  const sockets = dirs(t);
  for (const a of accounts) fs.mkdirSync(path.join(sockets, a));
  const stub = options.stub || (await llama(t));
  const share = create({ socketsDir: sockets, upstreamPort: stub.port, scanMs: 50, log: () => {}, ...options.share });
  share.start();
  t.after(() => share.stop());
  const file = (a) => path.join(sockets, a, SOCKET_NAME);
  // Open to everyone (mode 666) is the last thing it does to a socket.
  const open = (a) => { try { return (fs.statSync(file(a)).mode & 0o777) === 0o666; } catch { return false; } };
  for (const a of accounts) for (let i = 0; i < 200 && !open(a); i++) await sleep(10);
  return { sockets, share, stub, file };
}

test('each account folder gets a socket, anyone may connect to it (the folder decides who may enter), and a folder made later gets one', async (t) => {
  const { sockets, share, file } = await proxy(t, ['ann', 'bob']);
  assert.deepEqual(share.accounts().sort(), ['ann', 'bob']);
  for (const a of ['ann', 'bob']) assert.equal(fs.statSync(file(a)).mode & 0o777, 0o666);
  fs.mkdirSync(path.join(sockets, 'carl'));
  for (let i = 0; i < 200 && !share.accounts().includes('carl'); i++) await sleep(10);
  await sleep(20);
  assert.ok(fs.existsSync(file('carl')), 'a new account\'s socket appears by itself');
  assert.equal((await ask(file('carl'), 'GET', '/health')).status, 200);
});

test('a folder that is deleted loses its socket, and a socket that is removed is made again', async (t) => {
  const { sockets, share, file } = await proxy(t, ['ann', 'bob']);
  fs.rmSync(path.join(sockets, 'bob'), { recursive: true });
  for (let i = 0; i < 100 && share.accounts().includes('bob'); i++) await sleep(10);
  assert.deepEqual(share.accounts(), ['ann'], 'bob\'s listener is closed');
  fs.rmSync(file('ann'));
  for (let i = 0; i < 200 && !(fs.existsSync(file('ann')) && share.accounts().includes('ann')); i++) await sleep(10);
  assert.equal((await ask(file('ann'), 'GET', '/health')).status, 200, 'ann\'s socket is back');
});

test('a stale socket file left by a service that stopped is replaced when it starts', async (t) => {
  const sockets = dirs(t);
  fs.mkdirSync(path.join(sockets, 'ann'));
  fs.writeFileSync(path.join(sockets, 'ann', SOCKET_NAME), '');
  const stub = await llama(t);
  const share = create({ socketsDir: sockets, upstreamPort: stub.port, scanMs: 50, log: () => {} });
  share.start();
  t.after(() => share.stop());
  for (let i = 0; i < 100 && !share.accounts().includes('ann'); i++) await sleep(10);
  assert.equal((await ask(path.join(sockets, 'ann', SOCKET_NAME), 'GET', '/health')).status, 200);
});

test('health and embeddings go to llama-server and its answer comes back; nothing else of its is let through', async (t) => {
  const { file, stub } = await proxy(t, ['ann']);
  const health = await ask(file('ann'), 'GET', '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.json, { status: 'ok' });
  const done = await ask(file('ann'), 'POST', '/v1/embeddings', { input: ['abc', 'de'], model: 'bge-m3' });
  assert.equal(done.status, 200);
  assert.deepEqual(done.json.data.map((d) => d.embedding[0]), [3, 2]);
  assert.deepEqual(JSON.parse(stub.seen.at(-1).body), { input: ['abc', 'de'], model: 'bge-m3' });
  const before = stub.seen.length;
  for (const [method, url] of [['GET', '/slots'], ['GET', '/props'], ['GET', '/metrics'], ['POST', '/completion'], ['POST', '/v1/chat/completions'], ['POST', '/slots/0?action=erase'], ['GET', '/v1/embeddings'], ['DELETE', '/v1/embeddings'], ['GET', '/health/x'], ['GET', '/']]) {
    const refused = await ask(file('ann'), method, url, method === 'POST' ? {} : undefined);
    assert.equal(refused.status, 404, `${method} ${url}`);
  }
  assert.equal(stub.seen.length, before, 'none of them reached llama-server');
  assert.equal((await ask(file('ann'), 'GET', '/health?x=1')).status, 200, 'a query string on the health check is fine');
});

test('only the caller\'s own headers stay behind: llama-server is told the body and its type, nothing the account sent', async (t) => {
  const { file, stub } = await proxy(t, ['ann']);
  await new Promise((resolve, reject) => {
    const req = http.request({ socketPath: file('ann'), path: '/v1/embeddings', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret', 'X-Evil': '1', 'X-Forwarded-For': '9.9.9.9' } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end('{"input":["x"]}');
  });
  const headers = stub.seen.at(-1).headers;
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers.authorization, undefined);
  assert.equal(headers['x-evil'], undefined);
  assert.equal(headers['x-forwarded-for'], undefined);
});

test('llama-server down: embeddings and health answer 502 with a reason', async (t) => {
  const down = http.createServer();
  down.listen(0, '127.0.0.1');
  await once(down, 'listening');
  const { port } = down.address();
  down.close();
  await once(down, 'close');
  const { file } = await proxy(t, ['ann'], { stub: { port } });
  for (const [method, url, body] of [['GET', '/health'], ['POST', '/v1/embeddings', { input: ['a'] }]]) {
    const r = await ask(file('ann'), method, url, body);
    assert.equal(r.status, 502, url);
    assert.match(r.json.error.message, /not running/);
  }
});

test('llama-server still loading answers 503 on health, which reaches the account as not ready', async (t) => {
  const { file } = await proxy(t, ['ann'], { stub: await llama(t, { status: 503 }) });
  assert.equal((await ask(file('ann'), 'GET', '/health')).status, 503);
});

test('too much text in one request is refused before llama-server sees it', async (t) => {
  const { file, stub } = await proxy(t, ['ann']);
  const big = Buffer.alloc(17 * 1024 * 1024, 'a');
  let status;
  try { status = (await ask(file('ann'), 'POST', '/v1/embeddings', big)).status; } catch (e) { status = e.code; } // the socket may be cut as it is refused
  assert.ok(status === 413 || status === 'ECONNRESET' || status === 'EPIPE', String(status));
  assert.equal(stub.seen.length, 0);
});

test('the slots are taken in turns: one account\'s long queue does not hold up another', () => {
  const s = scheduler(1);
  const order = [];
  const want = (account, name) => s.acquire(account).promise.then((release) => { order.push(name); return release; });
  const a1 = want('ann', 'a1');
  const a2 = want('ann', 'a2');
  const a3 = want('ann', 'a3');
  const b1 = want('bob', 'b1');
  const c1 = want('carl', 'c1');
  return Promise.resolve().then(async () => {
    (await a1)(); await sleep(0);
    (await a2)(); await sleep(0);
    (await b1)(); await sleep(0);
    (await c1)(); await sleep(0);
    (await a3)();
    assert.deepEqual(order, ['a1', 'a2', 'b1', 'c1', 'a3'], 'ann\'s third waits for bob and carl, who asked after her');
    assert.equal(s.active(), 0);
    assert.equal(s.waiting(), 0);
  });
});

test('a request that gave up leaves the queue, and a slot is released once however often', async () => {
  const s = scheduler(1);
  const first = await s.acquire('ann').promise;
  const gone = s.acquire('ann');
  const next = s.acquire('bob');
  assert.equal(s.waiting(), 2);
  gone.cancel();
  assert.equal(s.waiting(), 1);
  first(); first(); first();
  const release = await next.promise;
  assert.equal(s.active(), 1, 'released once: one slot taken by bob');
  release();
  assert.equal(s.active(), 0);
  // A cancel after the slot was given changes nothing.
  const taken = s.acquire('ann');
  const r = await taken.promise;
  taken.cancel();
  assert.equal(s.active(), 1);
  r();
});

test('through the proxy a second account is served while the first has all the slots queued, and a caller that stops waiting is not sent on', async (t) => {
  const stub = await llama(t, { hold: true });
  const { file } = await proxy(t, ['ann', 'bob'], { stub, share: { slots: 2 } });
  const texts = (n) => ({ input: [`t${n}`] });
  const ann = [1, 2, 3, 4].map((n) => ask(file('ann'), 'POST', '/v1/embeddings', texts(n)));
  for (let i = 0; i < 100 && stub.held.length < 2; i++) await sleep(10);
  assert.equal(stub.held.length, 2, 'llama-server has two at once, the slots; two of ann\'s wait in the proxy');
  const abort = new AbortController();
  const impatient = ask(file('ann'), 'POST', '/v1/embeddings', texts(5), { signal: abort.signal }).catch((e) => e.name);
  const bob = ask(file('bob'), 'POST', '/v1/embeddings', texts(6));
  await sleep(50);
  abort.abort();
  assert.equal(await impatient, 'AbortError');
  // One of ann's two finishes: the turn goes to ann's next, then to bob, then to ann again.
  const next = async (name) => {
    stub.held.shift().respond();
    for (let i = 0; i < 100 && JSON.parse(stub.seen.at(-1).body).input[0] === name.before; i++) await sleep(10);
    for (let i = 0; i < 100 && stub.held.length < 2; i++) await sleep(10);
    return JSON.parse(stub.seen.at(-1).body).input[0];
  };
  assert.equal(await next({ before: 't2' }), 't3');
  assert.equal(await next({ before: 't3' }), 't6', 'bob is next, although ann asked for four before him');
  assert.equal(await next({ before: 't6' }), 't4');
  while (stub.held.length || stub.seen.filter((x) => x.url === '/v1/embeddings').length < 5) { stub.held.shift()?.respond(); await sleep(10); }
  await Promise.all([...ann, bob]);
  assert.ok(!stub.seen.some((s) => s.body.includes('"t5"')), 'the one that stopped waiting never reached llama-server');
});
