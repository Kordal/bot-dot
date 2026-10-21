// The working line (lib/working-line.js; docs/api.md, "The working line"): the one line of a working bot, in the
// botdot server's words. It reads the opening line first, then the words of each step that follows, on the feed,
// on the running run and in the run's stream; it changes at most once a second and the last change always goes
// out; it is gone on the reply and on Stop; and its changes are not in the run's log. Streams are recorded ones,
// played by the stand-in Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { words, pacer, follow, MAX, OPENER_MAX, simpleStep, stepDone } = require('../lib/working-line');
const { startServer, makeBot, heldRun, feed, waitFor, sleep } = require('./helpers');

const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const use = (name, input = {}, id = `t${Math.random()}`) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const tool = (name, input) => words({ tool: name, input });

// ---------- the words ----------

test('a step in, one short plain line out', () => {
  assert.equal(tool('WebFetch', { url: 'https://www.nytimes.com/section/world' }), 'Reading nytimes.com');
  assert.equal(tool('WebSearch', { query: 'weather Brussels' }), 'Searching the web');
  assert.equal(tool('Read', { file_path: '/home/bot/work/notes/plan.md' }), 'Reading plan.md');
  assert.equal(tool('Write', { file_path: '/home/bot/report.txt' }), 'Writing report.txt');
  assert.equal(tool('Edit', { file_path: 'C:\\work\\report.txt' }), 'Changing report.txt');
  assert.equal(tool('Bash', { command: 'ls', description: 'List files' }), 'List files');
  assert.equal(tool('Bash', { command: 'ls' }), 'Running a command');
  assert.equal(tool('Bash', { command: 'ls', description: '  ' }), 'Running a command');
  assert.equal(tool('Grep', { pattern: 'x' }), 'Looking through its files');
  assert.equal(tool('Task', {}), 'Asking a helper');
  assert.equal(tool('Skill', { skill: 'botdot:meal-plan' }), 'Using the skill meal-plan');
  assert.equal(tool('mcp__computer__open_browser', { url: 'https://nytimes.com/' }), 'Opening nytimes.com');
  assert.equal(tool('mcp__computer__open_browser', {}), 'Opening the browser');
  assert.equal(tool('mcp__computer__screenshot', {}), 'Looking at its screen');
  assert.equal(tool('mcp__computer__click', { x: 1, y: 2 }), 'Clicking');
  assert.equal(tool('mcp__computer__press_keys', { keys: ['enter'] }), 'Pressing keys');
  assert.equal(tool('mcp__computer__scroll', { x: 1, y: 2, direction: 'down' }), 'Scrolling');
  assert.equal(tool('mcp__computer__read_file', { path: '/workspace/b1/notes.md' }), 'Reading a file on its computer');
  assert.equal(tool('mcp__computer__write_file', { path: '/workspace/b1/notes.md', content: 'x' }), 'Saving a file on its computer');
  assert.equal(tool('mcp__computer__move_mouse', { x: 1, y: 2 }), 'Using its computer');
  assert.equal(tool('mcp__computer__run_shell', { command: 'ls' }), 'Running a command on its computer');
  assert.equal(tool('mcp__computer__run_shell', { command: 'df -h', description: 'Check disk space' }), 'Check disk space');
  assert.equal(tool('mcp__computer__run_with_file', { file: 'k.pem', command: 'openssl x', description: 'Sign the token' }), 'Sign the token');
  assert.equal(tool('mcp__computer__run_with_file', { file: 'k.pem', command: 'openssl x' }), 'Running a command with a saved file');
  assert.equal(tool('mcp__computer__start_program', { command: 'python3 -m http.server', description: 'Start a web server' }), 'Start a web server');
  assert.equal(tool('mcp__computer__run_with_login', { login: 'Bridge', command: 'curl --user "$BOTDOT_USERNAME:$BOTDOT_PASSWORD" imap://127.0.0.1:1143/' }), 'Running a command with a saved login');
  assert.equal(tool('mcp__computer__run_with_ssh_key', { key: 'Tailnet servers', command: 'ssh admin@host uptime' }), 'Running a command with a saved SSH key');
  assert.equal(tool('mcp__computer__run_with_ssh_key', { key: 'Tailnet servers', command: 'ssh admin@host uptime', description: 'Check the server is up' }), 'Check the server is up');
  assert.equal(tool('mcp__computer__run_with_login', { login: 'Bridge', command: 'curl x', description: 'Read the inbox' }), 'Read the inbox');
  assert.equal(tool('mcp__vault__api_request', { url: 'https://api.github.com/user', login: 'GitHub' }), 'Calling api.github.com');
  assert.equal(tool('mcp__vault__request_login', { site: 'github.com' }), 'Asking you for a login');
  assert.equal(tool('mcp__connectors__connector_run', { app: 'gmail', action: 'GMAIL_SEND_EMAIL' }), 'Using gmail');
  assert.equal(tool('mcp__self__remember', { text: 'x' }), 'Saving a note');
  assert.equal(tool('mcp__self__send_to_chief', { text: 'x' }), 'Writing to the Chief of Staff');
  assert.equal(tool('mcp__self__propose_job_call', { jobId: 'j1', summary: 'x' }), 'Setting up a call'); // #37
  assert.equal(tool('mcp__self__something_new', {}), 'Looking after its notes and jobs');
  assert.equal(words({ phase: 'computer' }), 'Starting its computer');
  assert.equal(words({ phase: 'waiting' }), null, 'no start waits for a free computer: the account has one (#108)');
  assert.equal(words({ job: 'Disk check' }), 'Running Disk check');
});

