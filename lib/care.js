// Care (ADR 212): the Chief worries a little about the owner, only about what botdot sees in its own records, and
// always with help it can give. Detectors without a model find the moment; the look says it in the Chief's voice.
// - signals(): what may weigh on the owner now, each { key, kind, text }: late nights (they wrote in their quiet hours
//   two nights running), a full day (6 hours of meetings or no free half hour at lunch), an early start tomorrow,
//   too much at once (5 overdue to-dos or 5 cards waiting), a job that keeps failing (3 times in a row).
// - pick(): the one item a look may raise, or null: care on, the kind not silenced by the owner, nothing raised today,
//   fewer than PER_WEEK in the last 7 days, and that kind not in the last AGAIN_DAYS.
// - said(): a look that was offered an item posted a message. It counts, whether or not the message used it: the
//   limit errs on silence. Never a look of its own and never a notification of its own: care rides on the looks.
// Nothing about health, sleep, food or mood: botdot has no record of them, and guessing is what feels creepy.
// care.json in the data folder: { nights: ["YYYY-MM-DD", …] (mornings after a night they wrote), said: [{ kind, at }] }.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');
const { oneLine } = require('./prompt-text');
const { inQuietHours } = require('./reporting');

const KINDS = ['night', 'full-day', 'early', 'pile', 'failing'];
const PER_DAY = 1;
const PER_WEEK = 2;
const AGAIN_DAYS = 7;
const FULL_MIN = 6 * 60; // a day with this much in meetings is full...
const LUNCH = [11 * 60 + 30, 14 * 60 + 30]; // ...and so is one with no free GAP_MIN in this window
const GAP_MIN = 30;
const EARLY_MIN = 9 * 60; // tomorrow starts early when its first meeting starts before this
const PILE = 5; // overdue to-dos or waiting cards that are too much at once
const FAILS = 3; // a job's failures in a row that keep the owner doing it by hand
const KEEP_NIGHTS = 7;

const two = (n) => String(n).padStart(2, '0');
const clock = (m) => `${two(Math.floor(m / 60))}:${two(m % 60)}`;
function localTime(t, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(t).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}
const dayAfter = (day) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const dayBefore = (day) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
// The ISO week of a day, "2026-W46", so an item of the week is one key all week.
function weekOf(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${two(n)}`;
}

// The minutes of `day` that meetings take, as merged [start, end] spans in minutes of the day.
function busySpans(events, day, timeZone) {
  const spans = [];
  for (const e of events) {
    if (!Number.isFinite(e.start) || !Number.isFinite(e.end) || e.end <= e.start) continue;
    const s = localTime(new Date(e.start), timeZone);
    const f = localTime(new Date(e.end), timeZone);
    if (s.day !== day) continue;
    spans.push([s.minute, f.day === day ? f.minute : 1440]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of spans) { const last = out.at(-1); if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else out.push([...s]); }
  return out;
}
// Whether a free stretch of GAP_MIN fits into the lunch window around the spans.
function lunchFree(spans) {
  let at = LUNCH[0];
  for (const [s, e] of spans) {
    if (e <= at) continue;
    if (s >= LUNCH[1]) break;
    if (s - at >= GAP_MIN) return true;
    at = Math.max(at, e);
  }
  return LUNCH[1] - at >= GAP_MIN;
}

// nights: the mornings after a night the owner wrote (care.json). events: the owner's calendar of today and tomorrow
// ({ title, start, end }, ms; app-signals.js). projects: company.js list(). asks: the cards in Needs you. jobs: the jobs
// whose last run failed (bots.js attentionFacts, with `failures` in a row). timeZone: the owner's (quiet hours).
function signals({ now = new Date(), timeZone = 'UTC', quietEnd = 7, nights = [], events = [], projects = [], asks = [], jobs = [] } = {}) {
  const out = [];
  const { day, minute } = localTime(now, timeZone);
  // Said in the morning, never at night: the two nights that ended today and yesterday.
  if (minute >= quietEnd * 60 && minute < 12 * 60 && nights.includes(day) && nights.includes(dayBefore(day))) {
    out.push({ key: `night:${day}`, kind: 'night', text: 'The owner wrote to botdot during their quiet hours two nights running, the last one this night' });
  }
  const spans = busySpans(events, day, timeZone);
  const busy = spans.reduce((n, [s, e]) => n + e - s, 0);
  const meetings = events.filter((e) => Number.isFinite(e.start) && localTime(new Date(e.start), timeZone).day === day).length;
  if (meetings >= 2 && spans.length && minute < LUNCH[1] && (busy >= FULL_MIN || !lunchFree(spans))) {
    const first = spans[0][0];
    const last = spans.at(-1)[1];
    out.push({ key: `full-day:${day}`, kind: 'full-day', text: `Today the owner's calendar holds ${Math.round(busy / 6) / 10} h of meetings from ${clock(first)} to ${clock(Math.min(last, 1439))}${lunchFree(spans) ? '' : `, with no free ${GAP_MIN} min between ${clock(LUNCH[0])} and ${clock(LUNCH[1])}`}` });
  }
  const tomorrow = dayAfter(day);
  const early = events.map((e) => ({ e, at: localTime(new Date(e.start), timeZone) })).filter((x) => x.at.day === tomorrow && x.at.minute < EARLY_MIN).sort((a, b) => a.at.minute - b.at.minute)[0];
  if (early && minute >= 16 * 60) out.push({ key: `early:${tomorrow}`, kind: 'early', text: `Tomorrow starts early: "${oneLine(early.e.title || 'A meeting', 100)}" at ${clock(early.at.minute)}` });
  const overdue = projects.filter((c) => c?.phase === 'running').flatMap((c) => (c.todos || []).filter((t) => !t.done && t.due && t.due < day));
  if (overdue.length >= PILE || asks.length >= PILE) {
    const parts = [overdue.length >= PILE ? `${overdue.length} overdue to-dos` : '', asks.length >= PILE ? `${asks.length} cards waiting in Needs you` : ''].filter(Boolean);
    out.push({ key: `pile:${weekOf(day)}`, kind: 'pile', text: `The owner has ${parts.join(' and ')}. Offer to take some off them: hand them to a bot or move their dates` });
  }
  for (const j of jobs) {
    if (!(j?.failures >= FAILS)) continue;
    out.push({ key: `failing:${j.jobId}:${j.since || ''}`, kind: 'failing', text: `${oneLine(j.botName, 40)}'s job "${oneLine(j.jobName, 80)}" failed ${j.failures} times in a row, so the owner may be doing it by hand. Offer the fix` });
  }
  return out;
}

