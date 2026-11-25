// The checkup on the web page (docs/api.md, The Chief's checkup): the Chief's settings have no switch for it or for
// its web search (it always runs and always may search), and its message is drawn by the page's own chiefBubble.
// The real page is walked in test/browser/checkup.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, words } = require('./web-page');

// ---- no switches ----

test('web: the Chief\'s settings have no checkup or web search switch, and the page asks nothing of the checkup\'s setting', () => {
  const settingsJs = read('settings.js');
  const draw = cut('function renderChiefSettings()', '// The pages that open from Settings.');
  assert.doesNotMatch(draw, /checkup|CHECKUP/i, 'no card in the Chief\'s settings');
  assert.doesNotMatch(settingsJs, /data-checkup|settings\/checkup|drawCheckup|loadCheckup|setCheckup|CHECKUP_HTML|'Web search'/);
  assert.doesNotMatch(app, /es\.addEventListener\('checkup'|state\.checkup|checkup: null/, 'no feed event and no state for it');
  assert.doesNotMatch(read('style.css'), /chief-checkup|data-checkup/);
});

// ---- a checkup's message ----

const page = vm.createContext({ ...words, esc, ...words, state: { features: ['chief', 'unread', 'ratings'], bots: [], runs: [] }, CHIEF_COLOR: '#d85a30', msgTime: () => '08:00', copyBtn: () => '<copy>', questionsHTML: () => '' });
vm.runInContext(read('unread.js'), page);
vm.runInContext(read('ratings.js'), page);
vm.runInContext(`${cut('// The text colour that reads best on a filled colour', '// Several questions at once ([[ask: …]])')}
  ${cut('function md(src, botId, tables = false)', '// Link bare web addresses after rendering')}
  ${cut('function actionBot(a)', '// What Approve sends to answer')}
  this.chiefBubble = chiefBubble;`, page);
const MESSAGE = { role: 'chief', at: '2026-10-12T06:00:00Z', checkup: true, startedBy: 'botdot', choices: ['Do 1', 'Do all', 'Not now'],
  text: '2 things I would change after this checkup:\n\n1. **Rule, Web Surfer:** Use the saved X login straight away.\n   Why: 12 Oct, you answered "Yes, use the X account"\n2. **Job, Web Surfer:** Give "Rail check" two minutes.\n   Why: 12 Oct, it stopped after 60 seconds' };

test('web: a checkup\'s message shows its answer buttons and no 👍 and 👎', () => {
  const html = page.chiefBubble(MESSAGE, true, 0);
  assert.deepEqual([...html.matchAll(/<button class="btn" data-choice="([^"]*)">([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]), [['Do 1', 'Do 1'], ['Do all', 'Do all'], ['Not now', 'Not now']]);
  assert.doesNotMatch(html, /class="rate|data-rating/, 'it is no unasked message');
  assert.match(html, /<strong>Rule, Web Surfer:<\/strong>/, 'its text is an ordinary reply');
  assert.match(html, /<div class="bubble-meta on-hover">08:00<copy><\/div>/);
  // One proposal: its two answers.
  assert.equal((page.chiefBubble({ ...MESSAGE, choices: ['Do it', 'Not now'] }, true, 0).match(/data-choice=/g) || []).length, 2);
  // The same message, were it unasked, would have the thumbs: it is `unasked` that draws them, not the place.
  assert.match(page.chiefBubble({ ...MESSAGE, checkup: undefined, unasked: true }, true, 0), /class="rate"/);
});

test('web: once the owner answered, the buttons are gone: only the newest reply has them', () => {
  assert.doesNotMatch(page.chiefBubble(MESSAGE, false, 0), /data-choice=/);
  const line = app.match(/^const messageHTML = .*$/m)[0];
  vm.runInContext(`function steeredBubbles() { return ""; } function userBubble() { return "user"; } ${line}; this.renderMessage = messageHTML;`, page);
  const update = { role: 'chief', notice: true, projectUpdate: 'p:one', text: 'Project update' };
  assert.match(page.renderMessage(MESSAGE, 0, [MESSAGE, update]), /data-choice=/, 'a summary is not the owner answering');
  assert.doesNotMatch(page.renderMessage(MESSAGE, 0, [MESSAGE, { role: 'user', text: 'Do 1' }]), /data-choice=/);

});
