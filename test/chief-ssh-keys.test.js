// The Chief makes an SSH key by chat (#181, part of #180): a new ed25519 key in the owner's Bitwarden, shared with
// the bots the owner names, and read back with its public key and fingerprint; its private key reaches no tool's
// answer, no chat and no log. Through the real server, the Chief's own MCP server, the stand-in for Claude and the
// stand-in for bw. docs/api.md, "The Vault's items".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { TOOLS } = require('../lib/mcp-server');
const { VAULT_WRITES, OWNERS_TURN_ONLY, VAULT_SAY, readKind } = require('../lib/chief-tools');
const sshKeys = require('../lib/ssh-keys');

const FAKE_BW = path.join(__dirname, 'fixtures', 'fake-bw.js');
const CLIENT_ID = 'user.00000000-0000-0000-0000-000000000000';
const BEGIN = `-----BEGIN OPENSSH ${'PRIVATE'} KEY-----`; // put together, as in lib/ssh-keys.js (gitleaks)

let srv, infra, scout;
before(async () => {
  srv = await startServer({ env: { BW_BIN: FAKE_BW } });
  infra = await makeBot(srv, { name: 'Infra Admin', emoji: '🛠️' });
  scout = await makeBot(srv, { name: 'Scout', emoji: '🔭' });
});
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

const isChief = (x) => !!x.botdot && x.args.includes('🧭 Chief of Staff');
const chatNow = async (chat) => (await srv.api(`/chief/chats/${chat.id}`)).data;
const newChat = async () => (await srv.api('/chief/chats', { method: 'POST' })).data;
const names = async (client) => (await client.request('tools/list')).tools.map((x) => x.name);
const sshItems = async () => (await srv.api('/vault')).data.filter((i) => i.kind === 'ssh-key');
const setUp = () => srv.api('/vault/bitwarden/setup', { method: 'POST', body: { server: 'us', clientId: CLIENT_ID, clientSecret: 'fixture-client-secret' } });
const unlock = () => srv.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } });

// A Chief turn that is held, with its tools as Claude Code would call them (as in chief-groups.test.js), and
// uses(name): a tool of Claude Code's own (a web search) asked for and answered.
async function turnOf(t, rec, chat) {
  const tools = rpcClient(t, 'mcp-server.js', { ...rec.botdot.env });
  const events = [];
  const emit = (...evs) => { events.push(...evs); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); };
  const going = async () => (await chatNow(chat)).messages.findLast((m) => m.role === 'chief' && m.pending);
  let serial = 0;
  const asks = async (name, input) => {
    const id = `tool-${++serial}`;
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
    await waitFor(async () => (await going())?.activity?.tool === name.replace(/^mcp__botdot__/, ''), { what: `the turn to ask for ${name}` });
    return id;
  };
  const answered = async (id, text) => {
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
    await waitFor(async () => (await going())?.activity?.tool === 'thinking', { what: 'the tool to have answered' });
  };
  const uses = async (name, input = {}, text = 'results') => answered(await asks(name, input), text);
  const call = async (name, args = {}) => {
    const id = await asks(`mcp__botdot__${name}`, args);
    const r = await tools.call(name, args);
    const text = r.content.map((c) => c.text || '').join('\n');
    await answered(id, text);
    return r.isError ? { error: text, text } : { ...JSON.parse(text), text };
  };
  let ended = false;
  const end = async (reply = 'Done.') => {
    if (ended) return null;
    ended = true;
    srv.reply(reply);
    srv.release(rec);
    return waitFor(async () => { const c = await chatNow(chat); return c.busy ? null : c; }, { what: 'the Chief to finish' });
  };
  t.after(() => end());
  return { chat, rec, tools, call, uses, end };
}
async function ownerTurn(t, text) {
  srv.hold();
  const chat = await newChat();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const rec = await srv.nextRun((r) => isChief(r) && r.stdin.includes(text), "the Chief's turn");
  return turnOf(t, rec, chat);
}

