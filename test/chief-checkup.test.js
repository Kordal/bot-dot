// The Chief's checkup (ADR 023) on a real botdot server with the stand-in Claude. The checkup is started by hand
// (BOT_DOT_LOOK_ON_DEMAND, as a test environment does); when one starts by itself is in checkup.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, seedRuns, QUIET_RUN, feed, waitFor } = require('./helpers');
const checkup = require('../lib/checkup');

const ENV = { BOT_DOT_LOOK_ON_DEMAND: '1' };
let srv, f, surfer, cook;
before(async () => {
  srv = await startServer({ env: ENV });
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // the tests run at any hour
  surfer = await makeBot(srv, { name: 'Web Surfer', description: 'Looks things up on the web' });
  cook = await makeBot(srv, { name: 'Cook', description: 'Plans the meals' });
  await srv.api('/dashboard/tiles', { method: 'POST', body: { title: 'Disk space', kind: 'value', section: 'Homelab' } });
  const job = (await srv.api(`/bots/${cook.id}/jobs`, { method: 'POST', body: { name: 'Menu check', kind: 'ai', cron: '0 6 * * *', prompt: 'Check the menu.' } })).data;
  // What happened before the checkup: written as botdot keeps runs, found when it starts again.
  await srv.stop();
  seedRuns(srv, cook, [
    { ...QUIET_RUN, jobId: job.id, jobName: 'Menu check', times: 3 },
    { ...QUIET_RUN, jobId: job.id, jobName: 'Menu check', reporting: undefined, result: 'The menu changed.', notificationAudience: 'owner' },
  ]);
  seedRuns(srv, surfer, [
    { prompt: 'What changed in the Grok subscription?', result: 'Should I log in with the saved X login?' },
    { prompt: 'Yes, use the X account', result: 'Done: the price went up.' },
    { trigger: 'schedule', jobId: 'j1', jobName: 'Rail check', customPrompt: false, status: 'error', result: '', error: 'Stopped after 60 seconds', notificationAudience: 'internal' },
    { prompt: 'My bank card number is 4111', result: 'Noted the secret card.', excludedFromMemory: true },
  ]);
  fs.mkdirSync(path.join(srv.data, 'inbox'), { recursive: true });
  // An answer Cook collects for a question of its own: unread, and it wakes nothing as botdot starts (ADR 049).
  fs.writeFileSync(path.join(srv.data, 'inbox', `${cook.id}.json`), JSON.stringify([{ id: 'n1', at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), fromId: surfer.id, fromName: 'Web Surfer', text: 'Please plan around the rail strike.', answer: true }]));
  srv = await startServer({ dir: srv.dir, env: ENV });
  f = await feed(srv);
  await f.wait('hello');
});
after(async () => { f.close(); await srv.stop(); });

const today = () => new Date().toISOString().slice(0, 10);
const RULE = () => ({ kind: 'rule', bot: 'web surfer', change: 'Use the saved X login straight away for read-only lookups.', day: today(), evidence: 'you answered "Yes, use the X account"' });
const JOB = () => ({ kind: 'job', bot: 'Web Surfer', change: 'Give "Rail check" two minutes instead of one.', day: today(), evidence: 'it stopped after 60 seconds' });
const checkupNow = async () => (await srv.api('/chief/checkup/now', { method: 'POST' })).data;
const checkupRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff · checkup'));
const chiefRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff'));
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const chats = async () => (await srv.api('/chief')).data.chats;
const replyDone = (id) => waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
const say = async (id, text) => { await srv.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text } }); return replyDone(id); };
const record = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'checkups.json'), 'utf8'));
const flagged = (args, flag) => { const i = args.indexOf(flag) + 1; let j = i; while (j < args.length && !args[j].startsWith('--')) j++; return args.slice(i, j); };
const setting = async (body) => srv.api('/settings/checkup', body ? { method: 'PUT', body } : {});

let chatId;

test('the server announces the checkup, and it is on, on weekdays at 08:00, without web search', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('checkup'));
  const { on, days, time, webSearch, when, timeZone, lastRanAt } = (await setting()).data.checkup;
  assert.deepEqual([on, days, time, webSearch, when, lastRanAt], [true, [1, 2, 3, 4, 5], '08:00', false, 'Weekdays at 08:00', null]);
  assert.ok(timeZone);
});

