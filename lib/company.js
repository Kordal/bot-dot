// The Company (#668, #669, ADR 110): one company per account, kept in data/company.json. The owner sets it up with
// the Chief of Staff (what it is, who it is for, a few answers, a proposed team) and then runs its bots as teams: a
// team is several bots with exactly one lead. Bots stay ordinary bots; the company only names them by id.
//
// Everything here is somebody's text (the owner's, or the Chief's from lib/company-chief.js): it is cut to length and
// kept as plain strings, never as markup (AGENTS.md rule 6). Each change goes out as a `company` feed event.
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonfile');

const DATA_DIR = process.env.BOT_DOT_DATA || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'company.json');

const MAX = { name: 80, start: 500, text: 300, long: 2000, list: 20, sources: 20, teams: 20, bots: 40, todos: 200, objectives: 6, chat: 8, undo: 10 };
const TEAM_COLORS = ['#34c759', '#ff7a45', '#8e7cff', '#3aa0ff', '#ffb020', '#ff5c8a', '#2ec4b6', '#b07cff'];
const OBJECTIVE_COLORS = ['#34c759', '#ff7a45', '#8e7cff', '#3aa0ff', '#ffb020', '#ff5c8a'];
const DECISIONS = ['keep', 'change', 'stop'];
const DAYS = [30, 60, 90];

const refused = (message, status = 400, state = 'refused') => Object.assign(new Error(message), { status, state });
const id = () => crypto.randomUUID().slice(0, 8);
const nowIso = (now) => (now instanceof Date ? now : new Date()).toISOString();

// One line of text, trimmed and cut; anything that is not text is ''.
const line = (v, max = MAX.text) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const lines = (v, max = MAX.text, n = MAX.list) => (Array.isArray(v) ? v : []).map((x) => line(x, max)).filter(Boolean).slice(0, n);
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

function plan(v) {
  if (!v || typeof v !== 'object') return null;
  return { items: (Array.isArray(v.items) ? v.items : []).filter((x) => x && typeof x === 'object').map((x) => ({ text: line(x.text, 200), ...(x.objective ? { objective: line(x.objective, 16) } : {}) })).filter((x) => x.text).slice(0, 5), approved: !!v.approved };
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
    goal: line(c.goal), never: lines(c.never, 80, 10), time: line(c.time, 80),
    objectives: objectives(c.objectives), proposal: c.proposal == null ? null : proposal(c.proposal),
    teamChat: teamChat(c.teamChat), proposalUndo: (Array.isArray(c.proposalUndo) ? c.proposalUndo : []).filter(Array.isArray).map(proposal).slice(-MAX.undo),
    teams: (Array.isArray(c.teams) ? c.teams : []).filter((t) => t && typeof t === 'object' && Array.isArray(t.bots) && t.bots.length).map((t, i) => {
      const bots = [...new Set(t.bots.filter((b) => typeof b === 'string'))];
      return { id: line(t.id, 16) || id(), name: line(t.name, 60), color: color(t.color, TEAM_COLORS, i), bots, lead: bots.includes(t.lead) ? t.lead : bots[0] };
    }).filter((t) => t.bots.length),
    todos: (Array.isArray(c.todos) ? c.todos : []).filter((t) => t && typeof t === 'object' && t.text).map((t) => ({ id: line(t.id, 16) || id(), text: line(t.text, 300), ...(t.bot ? { bot: line(t.bot, 64) } : {}), done: !!t.done, at: t.at || null })).slice(-MAX.todos),
    plan: plan(c.plan),
    checkins: (Array.isArray(c.checkins) ? c.checkins : []).filter((k) => k && DAYS.includes(k.day) && DECISIONS.includes(k.decision)).map((k) => ({ day: k.day, decision: k.decision, at: k.at || null })),
  };
}

