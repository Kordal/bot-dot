// Asking the Chief to change one Board tile (#430): POST /api/dashboard/tiles/:id/change starts a Chief chat whose
// message names the tile (title, id, heading, bot) above the owner's words. The owner's alone; the web page draws
// the pencil and the popover (test/browser/tile-change.cjs).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor } = require('./helpers');
const { changeAsk } = require('../lib/tile-change');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('the ask names the tile in one quoted line, then the owner’s words', () => {
  assert.equal(changeAsk({ id: 't1', title: 'Mailbox', section: 'Home' }, '  Show the date\n', 'Home Helper'), '> Board tile “Mailbox” · id t1 · heading Home · bot Home Helper\n\nShow the date');
  assert.equal(changeAsk({ id: 't2', title: 'A\nB' }, 'x'), '> Board tile “A B” · id t2\n\nx', 'no heading or bot: left out; one line');
});

test('a change ask starts a Chief chat with the tile named; the features say tile-change', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('tile-change'));
  const bot = await makeBot(srv, { name: 'Home Helper' });
  const tile = (await srv.api('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Mailbox last opened', section: 'Home', bot: bot.id } })).data;
  srv.reply('On it.');
  const r = await srv.api(`/dashboard/tiles/${tile.id}/change`, { method: 'POST', body: { text: 'Turn it red after 2 days' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const turn = await srv.nextRun((x) => !!x.botdot, "the Chief's turn");
  assert.ok(JSON.stringify(turn).includes(`Board tile “Mailbox last opened” · id ${tile.id} · heading Home · bot Home Helper`));
  await waitFor(async () => !(await srv.api(`/chief/chats/${r.data.chatId}`)).data.busy, { what: 'the Chief to reply' });
  const chat = (await srv.api(`/chief/chats/${r.data.chatId}`)).data;
  assert.equal(chat.messages[0].text, `> Board tile “Mailbox last opened” · id ${tile.id} · heading Home · bot Home Helper\n\nTurn it red after 2 days`);
});

test('a change ask needs words and a tile, and only the owner sends one', async () => {
  const tile = (await srv.api('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Note' } })).data;
  assert.equal((await srv.api(`/dashboard/tiles/${tile.id}/change`, { method: 'POST', body: { text: '  ' } })).status, 400);
  assert.equal((await srv.api('/dashboard/tiles/nope/change', { method: 'POST', body: { text: 'x' } })).status, 404);
  assert.equal((await srv.asChief(`/dashboard/tiles/${tile.id}/change`, { method: 'POST', body: { text: 'x' } })).status, 403);
});
