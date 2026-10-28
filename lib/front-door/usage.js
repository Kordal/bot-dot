// @ts-check
// How the machine's accounts use botdot, for the admin page (ADR 105): once a day the front door asks each account's
// botdot server for the counts of each finished UTC day it lacks (GET /api/usage-summary, lib/routes/usage-summary.js),
// keeps one row per account and day in usage.json beside front-door.json (mode 600), and drops a row after 13 months
// and every row of an account the admin deleted. A row holds counts, yes-or-no and a version, and a failed run's
// redacted error line (ADR 109), nothing else: whatever an account's server answers is cut down to those first. Nothing leaves the machine.
const fs = require('fs');
const path = require('path');
const errorDetail = require('../error-detail');

const KEEP_MONTHS = 13;
const BACK_DAYS = 7; // a day an account didn't answer is asked for again, up to this many days back
const OUTCOMES = ['done', 'failed', 'stopped', 'needs_you', 'passed']; // lib/outcomes.js
const ERRORS = ['signout', 'idle', 'limit', 'timeout', 'exit', 'disk', 'no_reply', 'no_start', 'restart', 'claude_limit', 'rate_limit', 'too_long', 'auth', 'api_error', 'max_turns', 'error'];
const SOURCES = ['owner', 'job', 'group', 'bot', 'chief', 'aside', 'replies', 'review', 'hello', 'reminder'];
const RUN_KINDS = ['claude', 'script', 'aside', 'replay'];
const MAX_FAILURES = 100; // a day's failed runs kept one by one
const TOOL = /^[A-Za-z0-9_.:-]{1,80}$/;
const FEATURES = ['groups', 'pages', 'jobs', 'scripts', 'computer', 'vaultLogins', 'connectors', 'rooms', 'boat'];
const COUNTS = ['bots', 'counted', 'reasked', 'corrected', 'messages', 'web', 'android'];

const DAY_MS = 864e5;
/** @param {number} t */
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
/** @param {string} d @param {number} n */
const addDays = (d, n) => dayOf(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS);
/** @param {unknown} n */
const count = (n) => (Number.isInteger(n) && /** @type {number} */ (n) >= 0 ? Math.min(/** @type {number} */ (n), 1e9) : 0);
/** @param {unknown} o @param {string[]} keys */
const counts = (o, keys) => {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of keys) { const n = count(/** @type {any} */ (o)?.[k]); if (n) out[k] = n; }
  return out;
};

// An account's answer, cut down to what a row may hold.
/** @param {any} s */
function clean(s) {
  /** @type {Record<string, any>} */
  const row = {
    version: typeof s?.version === 'string' && /^[\w.+-]{1,40}$/.test(s.version) ? s.version : null,
    active: s?.active === true,
    runs: counts(s?.runs, OUTCOMES),
    errors: counts(s?.errors, ERRORS),
    cards: { shown: count(s?.cards?.shown), answered: count(s?.cards?.answered), medianAnswerMs: Number.isInteger(s?.cards?.medianAnswerMs) && s.cards.medianAnswerMs >= 0 ? s.cards.medianAnswerMs : null },
    features: Object.fromEntries(FEATURES.map((k) => [k, s?.features?.[k] === true])),
  };
  for (const k of COUNTS) row[k] = count(s?.[k]);
  // Each failed run (#615): when, its kind of failure, where it came from, its bot's number, how long, and the names of
  // the tools that failed. Absent from an account's server older than that, which is asked again while it is recent.
  if (Array.isArray(s?.failures)) {
    const day = typeof s.day === 'string' ? s.day : null;
    row.failures = s.failures.slice(0, MAX_FAILURES).filter((f) => f && typeof f.at === 'string' && !Number.isNaN(Date.parse(f.at))).map((f) => ({
      at: new Date(Date.parse(f.at)).toISOString(),
      kind: ERRORS.includes(f.kind) ? f.kind : 'error',
      bot: Number.isInteger(f.bot) && f.bot > 0 && f.bot < 1e4 ? f.bot : null,
      source: SOURCES.includes(f.source) ? f.source : null,
      run: RUN_KINDS.includes(f.run) ? f.run : null,
      durationMs: Number.isInteger(f.durationMs) && f.durationMs >= 0 ? f.durationMs : null,
      turns: Number.isInteger(f.turns) && f.turns >= 0 ? f.turns : null,
      retries: count(f.retries),
      toolErrors: count(f.toolErrors),
      tools: Array.isArray(f.tools) ? f.tools.filter((t) => typeof t === 'string' && TOOL.test(t)).slice(0, 5) : [],
      // Its error's line (ADR 109), redacted here again. Absent from an account's server older than that.
      ...('detail' in f ? { detail: errorDetail.detail(f.detail) } : {}),
    })).filter((f) => !day || f.at.slice(0, 10) === day);
  }
  return row;
}

