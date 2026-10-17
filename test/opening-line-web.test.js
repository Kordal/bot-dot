// A working bot's opening line on the web page: public/opening-line.js loaded the way the browser loads
// it (a plain script, no module): the status line's markup, the preview in the list, and which lines
// the page keeps and drops; then the page's own code, read for where it draws and removes the line.
// The look and the timing are checked by hand, in a browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const page = vm.createContext({});
vm.runInContext(read('unread.js'), page);
vm.runInContext(read('opening-line.js'), page);
const { OpeningLine, Unread } = page;
const app = read('app.js');
const css = read('style.css');

test('web: the page gets it as window.OpeningLine, before app.js', () => {
  assert.equal(typeof OpeningLine.status, 'function');
  assert.equal(page.module, undefined);
  const html = read('index.html');
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/opening-line.js') > 0 && at('/opening-line.js') < at('/app.js'));
});

test('web: the status line is a dot in the bot\'s colour and the line, as text', () => {
  assert.equal(OpeningLine.status('Checking the weather in Brussels', '#378add'),
    '<div class="status-line" role="status" style="--c:#378add"><i></i><span>Checking the weather in Brussels</span></div>');
  assert.equal(OpeningLine.status('', '#378add'), '');
  for (const none of [null, undefined, 5, {}, ['x'], '   ']) assert.equal(OpeningLine.status(none, '#378add'), '', String(none));
});

