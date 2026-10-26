// A bot's proposed main assignment or rules (update_instructions, #596, ADR 102) is tried on its past tasks before
// its card goes to Needs you: the bot as it is against the bot with the new text (lib/replay.js). The card comes once
// the replays have run, its reason led by the score ("Better on 14 of 20 past tasks, worse on 1."), and the score goes
// with the change into the bot's history when the owner says yes. A worse score still gets its card: the bot proposed
// it, often because the owner asked, and the owner decides.
//
// What is being tried is kept in data/change-trials.json, so a restart meanwhile still brings its card, untried. A
// newer proposal of the same bot takes the place of one being tried: the older one's replays stop, and the runs that
// waited for it wait for the newer card. With replays off, or a change that is no main assignment or rules (or not the
// bot's own), the card goes at once, as before. Asks, the score and the bots are handed in, so a test needs nothing running.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonfile');
const { scoreLine } = require('./replay');
const { staleChange } = require('./asks');

const FIELDS = ['prompt', 'systemPrompt'];
// A change of the bot's own to its main assignment or rules.
const tried = (change) => change.by === 'bot' && FIELDS.some((f) => f in (change.changes || {}));

// asks: lib/asks.js; score(ask, { gone }): how its change did on the bot's past tasks (replay.js score), or null when
// it was not tried; on(): replays are on; bot(id): the bot as it is now.
function create({ dataDir, asks, score, on = () => true, bot = () => null }) {
  const file = path.join(dataDir, 'change-trials.json');
  const load = () => { const r = readJson(file, {}); return Array.isArray(r.trying) ? r.trying : []; };
  const keep = (list) => writeJson(file, { trying: list });

  // The card of a trial, with its score: one card, joined by every run that waited for it. Nothing when the bot is
  // gone, or when what the change was made against changed meanwhile (the owner edited it: a yes would be refused).
  function card(t, tested) {
    const b = bot(t.ask.botId);
    if (!b || staleChange(t.ask, b)) return null;
    const line = scoreLine(tested);
    const ask = { ...t.ask, ...(tested ? { tested } : {}), reason: `${line ? `${line} ` : ''}${t.ask.reason || ''}`.trim() };
    let a = null;
    for (const runId of t.runs.length ? t.runs : [null]) a = asks.add(ask, { runId });
    return a;
  }

  // Trials that were going when botdot stopped: their cards come as they are, untried.
  const left = load();
  if (left.length) {
    keep([]);
    for (const t of left) { try { card(t, null); } catch (e) { console.error(`[replay] a proposed change: ${e.message}`); } }
  }

  async function trial(t) {
    const gone = () => !load().some((x) => x.ask.id === t.ask.id);
    let tested = null;
    try { tested = await score(t.ask, { gone }); } catch (e) { console.error(`[replay] a proposed change of ${t.ask.botId}: ${e.message}`); }
    const list = load();
    const still = list.find((x) => x.ask.id === t.ask.id);
    if (!still) return; // a newer proposal took its place
    keep(list.filter((x) => x !== still));
    try { card(still, tested); } catch (e) { console.error(`[replay] a proposed change: ${e.message}`); }
  }

  // A change that waits for the owner (bots.js requestChange): its card now, or once it is tried. Returns the ask,
  // or { id, trying: true } for one being tried.
  function request(change) {
    const runId = change.by === 'bot' ? change.runId || null : null;
    if (!tried(change) || !on()) return asks.add({ kind: 'bot-change', ...change }, { runId });
    const list = load();
    const earlier = list.filter((x) => x.ask.botId === change.botId);
    const t = { ask: { id: crypto.randomUUID().slice(0, 8), kind: 'bot-change', ...change }, runs: [...new Set([...earlier.flatMap((x) => x.runs), ...(runId ? [runId] : [])])] };
    keep([...list.filter((x) => !earlier.includes(x)), t]);
    trial(t);
    return { id: t.ask.id, trying: true };
  }

  // The changes being tried, as asks: what waits of a bot (server.js, its first message). A deleted bot's trial
  // ends with no card (card).
  const list = () => load().map((t) => t.ask);

  return { request, list };
}

module.exports = { create, tried, FIELDS };
