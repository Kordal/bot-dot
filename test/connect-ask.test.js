// A missing connected app is one Connect card (ADR 168, #1182): the Chief offers it for itself or for a bot, one card
// per bot and app; Not now holds the next for a day; its yes is the sign-in on the card, never a bare yes; its
// Connect keeps the connection Composio makes and never the sign-in page's address; and once that connection is
// ACTIVE the bot has the app and the run that waited carries on. An app that is connected already is a changed
// bot's card (`asked: 'app'`). A stand-in for Composio's API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startServer, makeBot, waitFor } = require('./helpers');
const asksLib = require('../lib/asks');
const connectAsksLib = require('../lib/connect-asks');

const REDIRECT = 'https://connect.composio.example/link/secret-page-123';
const composio = { status: {}, users: {}, links: 0 };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (p === '/connected_accounts' && req.method === 'GET') return json(200, { items: Object.entries(composio.status).filter(([, s]) => s.status === 'ACTIVE').map(([id, s]) => ({ id, toolkit: { slug: s.app }, status: 'ACTIVE' })) });
    if (p === '/toolkits/weather') return json(200, { slug: 'weather', name: 'Weather', no_auth: true });
    if (p === '/toolkits/github') return json(200, { slug: 'github', name: 'GitHub', composio_managed_auth_schemes: ['OAUTH2'] });
    if (p.startsWith('/toolkits/')) { const slug = p.split('/').at(-1); return json(200, { slug, name: slug === 'gmail' ? 'Gmail' : slug, composio_managed_auth_schemes: ['OAUTH2'] }); }
    if (p === '/auth_configs') return json(200, { items: [{ id: `ac_${url.searchParams.get('toolkit_slug')}`, status: 'ENABLED' }] });
    if (p === '/connected_accounts/link') {
      const b = JSON.parse(body);
      if (b.auth_config_id === 'ac_github') return json(400, { error: { message: '{"code":1803,"detail":"ConnectedAccount_MultipleAccountsNotAllowed for ac_github"}' } });
      const id = `ca_${b.auth_config_id.slice(3)}_${++composio.links}`;
      composio.status[id] = { app: b.auth_config_id.slice(3), status: 'INITIATED' };
      composio.users[id] = b.user_id;
      return json(200, { redirect_url: REDIRECT, connected_account_id: id, expires_at: '2026-11-07T08:00:00Z' });
    }
    if (p.startsWith('/connected_accounts/')) {
      const id = p.split('/').at(-1);
      const s = composio.status[id];
      return s ? json(200, { id, user_id: composio.users[id], toolkit: { slug: s.app }, status: s.status }) : json(404, { message: 'Not here' });
    }
    if (p === '/toolkits') return json(200, { items: [], next_cursor: null });
    return json(404, { message: 'Not here' });
  });
});

