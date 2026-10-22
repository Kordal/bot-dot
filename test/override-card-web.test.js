// A rule a bot asks to lift (`override`, #253), on the web page: the page's own code for the cards (test/need-cards.js)
// against the ask as the server sends it (test/override-ask.test.js). Every word is the server's, its two yes buttons too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./web-page');
const { page, titleOf, metaOf, buttonsOf, rowsOf, BAD } = require('./need-cards');

const ADMIN = { id: 'ops', name: 'Infra Admin', color: '#4a7fd8' };
const LIFT = {
  id: 'o1', kind: 'override', botId: 'ops', bot: ADMIN, rule: "Never touch other bots' files", action: 'Edit /workspace/mail-sorter/config.json',
  reason: 'The owner asked me to add a folder.', title: 'Let Infra Admin do this, though its rules say no?',
  parts: [{ label: 'Its rule', now: "Never touch other bots' files" }, { label: 'What it would do', now: 'Edit /workspace/mail-sorter/config.json' }],
  warning: 'Only you can lift a rule.', yes: 'Allow once', always: 'Allow always for this bot', yesOn: 'card', text: 'Asks to lift a rule: Edit /workspace/mail-sorter/config.json', at: '2026-10-21T12:00:00.000Z',
};
const draw = (ask) => { const p = page({ state: { asks: [ask] } }); return p.needCardHTML(p.item(`ask:${ask.id}`)); };

test("web: the card is the server's title, the reason, the rule and the action as rows, and Decline / Allow always / Allow once", () => {
  const html = draw(LIFT);
  assert.equal(titleOf(html), 'Let Infra Admin do this, though its rules say no?');
  assert.equal(metaOf(html), 'The owner asked me to add a folder.');
  assert.deepEqual(rowsOf(html), [['Its rule', 'Never touch other bots&#39; files'], ['What it would do', 'Edit /workspace/mail-sorter/config.json']]);
  assert.deepEqual(buttonsOf(html), ['Decline', 'Allow always for this bot', 'Allow once']);
});

test('web: what a bot wrote on the card is text', () => {
  const html = draw({ ...LIFT, reason: BAD, title: BAD, parts: [{ label: BAD, now: BAD }], yes: BAD, always: BAD });
  assert.doesNotMatch(html, /<img|<script/);
});

test('web: the page asks for these cards wherever it reads the asks', () => {
  assert.match(app, /api\('\/asks\?vault-switch=1&vault-remove=1&vault-file=1&override=1&chief-action=1&room-tool=1&room-post=1'\)/);
});
