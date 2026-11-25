// lib/embed.js with EMBED_SOCKET (ADR 274): an account's botdot server on a machine with several reaches the machine's one
// shared embedding server through a Unix socket, and starts no llama-server of its own. A stub embedder listens on a
// socket in place of lib/embed-share.js and bge-m3.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const embed = require('../lib/embed');
const { scratchMemory } = require('./memory-helpers');
const { LOOKUP } = require('../lib/memory');

const NAMES = ['EMBED_SOCKET', 'EMBED_URL', 'EMBED_SERVER_BIN', 'EMBED_MODEL_FILE'];
// Environment for one test, put back after it.
function withEnv(t, values) {
  const before = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
  for (const k of NAMES) delete process.env[k];
  Object.assign(process.env, values);
  t.after(() => { for (const k of NAMES) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });
}
const folder = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// A stand-in for the shared server on a socket: texts that match `same` are the same vector, the rest another. `state`:
// { down } answers /health with 503, { hang } never answers a text; `seen` collects what it was asked.
async function listening(t, file, same = /./, state = {}) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/health') { res.writeHead(state.down ? 503 : 200); return res.end('{}'); }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (state.hang) return;
    const input = JSON.parse(raw).input;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: same.test(text) ? [3, 4, 0] : [0, 0, 2] })).reverse() }));
  });
  server.listen(file);
  await once(server, 'listening');
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; });
  return seen;
}

test('with EMBED_SOCKET the embedder asks the socket: health, normalised vectors in order, and the status says shared', async (t) => {
  withEnv(t, {});
  const file = path.join(folder(t), 'embed.sock');
  const seen = await listening(t, file, /pnpm/);
  process.env.EMBED_SOCKET = file;
  const e = embed.create(folder(t));
  assert.equal(await e.ready(), true);
  const [a, b] = await e.embed(['Use pnpm.', 'something else']);
  assert.deepEqual([...a].map((x) => +x.toFixed(3)), [0.6, 0.8, 0], 'normalised, and in the order of the texts although the server answered in the other');
  assert.deepEqual([...b].map((x) => +x.toFixed(3)), [0, 0, 1]);
  assert.deepEqual(seen, ['GET /health', 'POST /v1/embeddings']);
  const s = await e.status();
  assert.equal(s.server, 'shared');
  assert.equal(s.state, 'ready');
  assert.equal(s.address, `unix:${file}`);
  assert.equal(s.binary, null);
  assert.equal(s.modelFile, null);
  assert.equal(s.error, null);
});

test('with EMBED_SOCKET no llama-server is started, whatever is switched on, and nothing is downloaded', async (t) => {
  const dir = folder(t);
  const marker = path.join(dir, 'started');
  const bin = path.join(dir, 'llama-server');
  fs.writeFileSync(bin, `#!/bin/sh\ntouch '${marker}'\nsleep 30\n`, { mode: 0o755 });
  const model = path.join(dir, 'model.gguf');
  fs.writeFileSync(model, 'x');
  const file = path.join(dir, 'embed.sock');
  withEnv(t, { EMBED_SOCKET: file, EMBED_SERVER_BIN: bin, EMBED_MODEL_FILE: model });
  await listening(t, file);
  const data = folder(t);
  const e = embed.create(data);
  await e.want(true);
  await e.ready();
  await e.embed(['a']);
  await e.download();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!fs.existsSync(marker), 'the program was never run');
  assert.ok(!fs.existsSync(path.join(data, 'models')), 'and no model was downloaded');
  assert.equal((await e.status()).server, 'shared');
  e.stop();
});

test('a socket nothing listens on is unreachable: not ready, the embedding fails, and the status says so', async (t) => {
  const dir = folder(t);
  withEnv(t, { EMBED_SOCKET: path.join(dir, 'gone.sock') });
  const e = embed.create(folder(t));
  assert.equal(await e.ready(), false);
  await assert.rejects(e.embed(['a']));
  const s = await e.status();
  assert.deepEqual([s.server, s.state], ['shared', 'unreachable']);
  // A socket left behind by a service that stopped refuses the connection the same way.
  const stale = path.join(dir, 'stale.sock');
  const server = http.createServer();
  server.listen(stale);
  await once(server, 'listening');
  server.close();
  await once(server, 'close');
  process.env.EMBED_SOCKET = stale;
  assert.equal(await e.ready(), false);
});

