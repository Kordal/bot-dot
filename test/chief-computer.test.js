// The Chief debugs a bot's computer (#59): computer_status says what Docker and botdot know of it, with the error of
// its last start that failed; computer_logs reads its recent logs; restart_computer stops it and starts it again and
// says whether it came up. Each goes through botdot's server to the Docker helper, which serves one account's
// computers only (ADR 028): a bot of another account is no bot here, and nothing of it is asked. The Chief still has
// no Bash and no Docker of its own.
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
    if (operation === 'ensure' && !starts) { state = 'stopped'; return answer(400, { error: PANIC }); }
    let value = null;
    if (operation === 'ensure') state = 'running';
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
// A call for the bot: by its id, or by its seat on the account's computer (#105).
const ofBot = (bot) => asked.filter(([, id]) => id === bot.id || id?.bot === bot.id).map(([op]) => op);
// The bot never used its computer, so it has no screen and its logs are the computer's alone (#105).
const lastLogs = () => { const [op, seat, lines] = asked.findLast(([o]) => o === 'logs'); return [op, seat, lines]; };

test("computer_status quotes why the bot's computer did not start", async (t) => {
  const bot = await makeBot(srv, { name: 'VPS Admin', computer: 'linux' });
  const status = await chief(t).json('computer_status', { id: bot.id });
  assert.equal(status.lastStartError.message, PANIC);
  assert.ok(ofBot(bot).includes('health'));
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

test('restart_computer stops the computer and starts it again, and says plainly when it did not come up', async (t) => {
  const bot = await makeBot(srv, { computer: 'linux' });
  const tools = chief(t);
  starts = false;
  asked = [];
  const failed = await tools.json('restart_computer', { id: bot.id });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, PANIC);
  assert.deepEqual(ofBot(bot).filter((op) => ['stop', 'ensure'].includes(op)), ['stop', 'ensure']);
  starts = true;
  const came = await tools.json('restart_computer', { id: bot.id });
  assert.deepEqual(came, { ok: true, state: 'running' });
});

test("the Chief can't reach a bot that isn't this account's, and its helper is never asked of it", async (t) => {
  const tools = chief(t);
  asked = [];
  for (const [tool, args] of [['computer_status', {}], ['computer_logs', { lines: 10 }], ['restart_computer', {}]]) {
    const r = await tools.text(tool, { id: 'otheracct', ...args }).then(String, (e) => e.message);
    assert.match(r, /Bot not found/, tool);
  }
  assert.deepEqual(asked.filter(([op]) => ['health', 'logs', 'stop', 'ensure'].includes(op)), []);
});

test("the Chief can't stop, start or erase a computer itself, nor restart one of a bot that has none", async (t) => {
  const bot = await makeBot(srv, { computer: 'linux' });
  for (const action of ['reset', 'stop', 'start']) {
    assert.equal((await srv.asChief(`/bots/${bot.id}/computer`, { method: 'POST', body: { action } })).status, 403, action);
  }
  const plain = await makeBot(srv);
  asked = [];
  const r = await chief(t).text('restart_computer', { id: plain.id }).then(String, (e) => e.message);
  assert.match(r, /This bot has no computer/);
  assert.deepEqual(ofBot(plain).filter((op) => ['stop', 'ensure'].includes(op)), []);
});

test("a computer is not restarted under the bot's own run", async (t) => {
  const bot = await makeBot(srv, { computer: 'linux' });
  const { rec } = await heldRun(srv, bot);
  t.after(() => { srv.unhold(); srv.release(rec); });
  asked = [];
  const r = await chief(t).text('restart_computer', { id: bot.id }).then(String, (e) => e.message);
  assert.match(r, /Wait until the bot finishes its run/);
  assert.deepEqual(ofBot(bot).filter((op) => ['stop', 'ensure'].includes(op)), []);
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
