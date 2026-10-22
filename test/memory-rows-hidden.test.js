// A done memory change is no row under a reply (ADR 024), through the real server, the bots' own MCP server and
// the stand-in for Claude: what a run learned, as the apps get it (the run, the list of runs, the run's events and
// its stream), leaves out the notes saved, changed, pinned, removed, brought back and forgotten, and keeps a
// change that waits for the owner and all that is no note. What is stored keeps every item. docs/api.md, "What a
// run learned". The Chief's replies are in test/chief-memory.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { startServer, restartServer, makeBot, self, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

const isRunOf = (b) => (x) => !!x.self?.env && x.args.includes(`${b.emoji} ${b.name}`);
const HIDDEN = ['memory', 'memory-shared', 'memory-removed', 'memory-restored', 'memory-pin', 'forgot'];
const kindsOf = (list) => (list || []).map((x) => x.kind);
async function streamOf(id) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  let got = '';
  try {
    const res = await fetch(`${srv.base}/api/runs/${id}/stream`, { signal: abort.signal });
    for await (const chunk of res.body) got += Buffer.from(chunk).toString();
  } catch { /* timed out: what came is what there is */ } finally { clearTimeout(timer); abort.abort(); }
  return got.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
}
// What the apps get of what a run learned, everywhere they get it: the run, its events, its stream, the list.
async function sent(b, id) {
  const run = (await srv.api(`/runs/${id}`)).data;
  const listed = (await srv.api(`/runs?botId=${b.id}`)).data.find((r) => r.id === id);
  const stream = await streamOf(id);
  const fromEvents = (events) => [
    ...events.filter((e) => e.type === 'learned').map((e) => e.item.kind),
    ...events.filter((e) => e.meta?.learned).flatMap((e) => kindsOf(e.meta.learned)),
  ];
  return { run: kindsOf(run.learned), listed: kindsOf(listed.learned), events: fromEvents(run.events), stream: fromEvents(stream), items: run.learned };
}

test('a run that saved, shared, removed, restored and forgot notes and wrote a skill sends only the skill and the change that waits', async (t) => {
  const b = await makeBot(srv, { name: 'Quiet memory bot', emoji: '🤫', mayMessage: [] });
  srv.hold();
  const ask = { prompt: 'Remember what I tell you.', key: crypto.randomUUID() };
  const run = (await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: ask })).data;
  const rec = await srv.nextRun(isRunOf(b), 'the run');
  const mem = (body) => self(srv, rec.self.env.RUN_TOKEN, 'memory', body).then((r) => r.data);
  const kept = await mem({ action: 'add', text: 'The car is blue' });
  assert.equal(kept.result, 'saved');
  assert.equal((await mem({ action: 'add', text: 'The house is on Elm Street', scope: 'shared' })).result, 'saved');
  assert.equal((await mem({ action: 'remove', id: kept.note.id })).result, 'saved');
  assert.equal((await mem({ action: 'restore', id: kept.note.id })).result, 'saved');
  const gone = await mem({ action: 'add', text: 'The old phone number' });
  assert.equal((await mem({ action: 'forget', notes: [gone.note.id] })).result, 'forgotten');
  assert.equal((await self(srv, rec.self.env.RUN_TOKEN, 'skill', { action: 'create', name: 'wash-the-car', description: 'When the car is dirty', instructions: '# Wash\nStep by step.', reason: 'It worked' })).data.result, 'saved');
  // After outside content a shared note is saved at once and told under the reply (ADR 057); a removal waits.
  fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify([{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: {} }] } }]));
  await waitFor(async () => ((await srv.api(`/runs/${run.id}`)).data.events || []).some((e) => e.type === 'assistant'), { what: 'the run to have read a page' });
  const page = await mem({ action: 'add', text: 'A page says the shop opens at nine', scope: 'shared' });
  assert.equal(page.result, 'saved');
  assert.equal((await mem({ action: 'remove', id: page.note.id })).result, 'waits');

  // The note is still there, and still found by the bot's memory search.
  assert.match(await rpcClient(t, 'self-mcp.js', rec.self.env).text('recall', { query: 'car', in: 'notes' }), /The car is blue/);
  const going = await sent(b, run.id);
  assert.deepEqual(going.events, ['skill', 'memory-shared', 'memory-pending'], 'while it goes');
  srv.release(rec);
  await srv.finished(run.id);

  const done = await sent(b, run.id);
  assert.deepEqual(done.run, ['skill', 'memory-shared', 'memory-pending']);
  assert.deepEqual(done.listed, ['skill', 'memory-shared', 'memory-pending']);
  assert.deepEqual(done.events.slice(0, 3), ['skill', 'memory-shared', 'memory-pending'], 'the learned events');
  assert.deepEqual(done.events.slice(3), ['skill', 'memory-shared', 'memory-pending'], 'the end event\'s record');
  assert.deepEqual(done.stream, done.events, 'the stream sends what the events do');
  const again = (await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: ask })).data;
  assert.deepEqual([again.again, kindsOf(again.learned)], [true, ['skill', 'memory-shared', 'memory-pending']], 'the same request sent again');
  assert.equal(done.items[0].chip, 'Saved the skill wash-the-car');
  assert.equal(done.items[1].chip, 'Remembered for all bots, after outside content: A page says the shop opens at nine');
  assert.equal(done.items[2].chip, 'Asked to remove from the shared memory: A page says the shop opens at nine (waiting for your OK)');

  // Stored: every item, in the run's record and in the memory index.
  const meta = JSON.parse(fs.readFileSync(path.join(srv.data, 'runs', `${run.id}.json`), 'utf8'));
  assert.deepEqual(kindsOf(meta.learned), ['memory', 'memory-shared', 'memory-removed', 'memory-restored', 'memory', 'forgot', 'skill', 'memory-shared', 'memory-pending']);
  const db = new DatabaseSync(path.join(srv.data, 'memory.db'));
  const row = db.prepare('SELECT learned FROM runs WHERE run_id = ?').get(run.id);
  db.close();
  assert.deepEqual(row.learned.split('\n').map((l) => l.split(':')[0]), ['memory', 'memory-shared', 'memory-removed', 'memory-restored', 'memory', 'forgot', 'Saved the skill wash-the-car', 'memory-shared', 'memory-pending']);
});

