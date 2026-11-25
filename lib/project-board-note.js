// What the Project Manager is told of a project's board: the tiles on it and what each shows now, read from the
// same records the apps draw them from, so "why is this tile twice" or "what does the Blockers tile say" is answered
// from the board and not guessed. Names and texts are the owner's and the bots' words: one line each, no tag.
const { oneLine, inert } = require('./prompt-text');
const { cardLine } = require('./project-cards');
const company = require('./company');

const ROWS = 10; // of Current work and of Blockers
const TEXT = 200; // of one row's text
const EVENTS = 5;

// The board's tiles in the words the apps use. Cards and goals are tiles of their own, drawn beside these.
const LABELS = { days: '90 days', goals: 'Goals', teams: 'Teams', calendar: 'Calendar', todo: 'To-do', files: 'Files', needs: 'Needs you', work: 'Current work', blockers: 'Blockers', replies: 'Latest replies' };

const one = (s, max = TEXT) => inert(oneLine(s, max));
const ago = (at, now) => {
  const ms = Date.parse(now) - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${Math.max(m, 1)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const row = (x, now) => `- ${one(x.name || 'the owner', 60)} (${[x.state, x.at && ago(x.at, now)].filter(Boolean).join(', ')}): ${one(x.text) || 'no text'}`;
const rows = (list, empty, now) => (list.length ? `\n${list.slice(0, ROWS).map((x) => row(x, now)).join('\n')}${list.length > ROWS ? `\n- and ${list.length - ROWS} more` : ''}` : ` ${empty}`);

// The tiles on the board, what the owner sees on it. `board` is absent on a project made before pieces were chosen:
// it shows them all. An ongoing project has no 90 days.
const tilesOf = (c) => (Array.isArray(c.board) ? c.board : company.PIECES).filter((k) => LABELS[k] && !(k === 'days' && company.ongoing(c)));

// What each tile of the board shows now, by the tile's id in the layout (`work`, `calendar`, `card:<id>`): { rows,
// text }, `rows` the lines of a tile that lists rows and `text` the one line of a tile that is one. A tile not on the
// board has none. boardNote lists them all; tileNote gives the one the owner pointed at (ADR 276).
// c: the project; snapshot: its overview (lib/project-overview.js); cards: its board cards; now: an ISO time.
function shows(c, { snapshot = null, cards = [], now = new Date().toISOString() } = {}) {
  const on = tilesOf(c);
  const running = c.phase === 'running'; // the apps draw the calendar and the files only then
  const shown = (k) => on.includes(k) && (running || !['calendar', 'files'].includes(k));
  const out = {};
  const listed = (list, empty) => (list.length ? { rows: `${list.slice(0, ROWS).map((x) => row(x, now)).join('\n')}${list.length > ROWS ? `\n- and ${list.length - ROWS} more` : ''}`, empty } : { rows: '', empty });
  if (snapshot) {
    out.needs = listed((snapshot.blockers || []).filter((x) => x.state === 'asks'), 'No question waits.');
    if (shown('work')) out.work = listed(snapshot.work, 'No recorded work.');
    if (shown('blockers')) out.blockers = listed(snapshot.blockers.filter((x) => x.state !== 'asks'), 'No failed work.');
    if (shown('replies')) out.replies = listed(snapshot.replies, 'No replies yet.');
  }
  if (shown('calendar')) {
    const today = company.today(now);
    const ahead = (c.events || []).filter((e) => e.day >= today).sort((a, b) => `${a.day} ${a.time || ''}`.localeCompare(`${b.day} ${b.time || ''}`));
    out.calendar = { text: ahead.length ? ahead.slice(0, EVENTS).map((e) => `${e.day}${e.time ? ` ${e.time}` : ''} ${one(e.title, 80)}`).join('; ') : 'no event ahead' };
  }
  if (shown('todo')) out.todo = { text: `${(c.todos || []).filter((t) => !t.done).length} open (they are the "planned" rows of Current work), ${(c.todos || []).filter((t) => t.done).length} done` };
  if (shown('files')) out.files = { text: "the newest files of the project's folder (you are not shown which)" };
  return { out, on, shown };
}

function boardNote(c, ctx = {}) {
  const cards = ctx.cards || [];
  const { out: s, on, shown } = shows(c, ctx);
  const list = (k, text) => (s[k] ? `${text}${s[k].rows ? `\n${s[k].rows}` : ` ${s[k].empty}`}` : '');
  // Needs you is never hidden: the apps draw it on top whenever something waits, whatever the board holds (ADR 252).
  const names = [...(on.includes('needs') ? [] : ['Needs you (only while something waits)']), ...on.filter(shown).map((k) => LABELS[k]), ...(cards.length ? [`${cards.length} card${cards.length === 1 ? '' : 's'} made by Claude`] : [])];
  const out = [`The project's board, as the owner sees it now. Tiles on it: ${names.join(', ') || 'none'}. Each tile is on the board once; a tile that lists several rows (Current work, Blockers, Latest replies) shows several rows, not several tiles. Answer questions about the board from this, and say what you did not see.`];
  if (ctx.snapshot) {
    out.push(list('needs', 'Needs you tile: the questions waiting for the owner, then the cards of the bots that wait for the owner\'s OK, as listed above:'));
    if (s.work) out.push(list('work', 'Current work tile: running work first ("working"), then the project\'s open to-dos ("planned"). A to-do botdot has started shows as "working" and also stays "planned" until it is ticked, so one task can show twice that way; two to-dos with alike texts are two to-dos, not a second tile:'));
    if (s.blockers) out.push(list('blockers', 'Blockers tile: failed runs; questions are in Needs you:'));
    if (s.replies) out.push(list('replies', 'Latest replies tile (newest first):'));
  }
  if (shown('goals') && c.objectives.length) out.push(`Goal tiles: ${c.objectives.map((o) => `${one(o.name, 80)} (${o.target > 0 ? `${o.current} of ${o.target}` : o.steps?.length ? `${o.steps.filter((x) => x.done).length} of ${o.steps.length} steps done` : o.done ? 'done' : 'not done'})`).join('; ')}.`);
  if (cards.length) out.push(`Card tiles:\n${cards.map((k) => `- ${one(cardLine(k), 300)}`).join('\n')}`);
  if (s.calendar) out.push(`Calendar tile: ${s.calendar.text}.`);
  if (s.todo) out.push(`To-do tile: ${s.todo.text}.`);
  if (s.files) out.push(`Files tile: ${s.files.text}.`);
  return out.join('\n');
}

// ---------- the tile the owner points at (ADR 276) ----------

// The tiles the owner can point at with the pencil: the pieces that have a title of their own, and a card made by
// Claude. Goals have a pencil of their own (Change), the team rows their own chat.
const POINTABLE = ['work', 'blockers', 'replies', 'calendar', 'todo', 'files'];
// What a piece lists, for "you cannot change which … it lists".
const LISTS = { work: 'work', blockers: 'failed runs', replies: 'replies', calendar: 'events', todo: 'to-dos', files: 'files' };
const ORDER = { work: ' (running work first, then open to-dos)', replies: ' (newest first)' };

// The tile the owner points at, as { id, label }, or null when the board has no such tile now. `ref`: the tile's id as
// the layout names it (arrange_project_board): a piece's (`replies`) or `card:<id>`.
function tileOf(c, ref, { cards = [] } = {}) {
  const id = typeof ref === 'string' ? ref.trim() : '';
  if (POINTABLE.includes(id)) return shows(c).shown(id) ? { id, label: LABELS[id] } : null;
  const k = id.startsWith('card:') ? cards.find((x) => `card:${x.id}` === id) : null;
  return k ? { id, label: oneLine(k.title || k.ask, 60) } : null;
}

// A card's body as the lines it shows (project-cards bodyOf): a value, then its list, table, bars or points.
function bodyLines(b) {
  if (!b) return [];
  const big = `${b.value}${b.sub ? ` (${b.sub})` : ''}`;
  if (b.show === 'list') return b.list.map((x) => `${x.ref ? `${x.ref}: ` : ''}${x.text}${x.tag ? ` [${x.tag}]` : ''}`);
  if (b.show === 'table') return b.rows.map((r) => `${r.label}: ${r.value}${r.change ? ` (${r.change})` : ''}`);
  if (b.show === 'bars') return [big, ...b.bars.map((x) => `${x.label}: ${x.value}`)];
  if (b.show === 'spark') return [big, `points: ${b.points.join(', ')}`];
  return [big];
}
const STATE = { asking: "waiting for the owner's answers", building: 'being built', ready: 'ready' };

// What a turn is told when the owner's message points at a tile: which one, what it shows now, and what may be done
// with it. The words are the owner's approved wording (the design of the pencil); a tile's texts are somebody's
// words, as in the whole board's note (one(), inert()).
function tileNote(c, tile, ctx = {}) {
  if (tile.id.startsWith('card:')) {
    const k = (ctx.cards || []).find((x) => `card:${x.id}` === tile.id);
    if (!k) return '';
    const state = k.state === 'failed' ? `failed: ${one(k.error || 'nothing to show', 80)}` : STATE[k.state] || k.state;
    const lines = bodyLines(k.body).map((x) => `- ${one(x, 160)}`);
    return `This message is about the board card ${tile.id} "${one(tile.label, 60).replace(/"/g, "'")}" (${state}; asked: ${one(k.ask, 200)}). Change it with change_project_card, card "${k.id}".\nIt shows now:${lines.length ? `\n${lines.join('\n')}` : ' nothing yet.'}`;
  }
  const s = shows(c, ctx).out[tile.id];
  const body = s?.rows ? `\n${s.rows}` : s?.text ? ` ${s.text}.` : ` ${s?.empty || 'nothing.'}`;
  return `This message is about the board tile "${tile.label}" (${tile.id}). It is a fixed tile: you can move it, resize it or hide it with arrange_project_board; you cannot change which ${LISTS[tile.id]} it lists. Say so if that is what the owner asks.\nIt shows now${ORDER[tile.id] || ''}:${body}`;
}

module.exports = { boardNote, tilesOf, tileOf, tileNote, POINTABLE };
