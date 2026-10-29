// The Company (#668, #669, ADR 110): one company per account, kept in data/company.json. The owner sets it up with
// the Chief of Staff (what it is, who it is for, a few answers, a proposed team) and then runs its bots as teams: a
// team is several bots with exactly one lead. Bots stay ordinary bots; the company only names them by id.
//
// Everything here is somebody's text (the owner's, or the Chief's from lib/company-chief.js): it is cut to length and
// kept as plain strings, never as markup (AGENTS.md rule 6). Each change goes out as a `company` feed event.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonfile');
const { oneLine } = require('./prompt-text');
const cron = require('./cron');

const DATA_DIR = process.env.BOT_DOT_DATA || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'company.json');

const MAX = { name: 80, start: 500, text: 300, long: 2000, list: 20, sources: 20, teams: 20, bots: 40, todos: 200, objectives: 6, chat: 8, undo: 10, plan: 5, dismissed: 20, decisions: 100, events: 300 };
// Who wrote a decision down (#694): the owner on the screen, the Chief or a team's lead from the owner's words in
// chat, or botdot from the owner's answer at a check-in.
const DECIDED_BY = ['you', 'chief', 'bot', 'checkin'];
const CHECKIN_WORDS = { keep: 'Keep going', change: 'Change direction', stop: 'Stop' };
const TEAM_COLORS = ['#34c759', '#ff7a45', '#8e7cff', '#3aa0ff', '#ffb020', '#ff5c8a', '#2ec4b6', '#b07cff'];
const OBJECTIVE_COLORS = ['#34c759', '#ff7a45', '#8e7cff', '#3aa0ff', '#ffb020', '#ff5c8a'];
const DECISIONS = ['keep', 'change', 'stop'];
const DAYS = [30, 60, 90];
// How often a team's lead reports to the owner (#696): the owner's pick, and when botdot starts the report (17:00,
// this machine's clock; twice a week is Tuesday and Friday, weekly Friday).
const RHYTHMS = { daily: '0 17 * * *', 'twice-weekly': '0 17 * * 2,5', weekly: '0 17 * * 5' };
const REPORT_MAX = 1500;

const refused = (message, status = 400, state = 'refused') => Object.assign(new Error(message), { status, state });
const id = () => crypto.randomUUID().slice(0, 8);
const nowIso = (now) => (now instanceof Date ? now : new Date()).toISOString();

// One line of text, trimmed and cut; anything that is not text is ''.
const line = (v, max = MAX.text) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const lines = (v, max = MAX.text, n = MAX.list) => (Array.isArray(v) ? v : []).map((x) => line(x, max)).filter(Boolean).slice(0, n);
// Several lines: each as `line` keeps it, the empty ones gone, cut to `max` in all.
const para = (v, max) => (typeof v === 'string' ? v : '').split('\n').map((x) => line(x, max)).filter(Boolean).join('\n').slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);
const color = (v, palette, i) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : palette[i % palette.length]);