test('a checkup with nothing to propose opens no chat and announces nothing', async () => {
  srv.reply('NOTHING');
  const events = f.events.length;
  const r = await checkupNow();
  assert.deepEqual([r.ran, r.posted], [true, false]);
  assert.deepEqual(await chats(), []);
  assert.ok(!f.events.slice(events).some((e) => e.type === 'chief_reply'));
  assert.ok((await setting()).data.checkup.lastRanAt, 'it ran: the next one reads from here');
  fs.rmSync(path.join(srv.data, 'checkups.json')); // the next test reads the whole window again
});

test('a checkup opens a new chat named for the day, with numbered proposals and answer buttons, as a new reply', async () => {
  srv.reply(JSON.stringify({ proposals: [RULE(), JOB(), { ...RULE(), bot: 'Coder', change: 'A rule for a bot that is gone.' }] }));
  const r = await checkupNow();
  assert.deepEqual([r.ran, r.posted], [true, true]);
  chatId = r.chatId;
  const chat = await chatOf(chatId);
  assert.match(chat.title, /^Checkup, \d{1,2} [A-Z][a-z]{2}$/);
  assert.equal(chat.messages.length, 1);
  const { at, ...m } = chat.messages[0];
  assert.deepEqual(Object.keys(m).sort(), ['checkup', 'choices', 'role', 'startedBy', 'text']);
  assert.deepEqual([m.role, m.checkup, m.startedBy, m.choices], ['chief', true, 'botdot', ['Do 1', 'Do all', 'Not now']]);
  assert.match(m.text, /^2 things I would change after this checkup:\n\n1\. \*\*Rule, Web Surfer:\*\* Use the saved X login straight away for read-only lookups\.\n {3}Why: \d{1,2} [A-Z][a-z]{2}, you answered "Yes, use the X account"\n2\. \*\*Job, Web Surfer:\*\*/);
  assert.doesNotMatch(m.text, /Coder/, 'a proposal for a bot that does not exist is left out');
  assert.ok(!('unasked' in m) && !('rating' in m), 'it is no unasked message');
  assert.deepEqual([chat.unread, chat.firstUnread], [1, 0], 'it counts as new');
  const ev = await f.wait('chief_reply', (d) => d.chatId === chatId);
  assert.deepEqual([ev.data.checkup, ev.data.new, ev.data.status, ev.data.error, ev.data.unasked], [true, true, 'success', null, undefined], 'announced like a reply');
  await f.wait('unread', (d) => d.chat === `chief:${chatId}` && d.unread === 1);
  assert.deepEqual(record().proposals.map((p) => [p.n, p.kind, p.bot, p.status, p.chatId, p.shown]), [[1, 'rule', 'Web Surfer', 'open', chatId, 1], [2, 'job', 'Web Surfer', 'open', chatId, 1]]);
  assert.deepEqual((await srv.api('/settings/writing-first')).data.writingFirst, { perDay: 3, sentToday: 0, times: [] }, 'it does not count toward the unasked messages of the day');
});

test('a checkup\'s message cannot be rated', async () => {
  const r = await srv.api(`/chief/chats/${chatId}/messages/0/rating`, { method: 'PUT', body: { rating: 'up' } });
  assert.ok(r.status >= 400);
  assert.ok(!('rating' in (await chatOf(chatId)).messages[0]));
});

test('a checkup is its own session with botdot\'s reading tools only: no web, no fetch, no bot is messaged', async () => {
  const run = checkupRuns().at(-1);
  assert.deepEqual(flagged(run.args, '--allowedTools'), checkup.tools(false));
  assert.deepEqual(flagged(run.args, '--tools'), [''], 'no built-in tool at all');
  for (const t of flagged(run.args, '--allowedTools')) assert.match(t, /^mcp__botdot__(recall|list_bots|get_bot|list_runs|get_run)$/);
  assert.equal(run.botdot.env.BOT_DOT_LOOK, '1', 'the tools server offers the reading tools only');
  assert.ok(!run.args.includes('--resume') && run.args.includes('--no-session-persistence') && !run.args.includes('--plugin-dir'));
  assert.deepEqual(flagged(run.args, '--permission-mode'), ['dontAsk']);
  assert.match(run.system, /At most three proposals/);
  assert.doesNotMatch(run.system, /search the web/);
  assert.equal(chiefRuns().length, 0, 'no turn of a chat ran');
  assert.equal(srv.runs().length, checkupRuns().length, 'and no bot ran: none was asked anything');
});

