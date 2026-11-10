// A missing app is found where botdot knows it is missing (ADR 168, #1182): a bot's run that finds an app not
// connected, signed out or without a permission it needs gets the one Connect (or Reconnect) card, and is told so with
// `code: 'needs-connect'`; a write to such an app makes no card for the write; ask_chief_for_app makes the card itself,
// with no Chief turn; and once Composio lists the app as connected (any list: the Connectors page, an action, the
// card's own watch), the card settles, the bot has the app and the run carries on as after any yes (ADR 009, ADR
// 166): in its own session, handed back to the Chief when the Chief started it, and not at all when the owner wrote
// since or a day has passed. A stand-in for Composio's API.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startServer, makeBot, heldRun, self, waitFor, writeData, sleep } = require('./helpers');
const asksLib = require('../lib/asks');
const connectAsksLib = require('../lib/connect-asks');

const SCOPES = JSON.stringify({ error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } });
// Composio as botdot calls it: accounts are { id, app, status, created_at }; an action's app is its prefix.
const composio = { accounts: [], executed: [] };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/connected_accounts' && req.method === 'GET') return json(200, { items: composio.accounts.map((a) => ({ id: a.id, toolkit: { slug: a.app }, status: a.status, created_at: a.created_at })) });
    if (p.startsWith('/toolkits/')) { const slug = p.split('/').at(-1); return slug === 'nosuchapp' ? json(404, { message: 'Toolkit not found' }) : json(200, { slug, name: slug, composio_managed_auth_schemes: ['OAUTH2'] }); }
    if (p.startsWith('/tools/execute/')) {
      const action = p.split('/').at(-1);
      composio.executed.push(action);
      return json(200, action.endsWith('_DRAFTS') ? { successful: false, error: SCOPES, data: {} } : { successful: true, data: { done: true } });
    }
    if (p.startsWith('/tools/')) {
      const slug = p.split('/').at(-1);
      return json(200, { slug, toolkit: { slug: slug.split('_')[0].toLowerCase() }, no_auth: false, tags: slug.includes('SEND') ? ['createHint'] : ['readOnlyHint'] });
    }
    if (p === '/toolkits') return json(200, { items: [], next_cursor: null });
    return json(404, { message: 'Not here' });
  });
});

