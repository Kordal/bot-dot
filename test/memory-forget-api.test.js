// Forget erases, and a removed note ends (ADR 016), through the real server, the bots' own MCP server and the
// stand-in for Claude: the two verbs and their tools, the gate and the card of a forget that waits, every reader
// outside the store that asks "left out" (the conversation block, read_run, the Chief's get_run, list_runs and
// wait_for_run, its waiting turns), what an app is sent of what a run learned, a note's end, a deleted bot, the
// audit log, and the one wording of what to save. docs/api.md, Memory, "The contract".
// The store's own behaviour is in test/memory-forget.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, restartServer, makeBot, self, waitFor, sleep, readData } = require('./helpers');
const { rpcClient, storedLearned } = require('./memory-helpers');
const { dayOf, dayWords } = require('../lib/prompt-text');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

let serial = 0;
const bot = (server = srv, fields = {}) => makeBot(server, { name: `Forget bot ${++serial}`, emoji: '🧽', mayMessage: [], ...fields });
const isRunOf = (b) => (x) => !!x.self?.env && x.args.includes(`${b.emoji} ${b.name}`);
const ownerAsks = (server, b, prompt) => () => server.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt } }).then((r) => r.data);
const chiefAsks = (server, b, prompt = 'Check the mail.') => () => server.asChief(`/bots/${b.id}/run`, { method: 'POST', body: { prompt } }).then((r) => r.data);
// A run of `b` that is held, so its key stays valid: { run, rec, token, tools, end(reply) }.
async function held(t, b, start, server = srv) {
  server.hold();
  const run = await start();
  const rec = await server.nextRun(isRunOf(b), `a run of ${b.name}`);
  let ended = false;
  const end = async (reply = 'Done.') => { if (ended) return null; ended = true; server.reply(reply); server.release(rec); return server.finished(run.id); };
  t.after(() => end());
  return { run, rec, token: rec.self.env.RUN_TOKEN, tools: rpcClient(t, 'self-mcp.js', rec.self.env), end };
}
// A run that ended, with this request and this reply.
async function ended(t, b, prompt, reply, server = srv) { const h = await held(t, b, ownerAsks(server, b, prompt), server); await h.end(reply); return h.run; }
// The held run asks for a tool, as Claude Code reports it; returns once botdot has noted it.
async function uses(h, name, server = srv) {
  fs.writeFileSync(path.join(server.out, `events-${h.rec.n}.json`), JSON.stringify([{ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${Date.now()}`, name, input: {} }] } }]));
  await waitFor(async () => ((await server.api(`/runs/${h.run.id}`)).data.events || []).some((e) => e.type === 'assistant'), { what: `the run to have asked for ${name}` });
}
const mem = (h, body, server = srv) => self(server, h.token, 'memory', body).then((r) => r.data);
const learnedOf = async (run, server = srv) => storedLearned(server, run.id);
const noteId = (text) => { const id = text.match(/as \[([\w-]+)\]/)?.[1]; assert.ok(id, text); return id; };
const runFile = (server, id) => readData(server.data, path.join('runs', `${id}.json`));
const auditLog = (server) => { try { return fs.readFileSync(path.join(server.data, 'audit.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.action.startsWith('memory.')); } catch { return []; } };
const pendingOf = async (b, server = srv) => (await server.api('/memory/pending?guarded=1')).data.filter((p) => p.botId === b.id);
const inDays = (n) => dayOf(new Date(Date.now() + n * 864e5));

test('features announce the two verbs', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('memory-forget'));
});

// What the first test leaves behind, for the tests of the readers below it: a bot whose owner had it forget.
let scene = null;

test('in a run the owner started that has read nothing outside, a forget erases at once, and the bot\'s next run is told nothing of it', async (t) => {
  const b = await bot();
  // The owner said it, and the bot saved it; then it came up in a second chat.
  const first = await held(t, b, ownerAsks(srv, b, 'My dentist is Dr Zebrowska, remember that.'));
  const id = noteId(await first.tools.text('remember', { note: 'The dentist is Dr Zebrowska', topic: 'health' }));
  await first.end('Saved: your dentist is Dr Zebrowska.');
  const second = { run: await ended(t, b, 'Book Dr Zebrowska for Friday.', 'Dr Zebrowska has no slot on Friday.') };
  const other = await ended(t, b, 'What is the capital of Portugal?', 'Lisbon.');
  assert.equal((await learnedOf(first.run))[0].chip, 'Remembered: The dentist is Dr Zebrowska');

  // "Forget what I told you about my dentist": the bot finds the notes and runs, and forgets.
  const asking = await held(t, b, ownerAsks(srv, b, 'Forget what I told you about my dentist.'));
  assert.match(asking.rec.system, /Dr Zebrowska/, 'until then the run is told it');
  assert.match(await asking.tools.text('recall', { query: 'dentist Zebrowska' }), new RegExp(`\\[${id}\\][\\s\\S]*past run ${second.run.id}`));
  const said = await asking.tools.text('forget', { notes: [id], about: 'dentist Zebrowska' });
  assert.match(said, /^Forgotten for good: 1 note erased with its history, and 2 past runs left out of what you, other bots and the Chief read \(this run among them\)\. The owner still sees those chats in their own history\./);
  assert.match(said, new RegExp(`These still match the words you gave:\\nPast runs: run ${second.run.id} \\(\\d{4}-\\d\\d-\\d\\d\\): Book Dr Zebrowska for Friday\\.\\nCall forget again with those that hold what the owner wants forgotten`), 'the answer names what still matches');
  // The second call, with what the answer named: a chat only, so no note is erased.
  const again = await mem(asking, { action: 'forget', runs: [second.run.id], about: 'dentist Zebrowska' });
  assert.deepEqual([again.result, again.erased, again.leftOut, again.still], ['forgotten', 0, [second.run.id], { notes: [], runs: [] }]);
  assert.match(again.say, /Nothing else of yours matches those words/);
  assert.deepEqual((await learnedOf(asking.run)).map((x) => [x.kind, x.text, x.chip]), [['forgot', '1 note', 'Forgot 1 note'], ['forgot', 'what was said in 1 chat', 'Forgot what was said in 1 chat']]);
  await asking.end('Done. I have forgotten what you told me about your dentist; your own chat history still shows it.');

  // What a run learned is kept as a kind and an id: no file of a run holds the note's text as something learned.
  for (const run of [first.run, asking.run]) {
    const file = runFile(srv, run.id);
    assert.equal(file.forgotten, true, 'the mark is in the run\'s own record too');
    assert.ok(!/zebrowska/i.test(JSON.stringify(file.learned)), JSON.stringify(file.learned));
  }
  assert.deepEqual(runFile(srv, first.run.id).learned.map(({ at, ...x }) => x), [{ kind: 'memory', id, what: 'add', unpinned: [] }]);
  assert.equal(runFile(srv, other.id).forgotten, undefined);

  // The chip of the earlier run, as its record reads now; an app is sent no row of either run (ADR 024).
  assert.deepEqual((await learnedOf(first.run)).map((x) => [x.kind, x.text, x.chip]), [['memory', 'a note, since forgotten', 'Remembered a note, since forgotten']]);
  const then = (await srv.api(`/runs/${first.run.id}`)).data;
  assert.deepEqual(then.learned, []);
  assert.deepEqual((await srv.api(`/runs?botId=${b.id}`)).data.find((r) => r.id === asking.run.id).learned, []);

  // The owner's own chat and their search over all chats still hold the runs, whole.
  assert.equal(then.result, 'Saved: your dentist is Dr Zebrowska.');
  assert.equal(then.prompt, 'My dentist is Dr Zebrowska, remember that.');
  assert.deepEqual((await srv.api('/search?q=Zebrowska')).data.map((h) => h.runId).sort(), [first.run.id, second.run.id].sort());
  assert.equal((await srv.api(`/memory/runs/${first.run.id}`, { method: 'PUT', body: { excluded: false } })).status, 409, "a forget's mark is not taken back");

  // The next run of the bot: nothing of it in its prompt (pinned notes, the lookup, the conversation block), and
  // its recall finds nothing.
  const next = await held(t, b, ownerAsks(srv, b, 'Who is my dentist? Is it Zebrowska?'));
  assert.doesNotMatch(next.rec.system, /zebrowska|dentist/i);
  assert.match(next.rec.system, /What is the capital of Portugal\?/, 'the chat that was not forgotten is still in the conversation block');
  assert.match(await next.tools.text('recall', { query: 'dentist Zebrowska', history: true }), /Nothing found/);
  await next.end('I do not know who your dentist is.');
  scene = { b, id, first: first.run, second: second.run, asking: asking.run, other, next: next.run };

  // The audit log: one line per forget, with who and which note's id, and without its text.
  const lines = auditLog(srv).filter((l) => l.bot === b.id);
  assert.deepEqual(lines.map(({ time, ...l }) => l), [
    { actor: b.id, action: 'memory.forgotten', bot: b.id, notes: [id], runs: 2 },
    { actor: b.id, action: 'memory.forgotten', bot: b.id, notes: [], runs: 1 },
  ]);
  assert.ok(!/zebrowska/i.test(fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8')));
});

const leftOutRuns = () => { assert.ok(scene, 'the forget of the test above'); return [scene.first, scene.second, scene.asking]; };

test("left out, in the bot's read_run", async (t) => {
  const [first, second, asking] = leftOutRuns();
  const h = await held(t, scene.b, ownerAsks(srv, scene.b, 'Read me my old chats.'));
  for (const run of [first, second, asking]) {
    const r = await h.tools.call('read_run', { run: run.id });
    assert.ok(r.isError);
    assert.match(r.content[0].text, /No past run of yours with that number/);
  }
  assert.match(await h.tools.text('read_run', { run: scene.other.id }), /Lisbon/, 'a run that is not left out is read as before');
});

test("left out, in the Chief's get_run: that it ran and how it ended, nothing it was asked or replied, and not its log", async (t) => {
  const [first] = leftOutRuns();
  const got = (await srv.asChief(`/runs/${first.id}?seen=chief&events=0`)).data;
  assert.deepEqual([got.id, got.botId, got.status, got.leftOut, got.result, got.prompt, got.learned], [first.id, scene.b.id, 'success', true, undefined, undefined, undefined]);
  assert.equal((await srv.asChief(`/runs/${first.id}`)).data.events, undefined);
  assert.ok(!/zebrowska|dentist/i.test(JSON.stringify(got)));
  // Through the Chief's own MCP server, with the note that says why.
  const chief = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const viaTool = await chief.json('get_run', { runId: first.id });
  assert.deepEqual([viaTool.leftOut, viaTool.result, viaTool.prompt], [true, undefined, undefined]);
  assert.match(viaTool.note, /left out of what you read, at the user's wish/);
  assert.equal((await chief.json('get_run', { runId: scene.other.id })).result, 'Lisbon.', 'a run that is not left out is whole');
  // The owner's own app is sent the run whole.
  assert.equal((await srv.api(`/runs/${first.id}?events=0`)).data.result, 'Saved: your dentist is Dr Zebrowska.');
});

test("left out, in the Chief's list_runs", async (t) => {
  const left = leftOutRuns().map((r) => r.id).sort();
  const listed = (await srv.asChief(`/runs?botId=${scene.b.id}&limit=50`)).data;
  assert.deepEqual(listed.filter((r) => r.leftOut).map((r) => r.id).sort(), left);
  assert.ok(!/zebrowska/i.test(JSON.stringify(listed.filter((r) => r.id !== scene.next.id))), 'no text of them');
  assert.equal(listed.find((r) => r.id === scene.other.id).result, 'Lisbon.');
  const chief = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const viaTool = await chief.json('list_runs', { botId: scene.b.id, limit: 50 });
  assert.deepEqual(viaTool.filter((r) => r.leftOut).map((r) => [r.id, r.resultPreview]).sort(), left.map((id) => [id, null]));
  assert.equal((await srv.api(`/runs?botId=${scene.b.id}`)).data.filter((r) => r.leftOut).length, 0, "the owner's own list has them whole");
});

test("left out, in the Chief's wait_for_run", async (t) => {
  const [, second] = leftOutRuns();
  const waited = (await srv.asChief(`/runs/${second.id}/wait?timeout=1&seen=chief`)).data;
  assert.deepEqual([waited.id, waited.status, waited.leftOut, waited.result, waited.prompt], [second.id, 'success', true, undefined, undefined]);
  const chief = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const viaTool = await chief.json('wait_for_run', { runId: second.id, timeoutSeconds: 5 });
  assert.deepEqual([viaTool.leftOut, viaTool.result], [true, undefined]);
  assert.equal((await chief.json('wait_for_run', { runId: scene.other.id, timeoutSeconds: 5 })).result, 'Lisbon.');
});

test("left out, in the Chief's recall, also of its own replies", async () => {
  leftOutRuns();
  assert.deepEqual((await srv.asChief('/memory/search?q=dentist%20Zebrowska&history=1')).data.results.filter((r) => r.runId !== scene.next.id), []);
  // A reply of the Chief's that the owner left out: the Chief's get_run is handed no text of it.
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.unhold();
  srv.reply('The WALRUS plan is ready.');
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Is the walrus plan ready?' } });
  await waitFor(async () => { const c = (await srv.api(`/chief/chats/${chat.id}`)).data; return !c.busy && c.messages.some((m) => m.role === 'chief' && !m.pending); }, { what: "the Chief's reply" });
  const replyId = `chief-${chat.id}-1`;
  assert.equal((await srv.asChief(`/memory/runs/${replyId}`)).data.reply, 'The WALRUS plan is ready.');
  await srv.api(`/memory/runs/${replyId}`, { method: 'PUT', body: { excluded: true } });
  const got = (await srv.asChief(`/memory/runs/${replyId}`)).data;
  assert.deepEqual([got.run_id, got.leftOut, got.reply, got.asked], [replyId, true, undefined, undefined]);
  assert.deepEqual((await srv.asChief('/memory/search?q=walrus%20plan')).data.results, []);
  assert.equal((await srv.api(`/memory/runs/${replyId}`)).data.reply, 'The WALRUS plan is ready.', 'the owner is');
  // The owner's own mark can be taken back, as before.
  assert.equal((await srv.api(`/memory/runs/${replyId}`, { method: 'PUT', body: { excluded: false } })).status, 200);
  assert.equal((await srv.asChief(`/memory/runs/${replyId}`)).data.reply, 'The WALRUS plan is ready.');
});

test('a forget names only what is the bot\'s: its own notes, shared notes and its own runs', async (t) => {
  const mine = await bot();
  const theirs = await bot();
  const foreign = (await srv.api('/memory/notes', { method: 'POST', body: { owner: theirs.id, text: 'A note of another bot' } })).data.note;
  const foreignRun = await ended(t, theirs, 'A question to the other bot', 'Its answer.');
  const shared = (await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'The owner was born in Tartu' } })).data.note;
  const h = await held(t, mine, ownerAsks(srv, mine, 'Forget where I was born.'));
  const none = await mem(h, { action: 'forget', notes: [foreign.id, 'nope00'], runs: [foreignRun.id], about: 'born' });
  assert.deepEqual([none.ok, none.error], [false, `Nothing to forget: name the notes by their [id] and your past runs by their number, from recall. Not yours, or not found: ${foreign.id}, nope00, ${foreignRun.id}.`]);
  const done = await mem(h, { action: 'forget', notes: [shared.id, foreign.id], runs: [foreignRun.id] });
  assert.deepEqual([done.result, done.erased, done.leftOut], ['forgotten', 1, [h.run.id]], 'a shared note of the owner\'s, in the owner\'s own clean run');
  assert.match(done.say, new RegExp(`Not yours, or not found, and left as they are: ${foreign.id}, ${foreignRun.id}\\.`));
  assert.equal((await srv.api(`/memory/notes/${foreign.id}/history`)).status, 200, 'the other bot\'s note is there');
  assert.equal((await srv.api(`/memory/notes/${shared.id}/history`)).status, 404);
  assert.ok(!(await srv.asChief(`/runs/${foreignRun.id}?events=0`)).data.leftOut);
});

test('in a run the owner did not start, and after the run read outside content, a forget erases nothing and waits on a card: the yes erases, the no keeps', async (t) => {
  const b = await bot();
  const wrote = await held(t, b, ownerAsks(srv, b, 'My gate code is MAGNOLIA.'));
  const id = noteId(await wrote.tools.text('remember', { note: 'The gate code is MAGNOLIA' }));
  await wrote.end('Saved.');
  const cards = async () => (await pendingOf(b)).map((p) => [p.action, p.title, p.meta, p.yes, p.no, p.guarded, p.text, p.notes.map((n) => n.id)]);

  // A run the Chief started.
  const chiefs = await held(t, b, chiefAsks(srv, b, 'Forget the gate code.'));
  const asked = await mem(chiefs, { action: 'forget', notes: [id], about: 'gate code' });
  assert.deepEqual([asked.result, asked.erased], ['waits', undefined]);
  assert.match(asked.say, /^Not done: a forget erases for good, and the owner did not start this run\. It waits for the owner on a card in Needs you \("Forget for good" or "Keep"\)\. Nothing is erased until then\. Tell the owner that\.$/);
  assert.deepEqual(await cards(), [['erase', 'Forget for good', 'in a run you did not start', 'Forget for good', 'Keep', true, 'The gate code is MAGNOLIA', [id]]]);
  assert.equal((await srv.api(`/memory/notes/${id}/history`)).status, 200, 'nothing is erased');
  assert.ok(!runFile(srv, wrote.run.id).forgotten);
  assert.deepEqual((await learnedOf(chiefs.run)).map((x) => [x.kind, x.chip]), [['memory-pending', 'Asked to forget for good: 1 note (waiting for your OK)']]);
  // Never part of "Approve all": an app that does not ask for guarded changes is not sent it, nor is it counted.
  assert.deepEqual((await srv.api('/memory/pending')).data.filter((p) => p.botId === b.id), []);
  const feedCards = (await srv.api('/memory/pending?guarded=1')).data.find((p) => p.botId === b.id);
  assert.ok(!/magnolia/i.test(JSON.stringify(readStore(srv, "SELECT text, detail, reason FROM pending"))), 'the waiting change holds ids, not the text');
  // Keep.
  const no = (await srv.api(`/memory/pending/${feedCards.id}`, { method: 'POST', body: { approve: false } })).data;
  assert.deepEqual([no.declined, no.text], [true, 'Kept']);
  assert.equal((await srv.api('/memory')).data.bots.find((x) => x.id === b.id).notes[0].text, 'The gate code is MAGNOLIA');
  assert.equal((await learnedOf(chiefs.run))[0].chip, 'Asked to forget for good (since answered)');
  await chiefs.end('Asked the owner.');

  // A run the owner started, after it read a web page; and a job's run: both wait, neither is refused.
  const afterWeb = await held(t, b, ownerAsks(srv, b, 'Look something up, then forget the gate code.'));
  await uses(afterWeb, 'WebFetch');
  const second = await mem(afterWeb, { action: 'forget', notes: [id], about: 'gate code' });
  assert.equal(second.result, 'waits');
  assert.match(second.say, /this run has read outside content/);
  assert.equal((await pendingOf(b))[0].meta, 'after reading outside content');
  // Forget for good: the note goes, and the run that wrote it and the run that asked are left out.
  const yes = (await srv.api(`/memory/pending/${second.id}`, { method: 'POST', body: { approve: true } })).data;
  assert.deepEqual([yes.erased, yes.leftOut.sort(), yes.text], [[id], [wrote.run.id, afterWeb.run.id].sort(), 'Forgotten']);
  assert.deepEqual((await srv.api('/memory')).data.bots.find((x) => x.id === b.id).notes, []);
  assert.equal(readStore(srv, 'SELECT COUNT(*) AS n FROM note_versions WHERE note_id = ?', id)[0].n, 0);
  assert.equal(runFile(srv, wrote.run.id).forgotten, true);
  await afterWeb.end('It is forgotten.');
  assert.equal(runFile(srv, afterWeb.run.id).forgotten, true, 'the asking run carries the mark into its record when it ends');
  assert.deepEqual(await pendingOf(b), []);

  // The audit log: the decline, the approval and the forget, each one line.
  assert.deepEqual(auditLog(srv).filter((l) => l.bot === b.id).map(({ time, ...l }) => l), [
    { actor: 'owner', action: 'memory.declined', change: 'erase', bot: b.id, notes: [id] },
    { actor: 'owner', action: 'memory.approved', change: 'erase', bot: b.id, notes: [id] },
    { actor: 'owner', action: 'memory.forgotten', bot: b.id, notes: [id], runs: 2 },
  ]);
});
// What the store holds on disk, read as it is.
function readStore(server, sql, ...args) {
  const db = new DatabaseSync(path.join(server.data, 'memory.db'), { readOnly: true });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
}

test('an approved and a declined memory change each write one line of the audit log', async (t) => {
  const b = await bot();
  const h = await held(t, b, ownerAsks(srv, b, 'Read the page and remember what it says about me.'));
  await uses(h, 'WebFetch');
  // Saved at once (ADR 059); their removals wait.
  const notes = [];
  for (const text of ['The owner plays the cello', 'The owner plays the oboe']) notes.push((await mem(h, { action: 'add', text, scope: 'shared' })).note);
  const one = await mem(h, { action: 'remove', id: notes[0].id });
  const two = await mem(h, { action: 'remove', id: notes[1].id });
  assert.deepEqual([one.result, two.result], ['waits', 'waits']);
  await srv.api(`/memory/pending/${one.id}`, { method: 'POST', body: { approve: true } });
  await srv.api(`/memory/pending/${two.id}`, { method: 'POST', body: { approve: false } });
  assert.deepEqual(auditLog(srv).filter((l) => l.bot === b.id).map(({ time, ...l }) => l), [
    { actor: 'owner', action: 'memory.approved', change: 'remove', bot: b.id, notes: [notes[0].id] },
    { actor: 'owner', action: 'memory.declined', change: 'remove', bot: b.id, notes: [notes[1].id] },
  ]);
  assert.ok(!/cello|oboe/.test(fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8')));
  // The chip of the run that asked no longer holds the text once the change is answered.
  assert.deepEqual((await learnedOf(h.run)).filter((x) => x.kind === 'memory-pending').map((x) => x.chip), ['Asked to remove from the shared memory (since answered)', 'Asked to remove from the shared memory (since answered)']);
  await srv.api(`/memory/notes/${notes[1].id}`, { method: 'DELETE' });
});

test('a removed note is listed and restored by a bot only in a run the owner started', async (t) => {
  const b = await bot();
  const h = await held(t, b, ownerAsks(srv, b, 'Remove the note about the parking spot.'));
  const id = noteId(await h.tools.text('remember', { note: 'The parking spot is number 14', topic: 'car' }));
  assert.match(await h.tools.text('remove_note', { id, reason: 'moved house' }), new RegExp(`^Removed note \\[${id}\\]\\. No bot reads it any more\\. For 30 days the owner can have it brought back; then it is gone\\.$`));
  assert.deepEqual((await learnedOf(h.run)).at(-1), { kind: 'memory-removed', text: 'Removed: The parking spot is number 14', chip: 'Removed: The parking spot is number 14' });
  assert.match(await h.tools.text('recall', { query: 'parking spot', history: true }), /Nothing found/, 'recall, with history too, hands out no removed note');
  await h.end('Removed.');

  // A run the Chief started: neither listed nor restored.
  const chiefs = await held(t, b, chiefAsks(srv, b, 'Bring back the parking note.'));
  assert.doesNotMatch(chiefs.rec.system, /parking spot is number 14/);
  assert.match(await chiefs.tools.text('recall', { query: 'parking', removed: true }), /^Removed notes are listed only in a run the owner started\./);
  const refused = await mem(chiefs, { action: 'restore', id });
  assert.deepEqual([refused.result, refused.say], ['refused', 'Not done: a removed note is brought back only in a run the owner started. The owner can ask you for it in a message.']);
  await chiefs.end('Could not.');
  // The Chief's own tools are handed none either; the owner's app is.
  assert.deepEqual((await srv.asChief('/memory')).data.bots.find((x) => x.id === b.id).deleted, []);
  assert.deepEqual((await srv.asChief('/memory/search?q=parking%20spot&history=1')).data.results.filter((r) => r.kind !== 'run'), []);
  assert.deepEqual((await srv.api('/memory')).data.bots.find((x) => x.id === b.id).deleted.map((v) => v.noteId), [id]);
  assert.deepEqual((await srv.api(`/memory/search?q=parking%20spot&bot=${b.id}&in=notes`)).data.results.map((r) => [r.kind, r.noteId]), [['old', id]]);

  // A run the owner started: listed when asked for, and restored.
  const mine = await held(t, b, ownerAsks(srv, b, 'Bring back the note about my parking spot.'));
  assert.doesNotMatch(mine.rec.system.replace(/<conversation>[\s\S]*<\/conversation>/, ''), /parking spot is number 14/, 'not in its notes nor in the lookup');
  assert.match(await mine.tools.text('recall', { query: 'parking', removed: true }), new RegExp(`- removed note \\[${id}\\] \\(yours, the owner said, removed \\d{4}-\\d\\d-\\d\\d, because: moved house\\): The parking spot is number 14`));
  assert.match(await mine.tools.text('recall', { query: 'zeppelin', removed: true }), /^No removed note matches\.$/);
  assert.match(await mine.tools.text('restore_note', { id }), new RegExp(`^Brought back note \\[${id}\\]: “The parking spot is number 14”, pinned\\.$`));
  assert.deepEqual((await learnedOf(mine.run)).map((x) => [x.kind, x.chip]), [['memory-restored', 'Restored: The parking spot is number 14']]);
  const back = (await srv.api('/memory')).data.bots.find((x) => x.id === b.id).notes[0];
  assert.deepEqual([back.id, back.topic, back.source], [id, 'car', 'owner']);
  assert.match((await mine.tools.call('restore_note', { id })).content[0].text, /No removed note with id/);
  // The same sentence saved again while a note was removed: that note stands, and nothing is brought back.
  const twice = noteId(await mine.tools.text('remember', { note: 'The bike is in the cellar' }));
  await mine.tools.text('remove_note', { id: twice });
  const again = noteId(await mine.tools.text('remember', { note: 'The bike is in the cellar' }));
  assert.notEqual(again, twice);
  const chips = (await learnedOf(mine.run)).length;
  const none = await mem(mine, { action: 'restore', id: twice });
  assert.deepEqual([none.result, none.say, none.note.id], ['already', `Nothing to bring back: the same note is already there as [${again}].`, again]);
  assert.equal((await learnedOf(mine.run)).length, chips, 'no chip for it');
  // As recall: 25 at most, whatever is asked for.
  assert.equal((await self(srv, mine.token, 'recall', { query: '', removed: true, limit: -1 })).data.results.length, 1);
  assert.equal((await learnedOf(h.run)).at(-1).chip, 'Removed: The parking spot is number 14 (since brought back)');
});

test('remember with an end date saves a passing state for all bots: the chip names the end, every line prints it, and a past day is refused', async (t) => {
  const b = await bot();
  const until = inDays(4);
  const h = await held(t, b, ownerAsks(srv, b, "This week I'm in Berlin."));
  const said = await h.tools.text('remember', { note: 'In Berlin', scope: 'shared', until });
  const id = noteId(said);
  assert.match(said, new RegExp(`^Saved to the shared memory \\(every bot reads it\\) as \\[${id}\\], pinned\\. It holds until ${until}; botdot removes it the day after\\.`));
  assert.deepEqual((await learnedOf(h.run)).map((x) => [x.kind, x.text, x.chip]), [['memory-shared', 'In Berlin', `Remembered for all bots until ${dayWords(until)}: In Berlin`]]);
  const note = (await srv.api('/memory')).data.shared.find((n) => n.id === id);
  assert.deepEqual([note.until, note.source], [until, 'owner']);
  const past = await h.tools.call('remember', { note: 'Was in Paris', scope: 'shared', until: inDays(-2) });
  assert.ok(past.isError);
  assert.match(past.content[0].text, /is in the past \(today is \d{4}-\d\d-\d\d\)\. Give the day it ends, or save it without an end\./);
  assert.match((await h.tools.call('remember', { note: 'In Rome', until: 'next Sunday' })).content[0].text, /Give the end as a calendar day, like 2026-10-11\./);
  assert.match(await h.tools.text('update_memory', { id, note: 'In Berlin', until: inDays(6), reason: 'staying longer' }), /Updated note/);
  assert.equal((await srv.api('/memory')).data.shared.find((n) => n.id === id).until, inDays(6));
  assert.match(await h.tools.text('recall', { query: 'Berlin', in: 'notes' }), new RegExp(`\\(note, shared, pinned, the owner said, \\d{4}-\\d\\d-\\d\\d, until ${inDays(6)}\\) In Berlin`));
  await h.end('Noted, until Sunday.');
  // Every bot's next prompt prints it with its end.
  const other = await bot();
  const next = await held(t, other, ownerAsks(srv, other, 'Where am I this week?'));
  assert.match(next.rec.system, new RegExp(`<shared-memory>[\\s\\S]*- \\[${id}\\] \\(the owner said, \\d{4}-\\d\\d-\\d\\d, until ${inDays(6)}\\) In Berlin[\\s\\S]*</shared-memory>`));
  // After outside content a shared one is saved at once with its end (ADR 059).
  await uses(next, 'WebFetch');
  const later = await mem(next, { action: 'add', text: 'In Hamburg', scope: 'shared', until: inDays(2) });
  assert.deepEqual([later.result, later.note.until], ['saved', inDays(2)]);
  for (const n of [id, later.note.id]) await srv.api(`/memory/notes/${n}`, { method: 'DELETE' });
});

test('what to save is stated once, where the instructions are built, and the tools\' descriptions repeat none of it', async (t) => {
  const b = await bot();
  const h = await held(t, b, ownerAsks(srv, b, 'Hello.'));
  const sys = h.rec.system;
  assert.equal(sys.split('What to save, and what not.').length - 1, 1, 'once');
  for (const said of [
    /Save what the owner states or decides/,
    /A decision goes in with its date and with what it replaces/,
    /When the owner takes something back \("don't use Redis anymore"\), save it as a rule that holds now \("Do not use Redis"\), also when you have no earlier note about it\./,
    /A passing state is something true about the owner for a time[^.]*: save it for all bots \(scope "shared"\) with the day it ends in "until"/,
    /When they gave no end and none follows from what they said, ask until when, and save it once you know\./,
    /Do not save a maybe or a guess \("we might use Redis"\), what a tool, a web page or a file said, a one-off result, small talk, or a secret\./,
    /"shared" is for who the owner is/,
    /Two verbs take a note away\. Remove \(remove_note\) is for a note that is no longer true, was replaced or is of no use/,
    /Forget \(forget\) is only for when the owner asks you to forget something: it erases the notes for good, with their history, and leaves the past runs that held it out/,
    /Say that something is saved, removed or forgotten only after the tool answered that it is/,
  ]) assert.match(sys, said);
  // Nothing else in the prompt says what to save: the sentences that did are gone.
  assert.doesNotMatch(sys, /Save a lesson with remember when|Use "shared" for lasting facts|Don't save one-off results or secrets/);
  const tools = (await h.tools.request('tools/list')).tools.filter((x) => ['remember', 'update_memory', 'remove_note', 'restore_note', 'forget', 'set_pin'].includes(x.name));
  assert.deepEqual(tools.map((x) => x.name).sort(), ['forget', 'remember', 'remove_note', 'restore_note', 'set_pin', 'update_memory']);
  for (const tool of tools) {
    assert.doesNotMatch(JSON.stringify(tool), /preference|correction|decision|one-off|secret|a maybe|a guess|small talk|lasting fact|about the owner|site quirk|how-to|Never store|Use it for/i, tool.name);
  }
  assert.match(tools.find((x) => x.name === 'forget').description, /^Forget for good\. It erases the notes you name .* with their history, and leaves the past runs you name, and the runs that wrote those notes, out of everything bots and the Chief read\. It cannot be undone\./);
  assert.match(tools.find((x) => x.name === 'remove_note').description, /^Remove a note .*: no bot reads it any more\. For 30 days it can be brought back with restore_note; then it is gone\.$/);
  // The review's prompt names the two verbs as they are, and keeps its hands off forget.
  const reviewed = await bot();
  srv.hold();
  const r = (await srv.api(`/memory/review/${reviewed.id}`, { method: 'POST' })).data;
  const rec = await srv.nextRun(isRunOf(reviewed), 'the review');
  t.after(async () => { srv.release(rec); await srv.finished(r.run.id); });
  assert.match(rec.stdin, /remove_note the other\), update outdated ones with a reason, remove ones that are clearly wrong\..*Never use forget here: it erases for good and is only for the owner's own request\./);
  assert.doesNotMatch(rec.stdin, /forget the notes you moved|forget the other|the owner's preferences and corrections/);
  assert.equal(rec.system.split('What to save, and what not.').length - 1, 1);
});

test('after a bot is deleted, no note, version, waiting change or indexed run of it remains, also after a restart', async (t) => {
  let own = await startServer();
  t.after(async () => { own.unhold(); await own.stop(); fs.rmSync(own.dir, { recursive: true, force: true }); });
  const b = await bot(own);
  const stays = await bot(own);
  const h = await held(t, b, ownerAsks(own, b, 'The OKAPI lives in the Ituri forest.'), own);
  const id = noteId(await h.tools.text('remember', { note: 'The OKAPI lives in the Ituri forest' }));
  await h.tools.text('update_memory', { id, note: 'The OKAPI lives in the Ituri rainforest' });
  await uses(h, 'WebFetch', own);
  const shared = (await mem(h, { action: 'add', text: 'The owner likes the zoo', scope: 'shared' }, own)).note; // shared: it outlives the bot
  assert.equal((await mem(h, { action: 'remove', id: shared.id }, own)).result, 'waits'); // a removal after the web waits (ADR 059)
  await h.end('The OKAPI is noted.');
  const kept = await ended(t, stays, 'A question about the TAPIR', 'The TAPIR is fine.', own);
  assert.equal((await own.api('/search?q=okapi')).data.length, 1);

  assert.equal((await own.api(`/bots/${b.id}`, { method: 'DELETE' })).status, 200);
  const left = () => ({
    rows: ['notes WHERE owner', 'note_versions WHERE owner', 'pending WHERE bot_id', 'runs WHERE bot_id', 'runs_fts WHERE bot_id'].map((w) => readStore(own, `SELECT COUNT(*) AS n FROM ${w} = ?`, b.id)[0].n),
    waiting: readStore(own, 'SELECT COUNT(*) AS n FROM pending')[0].n,
  });
  assert.deepEqual(left(), { rows: [0, 0, 0, 0, 0], waiting: 0 });
  assert.deepEqual((await own.api('/search?q=okapi')).data, []);
  assert.ok(fs.existsSync(path.join(own.data, 'runs', `${h.run.id}.json`)), 'its run stays in the run history');

  own = await restartServer(own);
  assert.deepEqual(left(), { rows: [0, 0, 0, 0, 0], waiting: 0 }, 'the start does not index its runs again');
  assert.deepEqual((await own.asChief('/memory/search?q=okapi')).data.results, []);
  assert.deepEqual((await own.asChief('/memory/search?q=tapir')).data.results.map((r) => r.runId), [kept.id], 'another bot\'s runs are indexed as before');
});

test('botdot stopped before a forget reached a run\'s file completes it at the next start, and rebuilds the index of what runs learned once', async (t) => {
  let own = await startServer();
  t.after(async () => { own.unhold(); await own.stop(); fs.rmSync(own.dir, { recursive: true, force: true }); });
  const b = await bot(own);
  const wrote = await held(t, b, ownerAsks(own, b, 'The safe opens with KESTREL.'), own);
  const id = noteId(await wrote.tools.text('remember', { note: 'The safe opens with KESTREL' }));
  await wrote.end('Saved.');
  const kept = await held(t, b, ownerAsks(own, b, 'I like green tea.'), own);
  await kept.tools.text('remember', { note: 'Likes green tea' });
  await kept.end('Saved.');
  const asking = await held(t, b, ownerAsks(own, b, 'Forget how the safe opens.'), own);
  assert.equal((await mem(asking, { action: 'forget', notes: [id], about: 'safe KESTREL' }, own)).erased, 1);
  await asking.end('Forgotten.');

  // As a stop in between leaves it: the store holds the forget, the run's file has no mark yet. And the index as
  // the code before this task made it: version 3, with what a run learned as text.
  own = await restartServer(own, (data) => {
    const file = path.join(data, 'runs', `${wrote.run.id}.json`);
    const { forgotten, ...meta } = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify(meta));
    const db = new DatabaseSync(path.join(data, 'memory.db'));
    db.prepare("UPDATE runs SET learned = 'Likes green tea' WHERE run_id = ?").run(kept.run.id);
    db.prepare("UPDATE runs_fts SET learned = 'Likes green tea' WHERE run_id = ?").run(kept.run.id);
    db.exec("UPDATE meta SET value = '3' WHERE key = 'index_version'");
    db.close();
  });
  assert.equal(runFile(own, wrote.run.id).forgotten, true, 'completed at the start');
  assert.ok((await own.asChief(`/runs/${wrote.run.id}?events=0`)).data.leftOut);
  assert.match(own.log.join(''), /\[memory\] the index of past runs no longer holds what a run learned as text: 3 entries made again/, 'the three runs that learned something, each from its file');
  assert.equal(readStore(own, 'SELECT learned FROM runs WHERE run_id = ?', kept.run.id)[0].learned, `memory: note ${readStore(own, "SELECT id FROM notes WHERE text = 'Likes green tea'")[0].id}`);
  assert.equal(readStore(own, "SELECT COUNT(*) AS n FROM runs_fts WHERE runs_fts MATCH 'learned : green'")[0].n, 0);
  assert.equal(readStore(own, "SELECT value FROM meta WHERE key = 'index_version'")[0].value, require('../lib/memory').INDEX_VERSION);

  own = await restartServer(own);
  assert.doesNotMatch(own.log.join(''), /made again/, 'a second start rebuilds nothing');
  assert.equal(runFile(own, wrote.run.id).forgotten, true);
});

test('no waiting turn of the Chief and no unread result in its chat hands a left-out run\'s text to the Chief', async (t) => {
  let own = await startServer();
  t.after(async () => { own.unhold(); await own.stop(); fs.rmSync(own.dir, { recursive: true, force: true }); });
  const b = await bot(own);
  const secret = await ended(t, b, 'Plan the surprise', 'The surprise is a trip to SARAJEVO.', own);
  const fine = await ended(t, b, 'What is on today', 'A walk in the PARK.', own);
  own.unhold();
  const chat = (await own.api('/chief/chats', { method: 'POST' })).data;
  await own.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Good morning' } });
  await waitFor(async () => { const c = (await own.api(`/chief/chats/${chat.id}`)).data; return !c.busy && c.messages.some((m) => m.role === 'chief' && !m.pending); }, { what: "the Chief's first reply" });

  // As botdot left it when it stopped: two results of bots wait to be told to the Chief, and two stand in its
  // chat unread. Meanwhile a forget left the first run out.
  const from = { id: b.id, name: b.name, emoji: b.emoji, color: b.color };
  const told = (run, text) => ({
    prompt: `botdot writes this, not the user: nobody typed it. ${b.name} has ended its run ${run.id}.\n<bot-reply>\n${text}\n</bot-reply>`,
    message: null, otherwise: { role: 'report', from, text, runId: run.id }, title: `${b.name}: ${text}`, at: new Date().toISOString(),
    from: { botId: b.id, name: b.name, runId: run.id }, unlessSeen: run.id,
  });
  own = await restartServer(own, (data) => {
    const meta = JSON.parse(fs.readFileSync(path.join(data, 'runs', `${secret.id}.json`), 'utf8'));
    fs.writeFileSync(path.join(data, 'runs', `${secret.id}.json`), JSON.stringify({ ...meta, forgotten: true }));
    fs.writeFileSync(path.join(data, 'chief-waiting-turns.json'), JSON.stringify({ [chat.id]: [told(secret, 'The surprise is a trip to SARAJEVO.'), told(fine, 'A walk in the PARK.')] }));
    const file = path.join(data, 'chief', `${chat.id}.json`);
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    c.messages.push({ role: 'report', from, text: 'An earlier word about SARAJEVO.', runId: secret.id, at: new Date().toISOString() }, { role: 'report', from, text: 'An earlier word about the PARK.', runId: fine.id, at: new Date().toISOString() });
    fs.writeFileSync(file, JSON.stringify(c));
  });
  // The turn about the run that is not left out starts; the other is dropped, and nothing of it is posted.
  const turn = await own.nextRun((r) => !!r.botdot && /A walk in the PARK\./.test(r.stdin), 'the turn about the other run');
  assert.doesNotMatch(turn.stdin, /SARAJEVO/);
  await waitFor(async () => !(await own.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to finish' });
  assert.deepEqual(fs.existsSync(path.join(own.data, 'chief-waiting-turns.json')) ? readData(own.data, 'chief-waiting-turns.json') : {}, {});
  // The owner writes: the turn is told the unread result of the run that is not left out, and not the other.
  await own.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Anything new?' } });
  const reply = await own.nextRun((r) => !!r.botdot && /Anything new\?/.test(r.stdin), "the Chief's turn");
  assert.match(reply.stdin, /An earlier word about the PARK\./);
  assert.doesNotMatch(reply.stdin, /SARAJEVO/);
  await sleep(100);
  assert.ok(!own.runs().some((r) => r.botdot && /SARAJEVO/.test(`${r.stdin}\n${r.system}`)), 'no turn of the Chief was handed it');
  // The owner's own chat still shows what was posted there.
  assert.ok((await own.api(`/chief/chats/${chat.id}`)).data.messages.some((m) => /SARAJEVO/.test(m.text)));
});
