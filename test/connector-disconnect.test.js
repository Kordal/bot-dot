// Disconnect always takes the app off the owner's list and off the bots (#463), whatever Composio answers: a key it
// refuses, a connection already gone, its own failure. Composio's delete keeps the record, so it may still list it.
// A stand-in for Composio's API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startServer } = require('./helpers');

const KEY = 'pk_disconnect_test_1';
// accounts: id -> app. answer: what the delete of an id gets ('ok' keeps listing it, as Composio's soft delete may).
const fake = { accounts: {}, answer: {}, dead: false, deleted: [] };
const composio = http.createServer((req, res) => {
  const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  const url = new URL(req.url, 'http://x');
  if (req.headers['x-api-key'] !== KEY || (fake.dead && url.pathname !== '/toolkits')) return json(401, { message: 'Bad key' });
  if (url.pathname === '/toolkits') return json(200, { items: [], next_cursor: null });
  if (url.pathname.startsWith('/toolkits/')) { const slug = url.pathname.split('/')[2]; return json(200, { slug, name: slug === 'github' ? 'GitHub' : slug }); }
  const user = url.searchParams.get('user_ids');
  if (url.pathname === '/connected_accounts') return json(200, { items: Object.entries(fake.accounts).map(([id, slug]) => ({ id, user_id: user, toolkit: { slug }, status: 'ACTIVE' })) });
  const [, , id, more] = url.pathname.split('/');
  if (!(id in fake.accounts)) return json(404, { message: 'No such account' });
  if (req.method === 'POST' && more === 'revoke') return json(500, { message: 'The app refused the revoke' }); // already revoked at the app
  if (req.method === 'GET') return json(200, { id, user_id: fake.user, toolkit: { slug: fake.accounts[id] }, status: 'ACTIVE' });
  if (req.method === 'DELETE') {
    fake.deleted.push(id);
    const a = fake.answer[id] || 'ok';
    if (a === '5xx') return json(503, { message: 'Try later' });
    if (a === 'gone') { delete fake.accounts[id]; return json(404, { message: 'No such account' }); }
    return json(200, { success: true }); // soft delete: still listed
  }
  return json(404, { message: 'Not here' });
});

let srv;
before(async () => {
  await new Promise((r) => composio.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { COMPOSIO_API_URL: `http://127.0.0.1:${composio.address().port}` } });
  assert.equal((await srv.api('/connectors/key', { method: 'PUT', body: { key: KEY } })).data.configured, true);
  fake.user = JSON.parse(require('fs').readFileSync(require('path').join(srv.data, 'connectors.json'), 'utf8')).userId;
});
after(async () => { await srv?.stop(); composio.close(); });

async function botWith(app) {
  const bot = (await srv.api('/bots', { method: 'POST', body: { name: `Uses ${app}`, prompt: 'x' } })).data;
  await srv.api(`/connectors/apps/${app}/bots`, { method: 'PUT', body: { bots: [bot.id] } });
  return bot;
}
const listed = async () => (await srv.api('/connectors')).data.connections.map((c) => c.id);
const botApps = async (bot) => (await srv.api('/bots')).data.find((b) => b.id === bot.id).connectors || [];

test('a delete Composio takes but still lists leaves the list and the bots, with nothing to say', async () => {
  fake.accounts.ca_github = 'github';
  const bot = await botWith('github');
  assert.deepEqual(await listed(), ['ca_github']);
  const r = await srv.api('/connectors/connections/ca_github', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(r.data.note ?? null, null);
  assert.ok(fake.deleted.includes('ca_github'), 'deleted in Composio even though its revoke failed');
  assert.deepEqual(await listed(), [], 'gone from the list though Composio still lists it');
  assert.deepEqual(await botApps(bot), []);
});

test('a connection already gone in Composio (404) is simply removed', async () => {
  fake.accounts.ca_notion = 'notion';
  const bot = await botWith('notion');
  await listed();
  fake.answer.ca_notion = 'gone';
  const r = await srv.api('/connectors/connections/ca_notion', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(r.data.note ?? null, null);
  assert.deepEqual(await botApps(bot), []);
});

test('Composio failing the delete (5xx) still removes it here, and says it may be left there', async () => {
  fake.accounts.ca_slack = 'slack';
  const bot = await botWith('slack');
  await listed();
  fake.answer.ca_slack = '5xx';
  const r = await srv.api('/connectors/connections/ca_slack', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.match(r.data.note, /^slack is off your list, but Composio didn't confirm removing it/);
  assert.ok(!(await listed()).includes('ca_slack'));
  assert.deepEqual(await botApps(bot), []);
});

test('another connection of the same app keeps the bots on it', async () => {
  fake.accounts.ca_gmail_1 = 'gmail';
  fake.accounts.ca_gmail_2 = 'gmail';
  const bot = await botWith('gmail');
  await listed();
  await srv.api('/connectors/connections/ca_gmail_1', { method: 'DELETE' });
  assert.deepEqual(await listed(), ['ca_gmail_2']);
  assert.deepEqual(await botApps(bot), ['gmail']);
});

test('a key Composio refuses still takes the app off the bots, and says it may be left there', async () => {
  fake.accounts.ca_linear = 'linear';
  const bot = await botWith('linear');
  await listed();
  fake.dead = true;
  const r = await srv.api('/connectors/connections/ca_linear', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.match(r.data.note, /is off your list, but Composio didn't confirm removing it/);
  assert.deepEqual(await botApps(bot), []);
  const page = (await srv.api('/connectors')).data;
  assert.equal(page.keyRejected, true);
  assert.deepEqual(page.connections, [], 'nothing shown as connected on a key Composio refuses');
  fake.dead = false;
  assert.ok(!(await listed()).includes('ca_linear'), 'still off the list once the key works again');
});

test('a connection of another Composio user is not removed', async () => {
  fake.accounts.ca_other = 'figma';
  const user = fake.user;
  fake.user = 'someone-else';
  const r = await srv.api('/connectors/connections/ca_other', { method: 'DELETE' });
  fake.user = user;
  assert.equal(r.status, 403);
  assert.ok(!fake.deleted.includes('ca_other'));
  assert.ok((await listed()).includes('ca_other'));
});
