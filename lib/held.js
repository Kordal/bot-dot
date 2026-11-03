// What holds up the server (the hq freezes of 2026-11-03): the server answers nothing while one synchronous call
// runs, so each one that takes long is said in the log with what it was and who asked, and a held event loop is said
// with the slow calls and the last request inside it. Off where nothing is slow: every timing is two clock reads.
//
// BOT_DOT_SLOW_SYNC_MS: a synchronous call this long or longer is logged (default 200; 0 turns logging off).
// BOT_DOT_LAG_WARN_MS: an event loop held this long or longer is logged (default 500; 0 turns the watch off).
const { performance } = require('node:perf_hooks');

const ms = (name, otherwise) => { const v = Number(process.env[name]); return Number.isFinite(v) && v >= 0 ? v : otherwise; };
const slowAt = () => ms('BOT_DOT_SLOW_SYNC_MS', 200);

const recent = []; // { what, at, took }: the calls that took 20 ms or more, the newest last
const KEEP = 50;
let last = null; // { label, at }: the request the server started last
let log = (line) => console.warn(line);

// Where the call came from: the first frames outside this file and the wrappers that called it.
function caller(skip) {
  const lines = String(new Error().stack).split('\n').slice(1)
    .filter((l) => !l.includes(__filename) && !skip.some((s) => l.includes(s)))
    .map((l) => l.trim().replace(/^at /, '').replace(/[^\s(]*\//g, ''));
  return lines.slice(0, 3).join(' < ');
}

// Runs fn and times it. label: a string or a function that makes one (only called when the call took 20 ms or more).
// skip: file names of the wrappers between the real caller and here, left out of "from".
function time(label, fn, skip = []) {
  const start = performance.now();
  try { return fn(); } finally {
    const took = performance.now() - start;
    if (took >= 20) {
      let what; try { what = typeof label === 'function' ? label() : label; } catch { what = '?'; }
      recent.push({ what, at: start, took });
      if (recent.length > KEEP) recent.shift();
      const slow = slowAt();
      if (slow && took >= slow) log(`[held] ${Math.round(took)} ms ${what} from ${caller(skip)}`);
    }
  }
}

// A node:sqlite database whose statements and exec are timed, labelled with their SQL's start.
function sqlite(db, name) {
  const sqlLabel = (sql) => () => `${name} ${String(sql).replace(/\s+/g, ' ').trim().slice(0, 80)}`;
  const statement = (st, sql) => new Proxy(st, {
    get(target, key) {
      const v = Reflect.get(target, key, target);
      if (typeof v !== 'function') return v;
      if (['run', 'get', 'all'].includes(key)) return (...args) => time(sqlLabel(sql), () => v.apply(target, args), [__filename]);
      return v.bind(target);
    },
  });
  return new Proxy(db, {
    get(target, key) {
      const v = Reflect.get(target, key, target);
      if (typeof v !== 'function') return v;
      if (key === 'prepare') return (sql, ...rest) => statement(v.call(target, sql, ...rest), sql);
      if (key === 'exec') return (sql) => time(sqlLabel(sql), () => v.call(target, sql), [__filename]);
      return v.bind(target);
    },
  });
}

// The request the server is on, for a held loop that no timed call explains.
function request(method, url) { last = { label: `${method} ${String(url).split('?')[0].slice(0, 120)}`, at: performance.now() }; }

// Checks every `every` ms that the event loop came back in time; when it was held, says how long and what ran then.
function watch({ every = 250 } = {}) {
  const warnAt = ms('BOT_DOT_LAG_WARN_MS', 500);
  if (!warnAt) return () => {};
  let expected = performance.now() + every;
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    expected = now + every;
    if (lag < warnAt) return;
    const from = now - lag - every;
    const inside = recent.filter((r) => r.at + r.took >= from).sort((a, b) => b.took - a.took).slice(0, 3)
      .map((r) => `${r.what} ${Math.round(r.took)} ms`);
    const req = last ? `; last request ${last.label}, ${Math.round(now - last.at)} ms ago` : '';
    log(`[lag] event loop held ${Math.round(lag)} ms; slow calls then: ${inside.length ? inside.join(', ') : 'none timed'}${req}`);
  }, every);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { time, sqlite, request, watch, _setLog: (fn) => { log = fn || ((line) => console.warn(line)); } };
