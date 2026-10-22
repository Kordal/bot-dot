// A message that waits, on the web page (BUSY-005; docs/api.md, "A message that waits"): the page's own code
// for the waiting messages, the message box and the two senders, cut out of public/app.js and run against
// stand-ins. A message to a working bot or a replying Chief is drawn from the server's list at the end of its
// chat, faded, after the working line and before the cards, with "Take back", which puts its text and files
// into the box again; Send stays in the box; once botdot answered the page has no bubble of its own and follows
// nothing for a run that only waits. The real page is walked in test/browser/message-waits.cjs. The message in
// the chat from Send until that answer: test/sent-at-once-web.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, thread } = require('./web-page');

const css = read('style.css');
const at = '2026-10-06T09:00:00.000Z';
const FIRST = 'Check why the backup failed last night.';
const SECOND = 'Also check that tonight\'s backup has enough room.';
const refused = (said, status, more = {}) => Object.assign(new Error(said), { status, refused: true, ...more });
// What the page made, as values of this side (its code runs in a context of its own).
const plain = (x) => JSON.parse(JSON.stringify(x));

// A message box as composerHTML draws it.
function composer() {
  const ta = element({}, { scrollHeight: 22 });
  const btn = element({}, { setAttribute(name, value) { btn[name] = value; } });
  const note = element({}, { classes: ['hidden'] });
  const list = element({}, { classes: ['hidden'] });
  const form = element({ '.send-btn': btn, '.send-note': note, '.attach-list': list, '.attach-btn': element() }, { text: ta, files: element() });
  return { form, ta, btn, note, list,
    type(text) { ta.value = text; ta.oninput(); },
    submit: () => form.onsubmit({ preventDefault() {} }),
    line: () => (note.classList.contains('hidden') ? null : note.textContent),
    files: () => Array.from(form._files, (f) => [f.name, f.status]) };
}

