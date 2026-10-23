// New replies on the web page: public/unread.js loaded the way the browser loads it (a plain script, no
// module): the dots of a row, the "New" line and where it goes, how long the line stays, and the report
// of the chat on screen, the last one against a real botdot server. Scrolling and the look are checked
// by hand, in a browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer, makeBot, seedRuns, QUIET_RUN, BOT_TO_BOT_RUN, feed, waitFor } = require('./helpers');
const { webSource } = require('./web-source');

const PUBLIC = path.join(__dirname, '..', 'public');
const page = vm.createContext({ setInterval, clearInterval });
vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'unread.js'), 'utf8'), page);
const { Unread } = page;
const dotCount = (html) => (html.match(/<i><\/i>/g) || []).length;

test('web: the page gets it as window.Unread, before app.js', () => {
  assert.equal(typeof Unread.dots, 'function');
  assert.equal(page.module, undefined);
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/unread.js') > 0 && at('/unread.js') < at('/app.js'));
});

test('web: one dot per new reply, at most three, and never a number', () => {
  for (const [n, shown] of [[1, 1], [2, 2], [3, 3], [5, 3], [40, 3]]) {
    const html = Unread.dots(n, '#1d9e75');
    assert.equal(dotCount(html), shown, `${n} new`);
    assert.match(html, /^<span class="unread-dots" style="--c:#1d9e75" aria-label="New repl(y|ies)">(<i><\/i>)+<\/span>$/);
    assert.doesNotMatch(html.replace('#1d9e75', ''), /\d/, 'no number, in the text or the label');
  }
  assert.match(Unread.dots(1, '#1d9e75'), /aria-label="New reply"/);
  assert.match(Unread.dots(2, '#1d9e75'), /aria-label="New replies"/);
});

test('web: nothing new, or a server without the fields, draws no dot', () => {
  for (const n of [0, undefined, null, -1, 1.5, '2', NaN]) assert.equal(Unread.dots(n, '#1d9e75'), '', String(n));
  for (const bot of [{}, { unread: 0 }, { unread: null }, { unread: '3' }, undefined, null]) {
    assert.equal(Unread.count(bot), 0);
    assert.equal(Unread.dots(Unread.count(bot), '#1d9e75'), '');
  }
  assert.equal(Unread.count({ unread: 4, firstUnread: 'r1' }), 4, 'the count is the server\'s, not capped');
});

test('web: a colour that is not a colour never reaches the markup', () => {
  assert.match(Unread.dots(1, '#D85A30'), /--c:#D85A30"/);
  for (const bad of ['red;background:url(x)', '"><script>', '#12345', '#1234567g', '', undefined]) {
    assert.match(Unread.dots(1, bad), /style="--c:#888780"/);
    assert.match(Unread.line(bad), /style="--c:#888780"/);
  }
});

test('web: the line says "New", in the bot\'s colour', () => {
  assert.equal(Unread.line('#378add'), '<div class="new-line" style="--c:#378add">New</div>');
});

test('web: the line goes above the first new reply', () => {
  const line = Unread.line('#378add');
  const scheduled = { asked: '<chip>', reply: '<reply>', mine: false };
  assert.equal(Unread.exchange(scheduled, line), `${line}<chip><reply>`, 'above what started the run, when that is not yours');
  const asked = { asked: '<mine>', reply: '<reply>', mine: true };
  assert.equal(Unread.exchange(asked, line), `<mine>${line}<reply>`, 'below your own message');
  assert.equal(Unread.exchange(asked), '<mine><reply>', 'no line: the exchange as it was');
  assert.equal(Unread.exchange(scheduled, ''), '<chip><reply>');
});

test('web: in a Chief chat the line goes above the message the server named, or the next one drawn', () => {
  assert.equal(Unread.rowFrom([0, 1, 2, 3], 3), 3);
  assert.equal(Unread.rowFrom([0, 1, 2, 3], 0), 0);
  assert.equal(Unread.rowFrom([0, 1, 3, 4], 2), 2, 'message 2 draws no row: above message 3');
  assert.equal(Unread.rowFrom([0, 1], 2), -1, 'not drawn (the page added the rows itself): the chat is read again');
  assert.equal(Unread.rowFrom([], 0), -1);
  for (const first of [null, undefined, 'r1']) assert.equal(Unread.rowFrom([0, 1], first), -1);
});

test('web: the app draws the dots after the time, for a bot and for the Chief in coral', () => {
  const app = webSource();
  assert.match(app, /<span class="time">\$\{esc\(shortTime\(r\?\.startedAt\)\)\}<\/span>\$\{line\.after\}<\/div>/);
  assert.match(app, /after: asks \? Unread\.mark\(b\.color\) : Unread\.dots\(Unread\.count\(b\), b\.color\) \};/, 'the dots, or the mark of a bot that asks (contactLine, SURE-003)');
  assert.match(app, /<span class="time">\$\{esc\(shortTime\(chat\?\.updatedAt\)\)\}<\/span>\$\{Unread\.dots\(state\.chiefUnread, CHIEF_COLOR\)\}<\/div>/);
  assert.match(app, /const CHIEF_COLOR = '#d85a30';/);
  assert.match(app, /const bots = \[\.\.\.state\.bots\]\.sort\(byPlace\);/, 'the list keeps the owner\'s order');
  assert.doesNotMatch(app.match(/const byPlace = [^\n]*/)?.[0] || '', /unread/, 'new replies do not move a bot');
});

