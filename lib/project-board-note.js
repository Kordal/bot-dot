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
const row = (x, now) => `- ${one(x.name || 'the Chief of Staff', 60)} (${[x.state, x.at && ago(x.at, now)].filter(Boolean).join(', ')}): ${one(x.text) || 'no text'}`;
const rows = (list, empty, now) => (list.length ? `\n${list.slice(0, ROWS).map((x) => row(x, now)).join('\n')}${list.length > ROWS ? `\n- and ${list.length - ROWS} more` : ''}` : ` ${empty}`);

// The tiles on the board, what the owner sees on it. `board` is absent on a project made before pieces were chosen:
// it shows them all. An ongoing project has no 90 days.
const tilesOf = (c) => (Array.isArray(c.board) ? c.board : company.PIECES).filter((k) => LABELS[k] && !(k === 'days' && company.ongoing(c)));

// c: the project; snapshot: its overview (lib/project-overview.js); cards: its board cards; now: an ISO time.
function boardNote(c, { snapshot = null, cards = [], now = new Date().toISOString() } = {}) {
  const on = tilesOf(c);
  const shown = (k) => on.includes(k);
  const out = [`The project's board, as the owner sees it now. Tiles on it: ${[...on.map((k) => LABELS[k]), ...(cards.length ? [`${cards.length} card${cards.length === 1 ? '' : 's'} made by Claude`] : [])].join(', ') || 'none'}. Each tile is on the board once; a tile that lists several rows (Current work, Blockers, Latest replies) shows several rows, not several tiles. Answer questions about the board from this, and say what you did not see.`];
  if (snapshot) {
    if (shown('work')) out.push(`Current work tile: running work first ("working"), then the project's open to-dos ("planned"; a to-do shows here, so the same to-do twice is two to-dos, not a second tile):${rows(snapshot.work, 'No recorded work.', now)}`);
    if (shown('blockers')) out.push(`Blockers tile: failed runs and questions waiting for the owner ("asks"):${rows(snapshot.blockers.filter((x) => x.state !== 'asks'), 'No failed work.', now)}`);
    if (shown('replies')) out.push(`Latest replies tile (newest first):${rows(snapshot.replies, 'No replies yet.', now)}`);
  }
  if (shown('needs')) out.push('Needs you tile: what waits for the owner, as listed above; it is on top of the board only while something waits.');
  if (shown('goals') && c.objectives.length) out.push(`Goal tiles: ${c.objectives.map((o) => `${one(o.name, 80)} (${o.steps?.length ? `${o.steps.filter((x) => x.done).length} of ${o.steps.length} steps done` : `${o.current} of ${o.target}`})`).join('; ')}.`);
  if (cards.length) out.push(`Card tiles:\n${cards.map((k) => `- ${one(cardLine(k), 300)}`).join('\n')}`);
  if (shown('calendar')) {
    const today = company.today(now);
    const ahead = (c.events || []).filter((e) => e.day >= today).sort((a, b) => `${a.day} ${a.time || ''}`.localeCompare(`${b.day} ${b.time || ''}`));
    out.push(`Calendar tile: ${ahead.length ? ahead.slice(0, EVENTS).map((e) => `${e.day}${e.time ? ` ${e.time}` : ''} ${one(e.title, 80)}`).join('; ') : 'no event ahead'}.`);
  }
  if (shown('todo')) out.push(`To-do tile: ${(c.todos || []).filter((t) => !t.done).length} open (they are the "planned" rows of Current work), ${(c.todos || []).filter((t) => t.done).length} done.`);
  if (shown('files')) out.push("Files tile: the newest files of the project's folder (you are not shown which).");
  return out.join('\n');
}

module.exports = { boardNote, tilesOf };
