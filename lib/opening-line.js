// A working bot's opening line: the one short line a bot or the Chief may write before work that uses
// tools ("Checking the weather in Brussels."). It is read from Claude Code's event stream and kept for
// the running run only: never in the stored run, the chat or a notification.
//
// The line is the first text that comes before the run's first tool call. Text with no tool call after
// it is the reply, not a line, so nothing is a line until that first tool call is seen. Text after it
// is never one.

const MAX = 120;

// The line as plain text, so that no app has to tidy it: one line, without Markdown's marks (emphasis,
// code, a link's address, a heading's #), its first 120 characters, without the full stop or ellipsis it
// ends with (the apps draw their own ellipsis after it). '' when nothing is left.
function clean(text) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]+/g, '').replace(/^\s*#+\s+/, '').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, MAX).join('').replace(/[\s.…]+$/u, '');
}

// Reads one run's stream. read(event) gives the line once, with the event that holds the run's first
// tool call, and null for every other event.
function reader() {
  let said = null; // the first text so far
  let closed = false; // the first tool call was seen
  return {
    read(ev) {
      if (closed || ev?.type !== 'assistant' || ev.parent_tool_use_id) return null;
      for (const c of ev.message?.content || []) {
        if (c.type === 'text' && said === null && typeof c.text === 'string' && c.text.trim()) said = c.text;
        if (c.type === 'tool_use') {
          closed = true;
          return (said !== null && clean(said)) || null;
        }
      }
      return null;
    },
  };
}

module.exports = { MAX, clean, reader };
