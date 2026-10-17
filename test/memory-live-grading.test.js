// The parts of the live memory conversations (test/live/) that need no Claude: whether a question is a fresh
// conversation, the grade of what a bot saved, and the comparison of a later run with a baseline. The conversations
// themselves run by hand, on real Claude: BOT_DOT_TEST_LIVE_CLAUDE=1 npm run test:live.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const chatHistory = require('../lib/chat-history');
const { conversationOf, heldIn, valuesOf, realDate, grade, WRITE_SCENARIOS } = require('./live/grading');
const { report, comparison, verdict } = require('./live/report');
const { ROOT, startServer, makeBot } = require('./helpers');

const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
const scenario = (name) => WRITE_SCENARIOS.find((w) => w.name.includes(name));

// A bot's appended prompt around the block, as lib/bots.js startRun writes it.
const promptWith = (block) => ['You are 🏠 Home Helper, a bot in botdot.', block ? `Your chat with the owner as they saw it, oldest first:\n<conversation>\n${block}\n</conversation>\n${chatHistory.NOTE}` : '', 'Possibly relevant, from your memory:\n<possibly-relevant>\n- note [ab12cd] (yours, 2026-09-01): The code for the bike lock is 4821.\n</possibly-relevant>'].filter(Boolean).join('\n\n');
const taught = (days) => ({ id: '20260930101112-4821ab', botId: 'b1', status: 'success', trigger: 'manual', customPrompt: true, startedAt: daysAgo(days), prompt: 'Please remember: the code for the bike lock in the garage is 4821.', result: 'Saved.' });

test('a taught exchange inside the window of the conversation block is found in the asking run\'s prompt, and one past it is not', () => {
  // Five days, as the suite aged its runs before: inside the block since it reaches back seven days.
  const inside = promptWith(chatHistory.build([taught(5)]));
  assert.deepEqual(heldIn(conversationOf(inside), ['4821']), ['4821']);
  // Past the window, as the suite ages them now: no block at all, and the fact only where memory put it.
  assert.equal(chatHistory.build([taught(chatHistory.DAYS + 1)]), '');
  const outside = promptWith('');
  assert.match(outside, /4821/, 'the lookup still hands the note over');
  assert.equal(conversationOf(outside), '');
  assert.deepEqual(heldIn(conversationOf(outside), ['4821']), []);
});

// The check looks for the block by its tag, so it must be the tag botdot writes: with another one it would find no
// block and pass every question. Here the prompt is the one a run is really started with.
test('the conversation block is found in the prompt botdot builds for a bot\'s next message', async (t) => {
  const srv = await startServer();
  t.after(async () => { await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); });
  const bot = await makeBot(srv, { name: 'Home Helper' });
  srv.reply('Saved.');
  const teach = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Please remember: the code for the bike lock in the garage is 4821.' } });
  await srv.finished(teach.data.id);
  await srv.nextRun();
  const asking = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: "What's the code for the bike lock?" } });
  const started = await srv.nextRun();
  await srv.finished(asking.data.id);
  const block = conversationOf(started.system);
  assert.match(block, /^\[run /, 'the block of the asking run, from its first exchange on');
  assert.deepEqual(heldIn(block, ['4821']), ['4821']);
  assert.doesNotMatch(block, /<\/?conversation>/);
});

test('a value is found only as a whole word, as written, and "unknown" is no value', () => {
  // The run number above holds 4821 inside a longer word: that is not the code.
  const block = chatHistory.build([{ ...taught(1), prompt: 'What is on the list?', result: 'Milk, and the guest Wi-Fi is ABCD-1234 (unknown to me before).' }]);
  assert.match(block, /4821ab/);
  assert.deepEqual(heldIn(block, ['4821', 'abcd-1234', 'ABCD-123', 'unknown', '', undefined]), ['abcd-1234']);
  assert.deepEqual(valuesOf({ expected: 'A', outdated: ['B'], related: ['C'], offLimits: ['D'] }), ['A', 'B', 'C', 'D']);
  assert.deepEqual(valuesOf({ expected: 'unknown' }), ['unknown']);
});

