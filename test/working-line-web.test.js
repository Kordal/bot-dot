// The working line on the web page (docs/api.md, "The working line"): public/opening-line.js loaded the way the
// browser loads it, and the page's own code cut out of public/app.js and run against stand-ins. With
// `working-line` in the server's `features` the line under a bot's chat and in its row is the server's text, and
// follows it as it changes: from the feed, from the run's stream and from the runs as they are read. Against a
// server without the feature the page shows the opening line as before. The page has no words of its own for a
// running run's step.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, noDrafts, esc } = require('./web-page');

const lib = vm.createContext({});
vm.runInContext(read('unread.js'), lib);
vm.runInContext(read('opening-line.js'), lib);
const { OpeningLine } = lib;

const NEWS = { id: 'news', name: 'News', color: '#378add' };
const WITH = ['opening-line', 'working-line'];
const WITHOUT = ['opening-line'];
const RUN = { id: 'r1', botId: 'news', status: 'running', trigger: 'manual', prompt: 'What is in the news?', startedAt: '2026-10-09T08:00:00.000Z' };

test('web: a run\'s line is its working line from a server that has one, its opening line from one that does not', () => {
  const run = { ...RUN, openingLine: 'Checking the news', workingLine: 'Reading nytimes.com' };
  assert.equal(OpeningLine.ofRun(run, WITH), 'Reading nytimes.com');
  assert.equal(OpeningLine.ofRun(run, WITHOUT), 'Checking the news', 'a field the page was not told about is not drawn');
  assert.equal(OpeningLine.ofRun({ ...RUN, openingLine: 'Checking the news' }, WITH), 'Checking the news', 'a turn in a group has no working line yet');
  assert.equal(OpeningLine.ofRun(RUN, WITH), '', 'a run that did nothing yet: "Working"');
  for (const none of [undefined, null, [], 'working-line', {}]) assert.equal(OpeningLine.ofRun(run, none), 'Checking the news', JSON.stringify(none));
  for (const junk of [5, {}, ['x'], '   ', null]) assert.equal(OpeningLine.ofRun({ ...RUN, workingLine: junk }, WITH), '', JSON.stringify(junk));
  for (const none of [null, undefined]) assert.equal(OpeningLine.ofRun(none, WITH), '');
});

test('web: which event brings a run\'s line: `working_line` with the feature, `opening_line` without', () => {
  assert.equal(OpeningLine.says('working_line', WITH), true);
  assert.equal(OpeningLine.says('opening_line', WITH), false, 'the working line starts with it: read twice, the line would change twice in a second');
  assert.equal(OpeningLine.says('opening_line', WITHOUT), true);
  assert.equal(OpeningLine.says('working_line', WITHOUT), false);
  for (const other of ['run_end', 'assistant', 'phase', undefined]) for (const f of [WITH, WITHOUT]) assert.equal(OpeningLine.says(other, f), false);
});

// The page with a bot's chat open: its feed's listeners, the run's stream, the status line and the row's words,
// all the page's own code, over one keeper of lines.
function page(features, runs = [RUN]) {
  const state = { features, runs, bots: [NEWS], botStreams: [] };
  const openingLines = OpeningLine.keeper();
  const drawn = { contacts: 0, refreshed: 0 };
  const thread = { dataset: {}, scrollHeight: 0, scrollTop: 0, clientHeight: 0, line: null,
    insertAdjacentHTML(where, html) { this.line = { html, nextElementSibling: null, remove: () => { this.line = null; } }; },
    get lastElementChild() { return this.line; } };
  const heard = {};
  const es = { addEventListener: (type, fn) => { heard[type] = fn; } };
  const streams = [];
  class EventSource { constructor(url) { this.url = url; this.closed = false; streams.push(this); } close() { this.closed = true; } }
  const ctx = vm.createContext({ ...noDrafts,
    JSON, OpeningLine, Unread: lib.Unread, openingLines, state, es, EventSource, esc,
    sentTo: () => [], said: (v) => (typeof v === 'string' ? v.trim() : ''), plain: (t) => String(t || ''), Date, CHIEF_COLOR: '#d85a30', chiefTurns: new Map(),
    botById: (id) => state.bots.find((b) => b.id === id) || null, stopRun() {}, updateChatQueued() {},
    renderContacts: () => { drawn.contacts++; }, refresh: () => { drawn.refreshed++; },
    $: (sel, root) => (sel === '#view-bot' ? { dataset: { bot: NEWS.id } } : sel === '#bot-thread' ? thread : sel === '.status-line' ? root.line : sel === '[data-stop-run]' ? { dataset: {} } : null),
  });
  vm.runInContext(`${cut('function placeStatusLines() {', '// Stop a run.')}
    ${cut('function followBotRun(run) {', '// ---------- live screen preview')}
    ${cut('  // A working bot said its opening line:', '  // Its run ended, with an answer or without')}
    ${cut('  // Its run ended, with an answer or without', '  // A tile\'s new value')}
    ${cut('const STEP_ICON = {', '// The running blocks\' lines')}
    Object.assign(this, { placeStatusLines, followBotRun, runLine, stepLineHTML });`, ctx);
  // The step line of the running run's block, as it is drawn.
  const block = () => ctx.stepLineHTML(state.runs.find((x) => x.status === 'running'));
  // What the step line of the running run's block says (bot-chat.js, #625): a working bot has no line under its chat.
  const line = () => {
    ctx.placeStatusLines();
    assert.equal(thread.line, null, 'no line under the chat of a working bot');
    const r = state.runs.find((x) => x.status === 'running');
    return r ? ctx.runLine(r) : null;
  };
  // The bot's row while it works, as drawContacts words it.
  const row = () => OpeningLine.preview(openingLines.of(`bot:${NEWS.id}`)) || 'Working…';
  const feed = (type, data) => heard[type]({ data: JSON.stringify(data) });
  return { ctx, state, openingLines, thread, heard, feed, streams, drawn, line, row, block };
}
const lineEvent = (text, more = {}) => ({ chat: 'bot:news', botId: 'news', runId: 'r1', text, ...more });