// Whether a row's failed runs carry their error's line, null or not (ADR 109).
/** @param {Record<string, any>} row */
const detailed = (row) => (row.failures || []).every((/** @type {any} */ f) => 'detail' in f);

/** @param {string} dir the front door's data folder @param {{ now?: () => number }} [options] */
function open(dir, { now = () => Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, 'usage.json');
  /** @type {Record<string, Record<string, any>>} account → day → row */
  let rows = {};
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (saved && typeof saved.rows === 'object') rows = saved.rows;
  } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') console.error(`[front door] usage.json: ${/** @type {any} */ (e).message}`);
  }
  function save() {
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ rows }), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }
  const cutoff = () => { const d = new Date(now()); d.setUTCMonth(d.getUTCMonth() - KEEP_MONTHS); return dayOf(d.getTime()); };

  // Asks every account for each finished day it lacks, one request at a time. accounts: [{ name, created }].
  // ask(name, day): the account's answer, { status, data }. Rows of accounts no longer listed, and old ones, go.
  /** @param {{ name: string, created: string }[]} accounts @param {(name: string, day: string) => Promise<{ status: number, data: any }>} ask */
  async function collect(accounts, ask) {
    const yesterday = dayOf(now() - DAY_MS);
    const oldest = cutoff();
    let changed = false;
    const names = new Set(accounts.map((a) => a.name));
    for (const name of Object.keys(rows)) if (!names.has(name)) { delete rows[name]; changed = true; }
    for (const name of Object.keys(rows)) for (const d of Object.keys(rows[name])) if (d < oldest) { delete rows[name][d]; changed = true; }
    for (const a of accounts) {
      const created = dayOf(Date.parse(a.created) || now());
      for (let d = addDays(yesterday, 1 - BACK_DAYS); d <= yesterday; d = addDays(d, 1)) {
        const had = rows[a.name]?.[d];
        // A day kept before failures were listed one by one (#615), or before they had their error's line (ADR 109),
        // is asked again for them.
        if (d < created || (had && ((had.failures && detailed(had)) || !had.runs.failed))) continue;
        let r;
        try { r = await ask(a.name, d); } catch { r = { status: 0, data: null }; }
        if (r.status !== 200 || !r.data) break; // not running, or too old to answer: tried again next time
        const row = clean(r.data);
        if (had && (!row.failures || (had.failures && !detailed(row)))) continue; // its server doesn't list them, or their lines, yet
        (rows[a.name] ||= {})[d] = row;
        changed = true;
      }
    }
    if (changed) save();
  }

  // What the admin page shows. accounts: [{ name, created }].
  /** @param {{ name: string, created: string }[]} accounts */
  function report(accounts) {
    const yesterday = dayOf(now() - DAY_MS);
    const from30 = addDays(yesterday, -29);
    const from7 = addDays(yesterday, -6);
    const errors = /** @type {Record<string, number>} */ ({});
    const features = Object.fromEntries(FEATURES.map((k) => [k, 0]));
    const t = { accounts: accounts.length, weeklyActive: 0, activated: 0, activationKnown: 0, week1: 0, week1Of: 0, week4: 0, week4Of: 0, runs: 0, counted: 0, corrected: 0 };
    const list = accounts.map((a) => {
      const own = rows[a.name] || {};
      const { bot, run, w1, w4, sum, latest } = sumUp(a, own, from30);
      if (bot !== null && run !== null) { t.activationKnown++; if (bot && run) t.activated++; }
      if (w1 !== null) { t.week1Of++; if (w1) t.week1++; }
      if (w4 !== null) { t.week4Of++; if (w4) t.week4++; }
      if (Object.keys(own).some((d) => d >= from7 && d <= yesterday && own[d].active)) t.weeklyActive++;
      for (const d of Object.keys(own)) if (d >= from30) for (const [k, n] of Object.entries(own[d].errors)) errors[k] = (errors[k] || 0) + n;
      t.runs += sum.runs; t.counted += sum.counted; t.corrected += sum.corrected;
      if (latest) for (const k of FEATURES) if (latest.features[k]) features[k]++;
      return entry(a, own, sum, latest, { bot, run }, { week1: w1, week4: w4 });
    });
    return { day: yesterday, totals: { ...t, errors, features }, accounts: list };
  }

  /** @param {{ name: string, created: string }} a @param {Record<string, any>} own @param {any} sum @param {any} latest @param {any} activation @param {any} retention */
  const entry = (a, own, sum, latest, activation, retention) => {
    const days = Object.keys(own).sort();
    return {
      name: a.name, created: a.created, lastDay: days[days.length - 1] || null, ...sum,
      bots: latest ? latest.bots : null, version: latest ? latest.version : null,
      features: latest ? FEATURES.filter((k) => latest.features[k]) : [],
      activation, retention,
    };
  };

  // One account's activation, retention and sums of the 30 days from from30 to yesterday.
  /** @param {{ name: string, created: string }} a @param {Record<string, any>} own @param {string} from30 */
  function sumUp(a, own, from30) {
    const yesterday = dayOf(now() - DAY_MS);
    const days = Object.keys(own).sort();
    const created = dayOf(Date.parse(a.created) || now());
    const has = (d) => !!own[d];
    const any = (from, to, test) => days.some((d) => d >= from && d <= to && test(own[d]));
    const all = (from, to) => { for (let d = from; d <= to; d = addDays(d, 1)) if (!has(d)) return false; return true; };
    // Activation: a bot within 24 hours (its first two days), a successful run within 7 days. null: not known yet,
    // or from before the rows began.
    const flag = (to, test) => (any(created, to, test) ? true : to <= yesterday && all(created, to) ? false : null);
    const bot = flag(addDays(created, 1), (r) => r.bots > 0 || Object.keys(r.runs).length > 0);
    const run = flag(addDays(created, 6), (r) => r.runs.done > 0);
    // Retention: active on any day of its second week, of its fifth week, once that week has ended and it was
    // counted from its start.
    const kept = (start) => {
      const end = addDays(created, start + 6);
      if (end > yesterday || !days.length || days[0] > addDays(created, start)) return null;
      return any(addDays(created, start), end, (r) => r.active);
    };
    const w1 = kept(7), w4 = kept(28);
    const sum = { activeDays: 0, runs: 0, failed: 0, counted: 0, corrected: 0, web: 0, android: 0, messages: 0 };
    for (const d of days) {
      if (d < from30) continue;
      const r = own[d];
      if (r.active) sum.activeDays++;
      const runs = Object.values(r.runs).reduce((n, x) => n + x, 0);
      sum.runs += runs; sum.failed += r.runs.failed || 0; sum.counted += r.counted; sum.corrected += r.corrected;
      sum.web += r.web; sum.android += r.android; sum.messages += r.messages;
    }
    const latest = days.length ? own[days[days.length - 1]] : null;
    return { bot, run, w1, w4, sum, latest };
  }

  // One account's own numbers for the admin page: what report() has for it, and the 30 days one by one. A day the
  // account didn't answer has counted: false. null for an account not listed.
  /** @param {string} name @param {{ name: string, created: string }[]} accounts */
  function account(name, accounts) {
    const a = accounts.find((x) => x.name === name);
    if (!a) return null;
    const yesterday = dayOf(now() - DAY_MS);
    const from30 = addDays(yesterday, -29);
    const own = rows[name] || {};
    const { bot, run, w1, w4, sum, latest } = sumUp(a, own, from30);
    const runs = /** @type {Record<string, number>} */ ({});
    const errors = /** @type {Record<string, number>} */ ({});
    const cards = { shown: 0, answered: 0, medianAnswerMs: /** @type {number | null} */ (null) };
    const medians = [];
    const days = [];
    const failures = [];
    let unlisted = 0; // failed runs of days kept before they were listed
    for (let d = from30; d <= yesterday; d = addDays(d, 1)) {
      const r = own[d];
      if (!r) { days.push({ day: d, counted: false, active: false, runs: {} }); continue; }
      days.push({ day: d, counted: true, active: r.active, runs: r.runs });
      for (const [k, n] of Object.entries(r.runs)) runs[k] = (runs[k] || 0) + n;
      for (const [k, n] of Object.entries(r.errors)) errors[k] = (errors[k] || 0) + n;
      cards.shown += r.cards.shown; cards.answered += r.cards.answered;
      if (r.failures) failures.push(...r.failures); else unlisted += r.runs.failed || 0;
      if (r.cards.answered && r.cards.medianAnswerMs !== null) medians.push(r.cards.medianAnswerMs);
    }
    if (medians.length) { medians.sort((x, y) => x - y); const m = medians.length >> 1; cards.medianAnswerMs = medians.length % 2 ? medians[m] : Math.round((medians[m - 1] + medians[m]) / 2); }
    return { day: yesterday, ...entry(a, own, sum, latest, { bot, run }, { week1: w1, week4: w4 }), runsBy: runs, errors, cards, days, failures: failures.reverse(), unlisted };
  }

  const rowsOf = (/** @type {string} */ name) => rows[name] || {};
  // The admin deleted an account: its rows go now, not at the next collection.
  const forget = (/** @type {string} */ name) => { if (rows[name]) { delete rows[name]; save(); } };
  return { collect, report, account, rowsOf, forget };
}

module.exports = { open, clean, FEATURES, KEEP_MONTHS, BACK_DAYS };
