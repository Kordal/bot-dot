// What a yes on an ask starts (lib/asks.js whatCarriesOn, ADR 009): the rules as one pure function, which the
// card's `then`, the yes and the queued work all ask.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { whatCarriesOn, chatsTakenUp, thenOf, starterOf } = require('../lib/asks');

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const ago = (minutes) => new Date(NOW - minutes * 60e3).toISOString();
const bot = { id: 'b1', name: 'Coder', jobs: [] };
// A run of the bot that started 10 minutes ago, and the ask it made a minute later, which keeps it. A run that
// joined the ask later says when (askedAt); `made` moves the moment the ask was made.
const run = (fields = {}) => ({ id: 'r1', botId: 'b1', trigger: 'manual', status: 'success', prompt: 'Check the PRs', startedAt: ago(10), ...fields });
const askOf = (runs, made = ago(9)) => ({ kind: 'permission', botId: 'b1', permission: 'commands', at: made, runs: runs.map((r) => ({ id: r.id, at: r.askedAt || made })) });
const facts = (runs, { made, ...more } = {}) => ({ ask: askOf(runs, made), bot, stopped: Object.fromEntries(runs.map((r) => [r.id, r])), now: NOW, ...more });
const who = (found) => found.map((f) => `${f.who}:${f.run.id}`);

test('who started a run decides what follows', () => {
  assert.equal(starterOf(run()), 'owner');
  assert.equal(starterOf(run({ startedBy: 'chief' })), 'chief');
  assert.equal(starterOf(run({ trigger: 'bot', fromBot: { id: 'b2', name: 'Asker' } })), 'teammate');
  assert.equal(starterOf(run({ trigger: 'schedule', jobId: 'j1' })), 'job');
  assert.equal(starterOf(run({ trigger: 'manual', jobId: 'j1' })), 'job', '"Run now"');
  for (const other of [{ trigger: 'replies' }, { trigger: 'review', jobId: 'memory-review' }, { trigger: 'bot' }, { trigger: 'schedule' }]) assert.equal(starterOf(run(other)), null);
  assert.equal(starterOf(null), null);
});

test("an owner's run carries on, and its card says with what", () => {
  const found = whatCarriesOn(facts([run()]));
  assert.deepEqual(who(found), ['owner:r1']);
  assert.deepEqual(thenOf(found), { who: 'bot', text: 'It carries on with “Check the PRs” when you allow it.' });
  const long = thenOf(whatCarriesOn(facts([run({ prompt: `Find\n  every ${'very '.repeat(30)}long thing` })])));
  const quoted = long.text.match(/“(.*)”/)[1];
  assert.equal(quoted.length, 80, 'the request is clipped to 80 characters');
  assert.ok(quoted.startsWith('Find every very') && quoted.endsWith('…'), 'in one line, with …');
  assert.equal(thenOf([]), null);
});

test('an ask with no run, or with a run that is no longer found, only changes the setting', () => {
  assert.deepEqual(whatCarriesOn({ ask: { kind: 'permission', botId: 'b1', permission: 'web', at: ago(9) }, bot, now: NOW }), []);
  assert.deepEqual(whatCarriesOn({ ...facts([run()]), stopped: {} }), [], 'its record is gone');
  assert.deepEqual(whatCarriesOn(facts([run({ botId: 'other' })])), [], "another bot's run");
});