test('web: nothing a bot writes is markup', () => {
  const html = OpeningLine.status('<img src=x onerror=alert(1)> & "quotes" \'too\'', '#378add');
  assert.doesNotMatch(html.replace(/^<div class="status-line" role="status" style="--c:#378add"><i><\/i><span>|<\/span><\/div>$/g, ''), /[<>"']/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quotes&quot; &#39;too&#39;/);
  for (const bad of ['red;background:url(x)', '"><script>', '#12345', '', undefined]) assert.match(OpeningLine.status('Hi', bad), /style="--c:#888780"/);
  assert.equal(OpeningLine.status('Hi', '#D85A30').includes(`--c:${Unread.tint('#D85A30')}`), true, 'the colour is checked by the dots\' own check');
});

test('web: the line is the server\'s text; the page cuts and tidies nothing itself', () => {
  assert.equal(OpeningLine.text(' Checking the weather '), 'Checking the weather');
  for (const none of [null, undefined, 5, {}, ['x']]) assert.equal(OpeningLine.text(none), '');
  assert.equal(OpeningLine.MAX, undefined, 'the 120 characters are the server\'s rule (lib/opening-line.js)');
});

test('web: the preview in the list is the line with an ellipsis, or nothing for "Working…"', () => {
  assert.equal(OpeningLine.preview('Planning this week\'s meals'), 'Planning this week\'s meals…');
  for (const none of ['', null, undefined, 3]) assert.equal(OpeningLine.preview(none), '');
  assert.match(app, /const working = OpeningLine\.preview\(openingLines\.of\(`bot:\$\{b\.id\}`\)\) \|\| 'Working…'/);
  assert.match(app, /<div class="prev \$\{line\.cls\}">\$\{esc\(line\.prev\)\}<\/div>/, 'drawn as text');
  assert.match(app, /cls: asks \? 'asks' : b\.running \? 'working' : ''/);
});

test('web: the keeper holds a line per chat until its run ends', () => {
  const k = OpeningLine.keeper();
  assert.equal(k.of('bot:a'), '');
  assert.equal(k.say('bot:a', 'Checking the weather', 'r1'), true);
  assert.equal(k.say('bot:a', 'Checking the weather', 'r1'), false, 'the same again changes nothing');
  assert.equal(k.of('bot:a'), 'Checking the weather');
  assert.equal(k.of('bot:b'), '', 'another bot has none');
  assert.equal(k.say('bot:a', '', 'r1'), false, 'no text is no line');
  assert.equal(k.say(null, 'x'), false);
  assert.equal(k.end('bot:a', 'r0'), false, 'another run\'s end leaves it');
  assert.equal(k.of('bot:a'), 'Checking the weather');
  assert.equal(k.end('bot:a', 'r1'), true, 'answered, failed or stopped: gone');
  assert.equal(k.of('bot:a'), '');
  assert.equal(k.end('bot:a', 'r1'), false);
  // The Chief's line has no run: its chat's reply ends it.
  assert.equal(k.say('chief:c1', 'Setting up your news bot'), true);
  assert.equal(k.end('chief:c1'), true);
  assert.equal(k.of('chief:c1'), '');
});

test('web: the server\'s lists set the lines when the page loads, and drop those of ended runs', () => {
  const k = OpeningLine.keeper();
  assert.equal(k.sync([{ chat: 'bot:a', runId: 'r1', text: 'Checking the weather' }, { chat: 'bot:b', runId: 'r2' }]), true);
  assert.equal(k.of('bot:a'), 'Checking the weather', 'a page opened while the bot works shows it');
  assert.equal(k.of('bot:b'), '');
  // The feed brought b's line after the list was fetched: a list without it does not take it away.
  k.say('bot:b', 'Reading the notes', 'r2');
  assert.equal(k.sync([{ chat: 'bot:a', runId: 'r1', text: 'Checking the weather' }, { chat: 'bot:b', runId: 'r2' }]), false);
  assert.equal(k.of('bot:b'), 'Reading the notes');
  // a's run is over (not in the list): reloading does not bring the line back.
  assert.equal(k.sync([{ chat: 'bot:b', runId: 'r2' }]), true);
  assert.equal(k.of('bot:a'), '');
  // b runs again, with no line yet: the old run's line goes.
  assert.equal(k.sync([{ chat: 'bot:b', runId: 'r3' }]), true);
  assert.equal(k.of('bot:b'), '');
  assert.equal(k.sync([]), false);
});

test('web: a list fetched before a run ended does not bring its line back', () => {
  const k = OpeningLine.keeper();
  k.say('bot:a', 'Checking the weather', 'r1');
  assert.equal(k.end('bot:a', 'r1'), true); // run_finished, while a refresh was on its way
  assert.equal(k.sync([{ chat: 'bot:a', runId: 'r1', text: 'Checking the weather' }]), false);
  assert.equal(k.of('bot:a'), '');
  assert.equal(k.say('bot:a', 'Checking the weather', 'r1'), false, 'nor does a late event of that run');
});

test('web: a bot has one run going, so one line: the run that waited gets its own when the first has ended', () => {
  // A bot does one thing at a time (ADR 011): the next run of a chat starts after the one before it ended.
  const k = OpeningLine.keeper();
  k.say('bot:a', 'Checking the weather', 'r1');
  assert.equal(k.of('bot:a'), 'Checking the weather');
  assert.equal(k.end('bot:a', 'r1'), true);
  assert.equal(k.of('bot:a'), '', 'nothing while the next run has not said its line');
  k.say('bot:a', 'Reading the notes', 'r2');
  assert.equal(k.of('bot:a'), 'Reading the notes');
  assert.equal(k.say('bot:a', 'Checking the weather', 'r1'), false, 'a late event of the run that ended changes nothing');
  assert.equal(k.of('bot:a'), 'Reading the notes');
  assert.equal(k.sync([{ chat: 'bot:a', runId: 'r2', text: 'Reading the notes' }]), false);
  assert.equal(k.end('bot:a', 'r2'), true);
  assert.equal(k.of('bot:a'), '');
});

test('web: after a feed reset the lines are read again from the server', () => {
  const k = OpeningLine.keeper();
  k.say('chief:c1', 'Setting up your news bot');
  k.say('bot:a', 'Checking the weather', 'r1');
  assert.equal(k.clear(), true);
  assert.equal(k.of('chief:c1') + k.of('bot:a'), '');
  assert.equal(k.clear(), false);
  // The Chief is busy in another chat now: c1's old line is not kept by the list.
  assert.equal(k.sync([{ chat: 'chief:c1' }, { chat: 'chief:c2', text: 'Looking at your bots' }]), true);
  assert.equal(k.of('chief:c1'), '');
  assert.equal(k.of('chief:c2'), 'Looking at your bots');
  assert.match(app, /es\.addEventListener\('reset', \(\) => \{ if \(openingLines\.clear\(\)\) \{ renderContacts\(\); placeStatusLines\(\); \} \}\);/);
});

test('web: the line is not a message: no dot, and the "New" line does not look at it', () => {
  // unread.js counts what the server counts; a status line is no row of a chat.
  assert.equal(Unread.dots(Unread.count({ openingLine: 'Checking the weather' }), '#378add'), '');
  assert.doesNotMatch(OpeningLine.status('Checking', '#378add'), /bubble-row|data-msg|new-line|unread-dots/);
  assert.doesNotMatch(read('unread.js'), /status-line|openingLine|opening_line/);
});

test('web: the page draws it under the chat and takes it away when the run ends', () => {
  // From the feed, at once; from the lists, on a refresh; from a run's and a Chief chat's own stream.
  assert.match(app, /es\.addEventListener\('opening_line', \(e\) => \{[\s\S]{0,200}openingLines\.say\(d\.chat, d\.text, d\.runId \?\? null\)\) \{ renderContacts\(\); placeStatusLines\(\); \}/);
  assert.match(app, /es\.addEventListener\('run_finished', \(e\) => \{[\s\S]{0,200}openingLines\.end\(`bot:\$\{d\.botId\}`, d\.id\)\) \{ renderContacts\(\); placeStatusLines\(\); \}/);
  assert.match(app, /if \(\[openingLines\.end\(`chief:\$\{d\.chatId\}`\), !followed && chiefTurns\.delete\(d\.chatId\)\]\.some\(Boolean\)\) placeStatusLines\(\);/);
  assert.match(app, /openingLines\.sync\(\[\s*\.\.\.runs\.filter\(\(r\) => r\.status === 'running'\)\.map\(\(r\) => \(\{ chat: `bot:\$\{r\.botId\}`, runId: r\.id, text: OpeningLine\.ofRun\(r, state\.features\) \}\)\),/);
  assert.match(app, /if \(OpeningLine\.says\(ev\.type, state\.features\)\) onLine\?\.\(ev\.text\);/, 'which event brings a run\'s line: test/working-line-web.test.js');
  assert.match(app, /\} else if \(ev\.type === 'opening_line'\) \{\s*if \(openingLines\.say\(`chief:\$\{id\}`, ev\.text\)\) placeStatusLines\(\);/);
  assert.match(app, /openingLines\.end\(`chief:\$\{id\}`\);\s*chiefTurns\.delete\(id\);\s*placeStatusLines\(\);/, 'the Chief\'s stream ending removes it');
  // Drawn by OpeningLine.status only, in the bot's colour and the Chief's, above the cards that wait.
  assert.match(app, /drawStatusLine\(\$\('#bot-thread'\), botId \? `bot:\$\{botId\}` : null, botById\(botId\)\?\.color, working\?\.id, working\?\.waitingFor === 'ok'\);/);
  assert.match(app, /const kept = chat \? openingLines\.of\(chat\) : '';\n\s*const html = OpeningLine\.status\(stop && typeof stop === 'object' \? OpeningLine\.chiefLine\(doing, kept\) : kept \|\| doing, color, stop, held\);/);
  assert.equal((app.match(/status-line/g) || []).length, 1, 'app.js only finds the line; its markup is OpeningLine\'s');
});

test('web: the look: a pulsing dot in the bot\'s colour, the line, an ellipsis', () => {
  assert.match(css, /\.status-line \{[^}]*color: var\(--muted\);[^}]*font-size: 13px;/);
  assert.match(css, /\.status-line i \{[^}]*width: 7px; height: 7px; border-radius: 50%; background: var\(--c\); animation: status-pulse 1\.2s ease-in-out infinite;/);
  assert.match(css, /\.status-line span::after \{ content: '…'; \}/);
  assert.match(css, /@keyframes status-pulse \{ 50% \{ opacity: \.25; \} \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.status-line i \{ animation: none; \} \}/);
});

test('web: a working bot is one line with Stop: its opening line, or "Working" until it says one', () => {
  assert.equal(OpeningLine.status('', '#378add', 'r1'),
    '<div class="status-line" role="status" style="--c:#378add"><i></i><span>Working</span><button type="button" data-stop-run="r1">Stop</button></div>');
  assert.equal(OpeningLine.status('Checking the Agent Mail inbox', '#378add', 'r1'),
    '<div class="status-line" role="status" style="--c:#378add"><i></i><span>Checking the Agent Mail inbox</span><button type="button" data-stop-run="r1">Stop</button></div>');
  // No running run (and the Chief, which passes none): the line alone, or nothing.
  for (const none of [undefined, null, '', '  ', 5]) {
    assert.equal(OpeningLine.status('', '#378add', none), '', String(none));
    assert.doesNotMatch(OpeningLine.status('Looking at your bots', '#378add', none), /button|Stop/);
  }
  assert.doesNotMatch(OpeningLine.status('', '#378add', '"><script>'), /<script>/, 'the run id is not markup');
  // The Chief's line has Stop too, for its reply: test/chief-line-web.test.js.
  // The line belongs to the bot's running run; a script run has its own row.
  assert.match(app, /const working = botId && state\.runs\.find\(\(r\) => r\.botId === botId && r\.status === 'running' && r\.kind !== 'script'\);/);
  assert.match(css, /\.status-line button \{[^}]*color: var\(--faint\);/);
});

test('web: a running run draws no bubble: no typing dots, no steps, no Details, only what it attached', () => {
  const running = app.slice(app.indexOf("if (r.status === 'running') {", app.indexOf('function botThreadHTML')), app.indexOf("const failed = ['error', 'stopped', 'interrupted']"));
  assert.match(running, /reply = `<div class="bubble-row from-bot" data-live="\$\{esc\(r\.id\)\}">\$\{botFilesHTML\(r\.files\)\}<\/div>`;/);
  assert.doesNotMatch(running, /bubble from-bot|typing|steps|data-details|data-stop-run|activity/);
  assert.match(css, /\[data-live\]:empty \{ display: none; \}/);
  const follow = app.slice(app.indexOf('function followBotRun'), app.indexOf('function watchRun('));
  assert.doesNotMatch(follow, /stepsHTML|\.activity|\.steps/);
  assert.match(follow, /live\.insertAdjacentHTML\('beforeend', html\)/, 'a file it attaches shows at once');
  assert.match(app, /<button data-details="\$\{esc\(r\.id\)\}">Details<\/button>\$\{copyBtn\(body\)\}/, 'a finished reply keeps Details');
});

test('web: Stop stops the line\'s run, and a Stop that fails leaves the chat and says why', async () => {
  // The page's own drawStatusLine and stopRun, run against a stand-in thread: the button is clicked for real.
  const src = app.slice(app.indexOf('function drawStatusLine('), app.indexOf('// ---------- the live feed ----------'));
  const calls = [], toasts = [];
  let fail = null;
  const button = { dataset: { stopRun: 'r1' }, onclick: null };
  const thread = { dataset: {}, scrollHeight: 0, scrollTop: 0, clientHeight: 0, lastElementChild: null, html: '',
    insertAdjacentHTML(where, html) { this.html = html; } };
  const box = vm.createContext({
    OpeningLine, Unread, openingLines: { of: () => '' },
    $: (sel) => (sel === '[data-stop-run]' && thread.html.includes('data-stop-run="r1"') ? button : null),
    api: async (url, opts) => { calls.push([url, opts.method]); if (fail) throw new Error(fail); },
    toast: (text, bad) => toasts.push([text, !!bad]),
  });
  vm.runInContext(`${src}; this.drawStatusLine = drawStatusLine;`, box);
  box.drawStatusLine(thread, 'bot:a', '#378add', 'r1');
  assert.match(thread.html, /<span>Working<\/span><button type="button" data-stop-run="r1">Stop<\/button>/);
  await button.onclick();
  assert.deepEqual(calls, [['/runs/r1/stop', 'POST']]);
  assert.deepEqual(toasts, [['Stopping…', false]]);
  fail = 'The server can\'t be reached';
  await button.onclick();
  assert.deepEqual(toasts[1], ['The server can\'t be reached', true], 'the error, as a toast; nothing else changes');
  assert.match(thread.html, /data-stop-run="r1"/, 'the line stays');
});