test('create_ssh_key is a tool of the owner\'s turns alone, reads nothing, and the Chief is told when to use it', () => {
  assert.deepEqual(VAULT_WRITES, ['create_ssh_key']);
  assert.ok(OWNERS_TURN_ONLY.includes('create_ssh_key'));
  assert.ok(TOOLS.some((x) => x.name === 'create_ssh_key'));
  assert.equal(readKind('mcp__botdot__create_ssh_key'), null, 'its answer is botdot\'s own words and the key\'s public half');
  const prompt = fs.readFileSync(path.join(__dirname, '..', 'lib', 'chief.js'), 'utf8');
  assert.match(prompt, /make a new one yourself with create_ssh_key/);
  assert.match(prompt, /never ask them to paste a private key here/);
});

test('in a turn the owner started the Chief makes an SSH key, shared with the bot named, and reads back its public key; no private key anywhere', async (t) => {
  const turn = await ownerTurn(t, 'Make an SSH key called VPS Admin SSH and share it with Infra Admin.');
  assert.ok((await names(turn.tools)).includes('create_ssh_key'));
  const ask = { name: 'VPS Admin SSH', bots: ['Infra Admin'] };

  // Without Bitwarden, and with it locked: one sentence, and nothing is made.
  assert.equal((await turn.call('create_ssh_key', ask)).error, `Error: ${VAULT_SAY.noBitwarden}`);
  assert.equal((await setUp()).status, 200);
  const locked = await turn.call('create_ssh_key', ask);
  assert.equal(locked.error, `Error: ${VAULT_SAY.locked}`);
  assert.equal((await unlock()).status, 200);
  assert.deepEqual(await sshItems(), [], 'nothing made while it was locked');

  // Refusals: no such bot, the Chief itself.
  assert.equal((await turn.call('create_ssh_key', { name: 'X', bots: ['Ghost'] })).error, 'Error: There is no bot "Ghost". Nothing was made or changed.');
  assert.equal((await turn.call('create_ssh_key', { name: 'X', bots: ['me'] })).error, `Error: ${VAULT_SAY.self}`);
  const headers = { 'X-Chief-Chat': turn.chat.id };
  const ghost = await srv.asChief('/vault/ssh-keys', { method: 'POST', body: { name: 'X', allowedBots: ['nobot'] }, headers });
  assert.deepEqual([ghost.status, ghost.data.error], [400, 'There is no bot "nobot". Nothing was made.']);
  // A key of the Chief's own is never taken, not even generate's word with it.
  const pasted = await srv.asChief('/vault/ssh-keys', { method: 'POST', body: { name: 'Mine', privateKey: sshKeys.generate('x').privateKey }, headers });
  assert.deepEqual([pasted.status, pasted.data.error], [400, VAULT_SAY.noPaste]);
  assert.deepEqual(await sshItems(), []);

  const made = await turn.call('create_ssh_key', ask);
  assert.equal(made.name, 'VPS Admin SSH');
  assert.match(made.publicKey, /^ssh-ed25519 AAAA\S+ botdot:VPS Admin SSH$/);
  assert.match(made.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.deepEqual(made.allowedBots, ['Infra Admin']);
  assert.equal(made.say, `The SSH key VPS Admin SSH is made, shared with Infra Admin. Its public key: ${made.publicKey} (fingerprint ${made.fingerprint}).`);
  assert.ok(!made.text.includes(BEGIN) && !made.text.includes('PRIVATE'), 'the answer holds no private key');

  // The Vault holds it, in the bot-dot folder, for Infra Admin; list_vault shows its public key.
  const [item] = await sshItems();
  assert.deepEqual([item.name, item.allowedBots, item.publicKey, item.fingerprint], ['VPS Admin SSH', [infra.id], made.publicKey, made.fingerprint]);
  const listed = await turn.call('list_vault');
  assert.deepEqual(Object.values(listed).filter((x) => typeof x === 'object'), [{ name: 'VPS Admin SSH', type: 'ssh-key', publicKey: made.publicKey, fingerprint: made.fingerprint, allowedBots: ['Infra Admin'] }]);
  assert.ok(!listed.text.includes(BEGIN));
  const reply = (await turn.end('Made it.')).messages.at(-1);
  assert.deepEqual([reply.startedBy, reply.read], ['owner', undefined], 'making a key reads nothing that is not the owner\'s');

  // The key is a real one, of the bot-dot folder, and Infra Admin's list has it; Scout's does not.
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'bitwarden-cli', 'items.json'), 'utf8')).find((i) => i.name === 'VPS Admin SSH');
  assert.equal(kept.type, 5);
  assert.ok(kept.folderId);
  assert.deepEqual(sshKeys.readPrivateKey(kept.sshKey.privateKey).publicKey, made.publicKey, 'its private key reads back as its public key, as ssh-keygen -y does');
  const held = await heldRun(srv, infra);
  const tools = rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: held.token });
  assert.ok((await tools.json('list_logins')).some((l) => l.kind === 'ssh-key' && l.name === 'VPS Admin SSH'));
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
  assert.ok(!srv.log.join('').includes(BEGIN), 'no private key in the log');
  assert.ok(!fs.readdirSync(path.join(srv.data, 'chief')).some((f) => fs.readFileSync(path.join(srv.data, 'chief', f), 'utf8').includes(BEGIN)), 'nor in a chat');
});

