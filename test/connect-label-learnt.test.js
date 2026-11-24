// A Reconnect card with `replaces` settles by a working connection made after it with the label of the account it
// replaces (ADR 174, ADR 221, #1322). A connection made again has no label on the list that first shows it: botdot
// reads it from the app's profile just after (lib/connectors.js learnLabels), and the card must settle when that read
// ends, not at some later list, and not never when the read fails. The real connectors module and connect-asks, wired as
// server.js wires them, on a stand-in for Composio's API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const asksLib = require('../lib/asks');
const connectAsksLib = require('../lib/connect-asks');

// accounts: { id: { status, created_at } }; profile: { id: an address | 'refused' (the read answers it failed) | 'down' (HTTP 500) }.
const composio = { accounts: {}, profile: {}, lists: 0 };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/toolkits') return json(200, { items: [], next_cursor: null });
    if (p === '/connected_accounts' && req.method === 'GET') {
      composio.lists++;
      return json(200, { items: Object.entries(composio.accounts).map(([id, a]) => ({ id, toolkit: { slug: 'gmail' }, status: a.status, created_at: a.created_at })) });
    }
    if (p.startsWith('/connected_accounts/') && req.method === 'PATCH') return json(200, { success: true });
    if (p === '/tools/execute/GMAIL_GET_PROFILE') {
      const who = composio.profile[JSON.parse(body).connected_account_id];
      if (who === 'down') return json(500, { error: { message: 'Composio is down for a moment' } });
      return json(200, who && who !== 'refused' ? { successful: true, data: { emailAddress: who } } : { successful: false, error: 'no' });
    }
    return json(404, { message: 'Not here' });
  });
});
let connectorsLib;
before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.COMPOSIO_API_URL = `http://127.0.0.1:${fake.address().port}`; // read when the module loads
  connectorsLib = require('../lib/connectors');
});
after(() => fake.close());

// A Reconnect card for the dead account ca_old (me@x.com), made now, and a new connection a minute later.
async function setup() {
  composio.lists = 0;
  composio.accounts = { ca_old: { status: 'EXPIRED', created_at: '2000-01-01T00:00:00Z' } };
  composio.profile = {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-label-'));
  const connectors = connectorsLib.create(dir);
  await connectors.setKey('pk_test_key_1');
  await connectors.setLabel('ca_old', 'me@x.com');
  const asks = asksLib.create(dir);
  const bot = { id: 'b1', name: 'Writer', connectors: [], accounts: { gmail: 'ca_old' } };
  const bots = { get: (id) => (id === 'b1' ? bot : null), list: () => [bot], update: (id, patch) => Object.assign(bot, patch) };
  const C = connectAsksLib.create({ asks, bots, connectors, appName: asksLib.appWord, carryOnAfter: () => ({}) });
  const lists = []; // each list the listeners get: the first, and one more per label read that ends
  connectors.onConnections((list) => C.listed(list, []));
  connectors.onConnections((list) => lists.push(list));
  const card = C.offer({ botId: 'b1', app: 'gmail', mode: 'reconnect', replaces: 'ca_old' }).ask;
  const open = () => asks.list().some((x) => x.id === card.id);
  const connectAgain = (profile) => {
    composio.accounts.ca_new = { status: 'ACTIVE', created_at: new Date(Date.now() + 60_000).toISOString() };
    composio.profile.ca_new = profile;
  };
  const settledBy = async (n) => { for (let i = 0; i < 200 && lists.length < n; i++) await new Promise((r) => setTimeout(r, 10)); assert.equal(lists.length, n, 'the listeners were told again when the read ended'); };
  return { connectors, bot, open, lists, connectAgain, settledBy, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("the new connection's label arrives after the first list: the card settles then, with no other list asked for", async () => {
  const t = await setup();
  t.connectAgain('Me@X.com');
  const first = await t.connectors.connections();
  assert.equal(first.find((c) => c.id === 'ca_new').label, null, 'the first list has no label for it');
  assert.equal(t.open(), true, 'the card waits while the label is being read');
  await t.settledBy(2);
  assert.equal(t.lists[1].find((c) => c.id === 'ca_new').label, 'Me@X.com', 'the second list has it');
  assert.equal(t.open(), false, 'the card is settled by the label');
  assert.equal(t.bot.accounts.gmail, 'ca_new', 'and the bot moves to the new connection');
  assert.equal(composio.lists, 1, 'Composio was listed once');
  t.done();
});

for (const how of ['refused', 'down']) {
  test(`the profile read fails (${how}): the connection is unlabeled and the card still settles`, async () => {
    const t = await setup();
    t.connectAgain(how);
    await t.connectors.connections();
    assert.equal(t.open(), true, 'waiting while the read runs');
    await t.settledBy(2);
    assert.equal(t.lists[1].find((c) => c.id === 'ca_new').label, null);
    assert.equal(t.open(), false);
    assert.equal(t.bot.accounts.gmail, 'ca_new');
    t.done();
  });
}

test('a learnt label of another account leaves the card, and moves no bot', async () => {
  const t = await setup();
  t.connectAgain('you@y.com');
  await t.connectors.connections();
  await t.settledBy(2);
  assert.equal(t.lists[1].find((c) => c.id === 'ca_new').label, 'you@y.com');
  assert.equal(t.open(), true, 'a connection with another label is another account');
  assert.equal(t.bot.accounts.gmail, 'ca_old');
  t.done();
});

test('a read is made once per connection: a later list asks Composio again and reads nothing more', async () => {
  const t = await setup();
  t.connectAgain('you@y.com');
  await t.connectors.connections();
  await t.settledBy(2);
  await t.connectors.connections();
  assert.equal(t.lists.length, 3, 'one more list, and no read to end after it');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(t.lists.length, 3);
  t.done();
});