test('a run carries on unless the owner sent the bot a message after that run asked (OK-010)', () => {
  // The later message was not refused, so it is on no card: nothing carries on, whatever waits (scenario A10).
  const again = run({ id: 'r2', startedAt: ago(5), prompt: 'And the issues?' });
  assert.deepEqual(whatCarriesOn(facts([run()], { later: [again] })), [], 'a message after the run asked');
  assert.equal(thenOf(whatCarriesOn(facts([run()], { later: [again] }))), null, 'and the card promises nothing');
  // That second request was refused the same thing and waits for the same card: it carries on, and the first,
  // which the owner sent a message after, does not.
  const both = whatCarriesOn(facts([run(), { ...again, askedAt: ago(4) }], { later: [again] }));
  assert.deepEqual(who(both), ['owner:r2']);
  assert.deepEqual(thenOf(both), { who: 'bot', text: 'It carries on with “And the issues?” when you allow it.' });
  // A job's run and a teammate's request that wait: the same rule for each.
  const job = { id: 'j1', name: 'Morning check', enabled: true, approved: true };
  const waiting = [run({ id: 'j', trigger: 'schedule', jobId: 'j1' }), run({ id: 't', trigger: 'bot', fromBot: { id: 'b2', name: 'Asker' } })];
  assert.deepEqual(who(whatCarriesOn({ ...facts(waiting), bot: { ...bot, jobs: [job] } })).sort(), ['job:j', 'teammate:t']);
  assert.deepEqual(whatCarriesOn({ ...facts(waiting, { later: [again] }), bot: { ...bot, jobs: [job] } }), []);
  // What is no message of the owner after it asked: a message before it asked, also one sent while the run was
  // still going, a job, the Chief's task, a teammate's message, and a run botdot started itself.
  const before = run({ id: 'r0', startedAt: ago(9.5) });
  const others = [before, run({ id: 'j', jobId: 'j1', startedAt: ago(5) }), run({ id: 'c', startedBy: 'chief', startedAt: ago(5) }),
    run({ id: 't', trigger: 'bot', fromBot: { id: 'b2', name: 'Asker' }, startedAt: ago(5) }), run({ id: 'k', continues: 'r0', startedAt: ago(5) })];
  assert.deepEqual(who(whatCarriesOn(facts([run()], { later: others }))), ['owner:r1']);
});

test("a job's run asked first and the owner's request joined its card: the request carries on, the job is not repeated (OK-010)", () => {
  // The job's run was refused at 7:00 and made the card. At 8:00 the owner asked the bot something, which was
  // refused the same and joined. `later` is what botdot hands in: every run of the bot since the first one started.
  const job = { id: 'j1', name: 'Morning news', enabled: true, approved: true };
  const withJob = { ...bot, jobs: [job] };
  const atSeven = run({ id: 'r7', trigger: 'schedule', jobId: 'j1', jobName: 'Morning news', startedAt: ago(301) });
  const atEight = run({ id: 'r8', startedAt: ago(241), askedAt: ago(240), prompt: 'What is new today?' });
  const card = (runs, later = runs) => ({ ...facts(runs, { made: ago(300), later }), bot: withJob });
  assert.deepEqual(who(whatCarriesOn(card([atSeven]))), ['job:r7'], 'until the owner writes, the job would run again');
  const found = whatCarriesOn(card([atSeven, atEight]));
  assert.deepEqual(who(found), ['owner:r8'], 'one run, for the 8:00 request');
  assert.deepEqual(thenOf(found), { who: 'bot', text: 'It carries on with “What is new today?” when you allow it.' });
  // The 8:00 message was not refused (the bot did it): it is on no card, and nothing carries on.
  assert.deepEqual(whatCarriesOn(card([atSeven], [atSeven, atEight])), []);
  assert.equal(thenOf(whatCarriesOn(card([atSeven], [atSeven, atEight]))), null);
  // Two requests of the owner, both refused and on that card: the later one only.
  const atNine = run({ id: 'r9', startedAt: ago(181), askedAt: ago(180), prompt: 'And the weather?' });
  const three = whatCarriesOn(card([atSeven, atEight, atNine]));
  assert.deepEqual(who(three), ['owner:r9']);
  assert.match(thenOf(three).text, /And the weather\?/);
  // A request the owner sent while the job's run was still going, before it asked, is not after it: both carry on.
  const early = run({ id: 'r8', startedAt: ago(300.5), askedAt: ago(299), prompt: 'What is new today?' });
  assert.deepEqual(who(whatCarriesOn(card([atSeven, early]))), ['owner:r8', 'job:r7']);
  // Each run counts for itself: the bot answered the 8:00 message, and the job's next run, at 9:00, was refused
  // the same and joined. No message of the owner came after that run asked: the job runs again, once, for it.
  const jobAtNine = { ...atSeven, id: 'j9', startedAt: ago(181), askedAt: ago(180) };
  const next = whatCarriesOn(card([atSeven, jobAtNine], [atSeven, atEight, jobAtNine]));
  assert.deepEqual(who(next), ['job:j9']);
  assert.deepEqual(thenOf(next), { who: 'bot', text: 'It runs “Morning news” again when you allow it.' });
});

