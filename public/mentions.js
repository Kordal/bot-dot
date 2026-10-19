// Mentions: "@" plus the name of a bot, a bot's job or a skill in a chat message, saying the message is
// about it (CONTEXT.md: Mention). Reference only: nothing is sent, run, loaded or granted.
//   - bot: its name without spaces, each word capitalised: @FleetDoctor (the Chief is @ChiefOfStaff)
//   - job: bot then job: @FleetDoctor/MorningCheck
//   - skill: its name as is: @weekly-report
// Matching ignores case; a bot wins over a skill of the same name; "@" inside a word (an email) isn't one;
// anything that matches nothing stays plain text.
//
// ctx, for every function: { chat, bots, library }
//   chat: 'chief' or the id of the bot whose chat it is
//   bots: [{ id, name, description?, prompt?, skills?, useSkills?, jobs?: [{ id, name, cron?, at?, kind?, prompt? }] }], the Chief included
//   library: [{ name, description }], the whole skill library
//   all: a group's chat, on a botdot that knows "@all" (#124, feature `group-all`): "@all" at the start of a message
//     sends it to every member at once. It is offered first while it is typed there, and it is no member's mention:
//     a member named All is neither matched nor suggested.
// Skills in scope: the whole library in the Chief chat; the bot's picked skills in its own chat.
// The apps follow the same rules, all checked against test/fixtures/mentions.json. The botdot server
// (lib/mentions.js, which adds the note runs get) and the web page (a plain <script>, as
// window.Mentions) share this one file.

(function (root) {

const MAX_ROWS = 6; // suggestions shown at once
const CHIEF = 'chief'; // the Chief's id, and its chat's (lib/chief.js CHIEF)
// The Chief's mention by its role, which stays its mention beside the name the owner gave it (#41): habit and older
// messages still mean it. No bot may be called so (server.js). It is not suggested: the list offers its name.
const CHIEF_ALIAS = 'ChiefOfStaff';

const NAME = '[\\p{L}\\p{N}_-]';
const TOKEN = new RegExp(`(?<![\\p{L}\\p{N}_])@(${NAME}+)(?:/(${NAME}+))?`, 'gu');
const TYPING = new RegExp(`(?<![\\p{L}\\p{N}_])@(${NAME}*)(?:/(${NAME}*))?$`, 'u');
const WORD_REST = /^[\p{L}\p{N}_/-]*/u; // the rest of a mention's word after the cursor
const ALL = 'all'; // "@all" in a group (ctx.all): every member at once, no member's mention

// "Fleet Doctor" → "FleetDoctor", "Chief of Staff" → "ChiefOfStaff", "Morning check" → "MorningCheck".
function shortName(name) {
  return String(name || '').trim().split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('').replace(/[^\p{L}\p{N}_-]/gu, '');
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

function skillsInScope({ chat, bots = [], library = [] }) {
  if (chat === CHIEF) return library;
  const bot = bots.find((b) => b.id === chat);
  if (!bot || bot.useSkills === false) return [];
  return library.filter((k) => (bot.skills || []).includes(k.name));
}

// What "@a" or "@a/b" stands for, or null. Returns how much of the token it covers.
function resolve(a, b, ctx, skills) {
  if (ctx.all && same(a, ALL)) return null;
  const bots = ctx.bots || [];
  const bot = bots.find((x) => same(shortName(x.name), a)) || (same(CHIEF_ALIAS, a) ? bots.find((x) => x.id === CHIEF) : null);
  if (bot) {
    const job = b ? (bot.jobs || []).find((j) => same(shortName(j.name), b)) : null;
    return job ? { kind: 'job', bot: bot.id, job: job.id, whole: true } : { kind: 'bot', bot: bot.id, whole: !b };
  }
  const skill = skills.find((k) => same(k.name, a));
  return skill ? { kind: 'skill', skill: skill.name, whole: !b } : null;
}

// The mentions in a text, in order: [{ kind: 'bot'|'job'|'skill', text, start, end, bot?, job?, skill? }].
function findMentions(text, ctx) {
  const skills = skillsInScope(ctx);
  const out = [];
  for (const m of String(text || '').matchAll(TOKEN)) {
    const r = resolve(m[1], m[2], ctx, skills);
    if (!r) continue;
    const { whole, ...what } = r;
    const t = whole ? m[0] : `@${m[1]}`;
    out.push({ ...what, text: t, start: m.index, end: m.index + t.length });
  }
  return out;
}

// The suggestion rows for text typed up to the cursor, when it ends in a word starting with "@".
// "@all" first in a group (ctx.all), then bots, then jobs, then skills, at most MAX_ROWS. After "@Bot/" only that bot's jobs.
// Each row: { kind, text, label, bot?, job?, skill? }; picking it puts text plus a space in place of the "@…".
function suggest(typed, ctx) {
  const m = String(typed || '').match(TYPING);
  if (!m) return [];
  const bots = (ctx.bots || []).filter((b) => shortName(b.name) && !(ctx.all && same(shortName(b.name), ALL))); // a name of only emoji can't be mentioned
  const has = (name, q) => name.toLowerCase().includes(q.toLowerCase());
  const jobRow = (bot, j) => ({ kind: 'job', text: `@${shortName(bot.name)}/${shortName(j.name)}`, label: `${bot.name} · ${j.name}`, bot: bot.id, job: j.id });
  let rows;
  if (m[2] !== undefined) {
    const bot = bots.find((b) => same(shortName(b.name), m[1]));
    rows = bot ? (bot.jobs || []).filter((j) => has(shortName(j.name), m[2])).map((j) => jobRow(bot, j)) : [];
  } else {
    const q = m[1];
    const botNames = new Set(bots.map((b) => shortName(b.name).toLowerCase()));
    const all = ctx.all && !String(typed).slice(0, m.index).trim() && has(ALL, q) ? [{ kind: 'all', text: `@${ALL}`, label: 'all: every member at once' }] : [];
    rows = [
      ...all,
      ...bots.filter((b) => has(shortName(b.name), q)).map((b) => ({ kind: 'bot', text: `@${shortName(b.name)}`, label: b.name, bot: b.id })),
      ...bots.flatMap((b) => (b.jobs || []).filter((j) => has(shortName(j.name), q)).map((j) => jobRow(b, j))),
      ...skillsInScope(ctx).filter((k) => has(k.name, q) && !botNames.has(k.name.toLowerCase())).map((k) => ({ kind: 'skill', text: `@${k.name}`, label: k.name, skill: k.name })),
    ];
  }
  return rows.slice(0, MAX_ROWS);
}

// Picking a suggestion row while typing: the "@…" before the cursor (and the rest of that word) becomes
// the row's text and a space (unless a space follows already), and the cursor goes after the space.
// text is the whole message; cursor where the cursor is in it.
// Returns { text, cursor, jobsNext }, or null when no "@…" is being typed. jobsNext: a bot was picked
// and the space is new, so a "/" typed next goes in its place and lists the bot's jobs.
function pick(text, cursor, row) {
  const s = String(text || '');
  const m = s.slice(0, cursor).match(TYPING);
  if (!m) return null;
  const end = cursor + s.slice(cursor).match(WORD_REST)[0].length;
  const spaced = s[end] === ' ';
  return {
    text: s.slice(0, m.index) + row.text + (spaced ? '' : ' ') + s.slice(end),
    cursor: m.index + row.text.length + 1,
    jobsNext: row.kind === 'bot' && !spaced,
  };
}

const api = { shortName, findMentions, suggest, pick, skillsInScope, MAX_ROWS, CHIEF, CHIEF_ALIAS };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Mentions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
