// The sent message is there at once, on the web page (ALV-005): the page's own senders, message box, waiting
// messages and working line, cut out of public/app.js and run against stand-ins, with botdot's answer held back
// so that the chat is looked at between Send and the answer. The owner's words and files stand in the chat from
// Send, drawn as a waiting message is, with "Working" under them; the server's version takes their place when
// the request answers, once; a send that failed takes them away and the box has them again. In a bot's chat and
// a Chief chat, for a quick answer as for a typed message. A group's: test/groups-web.test.js. What a failed
// send and a waiting message did before stays as test/failed-send-web.test.js and test/message-waits-web.test.js
// hold it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, thread } = require('./web-page');

const css = read('style.css');
const at = '2026-10-09T09:00:00.000Z';
const unreached = () => Object.assign(new Error("Can't reach botdot."), { unreached: true });
const refused = (said, status) => Object.assign(new Error(said), { status, refused: true });
const plain = (x) => JSON.parse(JSON.stringify(x));
const FILE = { name: 'backup.log', file: 'uploads/backup.log', size: 2048, readable: true };
const KEY = 'k'.repeat(32);

// A message box as composerHTML draws it.
function composer() {
  const ta = element({}, { scrollHeight: 22 });
  const btn = element({}, { setAttribute(name, value) { btn[name] = value; } });
  const note = element({}, { classes: ['hidden'] });
  const list = element({}, { classes: ['hidden'] });
  const form = element({ '.send-btn': btn, '.send-note': note, '.attach-list': list, '.attach-btn': element() }, { text: ta, files: element() });
  return { form, ta, btn, note, list,
    type(text) { ta.value = text; ta.oninput(); },
    attach: (...files) => files.forEach((f) => form._files.push({ key: f.name, ...f, status: 'ready' })),
    submit: () => form.onsubmit({ preventDefault() {} }),
    line: () => (note.classList.contains('hidden') ? null : note.textContent),
    files: () => Array.from(form._files, (f) => f.name) };
}

// botdot's answers, held back: each request waits until the test answers it.
function held() {
  const waiting = [];
  const take = () => { assert.ok(waiting.length, 'a request is under way'); return waiting.shift(); };
  return { reply: () => new Promise((resolve, reject) => waiting.push({ resolve, reject })), answer: (x) => take().resolve(x), fail: (e) => take().reject(e), asked: () => waiting.length };
}