let srv;
before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { COMPOSIO_API_URL: `http://127.0.0.1:${fake.address().port}` } });
  const r = await srv.api('/connectors/key', { method: 'PUT', body: { key: 'pk_test_key_1' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
after(async () => { await srv?.stop(); fake.close(); });

const offer = (body) => srv.asChief('/asks', { method: 'POST', body: { kind: 'connect-app', reason: 'It reads the inbox for the morning summary.', ...body } });
const stored = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8'));
const listed = async (id) => (await srv.api('/asks?connect-app=1')).data.find((a) => a.id === id);

test("the Chief's Connect card: one per bot and app, outside batches, opted in, and only signed in on its card", async () => {
  const writer = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
  const made = await offer({ app: 'Gmail', bot: writer.id });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const a = made.data;
  assert.deepEqual([a.kind, a.app, a.name, a.mode, a.botId, a.title, a.act, a.no, a.text, a.yesOn], ['connect-app', 'gmail', 'Gmail', 'connect', writer.id, 'Connect Gmail for Writer', { verb: 'connect', label: 'Connect' }, 'Not now', 'Needs Gmail connected', 'card']);
  assert.equal(a.batch, undefined);

  // Asked again: the same card.
  const again = await offer({ app: 'gmail', bot: writer.id });
  assert.deepEqual([again.status, again.data.id, again.data.joined], [200, a.id, true]);
  assert.equal(stored().filter((x) => x.kind === 'connect-app').length, 1);

  // An app from before draws none: it would take it for a skill to install.
  assert.ok(!(await srv.api('/asks')).data.some((x) => x.id === a.id));
  assert.ok(await listed(a.id));

  // Its yes is the sign-in: a bare yes is refused, and only the owner connects.
  const yes = await srv.api(`/asks/${a.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 409);
  assert.match(yes.data.error, /^Press Connect on its card/);
  assert.equal((await srv.asChief(`/asks/${a.id}/connect`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await srv.api('/asks', { method: 'POST', body: { kind: 'connect-app', app: 'gmail' } })).status, 403, "only the Chief's tools offer one");
  assert.equal((await offer({ app: 'not a slug!' })).status, 400);
  assert.ok(await listed(a.id), 'the card stays');
  await srv.api(`/asks/${a.id}`, { method: 'POST', body: { yes: false } });
});

test('Not now removes the card and holds the next for that bot and app for a day', async () => {
  const bot = await makeBot(srv, { name: 'Chatter', emoji: '💬' });
  const a = (await offer({ app: 'slack', bot: bot.id })).data;
  const no = await srv.api(`/asks/${a.id}`, { method: 'POST', body: { yes: false } });
  assert.deepEqual(no.data, { ok: true, declined: true });
  assert.ok(!(await listed(a.id)));
  const held = await offer({ app: 'slack', bot: bot.id });
  assert.equal(held.status, 409);
  assert.equal(held.data.error, "The owner said not now to Slack today. Say in one line what you couldn't do without it.");
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'asks-declined.json'), 'utf8'));
  assert.ok(kept.some((d) => d.botId === bot.id && d.connectApp === 'slack'));
  // Another app, or the Chief's own card for it, is not held.
  assert.equal((await offer({ app: 'notion', bot: bot.id })).status, 201);
  assert.equal((await offer({ app: 'slack' })).status, 201);
});

test('Connect keeps the connection and never the page; once it is ACTIVE the bot has the app and its run carries on', { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Mail Reader', emoji: '📬' });
  srv.reply('I need Gmail for that.');
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Summarise my inbox' } })).data;
  await srv.finished(run.id);
  const a = (await offer({ app: 'gmail', bot: bot.id, run: run.id })).data;
  assert.match(a.then?.text || '', /carries on with “Summarise my inbox”/);

  const c = await srv.api(`/asks/${a.id}/connect`, { method: 'POST', body: {} });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.redirectUrl, REDIRECT);
  assert.equal(c.data.expiresAt, '2026-11-07T08:00:00Z');
  const card = stored().find((x) => x.id === a.id);
  assert.deepEqual([card.connectionId, card.expiresAt], [c.data.connectionId, '2026-11-07T08:00:00Z']);
  assert.ok(!fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8').includes('secret-page-123'), 'the sign-in page is not kept');

  // Not signed in yet: the card waits.
  assert.deepEqual((await srv.api(`/asks/${a.id}/connect`)).data, { status: 'INITIATED' });
  assert.ok(await listed(a.id));
  assert.equal((await srv.asChief(`/asks/${a.id}/connect`)).status, 403);

  srv.reply('Here is your inbox summary.');
  composio.status[c.data.connectionId].status = 'ACTIVE';
  const done = await srv.api(`/asks/${a.id}/connect`);
  assert.equal(done.data.status, 'ACTIVE');
  assert.equal(done.data.settled, true);
  assert.equal(done.data.carriesOn?.who, 'bot');
  assert.ok(!(await listed(a.id)), 'the card is gone');
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.connectors, ['gmail']);
  const next = await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.continues === run.id), { what: 'the run that carries on' });
  assert.ok(next);
  assert.deepEqual((await srv.api(`/asks/${a.id}/connect`)).status, 404, 'settled once');
});

test('an app that needs no sign-in settles at once; a refused sign-in turns the card to setup, which closes', { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Forecaster', emoji: '🌦️' });
  const w = (await offer({ app: 'weather', bot: bot.id })).data;
  const r = await srv.api(`/asks/${w.id}/connect`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.noAuth, r.data.settled], [true, true]);
  assert.ok(!(await listed(w.id)));
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.connectors, ['weather']);

  srv.reply('GitHub is already connected once; remove the old connection in Connectors and try again.');
  const g = (await offer({ app: 'github', bot: bot.id })).data;
  const refused = await srv.api(`/asks/${g.id}/connect`, { method: 'POST', body: {} });
  assert.equal(refused.status, 502);
  assert.equal(refused.data.mode, 'setup');
  assert.equal(refused.data.error, 'GitHub is already connected once; remove the old connection in Connectors and try again.');
  const setup = await listed(g.id);
  assert.deepEqual([setup.mode, setup.title, setup.act, setup.body], ['setup', 'Set up GitHub in Composio', { verb: 'open', screen: 'connectors', label: 'Open Apps' }, refused.data.error]);
  const closed = await srv.api(`/asks/${g.id}`, { method: 'POST', body: { yes: true } });
  assert.deepEqual(closed.data, { ok: true, closed: true });
  assert.ok(!(await listed(g.id)));
  assert.equal((await offer({ app: 'github', bot: bot.id })).status, 201, 'closing is no Not now');
});

test("a changed bot's card gives a connected app the bot lacks (asked: 'app'), and its yes carries the run on", { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Planner', emoji: '📅' });
  srv.reply('I need Google Calendar.');
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Plan my week' } })).data;
  await srv.finished(run.id);
  // As lib/connect-asks.js giveApp makes it: a bot's own ask_permission-like card.
  const at = new Date().toISOString();
  const card = { id: 'giveapp1', kind: 'bot-change', botId: bot.id, by: 'bot', asked: 'app', app: 'googlecalendar', name: 'Google Calendar', reason: 'To plan the week.', runId: run.id, changes: { connectors: ['googlecalendar'] }, before: { connectors: [] }, at, runs: [{ id: run.id, at }] };
  fs.writeFileSync(path.join(srv.data, 'asks.json'), JSON.stringify([...stored(), card]));
  const shown = (await srv.api('/asks')).data.find((x) => x.id === card.id);
  assert.deepEqual([shown.title, shown.yes, shown.text, shown.yesOn], ['Let Planner use Google Calendar?', 'Allow', 'Asks to use Google Calendar', 'card']);
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.deepEqual(yes.data.bot.connectors, ['googlecalendar']);
  assert.equal(yes.data.carriesOn?.who, 'bot');
  await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.continues === run.id), { what: 'the run that carries on' });
});

test("connect-ask's cards in lib: modes, words, giveApp and its holds", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-connect-'));
  const asks = asksLib.create(dir);
  const bot = { id: 'b1', name: 'Writer', connectors: ['slack'] };
  const status = { configured: true, keyRejected: false };
  const connectors = { status: () => status, reconnect: () => ['notion'], rejectedError: () => new Error('refused') };
  const C = connectAsksLib.create({ asks, bots: { get: (id) => (id === 'b1' ? bot : null) }, connectors, appName: (s) => ({ gmail: 'Gmail', notion: 'Notion' }[s] || asksLib.appWord(s)), carryOnAfter: () => ({}), botOfRun: (id) => (id === 'r1' ? 'b1' : 'other') });
  const view = (a, lang) => asksLib.proposalView(a, 'Writer', { lang });

  // An app of the old Composio account is a Reconnect; the Chief's card names no bot; no key is a setup for the key.
  const re = C.offer({ botId: 'b1', app: 'notion', runId: 'r1' }).ask;
  assert.deepEqual([re.mode, view(re).title, view(re).act.verb, re.runs.map((r) => r.id)], ['reconnect', 'Reconnect Notion', 'connect', ['r1']]);
  assert.equal(asksLib.askText(re), 'Needs Notion reconnected');
  assert.equal(C.offer({ botId: 'b1', app: 'gmail', runId: 'r2' }).ask.runs, undefined, "another bot's run waits for nothing here");
  assert.equal(view(C.offer({ app: 'gmail' }).ask).title, 'Connect Gmail');
  status.configured = false;
  const key = C.offer({ botId: 'b1', app: 'linear' }).ask;
  assert.deepEqual([key.mode, key.key, view(key).title, view(key).act], ['setup', true, 'Add your Composio key', { verb: 'open', screen: 'connectors', label: 'Open Apps' }]);
  assert.equal(view(key, 'pl').title, 'Dodaj swój klucz Composio');
  assert.equal(asksLib.askText(key), 'Needs your Composio key for Linear');
  // Asked again once the key is there: the same card, as it is now.
  status.configured = true;
  const now = C.offer({ botId: 'b1', app: 'linear' });
  assert.deepEqual([now.joined, now.ask.id, now.ask.mode, now.ask.key], [true, key.id, 'connect', undefined]);
  assert.equal(view(now.ask, 'pl').title, 'Połącz Linear dla Writer');

  // What a yes gives the run, and what the Chief is told.
  assert.deepEqual(asksLib.grantWords(re), ['use Notion']);
  assert.equal(asksLib.answerWords(re, { botName: 'Writer' }).done, 'Notion is connected, and Writer has it now.');
  assert.equal(asksLib.batchKey(re, () => 'r1'), null);
  assert.equal(asksLib.ownYes(re), true);

  // Not now holds for a day, for that bot and app only.
  asks.take(re.id, { declined: true });
  assert.deepEqual(C.offer({ botId: 'b1', app: 'notion' }), { held: true, name: 'Notion' });
  assert.ok(C.offer({ app: 'notion' }).ask, "the Chief's own is not held");
  const file = path.join(dir, 'asks-declined.json');
  fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).map((d) => ({ ...d, at: new Date(Date.now() - 25 * 3600e3).toISOString() }))));
  assert.ok(C.offer({ botId: 'b1', app: 'notion' }).ask, 'a day later, a card again');

  // A connected app the bot lacks: a changed bot's card, held a week after a no.
  const give = C.giveApp({ bot, app: 'gmail', runId: 'r1', reason: 'To read mail.' }).ask;
  assert.deepEqual([give.kind, give.asked, give.changes, give.before], ['bot-change', 'app', { connectors: ['slack', 'gmail'] }, { connectors: ['slack'] }]);
  assert.deepEqual([view(give).title, view(give).yes, asksLib.askText(give), asksLib.grantWords(give)], ['Let Writer use Gmail?', 'Allow', 'Asks to use Gmail', ['use Gmail']]);
  assert.equal(view(give, 'pl').title, 'Czy Writer może używać Gmail?');
  assert.throws(() => C.giveApp({ bot, app: 'slack' }), /already yours/);
  asks.take(give.id, { declined: true });
  assert.deepEqual(C.giveApp({ bot, app: 'gmail' }), { held: true, name: 'Gmail' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an app whose Composio slug has a _ or - in it is the same app however a bot writes it', async () => {
  // "GitHub MCP" is github_mcp in Composio. A bot that has it and asks for "githubmcp" or "GitHub MCP" is told it
  // has it, with no card; a bot without it gets the card that gives it the connected github_mcp, never a setup.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-connect-'));
  const asks = asksLib.create(dir);
  const has = { id: 'b1', name: 'Coder', connectors: ['github_mcp'] };
  const lacks = { id: 'b2', name: 'Manager', connectors: [] };
  const toolkit = async (slug) => {
    if (slug === 'github_mcp') return { slug, name: 'GitHub MCP' };
    throw Object.assign(new Error('Toolkit not found'), { composio: true, status: 404 });
  };
  const connectors = { status: () => ({ configured: true, keyRejected: false }), reconnect: () => [], toolkit, connections: async () => [{ id: 'ca_1', toolkit: 'github_mcp', status: 'ACTIVE' }] };
  const C = connectAsksLib.create({ asks, bots: { get: (id) => ({ b1: has, b2: lacks }[id] || null) }, connectors, appName: (s) => (s === 'github_mcp' ? 'GitHub MCP' : asksLib.appWord(s)), carryOnAfter: () => ({}) });
  for (const app of ['githubmcp', 'GitHub MCP', 'github-mcp']) await assert.rejects(C.need({ bot: has, app }), /GitHub MCP is already yours/, app);
  const given = await C.need({ bot: lacks, app: 'githubmcp', reason: 'To open pull requests.' });
  assert.equal(given.given, true);
  assert.deepEqual([given.ask.kind, given.ask.app, given.ask.name, given.ask.changes], ['bot-change', 'github_mcp', 'GitHub MCP', { connectors: ['github_mcp'] }]);
  assert.deepEqual(await C.chiefNeed({ app: 'GitHub MCP' }), { connected: true, name: 'GitHub MCP' });
  assert.ok(!asks.list().some((a) => a.kind === 'connect-app'), 'no Set up card');

  // Not connected at all: the card is under github_mcp as it was written, and a name with spaces still finds googlecalendar.
  connectors.connections = async () => [];
  const card = await C.need({ bot: lacks, app: 'github_mcp', reason: 'To open pull requests.' });
  assert.deepEqual([card.ask.kind, card.ask.app, card.ask.name, card.ask.mode], ['connect-app', 'github_mcp', 'GitHub MCP', 'connect']);
  connectors.toolkit = async (slug) => {
    if (slug === 'googlecalendar') return { slug, name: 'Google Calendar' };
    throw Object.assign(new Error('Toolkit not found'), { composio: true, status: 404 });
  };
  assert.equal((await C.chiefNeed({ app: 'google_calendar' })).ask.app, 'googlecalendar');
  connectors.connections = async () => [{ id: 'ca_1', toolkit: 'github_mcp', status: 'ACTIVE' }];
  connectors.toolkit = toolkit;

  const apps = require('../lib/connected-apps').create({ connectAsks: C, post: () => {} });
  await assert.rejects(apps.request({ bot: has, session: {}, app: 'githubmcp', reason: 'To open pull requests.' }), /already yours/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a card or a Not now from before, under the slug without its _, is the same app as github_mcp', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-connect-'));
  const asks = asksLib.create(dir);
  const bot = { id: 'b1', name: 'Manager', connectors: [] };
  const toolkit = async (slug) => ({ slug, name: slug === 'github_mcp' ? 'GitHub MCP' : slug });
  const connectors = { status: () => ({ configured: true, keyRejected: false }), reconnect: () => [], toolkit, connections: async () => [{ id: 'ca_1', toolkit: 'github_mcp', status: 'EXPIRED' }] };
  const C = connectAsksLib.create({ asks, bots: { get: (id) => (id === 'b1' ? bot : null) }, connectors, appName: (s) => (s === 'github_mcp' ? 'GitHub MCP' : asksLib.appWord(s)), carryOnAfter: () => ({}) });
  // The card the old spelling made: asked again, the same card, which now keeps Composio's slug for its Connect.
  const old = asks.add({ kind: 'connect-app', botId: 'b1', app: 'githubmcp', name: 'Githubmcp', mode: 'setup', error: 'No such app', reason: 'To open pull requests.' });
  const again = await C.need({ bot, app: 'GitHub MCP', reason: 'To open pull requests.' });
  assert.deepEqual([again.joined, again.ask.id, again.ask.app, again.ask.name, again.ask.mode], [true, old.id, 'github_mcp', 'GitHub MCP', 'reconnect']);
  assert.equal(asks.list().filter((a) => a.kind === 'connect-app').length, 1);
  // Its Not now holds the app under either spelling.
  asks.take(old.id, { declined: true });
  assert.deepEqual(await C.need({ bot, app: 'githubmcp', reason: 'To open pull requests.' }), { held: true, name: 'GitHub MCP' });
  // A Not now stored before, under githubmcp, holds github_mcp too.
  const other = { id: 'b2', name: 'Coder', connectors: [] };
  const C2 = connectAsksLib.create({ asks, bots: { get: (id) => (id === 'b2' ? other : null) }, connectors, appName: (s) => (s === 'github_mcp' ? 'GitHub MCP' : asksLib.appWord(s)), carryOnAfter: () => ({}) });
  asks.take(asks.add({ kind: 'connect-app', botId: 'b2', app: 'githubmcp', name: 'Githubmcp', mode: 'connect', reason: 'x' }).id, { declined: true });
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'asks-declined.json'), 'utf8')).some((d) => d.botId === 'b2' && d.connectApp === 'githubmcp'));
  assert.deepEqual(await C2.need({ bot: other, app: 'GitHub MCP', reason: 'To open pull requests.' }), { held: true, name: 'GitHub MCP' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a card made under githubmcp settles when github_mcp is connected, and the bot gets github_mcp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-connect-'));
  const asks = asksLib.create(dir);
  const bot = { id: 'b1', name: 'Coder', connectors: [] };
  const bots = { get: (id) => (id === 'b1' ? bot : null), list: () => [bot], update: (id, patch) => Object.assign(bot, patch) };
  const connectors = { status: () => ({ configured: false, keyRejected: false }), reconnect: () => [], knownConnections: () => [] };
  const C = connectAsksLib.create({ asks, bots, connectors, appName: asksLib.appWord, carryOnAfter: () => ({}) });
  // Made without a key: Composio could not be asked, so the card has the slug without its _.
  const card = C.offer({ botId: 'b1', app: 'github_mcp' }).ask;
  assert.deepEqual([card.app, card.mode, card.key], ['githubmcp', 'setup', true]);
  C.listed([{ id: 'ca_9', toolkit: 'github_mcp', status: 'ACTIVE', createdAt: new Date(Date.now() + 1000).toISOString() }], []);
  assert.ok(!asks.list().some((a) => a.id === card.id), 'the card settled');
  assert.deepEqual(bot.connectors, ['github_mcp']);
  fs.rmSync(dir, { recursive: true, force: true });
});
