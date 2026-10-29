// Mentions: "@" plus the name of a bot, a bot's job or a skill in a chat message, saying the message is
// about it (CONTEXT.md: Mention). Reference only: nothing is sent, run, loaded or granted.
//   - bot: its name without spaces, each word capitalised: @FleetDoctor (the Chief is @ChiefOfStaff)
//   - job: bot then job: @FleetDoctor/MorningCheck
//   - skill: its name as is: @weekly-report
//   - page (#473): a bot's page (or the Chief's), its title squashed as a bot's name: @IssueList, or @FleetDoctor/IssueList
//   - tile (#473): a tile of the Board, its title squashed the same way: @LivingRoom
//   - project (#700): one of the account's projects, its name squashed the same way: @Botdot
// A page, a tile or a project mention hands its content to the run that answers (lib/mentions.js mentionsNote).
// Matching ignores case; for one name a bot wins, then a page (the chat's own bot's first), then a tile, then a project, then a skill; "@" inside a word (an email) isn't one;
// anything that matches nothing stays plain text.
//
// Files (#604, feature `file-mentions`): "@[" its place and path "]", the form a pick from the "@" file picker puts in a
// bot's own chat: @[botdot:reports/summary.md] (its workspace on botdot), @[computer:archive/a.csv] (its folder on the
// account's computer), @[project:Website/index.html] (a shared project it is in: the project's name, then the path).
// A path has no "]" and no line break; a file or folder is named the same way. The run gets its full path (lib/mentions.js).
// While "@" and a word without spaces is typed (fileTyping), the apps look for files and folders of that name; a "/"
// after a folder's name goes into it ("@reports/").
//
// Commands (#237): "/" and one of a bot's skills at the very start of a message in that bot's own chat runs the
// skill, with the rest of the message as its arguments: /weekly-report for May. Typing "/" there lists the bot's
// skills; a name the bot has no skill of is plain text. Not in the Chief chat or a group. The skills are the ones
// that reach the bot's runs (commandSkills: while its skills are on, its picked library skills, then the Claude
// account's not switched off for it and not named like a library skill, #236).
//
// Chips (2026-10-23): a message that runs a skill, or a "/btw" in a bot's own chat or the Chief chat, is drawn with
// that start as a chip, in the message box and in the owner's bubble (commandMark). The text sent stays as typed.
//
// ctx, for every function: { chat, bots, library }
//   chat: 'chief' or the id of the bot whose chat it is
//   bots: [{ id, name, description?, prompt?, skills?, useSkills?, jobs?: [{ id, name, cron?, at?, kind?, prompt? }] }], the Chief included
//   library: [{ name, description }], the whole skill library
//   pages: [{ bot, slug, title }], every page of the account, the Chief's with bot 'chief' (#473, feature `page-mentions`)
//   tiles: [{ id, title, kind }], the Board's tiles; a page's tile and a group of tiles are no tile mention (#473)
//   projects: [{ id, name, color? }], the account's projects (#700, feature `project-mentions`); one without a name is none
//   account: [{ name, description }], the Claude account's skills (for "/" only); bots[].disabledSkills switches them off
//   all: a group's chat, on a botdot that knows "@all" (#124, feature `group-all`): "@all" at the start of a message
//     sends it to every member at once. It is offered first while it is typed there, and it is no member's mention:
//     a member named All is neither matched nor suggested.
//   files: the chat is a bot's own and its botdot hands files over (#604): "@" also looks for files (the apps do)
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

// A file mention (#604): its place, its project and its path, and while one is typed, the "@" and what follows it.
const FILE = /(?<![\p{L}\p{N}_])@\[(botdot|computer|project):([^\]\n]+)\]/gu;
const FILE_TYPING = /(?<![\p{L}\p{N}_])@([^\s@[\]]*)$/u;
const FILE_REST = /^[^\s@[\]]*/u; // the rest of a file mention's word after the cursor
const PLACES = { botdot: 'server', computer: 'computer', project: 'project' }; // the word in the text → the API's root

// "Fleet Doctor" → "FleetDoctor", "Chief of Staff" → "ChiefOfStaff", "Morning check" → "MorningCheck".
function shortName(name) {
  return String(name || '').trim().split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('').replace(/[^\p{L}\p{N}_-]/gu, '');
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// The pages a mention can name, the chat's own bot's first (#473); and the Board's tiles, without a page's tile (the
// page itself is named) and without a group of tiles.
function pagesInScope({ chat, pages = [] }) {
  const ok = (p) => p && p.title && shortName(p.title);
  return [...pages.filter((p) => ok(p) && p.bot === chat), ...pages.filter((p) => ok(p) && p.bot !== chat)];
}
const tilesInScope = ({ tiles = [] }) => tiles.filter((t) => t && t.title && shortName(t.title) && t.kind !== 'page' && t.kind !== 'group');
const projectsInScope = ({ projects = [] }) => projects.filter((p) => p && p.id && p.name && shortName(p.name));

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
    if (job) return { kind: 'job', bot: bot.id, job: job.id, whole: true };
    const page = b ? (ctx.pages || []).find((p) => p.bot === bot.id && p.title && same(shortName(p.title), b)) : null;
    return page ? { kind: 'page', bot: bot.id, page: page.slug, whole: true } : { kind: 'bot', bot: bot.id, whole: !b };
  }
  const page = pagesInScope(ctx).find((p) => same(shortName(p.title), a));
  if (page) return { kind: 'page', bot: page.bot, page: page.slug, whole: !b };
  const tile = tilesInScope(ctx).find((t) => same(shortName(t.title), a));
  if (tile) return { kind: 'tile', tile: tile.id, whole: !b };
  const project = projectsInScope(ctx).find((p) => same(shortName(p.name), a));
  if (project) return { kind: 'project', project: project.id, whole: !b };
  const skill = skills.find((k) => same(k.name, a));
  return skill ? { kind: 'skill', skill: skill.name, whole: !b } : null;
}

