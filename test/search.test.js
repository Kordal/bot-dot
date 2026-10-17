// The search box (GET /api/search, memory.searchChats): what was asked and replied in every chat,
// with where to open each match.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test("finds a bot's run and a Chief reply, every word, the last one half typed", async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '💻' });
  srv.reply('The GitHub token expires on 24 December.');
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'When does the token expire?' } })).data;
  await srv.finished(run.id);
  const hits = await waitFor(async () => { const h = (await srv.api('/search?q=github%20toke')).data; return h.length ? h : null; }, { what: 'the run to be indexed' });
  assert.equal(hits[0].runId, run.id);
  assert.equal(hits[0].bot.id, bot.id);
  assert.match(hits[0].snippet, /«GitHub»/i);
  assert.deepEqual((await srv.api('/search?q=github%20pineapple')).data, [], 'every word must match');
  // A Chief reply opens its chat at that message.
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.reply('Your pineapple order is on its way.');
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Where is my order?' } });
  const [hit] = await waitFor(async () => { const h = (await srv.api('/search?q=pineapple')).data; return h.length ? h : null; }, { what: 'the reply to be indexed' });
  assert.equal(hit.chatId, chat.id);
  assert.equal(hit.index, 1);
  assert.equal(hit.title, 'Where is my order?');
});

test('one letter finds nothing', async () => {
  assert.deepEqual((await srv.api('/search?q=g')).data, []);
});
