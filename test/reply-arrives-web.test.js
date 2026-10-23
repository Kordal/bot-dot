// A reply arrives, visibly, on the web page (ALV-008): which replies of an open chat count as new, and so move
// once. The page's own rule, cut out of public/app.js and run against stand-ins, with the cases of Android's
// ArrivalsTest. A reply is told by its id (the run's; the message's place in a Chief chat; the turn's in a group).
// Nothing is new when the chat opens, when its lists are read again and the chat's markup is built again, or when
// older messages are loaded. The owner's own message moves once, on Send, and not again when the server's version
// takes its place. With reduced motion asked for nothing moves. A group's rows: test/groups-web.test.js. How the
// movement looks is the owner's to judge on screen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, thread } = require('./web-page');
const { rulesOf, winner } = require('./css-rules');

const css = read('style.css');
const plain = (x) => JSON.parse(JSON.stringify(x));
const SECTION = ['// ---------- a reply arrives ----------', '// Stop a run.'];

// The rule alone. still: reduced motion is asked for.
function rule({ still = false, $ = () => null, $$ = () => [] } = {}) {
  const ctx = vm.createContext({ $, $$, reducedMotion: () => still });
  vm.runInContext(`${cut(...SECTION)}
    Object.assign(this, { newReplies, arrivalsKeeper, arrivals, botReplyIds, chiefReplyIds, repliesArrive, sentArrives, chiefArrives, arrive });`, ctx);
  return ctx;
}
// One open chat, drawn as the page draws it: its replies first, then the owner's message on its way (its key).
// What is new with that draw: the replies' ids, and "sent" for the owner's message.
function chat() {
  const a = rule().arrivalsKeeper();
  return { leave: () => a.leave(), draw: (id, replies, sent = null) => [...plain(a.replies(id, replies)), ...(a.sent(id, sent) ? ['sent'] : [])] };
}

// ---------- which replies are new ----------

test('web: opening a chat marks none of its replies as arriving', () => {
  assert.deepEqual(chat().draw('bot:doctor', ['r1', 'r2', 'r3']), []);
});

test('web: a reply whose id is new in the open chat arrives, once', () => {
  const c = chat();
  c.draw('bot:doctor', ['r1', 'r2']);
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2', 'r3']), ['r3'], 'the ones before it stand still');
  // Drawn again, as it is whenever the page draws: it is not new a second time.
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2', 'r3']), []);
});

test('web: a refresh of the lists marks none again', () => {
  const c = chat();
  c.draw('bot:doctor', ['r1', 'r2']);
  c.draw('bot:doctor', ['r1', 'r2', 'r3']);
  // The newest runs are read again and the chat's markup is built again: the same ids.
  for (let i = 0; i < 3; i++) assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2', 'r3']), []);
});

test('web: older messages loaded above do not arrive', () => {
  const c = chat();
  c.draw('bot:doctor', ['r5', 'r6']);
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']), []);
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']), ['r7'], 'and a reply that then comes at the end still does');
});

test('web: the first reply of a chat that opened empty arrives', () => {
  const c = chat();
  c.draw('bot:doctor', []);
  assert.deepEqual(c.draw('bot:doctor', ['r1']), ['r1']);
});

test('web: several replies that came together all arrive', () => {
  const c = chat();
  c.draw('group:g1', ['t1']);
  assert.deepEqual(c.draw('group:g1', ['t1', 't2', 't3']), ['t2', 't3']);
});

test('web: a chat read from scratch marks none', () => {
  const c = chat();
  c.draw('bot:doctor', ['r1', 'r2']);
  // More came than one look brings, and the chat started over: none of what it drew is among them.
  assert.deepEqual(c.draw('bot:doctor', ['r20', 'r21', 'r22']), []);
  assert.deepEqual(c.draw('bot:doctor', ['r20', 'r21', 'r22', 'r23']), ['r23']);
});

test('web: a reply that left and came back does not arrive again', () => {
  const c = chat();
  c.draw('bot:doctor', ['r1']);
  c.draw('bot:doctor', ['r1', 'r2']);
  c.draw('bot:doctor', ['r1']);
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2']), []);
});