test('web: the line is placed when the chat comes on screen and stays until the chat is left', () => {
  const k = Unread.lineKeeper();
  assert.equal(k.open('bot:a'), false);
  assert.equal(k.arrive('bot:a', { unread: 2, firstUnread: 'r7' }), true);
  assert.equal(k.first('bot:a'), 'r7');
  assert.equal(k.takeJump(), true, 'scroll to it once');
  assert.equal(k.takeJump(), false);
  // The server now says the chat is read; the page was in the background and came back; a redraw happens.
  assert.equal(k.arrive('bot:a', { unread: 0, firstUnread: null }), false);
  assert.equal(k.open('bot:a'), false);
  assert.equal(k.first('bot:a'), 'r7', 'it does not move or go');
  assert.equal(k.first('bot:b'), null, 'another chat has none');
  // A reply came while the page was in the background: the line moves above it.
  assert.equal(k.arrive('bot:a', { unread: 1, firstUnread: 'r9' }), true);
  assert.equal(k.first('bot:a'), 'r9');
  assert.equal(k.takeJump(), true);
  // The owner leaves the chat.
  assert.equal(k.open('bot:b'), true, 'a line went: draw again');
  assert.equal(k.first('bot:a'), null);
  assert.equal(k.open(null), false);
});

test('web: a chat with nothing new, or a server without the fields, gets no line', () => {
  const k = Unread.lineKeeper();
  k.open('chief:c1');
  for (const model of [{ unread: 0, firstUnread: null }, {}, undefined, { unread: 2 }, { unread: 2, firstUnread: null }]) {
    assert.equal(k.arrive('chief:c1', model), false);
    assert.equal(k.first('chief:c1'), null);
  }
  assert.equal(k.arrive('chief:c1', { unread: 1, firstUnread: 0 }), true, 'the first message of a Chief chat is place 0');
  assert.equal(k.first('chief:c1'), 0);
});

// A reporter with a clock the test moves by hand.
function reporterWith(answer = { ok: true, repeatMs: 10_000 }) {
  const sent = [];
  const read = [];
  let tick = null;
  let ms = null;
  const r = Unread.reporter({
    app: 'web-test',
    post: async (body) => { sent.push(body.chat); if (answer instanceof Error) throw answer; return { ...answer, chat: body.chat }; },
    onRead: (chat) => read.push(chat),
    every: (fn, t) => { tick = fn; ms = t; return 1; },
    stop: () => { tick = null; },
  });
  return { r, sent, read, repeat: () => tick?.(), repeating: () => !!tick, ms: () => ms };
}

test('web: the report: the chat when it comes on screen, again every repeatMs, null when it is not', async () => {
  const t = reporterWith();
  assert.equal(t.r.show(null), null);
  assert.deepEqual(t.sent, [], 'nothing on screen and nothing was: nothing to say');
  await t.r.show('bot:a');
  assert.deepEqual(t.sent, ['bot:a']);
  assert.deepEqual(t.read, ['bot:a'], 'the server took it as read');
  assert.equal(t.ms(), 10_000);
  assert.equal(t.r.show('bot:a'), null, 'still the same chat: the repeat covers it');
  t.repeat();
  t.repeat();
  assert.deepEqual(t.sent, ['bot:a', 'bot:a', 'bot:a']);
  await t.r.show('chief:c1'); // another chat takes its place, without a null between
  await t.r.show(null); // the page is hidden
  assert.deepEqual(t.sent.slice(3), ['chief:c1', null]);
  assert.equal(t.repeating(), false, 'nothing repeats while no chat is on screen');
  assert.equal(t.r.show(null), null);
  assert.equal(t.r.again(), null, 'nothing on screen: nothing to say again');
  assert.equal(t.sent.length, 5);
  await t.r.show('bot:b');
  await t.r.again(); // the page got counts from before its report
  assert.deepEqual(t.sent.slice(5), ['bot:b', 'bot:b']);
  assert.deepEqual(t.read.slice(-2), ['bot:b', 'bot:b']);
});

