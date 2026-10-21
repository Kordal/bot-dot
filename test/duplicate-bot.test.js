// "Duplicate" (#227): a second bot with the same settings, such as Coder 2. It gets the original's settings and,
// from the owner, the Vault entries the original may use; never its jobs, memory, chats or groups. The Chief's
// duplicate_bot makes the same copy, with no Vault entry and what it may not give waiting on a card.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv; let coder; let portal; let other;
before(async () => {
  srv = await startServer();
  coder = await makeBot(srv, {
    name: 'Coder', emoji: '👩‍💻', description: 'Writes the code', group: 'Work', systemPrompt: 'Be brief.',
    allowedTools: ['Read', 'Bash(git diff *)'], permissionMode: 'acceptEdits', model: 'sonnet', effort: 'high',
    computer: 'linux', computerAlwaysOn: true, useSkills: true, disabledSkills: ['pdf'], connectors: ['github'],
    mayMessageAll: false, othersMayAsk: false, outfit: { hat: 'cap' },
    jobs: [{ name: 'Nightly', kind: 'ai', cron: '0 3 * * *', prompt: 'Check the build.' }],
  });
  const helper = await makeBot(srv, { name: 'Helper' });
  await srv.api(`/bots/${coder.id}`, { method: 'PUT', body: { mayMessage: [helper.id] } });
  portal = (await srv.api('/vault', { method: 'POST', body: { name: 'Portal', site: 'portal.example.com', username: 'bart', password: 'portal-secret', allowedBots: [coder.id], inComputer: true } })).data;
  other = (await srv.api('/vault', { method: 'POST', body: { name: 'Other', site: 'other.example.com', username: 'x', password: 'other-secret', allowedBots: [helper.id] } })).data;
  await srv.api(`/bots/${coder.id}/learning/memory`, { method: 'POST', body: { action: 'add', text: 'The repo is bot-dot.' } });
  coder = (await srv.api(`/bots/${coder.id}`)).data;
});
after(() => srv.stop());

const COPIED = ['emoji', 'outfit', 'description', 'group', 'prompt', 'systemPrompt', 'allowedTools', 'permissionMode', 'model', 'effort',
  'computer', 'computerAlwaysOn', 'useSkills', 'skills', 'disabledSkills', 'connectors', 'mayMessageAll', 'mayMessage', 'othersMayAsk'];

test('the confirmation lists what is copied, the Vault entries by name, and the next free name', async () => {
  const r = await srv.api(`/bots/${coder.id}/duplicate`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.name, 'Coder 2');
  assert.deepEqual(r.data.logins, ['Portal']);
  assert.equal(r.data.vaultLocked, false);
  assert.ok(r.data.copies.includes('Its connected apps: github'));
  assert.ok(r.data.copies.includes("The account's computer, always on"));
  assert.ok(r.data.copies.includes('The Vault entries it may use: Portal'));
  assert.match(r.data.notCopied, /memory, chats, runs, jobs/);
  assert.ok(!JSON.stringify(r.data).includes('secret'));
});

test("the owner's copy has the settings, a new id, name and colour, and none of the jobs, memory or place", async () => {
  const r = await srv.api(`/bots/${coder.id}/duplicate`, { method: 'POST', body: {} });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const copy = r.data;
  assert.notEqual(copy.id, coder.id);
  assert.equal(copy.name, 'Coder 2');
  assert.notEqual(copy.color, coder.color);
  for (const k of COPIED) assert.deepEqual(copy[k], coder[k], k);
  assert.deepEqual(copy.jobs, [], 'no jobs');
  assert.equal(copy.pinned, 0);
  assert.deepEqual(copy.logins, ['Portal']);
  assert.equal((await srv.api(`/bots/${copy.id}/learning`)).data.memory.length, 0, 'an empty memory');
  assert.equal((await srv.api(`/runs?botId=${copy.id}`)).data.length, 0, 'no chat');
  assert.equal((await srv.api('/bots')).data.length, 3, 'Coder, Helper and the copy');

  // The copy may use what the original may, with the entry's own switches, and nothing else.
  const vault = (await srv.api('/vault')).data;
  assert.deepEqual(vault.find((e) => e.id === portal.id).allowedBots, [coder.id, copy.id]);
  assert.deepEqual(vault.find((e) => e.id === other.id).allowedBots, [other.allowedBots[0]]);
  const { rec, token } = await heldRun(srv, copy);
  const seen = (await srv.api('/vault/session/logins', { headers: { 'X-Vault-Token': token } })).data;
  assert.deepEqual(seen.logins.map((l) => [l.name, !!l.inComputer]), [['Portal', true]]);
  srv.unhold();
  srv.release(rec);

  // A copy of the copy is Coder 3; a name given is kept.
  assert.equal((await srv.api(`/bots/${copy.id}/duplicate`)).data.name, 'Coder 3');
  const named = await srv.api(`/bots/${coder.id}/duplicate`, { method: 'POST', body: { name: 'Reviewer' } });
  assert.equal(named.data.name, 'Reviewer');
  const taken = await srv.api(`/bots/${coder.id}/duplicate`, { method: 'POST', body: { name: 'coder' } });
  assert.equal(taken.status, 400, 'a name another bot has');
  assert.match(taken.data.error, /already/);
});

test("the Chief's copy shares no Vault entry, names them, and what it may not give waits for the owner", async () => {
  const r = await srv.asChief(`/bots/${coder.id}/duplicate`, { method: 'POST', body: { name: 'Coder Chief' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.name, 'Coder Chief');
  assert.deepEqual(r.data.loginsNotShared, ['Portal']);
  assert.ok(!('logins' in r.data));
  assert.ok(!r.data.allowedTools.includes('Bash(git diff *)'), 'commands wait on a card');
  assert.deepEqual(r.data.connectors, []);
  assert.equal(r.data.computer, 'none');
  assert.ok(r.data.waiting.length, JSON.stringify(r.data));
  assert.equal(r.data.prompt, coder.prompt);
  const vault = (await srv.api('/vault')).data;
  assert.ok(!vault.find((e) => e.id === portal.id).allowedBots.includes(r.data.id));
});

test('duplicate_bot is a Chief tool that answers the copy as create_bot does', async (t) => {
  const client = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const tool = (await client.request('tools/list')).tools.find((x) => x.name === 'duplicate_bot');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['id']);
  const made = await client.json('duplicate_bot', { id: coder.id });
  assert.match(made.name, /^Coder \d+$/);
  assert.equal(made.prompt, coder.prompt);
  assert.deepEqual(made.loginsNotShared, ['Portal']);
  assert.ok(Array.isArray(made.waiting));
});

test('a long name keeps its number within 60 characters', async () => {
  const long = await makeBot(srv, { name: 'L'.repeat(60) });
  const r = await srv.api(`/bots/${long.id}/duplicate`, { method: 'POST', body: {} });
  assert.equal(r.data.name, `${'L'.repeat(58)} 2`);
});

test('an unknown bot is not found', async () => {
  assert.equal((await srv.api('/bots/nope/duplicate', { method: 'POST', body: {} })).status, 404);
});