test('web: the line under a bot\'s chat and in its row is the server\'s text, and follows it as the feed says', () => {
  const p = page(WITH);
  assert.equal(p.line(), 'Working', 'before the server said anything');
  assert.equal(p.row(), 'Working…');
  p.feed('working_line', lineEvent('Checking the news'));
  assert.equal(p.line(), 'Checking the news', 'the opening line first: the server sends it as the line\'s first text');
  assert.equal(p.row(), 'Checking the news…');
  p.feed('working_line', lineEvent('Reading nytimes.com'));
  assert.equal(p.line(), 'Reading nytimes.com');
  assert.equal(p.row(), 'Reading nytimes.com…');
  p.feed('working_line', lineEvent('Starting its computer'));
  assert.match(p.block(), /<span class="step-now">Starting its computer<\/span>/, 'one line in its block, whose footer has Stop');
  assert.equal(p.drawn.contacts, 3, 'the list is drawn again with each change');
  const draws = p.drawn.contacts;
  p.feed('working_line', lineEvent('Starting its computer'));
  assert.equal(p.drawn.contacts, draws, 'the same words again: nothing is drawn');
  // The server's `opening_line`, sent as before for an older app, changes nothing here.
  p.feed('opening_line', lineEvent('Checking the news'));
  assert.equal(p.line(), 'Starting its computer');
  // The reply, or Stop: the run's end takes the line away.
  p.feed('run_finished', { id: 'r1', botId: 'news', status: 'success' });
  p.state.runs = [{ ...RUN, status: 'success' }];
  assert.equal(p.line(), null);
  assert.equal(p.openingLines.of('bot:news'), '');
  p.feed('working_line', lineEvent('Reading late.example.com'));
  assert.equal(p.openingLines.of('bot:news'), '', 'a line that comes after its run ended is not drawn');
});

test('web: the server\'s text is drawn as text, and what is no line is not drawn', () => {
  const p = page(WITH);
  p.feed('working_line', lineEvent('Reading <img src=x onerror=alert(1)>'));
  assert.doesNotMatch(p.block(), /<img/);
  assert.match(p.block(), /Reading &lt;img src=x onerror=alert\(1\)&gt;/);
  for (const junk of [5, null, {}, ['x'], '   ']) p.feed('working_line', lineEvent(junk));
  assert.equal(p.openingLines.of('bot:news'), 'Reading <img src=x onerror=alert(1)>', 'the line stays as it was');
  p.heard.working_line({ data: 'not json' });
});

