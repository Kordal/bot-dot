// A run's steps, as its block in a bot's chat shows them (docs/api.md, "A run's steps"; #625): how many tool calls it
// made, and a short timeline of them in the working line's words (working-line.js), with when each came.
//
// The steps are kept while the run goes on (in the run's entry, not on disk) and written on its record when it ends,
// so a chat never reads a run's log to draw it. A step without words (Claude Code's own housekeeping, a tool nobody
// knows) is counted and has no row; the plan's TodoWrite and ToolSearch are no steps at all. Two rows in a row with
// the same words are one row, with how many times it came (`n`). The timeline keeps its newest MAX_ROWS rows.
const workingLine = require('./working-line');

const MAX_ROWS = 60;
const SKIPPED = new Set(['TodoWrite', 'ToolSearch']);
// The kind of a row the apps mark with its own icon: a message to a teammate, a skill it used.
const kindOf = (tool) => (tool === 'mcp__self__message_bot' ? 'message' : tool === 'Skill' ? 'skill' : undefined);

// A keeper of one run's steps. opts.who(to): the name of the bot a message goes to, opts.lang: the language its rows
// are said in (working-line.js words).
// now(): the clock, for a test.
function keeper({ who, lang, now = () => new Date() } = {}) {
  let count = 0;
  let rows = [];
  return {
    // A tool call of the run.
    see(tool, input) {
      if (typeof tool !== 'string' || SKIPPED.has(tool)) return;
      count++;
      const text = workingLine.words({ tool, input }, { who, lang });
      if (!text) return;
      const last = rows[rows.length - 1];
      if (last && last.text === text) { last.n = (last.n || 1) + 1; return; }
      const kind = kindOf(tool);
      rows.push({ at: now().toISOString(), text, ...(kind ? { kind } : {}) });
      if (rows.length > MAX_ROWS) rows = rows.slice(-MAX_ROWS);
    },
    // A new start of the same run (its sign-in was renewed): what the first start did is not its steps.
    again() { count = 0; rows = []; },
    // What the run's record and the API carry: null for a run that took no step.
    view: () => (count ? { count, rows: rows.map((r) => ({ ...r })) } : null),
    count: () => count,
  };
}

module.exports = { MAX_ROWS, keeper };
