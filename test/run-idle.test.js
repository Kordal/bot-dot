// A bot's run and a Chief's turn are ended when they have been silent too long (#187, ADR 043): no line at all from
// Claude Code for 20 minutes. A run that keeps working goes on, up to the ceiling of 4 hours (run-limit.test.js).
// These servers have the silence at under a second (BOT_DOT_RUN_IDLE_MS) and the ceiling far off.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, feed, sleep } = require('./helpers');

const IDLE = 'I stopped because nothing happened for 20 minutes: I seemed stuck. Send it again, or break it into smaller pieces.';
const IDLE_MS = 800;

let srv; let f;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_RUN_IDLE_MS: String(IDLE_MS), BOT_DOT_RUN_LIMIT_MS: String(60_000) } });
  f = feed(srv);
  await f.wait('hello');
});
after(async () => { f?.close(); await srv.stop(); });

// The stand-in Claude writes what is in events-<n>.json as it grows: one tool step more.
const step = (rec, events, i) => {
  events.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'true' } }] } });
  events.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: '' }] } });
  fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events));
};

test('a run that keeps working goes on past the silence, and is ended once it is silent that long', async () => {
  const bot = await makeBot(srv, { name: 'Busy One', emoji: '🐝' });
  const { run, rec } = await heldRun(srv, bot, 'Rebase it');
  const events = [];
  const started = Date.now();
  let last = started;
  for (let i = 0; Date.now() - started < IDLE_MS * 3; i++) { step(rec, events, i); last = Date.now(); await sleep(IDLE_MS / 4); }
  assert.equal((await srv.api(`/runs/${run.id}?events=0`)).data.status, 'running', 'working for three times the silence, and still going');
  const ended = await srv.finished(run.id);
  assert.deepEqual([ended.status, ended.endedBy, ended.problem, ended.error], ['error', 'idle', IDLE, IDLE]);
  assert.ok(Date.parse(ended.endedAt) - last >= IDLE_MS - 100, 'not before it was silent that long');
  const event = (await f.wait('run_finished', (d) => d.id === run.id)).data;
  assert.deepEqual([event.status, event.endedBy, event.problem], ['error', 'idle', IDLE]);
  srv.unhold();
});

test("a Chief's turn that is silent that long ends with the silence's sentence", async () => {
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Think quietly' } });
  await srv.nextRun((x) => !!x.botdot && x.stdin.includes('Think quietly'), 'the Chief turn');
  const reply = (await f.wait('chief_reply', (d) => d.chatId === chat.id)).data;
  assert.deepEqual([reply.status, reply.error], ['error', IDLE]);
  srv.unhold();
});
