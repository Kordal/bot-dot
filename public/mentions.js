// Mentions: "@" plus the name of a bot, a bot's job or a skill in a chat message, saying the message is
// about it (CONTEXT.md: Mention). Reference only: nothing is sent, run, loaded or granted.
//   - bot: its name without spaces, each word capitalised: @FleetDoctor (the Chief is @ChiefOfStaff)
//   - job: bot then job: @FleetDoctor/MorningCheck
//   - skill: its name as is: @weekly-report
// Matching ignores case; a bot wins over a skill of the same name; "@" inside a word (an email) isn't one;
// anything that matches nothing stays plain text.
//
// Commands (#237): "/" and one of a bot's skills at the very start of a message in that bot's own chat runs the
// skill, with the rest of the message as its arguments: /weekly-report for May. Typing "/" there lists the bot's
// skills; a name the bot has no skill of is plain text. Not in the Chief chat or a group. The skills are the ones
// that reach the bot's runs (commandSkills: while its skills are on, its picked library skills, then the Claude
// account's not switched off for it and not named like a library skill, #236).
//
// ctx, for every function: { chat, bots, library }
//   chat: 'chief' or the id of the bot whose chat it is
//   bots: [{ id, name, description?, prompt?, skills?, useSkills?, jobs?: [{ id, name, cron?, at?, kind?, prompt? }] }], the Chief included
//   library: [{ name, description }], the whole skill library
//   account: [{ name, description }], the Claude account's skills (for "/" only); bots[].disabledSkills switches them off
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
const COMMAND_TYPING = /^\/([\p{L}\p{N}_-]*)$/u; // the text before the cursor while a command's name is typed
const COMMAND = /^\/([\p{L}\p{N}_-]+)(?:\s+([\s\S]*))?$/u; // a message that may run a skill

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
// "/" at the very start of a bot's own chat lists its skills instead: rows { kind: 'command', text: '/name', label,
// about (the skill's description), skill }.
function suggest(typed, ctx) {
  const has = (name, q) => name.toLowerCase().includes(q.toLowerCase());
  const c = String(typed || '').match(COMMAND_TYPING);
  if (c) return commandSkills(ctx).filter((k) => has(k.name, c[1])).slice(0, MAX_ROWS)
    .map((k) => ({ kind: 'command', text: `/${k.name}`, label: k.name, about: String(k.description || ''), skill: k.name }));
  const m = String(typed || '').match(TYPING);
  if (!m) return [];
  const bots = (ctx.bots || []).filter((b) => shortName(b.name) && !(ctx.all && same(shortName(b.name), ALL))); // a name of only emoji can't be mentioned
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
  const m = s.slice(0, cursor).match(row.kind === 'command' ? COMMAND_TYPING : TYPING);
  if (!m) return null;
  const end = cursor + s.slice(cursor).match(WORD_REST)[0].length;
  const spaced = s[end] === ' ';
  return {
    text: s.slice(0, m.index) + row.text + (spaced ? '' : ' ') + s.slice(end),
    cursor: m.index + row.text.length + 1,
    jobsNext: row.kind === 'bot' && !spaced,
  };
}

// A skill switched off for a bot, by its name or a namespaced one ("anthropic-skills:pdf"), as lib/skills.js isOff.
const isOff = (name, off) => (off || []).some((k) => k === name || String(k).endsWith(`:${name}`));

// The skills "/" runs in this chat: a bot's own chat only. The account's skills after the library's (#236).
function commandSkills(ctx) {
  const bot = ctx.chat === CHIEF ? null : (ctx.bots || []).find((b) => b.id === ctx.chat);
  if (!bot || bot.useSkills === false) return [];
  const library = new Set((ctx.library || []).map((k) => k.name));
  return [...skillsInScope(ctx), ...(ctx.account || []).filter((k) => !library.has(k.name) && !isOff(k.name, bot.disabledSkills))];
}

// What sending a message runs: { skill, args } when it starts with "/" and the name of a skill the bot has (args: the
// rest, trimmed), else null (it is sent as plain text).
function command(text, ctx) {
  const m = String(text || '').match(COMMAND);
  const skill = m && commandSkills(ctx).find((k) => same(k.name, m[1]));
  return skill ? { skill: skill.name, args: String(m[2] || '').trim() } : null;
}

const api = { shortName, findMentions, suggest, pick, command, skillsInScope, MAX_ROWS, CHIEF, CHIEF_ALIAS };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Mentions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
