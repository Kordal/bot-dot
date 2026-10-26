// What the owner, the bots and the Chief read about saved secrets used on the account's computer (#106, ADR 035):
// every bot there works as box with sudo, so each can read what botdot types or hands to a command there. Said
// plainly in the Vault's hint (web and Android), the approval card (vault-switch-ask.test.js), the bots' vault and
// computer tools, the Chief's Vault tool and the bot's prompt.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { rpcClient } = require('./memory-helpers');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const EVERY_BOT = /every (other )?bot on the account's computer can read/i;

async function listed(t, file, env = {}) {
  const mcp = rpcClient(t, file, { VAULT_URL: 'http://127.0.0.1:9', VAULT_TOKEN: 'fixture', ...env });
  await mcp.request('initialize', {});
  const { tools } = await mcp.request('tools/list');
  return Object.fromEntries(tools.map((x) => [x.name, x.description]));
}

test('every computer tool that uses a saved secret says every bot on the account\'s computer can read it', async (t) => {
  const tools = await listed(t, 'computer-mcp.js');
  for (const name of ['type_login', 'type_card', 'type_identity', 'run_with_login', 'run_with_ssh_key']) {
    assert.match(tools[name], EVERY_BOT, name);
    assert.match(tools[name], /sudo/, name);
  }
  assert.doesNotMatch(tools.run_shell, EVERY_BOT, 'a plain command uses no secret');
});

test("a machine of the bot's own on boat.dev has the Vault tools for one command, with no word of other bots (#560)", async (t) => {
  const tools = await listed(t, 'computer-mcp.js', { COMPUTER_KIND: 'boat' });
  for (const name of ['run_with_login', 'run_with_ssh_key', 'run_with_file']) {
    assert.ok(tools[name], name);
    assert.doesNotMatch(tools[name], EVERY_BOT, name);
    assert.doesNotMatch(tools[name], /other bots/, name);
  }
  assert.equal(tools.place_secret_file, undefined, 'no secret kept on disk at boat.dev');
  assert.equal(tools.type_login, undefined, 'no browser there');
});

test('the vault tools say it of "Usable in its computer"', async (t) => {
  const tools = await listed(t, 'vault-mcp.js');
  assert.match(tools.ask_vault_switch, /"inComputer" \("Usable in its computer": [^)]*every other bot on the account's computer can read it/);
  assert.match(tools.list_logins, /inComputer: true when you may use it with run_with_login on the account's computer, where every bot on the account's computer can read it/);
});

test('the Chief\'s Vault tool says it, so the Chief can tell the owner', () => {
  const { TOOLS } = require('../lib/mcp-server');
  const tool = TOOLS.find((x) => x.name === 'list_vault');
  assert.match(tool.description, EVERY_BOT);
  assert.match(read('chief-skills', 'skills', 'bot-designer', 'SKILL.md'), /every bot on the account's computer can read it/);
});

test('the bot\'s prompt says it, and that botdot puts no secret on a command line, and in a file only for one command (ADR 039) or by place_secret_file (ADR 051)', () => {
  const bots = read('lib', 'bots.js');
  assert.match(bots, /What botdot types into your browser or hands to a command on this computer \([^)]*\) every other bot on the computer can read too, as they all have sudo\. botdot puts no secret on a command line, and in a file only for one command or by place_secret_file/);
});

test('the Vault\'s hint says it, on the web and in the Android app', () => {
  assert.match(read('public', 'vault.js'), /Usable in its computer <span class="hint muted"[^>]*>[^<]*Every bot on that computer could then read it/);
  assert.match(read('android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app', 'data', 'VaultTypes.kt'), /IN_COMPUTER_HINT = "[^"]*Every bot on that computer could then read it/);
});