test('web: against a server without the feature the page shows the opening line as today', () => {
  const p = page(WITHOUT);
  assert.equal(p.line(), 'Working');
  p.feed('opening_line', lineEvent('Checking the news'));
  assert.equal(p.line(), 'Checking the news');
  assert.equal(p.row(), 'Checking the news…');
  // Its run's stream says the same, and its steps are not put in words.
  p.ctx.followBotRun(RUN);
  const [stream] = p.streams;
  assert.equal(stream.url, '/api/runs/r1/stream');
  const say = (ev) => stream.onmessage({ data: JSON.stringify(ev) });
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://nytimes.com' } }] } });
  say({ type: 'phase', text: 'Starting its computer' });
  assert.equal(p.line(), 'Checking the news', 'the line stands still, as before the working line');
  say({ type: 'opening_line', text: 'Checking the news' });
  assert.equal(p.line(), 'Checking the news');
  say({ type: 'run_end' });
  assert.equal(stream.closed, true);
  assert.equal(p.drawn.refreshed, 1);
});

test('web: the open chat follows the run\'s stream: each `working_line` is drawn, and no step is put in the page\'s words', () => {
  const p = page(WITH);
  p.ctx.followBotRun(RUN);
  const [stream] = p.streams;
  const say = (ev) => stream.onmessage({ data: JSON.stringify(ev) });
  // A reconnect: what happened is replayed, then the opening line as before, then what the line reads now.
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://nytimes.com' } }] } });
  say({ type: 'opening_line', text: 'Checking the news' });
  assert.equal(p.line(), 'Working', '`opening_line` is not read from a server with the working line');
  say({ type: 'working_line', text: 'Reading nytimes.com' });
  assert.equal(p.line(), 'Reading nytimes.com');
  assert.equal(p.row(), 'Reading nytimes.com…');
  say({ type: 'phase', text: 'Starting its computer' });
  assert.equal(p.line(), 'Reading nytimes.com', 'the page waits for the server\'s line');
  say({ type: 'working_line', text: 'Starting its computer' });
  assert.equal(p.line(), 'Starting its computer');
  say({ type: 'run_end' });
  assert.equal(p.drawn.refreshed, 1, 'the refresh draws the reply');
});

