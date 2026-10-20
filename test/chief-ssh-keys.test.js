// The Chief makes an SSH key by chat (#181, part of #180), and shares, unshares and renames one (#182): a new ed25519 key in the owner's Bitwarden, shared with
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
const heldAsksOf = async (chat) => (await srv.api('/asks?chief-action=1')).data.filter((a) => a.kind === 'chief-action' && a.chatId === chat.id);
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
  assert.deepEqual(VAULT_WRITES, ['create_ssh_key', 'update_vault_item']);
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
  assert.equal((await turn.call('create_ssh_key', { name: 'X', bots: ['Ghost'] })).error, 'Error: There is no bot "Ghost". Nothing was made.');
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
  assert.deepEqual(card.rows.map((r) => r.label).sort(), ['Allowed bots', 'Name'].sort(), JSON.stringify(card.rows));
  // What the route refuses is refused there too, before any card: a key of the Chief's own above all.
  const headers = { 'X-Chief-Chat': turn.chat.id };
  const pasted = await srv.asChief('/vault/ssh-keys', { method: 'POST', body: { name: 'Mine', privateKey: sshKeys.generate('x').privateKey }, headers });
  assert.deepEqual([pasted.status, pasted.data.error], [400, VAULT_SAY.noPaste]);
  const ghost = await srv.asChief('/vault/ssh-keys', { method: 'POST', body: { name: 'X', allowedBots: ['nobot'] }, headers });
  assert.equal(ghost.status, 400);
  const empty = await srv.asChief('/vault/ssh-keys', { method: 'POST', body: null, headers });
  assert.deepEqual([empty.status, empty.data.error], [400, 'Give the SSH key a name. Nothing was made.']);
  const cards = (await srv.api('/asks?chief-action=1')).data.filter((a) => a.kind === 'chief-action' && a.chatId === turn.chat.id);
  assert.deepEqual(cards.map((a) => a.id), [card.id], 'the refused calls made no card');
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

// ---------- changing a key (#182) ----------

const items = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'bitwarden-cli', 'items.json'), 'utf8'));
const sharedWith = async (bot) => {
  const held = await heldRun(srv, bot);
  const r = (await srv.api('/vault/session/logins', { headers: { 'X-Vault-Token': held.token } })).data;
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
  return { logins: r.logins.map((l) => l.name), notShared: r.notShared.map((l) => l.name) };
};

test('in a turn the owner started the Chief shares an SSH key with a bot, takes it off and renames the key, with no card; the key bytes stay', async (t) => {
  // A key whose bot list is empty, as one the owner made on the Vault page.
  const empty = (await srv.api('/vault/ssh-keys', { method: 'POST', body: { name: 'Empty key', generate: true } })).data;
  const bytes = items().find((i) => i.id === empty.id).sshKey;
  const turn = await ownerTurn(t, 'Add Infra Admin to Empty key.');
  assert.ok((await names(turn.tools)).includes('update_vault_item'));
  const added = await turn.call('update_vault_item', { item: 'empty key', add: ['Infra Admin'] });
  assert.deepEqual([added.name, added.botsBefore, added.botsAfter], ['Empty key', [], ['Infra Admin']]);
  assert.equal(added.say, 'Its bots were no bot and are now Infra Admin.');
  assert.deepEqual((await sshItems()).find((i) => i.id === empty.id).allowedBots, [infra.id]);
  assert.deepEqual(await heldAsksOf(turn.chat), [], 'no card');

  const renamed = await turn.call('update_vault_item', { item: 'Empty key', newName: 'VPS Admin ed25519' });
  assert.deepEqual([renamed.name, renamed.was, renamed.botsAfter, renamed.say], ['VPS Admin ed25519', 'Empty key', ['Infra Admin'], 'Renamed the SSH key Empty key to VPS Admin ed25519.']);
  const kept = items().find((i) => i.id === empty.id);
  assert.deepEqual([kept.name, kept.sshKey, kept.type], ['VPS Admin ed25519', bytes, 5], 'renamed, with its key bytes as they were');
  const same = await turn.call('update_vault_item', { item: 'VPS Admin ed25519', add: ['Infra Admin'] });
  assert.equal(same.say, 'Nothing changed: the SSH key VPS Admin ed25519 is shared with Infra Admin.');
  await turn.end();
  assert.ok((await sharedWith(infra)).logins.includes('VPS Admin ed25519'), "Infra Admin's list_logins has it");

  const off = await ownerTurn(t, 'Take Infra Admin off VPS Admin ed25519.');
  const taken = await off.call('update_vault_item', { item: 'VPS Admin ed25519', remove: ['Infra Admin'] });
  assert.deepEqual([taken.botsBefore, taken.botsAfter, taken.say], [['Infra Admin'], [], 'Its bots were Infra Admin and are now no bot.']);
  const reply = (await off.end()).messages.at(-1);
  assert.deepEqual([reply.startedBy, reply.read], ['owner', undefined], 'changing a key reads nothing that is not the owner\'s');
  const now = await sharedWith(infra);
  assert.ok(!now.logins.includes('VPS Admin ed25519') && now.notShared.includes('VPS Admin ed25519'), 'no longer usable by Infra Admin');
});

