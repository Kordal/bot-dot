// An irreversible step on a bot's computer (#638, ADR 107): the click that confirms a control the page marks
// irreversible waits for the owner's OK on a card; a no, or the owner taking control of the screen, is final for the run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const steps = require('../lib/irreversible-steps');

const DIALOG = [
  'Page: Settings – Stripe (https://dashboard.stripe.com/settings/account)',
  '- heading "Account settings" [level=1]',
  '- paragraph: Closing an account is irreversible. Read the guide first.',
  '- link "Read the guide" [ref=e1]',
  '- button "Next" [ref=e2]',
  '- dialog "Close account":',
  '  - paragraph: This cannot be undone. All payments stop.',
  '  - button "Cancel" [ref=e3]',
  '  - button "Close account" [ref=e4]',
].join('\n');

test('the confirming button of a dialog that says it cannot be undone is an irreversible step', () => {
  const step = steps.stepAt(DIALOG, 'e4');
  assert.deepEqual({ site: step.site, control: step.control }, { site: 'dashboard.stripe.com', control: 'Close account' });
  assert.match(step.says, /This cannot be undone/);
  assert.equal(steps.stepAt(DIALOG, 'e3'), null, 'Cancel confirms nothing');
});

test('an ordinary page that only mentions irreversible opens no card', () => {
  assert.equal(steps.stepAt(DIALOG, 'e1'), null, 'a link beside the word');
  assert.equal(steps.stepAt(DIALOG, 'e2'), null, 'a button outside the dialog');
  const docs = 'Page: Docs (https://docs.example.com/)\n- paragraph: Deleting is irreversible and cannot be reversed.\n- button "Search" [ref=e1]';
  assert.equal(steps.stepAt(docs, 'e1'), null);
  assert.equal(steps.stepOnPress(docs, 'Enter'), null);
});

test('a form that says it cannot be reversed, and a button named so, are steps too', () => {
  const form = 'Page: DNS (https://dns.example.net/zone)\n- form "Delete zone":\n  - text: Deleting a zone can\'t be reversed.\n  - textbox "Zone" [ref=e1]\n  - button "Delete zone" [ref=e2]';
  assert.equal(steps.stepAt(form, 'e2').control, 'Delete zone');
  assert.equal(steps.stepAt(form, 'e1'), null, 'a box is no confirming control');
  const named = 'Page: X (https://x.example.com/)\n- button "Delete forever (irreversible)" [ref=e7]';
  assert.equal(steps.stepAt(named, 'e7').control, 'Delete forever (irreversible)');
});

test('Enter or Space in a marked dialog is the step of its confirming button; another key is not', () => {
  assert.equal(steps.stepOnPress(DIALOG, 'Enter').control, 'Close account');
  assert.equal(steps.stepOnPress(DIALOG, ' ').control, 'Close account');
  assert.equal(steps.stepOnPress(DIALOG, 'Tab'), null);
});

test('a site belongs to a connected app by its name in the address', () => {
  assert.equal(steps.appOfSite(['github', 'stripe'], 'dashboard.stripe.com'), 'stripe');
  assert.equal(steps.appOfSite(['gmail'], 'mail.google.com'), 'gmail');
  assert.equal(steps.appOfSite(['stripe'], 'stripe-clone.example.com'), null);
  assert.equal(steps.appOfSite(['com'], 'example.com'), null, 'never by the last label');
  assert.equal(steps.appOfSite([], 'dashboard.stripe.com'), null);
});

// ---------- the gate ----------

function setup({ connected = null } = {}) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-steps-'));
  const asks = require('../lib/asks').create(dir);
  const live = new Set(['r1']);
  const gate = steps.create(dir, { asks, active: (id) => live.has(id), connectedApp: () => connected, waitMs: 60_000 });
  const session = { botId: 'b1', runId: 'r1' };
  gate.seen(session, DIALOG);
  return { dir, asks, live, gate, session };
}
const click = { op: 'click', ref: 'e4' };

test('the click waits on a card; the owner\'s yes lets that one click through once', async () => {
  const { asks, gate, session } = setup();
  assert.deepEqual(gate.before(session, { op: 'click', ref: 'e2' }), null, 'an ordinary click goes');
  const held = gate.before(session, click);
  assert.ok(held.waits);
  const [card] = asks.list();
  assert.equal(card.kind, 'computer-step');
  assert.equal(card.control, 'Close account');
  assert.equal(gate.waitsFor('r1'), true);
  const waiting = gate.wait(session, held.waits);
  gate.approve(card);
  assert.equal((await waiting).status, 'allowed');
  assert.equal(gate.before(session, click), null, 'the yes is used by this click');
  assert.ok(gate.before(session, click).waits, 'and only once');
});