test('web: after a reload the line is the one on the running run, and a run that ended has none', () => {
  // refresh() hands the runs it read to the keeper: by OpeningLine.ofRun, as the page's own line says.
  assert.match(app, /openingLines\.sync\(\[\s*\.\.\.runs\.filter\(\(r\) => r\.status === 'running'\)\.map\(\(r\) => \(\{ chat: `bot:\$\{r\.botId\}`, runId: r\.id, text: OpeningLine\.ofRun\(r, state\.features\) \}\)\),/);
  const sync = (p, runs) => { p.state.runs = runs; p.openingLines.sync(runs.filter((r) => r.status === 'running').map((r) => ({ chat: `bot:${r.botId}`, runId: r.id, text: OpeningLine.ofRun(r, p.state.features) }))); };
  const p = page(WITH);
  sync(p, [{ ...RUN, openingLine: 'Checking the news', workingLine: 'Reading nytimes.com' }]);
  assert.equal(p.line(), 'Reading nytimes.com');
  assert.equal(p.row(), 'Reading nytimes.com…');
  sync(p, [{ ...RUN, status: 'success', result: 'Here is the news.' }]);
  assert.equal(p.line(), null);
  assert.equal(p.row(), 'Working…', 'no line is left for the next run');
});

test('web: a job\'s run reads as the server says', () => {
  const job = { ...RUN, id: 'r2', trigger: 'schedule', jobId: 'j1', jobName: 'Disk check', customPrompt: false };
  const p = page(WITH, [job]);
  p.feed('working_line', lineEvent('Running Disk check', { runId: 'r2' }));
  assert.equal(p.line(), 'Running Disk check');
  assert.equal(p.row(), 'Running Disk check…');
  p.feed('working_line', lineEvent('Running a command', { runId: 'r2' }));
  assert.equal(p.line(), 'Running a command');
  // The page has no words of its own for a job's run: without a line from the server it says "Working".
  const old = page(WITHOUT, [job]);
  assert.equal(old.line(), 'Working');
  assert.doesNotMatch(read('opening-line.js'), /Running /);
});

test('web: "Waiting for your OK" keeps its words and its place over the working line', () => {
  const p = page(WITH, [{ ...RUN, waitingFor: 'ok' }]);
  p.feed('working_line', lineEvent('Using gmail'));
  assert.equal(p.line(), OpeningLine.WAITING);
  assert.match(p.block(), /<span class="step-now">Waiting for your OK<\/span>/, 'in its block, whose footer keeps Stop');
  p.state.runs = [RUN];
  assert.equal(p.line(), 'Using gmail');
});

test('web: the page listens for the line on the feed, and a running run\'s steps are still thrown away', () => {
  assert.match(app, /es\.addEventListener\('working_line', \(e\) => \{[\s\S]{0,500}openingLines\.say\(d\.chat, d\.text, d\.runId \?\? null\)\) \{ renderContacts\(\); placeStatusLines\(\); \} else if \(held\) placeStatusLines\(\);/);
  assert.match(app, /const es = watchRun\(run\.id, /);
});

// ---------- no words of the page's own (ALV-004) ----------

test('web: the page holds no words of its own for a running run\'s step or for the Chief\'s tools', () => {
  assert.doesNotMatch(app, /stepText|activityFor|ACTIVITY|WAITING_TOOLS|stepsHTML|watchRunSteps/);
  for (const words of ['Writing the answer', 'Getting started', 'Checking something', 'Reading files', 'Starting a bot', 'Checking your bots', 'Working on it', 'Messaging a teammate', 'Looking at its screen'])
    assert.ok(!app.includes(words), `"${words}" is the server's to say`);
  // A finished run's steps, on the run's page, are drawn as before: each tool by its name, with what it was given.
  assert.match(app, /<span class="tname">\$\{esc\(c\.name\)\}<\/span><span class="targ">\$\{esc\(toolArg\(c\.input\)\)\}<\/span>/);
});

// The page's watchRun over a run's stream: what it hands on of each event.
function watching(features) {
  const streams = [];
  class EventSource { constructor(url) { this.url = url; this.closed = false; streams.push(this); } close() { this.closed = true; } }
  const got = { lines: [], files: [], ended: 0 };
  const ctx = vm.createContext({ ...noDrafts, JSON, OpeningLine, EventSource, state: { features } });
  vm.runInContext(`${cut('function watchRun(runId, onEnd, onFile, onLine, onDraft, onPlan) {', '// ---------- live screen preview')}\nthis.watchRun = watchRun;`, ctx);
  ctx.watchRun('r1', () => got.ended++, (file) => got.files.push(file), (text) => got.lines.push(text));
  const emit = (ev) => streams[0].onmessage({ data: JSON.stringify(ev) });
  return { got, streams, emit };
}

test('web: a run that is followed hands on the server\'s line and nothing of its steps', () => {
  const w = watching(WITH);
  assert.equal(w.streams[0].url, '/api/runs/r1/stream');
  w.emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking the news.' }, { type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://nytimes.com/x?token=SECRET' } }] } });
  w.emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } });
  w.emit({ type: 'phase', text: 'Starting its computer' });
  assert.deepEqual(w.got.lines, [], 'a step is not put in words by the page');
  w.emit({ type: 'opening_line', text: 'Checking the news' });
  w.emit({ type: 'working_line', text: 'Checking the news' });
  w.emit({ type: 'working_line', text: 'Reading nytimes.com' });
  assert.deepEqual(w.got.lines, ['Checking the news', 'Reading nytimes.com']);
  w.emit({ type: 'file', file: { name: 'a.txt' } });
  assert.equal(w.got.files.length, 1);
  w.emit({ type: 'run_end' });
  assert.deepEqual([w.got.ended, w.streams[0].closed], [1, true]);
  // Against a server without the working line: the opening line, as before.
  const old = watching(WITHOUT);
  old.emit({ type: 'working_line', text: 'NOT READ' });
  old.emit({ type: 'opening_line', text: 'Checking the news' });
  assert.deepEqual(old.got.lines, ['Checking the news']);
});

test('web: the run\'s page and the computer\'s window draw a running run\'s line as the server says it', () => {
  const run = cut('function showRun(id) {', '// ---------- chief of staff ----------');
  assert.match(run, /<span class="activity muted">Working…<\/span>/, 'until the run has a line');
  assert.match(run, /if \(OpeningLine\.says\(ev\.type, state\.features\)\) \{ line = OpeningLine\.text\(ev\.text\); setActivity\(line \|\| 'Working'\); \}/);
  assert.match(run, /if \(ev\.type === 'phase'\) \{\s*setActivity\(OpeningLine\.text\(ev\.text\) \|\| line \|\| 'Working'\);/, 'the server\'s words while its computer starts, then its line again');
  assert.doesNotMatch(run, /tool_use/);
  const screen = cut('function openScreen(botId) {', '// Plain-language explanation for a failed or stopped run');
  assert.match(screen, /const stepsEs = run && watchRun\(run\.id, /);
  assert.match(screen, /What it's doing: <span id="screen-now"><\/span>/);
  assert.doesNotMatch(screen, /class="steps"/, 'one line, no list of steps');
});
