// Pages (#346, ADR 065): a bot saves a page in Markdown with save_page, the run lists it, the owner lists and opens a
// bot's pages, and one tap keeps a page up to date: an AI job of the owner's, approved with no card.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, feed } = require('./helpers');
const pagesLib = require('../lib/pages');

let srv; let bot;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Ops', emoji: '🛠', allowedTools: [] });
});
after(async () => { srv.unhold(); await srv.stop(); });

const ws = () => path.join(srv.data, 'workspaces', bot.id);

test('slugs and schedules are made on the server', () => {
  assert.equal(pagesLib.slugOf('hq weekly health'), 'hq-weekly-health');
  assert.equal(pagesLib.slugOf('Zażółć gęślą jaźń!'), 'zazolc-gesla-jazn');
  assert.equal(pagesLib.slugOf('<script>'), 'script');
  assert.equal(pagesLib.slugOf('***'), 'page');
  assert.equal(pagesLib.cronOf('hour'), '0 * * * *');
  assert.equal(pagesLib.cronOf('day', '07:00'), '0 7 * * *');
  assert.equal(pagesLib.cronOf('monday', '8:30'), '30 8 * * 1');
  assert.throws(() => pagesLib.cronOf('day', '25:00'), /HH:MM/);
  assert.throws(() => pagesLib.cronOf('yearly'), /how often/);
  assert.deepEqual(pagesLib.scheduleOf('0 * * * *'), { every: 'hour' });
  assert.deepEqual(pagesLib.scheduleOf('5 6 * * *'), { every: 'day', time: '06:05' });
  assert.deepEqual(pagesLib.scheduleOf('0 9 * * 1-5'), {}, 'set some other way');
});

let page;
test('save_page writes the page in its workspace, lists it on the run and tells the live feed', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('pages'));
  const live = await feed(srv);
  const { run, rec, token } = await heldRun(srv, bot, 'Make me a page with hq health');
  assert.match(rec.system, /save it with save_page/);
  let r = await self(srv, token, 'page', { title: 'hq weekly health', markdown: '# hq weekly health\n\nDisk 81%. <b>bold?</b>', sources: 'Disk and RAM, last 7 days' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.created, true);
  page = r.data.page;
  assert.equal(page.slug, 'hq-weekly-health');
  assert.equal(fs.readFileSync(path.join(ws(), 'pages', 'hq-weekly-health.md'), 'utf8'), '# hq weekly health\n\nDisk 81%. <b>bold?</b>');
  await live.wait('page', (d) => d.botId === bot.id && d.slug === page.slug);
  live.close();

  // Rewritten by its slug: the same page, a newer time; an unknown slug is refused in plain words.
  r = await self(srv, token, 'page', { page: page.slug, markdown: '# hq weekly health\n\nDisk 82%.' });
  assert.equal(r.data.created, false);
  assert.equal(r.data.page.title, 'hq weekly health');
  assert.equal(r.data.page.sources, 'Disk and RAM, last 7 days', 'kept when not given');
  r = await self(srv, token, 'page', { page: 'nope', markdown: 'x' });
  assert.match(r.data.error, /You have no page "nope"/);
  r = await self(srv, token, 'page', { title: 'Empty', markdown: '  ' });
  assert.match(r.data.error, /Write the page/);
  srv.release(rec);
  await srv.finished(run.id);
  const done = (await srv.api(`/runs/${run.id}`)).data;
  assert.deepEqual(done.pages, [{ slug: 'hq-weekly-health', title: 'hq weekly health' }], 'once, however often it was saved');
});

test('the owner lists a bot\'s pages and opens one as the viewer reads a file, never as HTML', async () => {
  let r = await srv.api(`/bots/${bot.id}/pages`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.pages.map((p) => [p.slug, p.title, p.keep]), [['hq-weekly-health', 'hq weekly health', null]]);
  r = await srv.api(`/bots/${bot.id}/pages/hq-weekly-health?view=1`);
  assert.equal(r.status, 200);
  assert.equal(r.data.kind, 'markdown');
  assert.match(r.data.text, /Disk 82%/);
  assert.equal(r.data.page.slug, 'hq-weekly-health');
  const raw = await fetch(`${srv.base}/api/bots/${bot.id}/pages/hq-weekly-health`, { headers: { 'X-Bot-Dot': '1', Cookie: srv.cookie || '' } });
  assert.notEqual(raw.headers.get('content-type')?.split(';')[0], 'text/html');
  assert.equal((await srv.api(`/bots/${bot.id}/pages/gone`)).status, 404);
  assert.equal((await srv.asChief(`/bots/${bot.id}/pages`)).status, 403, "the owner's alone");
});