test('a message to a teammate names it, by the name the caller knows', () => {
  const who = (to) => (to === 'surf' ? 'Web Surfer' : '');
  assert.equal(words({ tool: 'mcp__self__message_bot', input: { to: 'surf', message: 'SECRET' } }, { who }), 'Messaging Web Surfer');
  assert.equal(words({ tool: 'mcp__self__message_bot', input: { to: 'nobody' } }, { who }), 'Messaging a teammate');
  assert.equal(tool('mcp__self__message_bot', { to: 'surf' }), 'Messaging a teammate');
});

test('a step without words gives nothing', () => {
  for (const name of ['ToolSearch', 'TodoWrite', 'unrecognized_tool', 'mcp__elsewhere__thing', '', null, undefined, 5]) assert.equal(tool(name, { x: 'SECRET' }), null, String(name));
  for (const none of [null, undefined, 'x', 5, {}, { phase: 'other' }, { job: '   ' }, { job: 5 }]) assert.equal(words(none), null, JSON.stringify(none));
});

test('a secret, a whole command, a long address and a file\'s path are not in a line', () => {
  const steps = [
    ['WebFetch', { url: 'https://user:SECRET@www.example.com/a/very/long/path/that/goes/on?token=SECRET&q=SECRET#SECRET' }, 'Reading example.com'],
    ['mcp__computer__open_browser', { url: 'https://example.com/login?password=SECRET' }, 'Opening example.com'],
    ['mcp__vault__api_request', { url: 'https://api.example.com/v1?key=SECRET', login: 'SECRET', body: 'SECRET' }, 'Calling api.example.com'],
    ['Bash', { command: 'curl -H "Authorization: Bearer SECRET" https://example.com' }, 'Running a command'],
    ['Bash', { command: 'curl -H "Authorization: Bearer SECRET" https://example.com', description: 'Check the vault files' }, 'Check the vault files'],
    ['mcp__computer__run_shell', { command: 'export KEY=SECRET' }, 'Running a command on its computer'],
    ['mcp__computer__run_shell', { command: 'export KEY=SECRET', description: 'Read the repo' }, 'Read the repo'],
    ['mcp__computer__run_with_login', { login: 'SECRET', command: 'curl --user SECRET' }, 'Running a command with a saved login'],
    ['mcp__computer__start_program', { command: 'app --token SECRET' }, 'Starting a program on its computer'],
    ['mcp__computer__type_text', { text: 'SECRET' }, 'Typing'],
    ['mcp__computer__type_login', { field: 'password', login: 'SECRET' }, 'Signing in with a saved login'],
    ['mcp__computer__type_card', { field: 'number', card: 'SECRET', amount: 'SECRET' }, 'Paying with a saved card'],
    ['Read', { file_path: '/home/SECRET/private/notes.md' }, 'Reading notes.md'],
    ['WebSearch', { query: 'SECRET' }, 'Searching the web'],
    ['mcp__self__remember', { text: 'SECRET' }, 'Saving a note'],
    ['mcp__connectors__connector_run', { app: 'gmail', action: 'SEND', params: { body: 'SECRET' } }, 'Using gmail'],
  ];
  for (const [name, input, line] of steps) {
    assert.equal(tool(name, input), line, name);
    assert.doesNotMatch(tool(name, input), /SECRET|\/|https?:|\?/, name);
  }
  // An address that is none, and names that are no names, give the kind only.
  assert.equal(tool('WebFetch', { url: 'javascript:alert(1)' }), 'Reading a web page');
  assert.equal(tool('WebFetch', { url: 'not an address' }), 'Reading a web page');
  assert.equal(tool('mcp__connectors__connector_run', { app: '<img src=x>' }), 'Using a connected app');
  assert.equal(tool('Skill', { skill: '<b>x</b>' }), 'Using a skill');
});