test("a teammate's request follows the same rule as a job's run (OK-010)", () => {
  const mate = run({ id: 'm', trigger: 'bot', fromBot: { id: 'b2', name: 'Fleet Doctor' }, startedAt: ago(61) });
  const mine = run({ id: 'r8', startedAt: ago(31), askedAt: ago(30), prompt: 'Read the status page' });
  const card = (runs, later = runs) => facts(runs, { made: ago(60), later });
  assert.deepEqual(who(whatCarriesOn(card([mate]))), ['teammate:m']);
  assert.deepEqual(who(whatCarriesOn(card([mate, mine]))), ['owner:r8'], 'the owner sent the bot a message after it asked');
  assert.deepEqual(whatCarriesOn(card([mate], [mate, mine])), [], 'also one that was not refused');
  // The other way round: the teammate's request came after the owner's. No message of the owner followed either.
  const first = run({ id: 'r1', startedAt: ago(61), prompt: 'Read the status page' });
  const after = run({ id: 'm', trigger: 'bot', fromBot: { id: 'b2', name: 'Fleet Doctor' }, startedAt: ago(31), askedAt: ago(30) });
  assert.deepEqual(who(whatCarriesOn(card([first, after]))), ['teammate:m', 'owner:r1']);
});

test('a run that was carried on from does not carry on again', () => {
  // Its work was queued after one yes; then it ended refused something else, and the run that carried on was
  // refused the same: both wait for the second card, and one run follows.
  const next = run({ id: 'r2', continues: 'r1', startedAt: ago(5), askedAt: ago(4) });
  assert.deepEqual(who(whatCarriesOn(facts([run(), next], { later: [next] }))), ['owner:r2']);
  assert.deepEqual(whatCarriesOn(facts([run()], { later: [next] })), [], 'also when the later run waits for nothing');
});

test('older than 24 hours, deleted or stopped by the owner: nothing carries on', () => {
  assert.deepEqual(who(whatCarriesOn(facts([run()], { made: ago(24 * 60 - 1) }))), ['owner:r1'], 'just inside the day');
  assert.deepEqual(whatCarriesOn(facts([run()], { made: ago(24 * 60) })), [], '24 hours');
  assert.deepEqual(whatCarriesOn(facts([run({ askedAt: ago(5) })], { made: ago(24 * 60) })), [], 'also for a run that joined the old card lately');
  assert.deepEqual(whatCarriesOn(facts([run()], { made: 'not a time' })), []);
  assert.deepEqual(whatCarriesOn({ ...facts([run()]), bot: null }), [], 'the bot is gone');
  // Paused, every job switched off, stops a job's run from being repeated, not the owner's own request (OK-010).
  const off = { ...bot, jobs: [{ id: 'j1', enabled: false, approved: true }] };
  assert.deepEqual(who(whatCarriesOn({ ...facts([run()]), bot: off })), ['owner:r1'], "every job switched off: the owner's own request still carries on");
  assert.deepEqual(who(whatCarriesOn({ ...facts([run()]), bot: { ...bot, jobs: [...off.jobs, { id: 'j2', enabled: true, approved: true }] } })), ['owner:r1']);
  assert.deepEqual(whatCarriesOn(facts([run({ status: 'stopped' })])), [], 'the owner stopped that run');
  assert.deepEqual(who(whatCarriesOn(facts([run({ status: 'error' })]))), ['owner:r1'], 'a run that failed still carries on');
  assert.deepEqual(whatCarriesOn(facts([run({ trigger: 'replies' })])), [], 'a follow-up carries on nothing');
});