// A bot's chat and the Chief's with their message boxes, and the page's own functions over them. The rows of a
// bot's chat are its runs, drawn by a stand-in for renderBotChat from what the page holds (state.runs), oldest
// first, as the page does; it notes what was asked of botdot by then.
function page({ features = ['message-waits', 'message-key'], reply = async () => ({}) } = {}) {
  const bot = thread(), chief = thread();
  const boxes = { bot: composer(), chief: composer() };
  const doctor = { id: 'doctor', name: 'Fleet Doctor', color: '#c2473d', queued: [] };
  const state = { features, bots: [doctor], runs: [], chatId: 'c1', chatNew: false, chatStream: null, view: 'bot', botId: 'doctor' };
  const doc = { '#view-bot': { dataset: { bot: 'doctor' } }, '#bot-thread': bot.thread, '#chat-thread': chief.thread, '#view-bot form': boxes.bot.form, '#view-chief form': boxes.chief.form };
  const of = (root) => (root === bot.thread ? bot : root === chief.thread ? chief : root.buttons ? bot : null);
  const said = { calls: [], bodies: [], toasts: [], refreshed: 0, shown: [], followed: [], drawn: [] };
  const lib = vm.createContext({});
  vm.runInContext(read('unread.js'), lib);
  vm.runInContext(read('opening-line.js'), lib);
  const ctx = vm.createContext({
    crypto: globalThis.crypto, esc, state, console: { error: (e) => { throw e; }, warn() {} }, OpeningLine: lib.OpeningLine, Unread: lib.Unread, openingLines: lib.OpeningLine.keeper(),
    CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, CHIEF_COLOR: '#d85a30', ICON: { stop: '<stop>', send: '<send>' },
    chiefTurns: new Map(), chiefQueued: new Map(),
    $: (sel, root) => (root === undefined ? doc[sel] ?? null : of(root) ? of(root).find.$(sel, root) : root.querySelector(sel)),
    $$: (sel, root) => (of(root) ? of(root).find.$$(sel, root) : root.querySelectorAll(sel)),
    document: { createElement: () => bot.make() },
    botById: (id) => state.bots.find((b) => b.id === id), escMentions: (t) => esc(t), mentionSig: () => 'names',
    api: async (path, opts = {}) => { said.calls.push(`${opts.method || 'GET'} ${path}`); if (opts.body) said.bodies.push(opts.body); return reply(path, opts); },
    refresh: () => { said.refreshed++; return new Promise(() => {}); }, // the lists read again: its answer never comes here
    showChat: async (id) => { said.shown.push(id); },
    toast: (...a) => said.toasts.push(a), stopRun() {}, stopChief() {},
    confirm: () => true, looksLikeSecret: () => false, matchMedia: () => ({ matches: false }),
    fetch: () => assert.fail('nothing is uploaded here'),
    userBubble: (m) => `<div class="mine">${esc(m.text)}${(m.attachments || []).map((f) => `[${esc(f.name)}]`).join('')}</div>`, chiefBubble: () => '<div class="pending"></div>',
    syncRead() {}, updateChatNeeds() {}, writeHash() {}, markMore() {}, loadChief: async () => {},
    followChief: (id) => said.followed.push(id),
    renderBotChat: () => {
      said.drawn.push({ asked: [...said.calls], refreshed: said.refreshed });
      for (const row of bot.thread.children.filter((n) => n.className === 'run-row')) row.remove();
      for (const r of [...state.runs].reverse()) bot.thread.insertAdjacentHTML('beforeend', `<div class="run-row" data-run="${esc(r.id)}">${esc(r.prompt)}</div>`);
      ctx.placeStatusLines();
    },
  });
  vm.runInContext(`${cut('const messageKey = ', '// Copy a whole message')}
    ${cut('const fmtSize = ', '// Files a bot attached to its reply')}
    ${cut('const readyFiles = ', '// "@" suggestions above the message box')}
    ${cut('function sendNoteText(err)', 'function renderChief() {')}
    ${cut('async function sendToChief(text, attachments = [], key = messageKey())', 'function followChief(id)')}
    ${cut('async function runBot(botId, text, attachments = [], key = messageKey())', '// A bot\'s running run as it happens')}
    ${cut('const chatParts = ', '// What the page knows about')}
    ${cut('// ---------- a message that waits ----------', '// ---------- a working bot\'s opening line ----------')}
    ${cut('function placeStatusLines() {', '// Stop a run.')}
    Object.assign(this, { wireComposer, sendFrom, sendToChief, runBot, placeStatusLines, setQueued, queuedIn, sentIn, sentAtOnce, sentOver });`, ctx);
  ctx.wireComposer(boxes.bot.form, (text, files, key) => ctx.runBot('doctor', text, files, key), () => 'bot:doctor');
  ctx.wireComposer(boxes.chief.form, ctx.sendToChief, () => 'chief');
  const one = (t, name) => t.thread.children.find((n) => n.className === name) || null;
  // The local bubble where it is drawn: in its own box above the line, or the last row among the messages that wait.
  const local = (t) => one(t, 'chat-sent')?.innerHTML ?? (one(t, 'chat-queued')?.innerHTML.match(/<div class="bubble-row from-me" data-sent>[\s\S]*$/) || [null])[0];
  const lineOf = (t) => one(t, 'status-line')?.html ?? null;
  return { ctx, state, doctor, bot, chief, boxes, said, one, local, lineOf };
}
const run = (id, prompt, status = 'success', more = {}) => ({ id, botId: 'doctor', status, prompt, customPrompt: true, trigger: 'manual', attachments: [], startedAt: at, ...more });
const queued = (id, text, attachments = []) => ({ id, text, attachments, at });

// ---------- a bot's chat ----------

