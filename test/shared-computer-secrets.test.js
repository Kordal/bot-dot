// What the owner, the bots and the Chief read about saved secrets used on the account's computer (#106, ADR 035):
// every bot there works as box with sudo, so each can read what botdot types or hands to a command there. Said
// plainly in the bots' vault and computer tools, the Chief's Vault tool and the bot's prompt. Every login may be used
// there (ADR 175), so the Vault's editor has no switch or hint for it.
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

test("a machine of the bot's own on boat.dev has the Vault tools for one command and for its browser, with no word of other bots (#560, #563)", async (t) => {
  const tools = await listed(t, 'computer-mcp.js', { COMPUTER_KIND: 'boat' });
  for (const name of ['run_with_login', 'run_with_ssh_key', 'run_with_file', 'type_login', 'type_card', 'type_identity']) {
    assert.ok(tools[name], name);
    assert.doesNotMatch(tools[name], EVERY_BOT, name);
    assert.doesNotMatch(tools[name], /other bots/, name);
  }
  assert.equal(tools.place_secret_file, undefined, 'no secret kept on disk at boat.dev');
});

test('the vault tools say every login may be used on the account\'s computer, where every bot can read it', async (t) => {
  const tools = await listed(t, 'vault-mcp.js');
  assert.equal(tools.ask_vault_switch, undefined, 'no switch is left to ask for');
  assert.match(tools.list_logins, /each login may also be used with run_with_login on the account's computer, where every bot on the account's computer can read it/);
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

test('the Vault\'s editor has no switch for a self-signed certificate or for the computer (ADR 175)', () => {
  for (const f of [read('public', 'vault.js'), read('public', 'login-requests.js'), read('android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app', 'ui', 'VaultScreen.kt')]) {
    assert.doesNotMatch(f, /name="insecureTls"|name="inComputer"|Usable in its computer|Accept a self-signed certificate/);
  }
});
