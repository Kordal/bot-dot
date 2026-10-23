// A page on the Board (#451): a tile of kind "page" that shows a bot's page, put there or taken off by the owner's
// switch (PUT …/pages/<slug>/board), by the Chief's add_tile, or by the owner's Add on a bot's suggestion.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor } = require('./helpers');

let srv; let ops; let writer;
before(async () => {
  srv = await startServer();
  ops = await makeBot(srv, { name: 'Ops', emoji: '🛠', allowedTools: [] });
  writer = await makeBot(srv, { name: 'Writer', emoji: '✍', allowedTools: [] });
});
after(async () => { srv.unhold(); await srv.stop(); });

async function savePage(bot, title, markdown) {
  const { run, rec, token } = await heldRun(srv, bot, `Make the page ${title}`);
  const r = await self(srv, token, 'page', { title, markdown });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  srv.release(rec);
  await srv.finished(run.id);
  return r.data.page;
}
const board = async () => (await srv.api('/dashboard?quiet')).data;
const pageTiles = async () => (await board()).tiles.filter((t) => t.kind === 'page');

test('the owner shows a page on the Board and takes it off; no page is there before', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('pages-board'));
  await savePage(ops, 'Weekly health', '# Weekly health\n\n```kpi\n[{"label":"Up","value":"3/3"},{"label":"Disk","value":41,"unit":"%"}]\n```\n');
  await savePage(writer, 'Launch memo', '# Launch memo\n\nPost on **Tuesday** at 15:00, then answer [every](https://example.com) comment.\n');
  assert.deepEqual(await pageTiles(), [], 'nothing on the Board by itself');
  assert.equal((await srv.api('/pages')).data.pages.every((p) => p.onBoard === false), true);

  let r = await srv.api(`/bots/${ops.id}/pages/weekly-health/board`, { method: 'PUT', body: { on: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.page.onBoard, true);
  r = await srv.api(`/bots/${writer.id}/pages/launch-memo/board`, { method: 'PUT', body: { on: true } });
  assert.equal(r.data.page.onBoard, true);
  assert.equal((await srv.api(`/bots/${ops.id}/pages/weekly-health/board`, { method: 'PUT', body: { on: true } })).status, 200, 'twice is once');

  const d = await board();
  const tiles = d.tiles.filter((t) => t.kind === 'page');
  assert.equal(tiles.length, 2);
  const health = tiles.find((t) => t.page.slug === 'weekly-health');
  assert.equal(health.title, 'Weekly health');
  assert.equal(health.section, 'Pages');
  assert.equal(health.bot, ops.id);
  assert.deepEqual(health.page, { bot: ops.id, slug: 'weekly-health', updatedAt: health.at, kind: 'markdown' });
  assert.equal(health.look.face[0].type, 'row');
  assert.deepEqual(health.look.face[0].blocks.map((b) => [b.label, b.text]), [['Up', '3/3'], ['Disk', '41']]);
  assert.equal(health.look.short, '3/3');
  assert.equal(health.look.dot, null);
  const memo = tiles.find((t) => t.page.slug === 'launch-memo');
  assert.deepEqual(memo.look.face, [{ type: 'text', text: 'Post on Tuesday at 15:00, then answer every comment.', lines: 3 }]);
  assert.ok(d.home.includes(health.id), 'on home like any tile while home is automatic');

  assert.equal((await srv.api(`/bots/${ops.id}/pages/weekly-health`)).status, 200);
  assert.equal((await srv.api(`/bots/${ops.id}/pages`)).data.pages[0].onBoard, true);
  assert.equal((await srv.api(`/bots/${ops.id}/pages/weekly-health?view=1`)).data.page.onBoard, true);

  r = await srv.api(`/bots/${writer.id}/pages/launch-memo/board`, { method: 'PUT', body: { on: false } });
  assert.equal(r.data.page.onBoard, false);
  assert.deepEqual((await pageTiles()).map((t) => t.page.slug), ['weekly-health']);
  assert.ok(fs.existsSync(path.join(srv.data, 'workspaces', writer.id, 'pages', 'launch-memo.md')), 'the page stays');
  assert.equal((await srv.api(`/bots/${ops.id}/pages/weekly-health/board`, { method: 'PUT', body: {} })).status, 400);
  assert.equal((await srv.asChief(`/bots/${ops.id}/pages/weekly-health/board`, { method: 'PUT', body: { on: true } })).status, 403);
});