test('web: on Send the bubble and "Working" are in a bot\'s chat before the request answers, with the files; the answer\'s run takes their place', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.state.runs = [run('r1', 'Earlier')];
  p.ctx.renderBotChat();
  p.boxes.bot.type('Check the backup');
  p.boxes.bot.attach(FILE);
  const sending = p.boxes.bot.submit();
  // Nothing has answered: the owner's words and files stand in the chat, faded, and "Working" under them.
  assert.equal(h.asked(), 1, 'the request is under way');
  assert.deepEqual(p.bot.names(), ['run-row', 'chat-sent', 'status-line'], 'above the working line, where its run will draw it');
  assert.match(p.local(p.bot), /^<div class="bubble-row from-me" data-sent><div class="stack mine"><div class="bubble from-me waits">Check the backup<div class="bubble-files">/, 'drawn as a waiting message is');
  assert.match(p.local(p.bot), /<span class="fname">backup\.log<\/span>/, 'its file shows on it');
  assert.doesNotMatch(p.local(p.bot), /data-take-back|Waits until|data-unattach|data-copy/, 'the owner\'s own words and files, and nothing else');
  assert.match(p.lineOf(p.bot), /^<div class="status-line" role="status" style="--c:#c2473d"><i><\/i><span>Working<\/span><\/div>$/, '"Working" under it, in the bot\'s colour, with nothing to stop yet');
  assert.equal(p.boxes.bot.ta.value, '', 'the box is empty');
  assert.deepEqual(p.boxes.bot.files(), []);
  // The answer is the run: it is drawn from the answer itself, before any list is read again.
  h.answer(run('r2', 'Check the backup', 'running', { attachments: [FILE] }));
  await sending;
  assert.deepEqual(p.bot.names(), ['run-row', 'run-row', 'status-line'], 'one message stands, the server\'s');
  assert.deepEqual(plain(p.state.runs.map((r) => r.id)), ['r2', 'r1'], 'on top of the runs the page holds');
  assert.match(p.lineOf(p.bot), /<span>Working<\/span><button type="button" data-stop-run="r2">Stop<\/button>/, 'the line is the run\'s own, with Stop');
  assert.deepEqual(p.said.drawn.pop(), { asked: ['POST /bots/doctor/run'], refreshed: 0 }, 'drawn with nothing read again first');
  assert.equal(p.said.refreshed, 1, 'the lists follow after it, and the send does not wait for them');
  assert.equal(p.boxes.bot.btn.disabled, false, 'Send works again');
});

test('web: a repeat of the same send makes no second message', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.boxes.bot.type('Check the backup');
  let sending = p.boxes.bot.submit();
  assert.ok(p.local(p.bot));
  // The answer is lost: botdot may have it. Nothing of the page's own stays in the chat.
  h.fail(Object.assign(new Error("botdot couldn't do that (504)."), { status: 504, unsure: true }));
  await sending;
  assert.equal(p.local(p.bot), null);
  assert.equal(p.boxes.bot.ta.value, 'Check the backup');
  // The feed's refresh brings the run it did start.
  p.state.runs = [run('r1', 'Check the backup', 'running')];
  p.ctx.renderBotChat();
  // Sent again as it is: the same key, and botdot answers the run it has.
  sending = p.boxes.bot.submit();
  assert.equal(p.local(p.bot), null, 'the message is in the chat already: no second one beside it, not for a moment');
  h.answer({ ...run('r1', 'Check the backup', 'running'), again: true });
  await sending;
  assert.equal(p.said.bodies[1].key, p.said.bodies[0].key);
  assert.deepEqual(p.bot.names(), ['run-row', 'status-line']);
  assert.equal(p.state.runs.length, 1);
  // A run the page holds already, further on than the answer, stays as it is.
  const q = page({ reply: async () => run('r1', 'Check the backup', 'running') });
  q.state.runs = [run('r1', 'Check the backup', 'success')];
  await q.ctx.runBot('doctor', 'Check the backup', [], KEY);
  assert.deepEqual(plain(q.state.runs.map((r) => [r.id, r.status])), [['r1', 'success']]);
});