test('a line is one line of plain text, at most 80 characters, with no ellipsis of its own', () => {
  const long = tool('Read', { file_path: `/x/${'a'.repeat(300)}.md` });
  assert.ok([...long].length <= MAX);
  assert.doesNotMatch(long, /…/);
  assert.equal(words({ job: 'Morning\n\ncheck\tof\u0000 disks' }), 'Running Morning check of disks');
  assert.ok([...words({ job: 'x'.repeat(500) })].length <= MAX);
  assert.ok([...tool('WebFetch', { url: `https://${'a'.repeat(60)}.${'b'.repeat(60)}.example.com/` })].length <= MAX);
  const told = tool('mcp__computer__run_shell', { command: 'x', description: `Check\nthe\u0000 disks ${'d'.repeat(200)}` });
  assert.equal([...told].length, MAX);
  assert.match(told, /^Check the disks d+$/);
  assert.equal(tool('Bash', { command: 'x', description: 'é'.repeat(100) }), 'é'.repeat(80));
});

test('the words of a step that is done are as they were (the index of past runs, the simple stream)', () => {
  const label = (to) => `🌐 ${to}`;
  assert.equal(stepDone('mcp__self__message_bot', { to: 'surf' }, label), 'messaged 🌐 surf');
  assert.equal(stepDone('mcp__self__send_to_chief', {}, label), 'sent the Chief a suggestion');
  assert.equal(stepDone('WebFetch', { url: 'https://example.com' }, label), 'read https://example.com');
  assert.equal(stepDone('mcp__computer__screenshot', {}, label), null);
  assert.equal(simpleStep('mcp__computer__screenshot', {}, label), 'used its computer');
  assert.equal(simpleStep('Grep', {}, label), 'looked through its files');
  assert.equal(simpleStep('unrecognized_tool', {}, label), 'worked on it');
  assert.equal(simpleStep('WebSearch', { query: 'game news' }, label), 'searched the web for "game news"');
});

// ---------- once a second, with a clock moved by hand ----------

function clock() {
  let t = 0;
  let timers = [];
  return {
    opts: { everyMs: 1000, now: () => t, later: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; }, cancel: (x) => { timers = timers.filter((y) => y !== x); } },
    pass(ms) { t += ms; for (const x of timers.filter((y) => y.at <= t)) { timers = timers.filter((y) => y !== x); x.fn(); } },
    waiting: () => timers.length,
  };
}

test('the first change goes out at once; changes within a second give one, and the last is the one kept', () => {
  const c = clock();
  const sent = [];
  const p = pacer((x) => sent.push(x), c.opts);
  p.say('Checking the news');
  assert.deepEqual(sent, ['Checking the news'], 'at once');
  c.pass(200); p.say('Reading nytimes.com');
  c.pass(200); p.say('Reading bbc.com');
  c.pass(200); p.say('Reading lemonde.fr');
  assert.deepEqual(sent, ['Checking the news'], 'held');
  assert.equal(p.sent(), 'Checking the news', 'what a client that comes now is given is what the others have');
  c.pass(399);
  assert.equal(sent.length, 1, 'not before the second is over');
  c.pass(1);
  assert.deepEqual(sent, ['Checking the news', 'Reading lemonde.fr']);
  assert.equal(p.sent(), 'Reading lemonde.fr');
  c.pass(5000); p.say('Writing report.txt');
  assert.deepEqual(sent, ['Checking the news', 'Reading lemonde.fr', 'Writing report.txt'], 'after a quiet second: at once again');
});

