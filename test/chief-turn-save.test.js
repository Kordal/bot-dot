// The save at the end of a Chief turn fails (#343): the server stays up, the turn ends (the chat is not busy, what
// waited behind it starts), the reply and what waited in the turn stay in the chat, and the save is tried again on
// the reminders' check (chief.js remindersDue, every 15 seconds, every second in the tests) until it works, each
// message once.
// A chat is broken by putting a directory where its file was, after the server started, so writing it fails for
// any user, root too (as test/reminder-delivery.test.js does).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, makeBot, feed, waitFor, sleep } = require('./helpers');

const chatPath = (srv, id) => path.join(srv.data, 'chief', `${id}.json`);
// Put a directory where the chat's file is; mend() puts the file back as it was.
function breakChat(srv, id) {
  const file = chatPath(srv, id);
  const kept = fs.readFileSync(file);
  fs.rmSync(file);
  fs.mkdirSync(file);
  return () => { fs.rmSync(file, { recursive: true }); fs.writeFileSync(file, kept); };
}
const failedSaveLogged = (srv) => waitFor(() => /\[chief\] .*EISDIR/.test(srv.log.join('')), { what: 'the failed save to be logged' });
const onDisk = (srv, id) => JSON.parse(fs.readFileSync(chatPath(srv, id), 'utf8'));
const chatNow = async (srv, id) => (await srv.api(`/chief/chats/${id}`)).data;
const isChief = (x) => x.args.includes('🧭 Chief of Staff');
const isLook = (x) => x.args.includes('🧭 Chief of Staff · look');
const REPLY = 'Your week: three meetings and the dentist.';
const LOOK = 'Your backup bot has not run since Monday.';
const NOTICE = 'Declined: new main assignment for Mail Sorter.';
// What a chat shows, as [role, text, pending], from the owner's message on.
const shown = (chat) => chat.messages.map((m) => [m.role, m.text, !!m.pending]);
const SHOWN = [['user', 'Plan my week', false], ['chief', REPLY, false], ['chief', LOOK, false], ['chief', NOTICE, false]];

// A Chief turn, held, with a look's unasked message and a declined card's line waiting in it.
async function turnWithReports(srv) {
  fs.writeFileSync(path.join(srv.out, 'result-ChiefofStaff.txt'), REPLY);
  fs.writeFileSync(path.join(srv.out, 'result-ChiefofStafflook.txt'), LOOK);
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // the tests run at any hour
  const bot = await makeBot(srv, { name: 'Mail Sorter', prompt: 'Sort the mail.' });
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  const looked = srv.api('/chief/look', { method: 'POST' }); // a look starts before the owner writes
  const look = await srv.nextRun(isLook, 'the look');
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Plan my week' } });
  const turn = await srv.nextRun((x) => isChief(x) && !isLook(x), "the Chief's turn");
  // The look ends while the Chief answers: its message waits in the turn.
  srv.release(look);
  assert.equal((await looked).data.chatId, chat.id);
  // A card of the Chief's that the owner declines: botdot's line waits in the turn (post()).
  const change = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { prompt: 'Sort the mail.\nFlag the tax office.' }, headers: { 'X-Chief-Chat': chat.id } });
  assert.equal((await srv.api(`/asks/${change.data.pendingChange}`, { method: 'POST', body: { yes: false } })).status, 200);
  assert.deepEqual(shown(await chatNow(srv, chat.id)).map(([role]) => role), ['user', 'chief'], 'both wait in the turn');
  return { chat, turn };
}

