// Each bot has its own screen on the account's computer (#105), end to end through botdot and its Docker helper (a
// stand-in here): a bot's computer tools reach its own screen, the screen view in the web page and the Android app
// (/computer/<bot>/...) shows the bot's own screen, and deleting a bot ends its screen and frees its number.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startServer, makeBot, heldRun } = require('./helpers');
const { validate } = require('../lib/docker-helper');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-screens-'));
const socket = path.join(dir, 'helper.sock');
let asked = [];
const upgrades = [];
const on = new Set(); // the screens that are on, by number
let helper;
let srv;

before(async () => {
  helper = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    // What the real helper refuses, the stand-in refuses too: a seat botdot hands on must pass its checks.
    if (!validate(operation, args)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid helper operation' })); }
    asked.push([operation, ...args]);
    const [seat] = args;
    let value = null;
    if (operation === 'ensure' && seat) on.add(seat.screen);
    if (operation === 'inspect' || operation === 'details') value = { state: 'running' };
    if (operation === 'screenState') value = { state: on.has(seat.screen) ? 'running' : 'off' };
    if (operation === 'freeScreen') on.delete(seat.screen);
    if (operation === 'request') value = { ok: true, text: 'data: {"success": true}' };
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  // The screen's own connection, as the helper takes it: /screen/<bot>/<screen number>.
  helper.on('upgrade', (req, sock) => {
    upgrades.push(req.url);
    sock.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: botdot-screen\r\n\r\n');
    // websockify on that screen answers the viewer's request.
    sock.once('data', () => sock.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
    sock.on('error', () => {});
  });
  await new Promise((r) => helper.listen(socket, r));
  srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
});
after(async () => { await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

const map = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'computer-screens.json'), 'utf8'));
const page = (botId) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.port, path: `/computer/${botId}/vnc.html?autoconnect=1` }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});
// noVNC's WebSocket, as the viewer opens it: botdot hands it on to the helper.
const view = (botId) => new Promise((resolve, reject) => {
  const host = `127.0.0.1:${srv.port}`;
  const req = http.request({ host: '127.0.0.1', port: srv.port, path: `/computer/${botId}/websockify`, headers: {
    Connection: 'Upgrade', Upgrade: 'websocket', Origin: `http://${host}`, Host: host, 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
  } });
  req.on('upgrade', (_res, sock) => resolve(sock));
  req.on('response', (res) => resolve(res.statusCode));
  req.on('error', (e) => resolve(e.code));
  req.setTimeout(5000, () => { req.destroy(); reject(new Error('no answer')); });
  req.end();
});

test("each bot's computer tools reach its own screen, and the view shows the bot's own screen (#105)", async (t) => {
  const alice = await makeBot(srv, { name: 'Alice', computer: 'linux' });
  const bob = await makeBot(srv, { name: 'Bob', computer: 'linux' });

  // Before its first computer tool, a bot has no screen: the view says so, and looking gives it none.
  const before = await page(alice.id);
  assert.equal(before.status, 503);
  assert.match(before.body, /This bot's screen starts when it first uses its computer/);
  assert.ok(!fs.existsSync(path.join(srv.data, 'computer-screens.json')) || !map()[alice.id]);

  // Both bots at work at once: each one's command goes to its own screen.
  const a = await heldRun(srv, alice);
  const b = await heldRun(srv, bob);
  t.after(() => { srv.unhold(); srv.release(a.rec); srv.release(b.rec); });
  asked = [];
  const cmd = (held, command) => srv.api('/vault/session/computer/cmd', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { command, params: {} } });
  const [ra, rb] = await Promise.all([cmd(a, 'screenshot'), cmd(b, 'left_click')]);
  assert.equal(ra.data.ok, true);
  assert.equal(rb.data.ok, true);
  const screens = map();
  assert.deepEqual(Object.values(screens).sort(), [1, 2], 'two screens');
  const seat = (bot) => ({ bot: bot.id, screen: screens[bot.id], name: bot.name });
  const requests = asked.filter(([op]) => op === 'request').map(([, s, , body]) => [s, body.command]);
  assert.deepEqual(requests.sort((x, y) => x[0].screen - y[0].screen), [[seat(alice), 'screenshot'], [seat(bob), 'left_click']]
    .sort((x, y) => x[0].screen - y[0].screen));
  assert.ok(asked.some(([op, s]) => op === 'ensure' && s?.bot === alice.id), "alice's screen was started");

  // start_program, on the bot's own screen.
  asked = [];
  assert.equal((await srv.api('/vault/session/computer/launch', { method: 'POST', headers: { 'X-Vault-Token': b.token }, body: { command: 'xterm' } })).data.ok, true);
  assert.deepEqual(asked.find(([op]) => op === 'startProgram'), ['startProgram', seat(bob), 'xterm']);

  // The view: the page, then the screen itself, from the bot's own screen.
  assert.equal((await page(alice.id)).status, 200);
  const sock = await view(bob.id);
  assert.equal(typeof sock, 'object', `the view connected: ${sock}`);
  sock.destroy();
  assert.deepEqual(upgrades, [`/screen/${bob.id}/${screens[bob.id]}`]);
  assert.deepEqual(map(), screens, 'using them changed no screen');
});

test("a deleted bot's screen ends, and its number goes to the next bot (#105)", async () => {
  const gone = await makeBot(srv, { name: 'Gone', computer: 'linux' });
  assert.equal((await srv.api(`/bots/${gone.id}/computer`, { method: 'POST', body: { action: 'start' } })).status, 200);
  const n = map()[gone.id];
  assert.ok(n);
  asked = [];
  assert.equal((await srv.api(`/bots/${gone.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(asked.find(([op]) => op === 'freeScreen'), ['freeScreen', { bot: gone.id, screen: n, name: 'Gone' }]);
  assert.equal(map()[gone.id], undefined);
  const next = await makeBot(srv, { name: 'Next', computer: 'linux' });
  assert.equal((await srv.api(`/bots/${next.id}/computer`, { method: 'POST', body: { action: 'start' } })).status, 200);
  assert.equal(map()[next.id], n, 'the lowest free number');
});

test("the computer's view says when a bot's screen is off, and Start its screen starts it (#134)", async () => {
  const cara = await makeBot(srv, { name: 'Cara', computer: 'linux' });
  const off = (await srv.api(`/bots/${cara.id}/computer`)).data;
  assert.equal(off.state, 'running');
  assert.match(off.screenOff.text, /^Cara's screen is off\. Its commands and files run without one/);
  assert.equal(off.screenOff.start, 'Start its screen');

  assert.equal((await srv.api(`/bots/${cara.id}/computer`, { method: 'POST', body: { action: 'start' } })).status, 200);
  assert.equal((await srv.api(`/bots/${cara.id}/computer`)).data.screenOff, undefined, 'its screen is on now');
});
