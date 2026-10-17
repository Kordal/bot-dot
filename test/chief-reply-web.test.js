// A Chief reply on the web page (QW-001): chiefBubble and actionChip cut out of public/app.js and run with
// the page's own Markdown and ratings. A reply that failed after writing shows its text and the problem in a
// block of its own; an empty reply shows no words the Chief did not write; a chip says what waits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc } = require('./web-page');

const css = read('style.css');
const state = { features: ['chief', 'unread', 'ratings'], bots: [{ id: 'news', name: 'News Watcher', computer: 'none' }, { id: 'coder', name: 'Coder', computer: 'linux' }], runs: [{ id: 'r1', botId: 'coder' }] };
const page = vm.createContext({
  esc, state, CHIEF_COLOR: '#d85a30',
  msgTime: () => '09:12', copyBtn: (t) => `<copy:${t}>`,
  choicesHTML: (c) => (c?.length ? '<choices>' : ''), questionsHTML: (q) => (q?.length ? '<questions>' : ''),
});
vm.runInContext(read('unread.js'), page);
vm.runInContext(read('ratings.js'), page);
vm.runInContext(`${cut('function md(src)', '// Link bare web addresses after rendering')}
  ${cut('function actionBot(a)', '// What Approve sends to answer')}
  this.chiefBubble = chiefBubble; this.actionChip = actionChip;`, page);
const { chiefBubble, actionChip } = page;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const bubble = (html) => html.match(/<div class="bubble from-bot([^"]*)">([\s\S]*?)<\/div>\s*<div class="actions">/);
const at = '2026-10-05T09:12:00Z';

test('web: a reply with text and error shows the text and, under it in the same bubble, the error in a block of its own', () => {
  const html = chiefBubble({ role: 'chief', text: 'Mail Sorter is set up. I was starting on Mail Writer.', error: 'I couldn\'t finish: Claude is signed out on the botdot server.', at, actions: [{ kind: 'created', text: 'Created Mail Sorter', botId: 'm1' }] });
  const [, classes, body] = bubble(html);
  assert.doesNotMatch(classes, /problem/, 'the bubble itself is an ordinary reply');
  assert.match(body, /^<div class="md"><p>Mail Sorter is set up\. I was starting on Mail Writer\.<\/p><\/div><div class="problem-line"><div class="md"><p>I couldn&#39;t finish: Claude is signed out on the botdot server\.<\/p><\/div><\/div>$/);
  assert.match(html, /Created Mail Sorter/, 'its chips as before');
  assert.match(html, /<copy:Mail Sorter is set up\. I was starting on Mail Writer\.>/, 'Copy copies what the Chief wrote');
});

test('web: the block is in the warning colour, like the problem bubble', () => {
  assert.match(css, /\.problem-line \{[^}]*background: var\(--warn-soft\)/);
  assert.match(css, /\.bubble\.from-bot\.problem \{ background: var\(--warn-soft\)/);
});

test('web: a reply with error only is the problem bubble it was', () => {
  const html = chiefBubble({ role: 'chief', text: '', error: 'Claude is signed out. Sign in under Settings.', at });
  const [, classes, body] = bubble(html);
  assert.match(classes, /\bproblem\b/);
  assert.equal(body, '<div class="md"><p>Claude is signed out. Sign in under Settings.</p></div>');
  assert.doesNotMatch(html, /problem-line/);
  assert.match(html, /<copy:Claude is signed out\. Sign in under Settings\.>/);
});

test('web: a reply with neither text nor error shows no bubble and no "Done."; its chips show', () => {
  const html = chiefBubble({ role: 'chief', text: '', at, actions: [{ kind: 'run', text: 'Started Fleet Doctor · Disk check', botId: 'f1' }] });
  assert.doesNotMatch(html, /class="bubble from-bot/);
  assert.equal(text(html), '→ Started Fleet Doctor · Disk check');
  assert.doesNotMatch(html, /bubble-meta/, 'nothing to copy');
  assert.equal(text(chiefBubble({ role: 'chief', at })), '', 'a server that sends no text at all');
  assert.doesNotMatch(cut('function chiefBubble(m', '// What Approve sends to answer'), /Done\./);
});

test('web: an ordinary reply is as before; one being written is no bubble, only its chips: the working line says the rest', () => {
  const [, classes, body] = bubble(chiefBubble({ role: 'chief', text: 'Two bots ran: **News Watcher** and Fleet Doctor.', at }, true));
  assert.equal(classes.trim(), '');
  assert.equal(body, '<div class="md"><p>Two bots ran: <strong>News Watcher</strong> and Fleet Doctor.</p></div>');
  const live = chiefBubble({ pending: true, activity: { tool: 'thinking', text: 'Thinking' } });
  assert.equal(bubble(live), null, 'no bubble');
  assert.doesNotMatch(live, /Thinking|typing|live-line|bubble-meta/, 'test/chief-line-web.test.js: the line under the chat says it');
  assert.match(live, /<div class="bubble-row from-bot" data-pending>/, 'the row the reply takes when it is done');
  assert.equal(text(chiefBubble({ pending: true, actions: [{ kind: 'run', text: 'Asked Web Surfer', botId: 'news' }] })), '→ Asked Web Surfer');
  assert.match(css, /\[data-pending\]:not\(:has\(\.action-chip\)\) \{ display: none; \}/, 'a row without a chip takes no room');
  assert.match(chiefBubble({ role: 'chief', text: 'Which one?', at, choices: ['A', 'B'] }, true), /<choices>/);
});

test('web: nothing the Chief or the server wrote is markup, in the text or in the problem', () => {
  const html = chiefBubble({ role: 'chief', text: '<img src=x onerror=1>', error: '<script>alert(1)</script>', at, actions: [{ kind: 'created', text: '<b>x</b>', waits: '<i>web</i> waits' }] });
  assert.doesNotMatch(html.replace(/<copy:[^>]*>/g, ''), /<img|<script|<b>|<i>web/);
});

test('web: a bot\'s run with no reply still reads "Done. (No written reply.)": its chat is not part of this', () => {
  assert.equal((app.match(/'Done\. \(No written reply\.\)'/g) || []).length, 2, 'in its chat and in the run\'s details');
});

test('web: a chip whose action waits says so after its text, in the warning colour', () => {
  const html = actionChip({ kind: 'created', text: 'Created News Watcher', botId: 'news', waits: 'web access waits for your OK' });
  assert.match(html, /^<button class="action-chip" data-kind="created" data-bot="news" >✨ Created News Watcher · <span class="waits">web access waits for your OK<\/span><\/button>$/);
  assert.match(css, /\.action-chip \.waits \{ color: var\(--warn-text\); \}/);
});

test('web: a chip without it is as before, also from a server that sends something else there', () => {
  const plain = '<button class="action-chip" data-kind="created" data-bot="news" >✨ Created News Watcher</button>';
  assert.equal(actionChip({ kind: 'created', text: 'Created News Watcher', botId: 'news' }), plain);
  for (const waits of ['', '   ', null, true, 3, ['x'], { text: 'x' }]) assert.equal(actionChip({ kind: 'created', text: 'Created News Watcher', botId: 'news', waits }), plain, JSON.stringify(waits));
});

test('web: a chip of a run on a computer keeps its way to the live screen, after what waits', () => {
  assert.match(actionChip({ kind: 'run', text: 'Started Coder', runId: 'r1', waits: 'a login waits for your OK' }), /→ Started Coder · <span class="waits">a login waits for your OK<\/span> · View live screen<\/button>$/);
});
