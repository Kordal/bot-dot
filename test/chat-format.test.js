// What bots and the Chief of Staff are told about the chat (lib/chat-format.js): which Markdown it draws, said in
// one text to every bot and to the Chief, and how a reply opens and how long it is, said to the Chief and to
// every bot. With the stand-in Claude, on a real botdot server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHAT_FORMAT, answerFirst } = require('../lib/chat-format');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const count = (text, part) => text.split(part).length - 1;
// What the old style note said in place of the new lines.
const REPLACED = /bullets or a few headings|Keep it as short as the task allows|Lead with the answer or the outcome, then/;
const LINE = /One exception: when the task needs tools \(searching, browsing, reading files, running something\), first write one short line saying what you are about to do, in the owner's language, under ten words, with no tool names \("Checking the weather in Brussels\."\)\. Then do the work\. Never more than this one line before your final reply\./;

test('one text says what the chat draws', () => {
  assert.match(CHAT_FORMAT, /^What the chat draws:/);
  assert.match(CHAT_FORMAT, /"## Title" on a line of its own, in place of a bold line/);
  assert.match(CHAT_FORMAT, /Use titles only in a reply of more than one section/);
  assert.match(CHAT_FORMAT, /lines that start with "-"/);
  assert.match(CHAT_FORMAT, /lines that start with "1\.", with a step's details indented under the step/);
  assert.match(CHAT_FORMAT, /Tables, quotes \(lines that start with ">"\) and code blocks/);
});

test('how a reply opens and how long it is: the answer first, under 150 words, sections when longer', () => {
  for (const who of ['the owner', 'the user']) {
    const said = answerFirst(who);
    assert.match(said, /^Start with the answer or the outcome, in one or two sentences\./);
    assert.match(said, /Aim for under 150 words\./);
    assert.ok(said.includes(`Go longer only when ${who} asked for a report or the details are the answer, and then give the reply sections.`));
  }
});

test('a bot is told what the chat draws, to start with the answer and the length', async () => {
  const { run, rec } = await heldRun(srv, await makeBot(srv, { name: 'Told' }));
  assert.equal(count(rec.system, CHAT_FORMAT), 1, 'the shared text, once');
  assert.equal(count(rec.system, answerFirst('the owner')), 1);
  assert.doesNotMatch(rec.system, REPLACED, 'no two lines say the same');
  // The rest of the style note reads as before.
  assert.match(rec.system, /Your final reply is read by a person in a simple chat window, not a terminal\. Write it like a helpful colleague would:\n- Plain, warm, conversational language, in short paragraphs\.\n- Start with the answer/);
  assert.match(rec.system, /- Don't narrate your process, tools, commands or file permissions, except what you tried when something failed\.\n/);
  assert.match(rec.system, LINE);
  assert.match(rec.system, /- No shell commands or code unless the task is about code and the person needs to see it\. Refer to files by name, not full paths\./);
  srv.release(rec); await srv.finished(run.id); srv.unhold();
});

test('a bot saved or sent with "friendly": false is told the same: the switch is gone', async () => {
  const bot = await makeBot(srv, { name: 'Own Style', friendly: false });
  assert.equal('friendly' in bot, false, 'the botdot server keeps no such field');
  const { run, rec } = await heldRun(srv, bot);
  assert.equal(count(rec.system, CHAT_FORMAT), 1);
  assert.equal(count(rec.system, answerFirst('the owner')), 1);
  assert.match(rec.system, LINE);
  srv.release(rec); await srv.finished(run.id); srv.unhold();
});

test('a memory-only start gets it too: the memory review of a bot', async () => {
  const bot = await makeBot(srv, { name: 'Reviewed' });
  srv.hold();
  const started = await srv.api(`/memory/review/${bot.id}`, { method: 'POST' });
  assert.equal(started.status, 200);
  const rec = await srv.nextRun((x) => x.self && x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes('This run is your memory review'), `the memory review of ${bot.name}`);
  assert.equal(count(rec.system, CHAT_FORMAT), 1);
  assert.equal(count(rec.system, answerFirst('the owner')), 1);
  srv.release(rec); srv.unhold();
  await waitFor(async () => !(await srv.api(`/bots/${bot.id}`)).data.busy, { what: 'the review to end' });
});

test('the Chief is told the same text, to start with the answer and the length', async () => {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  await srv.api(`/chief/chats/${chat}/messages`, { method: 'POST', body: { text: 'Hello' } });
  await waitFor(async () => { const c = (await srv.api(`/chief/chats/${chat}`)).data; return !c.busy && !c.messages.at(-1).pending; }, { what: 'the Chief to reply' });
  const turn = srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff')).at(-1);
  assert.equal(count(turn.system, CHAT_FORMAT), 1, 'the same text the bots get');
  assert.equal(count(turn.system, `- ${answerFirst('the user')}\n`), 1, 'under "How to work"');
  const work = turn.system.slice(turn.system.lastIndexOf('How to work:'));
  // The lines around it read as before.
  assert.match(work, /^How to work:\n- Talk like a capable, friendly chief of staff: plain language, short, no jargon, no tool names, commands or JSON in your replies\.\n- Start with the answer or the outcome, in one or two sentences\. Aim for under 150 words\. Go longer only when the user asked for a report or the details are the answer, and then give the reply sections\.\n- Don't narrate your process\. One exception: when the request needs your tools \(creating or changing a bot, running one, looking something up\), first write one short line saying what you are about to do, in the user's language, under ten words, with no tool names \("Setting up your news bot\."\)\. Then do the work\. Never more than this one line before your final reply\.\n/);
});
