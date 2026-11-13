// The Chief's own Connect card (ADR 168, #1182): offer_connect_app puts the card in the Chief's chat, refuses an app
// that works already, and a Chief turn's action on an app that isn't connected makes the same card. Once the app is
// connected, botdot starts a Chief turn in that chat with the app among its connected apps; when the owner wrote
// there since, only botdot's line "Connected: <App>." stands. A bot's run that made such a card counts as needing the
// owner in the outcome ledger. Through the real server, the Chief's own tools (lib/mcp-server.js) and a stand-in for
// Composio's API.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer, makeBot, heldRun, waitFor, sleep } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

// Composio as botdot calls it: accounts are { id, app, status, created_at }.
const composio = { accounts: [] };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/connected_accounts' && req.method === 'GET') return json(200, { items: composio.accounts.map((a) => ({ id: a.id, toolkit: { slug: a.app }, status: a.status, created_at: a.created_at })) });
    if (p.startsWith('/toolkits/')) { const slug = p.split('/').at(-1); return slug === 'nosuchapp' ? json(404, { message: 'Toolkit not found' }) : json(200, { slug, name: slug, composio_managed_auth_schemes: ['OAUTH2'] }); }
    if (p.startsWith('/tools/execute/')) return json(200, { successful: true, data: { done: true } });
    if (p.startsWith('/tools/')) { const slug = p.split('/').at(-1); return json(200, { slug, toolkit: { slug: slug.split('_')[0].toLowerCase() }, no_auth: false, tags: ['readOnlyHint'] }); }
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
after(async () => { srv.unhold(); await srv?.stop(); fake.close(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

let n = 0;
const account = (app, status = 'ACTIVE') => { const a = { id: `ca_${app}_${++n}`, app, status, created_at: new Date().toISOString() }; composio.accounts.push(a); return a; };
const isChief = (x) => !!x.botdot && x.args.includes('🧭 Chief of Staff');
const cards = async () => (await srv.api('/asks?connect-app=1')).data.filter((a) => a.kind === 'connect-app');
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const said = (result) => result.content.map((c) => c.text).join('\n');

// A Chief turn the owner started in `chat` (a new one when none), held until end(); tools: its botdot tools.
async function ownerTurn(t, text, chat = null) {
  srv.hold();
  chat ||= (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const rec = await srv.nextRun((r) => isChief(r) && r.stdin.includes(text), "the Chief's turn");
  const tools = rpcClient(t, 'mcp-server.js', rec.botdot.env);
  let ended = false;
  const end = async (reply = 'Done.') => {
    if (ended) return;
    ended = true;
    srv.reply(reply);
    srv.release(rec);
    srv.unhold();
    await waitFor(async () => !(await chatOf(chat.id)).busy || null, { what: 'the Chief to finish' });
  };
  t.after(() => end());
  return { chat, rec, tools, end };
}

test('offer_connect_app puts the Connect card in this chat, joins it when asked again, and refuses an app that works', async (t) => {
  const turn = await ownerTurn(t, 'What is in my Notion?');
  const offered = (await turn.tools.request('tools/list')).tools.find((x) => x.name === 'offer_connect_app');
  assert.ok(offered, 'the tool is offered');
  assert.match(offered.description, /Only the user connects an app/);
  const r = await turn.tools.json('offer_connect_app', { app: 'Notion', reason: 'To read your notes.' });
  assert.deepEqual([r.asked, r.app, r.name], [true, 'notion', 'Notion']);
  assert.equal(r.note, "Notion isn't connected. The user now has a card in this chat to connect it, and you get a new turn here once it is connected: say so in one line and end your reply.");
  const [card] = (await cards()).filter((a) => a.app === 'notion');
  assert.deepEqual([card.botId, card.chatId, card.mode, card.title, card.reason], [null, turn.chat.id, 'connect', 'Connect Notion', 'To read your notes.']);
  assert.equal((await turn.tools.json('offer_connect_app', { app: 'notion', reason: 'Again.' })).joined, true);
  assert.equal((await cards()).filter((a) => a.app === 'notion').length, 1);
  // An app with a working connection gets no card: the Chief uses it, or gives it with update_bot.
  account('slack');
  const slack = await turn.tools.json('offer_connect_app', { app: 'slack', reason: 'To post.' });
  assert.deepEqual(slack, { asked: false, note: 'Slack is connected already: use it. Every bot has it unless the owner took it away.' });
  assert.equal((await cards()).filter((a) => a.app === 'slack').length, 0);
  const unknown = await turn.tools.call('offer_connect_app', { app: 'nosuchapp', reason: 'x' });
  assert.ok(unknown.isError);
  assert.match(said(unknown), /No app called "nosuchapp"/);
  // list_connectors sends the Chief to the card, not to the Connectors page.
  assert.match((await turn.tools.json('list_connectors', {})).note, /^Only the user connects an app: offer_connect_app puts a Connect card in this chat\./);
  await turn.end();
  // Its card for a bot: connecting it gives the bot the app (its history keeps it as the owner's), and the Chief is
  // told in its chat.
  const bot = await makeBot(srv, { name: 'Planner', emoji: '🗓️' });
  const forBot = await ownerTurn(t, 'Let Planner read my Trello.', turn.chat);
  assert.equal((await forBot.tools.json('offer_connect_app', { app: 'trello', bot: bot.id, reason: 'Planner reads your boards.' })).asked, true);
  await forBot.end();
  assert.equal((await cards()).find((a) => a.app === 'trello').title, 'Connect Trello for Planner');
  // The Chief's own Notion card would start a turn of its own once Composio lists Notion: it goes first.
  await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } });
  account('trello');
  srv.reply('Planner has Trello now.');
  await srv.api('/connectors');
  await waitFor(async () => (await srv.api(`/bots/${bot.id}`)).data.connectors?.includes('trello') || null, { what: 'Planner to have Trello' });
  await srv.nextRun((x) => isChief(x) && /The user said yes on the card for something you asked for in this chat/.test(x.stdin) && /Planner/.test(x.stdin), "the Chief's turn about Planner's app");
  assert.equal((await cards()).filter((a) => a.app === 'trello').length, 0);
});

test("a Chief turn's action on an app that isn't connected makes the card; connecting it starts a Chief turn there that has the app", async (t) => {
  const turn = await ownerTurn(t, 'What are my Linear issues?');
  assert.ok(turn.rec.connectors, 'the turn has connected apps (slack and trello)');
  const apps = rpcClient(t, 'connectors-mcp.js', turn.rec.connectors.env);
  const linear = await apps.call('connector_run', { app: 'linear', action: 'LINEAR_LIST_ISSUES', arguments: {} });
  assert.equal(said(linear), "Error: Linear isn't connected, so nothing was done. The user now has a card in this chat to connect it, and you get a new turn here once it is connected: say so in one line and end your reply.");
  const [card] = (await cards()).filter((a) => a.app === 'linear');
  assert.deepEqual([card.botId, card.chatId, card.title], [null, turn.chat.id, 'Connect Linear']);
  await turn.end();
  // Linear connected (on the Connectors page): the card settles, and the Chief's turn in that chat has Linear.
  account('linear');
  srv.hold();
  await srv.api('/connectors');
  const rec = await srv.nextRun((x) => isChief(x) && x.stdin.includes('The user connected Linear from the card you offered in this chat.'), "the Chief's turn after the connection");
  assert.equal(rec.botdot.env.BOT_DOT_TURN, 'botdot', "botdot's turn, not the owner's");
  assert.ok(rec.connectors, 'it has connected apps');
  assert.ok(rec.connectors.env.CONNECTOR_APPS.split(',').includes('linear'));
  assert.match(rec.stdin, /Your chat needed Linear\./);
  assert.equal((await cards()).filter((a) => a.app === 'linear').length, 0, 'the card is settled');
  srv.reply('Here are your Linear issues.');
  srv.release(rec);
  srv.unhold();
  await waitFor(async () => (await chatOf(turn.chat.id)).messages.some((m) => m.role === 'chief' && !m.pending && m.text === 'Here are your Linear issues.') || null, { what: 'its reply' });
});

test('when the owner wrote in that chat since the card, connecting it starts no turn: only "Connected: <App>." stands there', async (t) => {
  const turn = await ownerTurn(t, 'Add a task in Todoist.');
  assert.equal((await turn.tools.json('offer_connect_app', { app: 'todoist', reason: 'To add your task.' })).asked, true);
  await turn.end();
  await sleep(5); // the owner's next message is after the card
  const later = await ownerTurn(t, 'Never mind, something else.', turn.chat);
  await later.end();
  const before = srv.runs().length;
  account('todoist');
  await srv.api('/connectors');
  await waitFor(async () => (await chatOf(turn.chat.id)).messages.some((m) => m.text === 'Connected: Todoist.') || null, { what: "botdot's line" });
  assert.equal((await cards()).filter((a) => a.app === 'todoist').length, 0);
  await sleep(300);
  assert.ok(!srv.runs().slice(before).some((x) => isChief(x) && x.stdin.includes('The user connected Todoist')), 'no Chief turn');
});

test("a bot's run that made a Connect card counts as needing the owner in the ledger", async () => {
  const bot = await makeBot(srv, { name: 'Mail Reader', emoji: '📬', connectors: ['gmail'] });
  srv.reply('Gmail is not connected yet.');
  const held = await heldRun(srv, bot, 'Summarise my inbox');
  const r = await srv.api('/connectors/session/run', { method: 'POST', body: { app: 'gmail', action: 'GMAIL_FETCH_EMAILS', arguments: {} }, headers: { 'X-Run-Token': held.token } });
  assert.equal(r.data.code, 'needs-connect');
  srv.release(held.rec);
  srv.unhold();
  await srv.finished(held.run.id);
  const o = await waitFor(async () => (await srv.api(`/bots/${bot.id}/outcomes`)).data.outcomes.find((x) => x.runId === held.run.id), { what: 'its row' });
  assert.equal(o.outcome, 'needs_you');
});
