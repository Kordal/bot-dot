// The outcome ledger (ADR 099): one compact row per finished bot run, in data/memory.db beside the run's entry in
// the past-run index. How the run ended, what failed on the way, and the owner's own signals after it, for what
// reads how the team does: a replay of a run, a job turned into a script, the Chief's weekly review. No text of a
// run is kept here: no request, no reply, no error message, no note. Inputs are ids. No cost either (AGENTS.md rule 5).
//
// The owner's signals outrank any judgement of a model: a run whose reply the owner corrected is a bad run, whatever
// its status says.

const REASK_MS = 10 * 60_000; // the owner writing to the same bot this soon after its reply re-asks
const BACKFILL_DAYS = 7; // on start, the runs of this many days without a row get one from their run file
const MAX_TOOLS = 5; // the names of failed tools kept per run
const OUTCOMES = ['done', 'failed', 'stopped', 'needs_you', 'passed'];
// The start of a message that tells the bot it got it wrong (English and Polish, as the other word lists here).
const CORRECTION = /^\s*(no\b|nope\b|not (that|what|quite|right)\b|wrong\b|that'?s (wrong|not)\b|that is (wrong|not)\b|incorrect\b|you (missed|forgot|didn'?t)\b|i (said|meant|asked)\b|again\b|try again\b|nie\b|źle\b|zle\b|błąd\b|blad\b|popraw|jeszcze raz\b|miało być\b|mialo byc\b|chodziło mi\b|chodzilo mi\b)/iu;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS outcomes (
    run_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, at TEXT NOT NULL, ended_at TEXT, trigger TEXT, source TEXT, job TEXT, kind TEXT,
    outcome TEXT NOT NULL, ended_by TEXT, error_kind TEXT, tool_errors INTEGER, failed_tools TEXT, retries INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER, turns INTEGER, reply_at TEXT, counted INTEGER NOT NULL DEFAULT 0, reasked_at TEXT, corrected INTEGER NOT NULL DEFAULT 0,
    inputs TEXT);
  CREATE INDEX IF NOT EXISTS outcomes_bot ON outcomes(bot_id, at);
