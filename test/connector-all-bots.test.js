// Every bot has every connected app (ADR 231): an app connected before or after a bot is made is the bot's with no
// card; the owner only takes one away, from the bot's settings or the Apps page, and that stays so, also after the
// app is disconnected and connected again. Against a real botdot server and the stand-in connected app.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, fakeConnectedApp } = require('./helpers');

const connected = ['gmail'];
let app, srv;
before(async () => {
  app = await fakeConnectedApp({ connected });
  srv = await startServer({ env: app.env });
  await app.connect(srv);
  await srv.api('/connectors');
});
after(async () => { await srv.stop(); app.close(); });

const appsOf = async (bot) => (await srv.api(`/bots/${bot.id}`)).data.connectors;
const saved = (bot) => JSON.parse(fs.readFileSync(path.join(srv.data, 'bots.json'), 'utf8')).find((b) => b.id === bot.id);

test('a new bot has every connected app, and one connected later too, with no card', async () => {
  const bot = await makeBot(srv, { name: 'Every app' });
  assert.deepEqual(await appsOf(bot), ['gmail']);
  connected.push('slack');
  await srv.api('/connectors'); // botdot lists the connections again
  assert.deepEqual((await appsOf(bot)).sort(), ['gmail', 'slack']);
  assert.deepEqual((await srv.api('/asks')).data.filter((a) => a.botId === bot.id), [], 'no card gives it the app');
  const list = (await srv.api('/connectors')).data.connections;
  assert.ok(list.find((c) => c.toolkit === 'slack').usedBy.includes(bot.id), 'the Apps page lists it among the bots that use the app');
});

test('the owner takes an app away in the bot\'s settings, and gives it back', async () => {
  const bot = await makeBot(srv, { name: 'No mail' });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { connectors: ['slack'] } });
  assert.deepEqual(await appsOf(bot), ['slack']);
  assert.deepEqual(saved(bot).appsOff, ['gmail']);
  const other = await makeBot(srv, { name: 'Has mail' });
  assert.ok((await appsOf(other)).includes('gmail'), 'only that bot lost it');
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { connectors: ['slack', 'gmail'] } });
  assert.deepEqual((await appsOf(bot)).sort(), ['gmail', 'slack']);
  assert.deepEqual(saved(bot).appsOff, []);
});

test('the Apps page takes an app away from the bots left out, and only from them', async () => {
  const a = await makeBot(srv, { name: 'Keeps slack' });
  const b = await makeBot(srv, { name: 'Loses slack' });
  const all = (await srv.api('/bots')).data.filter((x) => x.connectors.includes('slack')).map((x) => x.id);
  await srv.api('/connectors/apps/slack/bots', { method: 'PUT', body: { bots: all.filter((id) => id !== b.id) } });
  assert.ok((await appsOf(a)).includes('slack'));
  assert.ok(!(await appsOf(b)).includes('slack'));
  assert.deepEqual(saved(b).appsOff, ['slack']);
});

test('an app taken away stays away after it is disconnected and connected again; the others get it back', async () => {
  const off = await makeBot(srv, { name: 'Never slack' });
  const on = await makeBot(srv, { name: 'Slack again' });
  await srv.api(`/bots/${off.id}`, { method: 'PUT', body: { connectors: ['gmail'] } });
  connected.splice(connected.indexOf('slack'), 1); // gone from Composio's list
  await srv.api('/connectors');
  await srv.api(`/bots/${on.id}`, { method: 'PUT', body: { connectors: ['gmail'] } }); // its settings saved meanwhile
  assert.deepEqual(saved(on).appsOff, [], 'losing an app that is gone is not taking it away');
  connected.push('slack');
  await srv.api('/connectors');
  assert.ok((await appsOf(on)).includes('slack'), 'connected again, every bot has it');
  assert.ok(!(await appsOf(off)).includes('slack'), 'the one the owner took it from still has it off');
});

test('the Chief giving back an app the owner took away waits for the owner, as a new app did', async () => {
  const bot = await makeBot(srv, { name: 'Asks back' });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { connectors: [] } });
  assert.deepEqual(await appsOf(bot), []);
  await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { connectors: ['gmail'] } });
  assert.deepEqual(await appsOf(bot), [], 'held on a card');
  assert.ok((await srv.api('/asks')).data.some((a) => a.botId === bot.id && a.kind === 'bot-change'), 'its card waits in Needs you');
});

test('a copy keeps what was taken from the original', async () => {
  const bot = await makeBot(srv, { name: 'Original' });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { connectors: ['gmail'] } });
  const copy = (await srv.api(`/bots/${bot.id}/duplicate`, { method: 'POST', body: {} })).data;
  const made = copy.bot || copy;
  assert.deepEqual(await appsOf(made), ['gmail']);
  assert.deepEqual(saved(made).appsOff, ['slack']);
});
