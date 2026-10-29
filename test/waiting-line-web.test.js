// A run that waits for the owner, and a run that carries on, on the web page (OK-004): public/opening-line.js
// loaded the way the browser loads it, and the page's own code for the status line and for a bot's chat, cut
// out of public/app.js and run against stand-ins. A running run with `waitingFor: "ok"` ("The contract" of
// OK-003) shows "Waiting for your OK" in place of its opening line, with a still dot, no dots after the words
// and Stop; the opening line returns when the field goes. A run with `continues` (docs/api.md, "What follows a
// yes") draws no message of the owner: the chat shows the request once, the first reply, then the line and the
// new reply. The real page is walked in test/browser/carries-on.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, noDrafts, words } = require('./web-page');

const css = read('style.css');
const MAIL = { id: 'mail', name: 'Mail Writer', color: '#9b59d0' };
const lib = vm.createContext({ ...words });
vm.runInContext(read('unread.js'), lib);
vm.runInContext(read('opening-line.js'), lib);
const { OpeningLine } = lib;

test('web: a run that waits says "Waiting for your OK" in place of its opening line, and Stop stays', () => {
  assert.equal(OpeningLine.status('Writing to Anna', '#9b59d0', 'r1', true),
    '<div class="status-line held" role="status" style="--c:#9b59d0"><i></i><span>Waiting for your OK</span><button type="button" data-stop-run="r1">Stop</button></div>');
  assert.equal(OpeningLine.status('', '#9b59d0', 'r1', true), OpeningLine.status('Writing to Anna', '#9b59d0', 'r1', true), 'also before it said a line');
  assert.equal(OpeningLine.WAITING, 'Waiting for your OK');
  // Not waiting: the line as it was, to the letter.
  for (const not of [false, undefined, null, 'ok', 1, {}]) {
    assert.equal(OpeningLine.status('Writing to Anna', '#9b59d0', 'r1', not),
      '<div class="status-line" role="status" style="--c:#9b59d0"><i></i><span>Writing to Anna</span><button type="button" data-stop-run="r1">Stop</button></div>', String(not));
  }
  assert.equal(OpeningLine.status('', '#9b59d0', 'r1'), '<div class="status-line" role="status" style="--c:#9b59d0"><i></i><span>Working</span><button type="button" data-stop-run="r1">Stop</button></div>');
  // Only a run waits: without one (the Chief's line) nothing is held.
  assert.equal(OpeningLine.status('Thinking', '#d85a30', undefined, true), '<div class="status-line" role="status" style="--c:#d85a30"><i></i><span>Thinking</span></div>');
  assert.equal(OpeningLine.status('', '#d85a30', undefined, true), '');
});

test('web: the dot stands still and no dots follow the words', () => {
  assert.match(css, /\.status-line\.held i \{ animation: none; opacity: \.5; \}/);
  assert.match(css, /\.status-line\.held span::after \{ content: ''; \}/);
  // Both after the rules they change, and the working line keeps its own.
  const pulse = css.indexOf('.status-line i {'), dots = css.indexOf(".status-line span::after { content: '…'; }");
  assert.ok(pulse > 0 && css.indexOf('.status-line.held i {') > pulse);
  assert.ok(dots > 0 && css.indexOf('.status-line.held span::after') > dots);
  assert.match(css, /\.status-line i \{[^}]*animation: status-pulse 1\.2s ease-in-out infinite;/);
  // The line is as wide as any status line, at phone and desktop width, and Stop keeps its look.
  assert.match(css, /\.status-line \{ display: flex; align-items: center; gap: var\(--sp-8\);[^}]*font-size: var\(--fs-12\); \}/);
  assert.match(css, /\.status-line span \{ min-width: 0; overflow-wrap: anywhere; \}/);
  assert.match(css, /\.status-line button \{[^}]*color: var\(--faint\);/);
});

