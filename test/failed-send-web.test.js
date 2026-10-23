// A send that failed on the web page (QW-001): the message box, the quick answers and the two senders cut
// out of public/app.js and run against stand-in elements. The text, the files and what was typed meanwhile
// are back in the box, the line above it says why in its wordings, a quick answer and a question card stay
// until their send went, and nothing is added to the chat. The real page with botdot stopped is walked in
// test/browser/failed-send.cjs.
// QW-008: every message carries a key, kept while it is sent again as it is and new once it is changed, a send
// botdot answers with `again` is a success, and one message goes at a time, from the box or from outside it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, element, finders, answer, esc } = require('./web-page');

const unreached = () => Object.assign(new Error("Can't reach botdot."), { unreached: true });
const refused = (said) => Object.assign(new Error(said), { status: 429, refused: true });
// The names of files, as an array of this side (the page's code runs in a context of its own).
const names = (files) => Array.from(files, (f) => f.name);

// A chat's message box as composerHTML draws it, wired by the page's own wireComposer.
function box(onSend, { secret = false } = {}) {
  const ta = element({}, { scrollHeight: 22 });
  const btn = element();
  const note = element({}, { classes: ['hidden'] });
  const list = element({}, { classes: ['hidden'] });
  const form = element({ '.send-btn': btn, '.send-note': note, '.attach-list': list, '.attach-btn': element() }, { text: ta, files: element() });
  const said = { toasts: [], confirms: [] };
  const ctx = vm.createContext({
    ...finders(), Math, String, Promise, Map, WeakSet, crypto: globalThis.crypto,
    toast: (...a) => said.toasts.push(a),
    confirm: (q) => { said.confirms.push(q); return true; },
    looksLikeSecret: () => secret,
    matchMedia: () => ({ matches: false }),
    fileChipHTML: (f) => `[${f.name}]`,
    fetch: () => assert.fail('nothing is uploaded here'),
  });
  vm.runInContext(`${cut('const messageKey = ', '// Copy a whole message')}
    ${cut('function wireAttachments(form, uploadTo)', '// "@" suggestions above the message box')}
    ${cut('function sendNoteText(err)', 'function setSendBusy(form, busy, onStop)')}
    this.wireComposer = wireComposer; this.sendNoteText = sendNoteText; this.sendFrom = sendFrom; this.withFailed = withFailed; this.withKey = withKey; this.messageKey = messageKey;`, ctx);
  ctx.wireComposer(form, onSend, () => 'chief');
  const submit = () => form.onsubmit({ preventDefault() {} });
  const type = (text) => { ta.value = text; ta.oninput(); };
  const attach = (...names) => names.forEach((name) => form._files.push({ key: name, name, file: `uploads/${name}`, size: 10, readable: true, status: 'ready' }));
  const line = () => (note.classList.contains('hidden') ? null : note.textContent);
  return { ctx, form, ta, btn, list, said, submit, type, attach, line, files: () => names(form._files) };
}

test('web: a message that goes leaves the box empty, with no line', async () => {
  const sent = [];
  const b = box(async (text, files) => { sent.push([text, names(files)]); });
  b.type('  File the invoices  ');
  b.attach('invoices.pdf');
  await b.submit();
  assert.deepEqual(sent, [['File the invoices', ['invoices.pdf']]]);
  assert.equal(b.ta.value, '');
  assert.deepEqual(b.files(), []);
  assert.equal(b.line(), null);
  assert.deepEqual(b.said.toasts, []);
});

test('web: a send that got no answer puts the text and the files back, ready to send, and says why above the box', async () => {
  const b = box(async () => { throw unreached(); });
  b.type('File the invoices');
  b.attach('invoices.pdf', 'notes.txt');
  await b.submit();
  assert.equal(b.ta.value, 'File the invoices');
  assert.deepEqual(b.files(), ['invoices.pdf', 'notes.txt']);
  assert.ok(b.form._files.every((f) => f.status === 'ready'), 'ready to send again, not uploaded again');
  assert.match(b.list.innerHTML, /\[invoices\.pdf\]\[notes\.txt\]/, 'and drawn in the attachment list');
  assert.ok(!b.list.classList.contains('hidden'));
  assert.equal(b.line(), "Not sent: can't reach botdot. Your message is still here.");
  assert.deepEqual(b.said.toasts, [], 'no toast for it');
  assert.equal(b.btn.disabled, false, 'Send works again');
});

test('web: a refusal says the server\'s sentence', async () => {
  const b = box(async () => { throw refused('The Chief already has 10 of your messages waiting here. Take one back, or wait.'); });
  b.type('And the overdue ones?');
  await b.submit();
  assert.equal(b.ta.value, 'And the overdue ones?');
  assert.equal(b.line(), 'Not sent: The Chief already has 10 of your messages waiting here. Take one back, or wait. Your message is still here.');
  assert.deepEqual(b.said.toasts, []);
});

