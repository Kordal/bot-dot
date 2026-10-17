// Bots and runs: create, change, delete; a run starts, finishes, and can be stopped.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('create, change and delete a bot', async () => {
  const bot = await makeBot(srv, { name: 'Home Keeper', emoji: '🏠', description: 'Keeps the home' });
  assert.equal(bot.name, 'Home Keeper');
  let r = await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { description: 'Keeps the home tidy' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.description, 'Keeps the home tidy');
  r = await srv.api('/bots');
  assert.ok(r.data.some((b) => b.id === bot.id));
  r = await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  r = await srv.api('/bots');
  assert.ok(!r.data.some((b) => b.id === bot.id));
});

test('pinned bots keep their own order below the Chief', async () => {
  const [a, b, c] = [await makeBot(srv, { name: 'Pin A' }), await makeBot(srv, { name: 'Pin B' }), await makeBot(srv, { name: 'Pin C' })];
  const put = (bot, body) => srv.api(`/bots/${bot.id}`, { method: 'PUT', body });
  const order = async () => (await srv.api('/bots')).data.filter((x) => x.pinned > 0).sort((x, y) => x.pinned - y.pinned).map((x) => x.name);
  assert.equal(a.pinned, 0);
  await put(a, { pinned: true });
  await put(b, { pinned: true });
  assert.deepEqual(await order(), ['Pin A', 'Pin B']);
  await put(c, { pinned: 1 }); // first
  assert.deepEqual(await order(), ['Pin C', 'Pin A', 'Pin B']);
  await put(b, { pinned: 2, description: 'moved' });
  assert.deepEqual(await order(), ['Pin C', 'Pin B', 'Pin A']);
  await put(b, { pinned: true }); // already pinned: stays where it is
  assert.deepEqual(await order(), ['Pin C', 'Pin B', 'Pin A']);
  await put(c, { pinned: 0 });
  assert.deepEqual(await order(), ['Pin B', 'Pin A']);
  // Saving other settings with the bot's current place doesn't move it.
  const r = await put(a, { pinned: 2, description: 'still second' });
  assert.equal(r.data.pinned, 2);
  await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
  assert.deepEqual(await order(), ['Pin A']);
  assert.equal((await srv.api(`/bots/${a.id}`)).data.pinned, 1);
});

test('bots keep your order in their group, and move between groups where you drop them', async () => {
  const mk = (name, group) => makeBot(srv, { name, group });
  const [a, b, c, d] = [await mk('Ord B', 'Ord1'), await mk('Ord A', 'Ord1'), await mk('Ord C', 'Ord1'), await mk('Ord D', 'Ord2')];
  const put = (bot, body) => srv.api(`/bots/${bot.id}`, { method: 'PUT', body });
  const order = async (g) => (await srv.api('/bots')).data.filter((x) => x.group === g && !x.pinned).sort((x, y) => x.order - y.order).map((x) => x.name);
  assert.deepEqual(await order('Ord1'), ['Ord B', 'Ord A', 'Ord C'], 'new bots go last');
  await put(c, { order: 1 });
  assert.deepEqual(await order('Ord1'), ['Ord C', 'Ord B', 'Ord A']);
  await put(a, { group: 'Ord2', order: 1 }); // dragged into another group, on top
  assert.deepEqual(await order('Ord1'), ['Ord C', 'Ord A']);
  assert.deepEqual(await order('Ord2'), ['Ord B', 'Ord D']);
  await put(d, { group: 'Ord1' }); // a new group from the settings: last there
  assert.deepEqual(await order('Ord1'), ['Ord C', 'Ord A', 'Ord D']);
  await put(c, { group: 'Ord2', order: 1 }); // first in the other group, though it was first here too
  assert.deepEqual(await order('Ord2'), ['Ord C', 'Ord B']);
  await put(c, { group: 'Ord1', order: 1 });
  assert.deepEqual(await order('Ord1'), ['Ord C', 'Ord A', 'Ord D']);
  // Pinned: out of its group's order; unpinned where you drop it.
  await put(b, { pinned: true });
  assert.equal((await srv.api(`/bots/${b.id}`)).data.order, 0);
  assert.deepEqual(await order('Ord1'), ['Ord C', 'Ord D']);
  await put(b, { pinned: 0, group: 'Ord1', order: 1 });
  assert.deepEqual(await order('Ord1'), ['Ord A', 'Ord C', 'Ord D']);
  // Saving other settings with the same place doesn't move it.
  await put(b, { order: 1, description: 'same place' });
  assert.deepEqual(await order('Ord1'), ['Ord A', 'Ord C', 'Ord D']);
  await srv.api(`/bots/${c.id}`, { method: 'DELETE' });
  assert.deepEqual(await order('Ord1'), ['Ord A', 'Ord D']);
  assert.deepEqual((await srv.api('/bots')).data.filter((x) => x.group === 'Ord1').map((x) => x.order).sort(), [1, 2]);
});

test('a run starts, gets the message, and finishes with the reply', async () => {
  srv.unhold();
  srv.reply('All tidy.');
  const bot = await makeBot(srv);
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Is the home tidy?' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'running');
  const done = await srv.finished(r.data.id);
  assert.equal(done.status, 'success');
  assert.equal(done.result, 'All tidy.');
  const rec = srv.runs().find((x) => x.args.includes(`${bot.emoji} ${bot.name}`));
  assert.match(rec.stdin, /Is the home tidy\?/);
  const list = await srv.api(`/runs?botId=${bot.id}`);
  assert.equal(list.data[0].id, r.data.id);
});

test('a run can be stopped', async () => {
  const bot = await makeBot(srv, { name: 'Slow Bot' });
  const { run } = await heldRun(srv, bot);
  const r = await srv.api(`/runs/${run.id}/stop`, { method: 'POST' });
  assert.equal(r.data.ok, true);
  const done = await srv.finished(run.id);
  assert.equal(done.status, 'stopped');
  srv.unhold();
});

test('runs have no spending cap, even for a bot saved with one', async () => {
  const bot = await makeBot(srv, { name: 'Old Saver', maxBudgetUsd: 2 });
  assert.equal(bot.maxBudgetUsd, undefined);
  const { rec, run } = await heldRun(srv, bot);
  assert.ok(!rec.args.includes('--max-budget-usd'));
  srv.release(rec);
  await srv.finished(run.id);
});

test('a failed run comes with the problem said plainly, for the web page and the phone', async () => {
  srv.unhold();
  const fail = require('path').join(srv.out, 'fail.txt');
  require('fs').writeFileSync(fail, 'API Error: getaddrinfo ENOTFOUND api.anthropic.com');
  try {
    const bot = await makeBot(srv, { name: 'Offline' });
    const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Anything new?' } });
    const done = await srv.finished(r.data.id);
    assert.equal(done.status, 'error');
    assert.match(done.error, /ENOTFOUND/, 'the raw error stays for the details');
    assert.match(done.problem, /couldn't reach Claude's servers/);
    assert.match((await srv.api(`/runs?botId=${bot.id}`)).data[0].problem, /couldn't reach Claude's servers/);
  } finally { require('fs').rmSync(fail, { force: true }); }
});