test("a bot whose jobs are all switched off: a job's run is not repeated, and what the owner, the Chief or a teammate asked carries on (OK-010)", () => {
  const off = { ...bot, jobs: [{ id: 'j1', name: 'Morning check', enabled: false, approved: true }] };
  const paused = (r, more = {}) => whatCarriesOn({ ...facts([r], more), bot: off });
  // A job's run: at its time, by "Run now", and a one-time job that is gone from the bot's jobs since.
  for (const fields of [{ trigger: 'schedule', jobId: 'j1' }, { trigger: 'manual', jobId: 'j1' }, { trigger: 'schedule', jobId: 'once', jobName: 'Call the plumber', oneTime: true }]) {
    assert.deepEqual(paused(run(fields)), [], JSON.stringify(fields));
    assert.equal(thenOf(paused(run(fields))), null);
  }
  // The owner's own request, by a message or a tile of the Board.
  assert.deepEqual(thenOf(paused(run())), { who: 'bot', text: 'It carries on with “Check the PRs” when you allow it.' });
  // A run the Chief started is handed to the Chief, in the chat that started it.
  const chiefs = paused(run({ startedBy: 'chief' }), { chats: { r1: { id: 'c1', title: 'Watch the news', wroteAt: ago(11) } } });
  assert.deepEqual(who(chiefs), ['chief:r1']);
  assert.deepEqual(thenOf(chiefs), { who: 'chief', text: 'The Chief carries on in “Watch the news” when you allow it.', chatId: 'c1', here: 'The Chief carries on in this chat when you allow it.' });
  // A teammate's request.
  assert.deepEqual(thenOf(paused(run({ trigger: 'bot', fromBot: { id: 'b2', name: 'Fleet Doctor' } }))), { who: 'bot', text: "It carries on with Fleet Doctor's request when you allow it." });
  // All of them on one card: everything but the job's run.
  const all = [run({ id: 'j', trigger: 'schedule', jobId: 'j1' }), run({ id: 't', trigger: 'bot', fromBot: { id: 'b2', name: 'Asker' } }), run({ id: 'c', startedBy: 'chief' }), run()];
  assert.deepEqual(who(whatCarriesOn({ ...facts(all, { chats: { c: { id: 'c1', title: 'Watch the news', wroteAt: ago(11) } } }), bot: off })).sort(), ['chief:c', 'owner:r1', 'teammate:t']);
  // With one job switched on the bot is not paused, and a "Run now" of a job that is off runs again, as before.
  const on = { ...off, jobs: [...off.jobs, { id: 'j2', name: 'Other', enabled: true, approved: true }] };
  assert.deepEqual(who(whatCarriesOn({ ...facts([run({ trigger: 'manual', jobId: 'j1' })]), bot: on })), ['job:r1']);
  // A deleted bot carries on with nothing, whoever asked.
  for (const r of all) assert.deepEqual(whatCarriesOn({ ...facts([r], { chats: { c: { id: 'c1', title: 'Watch the news', wroteAt: ago(11) } } }), bot: null }), [], r.id);
});

test("a teammate's request names the teammate", () => {
  const found = whatCarriesOn(facts([run({ trigger: 'bot', fromBot: { id: 'b2', name: 'Fleet Doctor' } })]));
  assert.deepEqual(who(found), ['teammate:r1']);
  assert.deepEqual(thenOf(found), { who: 'bot', text: "It carries on with Fleet Doctor's request when you allow it." });
});

test('a run the Chief started carries on in the chat that started it, and nowhere without it', () => {
  const r = run({ startedBy: 'chief' });
  assert.deepEqual(whatCarriesOn(facts([r])), [], 'the chat is gone');
  const found = whatCarriesOn(facts([r], { chats: { r1: { id: 'c1', title: 'Watch the news' } } }));
  assert.deepEqual(who(found), ['chief:r1']);
  assert.deepEqual(thenOf(found), { who: 'chief', text: 'The Chief carries on in “Watch the news” when you allow it.', chatId: 'c1', here: 'The Chief carries on in this chat when you allow it.' });
});

test('a job runs again once: for its latest run, while it is there and approved', () => {
  const job = { id: 'j1', name: 'Morning check', enabled: true, approved: true };
  const withJob = { ...bot, jobs: [job] };
  const made = ago(119);
  const first = run({ trigger: 'schedule', jobId: 'j1', jobName: 'Morning check', startedAt: ago(120) });
  const second = { ...first, id: 'r2', startedAt: ago(60), askedAt: ago(59) };
  const facts = (runs, more = {}) => ({ ask: askOf(runs, made), bot, stopped: Object.fromEntries(runs.map((r) => [r.id, r])), now: NOW, ...more });
  const one = whatCarriesOn({ ...facts([first]), bot: withJob });
  assert.deepEqual(who(one), ['job:r1']);
  assert.deepEqual(thenOf(one), { who: 'bot', text: 'It runs “Morning check” again when you allow it.' });
  // Refused every hour: both runs wait, the job runs once more.
  assert.deepEqual(who(whatCarriesOn({ ...facts([first, second], { later: [second] }), bot: withJob })), ['job:r2']);
  assert.deepEqual(whatCarriesOn({ ...facts([first], { later: [{ ...second, kind: 'script' }] }), bot: withJob }), [], 'it ran again since');
  assert.deepEqual(whatCarriesOn({ ...facts([first]), bot: { ...withJob, jobs: [{ ...job, approved: false }] } }), [], 'it waits for approval');
  // Switched off since, with another job of the bot still on: its run at its time is not repeated, a "Run now" is.
  const other = { id: 'j2', name: 'Other', enabled: true, approved: true };
  const switchedOff = { ...withJob, jobs: [{ ...job, enabled: false }, other] };
  assert.deepEqual(whatCarriesOn({ ...facts([first]), bot: switchedOff }), [], 'switched off');
  assert.deepEqual(who(whatCarriesOn({ ...facts([{ ...first, trigger: 'manual' }]), bot: switchedOff })), ['job:r1'], '"Run now" of a job that is off');
  assert.deepEqual(whatCarriesOn(facts([first])), [], 'the job was removed');
  // A one-time job is gone from the bot's jobs as its run starts: it still runs, named as its run recorded it.
  const once = whatCarriesOn(facts([{ ...first, oneTime: true }]));
  assert.deepEqual(who(once), ['job:r1']);
  assert.equal(thenOf(once).text, 'It runs “Morning check” again when you allow it.');
});

