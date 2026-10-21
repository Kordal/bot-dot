// A reminder stays in reminders.json until its ⏰ message is in its chat (chief.js remindersDue, #307): a
// delivery that fails keeps it for a later run, keeps the others of the same run going, and leaves the server up.
// A chat is broken by putting a directory where its file was, after the server started (it reads every chat as it
// starts), so reading and writing it fail for any user, root too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, feed, waitFor, sleep } = require('./helpers');

const soon = (ms) => new Date(Date.now() + ms).toISOString(); // past the run addReminder starts
const chatPath = (srv, id) => path.join(srv.data, 'chief', `${id}.json`);
// Put a directory where the chat's file is; mend() puts the file back as it was.
function breakChat(srv, id) {
  const file = chatPath(srv, id);
  const kept = fs.readFileSync(file);
  fs.rmSync(file);
  fs.mkdirSync(file);
  return () => { fs.rmSync(file, { recursive: true }); fs.writeFileSync(file, kept); };
}
const bells = (chat, text) => chat.messages.filter((m) => m.text === `⏰ ${text}`);
const reminderTexts = async (srv) => (await srv.api('/chief/reminders')).data.map((r) => r.text);
// A ⏰ message for this chat on the feed: the reminder runs come every second in the tests (helpers.js).
const bell = (events, chatId) => waitFor(() => events.events.find((e) => e.type === 'chief_reply' && e.data.chatId === chatId), { timeout: 20_000, what: `a reminder in ${chatId}` });

