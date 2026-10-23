// The reply draft (docs/api.md, "The reply draft"; ADR 042): the reply as the model writes it, for the chat that
// follows the run, so the owner reads it grow instead of waiting for the whole. It is read from Claude Code's partial
// messages (--include-partial-messages: `stream_event` lines with `text_delta`s) and kept for the running run or turn
// only: never in its log, its meta or the chat. When the run ends, the reply takes its place.
//
// Only the reply is shown. The text of the message being written, since its last tool call, is held back while it
// could still be the opening line (one line of at most opening-line.js MAX characters, in a message that has not
// ended), cleared when a tool call starts, and drawn without a trailing marker line ([[choices: …]], [[ask: …]],
// choices.js), without a mail draft's block (mail-draft.js: the card shows it once the reply has ended) and, in a group, not at all while it could still be the pass word (ADR 019).

const openingLine = require('./opening-line');
const choices = require('./choices');
const mailDraft = require('./mail-draft');

// At most one draft every this many milliseconds per run; the newest text waits for its turn and is never lost.
const EVERY_MS = 200;

// What could still become the pass word (group-chat.js isPass): its signs, and a beginning of "pass".
const SIGNS = '[\\s*_`"\'.!]*';
const MAYBE_PASS = new RegExp(`^${SIGNS}(?:p(?:a(?:s(?:s${SIGNS})?)?)?)?$`, 'i');

// What of the text written so far may be shown ('' for nothing). ended: its message ended its turn (end_turn), so
// it is the reply as written; group: a turn in a group, which may pass.
function shown(text, { ended = false, group = false } = {}) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n');
  if (group && MAYBE_PASS.test(t)) return '';
  if (ended) return choices.split(mailDraft.split(t).text).text;
  const open = t.search(/^[ \t]*\[\[\s*draft\b/im); // a mail draft's block, from where it begins
  if (open >= 0) return shown(t.slice(0, open).trimEnd() + '\n', { group });
  const flat = t.trim();
  if (!flat.includes('\n') && [...flat].length <= openingLine.MAX) return '';
  // A marker line, or the beginning of one, is no text: the lines that start with "[[" at the end, and a last line
  // that is a lone "[".
  const lines = t.split('\n');
  while (lines.length && (/^\s*\[\[/.test(lines.at(-1)) || /^\s*\[?\s*$/.test(lines.at(-1)))) lines.pop();
  return choices.split(lines.join('\n')).text.trimEnd();
}

// Reads one run's or turn's stream. read(ev) takes a partial-message line (true: it was one, and is not to be logged
// or read further) and send(text) gets the draft as it changes, at most every EVERY_MS: '' when a draft that was shown
// is gone (a tool call followed it). current() is the draft sent last, end() stops it. The clock is for the tests.
function drafter({ group = false, every = EVERY_MS, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}, send) {
  let text = ''; // the text of the message being written, since its last tool call
  let ended = false; // that message ended its turn
  let sent = ''; // the draft sent last
  let want = ''; // the draft as it is now
  let at = -Infinity; // when the last one went
  let timer = null;
  let over = false;
  const out = () => {
    timer = null;
    if (over || want === sent) return;
    sent = want;
    at = now();
    send(sent);
  };
  const update = () => {
    want = shown(text, { ended, group });
    if (want === sent || timer) return;
    const wait = at + every - now();
    if (wait <= 0) out();
    else { timer = setTimer(out, wait); timer?.unref?.(); }
  };
  return {
    read(ev) {
      if (ev?.type !== 'stream_event') return false;
      const e = ev.event;
      if (over || ev.parent_tool_use_id || !e || typeof e !== 'object') return true; // a helper's text is not the reply
      if (e.type === 'message_start') { text = ''; ended = false; update(); }
      else if (e.type === 'content_block_start' && /tool_use$/.test(e.content_block?.type || '')) { text = ''; update(); }
      else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') { text += e.delta.text; update(); }
      else if (e.type === 'message_delta' && e.delta?.stop_reason === 'end_turn') { ended = true; update(); }
      return true;
    },
    current: () => sent || null,
    end() { over = true; if (timer) clearTimer(timer); timer = null; },
  };
}

module.exports = { EVERY_MS, shown, drafter };