test('the same words are not sent twice, and nothing goes out after the end', () => {
  const c = clock();
  const sent = [];
  const p = pacer((x) => sent.push(x), c.opts);
  p.say('Reading a.com'); p.say('Reading a.com');
  c.pass(100); p.say('Reading b.com'); p.say('Reading a.com'); // back to what is on screen within the second
  c.pass(2000);
  assert.deepEqual(sent, ['Reading a.com']);
  for (const none of ['', null, undefined, 5]) p.say(none);
  c.pass(2000);
  assert.deepEqual(sent, ['Reading a.com']);
  p.say('Reading c.com'); c.pass(100); p.say('Reading d.com');
  p.end();
  assert.equal(c.waiting(), 0, 'no timer is left');
  c.pass(5000); p.say('Reading e.com');
  assert.deepEqual(sent, ['Reading a.com', 'Reading c.com']);
});

test('a run\'s line reads its phase, else its latest step, else its opening line, else its job', () => {
  const c = clock();
  const sent = [];
  const line = follow((x) => sent.push(x), { ...c.opts, who: () => 'Web Surfer' });
  const next = () => { c.pass(1000); return line.line(); };
  assert.equal(line.line(), null, 'a run that did nothing has no line: the apps say "Working"');
  line.job('Morning news'); assert.equal(next(), 'Running Morning news');
  line.opener('Checking the news'); assert.equal(next(), 'Checking the news');
  line.step('WebFetch', { url: 'https://nytimes.com/x' }); assert.equal(next(), 'Reading nytimes.com');
  line.step('TodoWrite', {}); assert.equal(next(), 'Reading nytimes.com', 'a step without words leaves the line as it was');
  line.step('mcp__computer__open_browser', { url: 'https://bbc.com' }); line.phase('computer'); // its computer tool asks for the computer
  assert.equal(line.line(), 'Opening bbc.com', 'the step went out at once: the line was a second old');
  assert.equal(next(), 'Starting its computer');
  line.phase(null); assert.equal(next(), 'Opening bbc.com', 'the computer is up: the step it was started for');
  line.step('mcp__self__message_bot', { to: 'surf' }); assert.equal(next(), 'Messaging Web Surfer');
  assert.deepEqual(sent, ['Running Morning news', 'Checking the news', 'Reading nytimes.com', 'Opening bbc.com', 'Starting its computer', 'Opening bbc.com', 'Messaging Web Surfer']);
});

test('a run that starts again reads its job, and what its first start said is neither sent nor kept', () => {
  // A change that still waited for its second when the run started again.
  let c = clock();
  let sent = [];
  let line = follow((x) => sent.push(x), c.opts);
  line.job('Disk check');
  c.pass(300); line.opener('Checking the disks');
  line.again();
  c.pass(5000);
  assert.deepEqual(sent, ['Running Disk check'], 'what the first start said is not sent afterwards');
  assert.equal(line.line(), 'Running Disk check');
  assert.equal(c.waiting(), 0);

  // What the first start said was sent already: the apps are told the line is the job's again, at the line's pace.
  c = clock(); sent = [];
  line = follow((x) => sent.push(x), c.opts);
  line.job('Disk check');
  c.pass(1000); line.opener('Checking the disks');
  c.pass(200); line.step('Bash', {}); line.phase('computer');
  line.again();
  assert.deepEqual(sent, ['Running Disk check', 'Checking the disks'], 'held for its second');
  c.pass(800);
  assert.deepEqual(sent, ['Running Disk check', 'Checking the disks', 'Running Disk check']);
  assert.equal(line.line(), 'Running Disk check');
  line.step('WebSearch', {}); c.pass(1000);
  assert.equal(line.line(), 'Searching the web', 'and the second start goes on from there');

  // A run that is no job's has no line again: a reload reads none, and nothing of the first start comes later.
  c = clock(); sent = [];
  line = follow((x) => sent.push(x), c.opts);
  line.opener('Checking the news');
  c.pass(100); line.step('WebFetch', { url: 'https://nytimes.com/' });
  line.again();
  c.pass(5000);
  assert.deepEqual(sent, ['Checking the news']);
  assert.equal(line.line(), null);
  line.opener('Checking the news'); c.pass(1000);
  assert.equal(line.line(), 'Checking the news', 'the second start says its own, the same words too');
  assert.deepEqual(sent, ['Checking the news', 'Checking the news']);
});

test('a step\'s words are at most 80 characters, and an opening line passes whole, up to 120', () => {
  const c = clock();
  const line = follow(() => {}, c.opts);
  line.opener('a'.repeat(200));
  assert.equal(line.line(), 'a'.repeat(OPENER_MAX));
  assert.equal(OPENER_MAX, 120);
  assert.equal(MAX, 80);
});