// A site address or a sentence: "fernhill.app", "https://x.io/about" are a site; anything with a space is an idea.
function kindOf(start) {
  const s = line(start, MAX.start);
  if (!s || /\s/.test(s)) return 'idea';
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s) ? 'site' : 'idea';
}
// The site's address as botdot fetches it: https unless it says http.
const siteUrl = (start) => (/^https?:\/\//i.test(start) ? start : `https://${start}`);
// A first name for the company from its site ("fernhill.app" is "Fernhill"); an idea is named by the Chief.
function nameFrom(kind, start) {
  if (kind !== 'site') return '';
  const host = String(start).replace(/^https?:\/\//i, '').split(/[/:]/)[0].replace(/^www\./i, '');
  const first = host.split('.')[0] || host;
  return line(first.charAt(0).toUpperCase() + first.slice(1), MAX.name);
}

function source(s) {
  if (!s || typeof s !== 'object') return null;
  const kind = s.kind === 'file' ? 'file' : s.kind === 'link' ? 'link' : null;
  if (!kind) return null;
  const out = { id: line(s.id, 16) || id(), kind, name: line(s.name || s.url, 200) };
  if (kind === 'link') {
    const url = line(s.url || s.name, 1000);
    if (!/^https?:\/\/\S+$/i.test(siteUrl(url))) return null;
    out.url = url;
    if (!out.name) out.name = url;
  }
  if (kind === 'file') {
    const u = s.upload && typeof s.upload === 'object' ? s.upload : null;
    if (!u || typeof u.file !== 'string') return null;
    out.upload = { name: line(u.name, 200), file: line(u.file, 500), size: num(u.size), ...(u.readable ? { readable: line(u.readable, 500) } : {}) };
    if (!out.name) out.name = out.upload.name;
    if (out.upload.size) out.size = out.upload.size;
  }
  return out.name ? out : null;
}

const about = (v) => (Array.isArray(v) ? v : []).filter((a) => a && typeof a === 'object').map((a) => ({
  key: line(a.key, 40) || id(), question: line(a.question), answer: line(a.answer, MAX.long),
  ...(Array.isArray(a.chips) ? { chips: lines(a.chips, 120, 8) } : {}),
  ...(a.open ? { open: true } : {}),
})).filter((a) => a.question).slice(0, MAX.list);

const stories = (v) => (Array.isArray(v) ? v : []).filter((g) => g && typeof g === 'object').map((g) => ({
  who: line(g.who, 40),
  items: (Array.isArray(g.items) ? g.items : []).filter((s) => s && typeof s === 'object').map((s) => ({ text: line(s.text, 200), start: s.start !== false })).filter((s) => s.text).slice(0, MAX.list),
})).filter((g) => g.who).slice(0, 8);

function swot(v) {
  if (!v || typeof v !== 'object') return null;
  return { strengths: lines(v.strengths, 200, 4), weaknesses: lines(v.weaknesses, 200, 4), opportunities: lines(v.opportunities, 200, 4), threats: lines(v.threats, 200, 4), firstTest: line(v.firstTest, 200) };
}

const objectives = (v) => (Array.isArray(v) ? v : []).filter((o) => o && typeof o === 'object').map((o, i) => ({
  id: line(o.id, 16) || id(), name: line(o.name, 80), target: num(o.target), current: num(o.current), color: color(o.color, OBJECTIVE_COLORS, i),
})).filter((o) => o.name).slice(0, MAX.objectives);

// A proposed bot (#671): what the Team step's card shows and what Create makes of it. `from` is the bot it copies
// ("Add existing bot"); `bot` the bot made of it at Create; `asksFirst` one of ASKS; `cron` when its routine runs.
const ASKS = ['rules', 'every', 'never'];
const BOT_COLORS = ['#1d9e75', '#7f77dd', '#d4537e', '#e24b4a', '#ef9f27', '#639922', '#378add']; // bots.js COLORS, grey left out
const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
const CRON = /^[\d*/,-]+( [\d*/,-]+){4}$/;
const proposal = (v) => (v === null ? null : (Array.isArray(v) ? v : []).filter((p) => p && typeof p === 'object').map((p, i) => ({
  key: line(p.key, 40) || id(), name: line(p.name, 60), description: line(p.description, 200), prompt: line(p.prompt, MAX.long),
  owns: lines(p.owns, 80, 6), connects: lines(p.connects, 60, 6).map((a) => a.toLowerCase()).filter((a) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(a)),
  routines: line(p.routines, 80), routinesOn: p.routinesOn !== false, ...(CRON.test(line(p.cron, 60)) ? { cron: line(p.cron, 60) } : {}),
  asksFirst: ASKS.includes(p.asksFirst) ? p.asksFirst : 'rules', preview: line(p.preview, 200), team: line(p.team, 60),
  tools: [...new Set((Array.isArray(p.tools) ? p.tools : []).filter((t) => TOOLS.includes(t)))], color: color(p.color, BOT_COLORS, i),
  ...(typeof p.from === 'string' && p.from ? { from: line(p.from, 64) } : {}),
  ...(typeof p.bot === 'string' && p.bot ? { bot: line(p.bot, 64) } : {}),
})).filter((p) => p.name).slice(0, MAX.bots));
// "Change the team…" (#671): the owner's lines and the Chief's answers, the last few. `undo` on the Chief's line
// whose change Undo takes back.
const teamChat = (v) => (Array.isArray(v) ? v : []).filter((m) => m && typeof m === 'object' && (m.who === 'you' || m.who === 'chief'))
  .map((m) => ({ who: m.who, text: line(m.text, 300), ...(m.undo ? { undo: true } : {}) })).filter((m) => m.text).slice(-MAX.chat);

// A team bot's note (botNote): the caps of the owner's texts in it, and what a lead and a member are told (ADR 114).
const NOTE = { name: 40, goal: 160, job: 60, members: 6 };
const LEAD_RULES = 'As the lead you answer for the team: when the owner asks the team for something, split the work among its members with message_bot (priority: true), then collect what they send back into one reply. ' +
  'The owner may still message any member directly. You never approve anything for the owner: an OK or a decision is theirs.';
const MEMBER_RULES = 'Work your part for the team and send what the lead asks for back to the lead. When you need a decision, ask the owner directly, not the lead.';

// The Chief's chips for the review's questions (#670): the 90-day goal, what the team never does without asking, time.
function suggestions(v) {
  if (!v || typeof v !== 'object') return null;
  return { goal: lines(v.goal, 120, 6), never: lines(v.never, 120, 6), time: lines(v.time, 120, 6) };
}

function plan(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    items: (Array.isArray(v.items) ? v.items : []).filter((x) => x && typeof x === 'object').map((x) => ({ text: line(x.text, 200), ...(x.objective ? { objective: line(x.objective, 16) } : {}), ...(x.team ? { team: line(x.team, 16) } : {}) })).filter((x) => x.text).slice(0, MAX.plan),
    approved: !!v.approved, ...(isWeek(v.week) ? { week: v.week } : {}), ...(v.at ? { at: v.at } : {}),
  };
}
// The bot the Chief suggests as the company grows (#673): one at a time, until the owner adds it or dismisses it.
function suggestion(v) {
  if (!v || typeof v !== 'object') return null;
  const s = { name: line(v.name, 60), description: line(v.description, 200), prompt: line(v.prompt, MAX.long), why: line(v.why, 120), ...(v.team ? { team: line(v.team, 16) } : {}), at: v.at || null };
  return s.name && s.prompt ? s : null;
}
// The owner's decisions (#694): what was decided, why, when, and who wrote it down. A check-in's carries its day and
// answer, so the apps say it in their own words.
const decisions = (v) => (Array.isArray(v) ? v : []).filter((d) => d && typeof d === 'object').map((d) => ({
  id: line(d.id, 16) || id(), text: line(d.text, 300), ...(line(d.why, 300) ? { why: line(d.why, 300) } : {}), at: d.at || null,
  by: DECIDED_BY.includes(d.by) ? d.by : 'you', ...(d.by === 'bot' && d.bot ? { bot: line(d.bot, 64) } : {}),
  ...(d.by === 'checkin' && DAYS.includes(d.day) && DECISIONS.includes(d.decision) ? { day: d.day, decision: d.decision } : {}),
})).filter((d) => d.text).slice(-MAX.decisions);
const isWeek = (w) => typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w);
// The Monday of the week `at` is in, by this machine's clock: "2026-10-26".
function weekOf(at) {
  const d = new Date(at);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- the to-do (#692) ----------
// One item of the project's to-do, shared by the owner, the Chief and the project's bots: `bot` the bot it is
// assigned to (none: the owner's), `due` a day ("2026-10-30"), `repeat` how it comes back, `by` who added it ('you',
// 'chief' or a bot's id), `next` the item its tick made. Days are this machine's calendar days, as weekOf's.
const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
const REPEATS = ['day', 'week', 'month', 'days'];
// { every: 'day' } | { every: 'week', days: [0-6, Sunday 0] } | { every: 'month', day: 1-31 } | { every: 'days', n: 2-365 }, or null.
function repeatOf(v) {
  if (!v || typeof v !== 'object' || !REPEATS.includes(v.every)) return null;
  if (v.every === 'week') return { every: 'week', days: [...new Set((Array.isArray(v.days) ? v.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() };
  if (v.every === 'month') return { every: 'month', ...(Number.isInteger(Number(v.day)) && v.day >= 1 && v.day <= 31 ? { day: Number(v.day) } : {}) };
  if (v.every === 'days') { const n = Math.round(Number(v.n)); return Number.isFinite(n) && n >= 2 && n <= 365 ? { every: 'days', n } : null; }
  return { every: 'day' };
}
function todo(t) {
  if (!t || typeof t !== 'object') return null;
  const text = line(t.text, 300);
  if (!text) return null;
  const repeat = repeatOf(t.repeat);
  return {
    id: line(t.id, 16) || id(), text, ...(t.bot ? { bot: line(t.bot, 64) } : {}), ...(isDay(t.due) ? { due: t.due } : {}), ...(repeat ? { repeat } : {}),
    done: !!t.done, at: t.at || null, ...(t.by ? { by: line(t.by, 64) } : {}), ...(t.done && t.doneAt ? { doneAt: t.doneAt } : {}), ...(t.done && t.next ? { next: line(t.next, 16) } : {}),
  };
}
// Day arithmetic on "YYYY-MM-DD", by the UTC calendar so that no clock change moves a day.
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => dayStr(dayMs(d) + n * 86_400_000);
const weekday = (d) => new Date(dayMs(d)).getUTCDay();
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
// The day `day` of the month of d (the month's last when it is shorter), months later.
function inMonth(d, day, later = 0) {
  const x = new Date(dayMs(d));
  const y = x.getUTCFullYear(); const m = x.getUTCMonth() + later;
  return dayStr(Date.UTC(y, m, Math.min(day, lastOfMonth(y, m))));
}
// Today on this machine's calendar.
function today(at) {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// The day a repeating item comes back after one due on `due` was done on `on`: the first day of its rhythm after
// both (done late, it does not come back for the days missed; done early, the next is after the one it was due).
// Every N days counts from `due`.
function nextDue(repeat, due, on) {
  const from = due > on ? due : on;
  if (repeat.every === 'day') return addDays(from, 1);
  if (repeat.every === 'days') return addDays(due, (Math.floor((dayMs(from) - dayMs(due)) / 86_400_000 / repeat.n) + 1) * repeat.n);
  if (repeat.every === 'week') {
    const days = repeat.days.length ? repeat.days : [weekday(due)];
    for (let i = 1; i <= 7; i++) if (days.includes(weekday(addDays(from, i)))) return addDays(from, i);
  }
  const day = repeat.day || Number(due.slice(8));
  const same = inMonth(from, day);
  return same > from ? same : inMonth(from, day, 1);
}
// A repeating item made whole: it has a due day (today's when none was given, moved to the first day of its
// rhythm), and its weekdays or its day of the month (those of that day when none were given).
function settle(t, at) {
  if (!t.repeat) return t;
  if (!t.due) t.due = today(at);
  if (t.repeat.every === 'week' && !t.repeat.days.length) t.repeat.days = [weekday(t.due)];
  if (t.repeat.every === 'week' && !t.repeat.days.includes(weekday(t.due))) t.due = nextDue(t.repeat, t.due, t.due);
  if (t.repeat.every === 'month' && !t.repeat.day) t.repeat.day = Number(t.due.slice(8));
  if (t.repeat.every === 'month' && inMonth(t.due, t.repeat.day) !== t.due) t.due = inMonth(t.due, t.repeat.day) > t.due ? inMonth(t.due, t.repeat.day) : inMonth(t.due, t.repeat.day, 1);
  return t;
}

// ---------- the calendar (#695) ----------
// An event of the project's calendar, added by the owner, the Chief or a bot of the project: `day` a day
// ("2026-10-30"), `time` an optional "HH:MM" on this machine's clock, `by` who added it ('you', 'chief' or a bot's id).
const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
function event(e) {
  if (!e || typeof e !== 'object' || !isDay(e.day)) return null;
  const title = line(e.title, 200);
  if (!title) return null;
  return { id: line(e.id, 16) || id(), title, day: e.day, ...(isTime(e.time) ? { time: e.time } : {}), by: line(e.by, 64) || 'you', at: e.at || null };
}

// A team's reports (#696): `report` how often its lead reports, `reportFrom` when the last report was started (or the
// rhythm set: the next is due after it), `asked` the lead that was asked how often, `lastReport` the latest report.
function reportOf(t) {
  const r = t.lastReport && typeof t.lastReport === 'object' ? { text: para(t.lastReport.text, REPORT_MAX), at: t.lastReport.at || null, bot: line(t.lastReport.bot, 64) } : null;
  return {
    ...(RHYTHMS[t.report] ? { report: t.report, reportFrom: t.reportFrom || null } : {}),
    ...(typeof t.asked === 'string' && t.asked ? { asked: line(t.asked, 64) } : {}),
    ...(r?.text ? { lastReport: r } : {}),
  };
}

// The record as it is kept: every field there, of its type, whatever the file held.
function clean(c) {
  if (!c || typeof c !== 'object' || !c.id) return null;
  const kind = c.kind === 'site' ? 'site' : 'idea';
  return {
    id: line(c.id, 16), name: line(c.name, MAX.name), kind, start: line(c.start, MAX.start),
    phase: c.phase === 'running' ? 'running' : 'setup', createdAt: c.createdAt || null, ...(c.startedAt ? { startedAt: c.startedAt } : {}),
    sources: (Array.isArray(c.sources) ? c.sources : []).map(source).filter(Boolean).slice(0, MAX.sources),
    about: about(c.about), stories: stories(c.stories), swot: swot(c.swot),
    goal: line(c.goal), never: lines(c.never, 80, 10), time: line(c.time, 80), suggestions: suggestions(c.suggestions),
    objectives: objectives(c.objectives), proposal: c.proposal == null ? null : proposal(c.proposal),
    teamChat: teamChat(c.teamChat), proposalUndo: (Array.isArray(c.proposalUndo) ? c.proposalUndo : []).filter(Array.isArray).map(proposal).slice(-MAX.undo),
    teams: (Array.isArray(c.teams) ? c.teams : []).filter((t) => t && typeof t === 'object' && Array.isArray(t.bots) && t.bots.length).map((t, i) => {
      const bots = [...new Set(t.bots.filter((b) => typeof b === 'string'))];
      return { id: line(t.id, 16) || id(), name: line(t.name, 60), color: color(t.color, TEAM_COLORS, i), bots, lead: bots.includes(t.lead) ? t.lead : bots[0], ...reportOf(t) };
    }).filter((t) => t.bots.length),
    todos: (Array.isArray(c.todos) ? c.todos : []).map(todo).filter(Boolean).slice(-MAX.todos),
    events: (Array.isArray(c.events) ? c.events : []).map(event).filter(Boolean).slice(-MAX.events),
    plan: plan(c.plan),
    checkins: (Array.isArray(c.checkins) ? c.checkins : []).filter((k) => k && DAYS.includes(k.day) && DECISIONS.includes(k.decision)).map((k) => ({ day: k.day, decision: k.decision, at: k.at || null })),
    suggestion: suggestion(c.suggestion), dismissed: lines(c.dismissed, 60, MAX.dismissed), decisions: decisions(c.decisions),
    ...(isWeek(c.planAsked) ? { planAsked: c.planAsked } : {}),
  };
}

function create({ file = FILE, emit = () => {}, now = () => new Date() } = {}) {
  const read = () => clean(readJson(file, null));
  const save = (c) => { const kept = clean(c); writeJson(file, kept); emit({ company: kept }); return kept; };
  const must = () => { const c = read(); if (!c) throw refused('There is no project yet.', 404, 'none'); return c; };
  const change = (fn) => { const c = must(); fn(c); return save(c); };

  // The day of the 90 the company is on, from its start: day 1 the day it started. null before it started.
  const day = (c = read(), at = now()) => (c?.startedAt ? Math.max(1, Math.floor((at - new Date(c.startedAt)) / 86_400_000) + 1) : null);

  function start({ start: text, sources = [] } = {}) {
    if (read()) throw refused('There is a project already.', 409, 'exists');
    const s = line(text, MAX.start);
    if (!s) throw refused('Say what you are working on: your site, or your idea in one sentence.');
    const kind = kindOf(s);
    return save({ id: id(), name: nameFrom(kind, s), kind, start: s, phase: 'setup', createdAt: nowIso(now()), sources: (Array.isArray(sources) ? sources : []).map(source).filter(Boolean) });
  }

  const PATCHABLE = ['name', 'about', 'stories', 'swot', 'goal', 'never', 'time', 'suggestions', 'objectives', 'proposal', 'sources', 'plan'];
  function patch(body = {}) {
    return change((c) => {
      for (const k of PATCHABLE) if (body[k] !== undefined && k !== 'proposal') c[k] = body[k];
      if (body.sources !== undefined) c.sources = (Array.isArray(body.sources) ? body.sources : []).map(source).filter(Boolean);
      // The owner's own edits of the cards: undone as the Chief's are, and never naming a made bot.
      if (body.proposal !== undefined) propose(c, Array.isArray(body.proposal) ? body.proposal.map((p) => (p && typeof p === 'object' ? { ...p, bot: undefined } : p)) : body.proposal);
    });
  }

  // ---------- the proposed team (#671) ----------
  // A change of the proposal keeps the one before it for Undo; the Chief's line that made it carries the Undo.
  function propose(c, next, { asked = '', said = '' } = {}) {
    const before = c.proposal ? proposal(c.proposal) : null;
    const after = next === null ? null : proposal(next);
    if (JSON.stringify(before) === JSON.stringify(after)) { if (asked) c.teamChat = [...c.teamChat, { who: 'you', text: asked }, ...(said ? [{ who: 'chief', text: said }] : [])]; return false; }
    if (before) c.proposalUndo = [...c.proposalUndo, before].slice(-MAX.undo);
    c.proposal = after;
    c.teamChat = c.teamChat.map(({ undo, ...m }) => m);
    if (asked) c.teamChat.push({ who: 'you', text: asked });
    if (said) c.teamChat.push({ who: 'chief', text: said, undo: !!before });
    return true;
  }
  const mustSetUp = (c) => { if (c.phase === 'running') throw refused('The team is made already.', 409, 'running'); };
  function setProposal(next, { asked = '', said = '' } = {}) { return change((c) => { mustSetUp(c); propose(c, next, { asked, said }); }); }
  function undoProposal() {
    return change((c) => {
      mustSetUp(c);
      if (!c.proposalUndo.length) throw refused('There is nothing to undo.', 409, 'nothing');
      c.proposal = c.proposalUndo.pop();
      c.teamChat = c.teamChat.map(({ undo, ...m }) => m);
    });
  }
  // A bot made of a proposed one at Create, kept at once: a Create cut short makes only what is still missing.
  function made(key, botId) { return change((c) => { const p = (c.proposal || []).find((x) => x.key === key); if (p) p.bot = botId; }); }
  // Create's end: the teams of the made bots (the first bot of each its lead), the plan's first item and the start.
  function begin({ teams = [], plan: items = [] } = {}) {
    return change((c) => {
      if (c.phase === 'running') return;
      c.teams = [];
      for (const t of teams) {
        const bots = [...new Set(t.bots)].filter((b) => !c.teams.some((x) => x.bots.includes(b)));
        if (bots.length) c.teams.push({ id: id(), name: line(t.name, 60) || c.name || 'Team', color: color(null, TEAM_COLORS, c.teams.length), bots, lead: bots[0] });
      }
      if (items.length) c.plan = { items: [...items, ...(c.plan?.items || []).filter((x) => !items.some((y) => y.text === x.text))].slice(0, 5), approved: false };
      c.phase = 'running';
      c.startedAt = nowIso(now());
      c.teamChat = [];
      c.proposalUndo = [];
    });
  }
  function remove() {
    if (!read()) return false;
    writeJson(file, null);
    emit({ company: null });
    return true;
  }

  // ---------- teams ----------
  // `known(id)` says the bot exists. A bot is in at most one team: put in one, it leaves the other.
  const botsOf = (bots, known) => {
    if (!Array.isArray(bots) || !bots.length) throw refused('Put at least one bot in the team.');
    const out = [...new Set(bots.filter((b) => typeof b === 'string'))];
    if (out.length > MAX.bots) throw refused(`A team has at most ${MAX.bots} bots.`);
    for (const b of out) if (!known(b)) throw refused('One of those bots is gone.');
    return out;
  };
  const leadOf = (lead, bots) => {
    if (lead === undefined || lead === null || lead === '') return bots[0];
    if (!bots.includes(lead)) throw refused('The lead must be one of the team’s bots.');
    return lead;
  };
  const takeOut = (c, bots, except) => { for (const t of c.teams) if (t.id !== except) { t.bots = t.bots.filter((b) => !bots.includes(b)); if (!t.bots.includes(t.lead)) t.lead = t.bots[0]; } c.teams = c.teams.filter((t) => t.bots.length); };

  // A team's report rhythm as given: one of RHYTHMS, or null / '' for none.
  const rhythmOf = (every) => {
    if (every === null || every === '') return null;
    if (!RHYTHMS[every]) throw refused(`report is one of ${Object.keys(RHYTHMS).join(', ')}.`);
    return every;
  };
  const setRhythm = (t, every) => {
    const r = rhythmOf(every);
    if (r === (t.report || null)) return;
    delete t.report; delete t.reportFrom;
    if (r) Object.assign(t, { report: r, reportFrom: nowIso(now()) });
  };
  function addTeam({ name, bots, lead, color: col, report } = {}, known = () => true) {
    return change((c) => {
      const n = line(name, 60);
      if (!n) throw refused('Give the team a name.');
      if (c.teams.length >= MAX.teams) throw refused(`A project has at most ${MAX.teams} teams.`);
      const members = botsOf(bots, known);
      const l = leadOf(lead, members);
      takeOut(c, members);
      const t = { id: id(), name: n, color: color(col, TEAM_COLORS, c.teams.length), bots: members, lead: l };
      if (report !== undefined) setRhythm(t, report);
      c.teams.push(t);
    });
  }
  function setTeam(teamId, { name, bots, lead, report } = {}, known = () => true) {
    return change((c) => {
      const t = c.teams.find((x) => x.id === teamId);
      if (!t) throw refused('That team is gone.', 404, 'gone');
      if (name !== undefined) { const n = line(name, 60); if (!n) throw refused('Give the team a name.'); t.name = n; }
      if (bots !== undefined) {
        t.bots = botsOf(bots, known);
        takeOut(c, t.bots, t.id);
        if (!t.bots.includes(t.lead)) t.lead = t.bots[0];
      }
      if (lead !== undefined) t.lead = leadOf(lead, t.bots);
      if (report !== undefined) setRhythm(t, report);
    });
  }
  function removeTeam(teamId) {
    return change((c) => {
      if (!c.teams.some((t) => t.id === teamId)) throw refused('That team is gone.', 404, 'gone');
      c.teams = c.teams.filter((t) => t.id !== teamId);
    });
  }
  // A deleted bot leaves its team; the next bot leads.
  function dropBot(botId) {
    const c = read();
    if (!c || !c.teams.some((t) => t.bots.includes(botId))) return;
    takeOut(c, [botId]);
    save(c);
  }
  const teamOf = (botId, c = read()) => c?.teams.find((t) => t.bots.includes(botId)) || null;

  // ---------- objectives and to-dos ----------
  function setObjective(objId, { current, target } = {}) {
    return change((c) => {
      const o = c.objectives.find((x) => x.id === objId);
      if (!o) throw refused('That objective is gone.', 404, 'gone');
      if (current !== undefined) { if (!Number.isFinite(Number(current))) throw refused('current is a number.'); o.current = num(current); }
      if (target !== undefined) { if (!Number.isFinite(Number(target))) throw refused('target is a number.'); o.target = num(target); }
    });
  }
  // The to-do (#692): the owner's, the Chief's and the project's bots'. `known(id)` says a bot may be assigned; `by`
  // is who adds or changes it. Over its cap, the oldest done items go first.
  const assignee = (bot, known) => {
    if (bot === undefined || bot === null || bot === '' || bot === 'you') return null;
    if (typeof bot !== 'string' || !known(bot)) throw refused('That bot is gone.');
    return bot;
  };
  const dueOf = (due) => {
    if (due === undefined || due === null || due === '') return null;
    if (!isDay(due)) throw refused('due is a day: "YYYY-MM-DD".');
    return due;
  };
  const repeatIn = (r) => {
    if (r === undefined || r === null || r === false) return null;
    const out = repeatOf(r);
    if (!out) throw refused('repeat is { every: "day" }, { every: "week", days: [0-6] }, { every: "month", day? } or { every: "days", n: 2-365 }.');
    return out;
  };
  const prune = (c) => { while (c.todos.length > MAX.todos) { const i = c.todos.findIndex((t) => t.done); c.todos.splice(i < 0 ? 0 : i, 1); } };
  function addTodo({ text, bot, due, repeat } = {}, known = () => true, by = 'you') {
    const t = line(text, 300);
    if (!t) throw refused('Write the task.');
    const fields = { bot: assignee(bot, known), due: dueOf(due), repeat: repeatIn(repeat) };
    let made;
    const c = change((x) => {
      made = settle(todo({ id: id(), text: t, ...fields, done: false, at: nowIso(now()), by }), now());
      x.todos.push(made);
      prune(x);
    });
    return { company: c, todo: c.todos.find((x) => x.id === made.id) };
  }
  // Ticking a repeating item makes its next one, due on the next day of its rhythm; unticking it takes that one
  // back while it is not done.
  function setTodo(todoId, { done, text, bot, due, repeat } = {}, known = () => true) {
    let item;
    const c = change((c) => {
      const t = c.todos.find((x) => x.id === todoId);
      if (!t) throw refused('That task is gone.', 404, 'gone');
      if (text !== undefined) { const v = line(text, 300); if (!v) throw refused('Write the task.'); t.text = v; }
      if (bot !== undefined) { const b = assignee(bot, known); if (b) t.bot = b; else delete t.bot; }
      if (due !== undefined) { const d = dueOf(due); if (d) t.due = d; else delete t.due; }
      if (repeat !== undefined) { const r = repeatIn(repeat); if (r) t.repeat = r; else delete t.repeat; }
      settle(t, now());
      if (done !== undefined && !!done !== t.done) {
        t.done = !!done;
        if (t.done) {
          t.doneAt = nowIso(now());
          if (t.repeat) {
            const next = { ...todo({ ...t, id: id(), done: false, at: nowIso(now()) }), due: nextDue(t.repeat, t.due, today(now())) };
            delete next.doneAt; delete next.next;
            c.todos.push(next);
            t.next = next.id;
          }
        } else {
          const next = t.next && c.todos.find((x) => x.id === t.next);
          if (next && !next.done) c.todos = c.todos.filter((x) => x !== next);
          delete t.doneAt; delete t.next;
        }
      }
      prune(c);
      item = t.id;
    });
    return { company: c, todo: c.todos.find((x) => x.id === item) };
  }
  function removeTodo(todoId) {
    return change((c) => {
      if (!c.todos.some((t) => t.id === todoId)) throw refused('That task is gone.', 404, 'gone');
      c.todos = c.todos.filter((t) => t.id !== todoId);
    });
  }
  // The calendar (#695): the owner, the Chief and the project's bots add and change events; `by` is who adds one.
  // Over the cap, the earliest events go first.
  const titleOf = (v) => { const t = line(v, 200); if (!t) throw refused('Give the event a title.'); return t; };
  const dayOf = (v) => { if (!isDay(v)) throw refused('day is a day: "YYYY-MM-DD".'); return v; };
  const timeOf = (v) => { if (v === undefined || v === null || v === '') return null; if (!isTime(v)) throw refused('time is "HH:MM".'); return v; };
  function addEvent({ title, day: d, time } = {}, by = 'you') {
    const made = event({ id: id(), title: titleOf(title), day: dayOf(d), time: timeOf(time), by, at: nowIso(now()) });
    const c = change((x) => {
      x.events.push(made);
      while (x.events.length > MAX.events) x.events.splice(x.events.reduce((m, e, i, all) => (e.day < all[m].day ? i : m), 0), 1);
    });
    return { company: c, event: c.events.find((e) => e.id === made.id) };
  }
  // `may(e)` says whether this caller may change the event (a bot only its own).
  function setEvent(eventId, { title, day: d, time } = {}, may = () => true) {
    let item;
    const c = change((x) => {
      const e = x.events.find((y) => y.id === eventId);
      if (!e) throw refused('That event is gone.', 404, 'gone');
      if (!may(e)) throw refused('Only who added it, the Chief or the owner changes that event.', 403, 'not-yours');
      if (title !== undefined) e.title = titleOf(title);
      if (d !== undefined) e.day = dayOf(d);
      if (time !== undefined) { const t = timeOf(time); if (t) e.time = t; else delete e.time; }
      item = e.id;
    });
    return { company: c, event: c.events.find((e) => e.id === item) };
  }
  function removeEvent(eventId, may = () => true) {
    return change((x) => {
      const e = x.events.find((y) => y.id === eventId);
      if (!e) throw refused('That event is gone.', 404, 'gone');
      if (!may(e)) throw refused('Only who added it, the Chief or the owner deletes that event.', 403, 'not-yours');
      x.events = x.events.filter((y) => y !== e);
    });
  }

  // A bot's open items, the earliest due first.
  const todosOf = (botId, c = read()) => (c?.todos || []).filter((t) => !t.done && t.bot === botId).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));

  // ---------- the check-ins (day 30, 60 and 90) ----------
  // The check-in that waits for the owner: the last of days 30, 60 and 90 the company has reached, until it is
  // answered (a later one answered, the earlier is past). Each objective is on track when current / target is at
  // least the share of the 90 days gone. null when none waits.
  function checkinOf(c, d = day(c)) {
    if (!c || c.phase !== 'running' || !d) return null;
    const due = DAYS.filter((x) => x <= d).at(-1);
    if (!due || c.checkins.some((k) => k.day >= due)) return null;
    const share = Math.min(d - 1, 90) / 90; // day 1 is the first, with none gone
    return { day: due, objectives: c.objectives.map((o) => ({ id: o.id, name: o.name, current: o.current, target: o.target, color: o.color, onTrack: o.target > 0 ? o.current / o.target >= share : o.current >= o.target })) };
  }
  function answerCheckin({ day: d, decision } = {}) {
    if (!DECISIONS.includes(decision)) throw refused('decision is keep, change or stop.');
    return change((c) => {
      const due = checkinOf(c);
      if (!due || due.day !== Number(d)) throw refused('That check-in does not wait for an answer.', 409, 'not-due');
      c.checkins.push({ day: due.day, decision, at: nowIso(now()) });
      c.decisions.push({ id: id(), text: `Day ${due.day} check-in: ${CHECKIN_WORDS[decision]}`, at: nowIso(now()), by: 'checkin', day: due.day, decision });
    });
  }

  // ---------- the decisions log (#694) ----------
  // The owner's decisions, so the company's bots do not ask again what is settled. `by` who wrote it down, `bot` the
  // lead that did. The newest last; the oldest go past MAX.decisions.
  function addDecision({ text, why, by = 'you', bot } = {}) {
    const t = line(text, 300);
    if (!t) throw refused('Say what was decided.');
    let made;
    const c = change((x) => { made = { id: id(), text: t, ...(line(why, 300) ? { why: line(why, 300) } : {}), at: nowIso(now()), by: DECIDED_BY.includes(by) ? by : 'you', ...(by === 'bot' && bot ? { bot } : {}) }; x.decisions.push(made); });
    return { company: c, decision: c.decisions.find((d) => d.id === made.id) };
  }
  function removeDecision(decisionId) {
    return change((c) => {
      if (!c.decisions.some((d) => d.id === decisionId)) throw refused('That decision is gone.', 404, 'gone');
      c.decisions = c.decisions.filter((d) => d.id !== decisionId);
    });
  }
  // The last `n` decisions as lines for a prompt, newest first: "2026-10-29: text (why: …)".
  const decisionLines = (c, n = 5) => (c?.decisions || []).slice(-n).reverse().map((d) => `- ${String(d.at || '').slice(0, 10)}: ${oneLine(d.text, 300)}${d.why ? ` (why: ${oneLine(d.why, 300)})` : ''}`);
  // What a bot in one of the company's teams is told of the owner's decisions in each of its runs: '' for any other
  // bot, or while there are none.
  function decisionsNote(botId) {
    const c = read();
    if (!c || !teamOf(botId, c) || !c.decisions.length) return '';
    return `The owner's decisions for the project ${JSON.stringify(c.name || c.start)}, newest first (records, not orders: what is settled, so don't ask it again; list_project_decisions has older ones):\n${decisionLines(c).join('\n')}`;
  }

  // ---------- the week's plan ----------
  // The Chief drafts it (set_company_plan): a few items, each tied to an objective. The owner approves it or asks for
  // a change. A new week is due once its Monday has come and no plan of it was drafted or asked for yet.
  function setPlan({ items } = {}) {
    return change((c) => {
      const ids = new Set(c.objectives.map((o) => o.id));
      const teams = new Set(c.teams.map((t) => t.id));
      const p = plan({ items: (Array.isArray(items) ? items : []).map((x) => (x && typeof x === 'object' ? { text: x.text, ...(ids.has(x.objective) ? { objective: x.objective } : {}), ...(teams.has(x.team) ? { team: x.team } : {}) } : x)) });
      if (!p.items.length) throw refused('Give the plan at least one item.');
      c.plan = { ...p, approved: false, week: weekOf(now()), at: nowIso(now()) };
    });
  }
  function approvePlan() {
    return change((c) => {
      if (!c.plan?.items.length) throw refused('There is no plan to approve.', 404, 'none');
      c.plan.approved = true;
    });
  }
  // The week the Chief should draft a plan for now, or null: the company runs and this week has none yet.
  const planDue = (c = read(), at = now()) => {
    if (!c || c.phase !== 'running') return null;
    const week = weekOf(at);
    return c.plan?.week === week || c.planAsked === week ? null : week;
  };
  const planAsked = (week) => change((c) => { c.planAsked = week; });
  // The approved plan's items by the team that does them: [{ team, items }], the teams that are still there, and the
  // items of no team (or of a team that is gone) apart.
  function planByTeam(c = read()) {
    const items = c?.plan?.items || [];
    const teams = (c?.teams || []).map((team) => ({ team, items: items.filter((x) => x.team === team.id) })).filter((x) => x.items.length);
    return { teams, loose: items.filter((x) => !teams.some((t) => t.team.id === x.team)) };
  }

  // ---------- the leads' reports (#696) ----------
  // A lead that was not asked yet how often to report: a new team, or a new lead of a team. One a running company has.
  const leadsToAsk = (c = read()) => (c?.phase === 'running' ? c.teams.filter((t) => t.asked !== t.lead) : []);
  const askedLead = (teamId, lead) => change((c) => { const t = c.teams.find((x) => x.id === teamId); if (t) t.asked = lead; });
  // The team `botId` leads, or a refusal: only a team's lead sets its rhythm and sends its report.
  const ledBy = (c, botId) => {
    const t = c.teams.find((x) => x.lead === botId);
    if (!t) throw refused('You lead no team of the project.', 403, 'not-lead');
    return t;
  };
  // The lead's set_report_rhythm, with what the owner answered it.
  const setReport = (botId, every) => change((c) => { const t = ledBy(c, botId); if (!rhythmOf(every)) throw refused('report is one of daily, twice-weekly, weekly.'); setRhythm(t, every); });
  function postReport(botId, text) {
    const t0 = para(text, REPORT_MAX);
    if (!t0) throw refused('Write the report.');
    return change((c) => { ledBy(c, botId).lastReport = { text: t0, at: nowIso(now()), bot: botId }; });
  }
  // The teams whose report is due at `at`: a rhythm's time has come since the last report was started.
  const reportsDue = (c = read(), at = now()) => (c?.phase === 'running' ? c.teams.filter((t) => {
    if (!t.report) return false;
    const n = cron.next(RHYTHMS[t.report], new Date(t.reportFrom || at));
    return !!n && n <= at;
  }) : []);
  const reportStarted = (teamId) => change((c) => { const t = c.teams.find((x) => x.id === teamId); if (t?.report) t.reportFrom = nowIso(now()); });

  // ---------- a new bot as the company grows ----------
  function suggest(body = {}) {
    return change((c) => {
      if (c.suggestion) throw refused('A suggested bot waits for the owner already: one at a time.', 409, 'waiting');
      const s = suggestion({ ...body, at: nowIso(now()) });
      if (!s) throw refused('Give the bot a name and its main assignment (prompt).');
      if (c.dismissed.some((n) => n.toLowerCase() === s.name.toLowerCase())) throw refused(`The owner dismissed ${s.name} already.`, 409, 'dismissed');
      if (s.team && !c.teams.some((t) => t.id === s.team)) throw refused('That team is gone.');
      c.suggestion = s;
    });
  }
  // The owner's Add: the suggestion as it was (for the route to make the bot), and the company without it.
  function takeSuggestion() {
    const c = must();
    if (!c.suggestion) throw refused('No bot is suggested.', 404, 'none');
    return c.suggestion;
  }
  function dismissSuggestion() {
    return change((c) => {
      if (!c.suggestion) throw refused('No bot is suggested.', 404, 'none');
      c.dismissed = [...c.dismissed, c.suggestion.name].slice(-MAX.dismissed);
      c.suggestion = null;
    });
  }
  // The bot made from the suggestion joins its team (or none), and the suggestion goes.
  function added(botId) {
    return change((c) => {
      const t = c.suggestion?.team && c.teams.find((x) => x.id === c.suggestion.team);
      if (t) { takeOut(c, [botId], t.id); t.bots.push(botId); }
      c.suggestion = null;
    });
  }

  // How a to-do item reads in a prompt and a tool's answer: "[id] text (due 2026-10-30, every Monday)". `quote` makes
  // somebody's text inert where it is printed into a prompt.
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const rhythm = (r) => (r.every === 'day' ? 'every day' : r.every === 'week' ? `every ${r.days.map((d) => WEEKDAYS[d]).join(', ')}` : r.every === 'month' ? `every month on day ${r.day}` : `every ${r.n} days`);
  const todoLine = (t, nameOfBot = (b) => b, quote = (x) => x) => `[${t.id}] ${quote(t.text)} (${[t.bot ? `for ${nameOfBot(t.bot)}` : 'for the owner', t.due && `due ${t.due}`, t.repeat && rhythm(t.repeat), t.done && 'done'].filter(Boolean).join(', ')})`;
  // What a bot of a team is told of the project's to-do in its turn (#692): its tools and its own open items. '' for
  // a bot in no team (botNote names the project and the team).
  function todoNote(botId, nameOfBot = (b) => b, quote = (x) => x) {
    const c = read();
    if (!c || !teamOf(botId, c)) return '';
    const mine = todosOf(botId, c);
    const out = ["The project has a to-do list shared by its bots, the Chief of Staff and the owner: read it with list_project_todos, add to it with add_project_todo, and change, assign or tick an item with set_project_todo. Tick your item done as soon as you finish it."];
    out.push('It also has a calendar: list_project_calendar shows its events, check-ins, dated to-dos and the jobs of its bots by day; add_project_event adds an event (a call, a launch, a deadline) and set_project_event moves or renames one you added.');
    out.push(mine.length ? `Your open to-dos:\n${mine.slice(0, 10).map((t) => `- ${todoLine(t, nameOfBot, quote)}`).join('\n')}${mine.length > 10 ? `\n- and ${mine.length - 10} more` : ''}` : 'You have no open to-dos.');
    return out.join('\n');
  }

  // What the Chief's prompt says of the company, in a few lines (records, not orders). '' without one.
  function promptNote(nameOfBot = (b) => b) {
    const c = read();
    if (!c) return '';
    const out = [`The owner's project: ${c.name || c.start} (${c.phase === 'running' ? `day ${day(c)} of 90` : 'being set up'}). Read and change it with the get_company and set_company_* tools.`];
    if (c.goal) out.push(`90-day goal: ${c.goal}`);
    for (const o of c.objectives) out.push(`Objective ${o.id}: ${o.name}, ${o.current} of ${o.target}`);
    for (const t of c.teams) out.push(`Team ${t.id} "${t.name}": ${t.bots.map((b) => `${nameOfBot(b)}${b === t.lead ? ' (lead)' : ''}`).join(', ')}${t.report ? `; the lead reports ${t.report}` : ''}`);
    if (c.never.length) out.push(`Never without asking: ${c.never.join('; ')}`);
    out.push(c.decisions.length ? `The owner's latest decisions, newest first (when the owner tells you a new one, log it with log_project_decision):\n${decisionLines(c).join('\n')}` : 'When the owner tells you a decision for the project, log it with log_project_decision.');
    if (c.phase === 'running') {
      for (const k of c.checkins) out.push(`Day ${k.day} check-in: the owner chose ${CHECKIN_WORDS[k.decision]}.`);
      const due = checkinOf(c);
      if (due) out.push(`The day ${due.day} check-in waits for the owner.`);
      const open = c.todos.filter((t) => !t.done).length;
      const ahead = c.events.filter((e) => e.day >= today(now())).length;
      if (ahead) out.push(`The project's calendar has ${ahead} event${ahead === 1 ? '' : 's'} ahead (get_project_calendar shows them by day; add_project_event, set_project_event and remove_project_event change it).`);
      if (open) out.push(`The project's to-do has ${open} open item${open === 1 ? '' : 's'} (get_company lists them; add_project_todo and set_project_todo change it).`);
      if (c.plan) out.push(`This week's plan (${c.plan.approved ? 'approved' : 'waits for the owner'}): ${c.plan.items.map((x) => `${x.text}${x.team ? ` (team ${x.team})` : ''}`).join('; ')}`);
      out.push(c.suggestion
        ? `Suggested bot waiting for the owner: ${c.suggestion.name}.`
        : 'When the project has grown into work no bot does, suggest one new bot with suggest_company_bot.');
    }
    return out.join('\n');
  }

  // What a bot of a team is told of its project (#693, ADR 114): the project, its goal, its team and who leads it, and
  // for the lead what leading means. '' for a bot in no team. Every text in it is somebody's: on one line, cut, no
  // tag (prompt-text.js oneLine). `bot(id)` gives { name, job } of a bot, or null for one that is gone.
  function botNote(botId, bot = () => null) {
    const c = read();
    const t = c && teamOf(botId, c);
    if (!t) return '';
    const who = (b) => { const x = bot(b); return x ? `${oneLine(x.name, NOTE.name)} (id ${b})` : `id ${b}`; };
    const job = (b) => { const j = bot(b)?.job; return j ? `: ${oneLine(j, NOTE.job)}` : ''; };
    const others = t.bots.filter((b) => b !== botId);
    const shown = others.slice(0, NOTE.members);
    const members = shown.map((b) => `${who(b)}${b === t.lead ? ' (lead)' : ''}${job(b)}`).join('; ') + (others.length > shown.length ? `; and ${others.length - shown.length} more` : '');
    const project = `the owner's project "${oneLine(c.name || c.start, NOTE.name)}"`;
    const out = [botId === t.lead
      ? `You lead team "${oneLine(t.name, NOTE.name)}" in ${project}.`
      : `You are on team "${oneLine(t.name, NOTE.name)}" in ${project}. ${who(t.lead)} leads it.`];
    if (c.goal) out.push(`90-day goal: ${oneLine(c.goal, NOTE.goal)}`);
    if (members) out.push(`${botId === t.lead ? 'Your team' : 'Also on it'}: ${members}.`);
    out.push(botId === t.lead ? LEAD_RULES : MEMBER_RULES);
    return out.join('\n');
  }

  return { FILE: file, read, start, patch, remove, setProposal, undoProposal, made, begin, addTeam, setTeam, removeTeam, dropBot, teamOf, setObjective, addTodo, setTodo, removeTodo, day, checkinOf, answerCheckin, setPlan, approvePlan, planDue, planAsked, planByTeam, leadsToAsk, askedLead, setReport, postReport, reportsDue, reportStarted, suggest, takeSuggestion, dismissSuggestion, added, addDecision, removeDecision, decisionsNote, promptNote, botNote, todosOf, todoNote, todoLine, addEvent, setEvent, removeEvent };;
}

module.exports = { create, clean, NOTE, kindOf, nextDue, repeatOf, today, isDay, addDays, weekday, siteUrl, nameFrom, weekOf, MAX, TEAM_COLORS, BOT_COLORS, DAYS, DECISIONS, DECIDED_BY, ASKS, TOOLS, RHYTHMS };
