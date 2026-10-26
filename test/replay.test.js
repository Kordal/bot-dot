// The replay harness (ADR 101, #593): a candidate skill is tried on a bot's past tasks, the bot as it is against the
// bot with the skill, a judge picks the better reply, and the tally goes on the Chief's review card. lib/replay.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const replay = require('../lib/replay');

// ---------- which tasks ----------

const row = (runId, fields = {}) => ({ runId, botId: 'b1', kind: 'claude', source: 'owner', outcome: 'done', opened: true, inputs: { notes: ['n1'] }, ...fields });
const META = {
  r1: { prompt: 'File my taxi expense', result: 'Filed.' },
  r2: { prompt: 'file my  taxi expense', result: 'Again.' }, // the same request: one task
  r3: { prompt: 'Count the open issues', jobName: 'Issue counter', result: '12' },
  r4: { prompt: 'In the group', groupId: 'g1' },
  r5: { prompt: 'A teammate asked', fromBot: { id: 'b2' } },
  r6: { prompt: 'Carried on', continues: 'r0' },
  r7: { prompt: 'Corrected one', result: 'Wrong answer.' },
  r8: { prompt: '' },
};

test('a bot\'s tasks are its own chat\'s, its jobs\' and the Chief\'s, one per request, the newest first', () => {
  const rows = [
    row('r1'), row('r2'), row('r3', { source: 'job' }), row('r4'), row('r5'), row('r6'),
    row('r7', { reasked: true, corrected: true, opened: true }), row('r8'),
    row('x1', { source: 'group' }), row('x2', { source: 'aside' }), row('x3', { kind: 'script', source: 'job' }), row('x4', { outcome: 'passed' }), row('x5'),
  ];
  const tasks = replay.pickTasks(rows, { metaOf: (id) => META[id] || { prompt: `asked ${id}` }, nextOf: (o) => (o.runId === 'r7' ? 'No, the one from Tuesday.' : null), leftOut: (id) => id === 'x5' });
  assert.deepEqual(tasks.map((t) => t.runId), ['r1', 'r3', 'r7']);
  assert.deepEqual(tasks[0], { runId: 'r1', botId: 'b1', request: 'File my taxi expense', job: null, reply: 'Filed.', notes: ['n1'], signal: { kind: 'accepted' } });
  assert.equal(tasks[1].job, 'Issue counter');
  assert.deepEqual(tasks[2].signal, { kind: 'corrected', next: 'No, the one from Tuesday.' }, 'the owner\'s next message is what the judge measures against');
  assert.equal(replay.pickTasks(rows, { metaOf: (id) => META[id], n: 1 }).length, 1);
  assert.equal(replay.signalOf(row('r', { opened: false }), () => null), null, 'a reply never opened says nothing');
  assert.equal(replay.signalOf(row('r', { reasked: true }), () => null), null, 'a re-ask whose message is gone says nothing');
});

// ---------- what a replay is ----------

test('a replay may only read: no MCP server, no commands, and it is told it is a replay', () => {
  const args = replay.args({ llm: ['--model', 'm'], plugins: ['/kit', '/pack'], promptFile: '/p', flag: '--append-system-prompt-file', deny: ['SendMessage'] });
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob,WebSearch,WebFetch,Skill');
  assert.ok(!args.join(' ').includes('Bash') && !args.includes('mcp__vault'));
  assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), { mcpServers: {} });
  assert.ok(args.includes('--strict-mcp-config') && args.includes('--no-session-persistence'));
  assert.deepEqual(args.filter((a, i) => args[i - 1] === '--plugin-dir'), ['/kit', '/pack']);
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  const text = replay.instructions({
    bot: { name: 'Cook', emoji: '🍳', description: 'Plans meals.', prompt: 'Plan the <meals>.', systemPrompt: 'Be short.' },
    pinned: '- likes soup', notes: [{ id: 'n1', text: 'The sheet is KESTREL', source: 'owner', at: '2026-10-01T00:00:00Z' }], skills: [{ plugin: 'botdot', name: 'expense-filing', description: 'Filing' }], job: 'Morning',
  });
  assert.match(text, /This run is a replay/);
  assert.match(text, /You cannot run commands, use connected apps, saved logins, a computer or your memory tools, or message anyone/);
  assert.match(text, /Plan the &lt;meals>\./, 'what others wrote writes no tag');
  assert.match(text, /KESTREL/);
  assert.match(text, /- botdot:expense-filing: Filing/);
  assert.match(text, /your job "Morning"/);
});