test('a reminder whose chat cannot be written is kept, the others of the run go off, and the server stays up', { timeout: 90_000 }, async () => {
  const srv = await startServer();
  const events = await feed(srv);
  try {
    await events.wait('hello');
    const a = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const b = (await srv.api('/chief/chats', { method: 'POST' })).data;
    // Due at the same moment, so one run has both; A's was set first, so its failure comes before B's turn.
    const at = soon(3000);
    for (const [chat, text] of [[a, 'Water the plants'], [b, 'Call the bank']]) {
      const r = await srv.api('/chief/reminders', { method: 'POST', body: { text, at, chatId: chat.id } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
    }
    const mend = breakChat(srv, a.id);

    await bell(events, b.id);
    assert.equal(bells((await srv.api(`/chief/chats/${b.id}`)).data, 'Call the bank').length, 1);
    assert.deepEqual(await reminderTexts(srv), ['Water the plants'], "A's is kept, B's is gone");
    assert.match(srv.log.join(''), /\[reminders\] .*EISDIR/, 'the failure is logged');
    assert.equal((await srv.api('/version')).status, 200, 'the server is still up');

    // Once its chat can be written again, a later run delivers it, once.
    mend();
    await bell(events, a.id);
    assert.equal(bells((await srv.api(`/chief/chats/${a.id}`)).data, 'Water the plants').length, 1);
    assert.deepEqual(await reminderTexts(srv), []);
    assert.equal(events.events.filter((e) => e.type === 'chief_reply').length, 2, 'one chief_reply each');
  } finally {
    events.close();
    await srv.stop();
  }
});

// A Chief turn in a chat: the Chief's turn, held, and what started it.
async function heldTurn(srv, chat) {
  srv.hold();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Plan my week' } });
  return srv.nextRun((x) => x.args.includes('🧭 Chief of Staff'), 'the Chief');
}

test('a reminder for a chat whose Chief turn is going on is handed to it once and kept until the turn is saved', { timeout: 90_000 }, async () => {
  const srv = await startServer();
  const events = await feed(srv);
  try {
    await events.wait('hello');
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const turn = await heldTurn(srv, chat);
    await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Stretch', at: soon(0), chatId: chat.id } });
    await sleep(2_500); // the run addReminder starts, and the next ones
    assert.deepEqual(await reminderTexts(srv), ['Stretch'], 'kept while the turn goes on');
    assert.equal(bells(JSON.parse(fs.readFileSync(chatPath(srv, chat.id), 'utf8')), 'Stretch').length, 0, 'not in the chat yet');

    srv.release(turn);
    await bell(events, chat.id);
    await waitFor(async () => (await reminderTexts(srv)).length === 0, { what: 'the reminder to be removed' });
    assert.equal(bells((await srv.api(`/chief/chats/${chat.id}`)).data, 'Stretch').length, 1, 'once, though two runs saw it due');
  } finally {
    events.close();
    srv.unhold();
    await srv.stop();
  }
});

test('a reminder handed to a turn whose save fails goes off after the restart', { timeout: 90_000 }, async () => {
  let srv = await startServer();
  try {
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const turn = await heldTurn(srv, chat);
    await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Pay rent', at: soon(0), chatId: chat.id } });
    // The run addReminder starts at once hands it to the turn, which goes on until it is released; a later run
    // hands it to the turn too, without reading the chat that is broken now.
    const mend = breakChat(srv, chat.id);
    srv.release(turn);
    // The turn's own save fails: the server stays up and tries it again later (#343). The reminder is kept until then.
    await waitFor(() => /\[chief\] .*EISDIR/.test(srv.log.join('')), { what: 'the failed save to be logged' });
    assert.deepEqual(await reminderTexts(srv), ['Pay rent']);

    mend();
    srv.unhold();
    srv = await restartServer(srv);
    await waitFor(async () => bells((await srv.api(`/chief/chats/${chat.id}`)).data, 'Pay rent').length === 1, { timeout: 20_000, what: 'the reminder after the restart' });
    assert.deepEqual(await reminderTexts(srv), []);
  } finally {
    srv.unhold();
    await srv.stop();
  }
});

test('a reminder cancelled while it waits in a turn does not go off', { timeout: 60_000 }, async () => {
  const srv = await startServer();
  const events = await feed(srv);
  try {
    await events.wait('hello');
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const turn = await heldTurn(srv, chat);
    const other = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const at = soon(0);
    const r = (await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Feed the cat', at, chatId: chat.id } })).data;
    // One due with it in a chat with no turn: once that one is on the feed, a run has had both.
    await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Lock the door', at, chatId: other.id } });
    await bell(events, other.id);
    assert.deepEqual(await reminderTexts(srv), ['Feed the cat'], 'still listed');
    assert.equal(bells(JSON.parse(fs.readFileSync(chatPath(srv, chat.id), 'utf8')), 'Feed the cat').length, 0, 'not in the chat yet');
    assert.doesNotMatch(srv.log.join(''), new RegExp(`\\[reminders\\] ${r.id}`), 'not failed: handed to the turn');
    assert.equal((await srv.api(`/chief/reminders/${r.id}`, { method: 'DELETE' })).data.ok, true);
    srv.release(turn);
    await events.wait('chief_reply', (d) => d.chatId === chat.id);
    assert.equal(bells((await srv.api(`/chief/chats/${chat.id}`)).data, 'Feed the cat').length, 0);
    assert.deepEqual(await reminderTexts(srv), []);
  } finally {
    events.close();
    srv.unhold();
    await srv.stop();
  }
});

// The chat is on screen, so telling the feed marks it read; a directory where read-positions.json is saved fails that.
test('a reminder whose chat is in, but whose feed could not be told, is removed and not posted again', { timeout: 60_000 }, async () => {
  const srv = await startServer();
  const events = await feed(srv);
  const blocker = path.join(srv.data, `read-positions.json.${srv.pid}.tmp`);
  try {
    await events.wait('hello');
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    assert.equal((await srv.api('/read', { method: 'POST', body: { app: 'test-app', chat: `chief:${chat.id}` } })).status, 200);
    const r = (await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Take the pills', at: soon(3000), chatId: chat.id } })).data;
    fs.mkdirSync(blocker);
    await waitFor(() => new RegExp(`\\[reminders\\] ${r.id}: .*EISDIR`).test(srv.log.join('')), { timeout: 20_000, what: 'the failed announce to be logged' });
    assert.deepEqual(await reminderTexts(srv), [], 'removed: its message is in the chat');
    await sleep(2_000); // the next runs
    assert.equal(bells(JSON.parse(fs.readFileSync(chatPath(srv, chat.id), 'utf8')), 'Take the pills').length, 1, 'not posted again');
    assert.equal(events.events.filter((e) => e.type === 'chief_reply').length, 0, 'the feed was not told');
  } finally {
    events.close();
    fs.rmSync(blocker, { recursive: true, force: true });
    await srv.stop();
  }
});

test('a reminder that went off but could not be taken off the list goes off once, and leaves it later', { timeout: 90_000 }, async () => {
  const srv = await startServer();
  const events = await feed(srv);
  // Saving reminders.json writes this file first (jsonfile.js): a directory there fails the save, and reading still works.
  const blocker = path.join(srv.data, `reminders.json.${srv.pid}.tmp`);
  try {
    await events.wait('hello');
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Back up the photos', at: soon(3000), chatId: chat.id } });
    fs.mkdirSync(blocker);
    await bell(events, chat.id);
    await sleep(2_000); // the next runs, which see it due and still listed
    assert.deepEqual(await reminderTexts(srv), ['Back up the photos']);
    assert.equal(bells((await srv.api(`/chief/chats/${chat.id}`)).data, 'Back up the photos').length, 1, 'not posted again');

    fs.rmSync(blocker, { recursive: true });
    await waitFor(async () => (await reminderTexts(srv)).length === 0, { timeout: 40_000, what: 'the reminder to be removed' });
    assert.equal(bells((await srv.api(`/chief/chats/${chat.id}`)).data, 'Back up the photos').length, 1);
  } finally {
    events.close();
    fs.rmSync(blocker, { recursive: true, force: true });
    await srv.stop();
  }
});

test('a run that cannot read reminders.json is logged, and the server stays up', { timeout: 60_000 }, async () => {
  const srv = await startServer();
  try {
    fs.mkdirSync(path.join(srv.data, 'reminders.json')); // no reminder set yet, so no file is in its place
    await waitFor(() => /\[reminders\] .*EISDIR/.test(srv.log.join('')), { timeout: 20_000, what: 'the failed run to be logged' });
    assert.equal((await srv.api('/version')).status, 200, 'the server is still up');
  } finally {
    await srv.stop();
  }
});