test('web: the line\'s wordings', () => {
  const { ctx } = box(async () => {});
  assert.equal(ctx.sendNoteText(unreached()), "Not sent: can't reach botdot. Your message is still here.");
  assert.equal(ctx.sendNoteText(refused('The Chief already has 10 of your messages waiting here. Take one back, or wait.')), 'Not sent: The Chief already has 10 of your messages waiting here. Take one back, or wait. Your message is still here.');
  assert.equal(ctx.sendNoteText(refused('This bot is paused')), 'Not sent: This bot is paused. Your message is still here.', 'a sentence without its full stop gets one');
  assert.equal(ctx.sendNoteText(refused('Is Docker running?')), 'Not sent: Is Docker running? Your message is still here.');
  // An answer nobody can read the outcome from (a gateway that gave up waiting, a crash): the message may have arrived.
  assert.equal(ctx.sendNoteText(Object.assign(new Error("botdot couldn't do that (504)."), { status: 504, unsure: true })), 'It may have been sent: check the chat. Your message is still here.');
  assert.equal(ctx.sendNoteText(new Error('')), "Not sent: can't reach botdot. Your message is still here.");
});

test('web: what was typed while the failed request was under way stays: the failed text goes in front of it', async () => {
  let fail;
  const b = box(() => new Promise((_, reject) => { fail = reject; }));
  b.type('First message');
  b.attach('first.pdf');
  const sending = b.submit();
  assert.equal(b.ta.value, '', 'the box is free for the next message at once');
  b.type('Second, typed meanwhile');
  b.attach('second.pdf');
  fail(unreached());
  await sending;
  assert.equal(b.ta.value, 'First message\nSecond, typed meanwhile');
  assert.deepEqual(b.files(), ['first.pdf', 'second.pdf']);
  const { ctx } = b;
  assert.equal(ctx.withFailed('a', ''), 'a');
  assert.equal(ctx.withFailed('a', '  \n'), 'a', 'only spaces were typed: nothing to keep');
  assert.equal(ctx.withFailed('', 'typed'), 'typed', 'a message of files only');
});

test('web: the line stays until the owner edits or sends', async () => {
  let ok = false;
  const sent = [];
  const b = box(async (text, files) => { if (!ok) throw unreached(); sent.push([text, names(files)]); });
  b.type('File the invoices');
  await b.submit();
  assert.ok(b.line());
  b.type('File the invoices today');
  assert.equal(b.line(), null, 'edited');
  await b.submit();
  assert.ok(b.line(), 'failed again');
  ok = true;
  await b.submit();
  assert.equal(b.line(), null, 'sent');
  assert.deepEqual(sent, [['File the invoices today', []]]);
});

test('web: sending again delivers the message once, with its files', async () => {
  let ok = false;
  const sent = [];
  const b = box(async (text, files) => { if (!ok) throw unreached(); sent.push([text, names(files)]); });
  b.type('File the invoices');
  b.attach('invoices.pdf');
  await b.submit();
  ok = true;
  await b.submit();
  await b.submit(); // the box is empty now: nothing more goes
  assert.deepEqual(sent, [['File the invoices', ['invoices.pdf']]]);
  assert.equal(b.ta.value, '');
  assert.deepEqual(b.files(), []);
});

test('web: a second Send while the first is under way sends nothing', async () => {
  let done;
  const sent = [];
  const b = box((text) => { sent.push(text); return sent.length > 1 ? Promise.resolve() : new Promise((resolve) => { done = resolve; }); });
  b.type('One');
  const first = b.submit();
  assert.equal(b.btn.disabled, true);
  b.type('Two');
  await b.submit();
  assert.deepEqual(sent, ['One']);
  assert.equal(b.ta.value, 'Two', 'and it is not lost');
  done();
  await first;
  assert.equal(b.btn.disabled, false);
  await b.submit();
  assert.deepEqual(sent, ['One', 'Two']);
});

test('web: a bot\'s chat left while its send was under way: the failed message is said at once and is back in the box with that chat', async () => {
  let fail;
  const b = box(() => new Promise((_, reject) => { fail = reject; }));
  b.type('Fix the footer');
  b.attach('footer.png');
  const sending = b.submit();
  b.form.isConnected = false; // the owner opened another bot: this box was built again for it
  fail(unreached());
  await sending;
  assert.deepEqual(b.said.toasts, [["Not sent: can't reach botdot. Your message is still here.", true]]);
  // The box of the same chat, built again when the owner comes back.
  const ta = element({}, { scrollHeight: 22 });
  const note = element({}, { classes: ['hidden'] });
  const again = element({ '.send-btn': element(), '.send-note': note, '.attach-list': element(), '.attach-btn': element() }, { text: ta, files: element() });
  b.ctx.wireComposer(again, async () => {}, () => 'chief');
  assert.equal(ta.value, 'Fix the footer');
  assert.deepEqual(names(again._files), ['footer.png']);
  assert.equal(note.textContent, "Not sent: can't reach botdot. Your message is still here.");
  // Once: the next box of that chat starts empty.
  const third = element({ '.send-btn': element(), '.send-note': element(), '.attach-list': element(), '.attach-btn': element() }, { text: element({}, { scrollHeight: 22 }), files: element() });
  b.ctx.wireComposer(third, async () => {}, () => 'chief');
  assert.equal(third.text.value, '');
  // Another chat's box does not get it.
  const b2 = box(() => Promise.reject(unreached()));
  b2.type('x');
  const s2 = b2.submit();
  b2.form.isConnected = false;
  await s2;
  const other = element({ '.send-btn': element(), '.send-note': element(), '.attach-list': element(), '.attach-btn': element() }, { text: element({}, { scrollHeight: 22 }), files: element() });
  b2.ctx.wireComposer(other, async () => {}, () => 'bot:other');
  assert.equal(other.text.value, '');
});

