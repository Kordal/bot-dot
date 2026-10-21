// The front door's test helpers: a real front door (front-door.js) on a free port with a scratch data folder,
// stand-in botdot servers on their accounts' sockets, and a browser with a cookie jar of its own.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const { waitFor, freePort } = require('./helpers');
const store = require('../lib/front-door/store');

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 3600_000;

// sockets: the folder of the accounts' sockets, when real botdot servers made theirs there (else one of its own).
async function startFrontDoor({ env = {}, sockets: socketsDir, tries = 3 } = {}) {
  // Short: a socket's path may be at most about 100 characters.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-'));
  const data = path.join(dir, 'data');
  const sockets = socketsDir || path.join(dir, 's');
  fs.mkdirSync(sockets, { recursive: true });
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const log = [];
  const child = spawn(process.execPath, ['front-door.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, FRONT_DOOR_PORT: String(port), FRONT_DOOR_ORIGIN: origin, FRONT_DOOR_DATA: data, FRONT_DOOR_SOCKETS: sockets, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => log.push(String(c)));
  child.stderr.on('data', (c) => log.push(String(c)));
  const exited = new Promise((r) => child.on('exit', r));
  const host = `localhost:${port}`;

  // One request as a browser sends it: Host is the front door's own name. A connection of its own each time: a kept-alive
  // one left idle by a slow test can be closed by the front door just as the next request goes out (socket hang up).
  const request = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { Host: host, ...(text ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(out); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text: out, data });
      });
    });
    req.on('error', reject);
    req.end(text);
  });

  function browser() {
    const jar = new Map();
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const keep = (r) => {
      for (const c of [].concat(r.headers['set-cookie'] || [])) {
        const [pair, ...attrs] = c.split(/;\s*/);
        const [k, v] = pair.split('=');
        if (attrs.some((a) => /^max-age=0$/i.test(a)) || v === '') jar.delete(k); else jar.set(k, v);
      }
      return r;
    };
    const send = async (method, p, body, headers = {}) => keep(await request(method, p, {
      body,
      headers: { ...(jar.size ? { Cookie: cookie() } : {}), ...(method === 'GET' ? {} : { 'X-Bot-Dot': '1' }), ...headers },
    }));
    return { cookie, get: (p, headers) => send('GET', p, undefined, headers), post: (p, body, headers) => send('POST', p, body, headers) };
  }

  // A WebSocket handshake; resolves with what came back first.
  const upgrade = (p, headers) => new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => {
      const lines = Object.entries({ Host: host, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers }).map(([k, v]) => `${k}: ${v}`);
      s.write(`GET ${p} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    });
    let got = '';
    s.on('data', (c) => { got += c; if (got.includes('\r\n\r\n')) { s.destroy(); resolve(got); } });
    s.on('error', reject);
    s.on('close', () => resolve(got));
  });

  const door = {
    port, origin, rpId: 'localhost', data, sockets, log, browser, request, upgrade,
    firstLink: null,
    // A new sign-up link, made `ageDays` ago.
    newLink({ ageDays = 0 } = {}) {
      const { url } = store.open(data).newSignUpLink({ origin, now: Date.now() - ageDays * DAY });
      return { url, path: new URL(url).pathname };
    },
    async stop() { if (child.exitCode === null) { child.kill('SIGTERM'); await exited; } },
  };
  // The free port was let go before the front door took it: under load another test's server can take it first.
  // Then the front door stops at once, and starts again on another port.
  const taken = () => child.exitCode !== null && /EADDRINUSE/.test(log.join(''));
  try {
    await waitFor(async () => {
      if (taken()) return true;
      try { return (await request('GET', '/api/version')).status === 200; } catch { return false; }
    }, { timeout: 15_000, what: 'the front door to start' });
  } catch (e) {
    child.kill('SIGKILL');
    throw new Error(`${e.message}\n${log.join('')}`);
  }
  if (taken()) {
    if (tries > 1) return startFrontDoor({ env, sockets: socketsDir, tries: tries - 1 });
    throw new Error(`The front door's port was taken\n${log.join('')}`);
  }
  const printed = log.join('').match(/https?:\/\/\S+\/sign-up\/\S+/);
  if (printed) door.firstLink = { url: printed[0], path: new URL(printed[0]).pathname };
  return door;
}

// A stand-in botdot server on `account`'s socket: answers every request with what it was sent, and keeps it, with
// its body. answer(req): [status, body] to answer instead, as a botdot server checking a call's key does.
function standIn(door, account, { answer = null } = {}) {
  const seen = [];
  const file = path.join(door.sockets, account, 'botdot.sock');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.rmSync(file, { force: true });
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      const [status, body] = answer?.(req) || [200, { account: req.headers['x-botdot-account'] || null, url: req.url, cookie: req.headers.cookie || null }];
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  server.on('upgrade', (req, socket) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, upgrade: true });
    socket.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nAccount: ${req.headers['x-botdot-account']}\r\n\r\n`);
  });
  return new Promise((resolve) => server.listen(file, () => resolve({ seen, file, close: () => server.close() })));
}

module.exports = { startFrontDoor, standIn };
