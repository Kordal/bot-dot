// The HTTP server never changes identity itself. This client reaches the supervisor over its
// private Unix socket; a configured but missing supervisor is an error, never a local fallback.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const cp = require('node:child_process');
const held = require('./held');
const MAX = 128 * 1024 * 1024;
// What a broker call was, for the log of slow ones (lib/held.js): the operation, whose, and the file it was on.
function callLabel(operation, payload) {
  const request = payload.request || {};
  const file = Array.isArray(request.args) && typeof request.args[0] === 'string' ? ` ${request.args[0].split('/').slice(-3).join('/')}` : '';
  return `broker ${operation}${request.op ? ` ${request.op}` : ''}${payload.principal ? ` of ${payload.principal}` : ''}${file}`;
}
function callSync(operation, payload = {}, { timeout = 120_000 } = {}) {
  return held.time(() => callLabel(operation, payload), () => callSyncUntimed(operation, payload, timeout), ['privilege-client.js', 'principal-fs.js']);
}
// One thread for every callSync, started at the first (ADR 144). The server's thread waits on its answer with
// Atomics.wait, so callSync stays synchronous for its callers, but no node process starts for each call.
let channel = null;
let nextId = 0;
function syncChannel() {
  if (channel) return channel;
  const { Worker, MessageChannel } = require('node:worker_threads');
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(path.join(__dirname, 'privilege-sync-worker.js'), { workerData: { flag, port: port2, max: MAX }, transferList: [port2], env: {} });
  worker.unref(); port1.unref();
  worker.on('error', (e) => { console.error(`[broker] the callSync thread failed: ${e.message}`); if (channel?.worker === worker) channel = null; });
  worker.on('exit', () => { if (channel?.worker === worker) channel = null; });
  channel = { worker, port: port1, flag };
  return channel;
}
function callSyncUntimed(operation, payload, timeout) {
  const { receiveMessageOnPort } = require('node:worker_threads');
  const c = syncChannel();
  const id = ++nextId;
  Atomics.store(c.flag, 0, 0);
  c.worker.postMessage({ id, socketPath: process.env.BOT_DOT_PRIVILEGE_SOCKET, request: JSON.stringify({ operation, ...payload }) });
  for (const end = Date.now() + timeout; ;) {
    const left = end - Date.now();
    if (left <= 0 || Atomics.wait(c.flag, 0, 0, left) === 'timed-out') {
      // A broker that never answers: the thread is dropped with its connection, which makes the broker stop the work.
      channel = null; c.worker.terminate().catch(() => {});
      throw new Error('The privilege broker took too long');
    }
    let got;
    while ((got = receiveMessageOnPort(c.port))) {
      if (got.message.id !== id) continue; // the late answer of a call that was given up on
      const response = got.message.message;
      if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
      return response.value;
    }
    Atomics.store(c.flag, 0, 0); // woken by an old answer only: wait on
  }
}
// The same without holding up the server: for the tools operations, which download and can take minutes.
// Past `timeout` the call is dropped, and with it the broker stops what it had started.
function call(operation, payload = {}, { timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [__filename, 'call'], { env: { BOT_DOT_PRIVILEGE_SOCKET: process.env.BOT_DOT_PRIVILEGE_SOCKET }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let late = false;
    const timer = setTimeout(() => { late = true; child.kill('SIGTERM'); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text) => { out += text; if (out.length > MAX) child.kill('SIGTERM'); });
    child.stderr.on('data', (text) => { err = (err + text).slice(-4096); });
    child.stdin.on('error', () => {});
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (late) return reject(new Error('The privilege broker took too long'));
      let response;
      try { response = JSON.parse(out); } catch { return reject(new Error(`Privilege broker failed: ${err || code}`)); }
      if (response.error) return reject(Object.assign(new Error(response.error.message), { code: response.error.code }));
      resolve(response.value);
    });
    child.stdin.end(JSON.stringify({ operation, ...payload }));
  });
}
function relay(request, options = {}) {
  const child = cp.spawn(process.execPath, [__filename, 'stream'], {
    env: { BOT_DOT_PRIVILEGE_SOCKET: process.env.BOT_DOT_PRIVILEGE_SOCKET },
    stdio: [options.stdio === 'ignore' || options.stdio?.[0] === 'ignore' ? 'ignore' : 'pipe', 'pipe', 'pipe', 'pipe'], detached: !!options.detached,
  });
  child.stdio[3].on('error', () => {});
  child.stdio[3].end(JSON.stringify(request));
  // SIGKILL cannot be handled by a relay; socket EOF still makes the supervisor kill the process group.
  return child;
}
// What botdot started ends with it: a Claude or a script left behind by a stopped server would work on
// with nobody to hear it. Docker and systemd end the whole group themselves; a plain `node server.js` does not.
const started = new Map(); // child -> whether it leads a process group of its own
function keep(child, detached) {
  if (!child.pid) return child; // it never started
  started.set(child, !!detached);
  child.on('exit', () => started.delete(child));
  return child;
}
process.on('exit', () => {
  for (const [child, group] of started) {
    try { if (group) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* already gone */ }
  }
});
// What one command of a bot may hold (ADR 131): the Docker helper knows the account's share, the server tells the broker.
let commandMemory = 0;
const setCommandMemory = (bytes) => { commandMemory = bytes; };
function spawn(command, args, options = {}) {
  if (!process.env.BOT_DOT_PRIVILEGE_SOCKET) {
    if (options.botdotPrincipal) throw new Error('Privilege broker is required');
    return keep(cp.spawn(command, args, options), options.detached);
  }
  if (!options.botdotPrincipal) throw new Error('A principal is required for brokered execution');
  return keep(relay({ operation: 'spawn', principal: options.botdotPrincipal, command, args, cwd: options.cwd, env: options.env, memory: commandMemory }, options), options.detached);
}
function spawnFsStream({ principal, op, args }) { return relay({ operation: 'fileStream', principal, request: { op, args } }); }
module.exports = { setCommandMemory, callSync, call, spawn, spawnFsStream };

