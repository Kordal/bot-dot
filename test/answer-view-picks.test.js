// Several quizzes or polls in one view (ADR 265, amendment): a tap picks, one Send posts every pick, one line to a question. The
// page's own code runs here over a few stand-in elements; the rules of the text are the shared fixture's (test/answer-view.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc, words } = require('./web-page');

const catalog = require('../lib/ui-catalog.json');

// A page with a document that keeps the listeners it is given, and a few elements that find each other by simple selectors.
function stage() {
  const listeners = {};
  const document = { addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), hidden: false };
  const matches = (el, sel) => {
    if (/\s/.test(sel)) return false;
    const m = /^((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(sel);
    if (!m) return false;
    if (m[1] && !m[1].slice(1).split('.').every((c) => el.classes.includes(c))) return false;
    if (m[2]) { const key = m[2].replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase()); const v = m[2].startsWith('data-') ? el.dataset[key] : el.attrs[m[2]]; if (v === undefined || (m[3] !== undefined && v !== m[3])) return false; }
    return true;
  };
  const all = (el) => el.kids.flatMap((k) => [k, ...all(k)]);
  const find = (sel, root) => all(root).filter((el) => sel.split(', ').some((s) => matches(el, s)));
  const make = (classes = [], dataset = {}, kids = []) => {
    const el = {
      classes, dataset, attrs: {}, classList: { contains: (c) => classes.includes(c) }, kids, parentElement: null, disabled: false, hidden: false, textContent: '',
      setAttribute(k, v) { el.attrs[k] = String(v); },
      removeAttribute(k) { delete el.attrs[k]; },
      hasAttribute: (k) => (k.startsWith('data-') ? el.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] !== undefined : k in el.attrs),
      closest(sel) { for (let e = el; e; e = e.parentElement) if (matches(e, sel)) return e; return null; },
    };
    kids.forEach((k) => { k.parentElement = el; });
    return el;
  };
  const page = vm.createContext({
    ...words, esc, URL, JSON, document, linkPaths: (html) => html, FILE_ICON: '<svg></svg>', wireCharts() {}, messageKey: () => 'key-1',
    $$: (sel, root) => find(sel, root), $: (sel, root) => find(sel, root)[0] || null,
  });
  vm.runInContext(`${read('answer-view.js')}\n${read('answer-text.js')}\n${read('answer-view-draw.js')}\nthis.AnswerViews = AnswerViews;`, page);
  page.AnswerViews.use(catalog);
  const click = (target) => listeners.click.forEach((fn) => fn({ target }));
  return { page, make, click };
}

const QUESTIONS = [
  { type: 'quiz', question: 'Capital of Poland?', options: ['Kraków', 'Warsaw'], answer: 1, explain: 'Since 1596.' },
  { type: 'poll', question: 'Pick a day:', options: ['Monday', 'Tuesday'] },
  { type: 'quiz', question: 'Largest planet?', options: ['Mars', 'Jupiter'], answer: 1 },
];

// The view's HTML as the page draws it, and the same view as stand-in elements.
function drawn(root) {
  const { page, make, click } = stage();
  const html = page.AnswerViews.html({ alt: 'Questions', root: JSON.parse(JSON.stringify(root)) }, 'shopper');
  const key = /data-av="([a-z0-9]+)"/.exec(html)[1];
  const boxes = [];
  root.children.forEach((q, i) => {
    const choices = q.options.map((o, j) => make(['av-btn'], { avPress: `0.${i}.${j}`, say: o }));
    boxes.push({ q, choices, el: make(['av-poll'], { avPoll: `0.${i}`, q: q.question, ...(q.type === 'quiz' ? { correct: q.options[q.answer], ...(q.explain ? { explain: q.explain } : {}) } : {}) }, [...choices, ...(q.type === 'quiz' ? [make(['av-reveal'])] : [])]) });
  });
  const send = make(['av-send'], { avSend: '' });
  send.disabled = true;
  const line = make(['av-sent']);
  const av = make(['av'], { av: key, avAct: 'picks', avState: 'open' }, [...boxes.map((b) => b.el), send, line]);
  const posted = [];
  const chat = make(['chat'], {}, [make(['bubble', 'from-bot'], {}, [av])]); // the newest message of a bot
  page.AnswerViews.wireChat(chat, async (text, k) => { posted.push([text, k]); return true; });
  return { html, av, boxes, send, line, click, posted, page };
}

const VIEW = { type: 'stack', children: QUESTIONS };

test('a view of several quizzes and polls with no form is one to pick in: its Send waits, and its choices are pressed or not', () => {
  const { html } = drawn(VIEW);
  assert.match(html, /data-av-act="picks"/);
  assert.match(html, /<div class="av-actions"><button type="button" class="btn primary av-send" data-av-send disabled>Send<\/button><\/div>/);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 6, 'every choice is a toggle that is not pressed yet');
  assert.match(html, /data-av-poll="0\.0" data-q="Capital of Poland\?"/);
});

