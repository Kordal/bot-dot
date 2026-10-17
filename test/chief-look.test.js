// The Chief writes first (ADR 006): a look on a real botdot server with the stand-in Claude. The look is
// started by hand (BOT_DOT_LOOK_ON_DEMAND, as a test environment does); when one starts by itself is in look.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, feed, waitFor, sleep } = require('./helpers');
const look = require('../lib/look');

const ENV = { BOT_DOT_LOOK_ON_DEMAND: '1' };
let srv, f;
before(async () => {
  srv = await startServer({ env: ENV });
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // the tests run at any hour
  await makeBot(srv, { name: 'Recipe Keeper', description: 'Keeps the recipes on recipes.example.com tidy' });
  f = feed(srv);
  await f.wait('hello');
});
after(async () => { f.close(); await srv.stop(); });

const lookNow = async () => (await srv.api('/chief/look', { method: 'POST' })).data;
const lookRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff · look'));
const chiefRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff'));
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const replyDone = (id) => waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
const say = async (id, text) => { await srv.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text } }); return replyDone(id); };
const chatFiles = () => Object.fromEntries(fs.readdirSync(path.join(srv.data, 'chief')).sort().map((n) => [n, fs.readFileSync(path.join(srv.data, 'chief', n), 'utf8')]));
const writingFirst = async () => (await srv.api('/settings/writing-first')).data.writingFirst;
const record = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'looks.json'), 'utf8')).raised;
const flagged = (args, flag) => { const i = args.indexOf(flag) + 1; let j = i; while (j < args.length && !args[j].startsWith('--')) j++; return args.slice(i, j); };

const FIRST = 'Your duplicate check on recipes.example.com never finished. Want me to start it again?';
let chatId;

test('with no Chief chat, the message of a look starts a new chat, as a new reply', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('ratings'));
  assert.deepEqual((await srv.api('/chief')).data.chats, []);
  srv.reply(`${FIRST}\nIt stopped at step two.`);
  const r = await lookNow();
  assert.deepEqual([r.looked, r.posted], [true, true]);
  chatId = r.chatId;
  const chat = await chatOf(chatId);
  assert.equal(chat.title, FIRST.slice(0, 60), 'titled from its first words');
  assert.equal(chat.messages.length, 1);
  const { at, lookId, ...m } = chat.messages[0];
  assert.deepEqual(m, { role: 'chief', text: `${FIRST}\nIt stopped at step two.`, unasked: true, startedBy: 'botdot' });
  const [kept] = record();
  assert.deepEqual({ ...kept, at: undefined }, { id: lookId, chatId, at: undefined, text: `${FIRST}\nIt stopped at step two.`, rating: null, answer: null }, "kept in the look's record, which carries its id");
  assert.ok(Math.abs(Date.parse(kept.at) - Date.parse(at)) < 5000, 'at the time it was posted');
  assert.deepEqual([chat.unread, chat.firstUnread], [1, 0], 'it counts as new');
  assert.equal((await srv.api('/chief')).data.unread, 1);
  const ev = await f.wait('chief_reply', (d) => d.chatId === chatId);
  assert.deepEqual([ev.data.unasked, ev.data.new, ev.data.status, ev.data.error], [true, true, 'success', null], 'announced like a reply');
  assert.match(ev.data.text, /duplicate check/);
  await f.wait('unread', (d) => d.chat === `chief:${chatId}` && d.unread === 1);
  assert.deepEqual(await writingFirst(), { perDay: 3, sentToday: 1 });
});

test("a look is its own session with web search and botdot's reading tools only", async () => {
  const run = lookRuns().at(-1);
  assert.deepEqual(flagged(run.args, '--allowedTools'), look.TOOLS);
  assert.deepEqual(flagged(run.args, '--tools'), ['WebSearch'], 'no other built-in tool exists for it: none fetches a URL');
  for (const t of flagged(run.args, '--allowedTools')) assert.match(t, /^(WebSearch|mcp__botdot__(recall|list_bots|get_bot|list_runs|get_run))$/);
  assert.equal(run.botdot.env.BOT_DOT_LOOK, '1', "the tools server is told it's a look");
  assert.ok(!run.args.includes('--resume') && run.args.includes('--no-session-persistence') && !run.args.includes('--plugin-dir'));
  assert.deepEqual(flagged(run.args, '--permission-mode'), ['dontAsk']);
  assert.match(run.system, /answer exactly NOTHING/);
  assert.match(run.stdin, /- Recipe Keeper: Keeps the recipes on recipes\.example\.com tidy/);
  assert.equal(chiefRuns().length, 0, 'no turn of a chat ran');
});

