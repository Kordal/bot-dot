// The Chief's working line, Stop and who ended what, on the web page (BUSY-005): public/opening-line.js loaded
// the way the browser loads it, and the page's own code for the Chief's chat, cut out of public/app.js and run
// against stand-ins. While the Chief replies its chat shows one status line, as a bot's chat has: its opening
// line once it has one, else what it is doing, with the faint word Stop at its end; the "Thinking" bubble is
// gone. A turn the page did not start (the feed's `chief_started`) shows the line and its reply. An ended run
// reads the server's `problem`, a stopped reply the server's sentence, and a late result has its "From" chip.
// The real page is walked in test/browser/message-waits.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, thread } = require('./web-page');

const css = read('style.css');
const lib = vm.createContext({});
vm.runInContext(read('unread.js'), lib);
vm.runInContext(read('opening-line.js'), lib);
const { OpeningLine } = lib;
const CHIEF = '#d85a30';
const plain = (x) => JSON.parse(JSON.stringify(x));
const said = (html) => html?.match(/<span>(.*?)<\/span>/)?.[1] ?? null;

test('web: the status line takes a stop that is not a run: the Chief\'s reply in a chat', () => {
  assert.equal(OpeningLine.status('', CHIEF, { chief: 'c1' }),
    `<div class="status-line" role="status" style="--c:${CHIEF}"><i></i><span>Thinking</span><button type="button" data-stop-chief="c1">Stop</button></div>`);
  assert.equal(OpeningLine.status('Looking at your bots', CHIEF, { chief: 'c1' }),
    `<div class="status-line" role="status" style="--c:${CHIEF}"><i></i><span>Looking at your bots</span><button type="button" data-stop-chief="c1">Stop</button></div>`);
  // A reply is never "held": that is a run waiting for the owner's OK.
  assert.doesNotMatch(OpeningLine.status('Looking', CHIEF, { chief: 'c1' }, true), /held|Waiting for your OK/);
  // No chat to stop: the line alone, or nothing, as before.
  for (const none of [{}, { chief: '' }, { chief: 5 }, { chief: null }, [], null]) {
    assert.equal(OpeningLine.status('', CHIEF, none), '', JSON.stringify(none));
    assert.doesNotMatch(OpeningLine.status('Looking', CHIEF, none), /button|Stop/);
  }
  assert.doesNotMatch(OpeningLine.status('', CHIEF, { chief: '"><script>' }), /<script>/, 'the chat id is not markup');
  // A bot's line and its Stop are as they were.
  assert.equal(OpeningLine.status('', '#378add', 'r1'),
    '<div class="status-line" role="status" style="--c:#378add"><i></i><span>Working</span><button type="button" data-stop-run="r1">Stop</button></div>');
  assert.match(css, /\.status-line button \{[^}]*color: var\(--faint\);[^}]*font-size: 12px;/, 'the faint word, the same for both');
});

// The Chief's chat that stands in for the one on screen, with the page's placeStatusLines and drawStatusLine.
function chiefChat({ reply = async () => ({ ok: true }) } = {}) {
  const t = thread();
  t.thread.dataset.chat = 'c1';
  const state = { runs: [], chatId: 'c1' };
  const calls = [];
  const ctx = vm.createContext({
    OpeningLine, Unread: lib.Unread, openingLines: OpeningLine.keeper(), state, CHIEF_COLOR: CHIEF, 
    chiefTurns: new Map(), botById: () => null, updateChatQueued() {}, stopRun: () => assert.fail('no run is stopped from the Chief\'s line'),
    api: async (path, opts = {}) => { calls.push(`${opts.method || 'GET'} ${path}`); return reply(path); },
    $: (sel, root) => (root === undefined ? (sel === '#chat-thread' ? t.thread : null) : t.find.$(sel, root)), $$: (sel, root) => t.find.$$(sel, root),
  });
  vm.runInContext(`${cut('const chiefActivity = ', '// The Chief\'s replies that are going on')}
    ${cut('const stopChief = ', '// Rejects when the message did not go')}
    ${cut('function placeStatusLines() {', '// Stop a run.')}
    Object.assign(this, { placeStatusLines, chiefActivity, stopChief });`, ctx);
  const line = () => { ctx.placeStatusLines(); return t.thread.children.find((n) => n.className.startsWith('status-line'))?.html ?? null; };
  return { ctx, state, calls, line, ...t };
}