test('web: a message sent to a working bot stands under those that wait, and becomes the waiting message the server reports', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.state.runs = [run('r1', 'Check why the backup failed', 'running')];
  p.doctor.queued = [queued('q1', 'Also tonight\'s')];
  p.ctx.renderBotChat();
  p.boxes.bot.type('And the disk');
  p.boxes.bot.attach(FILE);
  const sending = p.boxes.bot.submit();
  assert.deepEqual(p.bot.names(), ['run-row', 'status-line', 'chat-queued'], 'at the end, under the messages that already wait');
  const waits = p.one(p.bot, 'chat-queued').innerHTML;
  assert.ok(waits.indexOf('data-take-back="q1"') < waits.indexOf('data-sent'), 'after them');
  assert.match(p.local(p.bot), /<div class="bubble from-me waits">And the disk<div class="bubble-files">/);
  assert.doesNotMatch(p.local(p.bot), /data-take-back|Waits until/, 'nothing says yet that it waits');
  assert.match(p.lineOf(p.bot), /<span>Working<\/span><button type="button" data-stop-run="r1">Stop<\/button>/, 'the line stays the working run\'s');
  // The answer is a run that waits: its id is what "Take back" names.
  h.answer({ id: 'r2', botId: 'doctor', status: 'queued', prompt: 'And the disk', attachments: [FILE], queuedAt: at });
  await sending;
  assert.equal(p.local(p.bot), null);
  assert.deepEqual(plain(p.doctor.queued), [queued('q1', 'Also tonight\'s'), { id: 'r2', text: 'And the disk', attachments: [FILE], at }], 'oldest first, as the server lists them');
  assert.deepEqual([...p.one(p.bot, 'chat-queued').innerHTML.matchAll(/data-take-back="([^"]*)"/g)].map((m) => m[1]), ['q1', 'r2']);
  assert.match(p.one(p.bot, 'chat-queued').innerHTML, /And the disk[\s\S]*Waits until Fleet Doctor is free/);
  assert.deepEqual(plain(p.state.runs.map((r) => r.id)), ['r1'], 'it is no run yet');
  // The same answer again (a repeat), and the feed's own list: one entry.
  const again = p.ctx.runBot('doctor', 'And the disk', [FILE], p.said.bodies[0].key);
  h.answer({ id: 'r2', botId: 'doctor', status: 'queued', prompt: 'And the disk', attachments: [FILE], queuedAt: at, again: true });
  await again;
  p.ctx.setQueued('bot:doctor', [queued('q1', 'Also tonight\'s'), queued('r2', 'And the disk', [FILE])]);
  assert.deepEqual(plain(p.doctor.queued).map((q) => q.id), ['q1', 'r2']);
});

test('web: the server\'s message brought by the feed before the request answers is not drawn twice', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.state.runs = [run('r1', 'Check the backup', 'success', { attachments: [FILE] })]; // the same words and file, sent before: not this message
  p.ctx.renderBotChat();
  const sending = p.ctx.runBot('doctor', 'Check the backup ', [FILE], KEY);
  assert.ok(p.local(p.bot), 'an older message with the same words hides nothing');
  // Not for other words, other files, or a run the owner did not start.
  for (const other of [run('r2', 'Check the disk', 'running', { attachments: [FILE] }), run('r2', 'Check the backup', 'running'),
    run('r2', 'Check the backup', 'running', { attachments: [FILE], jobName: 'Nightly', trigger: 'schedule' }),
    run('r2', 'Check the backup', 'running', { attachments: [FILE], trigger: 'bot', fromBot: { id: 'coder', name: 'Coder' } }),
    run('r2', 'Check the backup', 'running', { attachments: [FILE], startedBy: 'chief' }),
    run('r2', 'Check the backup', 'running', { attachments: [FILE], customPrompt: false })]) {
    p.state.runs = [other, p.state.runs.at(-1)];
    p.ctx.renderBotChat();
    assert.ok(p.local(p.bot), JSON.stringify(other));
  }
  // The feed's refresh brings its run: the local one gives way to it.
  p.state.runs = [run('r2', 'Check the backup', 'running', { attachments: [FILE] }), p.state.runs.at(-1)];
  p.ctx.renderBotChat();
  assert.equal(p.local(p.bot), null);
  const rows = () => p.bot.names().filter((n) => n !== 'chat-queued'); // the box of what waits stays, empty
  assert.equal(p.one(p.bot, 'chat-queued').innerHTML, '');
  assert.deepEqual(rows(), ['run-row', 'run-row', 'status-line']);
  h.answer(run('r2', 'Check the backup', 'running', { attachments: [FILE] }));
  await sending;
  assert.deepEqual(rows(), ['run-row', 'run-row', 'status-line']);
  assert.deepEqual(plain(p.state.runs.map((r) => r.id)), ['r2', 'r1']);
  // Nor twice when the feed brought it as a message that waits.
  const w = page({ reply: h.reply });
  w.state.runs = [run('r1', 'Earlier', 'running')];
  const waiting = w.ctx.runBot('doctor', 'And the disk', [], KEY);
  assert.ok(w.local(w.bot));
  w.ctx.setQueued('bot:doctor', [queued('r2', 'And the disk')]);
  assert.equal(w.local(w.bot), null);
  h.answer({ id: 'r2', botId: 'doctor', status: 'queued', prompt: 'And the disk', attachments: [], queuedAt: at });
  await waiting;
  assert.equal(w.doctor.queued.length, 1);
});