test('after a no the same step is refused for the rest of the run, without a new card, and in its carry-on', async () => {
  const { asks, live, gate, session } = setup();
  const held = gate.before(session, click);
  gate.declined(asks.take(asks.list()[0].id, { declined: true }));
  assert.equal((await gate.wait(session, held.waits)).status, 'declined');
  const again = gate.before(session, click);
  assert.match(again.refused, /declined/);
  assert.equal(asks.list().length, 0, 'no second card');
  assert.match(gate.before(session, { op: 'press', key: 'Enter' }).refused, /declined/, 'nor by Enter');
  assert.match(gate.screenCmd(session, 'left_click'), /declined/, 'nor by a click on the screen');
  assert.equal(gate.screenCmd(session, 'screenshot'), null, 'looking goes');
  gate.runEnded({ id: 'r1', botId: 'b1' });
  live.add('r2');
  gate.runStarted({ id: 'r2', botId: 'b1', continues: 'r1' });
  const next = { botId: 'b1', runId: 'r2' };
  gate.seen(next, DIALOG);
  assert.match(gate.before(next, click).refused, /declined/, 'the run that carries on is refused too');
  live.add('r3');
  gate.runStarted({ id: 'r3', botId: 'b1' });
  gate.seen({ botId: 'b1', runId: 'r3' }, DIALOG);
  assert.ok(gate.before({ botId: 'b1', runId: 'r3' }, click).waits, 'a new request of the owner asks again');
});

test('the owner taking control of the screen while the card waits, or while the step is on it, is a no', async () => {
  const { asks, gate, session } = setup();
  const held = gate.before(session, click);
  const waiting = gate.wait(session, held.waits);
  gate.tookControl('b1');
  assert.equal((await waiting).status, 'declined');
  assert.equal(asks.list().length, 0, 'its card went');
  assert.match(gate.before(session, click).refused, /took control/);

  const other = setup();
  other.gate.tookControl('b1'); // the step is on the screen, no card yet
  assert.match(other.gate.before(other.session, click).refused, /took control/);
});

test('a step on the site of a connected app stays on the connector path: no card of its own', () => {
  const { asks, gate, session } = setup({ connected: 'Stripe' });
  const r = gate.before(session, click);
  assert.match(r.refused, /Stripe is connected/);
  assert.match(r.refused, /connector_run/);
  assert.equal(asks.list().length, 0);
});

test('a card whose run stopped waiting cannot be allowed, and goes', () => {
  const { asks, live, gate, session } = setup();
  gate.before(session, click);
  const card = asks.list()[0];
  live.delete('r1');
  gate.runEnded({ id: 'r1', botId: 'b1' });
  assert.equal(asks.list().length, 0);
  assert.throws(() => gate.approve(card), /no longer waits/);
});

// ---------- the bot's tool: browser_click waits on the card and goes only after a yes ----------

test('browser_click waits on the card, clicks after the yes, and after a no does not click again', async (t) => {
  const http = require('node:http');
  const { rpcClient } = require('./memory-helpers');
  const { asks, live, gate, session } = setup();
  const clicked = [];
  // botdot's routes as lib/routes/computers.js answers them, over this gate; the browser itself a stand-in.
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      const waitOf = /^\/session\/computer\/step\/([^/]+)\/wait$/.exec(req.url);
      if (waitOf) return res.end(JSON.stringify({ ok: true, ...(await gate.wait(session, waitOf[1], 200)) }));
      if (req.url !== '/session/computer/browser') return res.end('{"ok":true}');
      const payload = JSON.parse(body);
      const held = gate.before(session, payload);
      if (held?.refused) return res.end(JSON.stringify({ ok: false, error: held.refused }));
      if (held?.waits) return res.end(JSON.stringify({ ok: true, waits: held.waits }));
      clicked.push(payload.ref);
      res.end(JSON.stringify({ ok: true, snapshot: DIALOG }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture' });
  await mcp.request('initialize', {});
  const answer = (yes) => new Promise((resolve) => {
    const look = setInterval(() => {
      const card = asks.list()[0];
      if (!card) return;
      clearInterval(look);
      if (yes) gate.approve(card); else gate.declined(asks.take(card.id, { declined: true }));
      resolve();
    }, 20);
  });

  const [allowed] = await Promise.all([mcp.request('tools/call', { name: 'browser_click', arguments: { ref: 'e4' } }), answer(true)]);
  assert.equal(allowed.content[0].text, DIALOG);
  assert.deepEqual(clicked, ['e4'], 'clicked once, after the yes');

  const [refused] = await Promise.all([mcp.request('tools/call', { name: 'browser_click', arguments: { ref: 'e4' } }), answer(false)]);
  assert.match(refused.content[0].text, /declined/);
  const again = await mcp.request('tools/call', { name: 'browser_click', arguments: { ref: 'e4' } });
  assert.equal(again.isError, true);
  assert.match(again.content[0].text, /declined/);
  assert.deepEqual(clicked, ['e4'], 'no click after the no');
  assert.equal(asks.list().length, 0, 'and no new card');
  live.delete('r1');
});
