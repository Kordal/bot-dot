// One set of words for groups and the Chief of Staff (ALV-004; docs/api.md, "The working line"). A turn in a
// group has a working line as a bot's own run has: on the feed as `group_working_line`, as `workingLine` in the
// group's `working`, on the turn's run and in its stream, at most one change a second and never in the run's
// log; `group_opening_line` and `openingLine` are sent as before. The Chief's `activity` reads the words of the
// same module (lib/working-line.js): a bot's words for a tool a bot can also use, the Chief's own for its tools
// (the words here; the Chief's line on the server is in test/chief-line.test.js).
// Against a real botdot server and the stand-in for Claude, which plays recorded streams.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { words } = require('../lib/working-line');
const { TOOLS } = require('../lib/mcp-server');
const { startServer, makeBot, heldRun, feed, waitFor, sleep } = require('./helpers');
const { shortName } = require('../public/mentions.js');

const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const use = (name, input = {}, id = `t${Math.random()}`) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Done' }] } });

// ---------- the words ----------

test('the Chief\'s own tools have words of their own, every one of them, and a run it waits for is named', () => {
  const chief = (name, input = {}, opts) => words({ tool: `mcp__botdot__${name}`, input }, opts);
  assert.equal(chief('remember', { text: 'SECRET' }), 'Saving a note');
  assert.equal(chief('list_notes'), 'Reading notes');
  assert.equal(chief('create_group'), 'Making a group');
  assert.equal(chief('run_bot', { prompt: 'SECRET' }), 'Starting a bot');
  assert.equal(chief('list_bots'), 'Checking your bots');
  const whose = (runId) => (runId === 'r1' ? 'Web Surfer' : '');
  assert.equal(chief('wait_for_run', { runId: 'r1' }, { whose }), 'Waiting for Web Surfer');
  assert.equal(chief('wait_for_run', { runId: 'r2' }, { whose }), 'Waiting for the bot to finish');
  assert.equal(chief('wait_for_run', { runId: 5 }), 'Waiting for the bot to finish');
  for (const t of TOOLS) {
    const line = chief(t.name, { text: 'SECRET', prompt: 'SECRET', name: 'SECRET' });
    assert.ok(line && /^[A-Z][a-z]+/.test(line), `${t.name} has words: ${line}`);
    assert.doesNotMatch(line, /SECRET/, t.name);
  }
  assert.equal(chief('something_new'), null, 'a tool nobody knows has no words');
});

// ---------- a turn in a group ----------

let srv, f;
// The real pace of the line, once a second (the helper's is 50 ms): the lines here follow it.
before(async () => { srv = await startServer({ env: { BOT_DOT_LINE_EVERY_MS: '1000' } }); f = await feed(srv); });
after(async () => {
  for (const x of fs.readdirSync(srv.out)) if (x === 'hold' || x.startsWith('hold-')) fs.rmSync(path.join(srv.out, x), { force: true });
  f.close();
  await srv.stop();
});

const holdFile = (bot) => path.join(srv.out, `hold-${shortName(bot.name)}`);
const hold = (bot) => fs.writeFileSync(holdFile(bot), '');
const letGo = (bot) => fs.rmSync(holdFile(bot), { force: true });
const ranOf = (bot) => srv.runs().filter((x) => x.who === shortName(bot.name));
const player = (rec) => { const events = []; return (...evs) => { events.push(...evs); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); }; };
const chatOf = async (group) => (await srv.api(`/group-chats/${group.id}/chat`)).data;
const atWork = (group, bot) => waitFor(async () => { const c = await chatOf(group); return c.working.length === 1 && c.working[0].botId === bot.id ? c.working[0] : null; }, { what: `${bot.name} to be at work` });
const of = (type, runId) => f.events.filter((e) => e.type === type && e.data.runId === runId);
const lines = (runId) => of('group_working_line', runId).map((e) => e.data.text);
const lineIs = (runId, text) => waitFor(() => lines(runId).at(-1) === text, { what: `the line "${text}" (it reads ${JSON.stringify(lines(runId))})` });
async function streamOf(p, until, ms = 2000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  let got = '';
  try {
    const res = await fetch(`${srv.base}/api${p}`, { signal: abort.signal });
    for await (const chunk of res.body) { got += Buffer.from(chunk).toString(); if (until.test(got)) break; }
  } catch { /* timed out: what came is what there is */ } finally { clearTimeout(timer); abort.abort(); }
  return got;
}