test('the judge reads the owner\'s signal first, and its answer is 1, 2, 0 or nothing', () => {
  const p = replay.judgePrompt({ request: 'Which flight?', reply: 'LO 123', signal: { kind: 'corrected', next: 'No, the return one.' } }, 'first', 'second');
  assert.match(p, /<owner>\nNo, the return one\.\n<\/owner>/);
  assert.match(p, /they corrected it/);
  assert.ok(p.indexOf('<owner>') < p.indexOf('<reply-1>'));
  assert.match(replay.judgePrompt({ request: 't', reply: 'kept', signal: { kind: 'accepted' } }, 'a', 'b'), /took this earlier reply without asking again/);
  assert.equal(replay.parseVerdict('{"better": 2, "why": "x"}'), 2);
  assert.equal(replay.parseVerdict('Sure: {"better":0}'), 0);
  for (const bad of ['', 'two', '{"better":3}', '{"better":null}', '{oops']) assert.equal(replay.parseVerdict(bad), null, bad);
  assert.equal(replay.scoreLine({ of: 20, better: 14, worse: 1, same: 5, failed: 0 }), 'Better on 14 of 20 past tasks, worse on 1.');
  assert.equal(replay.scoreLine({ of: 3, better: 0, worse: 0, same: 0, failed: 3 }), 'Better on 0 of 3 past tasks, worse on 0, 3 not tested. None could be replayed.');
  assert.equal(replay.scoreLine(null), '');
  assert.ok(replay.lost({ of: 5, better: 1, worse: 2 }) && !replay.lost({ of: 5, better: 2, worse: 2 }) && !replay.lost(null));
});

test('the pace is the admin\'s: off at 0, at most 60 an hour', () => {
  assert.equal(replay.perHour({}), 0);
  assert.equal(replay.perHour({ BOT_DOT_REPLAYS_PER_HOUR: '12' }), 12);
  assert.equal(replay.perHour({ BOT_DOT_REPLAYS_PER_HOUR: '900' }), 60);
  assert.equal(replay.perHour({ BOT_DOT_REPLAYS_PER_HOUR: '-3' }), 0);
});

// ---------- the score ----------

function harness({ tasks = {}, verdicts = [], pace = 6, swaps = [], fails = new Set() } = {}) {
  let t = 0;
  const slept = [];
  const ran = [];
  const asked = [];
  const r = replay.create({
    tasks: (botId, n) => (tasks[botId] || []).slice(0, n),
    run: async (bot, task, candidate) => { ran.push(`${task.runId}:${candidate ? 'new' : 'old'}`); if (fails.has(task.runId)) throw new Error('no reply'); return candidate ? `new ${task.runId}` : `old ${task.runId}`; },
    ask: async (prompt) => { asked.push(prompt); return JSON.stringify({ better: verdicts.shift() ?? 0 }); },
    perHour: () => (typeof pace === 'function' ? pace() : pace), gapMs: null,
    now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, random: () => (swaps.shift() ? 0.1 : 0.9),
  });
  return { r, slept, ran, asked };
}
const task = (id) => ({ runId: id, request: `task ${id}`, reply: '', notes: [], signal: null });

test('each task runs as it is and with the change, one at a time at the pace, and the judge\'s order says nothing', async () => {
  // Task a: reply 1 is the old one and the judge picks 2 (the new): better. Task b: swapped, so reply 1 is the new one,
  // and the judge picks 2 (the old): worse. Task c: no difference.
  const h = harness({ tasks: { b1: [task('a'), task('b'), task('c')] }, verdicts: [2, 2, 0], swaps: [false, true, false] });
  const t = await h.r.score({ bots: [{ id: 'b1', name: 'Cook' }], candidate: { name: 'x' } });
  assert.deepEqual(t, { of: 3, better: 1, worse: 1, same: 1, failed: 0 });
  assert.deepEqual(h.ran, ['a:old', 'a:new', 'b:new', 'b:old', 'c:old', 'c:new'], 'which goes first changes from task to task');
  assert.deepEqual(h.slept, Array(5).fill(600_000), '6 an hour: ten minutes apart');
  assert.match(h.asked[1], /<reply-1>\nnew b\n<\/reply-1>/);
});

test('a replay or a judge that fails is not tested; no task or replays off is no score', async () => {
  const h = harness({ tasks: { b1: [task('a'), task('b')] }, fails: new Set(['a']), verdicts: [] });
  assert.deepEqual(await h.r.score({ bots: [{ id: 'b1', name: 'Cook' }], candidate: { name: 'x' } }), { of: 2, better: 0, worse: 0, same: 1, failed: 1 });
  assert.equal(await harness({ tasks: {} }).r.score({ bots: [{ id: 'b1' }], candidate: {} }), null);
  assert.equal(await harness({ tasks: { b1: [task('a')] }, pace: 0 }).r.score({ bots: [{ id: 'b1' }], candidate: {} }), null);
  let n = 2;
  const off = harness({ tasks: { b1: [task('a'), task('b')] }, pace: () => (n-- > 0 ? 6 : 0) });
  assert.equal(await off.r.score({ bots: [{ id: 'b1', name: 'Cook' }], candidate: {} }), null, 'switched off meanwhile');
});

test('the tasks of several bots are taken in turn, twenty in all', async () => {
  const many = (p) => Array.from({ length: 15 }, (_, i) => task(`${p}${i}`));
  const h = harness({ tasks: { b1: many('a'), b2: many('b') } });
  const t = await h.r.score({ bots: [{ id: 'b1', name: 'Cook' }, { id: 'b2', name: 'Shopper' }], candidate: {} });
  assert.equal(t.of, 20);
  assert.deepEqual(h.ran.filter((x) => x.endsWith(':old')).slice(0, 4), ['a0:old', 'b0:old', 'a1:old', 'b1:old']);
});

