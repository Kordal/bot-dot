// "Always allow" on more cards (#280), on the web page: the page's own code for the cards (test/need-cards.js)
// against the cards as the server sends them (test/more-always.test.js). Every word is the server's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { page, buttonsOf, BAD } = require('./need-cards');

const REMINDER = {
  id: 'c1', kind: 'chief-action', botId: null, bot: null, chatId: 'k1', title: 'Set a reminder: “Water the plants”',
  meta: 'The Chief read the web in this chat, so this waits for your OK. A yes does exactly this.',
  rows: [{ label: 'Text', value: 'Water the plants' }, { label: 'At', value: '2030-01-01T09:00' }],
  always: 'Always allow reminders', warning: '“Always allow reminders” lets the Chief set reminders also after it read the web, without a card, until you ask it to stop.',
  yesOn: 'card', text: 'After reading the web: Set a reminder', at: '2026-10-22T06:00:00.000Z',
};

test("web: a Chief's change of a type that may be always allowed has Decline / the server's always / Approve", () => {
  const p = page({ state: { asks: [REMINDER] } });
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item('ask:c1'))), ['Decline', 'Always allow reminders', 'Approve']);
  const plain = page({ state: { asks: [{ ...REMINDER, always: undefined }] } });
  assert.deepEqual(buttonsOf(plain.needCardHTML(plain.item('ask:c1'))), ['Decline', 'Approve'], 'without it, as before');
  const cut = page({ state: { asks: [{ ...REMINDER, rows: [{ label: 'Text', value: 'x', more: true }] }] } });
  assert.deepEqual(buttonsOf(cut.needCardHTML(cut.item('ask:c1'))), ['Decline'], 'a card that cannot show it all offers no yes, "always" neither');
});

test('web: what the server wrote on these cards is text', () => {
  const p = page({ state: { asks: [{ ...REMINDER, always: BAD }] } });
  assert.doesNotMatch(p.needCardHTML(p.item('ask:c1')), /<img|<script/);
});