test('a page whose file was deleted in the workspace is no longer listed', async () => {
  const { run, rec, token } = await heldRun(srv, bot, 'One more page');
  await self(srv, token, 'page', { title: 'Scratch', markdown: 'temp' });
  srv.release(rec);
  await srv.finished(run.id);
  fs.rmSync(path.join(ws(), 'pages', 'scratch.md'));
  const r = await srv.api(`/bots/${bot.id}/pages`);
  assert.deepEqual(r.data.pages.map((p) => p.slug), ['hq-weekly-health']);
});

test('a link put in place of the pages folder is refused, nothing is written outside the workspace', async () => {
  const other = await makeBot(srv, { name: 'Sly', emoji: '🦊', allowedTools: [] });
  const outside = fs.mkdtempSync(path.join(srv.data, '..', 'outside-'));
  fs.mkdirSync(path.join(srv.data, 'workspaces', other.id), { recursive: true });
  fs.symlinkSync(outside, path.join(srv.data, 'workspaces', other.id, 'pages'));
  const { run, rec, token } = await heldRun(srv, other, 'Page please');
  const r = await self(srv, token, 'page', { title: 'Leak', markdown: 'x' });
  assert.match(r.data.error, /not a folder/);
  assert.deepEqual(fs.readdirSync(outside), []);
  srv.release(rec);
  await srv.finished(run.id);
});

test('Keep up to date makes an approved AI job of the owner\'s, with no card; again changes it; Stop removes it', async () => {
  const live = await feed(srv);
  let r = await srv.api(`/bots/${bot.id}/pages/hq-weekly-health/keep`, { method: 'POST', body: { every: 'day', time: '07:00', notify: 'report-only' } });
  await live.wait('page', (d) => d.botId === bot.id && d.slug === 'hq-weekly-health');
  live.close();
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const job = r.data.job;
  assert.equal(job.kind, 'ai');
  assert.equal(job.approved, true, 'the tap is the consent');
  assert.equal(job.createdBy, 'you');
  assert.equal(job.cron, '0 7 * * *');
  assert.equal(job.notify, 'report-only');
  assert.match(job.prompt, /save_page, with page set to that slug/);
  assert.match(job.prompt, /What to check: Disk and RAM, last 7 days/, 'from the page\'s sources');
  assert.deepEqual(r.data.page.keep, { jobId: job.id, when: 'Daily at 07:00', every: 'day', time: '07:00', notify: 'report-only', check: 'Disk and RAM, last 7 days' });
  const waiting = (await srv.api('/approvals')).data;
  assert.ok(!JSON.stringify(waiting).includes(job.id), 'nothing waits for an OK');

  r = await srv.api(`/bots/${bot.id}/pages/hq-weekly-health/keep`, { method: 'POST', body: { every: 'monday', time: '08:30', notify: 'always', check: 'Disk only' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.job.id, job.id, 'the same job');
  assert.equal(r.data.job.cron, '30 8 * * 1');
  assert.equal(r.data.job.notify, 'always');
  assert.equal(r.data.job.approved, true);
  assert.ok(!r.data.job.change, 'no change waits');
  assert.equal(r.data.page.keep.check, 'Disk only');
  assert.deepEqual([r.data.page.keep.every, r.data.page.keep.time], ['monday', '08:30']);
  assert.equal((await srv.api(`/bots/${bot.id}/jobs`)).data.length, 1);

  assert.equal((await srv.api(`/bots/${bot.id}/pages/hq-weekly-health/keep`, { method: 'POST', body: { every: 'day', time: 'soon' } })).status, 400);

  r = await srv.api(`/bots/${bot.id}/pages/hq-weekly-health/keep`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(r.data.page.keep, null);
  assert.equal((await srv.api(`/bots/${bot.id}/jobs`)).data.length, 0);
});

test('a page whose job was removed on the jobs screen no longer says it keeps up to date', async () => {
  const job = (await srv.api(`/bots/${bot.id}/pages/hq-weekly-health/keep`, { method: 'POST', body: { every: 'hour' } })).data.job;
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'DELETE' });
  const r = await srv.api(`/bots/${bot.id}/pages`);
  assert.equal(r.data.pages[0].keep, null);
});
