// A quick answer shows the question it answers (design/answer-context-mockup.html, A): the question picked out of the
// reply (app.js questionOf, checked against the table the Android app is checked against too:
// test/fixtures/answer-question-cases.json), the quote line over the owner's bubble in a bot's chat, and the
// paragraph that asks staying visible when a long reply folds. The page's own code run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const table = require('./fixtures/answer-question-cases.json');
const { read, cut, esc, words, element, finders } = require('./web-page');

const lib = vm.createContext({ ...words });
vm.runInContext(read('unread.js'), lib);

function page(more = {}) {
  const ctx = vm.createContext({ ...words,
    esc, Unread: lib.Unread, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: () => '09:41', dur: () => '2 s',
    notesFoldHTML: () => '', filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '', draftHTML: () => '',
    replyDrafts: { of: () => '' }, escMentions: (t) => esc(t), md: (t) => esc(t), learnedChips: () => '', questionsHTML: () => '',
    choicesHTML: (c) => (c ? `<div class="choices">${c.map(esc).join('|')}</div>` : ''),
    said: (v) => (typeof v === 'string' ? v.trim() : ''), plain: (t) => String(t || ''), OpeningLine: { WAITING: 'Waiting for your OK', ofRun: () => '' },
    state: { keepOpen: null, features: [] }, I18n: { locale: 'en' }, ...more });
  vm.runInContext(`${cut('const QUESTION_WORDS = 12;', '// send(text, key) resolves')}\n${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// "Run now" under the notes that wait')}\nthis.botThreadHTML = botThreadHTML; this.questionOf = questionOf; this.questionParagraph = questionParagraph; this.answerQuoteHTML = answerQuoteHTML;`, ctx);
  return ctx;
}

for (const c of table.questions) {
  test(`web table: ${c.name}`, () => {
    assert.equal(page().questionOf(c.text, c.questions), c.question);
  });
}
for (const c of table.folds) {
  test(`web table: ${c.name}`, () => {
    const kept = [...new Set([0, page().questionParagraph(c.paragraphs)])];
    assert.deepEqual(kept, c.kept);
  });
}

test('web: the quote is a button with the reply arrow and the question, escaped; nothing without a question or a reply', () => {
  const { answerQuoteHTML } = page();
  const html = answerQuoteHTML('Should I <b>post</b> it?', 'r1');
  assert.match(html, /^<button type="button" class="answer-quote" data-answer-of="r1"/);
  assert.match(html, /<svg [^>]*><path d="M9 14L4 9l5-5"\/>/);
  assert.match(html, /<span>Should I &lt;b&gt;post&lt;\/b&gt; it\?<\/span>/);
  assert.equal(answerQuoteHTML('', 'r1'), '');
  assert.equal(answerQuoteHTML('Why?', ''), '');
});

const bot = { id: 'iw', name: 'Issue Writer', color: '#c46' };
const day1 = '2026-11-22T10:00:00.000Z', day2 = '2026-11-23T10:00:00.000Z';
const run = (id, startedAt, more = {}) => ({ id, botId: 'iw', trigger: 'manual', customPrompt: true, status: 'success', prompt: 'Hi', startedAt, endedAt: startedAt, ...more });
const asked = run('q', day1, { result: 'I made two small changes this time. Everything else is in good shape.\n\nShould I post both issues now, or wait until you\'ve looked?', choices: ['Post both', 'Wait'] });

test('web: an answer a day later quotes the question above its bubble, which the reply keeps visible', () => {
  const html = page().botThreadHTML(bot, [asked, run('a', day2, { prompt: 'Wait', answers: 'q', result: 'Waiting.' })]);
  const quote = html.indexOf('data-answer-of="q"'), bubble = html.indexOf('>Wait</div>');
  assert.ok(quote > 0 && quote < bubble, 'the quote stands over the owner\'s bubble');
  assert.match(html, /<span>Should I post both issues now, or wait until you&#39;ve looked\?<\/span>/);
  assert.match(html.slice(html.indexOf('class="md"')), /^class="md" data-asked>/, 'the reply that asked is marked, so a fold keeps its question');
});

test('web: an answer to the reply right above it, the same day, quotes nothing', () => {
  const html = page().botThreadHTML(bot, [asked, run('a', '2026-11-22T10:05:00.000Z', { prompt: 'Wait', answers: 'q', result: 'Waiting.' })]);
  assert.doesNotMatch(html, /answer-quote/);
});

test('web: an answer after another reply quotes its question even on the same day', () => {
  const html = page().botThreadHTML(bot, [asked, run('b', '2026-11-22T10:02:00.000Z', { result: 'Something else.' }), run('a', '2026-11-22T10:05:00.000Z', { prompt: 'Wait', answers: 'q', result: 'Waiting.' })]);
  assert.match(html, /data-answer-of="q"/);
});

test('web: no quote for a card of questions (the questions are in it), a message that answers nothing, or a reply the page does not hold', () => {
  const ctx = page();
  const card = ctx.botThreadHTML(bot, [asked, run('a', day2, { prompt: 'Which one?\n→ Wait', answers: 'q' })]);
  assert.doesNotMatch(card, /answer-quote/);
  assert.doesNotMatch(ctx.botThreadHTML(bot, [asked, run('a', day2, { prompt: 'Wait' })]), /answer-quote/);
  assert.doesNotMatch(ctx.botThreadHTML(bot, [run('a', day2, { prompt: 'Wait', answers: 'gone' })]), /answer-quote/);
});

test('web: a reply that asks stays whole while its question is open', () => {
  const open = page().botThreadHTML({ ...bot, asks: { runId: 'q', text: 'x', at: day1 } }, [asked]);
  assert.match(open, /class="md" data-asks>/);
  assert.doesNotMatch(open, /data-asked/);
});

// A long reply folded (foldLongReplies): paragraphs as elements that hold their text and classes.
function folded(paragraphs, attrs = {}) {
  const children = paragraphs.map((t) => element({}, { textContent: t, children: [] }));
  const md = element({ pre: null }, { textContent: paragraphs.join(' '), children, attrs, hasAttribute: (a) => a in attrs });
  md.insertAdjacentHTML = () => { md.nextElementSibling = element(); };
  const thread = element({ '.run-block .bubble.from-bot:not(.problem) > .md': [md] });
  const ctx = page({ ...finders(thread) });
  ctx.foldLongReplies(thread);
  return { md, children };
}
const long = (t) => t.padEnd(260, ' x');

test('web: a long reply that asked and was answered folds, but the paragraph with its question stays', () => {
  const { md, children } = folded([long('First.'), long('Middle.'), long('Should I post both?'), long('Last.')], { 'data-asked': '' });
  assert.ok(md.classList.contains('long'));
  assert.deepEqual(children.map((c) => c.classList.contains('keep')), [false, false, true, false]);
});

test('web: a long reply that asks now is never folded; one that never asked folds to its first paragraph', () => {
  assert.equal(folded([long('First.'), long('Should I?'), long('Last.')], { 'data-asks': '' }).md.classList.contains('long'), false);
  const plain = folded([long('First.'), long('Should I?'), long('Last.')]);
  assert.ok(plain.md.classList.contains('long'));
  assert.deepEqual(plain.children.map((c) => c.classList.contains('keep')), [false, false, false]);
});