// The page's placeStatusLines over a bot's chat that stands in for the one on screen, and the step line of a running
// run's block (bot-chat.js, #625): a working bot's line is in its block, and the chat has no line under it.
function chat(runs) {
  const state = { runs, features: ['opening-line', 'working-line'] };
  const openingLines = OpeningLine.keeper();
  const thread = { dataset: {}, scrollHeight: 0, scrollTop: 0, clientHeight: 0, line: null,
    insertAdjacentHTML(where, html) { this.line = { html, nextElementSibling: null, remove: () => { this.line = null; } }; },
    get lastElementChild() { return this.line; } };
  const ctx = vm.createContext({ ...words, ...noDrafts,
    OpeningLine, Unread: lib.Unread, openingLines, state, CHIEF_COLOR: '#d85a30', botById: (id) => (id === MAIL.id ? MAIL : null),
    stopRun() {}, updateChatQueued() {}, chiefTurns: new Map(), esc, sentTo: () => [], said: (v) => (typeof v === 'string' ? v.trim() : ''), plain: String, Date,
    $: (sel, root) => (sel === '#view-bot' ? { dataset: { bot: MAIL.id } } : sel === '#bot-thread' ? thread : sel === '.status-line' ? root.line : null),
  });
  vm.runInContext(`${cut('function placeStatusLines() {', '// Stop a run.')}\n${cut('const STEP_ICON = {', '// The running blocks\' lines')}\nObject.assign(this, { placeStatusLines, stepLineHTML });`, ctx);
  // What the step line of its block says, or null with no run at work in this chat.
  const line = () => {
    ctx.placeStatusLines();
    assert.equal(thread.line, null, 'no line under the chat of a working bot');
    const r = state.runs.find((x) => x.botId === MAIL.id && x.status === 'running' && x.kind !== 'script');
    return r ? ctx.stepLineHTML(r).match(/<span class="step-now">(.*?)<\/span>/)[1] : null;
  };
  return { state, openingLines, thread, line };
}