test('a shared server that is loading answers not ready, one that never answers ends at the timeout, and a refusal says why', async (t) => {
  const dir = folder(t);
  const file = path.join(dir, 'embed.sock');
  withEnv(t, { EMBED_SOCKET: file });
  const state = { down: true };
  await listening(t, file, /./, state);
  const e = embed.create(folder(t));
  assert.equal(await e.ready(), false);
  assert.equal((await e.status()).state, 'unreachable');
  state.down = false;
  assert.equal(await e.ready(), true);
  state.hang = true;
  const t0 = Date.now();
  await assert.rejects(e.embed(['a'], 300));
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms: the timeout ends the whole request`);
});

test('an explicit EMBED_URL is used before EMBED_SOCKET', async (t) => {
  const dir = folder(t);
  const file = path.join(dir, 'embed.sock');
  const socketSeen = await listening(t, file);
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('{}'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; });
  withEnv(t, { EMBED_SOCKET: file, EMBED_URL: `http://127.0.0.1:${server.address().port}` });
  const e = embed.create(folder(t));
  assert.equal((await e.status()).server, 'external');
  assert.equal(await e.ready(), true);
  assert.deepEqual(socketSeen, []);
});

test('without the variable the embedder is its own, as before', async (t) => {
  withEnv(t, {});
  const e = embed.create(folder(t));
  assert.equal((await e.status()).server, 'built-in');
});

test('llama-server\'s arguments: one slot as an account\'s own, and several slots that each keep the whole 8,192 tokens', () => {
  const own = embed.llamaArgs({ model: '/m.gguf', port: 8089, threads: 2 });
  assert.deepEqual(own.slice(own.indexOf('-c'), own.indexOf('-c') + 2), ['-c', '8192']);
  assert.deepEqual(own.slice(own.indexOf('--parallel'), own.indexOf('--parallel') + 2), ['--parallel', '1']);
  const shared = embed.llamaArgs({ model: '/m.gguf', port: 8089, threads: 3, slots: 4 });
  assert.deepEqual(shared.slice(shared.indexOf('-c'), shared.indexOf('-c') + 2), ['-c', '32768']);
  assert.deepEqual(shared.slice(shared.indexOf('--parallel'), shared.indexOf('--parallel') + 2), ['--parallel', '4']);
  assert.deepEqual(shared.slice(shared.indexOf('-t'), shared.indexOf('-t') + 2), ['-t', '3']);
  assert.ok(shared.includes('--embedding') && shared.includes('127.0.0.1'), 'embeddings only, on the loopback');
});

// --- In memory search ---------------------------------------------------------------------------------------

test('memory search by meaning goes through the shared socket, is on by default there, and falls back to words when it is gone', async (t) => {
  const dir = folder(t);
  const file = path.join(dir, 'embed.sock');
  withEnv(t, { EMBED_SOCKET: file });
  const state = {};
  await listening(t, file, /pnpm|package manager/i, state);
  const { memory } = scratchMemory(t);
  assert.equal(memory.semanticSettings().enabled, true, 'on by default where the shared socket is set, without the program or the model');
  const pnpm = memory.addNote('alpha', 'Use pnpm.', { pinned: false }).note;
  const byWords = memory.addNote('alpha', 'The bike with the flat front wheel is the red one.', { pinned: false }).note;
  await memory.embedPending(20);
  const ask = async (text) => (await memory.relevantFor({ botId: 'alpha', text })).map((r) => r.id);
  assert.deepEqual(await ask('What package manager do I prefer?'), [pnpm.id], 'by meaning, with no word in common');
  const status = await memory.semanticStatus();
  assert.deepEqual([status.server, status.state, status.enabled], ['shared', 'ready', true]);
  // The shared server is down: the lookup is by words alone and does not wait for it.
  state.down = true;
  const t0 = Date.now();
  assert.deepEqual(await ask('My bike has a flat tyre at the front'), [byWords.id], 'words alone');
  assert.ok(Date.now() - t0 < LOOKUP.embedMs, `${Date.now() - t0} ms`);
  // And the socket gone altogether.
  fs.rmSync(file);
  assert.deepEqual(await ask('Which bike has the flat front wheel?'), [byWords.id]);
  assert.equal((await memory.semanticStatus()).state, 'unreachable');
});