test('web: while the Chief replies its chat has the line a bot\'s chat has: what the server says it is doing, its opening line first', () => {
  const c = chiefChat();
  assert.equal(c.line(), null, 'no reply is going on: no line');
  c.ctx.chiefTurns.set('c1', '');
  assert.equal(c.line(), `<div class="status-line" role="status" style="--c:${CHIEF}"><i></i><span>Thinking</span><button type="button" data-stop-chief="c1">Stop</button></div>`);
  c.ctx.chiefTurns.set('c1', 'Waiting for Web Surfer');
  assert.equal(said(c.line()), 'Waiting for Web Surfer');
  // The server's `activity` text is the whole line: its opening line first, then the steps that follow. The page
  // draws it, and the line goes on after the opening line.
  c.ctx.openingLines.say('chief:c1', 'Asking Web Surfer for the cheapest flight');
  c.ctx.chiefTurns.set('c1', 'Asking Web Surfer for the cheapest flight');
  assert.equal(said(c.line()), 'Asking Web Surfer for the cheapest flight', 'its opening line, once it has one');
  c.ctx.chiefTurns.set('c1', 'Reading tap.pt');
  assert.equal(said(c.line()), 'Reading tap.pt', 'then what it is doing, not the opening line for the whole reply');
  c.ctx.chiefTurns.set('c1', 'Thinking');
  assert.equal(said(c.line()), 'Thinking');
  assert.match(c.line(), /data-stop-chief="c1">Stop<\/button>/);
  // No words in the activity: none came yet, or a server from before names the tool alone. The opening line stands.
  c.ctx.chiefTurns.set('c1', '');
  assert.equal(said(c.line()), 'Asking Web Surfer for the cheapest flight');
  c.ctx.chiefTurns.set('c1', c.ctx.chiefActivity({ tool: 'list_bots' }));
  assert.equal(said(c.line()), 'Asking Web Surfer for the cheapest flight');
  c.ctx.openingLines.end('chief:c1');
  assert.equal(said(c.line()), 'Working', 'and without an opening line, the plain line of something at work');
  c.ctx.openingLines.say('chief:c1', 'Asking Web Surfer for the cheapest flight');
  // Another chat's reply is not this chat's.
  c.thread.dataset.chat = 'c2';
  assert.equal(c.line(), null);
  c.thread.dataset.chat = 'c1';
  // The reply ended: the line goes.
  c.ctx.openingLines.end('chief:c1');
  c.ctx.chiefTurns.delete('c1');
  assert.equal(c.line(), null);
  assert.match(css, /\.status-line span::after \{ content: '…'; \}/, 'the ellipsis is the style\'s');
});

test('web: what the Chief is doing, in words: the server\'s text, and the page has none of its own for a tool', () => {
  const { ctx } = chiefChat();
  assert.equal(ctx.chiefActivity({ tool: 'thinking', text: 'Thinking' }), 'Thinking');
  assert.equal(ctx.chiefActivity({ tool: 'wait_for_run', text: 'Waiting for Web Surfer' }), 'Waiting for Web Surfer');
  assert.equal(ctx.chiefActivity({ tool: 'WebFetch', text: 'Reading nytimes.com' }), 'Reading nytimes.com', 'a bot\'s words, as the server says them');
  assert.equal(ctx.chiefActivity({ tool: 'run_bot', text: 'Starting a bot' }), 'Starting a bot');
  // A server from before it had words for every tool names the tool alone: the plain line of something at work.
  assert.equal(ctx.chiefActivity({ tool: 'run_bot' }), 'Working');
  assert.equal(ctx.chiefActivity({ tool: 'something_new' }), 'Working');
  assert.equal(ctx.chiefActivity({ tool: 'run_bot', text: { no: 'text' } }), 'Working');
  for (const none of [null, undefined]) assert.equal(ctx.chiefActivity(none), '', 'none said: "Thinking" on the line');
  assert.doesNotMatch(app, /CHIEF_ACTIVITY/);
});