// ---------- on the botdot server ----------

let srv, f, slowDocker;
before(async () => {
  // A docker that takes its time and then fails: a bot's computer that is starting, for as long as a test looks.
  slowDocker = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-slow-docker-'));
  fs.writeFileSync(path.join(slowDocker, 'docker'), '#!/bin/sh\nsleep 3\nexit 1\n', { mode: 0o755 });
  // The real pace, a change at most once a second: these tests are of it (the helper's is 50 ms).
  srv = await startServer({ env: { PATH: `${slowDocker}${path.delimiter}${process.env.PATH}`, BOT_DOT_LINE_EVERY_MS: '1000' } });
  f = await feed(srv);
});
after(async () => { f.close(); await srv.stop(); fs.rmSync(slowDocker, { recursive: true, force: true }); });

const player = (rec) => { const events = []; return (...evs) => { events.push(...evs); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); }; };
const runOf = async (id) => (await srv.api(`/runs/${id}?events=0`)).data;
const lines = (runId) => f.events.filter((e) => e.type === 'working_line' && e.data.runId === runId).map((e) => e.data.text);
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
const logOf = async (runId) => (await srv.api(`/runs/${runId}`)).data.events; // the run's log, as the API reads it

test('the features name it, and the opening line as before', async () => {
  const { features } = (await srv.api('/version')).data;
  assert.ok(features.includes('working-line'));
  assert.ok(features.includes('opening-line'));
});

test('the line reads the opening line first, then the server\'s words for each following step: on the feed, on the running run and in its stream', async () => {
  const surfer = await makeBot(srv, { name: 'Web Surfer', emoji: '🌐' });
  const bot = await makeBot(srv, { name: 'News' });
  srv.reply('Here is the news.');
  const { run, rec } = await heldRun(srv, bot, 'What is in the news?');
  const play = player(rec);
  await sleep(200);
  assert.deepEqual(lines(run.id), [], 'a run that did nothing yet has no line');
  assert.equal((await runOf(run.id)).workingLine, undefined);

  play(say('Checking the news.'));
  await sleep(200);
  assert.deepEqual(lines(run.id), [], 'text alone is not a line: it may be the reply');
  play(use('WebSearch', { query: 'news today' }));
  await lineIs(run.id, 'Checking the news');
  const first = f.events.find((e) => e.type === 'working_line' && e.data.runId === run.id);
  assert.deepEqual({ ...first.data, at: undefined }, { chat: `bot:${bot.id}`, botId: bot.id, runId: run.id, text: 'Checking the news', at: undefined });
  // `opening_line` is sent as before, for an app that does not know the working line.
  assert.deepEqual(f.events.filter((e) => e.type === 'opening_line' && e.data.runId === run.id).map((e) => ({ ...e.data, at: undefined })), [{ chat: `bot:${bot.id}`, botId: bot.id, runId: run.id, text: 'Checking the news', at: undefined }]);
  await sleep(1200);
  assert.deepEqual(lines(run.id), ['Checking the news'], 'the step that came with the opening line is what it announced');

  play(use('WebFetch', { url: 'https://www.nytimes.com/section/world?token=SECRET' }));
  await lineIs(run.id, 'Reading nytimes.com');
  // A reload: the running run has it, wherever a run is read, beside its opening line.
  for (const got of [await runOf(run.id), (await srv.api(`/runs/${run.id}`)).data, (await srv.api(`/runs?botId=${bot.id}`)).data[0]]) {
    assert.equal(got.workingLine, 'Reading nytimes.com');
    assert.equal(got.openingLine, 'Checking the news');
  }
  assert.match(await streamOf('/events', /event: hello\ndata: .*\n\n/), new RegExp(`"id":"${run.id}"[^}]*"workingLine":"Reading nytimes.com"`));
  // A reconnect of the run's stream: what the line reads now, after what already happened, in both forms.
  for (const q of ['', '?simple']) {
    const got = await streamOf(`/runs/${run.id}/stream${q}`, /working_line/);
    assert.match(got, /data: \{"type":"working_line","text":"Reading nytimes.com"\}/, `stream${q}`);
    assert.ok(got.indexOf('"type":"opening_line","text":"Checking the news"') < got.indexOf('"type":"working_line"'), `stream${q}: the opening line as before, then the line`);
  }

  // Who follows the stream gets each change as it is sent.
  const live = streamOf(`/runs/${run.id}/stream`, /Messaging Web Surfer/, 4000);
  await sleep(1100);
  play(use('mcp__self__message_bot', { to: surfer.id, message: 'SECRET' }));
  await lineIs(run.id, 'Messaging Web Surfer');
  assert.match(await live, /data: \{"type":"working_line","text":"Messaging Web Surfer"\}/);
  await sleep(1100);
  play(use('TodoWrite', { todos: [] }));
  await sleep(300);
  assert.equal((await runOf(run.id)).workingLine, 'Messaging Web Surfer', 'a step without words leaves the line as it was');
  assert.deepEqual(lines(run.id), ['Checking the news', 'Reading nytimes.com', 'Messaging Web Surfer']);
  for (const e of f.events) assert.doesNotMatch(JSON.stringify(e.data), /SECRET/, e.type);

  // The reply: the line is gone, from the run and from its stream, and it was never a reply or part of the chat.
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.unread, 0);
  srv.release(rec);
  const done = await srv.finished(run.id);
  assert.equal(done.result, 'Here is the news.');
  assert.equal(done.workingLine, undefined);
  assert.equal((await srv.api(`/runs?botId=${bot.id}`)).data[0].workingLine, undefined);
  assert.doesNotMatch(await streamOf(`/runs/${run.id}/stream`, /run_end/), /working_line/, 'a finished run\'s stream has no line');
  assert.doesNotMatch(JSON.stringify(done), /Reading nytimes\.com|Messaging Web Surfer/);
  srv.unhold();
});

