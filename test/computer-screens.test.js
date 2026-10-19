// Each bot has a screen of its own on the account's computer (#105): botdot keeps a map from bot to screen number,
// which stays the same across restarts of botdot and is freed when the bot is deleted. Every computer call of a bot
// goes to its own screen, which a call that needs it starts first.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const screensLib = require('../lib/computer-screens');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-screens-'));

test('a bot gets the lowest free screen, keeps it, and keeps it across a restart', () => {
  const data = dir();
  const screens = screensLib.create(data);
  assert.equal(screens.of('alice'), 1);
  assert.equal(screens.of('bob'), 2);
  assert.equal(screens.of('alice'), 1, 'the same screen on every call');
  const again = screensLib.create(data);
  assert.equal(again.of('bob'), 2, 'botdot started again: the same map');
  assert.equal(again.of('carol'), 3);
});

test("a deleted bot's screen is freed and goes to the next bot that needs one", () => {
  const data = dir();
  const screens = screensLib.create(data);
  screens.of('alice'); screens.of('bob');
  assert.equal(screens.free('alice'), 1);
  assert.equal(screens.free('alice'), null, 'nothing left to free');
  assert.equal(screensLib.create(data).of('dave'), 1);
  assert.equal(screens.has('alice'), false);
});

test('there are at most as many screens as ports were set aside for', () => {
  const screens = screensLib.create(dir());
  for (let i = 0; i < screensLib.MAX; i++) screens.of(`bot-${i}`);
  assert.throws(() => screens.of('one-more'), /screens of the account's computer are taken/);
});

test("a bot's computer calls go to its own screen; the account's calls stay the bot's id", async () => {
  const got = [];
  const record = (name) => async (...args) => { got.push([name, ...args]); return name; };
  const raw = {
    IMAGE: 'img', containerName: () => 'box',
    ensure: record('ensure'), request: record('request'), typeSecret: record('typeSecret'), startProgram: record('startProgram'),
    runWithLogin: record('runWithLogin'), runWithSshKey: record('runWithSshKey'), logs: record('logs'), screenState: record('screenState'),
    freeScreen: record('freeScreen'), inspect: record('inspect'), reset: record('reset'),
    screenPipe: (...args) => { got.push(['screenPipe', ...args]); return pipe; },
  };
  const pipe = new (require('node:events'))(); // a child process, as lib/computers.js gives
  const screens = screensLib.create(dir());
  const computers = screensLib.facade(raw, screens);
  await computers.ensure('alice');
  await computers.request('bob', '/cmd', { command: 'screenshot' });
  await computers.typeSecret('alice', { op: 'where' });
  await computers.startProgram('bob', 'xterm');
  await computers.runWithLogin('alice', { command: 'true' });
  await computers.runWithSshKey('bob', { command: 'true', privateKey: 'k' });
  await computers.logs('alice', 50);
  await computers.screenState('bob');
  assert.equal(computers.screenPipe('alice'), pipe);
  await computers.inspect('alice');
  await computers.reset('bob');
  await computers.ensure();
  const alice = { bot: 'alice', screen: 1 };
  const bob = { bot: 'bob', screen: 2 };
  assert.deepEqual(got, [
    ['ensure', alice], ['ensure', bob], ['request', bob, '/cmd', { command: 'screenshot' }], ['typeSecret', alice, { op: 'where' }],
    ['startProgram', bob, 'xterm'], ['runWithLogin', alice, { command: 'true' }], ['runWithSshKey', bob, { command: 'true', privateKey: 'k' }],
    ['logs', alice, 50], ['screenState', bob], ['screenPipe', alice], ['inspect', 'alice'], ['reset', 'bob'], ['ensure'],
  ]);
  assert.equal(computers.IMAGE, 'img');
  assert.equal(computers.containerName('alice'), 'box');
});

test('looking at the screen of a bot that has none gives it none', async () => {
  const screens = screensLib.create(dir());
  let state = 'running';
  const computers = screensLib.facade({ inspect: async () => ({ state }), screenState: async () => ({ state: 'running' }) }, screens);
  assert.deepEqual(await computers.screenState('alice'), { state: 'off' }, 'the computer is on, her screen is not');
  state = 'stopped';
  assert.deepEqual(await computers.screenState('alice'), { state: 'stopped' });
  assert.equal(screens.has('alice'), false);
  screens.of('alice');
  assert.deepEqual(await computers.screenState('alice'), { state: 'running' });
});

test('botdot and the computer agree on how many screens there are', () => {
  assert.equal(screensLib.MAX, require('../lib/computers').MAX_SCREENS);
});

// open_browser asks whether the bot's own Camoufox is open, on its own screen: another bot's open browser does not
// count (#105). The stand-in is botdot's session API.
test("open_browser checks the bot's own browser, not any Camoufox on the computer", async (t) => {
  const http = require('node:http');
  const { rpcClient } = require('./memory-helpers');
  const asked = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : null;
      asked.push({ path: req.url, body: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/session/computer/cmd' && b.command === 'run_command') return res.end(JSON.stringify({ ok: true, text: `data: ${JSON.stringify({ success: true, stdout: 'yes\n' })}` }));
      if (req.url === '/session/computer/cmd') return res.end(JSON.stringify({ ok: true, text: 'data: {"success": true, "image_data": "aGk="}' }));
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot.account.computer' });
  await mcp.request('initialize', {});
  const out = await mcp.request('tools/call', { name: 'open_browser', arguments: { url: 'https://example.com' } });
  assert.match(out.content[0].text, /already open/);
  const check = asked.find((a) => a.body?.command === 'run_command');
  assert.equal(check.body.params.command, 'camoufox-browser --is-open && echo yes || echo no');
  assert.ok(!asked.some((a) => a.path === '/session/computer/launch'), 'nothing more was started');
});

test('freeing a bot ends its screen on the computer and gives its number back', async () => {
  const got = [];
  const raw = { freeScreen: async (seat) => { got.push(seat); } };
  const screens = screensLib.create(dir());
  const computers = screensLib.facade(raw, screens);
  screens.of('alice');
  await computers.free('alice');
  await computers.free('nobody');
  assert.deepEqual(got, [{ bot: 'alice', screen: 1 }], 'a bot that never had a screen has nothing to end');
  assert.equal(screens.has('alice'), false);
});

// A screen nobody used for a while ends (#126): its desktop and its browser hold memory of the account's computer
// that gVisor never gives back while they run (a screen and Camoufox, 0.5 to 2.5 GB). Its browser profile and its
// files stay, and its next computer tool starts it again. A call still running, or the owner watching the screen,
// keeps it.
test('a screen idle for longer than the rest time ends; one in use, or watched, does not', async () => {
  const rested = [];
  let clock = 0;
  let finish;
  const raw = {
    ensure: async () => 'ensured', restScreen: async (seat) => { rested.push(seat.bot); },
    request: () => new Promise((r) => { finish = r; }),
    screenPipe: () => { const pipe = new (require('node:events'))(); return pipe; },
  };
  const computers = screensLib.facade(raw, screensLib.create(dir()), { restAfterMs: 1000, now: () => clock });
  await computers.ensure('alice');
  await computers.ensure('bob');
  const pipe = computers.screenPipe('carol');
  const call = computers.request('dave', '/cmd', { command: 'screenshot' });
  clock = 999;
  assert.deepEqual(await computers.restIdle(), [], 'not yet');
  await computers.ensure('bob'); // used again
  clock = 1500;
  assert.deepEqual(await computers.restIdle(), ['alice']);
  assert.deepEqual(rested, ['alice']);
  assert.deepEqual(await computers.restIdle(), [], 'ended once');
  clock = 5000;
  assert.deepEqual(await computers.restIdle(), ['bob'], 'carol is watched and dave is still in a call');
  finish('done'); await call;
  pipe.emit('close');
  clock = 5999;
  assert.deepEqual(await computers.restIdle(), []);
  clock = 6001;
  assert.deepEqual((await computers.restIdle()).sort(), ['carol', 'dave'], 'a rest time after the call and the watching ended');
  await computers.ensure('alice');
  clock = 7500;
  assert.deepEqual(await computers.restIdle(), ['alice'], 'started again by its next tool, and ends again');
});