test('update_vault_item changes only an SSH key, only in a turn the owner started, and says why nothing changed', async (t) => {
  const login = (await srv.api('/vault', { method: 'POST', body: { name: 'Router', site: 'router.lan', username: 'admin', password: 'fixture-password' } })).data;
  const turn = await ownerTurn(t, 'Share my router login with Scout.');
  const refused = async (args, sentence) => assert.equal((await turn.call('update_vault_item', args)).error, `Error: ${sentence}`, JSON.stringify(args));
  await refused({ item: 'Router', add: ['Scout'] }, VAULT_SAY.onlyKeys('Router'));
  await refused({ item: 'Nothing here', add: ['Scout'] }, VAULT_SAY.noKey('Nothing here'));
  await refused({ item: 'Hardened' }, VAULT_SAY.nothing);
  await refused({ item: 'Hardened', add: ['Ghost'] }, VAULT_SAY.noBot('Ghost', 'changed'));
  await refused({ item: 'Hardened', add: ['me'] }, VAULT_SAY.selfChange);
  const headers = { 'X-Chief-Chat': turn.chat.id };
  const put = (id, body, h = headers) => srv.asChief(`/vault/${id}`, { method: 'PUT', body, headers: h });
  const hardened = (await sshItems()).find((i) => i.name === 'Hardened');
  assert.deepEqual([(await put(login.id, { allowedBots: [scout.id] })).status, (await put(login.id, { password: 'x' })).data.error], [400, VAULT_SAY.onlyKeys('Router')]);
  assert.deepEqual((await put(hardened.id, { name: ' ' })).data.error, 'Give the SSH key a name. Nothing was changed.');
  assert.equal((await put(hardened.id, { add: 'all' })).status, 400);
  assert.equal((await put(hardened.id, { privateKey: 'x', sshKey: {}, allowedBots: [scout.id] })).data.error, VAULT_SAY.nothing, 'nothing but a name and the bots to add or take off is taken');
  assert.deepEqual([(await put('no-such-item', { name: 'X' })).status, (await put('no-such-item', { name: 'X' })).data.error], [404, VAULT_SAY.noKey('no-such-item')]);
  // A login called as a key is is no reason to refuse the key.
  const twin = (await srv.api('/vault', { method: 'POST', body: { name: 'Hardened', site: 'hardened.lan', password: 'fixture-password' } })).data;
  assert.equal((await turn.call('update_vault_item', { item: 'Hardened', add: ['Scout'] })).say, 'Nothing changed: the SSH key Hardened is shared with Scout.');
  await srv.api(`/vault/${twin.id}`, { method: 'DELETE' });
  // With Bitwarden locked: one sentence, and nothing changes.
  await srv.api('/vault/bitwarden/lock', { method: 'POST' });
  await refused({ item: 'Hardened', newName: 'Late' }, VAULT_SAY.emptyVault);
  assert.deepEqual([(await put(hardened.id, { name: 'Late' })).status, (await put(hardened.id, { name: 'Late' })).data.error], [423, VAULT_SAY.lockedChange]);
  await unlock();
  await turn.end();
  assert.deepEqual((await srv.api('/vault')).data.find((i) => i.id === login.id).allowedBots, [], 'the login is as it was');

  // A turn the owner did not start: no tool, and the route refuses.
  const plain = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  assert.ok(!(await names(plain)).includes('update_vault_item'));
  const chat = await newChat();
  for (const h of [{}, { 'X-Chief-Chat': chat.id }]) assert.deepEqual((await put(hardened.id, { name: 'Unasked' }, h)).data.error, VAULT_SAY.notNowChange);
  assert.equal((await sshItems()).find((i) => i.id === hardened.id).name, 'Hardened');
  assert.ok((await srv.api('/version')).data.features.includes('chief-ssh-key-change'));
});

test('after a web search, a change to an SSH key waits on a card, and the owner\'s yes does it', async (t) => {
  const hardened = (await sshItems()).find((i) => i.name === 'Hardened');
  const turn = await ownerTurn(t, 'Read about SSH, then give Hardened to Infra Admin too.');
  await turn.uses('WebSearch', { query: 'ssh' });
  const r = await turn.call('update_vault_item', { item: 'Hardened', add: ['Infra Admin'] });
  assert.equal(r.held, true, r.text);
  assert.deepEqual((await sshItems()).find((i) => i.id === hardened.id).allowedBots, [scout.id], 'nothing changed');
  const [card] = await heldAsksOf(turn.chat);
  assert.equal(card.title, 'Change the SSH key “Hardened”');
  // A refused call makes no card.
  await srv.asChief(`/vault/${hardened.id}`, { method: 'PUT', body: { allowedBots: ['nobot'] }, headers: { 'X-Chief-Chat': turn.chat.id } });
  assert.equal((await heldAsksOf(turn.chat)).length, 1);
  assert.deepEqual(card.rows.map((r) => r.label).sort(), ['Add', 'Remove'], JSON.stringify(card.rows));
  await turn.end();
  // The owner changes the key's bots before the yes: the yes adds Infra Admin to what is there then.
  const other = await makeBot(srv, { name: 'Backup Bot' });
  await srv.api(`/vault/${hardened.id}`, { method: 'PUT', body: { allowedBots: [scout.id, other.id] } });
  srv.hold();
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.deepEqual([yes.status, yes.data.done], [200, true], JSON.stringify(yes.data));
  const told = await srv.nextRun((x) => isChief(x) && x.stdin.includes('Hardened'), 'the Chief told of the yes');
  srv.release(told);
  srv.reply('Done.');
  srv.unhold();
  assert.deepEqual((await sshItems()).find((i) => i.id === hardened.id).allowedBots, [scout.id, other.id, infra.id]);
});
