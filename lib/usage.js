// Token usage (#301): the tokens Claude Code's `result` events report, added up per day and per bot in the account's
// data folder (`usage.json`), for Settings → Usage. A day is the account's day (its time zone), the Chief of Staff
// counts as one row of its own, and a group's turn counts for the member whose run it is. Only what is recorded
// from the update that brought it on is there: nothing is read back from older runs. Days older than KEEP_DAYS go.
// No cost is kept or shown: tokens only (AGENTS.md rule 5).
//
// usage.json: { days: { "YYYY-MM-DD": { "<bot id>" | "@chief": { input, output, cacheRead, cacheWrite, runs } } },
//               names: { "<bot id>": "<its name when it last used tokens>" } }
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const KEEP_DAYS = 400;
const CHIEF = '@chief'; // never a bot's id: those are letters, digits and dashes
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'runs'];

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// The day of `now` in a time zone, as YYYY-MM-DD.
function dayOf(now, timeZone = zone()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Day arithmetic on YYYY-MM-DD, by the calendar alone (no time zone involved).
const toUtc = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const addDays = (day, n) => new Date(toUtc(day) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
const validDay = (day) => typeof day === 'string' && DAY_RE.test(day) && addDays(day, 0) === day;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

// What one result event adds: its four token counts. null when it reports none.
function fromResult(ev) {
  if (!ev || ev.type !== 'result') return null;
  const u = ev.usage && typeof ev.usage === 'object' ? ev.usage : {};
  const add = {
    input: num(u.input_tokens), output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens),
  };
  return Object.values(add).some((v) => v > 0) ? add : null;
}

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, runs: 0 });
function addInto(sum, add) {
  for (const k of FIELDS) sum[k] = (sum[k] || 0) + (add[k] || 0);
  return sum;
}
// As the API sends it (docs/api.md, Token usage).
const shown = (s) => ({
  inputTokens: s.input, outputTokens: s.output, cacheReadTokens: s.cacheRead, cacheWriteTokens: s.cacheWrite,
  totalTokens: s.input + s.output + s.cacheRead + s.cacheWrite, runs: s.runs,
});

// dataDir: the account's data folder; each account has its own, so it sees only its own usage (ADR 028).
// now(): the clock; timeZone(): the account's time zone (setup's, or TZ).
function create(dataDir, { now = () => new Date(), timeZone = zone } = {}) {
  const FILE = path.join(dataDir, 'usage.json');
  let data = null;
  const load = () => {
    if (!data) {
      const d = readJson(FILE, {});
      data = { days: d && typeof d.days === 'object' && d.days ? d.days : {}, names: d && typeof d.names === 'object' && d.names ? d.names : {} };
    }
    return data;
  };
  const today = () => dayOf(now(), timeZone());

  // Drops the days older than KEEP_DAYS before today. Returns whether anything went.
  function prune(d = load()) {
    const oldest = addDays(today(), -(KEEP_DAYS - 1));
    let gone = false;
    for (const day of Object.keys(d.days)) if (!validDay(day) || day < oldest) { delete d.days[day]; gone = true; }
    return gone;
  }

  // One result event of a bot's run (botId, its name) or of the Chief (botId null). Never throws: usage is not worth
  // a failed run.
  function record(botId, ev, name) {
    try {
      const add = fromResult(ev);
      if (!add) return false;
      const d = load();
      const key = botId ? String(botId) : CHIEF;
      const day = today();
      const row = (d.days[day] ||= {});
      addInto((row[key] ||= zero()), { ...add, runs: 1 });
      if (botId && name) d.names[key] = String(name).slice(0, 200);
      prune(d);
      writeJson(FILE, d);
      return true;
    } catch (e) {
      console.error(`[usage] couldn't record: ${e.message}`);
      return false;
    }
  }

  // The usage from `from` to `to`, both days included (YYYY-MM-DD, the account's days). Missing: today. Throws a 400
  // for a day that isn't one, a range that runs backwards or one longer than what is kept.
  // botName(id): a bot's name today, or null when it is gone (then the name it last used tokens under).
  function range({ from, to } = {}, { botName = () => null, chiefName = 'Chief of Staff' } = {}) {
    const t = today();
    from = from || to || t;
    to = to || from;
    const bad = (m) => Object.assign(new Error(m), { status: 400 });
    if (!validDay(from) || !validDay(to)) throw bad('from and to are days, as YYYY-MM-DD.');
    if (to < from) throw bad('to is before from.');
    if (daysBetween(from, to) >= KEEP_DAYS) throw bad(`At most ${KEEP_DAYS} days.`);
    const d = load();
    const total = zero();
    const perBot = new Map();
    const days = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const sum = zero();
      for (const [key, s] of Object.entries(d.days[day] || {})) {
        addInto(sum, s);
        addInto(total, s);
        if (!perBot.has(key)) perBot.set(key, zero());
        addInto(perBot.get(key), s);
      }
      days.push({ day, ...shown(sum) });
    }
    const bots = [...perBot].map(([key, s]) => (key === CHIEF
      ? { id: null, chief: true, name: chiefName, ...shown(s) }
      : { id: key, name: botName(key) || d.names[key] || key, gone: botName(key) ? undefined : true, ...shown(s) }))
      .sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name));
    return { from, to, today: t, timeZone: timeZone(), keepDays: KEEP_DAYS, totals: shown(total), bots, days };
  }

  return { record, range, prune: () => { const d = load(); if (prune(d)) writeJson(FILE, d); }, FILE };
}

module.exports = { create, fromResult, dayOf, addDays, KEEP_DAYS };