test("the owner's next message in that chat reaches the Chief with the unasked message quoted once", async () => {
  srv.reply('Starting it again.');
  const chat = await say(chatId, 'yes, start it again');
  assert.equal(chat.messages[0].seen, true);
  const turn = chiefRuns().at(-1);
  assert.equal(turn.stdin.split('<your-unasked-message>').length, 2);
  assert.match(turn.stdin, new RegExp(`<your-unasked-message>\\n${FIRST.replace(/[.?]/g, '\\$&')}\\nIt stopped at step two\\.\\n</your-unasked-message>\\n\\nbotdot wrote that in a look[^\\n]*\\n\\nMy message: yes, start it again$`));
  // A chat's session from before the Chief wrote first lacks those instructions: the turn tells it what that was and how to stop it.
  assert.match(turn.stdin, /botdot wrote that in a look: a moment it gives you a few times a day to write to me first\. How often is my setting: when I want fewer, more or none \("stop writing first"\), change it with your writing_first tool \(perDay: 0 = off, up to 3\)\./);
  assert.equal(record()[0].answer, 'yes, start it again', "the owner's answer is in the look's record");
  assert.ok(!turn.args.includes('--tools'), "a chat's turn keeps the Chief's own tools");
  const system = turn.system;
  assert.match(system, /writing_first \(perDay: 0 = off, up to 3\) and confirm in one line/);
  assert.match(system, /lasting preference about these messages[^\n]*save it with remember, place "me"/);
  await say(chatId, 'thanks');
  assert.match(chiefRuns().at(-1).stdin, /<\/from-botdot>\n\nMy message: thanks$/);
  assert.doesNotMatch(chiefRuns().at(-1).stdin, /your-unasked-message|botdot wrote that in a look/, 'quoted once');
  assert.equal(record()[0].answer, 'yes, start it again', 'answered once');
});

test('a look that answers NOTHING, answers nothing or fails changes no chat file, announces nothing and is not counted', async () => {
  await sleep(200); // what the turns before it announced has arrived
  const before = chatFiles();
  const events = f.events.length;
  const looks = lookRuns().length;
  srv.reply('NOTHING');
  assert.deepEqual(await lookNow(), { looked: true, posted: false });
  srv.reply('');
  assert.deepEqual(await lookNow(), { looked: true, posted: false });
  fs.writeFileSync(path.join(srv.out, 'no-result'), '');
  assert.deepEqual(await lookNow(), { looked: true, posted: false, failed: true });
  fs.rmSync(path.join(srv.out, 'no-result'));
  fs.writeFileSync(path.join(srv.out, 'fail.txt'), 'Not signed in');
  assert.deepEqual(await lookNow(), { looked: true, posted: false, failed: true });
  fs.rmSync(path.join(srv.out, 'fail.txt'));
  assert.equal(lookRuns().length, looks + 4, 'each one did look');
  await sleep(200);
  assert.deepEqual(chatFiles(), before);
  assert.deepEqual(f.events.slice(events).map((e) => e.type), [], 'nothing on the live feed');
  assert.deepEqual(await writingFirst(), { perDay: 3, sentToday: 1 });
  assert.match(srv.log.join(''), /\[look\] a look failed: Not signed in/, "the problem is in the server's log");
});