test('web: Stop on the Chief\'s line stops that chat\'s reply', async () => {
  const c = chiefChat();
  c.ctx.chiefTurns.set('c1', '');
  c.line();
  const [stop] = c.find.$$('[data-stop-chief]');
  await stop.onclick();
  assert.deepEqual(c.calls, ['POST /chief/chats/c1/stop']);
  assert.match(c.line(), /Thinking/, 'the line stays until the server says the reply ended');
  // From the box of a server without Send while it replies, the button's click is handed in: the open chat's reply.
  c.state.chatId = 'c 2';
  await c.ctx.stopChief({ type: 'click' });
  assert.equal(c.calls[1], 'POST /chief/chats/c%202/stop');
  // A stop that cannot be made leaves the chat as it is.
  const down = chiefChat({ reply: async () => { throw new Error("Can't reach botdot."); } });
  await down.ctx.stopChief('c1');
});

test('web: the "Thinking" bubble is gone: a reply being written is a row without a bubble', () => {
  const bubble = cut('function chiefBubble(m', '// What Approve sends to answer');
  assert.doesNotMatch(bubble, /typing|live-line|'Thinking'|class="activity/);
  assert.match(bubble, /<div class="bubble-row from-bot"\$\{m\.pending \? ' data-pending' : ''\}>/);
  assert.doesNotMatch(cut('function followChief(id) {', '// ---------- a bot\'s conversation ----------'), /\.activity/);
  assert.equal((app.match(/'Thinking'/g) || []).length, 0, 'the word is the status line\'s own (opening-line.js) or the server\'s');
});

// The page's followChief over a chat whose reply is being written, with the stream it opens.
function following({ row = true } = {}) {
  const streams = [];
  const pending = row ? { outerHTML: '<pending>', isConnected: true, chips: [], querySelector: (sel) => (sel === '.actions' ? { insertAdjacentHTML: (w, h) => pending.chips.push(h) } : null), insertAdjacentHTML() {} } : null;
  const t = { dataset: { chat: 'c1' }, scrollHeight: 0, scrollTop: 0, clientHeight: 0, added: [], insertAdjacentHTML(where, html) { this.added.push(html); } };
  const state = { chatId: 'c1', chatStream: null, chatReload: false };
  const did = { placed: 0, shown: [], needs: 0, busy: [] };
  const ctx = vm.createContext({
    JSON, state, chiefTurns: new Map([['c1', '']]), openingLines: OpeningLine.keeper(), OpeningLine,
    $: (sel) => (sel === '#chat-thread' ? t : null), $$: (sel) => (sel === '[data-pending]' && pending ? [pending] : []),
    EventSource: class { constructor(url) { this.url = url; this.closed = false; streams.push(this); } close() { this.closed = true; } },
    placeStatusLines: () => did.placed++, showChat: (id) => did.shown.push(id), updateChatNeeds: () => did.needs++, setSendBusy: (f, busy) => did.busy.push(busy),
    actionChip: (a) => `<chip:${a.text}>`, wireActions() {}, wireChoices() {}, refresh() {}, reportBubble: () => '<file>', chiefBubble: (m) => `<reply:${m.text || m.error}>`,
    sendFrom() {}, sendToChief() {},
  });
  vm.runInContext(`${cut('const chiefActivity = ', '// The Chief\'s replies that are going on')}\n${cut('function followChief(id) {', '// ---------- a bot\'s conversation ----------')}\nthis.followChief = followChief;`, ctx);
  ctx.followChief('c1');
  const emit = (ev) => streams[streams.length - 1].onmessage({ data: JSON.stringify(ev) });
  return { ctx, state, did, streams, pending, t, emit };
}

test('web: what the Chief does while it replies goes to the line, and the reply takes the row\'s place when it is done', () => {
  const f = following();
  assert.equal(f.streams[0].url, '/api/chief/chats/c1/stream');
  f.emit({ type: 'activity', tool: 'wait_for_run', text: 'Waiting for Web Surfer' });
  assert.equal(f.ctx.chiefTurns.get('c1'), 'Waiting for Web Surfer');
  assert.equal(f.did.placed, 1);
  f.emit({ type: 'activity', tool: 'wait_for_run', text: 'Waiting for Web Surfer' });
  assert.equal(f.did.placed, 1, 'the same again draws nothing');
  f.emit({ type: 'opening_line', text: 'Asking Web Surfer' });
  assert.equal(f.ctx.openingLines.of('chief:c1'), 'Asking Web Surfer');
  f.emit({ type: 'action', action: { kind: 'run', text: 'Asked Web Surfer' } });
  assert.deepEqual(f.pending.chips, ['<chip:Asked Web Surfer>'], 'its chips show under the row while it works');
  f.emit({ type: 'done', message: { role: 'chief', text: 'TAP at 07:05, €84.' } });
  assert.equal(f.pending.outerHTML, '<reply:TAP at 07:05, €84.>');
  assert.equal(f.ctx.chiefTurns.has('c1'), false, 'the reply ended: the line goes');
  assert.equal(f.ctx.openingLines.of('chief:c1'), '');
  assert.equal(f.streams[0].closed, true);
  assert.equal(f.state.chatStream, null);
  assert.deepEqual(f.did.shown, []);
});

test('web: a reply that was stopped or failed ends the line the same way', () => {
  const f = following();
  f.emit({ type: 'done', message: { role: 'chief', text: '', error: 'You stopped this reply.' } });
  assert.equal(f.pending.outerHTML, '<reply:You stopped this reply.>');
  assert.equal(f.ctx.chiefTurns.has('c1'), false);
});

test('web: one stream at a time: following a chat again closes the stream before', () => {
  const f = following();
  f.ctx.followChief('c1');
  assert.equal(f.streams.length, 2);
  assert.equal(f.streams[0].closed, true);
  assert.equal(f.state.chatStream, f.streams[1]);
});

test('web: a reply the page drew no row for goes to the end of the chat, above what waits', () => {
  const f = following({ row: false });
  f.emit({ type: 'done', message: { role: 'chief', text: 'Done.' } });
  assert.deepEqual(f.t.added, ['<reply:Done.>']);
  assert.equal(f.did.needs, 1, 'the cards are put last again');
  assert.ok(f.did.placed >= 2, 'and the line and what waits placed again');
});

test('web: when the next turn began while the reply was followed, the chat is read again at its end', () => {
  const f = following();
  f.state.chatReload = true; // the feed's chief_started, or a bot's reply, came meanwhile
  f.emit({ type: 'done', message: { role: 'chief', text: 'First answer.' } });
  assert.deepEqual(f.did.shown, ['c1']);
  assert.equal(f.state.chatReload, false);
  assert.equal(f.pending.outerHTML, '<pending>', 'showChat draws the chat');
});

// The feed's handlers, with the page's state around them.
function feed({ view = 'chief', chatId = 'c1', stream = null, sending = false } = {}) {
  const listeners = {};
  const form = {};
  const state = { view, chatId, chatStream: stream, chatReload: false };
  const did = { shown: [], placed: 0 };
  const ctx = vm.createContext({
    JSON, window: { EventSource: true }, state, setTimeout: () => 0, clearTimeout() {},
    chiefTurns: new Map(), openingLines: OpeningLine.keeper(), sendingIn: new WeakSet(sending ? [form] : []),
    $: (sel) => (sel === '#view-chief form' ? form : null),
    placeStatusLines: () => did.placed++, showChat: (id) => did.shown.push(id),
    EventSource: class { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } },
  });
  vm.runInContext(`${cut('function followFeed()', '// ---------- boot ----------')}\nfollowFeed();`, ctx);
  const emit = (type, data) => listeners[type].forEach((fn) => fn({ data: typeof data === 'string' ? data : JSON.stringify(data) }));
  return { ctx, state, did, emit, listeners };
}