test('web: the report follows the server\'s repeatMs and survives a lost connection', async () => {
  const fast = reporterWith({ ok: true, repeatMs: 4000 });
  await fast.r.show('bot:a');
  assert.equal(fast.ms(), 4000);
  const down = reporterWith(new Error('offline'));
  assert.equal(await down.r.show('bot:a'), null, 'no error reaches the page');
  assert.deepEqual(down.read, []);
  assert.equal(down.repeating(), true, 'the next repeat tries again');
  down.repeat();
  assert.deepEqual(down.sent, ['bot:a', 'bot:a']);
});

test('web: each page has an id of its own that the server accepts', () => {
  const a = Unread.appId();
  assert.match(a, /^web-[a-z0-9]{12}$/);
  assert.notEqual(a, Unread.appId());
});

test('the page\'s report reads the chat on the server, and a reply after it left is new again', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const live = await feed(srv);
  t.after(() => live.close());
  assert.ok((await srv.api('/version')).data.features.includes('unread'));
  const bot = await makeBot(srv);
  const chat = `bot:${bot.id}`;
  const unread = async () => { const b = (await srv.api(`/bots/${bot.id}`)).data; return [b.unread, b.firstUnread]; };
  const ask = async (prompt) => { const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } })).data; await srv.finished(run.id); return run.id; };
  const read = [];
  const web = Unread.reporter({
    app: Unread.appId(),
    post: async (body) => (await srv.api('/read', { method: 'POST', body })).data,
    onRead: (c, answer) => read.push([c, typeof answer.readAt]),
    every: () => 1,
    stop: () => {},
  });

  const first = await ask('one');
  await waitFor(async () => (await unread())[0] === 1, { what: 'the reply to count as new' });
  assert.deepEqual(await unread(), [1, first]);

  const answer = await web.show(chat); // the owner opens the chat, the page in front
  assert.equal(answer.ok, true);
  assert.equal(answer.chat, chat);
  assert.ok(answer.repeatMs > 0);
  assert.deepEqual(read, [[chat, 'string']]);
  assert.deepEqual(await unread(), [0, null]);
  const cleared = await live.wait('unread', (d) => d.chat === chat && d.unread === 0);
  assert.equal(cleared.data.firstUnread, null, 'every app hears that the dots go');

  await ask('two'); // the chat is on screen: read at once
  assert.deepEqual(await unread(), [0, null]);

  assert.deepEqual(await web.show(null), { ok: true, chat: null, repeatMs: answer.repeatMs }); // the page goes to the background
  const third = await ask('three');
  await waitFor(async () => (await unread())[0] === 1, { what: 'the reply after leaving to count as new' });
  assert.deepEqual(await unread(), [1, third]);
  assert.ok(live.events.some((e) => e.type === 'unread' && e.data.chat === chat && e.data.unread === 1 && e.data.firstUnread === third));
});

// ---------- a "New" line further back than the chat draws ----------

const runsOf = (...ids) => ids.map((id) => ({ id }));

test('web: a chat draws its newest 40 runs, and with a line every run back to it', () => {
  const runs = Array.from({ length: 70 }, (_, i) => ({ id: `r${70 - i}` })); // newest first: r70 … r1
  const ids = (x) => x.runs.map((r) => r.id);
  assert.equal(Unread.CHAT_RUNS, 40);
  assert.deepEqual(ids(Unread.shown(runs)), ids({ runs: runs.slice(0, 40) }));
  assert.equal(Unread.shown(runs).missing, false, 'no line: nothing to read');
  assert.equal(Unread.shown(runs, 'r60').runs.length, 40, 'a line among the newest 40 changes nothing');
  const back = Unread.shown(runs, 'r10');
  assert.equal(back.runs.length, 61);
  assert.equal(back.runs.at(-1).id, 'r10', 'the line\'s run is the oldest drawn');
  assert.equal(back.missing, false);
  const gone = Unread.shown(runs, 'r0');
  assert.deepEqual([gone.runs.length, gone.missing], [40, true], 'not among them: the newest, and it must be read');
  assert.deepEqual([Unread.shown([], 'r1').runs.length, Unread.shown([], 'r1').missing], [0, true]);
  assert.equal(Unread.shown(runs, undefined).missing, false);
});

test('web: older runs are read page by page until the line\'s run is there', async () => {
  const asked = [];
  const pages = { undefined: runsOf('r9', 'r8', 'r7'), r7: runsOf('r6', 'r5', 'r4'), r4: runsOf('r3', 'r2', 'r1'), r1: [] };
  const page = async (before) => { asked.push(before); return pages[before]; };
  assert.equal((await Unread.reach('r5', page)).map((r) => r.id).join(' '), 'r9 r8 r7 r6 r5 r4');
  assert.deepEqual(asked, [undefined, 'r7'], 'no further than needed');
  assert.equal(await Unread.reach('r0', page), null, 'a run that is gone: nothing older is left');
  assert.equal(await Unread.reach('r1', page, 2), null, 'further back than the pages it reads');
  assert.equal(await Unread.reach('r1', async () => runsOf('r9', 'r8')), null, 'a server that sends the newest again');
  assert.equal(await Unread.reach('r1', async () => null), null);
  await assert.rejects(Unread.reach('r1', async () => { throw new Error('offline'); }), /offline/);
});