let srv;
before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { COMPOSIO_API_URL: `http://127.0.0.1:${fake.address().port}` } });
  fs.writeFileSync(path.join(srv.out, 'uuid-sessions'), ''); // sessions with ids as Claude Code writes them (ADR 166)
  const r = await srv.api('/connectors/key', { method: 'PUT', body: { key: 'pk_test_key_1' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
after(async () => { srv.unhold(); await srv?.stop(); fake.close(); });

let n = 0;
const account = (app, status = 'ACTIVE', at = new Date().toISOString()) => { const a = { id: `ca_${app}_${++n}`, app, status, created_at: at }; composio.accounts.push(a); return a; };
const drop = (app) => { composio.accounts = composio.accounts.filter((a) => a.app !== app); };
// What the bot's connector_run gets back (lib/connectors-mcp.js shows `error` alone).
const run = (token, app, action) => srv.api('/connectors/session/run', { method: 'POST', body: { app, action, arguments: {} }, headers: { 'X-Run-Token': token } });
const cardsOf = async (bot) => (await srv.api('/asks?connect-app=1')).data.filter((a) => a.botId === bot.id);
const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const stored = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8'));
const CONNECT = (name, verb = 'connect') => `${name} isn't connected, so nothing was done. The owner now has a card to ${verb} it; botdot starts you again on this work once it is connected. Say so in one line, stop the work that needs it and don't try it another way.`;

test("an owner's run on an app that isn't connected gets one Connect card, and once the Apps page lists it the bot goes on in its session", { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Mail Reader', emoji: '📬', connectors: ['gmail'] });
  srv.reply('Gmail is not connected yet.');
  const held = await heldRun(srv, bot, 'Summarise my inbox');
  const r = await run(held.token, 'gmail', 'GMAIL_FETCH_EMAILS');
  assert.deepEqual([r.data.ok, r.data.code, r.data.error], [false, 'needs-connect', CONNECT('Gmail')]);
  const [card] = await cardsOf(bot);
  assert.deepEqual([card.id, card.app, card.mode, card.title], [r.data.card, 'gmail', 'connect', 'Connect Gmail for Mail Reader']);
  assert.deepEqual(stored().find((a) => a.id === card.id).runs.map((x) => x.id), [held.run.id]);
  // Asked again in the run: the same card.
  assert.equal((await run(held.token, 'gmail', 'GMAIL_FETCH_EMAILS')).data.card, card.id);
  assert.equal((await cardsOf(bot)).length, 1);
  assert.deepEqual(composio.executed, [], 'nothing ran');
  srv.release(held.rec);
  srv.unhold();
  const first = await srv.finished(held.run.id);
  assert.equal(first.reconnect, undefined, "an owner's run has no Reconnect card under its reply");

  // Signed in elsewhere (the Connectors page, another device): its next list settles the card.
  srv.reply('Here is your inbox.');
  account('gmail');
  await srv.api('/connectors');
  assert.deepEqual(await cardsOf(bot), []);
  const next = await srv.finished((await waitFor(async () => (await runsOf(bot)).find((x) => x.continues === first.id), { what: 'the run that carries on' })).id);
  const rec = srv.runs().filter((x) => x.args.includes(`${bot.emoji} ${bot.name}`)).at(-1);
  assert.equal(rec.args[rec.args.indexOf('--resume') + 1], first.sessionId, 'in its own session');
  assert.match(rec.stdin, /The owner allowed you to: use Gmail\./);
  assert.equal(next.result, 'Here is your inbox.');
  drop('gmail');
});

test("a write to an app that isn't connected makes no card for the write; an expired connection and a missing permission are a Reconnect", { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Sender', emoji: '📮', connectors: ['gmail', 'slack'] });
  const held = await heldRun(srv, bot, 'Send the digest');
  const sent = await run(held.token, 'gmail', 'GMAIL_SEND_EMAIL');
  assert.deepEqual([sent.data.code, sent.data.error], ['needs-connect', CONNECT('Gmail')]);
  assert.ok(!stored().some((a) => a.kind === 'connector-action' && a.botId === bot.id), 'no card for the write');

  account('slack', 'EXPIRED');
  const expired = await run(held.token, 'slack', 'SLACK_LIST_CHANNELS');
  assert.equal(expired.data.error, CONNECT('Slack', 'reconnect'));
  account('gmail', 'ACTIVE', '2026-01-01T00:00:00Z');
  const scopes = await run(held.token, 'gmail', 'GMAIL_LIST_DRAFTS');
  assert.equal(scopes.data.error, CONNECT('Gmail', 'reconnect'));
  const cards = await cardsOf(bot);
  assert.deepEqual(cards.map((a) => [a.app, a.mode]).sort(), [['gmail', 'reconnect'], ['slack', 'reconnect']], 'the Gmail card says what is true now');
  // The old connection that lacks the permission settles nothing; a new one does.
  await srv.api('/connectors');
  assert.ok((await cardsOf(bot)).some((a) => a.app === 'gmail'));
  account('gmail', 'ACTIVE', new Date(Date.now() + 1000).toISOString());
  await srv.api('/connectors');
  assert.deepEqual((await cardsOf(bot)).map((a) => a.app), ['slack']);
  srv.release(held.rec);
  srv.unhold();
  await srv.finished(held.run.id);
  drop('gmail'); drop('slack');
});

test('after Not now the bot is told so for a day', { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Notion Reader', emoji: '📓', connectors: ['notion'] });
  const held = await heldRun(srv, bot, 'Read my notes');
  const card = (await run(held.token, 'notion', 'NOTION_SEARCH')).data.card;
  assert.deepEqual((await srv.api(`/asks/${card}`, { method: 'POST', body: { yes: false } })).data, { ok: true, declined: true });
  const r = await run(held.token, 'notion', 'NOTION_SEARCH');
  assert.deepEqual([r.data.code, r.data.error, r.data.card], ['needs-connect', "The owner said not now to Notion today. Say in one line what you couldn't do without it.", undefined]);
  assert.deepEqual(await cardsOf(bot), []);
  srv.release(held.rec);
  srv.unhold();
  await srv.finished(held.run.id);
});

test('ask_chief_for_app makes the card itself: unknown, connected and not given, expired, or never connected', { timeout: 60_000 }, async () => {
  const ask = async (name, app) => {
    const bot = await makeBot(srv, { name, emoji: '🧩' });
    const held = await heldRun(srv, bot, 'Do the work');
    const r = await self(srv, held.token, 'app', { app, reason: 'The work needs it.' });
    srv.release(held.rec);
    srv.unhold();
    await srv.finished(held.run.id);
    return { bot, run: held.run, r: r.data, cards: (await srv.api('/asks?connect-app=1')).data.filter((a) => a.botId === bot.id) };
  };
  const turns = srv.runs().filter((x) => x.botdot).length;
  assert.match((await ask('Unknown', 'nosuchapp')).r.error, /^No app called "nosuchapp"\./);

  account('github');
  const given = await ask('Coder', 'GitHub');
  assert.deepEqual([given.r.asked, given.r.given, given.r.name], [true, true, 'GitHub']);
  assert.deepEqual([given.cards[0].kind, given.cards[0].asked, given.cards[0].title, given.cards[0].changes], ['bot-change', 'app', 'Let Coder use GitHub?', { connectors: ['github'] }]);
  assert.deepEqual(stored().find((a) => a.id === given.r.card).runs.map((x) => x.id), [given.run.id]);

  account('linear', 'FAILED');
  const again = await ask('Planner', 'linear');
  assert.deepEqual([again.r.mode, again.cards[0].mode, again.cards[0].kind], ['reconnect', 'reconnect', 'connect-app']);
  const fresh = await ask('Writer', 'google_docs');
  assert.deepEqual([fresh.r.mode, fresh.cards[0].app, fresh.cards[0].mode], ['connect', 'googledocs', 'connect']);
  assert.equal(srv.runs().filter((x) => x.botdot).length, turns, 'no Chief turn');
  drop('github'); drop('linear');
});

test('a run the Chief started is handed back to the Chief once the app is connected', { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Calendar Keeper', emoji: '📅', connectors: ['googlecalendar'] });
  srv.hold();
  const started = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Plan my week' } })).data;
  const rec = await srv.nextRun((x) => x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`), 'Calendar Keeper to start');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const file = path.join(srv.data, 'chief', `${chat.id}.json`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.title = 'My week';
  saved.messages.push({ role: 'user', text: 'Plan my week', at: new Date().toISOString() },
    { role: 'chief', text: 'Started it.', at: new Date().toISOString(), actions: [{ kind: 'run', text: 'Started Calendar Keeper', botId: bot.id, runId: started.id }] });
  writeData(file, saved);
  assert.equal((await run(rec.self.env.RUN_TOKEN, 'googlecalendar', 'GOOGLECALENDAR_LIST_EVENTS')).data.code, 'needs-connect');
  srv.unhold();
  srv.release(rec);
  await srv.finished(started.id);
  account('googlecalendar');
  await srv.api('/connectors');
  const turn = await srv.nextRun((x) => x.botdot && /use Google Calendar/.test(x.stdin), "the Chief's turn");
  assert.equal(turn.botdot.env.CHIEF_CHAT_ID, chat.id);
  assert.ok(turn.stdin.includes(`Its run ${started.id}, which you started in this chat`));
  srv.release(turn);
  drop('googlecalendar');
});

test('the work carries on when the owner wrote to the bot since, and not after a week (ADR 180)', { timeout: 60_000 }, async () => {
  const wrote = await makeBot(srv, { name: 'Busy Reader', emoji: '📰', connectors: ['todoist'] });
  const a = await heldRun(srv, wrote, 'Read my tasks');
  assert.equal((await run(a.token, 'todoist', 'TODOIST_GET_TASKS')).data.code, 'needs-connect');
  srv.release(a.rec);
  srv.unhold();
  await srv.finished(a.run.id);
  await srv.finished((await srv.api(`/bots/${wrote.id}/run`, { method: 'POST', body: { prompt: 'Never mind, do something else' } })).data.id);

  const late = await makeBot(srv, { name: 'Late Reader', emoji: '🕰️', connectors: ['todoist'] });
  const b = await heldRun(srv, late, 'Read my tasks');
  assert.equal((await run(b.token, 'todoist', 'TODOIST_GET_TASKS')).data.code, 'needs-connect');
  srv.release(b.rec);
  srv.unhold();
  await srv.finished(b.run.id);
  const day = new Date(Date.now() - 7 * 24 * 3600e3 - 3600e3).toISOString();
  writeData(path.join(srv.data, 'asks.json'), stored().map((x) => (x.botId === late.id ? { ...x, at: day, runs: x.runs.map((r) => ({ ...r, at: day })) } : x)));

  account('todoist');
  await srv.api('/connectors');
  assert.deepEqual([...await cardsOf(wrote), ...await cardsOf(late)], [], 'both cards settle');
  assert.deepEqual((await srv.api(`/bots/${late.id}`)).data.connectors, ['todoist']);
  await sleep(100);
  await waitFor(async () => (await runsOf(wrote)).length === 3 && (await runsOf(wrote)).every((r) => r.status !== 'running'), { what: 'the read carrying on' });
  assert.deepEqual((await runsOf(wrote)).filter((r) => r.continues).map((r) => r.continues), [a.run.id], 'it carries on after the owner wrote');
  assert.equal((await runsOf(late)).length, 1, 'not after a week');
  drop('todoist');
});

test('the watch of an open sign-in page settles its card once Composio says ACTIVE, and stops at its end or a refused key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-watch-'));
  const asks = asksLib.create(dir);
  const bot = { id: 'b1', name: 'Writer', connectors: [] };
  const status = { configured: true, keyRejected: false };
  const states = {};
  let asked = 0;
  const connectors = {
    status: () => status, reconnect: () => [], rejectedError: () => new Error('refused'),
    connect: async (slug) => ({ redirectUrl: 'https://x.example/p', connectionId: `ca_${slug}`, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    connection: async (id) => { asked++; return { id, status: states[id] || 'INITIATED' }; },
  };
  const carried = [];
  const C = connectAsksLib.create({ asks, bots: { get: () => bot, update: (id, ch) => Object.assign(bot, ch) }, connectors, appName: (s) => s, carryOnAfter: (a) => { carried.push(a.app); return {}; }, every: 5 });
  try {
    const a = C.offer({ botId: 'b1', app: 'gmail' }).ask;
    await C.connect(a, 'http://x/done');
    await sleep(30);
    assert.ok(asked >= 2, 'it asks while the page is open');
    states.ca_gmail = 'ACTIVE';
    await waitFor(() => carried.includes('gmail'), { what: 'the card to settle' });
    assert.deepEqual(bot.connectors, ['gmail']);
    assert.equal(asks.list().length, 0);

    // A refused key ends the watch; so does the page's end.
    const s = C.offer({ botId: 'b1', app: 'slack' }).ask;
    await C.connect(s, 'http://x/done');
    status.keyRejected = true;
    await sleep(20);
    const at = asked;
    await sleep(30);
    assert.equal(asked, at, 'no more asking with a refused key');
    status.keyRejected = false;
    asks.mark((x) => x.id === s.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    C.watch(s.id);
    await sleep(30);
    assert.equal(asked, at, 'nor after its page expired');
  } finally { C.stopAll(); fs.rmSync(dir, { recursive: true, force: true }); }
});
