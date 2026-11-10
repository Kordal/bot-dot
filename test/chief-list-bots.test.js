// The Chief's tool answers are compact (#1099): JSON on one line, and list_bots without what only get_bot needs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, withAlways } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('list_bots names each hat, kit or drawn, and leaves out colour, tool lists and skills turned off; get_bot keeps them', async (t) => {
  const tools = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const kit = await makeBot(srv, { name: 'Kit Hat', allowedTools: ['Read'], outfit: { hat: 'beanie' } });
  const plain = await makeBot(srv, { name: 'No Hat' });
  const text = await tools.text('list_bots', {});
  assert.ok(!text.includes('\n'), 'one line');
  const listed = JSON.parse(text);
  const one = listed.find((b) => b.id === kit.id);
  for (const k of ['color', 'outfit', 'allowedTools', 'disabledSkills']) assert.ok(!(k in one), k);
  assert.equal(one.hat, (await srv.api(`/bots/${kit.id}`)).data.outfit?.hat ?? null);
  assert.equal(listed.find((b) => b.id === plain.id).hat, (await srv.api(`/bots/${plain.id}`)).data.outfit?.hat ? 'drawn' : null);
  for (const k of ['id', 'name', 'description', 'computer', 'jobs', 'running']) assert.ok(k in one, k);
  const full = await tools.json('get_bot', { id: kit.id });
  assert.deepEqual(full.allowedTools, withAlways('Read'));
  assert.ok('color' in full && 'outfit' in full);
});
