// One order for everything pinned (#276, ADR 057): a bot's `pinned` and a group's count in one sequence, so a group
// can stand before a bot on the Pinned page. Pinning, moving, unpinning or deleting either kind numbers both again,
// and a botdot server from before it keeps its view on the first start: the pinned groups after the pinned bots.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, makeBot, readData } = require('./helpers');

let srv;
const id = {};
before(async () => {
  srv = await startServer();
  for (const name of ['Builder', 'Quoter', 'Cook', 'Writer']) id[name] = (await makeBot(srv, { name })).id;
});
after(() => srv?.stop());

const putBot = (name, body) => srv.api(`/bots/${id[name]}`, { method: 'PUT', body });
const putGroup = (name, body) => srv.api(`/group-chats/${id[name]}`, { method: 'PUT', body });
// The Pinned page as the server's places say it: every pinned bot and group by `pinned`, as "name:place".
async function pinned() {
  const bots = (await srv.api('/bots')).data, groups = (await srv.api('/group-chats')).data;
  return [...bots, ...groups].filter((x) => x.pinned > 0).sort((a, b) => a.pinned - b.pinned).map((x) => `${x.name}:${x.pinned}`);
}

test('features has pins-shared', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('pins-shared'));
});

test('a group moves among the pinned bots, and a bot below a group, in one order', async () => {
  for (const [name, members] of [['Builder Team', [id.Builder, id.Cook]], ['Quoter Team', [id.Quoter, id.Cook]]]) {
    id[name] = (await srv.api('/group-chats', { method: 'POST', body: { name, members } })).data.id;
  }
  await putBot('Builder', { pinned: true });
  await putBot('Quoter', { pinned: true });
  await putGroup('Builder Team', { pinned: true });
  await putGroup('Quoter Team', { pinned: true });
  assert.deepEqual(await pinned(), ['Builder:1', 'Quoter:2', 'Builder Team:3', 'Quoter Team:4'], 'pinned last, after everything pinned');
  // The issue's two moves: a group onto the first bot's place, then the other group onto that bot's place.
  assert.equal((await putGroup('Builder Team', { pinned: 1 })).status, 200);
  assert.deepEqual(await pinned(), ['Builder Team:1', 'Builder:2', 'Quoter:3', 'Quoter Team:4']);
  await putGroup('Quoter Team', { pinned: 2 });
  assert.deepEqual(await pinned(), ['Builder Team:1', 'Quoter Team:2', 'Builder:3', 'Quoter:4']);
  // A bot below a group, and back first.
  await putBot('Quoter', { pinned: 1 });
  assert.deepEqual(await pinned(), ['Quoter:1', 'Builder Team:2', 'Quoter Team:3', 'Builder:4']);
  await putBot('Builder', { pinned: 3 });
  assert.deepEqual(await pinned(), ['Quoter:1', 'Builder Team:2', 'Builder:3', 'Quoter Team:4']);
  // true keeps a pinned one where it is.
  await putGroup('Builder Team', { pinned: true });
  await putBot('Builder', { pinned: true });
  assert.deepEqual(await pinned(), ['Quoter:1', 'Builder Team:2', 'Builder:3', 'Quoter Team:4']);
});

test('unpinning either kind closes the gap and the others keep their order', async () => {
  await putGroup('Builder Team', { pinned: 0 });
  assert.deepEqual(await pinned(), ['Quoter:1', 'Builder:2', 'Quoter Team:3']);
  await putBot('Quoter', { pinned: 0 });
  assert.deepEqual(await pinned(), ['Builder:1', 'Quoter Team:2']);
  // Out of the pinned ones by a move to a category, as the list's drag sends it.
  await putGroup('Builder Team', { pinned: 1 });
  await putBot('Cook', { pinned: 2 });
  assert.deepEqual(await pinned(), ['Builder Team:1', 'Cook:2', 'Builder:3', 'Quoter Team:4']);
  await putBot('Cook', { group: '', order: 1, pinned: 0 });
  await putGroup('Builder Team', { category: '', order: 1, pinned: 0 });
  assert.deepEqual(await pinned(), ['Builder:1', 'Quoter Team:2']);
});

test('deleting a pinned bot or a pinned group closes the gap for both kinds', async () => {
  await putBot('Writer', { pinned: 1 });
  await putGroup('Builder Team', { pinned: 2 });
  assert.deepEqual(await pinned(), ['Writer:1', 'Builder Team:2', 'Builder:3', 'Quoter Team:4']);
  assert.equal((await srv.api(`/bots/${id.Writer}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await pinned(), ['Builder Team:1', 'Builder:2', 'Quoter Team:3']);
  assert.equal((await srv.api(`/group-chats/${id['Builder Team']}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await pinned(), ['Builder:1', 'Quoter Team:2']);
});

test('the order is kept across a restart', async () => {
  await putGroup('Quoter Team', { pinned: 1 });
  const was = await pinned();
  assert.deepEqual(was, ['Quoter Team:1', 'Builder:2']);
  srv = await restartServer(srv);
  assert.deepEqual(await pinned(), was);
});

test('on the first start with one order, the pinned groups keep their place after the pinned bots', async () => {
  // As a server from before kept them: the groups numbered among the groups, from 1, and no pins.json.
  srv = await restartServer(srv, (data) => {
    const bots = readData(data, 'bots.json');
    const pin = { Builder: 1, Quoter: 2 };
    for (const b of bots) b.pinned = pin[b.name] || 0;
    fs.writeFileSync(path.join(data, 'bots.json'), JSON.stringify(bots, null, 2));
    const groups = readData(data, 'groups.json');
    for (const g of groups) { g.pinned = 1; g.order = 0; }
    fs.writeFileSync(path.join(data, 'groups.json'), JSON.stringify(groups, null, 2));
    fs.rmSync(path.join(data, 'pins.json'));
  });
  assert.deepEqual(await pinned(), ['Builder:1', 'Quoter:2', 'Quoter Team:3']);
  assert.deepEqual(readData(srv.data, 'pins.json'), { shared: 1 });
  // Once: a later start leaves the places alone.
  await putGroup('Quoter Team', { pinned: 1 });
  srv = await restartServer(srv);
  assert.deepEqual(await pinned(), ['Quoter Team:1', 'Builder:2', 'Quoter:3']);
});
