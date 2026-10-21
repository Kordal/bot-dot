// The Chief of Staff's line (docs/api.md, "The working line", the Chief of Staff): the `activity` of the reply it
// is writing, `{ tool, text }`, in the chat's pending reply and on the chat's stream. `text` is the whole line as
// it reads now, in the botdot server's words (lib/working-line.js): its opening line first, kept while the step it
// announced runs, then the words of the steps that follow, as a bot's line. It changes at most once a second and
// the last change always goes out, as a bot's line does, and it is gone at once on the reply and on Stop.
// `opening_line` and `openingLine` are sent as before. Against a real botdot server and the stand-in for Claude,
// which plays recorded streams; a second is short here (BOT_DOT_LINE_EVERY_MS).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { words } = require('../lib/working-line');
const { startServer, makeBot, heldRun, waitFor, sleep } = require('./helpers');

const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const use = (name, input = {}, id = `t${Math.random()}`) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Done' }] } });

async function server(t, everyMs) {
  const srv = await startServer({ env: { BOT_DOT_LINE_EVERY_MS: String(everyMs) } });
  t.after(() => { srv.unhold(); return srv.stop(); });
  return srv;
}
const fast = (t) => server(t, 20);
const player = (srv, rec) => { const events = []; return (...evs) => { events.push(...evs); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); }; };
async function streamOf(srv, p, until, ms = 2000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  let got = '';
  try {
    const res = await fetch(`${srv.base}/api${p}`, { signal: abort.signal });
    for await (const chunk of res.body) { got += Buffer.from(chunk).toString(); if (until.test(got)) break; }
  } catch { /* timed out: what came is what there is */ } finally { clearTimeout(timer); abort.abort(); }
  return got;
}
// The stream of a Chief chat, as it comes: every event with the time it came at.
function follow(srv, chatId) {
  const events = [];
  const ac = new AbortController();
  (async () => {
    const res = await fetch(`${srv.base}/api/chief/chats/${chatId}/stream`, { signal: ac.signal });
    let buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf.slice(0, i).match(/^data: (.*)$/m)?.[1];
        buf = buf.slice(i + 2);
        if (data) events.push({ ...JSON.parse(data), cameAt: Date.now() });
      }
    }
  })().catch(() => {});
  const texts = () => events.filter((e) => e.type === 'activity').map((e) => e.text);
  return { events, texts, close: () => ac.abort(), reads: (text) => waitFor(() => texts().at(-1) === text, { what: `the line "${text}" (it read ${JSON.stringify(texts())})` }) };
}
// A Chief chat with a reply that is being written: the stand-in Claude plays what `play` hands it.
async function replying(srv, text = 'What is in the news?') {
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const rec = await srv.nextRun((r) => !!r.botdot, 'the Chief\'s turn');
  const read = async () => (await srv.api(`/chief/chats/${chat.id}`)).data;
  return { chat, rec, play: player(srv, rec), read, activity: async () => (await read()).messages.at(-1).activity };
}

