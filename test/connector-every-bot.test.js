// "Always allow" for all bots on a connected app's action (ADR 184): an action that reaches no one may be granted to
// every bot at once, from its card; one that sends, posts, removes or pays only to the bot that asked. The owner lists
// the grants for every bot in Settings and revokes one. Against a real botdot server and the stand-in connected app.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, waitFor, fakeConnectedApp, connectorEnv } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { forEveryBot } = require('../lib/asks');

let app, srv;
before(async () => {
  app = await fakeConnectedApp();
  srv = await startServer({ env: app.env });
  await app.connect(srv);
});
after(async () => { await srv.stop(); app.close(); });

async function running(t, bot) {
  const { token, rec, run } = await heldRun(srv, bot);
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, token));
  const call = (action, args = { message_id: 'm1', label: 'Later' }) => tools.call('connector_run', { app: 'gmail', action, arguments: args });
  const cards = async () => (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
  const card = () => waitFor(async () => (await cards())[0], { what: 'the card of the action' });
  const end = async () => { srv.release(rec); return srv.finished(run.id); };
  return { call, cards, card, end };
}
const said = (result) => result.content.map((c) => c.text).join('\n');
const answer = (ask, body) => srv.api(`/asks/${ask.id}`, { method: 'POST', body });

test('which actions may be allowed for every bot: none that reaches people, removes or pays', () => {
  for (const a of ['GMAIL_ADD_LABEL_TO_EMAIL', 'GOOGLECALENDAR_CREATE_EVENT', 'NOTION_CREATE_PAGE', 'GMAIL_CREATE_EMAIL_DRAFT', 'GITHUB_CREATE_AN_ISSUE']) assert.equal(forEveryBot(a), true, a);
  for (const a of ['GMAIL_SEND_EMAIL', 'SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL', 'LINKEDIN_CREATE_LINKED_IN_POST', 'GMAIL_REPLY_TO_THREAD', 'GMAIL_DELETE_MESSAGE', 'STRIPE_CREATE_REFUND', 'TWITTER_CREATION_OF_A_POST', 'GOOGLEDRIVE_SHARE_FILE']) assert.equal(forEveryBot(a), false, a);
});

test("all bots: one yes lets every bot's same action through, the card says whom it asks, and Settings lists and revokes it", async (t) => {
  const one = await makeBot(srv, { name: 'Sorter', emoji: '📥', connectors: ['gmail'] });
  const two = await makeBot(srv, { name: 'Filer', emoji: '🗂️', connectors: ['gmail'] });
  const r = await running(t, one);
  const pending = r.call('GMAIL_ADD_LABEL_TO_EMAIL');
  const card = await r.card();
  assert.deepEqual(card.everyBot, {
    question: 'Who may add label to email with Gmail from now on, whatever the details?',
    note: 'Only Sorter, or every bot you have and make. You can revoke it on the Connectors page.',
    only: 'Only Sorter', all: 'All bots',
  });
  assert.deepEqual((await answer(card, { yes: true, always: 'all' })).data, { ok: true });
  assert.equal(said(await pending), '{"done":true}');
  assert.deepEqual((await srv.api(`/bots/${one.id}/connector-actions`)).data, [], 'not kept as the bot\'s own');
  assert.deepEqual((await srv.api('/connector-actions')).data, { grants: [{ action: 'gmail:GMAIL_ADD_LABEL_TO_EMAIL', label: 'Add label to email with Gmail' }] });
  await r.end();

  // The other bot: through at once, no card.
  const s = await running(t, two);
  assert.equal(said(await s.call('GMAIL_ADD_LABEL_TO_EMAIL', { message_id: 'm2', label: 'Bills' })), '{"done":true}');
  assert.deepEqual(await s.cards(), []);

  // Revoked in Settings: the next call asks again.
  assert.equal((await srv.api('/connector-actions', { method: 'DELETE', body: { action: 'gmail:GMAIL_ADD_LABEL_TO_EMAIL' } })).status, 200);
  assert.deepEqual((await srv.api('/connector-actions')).data, { grants: [] });
  assert.equal((await srv.api('/connector-actions', { method: 'DELETE', body: { action: 'gmail:GMAIL_ADD_LABEL_TO_EMAIL' } })).status, 404);
  const again = s.call('GMAIL_ADD_LABEL_TO_EMAIL', { message_id: 'm3', label: 'Bills' });
  const next = await s.card();
  await answer(next, { yes: false });
  assert.match(said(await again), /declined/);
  await s.end();
});

test('an action that sends is always allowed for its bot only: the card offers no "all bots", and the server refuses it', async (t) => {
  const bot = await makeBot(srv, { name: 'Mailer', emoji: '✉️', connectors: ['gmail'] });
  const r = await running(t, bot);
  const pending = r.call('GMAIL_SEND_EMAIL', { recipient_email: 'anna@example.com', subject: 'Hi', body: 'Hi' });
  const card = await r.card();
  assert.equal(card.everyBot, undefined);
  const refused = await answer(card, { yes: true, always: 'all' });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error, 'This can be always allowed for this bot only.');
  assert.equal((await r.cards()).length, 1, 'the card stays');
  assert.deepEqual((await srv.api('/connector-actions')).data, { grants: [] });
  await answer(card, { yes: true, always: true });
  assert.equal(said(await pending), '{"done":true}');
  assert.deepEqual((await srv.api(`/bots/${bot.id}/connector-actions`)).data, ['gmail:GMAIL_SEND_EMAIL']);
  await r.end();
});

test('the Chief may not list or revoke the grants for every bot', async () => {
  assert.equal((await srv.asChief('/connector-actions')).status, 403);
});