// A bot's chat and the Chief's, with their message boxes: the page's own functions over them. reply(path, opts)
// is botdot's answer to a request.
function page({ features = ['message-waits'], reply = async () => ({}) } = {}) {
  const bot = thread(), chief = thread();
  const boxes = { bot: composer(), chief: composer() };
  const doctor = { id: 'doctor', name: 'Fleet Doctor', color: '#c2473d', queued: [] };
  const state = { features, bots: [doctor], runs: [], chatId: 'c1', chatNew: false, chatStream: null, view: 'bot' };
  const doc = { '#view-bot': { dataset: { bot: 'doctor' } }, '#bot-thread': bot.thread, '#chat-thread': chief.thread, '#view-bot form': boxes.bot.form, '#view-chief form': boxes.chief.form };
  const of = (root) => (root === bot.thread ? bot : root === chief.thread ? chief : root.buttons ? bot : null);
  const said = { calls: [], bodies: [], toasts: [], refreshed: 0, shown: [], followed: [], streams: 0 };
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
    refresh: async () => { said.refreshed++; }, showChat: async (id) => { said.shown.push(id); },
    toast: (...a) => said.toasts.push(a), stopRun() {}, stopChief() {},
    confirm: () => true, looksLikeSecret: () => false, matchMedia: () => ({ matches: false }),
    fetch: () => assert.fail('nothing is uploaded here'),
    EventSource: class { constructor() { said.streams++; assert.fail('no stream is opened for a message that waits'); } },
    userBubble: (m) => `<div class="mine">${esc(m.text)}</div>`, chiefBubble: () => '<div class="pending"></div>',
    syncRead() {}, updateChatNeeds() {}, writeHash() {}, markMore() {}, loadChief: async () => {},
    followChief: (id) => said.followed.push(id),
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
    Object.assign(this, { wireComposer, setSendBusy, sendToChief, runBot, placeStatusLines, setQueued, queuedList, queuedIn, takeBack, steerQueued });`, ctx);
  ctx.wireComposer(boxes.bot.form, (text, files, key) => ctx.runBot('doctor', text, files, key), () => 'bot:doctor');
  ctx.wireComposer(boxes.chief.form, ctx.sendToChief, () => 'chief');
  const waiting = (t) => t.thread.children.find((n) => n.className === 'chat-queued') || null;
  return { ctx, state, doctor, bot, chief, boxes, said, waiting };
}
const queued = (id, text, attachments = []) => ({ id, text, attachments, at });
const working = { id: 'r1', botId: 'doctor', status: 'running', prompt: FIRST };

test('web: a bot\'s waiting messages are drawn at the end of its chat: after the working line, before the cards', () => {
  const p = page();
  p.bot.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-me">first</div>');
  p.bot.thread.append(p.bot.make('chat-needs'));
  p.state.runs = [working];
  p.doctor.queued = [queued('q1', SECOND, [{ name: 'backup.log', file: 'uploads/backup.log', size: 2048 }])];
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['bubble-row', 'status-line', 'chat-queued', 'chat-needs']);
  const html = p.waiting(p.bot).innerHTML;
  assert.match(html, /<div class="bubble-row from-me"><div class="stack mine">\s*<div class="bubble from-me waits">Also check that tonight&#39;s backup has enough room\./, 'the owner\'s bubble, faded');
  assert.match(html, /<div class="bubble-meta"><span>Waits until Fleet Doctor is free<\/span><button type="button" data-take-back="q1">Take back<\/button><\/div>/);
  assert.match(html, /<div class="bubble-files"><span class="file-chip [^>]*title="backup\.log · 2 KB">[^<]*<span class="fname">backup\.log<\/span><\/span><\/div>/, 'its files, as on a sent message');
  assert.doesNotMatch(html, /data-unattach|copy/, 'nothing to remove a file with, nothing to copy');
  // Drawn again only when something changed.
  const box = p.waiting(p.bot), line = p.bot.thread.children[1];
  p.ctx.placeStatusLines();
  assert.equal(p.waiting(p.bot), box);
  assert.equal(p.bot.thread.children[1], line, 'the line stays where it stands: it is not moved by each draw');
  // A new row and the cards put last again (updateChatNeeds): the line and what waits follow, in their order.
  p.bot.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-bot">a reply</div>');
  p.bot.thread.append(p.bot.thread.children.find((n) => n.className === 'chat-needs'));
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['bubble-row', 'bubble-row', 'status-line', 'chat-queued', 'chat-needs']);
});

test('web: several wait in the order sent, and a bot that is not working has them without a line', () => {
  const p = page();
  p.doctor.queued = [queued('q1', 'One'), queued('q2', 'Two'), queued('q3', '', [{ name: 'a.pdf', file: 'uploads/a.pdf', size: 5 }])];
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['chat-queued']);
  const html = p.waiting(p.bot).innerHTML;
  assert.deepEqual([...html.matchAll(/data-take-back="([^"]*)"/g)].map((m) => m[1]), ['q1', 'q2', 'q3']);
  assert.match(html, /<div class="bubble from-me waits"><div class="bubble-files">/, 'files alone: the bubble holds them');
});

test('web: in the Chief\'s chat they wait "until the Chief is free", under its working line with Stop', () => {
  const p = page();
  p.chief.thread.dataset.chat = 'c1';
  p.chief.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-me">ask</div>');
  p.ctx.chiefTurns.set('c1', 'Waiting for Web Surfer');
  p.ctx.chiefQueued.set('c1', [queued('q7', 'And what is the weather there on Friday?')]);
  p.ctx.placeStatusLines();
  assert.deepEqual(p.chief.names(), ['bubble-row', 'status-line', 'chat-queued']);
  assert.match(p.chief.thread.children[1].html, /<span>Waiting for Web Surfer<\/span><button type="button" data-stop-chief="c1">Stop<\/button>/);
  assert.match(p.waiting(p.chief).innerHTML, /<span>Waits until the Chief is free<\/span><button type="button" data-take-back="q7">Take back<\/button>/);
  // Another chat's messages are not this chat's.
  p.chief.thread.dataset.chat = 'c2';
  p.ctx.placeStatusLines();
  assert.equal(p.waiting(p.chief).innerHTML, '');
});

test('web: they are drawn from the server\'s list alone: on a page that sent none, and gone when the list says so', () => {
  const p = page();
  assert.equal(p.waiting(p.bot), null, 'no list: nothing is added to the chat');
  p.ctx.setQueued('bot:doctor', [queued('q1', SECOND)]); // the feed's `queued`, from a message another app sent
  assert.match(p.waiting(p.bot).innerHTML, /Also check that tonight&#39;s backup/);
  assert.deepEqual(plain(p.doctor.queued), [queued('q1', SECOND)], 'the bot\'s list is the server\'s');
  p.ctx.setQueued('bot:doctor', []); // it started, or was taken back
  assert.equal(p.waiting(p.bot).innerHTML, '');
  assert.match(css, /\.chat-queued:empty \{ display: none; \}/);
  p.ctx.setQueued('chief:c1', [queued('q7', 'Later')]);
  assert.deepEqual(plain(p.ctx.queuedIn('chief:c1')), [queued('q7', 'Later')]);
  p.ctx.setQueued('bot:gone', [queued('q9', 'x')]); // a bot this page does not know: nothing to draw, nothing breaks
  // The lists come with the bots, with a Chief chat, and with the feed.
  assert.match(app, /if \(typeof d\.chat === 'string'\) setQueued\(d\.chat, d\.queued\);/);
  assert.match(app, /chiefQueued\.set\(id, queuedList\(chat\.queued\)\);/);
  assert.match(cut('async function refresh()', 'function render()'), /api\('\/bots'\)/);
});

test('web: the feed\'s `queued` reaches the page\'s list, and what is no list changes nothing', () => {
  const listeners = {};
  const got = [];
  const ctx = vm.createContext({
    window: { EventSource: true }, state: {}, setTimeout: () => 0, clearTimeout() {}, setQueued: (chat, list) => got.push([chat, list]),
    EventSource: class { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } },
  });
  vm.runInContext(`${cut('function followFeed()', '// ---------- boot ----------')}\nfollowFeed();`, ctx);
  const emit = (type, data) => listeners[type].forEach((fn) => fn({ data }));
  emit('queued', JSON.stringify({ chat: 'bot:doctor', botId: 'doctor', queued: [queued('q1', SECOND)] }));
  emit('queued', JSON.stringify({ chat: 'chief:c1', chatId: 'c1', queued: [] }));
  emit('queued', 'not json');
  emit('queued', JSON.stringify({ queued: [queued('q2', 'x')] }));
  assert.deepEqual(plain(got), [['bot:doctor', [queued('q1', SECOND)]], ['chief:c1', []]]);
});

test('web: nothing in a waiting message is markup, and an entry without an id is left out', () => {
  const p = page();
  p.doctor.name = '<b>Doc</b>';
  p.doctor.queued = [queued('"><script>x</script>', '<img src=x onerror=alert(1)>'), { text: 'no id' }, null, 'text', queued('', 'empty id'), { id: 7, text: 'a number' }];
  p.ctx.placeStatusLines();
  const html = p.waiting(p.bot).innerHTML;
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal((html.match(/data-take-back=/g) || []).length, 1);
  for (const none of [null, undefined, 'x', 5, {}]) assert.deepEqual(plain(p.ctx.queuedList(none)), []);
  // A list entry whose text or files are not what the contract says draws an empty bubble, not an error.
  p.doctor.queued = [{ id: 'q1', text: 5, attachments: 'x' }];
  p.ctx.placeStatusLines();
  assert.match(p.waiting(p.bot).innerHTML, /<div class="bubble from-me waits"><\/div>/);
});

test('web: Send stays: the box of a bot and of the Chief has Send whether or not something works', () => {
  const p = page();
  let stopped = 0;
  for (const busy of [true, false]) {
    p.ctx.setSendBusy(p.boxes.chief.form, busy, () => stopped++);
    assert.equal(p.boxes.chief.btn.classList.contains('stop'), false);
    assert.equal(p.boxes.chief.btn.innerHTML, '<send>');
    assert.equal(p.boxes.chief.btn.type, 'submit');
    assert.equal(p.boxes.chief.btn.onclick, null);
  }
  assert.match(cut('function renderBotChat() {', '// Rejects when the task did not go'), /setSendBusy\(\$\('form', root\), false\);/, 'a bot\'s box never had Stop');
  assert.doesNotMatch(cut('function composerHTML(placeholder', '// Files attached in a composer'), /stop/i, 'the box is drawn with Send alone');
});

test('web: against a server without `message-waits` the Chief\'s box is as before: Stop while it replies, and nothing is sent meanwhile', async () => {
  const p = page({ features: ['chief', 'unread'] });
  let stopped = 0;
  p.ctx.setSendBusy(p.boxes.chief.form, true, () => stopped++);
  assert.equal(p.boxes.chief.btn.classList.contains('stop'), true);
  assert.equal(p.boxes.chief.btn.innerHTML, '<stop>');
  assert.equal(p.boxes.chief.btn.type, 'button');
  p.boxes.chief.btn.onclick();
  assert.equal(stopped, 1);
  p.boxes.chief.type('And the weather?');
  await p.boxes.chief.submit();
  assert.deepEqual(p.said.calls, [], 'nothing is sent');
  assert.equal(p.boxes.chief.ta.value, 'And the weather?', 'and nothing is lost');
  p.ctx.setSendBusy(p.boxes.chief.form, false);
  assert.equal(p.boxes.chief.btn.classList.contains('stop'), false);
  assert.match(css, /\.send-btn\.stop \{[^}]*\}/, 'its look stays for that server');
});

test('web: a message sent to a working bot empties the box and is drawn among the bot\'s waiting messages, from the answer; the page keeps no bubble and follows nothing', async () => {
  const p = page({ reply: async () => ({ id: 'q1', botId: 'doctor', status: 'queued', prompt: SECOND, attachments: [], queuedAt: at }) });
  p.state.runs = [working];
  p.bot.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-me">first</div>');
  p.ctx.placeStatusLines();
  p.boxes.bot.type(SECOND);
  await p.boxes.bot.submit();
  assert.equal(p.boxes.bot.ta.value, '', 'the box is empty');
  assert.equal(p.boxes.bot.line(), null);
  assert.deepEqual(p.said.calls, ['POST /bots/doctor/run']);
  assert.equal(p.said.bodies[0].prompt, SECOND);
  assert.match(p.said.bodies[0].key, /^[\w-]{8,}$/, 'with its key, as every message');
  assert.equal(p.said.refreshed, 1, 'the bots are read again: the list is the server\'s');
  assert.deepEqual(p.bot.names(), ['bubble-row', 'status-line', 'chat-queued'], 'the waiting message the answer reports; no sent bubble and no working bubble of the page\'s own');
  assert.deepEqual(plain(p.doctor.queued), [{ id: 'q1', text: SECOND, attachments: [], at }]);
  assert.doesNotMatch(p.waiting(p.bot).innerHTML, /data-sent/);
  assert.equal(p.said.streams, 0, 'no stream on the id of a run that only waits');
  // The refresh brought the list: the same message, once.
  p.doctor.queued = [queued('q1', SECOND)];
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['bubble-row', 'status-line', 'chat-queued']);
  assert.equal((p.waiting(p.bot).innerHTML.match(/data-take-back=/g) || []).length, 1);
  const run = cut('async function runBot(botId', '// Every run of the bot that is going');
  assert.doesNotMatch(run, /EventSource|followBotRun|openRun|\/stream/);
});

test('web: a message sent to a replying Chief is drawn from the chat\'s list; no bubble, and no second stream', async () => {
  const p = page({ reply: async () => ({ id: 'c1', busy: true, messages: [], queued: [queued('q7', 'And the weather?')] }) });
  p.chief.thread.dataset.chat = 'c1';
  p.chief.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-me">ask</div>');
  p.ctx.chiefTurns.set('c1', '');
  p.state.chatStream = { close() { assert.fail('the reply that is going on stays followed'); } };
  p.boxes.chief.type('And the weather?');
  await p.boxes.chief.submit();
  assert.equal(p.boxes.chief.ta.value, '');
  assert.deepEqual(p.said.calls, ['POST /chief/chats/c1/messages']);
  assert.deepEqual(p.chief.names(), ['bubble-row', 'status-line', 'chat-queued'], 'what waits, from the answer\'s list; nothing else was added');
  assert.match(p.waiting(p.chief).innerHTML, /And the weather\?[\s\S]*Waits until the Chief is free/);
  assert.deepEqual(p.said.followed, [], 'no second stream');
  assert.deepEqual(p.said.shown, []);
});

test('web: a message that waits in a chat whose reply this page does not follow reads the chat, which follows it once', async () => {
  const p = page({ reply: async () => ({ id: 'c1', busy: true, messages: [], queued: [queued('q7', 'And the weather?')] }) });
  p.chief.thread.dataset.chat = 'c1';
  p.boxes.chief.type('And the weather?');
  await p.boxes.chief.submit();
  assert.deepEqual(p.said.shown, ['c1']);
  assert.deepEqual(p.said.followed, []);
  assert.deepEqual(p.chief.names(), [], 'showChat draws it');
});

test('web: a message the Chief takes at once is drawn as before, with the working line in place of a bubble', async () => {
  const p = page({ reply: async () => ({ id: 'c1', busy: true, messages: [], queued: [] }) });
  p.chief.thread.dataset.chat = 'c1';
  p.boxes.chief.type('Which bots ran last night?');
  await p.boxes.chief.submit();
  assert.deepEqual(p.chief.names(), ['mine', 'status-line'], 'the owner\'s message, then the line; the pending row is part of what was added');
  assert.match(p.chief.thread.children[0].html, /<div class="pending"><\/div>$/);
  assert.match(p.chief.thread.children[1].html, /<span>Thinking<\/span><button type="button" data-stop-chief="c1">Stop<\/button>/);
  assert.deepEqual(p.said.followed, ['c1']);
});

test('web: Take back puts the text and the files into the box again, ready to send', async () => {
  const files = [{ name: 'backup.log', file: 'uploads/backup.log', size: 2048, readable: true }];
  const p = page({ reply: async (path, opts) => (opts.method === 'DELETE' ? { text: SECOND, attachments: files } : { id: 'r2', status: 'running' }) });
  p.state.runs = [working];
  p.doctor.queued = [queued('q1', SECOND, files), queued('q2', 'And the weekly one.')];
  p.ctx.placeStatusLines();
  p.boxes.bot.type('typed meanwhile');
  const [back] = p.bot.find.$$('[data-take-back]', p.waiting(p.bot));
  await back.onclick();
  assert.deepEqual(p.said.calls, ['DELETE /bots/doctor/queued/q1']);
  assert.equal(p.boxes.bot.ta.value, `${SECOND}\ntyped meanwhile`, 'in front of what was typed since');
  assert.deepEqual(p.boxes.bot.files(), [['backup.log', 'ready']]);
  assert.match(p.boxes.bot.list.innerHTML, /backup\.log/, 'drawn in the attachment list');
  assert.equal(p.boxes.bot.line(), null);
  assert.deepEqual(plain(p.doctor.queued).map((q) => q.id), ['q2'], 'gone from the chat at once; the feed\'s list follows');
  assert.doesNotMatch(p.waiting(p.bot).innerHTML, /data-take-back="q1"/);
  assert.deepEqual(p.said.toasts, []);
  // Sent again it is a new message, with its files as botdot has them: nothing is uploaded again.
  p.boxes.bot.type(SECOND);
  await p.boxes.bot.submit();
  assert.deepEqual(p.said.calls.slice(1), ['POST /bots/doctor/run']);
  assert.deepEqual(plain(p.said.bodies[0].attachments), files);
  assert.equal(p.said.bodies[0].prompt, SECOND);
});

test('web: Take back in the Chief\'s chat calls its own route', async () => {
  const p = page({ reply: async () => ({ text: 'And the weather?', attachments: [] }) });
  p.chief.thread.dataset.chat = 'c1';
  p.ctx.chiefQueued.set('c1', [queued('q 7/x', 'And the weather?')]);
  p.ctx.placeStatusLines();
  await p.chief.find.$$('[data-take-back]', p.waiting(p.chief))[0].onclick();
  assert.deepEqual(p.said.calls, ['DELETE /chief/chats/c1/queued/q%207%2Fx'], 'the id is no part of the address');
  assert.equal(p.boxes.chief.ta.value, 'And the weather?');
  assert.equal(p.boxes.bot.ta.value, '', 'into the box of its own chat');
  assert.deepEqual(plain(p.ctx.queuedIn('chief:c1')), []);
});

test('web: a message taken back after its bot\'s chat was left is kept for that chat\'s box, not lost', async () => {
  const files = [{ name: 'backup.log', file: 'uploads/backup.log', size: 2048, readable: true }];
  let answer;
  const p = page({ reply: () => new Promise((resolve) => { answer = resolve; }) });
  p.doctor.queued = [queued('q1', SECOND, files)];
  p.ctx.placeStatusLines();
  const taking = p.bot.find.$$('[data-take-back]', p.waiting(p.bot))[0].onclick();
  // The owner opens another bot before botdot answers: the box on screen is that bot's.
  p.ctx.$('#view-bot').dataset.bot = 'coder';
  answer({ text: SECOND, attachments: files }); // botdot has taken the message away
  await taking;
  assert.equal(p.boxes.bot.ta.value, '', 'not into another bot\'s box');
  assert.deepEqual(p.said.toasts, []);
  // Back in Fleet Doctor's chat its box is built again, with the message and its file.
  const again = composer();
  p.ctx.wireComposer(again.form, async () => {}, () => 'bot:doctor');
  assert.equal(again.ta.value, SECOND);
  assert.deepEqual(again.files(), [['backup.log', 'ready']]);
  assert.equal(again.line(), null, 'it is no failed send: no line');
  // The Chief's chats share one box: a message taken back there is in it whichever chat is open.
  const c = page({ reply: async () => ({ text: 'And the weather?', attachments: [] }) });
  c.chief.thread.dataset.chat = 'c1';
  c.ctx.chiefQueued.set('c1', [queued('q7', 'And the weather?')]);
  c.ctx.placeStatusLines();
  const [back] = c.chief.find.$$('[data-take-back]', c.waiting(c.chief));
  c.state.chatId = 'c2';
  await back.onclick();
  assert.equal(c.boxes.chief.ta.value, 'And the weather?');
});

test('web: a message botdot took at once while the page still follows the reply before it reads the chat: no reply is left unshown', async () => {
  const p = page({ reply: async () => ({ id: 'c1', busy: true, messages: [], queued: [] }) });
  p.chief.thread.dataset.chat = 'c1';
  p.chief.thread.insertAdjacentHTML('beforeend', '<div class="bubble-row from-bot" data-pending></div>');
  p.state.chatStream = { close() {} }; // the first reply ended on the server; its end has not reached the page
  p.boxes.chief.type('And the weather?');
  await p.boxes.chief.submit();
  assert.deepEqual(p.said.shown, ['c1'], 'the chat as botdot has it: the first reply, the message, the new reply');
  assert.deepEqual(p.said.followed, [], 'showChat follows it');
  assert.deepEqual(p.chief.names(), ['bubble-row'], 'the page adds nothing of its own');
  assert.equal(p.boxes.chief.ta.value, '');
});

test('web: a message whose turn came first says "It has already started." above the box and shows what started', async () => {
  const p = page({ reply: async () => { throw refused('It has already started.', 409, { runId: 'q1' }); } });
  p.doctor.queued = [queued('q1', SECOND)];
  p.ctx.placeStatusLines();
  p.boxes.bot.type('typed meanwhile');
  await p.bot.find.$$('[data-take-back]', p.waiting(p.bot))[0].onclick();
  assert.equal(p.boxes.bot.line(), 'It has already started.');
  assert.equal(p.boxes.bot.ta.value, 'typed meanwhile', 'nothing is put into the box');
  assert.equal(p.said.refreshed, 1, 'the runs are read again: the run shows in the chat');
  assert.deepEqual(p.said.toasts, []);
  assert.equal(p.said.streams, 0);
  // The Chief's: the chat is read again, with the turn.
  p.chief.thread.dataset.chat = 'c1';
  p.ctx.chiefQueued.set('c1', [queued('q7', 'Later')]);
  p.ctx.placeStatusLines();
  await p.chief.find.$$('[data-take-back]', p.waiting(p.chief))[0].onclick();
  assert.equal(p.boxes.chief.line(), 'It has already started.');
  assert.deepEqual(p.said.shown, ['c1']);
  // The line goes with the next thing typed, as every line above the box.
  p.boxes.bot.type('x');
  assert.equal(p.boxes.bot.line(), null);
});

test('web: a take back botdot did not answer leaves the message waiting and says why; one that is gone reads the list again', async () => {
  let fail = Object.assign(new Error("Can't reach botdot."), { unreached: true });
  const p = page({ reply: async () => { throw fail; } });
  p.doctor.queued = [queued('q1', SECOND)];
  p.ctx.placeStatusLines();
  const [back] = p.bot.find.$$('[data-take-back]', p.waiting(p.bot));
  await back.onclick();
  assert.deepEqual(plain(p.said.toasts), [["Can't reach botdot.", true]]);
  assert.equal(back.disabled, false, 'it can be tried again');
  assert.equal(p.boxes.bot.ta.value, '');
  assert.deepEqual(plain(p.doctor.queued).map((q) => q.id), ['q1']);
  assert.equal(p.said.refreshed, 0);
  fail = refused('No such message.', 404);
  await back.onclick();
  assert.equal(p.said.refreshed, 1);
});

test('web: the eleventh message is refused with the server\'s sentence and stays in the box', async () => {
  const sentence = 'Fleet Doctor already has 10 of your messages waiting. Take one back, or wait.';
  const p = page({ reply: async () => { throw refused(sentence, 429); } });
  p.boxes.bot.type('One more');
  await p.boxes.bot.submit();
  assert.equal(p.boxes.bot.ta.value, 'One more');
  assert.equal(p.boxes.bot.line(), `Not sent: ${sentence} Your message is still here.`);
  assert.equal(p.said.refreshed, 0);
  assert.deepEqual(p.bot.names(), [], 'nothing is added to the chat');
  // The Chief's, the same way.
  p.chief.thread.dataset.chat = 'c1';
  p.boxes.chief.type('One more');
  await p.boxes.chief.submit();
  assert.equal(p.boxes.chief.line(), `Not sent: ${sentence} Your message is still here.`);
  assert.deepEqual(p.chief.names(), []);
});

test('web: the look: the same bubble at half strength, its line under it at the right, as a sent message\'s', () => {
  assert.match(css, /\.bubble\.from-me\.waits \{ opacity: \.5; \}/);
  assert.match(css, /\.chat-queued \{ display: flex; flex-direction: column; gap: 14px; \}/, 'the rows keep the chat\'s own distance');
  assert.match(css, /\.chat-thread \{[^}]*gap: 14px;/);
  assert.match(css, /\.bubble-row\.from-me \.bubble-meta \{ justify-content: flex-end; \}/);
  assert.match(css, /\.bubble-meta \{[^}]*flex-wrap: wrap;/, 'at phone width the line wraps under the bubble');
  assert.match(css, /\.stack\.mine \{ align-items: flex-end; max-width: 76%; \}/);
});

test('web: with `steer` a bot\'s waiting message has Steer beside Take back, and a steered one says "Steering…" with Take back alone (ADR 040)', async () => {
  const answers = [];
  const p = page({ features: ['message-waits', 'steer'], reply: async (path) => answers.shift()(path) });
  p.state.runs = [working];
  p.doctor.queued = [queued('q1', SECOND), queued('q2', 'Not steered')];
  p.ctx.placeStatusLines();
  let html = p.waiting(p.bot).innerHTML;
  assert.match(html, /<div class="bubble-meta"><span>Waits until Fleet Doctor is free<\/span><button type="button" data-steer="q1">Steer<\/button><button type="button" data-take-back="q1">Take back<\/button><\/div>/);
  // Pressed: the server's list comes back with it marked, and it is drawn so.
  answers.push(() => ({ queued: [{ ...queued('q1', SECOND), steering: true }, queued('q2', 'Not steered')] }));
  const [steer] = p.bot.find.$$('[data-steer]', p.waiting(p.bot));
  await steer.onclick();
  assert.deepEqual(p.said.calls.slice(-1), ['POST /bots/doctor/queued/q1/steer']);
  html = p.waiting(p.bot).innerHTML;
  assert.match(html, /<div class="bubble from-me waits">Also check that tonight&#39;s backup has enough room\.<\/div>\s*<div class="bubble-meta"><span>Steering…<\/span><button type="button" data-take-back="q1">Take back<\/button><\/div>/);
  assert.match(html, /<span>Waits until Fleet Doctor is free<\/span><button type="button" data-steer="q2">Steer<\/button>/, 'the other still waits, with its own Steer');
  assert.equal((html.match(/data-steer=/g) || []).length, 1);
  // Refused (the run can't take it, or it started): the server's sentence above the box, and the chat read again.
  answers.push(() => { throw refused("Fleet Doctor is working on a request of the Chief's. This starts when it is free.", 409); });
  await p.bot.find.$$('[data-steer]', p.waiting(p.bot))[0].onclick();
  assert.equal(p.boxes.bot.line(), "Fleet Doctor is working on a request of the Chief's. This starts when it is free.");
  assert.equal(p.said.refreshed, 1);
  // The Chief's chat has none from a server without `chief-steer`, and a bot's none from one without `steer`.
  p.chief.thread.dataset.chat = 'c1';
  p.ctx.chiefQueued.set('c1', [queued('q7', 'Later')]);
  p.ctx.placeStatusLines();
  assert.doesNotMatch(p.waiting(p.chief).innerHTML, /data-steer/);
  const old = page();
  old.doctor.queued = [{ ...queued('q1', SECOND), steering: true }];
  old.ctx.placeStatusLines();
  assert.match(old.waiting(old.bot).innerHTML, /<span>Waits until Fleet Doctor is free<\/span><button type="button" data-take-back="q1">Take back<\/button>/);
});

test('web: with `chief-steer` a Chief chat\'s waiting message has Steer too: pressed, it is marked; refused, the server\'s sentence and the chat read again', async () => {
  const answers = [];
  const p = page({ features: ['message-waits', 'chief-steer'], reply: async (path) => answers.shift()(path) });
  p.chief.thread.dataset.chat = 'c1';
  p.ctx.chiefTurns.set('c1', 'Thinking');
  p.ctx.chiefQueued.set('c1', [queued('q7', 'Also book the dentist')]);
  p.ctx.placeStatusLines();
  assert.match(p.waiting(p.chief).innerHTML, /<span>Waits until the Chief is free<\/span><button type="button" data-steer="q7">Steer<\/button><button type="button" data-take-back="q7">Take back<\/button>/);
  answers.push(() => ({ queued: [{ ...queued('q7', 'Also book the dentist'), steering: true }] }));
  await p.chief.find.$$('[data-steer]', p.waiting(p.chief))[0].onclick();
  assert.deepEqual(p.said.calls.slice(-1), ['POST /chief/chats/c1/queued/q7/steer']);
  assert.match(p.waiting(p.chief).innerHTML, /<span>Steering…<\/span><button type="button" data-take-back="q7">Take back<\/button>/);
  p.ctx.chiefQueued.set('c1', [queued('q8', 'One more')]);
  p.ctx.placeStatusLines();
  answers.push(() => { throw refused('Chief of Staff is answering something botdot brought it, not your message. This starts when it is free.', 409); });
  await p.chief.find.$$('[data-steer]', p.waiting(p.chief))[0].onclick();
  assert.equal(p.boxes.chief.line(), 'Chief of Staff is answering something botdot brought it, not your message. This starts when it is free.');
  assert.deepEqual(p.said.shown, ['c1'], 'the chat is read again');
  // A bot's chat keeps its own feature: without `steer`, no Steer there.
  p.state.runs = [working];
  p.doctor.queued = [queued('q1', SECOND)];
  p.ctx.placeStatusLines();
  assert.doesNotMatch(p.waiting(p.bot).innerHTML, /data-steer/);
});
