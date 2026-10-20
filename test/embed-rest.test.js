// The built-in llama-server rests while meaning search goes unused (#151): botdot stops it after a while
// without a request, and the next request starts it again. A stand-in llama-server (a small Node script that
// answers /health and /v1/embeddings on the port it is given) plays the program.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { once } = require('events');

const STAND_IN = `#!/usr/bin/env node
const http = require('http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
require('fs').appendFileSync(process.env.STARTS_FILE, 'start\\n');
http.createServer(async (req, res) => {
  if (req.url === '/health') return res.end('{}');
  let raw = '';
  for await (const c of req) raw += c;
  const { input } = JSON.parse(raw);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: [1, 0, 0] })) }));
}).listen(port, '127.0.0.1');
`;

async function freePort() {
  const s = net.createServer().listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function embedder(t, idleMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-embed-rest-'));
  const bin = path.join(dir, 'llama-server');
  fs.writeFileSync(bin, STAND_IN, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'model.gguf'), 'x');
  const starts = path.join(dir, 'starts');
  const saved = { ...process.env };
  Object.assign(process.env, { EMBED_SERVER_BIN: bin, EMBED_MODEL_FILE: path.join(dir, 'model.gguf'), EMBED_PORT: String(await freePort()), STARTS_FILE: starts });
  delete process.env.EMBED_URL;
  delete require.cache[require.resolve('../lib/embed')]; // EMBED_PORT is read when it loads
  const e = require('../lib/embed').create(dir, { idleMs });
  t.after(() => {
    e.stop();
    for (const k of ['EMBED_SERVER_BIN', 'EMBED_MODEL_FILE', 'EMBED_PORT', 'STARTS_FILE', 'EMBED_URL']) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const startCount = () => (fs.existsSync(starts) ? fs.readFileSync(starts, 'utf8').split('\n').filter(Boolean).length : 0);
  return { e, startCount };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await wait(50); }
  assert.fail('timed out');
}

test('llama-server rests after a while without a request, and the next request starts it again', async (t) => {
  const { e, startCount } = await embedder(t, 400);
  await e.want(true);
  assert.equal((await e.status()).state, 'ready');
  assert.equal((await e.embed(['hello'])).length, 1);
  await until(async () => (await e.status()).state === 'resting');
  assert.equal(await e.ready(), false, 'resting: not ready at once, but woken');
  await until(async () => (await e.status()).state === 'ready');
  assert.equal(startCount(), 2);
  await until(async () => (await e.status()).state === 'resting');
  assert.equal((await e.embed(['again'])).length, 1, 'an embedding wakes it and waits for it');
  assert.equal(startCount(), 3);
});

test('requests keep it awake, and a caller may wait for it to wake', async (t) => {
  const { e, startCount } = await embedder(t, 400);
  await e.want(true);
  for (let i = 0; i < 6; i++) { await e.embed(['busy']); await wait(150); }
  assert.equal((await e.status()).state, 'ready', 'used every 150 ms, it never rested');
  assert.equal(startCount(), 1);
  await until(async () => (await e.status()).state === 'resting');
  assert.equal(await e.ready(5000), true);
  assert.equal(startCount(), 2);
});

test('switched off, it does not rest or start again', async (t) => {
  const { e, startCount } = await embedder(t, 200);
  await e.want(true);
  await e.want(false);
  await wait(400);
  assert.equal((await e.status()).state, 'off');
  assert.equal(await e.ready(), false);
  await wait(300);
  assert.equal(startCount(), 1);
});
