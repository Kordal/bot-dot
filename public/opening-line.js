// A working bot's opening line on the web page (docs/api.md, "The opening line"). The botdot server
// reads the line from the bot's run and offers it while the run is going on; this file keeps what the
// server said per chat and draws it: a status line under the chat, with a pulsing dot in the bot's
// colour, with Stop after it, and the bot's preview in the list. The line is plain text and is never a message of the chat:
// it makes no dot and moves no "New" line (unread.js). Against a server without it a working
// bot's line says "Working". While a run waits for the owner's answer the line says "Waiting for your OK".
// With `working-line` in the server's `features` a bot's line is its working line (docs/api.md, "The working line"):
// the server's words for what the bot is doing now, which change as the run goes on. The page draws them as it
// draws the opening line, and has no words of its own for a running run's step.
// A plain <script>, as window.OpeningLine; the tests load it the same way.

(function (root) {

// The line as this page takes it: the server's text (already one line, cut and without marks), when it
// is a string. '' for anything else.
const text = (x) => (typeof x === 'string' ? x.trim() : '');

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// What the line of a run says while it waits for the owner's answer.
const WAITING = tr('Waiting for your OK');

// The status line under a chat: '' when there is nothing to say. The ellipsis after it is drawn by the style.
// The colour is the server's and is checked like the dots' (unread.js, loaded before this file).
// stop: what Stop at the end of the line ends. The running run of a bot's chat, as its id: the line is then
// there for the whole run, "Working" until the bot says its own. Or the Chief's reply in a chat, as
// { chief: <chat id> }: the line is there for the whole reply, "Thinking" until the page hands in what the Chief
// is doing (chiefLine). A working bot, and a replying Chief, is this line and nothing else.
// held: that run waits for the owner's answer (its `waitingFor` is "ok", docs/api.md). The line then says so in
// place of the opening line, with a still dot and no ellipsis (the style's `held`), and Stop stays.
function status(line, color, stop, held = false) {
  const run = text(stop);
  const chief = stop && typeof stop === 'object' ? text(stop.chief) : '';
  const waits = held === true && !!run;
  const t = waits ? WAITING : text(line) || (run ? tr('Working') : chief ? tr('Thinking') : '');
  const button = run ? `<button type="button" data-stop-run="${esc(run)}">${tr('Stop')}</button>`
    : chief ? `<button type="button" data-stop-chief="${esc(chief)}">${tr('Stop')}</button>` : '';
  return t ? `<div class="status-line${waits ? ' held' : ''}" role="status" style="--c:${root.Unread.tint(color)}"><i></i><span>${esc(t)}</span>${button}</div>` : '';
}

// Does the server offer the working line? features: its `features`, as the page read them.
const follows = (features) => Array.isArray(features) && features.includes('working-line');
// The line of a running run, from the run as the server gives it, and of a member at work in a group, from its
// entry in the group's `working`: its working line from a server that has one, its opening line from one that
// does not, or that sends this one none.
const ofRun = (run, features) => (follows(features) && text(run?.workingLine)) || text(run?.openingLine);
// Does this event bring the line of a bot's run, on the feed and in the run's stream? `working_line` from a server
// that has the working line, which sends every change of the line with it, the opening line first; `opening_line`
// from one that does not. So the line changes when the server says, and at most once a second.
const says = (type, features) => type === (follows(features) ? 'working_line' : 'opening_line');

// What stands for an activity of the Chief that has no words: a server from before it had words for every tool
// names the tool alone.
const NO_WORDS = 'Working';
// The Chief's line while it replies (docs/api.md, "The working line", the Chief of Staff). doing: the `text` of its
// `activity`, which is the whole line as it reads now: its opening line first, then the words of the steps that
// follow. opener: its opening line, which is still sent apart. The page draws what it is doing; where that has no
// words (none came yet, or a server from before) the opening line stands, as it always did.
const chiefLine = (doing, opener) => { const d = text(doing); return d && d !== NO_WORDS ? d : text(opener) || (d && tr('Working')); };

// The bot's preview in the list while it works: its line, or '' for the usual "Working…".
const preview = (line) => (text(line) ? `${text(line)}…` : '');

// The lines of the chats, as the server said them. A chat is "bot:<id>" or "chief:<chatId>". A line
// belongs to a run (the Chief's to the reply it is writing: no run id), and a chat shows the line of
// the latest run that said one and still goes on.
// Every change answers whether anything may look different, so the page redraws only then.
function keeper() {
  const said = new Map(); // chat -> Map(run id, or '' for the Chief -> text), in the order they were said
  const ended = new Set(); // runs that ended: a list fetched before that does not bring their line back
  const key = (runId) => runId || '';
  function say(chat, line, runId = null) {
    const t = text(line);
    if (!chat || !t || ended.has(runId)) return false;
    const lines = said.get(chat) || new Map();
    if (lines.get(key(runId)) === t) return false;
    lines.set(key(runId), t);
    said.set(chat, lines);
    return true;
  }
  function drop(chat, run) {
    const lines = said.get(chat);
    if (!lines?.delete(run)) return false;
    if (!lines.size) said.delete(chat);
    return true;
  }
  return {
    // The server said a line (the feed's `opening_line` or `working_line`, a run's stream, a Chief chat's stream):
    // a run's new line takes the place of its last.
    say,
    // The run or the reply ended, whichever way: its line goes. A run's end takes only its own line;
    // without a run id, every line of the chat.
    end(chat, runId = null) {
      if (!runId) return said.delete(chat);
      if (ended.size > 500) ended.clear();
      ended.add(runId);
      return drop(chat, runId);
    },
    // What is going on now, from the server's lists: [{ chat, runId, text }], text when it has a line.
    // A line whose run is no longer among them goes; a line the feed brought meanwhile stays.
    sync(live) {
      let changed = false;
      for (const [chat, lines] of [...said]) {
        for (const run of [...lines.keys()]) if (!live.some((x) => x.chat === chat && key(x.runId) === run)) changed = drop(chat, run) || changed;
      }
      for (const x of live) changed = say(x.chat, x.text, x.runId ?? null) || changed;
      return changed;
    },
    // Forget everything: the feed could not say what was missed, and the lists are read again.
    clear() { const had = said.size > 0; said.clear(); return had; },
    of: (chat) => [...(said.get(chat)?.values() || [])].pop() || '',
    // The line of one run of the chat: '' when it said none.
    ofRun: (chat, runId) => said.get(chat)?.get(key(runId)) || '',
  };
}

const api = { WAITING, NO_WORDS, text, status, preview, keeper, follows, ofRun, says, chiefLine };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.OpeningLine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