test('web: the line of a run with `waitingFor: "ok"` reads "Waiting for your OK", and returns to the opening line when the field goes', () => {
  const run = { id: 'r1', botId: 'mail', status: 'running', trigger: 'manual', prompt: 'Tell Anna I\'ll be late.', startedAt: '2026-10-05T11:40:00.000Z' };
  const c = chat([run]);
  c.openingLines.say('bot:mail', 'Writing to Anna', 'r1');
  assert.equal(c.line(), 'Writing to Anna');
  // Its connected-app action waits for the owner: the runs read with the next refresh say so.
  c.state.runs = [{ ...run, waitingFor: 'ok' }];
  assert.equal(c.line(), 'Waiting for your OK');
  // The owner answered, or the wait ended: the field is gone, and the run's own line is back.
  c.state.runs = [run];
  assert.equal(c.line(), 'Writing to Anna');
  // The run ended: no line.
  c.openingLines.end('bot:mail', 'r1');
  c.state.runs = [{ ...run, status: 'success' }];
  assert.equal(c.line(), null);
  // The block keeps Stop in its footer, and its look while it waits (drawBlockLines).
  assert.match(cut('function drawBlockLines(thread) {', '// On a phone a long reply folds'), /block\.classList\.toggle\('held', r\.waitingFor === 'ok'\);/);
  assert.match(css, /\.run-block\.held \.plan-spin \{ animation: none;/);
});

test('web: a run that said no line waits and works with the page\'s own words', () => {
  const run = { id: 'r2', botId: 'mail', status: 'running' };
  const c = chat([{ ...run, waitingFor: 'ok' }]);
  assert.equal(c.line(), 'Waiting for your OK');
  c.state.runs = [run];
  assert.equal(c.line(), 'Working');
});

test('web: only "ok" on the chat\'s own running run holds the line', () => {
  const run = { id: 'r1', botId: 'mail', status: 'running' };
  for (const waitingFor of [undefined, null, '', 'OK', 'login', true, 1, {}, ['ok']]) {
    const c = chat([{ ...run, waitingFor }]);
    assert.equal(c.line(), 'Working', JSON.stringify(waitingFor));
  }
  // Another bot's waiting run, a run that ended, and a script's run are not this chat's working run.
  const others = chat([{ id: 'r9', botId: 'coder', status: 'running', waitingFor: 'ok' }, { id: 'r8', botId: 'mail', status: 'success', waitingFor: 'ok' }, { id: 'r7', botId: 'mail', status: 'running', kind: 'script', waitingFor: 'ok' }]);
  assert.equal(others.line(), null);
  // The page reads the field with the runs, on every refresh. The feed's `run_waits` (docs/api.md, "An action in a
  // connected app") brings one when a run begins to wait and when it stops, and so does an ask that comes or goes.
  assert.match(app, /const \[bots, runs, activity, chief, computers, cfg\] = await Promise\.all\(\[api\('\/bots'\), api\('\/runs\?limit=200'\)/);
  assert.match(app, /\['run_started', 'run_finished', 'run_waits', 'bot_message', 'waiting', 'chief_reply', 'chief_suggestion', 'approvals', 'asks', 'bots', 'reset'\]\.forEach\(\(t\) => es\.addEventListener\(t, soon\)\);/);
  assert.match(cut('function renderBotChat(root', '// Rejects when the task did not go'), /placeStatusLines\(\);\n\}/, 'a bot\'s chat places its line each time it is drawn');
});

// The page's botThreadHTML over a bot's runs, oldest first, with stand-ins for what a bubble holds.
function threadHTML(runs, newFirst = null) {
  const ctx = vm.createContext({ ...words, ...noDrafts,
    esc, Unread: lib.Unread, OpeningLine, said: (v) => (typeof v === 'string' ? v.trim() : ''), state: { keepOpen: null, features: [] }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '<script-run>', msgTime: () => '11:40', dur: () => '2 s',
    notesFoldHTML: (notes) => (notes?.length ? '<notes>' : ''), filesHTML: (f) => (f?.length ? '<files>' : ''), botFilesHTML: () => '', copyBtn: () => '',
    plain: (t) => String(t || ''), escMentions: (t) => esc(t), md: (t) => esc(t), friendlyProblem: () => 'It could not finish.', learnedChips: () => '', choicesHTML: () => '', questionsHTML: () => '',
  });
  vm.runInContext(`${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// The notes other bots left for a bot')}\nthis.botThreadHTML = botThreadHTML;`, ctx);
  return ctx.botThreadHTML(MAIL, runs, newFirst);
}
const mine = (html) => [...html.matchAll(/<div class="bubble from-me" data-expand><div class="clamp">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
const replies = (html) => [...html.matchAll(/<div class="bubble from-bot (?:problem)?"><div class="md">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
const chips = (html) => [...html.matchAll(/<span class="chip">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
const REQUEST = 'Check why the backup failed last night.';
const STOPPED = { id: 'r1', botId: 'mail', status: 'success', trigger: 'manual', prompt: REQUEST, customPrompt: true, result: 'I can\'t look yet: I may not run commands.', startedAt: '2026-10-05T11:40:00.000Z', endedAt: '2026-10-05T11:40:20.000Z' };
// As the botdot server stores the run that carries on: the request again, `customPrompt: false`, `continues`.
const CARRIES = { id: 'r2', botId: 'mail', status: 'running', trigger: 'manual', prompt: REQUEST, customPrompt: false, continues: 'r1', startedAt: '2026-10-05T11:42:00.000Z' };

test('web: a run that carries on draws no message of the owner: the request once, the first reply, then the new reply', () => {
  const working = threadHTML([STOPPED, CARRIES]);
  assert.deepEqual(mine(working), [REQUEST], 'the request shows once');
  assert.deepEqual(replies(working), ['I can&#39;t look yet: I may not run commands.'], 'the first reply');
  assert.deepEqual(chips(working), [], 'and no "Ran its main assignment" in place of the request');
  assert.match(working, /<div class="steps-row"><details class="run-steps now" data-steps="r2">[\s\S]*data-stop-run="r2"[\s\S]*<div class="bubble-row from-bot" data-live="r2"><\/div>[\s\S]*<\/section>$/, 'while it works: its step line with Stop at its end, then its row of files, in its block');
  assert.equal((working.match(/class="bubble-row from-me"/g) || []).length, 1);

  const done = threadHTML([STOPPED, { ...CARRIES, status: 'success', result: 'The disk was full at 02:10.', endedAt: '2026-10-05T11:43:00.000Z' }]);
  assert.deepEqual(mine(done), [REQUEST]);
  assert.deepEqual(replies(done), ['I can&#39;t look yet: I may not run commands.', 'The disk was full at 02:10.'], 'then the new reply');
  assert.deepEqual(chips(done), []);
  const at = [done.indexOf(REQUEST), done.indexOf('I can&#39;t look yet'), done.indexOf('The disk was full')];
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  // A run that failed to carry on says so as any failed run does.
  assert.deepEqual(replies(threadHTML([STOPPED, { ...CARRIES, status: 'error', problem: 'Claude is signed out.' }])), ['I can&#39;t look yet: I may not run commands.', 'Claude is signed out.']);
});

test('web: its reply is new like any reply: the "New" line stands right above it', () => {
  const html = threadHTML([STOPPED, { ...CARRIES, status: 'success', result: 'The disk was full at 02:10.' }], 'r2');
  assert.equal((html.match(/class="new-line"/g) || []).length, 1);
  const between = html.slice(html.indexOf('class="new-line"'), html.indexOf('The disk was full'));
  assert.doesNotMatch(between, /from-me|chip/, 'nothing of the owner\'s between the line and the reply');
  assert.ok(html.indexOf('I can&#39;t look yet') < html.indexOf('class="new-line"'));
});

test('web: a run of the main assignment that carries on shows its start once, too', () => {
  const tapped = { ...STOPPED, prompt: 'Sort the mail.', customPrompt: false };
  const html = threadHTML([tapped, { ...CARRIES, prompt: 'Sort the mail.', status: 'success', result: 'Sorted.' }]);
  assert.deepEqual(chips(html), ['▶ Ran its main assignment'], 'the owner\'s tap, once');
  assert.deepEqual(mine(html), []);
  assert.equal(replies(html).length, 2);
});

test('web: a job\'s run and a teammate\'s request that carry on are drawn as theirs', () => {
  const job = threadHTML([{ ...STOPPED, trigger: 'schedule', jobId: 'j1', jobName: 'Morning news', customPrompt: true }, { ...CARRIES, trigger: 'schedule', jobId: 'j1', jobName: 'Morning news', customPrompt: true, status: 'success', result: 'Three stories.' }]);
  assert.deepEqual(chips(job), ['⏰ Morning news · 11:40', '⏰ Morning news · 11:40'], 'the job ran once more: as any run of that job');
  assert.deepEqual(mine(job), []);
  const mate = { trigger: 'bot', fromBot: { id: 'coder', name: 'Coder' } };
  const asked = threadHTML([{ ...STOPPED, ...mate }, { ...CARRIES, ...mate, status: 'success', result: 'Done.' }]);
  assert.equal((asked.match(/<span class="fold-who">Message from Coder<\/span>/g) || []).length, 2, 'folded, as the run that stopped');
  assert.deepEqual(mine(asked), [], 'never as the owner\'s own message');
  // Its reply to the teammate is folded too, behind one line with its first words (#413).
  assert.match(asked, /<details class="notes-fold theirs" ><summary class="fold-line"><span class="fold-who">Replied<\/span><span class="fold-peek">Done\.<\/span><\/summary>[\s\S]*?<div class="bubble from-bot "><div class="md">Done\.<\/div>[\s\S]*?<\/details>/);
  // The notes it read at its start still show above its reply.
  assert.match(threadHTML([STOPPED, { ...CARRIES, inbox: [{ from: 'Coder', text: 'A note.' }] }]), /<notes><div class="steps-row"><details class="run-steps now" data-steps="r2">[\s\S]*?<div class="bubble-row from-bot" data-live="r2">/);
});

test('web: runs without `continues` are drawn as before', () => {
  // What a botdot server without `ask-continues` sends: the owner's message, their tap, a scheduled run.
  const html = threadHTML([STOPPED, { ...STOPPED, id: 'r3', prompt: 'And how big is the folder?' }, { ...STOPPED, id: 'r4', prompt: 'Sort the mail.', customPrompt: false }, { ...STOPPED, id: 'r5', trigger: 'schedule' }]);
  assert.deepEqual(mine(html), [REQUEST, 'And how big is the folder?']);
  assert.deepEqual(chips(html), ['▶ Ran its main assignment', '⏰ Scheduled run · 11:40']);
  assert.equal(replies(html).length, 4);
  for (const none of [undefined, null, '', 0, false]) assert.deepEqual(mine(threadHTML([{ ...STOPPED, continues: none }])), [REQUEST], `continues: ${JSON.stringify(none)}`);
  // The mark of such a run is `continues`, as docs/api.md says; `customPrompt: false` alone is the owner's tap.
  assert.match(app, /: r\.continues \? '' \/\/ it carries on after your OK/);
});