test('web: a failed send leaves no bubble in the chat and restores the box as before', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.state.runs = [run('r1', 'Earlier')];
  p.ctx.renderBotChat();
  p.boxes.bot.type('Do the thing');
  p.boxes.bot.attach(FILE);
  const sending = p.boxes.bot.submit();
  assert.ok(p.local(p.bot));
  h.fail(refused('This bot is paused.', 409));
  await sending;
  assert.deepEqual(p.bot.names(), ['run-row'], 'nothing of it stays: no bubble, no "Working"');
  assert.equal(p.boxes.bot.ta.value, 'Do the thing');
  assert.deepEqual(p.boxes.bot.files(), ['backup.log']);
  assert.equal(p.boxes.bot.line(), 'Not sent: This bot is paused. Your message is still here.');
  assert.equal(p.said.refreshed, 0);
  assert.deepEqual(p.said.toasts, []);
  // Sent again it is there again, and goes.
  const again = p.boxes.bot.submit();
  assert.ok(p.local(p.bot));
  h.answer(run('r2', 'Do the thing', 'running', { attachments: [FILE] }));
  await again;
  assert.deepEqual(p.bot.names(), ['run-row', 'run-row', 'status-line']);
});

test('web: a quick answer is there at once like a typed message, and one that failed leaves the chat with the box as it was', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.state.runs = [run('r1', 'Do you want A or B?')];
  p.ctx.renderBotChat();
  // As the page wires an answer (wireChoices): through the chat's form, with the answer's own key.
  const tap = () => p.ctx.sendFrom(p.boxes.bot.form, () => p.ctx.runBot('doctor', 'A', [], KEY));
  let sending = tap();
  assert.deepEqual(p.bot.names(), ['run-row', 'chat-sent', 'status-line']);
  assert.match(p.local(p.bot), /<div class="bubble from-me waits">A<\/div>/);
  assert.match(p.lineOf(p.bot), /<span>Working<\/span><\/div>$/);
  h.fail(unreached());
  assert.equal(await sending, false);
  assert.deepEqual(p.bot.names(), ['run-row']);
  assert.equal(p.boxes.bot.ta.value, '', 'an answer is not put into the box');
  assert.equal(p.boxes.bot.line(), "Not sent: can't reach botdot. Your message is still here.");
  sending = tap();
  assert.ok(p.local(p.bot));
  h.answer(run('r2', 'A', 'running'));
  assert.equal(await sending, true);
  assert.deepEqual(p.bot.names(), ['run-row', 'run-row', 'status-line']);
  assert.equal(p.said.bodies[1].key, p.said.bodies[0].key);
  // Every answer, card, starter and plan approval goes through the two senders, which draw it (test/failed-send-web.test.js).
  const calls = [...app.matchAll(/(?<!function )\b(sendToChief|runBot)\(/g)];
  assert.ok(calls.length >= 6);
});

test('web: nothing in the local bubble is markup, and a message of files alone is its files', () => {
  const p = page({ reply: () => new Promise(() => {}) });
  p.ctx.runBot('doctor', '<img src=x onerror=alert(1)>', [{ name: '"><script>x</script>.txt', file: 'uploads/x.txt', size: 1 }], KEY);
  assert.doesNotMatch(p.local(p.bot), /<img|<script/);
  assert.match(p.local(p.bot), /&lt;img src=x onerror=alert\(1\)&gt;/);
  const f = page({ reply: () => new Promise(() => {}) });
  f.ctx.runBot('doctor', '', [FILE], KEY);
  assert.match(f.local(f.bot), /<div class="bubble from-me waits"><div class="bubble-files">/);
});

test('web: the local bubble belongs to its chat: another bot\'s chat does not show it, and it is there on the way back', () => {
  const p = page({ reply: () => new Promise(() => {}) });
  p.ctx.runBot('doctor', 'Check the backup', [], KEY);
  assert.ok(p.local(p.bot));
  p.ctx.$('#view-bot').dataset.bot = 'coder'; // the owner opened another bot: the thread is drawn for it
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), []);
  p.ctx.$('#view-bot').dataset.bot = 'doctor';
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['chat-sent', 'status-line'], 'still on its way');
});

