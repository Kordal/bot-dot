// Notes that wake a bot (#225), on the web page: the page's own code for a bot's chat, cut out of public/app.js and
// run against stand-ins. The notes that wait show how long the oldest has waited and "Run now" (from a botdot that
// announces `notes-wake`); a run the notes woke shows only the notes it read above its reply, never botdot's task
// as the owner's message; and "Messaged …" says a note is read when the bot is free.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, noDrafts } = require('./web-page');

const notes = [
  { fromId: 'ia', from: 'Infra Admin', color: '#d85a30', text: 'Add my key to authorized_keys on the OVH server.', at: '2026-10-21T06:00:00.000Z' },
  { fromId: 'ia', from: 'Infra Admin', color: '#d85a30', text: '<b>Still waiting</b>', at: '2026-10-21T07:00:00.000Z' },
];

function page(features) {
  const ctx = vm.createContext({ esc, state: { features }, botLabel: (b) => esc(b?.name || ''), msgTime: (at) => `t(${at})`, ago: (at) => `ago(${at})` });
  vm.runInContext(`${cut('function notesFoldHTML(notes, heading, foot = \'\') {', '// A run\'s bot:')}\nthis.waitingNotesHTML = waitingNotesHTML; this.notesFoldHTML = notesFoldHTML;`, ctx);
  return ctx;
}

test('web: the notes that wait say how long the oldest has waited, with "Run now"', () => {
  const html = page(['notes-wake']).waitingNotesHTML('qm', notes);
  assert.match(html, /<summary>Notes waiting: Infra Admin<\/summary>/);
  assert.match(html, /<div class="bubble-meta"><span>Oldest ago\(2026-10-21T06:00:00\.000Z\)<\/span> · <button data-run-notes="qm">Run now<\/button><\/div>/);
  assert.doesNotMatch(html, /<b>Still/, 'no markup');
  assert.equal(page(['notes-wake']).waitingNotesHTML('qm', []), '', 'nothing waits: nothing is drawn');
  // A botdot from before wakes nobody and has no "Run now": the age stays.
  const old = page([]).waitingNotesHTML('qm', notes);
  assert.match(old, /Oldest ago/);
  assert.doesNotMatch(old, /Run now/);
  // The notes a run read are drawn as before, with no line under them.
  assert.doesNotMatch(page(['notes-wake']).notesFoldHTML(notes, 'Read notes from'), /bubble-meta|notes-wait/);
});

test('web: "Run now" asks botdot to start the bot with its notes', () => {
  const src = cut('async function runNotes(botId, btn) {', '// The notes other bots left for a bot');
  assert.match(src, /api\(`\/bots\/\$\{encodeURIComponent\(botId\)\}\/inbox\/run`, \{ method: 'POST' \}\)/);
  assert.match(cut('function renderBotChat(', '// ---------- '), /\$\$\('\[data-run-notes\]', thread\)\.forEach\(\(el\) => \(el\.onclick = \(\) => runNotes\(el\.dataset\.runNotes, el\)\)\);/);
});

function chat() {
  const lib = vm.createContext({});
  vm.runInContext(read('unread.js'), lib);
  const ctx = vm.createContext({ ...noDrafts,
    esc, Unread: lib.Unread, state: { keepOpen: null }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: (at) => `t(${at})`, dur: () => '2 s',
    notesFoldHTML: (list, heading) => (list?.length ? `<notes ${heading}>` : ''), filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '<copy>',
    escMentions: (t) => esc(t), md: (t) => esc(t), friendlyProblem: () => '', learnedChips: () => '', choicesHTML: () => '', questionsHTML: () => '',
  });
  vm.runInContext(`${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// "Run now" under the notes that wait')}\nthis.botThreadHTML = botThreadHTML; this.messagedLabel = messagedLabel;`, ctx);
  return ctx;
}
const bot = { id: 'qm', name: 'Quotz Migration', color: '#1d9e75' };
const woken = { id: 'r1', botId: 'qm', trigger: 'bot', prompt: 'Read the messages your teammates left for you (below) and act on what they ask.', customPrompt: true, inbox: notes, status: 'success', result: 'Key added.', startedAt: '2026-10-21T07:01:00.000Z', endedAt: '2026-10-21T07:02:00.000Z' };

test('web: a run its notes woke shows the notes it read and its reply, not botdot\'s task as yours', () => {
  const html = chat().botThreadHTML(bot, [woken]);
  assert.match(html, /<notes Read notes from>/);
  assert.match(html, /Key added\./);
  assert.doesNotMatch(html, /Read the messages your teammates|bubble from-me|Ran its main assignment/);
});

test('web: "Messaged …" says a note is read when the bot is free', () => {
  const c = chat();
  assert.match(c.messagedLabel({ sentToAll: [{ id: 'qm', name: 'Quotz Migration', delivered: 'inbox' }] }), /Messaged Quotz Migration · a note it reads when free</);
  assert.match(c.messagedLabel({ sentToAll: [{ id: 'qm', name: 'Quotz Migration', delivered: 'inbox' }, { id: 'ia', name: 'Infra Admin', delivered: 'inbox' }] }), / · a note they read when free</);
  assert.doesNotMatch(c.messagedLabel({ sentToAll: [{ id: 'qm', name: 'Quotz Migration', delivered: 'inbox' }] }), /next run/);
});
