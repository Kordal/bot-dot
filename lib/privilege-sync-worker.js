// The thread behind privilege-client's callSync (ADR 144): it holds no state of its own, takes one request at a time,
// asks the broker over its socket and hands back the broker's one-line answer. The server's thread waits on `flag`
// meanwhile, so a call costs a socket round trip instead of a node process start (350-500 ms under gVisor on hq).
const net = require('node:net');
const { parentPort, workerData } = require('node:worker_threads');

const { flag, port, max } = workerData;
const answer = (id, message) => { port.postMessage({ id, message }); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };

parentPort.on('message', ({ id, socketPath, request }) => {
  let done = false;
  const finish = (message) => { if (done) return; done = true; answer(id, message); };
  const fail = (e) => finish({ error: { message: e.message, code: e.code } });
  if (!socketPath) return fail(new Error('Privilege broker socket is required'));
  const socket = net.createConnection(socketPath);
  socket.setEncoding('utf8');
  let buf = '';
  socket.on('connect', () => socket.write(request + '\n'));
  socket.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > max) { socket.destroy(); return fail(new Error('Privilege broker response too large')); }
    const i = buf.indexOf('\n'); if (i < 0) return;
    let message; try { message = JSON.parse(buf.slice(0, i)); } catch (e) { socket.destroy(); return fail(e); }
    socket.end();
    finish(message);
  });
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('Privilege broker disconnected')));
});