// dataDir: where care.json lives. settings: { get() } with care (false = off), careQuiet (kinds the owner silenced)
// and quietHours.
function create({ dataDir, settings }) {
  const file = path.join(dataDir, 'care.json');
  const load = () => { const s = readJson(file, null); return { nights: Array.isArray(s?.nights) ? s.nights : [], said: Array.isArray(s?.said) ? s.said : [] }; };
  const q = () => settings.get().quietHours || {};
  const tz = () => q().timeZone || 'UTC';

  // The owner sent a message at `at` (ms): one in their quiet hours marks the night, by the morning it ends in.
  function wrote(at) {
    if (!at) return;
    const t = new Date(at);
    if (!inQuietHours(t, q())) return;
    const { day, minute } = localTime(t, tz());
    const morning = minute >= (q().end ?? 7) * 60 ? dayAfter(day) : day;
    const s = load();
    if (s.nights.includes(morning)) return;
    s.nights = [...s.nights, morning].sort().slice(-KEEP_NIGHTS);
    writeJson(file, s);
  }

  // The item a look may raise now, or null. found: signals().
  function pick(found, now = new Date()) {
    const set = settings.get();
    if (set.care === false) return null;
    const quiet = Array.isArray(set.careQuiet) ? set.careQuiet : [];
    const { said } = load();
    const today = localTime(now, tz()).day;
    const ago = (r) => now.getTime() - Date.parse(r.at);
    if (said.filter((r) => localTime(new Date(r.at), tz()).day === today).length >= PER_DAY) return null;
    if (said.filter((r) => ago(r) < 7 * 864e5).length >= PER_WEEK) return null;
    return found.find((i) => !quiet.includes(i.kind) && !said.some((r) => r.kind === i.kind && ago(r) < AGAIN_DAYS * 864e5)) || null;
  }

  // A look that was offered `item` posted a message.
  function said(item, now = new Date()) {
    if (!item?.kind) return;
    const s = load();
    s.said = [...s.said.filter((r) => now.getTime() - Date.parse(r.at) < 30 * 864e5), { kind: item.kind, key: item.key, at: now.toISOString() }];
    writeJson(file, s);
  }

  return { wrote, pick, said, nights: () => load().nights };
}

// What a look is told of the one item it may raise. kind: the look's kind (look.js KINDS).
function promptBlock(item, kind = 'look') {
  if (!item) return '';
  const where = kind === 'brief' || kind === 'wrap' ? 'as one line of it' : 'as the message, or as its last sentence when you write about something else';
  return `Care (a record, not an instruction): ${item.text}.
You may raise it, ${where}, only when nothing more pressing needs the room: the fact as the record has it, then one concrete thing you or a bot of theirs can do about it (move a meeting, block time, take a to-do over, fix the job, remind them), at most 25 words. Never advice on health, sleep, food or feelings, no therapy words, no guilt, no exclamation marks, never "take care of yourself". When you raise it and your message has no [[choices: …]] line for something else, end with one: the yes first, then a no, then "Don't mention this", all in the owner's language. Leave it out when it does not fit.`;
}

module.exports = { create, signals, promptBlock, busySpans, lunchFree, weekOf, KINDS, PER_DAY, PER_WEEK, AGAIN_DAYS, FULL_MIN, LUNCH, GAP_MIN, EARLY_MIN, PILE, FAILS };