test('one quiz alone is still sent by its tap, and a form around quizzes keeps its own Send', () => {
  const { page } = stage();
  const html = (root) => page.AnswerViews.html({ alt: 'A', root }, 'shopper');
  const one = html({ type: 'quiz', question: 'Q?', options: ['A', 'B'], answer: 0 });
  assert.match(one, /data-av-act="press"/);
  assert.doesNotMatch(one, /av-send|aria-pressed/);
  const form = html({ type: 'stack', children: [{ type: 'text-input', label: 'Name' }, QUESTIONS[0], QUESTIONS[1]] });
  assert.match(form, /data-av-act="form"/);
  assert.doesNotMatch(form, /aria-pressed/);
});

test('a tap picks and can be changed; Send is enabled once every question has a pick, and posts all of them as lines', async () => {
  const v = drawn(VIEW);
  const [a, b, c] = v.boxes;
  const pressed = (box) => box.choices.map((x) => x.attrs['aria-pressed']);
  v.click(a.choices[0]);
  assert.deepEqual(pressed(a), ['true', 'false'], 'the pick is marked as pressed');
  assert.equal(v.send.disabled, true, 'two questions have none');
  assert.deepEqual(v.posted, [], 'a tap sends nothing');
  v.click(a.choices[1]);
  assert.deepEqual(pressed(a), ['false', 'true'], 'a pick can be changed');
  v.click(b.choices[1]);
  assert.equal(v.send.disabled, true);
  v.click(c.choices[1]);
  assert.equal(v.send.disabled, false, 'every question has a pick');
  v.click(v.send);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(v.posted, [['Capital of Poland? Warsaw\nPick a day: Tuesday\nLargest planet? Jupiter', 'key-1']]);
});

test('after the send each quiz says whether its own pick was right, and what was sent is recognised as the view\'s send', () => {
  const v = drawn(VIEW);
  const [a, b, c] = v.boxes;
  const said = 'Capital of Poland? Kraków\nPick a day: Tuesday\nLargest planet? Jupiter';
  v.page.AnswerViews.mark(v.av, { state: 'sent', said });
  const reveal = (box) => box.el.kids.find((k) => k.classes.includes('av-reveal'));
  assert.equal(reveal(a).textContent, 'Not quite. The answer is Warsaw. Since 1596.');
  assert.deepEqual(a.choices.map((x) => [x.attrs['aria-pressed'], x.attrs['data-result']]), [['true', 'wrong'], ['false', 'right']]);
  assert.equal(reveal(c).textContent, 'Correct.');
  assert.deepEqual(c.choices.map((x) => [x.attrs['aria-pressed'], x.attrs['data-result']]), [['false', undefined], ['true', 'right']]);
  assert.deepEqual(b.choices.map((x) => x.attrs['aria-pressed']), ['false', 'true'], 'a poll marks its pick and says nothing of right or wrong');
  // the owner's next message is the send of the view when it has a line for every question, and a lone choice is not
  const labels = QUESTIONS.map((q) => q.question);
  assert.equal(v.page.AnswerViews.sentFrom(said, { labels }), said);
  assert.equal(v.page.AnswerViews.sentFrom('Capital of Poland? Kraków', { labels }), null, 'a question is missing');
  assert.equal(v.page.AnswerViews.sentFrom('Warsaw', { says: [], labels }), null);
});

test('a form\'s lines read "Label: value", and "Label? value" when the label ends in a mark; a send in the older way still reads as sent', () => {
  const { page } = stage();
  assert.equal(page.AnswerText.said('Budget', '500'), 'Budget: 500');
  for (const mark of ['?', ':', '.', '!']) assert.equal(page.AnswerText.said(`Label${mark}`, 'x'), `Label${mark} x`);
  const sent = (text, labels) => page.AnswerViews.sentFrom(text, { labels });
  assert.equal(sent('How was your energy this week? 8', ['How was your energy this week?']), 'How was your energy this week? 8');
  assert.equal(sent('How was your energy this week?: 8', ['How was your energy this week?']), 'How was your energy this week?: 8', 'a view sent before this change is still sent');
  assert.equal(sent('Budget: 500', ['Budget']), 'Budget: 500');
  assert.equal(sent('Budget 500', ['Budget']), null, 'a label with no mark needs its colon');
  assert.equal(sent('Name? Ada', ['Name']), null);
  // the send-back also finds the settle of a pending post: what the page posted is the text the chat then shows
  const text = page.AnswerText.of(catalog && page.AnswerView.of(catalog)).form({ type: 'slider', label: 'How was your energy this week?', min: 0, max: 10 }, { 0: 8 });
  assert.equal(text, 'How was your energy this week? 8');
  assert.deepEqual(JSON.parse(JSON.stringify(page.AnswerViews.sendOf({ mine: [text], labels: ['How was your energy this week?'], pending: null }))), { sent: text, pending: null });
});
