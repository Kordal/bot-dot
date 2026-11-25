// The machine's one shared embedding server (ADR 275): llama.cpp's llama-server with bge-m3, started once for every
// account on a botdot machine, and a small proxy in front of it that gives each account a Unix socket of its own.
// It runs in the machine's own Docker beside the front door (compose.front-door.yaml, the service `embed`), with no
// network: llama-server listens on this container's own 127.0.0.1, and the only ways in are the sockets.
//
//   <EMBED_SHARE_SOCKETS>/<account>/embed.sock
//
// install.sh makes each account's folder (owned by its botdot server's user, closed to everyone else, and open to this
// service's user alone) and mounts it in that account's botdot server, whose lib/embed.js reaches the socket with
// EMBED_SOCKET. This service looks for the folders every few seconds: a new account's socket appears, a deleted
// account's goes. An account can therefore only ever reach the socket in its own folder.
//
// What it lets through: GET /health and POST /v1/embeddings, nothing else of llama-server's. It keeps nothing: the
// text of a note passes through to llama-server and its vector comes back, and no body is written down or kept.
//
// Fair, so that one account's indexing never blocks another's lookup: llama-server has several slots (EMBED_SHARE_SLOTS,
// default 4), and a request waits here for a free one, the accounts taking turns. A request whose caller gave up (a
// lookup stops waiting after 1.5 s, LOOKUP.embedMs in lib/memory.js) leaves the queue, or is cancelled at llama-server.
//
// `node lib/embed-share.js --check` asks whether llama-server answers (the container's health check).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { llamaArgs, llama, threads, MODEL_FILE } = require('./embed');

const SOCKET_NAME = 'embed.sock';
const MAX_BODY = 16 * 1024 * 1024; // bge-m3 reads 8,192 tokens a text; this is far more than a batch of notes
const SCAN_MS = 2000;

// Slots taken in turns: acquire(account) resolves with a release function once one is free, the accounts that wait
// each served in turn. cancel() takes a request that gave up out of the queue.
function scheduler(slots) {
  const queues = new Map(); // account -> waiting requests, oldest first
  const ring = []; // the accounts that wait, in the order of their next turn
  let active = 0;
  function pump() {
    while (active < slots && ring.length) {
      const account = ring.shift();
      const queue = queues.get(account);
      const waiter = queue.shift();
      if (queue.length) ring.push(account); else queues.delete(account);
      active++;
      let released = false;
      waiter.resolve(() => { if (released) return; released = true; active--; pump(); });
    }
  }
  function acquire(account) {
    let waiter;
    const promise = new Promise((resolve) => { waiter = { resolve }; });
    if (!queues.has(account)) { queues.set(account, []); ring.push(account); }
    queues.get(account).push(waiter);
    pump();
    const cancel = () => {
      const queue = queues.get(account);
      const at = queue ? queue.indexOf(waiter) : -1;
      if (at < 0) return;
      queue.splice(at, 1);
      if (!queue.length) { queues.delete(account); ring.splice(ring.indexOf(account), 1); }
    };
    return { promise, cancel };
  }
  return { acquire, active: () => active, waiting: () => [...queues.values()].reduce((n, q) => n + q.length, 0) };
}

