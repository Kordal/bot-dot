// A bot's machine of its own on boat.dev, inside botdot (#1617, ADR 263): ADR 096's one-minute migration leaves a bot
// that wants one on it and takes the others back to the account's machine; a bot's commands on its own machine go
// through the account's proxy as on the account's (ADR 262); the own key never goes into a command or a bot's
// environment. This file loads lib/bots.js on a scratch data folder, with boat.dev nowhere (a copy fails at once).
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-own-machine-run-'));
const data = path.join(dir, 'data');
fs.mkdirSync(data, { recursive: true });
Object.assign(process.env, {
  BOT_DOT_DATA: data, BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), HOME: path.join(dir, 'home'), BOT_DOT_BOAT_URL: 'http://127.0.0.1:9',
});
fs.mkdirSync(process.env.HOME);
const bot = (id, name, extra = {}) => ({ id, name, prompt: 'Build things.', allowedTools: ['Read'], computer: 'boat', computerPlace: 'boat', jobs: [], ...extra });
fs.writeFileSync(path.join(data, 'bots.json'), JSON.stringify([bot('plain', 'Plain'), bot('wants', 'Wants')]));
// Both have a machine of their own from before; the own key is set below, so `wants` asks for one now.
fs.writeFileSync(path.join(data, 'boat-machines.json'), JSON.stringify({ plain: { id: 'bx_0000000a', own: true }, wants: { id: 'bx_0000000b', own: true } }));
fs.writeFileSync(path.join(data, '.boat-own-machine'), '');

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/bots');
const boatLib = require('../lib/boat');

const OWN = `boat_${'o'.repeat(16)}`;
boatLib.setOwnKey(OWN);
after(() => { boatLib.setOwnKey(null); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

async function until(check) {
  for (let i = 0; i < 100; i++) { const v = await check(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('it never happened');
}

test("ADR 096's migration takes a bot back to the account's machine, and leaves one that wants a machine of its own", async () => {
  B.bots.update('wants', { boatOwnMachine: true }, { by: 'you' });
  assert.equal(B.bots.get('wants').boatOwnMachine, true);
  B.moveToAccountMachine();
  const move = await until(() => B.computerMove('plain'));
  assert.deepEqual([move.from, move.to], ['boat', 'boat'], 'its own machine to its folder on the account\'s');
  assert.equal(B.computerMove('wants'), null, 'the one that wants its own stays where it is');
  B.moveToAccountMachine();
  assert.equal(B.computerMove('wants'), null, 'every minute');
});

const add = (name, host) => B.proxies.add({ name, type: 'socks5', host, port: 1080, username: 'kordal', password: `pw-${name}` });
test("the account's proxy goes to a bot's own machine as to the account's, the bot's own choice aside, and a proxy that fails stops it", async () => {
  const handed = [];
  let answer = { ok: true };
  B.computers.setProxy = async (botId, proxy) => { handed.push([botId, proxy]); return answer; };
  const proxy = add('PL', 'pl.example');
  B.settings.update({ proxy: proxy.id });
  assert.equal(await B.commandProxy('wants'), true);
  assert.equal(handed.at(-1)[0], 'wants', "to its own machine's bridge");
  assert.equal(handed.at(-1)[1].host, 'pl.example');
  assert.equal(B.bots.get('wants').computer, 'boat');
  answer = { ok: false, proxy: true, error: 'nothing answers at 127.0.0.1:47300 on your machine' };
  await assert.rejects(B.commandProxy('wants'), /its proxy PL couldn't be set \(nothing answers at 127\.0\.0\.1:47300 on your machine\), so nothing went out directly/);
  B.settings.update({ proxy: '' });
  answer = { ok: true };
  assert.equal(await B.commandProxy('wants'), false);
  assert.equal(handed.at(-1)[1], null, "taken from its machine's bridge once");
});