test('👍 and 👎 are stored on an unasked message, announced on the feed and returned with the chat', async () => {
  const put = (index, body, who = srv.api) => who(`/chief/chats/${chatId}/messages/${index}/rating`, { method: 'PUT', body });
  let r = await put(0, { rating: 'up' });
  assert.deepEqual([r.status, r.data], [200, { ok: true, chatId, index: 0, rating: 'up' }]);
  const ev = await f.wait('rating', (d) => d.chatId === chatId && d.rating === 'up');
  assert.deepEqual([ev.data.index, ev.data.rating], [0, 'up']);
  assert.equal((await chatOf(chatId)).messages[0].rating, 'up');
  await put(0, { rating: 'down' });
  assert.equal((await chatOf(chatId)).messages[0].rating, 'down', '👎 replaces 👍');
  await put(0, { rating: null });
  await f.wait('rating', (d) => d.chatId === chatId && d.rating === null);
  assert.ok(!('rating' in (await chatOf(chatId)).messages[0]), 'cleared');
  assert.equal(record()[0].rating, null, "cleared in the look's record too");
  await put(0, { rating: 'up' });
  assert.equal(record()[0].rating, 'up', "the look's record follows the rating");
  await waitFor(() => f.events.filter((e) => e.type === 'rating').length === 4, { what: 'the four ratings on the feed' });

  // Anything else is refused and changes nothing.
  const before = chatFiles();
  const events = f.events.filter((e) => e.type === 'rating').length;
  const total = (await chatOf(chatId)).total;
  for (const [index, body, what] of [
    [1, { rating: 'up' }, "the owner's own message"], [2, { rating: 'up' }, 'an ordinary reply'], [total, { rating: 'up' }, 'no such message'],
    [-1, { rating: 'up' }, 'a negative index'], ['abc', { rating: 'up' }, 'no index'], [0, { rating: 'sideways' }, 'an unknown rating'],
    [0, { rating: 1 }, 'a number'], [0, {}, 'no rating'], [0, { rating: '' }, 'an empty rating'],
  ]) {
    r = await put(index, body);
    assert.equal(r.status, 400, what);
    assert.ok(r.data.error, what);
  }
  assert.equal((await srv.api('/chief/chats/nope/messages/0/rating', { method: 'PUT', body: { rating: 'up' } })).status, 404);
  assert.equal((await put(0, { rating: 'down' }, srv.asChief)).status, 403, 'the owner rates, not the Chief');
  await sleep(200);
  assert.deepEqual(chatFiles(), before);
  assert.equal(f.events.filter((e) => e.type === 'rating').length, events);
});

test("the next look's input holds the earlier unasked message with its rating and the owner's answer; its message goes to the chat the owner last used", async () => {
  const other = (await srv.api('/chief/chats', { method: 'POST' })).data; // a newer chat the owner never wrote in
  srv.reply('Proxmox 9 is out; your Homelab Manager still checks for 8.');
  const r = await lookNow();
  assert.deepEqual([r.posted, r.chatId], [true, chatId]);
  assert.equal((await chatOf(other.id)).messages.length, 0);
  const input = lookRuns().at(-1).stdin;
  assert.match(input, /Owner: yes, start it again\nYou: Starting it again\./);
  assert.match(input.slice(input.indexOf('Already raised')), /- \d{4}-\d\d-\d\d, rated up, the owner answered "yes, start it again": Your duplicate check on recipes\.example\.com never finished/);
  const last = (await chatOf(chatId)).messages.at(-1);
  assert.deepEqual([last.role, last.unasked, last.text], ['chief', true, 'Proxmox 9 is out; your Homelab Manager still checks for 8.']);
  assert.deepEqual(await writingFirst(), { perDay: 3, sentToday: 2 });
});

test('no look while the Chief is answering the owner', async () => {
  srv.hold();
  await srv.api(`/chief/chats/${chatId}/messages`, { method: 'POST', body: { text: 'what is new?' } });
  const looks = lookRuns().length;
  assert.deepEqual(await lookNow(), { looked: false, reason: 'busy' });
  assert.equal(lookRuns().length, looks);
  srv.unhold();
  await replyDone(chatId);
});