test('removing the tile takes the page off; a page tile takes no value and no sources', async () => {
  const t = (await pageTiles())[0];
  assert.equal((await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'page', title: 'X', page: { bot: writer.id, slug: 'launch-memo' }, read: { type: 'script', script: 'echo 1' } } })).status, 400);
  assert.equal((await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'page', title: 'X', page: { bot: writer.id, slug: 'nope' } } })).status, 400);
  assert.equal((await srv.api(`/dashboard/tiles/${t.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await srv.api(`/bots/${ops.id}/pages`)).data.pages[0].onBoard, false);
});

test('the Chief puts a page on the Board by its title, as any tile, at once', async () => {
  const r = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'page', title: 'Memo', section: 'Work', page: { bot: writer.id, slug: 'Launch memo' } } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.approved, true);
  assert.deepEqual(r.data.page, { bot: writer.id, slug: 'launch-memo', updatedAt: r.data.page.updatedAt, kind: 'markdown' });
  assert.equal(r.data.title, 'Launch memo', 'the page\'s own title');
  assert.equal((await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'page', title: 'Again', page: { bot: writer.id, slug: 'launch-memo' } } })).data.error, 'That page is already on the Board.');
  await srv.api(`/dashboard/tiles/${r.data.id}`, { method: 'DELETE' });
});

test('a bot suggests its own page; Add puts it there', async () => {
  const { run, rec, token } = await heldRun(srv, ops);
  const s = await self(srv, token, 'suggest', { tile: { kind: 'page', title: 'Weekly health', page: { bot: writer.id, slug: 'weekly-health' } }, reason: 'You open it every morning.' });
  assert.equal(s.data.ok, true, JSON.stringify(s.data));
  srv.release(rec);
  await srv.finished(run.id);
  const sug = (await board()).suggestions[0];
  assert.deepEqual(sug.tile.page, { bot: ops.id, slug: 'weekly-health' }, 'its own page, whatever bot it named');
  const added = await srv.api(`/dashboard/suggestions/${s.data.id}`, { method: 'POST', body: { add: true } });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.equal(added.data.tile.kind, 'page');
  assert.equal((await srv.api(`/bots/${ops.id}/pages`)).data.pages[0].onBoard, true);
});

test('a page tile is hidden while its page is gone, and goes with its bot', async () => {
  await srv.api(`/bots/${writer.id}/pages/launch-memo/board`, { method: 'PUT', body: { on: true } });
  fs.renameSync(path.join(srv.data, 'workspaces', writer.id, 'pages', 'launch-memo.md'), path.join(srv.data, 'workspaces', writer.id, 'memo.bak'));
  let d = await board();
  assert.deepEqual(d.tiles.filter((t) => t.kind === 'page').map((t) => t.page.slug), ['weekly-health']);
  assert.equal(d.home.some((id) => !d.tiles.some((t) => t.id === id)), false, 'nor on home');
  fs.renameSync(path.join(srv.data, 'workspaces', writer.id, 'memo.bak'), path.join(srv.data, 'workspaces', writer.id, 'pages', 'launch-memo.md'));
  assert.equal((await pageTiles()).length, 2, 'back with its page');
  for (const run of (await srv.api(`/runs?botId=${ops.id}`)).data) await srv.api(`/runs/${run.id}/stop`, { method: 'POST' }); // its carry on after Add
  await waitFor(async () => (await srv.api(`/bots/${ops.id}`, { method: 'DELETE' })).status === 200, { what: 'Ops deleted' });
  d = await board();
  assert.deepEqual(d.tiles.filter((t) => t.kind === 'page').map((t) => t.page.bot), [writer.id]);
});

test('a bot cannot write a value on a page tile', async () => {
  const { run, rec, token } = await heldRun(srv, writer);
  const t = (await pageTiles())[0];
  const r = await self(srv, token, 'tile', { id: t.id, value: 'x' });
  assert.equal(r.data.ok, false, JSON.stringify(r.data));
  assert.doesNotMatch(r.data.error, /page/, 'not among its tiles');
  srv.release(rec);
  await srv.finished(run.id);
});

test("the Chief's page goes on the Board too", async () => {
  const saved = await srv.asChief('/chief/pages', { method: 'POST', body: { title: 'Team overview', markdown: '# Team overview\n\nTwo bots.' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const r = await srv.api('/bots/chief/pages/team-overview/board', { method: 'PUT', body: { on: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = (await pageTiles()).find((x) => x.page.bot === 'chief');
  assert.equal(t.bot, null);
  assert.deepEqual(t.look.face, [{ type: 'text', text: 'Two bots.', lines: 3 }]);
  assert.equal((await srv.api('/bots/chief/pages')).data.pages[0].onBoard, true);
});