test('the latest ask comes first, and is what the card says', () => {
  const mine = run({ id: 'r2', startedAt: ago(8), askedAt: ago(7), prompt: 'The later one' });
  const mate = run({ trigger: 'bot', fromBot: { id: 'b2', name: 'Asker' } });
  const found = whatCarriesOn(facts([mate, mine]));
  assert.deepEqual(who(found), ['owner:r2', 'teammate:r1']);
  assert.match(thenOf(found).text, /The later one/);
});

// ---------- what the Chief asked for in a chat (OK-002) ----------

const CHAT = { id: 'c1', title: 'Morning tech news', wroteAt: ago(30) };
const HERE = 'The Chief carries on in this chat when you allow it.';
// A changed bot, a skill, a waiting job or a waiting tile that the Chief asked for in that chat 20 minutes ago.
const asked = (more = {}) => ({ ask: { chatId: 'c1', at: ago(20), ...more }, chat: CHAT, now: NOW });

test('what the Chief asked for in a chat gives it a turn there, and its card says so', () => {
  const found = whatCarriesOn(asked());
  assert.deepEqual(found, [{ who: 'chief', asker: true, chat: { id: 'c1', title: 'Morning tech news' }, asked: ago(20) }]);
  assert.deepEqual(thenOf(found), { who: 'chief', text: 'The Chief carries on in “Morning tech news” when you allow it.', chatId: 'c1', here: HERE });
  assert.deepEqual(whatCarriesOn({ ask: { at: ago(20) }, chat: CHAT, now: NOW }), [], 'asked for in no chat: the yes only changes the setting');
});

test('no turn once the owner wrote in that chat since, or after 24 hours', () => {
  assert.deepEqual(whatCarriesOn({ ...asked(), chat: { ...CHAT, wroteAt: ago(19) } }), [], 'they wrote after it was asked for');
  assert.equal(whatCarriesOn({ ...asked(), chat: { ...CHAT, wroteAt: ago(20) } }).length, 1, 'the message that asked for it is not after it');
  assert.equal(whatCarriesOn({ ...asked(), chat: { ...CHAT, wroteAt: null } }).length, 1, 'a chat the owner never wrote in');
  const silent = { chat: { ...CHAT, wroteAt: ago(2 * 24 * 60) } };
  assert.equal(whatCarriesOn({ ...asked({ at: ago(24 * 60 - 1) }), ...silent }).length, 1, 'just inside the day');
  assert.deepEqual(whatCarriesOn({ ...asked({ at: ago(24 * 60) }), ...silent }), [], '24 hours');
  // Asked for again in that chat, the card counts from then.
  const again = { at: ago(25 * 60), chatAt: ago(10) };
  assert.equal(whatCarriesOn({ ...asked(again), chat: { ...CHAT, wroteAt: ago(15) } }).length, 1);
  assert.deepEqual(whatCarriesOn({ ...asked(again), chat: { ...CHAT, wroteAt: ago(5) } }), []);
});

test('its chat is gone: the Chief carries on where it is told in its place, or in a new chat', () => {
  // The owner wrote there lately, about something else: that is no answer to what was asked in the lost chat.
  const other = whatCarriesOn({ ...asked(), chat: { id: 'c2', title: 'Something else', wroteAt: ago(1) } });
  assert.deepEqual(thenOf(other), { who: 'chief', text: 'The Chief carries on in “Something else” when you allow it.', chatId: 'c2', here: HERE });
  const none = whatCarriesOn({ ...asked(), chat: null });
  assert.deepEqual(none, [{ who: 'chief', asker: true, chat: null, asked: ago(20) }]);
  assert.deepEqual(thenOf(none), { who: 'chief', text: 'The Chief carries on in a new chat when you allow it.' });
});

