// A bot keeps a secret it made or holds (a database password, an app secret) in the Vault with save_to_vault (ADR
// 153): botdot reads it from a file on the bot's computer, or makes a new one, and it waits on a card in the bot's
// chat and in Needs you. Only the owner's yes saves it, as a login shared with that bot; the owner can show the secret
// on the card first. The secret never goes back to the bot, nor into the list of cards.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, makeBot, heldRun, waitFor, fakeDocker } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv; let bot; let other; let docker;
const vaultTools = (t, token) => rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: token });
const login = async (name) => (await srv.api('/vault')).data.find((l) => l.name === name);
const saveCards = async (botId = bot.id) => (await srv.api('/asks?vault-save=1')).data.filter((a) => a.kind === 'vault-save' && a.botId === botId);

before(async () => {
  docker = fakeDocker();
  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"'); // the account's computer is on
  docker.answer('labels.txt', '2|2'); // and current
  srv = await startServer({ env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  bot = await makeBot(srv, { name: 'Infra Admin', emoji: '🛠', computer: 'linux' });
  other = await makeBot(srv, { name: 'Mail Sorter', emoji: '📬' });
  for (const body of [
    { name: 'Qwotz prod DB', site: 'db.qwotz.example', username: 'qwotz', password: 'old-db-pass', allowedBots: [bot.id] },
    { name: 'NAS', site: 'nas.local', username: 'admin', password: 'nas-pass', allowedBots: [other.id] },
  ]) assert.equal((await srv.api('/vault', { method: 'POST', body })).status, 201);
});
after(async () => { srv.unhold(); await srv.stop(); docker.remove(); });

test('a new secret botdot makes is saved at once for that bot, with no card (ADR 177)', async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const said = await vaultTools(t, token).text('save_to_vault', { name: 'Qwotz prod secrets', site: '57.129.155.118', generate: true, reason: 'The app secret of Qwotz prod, for the launch on OVH.' });
  assert.match(said, /^Saved "Qwotz prod secrets" in the Vault, shared with you/);
  assert.match(said, /Never write the secret in your reply/);
  assert.deepEqual(await saveCards(), [], 'no card');
  const saved = await login('Qwotz prod secrets');
  assert.deepEqual([saved.site, saved.allowedBots, saved.hasPassword], ['57.129.155.118', [bot.id], true]);
  assert.ok((await srv.api('/version')).data.features.includes('vault-save'));
});

test('a secret in a file on its computer replaces the one of a login shared with it, after the yes', async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  docker.answer('exec.txt', 'new-db-pass\n');
  t.after(() => docker.answer('exec.txt', null));
  const said = await vaultTools(t, token).text('save_to_vault', { name: 'qwotz PROD db', file: '/tmp/db-pass', reason: 'Rotated.' });
  assert.match(said, /replace the secret of "Qwotz prod DB"/);
  assert.ok(docker.calls().some((c) => c.args[0] === 'exec' && c.args.includes('/tmp/db-pass')), 'read on its computer');
  const [card] = await saveCards();
  assert.equal(card.title, 'Let Infra Admin replace the secret of “Qwotz prod DB”?');
  assert.deepEqual(card.parts[1], { label: 'Source', now: '/tmp/db-pass on its computer' });
  assert.equal((await srv.api(`/asks/${card.id}/secret`)).data.value, 'new-db-pass', 'the final newline is not the secret');
  const before = await login('Qwotz prod DB');
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  const after = await login('Qwotz prod DB');
  assert.equal(after.id, before.id, 'the same login');
  assert.notEqual(after.updatedAt, before.updatedAt);
  assert.equal((await srv.api('/vault')).data.filter((l) => /qwotz prod db/i.test(l.name)).length, 1);
});

test("refused: another bot's entry, no source or two, an empty file; a no is not asked again", async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const tools = vaultTools(t, token);
  const refused = async (args, re) => {
    const r = await tools.call('save_to_vault', { reason: 'r', ...args });
    assert.ok(r.isError, JSON.stringify(r));
    assert.match(r.content[0].text, re);
  };
  await refused({ name: 'NAS', generate: true }, /not a login of yours to change/);
  await refused({ name: 'X', site: 'x.example' }, /either file/);
  await refused({ name: 'X', site: 'x.example', generate: true, file: '/tmp/x' }, /either file/);
  await refused({ name: 'X', generate: true }, /which address/);
  await refused({ name: 'X', site: 'x.example', generate: true, type: 'github-app' }, /GitHub App/);
  docker.answer('exec.txt', '\n');
  await refused({ name: 'X', site: 'x.example', file: 'empty' }, /is empty/);
  docker.answer('exec.txt', null);
  assert.deepEqual(await saveCards(), []);

  const before = await login('Qwotz prod DB');
  await tools.text('save_to_vault', { name: 'Qwotz prod DB', generate: true, reason: 'r' });
  const [card] = await saveCards();
  assert.ok(card, 'a replacement waits on a card');
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } })).status, 200);
  assert.equal((await login('Qwotz prod DB')).updatedAt, before.updatedAt, 'a no changes nothing');
  await refused({ name: 'qwotz PROD db', generate: true }, /said no to this recently/);
  // The Show of an answered card finds nothing.
  assert.equal((await srv.api(`/asks/${card.id}/secret`)).status, 404);
});

test("nobody but the owner answers it, and a login taken from the bot meanwhile saves nothing", async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, other);
  t.after(() => srv.release(rec));
  const relay = (await srv.api('/vault', { method: 'POST', body: { name: 'Mail relay', site: 'smtp.example', password: 'old', allowedBots: [other.id] } })).data;
  await vaultTools(t, token).text('save_to_vault', { name: 'Mail relay', generate: true, reason: 'r' });
  const [card] = await saveCards(other.id);
  for (const headers of [{ 'X-Run-Token': token }, { 'X-Vault-Token': token }]) {
    const r = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/asks/${card.id}/secret`, { headers: { 'X-Bot-Dot': '1', ...headers } });
    assert.equal(r.status, 403);
  }
  assert.equal((await srv.asChief(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).status, 403);
  // The owner takes the login from the bot meanwhile: the yes saves nothing.
  await srv.api(`/vault/${relay.id ?? (await login('Mail relay')).id}`, { method: 'PUT', body: { allowedBots: [] } });
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 409);
  assert.match(yes.data.error, /no longer a login of/);
  assert.deepEqual(await saveCards(other.id), [], 'the card goes');
  assert.deepEqual((await login('Mail relay')).allowedBots, [], "the owner's entry is as it was");
});