test('web: the rule itself: the replies after the last one drawn, all in a chat that drew none, none when none of them is left', () => {
  const { newReplies } = rule();
  assert.deepEqual(plain(newReplies(new Set(['a', 'b']), ['a', 'b', 'c', 'd'])), ['c', 'd']);
  assert.deepEqual(plain(newReplies(new Set(), ['a', 'b'])), ['a', 'b']);
  assert.deepEqual(plain(newReplies(new Set(['a', 'b']), ['x', 'y'])), []);
  assert.deepEqual(plain(newReplies(new Set(['c']), ['a', 'b', 'c'])), [], 'what stands before the last one drawn was loaded above it');
});

// ---------- a chat that was left ----------

test('web: a chat that was left opens again with nothing new', () => {
  const c = chat();
  c.draw('bot:doctor', ['r1']);
  c.leave(); // another page of botdot, or the list over the chat on a phone
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2']), [], 'what came meanwhile is there when it opens');
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2', 'r3']), ['r3']);
});

test('web: another chat in the same place opens with nothing new, and so does the first one after it', () => {
  const c = chat();
  c.draw('bot:doctor', ['r1']);
  assert.deepEqual(c.draw('bot:mail', ['m1', 'm2']), []);
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2']), []);
});

test('web: a chat that is not on screen is left: nothing is marked in it, and it opens with nothing new', () => {
  const r = rule();
  const shown = { getClientRects: () => [{}] }, hidden = { getClientRects: () => [] };
  const a = r.arrivalsKeeper();
  assert.deepEqual(plain(r.repliesArrive(a, shown, 'bot:doctor', ['r1'])), []);
  assert.deepEqual(plain(r.repliesArrive(a, hidden, 'bot:doctor', ['r1', 'r2'])), [], 'drawn under the list, or under another page');
  assert.equal(r.sentArrives(a, hidden, 'bot:doctor', { key: 'k1' }), false);
  assert.deepEqual(plain(r.repliesArrive(a, shown, 'bot:doctor', ['r1', 'r2'])), [], 'back on screen: it opens');
  assert.deepEqual(plain(r.repliesArrive(a, shown, 'bot:doctor', ['r1', 'r2', 'r3'])), ['r3']);
  assert.deepEqual(plain(r.repliesArrive(a, null, 'bot:doctor', ['r1', 'r2', 'r3', 'r4'])), [], 'a chat that is not built has nothing to mark');
});

// ---------- the owner's own message ----------

test('web: the owner\'s message arrives on Send, and not again when the server\'s takes its place', () => {
  const c = chat();
  c.draw('bot:doctor', ['r1']);
  assert.deepEqual(c.draw('bot:doctor', ['r1'], 'k1'), ['sent']);
  // Still on its way: the same message, not new again.
  assert.deepEqual(c.draw('bot:doctor', ['r1'], 'k1'), []);
  // The server answered: its run r2 is in the chat, at work, and the local message is gone. Nothing arrives:
  // the run's own row is the message that already stood there.
  assert.deepEqual(c.draw('bot:doctor', ['r1']), []);
  // The run ended: its reply arrives.
  assert.deepEqual(c.draw('bot:doctor', ['r1', 'r2']), ['r2']);
});

test('web: a message that was on its way when the chat opened stands still', () => {
  assert.deepEqual(chat().draw('bot:doctor', ['r1'], 'k1'), []);
});

test('web: a failed message sent again arrives again', () => {
  const c = chat();
  c.draw('bot:doctor', []);
  c.draw('bot:doctor', [], 'k1');
  c.draw('bot:doctor', []); // it did not go, and is back in the message box
  // Sent again as it is: it has the same key, and comes into the chat once more.
  assert.deepEqual(c.draw('bot:doctor', [], 'k1'), ['sent']);
});

// ---------- the Chief's chats, which share one place ----------

test('web: a new Chief chat that got its id is the same chat', () => {
  const c = chat();
  c.draw(null, []); // a new chat: it has no id until the first message
  assert.deepEqual(c.draw(null, [], 'k1'), ['sent']);
  // The chat was made: the message keeps its one movement, and nothing is new.
  assert.deepEqual(c.draw('c1', [], 'k1'), []);
  assert.deepEqual(c.draw('c1', []), []);
  // The Chief's reply, the chat's second message, arrives.
  assert.deepEqual(c.draw('c1', ['1']), ['1']);
});