test('web: the bubble stays above the one line, also above a card that waits and when the bot says its own words first', () => {
  const p = page({ reply: () => new Promise(() => {}) });
  p.state.runs = [run('r1', 'Earlier')];
  p.ctx.renderBotChat();
  p.bot.thread.append(p.bot.make('chat-needs')); // a card that waits stays last
  p.ctx.runBot('doctor', 'Check the disk', [], KEY);
  assert.deepEqual(p.bot.names(), ['run-row', 'chat-sent', 'status-line', 'chat-needs']);
  const box = p.one(p.bot, 'chat-sent'), line = p.one(p.bot, 'status-line');
  p.ctx.placeStatusLines();
  assert.equal(p.one(p.bot, 'chat-sent'), box, 'drawn once: nothing is moved by each draw');
  assert.equal(p.one(p.bot, 'status-line'), line);
  // The feed says the run's line before the request answered and before the runs were read again.
  p.ctx.openingLines.say('bot:doctor', 'Checking the disk', 'r2');
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['run-row', 'chat-sent', 'status-line', 'chat-needs']);
  assert.match(p.lineOf(p.bot), /<span>Checking the disk<\/span><\/div>$/, 'the bot\'s own words win, and it is still one line');
  // A row added at the end meanwhile, and the cards put last again: the bubble and the line follow, in their order.
  p.bot.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-bot">a note</div>');
  p.bot.thread.append(p.one(p.bot, 'chat-needs'));
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['run-row', 'bubble-row', 'chat-sent', 'status-line', 'chat-needs']);
});

// ---------- a Chief chat ----------

test('web: in a Chief chat the bubble and "Working" are there before the request answers; then the Chief\'s own line, with Stop', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.chief.thread.dataset.chat = 'c1';
  p.chief.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-bot">an earlier reply</div>');
  p.boxes.chief.type('Find a flight');
  p.boxes.chief.attach(FILE);
  const sending = p.boxes.chief.submit();
  assert.deepEqual(p.chief.names(), ['bubble-row', 'chat-sent', 'status-line']);
  assert.match(p.local(p.chief), /<div class="bubble from-me waits">Find a flight<div class="bubble-files">[\s\S]*backup\.log/);
  assert.match(p.lineOf(p.chief), /^<div class="status-line" role="status" style="--c:#d85a30"><i><\/i><span>Working<\/span><\/div>$/, '"Working" until the server answers, with nothing to stop');
  assert.equal(p.boxes.chief.ta.value, '');
  h.answer({ id: 'c1', busy: true, messages: [], queued: [] });
  await sending;
  assert.deepEqual(p.chief.names(), ['bubble-row', 'mine', 'status-line'], 'one message stands, in the place of the local one');
  assert.match(p.chief.thread.children[1].html, /^<div class="mine">Find a flight\[backup\.log\]<\/div>/);
  assert.match(p.lineOf(p.chief), /<span>Thinking<\/span><button type="button" data-stop-chief="c1">Stop<\/button>/);
  assert.deepEqual(p.said.followed, ['c1']);
});

test('web: a first message stands in its new Chief chat from Send, through the making of the chat', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.state.chatId = null;
  p.state.chatNew = true;
  p.chief.thread.insertAdjacentHTML('beforeend', '<div class="chief-empty">What should the team work on?</div>');
  const sending = p.ctx.sendFrom(p.boxes.chief.form, () => p.ctx.sendToChief('Give me a morning briefing every day', [], KEY)); // a starter
  assert.deepEqual(p.chief.names(), ['chief-empty', 'chat-sent', 'status-line'], 'before any chat is made');
  assert.match(css, /\.chief-empty:has\(~ \.chat-sent\), \.chat-empty:has\(~ \.chat-sent\) \{ display: none; \}/, 'the heading and the starters give way to it, and are back when it did not go');
  assert.deepEqual(p.said.calls, ['POST /chief/chats']);
  h.answer({ id: 'c9' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.said.calls, ['POST /chief/chats', 'POST /chief/chats/c9/messages']);
  assert.deepEqual(p.chief.names(), ['chief-empty', 'chat-sent', 'status-line'], 'still there while the message goes');
  // It did not go: the empty chat is as it was, with its starters.
  h.fail(unreached());
  assert.equal(await sending, false);
  assert.deepEqual(p.chief.names(), ['chief-empty']);
  // Sent again, to the chat that was made: there at once, and then the server's.
  const again = p.ctx.sendToChief('Give me a morning briefing every day', [], KEY);
  assert.deepEqual(p.chief.names(), ['chief-empty', 'chat-sent', 'status-line']);
  h.answer({ id: 'c9', busy: true, messages: [], queued: [] });
  await again;
  assert.equal(p.local(p.chief), null);
  assert.equal(p.chief.thread.dataset.chat, 'c9');
  assert.deepEqual(p.said.followed, ['c9']);
  // No chat could be made: nothing stays either.
  const q = page({ reply: async () => { throw unreached(); } });
  q.state.chatId = null;
  await assert.rejects(q.ctx.sendToChief('hi', [], KEY));
  assert.deepEqual(q.chief.names(), []);
});

