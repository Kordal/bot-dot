// A shared room's cards on the web page (ADR 067, test/need-cards.js, the page's own code): a tool a run from a room
// wants to use, and what would go to a room. The server's title, line, rows and yes word; no yes on a card that can't
// show all it approves. docs/api.md, "Shared rooms: the owner's mention".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { page, titleOf, metaOf, buttonsOf, rowsOf } = require('./need-cards');

const BOT = { id: 'b1', name: 'Scout', color: '#336699' };
const TOOL = { id: 't1', kind: 'room-tool', botId: 'b1', bot: BOT, room: { id: 'r1', name: 'Garden club' }, tool: 'Bash', title: 'Let Scout use Bash?', meta: 'For your message in the shared room “Garden club”.', rows: [{ label: 'Command', value: 'ls plants' }], yes: 'Allow', yesOn: 'card', at: '2026-10-22T15:00:00.000Z' };
const POST = { id: 'p1', kind: 'room-post', botId: 'b1', bot: BOT, room: { id: 'r1', name: 'Garden club' }, from: 'mention', title: "Post Scout's reply in “Garden club”?", meta: 'People of other accounts in the room read it.', rows: [{ label: 'Room', value: 'Garden club' }, { label: 'Text', value: 'Ferns and hostas.' }], yes: 'Post', yesOn: 'card', at: '2026-10-22T15:01:00.000Z' };
const draw = (ask) => { const p = page({ state: { asks: [ask] } }); return p.needCardHTML(p.item(`ask:${ask.id}`)); };

test("web: a room's tool card and post card show the server's words, with Decline and the server's yes", () => {
  const tool = draw(TOOL);
  assert.equal(titleOf(tool), 'Let Scout use Bash?');
  assert.equal(metaOf(tool), TOOL.meta);
  assert.deepEqual(rowsOf(tool), [['Command', 'ls plants']]);
  assert.deepEqual(buttonsOf(tool), ['Decline', 'Allow']);
  const post = draw(POST);
  assert.deepEqual(rowsOf(post), [['Room', 'Garden club'], ['Text', 'Ferns and hostas.']]);
  assert.deepEqual(buttonsOf(post), ['Decline', 'Post']);
});

test('web: a card cut short or too long to show in full offers Decline alone', () => {
  assert.deepEqual(buttonsOf(draw({ ...POST, more: true })), ['Decline']);
  assert.deepEqual(buttonsOf(draw({ ...TOOL, rows: [{ label: 'Command', value: 'ls…', more: true }] })), ['Decline']);
});
