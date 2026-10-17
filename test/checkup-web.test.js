// The checkup on the web page (docs/api.md, The Chief's checkup): its two switches in the Chief's settings, cut
// out of public/app.js and run against stand-in elements and a stand-in server, and its message drawn by the
// page's own chiefBubble. The switches show only against a server with `checkup`, the line is the server's
// `when`, Web search can't be used while checkups are off, a toggle is one PUT, a refusal puts the switch back
// with the server's sentence, and the feed's `checkup` moves them. The real page is walked in
// test/browser/checkup.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, finders } = require('./web-page');

const css = read('style.css');
const SETTING = { on: true, days: [1, 2, 3, 4, 5], time: '08:00', webSearch: false, when: 'Weekdays at 08:00', timeZone: 'Europe/Warsaw', lastRanAt: null };

// The Chief's settings with the card in it, and a server that answers `answers` in turn (an Error is a refusal).
function settings({ features = ['chief', 'checkup'], checkup = null, answers = [] } = {}) {
  const on = element({}, { checked: false });
  const web = element({}, { checked: false });
  const when = element();
  const box = element({ '[data-checkup="on"]': on, '[data-checkup="webSearch"]': web, '[data-checkup-when]': when }, { classes: ['hidden'] });
  const calls = [], toasts = [], listeners = {};
  const state = { features, checkup };
  const ctx = vm.createContext({
    ...finders(element({ '#chief-checkup': box })), state, JSON,
    toast: (...a) => toasts.push(a),
    api: async (path, opts = {}) => {
      calls.push([opts.method || 'GET', path, opts.body && JSON.parse(JSON.stringify(opts.body))]); // an object of this side
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return { checkup: a };
    },
    es: { addEventListener: (type, fn) => { listeners[type] = fn; } },
  });
  vm.runInContext(`${cut('const CHECKUP_HTML = `', "// The Chief's settings (its figure and name in its chat)")}
    ${cut("es.addEventListener('checkup'", '\n}\n\n// ---------- boot')}
    this.CHECKUP_HTML = CHECKUP_HTML; this.drawCheckup = drawCheckup; this.loadCheckup = loadCheckup; this.setCheckup = setCheckup;`, ctx);
  const hears = (data) => listeners.checkup({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  const shown = () => !box.classList.contains('hidden');
  return { ctx, state, on, web, when, calls, toasts, hears, shown };
}

test('web: two switches, "Checkup" and "Web search", each with its line, and no control for the days or the time', () => {
  const html = settings().ctx.CHECKUP_HTML;
  const rows = html.match(/<div class="bs-row">[\s\S]*?<\/label>\s*<\/div>/g);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /<b>Checkup<\/b><div class="faint" data-checkup-when><\/div>/);
  assert.match(rows[0], /<label class="switch"><input type="checkbox" data-checkup="on" aria-label="Checkup"><span><\/span><\/label>/);
  assert.match(rows[1], /<b>Web search<\/b><div class="faint">Lets a checkup search the web to check a proposal\. It never opens a page\.<\/div>/);
  assert.match(rows[1], /<label class="switch"><input type="checkbox" data-checkup="webSearch" aria-label="Web search"><span><\/span><\/label>/);
  assert.equal((html.match(/<input|<select|<button|<textarea/g) || []).length, 2, 'the two switches and nothing else');
  assert.match(html, /^\s*<div class="card settings-card bs-rows hidden" id="chief-checkup">/, 'not shown until the server said how it is');
  assert.doesNotMatch(html, /cost|budget|usage/i);
});

test('web: the card is in the Chief\'s settings, outside the form that saves its model and rules, and each switch saves itself', () => {
  const draw = cut('function renderChiefSettings()', '// The pages that open from Settings.');
  assert.match(draw, /<\/form>\$\{CHECKUP_HTML\}\s*<h3 class="page-sub">Previous chats<\/h3>/);
  assert.match(draw, /\$\$\('\[data-checkup\]', root\)\.forEach\(\(box\) => \(box\.onchange = \(\) => setCheckup\(box\.dataset\.checkup, box\.checked\)\)\);\s*loadCheckup\(\);/);
});

test('web: against a server without checkup neither switch shows, and nothing is asked', async () => {
  const s = settings({ features: ['chief', 'unread', 'ratings'] });
  await s.ctx.loadCheckup();
  assert.deepEqual(s.calls, []);
  assert.equal(s.shown(), false);
  s.hears(SETTING); // nor when something on the feed says so
  assert.equal(s.shown(), false);
  const unknown = settings({ features: [] }); // features not known yet
  await unknown.ctx.loadCheckup();
  assert.deepEqual(unknown.calls, []);
  assert.equal(unknown.shown(), false);
});

test('web: with checkup the setting is read and both switches show, with the server\'s words for when', async () => {
  const s = settings({ answers: [SETTING] });
  await s.ctx.loadCheckup();
  assert.deepEqual(s.calls, [['GET', '/settings/checkup', undefined]]);
  assert.equal(s.shown(), true);
  assert.deepEqual([s.on.checked, s.web.checked, s.web.disabled], [true, false, false]);
  assert.equal(s.when.textContent, 'Weekdays at 08:00. Ask the Chief to change it.');
  const other = settings({ answers: [{ ...SETTING, webSearch: true, when: 'Mondays and Thursdays at 07:30' }] });
  await other.ctx.loadCheckup();
  assert.equal(other.when.textContent, 'Mondays and Thursdays at 07:30. Ask the Chief to change it.');
  assert.equal(other.web.checked, true);
  assert.doesNotMatch(cut('const CHECKUP_HTML = `', "// The Chief's settings (its figure"), /\.days|\.time\b|Weekdays/, 'the page composes no days and no time');
});

test('web: a setting that could not be read shows no switches, and no toast from the background', async () => {
  const s = settings({ answers: [new Error("Can't reach botdot.")] });
  await s.ctx.loadCheckup();
  assert.equal(s.shown(), false);
  assert.deepEqual(s.toasts, []);
});

test('web: while Checkup is off, Web search is shown but can\'t be used', async () => {
  const s = settings({ answers: [{ ...SETTING, on: false, webSearch: true }] });
  await s.ctx.loadCheckup();
  assert.equal(s.shown(), true);
  assert.deepEqual([s.on.checked, s.web.checked, s.web.disabled], [false, true, true], 'what it is set to still shows');
  assert.equal(s.on.disabled, false);
  assert.match(css, /\.switch:has\(input:disabled\) \{ opacity: \.45; cursor: default; \}/, 'greyed out');
});

test('web: a toggle sends that one value, and the switches are as the server answers', async () => {
  const s = settings({ checkup: SETTING, answers: [{ ...SETTING, on: false }, { ...SETTING, webSearch: true }] });
  s.ctx.drawCheckup();
  await s.ctx.setCheckup('on', false);
  assert.deepEqual(s.calls, [['PUT', '/settings/checkup', { on: false }]]);
  assert.deepEqual([s.on.checked, s.web.disabled], [false, true]);
  await s.ctx.setCheckup('webSearch', true);
  assert.deepEqual(s.calls[1], ['PUT', '/settings/checkup', { webSearch: true }]);
  assert.deepEqual([s.on.checked, s.web.checked, s.web.disabled], [true, true, false]);
  assert.deepEqual(s.toasts, []);
});

test('web: a refused or failed change puts the switch back and says the server\'s sentence', async () => {
  const s = settings({ checkup: SETTING, answers: [Object.assign(new Error('"on" must be true or false.'), { status: 400, refused: true }), new Error("Can't reach botdot.")] });
  s.ctx.drawCheckup();
  s.on.checked = false; // the owner's tap
  await s.ctx.setCheckup('on', false);
  assert.equal(s.on.checked, true, 'back on');
  assert.equal(s.web.disabled, false);
  assert.deepEqual(s.toasts, [['"on" must be true or false.', true]]);
  s.web.checked = true;
  await s.ctx.setCheckup('webSearch', true);
  assert.equal(s.web.checked, false);
  assert.deepEqual(s.toasts[1], ["Can't reach botdot.", true]);
  assert.equal(s.state.checkup, SETTING, 'what the server last said is kept');
});

test('web: a change made in another app or by the Chief moves the switches and the line, from the feed', () => {
  const s = settings({ checkup: SETTING });
  s.ctx.drawCheckup();
  s.hears({ ...SETTING, on: true, webSearch: true, days: [1, 4], time: '07:30', when: 'Mondays and Thursdays at 07:30' });
  assert.deepEqual([s.on.checked, s.web.checked, s.web.disabled], [true, true, false]);
  assert.equal(s.when.textContent, 'Mondays and Thursdays at 07:30. Ask the Chief to change it.');
  s.hears({ ...SETTING, on: false, webSearch: true });
  assert.deepEqual([s.on.checked, s.web.checked, s.web.disabled], [false, true, true]);
  // What is no setting changes nothing.
  for (const junk of ['not json', {}, { when: 'Never' }]) s.hears(junk);
  assert.deepEqual([s.on.checked, s.web.checked, s.when.textContent], [false, true, 'Weekdays at 08:00. Ask the Chief to change it.']);
  assert.deepEqual(s.calls, [], 'the feed carries the setting: nothing is asked again');
});

test('web: the settings not on screen: a change on the feed is kept for when they open', () => {
  const state = { features: ['checkup'], checkup: null };
  const listeners = {};
  const ctx = vm.createContext({ ...finders(), state, JSON, es: { addEventListener: (t, fn) => { listeners[t] = fn; } } });
  vm.runInContext(`${cut('function drawCheckup()', 'async function loadCheckup()')}
    ${cut("es.addEventListener('checkup'", '\n}\n\n// ---------- boot')}`, ctx);
  listeners.checkup({ data: JSON.stringify(SETTING) });
  assert.equal(state.checkup.when, 'Weekdays at 08:00');
});

// ---- a checkup's message ----

const page = vm.createContext({ esc, state: { features: ['chief', 'unread', 'ratings', 'checkup'], bots: [], runs: [] }, CHIEF_COLOR: '#d85a30', msgTime: () => '08:00', copyBtn: () => '<copy>', questionsHTML: () => '' });
vm.runInContext(read('unread.js'), page);
vm.runInContext(read('ratings.js'), page);
vm.runInContext(`${cut('const choicesHTML = ', '\n')}
  ${cut('function md(src)', '// Link bare web addresses after rendering')}
  ${cut('function actionBot(a)', '// What Approve sends to answer')}
  this.chiefBubble = chiefBubble;`, page);
const MESSAGE = { role: 'chief', at: '2026-10-12T06:00:00Z', checkup: true, startedBy: 'botdot', choices: ['Do 1', 'Do all', 'Not now'],
  text: '2 things I would change after this checkup:\n\n1. **Rule, Web Surfer:** Use the saved X login straight away.\n   Why: 12 Oct, you answered "Yes, use the X account"\n2. **Job, Web Surfer:** Give "Rail check" two minutes.\n   Why: 12 Oct, it stopped after 60 seconds' };

test('web: a checkup\'s message shows its answer buttons and no 👍 and 👎', () => {
  const html = page.chiefBubble(MESSAGE, true, 0);
  assert.deepEqual([...html.matchAll(/<button class="btn" data-choice="([^"]*)">([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]), [['Do 1', 'Do 1'], ['Do all', 'Do all'], ['Not now', 'Not now']]);
  assert.doesNotMatch(html, /class="rate|data-rating/, 'it is no unasked message');
  assert.match(html, /<strong>Rule, Web Surfer:<\/strong>/, 'its text is an ordinary reply');
  assert.match(html, /<div class="bubble-meta">08:00<copy><\/div>/);
  // One proposal: its two answers.
  assert.equal((page.chiefBubble({ ...MESSAGE, choices: ['Do it', 'Not now'] }, true, 0).match(/data-choice=/g) || []).length, 2);
  // The same message, were it unasked, would have the thumbs: it is `unasked` that draws them, not the place.
  assert.match(page.chiefBubble({ ...MESSAGE, checkup: undefined, unasked: true }, true, 0), /class="rate"/);
});

test('web: once the owner answered, the buttons are gone: only the newest reply has them', () => {
  assert.doesNotMatch(page.chiefBubble(MESSAGE, false, 0), /data-choice=/);
  assert.match(app, /chiefBubble\(m, i === all\.length - 1, at\)/);
});