test('web: another Chief chat opens with nothing new', () => {
  const c = chat();
  c.draw('c1', ['1', '3']);
  // The plus: a new chat. Then an older chat, read from the server.
  assert.deepEqual(c.draw(null, []), []);
  assert.deepEqual(c.draw('c2', ['1', '3', '5']), []);
  assert.deepEqual(c.draw('c2', ['1', '3', '5', '7']), ['7']);
});

// ---------- what a reply is, in each chat ----------

test('web: a bot\'s replies are its runs that ended', () => {
  const { botReplyIds } = rule();
  // Oldest first, as the chat draws them. The run at work has no reply yet: its working line stands for it.
  const runs = [{ id: 'r1', status: 'success' }, { id: 'r2', status: 'error' }, { id: 'r3', status: 'running' }, { id: 'q1', status: 'queued' }];
  assert.deepEqual(plain(botReplyIds(runs)), ['r1', 'r2']);
  assert.deepEqual(plain(botReplyIds([...runs.slice(0, 2), { id: 'r3', status: 'stopped' }])), ['r1', 'r2', 'r3'], 'its reply came: also a run that was stopped says so in a reply');
});

test('web: a Chief chat\'s replies are by their place, and never the owner\'s or one still being written', () => {
  const { chiefReplyIds } = rule();
  const messages = [{ role: 'user', text: 'hi' }, { role: 'chief', text: 'Hello.' }, { role: 'report', text: 'Done.' }, { role: 'user', text: 'and now?' }, { role: 'chief', pending: true }];
  assert.deepEqual(plain(chiefReplyIds(messages, 10)), ['11', '12']);
  assert.deepEqual(plain(chiefReplyIds([...messages.slice(0, 4), { role: 'chief', text: 'Now this.' }], 10)), ['11', '12', '14']);
  assert.deepEqual(plain(chiefReplyIds([{ role: 'chief', text: 'Hello.' }])), ['0'], 'a chat that came whole starts at 0');
});

// ---------- the rows of the Chief's chat ----------

// The Chief's chat as showChat and followChief leave it: its rows, each the owner's (mine), a reply, or a reply
// that is still being written (pending). from: the place of its first row in the whole chat.
function chiefThread(rows, { id = 'c1', from = 0 } = {}) {
  const row = (kind) => element(kind === 'mine' ? { ':scope > .mine': element() } : {}, { dataset: kind === 'pending' ? { pending: '' } : {}, getClientRects: () => [{}] });
  const t = element({}, { _from: from, getClientRects: () => [{}], rows: [] });
  if (id) t.dataset.chat = id;
  t.querySelectorAll = (sel) => (sel === ':scope > .bubble-row' ? t.rows : []);
  t.put = (kinds) => { t.rows = kinds.map(row); return t; }; // the markup built again: every row is another element
  t.arriving = () => t.rows.map((r) => r.classList.contains('arrives'));
  return t.put(rows);
}
const finders = { $: (sel, root) => root.querySelector(sel), $$: (sel, root) => root.querySelectorAll(sel) };

test('web: in the Chief\'s chat the reply that was just written arrives, and nothing does on opening or when the chat is drawn again', () => {
  const r = rule(finders);
  const t = chiefThread(['mine', 'reply', 'mine', 'pending']);
  r.chiefArrives(t);
  assert.deepEqual(t.arriving(), [false, false, false, false], 'the chat opens: what is there stands still');
  // The reply is written: it stands in the place of the row that waited for it.
  const [a, b, c] = t.rows;
  t.rows = [a, b, c, t.put(['reply']).rows[0]];
  r.chiefArrives(t);
  assert.deepEqual(t.arriving(), [false, false, false, true], 'the whole reply row moves');
  // The chat is read again from the server and its markup is built again: the same places.
  t.put(['mine', 'reply', 'mine', 'reply']);
  r.chiefArrives(t);
  assert.deepEqual(t.arriving(), [false, false, false, false]);
  // The owner's next message as the server has it, and a reply that is still being written: neither arrives.
  t.put(['mine', 'reply', 'mine', 'reply', 'mine', 'pending']);
  r.chiefArrives(t);
  assert.deepEqual(t.arriving(), [false, false, false, false, false, false]);
});