test('web: the page listens to `chief_started`: a turn it did not start shows the line, and the chat is read so that its reply is followed', () => {
  const f = feed();
  f.emit('chief_started', { chatId: 'c1', title: 'Lisbon' });
  assert.equal(f.ctx.chiefTurns.get('c1'), '', 'its working line: "Thinking" until it says more');
  assert.ok(f.did.placed >= 1);
  assert.deepEqual(f.did.shown, ['c1'], 'after an OK, for a message that waited, for a late result');
  // What is no event of ours changes nothing.
  f.emit('chief_started', 'not json');
  f.emit('chief_started', { title: 'no chat' });
  assert.deepEqual(f.did.shown, ['c1']);
  assert.match(cut('async function showChat(id) {', '// Stop the Chief\'s reply in a chat'), /if \(chat\.busy\) followChief\(id\);/, 'the chat read again follows the reply');
});

test('web: a turn in a chat that is not on screen only marks its line', () => {
  for (const f of [feed({ chatId: 'c2' }), feed({ view: 'bot' })]) {
    f.emit('chief_started', { chatId: 'c1' });
    assert.equal(f.ctx.chiefTurns.has('c1'), true);
    assert.deepEqual(f.did.shown, []);
  }
});

test('web: a turn that begins while the page follows the reply before it, or is sending, is taken up when that ends', () => {
  const following = feed({ stream: { close() {} } });
  following.emit('chief_started', { chatId: 'c1' });
  assert.deepEqual(following.did.shown, [], 'no second stream');
  assert.equal(following.state.chatReload, true, 'the chat is read again when the stream ends (followChief)');
  // The page's own message: its answer draws it (sendToChief), and the turn the feed names is that one.
  const sending = feed({ sending: true });
  sending.emit('chief_started', { chatId: 'c1' });
  assert.deepEqual(sending.did.shown, []);
  assert.equal(sending.state.chatReload, false);
  assert.equal(sending.ctx.chiefTurns.has('c1'), true);
});

