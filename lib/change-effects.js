// How a bot's runs went after a change to its main assignment, rules or skills, from the outcome ledger alone
// (ADR 099): no model, nothing stored. For a change at a time, the owner's chats and the jobs of the 14 days before
// and of the days since (at most 14), runs of Claude only (not a script job's), counted as runs, runs the owner corrected or asked again, and runs that failed.
// The Chief's checkup and its review read it beside the replay's score, so a change is judged by what happened after it,
// not only by what was predicted. It is a record, never proof: few runs, and other changes at the same time, make it
// noise, so a window with fewer than MIN_RUNS runs says it is too early and compares nothing.
const DAY = 864e5;
const WINDOW_DAYS = 14;
const MIN_RUNS = 5;
const SOURCES = ['owner', 'job', 'chief']; // where a run came from that counts (outcomes.js sourceOf): not a group's turn, an aside or a teammate's message
const RECENT_DAYS = WINDOW_DAYS; // the checkup reads the changes of this many days

const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

// rows: outcomes.list rows of one bot. at: when the change was made. now: ms.
// → { after: { runs, redone, failed }, before: { runs, redone, failed } }
function effectOf(rows, at, now = Date.now()) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const mine = (Array.isArray(rows) ? rows : []).filter((r) => SOURCES.includes(r.source) && (r.kind || 'claude') === 'claude' && Number.isFinite(Date.parse(r.at)));
  const tally = (list) => ({ runs: list.length, redone: list.filter((r) => r.corrected || r.reasked).length, failed: list.filter((r) => r.outcome === 'failed').length });
  const when = (r) => Date.parse(r.at);
  return {
    after: tally(mine.filter((r) => when(r) >= t && when(r) <= Math.min(now, t + WINDOW_DAYS * DAY))),
    before: tally(mine.filter((r) => when(r) < t && when(r) >= t - WINDOW_DAYS * DAY)),
  };
}

const part = (x) => `${count(x.runs, 'run')}, ${x.redone} corrected or asked again, ${x.failed} failed`;

// The sentence for a prompt or a report: '' for a change that has no ledger to read.
function effectLine(e) {
  if (!e) return '';
  if (e.after.runs < MIN_RUNS) return `Too early to say: ${count(e.after.runs, 'run')} since.`;
  if (e.before.runs < MIN_RUNS) return `Since then: ${part(e.after)}. Too few runs before it to compare.`;
  return `Since then: ${part(e.after)}. In the ${WINDOW_DAYS} days before: ${part(e.before)}.`;
}

// bots: the bots' store (list), learn: lib/learning.js, outcomes: memory.js outcomes. now: () => ms.
function create({ bots, learn, outcomes, now = Date.now }) {
  // The rows of the two windows of a change, each fetched on its own so a busy bot's rows (a job every few minutes)
  // cannot push one window out of the ledger's limit: [at - 14 days, at) and [at, at + 14 days or now).
  function rowsAround(botId, at, t) {
    const from = Date.parse(at);
    const iso = (ms) => new Date(ms).toISOString();
    const to = Math.min(t, from + WINDOW_DAYS * DAY);
    return [
      ...outcomes.list({ botId, since: iso(from - WINDOW_DAYS * DAY), until: iso(from), limit: 5000 }),
      ...outcomes.list({ botId, since: iso(from), until: iso(to + 1), limit: 5000 }),
    ];
  }

  // The effect of a change of one bot made at `at`.
  const effectAt = (botId, at) => {
    const t = now();
    return Number.isFinite(Date.parse(at)) ? effectOf(rowsAround(botId, at, t), at, t) : null;
  };

  // The changes of the last RECENT_DAYS days to every bot's main assignment, rules and skills, newest first, at most
  // `max`: { name, fields, at, by, reason, tested, effect }.
  function recent(max = 12) {
    const since = new Date(now() - RECENT_DAYS * DAY).toISOString();
    const out = [];
    for (const b of bots.list()) for (const c of learn.changesSince(b.id, since)) out.push({ botId: b.id, name: b.name, ...c });
    // The effect is read only for the changes that are kept: each costs two queries of the ledger.
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, max).map(({ botId, ...c }) => ({ ...c, effect: effectAt(botId, c.at) }));
  }

  return { effectAt, recent };
}

module.exports = { create, effectOf, effectLine, RECENT_DAYS };
