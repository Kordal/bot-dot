// The lookup (CONTEXT.md): what the automatic lookup before a run (memory.relevantFor, the <possibly-relevant> block
// of a bot's prompt) brings, written against the store. First the seven fixtures MEM-001 wrote, each of which failed
// before MEM-005 ("The right note arrives") for the reason in its comment; then one test per rule of the lookup:
// the cap on the words, the floor and its one number, the slots and the budget, what is left out before the limit,
// the newer note, meaning search with a stub embedder (also one that is down, and one that never answers), and
// where meaning search is on by default. The lookup's older contracts are in memory.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once } = require('events');
const { scratchMemory, daysAgo, runMeta } = require('./memory-helpers');
const { LOOKUP } = require('../lib/memory');
const { inert, lookupLine } = require('../lib/prompt-text');

// The lookup, as a run of bot "alpha" gets it. Awaited: it answers at once today, and may wait for meaning search later.
const lookup = async (m, text, extra = {}) => m.relevantFor({ botId: 'alpha', text, ...extra });
const ids = (found) => found.map((r) => (r.kind === 'run' ? r.runId : r.id));
const searchable = (m, text, extra = {}) => m.addNote('alpha', text, { pinned: false, ...extra }).note;

// A stub embedder in place of bge-m3, as in memory-semantic.test.js: two texts mean the same when `same` matches
// both. Meaning search is switched on, on a store of its own. state: { down } makes it answer that it is not
// ready, { hang } makes it never answer a text.
async function withMeaning(t, same, state = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') { res.writeHead(state.down ? 503 : 200); return res.end('{}'); }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (state.hang) return; // the request stays open: nothing comes
    const data = JSON.parse(raw).input.map((text, index) => ({ index, embedding: same.test(text) ? [1, 0, 0] : [0, 0, 1] }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const previous = process.env.EMBED_URL;
  process.env.EMBED_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    if (previous === undefined) delete process.env.EMBED_URL; else process.env.EMBED_URL = previous;
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const { memory } = scratchMemory(t);
  memory.setSemanticSettings({ enabled: true });
  return memory;
}

// Failed before: the lookup is by words alone, also with meaning search on (relevantFor hands rank an empty map), and
// "Use pnpm." shares no word with the question. And it has no floor: every note that shares one ordinary word with
// the question ("package", "manager", "prefer") is within half of the best score and is handed over instead.
test('the pnpm paraphrase: "What package manager do I prefer?" brings "Use pnpm." and no note that shares one ordinary word', async (t) => {
  const m = await withMeaning(t, /pnpm|package manager/i);
  const pnpm = searchable(m, 'Use pnpm.');
  // Each of the three words stands in six notes of nineteen: none of them is rare in this memory.
  for (let i = 1; i <= 6; i++) {
    searchable(m, `Package ${i} from the tailor is due on the ${i}th.`);
    searchable(m, `Manager ${i} of the shop signs invoices above ${i}00 euros.`);
    searchable(m, `I prefer seat ${i} by the window on the morning train.`);
  }
  while (await m.embedPending(20));
  assert.deepEqual(ids(await lookup(m, 'What package manager do I prefer?')), [pnpm.id]);
});

// Failed before: each kind is scored against its own best, so the one matching run always scores as the best of its
// kind and stays, while the note that corrected it is under half of the best note's score and is cut.
test('the Redis correction: the newer note arrives, before the outdated run or without it', async (t) => {
  const { memory: m } = scratchMemory(t);
  const outdated = runMeta({ startedAt: daysAgo(60), prompt: 'Add a Redis cache to the orders service', result: 'I added a Redis cache to the orders service. Redis is our cache for every service.' });
  m.indexRun(outdated);
  const correction = searchable(m, "Don't use Redis for a cache anymore: we moved to Valkey.", { createdAt: daysAgo(10) });
  // A note that matches the request better than the correction does: the best of its kind.
  searchable(m, 'The checkout service: add a cache entry to its warm-up list when you add a cache to the checkout service.', { createdAt: daysAgo(10) });
  const found = ids(await lookup(m, 'Add a Redis cache to the checkout service'));
  assert.ok(found.includes(correction.id), 'the correction is handed over');
  if (found.includes(outdated.id)) assert.ok(found.indexOf(correction.id) < found.indexOf(outdated.id), 'and stands before the run it corrects');
});

// Failed before: the query is built from the first 12 distinct words of the request that are no filler (ftsQuery);
// "Zanzibar" is its 17th such word and its 21st word, so nothing is looked up for it.
test('a keyword at word 21 of the request still finds its note', async (t) => {
  const { memory: m } = scratchMemory(t);
  const note = searchable(m, 'The Zanzibar invoice goes to the Stone Town office, never to the bank.');
  for (const text of ['The dentist is on Mill Lane.', 'The car is serviced in April.', 'The spare key is with the neighbour.', 'The gym closes at ten.', 'The router is in the hallway cupboard.']) searchable(m, text);
  const request = 'Before the meeting tomorrow morning please prepare a short summary covering budget travel hiring equipment training licences and also the Zanzibar invoice';
  assert.equal(request.split(' ')[20], 'Zanzibar');
  assert.deepEqual(ids(await lookup(m, request)), [note.id]);
});

// Failed before: the job's own earlier runs are dropped in JavaScript after the candidates were cut to the best 20,
// and those 20 are all runs of the job, whose request is the lookup's very words.
test('30 runs of one job do not hide the one matching chat run from that job\'s next run', async (t) => {
  const { memory: m } = scratchMemory(t);
  const task = 'Check the greenhouse humidity sensors and report anomalies';
  for (let i = 1; i <= 30; i++) m.indexRun(runMeta({ startedAt: daysAgo(i), trigger: 'schedule', jobName: 'Greenhouse check', prompt: task, result: `Checked the greenhouse humidity sensors: no anomalies, reading ${40 + i}.` }));
  const chat = runMeta({ startedAt: daysAgo(45), prompt: 'The greenhouse humidity sensors read low after rain. Is that one of the anomalies?', result: 'After rain the greenhouse humidity sensors read low for an hour. Do not report that as an anomaly.' });
  m.indexRun(chat);
  assert.deepEqual(ids(await lookup(m, task, { job: 'Greenhouse check', runId: 'the-next-run' })), [chat.id]);
});

// Failed before: pinned notes are dropped in JavaScript after the candidates were cut to the best 20, and a pinned
// note ranks above an unpinned one that matches as well: the 20 are all pinned, and nothing is left.
test('25 matching pinned notes do not hide the one matching note that is not pinned', async (t) => {
  const { memory: m } = scratchMemory(t);
  for (let i = 1; i <= 25; i++) m.addNote('alpha', `Sourdough starter log ${i}: fed it rye flour.`);
  const rest = searchable(m, 'Sourdough starter: the rye flour is on the top shelf of the pantry.');
  assert.equal(m.notesOf('alpha').filter((n) => n.pinned).length, 25);
  assert.deepEqual(ids(await lookup(m, 'Feed the sourdough starter with rye flour')), [rest.id]);
});

// Failed before: "hello" is the one word of the message that is no filler, a single shared word is enough, and the
// best match always scores as the best: a note and earlier greetings are put into the prompt of a greeting.
test('"hello, how are you" brings nothing', async (t) => {
  const { memory: m } = scratchMemory(t);
  searchable(m, 'Say hello to the neighbours when you water their plants.');
  for (const text of ['The dentist is on Mill Lane.', 'The car is serviced in April.', 'The gym closes at ten.']) searchable(m, text);
  // A greeting is in many chats: the word is not rare in this memory.
  for (let i = 1; i <= 5; i++) m.indexRun(runMeta({ startedAt: daysAgo(10 + i), prompt: 'hello', result: 'Hello! How can I help you today?' }));
  assert.deepEqual(await lookup(m, 'hello, how are you'), []);
});

// Failed before: the index stems English only, so "Warszawie" shares no word with "Warszawa" (and no prefix that long),
// and the lookup does not use meaning search, also when it is on.
test('Warszawa / Warszawie: with meaning search on, the lookup finds the note in another case of the word', async (t) => {
  const m = await withMeaning(t, /warszaw/i);
  const note = searchable(m, 'Ulubiona restauracja właściciela: Stary Dom, Warszawa.');
  for (const text of ['Dentysta przyjmuje na Mokotowie.', 'Samochód jest serwisowany w kwietniu.', 'Zapasowy klucz ma sąsiadka.']) searchable(m, text);
  while (await m.embedPending(20));
  assert.deepEqual(ids(await lookup(m, 'Zarezerwuj stolik w Warszawie na piątek.')), [note.id]);
});

// ---------- one test per rule ----------

const kinds = (found) => found.map((r) => r.kind);
const printed = (found) => found.reduce((n, r) => n + inert(lookupLine(r)).length + 1, 0);

test('the query uses every distinct meaningful word of the request, up to a cap of 40', async (t) => {
  const { memory: m } = scratchMemory(t);
  assert.equal(LOOKUP.words, 40);
  // 44 distinct words that are no filler: w01 … w44, said twice each, with filler between them.
  const word = (i) => `w${String(i).padStart(2, '0')}x`;
  const request = Array.from({ length: 44 }, (_, i) => `the ${word(i + 1)} and ${word(i + 1)}`).join(' ');
  const last = searchable(m, `A note about ${word(39)} and ${word(40)}.`);
  searchable(m, `A note about ${word(41)} and ${word(42)}.`);
  assert.deepEqual(ids(await lookup(m, request)), [last.id], 'the 39th and 40th word are looked for, the 41st and 42nd are not');
});

test('the floor: two words of the request, or one that is rare in the bot\'s memory; what counts as rare is one number', async (t) => {
  const { memory: m } = scratchMemory(t);
  assert.equal(LOOKUP.rare, 3, 'a word is rare when at most three of the bot\'s notes and past runs hold it');
  // "heron" stands in exactly three items of this bot's memory: two notes, one of them shared, and a past run.
  const own = searchable(m, 'The heron ring is in the top drawer.');
  const shared = m.addNote('_shared', 'A heron nests by the pond every spring.', { pinned: false }).note;
  const run = runMeta({ startedAt: daysAgo(20), prompt: 'Draw a heron', result: 'Here is the heron, drawn in pencil.' });
  m.indexRun(run);
  // Another bot's notes are not this bot's memory.
  for (let i = 0; i < 5; i++) m.addNote('beta', `Beta's heron note ${i}.`, { pinned: false });
  assert.deepEqual(ids(await lookup(m, 'heron')).sort(), [own.id, shared.id, run.id].sort(), 'one rare word is enough');
  // A fourth item with the word: it is no longer rare, and one such word brings nothing.
  searchable(m, 'The heron documentary is on Thursday.');
  assert.deepEqual(await lookup(m, 'heron'), []);
  // Two words of the request are enough, rare or not; an inflected form counts as its word.
  assert.deepEqual(ids(await lookup(m, 'heron rings')), [own.id]);
  assert.deepEqual(ids(await lookup(m, 'Which documentaries about herons are on?')), ids(await lookup(m, 'heron documentary')));
  assert.equal((await lookup(m, 'heron documentary')).length, 1);
});

test('up to three notes come first, then up to two runs, within 5 items and 1,500 characters as printed', async (t) => {
  const { memory: m } = scratchMemory(t);
  assert.deepEqual([LOOKUP.notes, LOOKUP.runs], [3, 2]);
  for (let i = 1; i <= 6; i++) searchable(m, `Lantern festival note ${i}: bring the paper lantern.`);
  for (let i = 1; i <= 6; i++) m.indexRun(runMeta({ startedAt: daysAgo(i), prompt: `Plan the lantern festival, part ${i}`, result: `The lantern festival plan ${i} is done.` }));
  const found = await lookup(m, 'lantern festival');
  assert.deepEqual(kinds(found), ['note', 'note', 'note', 'run', 'run']);
  assert.ok(printed(found) <= 1500, `${printed(found)} characters`);
  // Long notes: the budget counts each line as it is printed, with its id, who said it and the date.
  const { memory: long } = scratchMemory(t);
  for (let i = 1; i <= 6; i++) long.addNote('alpha', `Lantern festival ${i}: ${'details '.repeat(46)}`, { pinned: false, topic: 'festival' });
  for (let i = 1; i <= 6; i++) long.indexRun(runMeta({ startedAt: daysAgo(i), prompt: `Plan the lantern festival, part ${i}`, result: `The lantern festival plan ${i} is done.` }));
  const fewer = await lookup(long, 'lantern festival');
  assert.ok(fewer.length >= 3 && fewer.length <= 5 && printed(fewer) <= 1500, `${fewer.length} items, ${printed(fewer)} characters`);
  assert.equal(kinds(fewer).filter((k) => k === 'note').length, 3, 'three long notes fit as printed');
  assert.ok(printed(fewer) > 1500 - 400, 'and the budget is used');
});

test('left-out runs and the run that asks are excluded before the limit', async (t) => {
  const { memory: m } = scratchMemory(t);
  // 70 matching runs that are left out, more than the query weighs: the owner's mark on half, a forget on the rest.
  const out = [];
  for (let i = 1; i <= 70; i++) { const r = runMeta({ startedAt: daysAgo(i), prompt: 'Tune the marimba mallets', result: `Marimba mallets tuned, round ${i}.` }); m.indexRun(r); out.push(r.id); }
  out.slice(0, 35).forEach((id) => m.setExcluded(id, true));
  m.erase({ runs: out.slice(35) });
  const kept = runMeta({ startedAt: daysAgo(80), prompt: 'Which marimba mallets are soft?', result: 'The blue marimba mallets are the soft ones.' });
  const asking = runMeta({ startedAt: daysAgo(0), prompt: 'Tune the marimba mallets again', result: 'Marimba mallets tuned.' });
  m.indexRun(kept);
  m.indexRun(asking);
  assert.deepEqual(ids(await lookup(m, 'Tune the marimba mallets', { runId: asking.id })), [kept.id]);
});

test('a newer note that holds the same words is never cut in favour of an older note, or of the run it corrected', async (t) => {
  const { memory: m } = scratchMemory(t);
  // Three older notes that match the request best, word for word, and a run older still.
  const old = [1, 2, 3].map((i) => searchable(m, `Descale kettle vinegar ${i}.`, { createdAt: daysAgo(60 + i) }));
  const run = runMeta({ startedAt: daysAgo(90), prompt: 'Descale the kettle', result: 'I descaled the kettle with vinegar.' });
  m.indexRun(run);
  // The correction: newer, and a weaker match by its length.
  const newer = searchable(m, `Since the new kettle arrived the advice has changed, after the seal was damaged and the warranty leaflet was read again in full: do not descale the kettle with vinegar any more, use citric acid, one spoon to a litre, and rinse twice. ${'This holds for both kettles. '.repeat(4)}`, { createdAt: daysAgo(1) });
  const scores = (await m.search({ query: 'descale kettle vinegar', notesOf: ['alpha'], limit: 10 })).map((r) => r.id);
  assert.equal(scores.indexOf(newer.id), 3, 'by its score alone it is the fourth note, and three are handed over');
  const found = ids(await lookup(m, 'Descale the kettle with vinegar'));
  assert.equal(found[0], newer.id, 'it stands before the notes it may correct');
  assert.equal(found.filter((id) => old.some((n) => n.id === id)).length, 2, 'and an older one gives up its place');
  assert.equal(found.indexOf(run.id), 3, 'the run it corrected comes after it: a run never takes a note\'s place');
});

// A dozen notes about other things: with them a word of the request is a rarer word, as in a memory that is in use.
const others = (m) => { for (const text of ['The dentist is on Mill Lane.', 'The car is serviced in April.', 'The spare key is with the neighbour.', 'The gym closes at ten.', 'The router is in the hallway cupboard.', 'Invoices go out on Mondays.', 'The owner likes dry humour.', 'The ferry leaves at noon.', 'The piano is tuned in March.', 'The lawn is mown on Fridays.', 'The printer needs cyan ink.', 'The attic ladder sticks.']) searchable(m, text); };

test('a newer note the budget has no room for is not replaced by an older note or run that holds the same words', async (t) => {
  const { memory: m } = scratchMemory(t);
  others(m);
  const first = searchable(m, 'Compost bin worms: feed them weekly.', { createdAt: daysAgo(3) });
  const second = searchable(m, 'Compost bin worms: keep them out of the sun.', { createdAt: daysAgo(2) });
  // Newer than the two short items below, and too long for a budget of 400 characters, wherever it stands.
  const big = searchable(m, `Compost bin: no orange peel in it. ${'and so on '.repeat(34)}`, { createdAt: daysAgo(10) });
  const smallOld = searchable(m, 'Compost bin: orange peel is fine.', { createdAt: daysAgo(40) });
  const runOld = runMeta({ startedAt: daysAgo(50), prompt: 'Can peel go in the compost bin?', result: 'Yes, peel can go in the compost bin.' });
  const runOther = runMeta({ startedAt: daysAgo(50), prompt: 'Where do the worms come from?', result: 'The worms were ordered by post for the compost.' });
  m.indexRun(runOld);
  m.indexRun(runOther);
  const found = ids(await lookup(m, 'compost bin worms and peel', { chars: 400 }));
  assert.deepEqual(found.slice(0, 2).sort(), [first.id, second.id].sort());
  assert.ok(!found.includes(big.id), 'the long note does not fit');
  assert.ok(!found.includes(smallOld.id), 'no older, smaller note with its words stands in for it');
  assert.ok(!found.includes(runOld.id), 'nor the run it may have corrected');
  assert.deepEqual(found.slice(2), [runOther.id], 'a run that a note among those handed over corrects arrives beside it');
  // With room for it, it stands before the older note.
  const roomy = ids(await lookup(m, 'compost bin and peel'));
  assert.ok(roomy.includes(big.id) && roomy.indexOf(big.id) < roomy.indexOf(smallOld.id));
});

// The request names two things. Three notes about the first fill the notes' places; the correction about the
// second has none. The run it corrected would have a place of its own, and would arrive as the last word on it.
test('a run does not arrive without the newer note that corrects it, when that note found no place', async (t) => {
  const { memory: m } = scratchMemory(t);
  others(m);
  for (let i = 1; i <= 3; i++) searchable(m, `Sourdough starter rye flour ${i}.`, { createdAt: daysAgo(5 + i) });
  const correction = searchable(m, `After the seal was damaged and the warranty leaflet was read again in full: do not descale the kettle with vinegar any more, use citric acid, one spoon to a litre, and rinse twice. ${'This holds for both kettles. '.repeat(4)}`, { createdAt: daysAgo(1) });
  const outdated = runMeta({ startedAt: daysAgo(90), prompt: 'Descale the kettle', result: 'I descaled the kettle with vinegar.' });
  const other = runMeta({ startedAt: daysAgo(90), prompt: 'Feed the sourdough starter', result: 'Fed the sourdough starter with rye flour.' });
  m.indexRun(outdated);
  m.indexRun(other);
  const found = ids(await lookup(m, 'Feed the sourdough starter with rye flour, then descale the kettle with vinegar'));
  assert.equal(found.length, 4);
  assert.ok(!found.includes(correction.id), 'three notes that match better have the places');
  assert.ok(!found.includes(outdated.id), 'the outdated run stays out with it');
  assert.equal(found[3], other.id, 'a run that newer notes among the three speak of arrives');
  // With a place for it, both arrive, the note first.
  const { memory: roomy } = scratchMemory(t);
  const c2 = searchable(roomy, 'Do not descale the kettle with vinegar any more: use citric acid.', { createdAt: daysAgo(1) });
  roomy.indexRun(outdated);
  assert.deepEqual(ids(await lookup(roomy, 'Descale the kettle with vinegar')), [c2.id, outdated.id]);
});

// What botdot itself writes into a run's entry is nobody's word about anything: it counts for no request.
test('botdot\'s own words in a past run are not words of the request: a job\'s name is, "scheduled job" and a run\'s steps are not', async (t) => {
  const { memory: m } = scratchMemory(t);
  for (let i = 1; i <= 2; i++) m.indexRun(runMeta({ startedAt: daysAgo(i), trigger: 'schedule', jobName: 'Tide watch', customPrompt: false, reporting: 'quiet', result: '', rawResult: `High water at 0${i}:12.` }));
  m.indexRun(runMeta({ startedAt: daysAgo(3), status: 'error', error: 'The harbour site was down.', prompt: 'Read the harbour page', result: null }));
  m.indexRun(runMeta({ startedAt: daysAgo(4), prompt: 'Look at the ledger', result: 'It balances.' }), ['searched the web for "ledger"', 'read the file notes.md']);
  assert.deepEqual(await lookup(m, 'Was the newsletter sent to the owner already?'), []);
  assert.deepEqual(await lookup(m, 'Please change the scheduled job for the newsletter'), []);
  assert.deepEqual(await lookup(m, 'It didn\'t finish: what was the error?'), []);
  assert.deepEqual(await lookup(m, 'Which file did I search the web for?'), []);
  assert.equal((await lookup(m, 'When is high water on the tide watch?')).length, 2, 'the job\'s name and its reply are');
});

test('with meaning search on, notes are ranked by meaning merged with the words; past runs are matched by words only', async (t) => {
  const m = await withMeaning(t, /flat tyre|puncture/i);
  const byMeaning = searchable(m, 'A puncture is mended with the kit under the saddle.');
  const byWords = searchable(m, 'The bike with the flat front wheel is the red one.');
  const run = runMeta({ startedAt: daysAgo(12), prompt: 'Mend it', result: 'The puncture is mended.' });
  m.indexRun(run);
  searchable(m, 'The dentist is on Mill Lane.');
  while (await m.embedPending(20));
  const request = 'My bike has a flat tyre at the front';
  assert.ok((await m.search({ query: request, notesOf: [], runsOf: ['alpha'] })).some((r) => r.runId === run.id), 'recall finds the run by meaning');
  const found = ids(await lookup(m, request));
  assert.deepEqual([...found].sort(), [byMeaning.id, byWords.id].sort(), 'the lookup brings the note found by meaning and the one found by words, and no run found by meaning alone');
  assert.equal(found[0], byMeaning.id, 'meaning weighs more than words');
  // A pinned note is not looked up by meaning either: it is in the prompt already.
  const pinned = m.addNote('alpha', 'After a puncture, check the rim tape.').note;
  while (await m.embedPending(20));
  assert.ok(pinned.pinned && !ids(await lookup(m, request)).includes(pinned.id));
});

test('when the embedding server is down, the lookup answers from words alone, at once', async (t) => {
  const state = {};
  const m = await withMeaning(t, /flat tyre|puncture/i, state);
  searchable(m, 'A puncture is mended with the kit under the saddle.');
  const byWords = searchable(m, 'The bike with the flat front wheel is the red one.');
  while (await m.embedPending(20));
  state.down = true;
  const t0 = Date.now();
  assert.deepEqual(ids(await lookup(m, 'My bike has a flat tyre at the front')), [byWords.id]);
  assert.ok(Date.now() - t0 < LOOKUP.embedMs / 2, `${Date.now() - t0} ms`);
});

test('an embedding server that never answers holds the lookup for its timeout and no longer; the timeout is one number', async (t) => {
  const state = {};
  const m = await withMeaning(t, /flat tyre|puncture/i, state);
  searchable(m, 'A puncture is mended with the kit under the saddle.');
  const byWords = searchable(m, 'The bike with the flat front wheel is the red one.');
  while (await m.embedPending(20));
  state.hang = true;
  assert.ok(LOOKUP.embedMs > 0 && LOOKUP.embedMs <= 2000, 'a run starts no later than this after it was asked for');
  const t0 = Date.now();
  assert.deepEqual(ids(await lookup(m, 'My bike has a flat tyre at the front')), [byWords.id], 'words alone');
  const took = Date.now() - t0;
  assert.ok(took >= LOOKUP.embedMs - 100 && took < LOOKUP.embedMs + 700, `${took} ms`);
});

test('meaning search is on by default where the Docker image\'s two variables are set and the owner never chose; a choice is kept', (t) => {
  const names = ['EMBED_SERVER_BIN', 'EMBED_MODEL_FILE', 'EMBED_URL'];
  const before = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  t.after(() => { for (const k of names) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });
  process.env.EMBED_URL = 'http://127.0.0.1:9'; // nothing is started for this test, and nothing answers there
  const image = () => { process.env.EMBED_SERVER_BIN = '/app/llama-server'; process.env.EMBED_MODEL_FILE = '/opt/models/bge-m3-q8_0.gguf'; };
  const elsewhere = () => { delete process.env.EMBED_SERVER_BIN; delete process.env.EMBED_MODEL_FILE; };
  // Elsewhere: off, also with one of the two.
  elsewhere();
  const plain = scratchMemory(t);
  assert.equal(plain.memory.semanticSettings().enabled, false);
  process.env.EMBED_SERVER_BIN = '/usr/local/bin/llama-server';
  assert.equal(plain.memory.semanticSettings().enabled, false, 'the program alone is not the image');
  // In the image, an install whose owner never chose: on, a new one and an existing one alike.
  image();
  assert.equal(plain.memory.semanticSettings().enabled, true);
  const fresh = scratchMemory(t);
  assert.equal(fresh.memory.semanticSettings().enabled, true);
  // The owner's "off" is kept, across a start.
  fresh.memory.setSemanticSettings({ enabled: false });
  assert.equal(scratchMemory(t, {}, fresh.dir).memory.semanticSettings().enabled, false);
  // The owner's "on" is kept where the default is off.
  elsewhere();
  const chosen = scratchMemory(t);
  chosen.memory.setSemanticSettings({ enabled: true });
  assert.equal(scratchMemory(t, {}, chosen.dir).memory.semanticSettings().enabled, true);
});
