#!/usr/bin/env node
// A stand-in for botdot's relay, for the Selkies trial (#1737): every TCP connection to LISTEN is carried into the
// computer through `docker exec -i python3 -c <pipe>` to 127.0.0.1:<port> there, the way server.js and
// lib/computers.js carry a screen (screenPipe, PIPE_IN_COMPUTER, copied below). It forwards raw bytes, HTTP and
// WebSocket alike, so the same program shows noVNC (the screen's websockify) and Selkies, and counts what passes.
//
//   node trial-relay.cjs <container> <port in the computer> <listen port> [listen address]
//   node trial-relay.cjs selkies-trial 6111 4851     noVNC:   http://127.0.0.1:4851/vnc.html?autoconnect=1&path=websockify
//   node trial-relay.cjs selkies-trial 6211 4852     Selkies: http://127.0.0.1:4852/
//
// http://127.0.0.1 is a secure context, so WebCodecs and the clipboard work in the browser. For the Tailscale leg, put
// `tailscale serve` (HTTPS) in front of the listen port; plain http on a tailnet address is not a secure context.
const net = require('node:net');
const { spawn } = require('node:child_process');

const [container, port, listen, address = '127.0.0.1'] = process.argv.slice(2);
if (!container || !/^\d+$/.test(port || '') || !/^\d+$/.test(listen || '')) {
  console.error('usage: node trial-relay.cjs <container> <port in the computer> <listen port> [listen address]');
  process.exit(2);
}
// lib/computers.js PIPE_IN_COMPUTER, as it was on 2026-11-25.
const PIPE = `
import os, socket, sys, threading
s = socket.create_connection(('127.0.0.1', int(sys.argv[1])))
def up():
    while True:
        d = os.read(0, 65536)
        if not d:
            break
        s.sendall(d)
    try:
        s.shutdown(socket.SHUT_WR)
    except OSError:
        pass
threading.Thread(target=up, daemon=True).start()
out = sys.stdout.buffer
while True:
    d = s.recv(65536)
    if not d:
        break
    out.write(d)
    out.flush()
`;
let toComputer = 0;
let fromComputer = 0;
let open = 0;
net.createServer((socket) => {
  open += 1;
  const up = spawn('docker', ['exec', '-i', container, 'python3', '-c', PIPE, port], { stdio: ['pipe', 'pipe', 'ignore'] });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    open -= 1;
    socket.destroy();
    up.kill();
  };
  up.on('error', close);
  up.on('close', close);
  up.stdin.on('error', close);
  socket.on('error', close);
  socket.on('close', close);
  socket.on('data', (d) => { toComputer += d.length; });
  up.stdout.on('data', (d) => { fromComputer += d.length; });
  socket.pipe(up.stdin);
  up.stdout.pipe(socket);
}).listen(Number(listen), address, () => console.log(`relay on ${address}:${listen} -> ${container}:${port}`));

const EVERY = 5;
setInterval(() => {
  const kbit = (n) => ((n * 8) / EVERY / 1000).toFixed(0);
  console.log(`${new Date().toISOString()}  connections ${open}  to the computer ${kbit(toComputer)} kbit/s  from it ${kbit(fromComputer)} kbit/s`);
  toComputer = 0;
  fromComputer = 0;
}, EVERY * 1000).unref();