test('web: a Chief chat that came in part counts its rows from where it begins', () => {
  const r = rule(finders);
  const t = chiefThread(['mine', 'reply'], { from: 40 });
  r.chiefArrives(t);
  // Read again, one message further on: the reply at place 41 was drawn, the one at 43 is new.
  t._from = 41;
  t.put(['reply', 'mine', 'reply']);
  r.chiefArrives(t);
  assert.deepEqual(t.arriving(), [false, false, true]);
});

test('web: another Chief chat in the same thread opens with nothing new, and one that is not on screen marks nothing', () => {
  const r = rule(finders);
  const t = chiefThread(['mine', 'reply']);
  r.chiefArrives(t);
  t.dataset.chat = 'c2';
  t.put(['mine', 'reply', 'mine', 'reply']);
  r.chiefArrives(t);
  assert.deepEqual(t.arriving(), [false, false, false, false]);
  // The owner is in a bot's chat while the Chief's reply ends: back in the Chief's chat it stands.
  t.getClientRects = () => [];
  t.put(['mine', 'reply', 'mine', 'reply', 'mine', 'reply']);
  r.chiefArrives(t);
  t.getClientRects = () => [{}];
  r.chiefArrives(t);
  assert.deepEqual(t.arriving(), [false, false, false, false, false, false]);
  r.chiefArrives(null); // the Chief's chat is not built yet
});

test('web: the Chief\'s chat marks its reply where it draws one: read from the server, written on its stream, and a bot\'s file', () => {
  const show = cut('async function showChat(id) {', '// Stop the Chief\'s reply in a chat');
  assert.match(show, /thread\._from = chat\.offset \|\| 0;/, 'the chat as it was read says where it begins');
  assert.ok(show.indexOf('thread.innerHTML = chat.messages') < show.indexOf('placeStatusLines();', show.indexOf('thread.innerHTML = chat.messages')), 'the rows are drawn, then looked at');
  const follow = cut('function followChief(id) {', '// ---------- a bot\'s conversation ----------');
  assert.match(follow, /row\.outerHTML = chiefBubble\(ev\.message, true\); placeStatusLines\(\);/, 'the reply in its row\'s place');
  assert.match(follow, /row\?\.insertAdjacentHTML\('beforebegin', reportBubble\(ev\.message\)\);[^\n]*\n\s*placeStatusLines\(\);/, 'a bot\'s file');
  assert.match(cut('function placeStatusLines() {', '// ---------- the sent message, there at once ----------'), /chiefArrives\(\$\('#chat-thread'\)\);/);
});

// ---------- the rows of a bot's chat ----------

test('web: in a bot\'s chat only the reply side of a run\'s row is marked, each time the chat is drawn', () => {
  const draw = cut('function renderBotChat() {', '// Rejects when the task did not go');
  // Outside the part that builds the markup again (two spaces in, not four): the chat tells what it draws every
  // time, as a chat on screen does.
  const built = draw.indexOf('thread.innerHTML = botThreadHTML(');
  const told = draw.indexOf('\n  for (const id of repliesArrive(arrivals.bot, thread, `bot:${bot.id}`, botReplyIds(runs)))');
  assert.ok(built > 0 && told > built && told < draw.lastIndexOf('placeStatusLines();'), 'after the rows are drawn, and before the owner\'s own message is looked at');
  // The reply's row is the one with its "Details": the row above it, with what started the run, is not touched.
  assert.match(draw, /arrive\(\$\(`\[data-details="\$\{CSS\.escape\(id\)\}"\]`, thread\)\?\.closest\('\.bubble-row'\)\);/);
});

// ---------- the owner's own message, in a bot's chat and the Chief's ----------