test('in a group each member\'s line follows its turn\'s work, one member after another, in the server\'s words', async (t) => {
  const coder = await makeBot(srv, { name: 'Coder', emoji: '🤖', prompt: 'Write the code.' });
  const reviewer = await makeBot(srv, { name: 'Reviewer', emoji: '🤖', prompt: 'Review the code.' });
  t.after(() => { letGo(coder); letGo(reviewer); });
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Dev', members: [coder.id, reviewer.id] } })).data;
  hold(coder);
  hold(reviewer);
  const sent = (await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: 'Ship it, both of you.' } })).data;

  // Coder's turn: no line until it does something.
  const first = await atWork(group, coder);
  await waitFor(() => ranOf(coder).length === 1, { what: "Coder's turn to be going" });
  const play = player(ranOf(coder)[0]);
  await sleep(200);
  assert.deepEqual(lines(first.runId), []);
  assert.equal(first.workingLine, undefined, 'a turn that did nothing yet has no line');

  // Its opening line is the line's first text; `group_opening_line` and `openingLine` are sent as before.
  play(say('Reading the diff.'), use('Read', { file_path: '/home/bot/a.js' }));
  await lineIs(first.runId, 'Reading the diff');
  const data = { chat: `group:${group.id}`, groupId: group.id, botId: coder.id, runId: first.runId, text: 'Reading the diff', at: undefined };
  assert.deepEqual(of('group_working_line', first.runId).map((e) => ({ ...e.data, at: undefined })), [data]);
  assert.deepEqual(of('group_opening_line', first.runId).map((e) => ({ ...e.data, at: undefined })), [data], 'as before, for an app that does not know a turn\'s working line');
  const order = f.events.filter((e) => e.data.runId === first.runId).map((e) => e.type);
  assert.ok(order.indexOf('group_opening_line') < order.indexOf('group_working_line'), 'the opening line first');

  // Then the server's words for each step that follows: on the feed, in the group's `working`, on the run and in its stream.
  await sleep(1100);
  play(use('WebFetch', { url: 'https://www.nytimes.com/section/world?token=SECRET' }));
  await lineIs(first.runId, 'Reading nytimes.com');
  assert.deepEqual((await chatOf(group)).working, [{ botId: coder.id, runId: first.runId, messageId: sent.id, startedAt: first.startedAt, openingLine: 'Reading the diff', workingLine: 'Reading nytimes.com' }]);
  const run = (await srv.api(`/runs/${first.runId}?events=0`)).data;
  assert.deepEqual([run.workingLine, run.openingLine], ['Reading nytimes.com', 'Reading the diff']);
  assert.match(await streamOf(`/runs/${first.runId}/stream`, /working_line/), /data: \{"type":"working_line","text":"Reading nytimes.com"\}/);

  // At most one change a second, and the last one always: two steps at once give one change.
  await sleep(1100);
  play(use('Bash', { command: 'npm test' }));
  await lineIs(first.runId, 'Running a command');
  play(use('WebSearch', { query: 'SECRET' }), use('mcp__self__message_bot', { to: reviewer.id, message: 'SECRET' }));
  await sleep(400);
  assert.equal(lines(first.runId).at(-1), 'Running a command', 'what follows within the second waits for it');
  await lineIs(first.runId, 'Messaging Reviewer');
  assert.deepEqual(lines(first.runId), ['Reading the diff', 'Reading nytimes.com', 'Running a command', 'Messaging Reviewer']);

  // Nothing of it is a line of the bot's own chat, and nothing new is in the run's log.
  assert.deepEqual(f.events.filter((e) => ['working_line', 'opening_line'].includes(e.type) && e.data.runId === first.runId), []);
  const log = (await srv.api(`/runs/${first.runId}`)).data.events;
  assert.deepEqual(log.filter((e) => /line/.test(e.type)), []);
  for (const e of f.events) assert.doesNotMatch(JSON.stringify(e.data), /SECRET/, e.type);

  // Coder answers: its line is gone with its turn, and Reviewer's line follows Reviewer's work.
  fs.writeFileSync(path.join(srv.out, 'result-Coder.txt'), 'Done here.');
  letGo(coder);
  const second = await atWork(group, reviewer);
  assert.notEqual(second.runId, first.runId);
  const ended = f.events.findIndex((e) => e.type === 'group_run_finished' && e.data.id === first.runId);
  assert.ok(ended >= 0);
  await waitFor(() => ranOf(reviewer).length === 1, { what: "Reviewer's turn to be going" });
  const playSecond = player(ranOf(reviewer)[0]);
  playSecond(use('Grep', { pattern: 'TODO' }));
  await lineIs(second.runId, 'Looking through its files');
  assert.deepEqual((await chatOf(group)).working.map((w) => [w.botId, w.workingLine, w.openingLine]), [[reviewer.id, 'Looking through its files', undefined]]);
  assert.equal(f.events.slice(ended).filter((e) => e.type === 'group_working_line' && e.data.runId === first.runId).length, 0, 'no line of a turn after its end');

  // Stop all: the line is gone, and none comes after.
  await sleep(1100);
  playSecond(use('Bash', { command: 'ls' }));
  await lineIs(second.runId, 'Running a command');
  playSecond(use('WebSearch', { query: 'x' })); // held back for its second: never sent after the end
  assert.equal((await srv.api(`/group-chats/${group.id}/stop`, { method: 'POST' })).status, 200);
  await waitFor(async () => !(await chatOf(group)).working.length, { what: 'the group to be still' });
  await sleep(1200);
  assert.equal(lines(second.runId).at(-1), 'Running a command');
  assert.equal((await srv.api(`/runs/${second.runId}?events=0`)).data.workingLine, undefined);
});
