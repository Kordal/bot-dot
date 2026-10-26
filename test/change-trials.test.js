// A bot's proposed main assignment or rules is tried on its past tasks before its card (#596, ADR 102): the card
// waits for the replays and leads with the score, the yes keeps the change and its score in the bot's history, one tap
// undoes it, and the Chief's weekly report lists it. lib/change-trials.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor } = require('./helpers');
const trials = require('../lib/change-trials');

// ---------- the held card ----------

function harness({ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trials-')), on = true, bots = { b1: { id: 'b1', prompt: 'Old' } } } = {}) {
  const added = [];
  const scores = [];
  const asks = { add: (ask, { runId } = {}) => { added.push({ ask, runId }); return { id: ask.id || 'now', ...ask }; } };
  const t = trials.create({
    dataDir: dir, asks, on: () => on, bot: (id) => bots[id] || null,
    score: (a, { gone }) => new Promise((resolve) => scores.push({ a, gone, resolve })),
  });
  return { t, added, scores, dir, file: path.join(dir, 'change-trials.json') };
}
const change = (fields = {}) => ({ botId: 'b1', by: 'bot', runId: 'r1', reason: 'You asked for soup.', changes: { prompt: 'New' }, before: { prompt: 'Old' }, ...fields });
const tally = { of: 20, better: 14, worse: 1, same: 5, failed: 0 };

test('a bot\'s new main assignment waits for its replays, and its card leads with the score', async () => {
  const h = harness();
  const r = h.t.request(change());
  assert.equal(r.trying, true);
  assert.deepEqual(h.added, [], 'no card while it is tried');
  assert.deepEqual(h.t.list().map((a) => a.id), [r.id], 'what waits of the bot, for its first message');
  assert.deepEqual(h.scores[0].a.changes, { prompt: 'New' });
  h.scores[0].resolve(tally);
  await waitFor(() => (h.added.length ? true : null), { what: 'the card' });
  assert.equal(h.added[0].ask.id, r.id, 'the card has the id the bot was given');
  assert.equal(h.added[0].ask.reason, 'Better on 14 of 20 past tasks, worse on 1. You asked for soup.');
  assert.deepEqual(h.added[0].ask.tested, tally);
  assert.equal(h.added[0].runId, 'r1', 'the run that proposed it carries on after the yes');
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file, 'utf8')).trying, []);
});

test('with replays off, a Chief\'s change or a change of something else, the card goes at once', () => {
  const off = harness({ on: false });
  assert.equal(off.t.request(change()).trying, undefined);
  assert.equal(off.added.length, 1);
  const h = harness();
  h.t.request(change({ by: 'chief' }));
  h.t.request(change({ changes: { allowedTools: ['Bash'] }, before: { allowedTools: [] } }));
  assert.equal(h.added.length, 2);
  assert.equal(h.added[0].runId, null, 'a Chief\'s change keeps no run');
  assert.equal(h.scores.length, 0);
});

test('a newer proposal takes the place of one being tried, and a worse or untried one still gets its card', async () => {
  const h = harness();
  const first = h.t.request(change());
  const second = h.t.request(change({ runId: 'r2', changes: { prompt: 'Newer' } }));
  assert.equal(h.scores[0].gone(), true, 'the older one\'s replays stop');
  h.scores[0].resolve(tally);
  h.scores[1].resolve({ of: 3, better: 0, worse: 2, same: 1, failed: 0 });
  await waitFor(() => (h.added.length >= 2 ? true : null), { what: 'the newer card' });
  assert.ok(h.added.every((x) => x.ask.id === second.id && x.ask.id !== first.id), 'one card, the newer');
  assert.deepEqual(h.added.map((x) => x.runId), ['r1', 'r2'], 'both runs wait for it');
  assert.match(h.added[0].ask.reason, /^Better on 0 of 3 past tasks, worse on 2\. /);
  const none = harness();
  none.t.request(change());
  none.scores[0].resolve(null);
  await waitFor(() => (none.added.length ? true : null), { what: 'the untried card' });
  assert.equal(none.added[0].ask.reason, 'You asked for soup.');
});

test('a card goes for a trial left by a restart, and none for a bot that is gone or was edited meanwhile', async () => {
  const h = harness();
  h.t.request(change());
  h.t.request(change({ botId: 'gone' }));
  const again = harness({ dir: h.dir });
  assert.deepEqual(again.added.map((x) => [x.ask.botId, x.ask.reason]), [['b1', 'You asked for soup.']], 'untried, as it is');
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file, 'utf8')).trying, []);
  const edited = harness({ bots: { b1: { id: 'b1', prompt: 'The owner typed this' } } });
  edited.t.request(change());
  edited.scores[0].resolve(tally);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(edited.added, [], 'a yes would be refused: no card');
});