test('a note is graded by what was said, for whom it was saved and how many there are', () => {
  const ts = scenario('prefer-typescript');
  assert.deepEqual(grade(ts, { own: [], shared: [], waiting: [] }), { saved: false, own: 0, shared: 0, waiting: 0, notes: 0, wanted: false });
  // A note beside the point is counted, and is not the thing said.
  assert.deepEqual(grade(ts, { own: [{ text: 'The owner said hello.' }], shared: [], waiting: [] }), { saved: false, own: 0, shared: 0, waiting: 0, notes: 1, wanted: false });
  assert.deepEqual(grade(ts, { own: [{ text: 'Prefers TypeScript.' }], shared: [{ text: 'The owner prefers TypeScript for code.' }], waiting: [] }), { saved: true, own: 1, shared: 1, waiting: 0, notes: 2, wanted: true });
  // The topic counts as the note's words; a shared change that waits for the owner's OK is saved, and no note yet.
  assert.equal(grade(ts, { own: [{ text: 'Use it for new code.', topic: 'typescript' }], shared: [], waiting: [] }).saved, true);
  assert.deepEqual(grade(ts, { own: [], shared: [], waiting: [{ action: 'add', text: 'Prefers TypeScript.' }, { action: 'remove', text: 'TypeScript is banned.' }] }), { saved: true, own: 0, shared: 0, waiting: 1, notes: 0, wanted: true });
  assert.equal(grade(scenario('for-this-bot-go'), { own: [{ text: 'Use Go for the code I write.' }], shared: [] }).wanted, true);
  assert.equal(grade(scenario('for-this-bot-go'), { own: [{ text: 'The owner told me to go ahead.' }], shared: [] }).saved, false);
  assert.equal(grade(scenario('for-this-bot-go'), { own: [{ text: 'Write my code in golang.' }], shared: [] }).saved, true);
});

test('"Remember that" wants the note and a reply that says so; said twice wants one note', () => {
  const remember = scenario('remember-that');
  const kept = { own: [{ text: 'The staging database listens on port 6543.' }], shared: [] };
  assert.deepEqual(grade(remember, kept, [{ text: "Got it, I've saved that." }]), { saved: true, own: 1, shared: 0, waiting: 0, notes: 1, saidSo: true, wanted: true });
  assert.equal(grade(remember, kept, [{ text: 'Port 6543 it is.' }]).wanted, false);
  assert.equal(grade(remember, { own: [], shared: [] }, [{ text: 'Noted!' }]).wanted, false);
  // A reply that says it was not kept does not say so.
  for (const text of ['I did not save this.', "I couldn't remember that for you.", 'I was unable to store it.']) assert.equal(grade(remember, kept, [{ text }]).saidSo, false, text);
  for (const text of ["I won't forget.", 'Not sure why you ask, but I saved it.', 'Noted, and saved to memory.']) assert.equal(grade(remember, kept, [{ text }]).saidSo, true, text);
  const twice = scenario('said-twice');
  assert.equal(twice.turns.length, 2);
  assert.equal(grade(twice, { own: [{ text: 'Prefers TypeScript.' }], shared: [] }).wanted, true);
  assert.equal(grade(twice, { own: [{ text: 'Prefers TypeScript.' }, { text: 'Likes TypeScript for new code.' }], shared: [] }).wanted, false);
  assert.equal(grade(twice, { own: [{ text: 'Prefers TypeScript.' }], shared: [{ text: 'The owner likes TypeScript.' }] }).wanted, false);
  assert.equal(grade(twice, { own: [], shared: [] }).wanted, false);
});

