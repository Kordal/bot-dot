// One list of every bot's pages (#361): GET /api/pages, newest first, each with its bot, the kept ones marked; the
// owner's alone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self } = require('./helpers');

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

test('every bot\'s pages in one list, newest first, each with its bot; a kept page says so', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('pages-all'));
  assert.deepEqual((await srv.api('/pages')).data, { pages: [] });
  await savePage(ops, 'hq weekly health', '# hq weekly health');
  await savePage(writer, 'Reddit launch memo', '# Memo');
  await savePage(ops, 'Router ports', '# Ports');
  const kept = (await srv.api(`/bots/${ops.id}/pages/hq-weekly-health/keep`, { method: 'POST', body: { every: 'day', time: '07:00' } })).data;

  const r = await srv.api('/pages');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.pages.map((p) => [p.botId, p.bot, p.slug]), [
    [ops.id, 'Ops', 'router-ports'],
    [writer.id, 'Writer', 'reddit-launch-memo'],
    [ops.id, 'Ops', 'hq-weekly-health'],
  ]);
  const health = r.data.pages.find((p) => p.slug === 'hq-weekly-health');
  assert.equal(health.keep.jobId, kept.job.id);
  assert.equal(health.keep.when, 'Daily at 07:00');
  assert.equal(health.file, 'pages/hq-weekly-health.md');
  assert.equal(r.data.pages.find((p) => p.slug === 'router-ports').keep, null);
});

test('a page whose file is gone is not listed, nor a removed bot\'s pages', async () => {
  fs.rmSync(path.join(srv.data, 'workspaces', ops.id, 'pages', 'router-ports.md'));
  let r = await srv.api('/pages');
  assert.deepEqual(r.data.pages.map((p) => p.slug), ['reddit-launch-memo', 'hq-weekly-health']);
  assert.equal((await srv.api(`/bots/${writer.id}`, { method: 'DELETE' })).status, 200);
  r = await srv.api('/pages');
  assert.deepEqual(r.data.pages.map((p) => p.slug), ['hq-weekly-health']);
});

test('the list is the owner\'s alone', async () => {
  assert.equal((await srv.asChief('/pages')).status, 403);
  assert.equal((await srv.api('/pages', { method: 'POST', body: {} })).status, 405);
});
