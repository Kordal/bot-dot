const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, feed } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

test('Chief delete_bot publishes the bot list change while its turn is still running', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const bot = await makeBot(srv);
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Delete the test bot' } });
  const chief = await srv.nextRun((run) => run.botdot);
  const live = await feed(srv);
  t.after(() => live.close());
  await live.wait('hello');
  const tools = rpcClient(t, 'mcp-server.js', chief.botdot.env);
  const result = await tools.json('delete_bot', { id: bot.id, userConfirmed: true });
  assert.equal(result.ok, true);
  await live.wait('bots');
  assert.equal((await srv.api('/bots')).data.some((b) => b.id === bot.id), false);
  assert.equal((await srv.api(`/chief/chats/${chat.id}`)).data.busy, true);
  assert.equal(live.events.some((event) => event.type === 'chief_reply'), false);
  srv.unhold();
});
