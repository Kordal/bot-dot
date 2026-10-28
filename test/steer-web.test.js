// What the owner steered into a run (#173, ADR 040), on the web page: the page's own code for a bot's chat, cut out
// of public/app.js and run against stand-ins. Each message the run read stands after the run's request, as the
// owner's bubble, with "Steered" and its time and no buttons, before the reply; the feed's `run_steered` reads
// the runs again. Steer under a waiting message is in test/message-waits-web.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, noDrafts } = require('./web-page');

function chat() {
  const lib = vm.createContext({});
  vm.runInContext(read('unread.js'), lib);
  const ctx = vm.createContext({ ...noDrafts,
    esc, Unread: lib.Unread, state: { keepOpen: null, features: [] }, OpeningLine: { WAITING: 'Waiting for your OK', ofRun: () => '' }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: (at) => `t(${at})`, dur: () => '2 s',
    notesFoldHTML: () => '', filesHTML: (list) => (list?.length ? `<files ${list.map((f) => f.name).join(',')}>` : ''), botFilesHTML: () => '', copyBtn: () => '<copy>',
    escMentions: (t) => esc(t), md: (t) => esc(t), friendlyProblem: () => '', learnedChips: () => '', choicesHTML: () => '', questionsHTML: () => '',
  });
  vm.runInContext(`${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// The notes other bots left for a bot')}\nthis.botThreadHTML = botThreadHTML;`, ctx);
  return ctx;
}
const bot = { id: 'bm', name: 'Buildr Migrator', color: '#1d9e75' };
const run = (more) => ({ id: 'r1', botId: 'bm', trigger: 'manual', prompt: 'Move the build to staging-vm', customPrompt: true, status: 'success', result: 'Moved.', startedAt: '2026-10-20T10:00:00.000Z', endedAt: '2026-10-20T10:05:00.000Z', ...more });
const steered = [
  { id: 'q1', text: 'staging-vm access mozesz dostac od Homelab Admin', attachments: [{ name: 'where.txt', file: 'uploads/where.txt' }], at: '2026-10-20T10:01:00.000Z', readAt: '2026-10-20T10:02:00.000Z' },
  { id: 'q2', text: '<b>and port 2222</b>', attachments: [], at: '2026-10-20T10:03:00.000Z', readAt: '2026-10-20T10:03:30.000Z' },
];

test('web: the messages a run read stand after its request, in order, as the owner\'s, without buttons, before the reply', () => {
  const html = chat().botThreadHTML(bot, [run({ steered })]);
  const at = (s) => html.indexOf(s);
  assert.ok(at('Move the build to staging-vm') < at('staging-vm access mozesz') && at('staging-vm access mozesz') < at('&lt;b&gt;and port 2222') && at('&lt;b&gt;and port 2222') < at('Moved.'));
  assert.match(html, /<div class="bubble-row from-me"><div class="stack mine"><div class="bubble from-me" data-expand><div class="clamp">staging-vm access mozesz dostac od Homelab Admin<\/div><files where\.txt><\/div><div class="bubble-meta on-hover"><span>Steered · t\(2026-10-20T10:01:00\.000Z\)<\/span><copy><\/div><\/div><\/div>/);
  assert.doesNotMatch(html, /<b>and port/, 'no markup');
  assert.doesNotMatch(html, /data-take-back|data-steer|waits/);
  // While the run is still going, they stand there too.
  const going = chat().botThreadHTML(bot, [run({ status: 'running', result: null, steered: steered.slice(0, 1) })]);
  assert.match(going, /Steered · /);
  // A run without them, or with something that is no list, is drawn as before.
  for (const none of [undefined, null, 'x']) assert.doesNotMatch(chat().botThreadHTML(bot, [run({ steered: none })]), /Steered/);
});

test('web: the feed\'s `run_steered` reads the runs again', () => {
  assert.match(cut('function followFeed()', '// ---------- boot ----------'), /es\.addEventListener\('run_steered', soon\);/);
});

test('web: in a Chief chat the messages a reply read stand before it, as the owner\'s, with "Steered" and no buttons', () => {
  const ctx = vm.createContext({ ...noDrafts,
    esc, state: { chatId: 'c1' }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, msgTime: (at) => `t(${at})`, copyBtn: () => '<copy>', escMentions: (t) => esc(t),
    filesHTML: (list) => (list?.length ? `<files ${list.map((f) => f.name).join(',')}>` : ''),
    userBubble: (m) => `<user ${esc(m.text)}>`, suggestionBubble: () => '', reportBubble: () => '', chiefBubble: (m) => `<chief ${esc(m.text)}>`,
  });
  vm.runInContext(`${cut('const messageHTML = ', 'function wireActions(root)')}\nthis.messageHTML = messageHTML;`, ctx);
  const all = [{ role: 'user', text: 'Plan my week' }, { role: 'chief', text: 'Done.', steered }];
  const html = all.map((m, i) => ctx.messageHTML(m, i, all)).join('');
  const at = (x) => html.indexOf(x);
  assert.ok(at('<user Plan my week>') < at('staging-vm access') && at('staging-vm access') < at('&lt;b&gt;and port 2222') && at('&lt;b&gt;and port 2222') < at('<chief Done.>'));
  assert.match(html, /<div class="bubble-row from-me" data-steered><div class="stack mine"><div class="bubble from-me">staging-vm access mozesz dostac od Homelab Admin<files where\.txt><\/div><div class="bubble-meta on-hover"><span>Steered · t\(2026-10-20T10:01:00\.000Z\)<\/span><copy><\/div><\/div><\/div>/);
  assert.doesNotMatch(html, /<b>and port|data-take-back|data-steer=/);
  for (const none of [undefined, null, 'x']) assert.equal(ctx.messageHTML({ role: 'chief', text: 'Hi', steered: none }, 0, [{}]), '<chief Hi>');
});

test('web: the Chief\'s stream says when its reply read a steered message, and the page draws them before that reply', () => {
  const follow = cut('function followChief(id) {', '    } else if (ev.type === \'file\') {');
  assert.match(follow, /ev\.type === 'steered'/);
  assert.match(follow, /row\.insertAdjacentHTML\('beforebegin', steeredBubbles\(ev\.steered\)\)/);
});