test('a turn the owner did not start is offered no create_ssh_key, and the route refuses it', async (t) => {
  const before = (await sshItems()).length;
  const plain = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  assert.ok(!(await names(plain)).includes('create_ssh_key'));
  const look = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, BOT_DOT_LOOK: '1' });
  assert.ok(!(await names(look)).includes('create_ssh_key'));
  const chat = await newChat();
  for (const headers of [{}, { 'X-Chief-Chat': chat.id }, { 'X-Chief-Chat': 'no-such-chat' }]) {
    const r = await srv.asChief('/vault/ssh-keys', { method: 'POST', body: { name: 'Unasked', allowedBots: [scout.id] }, headers });
    assert.deepEqual([r.status, r.data.error], [403, VAULT_SAY.notNow]);
  }
  assert.equal((await sshItems()).length, before);
  assert.ok((await srv.api('/version')).data.features.includes('chief-ssh-key-add'));
});

test('after a web search in the chat, create_ssh_key waits on a card and makes nothing before the owner\'s yes', async (t) => {
  const turn = await ownerTurn(t, 'Look up how to harden SSH, then make me a key called Hardened for Scout.');
  await turn.uses('WebSearch', { query: 'harden ssh' });
  const r = await turn.call('create_ssh_key', { name: 'Hardened', bots: ['Scout'] });
  assert.equal(r.held, true, r.text);
  assert.ok(!(await sshItems()).some((i) => i.name === 'Hardened'), 'nothing made');
  const card = (await srv.api('/asks?chief-action=1')).data.find((a) => a.kind === 'chief-action' && a.chatId === turn.chat.id);
  assert.equal(card.title, 'Make the SSH key “Hardened”');
  assert.ok(!JSON.stringify(card).includes(BEGIN));
  await turn.end('It waits for you.');

  srv.hold();
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.deepEqual([yes.status, yes.data.done], [200, true], JSON.stringify(yes.data));
  const told = await srv.nextRun((x) => isChief(x) && x.stdin.includes('Hardened'), 'the Chief told of the yes');
  assert.ok(!told.stdin.includes(BEGIN), 'what the Chief is told of the yes holds no private key');
  srv.release(told);
  srv.reply('Done.');
  srv.unhold();
  const item = (await sshItems()).find((i) => i.name === 'Hardened');
  assert.deepEqual(item.allowedBots, [scout.id]);
});