test('an old run in history sends no done memory change, and no row of it at all when that is all it learned', async () => {
  const b = await makeBot(srv, { name: 'Old memory bot', emoji: '📜', mayMessage: [] });
  srv.unhold();
  const run = (await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt: 'Hello.' } })).data;
  await srv.finished(run.id);
  const file = path.join(srv.data, 'runs', `${run.id}.json`);
  const at = new Date().toISOString();
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  const learned = HIDDEN.map((kind, i) => ({ kind, ...(kind === 'forgot' ? { count: 1, runs: 0 } : { id: `old00${i}` }), at }));
  fs.writeFileSync(file, JSON.stringify({ ...meta, learned }));
  srv = await restartServer(srv);
  const only = await sent(b, run.id);
  assert.deepEqual(only.run, []);
  assert.deepEqual(only.listed, []);
  // What else was done is no row either (ADR 025): an app used, a job changed. What waits for the owner still
  // shows, as it was written, and so does a skill the bot wrote, which no card asks about (ADR 050).
  const didRows = [
    { kind: 'connector', text: 'Used todoist: todoist get all tasks', at },
    { kind: 'job', text: 'Added job Weekly digest', at },
    { kind: 'job', text: 'Removed job Weekly digest', at },
    { kind: 'instructions', text: 'Updated its rules', at },
  ];
  const waits = [
    { kind: 'skill', text: 'Created skill wash-the-car', chip: 'Created skill wash-the-car', at },
    { kind: 'skill-updated', text: 'Updated skill wash-the-car', chip: 'Updated skill wash-the-car', at },
    { kind: 'job', text: 'Added job Disk check (a script, no AI), waiting for your approval', at },
    { kind: 'skill-pending', text: 'Asked to add the skill wash-the-car (waiting for your OK)', chip: 'Asked to add the skill wash-the-car (waiting for your OK)', at },
    { kind: 'instructions', text: 'Proposed changing its rules; waiting for your approval', at },
  ];
  fs.writeFileSync(file, JSON.stringify({ ...meta, learned: [...learned, ...didRows, ...waits] }));
  srv = await restartServer(srv);
  assert.deepEqual((await srv.api(`/runs/${run.id}`)).data.learned, waits);
  assert.deepEqual((await srv.api(`/runs?botId=${b.id}`)).data.find((r) => r.id === run.id).learned, waits);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).learned, [...learned, ...didRows, ...waits], 'the record on disk is as it was');
});
