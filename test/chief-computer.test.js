// The Chief debugs the account's computer (#59, #109): computer_status says what Docker and botdot know of it, with
// the error of its last start that failed; computer_logs reads its recent logs and a bot's screen's; restart_computer
// stops it and starts it again and says whether it came up. Each goes through botdot's server to the Docker helper,
// which serves one account's computer only (ADR 028): a bot of another account is no bot here, and nothing of it is
// asked. The Chief still has no Bash and no Docker of its own. What each bot uses of it: test/computer-usage.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, makeBot, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { READS } = require('../lib/chief-tools');

const PANIC = 'runsc: panic: unsupported update on a running sandbox (docker update botdot-kordal.pc)';

// The Docker helper, the boundary: what it was asked, and a computer that fails to start until `starts` is true.
let asked = [];
let state = 'running';
let starts = false;
let srv; let helper; let dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-chief-computer-'));
  const socket = path.join(dir, 'helper.sock');
  helper = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    asked.push([operation, ...args]);
    const answer = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (['ensure', 'restartAll'].includes(operation) && !starts) { state = 'stopped'; return answer(400, { error: PANIC }); }
    let value = null;
    if (operation === 'ensure') state = 'running';
    if (operation === 'restartAll') { state = 'running'; value = 'restarted'; }
    if (operation === 'stop') state = 'stopped';
    if (operation === 'inspect' || operation === 'details') value = { state };
    if (operation === 'health') value = { state, status: state === 'running' ? 'running' : 'exited', exitCode: 0, error: '', oomKilled: false, restartCount: 0, waiting: false, lastStartError: { at: '2026-10-18T18:00:00.000Z', message: PANIC } };
    if (operation === 'logs') value = { state, container: 'container says hello', desktop: 'supervisord: novnc exited (exit status 1)' };
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    answer(200, { value });
  });
  await new Promise((r) => helper.listen(socket, r));
  srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
});
after(async () => { await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

const chief = (t) => rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
// The bot never used its computer, so it has no screen and its logs are the computer's alone (#105).
const lastLogs = () => { const [op, seat, lines] = asked.findLast(([o]) => o === 'logs'); return [op, seat, lines]; };

test("computer_status quotes why the account's computer did not start", async (t) => {
  await makeBot(srv, { name: 'VPS Admin', computer: 'linux' });
  asked = [];
  const status = await chief(t).json('computer_status', {});
  assert.equal(status.lastStartError.message, PANIC);
  assert.deepEqual(asked.find(([op]) => op === 'health'), ['health'], 'the account\'s, asked for no bot');
});

test("computer_logs reads the computer's recent logs, as many lines as asked, at most 500", async (t) => {
  const bot = await makeBot(srv, { computer: 'linux' });
  const tools = chief(t);
  const logs = await tools.json('computer_logs', { id: bot.id, lines: 50 });
  assert.equal(logs.desktop, 'supervisord: novnc exited (exit status 1)');
  assert.deepEqual(lastLogs(), ['logs', null, 50]);
  await tools.json('computer_logs', { id: bot.id, lines: 100000 });
  assert.deepEqual(lastLogs(), ['logs', null, 500]);
  await tools.json('computer_logs', { id: bot.id });
  assert.deepEqual(lastLogs(), ['logs', null, 100]);
});

test("restart_computer stops the account's computer and starts it again, and says plainly when it did not come up", async (t) => {
  await makeBot(srv, { computer: 'linux' });
  const tools = chief(t);
  starts = false;
  asked = [];
  const failed = await tools.json('restart_computer', {});
  assert.equal(failed.ok, false);
  assert.equal(failed.error, PANIC);
  assert.deepEqual(asked.filter(([op]) => ['stop', 'ensure', 'restartAll'].includes(op)), [['restartAll']]);
  starts = true;
  const came = await tools.json('restart_computer', {});
  assert.deepEqual(came, { ok: true, state: 'running' });
});

test("the Chief can't reach a bot that isn't this account's, and its helper is never asked of it", async (t) => {
  const tools = chief(t);
  asked = [];
  const r = await tools.text('computer_logs', { id: 'otheracct', lines: 10 }).then(String, (e) => e.message);
  assert.match(r, /Bot not found/);
  for (const path of ['/bots/otheracct/computer/status', '/bots/otheracct/computer/logs']) assert.equal((await srv.asChief(path)).status, 404, path);
  assert.equal((await srv.asChief('/bots/otheracct/computer/restart', { method: 'POST' })).status, 404);
  assert.deepEqual(asked.filter(([op]) => ['health', 'logs', 'stop', 'ensure', 'restartAll'].includes(op)), []);
});

test("the Chief can't stop, start or erase a computer itself, nor restart one of a bot that has none", async (t) => {
  const bot = await makeBot(srv, { computer: 'linux' });
  for (const action of ['reset', 'stop', 'start']) {
    assert.equal((await srv.asChief(`/bots/${bot.id}/computer`, { method: 'POST', body: { action } })).status, 403, action);
  }
  const plain = await makeBot(srv);
  asked = [];
  const r = await srv.asChief(`/bots/${plain.id}/computer/restart`, { method: 'POST' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /This bot has no computer/);
  assert.deepEqual(asked.filter(([op]) => ['stop', 'ensure', 'restartAll'].includes(op)), []);
});

test("the account's computer is not restarted on the Chief's word under a bot's run: the owner is asked", async (t) => {
  const bot = await makeBot(srv, { computer: 'linux' });
  const { rec } = await heldRun(srv, bot);
  t.after(() => { srv.unhold(); srv.release(rec); });
  asked = [];
  const r = await chief(t).json('restart_computer', {});
  assert.equal(r.held, true);
  assert.deepEqual(asked.filter(([op]) => ['stop', 'ensure', 'restartAll'].includes(op)), []);
});

test('the three tools read what is not the owner\'s, and the Chief still has no Bash', async (t) => {
  const listed = (await chief(t).request('tools/list')).tools.map((x) => x.name);
  for (const tool of ['computer_status', 'computer_logs', 'restart_computer']) {
    assert.ok(listed.includes(tool), tool);
    assert.equal(READS[tool], 'bot', tool);
  }
  const allow = fs.readFileSync(path.join(__dirname, '..', 'lib', 'chief.js'), 'utf8').match(/const TOOL_ALLOW = (\[.*\]);/)[1];
  assert.doesNotMatch(allow, /Bash/);
});
