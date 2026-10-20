// A failed reply looks failed (QW-002, docs/api.md "A failed reply"): a Chief message has `error` whenever its
// turn ended in an error or was stopped, whatever text it has, and the feed's `chief_reply` says so in `status`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, feed, waitFor } = require('./helpers');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let srv; let f; let bot;
before(async () => { srv = await startServer(); bot = await makeBot(srv, { name: 'Web Surfer' }); f = feed(srv); await f.wait('hello'); });
after(async () => { f?.close(); await srv.stop(); });

const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
// The Chief starts a run of the bot: a tool call botdot shows as a chip (an action).
const started = (id) => [
  { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'mcp__botdot__run_bot', input: { id: bot.id } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify({ id: `run-${id}`, bot: bot.name }) }] } },
];
// How Claude Code ends a turn: with the reply, or with an error.
const result = (text, isError = false) => ({ type: 'result', subtype: isError ? 'error_during_execution' : 'success', is_error: isError, result: text, total_cost_usd: 0.01 });
const noResult = (on) => (on ? fs.writeFileSync(path.join(srv.out, 'no-result'), '') : fs.rmSync(path.join(srv.out, 'no-result'), { force: true }));
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const replyOf = (id) => waitFor(async () => { const c = await chatOf(id); const last = c.messages.at(-1); return !c.busy && last.role === 'chief' && !last.pending ? last : null; }, { what: "the Chief's reply" });

// One Chief turn that the stand-in Claude plays from `events`, ending as they say (no result line of its own).
// stopAfter: the owner stops it once the chat shows that many chips. Returns { message, event }.
async function turn(asked, events, { stopAfter = 0 } = {}) {
  srv.hold();
  noResult(true);
  try {
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: asked } });
    const rec = await srv.nextRun((r) => !!r.botdot && r.stdin.includes(asked), 'the Chief turn');
    fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events));
    if (stopAfter) {
      await waitFor(async () => (await chatOf(chat.id)).messages.at(-1).actions?.length >= stopAfter, { what: 'its chips' });
      await sleep(200); // what came with the last chip has been read too
      await srv.api(`/chief/chats/${chat.id}/stop`, { method: 'POST' });
    } else srv.release(rec);
    const message = await replyOf(chat.id);
    const event = await f.wait('chief_reply', (d) => d.chatId === chat.id);
    return { message, event: event.data };
  } finally { noResult(false); srv.unhold(); }
}

test('a turn that fails after it wrote keeps the text, and is marked failed', async () => {
  const { message, event } = await turn('Set up my mail bots', [say('Mail Sorter is set up. I was starting on Mail Writer.'), result('Claude is signed out: run /login', true)]);
  assert.equal(message.text, 'Mail Sorter is set up. I was starting on Mail Writer.');
  assert.match(message.error, /Claude isn't signed in yet/, 'said plainly, as before');
  assert.deepEqual([event.status, event.text, event.error], ['error', message.text, message.error]);
});

test("the text of an error result is never the reply, also when it was the turn's last text", async () => {
  const boom = 'API Error: 500 the model gave up';
  const alone = await turn('Do the first thing', [result(boom, true)]);
  assert.equal(alone.message.text, '');
  assert.match(alone.message.error, /Something went wrong and I couldn't finish\. It said: “API Error: 500 the model gave up”/);
  assert.equal(alone.event.status, 'error');
  // Claude Code may write the error as its last text too: still not a reply.
  const twice = await turn('Do the second thing', [say('I looked at your bots.'), say(boom), result(boom, true)]);
  assert.equal(twice.message.text, 'I looked at your bots.');
  assert.match(twice.message.error, /API Error: 500/);
  const only = await turn('Do the third thing', [say(boom), result(boom, true)]);
  assert.equal(only.message.text, '');
  assert.equal(only.event.status, 'error');
});

test('a turn the owner stopped says so, also when it has text', async () => {
  const { message, event } = await turn('Run the surfer twice', [...started('s1'), say('The first run is going. Starting the second.'), ...started('s2')], { stopAfter: 2 });
  assert.equal(message.text, 'The first run is going. Starting the second.');
  assert.equal(message.error, 'You stopped this reply.');
  assert.deepEqual([event.status, event.text, event.error], ['stopped', message.text, 'You stopped this reply.']);
  // Without text, as before.
  const empty = await turn('Run the surfer once', started('s3'), { stopAfter: 1 });
  assert.deepEqual([empty.message.text, empty.message.error, empty.event.status], ['', 'You stopped this reply.', 'stopped']);
});

test('a stop that comes after the whole reply stops nothing: the reply succeeded', async () => {
  const { message, event } = await turn('Start it and say so', [...started('l1'), result('Web Surfer is on it.')], { stopAfter: 1 });
  assert.equal(message.text, 'Web Surfer is on it.');
  assert.ok(!('error' in message), JSON.stringify(message));
  assert.equal(event.status, 'success');
});

test('a turn that ended well with no text is an error: its own silence after actions, an unreadable reply without', async () => {
  const acted = await turn('Start the surfer', [...started('e1'), result('')]);
  assert.equal(acted.message.text, '');
  assert.equal(acted.message.actions.length, 1);
  assert.equal(acted.message.error, 'I wrote no reply. Ask me what came of it.');
  assert.deepEqual([acted.event.status, acted.event.error], ['error', 'I wrote no reply. Ask me what came of it.']);

  const nothing = await turn('Say something', [result('')]);
  assert.equal(nothing.message.text, '');
  assert.match(nothing.message.error, /^Claude Code \(2\.1\.280\) finished without a reply botdot could read\./);
  assert.equal(nothing.event.status, 'error');
});

test('a turn that succeeded has no error, with or without actions', async () => {
  const plain = await turn('How are my bots?', [result('All three are idle.')]);
  assert.equal(plain.message.text, 'All three are idle.');
  assert.ok(!('error' in plain.message), JSON.stringify(plain.message));
  assert.deepEqual([plain.event.status, plain.event.text, plain.event.error], ['success', 'All three are idle.', null]);

  const acted = await turn('Start the surfer and tell me', [...started('g1'), say('Web Surfer is on it.'), result('Web Surfer is on it.')]);
  assert.ok(!('error' in acted.message));
  assert.equal(acted.event.status, 'success');
  // Nothing else of a message changed.
  // (`relevant`: what the lookup found for the message, when it found something. `phases`: its times, #204.)
  assert.deepEqual(Object.keys(acted.message).filter((k) => k !== 'relevant').sort(), ['actions', 'at', 'costUsd', 'endedAt', 'pending', 'phases', 'role', 'startedBy', 'text']);
  // A reply that is only buttons is a reply.
  const buttons = await turn('Which one?', [result('[[choices: Mail | News]]')]);
  assert.ok(!('error' in buttons.message), JSON.stringify(buttons.message));
});