test("a changed bot that runs wait for: the Chief's turn comes first, and each follows its own rule", () => {
  // The Chief proposed the web an hour ago; the owner then asked the bot, whose run was refused it and joined the
  // card 9 minutes ago. That request is what waits: it is not the owner asking again.
  const r = run();
  const joined = { ...facts([r]), ask: { kind: 'bot-change', botId: 'b1', chatId: 'c1', at: ago(60), runsAt: ago(9), runs: [{ id: 'r1', at: ago(9) }] }, chat: { ...CHAT, wroteAt: ago(70) } };
  const found = whatCarriesOn(joined);
  assert.deepEqual(found.map((f) => (f.asker ? 'the Chief' : `${f.who}:${f.run.id}`)), ['the Chief', 'owner:r1']);
  assert.equal(found[1].asked, ago(9), 'the run counts from when it asked');
  assert.equal(thenOf(found).who, 'chief');
  // The owner wrote in the chat since: no turn, and the run still carries on.
  assert.deepEqual(who(whatCarriesOn({ ...joined, chat: { ...CHAT, wroteAt: ago(1) } })), ['owner:r1']);
  // The owner asked the bot again after the run joined: the Chief's turn, and no run.
  const again = run({ id: 'r2', startedAt: ago(5) });
  assert.deepEqual(whatCarriesOn({ ...joined, later: [again] }).map((f) => f.who), ['chief']);
  // The card is a day old and its run is not: the run carries on, the Chief has no turn.
  assert.deepEqual(who(whatCarriesOn({ ...joined, ask: { ...joined.ask, at: ago(25 * 60) } })), ['owner:r1']);
  // The bot is gone or paused: the Chief is still told.
  assert.deepEqual(whatCarriesOn({ ...joined, bot: null }).map((f) => f.who), ['chief']);
});

// ---------- a run the Chief started carries on once (OK-007) ----------

// The Chief chat whose reply started a run, and when the owner last wrote in it: before the ask was made.
const NEWS = { id: 'c1', title: 'Watch the news', wroteAt: ago(11) };
const chiefs = (fields = {}) => run({ startedBy: 'chief', ...fields });

test('of the runs the Chief started from one chat, only the latest carries on', () => {
  // The Chief ran the bot twice from one chat, and both runs were refused the same thing: one card, one turn.
  const first = chiefs();
  const second = chiefs({ id: 'r2', startedAt: ago(8), askedAt: ago(7), prompt: 'The second task' });
  const both = whatCarriesOn(facts([first, second], { chats: { r1: NEWS, r2: NEWS } }));
  assert.deepEqual(who(both), ['chief:r2']);
  assert.deepEqual(both[0].chat, { id: 'c1', title: 'Watch the news' });
  assert.deepEqual(who(whatCarriesOn(facts([second, first], { chats: { r1: NEWS, r2: NEWS } }))), ['chief:r2'], 'in whatever order they wait');
  // Two that asked in the same moment: the one that started last.
  assert.deepEqual(who(whatCarriesOn(facts([first, { ...second, askedAt: undefined }], { chats: { r1: NEWS, r2: NEWS } }))), ['chief:r2']);
  // Runs from two chats carry on in each, and the owner's own request beside them as before.
  const other = chiefs({ id: 'r3', startedAt: ago(8), askedAt: ago(6) });
  const mine = run({ id: 'r4', startedAt: ago(8), askedAt: ago(5) });
  const chats = { r1: NEWS, r2: NEWS, r3: { id: 'c2', title: 'Another chat', wroteAt: null } };
  assert.deepEqual(who(whatCarriesOn(facts([first, second, other], { chats }))), ['chief:r3', 'chief:r2']);
  assert.deepEqual(who(whatCarriesOn(facts([first, second, mine], { chats }))), ['owner:r4', 'chief:r2']);
  // The latest of a chat cannot carry on (the owner stopped it): the one before it does not stand in for it.
  assert.deepEqual(whatCarriesOn(facts([first, { ...second, status: 'stopped' }], { chats })), []);
});