// ---------- on a real botdot ----------

let srv, cook;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_REPLAYS_PER_HOUR: '60', BOT_DOT_REPLAY_GAP_MS: '0' } });
  cook = await makeBot(srv, { name: 'Cook', description: 'Plans the meals and files the expenses' });
});
after(async () => { await srv.stop(); });

const cards = async () => (await srv.api('/asks')).data.filter((a) => a.kind === 'skill');
const notices = async () => {
  const chats = (await srv.api('/chief')).data.chats;
  const all = await Promise.all(chats.map(async (c) => (await srv.api(`/chief/chats/${c.id}`)).data.messages));
  return all.flat().filter((m) => m.notice).map((m) => m.text);
};
const replays = () => srv.runs().filter((x) => /This run is a replay/.test(x.system || ''));

test('the Chief\'s skill proposal is tried on the bot\'s past task before its card, and a worse one gets none', async () => {
  srv.reply('Here is your expense, roughly.');
  const asked = await srv.api(`/bots/${cook.id}/run`, { method: 'POST', body: { prompt: 'File my taxi expense from Monday' } });
  await srv.finished(asked.data.id);
  await waitFor(async () => ((await srv.api(`/bots/${cook.id}/outcomes`)).data.outcomes.length ? true : null), { what: 'the run\'s outcome' });
  const runsBefore = (await srv.api(`/runs?botId=${cook.id}`)).data.length;
  const noteId = (await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'To file an expense: open the KESTREL sheet, add a row, check the total.' } })).data.note.id;

  fs.writeFileSync(path.join(srv.out, 'result-with-expense-filing.txt'), 'SKILLED: filed in KESTREL, total checked.');
  fs.writeFileSync(path.join(srv.out, 'judge-picks.txt'), 'SKILLED');
  srv.reply(JSON.stringify({ proposals: [{ kind: 'skill', name: 'expense-filing', description: 'When the owner asks to file an expense', instructions: '1. Open the KESTREL sheet.', bots: ['Cook'], replaces: [noteId], reason: 'Steps for a recurring task.' }] }));
  assert.equal((await srv.asChief('/memory/review/chief', { method: 'POST' })).status, 200);

  const [card] = await waitFor(async () => { const l = await cards(); return l.length ? l : null; }, { what: 'the card', timeout: 20_000 });
  assert.match(card.reason, /^Better on 1 of 1 past tasks, worse on 0\. Steps for a recurring task\./);
  const report = await waitFor(async () => (await notices()).find((t) => /Memory review/.test(t)), { what: 'the report' });
  assert.match(report, /in place of one note\. Better on 1 of 1 past tasks, worse on 0\./);

  const [a, b] = replays();
  assert.ok(a && b, 'two replays of the task');
  for (const r of [a, b]) {
    assert.equal(r.stdin, 'File my taxi expense from Monday');
    assert.equal(r.self, null, 'no tools of its own');
    assert.equal(r.connectors, null, 'no connected apps');
    assert.equal(r.args[r.args.indexOf('--tools') + 1], 'Read,Grep,Glob,WebSearch,WebFetch,Skill');
    assert.match(r.system, /KESTREL/, 'the shared notes');
  }
  assert.deepEqual([a, b].map((r) => r.skills.includes('botdot:expense-filing')), [false, true], 'the bot as it is, then with the skill');
  assert.equal((await srv.api(`/runs?botId=${cook.id}`)).data.length, runsBefore, 'a replay is no run of the bot');
  assert.equal((await srv.api('/skills/expense-filing')).status, 404, 'nothing saved before the owner\'s yes');
  await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } });

  // A proposal the replays find worse: no card, the report says so, and it is not proposed again.
  const other = (await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'To order food: call the place.' } })).data.note.id;
  fs.writeFileSync(path.join(srv.out, 'judge-picks.txt'), 'When the owner orders food'); // in the reply as it is (the review's answer, which every run of the stand-in gives)
  fs.writeFileSync(path.join(srv.out, 'result-with-food-ordering.txt'), 'I can not.');
  srv.reply(JSON.stringify({ proposals: [{ kind: 'skill', name: 'food-ordering', description: 'When the owner orders food', instructions: 'Call.', bots: ['Cook'], replaces: [other], reason: 'A how-to.' }] }));
  const n = (await notices()).length;
  await srv.asChief('/memory/review/chief', { method: 'POST' });
  const dropped = await waitFor(async () => { const l = await notices(); return l.length > n ? l.at(-1) : null; }, { what: 'the second report', timeout: 20_000 });
  assert.match(dropped, /Dropped the skill “food-ordering”: worse on 1 of 1 past tasks, better on 0\./);
  assert.deepEqual(await cards(), []);
  const saved = JSON.parse(fs.readFileSync(path.join(srv.data, 'chief-review.json'), 'utf8'));
  assert.ok(saved.declined.some((d) => d.key === 'skill:food-ordering'));
  assert.deepEqual(saved.testing, []);
});
