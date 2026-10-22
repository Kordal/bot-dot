// Blocks in a bot's page (#395, lib/page-blocks.js, ADR 071): fences of the block kit between its Markdown, checked
// and filled in by botdot, with their own values or bound to a tile of the Board, live; a block that cannot be drawn
// is a quiet line; a document and a download get the blocks as text and tables.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self, feed } = require('./helpers');
const pb = require('../lib/page-blocks');

const fence = (type, v) => `\`\`\`${type}\n${typeof v === 'string' ? v : JSON.stringify(v)}\n\`\`\``;
const DISK = { tile: { id: 't_disk', title: 'Disk', reads: { load: {} } }, data: { value: { used: 71 }, load: 0.4 }, history: { 'value.used': [60, 65, 71] }, times: { 'value.used': [1, 2, 3] } };
const board = { tile: (ref) => (ref === 't_disk' || String(ref).toLowerCase() === 'disk' ? DISK : null) };

test('the page splits into Markdown and its blocks; a kit fence inside another code fence stays code', () => {
  const md = `# Report\n\n${fence('kpi', { value: 1 })}\n\ntext\n\n\`\`\`\`md\n${fence('kpi', {})}\n\`\`\`\`\n\n\`\`\`js\nconst a = 1;\n\`\`\``;
  const parts = pb.split(md);
  assert.deepEqual(parts.map((p) => p.type || 'md'), ['md', 'kpi', 'md']);
  assert.match(parts[2].md, /````md\n```kpi\n\{\}\n```\n````/);
  assert.match(parts[2].md, /```js\nconst a = 1;\n```/);
  assert.equal(pb.hasBlocks('# plain\n\n```json\n{}\n```'), false);
  assert.equal(pb.hasBlocks(md), true);
});

test("unbound blocks show the bot's own values: a hero, a row of kpis with change and sparkline, charts, pills, a callout", () => {
  const md = [
    fence('hero', { eyebrow: 'Report', title: 'bot-dot: features', lead: 'What is done.', tags: ['weekly'] }),
    fence('kpi', [{ label: 'Done', value: 42, of: 58, points: [30, 36, 42], sub: '6 this week' }, { label: 'Waiting', value: 3, points: [2, 3], good: 'down' }]),
    fence('chart', { title: 'Closed weekly', style: 'bar', labels: ['W41', 'W42'], series: [{ label: 'Closed', points: [18, 21] }] }),
    fence('chart', { title: 'By area', style: 'hbar', bars: [{ label: 'Chat', value: 11 }, { label: 'Rooms', value: 6 }] }),
    fence('status', [{ text: 'CI green', level: 'ok' }, { text: 'Disk', level: 'bad' }]),
    fence('callout', { title: 'Waits for you', text: 'Approve **#380**.', level: 'warn' }),
  ].join('\n\n');
  const { parts, tiles } = pb.render(md, board);
  assert.deepEqual(tiles, []);
  const [hero, kpis, bars, hbars, pills, callout] = parts.map((p) => p.block);
  assert.deepEqual(hero, { type: 'hero', title: 'bot-dot: features', eyebrow: 'Report', lead: 'What is done.', tags: ['weekly'] });
  assert.equal(kpis.type, 'grid');
  assert.equal(kpis.columns, 2);
  assert.deepEqual(kpis.blocks[0], { type: 'kpi', text: '42', label: 'Done', sub: '6 this week', of: '58', points: [30, 36, 42], delta: { text: '12', dir: 'up', good: true } });
  assert.deepEqual(kpis.blocks[1].delta, { text: '1', dir: 'up', good: false }, 'up is bad news when good is down');
  assert.deepEqual(bars, { type: 'chart', style: 'bar', text: 'Closed weekly', labels: ['W41', 'W42'], points: [18, 21], series: [{ points: [18, 21], label: 'Closed' }] });
  assert.deepEqual(hbars.bars, [{ label: 'Chat', text: '11', ratio: 1 }, { label: 'Rooms', text: '6', ratio: 6 / 11 }]);
  assert.deepEqual(pills.blocks, [{ type: 'status', text: 'CI green', level: 'ok' }, { type: 'status', text: 'Disk', level: 'err' }]);
  assert.deepEqual(callout, { type: 'callout', text: 'Approve **#380**.', level: 'warn', title: 'Waits for you' });
});