test("a failed save at a turn's end leaves the server up, the chat idle, and the reply and what waited in the chat, saved once later", { timeout: 90_000 }, async () => {
  const srv = await startServer({ env: { BOT_DOT_LOOK_ON_DEMAND: '1' } });
  const events = await feed(srv);
  try {
    await events.wait('hello');
    const { chat, turn } = await turnWithReports(srv);
    const mend = breakChat(srv, chat.id);
    srv.release(turn);

    await failedSaveLogged(srv);
    await events.wait('chief_reply', (d) => d.chatId === chat.id && d.text === NOTICE);
    assert.equal((await srv.api('/version')).status, 200, 'the server is still up');
    const now = await chatNow(srv, chat.id);
    assert.equal(now.busy, false, 'the chat is not busy');
    assert.deepEqual(shown(now), SHOWN, 'the reply and what waited in the turn are in the chat');
    assert.deepEqual(events.events.filter((e) => e.type === 'chief_reply' && e.data.chatId === chat.id).map((e) => e.data.text), [REPLY, LOOK, NOTICE], 'the feed is told of each, once');

    // Once the chat can be written again, the next check saves it, each message once.
    mend();
    await waitFor(() => !onDisk(srv, chat.id).messages.some((m) => m.pending), { timeout: 40_000, what: 'the chat to be saved again' });
    assert.deepEqual(shown(onDisk(srv, chat.id)), SHOWN);
    assert.deepEqual(shown(await chatNow(srv, chat.id)), SHOWN, 'nothing appears twice');
    assert.equal(events.events.filter((e) => e.type === 'chief_reply' && e.data.chatId === chat.id).length, 3, 'the retried save tells the feed nothing again');

    // The owner writes there again and gets a reply.
    srv.unhold();
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Thanks' } });
    const after = await waitFor(async () => { const c = await chatNow(srv, chat.id); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the next reply' });
    assert.deepEqual(shown(after).slice(SHOWN.length), [['user', 'Thanks', false], ['chief', REPLY, false]]);
    assert.deepEqual(shown(onDisk(srv, chat.id)), shown(after));
  } finally {
    events.close();
    srv.unhold();
    await srv.stop();
  }
});

test("the owner's message that waited behind a turn whose save failed is started at once, and the chat is not left busy", { timeout: 90_000 }, async () => {
  const srv = await startServer();
  try {
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    srv.hold();
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Plan my week' } });
    const turn = await srv.nextRun(isChief, "the Chief's turn");
    const waits = await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'And next week' } });
    assert.equal(waits.data.queued.length, 1, 'it waits behind the reply');
    const mend = breakChat(srv, chat.id);
    srv.release(turn);

    // Its turn is tried at once; with the chat still unwritable it cannot start, and is logged, as a message is
    // whose chat cannot be written. Nothing waits for an end that never comes.
    await waitFor(async () => { const c = await chatNow(srv, chat.id); return c.busy === false && c.queued?.length === 0 ? c : null; }, { what: 'the waiting message to leave the queue' }); // the file cannot be read until the turn has ended
    assert.equal((await srv.api('/version')).status, 200, 'the server is still up');
    assert.deepEqual((await chatNow(srv, chat.id)).messages.slice(0, 2).map((m) => [m.role, !!m.pending]), [['user', false], ['chief', false]], 'the first reply is done');

    mend();
    srv.unhold();
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Thanks' } });
    await waitFor(async () => { const c = await chatNow(srv, chat.id); return !c.busy && c.messages.at(-1).role === 'chief' && !c.messages.at(-1).pending ? c : null; }, { what: 'the next reply' });
  } finally {
    srv.unhold();
    await srv.stop();
  }
});

test('a restart before the save worked again: the reply shows as cut off, as before', { timeout: 60_000 }, async () => {
  let srv = await startServer();
  try {
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    srv.hold();
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Plan my week' } });
    const turn = await srv.nextRun(isChief, "the Chief's turn");
    const mend = breakChat(srv, chat.id);
    srv.release(turn);
    await failedSaveLogged(srv);
    srv.unhold();
    srv = await restartServer(srv, mend);
    const after = await chatNow(srv, chat.id);
    assert.deepEqual(after.messages.map((m) => [m.role, m.error || null]), [['user', null], ['chief', 'This reply was cut off because botdot was restarted.']]);
  } finally {
    srv.unhold();
    await srv.stop();
  }
});

test('a reminder that waited in a turn whose save failed goes off once, and leaves the list when the save works', { timeout: 90_000 }, async () => {
  const srv = await startServer();
  const reminders = async () => (await srv.api('/chief/reminders')).data.map((r) => r.text);
  const bells = (chat) => chat.messages.filter((m) => m.text === '⏰ Pay rent').length;
  try {
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    srv.hold();
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Plan my week' } });
    const turn = await srv.nextRun(isChief, "the Chief's turn");
    await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Pay rent', at: new Date().toISOString(), chatId: chat.id } });
    await sleep(1000); // the run addReminder starts hands it to the turn
    const mend = breakChat(srv, chat.id);
    srv.release(turn);
    await failedSaveLogged(srv);
    await sleep(2_000); // the next checks, with the chat still unwritable
    assert.deepEqual(await reminders(), ['Pay rent'], 'kept until its message is saved');
    assert.equal(bells(await chatNow(srv, chat.id)), 1, 'in the chat once, not posted again');

    mend();
    await waitFor(async () => (await reminders()).length === 0, { timeout: 40_000, what: 'the reminder to leave the list' });
    assert.equal(bells(onDisk(srv, chat.id)), 1);
  } finally {
    srv.unhold();
    await srv.stop();
  }
});
