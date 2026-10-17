// Opt-in: use the real local bge-m3 file, read-only, with a private llama-server and scratch DB.
// BOT_DOT_TEST_EMBED_MODEL=/absolute/path/bge-m3-q8_0.gguf node --test test/memory-bge-m3.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { once } = require('events');
const { scratchMemory, runMeta } = require('./memory-helpers');
const { waitFor } = require('./helpers');

// A private llama-server with the real model, for one test: { child, exited }. EMBED_URL points at it until the test ends.
async function realModel(t) {
  const model = process.env.BOT_DOT_TEST_EMBED_MODEL;
  assert.ok(fs.existsSync(model), 'the existing model file must be available');
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const child = spawn(process.env.BOT_DOT_TEST_EMBED_BIN || 'llama-server', [
    '-m', model, '--embedding', '--host', '127.0.0.1', '--port', String(port),
    '-c', '8192', '-b', '8192', '-ub', '8192', '--parallel', '1', '--log-disable',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (b) => { stderr = (stderr + b).slice(-4000); });
  const exited = once(child, 'exit');
  const previous = process.env.EMBED_URL;
  process.env.EMBED_URL = `http://127.0.0.1:${port}`;
  const url = process.env.EMBED_URL;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    if (previous === undefined) delete process.env.EMBED_URL; else process.env.EMBED_URL = previous;
  });
  await waitFor(async () => {
    assert.equal(child.exitCode, null, stderr);
    try { return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, { timeout: 90_000, what: 'real bge-m3 to load' });
  return { child, exited };
}
const SKIP = !process.env.BOT_DOT_TEST_EMBED_MODEL && 'set BOT_DOT_TEST_EMBED_MODEL to an existing bge-m3 GGUF';

test('real bge-m3: paraphrase and Polish-to-English recall, negatives, scoping and outage fallback', { skip: SKIP, timeout: 180_000 }, async (t) => {
  const { child, exited } = await realModel(t);
  const { memory: m } = scratchMemory(t);
  const coffee = m.addNote('alpha', 'The owner prefers drinking coffee without caffeine.', { pinned: false }).note;
  const home = m.addNote('_shared', 'The owner lives in Warsaw, Poland.', { pinned: false }).note;
  m.addNote('beta', 'The owner prefers drinking decaffeinated coffee.', { pinned: false });
  m.addNote('alpha', 'The bicycle tyres need inflating.', { pinned: false });
  const outage = runMeta({ prompt: 'Investigate incident', result: 'The database server stopped responding and had to be restarted.' });
  m.indexRun(outage);
  const search = (query, kinds = ['notes', 'runs']) => m.search({ query, notesOf: ['alpha', '_shared'], runsOf: ['alpha'], kinds });
  const queries = [
    ['decaffeinated beverage', coffee.id, 'note'],
    ['W jakim mieście mieszka właściciel?', home.id, 'note'],
    ['storage service outage recovery', outage.id, 'run'],
  ];
  for (const [query] of queries) assert.deepEqual(await search(query), [], `no lexical overlap: ${query}`);
  m.setSemanticSettings({ enabled: true });
  assert.equal(await m.embedPending(20), 5);
  for (const [query, id, kind] of queries) {
    const hits = await search(query);
    t.diagnostic(`${query}: ${JSON.stringify(hits.map((r) => ({ kind: r.kind, id: r.id || r.runId, text: r.text || r.excerpt })))}`);
    assert.equal(hits[0]?.id || hits[0]?.runId, id, query);
    assert.equal(hits[0].kind, kind);
    assert.ok(hits.every((r) => r.owner !== 'beta'));
  }
  assert.deepEqual(await search('quantum chromodynamics gluon scattering'), [], 'unrelated query does not fabricate a hit');
  assert.equal(await m.embedPending(), 0);
  assert.equal((await m.semanticStatus()).done, 5);
  child.kill();
  await exited;
  assert.equal((await search('caffeine'))[0].id, coffee.id, 'lexical fallback when real llama-server stops');
});

// The lookup before a run with the real model (MEM-005): which notes it hands over by meaning, for requests that
// share no word with their note, and for small talk. The numbers it decides by are LOOKUP.similar, standsOut and
// pool in lib/memory.js; this is where they were measured. Small talk must bring nothing; of the paraphrases most
// must arrive, and the diagnostics say which did not.
test('real bge-m3: the lookup brings a paraphrased note and nothing for small talk', { skip: SKIP, timeout: 180_000 }, async (t) => {
  await realModel(t);
  const { memory: m } = scratchMemory(t);
  const notes = [
    'Use pnpm.', 'The owner lives in Łódź, on Piotrkowska street.', 'The owner is vegetarian.', 'The owner is married to Anna.',
    'The VM 106 crash is caused by the backup job at 02:00.', 'A puncture is mended with the kit under the saddle.',
    'Ulubiona restauracja właściciela: Stary Dom, Warszawa.', 'Say hello to the neighbours when you water their plants.',
    'The dentist is on Mill Lane.', 'The car is serviced in April.', 'The spare key is with the neighbour.', 'The gym closes at ten.',
    'The router is in the hallway cupboard.', 'The owner likes dry humour.', 'The code for the WOMBAT safe is 3391.',
    'Invoices go out on the first Monday of the month.', 'Do not use Redis for a cache anymore: we moved to Valkey.',
    'The owner prefers short answers without bullet points.', 'The weekly report goes to Marta, never to the whole team.',
    'PostgreSQL is the database for BotDot (decided 2026-10-07).', "The owner's time zone is Europe/Warsaw.",
    'The Zanzibar invoice goes to the Stone Town office, never to the bank.', 'Samochód jest serwisowany w kwietniu.',
    "The owner's daughter Zosia has swimming on Tuesdays.", 'Deploys happen only after 18:00 on weekdays.',
  ].map((text) => m.addNote('alpha', text, { pinned: false }).note);
  // A greeting is in many chats: the word is not rare in this memory (as in the fixture of memory-lookup.test.js).
  for (let i = 1; i <= 5; i++) m.indexRun(runMeta({ prompt: 'hello', result: 'Hello! How can I help you today?' }));
  m.setSemanticSettings({ enabled: true });
  while (await m.embedPending(20));
  const lookup = async (text) => (await m.relevantFor({ botId: 'alpha', text })).map((r) => r.text);
  // A request, and the note it is a paraphrase of (no word of it is in the note, or one ordinary word).
  const paraphrases = [
    ['What package manager do I prefer?', 0], ['Where do I live?', 1], ["What is my wife's name?", 3], ['The server went down again last night', 4],
    ['My bike has a flat tyre at the front', 5], ['Which database are we using?', 19], ['When can I ship the release?', 24],
    ['Kiedy przegląd auta?', 22], ['What time is it for me now?', 20], ['Who gets the status update each week?', 18],
    ['Zarezerwuj stolik w Warszawie na piątek.', 6], ['Book a table for Friday', 2],
  ];
  let arrived = 0;
  let extra = 0;
  for (const [request, n] of paraphrases) {
    const found = await lookup(request);
    const hit = found.includes(notes[n].text);
    arrived += hit ? 1 : 0;
    extra += found.length - (hit ? 1 : 0);
    t.diagnostic(`${hit ? 'arrived' : 'MISSED '} ${request} → ${JSON.stringify(found)}`);
  }
  assert.ok((await lookup('What package manager do I prefer?')).includes('Use pnpm.'), 'the pnpm paraphrase');
  assert.ok(arrived >= 8, `${arrived} of ${paraphrases.length} paraphrases arrived`);
  t.diagnostic(`${arrived} of ${paraphrases.length} paraphrases arrived, with ${extra} other notes beside them`);
  // A young bot: three notes, too few for an average to stand out from. Nothing arrives by meaning for small talk.
  const { memory: young } = scratchMemory(t);
  for (const text of ['Say hello to the neighbours when you water their plants.', 'The owner likes dry humour.', 'Use pnpm.']) young.addNote('beta', text, { pinned: false });
  for (let i = 1; i <= 5; i++) young.indexRun(runMeta({ botId: 'beta', prompt: 'hello', result: 'Hello! How can I help you today?' }));
  young.setSemanticSettings({ enabled: true });
  while (await young.embedPending(20));
  for (const talk of ['hello, how are you', 'good morning!', 'thanks, that is all for today', 'ok']) assert.deepEqual(await young.relevantFor({ botId: 'beta', text: talk }), [], `a young bot: ${talk}`);
  t.diagnostic(`a young bot, "What package manager do I prefer?": ${JSON.stringify((await young.relevantFor({ botId: 'beta', text: 'What package manager do I prefer?' })).map((r) => r.text))}`);
  for (const talk of ['hello, how are you', 'thanks, that is all for today', 'ok', 'good morning!', 'Dzięki, to wszystko', 'What is 17 plus 23?', 'Translate "good night" into Spanish']) {
    assert.deepEqual(await lookup(talk), [], talk);
  }
});