const refuse = (res, status, message) => {
  if (res.headersSent) return res.destroy();
  const body = JSON.stringify({ error: { message } });
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

// The proxy: a listener on each account's socket, in front of the llama-server on 127.0.0.1:upstreamPort.
//   socketsDir: where the accounts' folders are; slots: how many requests llama-server takes at once.
function create({ socketsDir, upstreamPort, slots = 4, scanMs = SCAN_MS, log = console.log }) {
  const turns = scheduler(slots);
  const listeners = new Map(); // account -> { server, file }
  let timer = null;
  let stopped = false;

  // One request to llama-server for `account`: at once for the health check, and after its turn for embeddings.
  function forward(account, req, res, body) {
    // Only the path goes on: nothing the account added to the address reaches llama-server.
    const upstream = { host: '127.0.0.1', port: upstreamPort, path: req.url.split('?')[0], method: req.method };
    let release = () => {};
    let out = null;
    let done = false;
    const finish = () => { if (done) return; done = true; release(); };
    const turn = body === null ? null : turns.acquire(account);
    // The caller gave up (or went): out of the queue, or llama-server is told to stop.
    res.on('close', () => { if (turn) turn.cancel(); if (out) out.destroy(); finish(); });
    const send = () => {
      if (res.destroyed) return finish();
      out = http.request(body === null ? upstream : { ...upstream, headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, (answer) => {
        const headers = { 'Content-Type': answer.headers['content-type'] || 'application/json' };
        if (answer.headers['content-length']) headers['Content-Length'] = answer.headers['content-length'];
        res.writeHead(answer.statusCode, headers);
        answer.pipe(res);
        answer.on('end', finish);
        answer.on('error', () => { finish(); res.destroy(); });
      });
      out.on('error', () => { finish(); refuse(res, 502, 'The embedding server is not running'); });
      out.end(body === null ? undefined : body);
    };
    if (turn) turn.promise.then((r) => { release = r; send(); }); else send();
  }

  function handle(account) {
    return (req, res) => {
      const url = req.url.split('?')[0];
      if (req.method === 'GET' && url === '/health') return forward(account, req, res, null);
      if (req.method !== 'POST' || url !== '/v1/embeddings') return refuse(res, 404, 'Not found');
      const chunks = [];
      let size = 0;
      let over = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { over = true; chunks.length = 0; req.pause(); refuse(res, 413, 'Too much text in one request'); res.once('finish', () => req.destroy()); return; }
        chunks.push(c);
      });
      req.on('end', () => { if (!over) forward(account, req, res, Buffer.concat(chunks)); });
      req.on('error', () => res.destroy());
    };
  }

  function open(account) {
    const file = path.join(socketsDir, account, SOCKET_NAME);
    const server = http.createServer(handle(account));
    // A socket nothing waits on: a request must not hold the account's connection for long.
    server.requestTimeout = 5 * 60_000;
    const entry = { server, file };
    listeners.set(account, entry);
    server.on('error', (e) => {
      // Its folder is not ready yet (install.sh makes it, then opens it to this service): the next scan tries again.
      if (listeners.get(account) === entry) listeners.delete(account);
      log(`Embedding socket of ${account}: ${e.code || e.message}`);
    });
    try { fs.rmSync(file, { force: true }); } catch { /* the folder is not ours yet */ }
    server.listen(file, () => {
      // Who may connect is decided by the folder, not the file.
      try { fs.chmodSync(file, 0o666); } catch (e) { log(`Embedding socket of ${account}: ${e.message}`); }
      log(`The embedding socket of ${account} is open`);
    });
  }

  function close(account) {
    const entry = listeners.get(account);
    listeners.delete(account);
    if (!entry) return;
    entry.server.close();
    entry.server.closeAllConnections();
  }

  // Open a socket for each account's folder that has none, close the one of a folder that is gone.
  function scan() {
    if (stopped) return;
    let names = [];
    try { names = fs.readdirSync(socketsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch { /* none yet */ }
    for (const account of [...listeners.keys()]) {
      // A folder that is gone, or whose socket someone removed: this one is closed (and opened again below if it can be).
      if (!names.includes(account) || !fs.existsSync(listeners.get(account).file)) {
        if (listeners.get(account).server.listening) close(account);
      }
    }
    for (const account of names) if (!listeners.has(account)) open(account);
  }

  function start() {
    scan();
    timer = setInterval(scan, scanMs);
    timer.unref?.();
  }
  function stop() {
    stopped = true;
    clearInterval(timer);
    for (const account of [...listeners.keys()]) close(account);
  }
  return { start, stop, scan, accounts: () => [...listeners.keys()].filter((a) => listeners.get(a).server.listening), turns };
}

// llama-server in this container, started again when it stops (a few seconds later, longer after each failure).
function runLlama({ port, slots, log = console.log }) {
  let child = null;
  let stopping = false;
  let failures = 0;
  async function start() {
    if (stopping) return;
    const bin = await llama.refresh();
    const model = [process.env.EMBED_MODEL_FILE, `/opt/models/${MODEL_FILE}`].find((p) => p && fs.existsSync(p));
    if (!bin || !model) {
      failures++;
      log(`Not started: ${!bin ? 'llama-server is not in this image' : 'the bge-m3 model file is not in this image'}.`);
      return setTimeout(start, 60_000).unref();
    }
    const started = Date.now();
    child = spawn(bin, llamaArgs({ model, port, threads: Number(process.env.EMBED_SHARE_THREADS) || threads(), slots }), {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, LD_LIBRARY_PATH: [path.dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
    });
    child.on('error', (e) => log(`llama-server did not start: ${e.message}`));
    child.on('exit', (code) => {
      child = null;
      if (stopping) return;
      failures = Date.now() - started > 60_000 ? 1 : failures + 1;
      const wait = Math.min(60_000, 2000 * 2 ** (failures - 1));
      log(`llama-server stopped (exit ${code}); starting it again in ${Math.round(wait / 1000)} s.`);
      setTimeout(start, wait).unref();
    });
  }
  start();
  return { stop() { stopping = true; if (child) try { child.kill('SIGTERM'); } catch { /* gone */ } } };
}

function main() {
  const port = Number(process.env.EMBED_PORT) || 8089;
  if (process.argv.includes('--check')) {
    http.get({ host: '127.0.0.1', port, path: '/health', timeout: 5000 }, (res) => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); })
      .on('error', () => process.exit(1)).on('timeout', () => process.exit(1));
    return;
  }
  const slots = Math.min(16, Math.max(1, Math.floor(Number(process.env.EMBED_SHARE_SLOTS)) || 4));
  const socketsDir = path.resolve(process.env.EMBED_SHARE_SOCKETS || '/sockets');
  const model = runLlama({ port, slots });
  const share = create({ socketsDir, upstreamPort: port, slots });
  share.start();
  const end = () => { share.stop(); model.stop(); process.exit(0); };
  process.once('SIGTERM', end);
  process.once('SIGINT', end);
  console.log(`The shared embedding server: ${slots} slots, sockets in ${socketsDir}`);
}

if (require.main === module) main();

module.exports = { create, scheduler, SOCKET_NAME };