test('web: a starter or plan approval tapped twice sends once, and the second tap draws no line', async () => {
  let done;
  let sends = 0;
  const b = box(async () => {});
  const send = () => { sends++; return new Promise((resolve) => { done = resolve; }); };
  const first = b.ctx.sendFrom(b.form, send);
  assert.equal(await b.ctx.sendFrom(b.form, send), false);
  assert.equal(b.line(), null);
  done();
  assert.equal(await first, true);
  assert.equal(sends, 1);
  assert.equal(await b.ctx.sendFrom(b.form, async () => {}), true, 'free again');
});

test('web: the password question still comes before a send, also when sending again', async () => {
  const b = box(async () => { throw unreached(); }, { secret: true });
  b.type('password: hunter2x');
  await b.submit();
  await b.submit();
  assert.equal(b.said.confirms.length, 2);
  assert.match(b.said.confirms[0], /^This looks like it contains a password\./);
});

// Quick answers and a question card as choicesHTML and questionsHTML draw them, wired by the page's wireChoices.
function answers(send) {
  const row = element();
  const buttons = ['Yes', 'No'].map((c) => element({}, { dataset: { choice: c }, closest: () => row }));
  row.querySelectorAll = () => buttons;
  const boxes = ['Which inbox?', 'From when?'].map((q) => element({}, { dataset: { q }, value: '', offsetHeight: 0, clientHeight: 0, scrollHeight: 0 }));
  const sendBtn = element({}, { disabled: true });
  const card = element({ textarea: boxes, button: sendBtn });
  const thread = element({ '[data-choice]': buttons, '.ask-card': [card] });
  const ctx = vm.createContext({ ...finders(), Math, matchMedia: () => ({ matches: false }), crypto: globalThis.crypto });
  vm.runInContext(`${cut('const messageKey = ', '// Copy a whole message')}\n${cut('function wireChoices(root, send)', 'const copyBtn = ')}\nthis.wireChoices = wireChoices;`, ctx);
  ctx.wireChoices(thread, send);
  return { row, buttons, card, boxes, sendBtn };
}

test('web: a quick answer goes only after its send went; after a send that failed the buttons are still there to use', async () => {
  const sent = [];
  let ok = false;
  const a = answers(async (t) => { sent.push(t); return ok; });
  await a.buttons[0].onclick();
  assert.deepEqual(sent, ['Yes']);
  assert.equal(a.row.removed, false, 'kept');
  assert.deepEqual(a.buttons.map((b) => b.disabled), [false, false], 'and usable');
  ok = true;
  await a.buttons[1].onclick();
  assert.deepEqual(sent, ['Yes', 'No']);
  assert.equal(a.row.removed, true);
});

test('web: a quick answer tapped twice sends once', async () => {
  let done;
  const sent = [];
  const a = answers((t) => { sent.push(t); return new Promise((resolve) => { done = resolve; }); });
  const tap = a.buttons[0].onclick();
  assert.deepEqual(a.buttons.map((b) => b.disabled), [true, true], 'off while the first is under way');
  done(true);
  await tap;
  assert.deepEqual(sent, ['Yes']);
});

// The answers of one reply (choicesHTML's `of`, #495), drawn and wired again as the chat is drawn again.
function replyAnswers() {
  const ctx = vm.createContext({ esc, $: () => null, $$: () => [], CSS: { escape: (s) => s }, crypto: globalThis.crypto, Map });
  vm.runInContext(`${cut('const messageKey = ', '// Copy a whole message')}\n${cut('// The text colour that reads best on a filled colour', '// Several questions at once ([[ask: …]])')}\n${cut('function wireChoices(root, send)', 'const copyBtn = ')}\nObject.assign(this, { wireChoices, choicesHTML });`, ctx);
  const draw = (send) => {
    const row = element({}, { hidden: false });
    row.dataset.of = 'run-1';
    const buttons = ['Yes', 'No'].map((c) => element({}, { dataset: { choice: c }, closest: () => row }));
    ctx.$$ = (sel, root) => (root === row ? buttons : root ? root.querySelectorAll(sel) : []);
    ctx.wireChoices(element({ '[data-choice]': buttons, '.ask-card': [] }), send);
    return { row, buttons };
  };
  return { ctx, draw };
}