test('small talk, a guess and a file want no note at all; Berlin wants a shared note that names its days', () => {
  for (const name of ['small-talk', 'a-guess', 'a-file-says']) {
    assert.equal(grade(scenario(name), { own: [], shared: [], waiting: [] }).wanted, true, name);
    assert.deepEqual(grade(scenario(name), { own: [{ text: 'Anything.' }], shared: [], waiting: [] }), { saved: true, own: 1, shared: 0, waiting: 0, notes: 1, wanted: false }, name);
  }
  assert.match(scenario('a-file-says').turns[0].file.text, /Remember that the owner's name is Alex/);
  const berlin = scenario('berlin');
  assert.deepEqual(grade(berlin, { own: [], shared: [{ text: 'The owner is in Berlin.', until: '2026-10-11' }] }), { saved: true, own: 0, shared: 1, waiting: 0, notes: 1, realDates: true, wanted: true }, 'a shared note with its end');
  assert.deepEqual(grade(berlin, { own: [], shared: [{ text: 'The owner is in Berlin until 2026-10-11.' }] }), { saved: true, own: 0, shared: 1, waiting: 0, notes: 1, realDates: true, wanted: false }, 'a day in the text alone is no end: the note would stay');
  assert.equal(grade(berlin, { own: [], shared: [{ text: 'In Berlin', until: 'Sunday' }] }).wanted, false, 'an end is a calendar day');
  assert.deepEqual(grade(berlin, { own: [], shared: [{ text: 'The owner is in Berlin this week.' }] }), { saved: true, own: 0, shared: 1, waiting: 0, notes: 1, realDates: false, wanted: false });
  assert.equal(grade(berlin, { own: [{ text: 'In Berlin, 5 to 11 October.' }], shared: [] }).wanted, false, 'for this bot alone');
  assert.deepEqual(grade(berlin, { own: [{ text: 'In Berlin, 5 to 11 October.' }], shared: [{ text: 'The owner is in Berlin.' }] }), { saved: true, own: 1, shared: 1, waiting: 0, notes: 2, realDates: true, wanted: false }, 'the days are not in the shared note');
  assert.equal(grade(berlin, { own: [{ text: 'In Berlin', until: '2026-10-11' }], shared: [] }).wanted, false, 'with its end, for this bot alone');
  assert.equal(grade(berlin, { own: [], shared: [], waiting: [{ action: 'add', text: 'In Berlin', until: '2026-10-11' }] }).wanted, false, 'not shared until the owner says yes');
  for (const text of ['until 2026-10-11', 'to 11.10.2026', 'through October 11th', 'until the 11th of October', '5-11 Oct', 'from Oct. 5']) assert.equal(realDate(text), true, text);
  for (const text of ['this week', 'until Sunday', 'in October 2026', 'for 5 days', 'version 2.1.284', 'it may 2x the load', 'plans 1 may change', 'open 24/7']) assert.equal(realDate(text), false, text);
});

test('ten write-side scenarios, each with a name of its own', () => {
  assert.equal(WRITE_SCENARIOS.length, 10);
  assert.equal(new Set(WRITE_SCENARIOS.map((w) => w.name)).size, 10);
  for (const w of WRITE_SCENARIOS) assert.ok(w.turns.length && w.turns.every((t) => t.say) && typeof w.wanted === 'function' && w.says, w.name);
});

// ---------- the comparison, on two made-up result files ----------

const question = (id, correct) => ({ id, expected: '4821', score: { answer: correct ? '4821' : 'unknown', correct, usedRecall: true, searches: 1, readRun: 0, foundAnswer: correct, outdated: 0, offLimits: 0, irrelevant: correct ? 0 : 2, givenAnswer: correct, givenOffLimits: 0, givenExtra: 0 }, records: correct ? [{ holds: 'answer' }] : [], result: { durationMs: 6000, contextTokens: 30000, calls: [{ name: 'recall' }] } });
const reading = (name, id, rights) => rights.map((correct, i) => ({ scenario: name, rep: i + 1, questions: [{ ...question(id, correct), scenario: name, rep: i + 1 }] }));
const written = (name, stores) => stores.map((store, i) => {
  const s = scenario(name);
  const full = { own: [], shared: [], waiting: [], ...store };
  return { scenario: s.name, says: s.says, rep: i + 1, turns: [{ say: s.turns[0].say, text: 'OK.' }], store: full, grade: grade(s, full, [{ text: 'OK.' }]) };
});
const note = (text, until) => [{ text, pinned: true, ...(until ? { until } : {}) }];

const BASELINE = {
  date: '2026-10-07', commit: 'aaaaaaa', repeat: 3, models: ['claude-test-1'],
  results: [...reading('recall-taught-fact', 'bike-lock', [true, true, false]), ...reading('unknown-fact', 'dentist', [true, true, true]), ...reading('long-answer', 'part-number', [true, false, false])],
  writes: [
    ...written('prefer-typescript', [{ own: note('Prefers TypeScript.') }, {}, {}]),
    ...written('small-talk', [{}, {}, {}]),
    ...written('a-guess', [{}, {}, { own: note('Might use Redis.') }]),
    ...written('berlin', [{ own: note('In Berlin this week.') }, {}, {}]),
  ],
};
const LATER = {
  date: '2026-10-20', commit: 'bbbbbbb', repeat: 3, models: ['claude-test-1'],
  results: [...reading('recall-taught-fact', 'bike-lock', [true, true, true]), ...reading('unknown-fact', 'dentist', [true, true, true]), ...reading('long-answer', 'part-number', [false, false, false])],
  writes: [
    ...written('prefer-typescript', [{ own: note('Prefers TypeScript.') }, { shared: note('The owner prefers TypeScript.') }, { own: note('Prefers TypeScript.') }]),
    ...written('small-talk', [{}, {}, {}]),
    ...written('a-guess', [{ own: note('Might use Redis.') }, { own: note('Considering Redis.') }, {}]),
    ...written('berlin', [{ shared: note('The owner is in Berlin until 2026-10-11.', '2026-10-11') }, { shared: note('In Berlin, 5 to 11 October.', '2026-10-11') }, {}]),
    { scenario: 'w01-remember-that', rep: 1, error: 'Code Helper didn\'t answer' },
  ],
};
const row = (text, start) => text.split('\n').find((l) => l.startsWith(`| ${start}`)) || '';

test('a later run next to the baseline: every question and every write-side scenario is better, the same or worse', () => {
  assert.equal(verdict({ good: 1, n: 3 }, { good: 2, n: 3 }), 'better');
  assert.equal(verdict({ good: 2, n: 3 }, { good: 4, n: 6 }), 'the same');
  assert.equal(verdict({ good: 3, n: 3 }, { good: 5, n: 6 }), 'worse');
  assert.equal(verdict({ good: 0, n: 0 }, { good: 3, n: 3 }), '–');
  const text = comparison(BASELINE, LATER);
  assert.match(text, /Baseline: 2026-10-07, aaaaaaa, claude-test-1\. Change: 2026-10-20, bbbbbbb, claude-test-1\./);
  assert.match(row(text, 'recall-taught-fact · bike-lock'), /2\/3 → \*\*3\/3\*\* .* better \|$/);
  assert.match(row(text, 'unknown-fact · dentist'), /\| 3\/3 \|.* the same \|$/);
  assert.match(row(text, 'long-answer · part-number'), /1\/3 → \*\*0\/3\*\* .* worse \|$/);
  assert.match(text, /Questions better: 1, the same: 1, worse: 1\./);
  assert.match(row(text, 'w02-prefer-typescript'), /^\| w02-prefer-typescript: "I prefer TypeScript\." \| 1\/3 → \*\*3\/3\*\* \| 1\/3 → \*\*3\/3\*\* \| 1\/3 → \*\*2\/3\*\* \| 0\/3 → \*\*1\/3\*\* \| 0\/3 \| 1, 0, 0 → \*\*1, 1, 1\*\* \| – \| – \| better \|$/);
  assert.match(row(text, 'w08-small-talk'), /\| 3\/3 \| 0\/3 \|.* the same \|$/);
  assert.match(row(text, 'w09-a-guess'), /^\| w09-a-guess: [^|]* \| 2\/3 → \*\*1\/3\*\* \| 1\/3 → \*\*2\/3\*\* .* worse \|$/);
  assert.match(row(text, 'w06-this-week-berlin'), /\| 0\/3 → \*\*2\/3\*\* \| 1\/3 → \*\*2\/3\*\* \| 1\/3 → \*\*0\/3\*\* \| 0\/3 → \*\*2\/3\*\* \| 0\/3 \| 1, 0, 0 → \*\*1, 1, 0\*\* \| 0\/3 → \*\*2\/3\*\* \| – \| better \|$/);
  assert.match(text, /\*\*Scenarios better: 2, the same: 1, worse: 1\.\*\*/);
  assert.doesNotMatch(text, /A baseline holds for one Claude model/);
  // What failed is said, since it is in no count: here w01 of the later run.
  assert.match(text, /\*\*Failed, and so in no count above\.\*\* Baseline: none\. This run: w01-remember-that #1\./);
  assert.doesNotMatch(comparison(BASELINE, BASELINE), /Failed, and so in no count/);
  // Both files are graded by today's rules, from the notes they kept, whatever grade was written into them then.
  const stale = { ...BASELINE, writes: BASELINE.writes.map((w) => ({ ...w, grade: { ...w.grade, saved: !w.grade.saved, wanted: !w.grade.wanted } })) };
  assert.equal(comparison(stale, LATER), text);
  // A scenario only one side ran, or one that failed, has no verdict.
  assert.match(comparison({ ...BASELINE, writes: [] }, LATER), /\| w08-small-talk: small talk \| – → \*\*3\/3\*\* .* – \|/);
  // Another model: the difference is said, since the verdicts are then the model's as much as the change's.
  assert.match(comparison(BASELINE, { ...LATER, models: ['claude-test-2'] }), /\*\*The baseline was made with claude-test-1 and this run with claude-test-2\.\*\* A baseline holds for one Claude model/);
});

test('the report of one run counts what was saved and asserts nothing; the command line reads both files', (t) => {
  const { results, writes, ...meta } = LATER;
  const text = report(results, meta, writes);
  assert.match(text, /Model: claude-test-1\. Runs per scenario: 3\. Commit: bbbbbbb\./);
  assert.match(row(text, 'w06-this-week-berlin'), /\| 2\/3 \| 0\/3 \| 2\/3 \| 0\/3 \| 1, 1, 0 \| 2\/3 \| – \| 2\/3 \|$/);
  assert.match(text, /\*\*As wanted: 9\/12\.\*\* This counts what happened; nothing here is asserted\./);
  assert.match(text, /- w01-remember-that #1: Code Helper didn't answer/);
  assert.match(text, /- w06-this-week-berlin #1: shared: "The owner is in Berlin until 2026-10-11\."/);
  assert.match(text, /- w08-small-talk #1: no note/);
  // A results file from before the write side existed still renders.
  assert.doesNotMatch(report(results, meta), /What the bots saved/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-live-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const [a, b] = ['baseline.json', 'results.json'].map((f) => path.join(dir, f));
  fs.writeFileSync(a, JSON.stringify(BASELINE));
  fs.writeFileSync(b, JSON.stringify(LATER));
  const run = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'test', 'live', 'report.js'), ...args], { encoding: 'utf8' });
  assert.equal(run('--compare', a, b), comparison(BASELINE, LATER));
  assert.equal(run(b), text);
});

test('without BOT_DOT_TEST_LIVE_CLAUDE=1 the live conversations are skipped with one sentence', () => {
  const { BOT_DOT_TEST_LIVE_CLAUDE, NODE_TEST_CONTEXT, ...env } = process.env; // not as a part of this test run
  const out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', path.join(ROOT, 'test', 'live', 'memory-conversations.test.js')], { encoding: 'utf8', env });
  assert.match(out, /^ok 1 - live memory conversations \(real Claude\) # SKIP set BOT_DOT_TEST_LIVE_CLAUDE=1 to run live conversations$/m);
  assert.match(out, /^# skipped 1$/m);
  assert.match(out, /^# fail 0$/m);
});

// ---------- the recorded baseline ----------

test('the recorded baseline says when, on which model and at which revision it was made, and reads as "the same" next to itself', () => {
  const file = path.join(ROOT, 'test', 'live', 'baseline.json');
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.match(baseline.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(baseline.commit, /^[0-9a-f]{7,}$/, 'made on a committed revision of lib/ and server.js');
  assert.equal(baseline.models.length, 1, 'a baseline holds for one Claude model');
  assert.deepEqual([...baseline.results, ...baseline.writes].filter((r) => r.error), []);
  // Reading: every question a bot was asked ran with nothing it is about inside <conversation>.
  const asked = baseline.results.filter((r) => r.scenario !== 'chief').flatMap((r) => r.questions);
  assert.ok(asked.length > 0 && asked.every((q) => q.result.conversation && q.result.conversation.holds.length === 0));
  // Writing: the ten scenarios, three repeats each.
  for (const w of WRITE_SCENARIOS) assert.equal(baseline.writes.filter((x) => x.scenario === w.name && x.grade).length, baseline.repeat, w.name);
  assert.equal(baseline.repeat, 3);
  // Its report is the one in the repository, and it compares.
  const { results, writes, ...meta } = baseline;
  assert.equal(fs.readFileSync(path.join(ROOT, 'test', 'live', 'baseline.md'), 'utf8'), report(results, meta, writes), 'render it again: node test/live/report.js test/live/baseline.json > test/live/baseline.md');
  const text = comparison(baseline, baseline);
  assert.match(text, /Questions better: 0, the same: \d+, worse: 0\./);
  assert.match(text, /\*\*Scenarios better: 0, the same: 10, worse: 0\.\*\*/);
});