// ---------- on a real botdot ----------

let srv, cook;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_REPLAYS_PER_HOUR: '60', BOT_DOT_REPLAY_GAP_MS: '0' } });
  cook = await makeBot(srv, { name: 'Cook', prompt: 'Plan the meals.', description: 'Plans the meals' });
});
after(async () => { await srv.stop(); });

const changeCards = async () => (await srv.api('/asks')).data.filter((a) => a.kind === 'bot-change' && a.botId === cook.id);
const notices = async () => {
  const chats = (await srv.api('/chief')).data.chats;
  const all = await Promise.all(chats.map(async (c) => (await srv.api(`/chief/chats/${c.id}`)).data.messages));
  return all.flat().filter((m) => m.notice).map((m) => m.text);
};

test('the card waits for the replays, its yes is kept with its score, one tap undoes it, and the report lists it', async () => {
  srv.reply('Pasta on Friday.');
  const asked = await srv.api(`/bots/${cook.id}/run`, { method: 'POST', body: { prompt: 'Plan dinner for Friday' } });
  await srv.finished(asked.data.id);
  await srv.nextRun((x) => x.stdin === 'Plan dinner for Friday', 'the past task'); // not the run that proposes
  await waitFor(async () => ((await srv.api(`/bots/${cook.id}/outcomes`)).data.outcomes.length ? true : null), { what: 'the run\'s outcome' });

  fs.writeFileSync(path.join(srv.out, 'result-if-told.json'), JSON.stringify({ 'ALWAYS-SOUP': 'Soup on Friday.' }));
  fs.writeFileSync(path.join(srv.out, 'judge-picks.txt'), 'Soup');
  const { token } = await heldRun(srv, cook, 'From now on, always soup');
  const proposed = await self(srv, token, 'instructions', { task: 'Plan the meals. ALWAYS-SOUP', reason: 'You asked for soup.' });
  assert.equal(proposed.data.trying, true, JSON.stringify(proposed.data));
  assert.deepEqual(await changeCards(), [], 'no card while its replays are held');
  srv.unhold();

  const [card] = await waitFor(async () => { const l = await changeCards(); return l.length ? l : null; }, { what: 'the card', timeout: 20_000 });
  assert.equal(card.id, proposed.data.requestId);
  assert.match(card.reason, /^Better on 1 of 1 past tasks, worse on 0\. You asked for soup\./);
  const replays = srv.runs().filter((x) => /This run is a replay/.test(x.system || ''));
  assert.deepEqual(replays.map((r) => r.system.includes('ALWAYS-SOUP')).sort(), [false, true], 'the bot as it is, and with the new text');
  assert.ok(replays.every((r) => r.stdin === 'Plan dinner for Friday'));
  assert.equal((await srv.api(`/bots/${cook.id}`)).data.prompt, 'Plan the meals.', 'nothing changes before the yes');

  await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  const changed = (await srv.api(`/bots/${cook.id}`)).data;
  assert.equal(changed.prompt, 'Plan the meals. ALWAYS-SOUP');
  const [entry] = (await srv.api(`/bots/${cook.id}/learning`)).data.history;
  assert.deepEqual([entry.field, entry.proposal, entry.tested.better], ['prompt', card.id, 1], 'versioned with its card and score');
  assert.equal(changed.undo, entry.id, 'one tap undoes it');

  srv.reply('NOTHING');
  const n = (await notices()).length;
  assert.equal((await srv.asChief('/memory/review/chief', { method: 'POST' })).status, 200);
  const report = await waitFor(async () => { const l = await notices(); return l.length > n ? l.at(-1) : null; }, { what: 'the report', timeout: 20_000 });
  assert.match(report, /Changed since the last review:\n- Cook's main assignment changed on your OK\. Better on 1 of 1 past tasks, worse on 0\./);

  const undone = await srv.api(`/bots/${cook.id}/learning/undo`, { method: 'POST', body: { changeId: changed.undo } });
  assert.equal(undone.status, 200);
  const back = (await srv.api(`/bots/${cook.id}`)).data;
  assert.equal(back.prompt, 'Plan the meals.');
  assert.equal(back.undo, undefined, 'an undo is not undone by the same tap');
});