if (require.main === module) {
  const streaming = process.argv[2] === 'stream';
  const fail = (e) => {
    if (streaming) process.stderr.write(`Privilege broker: ${e.message}\n`);
    else process.stdout.write(JSON.stringify({ error: { message: e.message, code: e.code } }));
    process.exitCode = 1;
  };
  let request;
  try { request = JSON.parse(fs.readFileSync(streaming ? 3 : 0, 'utf8')); } catch (e) { fail(e); return; }
  const socketPath = process.env.BOT_DOT_PRIVILEGE_SOCKET;
  if (!socketPath) { fail(new Error('Privilege broker socket is required')); return; }
  const socket = net.createConnection(socketPath);
  socket.setEncoding('utf8');
  let buf = ''; let finished = false;
  const send = (v) => { if (!socket.write(JSON.stringify(v) + '\n')) process.stdin.pause(); };
  socket.on('drain', () => { if (streaming) process.stdin.resume(); });
  process.stdout.on('drain', () => socket.resume());
  process.stderr.on('drain', () => socket.resume());
  socket.on('connect', () => {
    send(request);
    if (streaming) {
      process.stdin.on('data', (b) => send({ stdin: b.toString('base64') }));
      process.stdin.on('end', () => send({ end: true }));
      process.stdin.resume();
    }
  });
  socket.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > MAX) { socket.destroy(new Error('Privilege broker response too large')); return; }
    for (;;) {
      const i = buf.indexOf('\n'); if (i < 0) break;
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let message; try { message = JSON.parse(line); } catch (e) { socket.destroy(e); return; }
      if (!streaming) { finished = true; process.stdout.write(JSON.stringify(message)); socket.end(); }
      else if (message.stdout !== undefined) { if (!process.stdout.write(Buffer.from(message.stdout, 'base64'))) socket.pause(); }
      else if (message.stderr !== undefined) { if (!process.stderr.write(Buffer.from(message.stderr, 'base64'))) socket.pause(); }
      else if (message.error) { finished = true; fail(message.error); socket.end(); process.stdin.destroy(); }
      else if (message.exit !== undefined) { finished = true; process.exitCode = message.exit === null ? 1 : message.exit; socket.end(); process.stdin.destroy(); }
    }
  });
  socket.on('error', (e) => { finished = true; fail(e); process.stdin.destroy(); });
  socket.on('close', () => { if (!finished) fail(new Error('Privilege broker disconnected')); process.stdin.destroy(); });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => {
    if (!socket.destroyed) send({ signal });
    socket.end(); process.stdin.destroy();
  });
}
