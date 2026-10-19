// npm start (scripts/dev.js, #71): botdot on this machine for development, its server behind the real front door
// with one account and a setup key, as the Mac app's local server was. It prints the sign-up link; a passkey made
// there signs in, and the signed-in session reaches the server. Started again, it says to sign in instead.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { freePort, waitFor, ROOT } = require('./helpers');

async function launch(t, dir, port) {
  const log = [];
  const child = spawn(process.execPath, ['scripts/dev.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: path.join(dir, 'home'),
      PORT: String(port),
      BOT_DOT_DEV_DIR: path.join(dir, 'dev'),
      BOT_DOT_DATA: path.join(dir, 'data'),
      BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'),
      CLAUDE_BIN: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
      FAKE_OUT: path.join(dir, 'fake'),
      BW_BIN: path.join(dir, 'no-bitwarden'),
      EMBED_SERVER_BIN: path.join(dir, 'no-llama'),
      COMPOSIO_API_URL: 'http://127.0.0.1:9',
      COMPOSIO_AGENTS_URL: 'http://127.0.0.1:9',
      BOT_DOT_ANTHROPIC_API_URL: 'http://127.0.0.1:9',
      BOT_DOT_DRESS_WAITS: 'off',
      BOT_DOT_HELLO_DELAY_MS: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => log.push(String(c)));
  child.stderr.on('data', (c) => log.push(String(c)));
  const exited = new Promise((r) => child.on('exit', r));
  const stop = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await exited; } };
  t.after(stop);
  await waitFor(() => /Open http:\/\/localhost:\d+\S*/.test(log.join('')), { timeout: 20_000, what: 'the sign-in line' })
    .catch((e) => { throw new Error(`${e.message}\n${log.join('')}`); });
  return { log, stop, child, link: log.join('').match(/Open (http:\/\/localhost:\d+\S*)/)[1] };
}

// A browser on the front door: Host is its name, and it keeps its cookie.
function browser(port) {
  let cookie = '';
  const send = (method, p, body) => new Promise((resolve, reject) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = { Host: `localhost:${port}`, ...(cookie ? { Cookie: cookie } : {}), ...(text ? { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' } : {}) };
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        const set = [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('botdot_session='));
        if (set) cookie = set;
        let data = null;
        try { data = JSON.parse(out); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, data, text: out });
      });
    });
    req.on('error', reject);
    req.end(text);
  });
  return { get: (p) => send('GET', p), post: (p, body) => send('POST', p, body) };
}

test('npm start runs the server behind the front door, prints the sign-up link, and a passkey made there signs in', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-dev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'home'));
  const port = await freePort();
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.start, 'node scripts/dev.js');

  const first = await launch(t, dir, port);
  const link = new URL(first.link);
  assert.match(link.pathname, /^\/sign-up\/[A-Za-z0-9_-]{32,}$/);
  const b = browser(port);
  assert.equal((await b.get(link.pathname)).status, 200);
  const options = await b.post(`${link.pathname}/options`, { name: 'owner' });
  assert.equal(options.status, 200, options.text);
  const key = passkey.create({ rpId: 'localhost', origin: `http://localhost:${port}` });
  const made = await b.post(link.pathname, { name: 'owner', credential: key.register(options.data.publicKey), app: 'web' });
  assert.equal(made.status, 201, made.text);
  await waitFor(async () => (await b.get('/api/bots')).status === 200, { timeout: 10_000, what: "the server's answer through the front door" });
  await first.stop();

  const again = await launch(t, dir, port);
  assert.equal(again.link, `http://localhost:${port}`, 'the account is made: sign in, no sign-up link');
});