test('the run\'s log holds no more events than before: the line\'s changes are not written to it', async () => {
  const bot = await makeBot(srv, { name: 'Logger' });
  const { run, rec } = await heldRun(srv, bot);
  const play = player(rec);
  const played = [say('Looking it up.'), use('WebSearch', { query: 'x' }), use('WebFetch', { url: 'https://example.com/a' }), use('Read', { file_path: '/tmp/notes.md' })];
  play(...played);
  await lineIs(run.id, 'Reading notes.md');
  srv.release(rec);
  await srv.finished(run.id);
  const log = await logOf(run.id);
  assert.equal(log.some((e) => e.type === 'working_line' || e.type === 'opening_line'), false);
  // What Claude Code wrote (its start, the events played, its result) and the run's own start and end: nothing else.
  assert.deepEqual(log.map((e) => e.type), ['run_start', 'system', ...played.map((e) => e.type), 'result', 'run_end']);
  for (const file of fs.readdirSync(path.join(srv.data, 'runs')).filter((x) => x.startsWith(run.id))) assert.doesNotMatch(fs.readFileSync(path.join(srv.data, 'runs', file), 'utf8'), /workingLine|working_line|Reading notes\.md/, `${file}: nor is it in what is stored of the run`);
  srv.unhold();
});

test('two steps within a second give one change, and the last step\'s words are the ones kept', async () => {
  const bot = await makeBot(srv, { name: 'Quick' });
  const { run, rec } = await heldRun(srv, bot);
  const play = player(rec);
  play(use('WebSearch', { query: 'x' }));
  await lineIs(run.id, 'Searching the web');
  const at = Date.now();
  play(use('WebFetch', { url: 'https://a.example.com/' }), use('WebFetch', { url: 'https://b.example.com/' }), use('Read', { file_path: '/tmp/last.md' }));
  await lineIs(run.id, 'Reading last.md');
  assert.ok(Date.now() - at >= 700, 'not before the second was over');
  assert.deepEqual(lines(run.id), ['Searching the web', 'Reading last.md'], 'one change, with the last words');
  assert.equal((await runOf(run.id)).workingLine, 'Reading last.md');
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

test('a run that uses no tools has no line, and Stop takes a line away', async () => {
  const bot = await makeBot(srv, { name: 'Plain' });
  const a = await heldRun(srv, bot, 'Say hello');
  player(a.rec)(say('Hello!'));
  await sleep(300);
  assert.equal((await runOf(a.run.id)).workingLine, undefined, 'the apps keep "Working"');
  srv.release(a.rec);
  await srv.finished(a.run.id);
  assert.deepEqual(lines(a.run.id), []);

  const b = await heldRun(srv, bot, 'Look it up');
  const play = player(b.rec);
  play(use('WebSearch', { query: 'x' }));
  await lineIs(b.run.id, 'Searching the web');
  play(use('WebFetch', { url: 'https://late.example.com/' })); // held for its second when Stop comes
  await sleep(150);
  assert.equal((await srv.api(`/runs/${b.run.id}/stop`, { method: 'POST' })).data.ok, true);
  const stopped = await srv.finished(b.run.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.workingLine, undefined);
  await sleep(1200);
  assert.deepEqual(lines(b.run.id), ['Searching the web'], 'no change is sent after the run ended');
  srv.unhold();
});

test('"Starting its computer" is the line while the bot\'s computer starts', async () => {
  const bot = await makeBot(srv, { name: 'Clicker', computer: 'linux' });
  const { run, rec, token } = await heldRun(srv, bot, 'Open the news');
  const play = player(rec);
  play(use('mcp__computer__open_browser', { url: 'https://www.nytimes.com/' }));
  await lineIs(run.id, 'Opening nytimes.com');
  // Its computer tool asks for the computer, as lib/computer-mcp does: the stand-in docker takes its time.
  const asked = srv.api('/vault/session/computer', { method: 'POST', headers: { 'X-Vault-Token': token } });
  await lineIs(run.id, 'Starting its computer');
  assert.equal((await runOf(run.id)).workingLine, 'Starting its computer');
  assert.match(await streamOf(`/runs/${run.id}/stream?simple`, /working_line/), /data: \{"type":"working_line","text":"Starting its computer"\}/, 'in the simple form too, which has no `phase`');
  assert.equal((await asked).data.ok, false, 'the stand-in computer never starts');
  await lineIs(run.id, 'Opening nytimes.com'); // the start is over: the step it was for
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

test('a job\'s run says which job, until the bot says more', async () => {
  const bot = await makeBot(srv, { name: 'Disks' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Disk check', kind: 'ai', cron: '0 3 * * *', prompt: 'Check the disks.' } })).data;
  srv.hold();
  const started = (await srv.api(`/bots/${bot.id}/jobs/${job.job?.id || job.id}/run`, { method: 'POST' })).data;
  assert.equal(started.started, 'ai');
  const rec = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), 'the job\'s run');
  const run = started.run;
  await lineIs(run.id, 'Running Disk check');
  assert.equal((await runOf(run.id)).workingLine, 'Running Disk check');
  await sleep(1100);
  const play = player(rec);
  play(use('Bash', { command: 'df -h' }));
  await lineIs(run.id, 'Running a command');
  await sleep(1100);
  play(use('Bash', { command: 'df -h /secret', description: 'Check disk space' }));
  await lineIs(run.id, 'Check disk space');
  assert.equal((await runOf(run.id)).workingLine, 'Check disk space');
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

test('a script job\'s run has no line: nothing is at work for the apps while its script runs, and its run is there when it ended', async () => {
  const bot = await makeBot(srv, { name: 'Scripted' });
  const made = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Disk check', kind: 'script', cron: '0 3 * * *', script: 'sleep 1.5; echo "disk 91% full"', aiWhen: 'never' } })).data;
  const from = f.events.length;
  const started = (await srv.api(`/bots/${bot.id}/jobs/${made.job?.id || made.id}/run`, { method: 'POST' })).data;
  assert.deepEqual(started, { started: 'script' }, 'no run is handed out: none exists yet');
  await sleep(500);
  // While the script runs: no run of it, running or not, and the bot is not at work. The apps draw no line.
  assert.deepEqual((await srv.api(`/runs?botId=${bot.id}`)).data, []);
  const now = (await srv.api(`/bots/${bot.id}`)).data;
  assert.equal(now.running, false);
  assert.notEqual(now.state, 'working');
  assert.doesNotMatch(await streamOf('/events', /event: hello\ndata: .*\n\n/), new RegExp(bot.id), 'nothing of it among what is going on');
  // When it ended with something to show, its run is there, finished: said once, on the feed.
  const { data: done } = await f.wait('run_finished', (d) => d.botId === bot.id);
  assert.deepEqual([done.kind, done.jobName, done.status, done.result], ['script', 'Disk check', 'success', 'disk 91% full']);
  const mine = f.events.slice(from).filter((e) => e.data.botId === bot.id && /^(run_|working_line|opening_line)/.test(e.type)).map((e) => e.type);
  assert.deepEqual(mine, ['run_finished'], 'no start, and no line');
  const [run] = (await srv.api(`/runs?botId=${bot.id}`)).data;
  assert.equal(run.status, 'success');
  assert.equal(run.workingLine, undefined);
});
