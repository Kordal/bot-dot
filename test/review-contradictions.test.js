// The weekly review settles notes that cannot both be true, and removes at most a quarter of a bot's notes (#1714):
// its prompt holds the step, the server holds the cap for a run whose trigger is "review" and for no other, and the
// number lives in one place, next to REVIEW_LIST (lib/bots.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { startServer, makeBot, self } = require('./helpers');
const { seedNotes } = require('./live/seed');
const B = require('../lib/bots');

test('the cap is a quarter of the bot\'s notes and at least 3', () => {
  assert.equal(B.REVIEW_CAP.share, 0.25);
  assert.equal(B.REVIEW_CAP.least, 3);
  const limit = B.reviewRemovalLimit;
  assert.deepEqual([0, 1, 3, 8, 12, 13].map(limit), [3, 3, 3, 3, 3, 3]);
  assert.deepEqual([16, 17, 40, 99, 100, 200].map(limit), [4, 4, 10, 24, 25, 50]);
});

// A bot with n notes of its own, seeded on a stopped server, and the server started again.
async function withNotes(t, texts, { pinned = true } = {}) {
  let srv = await startServer();
  const { dir } = srv;
  t.after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const bot = await makeBot(srv, { name: 'Tidy Bot', prompt: 'Keep things tidy.', useSkills: false });
  await srv.stop();
  const seeded = seedNotes(srv.data, bot.id, texts.map((x, i) => ({ key: `n${i}`, ...(typeof x === 'string' ? { text: x } : x), pinned })));
  srv = await startServer({ dir });
  return { srv, bot, ids: seeded.map((s) => s.id) };
}
const facts = (n) => Array.from({ length: n }, (_, i) => `Fact number ${i} about the house in room ${i}.`);

test('the review prompt has the step: pairs that cannot both be true, the newer one kept, and the limit it may remove', async (t) => {
  const { srv, bot } = await withNotes(t, facts(10));
  const started = await srv.api(`/memory/review/${bot.id}`, { method: 'POST' });
  const run = await srv.nextRun((x) => x.stdin.includes('This run is your memory review'), 'the review run');
  const p = run.stdin;
  assert.match(p, /\n4\. [^\n]*cannot both be true now/);
  assert.match(p, /Keep the newer one unless the older one is clearly the correction/);
  assert.match(p, /remove_note[^\n]*reason that names the note it lost to/);
  // Two notes of the owner's that contradict: left as they are, and named for the owner in the report as one line.
  assert.match(p, /both are marked "the owner said", change neither[^\n]*as one line/);
  assert.match(p, /removes? at most 3 of your notes/);
  assert.match(p, /\n5\. Pin what matters/);
  assert.match(p, /\n6\. The owner's Board/);
  await srv.finished(started.data.run.id);
  // The limit is said with the bot's own count: 40 notes, 10.
  const big = await withNotes(t, facts(40));
  const again = await big.srv.api(`/memory/review/${big.bot.id}`, { method: 'POST' });
  const bigRun = await big.srv.nextRun((x) => x.stdin.includes('This run is your memory review'), 'the review run');
  assert.match(bigRun.stdin, /removes? at most 10 of your notes/);
  await big.srv.finished(again.data.run.id);
});

test('a review run may remove its limit of notes; the next removal is refused and the answer says the review has reached its limit', async (t) => {
  const { srv, bot, ids } = await withNotes(t, facts(12));
  srv.hold();
  const started = await srv.api(`/memory/review/${bot.id}`, { method: 'POST' });
  const rec = await srv.nextRun((x) => x.self?.env && x.stdin.includes('This run is your memory review'), 'the review run');
  const token = rec.self.env.RUN_TOKEN;
  const remove = (id, reason = 'Contradicted by a newer note.') => self(srv, token, 'memory', { action: 'remove', id, reason }).then((r) => r.data);
  for (const id of ids.slice(0, 3)) assert.equal((await remove(id)).result, 'saved', 'within the limit');
  const over = await remove(ids[3]);
  assert.deepEqual([over.ok, over.result], [true, 'refused']);
  assert.match(over.say, /this review has reached its limit/);
  assert.match(over.say, /3 removals/);
  assert.match(over.say, /a quarter of your notes/);
  const mine = (await srv.api('/memory')).data.bots.find((b) => b.id === bot.id).notes;
  assert.equal(mine.length, 9, 'three went, and the refused one stayed');
  assert.ok(mine.some((n) => n.id === ids[3]));
  // A refused removal counts for nothing, and other changes are not limited: it can still reword and pin.
  assert.equal((await self(srv, token, 'memory', { action: 'edit', id: ids[3], text: 'Fact number 3 changed.', reason: 'x' })).data.result, 'saved');
  assert.equal((await self(srv, token, 'memory', { action: 'pin', id: ids[4], pin: false })).data.result, 'saved');
  assert.equal((await remove(ids[5])).result, 'refused', 'still at the limit');
  srv.release(rec);
  await srv.finished(started.data.run.id);
});

test('a run that is not a review has no cap on removals', async (t) => {
  const { srv, bot, ids } = await withNotes(t, facts(12));
  srv.hold();
  const sent = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Clean out the old facts.' } });
  const rec = await srv.nextRun((x) => x.self?.env && x.stdin.includes('Clean out the old facts.'), 'a run of the bot');
  for (const id of ids.slice(0, 8)) assert.equal((await self(srv, rec.self.env.RUN_TOKEN, 'memory', { action: 'remove', id, reason: 'old' })).data.result, 'saved');
  srv.release(rec);
  await srv.finished(sent.data.id);
});

test('the limit is counted from the notes the bot had when the review began: removing some does not lower it', async (t) => {
  const { srv, bot, ids } = await withNotes(t, facts(16)); // 16 notes: 4
  srv.hold();
  const started = await srv.api(`/memory/review/${bot.id}`, { method: 'POST' });
  const rec = await srv.nextRun((x) => x.self?.env && x.stdin.includes('This run is your memory review'), 'the review run');
  const results = [];
  for (const id of ids.slice(0, 6)) results.push((await self(srv, rec.self.env.RUN_TOKEN, 'memory', { action: 'remove', id, reason: 'old' })).data.result);
  assert.deepEqual(results, ['saved', 'saved', 'saved', 'saved', 'refused', 'refused']);
  srv.release(rec);
  await srv.finished(started.data.run.id);
});

test('a note the owner said is refused in a review before the cap is looked at, and counts for nothing', async (t) => {
  const { srv, bot, ids } = await withNotes(t, [{ text: 'The owner works from home.', owner: true }, ...facts(11)]);
  srv.hold();
  const started = await srv.api(`/memory/review/${bot.id}`, { method: 'POST' });
  const rec = await srv.nextRun((x) => x.self?.env && x.stdin.includes('This run is your memory review'), 'the review run');
  const token = rec.self.env.RUN_TOKEN;
  const refused = (await self(srv, token, 'memory', { action: 'remove', id: ids[0], reason: 'x' })).data;
  assert.equal(refused.result, 'refused');
  assert.doesNotMatch(refused.say, /limit/);
  for (const id of ids.slice(1, 4)) assert.equal((await self(srv, token, 'memory', { action: 'remove', id, reason: 'x' })).data.result, 'saved');
  srv.release(rec);
  await srv.finished(started.data.run.id);
});
