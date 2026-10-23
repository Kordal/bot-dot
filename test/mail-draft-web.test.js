// A mail draft in the Chief's chat on the web page (#415): the page's own chiefBubble, cut out of public/chief.js.
// The card has its header, state, text and actions; the run's chip moves into its footer; an earlier version and a
// sent mail fold. `ui/MailDraftTest` holds Android's side.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, noDrafts } = require('./web-page');

const page = vm.createContext({ ...noDrafts,
  esc, state: { features: [], bots: [{ id: 'mail', name: 'E-mail Assistant', computer: 'linux' }, { id: 'web', name: 'Web Surfer', computer: 'none' }], runs: [] }, CHIEF_COLOR: '#d85a30',
  msgTime: () => '07:31', copyBtn: () => '', choicesHTML: (c) => (c?.length ? `<choices:${c.join('|')}>` : ''), questionsHTML: () => '', botLabel: (b) => b.name,
});
vm.runInContext(read('unread.js'), page);
vm.runInContext(read('ratings.js'), page);
vm.runInContext(`${cut('function md(src, botId)', '// Link bare web addresses after rendering')}
  ${cut('const fmtSize = ', '// Files botdot already has')}
  ${cut('function actionBot(a)', '// What Approve sends to answer')}
  Object.assign(this, { chiefBubble });`, page);
const { chiefBubble } = page;

const draft = { to: 'Stefan <stefan@clinic.example>', subject: 'Online?', text: 'Hello <Stefan>', state: 'draft', botId: 'mail', runId: 'r1', bot: 'E-mail Assistant' };
const reply = (d, extra = {}) => ({ role: 'chief', text: 'Send it before 9:00.', at: '2026-10-23T07:00:00Z', choices: ['Send now', 'Not now'], actions: [{ kind: 'run', text: 'Started E-mail Assistant', botId: 'mail', runId: 'r1' }, { kind: 'run', text: 'Started Web Surfer', botId: 'web', runId: 'r2' }], draft: d, ...extra });
const buttons = (html) => [...html.matchAll(/data-choice="([^"]+)"/g)].map((m) => m[1]);

test('web: a draft is a labelled card with Send now and Not now, and the run chip in its footer', () => {
  const html = chiefBubble(reply(draft), true);
  assert.match(html, /<section class="mail-card" aria-label="Mail draft">/);
  assert.match(html, /<dt>To<\/dt><dd>Stefan &lt;stefan@clinic\.example&gt;<\/dd><dt>Subject<\/dt><dd class="mail-subject">Online\?<\/dd>/);
  assert.match(html, /<i><\/i>In Drafts · not sent/);
  assert.match(html, /<div class="mail-text">Hello &lt;Stefan&gt;<\/div>/, 'the text is the page\'s, escaped');
  assert.deepEqual(buttons(html), ['Send now', 'Not now']);
  assert.match(html, /class="btn primary" data-choice="Send now"/);
  assert.doesNotMatch(html, /<choices:/, 'no second row of buttons under the reply');
  assert.match(html, /data-mail-bot="mail">E-mail Assistant<\/button> · <button type="button" class="mail-link" data-mail-screen="mail">Screen<\/button>/);
  assert.doesNotMatch(html, /Started E-mail Assistant/, 'its chip is in the footer');
  assert.match(html, /Started Web Surfer/, 'another bot\'s chip stays');
});

test('web: kept keeps Send now, an earlier version and a sent mail fold', () => {
  const kept = chiefBubble(reply({ ...draft, state: 'kept' }), true);
  assert.match(kept, /Kept in Drafts · not sent/);
  assert.deepEqual(buttons(kept), ['Send now']);

  const earlier = chiefBubble(reply({ ...draft, earlier: true }), false);
  assert.match(earlier, /<button type="button" class="mail-old" data-mail-open>Earlier version · show<\/button>\s*<section class="mail-card" aria-label="Mail draft" hidden>/);
  assert.deepEqual(buttons(earlier), [], 'an earlier version is not sent from');

  const sent = chiefBubble(reply({ ...draft, state: 'sent', sentAt: '2026-10-23T07:31:00Z' }, { choices: undefined, text: 'Sent.' }), true);
  assert.match(sent, /<div class="mail-state sent"><i><\/i>Sent 07:31<\/div>/);
  assert.match(sent, /<div class="mail-text" hidden>/);
  assert.match(sent, /data-mail-text>Show the text<\/button>/);
  assert.deepEqual(buttons(sent), []);
});

test('web: a reply without a draft is as before', () => {
  const html = chiefBubble({ role: 'chief', text: 'Hi', at: '2026-10-23T07:00:00Z', choices: ['Yes', 'No'], actions: [{ kind: 'run', text: 'Started E-mail Assistant', botId: 'mail' }] }, true);
  assert.doesNotMatch(html, /mail-card/);
  assert.match(html, /<choices:Yes\|No>/);
  assert.match(html, /Started E-mail Assistant · View live screen/);
});