`;

// How a run ended, in one word. holds: its reply asks the owner something (choices.js holds).
function outcomeOf(meta, holds = false) {
  if (meta.status === 'stopped') return 'stopped';
  if (meta.status !== 'success') return 'failed';
  if (meta.passed) return 'passed';
  if (holds || meta.askedChief || meta.askedAsker || meta.heldQuestion) return 'needs_you';
  return 'done';
}
// What kind of failure, in a word botdot chose, never the error's own text (it can quote what the run read).
function errorKind(meta) {
  if (meta.status === 'interrupted') return 'restart'; // botdot was restarted while it went
  if (meta.status !== 'error') return null;
  if (meta.endedBy) return meta.endedBy; // signout, idle, limit
  const e = String(meta.error || '');
  if (/no space|disk is full/i.test(e)) return 'disk';
  if (/finished without a reply botdot could read/i.test(e)) return 'no_reply';
  if (/stopped after \d+ seconds|timed? ?out/i.test(e)) return 'timeout';
  if (/exit(ed)? (with )?code/i.test(e)) return 'exit';
  if (/^It didn't start/.test(e)) return 'no_start';
  if (/not logged in|please run \/login/i.test(e)) return 'signout';
  return 'error';
}
// What a run was handed, for a replay: ids and counts only.
function inputsOf(meta) {
  const relevant = Array.isArray(meta.relevant) ? meta.relevant : [];
  const ids = (kind) => relevant.filter((r) => r?.kind === kind && r.id).map((r) => String(r.id));
  const out = {
    notes: ids('note'), runs: ids('run'),
    files: Array.isArray(meta.files) ? meta.files.length : 0,
    ...(meta.model ? { model: String(meta.model) } : {}), ...(meta.effort ? { effort: String(meta.effort) } : {}),
    ...(meta.continues ? { continues: String(meta.continues) } : {}), ...(meta.chainId ? { chain: String(meta.chainId) } : {}),
  };
  return JSON.stringify(out);
}
// Where a run came from: the owner's own message, a job, a group, a teammate, the Chief, or botdot itself.
function sourceOf(meta, kind) {
  if (kind === 'aside' || meta.btw) return 'aside';
  if (meta.groupId) return 'group';
  if (meta.jobId || meta.jobName || meta.kind === 'script') return 'job';
  if (meta.fromBot || meta.trigger === 'bot') return 'bot';
  if (meta.startedBy === 'chief') return 'chief';
  if (['replies', 'review', 'hello', 'reminder'].includes(meta.trigger)) return meta.trigger;
  return 'owner';
}
// Its task as the ledger groups runs: the job's name, or where the run came from.
const taskOf = (r) => (r.job ? `job "${r.job}"` : r.source || 'owner');

// A watcher of tool calls in a run's stream of events: which failed, by the tool's name.
function toolWatch() {
  const names = new Map(); // tool_use id -> name
  const failed = [];
  return {
    see(ev) {
      for (const c of ev?.message?.content || []) {
        if (ev.type === 'assistant' && c?.type === 'tool_use' && c.id) names.set(c.id, String(c.name || ''));
        if (ev.type === 'user' && c?.type === 'tool_result' && c.is_error) failed.push(names.get(c.tool_use_id) || '');
      }
    },
    get count() { return failed.length; },
    get tools() { return [...new Set(failed.filter(Boolean))].slice(0, MAX_TOOLS); },
  };
}

// db: memory.js's database. q: its statement cache.
function create(db, q) {
  db.exec(SCHEMA);
  const view = (r, readAt) => {
    const opened = r.counted && r.reply_at && readAt ? readAt(r.bot_id) >= r.reply_at : null;
    let inputs = {};
    try { inputs = JSON.parse(r.inputs || '{}'); } catch { /* left empty */ }
    let tools = [];
    try { tools = JSON.parse(r.failed_tools || '[]'); } catch { /* left empty */ }
    return {
      runId: r.run_id, botId: r.bot_id, at: r.at, endedAt: r.ended_at, trigger: r.trigger, source: r.source, job: r.job || null, kind: r.kind, task: taskOf(r), outcome: r.outcome,
      ...(r.ended_by ? { endedBy: r.ended_by } : {}), ...(r.error_kind ? { errorKind: r.error_kind } : {}),
      toolErrors: r.tool_errors, ...(tools.length ? { failedTools: tools } : {}), retries: r.retries, durationMs: r.duration_ms, turns: r.turns,
      ...(r.reasked_at ? { reasked: true } : {}), ...(r.corrected ? { corrected: true } : {}), ...(opened === null ? {} : { opened }),
      inputs,
    };
  };

  // A finished run's row. extra: { tools: toolWatch(), retries, holds, counted, replyAt, kind }. A second record of the
  // same run (it was indexed again) keeps what the owner did after it.
  function record(meta, { tools = null, retries = 0, holds = false, counted = false, replyAt = null, kind = null } = {}) {
    if (!meta?.id || !meta.botId || meta.botId === 'chief' || !meta.status || meta.status === 'running') return;
    const started = Date.parse(meta.startedAt || '');
    const ended = Date.parse(meta.endedAt || '');
    const duration = meta.durationMs ?? (Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null);
    q(`INSERT INTO outcomes (run_id, bot_id, at, ended_at, trigger, source, job, kind, outcome, ended_by, error_kind, tool_errors, failed_tools, retries, duration_ms, turns, reply_at, counted, inputs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET ended_at = excluded.ended_at, outcome = excluded.outcome, ended_by = excluded.ended_by, error_kind = excluded.error_kind,
         tool_errors = COALESCE(excluded.tool_errors, outcomes.tool_errors), failed_tools = COALESCE(excluded.failed_tools, outcomes.failed_tools),
         retries = MAX(outcomes.retries, excluded.retries), duration_ms = excluded.duration_ms, turns = excluded.turns, reply_at = excluded.reply_at, counted = excluded.counted, inputs = excluded.inputs`)
      .run(String(meta.id), String(meta.botId), meta.startedAt || meta.endedAt || new Date().toISOString(), meta.endedAt || null, meta.trigger || 'manual', sourceOf(meta, kind), meta.jobName || '',
        kind || (meta.kind === 'script' ? 'script' : meta.btw ? 'aside' : 'claude'), outcomeOf(meta, holds), meta.endedBy || null, errorKind(meta),
        tools ? tools.count : null, tools ? JSON.stringify(tools.tools) : null, Number(retries) || 0,
        Number.isFinite(duration) ? Math.round(duration) : null, Number.isInteger(meta.numTurns) ? meta.numTurns : null,
        replyAt || null, counted ? 1 : 0, inputsOf(meta));
  }

  // The owner wrote to a bot in its own chat: the newest run of that bot whose reply reached them within REASK_MS
  // before is re-asked, and corrected when the message reads as a correction. Returns that run's id, or null.
  function ownerWrote(botId, text, at = new Date().toISOString()) {
    const since = new Date(Date.parse(at) - REASK_MS).toISOString();
    const r = q(`SELECT run_id FROM outcomes WHERE bot_id = ? AND counted = 1 AND reasked_at IS NULL AND reply_at >= ? AND reply_at <= ?
                 ORDER BY reply_at DESC LIMIT 1`).get(String(botId), since, at);
    if (!r) return null;
    q('UPDATE outcomes SET reasked_at = ?, corrected = ? WHERE run_id = ?').run(at, CORRECTION.test(String(text || '')) ? 1 : 0, r.run_id);
    return r.run_id;
  }

  // A bot's rows since a day, the newest first. readAt(botId): the bot's chat's read position, which tells whether a
  // reply was opened.
  const list = ({ botId, since = '', limit = 500, readAt = null } = {}) => q('SELECT * FROM outcomes WHERE bot_id = ? AND at >= ? ORDER BY at DESC LIMIT ?')
    .all(String(botId), since, limit).map((r) => view(r, readAt));
  const get = (runId, readAt = null) => { const r = q('SELECT * FROM outcomes WHERE run_id = ?').get(String(runId)); return r ? view(r, readAt) : null; };
  const has = (runId) => !!q('SELECT 1 FROM outcomes WHERE run_id = ?').get(String(runId));

  // What went wrong in a run, each a signal of its own. The owner's come first.
  const signalsOf = (o) => [
    o.corrected && 'corrected', o.reasked && !o.corrected && 'reasked', o.endedBy === 'owner' && 'stopped by the owner',
    o.outcome === 'failed' && `failed${o.errorKind ? ` (${o.errorKind})` : ''}`, o.toolErrors > 0 && 'tool errors', o.retries > 0 && 'retried',
    o.opened === false && 'not opened',
  ].filter(Boolean);
  // A bot's worst patterns since a day: a task and a signal, with how many of that task's runs had it. Sorted by
  // that count, then by its share of the task's runs. examples: up to 3 run ids, the newest first.
  function worst({ botId, since = '', limit = 5, readAt = null } = {}) {
    const rows = list({ botId, since, limit: 5000, readAt });
    const runsOf = new Map();
    const hits = new Map();
    for (const o of rows) {
      runsOf.set(o.task, (runsOf.get(o.task) || 0) + 1);
      for (const s of signalsOf(o)) {
        const key = `${o.task}\u0001${s}`;
        const h = hits.get(key) || { task: o.task, signal: s, runs: 0, examples: [], tools: new Set() };
        h.runs++;
        if (h.examples.length < 3) h.examples.push(o.runId);
        if (s === 'tool errors') for (const t of o.failedTools || []) h.tools.add(t);
        hits.set(key, h);
      }
    }
    return [...hits.values()].map(({ tools, ...h }) => ({ ...h, of: runsOf.get(h.task), ...(tools.size ? { tools: [...tools].slice(0, MAX_TOOLS) } : {}) }))
      .sort((a, b) => b.runs - a.runs || b.runs / b.of - a.runs / a.of).slice(0, limit);
  }

  const drop = (runIds) => { for (const id of runIds) q('DELETE FROM outcomes WHERE run_id = ?').run(String(id)); };
  const dropBot = (botId) => q('DELETE FROM outcomes WHERE bot_id = ?').run(String(botId));
  const prune = (cutoff) => q('DELETE FROM outcomes WHERE at < ?').run(cutoff).changes;

  return { record, ownerWrote, list, get, has, worst, drop, dropBot, prune };
}

module.exports = { create, toolWatch, outcomeOf, errorKind, sourceOf, CORRECTION, REASK_MS, BACKFILL_DAYS, OUTCOMES };
