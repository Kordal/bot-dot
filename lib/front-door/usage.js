// @ts-check
// How the machine's accounts use botdot, for the admin page (ADR 105): once a day the front door asks each account's
// botdot server for the counts of each finished UTC day it lacks (GET /api/usage-summary, lib/routes/usage-summary.js),
// keeps one row per account and day in usage.json beside front-door.json (mode 600), and drops a row after 13 months
// and every row of an account the admin deleted. A row holds counts, yes-or-no and a version, nothing else: whatever
// an account's server answers is cut down to those first. Nothing leaves the machine.
const fs = require('fs');
const path = require('path');

const KEEP_MONTHS = 13;
const BACK_DAYS = 7; // a day an account didn't answer is asked for again, up to this many days back
const OUTCOMES = ['done', 'failed', 'stopped', 'needs_you', 'passed']; // lib/outcomes.js
const ERRORS = ['signout', 'idle', 'limit', 'timeout', 'exit', 'disk', 'no_reply', 'no_start', 'restart', 'error'];
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
  return row;
}

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
        if (d < created || rows[a.name]?.[d]) continue;
        let r;
        try { r = await ask(a.name, d); } catch { r = { status: 0, data: null }; }
        if (r.status !== 200 || !r.data) break; // not running, or too old to answer: tried again next time
        (rows[a.name] ||= {})[d] = clean(r.data);
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
      if (bot !== null && run !== null) { t.activationKnown++; if (bot && run) t.activated++; }
      // Retention: active on any day of its second week, of its fifth week, once that week has ended and it was
      // counted from its start.
      const kept = (start) => {
        const end = addDays(created, start + 6);
        if (end > yesterday || !days.length || days[0] > addDays(created, start)) return null;
        return any(addDays(created, start), end, (r) => r.active);
      };
      const w1 = kept(7), w4 = kept(28);
      if (w1 !== null) { t.week1Of++; if (w1) t.week1++; }
      if (w4 !== null) { t.week4Of++; if (w4) t.week4++; }
      if (any(from7, yesterday, (r) => r.active)) t.weeklyActive++;
      const sum = { activeDays: 0, runs: 0, failed: 0, counted: 0, corrected: 0, web: 0, android: 0, messages: 0 };
      for (const d of days) {
        if (d < from30) continue;
        const r = own[d];
        if (r.active) sum.activeDays++;
        const runs = Object.values(r.runs).reduce((n, x) => n + x, 0);
        sum.runs += runs; sum.failed += r.runs.failed || 0; sum.counted += r.counted; sum.corrected += r.corrected;
        sum.web += r.web; sum.android += r.android; sum.messages += r.messages;
        for (const [k, n] of Object.entries(r.errors)) errors[k] = (errors[k] || 0) + n;
      }
      t.runs += sum.runs; t.counted += sum.counted; t.corrected += sum.corrected;
      const latest = days.length ? own[days[days.length - 1]] : null;
      if (latest) for (const k of FEATURES) if (latest.features[k]) features[k]++;
      return {
        name: a.name, created: a.created, lastDay: days[days.length - 1] || null, ...sum,
        bots: latest ? latest.bots : null, version: latest ? latest.version : null,
        features: latest ? FEATURES.filter((k) => latest.features[k]) : [],
        activation: { bot, run }, retention: { week1: w1, week4: w4 },
      };
    });
    return { day: yesterday, totals: { ...t, errors, features }, accounts: list };
  }

  const rowsOf = (/** @type {string} */ name) => rows[name] || {};
  // The admin deleted an account: its rows go now, not at the next collection.
  const forget = (/** @type {string} */ name) => { if (rows[name]) { delete rows[name]; save(); } };
  return { collect, report, rowsOf, forget };
}

module.exports = { open, clean, FEATURES, KEEP_MONTHS, BACK_DAYS };