// A bot's chat and the Chief's as the page's placeStatusLines finds them. The box of the owner's message on its
// way holds one row (`[data-sent]`), a new one each time the box is filled.
function page() {
  const bot = thread(), chief = thread();
  for (const t of [bot.thread, chief.thread]) t.getClientRects = () => [{}];
  chief.thread.dataset.chat = 'c1';
  const doctor = { id: 'doctor', name: 'Fleet Doctor', color: '#c2473d', queued: [] };
  const state = { bots: [doctor], runs: [], chatId: 'c1' };
  const doc = { '#view-bot': { dataset: { bot: 'doctor' } }, '#bot-thread': bot.thread, '#chat-thread': chief.thread };
  const of = (root) => (root === chief.thread ? chief : bot);
  const box = () => {
    const n = bot.make();
    let html = '';
    Object.defineProperty(n, 'innerHTML', { get: () => html, set(v) { html = v; n.row = /data-sent/.test(v) ? element() : null; } });
    return n;
  };
  const lib = vm.createContext({});
  vm.runInContext(read('unread.js'), lib);
  vm.runInContext(read('opening-line.js'), lib);
  const ctx = vm.createContext({
    JSON, esc, state, Unread: lib.Unread, OpeningLine: lib.OpeningLine, openingLines: lib.OpeningLine.keeper(), CHIEF_BOT: { id: 'chief' }, CHIEF_COLOR: '#d85a30',
    chiefTurns: new Map(), chiefQueued: new Map(), reducedMotion: () => false,
    $: (sel, root) => (root === undefined ? doc[sel] ?? null : sel === '[data-sent]' ? root.row ?? null : of(root).find.$(sel, root)),
    $$: (sel, root) => of(root).find.$$(sel, root),
    document: { createElement: box }, botById: (id) => state.bots.find((b) => b.id === id), escMentions: (t) => esc(t), mentionSig: () => 'names',
    stopRun() {}, stopChief() {},
  });
  vm.runInContext(`${cut('const fmtSize = ', '// Files a bot attached to its reply')}
    ${cut('const chatParts = ', '// What the page knows about')}
    ${cut('// ---------- a message that waits ----------', '// ---------- a working bot\'s opening line ----------')}
    ${cut('function placeStatusLines() {', '// Stop a run.')}
    Object.assign(this, { placeStatusLines, sentAtOnce, sentOver, arrivals, repliesArrive });`, ctx);
  const one = (t, name) => t.thread.children.find((n) => n.className === name) || null;
  // A stand-in for renderBotChat: the chat tells which replies it draws, then places its end.
  const drawBot = (replies) => { ctx.repliesArrive(ctx.arrivals.bot, bot.thread, 'bot:doctor', replies); ctx.placeStatusLines(); };
  const moves = (t, name) => one(t, name)?.row?.classList.contains('arrives') ?? null;
  return { ctx, state, bot, chief, one, drawBot, moves };
}
const KEY = 'k'.repeat(32);

test('web: on Send the owner\'s bubble arrives in a bot\'s chat, once: not when the page draws again, not when the chat\'s markup is built again', () => {
  const p = page();
  p.drawBot(['r1']);
  p.ctx.sentAtOnce('bot:doctor', { key: KEY, text: 'Check the backup', attachments: [] });
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['chat-sent', 'status-line']);
  assert.equal(p.moves(p.bot, 'chat-sent'), true);
  // The page draws again while the message is on its way: the same row, marked once.
  const row = p.one(p.bot, 'chat-sent').row;
  p.drawBot(['r1']);
  assert.equal(p.one(p.bot, 'chat-sent').row, row, 'not drawn a second time');
  // A refresh builds the chat's markup again, and the box with it: the bubble is there, and does not arrive again.
  p.one(p.bot, 'chat-sent').remove();
  p.drawBot(['r1']);
  assert.equal(p.moves(p.bot, 'chat-sent'), false);
  // The server answered: the bubble is gone, and the run's reply arrives when it ends.
  p.ctx.sentOver('bot:doctor', KEY);
  p.ctx.placeStatusLines();
  assert.equal(p.one(p.bot, 'chat-sent'), null);
});

test('web: a message that was on its way when the bot\'s chat opened stands still', () => {
  const p = page();
  p.ctx.sentAtOnce('bot:doctor', { key: KEY, text: 'Check the backup', attachments: [] });
  p.drawBot(['r1']);
  assert.equal(p.moves(p.bot, 'chat-sent'), false);
});