test('the Chief turns writing first down, off and on again for the owner; the setting and the count survive a restart', async () => {
  const set = (perDay) => srv.asChief('/settings/writing-first', { method: 'PUT', body: { perDay } });
  assert.deepEqual((await srv.asChief('/settings/writing-first')).data, { writingFirst: { perDay: 3, sentToday: 2 } });
  assert.deepEqual((await set(2)).data, { writingFirst: { perDay: 2, sentToday: 2 } });
  const looks = lookRuns().length;
  assert.deepEqual(await lookNow(), { looked: false, reason: 'limit' });
  assert.deepEqual((await set(0)).data.writingFirst.perDay, 0);
  assert.deepEqual(await lookNow(), { looked: false, reason: 'off' });
  for (const bad of [4, -1, 1.5, '2', null, undefined]) {
    const r = await set(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal((await writingFirst()).perDay, 0);
  }
  assert.equal((await srv.asChief('/chief/look', { method: 'POST' })).status, 403, 'only the owner starts a look by hand');

  // A chat from before botdot kept the look's record: its unasked message joins the record on the next start.
  fs.writeFileSync(path.join(srv.data, 'chief', 'older.json'), JSON.stringify({ id: 'older', title: 'Old', sessionId: null, createdAt: '2026-09-29T08:00:00.000Z', updatedAt: '2026-09-30T10:00:00.000Z', costUsd: 0, messages: [
    { role: 'chief', text: 'Your Fleet Doctor checks the wrong disk.', at: '2026-09-30T09:00:00.000Z', unasked: true, rating: 'down', seen: true },
    { role: 'user', text: 'which disk?', at: '2026-09-30T10:00:00.000Z' },
    // Posted, but its entry in the record was never saved (a failed write): it joins under its own id.
    { role: 'chief', text: 'A tip whose entry was lost.', at: '2026-09-30T11:00:00.000Z', unasked: true, lookId: 'lost-1' },
  ] }));
  const kept = record();
  f.close();
  await srv.stop();
  srv = await startServer({ dir: srv.dir, env: ENV });
  f = feed(srv);
  await f.wait('hello');
  const older = (await chatOf('older')).messages[0];
  assert.ok(older.lookId);
  assert.deepEqual(record(), [...kept,
    { id: older.lookId, chatId: 'older', at: '2026-09-30T09:00:00.000Z', text: 'Your Fleet Doctor checks the wrong disk.', rating: 'down', answer: 'which disk?' },
    { id: 'lost-1', chatId: 'older', at: '2026-09-30T11:00:00.000Z', text: 'A tip whose entry was lost.', rating: null, answer: null },
  ], 'adopted once, with its rating and answer');
  assert.equal((await chatOf('older')).messages[2].lookId, 'lost-1');
  assert.deepEqual(await writingFirst(), { perDay: 0, sentToday: 2 });
  assert.deepEqual(await lookNow(), { looked: false, reason: 'off' });
  await set(2);
  assert.deepEqual(await lookNow(), { looked: false, reason: 'limit' });
  assert.equal((await chatOf(chatId)).messages[0].rating, 'up', 'the rating is still there');
  assert.equal(lookRuns().length, looks, 'none of these looked');
  await set(3);
  // A second start adopts nothing again.
  const now = record();
  f.close();
  await srv.stop();
  srv = await startServer({ dir: srv.dir, env: ENV });
  f = feed(srv);
  await f.wait('hello');
  assert.deepEqual(record(), now);
});

test('the chat the owner last used was deleted: the message starts a new chat, not an older one', async () => {
  const older = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await say(older.id, 'an older question');
  await say(chatId, 'and back here'); // the chat the owner last used
  assert.equal((await srv.api(`/chief/chats/${chatId}`, { method: 'DELETE' })).data.ok, true);
  srv.reply('A third thing worth knowing about your recipes.');
  const r = await lookNow();
  assert.equal(r.posted, true);
  assert.ok(r.chatId !== chatId && r.chatId !== older.id);
  const chat = await chatOf(r.chatId);
  assert.deepEqual([chat.title, chat.messages.length, chat.messages[0].unasked], ['A third thing worth knowing about your recipes.', 1, true]);
  // The deleted chat's unasked messages, with their ratings and answers, are still in the record and in the look's input.
  const raised = lookRuns().at(-1).stdin.slice(lookRuns().at(-1).stdin.indexOf('Already raised'));
  assert.match(raised, /rated up, the owner answered "yes, start it again": Your duplicate check on recipes\.example\.com never finished/);
  assert.match(raised, /not rated, the owner answered "what is new\?": Proxmox 9 is out/);
  assert.ok(record().filter((x) => x.chatId === chatId).length === 2);
  assert.ok(!(await chatOf(older.id)).messages.some((m) => m.unasked));
  // The next one follows it there.
  assert.deepEqual(await lookNow(), { looked: false, reason: 'limit' });
  assert.deepEqual(await writingFirst(), { perDay: 3, sentToday: 3 });
});