// A file's place and path as a mention puts them (#604): { root: 'server'|'computer'|'project', project?, path }, or null.
function fileRef(place, rest) {
  const root = PLACES[place];
  let project = null, p = String(rest || '');
  if (root === 'project') { const i = p.indexOf('/'); project = i < 0 ? p : p.slice(0, i); p = i < 0 ? '' : p.slice(i + 1); }
  const parts = p.split('/').filter(Boolean);
  if (!root || (root === 'project' && !project) || (!parts.length && root !== 'project') || parts.some((x) => x === '.' || x === '..')) return null;
  return { root, ...(project ? { project } : {}), path: parts.join('/') };
}
// The text a file mention is: "@[botdot:reports/a.md]". null for a path it can't hold (a "]" or a line break in it).
function fileText({ root, project, path }) {
  const place = Object.keys(PLACES).find((k) => PLACES[k] === root);
  const where = root === 'project' ? [project, path].filter(Boolean).join('/') : path;
  if (!place || !where || /[\]\n]/.test(where) || (root === 'project' && (!project || project.includes('/')))) return null;
  return `@[${place}:${where}]`;
}
// The file mentions in a text: [{ kind: 'file', text, start, end, root, project?, path, name }].
function findFiles(text) {
  const out = [];
  for (const m of String(text || '').matchAll(FILE)) {
    const ref = fileRef(m[1], m[2]);
    if (ref) out.push({ kind: 'file', text: m[0], start: m.index, end: m.index + m[0].length, ...ref, name: (ref.path || ref.project).split('/').pop() });
  }
  return out;
}

// The mentions in a text, in order: [{ kind: 'bot'|'job'|'page'|'tile'|'project'|'skill'|'file', text, start, end, bot?, job?, page?, tile?, project?, skill? }].
// page is the page's slug, tile the tile's id, project the project's id; a file's are as findFiles has them. A name inside a file's mention is none.
function findMentions(text, ctx) {
  const skills = skillsInScope(ctx);
  const files = findFiles(text);
  const out = [];
  for (const m of String(text || '').matchAll(TOKEN)) {
    if (files.some((f) => m.index >= f.start && m.index < f.end)) continue;
    const r = resolve(m[1], m[2], ctx, skills);
    if (!r) continue;
    const { whole, ...what } = r;
    const t = whole ? m[0] : `@${m[1]}`;
    out.push({ ...what, text: t, start: m.index, end: m.index + t.length });
  }
  return [...out, ...files].sort((a, b) => a.start - b.start);
}

// What the file picker looks for while "@" and a word are typed up to the cursor (#604): { start (where the "@" is),
// folders (the names before each "/"), q (what follows the last) }, or null. "@sum" → { folders: [], q: 'sum' };
// "@reports/2026" → { folders: ['reports'], q: '2026' }. An empty name on the way ("@/", "@a//") is none.
function fileTyping(typed) {
  const m = String(typed || '').match(FILE_TYPING);
  if (!m) return null;
  const parts = m[1].split('/');
  const q = parts.pop();
  if (parts.some((x) => !x || x === '.' || x === '..')) return null;
  return { start: m.index, folders: parts, q };
}

