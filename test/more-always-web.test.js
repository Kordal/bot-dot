// "Always allow" on more cards (#280), on the web page: the page's own code for the cards (test/need-cards.js)
// against the cards as the server sends them (test/more-always.test.js). Every word is the server's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { page, buttonsOf, BAD } = require('./need-cards');

const QUIET = {
  id: 'c1', kind: 'chief-action', botId: null, bot: null, chatId: 'k1', title: 'Change your quiet hours',
  meta: 'The Chief read the web in this chat, so this waits for your OK. A yes does exactly this.',
  rows: [{ label: 'Start', value: '22' }, { label: 'End', value: '7' }],
  always: 'Always allow changes to your quiet hours', warning: '“Always allow changes to your quiet hours” lets the Chief change your quiet hours also after it read the web, without a card, until you ask it to stop.',
  yesOn: 'card', text: 'After reading the web: Change your quiet hours', at: '2026-10-22T06:00:00.000Z',
};

test("web: a Chief's change of a type that may be always allowed has Decline / the server's always / Approve", () => {
  const p = page({ state: { asks: [QUIET] } });
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item('ask:c1'))), ['Decline', 'Always allow changes to your quiet hours', 'Approve']);
  const plain = page({ state: { asks: [{ ...QUIET, always: undefined }] } });
  assert.deepEqual(buttonsOf(plain.needCardHTML(plain.item('ask:c1'))), ['Decline', 'Approve'], 'without it, as before');
  const cut = page({ state: { asks: [{ ...QUIET, rows: [{ label: 'Text', value: 'x', more: true }] }] } });
  assert.deepEqual(buttonsOf(cut.needCardHTML(cut.item('ask:c1'))), ['Decline'], 'a card that cannot show it all offers no yes, "always" neither');
});

test('web: what the server wrote on these cards is text', () => {
  const p = page({ state: { asks: [{ ...QUIET, always: BAD }] } });
  assert.doesNotMatch(p.needCardHTML(p.item('ask:c1')), /<img|<script/);
});