test('the owner wrote in that chat after that run asked: it does not carry on, and botdot says so there', () => {
  const first = chiefs();
  const second = chiefs({ id: 'r2', startedAt: ago(5), askedAt: ago(4) });
  // The owner wrote there after the latest run asked: they have taken the work up in that chat themselves.
  const since = { ...NEWS, wroteAt: ago(3) };
  const taken = facts([first, second], { chats: { r1: since, r2: since } });
  assert.deepEqual(whatCarriesOn(taken), [], 'the owner has taken it up in that chat');
  assert.equal(thenOf(whatCarriesOn(taken)), null, 'the card promises nothing');
  assert.deepEqual(chatsTakenUp(taken), [{ id: 'c1', title: 'Watch the news' }], 'one line, however many runs');
  assert.deepEqual(whatCarriesOn(facts([first], { chats: { r1: since } })), [], 'also with one run');
  // The message that led the Chief to start the run is not after it asked, nor is what the owner wrote while the
  // run was still going, before it was refused (it started 10 minutes ago and asked 9 minutes ago): nothing had
  // stopped yet that they could have taken up. A chat the owner never wrote in neither.
  for (const wroteAt of [ago(9), ago(9.5), ago(10), ago(11), null, undefined, 'not a time']) {
    const before = facts([first], { chats: { r1: { ...NEWS, wroteAt } } });
    assert.deepEqual(who(whatCarriesOn(before)), ['chief:r1'], String(wroteAt));
    assert.deepEqual(chatsTakenUp(before), []);
  }
  // Only that chat's runs: one from another chat, the owner's own request and a teammate's carry on.
  const other = chiefs({ id: 'r3', startedAt: ago(8), askedAt: ago(7) });
  const mine = run({ id: 'r4', startedAt: ago(9.5) });
  const mixed = facts([first, second, other, mine], { chats: { r1: since, r2: since, r3: { id: 'c2', title: 'Another chat', wroteAt: ago(30) } } });
  assert.deepEqual(who(whatCarriesOn(mixed)).sort(), ['chief:r3', 'owner:r4']);
  assert.deepEqual(chatsTakenUp(mixed), [{ id: 'c1', title: 'Watch the news' }]);
  // A changed bot that its runs joined: the same, from when the run asked.
  const joined = { ...taken, ask: { kind: 'bot-change', botId: 'b1', at: ago(60), runsAt: ago(9), runs: taken.ask.runs } };
  assert.deepEqual(whatCarriesOn(joined), []);
  assert.deepEqual(who(whatCarriesOn({ ...joined, chats: { r1: { ...NEWS, wroteAt: ago(30) }, r2: { ...NEWS, wroteAt: ago(30) } } })), ['chief:r2'], 'a message before the run is not after it');
  // A late yes on an action in a connected app starts the bot itself (ADR 010): the Chief gets no turn, so what
  // the owner wrote in its chat does not count, and botdot writes nothing there.
  const late = { ...facts([first], { chats: { r1: since } }), ask: { botId: 'b1', at: ago(9), runs: [{ id: 'r1', at: ago(9) }], startsBot: true } };
  assert.deepEqual(who(whatCarriesOn(late)), ['chief:r1']);
  assert.deepEqual(chatsTakenUp(late), []);
  assert.deepEqual(whatCarriesOn({ ...late, stopped: { r1: { ...first, handedBackAt: ago(2) } } }), [], 'a run that was handed back is no such run either');
  assert.deepEqual(whatCarriesOn({ ...late, chats: {} }), [], 'and it still needs the chat that started it');
  // No line where nothing would have carried on anyway: the bot is gone, a day passed, the chat is gone,
  // the owner stopped the run, or it carried on already.
  for (const [why, other] of Object.entries({
    gone: { bot: null }, old: { ask: { ...taken.ask, at: ago(24 * 60) } }, 'no chat': { chats: {} },
    stopped: { stopped: { r1: { ...first, status: 'stopped' }, r2: { ...second, status: 'stopped' } } },
    'asked the bot again': { later: [run({ id: 'r9', startedAt: ago(1) })] },
  })) assert.deepEqual(chatsTakenUp({ ...taken, ...other }), [], why);
  assert.deepEqual(chatsTakenUp({ ask: { chatId: 'c1', at: ago(20) }, chat: NEWS, now: NOW }), [], 'an ask without runs');
  // A paused bot's run that the Chief started would have been handed to the Chief (OK-010): the line is written.
  const off = { ...bot, jobs: [{ id: 'j1', enabled: false, approved: true }] };
  assert.deepEqual(chatsTakenUp({ ...taken, bot: off }), [{ id: 'c1', title: 'Watch the news' }], 'paused');
});