// The suggestion rows for text typed up to the cursor, when it ends in a word starting with "@".
// "@all" first in a group (ctx.all), then bots, then jobs, then pages, then tiles, then projects, then skills, at most MAX_ROWS; a name
// an earlier row took is not offered again, except a page's, offered as "@Bot/Title". After "@Bot/" only that bot's jobs,
// then its pages. Each row: { kind, text, label, bot?, job?, page?, tile?, project?, skill? }; picking it puts text plus a space in place of the "@…".
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
  const owner = (id) => (ctx.bots || []).find((b) => b.id === id);
  const pageRow = (p, text) => ({ kind: 'page', text, label: owner(p.bot)?.name ? `${owner(p.bot).name} · ${p.title}` : p.title, bot: p.bot, page: p.slug });
  let rows;
  if (m[2] !== undefined) {
    const bot = bots.find((b) => same(shortName(b.name), m[1]));
    rows = bot ? [
      ...(bot.jobs || []).filter((j) => has(shortName(j.name), m[2])).map((j) => jobRow(bot, j)),
      ...(ctx.pages || []).filter((p) => p.bot === bot.id && p.title && shortName(p.title) && has(shortName(p.title), m[2])).map((p) => pageRow(p, `@${shortName(bot.name)}/${shortName(p.title)}`)),
    ] : [];
  } else {
    const q = m[1];
    const taken = new Set(bots.map((b) => shortName(b.name).toLowerCase()));
    const all = ctx.all && !String(typed).slice(0, m.index).trim() && has(ALL, q) ? [{ kind: 'all', text: `@${ALL}`, label: typeof tr === 'function' ? tr('all: every member at once') : 'all: every member at once' }] : [];
    // A page's flat name, or "@Bot/Title" when a bot or an earlier page has it (and its bot can be mentioned).
    const pageRows = pagesInScope(ctx).filter((p) => has(shortName(p.title), q)).flatMap((p) => {
      const short = shortName(p.title);
      if (!taken.has(short.toLowerCase())) { taken.add(short.toLowerCase()); return [pageRow(p, `@${short}`)]; }
      const by = shortName(owner(p.bot)?.name || '');
      return by ? [pageRow(p, `@${by}/${short}`)] : [];
    });
    const tileRows = tilesInScope(ctx).filter((t) => {
      const short = shortName(t.title).toLowerCase();
      if (!has(short, q) || taken.has(short)) return false;
      taken.add(short);
      return true;
    }).map((t) => ({ kind: 'tile', text: `@${shortName(t.title)}`, label: t.title, tile: t.id }));
    const projectRows = projectsInScope(ctx).filter((p) => {
      const short = shortName(p.name).toLowerCase();
      if (!has(short, q) || taken.has(short)) return false;
      taken.add(short);
      return true;
    }).map((p) => ({ kind: 'project', text: `@${shortName(p.name)}`, label: p.name, project: p.id }));
    rows = [
      ...all,
      ...bots.filter((b) => has(shortName(b.name), q)).map((b) => ({ kind: 'bot', text: `@${shortName(b.name)}`, label: b.name, bot: b.id })),
      ...bots.flatMap((b) => (b.jobs || []).filter((j) => has(shortName(j.name), q)).map((j) => jobRow(b, j))),
      ...pageRows,
      ...tileRows,
      ...projectRows,
      ...skillsInScope(ctx).filter((k) => has(k.name, q) && !taken.has(k.name.toLowerCase())).map((k) => ({ kind: 'skill', text: `@${k.name}`, label: k.name, skill: k.name })),
    ];
  }
  return rows.slice(0, MAX_ROWS);
}

// Picking a suggestion row while typing: the "@…" before the cursor (and the rest of that word) becomes
// the row's text and a space (unless a space follows already), and the cursor goes after the space.
// text is the whole message; cursor where the cursor is in it.
// Returns { text, cursor, jobsNext }, or null when no "@…" is being typed. jobsNext: a bot was picked
// and the space is new, so a "/" typed next goes in its place and lists the bot's jobs.
// A file row (#604) is { kind: 'file', text: fileText(…) }: it takes the place of the "@" and all typed after it.
function pick(text, cursor, row) {
  const s = String(text || '');
  const m = s.slice(0, cursor).match(row.kind === 'command' ? COMMAND_TYPING : row.kind === 'file' ? FILE_TYPING : TYPING);
  if (!m) return null;
  const end = cursor + s.slice(cursor).match(row.kind === 'file' ? FILE_REST : WORD_REST)[0].length;
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

const BTW = /^\s*(\/btw)(?=\s|$)/i; // the owner's quick side question (lib/btw.js PREFIX)

// What the start of a message invokes, for the apps to draw it as a chip: { kind: 'skill', skill, text, start, end } when
// sending it runs a skill (command), { kind: 'btw', text, start, end } for "/btw" in a bot's own chat or the Chief chat
// (ADR 063), else null. text is the part of the message the chip shows; the message itself stays as typed.
function commandMark(text, ctx) {
  const s = String(text || '');
  const c = command(s, ctx);
  if (c) return { kind: 'skill', skill: c.skill, text: s.slice(0, c.skill.length + 1), start: 0, end: c.skill.length + 1 };
  const own = ctx.chat === CHIEF || (ctx.bots || []).some((b) => b.id === ctx.chat && b.id !== CHIEF);
  const b = own && !ctx.all && s.match(BTW);
  if (!b) return null;
  const start = b[0].length - b[1].length;
  return { kind: 'btw', text: b[1], start, end: start + b[1].length };
}

const api = { shortName, findMentions, findFiles, fileRef, fileText, fileTyping, suggest, pick, command, commandMark, skillsInScope, pagesInScope, tilesInScope, projectsInScope, MAX_ROWS, CHIEF, CHIEF_ALIAS };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Mentions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
