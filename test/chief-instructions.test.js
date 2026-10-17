// The Chief's current instructions reach every chat (CHF-007). Claude Code keeps a resumed session's first
// system prompt, so a resumed turn carries the time, the shared memory and the mentions every time, and the
// standing instructions once after they change. With the stand-in Claude, on a real botdot server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv, chatId;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_LOOK_ON_DEMAND: '1' } });
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // the look runs at any hour
  await makeBot(srv, { name: 'Todo Keeper', description: 'Keeps the to-do list' });
});
after(() => srv.stop());

const chiefRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff'));
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const say = async (id, text) => {
  await srv.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text } });
  await waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
  return chiefRuns().at(-1);
};
const note = async (text) => assert.equal((await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text, pinned: true } })).status, 201);
const context = (turn) => turn.stdin.match(/^<from-botdot>\n[\s\S]*?\n<\/from-botdot>\n\n/)?.[0] || null;
const NOW = /Now: \w+day \d{4}-\d\d-\d\dT\d\d:\d\d local time/;

test("a new chat's first turn gets everything as its system prompt and the owner's words alone", async () => {
  await note('QUOKKA The owner lives in Warsaw.');
  chatId = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  const turn = await say(chatId, 'Hello');
  assert.ok(!turn.args.includes('--resume'));
  assert.match(turn.system, /You are the Chief of Staff in botdot/);
  assert.match(turn.system, /save it with remember, place "me"/);
  assert.match(turn.system, /<shared-memory>\n[^]*QUOKKA The owner lives in Warsaw\.[^]*<\/shared-memory>/);
  assert.match(turn.system, NOW);
  assert.equal(turn.stdin, 'Hello');
});

test('a resumed turn carries the time, the shared memory and the mentions, and not the unchanged instructions', async () => {
  await note('WALLABY The owner works from home on Fridays.');
  const turn = await say(chatId, 'What do you know about me? Ask @TodoKeeper too.');
  assert.ok(turn.args.includes('--resume'));
  const told = context(turn);
  assert.ok(told, 'the turn starts with what botdot adds');
  assert.match(told, /botdot adds this to my message; it isn't my words\./);
  assert.match(told, NOW);
  assert.match(told, /<shared-memory>\n[^]*WALLABY The owner works from home on Fridays\.[^]*<\/shared-memory>/, 'the shared memory as it is now');
  assert.match(told, /@TodoKeeper is the bot Todo Keeper \(id [^)]+\): Keeps the to-do list$/m);
  assert.doesNotMatch(told, /<instructions>|You are the Chief of Staff/, 'the session has its instructions already');
  assert.equal(turn.stdin.slice(told.length), 'My message: What do you know about me? Ask @TodoKeeper too.');
});

test('changed instructions are given once, on the next turn, and not on the turn after', async () => {
  assert.equal((await srv.api('/settings', { method: 'PUT', body: { chiefRules: 'Answer in Polish.' } })).status, 200);
  let turn = await say(chatId, 'Hi again');
  let told = context(turn);
  assert.match(told, /Your instructions have changed since this conversation started\. These are the current ones, and they replace the ones you were given then:\n<instructions>\nYou are the Chief of Staff in botdot/);
  const given = told.slice(told.indexOf('<instructions>'), told.indexOf('</instructions>'));
  assert.match(given, /<user-rules>\nAnswer in Polish\.\n<\/user-rules>/, "the owner's rules");
  assert.match(given, /writing_first \(perDay: 0 = off, up to 3\)/, 'what the Chief was told since older chats began');
  // What BUSY-002 changed reaches a chat that began before it: a late result is told to the Chief, and a note ends a wait.
  assert.match(given, /If the run is still going when the wait ends, say so in one line: botdot tells you in this chat when the bot is done, and you then report its result in a few lines\./);
  assert.match(given, /When wait_for_run answers with a note that the user wrote to you while you waited, the wait is over: do what the note says, in one line, and end your reply; the user's message is your next turn\./);
  assert.doesNotMatch(given, /will show up in this chat by itself|appears in this chat by itself/);
  assert.match(given, /\[\[choices:/, 'the note on choices');
  assert.match(given, /save it with remember, place "me"/);
  assert.match(given, /Your skills \(load one with the Skill tool when it fits\):\n- chief:board: [^\n]+\n- chief:memory-setup: /);
  assert.doesNotMatch(given, /<shared-memory>|Now: /, 'what changes every turn is outside them');
  assert.match(told, NOW);
  assert.match(told, /WALLABY/);
  assert.ok(turn.stdin.endsWith('\n\nMy message: Hi again'));

  turn = await say(chatId, 'Thanks');
  told = context(turn);
  assert.doesNotMatch(told, /<instructions>/, 'not repeated');
  assert.match(told, NOW);
  assert.match(told, /WALLABY/);
  assert.equal(turn.stdin.slice(told.length), 'My message: Thanks');
});

test('a chat from before this change gets the current instructions on its next turn', async () => {
  const file = path.join(srv.data, 'chief', `${chatId}.json`);
  const chat = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(chat.sessionId && chat.instructionsKey);
  delete chat.instructionsKey; // as botdot kept chats before
  fs.writeFileSync(file, JSON.stringify(chat));
  const turn = await say(chatId, 'stop writing first');
  assert.ok(turn.args.includes('--resume'));
  assert.match(context(turn), /<instructions>\n[^]*writing_first[^]*<\/instructions>/);
  assert.ok(turn.stdin.endsWith('\n\nMy message: stop writing first'));
  assert.doesNotMatch(context(await say(chatId, 'ok')), /<instructions>/);
});

test('what the owner sees and what recall finds are their own words', async () => {
  const chat = await chatOf(chatId);
  assert.deepEqual(chat.messages.filter((m) => m.role === 'user').map((m) => m.text),
    ['Hello', 'What do you know about me? Ask @TodoKeeper too.', 'Hi again', 'Thanks', 'stop writing first', 'ok']);
  const hits = async (q) => (await srv.api(`/memory/search?q=${encodeURIComponent(q)}&bot=chief`)).data.results;
  assert.ok((await hits('TodoKeeper')).length, "the owner's words are found");
  for (const q of ['WALLABY', 'botdot adds this', 'Polish']) assert.deepEqual(await hits(q), [], `${q}: not in the Chief's replies as the owner's words`);
});

test('a look is unchanged: its own session, nothing added to its prompt', async () => {
  srv.reply('NOTHING');
  assert.equal((await srv.api('/chief/look', { method: 'POST' })).data.looked, true);
  const run = srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff · look')).at(-1);
  assert.ok(!run.args.includes('--resume'));
  assert.doesNotMatch(run.stdin, /<from-botdot>|<instructions>/);
});

test('after Claude Code compacts the session, the next turn gives the instructions again', async (t) => {
  const events = path.join(srv.out, 'events.json');
  fs.writeFileSync(events, JSON.stringify([{ type: 'system', subtype: 'compact_boundary', session_id: 'compacted', compact_metadata: { trigger: 'auto' } }]));
  t.after(() => fs.rmSync(events, { force: true }));
  assert.doesNotMatch(context(await say(chatId, 'one more')), /<instructions>/);
  fs.rmSync(events);
  assert.match(context(await say(chatId, 'and again')), /<instructions>\n[^]*writing_first[^]*<\/instructions>/, 'its summary may have left them out');
  assert.doesNotMatch(context(await say(chatId, 'last one')), /<instructions>/);
});
