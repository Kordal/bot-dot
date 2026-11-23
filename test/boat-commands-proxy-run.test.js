// What botdot does as a boat bot's command starts (#1612, ADR 262): the account's proxy is handed to the machine, each
// command, so a changed or removed proxy applies from the next one; a proxy that can't be had stops the command with the
// words that say where the owner tests it; without a proxy nothing is asked of the machine. Which place a bot works in is
// the bot's `computer`, as ADR 261 resolves it. This file loads lib/bots.js itself, on a scratch data folder, with the
// computers stubbed (as computer-hold.test.js does): no Docker, no boat.dev.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-boat-proxy-run-'));
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), HOME: path.join(dir, 'home'),
});
fs.mkdirSync(process.env.HOME);

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/bots');
const boatLib = require('../lib/boat');

boatLib.setKey(`boat_${'x'.repeat(16)}`); // no real key: the External Virtual PC is set up, and never asked

after(() => { boatLib.setKey(null); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

// The computers, stubbed: the proxies botdot handed over (a login is only here, never asked of a bot), and what each says.
let handed = [];
let answer = { ok: true };
B.computers.setProxy = async (botId, proxy) => { handed.push([botId, proxy]); return typeof answer === 'function' ? answer(proxy) : answer; };
beforeEach(() => { handed = []; answer = { ok: true }; B.settings.update({ proxy: '' }); });

const add = (name, host) => B.proxies.add({ name, type: 'socks5', host, port: 1080, username: 'kordal', password: `pw-${name}` });
const useAccountProxy = (p) => B.settings.update({ proxy: p ? p.id : '' });
const boatBot = (name, extra = {}) => {
  const bot = B.bots.create({ name, prompt: 'Build things.', computerPlace: 'boat', ...extra });
  assert.equal(B.bots.get(bot.id).computer, 'boat', 'a bot that works on the External Virtual PC');
  return bot;
};

test('without a proxy, a boat bot\'s command is not proxied and nothing is asked of its machine', async () => {
  const bot = boatBot('Plain Boat');
  assert.equal(await B.commandProxy(bot.id), false);
  assert.deepEqual(handed, []);
});

test("with the account's proxy, a boat bot's command is proxied: the account's proxy goes to its machine, whatever the bot's own choice", async () => {
  const account = add('PL', 'pl.example');
  const own = add('DE', 'de.example');
  useAccountProxy(account);
  const bot = boatBot('Proxied Boat', { proxy: own.id });
  assert.equal(await B.commandProxy(bot.id), true);
  assert.equal(handed.length, 1);
  assert.equal(handed[0][0], bot.id);
  assert.equal(handed[0][1].host, 'pl.example', "the machine's one bridge has the account's proxy (ADR 171)");
  assert.equal(handed[0][1].password, 'pw-PL');
});

test('a changed proxy applies from the next command, and a removed one is taken from the machine once', async () => {
  const first = add('PL', 'pl.example');
  const second = add('DE', 'de.example');
  const bot = boatBot('Changing Boat');
  useAccountProxy(first);
  await B.commandProxy(bot.id);
  useAccountProxy(second);
  assert.equal(await B.commandProxy(bot.id), true);
  assert.equal(handed.at(-1)[1].host, 'de.example');
  useAccountProxy(null);
  assert.equal(await B.commandProxy(bot.id), false, 'the next command goes without');
  assert.equal(handed.at(-1)[1], null, "its machine's bridge is told it has none now");
  const asked = handed.length;
  assert.equal(await B.commandProxy(bot.id), false);
  assert.equal(handed.length, asked, 'and not told again');
});

test("a proxy that can't be handed over stops the command, and the bot is told where the owner tests it", async () => {
  useAccountProxy(add('PL', 'pl.example'));
  const bot = boatBot('Stopped Boat');
  answer = { ok: false, error: 'nothing answers at 127.0.0.1:47300 on your machine' };
  await assert.rejects(B.commandProxy(bot.id), (e) => {
    assert.match(e.message, /its proxy PL couldn't be set \(nothing answers at 127\.0\.0\.1:47300 on your machine\), so nothing went out directly/);
    assert.match(e.message, /Tell the owner: they can test it in Settings → Proxy\./);
    assert.ok(!e.message.includes('pw-PL') && !e.message.includes('kordal'), 'no login in it');
    return true;
  });
  // A machine that did not answer at all is no different.
  answer = () => { throw new Error('boat.dev is down'); };
  await assert.rejects(B.commandProxy(bot.id), /boat\.dev is down.*Settings → Proxy/);
});

test("a boat bot's commands get their proxy as each starts, not with its computer: starting it hands over nothing", async () => {
  useAccountProxy(add('PL', 'pl.example'));
  const bot = boatBot('Starting Boat');
  B.computers.ensureMachine = async () => 'bx_machine';
  const meta = B.startRun(bot, { prompt: 'Run a command' });
  await B.computerForRun(meta.id, { screen: false });
  assert.deepEqual(handed, [], 'the machine is started for commands without the proxy');
  assert.equal(await B.commandProxy(bot.id), true);
  assert.equal(handed.length, 1);
  B.stopRun(meta.id);
});

test("on this machine's computer nothing changes: its command is proxied by its own choice, handed over as its run started", async () => {
  const account = add('PL', 'pl.example');
  const own = add('DE', 'de.example');
  useAccountProxy(account);
  const plain = B.bots.create({ name: 'Plain Linux', prompt: 'Help.', computer: 'linux' });
  assert.equal(await B.commandProxy(plain.id), true);
  const none = B.bots.create({ name: 'None Linux', prompt: 'Help.', computer: 'linux', proxy: 'none' });
  assert.equal(await B.commandProxy(none.id), false);
  const choosing = B.bots.create({ name: 'Own Linux', prompt: 'Help.', computer: 'linux', proxy: own.id });
  assert.equal(await B.commandProxy(choosing.id), true);
  assert.deepEqual(handed, [], 'it asks nothing of the machine as a command starts');
});