test('a bound block reads its tile: the value, a template, its recent values and change', () => {
  const md = [
    fence('kpi', { tile: 'Disk', bind: 'value.used', label: 'Disk', unit: '%', good: 'down' }),
    fence('chart', { tile: 't_disk', bind: 'value.used', title: 'Disk use' }),
    fence('status', { tile: 'disk', text: 'load {{load}}', level: 'ok' }),
  ].join('\n');
  const { parts, tiles } = pb.render(md, board);
  assert.deepEqual(tiles, ['t_disk']);
  const [kpi, chart, status] = parts.map((p) => p.block);
  assert.equal(kpi.text, '71');
  assert.equal(kpi.label, 'Disk');
  assert.deepEqual(kpi.points, [60, 65, 71]);
  assert.deepEqual(kpi.delta, { text: '11', dir: 'up', good: false });
  assert.deepEqual(chart.points, [60, 65, 71]);
  assert.equal(chart.text, 'Disk use');
  assert.deepEqual(status, { type: 'status', text: 'load 0.4', level: 'ok' });
  assert.deepEqual(pb.inspect(md, board), { problems: [], keeps: { t_disk: ['value.used'] } }, 'the tile keeps the recent values the page shows');
});

test('a block that cannot be drawn is a quiet line, never a broken page; controls are not on a page', () => {
  const md = [
    '# Still here',
    fence('kpi', '{ not json'),
    fence('kpi', { tile: 'Nope', bind: 'value' }),
    fence('kpi', { tile: 'Disk', bind: 'elsewhere.x' }),
    fence('chart', { style: 'pie', points: [1, 2] }),
    fence('grid', { blocks: [{ type: 'switch', on: 'value' }] }),
    fence('hero', { lead: 'no title' }),
    fence('status', { text: 'fine' }),
  ].join('\n\n');
  const { parts } = pb.render(md, board);
  assert.equal(parts[0].md, '# Still here\n');
  const errors = parts.slice(1, -1).map((p) => p.block);
  assert.ok(errors.every((b) => b.type === 'error'), JSON.stringify(errors));
  assert.match(errors[0].text, /JSON can't be read/);
  assert.match(errors[1].text, /no tile "Nope"/);
  assert.match(errors[2].text, /must start with "value" or "load"/);
  assert.match(errors[3].text, /style is one of/);
  assert.match(errors[4].text, /a grid holds kpi, chart, status, callout/);
  assert.deepEqual(parts.at(-1).block, { type: 'status', text: 'fine', level: 'info' });
  assert.equal(pb.inspect(md, board).problems.length, 6);
});

test('a fence never closed takes nothing with it, and a gap in a chart keeps each point under its label', () => {
  const { parts } = pb.render('# Top\n\n```kpi\n{"value": 1}\n\n## Still here\n\nText.', board);
  assert.equal(parts[1].block.type, 'error');
  assert.match(parts[1].block.text, /never closed/);
  assert.match(parts[2].md, /## Still here\n\nText\./);
  const chart = pb.render(fence('chart', { labels: ['W1', 'W2', 'W3'], points: [3, null, 5] }), board).parts[0].block;
  assert.deepEqual(chart.series, [{ points: [3, null, 5] }]);
});

test("a tile named by its title is the page's bot's first", () => {
  const tiles = [{ id: 'a', title: 'Status', bot: 'other' }, { id: 'b', title: 'Status', bot: 'mine' }];
  const dash = require('../lib/dashboard').create(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pb-')));
  for (const t of tiles) dash.add({ kind: 'value', title: t.title, section: t.id, bot: t.bot, value: t.id }, { by: 'you' });
  const ids = Object.fromEntries(dash.list().tiles.map((t) => [t.section, t.id]));
  assert.equal(dash.forPage('status', 'mine').data.value, 'b');
  assert.equal(dash.forPage('status', 'nobody').data.value, 'a');
  assert.equal(dash.forPage(ids.a, 'mine').data.value, 'a', 'by its id, that tile');
});

test('as text, for a document and a download: the blocks are written out with their values, as lines and tables', () => {
  const md = [
    fence('hero', { eyebrow: 'Report', title: 'Features', lead: 'What is done.' }),
    fence('kpi', [{ label: 'Done', value: 42, of: 58, points: [36, 42] }, { tile: 'Disk', bind: 'value.used', unit: '%', label: 'Disk' }]),
    fence('chart', { title: 'Closed', labels: ['W41', 'W42'], series: [{ label: 'PRs', points: [9, 12] }, { label: 'Issues', points: [18, 21] }] }),
    fence('callout', { title: 'Waits', text: 'Approve it', level: 'warn' }),
    fence('kpi', '{oops'),
  ].join('\n\n');
  const text = pb.plain(md, board);
  assert.match(text, /^\*Report\*\n\n# Features\n\nWhat is done\./);
  assert.match(text, /\| Done \| 42 of 58 \| ▲ 6 \|/);
  assert.match(text, /\| Disk \| 71 % \| ▲ 11 \|/);
  assert.match(text, /\*\*Closed\*\*\n\n\|  \| PRs \| Issues \|\n\| --- \| --- \| --- \|\n\| W41 \| 9 \| 18 \|\n\| W42 \| 12 \| 21 \|/);
  assert.match(text, /> \*\*Waits\*\* Approve it/);
  assert.match(text, /\*\(A block that could not be drawn\.\)\*/);
  assert.doesNotMatch(text, /```/);
});

let srv; let bot;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Ops', allowedTools: [] });
});
after(async () => { srv.unhold(); await srv.stop(); });

test('save_page with blocks: the bot hears which cannot be drawn, the page view has its parts, live values and a download as text', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('page-blocks'));
  const tile = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Queue', bot: bot.id, value: 5 } })).data;
  const md = `# Ops\n\n${fence('kpi', { tile: 'Queue', bind: 'value', label: 'Queue', good: 'down' })}\n\n${fence('callout', '{ bad')}\n\n<b>text</b>`;
  const { run, rec, token } = await heldRun(srv, bot, 'A page with the queue');
  const r = await self(srv, token, 'page', { title: 'Ops live', markdown: md });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.problems.length, 1);
  assert.match(r.data.problems[0], /Block 2 \(callout\): its JSON can't be read/);
  srv.release(rec);
  await srv.finished(run.id);

  const src = `/bots/${bot.id}/pages/ops-live`;
  let v = (await srv.api(`${src}?view=1`)).data;
  assert.equal(v.text, md, 'its Source stays the Markdown');
  assert.deepEqual(v.tiles, [tile.id]);
  assert.equal(v.parts[1].block.text, '5');
  assert.equal(v.parts[2].block.type, 'error');
  assert.equal(v.parts[3].md, '\n<b>text</b>', 'Markdown stays Markdown; the apps draw it as text');
  assert.match(v.plain, /\*\*Queue:\*\* 5/);

  // The tile gets a new value: the feed says so, and the page's blocks read it; the tile keeps the values the page shows.
  const live = await feed(srv);
  await srv.asChief(`/dashboard/tiles/${tile.id}/value`, { method: 'PUT', body: { value: 7 } });
  await live.wait('dashboard', (d) => d.tile?.id === tile.id);
  live.close();
  const b = (await srv.api(`${src}?blocks=1`)).data;
  assert.deepEqual(b.tiles, [tile.id]);
  assert.equal(b.parts[1].block.text, '7');
  assert.deepEqual(b.parts[1].block.delta, { text: '2', dir: 'up', good: false });

  const dl = await srv.api(src);
  assert.equal(dl.status, 200);
  const body = dl.data.toString('utf8');
  assert.match(body, /\*\*Queue:\*\* 7 \(▲ 2\)/);
  assert.doesNotMatch(body, /```kpi/);

  // A page without blocks is as it was: no parts, and it downloads as it was written. An unclosed fence runs to the end.
  const { run: r2, rec: rec2, token: t2 } = await heldRun(srv, bot, 'Two more pages');
  await self(srv, t2, 'page', { title: 'Plain', markdown: '# Plain\n\n```json\n{}\n```' });
  await self(srv, t2, 'page', { title: 'Open fence', markdown: '# Open\n\n```kpi\nnot closed' });
  srv.release(rec2);
  await srv.finished(r2.id);
  v = (await srv.api(`/bots/${bot.id}/pages/plain?view=1`)).data;
  assert.equal(v.parts, undefined);
  assert.equal((await srv.api(`/bots/${bot.id}/pages/plain`)).data.toString('utf8'), '# Plain\n\n```json\n{}\n```');
  v = (await srv.api(`/bots/${bot.id}/pages/open-fence?view=1`)).data;
  assert.equal(v.parts[1].block.type, 'error');
});