test('web: a message to a replying Chief stands under those that wait, then is the waiting message the server reports', async () => {
  const h = held();
  const p = page({ reply: h.reply });
  p.chief.thread.dataset.chat = 'c1';
  p.chief.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-me">ask</div>');
  p.ctx.chiefTurns.set('c1', 'Waiting for Web Surfer');
  p.ctx.chiefQueued.set('c1', [queued('q1', 'And a hotel')]);
  p.state.chatStream = { close() { assert.fail('the reply that is going on stays followed'); } };
  p.ctx.placeStatusLines();
  p.boxes.chief.type('And a car');
  const sending = p.boxes.chief.submit();
  assert.deepEqual(p.chief.names(), ['bubble-row', 'status-line', 'chat-queued']);
  const waits = p.one(p.chief, 'chat-queued').innerHTML;
  assert.ok(waits.indexOf('data-take-back="q1"') < waits.indexOf('data-sent'));
  assert.match(p.local(p.chief), /<div class="bubble from-me waits">And a car<\/div>/);
  assert.match(p.lineOf(p.chief), /<span>Waiting for Web Surfer<\/span><button type="button" data-stop-chief="c1">Stop<\/button>/, 'the Chief\'s own line stays');
  h.answer({ id: 'c1', busy: true, messages: [], queued: [queued('q1', 'And a hotel'), queued('q2', 'And a car')] });
  await sending;
  assert.equal(p.local(p.chief), null);
  assert.deepEqual([...p.one(p.chief, 'chat-queued').innerHTML.matchAll(/data-take-back="([^"]*)"/g)].map((m) => m[1]), ['q1', 'q2']);
  assert.deepEqual(p.said.shown, []);
});

test('web: a Chief chat read again while the message is on its way, with the message in it, draws it once', () => {
  const p = page({ reply: () => new Promise(() => {}) });
  p.chief.thread.dataset.chat = 'c1';
  p.chief.thread._mine = [{ role: 'user', text: 'Find a flight', attachments: [] }]; // as showChat leaves them: the same words, from before
  p.ctx.sendToChief('Find a flight', [], KEY);
  assert.ok(p.local(p.chief), 'the same words from before Send hide nothing');
  p.chief.thread._mine = [{ role: 'user', text: 'Find a flight', attachments: [] }, { role: 'user', text: 'Find a flight', attachments: [] }];
  p.ctx.placeStatusLines();
  assert.equal(p.local(p.chief), null);
  assert.match(cut('async function showChat(id) {', '// Stop the Chief\'s reply in a chat'), /thread\._mine = chat\.messages\.filter\(\(m\) => m\.role === 'user'\);/, 'the chat as it was read says what the owner wrote in it');
  // Another chat on screen does not show it.
  const q = page({ reply: () => new Promise(() => {}) });
  q.chief.thread.dataset.chat = 'c1';
  q.ctx.sendToChief('Find a flight', [], KEY);
  q.chief.thread.dataset.chat = 'c2';
  q.state.chatId = 'c2';
  q.ctx.placeStatusLines();
  assert.deepEqual(q.chief.names(), []);
});

test('web: the look: the local bubble is the waiting message\'s, in a box that keeps the chat\'s distance', () => {
  assert.match(css, /\.bubble\.from-me\.waits \{ opacity: \.5; \}/);
  assert.match(css, /\.chat-sent \{ display: flex; flex-direction: column; \}/);
  assert.equal((app.match(/status-line/g) || []).length, 1, 'the line under it is the chat\'s one working line, drawn as every other');
});