test('web: the app draws a bot\'s chat back to its "New" line', () => {
  const app = webSource();
  // Back to its "New" line, else to the run its open question is from (test/asks-in-chat-web.test.js).
  assert.match(app, /const back = chatBack\(bot, newFirst\);\n\s*const drawn = Unread\.shown\(chatRuns\(bot\.id, back\), back\);\n\s*if \(drawn\.missing\) reachNew\(bot\.id, back\);\n\s*const runs = drawn\.runs\.reverse\(\);/);
  assert.match(app, /Unread\.reach\(first, page\)/);
  assert.match(app, /\/runs\?botId=\$\{encodeURIComponent\(botId\)\}&limit=200\$\{before \? `&before=\$\{encodeURIComponent\(before\)\}` : ''\}/);
  assert.doesNotMatch(app, /\.slice\(0, 40\)\.reverse\(\)/, 'no window of its own');
});

test('a reply the owner has not read, under more runs than the chat draws, is reached on the server', async (t) => {
  let srv = await startServer();
  t.after(() => srv.stop());
  const quiet = await makeBot(srv, { name: 'Quiet after' });
  const busy = await makeBot(srv, { name: 'Busy after' });
  await srv.stop();
  // One reply for the owner, then sixty scheduled runs with nothing to say; and one, then fifty bot-to-bot runs.
  const [reply] = seedRuns(srv, quiet, [{ result: 'Your parcel arrived.' }, { ...QUIET_RUN, times: 60 }]);
  const [answer] = seedRuns(srv, busy, [{ result: 'It rains at 5.' }, { ...BOT_TO_BOT_RUN, times: 50 }]);
  srv = await startServer({ dir: srv.dir });
  const bots = (await srv.api('/bots')).data;
  const of = (id) => { const b = bots.find((x) => x.id === id); return [b.unread, b.firstUnread]; };
  assert.deepEqual(of(quiet.id), [1, reply], 'the quiet runs after it are not new');
  assert.deepEqual(of(busy.id), [1, answer]);

  // As the page does it: the newest 200 of all bots, then this bot's older runs when the line is not among them.
  const held = (await srv.api('/runs?limit=200')).data;
  const page = (botId) => async (before) => (await srv.api(`/runs?botId=${botId}&limit=20${before ? `&before=${before}` : ''}`)).data;
  for (const [bot, first, others] of [[quiet, reply, 60], [busy, answer, 50]]) {
    const mine = held.filter((r) => r.botId === bot.id);
    assert.equal(mine.length, others + 1);
    const all = await Unread.reach(first, page(bot.id));
    assert.equal(all.length, others + 1, 'four pages of twenty');
    assert.equal(all.at(-1).id, first);
    const drawn = Unread.shown(all.filter((r) => !r.quiet), first);
    assert.equal(drawn.missing, false);
    assert.equal(drawn.runs.at(-1).id, first, 'the chat is drawn back to the new reply');
    assert.equal(drawn.runs.at(-1).result, bot === quiet ? 'Your parcel arrived.' : 'It rains at 5.');
  }
  // Bot-to-bot runs are drawn (folded), so the newest 40 alone would not hold the reply.
  const folded = held.filter((r) => r.botId === busy.id && !r.quiet);
  assert.equal(Unread.shown(folded.slice(0, 40), answer).missing, true);
  assert.equal(Unread.shown(folded, answer).runs.length, 51);
  // A run that is not this bot's is never reached.
  assert.equal(await Unread.reach(reply, page(busy.id)), null);
});

test('the Mac app: its Dock icon shows a dot while something waits for your OK, and none for a new reply', () => {
  const notifier = fs.readFileSync(path.join(__dirname, '..', 'macos', 'BotDot', 'App', 'Notifier.swift'), 'utf8');
  assert.match(notifier, /NSApp\.dockTile\.badgeLabel = needs\.isEmpty \? nil : "●"/);
  assert.match(notifier, /requestAuthorization\(options: \[\.alert, \.sound, \.badge\]\)/);
  assert.equal(notifier.match(/badgeLabel/g).length, 1, 'set from what waits, and nowhere else');
  assert.doesNotMatch(notifier, /\.badge = |content\.badge|c\.badge/, 'a notification carries no badge number');
});
