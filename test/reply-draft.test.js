// The reply draft (lib/reply-draft.js, docs/api.md "The reply draft", ADR 041): the reply as the model writes it,
// read from Claude Code's partial messages, sent to who follows the run while it is written. Only the reply: never
// the opening line, text before a tool call, a marker line or a pass. At most one draft every 200 ms.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { drafter, shown, EVERY_MS } = require('../lib/reply-draft');
const openingLine = require('../lib/opening-line');

// Claude Code's partial-message lines (--include-partial-messages with stream-json).
const se = (event, extra = {}) => ({ type: 'stream_event', event, session_id: 's', parent_tool_use_id: null, ...extra });
const start = () => se({ type: 'message_start', message: { role: 'assistant', content: [] } });
const textBlock = (index = 0) => se({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
const delta = (text, index = 0) => se({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } });
const stop = (index = 0) => se({ type: 'content_block_stop', index });
const toolBlock = (index = 1) => se({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: 't', name: 'Bash', input: {} } });
const endTurn = () => se({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
const toolTurn = () => se({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });

// A drafter on a clock the test moves: what it sent, and when.
function clocked(opts = {}) {
  let now = 0;
  const timers = [];
  const sent = [];
  const d = drafter({ ...opts, now: () => now, setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } }, (text) => sent.push({ at: now, text }));
  const tick = (ms) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > until) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = until;
  };
  return { d, sent, tick, texts: () => sent.map((s) => s.text) };
}
// Feed a text in deltas of `size` characters, `ms` apart.
function write(c, text, { size = 5, ms = 30 } = {}) {
  for (let i = 0; i < text.length; i += size) { c.d.read(delta(text.slice(i, i + size))); c.tick(ms); }
}

const REPLY = '## Dysk\n\nWolne miejsce na **local-lvm**: 41%.\n\n| Host | Wolne |\n|---|---|\n| pve | 41% |\n\nTo wszystko.';

test('a reply in deltas: the drafts grow, the last is the reply, and they come at least 200 ms apart', () => {
  const c = clocked();
  for (const ev of [start(), textBlock()]) assert.equal(c.d.read(ev), true, 'a partial line is the drafter\'s');
  write(c, REPLY);
  c.d.read(stop()); c.d.read(endTurn()); c.tick(1000);
  const texts = c.texts();
  assert.ok(texts.length >= 3, 'several drafts');
  for (let i = 1; i < texts.length; i++) assert.ok(texts[i].startsWith(texts[i - 1].trimEnd()), `draft ${i} grows from the one before`);
  assert.equal(texts.at(-1), REPLY);
  assert.equal(c.d.current(), REPLY);
  for (let i = 1; i < c.sent.length; i++) assert.ok(c.sent[i].at - c.sent[i - 1].at >= EVERY_MS, `${c.sent[i].at - c.sent[i - 1].at} ms apart`);
  assert.equal(EVERY_MS, 200);
});

test('the newest text waits for its 200 ms and then goes out: none is lost, none sent twice', () => {
  const c = clocked();
  c.d.read(start()); c.d.read(textBlock());
  c.d.read(delta('First line.\nSecond'));
  assert.deepEqual(c.texts(), ['First line.\nSecond']);
  c.d.read(delta('More')); c.d.read(delta(' words'));
  c.tick(199);
  assert.equal(c.sent.length, 1, 'not before its time');
  c.tick(1);
  assert.deepEqual(c.texts().at(-1), 'First line.\nSecondMore words');
  c.tick(1000);
  assert.equal(c.sent.length, 2);
  c.d.end();
  c.d.read(delta(' after the end'));
  c.tick(1000);
  assert.equal(c.sent.length, 2, 'nothing after the end');
});

test('one short line is held: it may be the opening line, until it is longer, breaks or its message ends', () => {
  const held = clocked();
  held.d.read(start()); held.d.read(textBlock());
  write(held, 'Checking the weather in Brussels.');
  held.d.read(stop()); held.d.read(toolBlock()); held.tick(1000);
  assert.deepEqual(held.texts(), [], 'the opening line never shows as a draft');

  const longer = clocked();
  longer.d.read(start()); longer.d.read(textBlock());
  write(longer, 'x'.repeat(openingLine.MAX), { size: 20 });
  assert.deepEqual(longer.texts(), [], `${openingLine.MAX} characters: still held`);
  write(longer, 'y'); longer.tick(500);
  assert.equal(longer.texts().at(-1), `${'x'.repeat(openingLine.MAX)}y`);

  const broke = clocked();
  broke.d.read(start()); broke.d.read(textBlock());
  write(broke, 'Short.\n'); broke.tick(500);
  assert.deepEqual(broke.texts(), [], 'a line break with nothing after it is still one line');
  write(broke, 'Next'); broke.tick(500);
  assert.equal(broke.texts().at(-1), 'Short.\nNext');

  const ended = clocked();
  ended.d.read(start()); ended.d.read(textBlock());
  write(ended, 'Yes, it is sunny.');
  ended.d.read(stop()); ended.tick(500);
  assert.deepEqual(ended.texts(), []);
  ended.d.read(endTurn()); ended.tick(500);
  assert.deepEqual(ended.texts(), ['Yes, it is sunny.'], 'a short reply shows once its message ends');
});