test('web: the Chief\'s own reply ends the line of a turn the page does not follow; a bot\'s file does not', () => {
  const f = feed({ chatId: 'c2' });
  f.emit('chief_started', { chatId: 'c1' });
  f.emit('chief_reply', { chatId: 'c1', status: 'success', from: { id: 'surf', name: 'Web Surfer' } });
  assert.equal(f.ctx.chiefTurns.has('c1'), true, 'a bot\'s reply posted there: the Chief still replies');
  f.emit('chief_reply', { chatId: 'c1', status: 'success' });
  assert.equal(f.ctx.chiefTurns.has('c1'), false);
  // A reply the page follows ends with its stream: the next turn's start may come before that.
  const followed = feed({ stream: { close() {} } });
  followed.emit('chief_started', { chatId: 'c1' });
  followed.emit('chief_reply', { chatId: 'c1', status: 'success' });
  assert.equal(followed.ctx.chiefTurns.has('c1'), true);
  // When the Chief replies nowhere, no line is left over.
  assert.match(cut('async function refresh()', 'function render()'), /if \(!chief\.busy\) for \(const id of \[\.\.\.chiefTurns\.keys\(\)\]\) if \(!\(state\.chatStream && id === state\.chatId\)\) chiefTurns\.delete\(id\);/);
});

test('web: a chat that is read takes its reply that is going on, and what waits, from the server', async () => {
  const t = element({}, { scrollHeight: 0, scrollTop: 0 });
  const form = element({}, { text: element() });
  const state = { chatId: null, chatStream: null, view: 'chief', jump: null };
  const did = { followed: [], busy: [] };
  let chat = { id: 'c1', busy: true, openingLine: null, queued: [{ id: 'q7', text: 'And the weather?', attachments: [], at: 'x' }, { text: 'no id' }],
    messages: [{ role: 'user', text: 'Ask Web Surfer.' }, { role: 'chief', pending: true, activity: { tool: 'wait_for_run', text: 'Waiting for Web Surfer' } }] };
  const ctx = vm.createContext({
    state, chiefTurns: new Map(), chiefQueued: new Map(), openingLines: OpeningLine.keeper(), OpeningLine,
    $: (sel) => (sel === '#chat-thread' ? t : sel === '#view-chief form' ? form : null), $$: () => [],
    api: async () => chat, toast: () => assert.fail('no toast'), matchMedia: () => ({ matches: true }),
    writeHash() {}, sayPresent() {}, syncRead() {}, mentionSig: () => 'names', messageHTML: (m) => `<div class="bubble-row">${m.text || ''}</div>`,
    wireActions() {}, wireChoices() {}, placeStatusLines() {}, updateChatNeeds() {}, placeChiefLine() {}, markSearch() {}, jumpTo() {},
    setSendBusy: (f, busy) => did.busy.push(!!busy), followChief: (id) => did.followed.push(id), stopChief() {},
    queuedList: (list) => (Array.isArray(list) ? list : []).filter((q) => q && typeof q.id === 'string' && q.id),
  });
  vm.runInContext(`${cut('const chiefActivity = ', '// The Chief\'s replies that are going on')}\n${cut('async function showChat(id) {', '// Stop the Chief\'s reply in a chat')}\nthis.showChat = showChat;`, ctx);
  await ctx.showChat('c1');
  assert.equal(ctx.chiefTurns.get('c1'), 'Waiting for Web Surfer');
  assert.deepEqual(plain(ctx.chiefQueued.get('c1')).map((q) => q.id), ['q7']);
  assert.deepEqual(did.followed, ['c1']);
  // Read again when nothing goes on and nothing waits (a server without the list sends none).
  chat = { id: 'c1', busy: false, messages: [{ role: 'user', text: 'Ask Web Surfer.' }, { role: 'chief', text: 'Done.' }] };
  await ctx.showChat('c1');
  assert.equal(ctx.chiefTurns.has('c1'), false);
  assert.deepEqual(plain(ctx.chiefQueued.get('c1')), []);
  assert.deepEqual(did.followed, ['c1']);
});