test('web: a tapped answer goes at once, keeps its key when the chat is drawn again, and is not drawn again once it went', async () => {
  const { ctx, draw } = replyAnswers();
  const keys = [];
  let done;
  const send = (t, key) => { keys.push(key); return new Promise((resolve) => { done = resolve; }); };
  const html = () => ctx.choicesHTML(['Yes', 'No'], 0, '#7f77dd', 'run-1');
  assert.match(html(), /<div class="choices" data-of="run-1">/);
  const a = draw(send);
  const tap = a.buttons[0].onclick();
  assert.equal(a.row.hidden, true, 'gone at the tap');
  assert.match(html(), /<div class="choices" data-of="run-1" hidden>/, 'drawn again while it goes: hidden');
  done(false); // it failed
  await tap;
  assert.equal(a.row.hidden, false, 'back after a failed send');
  assert.deepEqual(a.buttons.map((b) => b.disabled), [false, false]);
  const b = draw(send); // the chat is drawn again
  const again = b.buttons[0].onclick();
  done(true);
  await again;
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], 'the same message: the same key');
  assert.equal(html(), '', 'answered: no buttons when it is drawn again');
  assert.match(ctx.choicesHTML(['Yes', 'No'], 0, '#7f77dd', 'run-2'), /data-of="run-2"/, 'another reply has its own');
});

test('web: a question card keeps its answers until its send went', async () => {
  const sent = [];
  let ok = false;
  const a = answers(async (t) => { sent.push(t); return ok; });
  a.boxes[0].value = 'Work';
  await a.sendBtn.onclick();
  assert.deepEqual(sent, ['Which inbox?\n→ Work\n\nFrom when?\n→ –']);
  assert.equal(a.card.removed, false);
  assert.equal(a.boxes[0].value, 'Work');
  assert.equal(a.sendBtn.disabled, false);
  ok = true;
  await a.sendBtn.onclick();
  assert.equal(a.card.removed, true);
  assert.equal(sent.length, 2);
});

test('web: a send from outside the box shows the same line above that chat\'s box, and tells whether it went', async () => {
  const b = box(async () => {});
  assert.equal(await b.ctx.sendFrom(b.form, async () => { throw refused('The Chief already has 10 of your messages waiting here. Take one back, or wait.'); }), false);
  assert.equal(b.line(), 'Not sent: The Chief already has 10 of your messages waiting here. Take one back, or wait. Your message is still here.');
  assert.equal(await b.ctx.sendFrom(b.form, async () => {}), true);
  assert.equal(b.line(), null);
  assert.deepEqual(b.said.toasts, []);
});