test('a tool call clears the draft: the next draft holds only text written after it', () => {
  const c = clocked();
  c.d.read(start()); c.d.read(textBlock());
  const interim = `I will look at three things first, the disk, the backups and the certificate, then report. ${'More words. '.repeat(5)}`;
  write(c, interim, { size: 40 }); c.tick(500);
  assert.equal(c.texts().at(-1), interim.trimEnd(), 'interim talk longer than a line is shown');
  c.d.read(stop()); c.d.read(toolBlock()); c.tick(500);
  assert.equal(c.texts().at(-1), '', 'and cleared at the tool call');
  c.d.read(toolTurn());
  c.d.read(start()); c.d.read(textBlock());
  write(c, 'The disk has 41% free.\nThe backups ran.'); c.tick(500);
  assert.equal(c.texts().at(-1), 'The disk has 41% free.\nThe backups ran.');
  assert.ok(c.texts().slice(c.texts().indexOf('') + 1).every((t) => !t.includes('three things')));
});

test('a marker line never shows, not even its first characters', () => {
  const body = 'Should I send the email to the team now?\nIt is ready.';
  for (const tail of ['\n[[choices: Yes | No]]', '\n[[ask: Which account?]]\n[[ask: Which time?]]']) {
    const c = clocked();
    c.d.read(start()); c.d.read(textBlock());
    write(c, body + tail, { size: 1, ms: 10 });
    c.d.read(stop()); c.d.read(endTurn()); c.tick(1000);
    assert.ok(c.texts().length > 1);
    for (const t of c.texts()) assert.doesNotMatch(t, /\[|choices|ask:/, JSON.stringify(t));
    assert.equal(c.texts().at(-1), body);
  }
  assert.equal(shown('Text.\nMore text here.\n[', {}), 'Text.\nMore text here.');
  assert.equal(shown('Text.\nMore text here.\n[[cho', {}), 'Text.\nMore text here.');
  assert.equal(shown('Text.\nMore text here.\n[link](https://x', {}), 'Text.\nMore text here.\n[link](https://x', 'one [ is a link, not a marker');
});

test('in a group, a pass shows nothing: PASS, **PASS**, pass.', () => {
  for (const reply of ['PASS', '**PASS**', 'pass.', ' Pass! ']) {
    const c = clocked({ group: true });
    c.d.read(start()); c.d.read(textBlock());
    write(c, reply, { size: 1, ms: 300 });
    c.d.read(stop()); c.d.read(endTurn()); c.tick(1000);
    assert.deepEqual(c.texts(), [], reply);
  }
  const c = clocked({ group: true });
  c.d.read(start()); c.d.read(textBlock());
  write(c, 'Passing it on: the tests are green.');
  c.d.read(endTurn()); c.tick(1000);
  assert.equal(c.texts().at(-1), 'Passing it on: the tests are green.', 'a reply that starts like the word is a reply');
  assert.equal(shown('PASS', { ended: true }), 'PASS', 'outside a group it is a word like any');
});

test("a helper's text inside a tool call, thinking and other lines are not the reply", () => {
  const c = clocked();
  c.d.read(start()); c.d.read(textBlock());
  c.d.read(se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A helper writes a long line.\nAnd more.' } }, { parent_tool_use_id: 'x' }));
  c.d.read(se({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hm.\nLet me think about this for a while.' } }));
  c.tick(1000);
  assert.deepEqual(c.texts(), []);
  for (const ev of [null, undefined, {}, { type: 'assistant' }, { type: 'result', result: 'x' }]) assert.equal(c.d.read(ev), false, 'not a partial line');
  for (const ev of [se(null), se({}), se({ type: 'content_block_delta' }), se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 7 } })]) assert.equal(c.d.read(ev), true);
});
