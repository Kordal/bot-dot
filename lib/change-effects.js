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
  const rowsOf = (botId, from) => outcomes.list({ botId, since: new Date(from).toISOString(), limit: 5000 });

  // The effect of a change of one bot made at `at`.
  const effectAt = (botId, at) => effectOf(rowsOf(botId, Date.parse(at) - WINDOW_DAYS * DAY), at, now());

  // The changes of the last RECENT_DAYS days to every bot's main assignment, rules and skills, newest first, at most
  // `max`: { name, fields, at, by, reason, tested, effect }.
  function recent(max = 12) {
    const t = now();
    const since = new Date(t - RECENT_DAYS * DAY).toISOString();
    const out = [];
    for (const b of bots.list()) {
      const list = learn.changesSince(b.id, since);
      if (!list.length) continue;
      const rows = rowsOf(b.id, t - 2 * RECENT_DAYS * DAY);
      for (const c of list) out.push({ name: b.name, ...c, effect: effectOf(rows, c.at, t) });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, max);
  }

  return { effectAt, recent };
}

module.exports = { create, effectOf, effectLine, RECENT_DAYS };