// ---------- Stop and who ended it ----------

test('web: the page\'s own table is for a run without the server\'s `problem`, and names who ended it', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${cut('const ENDED_BY = {', 'function runHeader(meta) {')}\nthis.friendlyProblem = friendlyProblem;`, ctx);
  const p = (meta) => ctx.friendlyProblem(meta, '');
  assert.equal(p({ status: 'stopped' }), 'You stopped this run before it finished.', 'a server that names nobody: the owner did');
  assert.equal(p({ status: 'stopped', endedBy: 'owner' }), 'You stopped this run before it finished.');
  assert.equal(p({ status: 'stopped', endedBy: 'chief' }), 'The Chief stopped this run before it finished.');
  assert.equal(p({ status: 'error', endedBy: 'signout' }), 'This run was stopped because Claude was signed out.');
  assert.equal(p({ status: 'error', endedBy: 'limit' }), 'I stopped after 60 minutes: this took too long. Send it again, or break it into smaller pieces.');
  // Someone the page does not know: nobody is named, and never the owner.
  for (const who of ['schedule', 'toString', 'constructor']) {
    assert.equal(p({ status: 'stopped', endedBy: who }), 'This run was stopped before it finished.', who);
    assert.doesNotMatch(p({ status: 'error', endedBy: who, error: 'boom' }), /You stopped/);
  }
  assert.equal(p({ status: 'interrupted' }), 'This run was cut off because botdot was restarted.', 'the rest of the table is as it was');
});

// The page's botThreadHTML over a bot's runs, with the page's own table for a run without `problem`.
function threadHTML(runs) {
  const ctx = vm.createContext({
    esc, Unread: lib.Unread, state: { keepOpen: null }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: () => '11:40', dur: () => '2 s',
    notesFoldHTML: () => '', filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '',
    escMentions: (t) => esc(t), md: (t) => esc(t), learnedChips: () => '', choicesHTML: () => '', questionsHTML: () => '',
  });
  vm.runInContext(`${cut('const ENDED_BY = {', 'function runHeader(meta) {')}\n${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// The notes other bots left for a bot')}\nthis.botThreadHTML = botThreadHTML;`, ctx);
  return ctx.botThreadHTML({ id: 'surf', name: 'Web Surfer', color: '#2f9e77' }, runs);
}
const problems = (html) => [...html.matchAll(/<div class="bubble from-bot problem"><div class="md">([\s\S]*?)<\/div>/g)].map((m) => m[1]);

test('web: an ended run draws the server\'s `problem`: who stopped it, in the server\'s words', () => {
  const run = { id: 'r1', botId: 'surf', trigger: 'manual', prompt: 'Find the cheapest flight.', customPrompt: true, startedAt: '2026-10-06T09:00:00.000Z', endedAt: '2026-10-06T09:01:00.000Z' };
  const sentences = {
    owner: 'You stopped this run before it finished.',
    chief: 'The Chief stopped this run before it finished.',
    signout: 'This run was stopped because Claude was signed out.',
    limit: 'I stopped after 60 minutes: this took too long. Send it again, or break it into smaller pieces.',
  };
  for (const [endedBy, problem] of Object.entries(sentences)) {
    const status = ['owner', 'chief'].includes(endedBy) ? 'stopped' : 'error';
    assert.deepEqual(problems(threadHTML([{ ...run, status, endedBy, problem }])), [problem], endedBy);
    // Without the sentence (a run the page followed live, a server that sends none) the page says the same.
    assert.deepEqual(problems(threadHTML([{ ...run, status, endedBy }])), [problem], `${endedBy}, the page's own`);
  }
  // The server's sentence wins over the page's table, whatever it says.
  assert.deepEqual(problems(threadHTML([{ ...run, status: 'stopped', endedBy: 'chief', problem: 'The Chief stopped this run: you asked for Sunday.' }])), ['The Chief stopped this run: you asked for Sunday.']);
  assert.doesNotMatch(threadHTML([{ ...run, status: 'stopped', endedBy: 'chief' }]), /You stopped/);
  // The run's details draw it the same way.
  assert.match(cut('function showRun(id) {', '// ---------- chief of staff ----------'), /const body = failed \? current\?\.problem \|\| friendlyProblem\(current \|\| \{\}, resultText\) :/);
});

// The page's chiefBubble and actionChip, with its own Markdown.
const chiefPage = vm.createContext({
  esc, state: { features: [], bots: [{ id: 'surf', name: 'Web Surfer', computer: 'linux' }], runs: [] }, CHIEF_COLOR: CHIEF, OpeningLine,
  msgTime: () => '09:12', copyBtn: () => '', choicesHTML: () => '', questionsHTML: () => '',
});
vm.runInContext(read('unread.js'), chiefPage);
vm.runInContext(read('ratings.js'), chiefPage);
vm.runInContext(`${cut('function md(src)', '// Link bare web addresses after rendering')}\n${cut('function actionBot(a)', '// What Approve sends to answer')}\n${cut('function wireActions(root) {', '// Open the Chief on this chat')}
  Object.assign(this, { chiefBubble, actionChip, wireActions });`, chiefPage);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('web: a Chief reply that was stopped draws the server\'s sentence, which names the runs that were stopped too', () => {
  const sentence = 'You stopped this reply. Web Surfer\'s run was stopped too.';
  const html = chiefPage.chiefBubble({ role: 'chief', text: '', error: sentence, stopped: [{ botId: 'surf', name: 'Web Surfer', runId: 'r5' }], at: '2026-10-06T09:12:00Z' });
  assert.match(html, /<div class="bubble from-bot\s+problem">/);
  assert.equal(text(html), 'You stopped this reply. Web Surfer&#39;s run was stopped too. 09:12', 'the sentence as it came, as text; the page adds no words about the runs');
  // After text it is the block under the text, as every problem of a reply.
  const both = chiefPage.chiefBubble({ role: 'chief', text: 'Web Surfer is looking.', error: 'This reply was stopped because Claude was signed out.', at: '2026-10-06T09:12:00Z' });
  assert.match(both, /<div class="problem-line"><div class="md"><p>This reply was stopped because Claude was signed out\.<\/p><\/div><\/div>/);
});

test('web: a late result has the chip "↩ From <Bot>", and a tap opens that bot\'s chat', async () => {
  const html = chiefPage.chiefBubble({ role: 'chief', text: 'Web Surfer found it: TAP at 07:05, €84.', at: '2026-10-06T09:12:00Z',
    actions: [{ kind: 'from', text: 'From Web Surfer', botId: 'surf', runId: 'r5' }, { kind: 'run', text: 'Asked Coder', botId: 'coder' }] });
  assert.match(html, /<button class="action-chip" data-kind="from" data-bot="surf" data-run-id="r5">↩ From Web Surfer<\/button>/);
  assert.doesNotMatch(chiefPage.actionChip({ kind: 'from', text: 'From Web Surfer', botId: 'surf' }), /View live screen/, 'it opens the chat, not the screen');
  assert.doesNotMatch(chiefPage.actionChip({ kind: 'from', text: '<b>From</b>', botId: '"><i>' }), /<b>|<i>/);
  // The tap.
  const chip = { dataset: { kind: 'from', bot: 'surf', runId: 'r5' }, onclick: null };
  const went = [];
  Object.assign(chiefPage, { $$: () => [chip], setView: (...a) => went.push(a), openScreen: () => went.push(['screen']), openRun: (id) => went.push(['run', id]), toast: () => assert.fail('no toast'), api: async () => assert.fail('the bot is known') });
  chiefPage.wireActions({});
  await chip.onclick();
  assert.deepEqual(went, [['bot', 'surf']]);
});