test('the Chief\'s line reads its opening line first, kept while the step it announced runs, then the words of the steps that follow', async (t) => {
  const srv = await fast(t);
  const bot = await makeBot(srv, { name: 'Web Surfer' });
  const held = await heldRun(srv, bot);
  const { chat, play, read, activity } = await replying(srv);
  const live = follow(srv, chat.id);
  t.after(() => live.close());
  const reads = (text, tool) => waitFor(async () => { const a = await activity(); return a?.text === text && (!tool || a.tool === tool); }, { what: `"${text}"${tool ? ` for ${tool}` : ''}`, timeout: 2000 });

  play(say('Looking at **your bots**.'));
  await sleep(150);
  assert.equal(await activity(), undefined, 'text alone is not a line: it may be the reply');
  // The first tool call: the opening line is the line, and the step that came with it is what it announced.
  play(use('mcp__botdot__list_bots', {}, 'a'));
  await reads('Looking at your bots', 'list_bots');
  await sleep(150);
  assert.deepEqual(await activity(), { tool: 'list_bots', text: 'Looking at your bots' });
  // `opening_line` and `openingLine` are sent as before, for an app that reads them.
  assert.equal((await read()).openingLine, 'Looking at your bots');
  assert.equal((await srv.api('/chief')).data.chats.find((c) => c.id === chat.id).openingLine, 'Looking at your bots');
  assert.deepEqual(live.events.filter((e) => e.type === 'opening_line').map((e) => e.text), ['Looking at your bots']);
  // An app that connects now is given the line as it reads, and the opening line as before.
  const late = await streamOf(srv, `/chief/chats/${chat.id}/stream`, /opening_line/);
  assert.match(late, /data: \{"type":"activity","tool":"list_bots","text":"Looking at your bots"\}/);
  assert.match(late, /data: \{"type":"opening_line","text":"Looking at your bots"\}/);

  // That step is done and the Chief thinks: the line stays, as a bot's does.
  play(result('a'));
  await reads('Looking at your bots', 'thinking');
  // A step without words leaves the line as it was.
  play(use('TodoWrite', { todos: [] }, 'todo'));
  await reads('Looking at your bots', 'TodoWrite');
  play(result('todo'));
  await reads('Looking at your bots', 'thinking');
  // A step that follows: its words take the line's place, and from here the line is what the Chief is doing.
  play(use('WebFetch', { url: 'https://www.nytimes.com/section/world?token=SECRET' }, 'b'));
  await reads('Reading nytimes.com', 'WebFetch');
  play(result('b'));
  await reads('Thinking', 'thinking');
  play(use('mcp__botdot__wait_for_run', { runId: held.run.id }, 'c'));
  await reads('Waiting for Web Surfer', 'wait_for_run');
  assert.equal((await read()).openingLine, 'Looking at your bots', 'the opening line itself is as it was');
  await live.reads('Waiting for Web Surfer');
  // Who follows the stream drew: the opening line, then each step's words. Nothing else, and never a secret.
  assert.deepEqual(live.texts().filter((x, i, all) => x !== all[i - 1]), ['Looking at your bots', 'Reading nytimes.com', 'Thinking', 'Waiting for Web Surfer']);
  assert.doesNotMatch(JSON.stringify(live.events.map((e) => e.text)), /SECRET/);

  // Stop: the line is gone, and so is the opening line.
  await srv.api(`/chief/chats/${chat.id}/stop`, { method: 'POST' });
  await waitFor(async () => !(await read()).busy);
  assert.equal(await activity(), undefined);
  assert.equal((await read()).openingLine, undefined);
  srv.release(held.rec);
});

test('a Chief that wrote no opening line reads the words of its first step', async (t) => {
  const srv = await fast(t);
  const { chat, play, read, activity } = await replying(srv);
  play(use('WebSearch', { query: 'news' }, 'a'));
  await waitFor(async () => (await activity())?.text === 'Searching the web');
  assert.equal((await read()).openingLine, undefined);
  play(result('a'));
  await waitFor(async () => (await activity())?.text === 'Thinking');
  await srv.api(`/chief/chats/${chat.id}/stop`, { method: 'POST' });
  await waitFor(async () => !(await read()).busy);
});