test('it is told what botdot recorded: the owner\'s chats, a failed scheduled run, the jobs, an unread message and the Board, and no run that is left out', async () => {
  const { stdin } = checkupRuns().at(-1);
  assert.match(stdin, /## Web Surfer: Looks things up on the web\nChats the owner started:\n- \S+ \S+ Owner: What changed in the Grok subscription\?\n {2}Web Surfer \(success\): Should I log in with the saved X login\?/);
  assert.match(stdin, /Owner: Yes, use the X account/);
  assert.match(stdin, /Runs that failed or were stopped:\n- \S+ \S+ its job "Rail check": .*Stopped after 60 seconds/);
  assert.match(stdin, /Jobs:\n- "Menu check" \(AI, [^)]*\): 4 runs in the window, 3 found nothing, 0 failed\./);
  assert.match(stdin, /## Cook: Plans the meals\n[\s\S]*?Messages from other bots it has not read:\n- since \S+ \S+, from Web Surfer: Please plan around the rail strike\./);
  assert.match(stdin, /## The Board's tiles\n- Disk space \(under "Homelab"\): value/);
  assert.match(stdin, /Proposed before \(the last 60 days, newest first\):\n\(nothing yet\)/);
  assert.doesNotMatch(stdin, /bank card|4111|secret card/, 'a run the owner left out is read by no checkup');
});

test('the owner\'s pick reaches the Chief in an ordinary turn with the proposals quoted once, and is kept', async () => {
  srv.reply('Done: Web Surfer now uses the saved X login without asking.');
  const chat = await say(chatId, 'Do 1');
  assert.equal(chat.messages.at(-1).text, 'Done: Web Surfer now uses the saved X login without asking.');
  assert.deepEqual(chat.messages.at(-1).read, ['checkup'], 'the turn read what a checkup wrote from the bots\' runs');
  const turn = chiefRuns().at(-1);
  assert.ok(!turn.args.includes('🧭 Chief of Staff · checkup') && !turn.args.includes('--no-session-persistence'), 'a turn of the chat, with the Chief\'s tools');
  assert.match(turn.stdin, /You wrote me this in a new chat after a checkup[^\n]*\n<your-checkup-message>\n2 things I would change after this checkup:/);
  assert.match(turn.stdin, /my pick is my yes: make the changes I pick now/);
  assert.match(turn.stdin, /My message: Do 1/);
  assert.match(turn.stdin, /botdot read my message as my answer to the proposals above and kept it: I pick 1, and not 2\./);
  assert.deepEqual(record().proposals.map((p) => [p.n, p.status]), [[1, 'picked'], [2, 'declined']]);
  srv.reply('You are welcome.');
  await say(chatId, 'Thanks');
  assert.doesNotMatch(chiefRuns().at(-1).stdin, /your-checkup-message|botdot read my message as my answer/, 'quoted once, and a later message is no pick');
});

test('the next checkup is told what was proposed and how the owner answered, and a picked proposal does not come back', async () => {
  const [picked, declined] = record().proposals;
  srv.reply(JSON.stringify({ proposals: [{ ...RULE(), again: picked.id }, { ...JOB(), again: declined.id }] })); // nothing new since the decline
  const r = await checkupNow();
  assert.deepEqual([r.ran, r.posted], [true, false]);
  const { stdin } = checkupRuns().at(-1);
  assert.match(stdin, new RegExp(`- \\[${picked.id}\\] \\S+, Rule, Web Surfer: Use the saved X login[^\\n]*\\(the owner picked it: done, never again\\)`));
  assert.match(stdin, new RegExp(`- \\[${declined.id}\\] \\S+, Job, Web Surfer:[^\\n]*\\(the owner declined it on `));
  assert.equal((await chats()).length, 1);
});

test('deleting the checkup\'s chat leaves its proposals in the record', async () => {
  assert.equal((await srv.api(`/chief/chats/${chatId}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(record().proposals.map((p) => p.status), ['picked', 'declined']);
});

test('no checkup while the Chief is answering the owner', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'Hello' } });
  const run = await srv.nextRun((x) => /Hello/.test(x.stdin), 'the Chief\'s turn');
  assert.deepEqual(await checkupNow(), { ran: false, reason: 'busy' });
  srv.unhold();
  srv.release(run);
  await replyDone(c.id);
});

// ---------- the switches ----------

test('the setting is changed through its route, announced on the feed, and kept across what it does not name', async () => {
  let r = await setting({ on: false });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.checkup.on, r.data.checkup.when], [false, 'Weekdays at 08:00']);
  assert.equal((await f.wait('checkup', (d) => d.on === false)).data.when, 'Weekdays at 08:00');
  r = await setting({ days: ['Monday', 'Thursday'], time: '07:30' });
  assert.deepEqual([r.data.checkup.on, r.data.checkup.days, r.data.checkup.time, r.data.checkup.when], [false, [1, 4], '07:30', 'Mondays and Thursdays at 07:30']);
  await f.wait('checkup', (d) => d.time === '07:30');
  r = await setting({ on: true, webSearch: true });
  assert.deepEqual([r.data.checkup.on, r.data.checkup.webSearch, r.data.checkup.days], [true, true, [1, 4]]);
  assert.deepEqual((await srv.api('/settings')).data.settings.checkup, { on: true, days: [1, 4], time: '07:30', webSearch: true });
});

test('a setting it cannot keep is refused in words, and a time inside the quiet hours with the nearest that works', async () => {
  for (const [body, why] of [[{ time: '8am' }, /time must be HH:MM/], [{ days: [] }, /days must be/], [{ on: 'yes' }, /on must be true or false/]]) {
    const r = await setting(body);
    assert.equal(r.status, 400);
    assert.match(r.data.error, why);
  }
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 22, end: 7 } });
  const r = await setting({ time: '06:30' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /06:30 is inside the quiet hours \(22:00 to 07:00\), when no checkup starts\. The nearest time is 07:00\./);
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } });
  assert.equal((await setting()).data.checkup.time, '07:30', 'what was refused changed nothing');
});

test('with web search switched on a checkup may search, and never fetch', async () => {
  srv.reply('NOTHING');
  await checkupNow();
  const run = checkupRuns().at(-1);
  assert.deepEqual(flagged(run.args, '--tools'), ['WebSearch']);
  assert.deepEqual(flagged(run.args, '--allowedTools'), checkup.tools(true));
  assert.ok(![...flagged(run.args, '--tools'), ...flagged(run.args, '--allowedTools')].some((a) => /fetch/i.test(a)));
  assert.match(run.system, /You may search the web, only to check that a proposal can work/);
  await setting({ webSearch: false });
});

// ---------- a checkup the owner asks for, in a chat ----------

// A turn the owner started in a chat, held while `during` makes the Chief's calls from it.
async function inOwnersTurn(chatId, text, during) {
  srv.hold();
  await srv.api(`/chief/chats/${chatId}/messages`, { method: 'POST', body: { text } });
  const run = await srv.nextRun((x) => x.stdin.includes(text), "the Chief's turn");
  try { return await during({ headers: { 'X-Chief-Chat': chatId } }); } finally { srv.unhold(); srv.release(run); await replyDone(chatId); }
}

test('the Chief reads the checkup\'s setting any time, changes it only in a turn the owner started, and nothing else of the settings', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const as = { headers: { 'X-Chief-Chat': c.id } };
  assert.equal((await srv.asChief('/settings/checkup')).status, 200);
  for (const from of [{}, as]) { // no turn at all, and a chat where no turn is going
    const r = await srv.asChief('/settings/checkup', { method: 'PUT', ...from, body: { time: '09:00' } });
    assert.equal(r.status, 403);
    assert.match(r.data.error, /only in a turn the user started/);
  }
  assert.equal((await setting()).data.checkup.time, '07:30', 'nothing changed');
  await inOwnersTurn(c.id, 'Checkups on weekdays at 8 again, please', async (turn) => {
    assert.equal((await srv.asChief('/settings/checkup', { method: 'PUT', ...turn, body: { days: [1, 2, 3, 4, 5], time: '08:00' } })).data.checkup.when, 'Weekdays at 08:00');
    assert.equal((await srv.asChief('/settings', { method: 'PUT', ...turn, body: { chiefRules: 'x' } })).status, 403);
  });
});

test('the Chief switches web search on only before its turn read anything that is not the owner\'s', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await inOwnersTurn(c.id, 'Let checkups search the web', async (turn) => {
    assert.equal((await srv.asChief('/settings/checkup', { method: 'PUT', ...turn, body: { webSearch: true } })).data.checkup.webSearch, true);
    await srv.asChief('/settings/checkup', { method: 'PUT', ...turn, body: { webSearch: false } });
    await srv.asChief('/chief/checkup', turn); // the bots' runs: not the owner's words
    const r = await srv.asChief('/settings/checkup', { method: 'PUT', ...turn, body: { webSearch: true } });
    assert.equal(r.status, 403);
    assert.match(r.data.error, /can't switch a checkup's web search on/);
    assert.equal((await srv.asChief('/settings/checkup', { method: 'PUT', ...turn, body: { webSearch: false } })).status, 200, 'switching it off is always allowed');
  });
  assert.equal((await setting()).data.checkup.webSearch, false);
});

test('the owner\'s general settings route leaves the checkup alone: it has its own, which announces a change', async () => {
  await srv.api('/settings', { method: 'PUT', body: { checkup: { on: false, time: '11:11' } } });
  assert.deepEqual([(await setting()).data.checkup.on, (await setting()).data.checkup.time], [true, '08:00']);
});

test('asked for a checkup in a chat, the Chief is handed the same records, with the switch off too, and its proposals are kept for that chat', async () => {
  await setting({ on: false });
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const kept = record();
  fs.writeFileSync(path.join(srv.data, 'checkups.json'), JSON.stringify({ ...kept, ranAt: undefined })); // as before any checkup ran: the whole window
  const before = (await setting()).data.checkup.lastRanAt;
  await inOwnersTurn(c.id, 'Run a checkup now', async (turn) => {
    const got = (await srv.asChief('/chief/checkup', turn)).data;
    assert.match(got.records, /## Web Surfer: Looks things up on the web\nChats the owner started:/);
    assert.match(got.records, /## The owner's chats with you\n[\s\S]*Owner: Hello/, 'the chats with the Chief in the window');
    assert.doesNotMatch(got.records, /bank card|4111/);
    assert.ok(got.proposedBefore.some((l) => /the owner picked it: done, never again/.test(l)));
    assert.deepEqual([got.on, got.when], [false, 'Weekdays at 08:00']);
    const made = (await srv.asChief('/chief/checkup/proposals', { method: 'POST', ...turn, body: { proposals: [{ kind: 'tile', bot: '', change: 'A tile with today\'s 06:25 train.', day: today(), evidence: 'you asked about the train twice' }, { kind: 'rule', bot: 'Nobody', change: 'x', day: today(), evidence: 'y' }, { ...RULE() }] } })).data;
    assert.deepEqual(made.proposals, [{ n: 1, kind: 'tile', bot: '', change: 'A tile with today\'s 06:25 train.', evidence: 'you asked about the train twice', day: today() }], 'not one for a bot that does not exist, nor the one the owner already picked');
    assert.match(made.text, /^One thing I would change after this checkup:\n\n1\. \*\*Tile:\*\* A tile with today's 06:25 train\./);
    assert.deepEqual(made.choices, ['Do it', 'Not now']);
  });
  assert.equal((await setting()).data.checkup.lastRanAt, before, 'it does not move the scheduled checkup');
  assert.equal((await chats()).filter((x) => /^Checkup,/.test(x.title)).length, 0, 'and opens no chat: the Chief answers where it was asked');
  // An answer that is no plain pick: the Chief says what it did.
  await inOwnersTurn(c.id, 'Do it, but make it a wide one', async (turn) => {
    assert.equal(record().proposals.find((p) => p.chatId === c.id).status, 'open');
    assert.deepEqual((await srv.asChief('/chief/checkup/outcome', { method: 'POST', ...turn, body: { picked: [1] } })).data, { decided: [{ n: 1, status: 'picked' }] });
  });
  assert.equal(record().proposals.find((p) => p.chatId === c.id).status, 'picked');
  // Outside a turn the owner started nothing is kept.
  const late = await srv.asChief('/chief/checkup/outcome', { method: 'POST', headers: { 'X-Chief-Chat': c.id }, body: { declined: [1] } });
  assert.equal(late.status, 403);
  fs.writeFileSync(path.join(srv.data, 'checkups.json'), JSON.stringify({ ...record(), ranAt: kept.ranAt }));
  await setting({ on: true });
});

test('proposals and their outcome need the chat they belong to', async () => {
  assert.equal((await srv.asChief('/chief/checkup/proposals', { method: 'POST', body: { proposals: [] } })).status, 400);
  assert.equal((await srv.asChief('/chief/checkup/outcome', { method: 'POST', body: { picked: [1] } })).status, 400);
});
