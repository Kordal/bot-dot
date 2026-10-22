#!/usr/bin/env node
// npm start / npm run dev (#71): botdot on this machine for development. botdot is only reached through its front
// door (ADR 028), so this starts both: the front door on http://localhost:<PORT> (default 4747) with one account
// and a setup key, as the Mac app's local server was, and the botdot server of that account behind it, on a free
// port of 127.0.0.1 that only the Chief's and the bots' tools use. Until the
// account has its passkey, it prints the sign-up link; after that, the address to sign in at.
//
//   node scripts/dev.js            serve (npm start)
//   node scripts/dev.js --watch    the same, the server restarted when its files change (npm run dev)
//
// BOT_DOT_DEV_DIR  the front door's data and the setup key (default ./.dev-data). The server's own data is
//                  BOT_DOT_DATA's, as with `node server.js` (default ./data). Every other variable goes to both.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const store = require('../lib/front-door/store');

const ROOT = path.join(__dirname, '..');
const ACCOUNT = 'owner';
const PORT = Number(process.env.PORT) || 4747;
const ORIGIN = `http://localhost:${PORT}`;
const DIR = path.resolve(process.env.BOT_DOT_DEV_DIR || path.join(ROOT, '.dev-data'));
const DOOR_DATA = path.join(DIR, 'front-door');
fs.mkdirSync(DOOR_DATA, { recursive: true, mode: 0o700 });

// The setup key opens the sign-up page until the account exists. Kept, so the link printed stays the same.
const KEY_FILE = path.join(DIR, 'setup-key');
let setupKey = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '';
if (!/^[A-Za-z0-9_-]{32,100}$/.test(setupKey)) {
  setupKey = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(KEY_FILE, setupKey, { mode: 0o600 });
}

// The socket's folder, in the temp folder: a socket's path may be at most about 100 characters, and a checkout's
// may be long. Only this user may enter it, or the server refuses to make its socket there.
const sockets = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-dev-'));
fs.mkdirSync(path.join(sockets, ACCOUNT), { mode: 0o700 });
const socket = path.join(sockets, ACCOUNT, 'botdot.sock');

const children = [];
function start(args, env) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
  child.on('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)));
  children.push(child);
  return child;
}
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGTERM');
  Promise.all(children.map((c) => (c.exitCode === null && c.signalCode === null ? new Promise((r) => c.on('exit', r)) : null))).then(() => {
    fs.rmSync(sockets, { recursive: true, force: true });
    process.exit(code);
  });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().on('error', reject).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
// Once the front door answers and the server has made its socket: where to go.
const answers = () => new Promise((resolve) => {
  if (!fs.existsSync(socket)) return resolve(false);
  http.get({ host: '127.0.0.1', port: PORT, path: '/api/version', headers: { Host: `localhost:${PORT}` } }, (res) => { res.resume(); resolve(res.statusCode === 200); })
    .on('error', () => resolve(false));
});
(async () => {
  start([...(process.argv.includes('--watch') ? ['--watch'] : []), 'server.js'], {
    PORT: String(await freePort()),
    BOT_DOT_ACCOUNT: ACCOUNT,
    BOT_DOT_FRONT_DOOR_SOCKET: socket,
  });
  start(['front-door.js'], {
    FRONT_DOOR_ORIGIN: ORIGIN,
    FRONT_DOOR_PORT: String(PORT),
    // Bots' interactive pages (#399): the next port, another origin than the front door's.
    FRONT_DOOR_SITES_ORIGIN: `http://localhost:${PORT + 1}`,
    FRONT_DOOR_SITES_PORT: String(PORT + 1),
    FRONT_DOOR_HOST: '127.0.0.1',
    FRONT_DOOR_DATA: DOOR_DATA,
    FRONT_DOOR_SOCKETS: sockets,
    FRONT_DOOR_ONE_ACCOUNT: ACCOUNT,
    FRONT_DOOR_SETUP_KEY: setupKey,
  });
  while (!stopping && !(await answers())) await new Promise((r) => setTimeout(r, 200));
  if (stopping) return;
  if (store.open(DOOR_DATA).accountCount()) console.log(`\nbotdot is running. Open ${ORIGIN} and sign in with your passkey.\n`);
  else console.log(`\nbotdot is running. Open ${ORIGIN}/sign-up/${setupKey} to make your passkey.\n`);
})();