test('the message that led the Chief to start a run is not the owner taking it up, however old the card is (OK-008)', () => {
  // The Chief ran the bot, it was refused; the owner asked the Chief again, and the second run was refused the same
  // and joined the card. That message is later than the card and earlier than the run it led to: one turn, for
  // that run.
  const first = chiefs();
  const second = chiefs({ id: 'r2', startedAt: ago(5), askedAt: ago(4) });
  const again = { ...NEWS, wroteAt: ago(6) };
  const asked = facts([first, second], { chats: { r1: again, r2: again } });
  assert.deepEqual(who(whatCarriesOn(asked)), ['chief:r2']);
  assert.deepEqual(chatsTakenUp(asked), [], 'and botdot writes no line of its own there');
  assert.deepEqual(thenOf(whatCarriesOn(asked)), { who: 'chief', text: 'The Chief carries on in “Watch the news” when you allow it.', chatId: 'c1', here: 'The Chief carries on in this chat when you allow it.' });
  // A4 on an older card: a job's run made the card an hour ago. Now the owner asks the Chief, whose run is refused
  // the same and joins. Allow gives the Chief its turn for that run, and the job runs again too.
  const job = { id: 'j1', name: 'Morning news', enabled: true, approved: true };
  const atItsTime = run({ trigger: 'schedule', jobId: 'j1', jobName: 'Morning news', startedAt: ago(61) });
  const asksChief = chiefs({ id: 'r2', startedAt: ago(2), askedAt: ago(1) });
  const request = { ...NEWS, wroteAt: ago(3) };
  const older = { ...facts([atItsTime, asksChief], { made: ago(60), chats: { r2: request }, later: [asksChief] }), bot: { ...bot, jobs: [job] } };
  assert.deepEqual(who(whatCarriesOn(older)), ['chief:r2', 'job:r1']);
  assert.deepEqual(whatCarriesOn(older)[0].chat, { id: 'c1', title: 'Watch the news' });
  assert.deepEqual(chatsTakenUp(older), []);
  // The same on a changed bot that is older than its first run.
  const change = { ...older, ask: { kind: 'bot-change', botId: 'b1', at: ago(600), runsAt: ago(60), runs: older.ask.runs } };
  assert.deepEqual(who(whatCarriesOn(change)), ['chief:r2', 'job:r1']);
  // What they write there while that run is still going (it started 2 minutes ago and asked a minute ago) changes
  // nothing. Once they write there after it asked, the work is theirs: the job still runs again.
  assert.deepEqual(who(whatCarriesOn({ ...older, chats: { r2: { ...NEWS, wroteAt: ago(1.5) } } })), ['chief:r2', 'job:r1']);
  const wrote = { ...older, chats: { r2: { ...NEWS, wroteAt: ago(0.5) } } };
  assert.deepEqual(who(whatCarriesOn(wrote)), ['job:r1']);
  assert.deepEqual(chatsTakenUp(wrote), [{ id: 'c1', title: 'Watch the news' }]);
});

test('a run the Chief was told to start again counts as carried on from that moment', () => {
  // The Chief starts the bot with run_bot, in a run that does not say which run it carries on from: the run
  // that stopped says it itself (`handedBackAt`).
  const told = chiefs({ handedBackAt: ago(3) });
  assert.deepEqual(whatCarriesOn(facts([told], { chats: { r1: NEWS } })), []);
  assert.equal(thenOf(whatCarriesOn(facts([told], { chats: { r1: NEWS } }))), null, "it is in no ask's `then`");
  assert.deepEqual(chatsTakenUp(facts([told], { chats: { r1: { ...NEWS, wroteAt: ago(1) } } })), []);
  // An earlier run of that chat does not carry on in its place: the Chief took up the latest.
  const older = chiefs({ id: 'r0', startedAt: ago(20), askedAt: ago(9) });
  assert.deepEqual(whatCarriesOn(facts([older, told], { chats: { r0: NEWS, r1: NEWS } })), []);
  // A run that was not handed back is as before.
  assert.deepEqual(who(whatCarriesOn(facts([chiefs()], { chats: { r1: NEWS } }))), ['chief:r1']);
});