function create({ file = FILE, emit = () => {}, now = () => new Date() } = {}) {
  const read = () => clean(readJson(file, null));
  const save = (c) => { const kept = clean(c); writeJson(file, kept); emit({ company: kept }); return kept; };
  const must = () => { const c = read(); if (!c) throw refused('There is no company yet.', 404, 'none'); return c; };
  const change = (fn) => { const c = must(); fn(c); return save(c); };

  // The day of the 90 the company is on, from its start: day 1 the day it started. null before it started.
  const day = (c = read(), at = now()) => (c?.startedAt ? Math.max(1, Math.floor((at - new Date(c.startedAt)) / 86_400_000) + 1) : null);

  function start({ start: text, sources = [] } = {}) {
    if (read()) throw refused('There is a company already.', 409, 'exists');
    const s = line(text, MAX.start);
    if (!s) throw refused('Say what you are working on: your site, or your idea in one sentence.');
    const kind = kindOf(s);
    return save({ id: id(), name: nameFrom(kind, s), kind, start: s, phase: 'setup', createdAt: nowIso(now()), sources: (Array.isArray(sources) ? sources : []).map(source).filter(Boolean) });
  }

  const PATCHABLE = ['name', 'about', 'stories', 'swot', 'goal', 'never', 'time', 'objectives', 'proposal', 'sources', 'plan'];
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

  function addTeam({ name, bots, lead, color: col } = {}, known = () => true) {
    return change((c) => {
      const n = line(name, 60);
      if (!n) throw refused('Give the team a name.');
      if (c.teams.length >= MAX.teams) throw refused(`A company has at most ${MAX.teams} teams.`);
      const members = botsOf(bots, known);
      const l = leadOf(lead, members);
      takeOut(c, members);
      c.teams.push({ id: id(), name: n, color: color(col, TEAM_COLORS, c.teams.length), bots: members, lead: l });
    });
  }
  function setTeam(teamId, { name, bots, lead } = {}, known = () => true) {
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
  function addTodo({ text, bot } = {}, known = () => true) {
    const t = line(text, 300);
    if (!t) throw refused('Write the task.');
    if (bot !== undefined && bot !== null && bot !== '' && !known(bot)) throw refused('That bot is gone.');
    let made;
    const c = change((x) => { made = { id: id(), text: t, ...(bot ? { bot } : {}), done: false, at: nowIso(now()) }; x.todos.push(made); });
    return { company: c, todo: made };
  }
  function setTodo(todoId, { done } = {}) {
    return change((c) => {
      const t = c.todos.find((x) => x.id === todoId);
      if (!t) throw refused('That task is gone.', 404, 'gone');
      t.done = !!done;
    });
  }
  function removeTodo(todoId) {
    return change((c) => {
      if (!c.todos.some((t) => t.id === todoId)) throw refused('That task is gone.', 404, 'gone');
      c.todos = c.todos.filter((t) => t.id !== todoId);
    });
  }

  // What the Chief's prompt says of the company, in a few lines (records, not orders). '' without one.
  function promptNote(nameOfBot = (b) => b) {
    const c = read();
    if (!c) return '';
    const out = [`The owner's company: ${c.name || c.start} (${c.phase === 'running' ? `day ${day(c)} of 90` : 'being set up'}). Read and change it with the company tools.`];
    if (c.goal) out.push(`90-day goal: ${c.goal}`);
    for (const o of c.objectives) out.push(`Objective ${o.id}: ${o.name}, ${o.current} of ${o.target}`);
    for (const t of c.teams) out.push(`Team ${t.id} "${t.name}": ${t.bots.map((b) => `${nameOfBot(b)}${b === t.lead ? ' (lead)' : ''}`).join(', ')}`);
    if (c.never.length) out.push(`Never without asking: ${c.never.join('; ')}`);
    return out.join('\n');
  }

  return { FILE: file, read, start, patch, remove, setProposal, undoProposal, made, begin, addTeam, setTeam, removeTeam, dropBot, teamOf, setObjective, addTodo, setTodo, removeTodo, day, promptNote };
}

module.exports = { create, clean, kindOf, siteUrl, nameFrom, MAX, TEAM_COLORS, BOT_COLORS, DAYS, DECISIONS, ASKS, TOOLS };
