// Separate users on Linux (identity.js), with real processes under the bots' and the Chief's users:
// whatever address they connect from, and whatever headers they send, they never become the owner.
// Needs Linux and root, so it runs in CI's container (tests.yml) and is skipped elsewhere.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { execFile } = require('child_process');
const { startServer } = require('./helpers');

const CAN = process.platform === 'linux' && process.getuid?.() === 0;
const BOT_UID = 61000;
const CHIEF_UID = 60500;
const { TOOLS_UID } = require('../lib/identity'); // the installer's user (ADR 007)
let srv;

before(async () => {
  if (!CAN) return;
  srv = await startServer({ env: { HOST: '0.0.0.0', BOT_DOT_SEPARATE_USERS: '1' } });
});
after(() => srv?.stop());

// This machine's addresses a process here can connect from: loopback ones, and its own others.
const sources = () => ['127.0.0.1', '127.0.0.2', '127.8.9.10',
  ...Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)];

// One request from a process running as uid, from the address `from`. Resolves with the status.
function requestAs(uid, from, { method = 'GET', path, body, headers = {} }) {
  const code = `
    const http = require('http');
    const body = ${JSON.stringify(body ? JSON.stringify(body) : '')};
    const req = http.request({ host: ${JSON.stringify(from)}, localAddress: ${JSON.stringify(from)}, port: ${srv.botdotPort}, method: ${JSON.stringify(method)}, path: ${JSON.stringify(path)},
      headers: { Host: '127.0.0.1', 'Content-Type': 'application/json', 'X-Bot-Dot': '1', ...${JSON.stringify(headers)} } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => console.log(JSON.stringify({ status: res.statusCode, body: d })));
    });
    req.on('error', (e) => console.log(JSON.stringify({ status: 0, body: e.message })));
    req.end(body);`;
  // Connecting to the address it comes from: a loopback one, or the machine's own, is always this machine.
  return new Promise((resolve, reject) => execFile(process.execPath, ['-e', code], { uid, gid: uid, cwd: '/', env: { PATH: process.env.PATH } }, (e, out) => {
    if (e) return reject(e);
    try { resolve(JSON.parse(out.trim())); } catch { reject(new Error(out)); }
  }));
}

const FORGED = { 'Tailscale-User-Login': 'owner@example.com', 'X-Forwarded-For': '100.101.102.103', 'X-Chief-Key': 'guess', 'X-Run-Token': 'guess' };

test('a bot never reaches the owner controls, from any address of this machine', { skip: !CAN && 'needs Linux and root' }, async () => {
  for (const from of sources()) {
    for (const [method, path] of [['GET', '/api/settings'], ['GET', '/api/bots'], ['GET', '/api/backups'], ['PUT', '/api/setup'], ['GET', '/api/vault']]) {
      const r = await requestAs(BOT_UID, from, { method, path, body: method === 'GET' ? undefined : {}, headers: FORGED });
      assert.equal(r.status, 403, `bot ${method} ${path} from ${from}: ${r.body}`);
    }
  }
});

test("the Chief's user gets only its own tools, and its script jobs wait for the owner", { skip: !CAN && 'needs Linux and root' }, async () => {
  for (const from of sources()) {
    const r = await requestAs(CHIEF_UID, from, { path: '/api/settings', headers: FORGED });
    assert.equal(r.status, 403, `Chief GET /api/settings from ${from}: ${r.body}`);
  }
  const job = { name: 'No-op', kind: 'script', cron: '0 0 1 1 *', script: ':', enabled: false };
  const r = await requestAs(CHIEF_UID, '127.0.0.2', { method: 'POST', path: '/api/bots', body: { name: 'Probe', prompt: 'x', jobs: [job], _by: 'you' } });
  assert.equal(r.status, 201, r.body);
  assert.equal(JSON.parse(r.body).jobs[0].approved, false);
});

// The tools user is neither the Chief nor a bot, and every other user of this machine is the owner. It must not be.
test("the tools user reaches nothing: it is a stranger, never the owner", { skip: !CAN && 'needs Linux and root' }, async () => {
  for (const from of sources()) {
    for (const headers of [{}, FORGED]) {
      for (const path of ['/api/settings', '/api/bots', '/api/backups', '/api/vault', '/api/tools', '/api/self/session/tool']) {
        const r = await requestAs(TOOLS_UID, from, { path, headers });
        assert.equal(r.status, 403, `the tools user GET ${path} from ${from}: ${r.body}`);
      }
    }
  }
});

test('the owner (root here) still gets in', { skip: !CAN && 'needs Linux and root' }, async () => {
  assert.equal((await srv.api('/settings')).status, 200);
});

// A call (ADR 026) is let in on a job's key alone, but never from a bot, the Chief or the tools user, whatever they send.
test('a call from a bot, the Chief or the tools user is refused, also with the right key', { skip: !CAN && 'needs Linux and root' }, async () => {
  const fs = require('fs');
  const crypto = require('crypto');
  const bot = (await srv.api('/bots', { method: 'POST', body: { name: 'Called', prompt: 'x' } })).data;
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Ping', kind: 'script', cron: '0 4 1 1 *', script: 'cat' } })).data;
  const key = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(require('path').join(srv.data, 'call-keys.json'), JSON.stringify({ [bot.id]: { [job.id]: { hash: crypto.createHash('sha256').update(key).digest('hex') } } }));
  const headers = { ...FORGED, 'X-Chief-Key': undefined, 'X-Run-Token': undefined, 'Tailscale-User-Login': undefined, Authorization: `Bearer ${key}` };
  for (const k of Object.keys(headers)) if (headers[k] === undefined) delete headers[k];
  for (const uid of [BOT_UID, CHIEF_UID, TOOLS_UID]) {
    for (const from of sources()) {
      const r = await requestAs(uid, from, { method: 'POST', path: `/api/bots/${bot.id}/jobs/${job.id}/call`, body: {}, headers });
      assert.equal(r.status, 403, `uid ${uid} from ${from}: ${r.body}`);
    }
  }
  assert.deepEqual((await srv.api(`/runs?botId=${bot.id}`)).data, []);
});