test('web: sent to a working bot, the bubble arrives at the end, under the messages that wait', () => {
  const p = page();
  p.state.runs = [{ id: 'r2', botId: 'doctor', status: 'running', prompt: 'Earlier' }];
  p.drawBot(['r1']);
  p.ctx.sentAtOnce('bot:doctor', { key: KEY, text: 'And the disk?', attachments: [] });
  p.ctx.placeStatusLines();
  assert.deepEqual(p.bot.names(), ['status-line', 'chat-queued']);
  assert.equal(p.moves(p.bot, 'chat-queued'), true);
});

test('web: in the Chief\'s chat the owner\'s bubble arrives on Send, also the first message of a new chat', () => {
  const p = page();
  p.ctx.placeStatusLines(); // the chat is open
  p.ctx.sentAtOnce('chief:c1', { key: KEY, text: 'Who is free?', attachments: [] });
  p.ctx.placeStatusLines();
  assert.equal(p.moves(p.chief, 'chat-sent'), true);
  // A new chat: no id until the message went.
  const q = page();
  delete q.chief.thread.dataset.chat;
  q.state.chatId = null;
  q.ctx.placeStatusLines();
  q.ctx.sentAtOnce('chief:', { key: KEY, text: 'Hello', attachments: [] });
  q.ctx.placeStatusLines();
  assert.equal(q.moves(q.chief, 'chat-sent'), true);
});

// ---------- the movement ----------

test('web: the stylesheet has the arrival: one movement, a fade and a short rise, run once', () => {
  assert.match(css, /@keyframes arrive \{ from \{ opacity: 0; transform: translateY\(10px\); \} \}/);
  const rules = rulesOf(css.replace(/@media \(prefers-reduced-motion: reduce\) \{[^{}]*\{[^{}]*\}[^{}]*\}/g, '')); // as with motion allowed
  for (const classes of [['bubble-row', 'from-bot', 'arrives'], ['bubble-row', 'from-bot', 'g-row', 'arrives'], ['bubble-row', 'from-me', 'arrives']]) {
    const won = winner(rules, [{ tag: 'div', classes: ['chat-thread'] }, { tag: 'div', classes }], 'animation');
    assert.equal(won?.value, 'arrive var(--t3) var(--out)', classes.join('.'));
  }
  // A row that is not new has no movement at all.
  assert.equal(winner(rules, [{ tag: 'div', classes: ['chat-thread'] }, { tag: 'div', classes: ['bubble-row', 'from-bot'] }], 'animation'), null);
  assert.equal(app.split("classList.add('arrives')").length - 1, 1, 'one place marks a row');
});

test('web: with reduced motion asked for nothing moves: the stylesheet switches the arrival off, and the page marks no row', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.arrives \{ animation: none; \} \}/);
  // As a browser reads it with the setting on: the rule inside @media wins.
  for (const classes of [['bubble-row', 'from-bot', 'arrives'], ['bubble-row', 'from-me', 'arrives']]) {
    assert.equal(winner(rulesOf(css), [{ tag: 'div', classes: ['chat-thread'] }, { tag: 'div', classes }], 'animation')?.value, 'none');
  }
  const row = element();
  rule({ still: true }).arrive(row);
  assert.equal(row.classList.contains('arrives'), false);
  rule().arrive(row);
  assert.equal(row.classList.contains('arrives'), true);
  rule().arrive(null); // a row that is not there
});

test('web: a row that has arrived is a row like any other: its mark goes with the end of its movement', () => {
  const heard = {};
  const ctx = vm.createContext({ document: { addEventListener: (type, fn) => { heard[type] = fn; } } });
  vm.runInContext(cut('// An arrival is over', '// ---------- a message that waits ----------'), ctx);
  const row = element({}, { classes: ['bubble-row', 'arrives'] });
  // Another movement that ended inside it (a working line's dot) leaves it as it is.
  heard.animationend({ animationName: 'status-pulse', target: row });
  assert.equal(row.classList.contains('arrives'), true);
  heard.animationend({ animationName: 'arrive', target: row });
  assert.equal(row.classList.contains('arrives'), false, 'hidden and shown again, it does not move a second time');
});
