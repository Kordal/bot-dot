// A login for an app botdot connects (Google Calendar, Slack, GitHub…) is never asked for as a password: the
// bot is sent to ask for the connected app (lib/connected-apps.js), which is the owner's card (ADR 168), and the
// Chief to give it or have the owner connect it. An API token for such a site is still a login like any other.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { appForSite } = require('../lib/connected-apps');

let srv, bot;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Inbox Keeper', emoji: '📬', connectors: [] });
});
after(() => srv?.stop());

test('the sites of connected apps are known, and a company is no one app', () => {
  assert.deepEqual(appForSite('calendar.google.com'), { slug: 'googlecalendar', name: 'Google Calendar' });
  assert.equal(appForSite('www.github.com').slug, 'github');
  assert.equal(appForSite('myteam.slack.com').slug, 'slack');
  for (const host of ['google.com', 'accounts.google.com', 'recipes.example.com', 'notgithub.com']) assert.equal(appForSite(host), null, host);
});

test("a bot's login request for a connected app's site is refused and points to ask_chief_for_app", async (t) => {
  const held = await heldRun(srv, bot, 'Warn me about clashes in my calendar.');
  const vault = rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: held.token });
  const refused = await vault.call('request_login', { site: 'calendar.google.com', reason: 'To read your events.' });
  assert.ok(refused.isError);
  assert.match(refused.content[0].text, /calendar\.google\.com is Google Calendar, an app botdot connects: don't ask for its password\. Ask for it with ask_chief_for_app \(app "googlecalendar"\): the owner gets one card/);
  assert.deepEqual((await srv.api('/vault/requests')).data, [], 'no login box was opened');
  assert.match((await vault.request('tools/list')).tools.find((x) => x.name === 'request_login').description, /Never for an app botdot connects[^']*ask_chief_for_app/);

  // The bot asks, once: no Chief turn, a card for the Composio key (there is none here), and the bot's line in the
  // Chief's chat.
  const self = rpcClient(t, 'self-mcp.js', held.rec.self.env);
  assert.ok((await self.request('tools/list')).tools.some((x) => x.name === 'ask_chief_for_app'));
  assert.match(await self.text('ask_chief_for_app', { app: 'googlecalendar', reason: 'To read your events and warn about clashes.' }), /^The owner now has a card to set up Google Calendar; botdot starts you again on this work once it is done\./);
  const card = (await srv.api('/asks?connect-app=1')).data.find((a) => a.kind === 'connect-app' && a.botId === bot.id);
  assert.deepEqual([card.app, card.mode, card.key, card.title], ['googlecalendar', 'setup', true, 'Add your Composio key']);
  assert.match(await self.text('ask_chief_for_app', { app: 'googlecalendar', reason: 'Still.' }), /asked already/);
  assert.equal(srv.runs().filter((r) => r.botdot).length, 0, 'no Chief turn');
  const said = (await Promise.all((await srv.api('/chief')).data.chats.map(async (c) => (await srv.api(`/chief/chats/${c.id}`)).data.messages))).flat();
  const line = said.find((m) => /^Asked for a connected app: Google Calendar\. Why: To read your events/.test(m.text));
  assert.deepEqual([line?.role, line?.from?.id], ['report', bot.id], "the bot's line in the Chief's chat");
  srv.release(held.rec);
  await srv.finished(held.run.id);
});

test('an app the bot has is not asked for', async (t) => {
  const mailer = await makeBot(srv, { name: 'Mailer', connectors: ['gmail'] });
  const held = await heldRun(srv, mailer, 'Read my mail.');
  const self = rpcClient(t, 'self-mcp.js', held.rec.self.env);
  assert.match((await self.call('ask_chief_for_app', { app: 'gmail', reason: 'x' })).content[0].text, /Gmail is already yours/);
  srv.release(held.rec);
  await srv.finished(held.run.id);
});

test('an API token for such a site is still asked for', async (t) => {
  const held = await heldRun(srv, bot, 'Call the GitHub API.');
  const vault = rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: held.token });
  const waiting = vault.text('request_login', { site: 'github.com', type: 'api-token', reason: 'To read issues.' });
  const r = await waitFor(async () => (await srv.api('/vault/requests')).data.find((x) => x.site === 'github.com'), { what: 'the token request' });
  await srv.api(`/vault/requests/${r.id}`, { method: 'POST', body: { action: 'decline' } });
  assert.match(await waiting, /declined/);
  srv.release(held.rec);
  await srv.finished(held.run.id);
});

test("the Chief's login request for such a site is refused and sends it to list_connectors", async () => {
  const r = await srv.asChief('/vault/requests', { method: 'POST', body: { site: 'https://calendar.google.com/calendar', forBot: bot.id, reason: 'x' } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Google Calendar, an app botdot connects[^\n]*Check list_connectors/);
});
