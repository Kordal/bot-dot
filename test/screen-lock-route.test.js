// One run at a time on a screen (#847, ADR 133), end to end through botdot and a stand-in Docker helper: two runs of
// one bot share its screen, so while one uses it the other's screen tools are refused with who holds it, its shell
// still runs, and once the first run ends the screen is the second's.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startServer, makeBot, heldRun } = require('./helpers');
const { validate } = require('../lib/docker-helper');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-screen-lock-'));
const socket = path.join(dir, 'helper.sock');
let asked = [];
let helper;
let srv;

before(async () => {
  helper = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    if (!validate(operation, args)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid helper operation' })); }
    asked.push([operation, ...args]);
    let value = null;
    if (operation === 'inspect' || operation === 'details') value = { state: 'running' };
    if (operation === 'request') value = { ok: true, text: 'data: {"success": true}' };
    if (operation === 'browserTool') value = { ok: true, snapshot: '' };
    if (operation === 'runShell') value = { code: 0, stdout: 'ran\n', stderr: '', timedOut: false };
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  await new Promise((r) => helper.listen(socket, r));
  srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket, BOT_DOT_SCREEN_WAIT_MS: '300' } });
});
after(async () => { await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

test("a bot's second run waits for its screen, keeps its shell, and gets the screen when the first run ends", async (t) => {
  const alice = await makeBot(srv, { name: 'Alice', computer: 'linux' });
  const first = await heldRun(srv, alice);
  // A second message to the busy bot starts beside the first (ADR 062): a second run on the same screen.
  const second = await heldRun(srv, alice, 'Look at the page.');
  const token2 = second.token;
  t.after(() => { srv.unhold(); srv.release(first.rec); srv.release(second.rec); });
  const vault = (token, what, body) => srv.api(`/vault/session/computer/${what}`, { method: 'POST', headers: { 'X-Vault-Token': token }, body });

  assert.equal((await vault(first.token, 'cmd', { command: 'screenshot', params: {} })).data.ok, true);
  asked = [];
  const refused = (await vault(token2, 'cmd', { command: 'left_click', params: {} })).data;
  assert.equal(refused.ok, false);
  assert.match(refused.error, /in use by another run of yours/);
  const browser = (await vault(token2, 'browser', { op: 'snapshot' })).data;
  assert.match(browser.error, /in use by another run of yours/, 'the browser too');
  assert.ok(!asked.some(([op]) => ['request', 'browserTool'].includes(op)), 'nothing reached the screen');
  const shell = (await vault(token2, 'shell', { command: 'echo ran' })).data;
  assert.doesNotMatch(JSON.stringify(shell), /in use by/, 'its shell runs at once');
  assert.ok(asked.some(([op]) => op === 'runShell'));

  // The first run ends: the screen is the second run's.
  srv.release(first.rec);
  await srv.finished(first.run.id);
  assert.equal((await vault(token2, 'cmd', { command: 'left_click', params: {} })).data.ok, true);
});