test('the Chief\'s line changes at most once a second, the last change always goes out, and Stop clears it at once', async (t) => {
  const EVERY = 600; // a second, here
  const srv = await server(t, EVERY);
  const { chat, play, read, activity } = await replying(srv);
  const live = follow(srv, chat.id);
  t.after(() => live.close());
  // The first change goes out at once. Its second starts when it is sent, never before it is played: the time it
  // came here would be late on a busy machine and make the second look short.
  const played = Date.now();
  play(use('WebSearch', { query: 'news' }, 'a'));
  await live.reads('Searching the web');
  assert.deepEqual(await activity(), { tool: 'WebSearch', text: 'Searching the web' });
  // Four changes within the second: one goes out, when the second is over, with the last words.
  play(result('a'), use('Read', { file_path: '/tmp/plan.md' }, 'b'), result('b'), use('WebFetch', { url: 'https://www.nytimes.com/' }, 'c'));
  await sleep(200);
  assert.deepEqual(live.texts(), ['Searching the web'], 'held');
  assert.deepEqual(await activity(), { tool: 'WebSearch', text: 'Searching the web' }, 'the chat says what the stream said last');
  await live.reads('Reading nytimes.com');
  assert.deepEqual(live.texts(), ['Searching the web', 'Reading nytimes.com'], 'one change, with the last words');
  assert.ok(live.events.filter((e) => e.type === 'activity')[1].cameAt - played >= EVERY - 5, 'not before the second was over');
  assert.deepEqual(await activity(), { tool: 'WebFetch', text: 'Reading nytimes.com' });
  // A change that still waits for its second when Stop comes is never sent, and the line is gone at once.
  play(result('c'), use('Bash', { command: 'ls' }, 'd'));
  await sleep(150);
  await srv.api(`/chief/chats/${chat.id}/stop`, { method: 'POST' });
  await waitFor(async () => !(await read()).busy);
  assert.equal(await activity(), undefined);
  await sleep(EVERY + 200);
  assert.equal(await activity(), undefined, 'nothing writes it back');
  assert.deepEqual(live.texts(), ['Searching the web', 'Reading nytimes.com']);
  assert.equal(live.events.at(-1).type, 'done');
});

// ---------- the words ----------

test('the Chief\'s activity reads a bot\'s words for a tool a bot can also use, and its own for its own tools', async (t) => {
  const srv = await fast(t);
  const bot = await makeBot(srv, { name: 'Web Surfer' });
  const held = await heldRun(srv, bot);
  t.after(() => srv.release(held.rec));
  const { chat, play, activity } = await replying(srv);
  const reads = (text, tool) => waitFor(async () => { const a = await activity(); return a?.text === text && a.tool === tool; }, { what: `"${text}" for ${tool}`, timeout: 2000 });
  const steps = [
    ['WebFetch', { url: 'https://www.nytimes.com/section/world?token=SECRET' }, 'Reading nytimes.com'],
    ['WebSearch', { query: 'SECRET' }, 'Searching the web'],
    ['Read', { file_path: '/home/chief/notes/plan.md' }, 'Reading plan.md'],
    ['Bash', { command: 'SECRET' }, 'Running a command'],
    ['Bash', { command: 'SECRET', description: 'List the files' }, 'List the files'],
    ['Skill', { skill: 'botdot:meal-plan' }, 'Using the skill meal-plan'],
  ];
  let n = 0;
  for (const [name, input, line] of steps) {
    assert.equal(words({ tool: name, input }), line, 'what a bot\'s line reads for it');
    const id = `s${n++}`;
    play(use(name, input, id));
    await reads(line, name);
    play(result(id));
    await reads('Thinking', 'thinking');
  }
  // Its own tools: its own words, as before, also those the web page used to hold.
  for (const [name, input, line] of [['remember', { text: 'x' }, 'Saving a note'], ['run_bot', { bot: 'Web Surfer' }, 'Starting a bot'], ['list_bots', {}, 'Checking your bots'], ['wait_for_run', { runId: held.run.id }, 'Waiting for Web Surfer']]) {
    const id = `s${n++}`;
    play(use(`mcp__botdot__${name}`, input, id));
    await reads(line, name);
    // A reconnect of its stream says the same.
    if (name === 'wait_for_run') assert.match(await streamOf(srv, `/chief/chats/${chat.id}/stream`, /activity/), /"type":"activity","tool":"wait_for_run","text":"Waiting for Web Surfer"/);
    play(result(id));
    await reads('Thinking', 'thinking');
  }
  // A tool without words (Claude Code's own housekeeping) is no step: it thinks.
  play(use('TodoWrite', { todos: [] }, 'todo'));
  await reads('Thinking', 'TodoWrite');
  await srv.api(`/chief/chats/${chat.id}/stop`, { method: 'POST' });
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy);
  assert.equal(await activity(), undefined);
});
