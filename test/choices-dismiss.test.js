// The owner puts away the quick answers under a reply with the small × (docs/api.md, "Putting quick answers away"):
// the run (or the Chief's message) keeps `choicesDismissed`, a reload and a restart keep it, Undo clears it, and the
// bot is told nothing and gets no message. Real botdot server, stand-in Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, makeBot, seedRuns, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;

test('a version with quick answers dismissed announces it in features', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('choices-dismiss'));
});

test('a dismissed run comes back dismissed, with its answers kept; Undo clears it; nobody is messaged', async () => {
  const bot = await makeBot(srv, { name: 'Quotz' });
  await srv.stop();
  const [asking, plain] = seedRuns(srv, bot, [{ prompt: 'Merge?', result: 'Merge #241?', choices: ['Yes, merge', 'No'], yes: 0 }, { prompt: 'Hi', result: 'Hello.' }]);
  srv = await startServer({ dir: srv.dir });
  const before = (await runsOf(bot)).length;

  let run = (await srv.api(`/runs/${asking}`)).data;
  assert.deepEqual([run.choices, run.choicesDismissed], [['Yes, merge', 'No'], undefined]);

  const put = await srv.api(`/runs/${asking}/choices-dismissed`, { method: 'PUT', body: { dismissed: true } });
  assert.equal(put.status, 200);
  assert.equal(put.data.choicesDismissed, true);
  run = (await runsOf(bot)).find((r) => r.id === asking);
  assert.equal(run.choicesDismissed, true, 'the chat list says so');
  assert.deepEqual(run.choices, ['Yes, merge', 'No'], 'the answers stay on the run: Undo brings them back');
  assert.equal(run.yes, 0);
  assert.equal((await runsOf(bot)).length, before, 'no message went to the bot');

  // A reload, and a restart of botdot: still put away.
  assert.equal((await srv.api(`/runs/${asking}?events=0`)).data.choicesDismissed, true);
  srv = await restartServer(srv);
  assert.equal((await srv.api(`/runs/${asking}?events=0`)).data.choicesDismissed, true, 'kept on disk');

  // Dismissing twice changes nothing; Undo clears the flag.
  assert.equal((await srv.api(`/runs/${asking}/choices-dismissed`, { method: 'PUT', body: { dismissed: true } })).data.choicesDismissed, true);
  const undone = await srv.api(`/runs/${asking}/choices-dismissed`, { method: 'PUT', body: { dismissed: false } });
  assert.equal(undone.status, 200);
  assert.equal('choicesDismissed' in undone.data, false);
  assert.equal('choicesDismissed' in (await srv.api(`/runs/${asking}?events=0`)).data, false);
  assert.equal((await runsOf(bot)).length, before);

  // A reply with no quick answers has none to put away, and a bad body is refused.
  const none = await srv.api(`/runs/${plain}/choices-dismissed`, { method: 'PUT', body: { dismissed: true } });
  assert.equal(none.status, 400);
  assert.equal((await srv.api(`/runs/${asking}/choices-dismissed`, { method: 'PUT', body: { dismissed: 'yes' } })).status, 400);
  assert.equal((await srv.api('/runs/nope/choices-dismissed', { method: 'PUT', body: { dismissed: true } })).status, 404);
});

test('the Chief cannot put the owner\'s quick answers away', async () => {
  const bot = await makeBot(srv, { name: 'Quiet' });
  await srv.stop();
  const [asking] = seedRuns(srv, bot, [{ prompt: 'Send?', result: 'Send it?', choices: ['Yes', 'No'] }]);
  srv = await startServer({ dir: srv.dir });
  assert.equal((await srv.asChief(`/runs/${asking}/choices-dismissed`, { method: 'PUT', body: { dismissed: true } })).status, 403);
  assert.equal('choicesDismissed' in (await srv.api(`/runs/${asking}?events=0`)).data, false);
});

test('the Chief cannot put away quick answers under a Chief message either', async () => {
  srv.reply('Send it?\n[[choices: Yes | No]]');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Draft it' } });
  const c = await waitFor(async () => { const x = (await srv.api(`/chief/chats/${chat.id}`)).data; return !x.busy && !x.messages.at(-1).pending ? x : null; }, { what: 'the Chief to reply' });
  const index = c.messages.length - 1;
  assert.equal((await srv.asChief(`/chief/chats/${chat.id}/messages/${index}/choices-dismissed`, { method: 'PUT', body: { dismissed: true } })).status, 403);
  assert.equal('choicesDismissed' in (await srv.api(`/chief/chats/${chat.id}`)).data.messages[index], false);
});

test('a Chief message keeps its quick answers put away, and Undo brings them back', async () => {
  srv.reply('Shall I send it now?\n[[choices: Yes | No]]');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Draft a note' } });
  const read = () => waitFor(async () => { const c = (await srv.api(`/chief/chats/${chat.id}`)).data; return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
  let c = await read();
  const index = c.messages.length - 1;
  assert.deepEqual(c.messages[index].choices, ['Yes', 'No']);
  assert.equal(c.messages[index].choicesDismissed, undefined);
  const turns = srv.runs().length;

  const put = await srv.api(`/chief/chats/${chat.id}/messages/${index}/choices-dismissed`, { method: 'PUT', body: { dismissed: true } });
  assert.deepEqual([put.status, put.data.dismissed], [200, true]);
  c = (await srv.api(`/chief/chats/${chat.id}`)).data;
  assert.equal(c.messages[index].choicesDismissed, true);
  assert.deepEqual(c.messages[index].choices, ['Yes', 'No']);
  assert.equal(c.messages.length, index + 1, 'no message was sent');
  assert.equal(srv.runs().length, turns, 'the Chief was not told');

  srv = await restartServer(srv);
  assert.equal((await srv.api(`/chief/chats/${chat.id}`)).data.messages[index].choicesDismissed, true, 'kept on disk');
  await srv.api(`/chief/chats/${chat.id}/messages/${index}/choices-dismissed`, { method: 'PUT', body: { dismissed: false } });
  assert.equal('choicesDismissed' in (await srv.api(`/chief/chats/${chat.id}`)).data.messages[index], false);

  // The owner's own message has none to put away; a bad index or body is refused.
  assert.equal((await srv.api(`/chief/chats/${chat.id}/messages/0/choices-dismissed`, { method: 'PUT', body: { dismissed: true } })).status, 400);
  assert.equal((await srv.api(`/chief/chats/${chat.id}/messages/${index}/choices-dismissed`, { method: 'PUT', body: {} })).status, 400);
  assert.equal((await srv.api(`/chief/chats/${chat.id}/messages/99/choices-dismissed`, { method: 'PUT', body: { dismissed: true } })).status, 400);
});