test('web: every quick answer, question card, starter and plan approval sends that way, in the Chief\'s chat and in a bot\'s', () => {
  // Each with the key of what was tapped (QW-008).
  assert.equal((app.match(/wireChoices\(thread, \(t, key\) => sendFrom\((form|\$\('#view-chief form'\)), \(\) => sendToChief\(t, \[\], key\)\)\);/g) || []).length, 2, 'the chat as opened, and the reply as it arrives');
  assert.match(app, /wireChoices\(thread, \(t, key\) => sendFrom\(\$\('form', root\), \(\) => runBot\(bot\.id, t, \[\], key\)\)\);/);
  assert.match(app, /b\.onclick = withKey\(\(key\) => sendFrom\(form, \(\) => sendToChief\(b\.textContent, \[\], key\)\)\)/);
  assert.match(app, /build\.onclick = withKey\(async \(key\) => \{ if \(await sendFrom\(form, \(\) => sendToChief\(PLAN_APPROVAL, \[\], key\)\)\) build\.closest\('\.suggestion-actions'\)\?\.remove\(\); \}\);/);
  assert.match(app, /wireComposer\(form, \(text, files, key\) => runBot\(bot\.id, text, files, key\), \(\) => `bot:\$\{bot\.id\}`, bot\.id\);/);
  const calls = [...app.matchAll(/(?<!function )\b(sendToChief|runBot)\(/g)].map((m) => app.slice(app.lastIndexOf('\n', m.index) + 1, app.indexOf('\n', m.index)));
  for (const line of calls) assert.match(line, /sendFrom\(|wireComposer\(/, `a send that can fail is caught: ${line.trim()}`);
  assert.match(app, /wireComposer\(\$\('form', root\), sendToChief, \(\) => 'chief', CHIEF_BOT\.id\);/);
});

// The two senders, with botdot's answers given per request.
function senders(reply) {
  const thread = element({}, { innerHTML: '<greeting>', insertAdjacentHTML(where, html) { thread.innerHTML += html; } });
  const form = element();
  const doc = element({ '#chat-thread': thread, '#bot-thread': thread, '#view-chief form': form });
  const calls = [];
  const bodies = []; // what each message was sent with
  const said = { toasts: [], refreshed: 0, followed: [], shown: [] };
  const ctx = vm.createContext({
    ...finders(doc), Promise, Object, crypto: globalThis.crypto,
    state: { chatId: null, chatNew: true, runs: [] }, console,
    api: async (path, opts = {}) => { calls.push(`${opts.method || 'GET'} ${path}`); if (opts.body) bodies.push(opts.body); return reply(path, opts); },
    showChat: async (id) => { said.shown.push(id); },
    toast: (...a) => said.toasts.push(a),
    refresh: async () => { said.refreshed++; },
    userBubble: (m) => `<me:${m.text}>`, chiefBubble: () => '<typing>',
    syncRead() {}, updateChatNeeds() {}, setSendBusy() {}, writeHash() {}, markMore() {}, stopChief() {},
    // What waits and the working line: test/message-waits-web.test.js and test/chief-line-web.test.js.
    queuedList: (list) => (Array.isArray(list) ? list : []), chiefTurns: new Map(), chiefQueued: new Map(), placeStatusLines() {},
    followChief: (id) => said.followed.push(id), loadChief: async () => {},
    // The message in the chat from Send until botdot answers: test/sent-at-once-web.test.js.
    sentAtOnce() {}, sentMoved() {}, sentOver() {}, showSent() {}, queuedIn: () => [], setQueued() {},
  });
  vm.runInContext(`${cut('const messageKey = ', '// Copy a whole message')}
    ${cut('async function sendToChief(text, attachments = [], key = messageKey())', 'function followChief(id)')}
    ${cut('async function runBot(botId, text, attachments = [], key = messageKey())', '// A bot\'s running run as it happens')}
    this.sendToChief = sendToChief; this.runBot = runBot;`, ctx);
  return { ctx, thread, calls, bodies, said };
}

test('web: a message the Chief\'s chat could not send adds nothing to the chat and rejects, without a toast', async () => {
  const s = senders(async (path) => { if (path.endsWith('/messages')) throw refused('The Chief already has 10 of your messages waiting here. Take one back, or wait.'); return { id: 'c1' }; });
  s.ctx.state.chatId = 'c1';
  s.ctx.state.chatNew = false;
  s.thread.dataset.chat = 'c1';
  s.thread.innerHTML = '<earlier>';
  await assert.rejects(s.ctx.sendToChief('hi'), /The Chief already has 10 of your messages waiting here\. Take one back, or wait\./);
  assert.equal(s.thread.innerHTML, '<earlier>');
  assert.deepEqual(s.said.toasts, []);
  assert.deepEqual(s.said.followed, []);
});

test('web: the first message of a new chat that fails leaves the empty chat as it was, and sending again uses the same chat', async () => {
  let up = false;
  const s = senders(async (path) => { if (path === '/chief/chats') return { id: 'c9' }; if (!up) throw unreached(); return {}; });
  await assert.rejects(s.ctx.sendToChief('hi'), /Can't reach botdot\./);
  assert.equal(s.thread.innerHTML, '<greeting>', 'nothing was added, nothing taken away');
  up = true;
  await s.ctx.sendToChief('hi');
  assert.deepEqual(s.calls, ['POST /chief/chats', 'POST /chief/chats/c9/messages', 'POST /chief/chats/c9/messages'], 'one chat, not two');
  assert.equal(s.thread.innerHTML, '<me:hi><typing>');
  assert.equal(s.thread.dataset.chat, 'c9');
  assert.deepEqual(s.said.followed, ['c9']);
});

test('web: a message that went is never given back: what the page draws after it cannot reject the send', async () => {
  const s = senders(async (path) => (path === '/chief/chats' ? { id: 'c1' } : {}));
  s.ctx.followChief = () => { throw new Error('a mistake of the page'); };
  s.ctx.console = { error() {} };
  await s.ctx.sendToChief('hi');
  assert.equal(s.thread.innerHTML, '<me:hi><typing>');
});

test('web: a gateway failing before any message was sent is "Not sent", not "may have been sent"', async () => {
  const s = senders(async () => { throw Object.assign(new Error("botdot couldn't do that (504)."), { status: 504, unsure: true }); });
  const e = await s.ctx.sendToChief('hi').then(() => null, (err) => err);
  assert.equal(e.unsure, false);
  const { ctx } = box(async () => {});
  assert.equal(ctx.sendNoteText(e), "Not sent: botdot couldn't do that (504). Your message is still here.");
});

test('web: no chat could be made: it rejects before any message is sent', async () => {
  const s = senders(async () => { throw unreached(); });
  await assert.rejects(s.ctx.sendToChief('hi'), /Can't reach botdot\./);
  assert.deepEqual(s.calls, ['POST /chief/chats']);
  assert.equal(s.ctx.state.chatId, null);
  assert.equal(s.thread.innerHTML, '<greeting>');
});

test('web: a task a bot\'s chat could not send rejects without a toast and without drawing the chat again', async () => {
  const s = senders(async () => { throw unreached(); });
  await assert.rejects(s.ctx.runBot('coder', 'Fix it', [{ name: 'a.txt' }]), /Can't reach botdot\./);
  assert.deepEqual(s.calls, ['POST /bots/coder/run']);
  assert.equal(s.said.refreshed, 0);
  assert.deepEqual(s.said.toasts, []);
  const ok = senders(async () => ({}));
  await ok.ctx.runBot('coder', 'Fix it');
  assert.equal(ok.said.refreshed, 1);
});

test('web: the box wired to the real senders keeps a failed message, in the Chief\'s chat and in a bot\'s', async () => {
  const s = senders(async () => { throw unreached(); });
  for (const send of [s.ctx.sendToChief, (text, files) => s.ctx.runBot('coder', text, files)]) {
    const b = box(send);
    b.type('File the invoices');
    b.attach('invoices.pdf');
    await b.submit();
    assert.equal(b.ta.value, 'File the invoices');
    assert.deepEqual(b.files(), ['invoices.pdf']);
    assert.equal(b.line(), "Not sent: can't reach botdot. Your message is still here.");
  }
  assert.equal(s.thread.innerHTML, '<greeting>');
});

// QW-006: the page's own api() behind the box, answered as a gateway in front of botdot answers.
function reaching(reply) {
  const awayLine = element({}, { classes: ['hidden'] });
  const doc = element({ '.away-line': [awayLine] });
  const ctx = vm.createContext({ ...finders(doc), fetch: (...a) => reply.now(...a), JSON, Object, Error, Promise });
  vm.runInContext(`${cut('const away = { on: false };', 'function esc(s)')}\nthis.api = api;`, ctx);
  const send = (text) => ctx.api('/chief/chats/c1/messages', { method: 'POST', body: { text } });
  return { send, api: ctx.api, away: () => !awayLine.classList.contains('hidden') };
}

test('web: a send answered by a gateway that botdot is not there (502, 503) reads "Not sent", with the text and the files back', async () => {
  for (const status of [502, 503]) {
    for (const body of [undefined, {}]) {
      const b = box(reaching({ now: answer(status, body) }).send);
      b.type('File the invoices');
      b.attach('invoices.pdf');
      await b.submit();
      assert.equal(b.line(), "Not sent: can't reach botdot. Your message is still here.", String(status));
      assert.equal(b.ta.value, 'File the invoices');
      assert.deepEqual(b.files(), ['invoices.pdf']);
      assert.deepEqual(b.said.toasts, []);
    }
  }
});

test('web: a send answered with 504 or another 5xx without botdot\'s sentence still reads "It may have been sent"', async () => {
  for (const [status, body] of [[504, undefined], [504, {}], [500, undefined], [500, {}], [501, {}]]) {
    const b = box(reaching({ now: answer(status, body) }).send);
    b.type('File the invoices');
    b.attach('invoices.pdf');
    await b.submit();
    assert.equal(b.line(), 'It may have been sent: check the chat. Your message is still here.', String(status));
    assert.equal(b.ta.value, 'File the invoices');
    assert.deepEqual(b.files(), ['invoices.pdf']);
  }
});

test('web: a send refused with botdot\'s own sentence reads it, whatever the status', async () => {
  for (const status of [429, 409, 500, 502, 503, 504]) {
    const b = box(reaching({ now: answer(status, { error: 'The Chief already has 10 of your messages waiting here. Take one back, or wait.' }) }).send);
    b.type('And the overdue ones?');
    await b.submit();
    assert.equal(b.line(), 'Not sent: The Chief already has 10 of your messages waiting here. Take one back, or wait. Your message is still here.', String(status));
  }
});

test('web: after a send a gateway refused, "Can\'t reach botdot. Trying again…" shows once the "Not sent" line is gone, until a request succeeds', async () => {
  const reply = { now: answer(502, undefined) };
  const r = reaching(reply);
  const b = box(r.send);
  b.type('File the invoices');
  await b.submit();
  assert.equal(b.line(), "Not sent: can't reach botdot. Your message is still here.");
  assert.equal(r.away(), true, 'botdot is away: its line is drawn, and stands back while the "Not sent" line shows');
  assert.match(read('style.css'), /\.away-line:has\(~ \.send-note:not\(\.hidden\)\) \{ display: none; \}/);
  const composer = cut('function composerHTML(placeholder', '// Files attached in a composer');
  assert.ok(composer.indexOf('away-line') < composer.indexOf('send-note'), 'the away line comes before the "Not sent" line, as that rule needs');
  b.type('File the invoices, please');
  assert.equal(b.line(), null, 'the owner edited: the "Not sent" line is gone');
  assert.equal(r.away(), true, 'and the away line shows');
  await b.submit();
  assert.equal(r.away(), true, 'sent again with botdot still away');
  b.type('File the invoices, please');
  reply.now = answer(200, {});
  await b.submit();
  assert.equal(b.line(), null);
  assert.equal(r.away(), false, 'a request succeeded: the away line goes');
});

test('web: the line is above the box, in the warning colour', () => {
  const composer = cut('function composerHTML(placeholder', '// Files attached in a composer');
  assert.match(composer, /<div class="send-note hidden" role="status"><\/div>\s*<div class="attach-list hidden"><\/div>\s*<div class="composer-box">/);
});

// ---------- QW-008: a message's key ----------

const KEY = /^[A-Za-z0-9_-]{8,64}$/;
// A box whose sends are recorded with their keys; fails while `down`.
function keyed() {
  const sent = [];
  const state = { down: true };
  const b = box(async (text, files, key) => { sent.push({ text, files: names(files), key }); if (state.down) throw unreached(); });
  return { b, sent, state, keys: () => sent.map((x) => x.key) };
}

test('web: every typed message carries a key, a new one for each message', async () => {
  const { b, state, keys } = keyed();
  state.down = false;
  for (const text of ['One', 'Two', 'One']) { b.type(text); await b.submit(); }
  assert.equal(keys().length, 3);
  for (const key of keys()) assert.match(key, KEY, 'a key the server takes');
  assert.equal(new Set(keys()).size, 3, 'the same words sent later are another message');
});

test('web: a message put back after a failed send keeps its key until it went', async () => {
  const { b, sent, state, keys } = keyed();
  b.type('File the invoices');
  b.attach('invoices.pdf');
  await b.submit();
  await b.submit(); // again, as it is: still down
  state.down = false;
  await b.submit();
  assert.deepEqual(sent.map((x) => [x.text, x.files]), Array(3).fill(['File the invoices', ['invoices.pdf']]));
  assert.equal(new Set(keys()).size, 1, 'one message, one key, however often it is sent');
  // It went: the next message, with the same words, is a new one.
  b.type('File the invoices');
  await b.submit();
  assert.notEqual(keys()[3], keys()[0]);
});

test('web: a changed text is a new message with a new key, also when it is changed back', async () => {
  const { b, keys } = keyed();
  b.type('File the invoices');
  await b.submit();
  b.type('File the invoices today');
  await b.submit();
  assert.notEqual(keys()[1], keys()[0], 'edited');
  b.type('File the invoices');
  b.type('File the invoices today'); // as it failed last, but typed again: the owner may have seen it arrive
  await b.submit();
  assert.equal(new Set(keys()).size, 3);
  await b.submit();
  assert.equal(keys()[3], keys()[2], 'and untouched it keeps its key');
});

test('web: other files make a new message; what was typed while it was sent, too', async () => {
  const { b, keys } = keyed();
  b.attach('a.pdf');
  await b.submit(); // files only
  b.form._files = []; // the owner took the file off
  b.attach('b.pdf');
  await b.submit();
  assert.notEqual(keys()[1], keys()[0], 'another file under the same (empty) text is not the message botdot may have');
  await b.submit();
  assert.equal(keys()[2], keys()[1]);
  b.attach('c.pdf');
  await b.submit();
  assert.notEqual(keys()[3], keys()[2], 'one more file');

  let fail;
  const sent = [];
  const slow = box((text, files, key) => { sent.push(key); return new Promise((_, reject) => { fail = reject; }); });
  slow.type('First message');
  const sending = slow.submit();
  slow.type('Second, typed meanwhile');
  fail(unreached());
  await sending;
  assert.equal(slow.ta.value, 'First message\nSecond, typed meanwhile');
  slow.submit();
  assert.notEqual(sent[1], sent[0], 'the two together are a new message');
});

test('web: a message that failed after its chat was left comes back with its key; two that wait together are a new message', async () => {
  let fail;
  const sent = [];
  const record = (text, files, key) => { sent.push({ text, key }); return new Promise((_, reject) => { fail = reject; }); };
  const b = box(record);
  b.type('Fix the footer');
  const sending = b.submit();
  b.form.isConnected = false;
  fail(unreached());
  await sending;
  const rebuilt = (onSend) => {
    const ta = element({}, { scrollHeight: 22 });
    const form = element({ '.send-btn': element(), '.send-note': element(), '.attach-list': element(), '.attach-btn': element() }, { text: ta, files: element() });
    b.ctx.wireComposer(form, onSend, () => 'chief');
    return { form, ta, submit: () => form.onsubmit({ preventDefault() {} }) };
  };
  const again = rebuilt(record);
  assert.equal(again.ta.value, 'Fix the footer');
  const second = again.submit();
  assert.deepEqual(sent.map((x) => x.text), ['Fix the footer', 'Fix the footer']);
  assert.equal(sent[1].key, sent[0].key, 'the same message, from the box built again');
  // It fails again with the box gone, and another message from that box fails after it: both wait for that chat.
  again.form.isConnected = false;
  fail(unreached());
  await second;
  again.ta.value = 'And the header';
  again.ta.oninput();
  const third = again.submit();
  fail(unreached());
  await third;
  const both = rebuilt(record);
  assert.equal(both.ta.value, 'And the header\nFix the footer');
  both.submit();
  assert.deepEqual(sent.map((x) => x.text), ['Fix the footer', 'Fix the footer', 'And the header', 'And the header\nFix the footer']);
  assert.equal(new Set(sent.map((x) => x.key)).size, 3, 'the two together are a new message');
});

test('web: a quick answer keeps its key while it is drawn; each answer has its own', async () => {
  const sent = [];
  let ok = false;
  const a = answers(async (t, key) => { sent.push([t, key]); return ok; });
  await a.buttons[0].onclick();
  await a.buttons[0].onclick();
  await a.buttons[1].onclick();
  assert.match(sent[0][1], KEY);
  assert.equal(sent[1][1], sent[0][1], 'tapped again after a failed send: the same message');
  assert.notEqual(sent[2][1], sent[0][1], 'another answer is another message');
  // Drawn again (a new reply with the same answers): new messages.
  const next = answers(async (t, key) => { sent.push([t, key]); return true; });
  await next.buttons[0].onclick();
  assert.notEqual(sent[3][1], sent[0][1]);
});

test('web: a question card keeps its key until an answer changes', async () => {
  const sent = [];
  const a = answers(async (t, key) => { sent.push(key); return false; });
  a.boxes[0].value = 'Work';
  await a.sendBtn.onclick();
  await a.sendBtn.onclick();
  assert.match(sent[0], KEY);
  assert.equal(sent[1], sent[0]);
  a.boxes[1].value = 'Last week';
  await a.sendBtn.onclick();
  assert.notEqual(sent[2], sent[0], 'changed answers are a new message');
});

test('web: a starter and the plan approval keep one key for as long as their button is drawn', async () => {
  const { ctx } = box(async () => {});
  const keys = [];
  const tap = ctx.withKey((key) => { keys.push(key); });
  tap(); tap();
  assert.match(keys[0], KEY);
  assert.equal(keys[1], keys[0]);
  ctx.withKey((key) => { keys.push(key); })();
  assert.notEqual(keys[2], keys[0], 'drawn again: a new message');
});

test('web: the Chief\'s chat and a bot\'s chat send the key with the message, and one of their own when none is given', async () => {
  const s = senders(async (path) => (path === '/chief/chats' ? { id: 'c1' } : {}));
  await s.ctx.sendToChief('hi', [], 'typed-message-key');
  await s.ctx.runBot('coder', 'Fix it', [], 'typed-message-key');
  assert.deepEqual(JSON.parse(JSON.stringify(s.bodies)), [{ text: 'hi', attachments: [], key: 'typed-message-key' }, { prompt: 'Fix it', attachments: [], key: 'typed-message-key' }]);
  await s.ctx.sendToChief('hi');
  await s.ctx.runBot('coder', 'Fix it');
  assert.match(s.bodies[2].key, KEY);
  assert.match(s.bodies[3].key, KEY);
  assert.notEqual(s.bodies[2].key, s.bodies[3].key);
});

test('web: a send botdot answers with "again" is a success: the box empties and the chat is read from botdot, the message in it once', async () => {
  let lost = true;
  // botdot takes the message, its answer is lost; sent again, botdot says it has it.
  const s = senders(async (path) => { if (!path.endsWith('/messages') && !path.endsWith('/run')) return { id: 'c1' }; if (lost) { lost = false; throw unreached(); } return { id: 'c1', again: true }; });
  s.ctx.state.chatId = 'c1';
  s.ctx.state.chatNew = false;
  s.thread.dataset.chat = 'c1';
  s.thread.innerHTML = '<earlier>';
  const b = box(s.ctx.sendToChief);
  b.type('File the invoices');
  await b.submit();
  assert.equal(b.line(), "Not sent: can't reach botdot. Your message is still here.");
  await b.submit();
  assert.equal(b.ta.value, '', 'the box is emptied');
  assert.equal(b.line(), null);
  assert.equal(s.bodies[1].key, s.bodies[0].key, 'sent again with its key');
  assert.deepEqual(s.said.shown, ['c1'], 'the chat as botdot has it');
  assert.equal(s.thread.innerHTML, '<earlier>', 'and no second bubble drawn beside it');

  // A bot's chat is read from botdot after every send.
  lost = true;
  const bot = box((text, files, key) => s.ctx.runBot('coder', text, files, key));
  bot.type('Fix it');
  await bot.submit();
  await bot.submit();
  assert.equal(bot.ta.value, '');
  assert.equal(bot.line(), null);
  assert.equal(s.said.refreshed, 1);
  assert.equal(s.bodies[3].key, s.bodies[2].key);
});

test('web: one message goes at a time: a quick answer tapped while a typed message is sent waits for it, and a Send while an answer is sent', async () => {
  let done;
  const sent = [];
  const b = box((text) => { sent.push(text); return new Promise((resolve) => { done = resolve; }); });
  b.type('A typed message');
  const typed = b.submit();
  // The quick answers of that chat send through the same form.
  const a = answers((t) => b.ctx.sendFrom(b.form, async () => { sent.push(t); }));
  await a.buttons[0].onclick();
  assert.deepEqual(sent, ['A typed message'], 'the tap sent nothing');
  assert.equal(a.row.removed, false, 'and the answers are still there');
  assert.deepEqual(a.buttons.map((x) => x.disabled), [false, false]);
  assert.equal(b.line(), null, 'no line for it');
  done();
  await typed;
  await a.buttons[0].onclick();
  assert.deepEqual(sent, ['A typed message', 'Yes']);
  assert.equal(a.row.removed, true);

  // The other way round: an answer on its way, and Send in the box.
  let went;
  const tap = b.ctx.sendFrom(b.form, () => new Promise((resolve) => { went = resolve; }));
  b.type('Typed meanwhile');
  await b.submit();
  assert.deepEqual(sent, ['A typed message', 'Yes']);
  assert.equal(b.ta.value, 'Typed meanwhile', 'kept in the box');
  went();
  assert.equal(await tap, true);
  const last = b.submit();
  done();
  await last;
  assert.deepEqual(sent, ['A typed message', 'Yes', 'Typed meanwhile']);
});

test('web: a 5xx without botdot\'s sentence while a new chat is made: "can\'t reach" for 502 and 503, the status otherwise', async () => {
  for (const [status, line] of [[502, "Not sent: can't reach botdot. Your message is still here."], [503, "Not sent: can't reach botdot. Your message is still here."],
    [500, "Not sent: botdot couldn't do that (500). Your message is still here."], [504, "Not sent: botdot couldn't do that (504). Your message is still here."]]) {
    const s = senders(async () => assert.fail('the page\'s own api() answers'));
    s.ctx.api = reaching({ now: answer(status, undefined) }).api;
    const b = box(s.ctx.sendToChief);
    b.type('hi');
    await b.submit();
    assert.equal(b.line(), line, String(status));
    assert.equal(b.ta.value, 'hi');
  }
});
