// A Gmail draft the Chief makes in a turn of the owner's goes through with no card (ADR 074): it stays in the
// owner's mailbox. Sending a draft keeps its card, a bot's draft keeps its card, and a look refuses a draft as it
// refuses every write (ADR 070).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const approvals = require('../lib/connector-approvals');

const DRAFT = { slug: 'GMAIL_CREATE_EMAIL_DRAFT', tags: ['createHint'] };
const SEND = { slug: 'GMAIL_SEND_DRAFT', tags: ['createHint'] };
const ARGS = { recipient_email: 'someone@example.com', subject: 'Re: Plans', body: 'Thanks, Thursday works.' };

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-draft-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const added = [];
  const asks = { add: (p) => { const a = { id: `ask-${added.length + 1}`, ...p }; added.push(a); return a; }, drop: () => [], mark: () => {} };
  const c = approvals.create(dir, { asks, active: () => true, bot: () => ({ name: 'Mail Bot', connectors: ['gmail'] }), chiefApps: () => ['gmail'] });
  return { c, added };
}
const waits = (fn) => assert.throws(fn, (e) => e.waits === true);

test('only a Gmail draft is a draft', () => {
  assert.deepEqual(approvals.DRAFTS, { gmail: ['GMAIL_CREATE_EMAIL_DRAFT'] });
});

test("the Chief's draft in the owner's turn goes through with no card; sending it waits for the card", (t) => {
  const { c, added } = setup(t);
  const { token, turnId } = c.openChief({ chatId: 'chat-1' });
  const s = c.chiefSession(token);
  assert.equal(c.authorize(s, 'gmail', DRAFT, ARGS), undefined);
  assert.equal(c.authorize(s, 'gmail', { ...DRAFT, tags: [] }, ARGS), undefined, 'also with no description from Composio');
  assert.equal(added.length, 0, 'no card');
  waits(() => c.authorize(s, 'gmail', SEND, { draft_id: 'd1' }));
  assert.deepEqual(added.map((a) => [a.action, a.chief]), [['GMAIL_SEND_DRAFT', true]]);
  c.closeChief(turnId);
});

test("a bot's draft keeps its card, and a look's is refused", (t) => {
  const { c, added } = setup(t);
  waits(() => c.authorize({ runId: 'run-1', botId: 'b1' }, 'gmail', DRAFT, ARGS));
  assert.deepEqual(added.map((a) => [a.action, a.botId]), [['GMAIL_CREATE_EMAIL_DRAFT', 'b1']]);
  const look = c.chiefSession(c.openChief({ chatId: null, apps: ['gmail'], readOnly: true }).token);
  assert.throws(() => c.authorize(look, 'gmail', DRAFT, ARGS), /^Error: This look only reads/);
  assert.equal(added.length, 1, 'no card for the look');
});
