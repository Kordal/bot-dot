// The project overview is the board (ADR 245): Needs you, Current work, Blockers and Latest replies are board tiles
// the owner, the Chief and a team bot show, hide and place like the others.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, makeBot, writeData, heldRun, self } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const Canvas = require('../public/board-canvas');
const { clean } = require('../lib/company');

test('the overview pieces are tiles, and every board gets them once at its top', () => {
  for (const k of ['needs', 'work', 'blockers', 'replies']) assert.equal(Canvas.kindOf(k), k);
  assert.deepEqual(clean({ id: 'p', board: ['todo'], filesOn: true }).board, ['needs', 'work', 'blockers', 'replies', 'todo']);
  assert.deepEqual(clean({ id: 'p', board: ['todo'], filesOn: true, overviewOn: true }).board, ['todo'], 'taken off stays off');
  assert.equal(clean({ id: 'p' }).board, undefined, 'a board made before pieces shows them all');
  // A board arranged before gets them at its top, everything else moved below.
  const kept = clean({ id: 'p', board: ['todo'], filesOn: true, layout: { todo: [0, 0, 392, 560] } }).layout;
  assert.deepEqual(kept.needs, [0, 0, 1200, 160]);
  assert.ok(kept.todo[1] >= kept.replies[1] + kept.replies[3], 'the To-do slid below them');
  assert.deepEqual(clean({ id: 'p', board: ['todo'], overviewOn: true, layout: { todo: [0, 0, 392, 560] } }).layout.todo, [0, 0, 392, 560]);
  // A board made before pieces, and the arrangement Tidy up kept to go back to, get them at the top too, once.
  const all = clean({ id: 'p', layout: { todo: [0, 0, 392, 560] }, layoutBack: { days: [0, 0, 392, 160] } });
  assert.deepEqual(all.layout.needs, [0, 0, 1200, 160]);
  assert.ok(all.layout.todo[1] >= all.layout.replies[1] + all.layout.replies[3]);
  assert.ok(all.layoutBack.needs && all.layoutBack.days[1] >= all.layoutBack.replies[1] + all.layoutBack.replies[3]);
  assert.deepEqual(clean(all).layout, all.layout, 'moved once');
});

test('the web and Android draw the same tile kinds', () => {
  const kt = require('fs').readFileSync(require('path').join(__dirname, '..', 'android/shared/src/commonMain/kotlin/dev/botdot/app/data/BoardCanvas.kt'), 'utf8');
  for (const [k, v] of Object.entries(Canvas.KINDS)) assert.ok(kt.includes(`"${k}" to Kind(${v.min[0]}, ${v.min[1]}, ${v.size[0]}, ${v.size[1]}`), `${k} in BoardCanvas.kt`);
});

let srv; let a;
before(async () => {
  srv = await startServer();
  a = await makeBot(srv, { name: 'Board Lead', emoji: '📣' });
  writeData(path.join(srv.data, 'company.json'), { id: 'p1', name: 'Fernhill', start: 'A planner', phase: 'running', startedAt: new Date().toISOString(), board: ['todo'], filesOn: true,
    teams: [{ id: 't1', name: 'Growth', bots: [a.id], lead: a.id }] });
});
after(() => { srv.unhold(); return srv.stop(); });

const board = async () => (await srv.api('/company')).data.company.board;
// A Chief turn the owner started by asking: what the Chief takes off the board needs one.
async function ownerTurn(text, fn) {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const turn = await srv.nextRun((x) => x.stdin.includes(text), "the Chief's turn");
  try { return await fn({ 'X-Chief-Chat': chat.id }); } finally { srv.unhold(); srv.release(turn); }
}

test('the Chief hides and shows a piece and places an overview tile', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('overview-board'));
  assert.deepEqual(await board(), ['needs', 'work', 'blockers', 'replies', 'todo']);
  assert.equal((await srv.asChief('/company/layout', { method: 'PUT', body: { hide: 'needs' } })).status, 403, 'not in a turn the owner did not start');
  let r = await ownerTurn('Hide Blockers on the board', (headers) => srv.asChief('/company/layout', { method: 'PUT', headers, body: { hide: 'blockers' } }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.board, ['needs', 'work', 'replies', 'todo']);
  r = await ownerTurn('Hide Needs you', (headers) => srv.asChief('/company/layout', { method: 'PUT', headers, body: { hide: 'needs' } }));
  assert.equal(r.status, 400, 'Needs you is never hidden (ADR 252)');
  assert.ok((await board()).includes('needs'));
  r = await srv.asChief('/company/layout', { method: 'PUT', body: { show: 'blockers' } });
  assert.deepEqual(r.data.board, ['needs', 'work', 'replies', 'todo', 'blockers']);
  assert.equal((await srv.api('/company/layout', { method: 'PUT', body: { hide: 'goal' } })).status, 400);
  r = await srv.asChief('/company/layout', { method: 'PUT', body: { tile: 'replies', x: 0, y: 0, w: 1200, h: 300 } });
  assert.deepEqual(r.data.layout.replies, [0, 0, 1200, 300]);
});

test('a bot of the project hides a piece and moves a tile when the owner asks', async (t) => {
  const { run, rec, token } = await heldRun(srv, a, 'Hide Latest replies');
  let r = (await self(srv, token, 'board', { hide: 'replies' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await board()).includes('replies'), false);
  r = (await self(srv, token, 'board', { tile: 'needs', x: 0, y: 0, w: 1200, h: 160 })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual((await srv.api('/company')).data.company.layout.needs, [0, 0, 1200, 160]);
  const tools = rpcClient(t, 'self-mcp.js', rec.self.env);
  assert.ok((await tools.request('tools/list')).tools.some((x) => x.name === 'arrange_project_board'));
  assert.match(await tools.text('arrange_project_board', { show: 'replies' }), /The board shows .*replies/);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

test("a bot's run the owner did not start shows a piece but takes none off", async () => {
  srv.hold();
  const job = (await srv.api(`/bots/${a.id}/jobs`, { method: 'POST', body: { name: 'Check', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Morning check.' } })).data;
  const ran = (await srv.api(`/bots/${a.id}/jobs/${job.id}/run`, { method: 'POST' })).data;
  const rec = await srv.nextRun((x) => x.self?.env && x.stdin.includes('Morning check.'), 'the job run');
  const token = rec.self.env.RUN_TOKEN;
  const r = await self(srv, token, 'board', { hide: 'needs' });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.ok((await board()).includes('needs'));
  assert.equal((await self(srv, token, 'board', { hide: '' })).status, 403, 'any hide is the owner\'s');
  assert.equal((await self(srv, token, 'board', { hide: 'needs', show: 'files' })).status, 400, 'not both');
  assert.equal((await self(srv, token, 'board', { show: 'files' })).data.ok, true);
  srv.release(rec);
  await srv.finished(ran.run.id);
  srv.unhold();
});

test('a board kept from before moves its tiles once, and a later move or hide stays as made', async () => {
  writeData(path.join(srv.data, 'company.json'), { id: 'p1', name: 'Fernhill', start: 'A planner', phase: 'running', startedAt: new Date().toISOString(),
    layout: { todo: [0, 0, 392, 560] }, teams: [{ id: 't1', name: 'Growth', bots: [a.id], lead: a.id }] });
  let r = await srv.asChief('/company/layout', { method: 'PUT', body: { tile: 'needs', x: 0, y: 1400, w: 1200, h: 160 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.layout.needs[1], 1400, 'the move is kept, not put back at the top');
  const todo = r.data.layout.todo;
  r = await srv.api('/company/layout', { method: 'PUT', body: { hide: 'blockers' } });
  assert.equal(r.data.layout.needs[1], 1400);
  assert.deepEqual(r.data.layout.todo, todo, 'nothing slid down a second time');
  assert.deepEqual((await srv.api('/company')).data.company.layout, r.data.layout);
});

test('web: Needs you stands first whenever something waits, above the arranged tiles, and is no piece to add (ADR 252)', () => {
  const read = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', f), 'utf8');
  const home = read('company-home.js');
  const tile = home.slice(home.indexOf('function needsTileHTML(c) {'), home.indexOf('function overviewHome('));
  assert.doesNotMatch(tile, /onBoard\(c, 'needs'\)/, 'not gated by the board');
  assert.match(tile, /<section class="cf-ov cf-needs" data-cf-needs>/);
  assert.doesNotMatch(tile, /data-cf-ov=/, 'no tile of the canvas');
  const canvas = read('board-canvas-view.js');
  assert.match(canvas, /if \(!ch\.matches\('\.cf-top, \.cf-teamchips, \.sp-needs, \.cf-needs, \.sp-teams'\)\) ch\.remove\(\);/, 'kept above the canvas');
  assert.match(canvas, /target\.closest\('\.cf-top, \.cf-teamchips, \.sp-needs, \.cf-needs, \.sp-teams'\)/, 'and never dragged');
  assert.match(read('company.js'), /const OVERVIEW = \['work', 'blockers', 'replies'\];/, 'not offered as a piece');
});

// ADR 273: an overview tile on an arranged board shows whole rows and says how many more, never a row sliced in half.
test('web: an overview tile shows the rows that fit its height, one at least, and "+N more" for the rest', () => {
  const vm = require('node:vm');
  const read = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', f), 'utf8');
  const ctx = { tr: (s, v) => s.replace('{n}', v?.n), setInterval: () => 0, document: { createElement: () => fakeEl('p') } };
  const HEAD = 40, ROW = 100, MORE = 20;
  // A tile `height` tall holding a heading and `n` rows; a row hidden takes no height.
  const fakeEl = (tag, classes = []) => ({ tag, classList: { contains: (c) => classes.includes(c) }, style: { display: '' }, hidden: false, textContent: '', set className(v) { classes.push(...v.split(' ')); } });
  function tile(n, height) {
    const rows = Array.from({ length: n }, () => fakeEl('div', ['po-row']));
    const sec = { children: [fakeEl('h2'), ...rows], clientHeight: height, append(el) { this.children.push(el); }, querySelectorAll: () => [] };
    const more = () => sec.children.find((x) => x.classList.contains('po-more'));
    Object.defineProperty(sec, 'scrollHeight', { get: () => HEAD + rows.filter((r) => r.style.display !== 'none').length * ROW + (more() && !more().hidden ? MORE : 0) });
    return { sec, rows, more };
  }
  const root = (...secs) => ({ querySelectorAll: () => secs });
  vm.createContext(ctx);
  vm.runInContext(`${read('project-overview.js')}\nthis.ProjectOverview = ProjectOverview;`, ctx);
  const PO = ctx.ProjectOverview;
  // 8 rows in 300: the heading, two rows and the line fit (40 + 200 + 20 = 260; three rows would be 360).
  let t = tile(8, 300);
  PO.fit(root(t.sec));
  assert.deepEqual(t.rows.map((r) => r.style.display), ['', '', 'none', 'none', 'none', 'none', 'none', 'none']);
  assert.equal(t.more().textContent, '+6 more');
  assert.equal(t.more().hidden, false);
  // Resized taller (500: four rows and the line): more rows, a shorter "more".
  t.sec.clientHeight = 500;
  PO.fit(root(t.sec));
  assert.equal(t.rows.filter((r) => r.style.display === 'none').length, 4);
  assert.equal(t.more().textContent, '+4 more');
  // Tall enough for all of them: nothing hidden, no line.
  t.sec.clientHeight = 900;
  PO.fit(root(t.sec));
  assert.equal(t.rows.some((r) => r.style.display === 'none'), false);
  assert.equal(t.more().hidden, true);
  // Too small for even one row: one stays.
  t = tile(4, 50);
  PO.fit(root(t.sec));
  assert.equal(t.rows[0].style.display, '');
  assert.equal(t.rows.filter((r) => r.style.display === 'none').length, 3);
  // The one-column flow shows every row and no line.
  t = tile(8, 300);
  PO.fit(root(t.sec));
  PO.fit(root(t.sec), false);
  assert.equal(t.rows.some((r) => r.style.display === 'none'), false);
  assert.equal(t.more().hidden, true);
  // A tile with one row, or none, is left alone.
  t = tile(1, 10);
  PO.fit(root(t.sec));
  assert.equal(t.more(), undefined);
  // The page calls it with the canvas, and the flow with `false` (board-canvas-view.js); the tile never scrolls inside.
  const canvas = read('board-canvas-view.js');
  assert.match(canvas, /ProjectOverview\.fit\(canvas\);/);
  assert.match(canvas, /ProjectOverview\.fit\(canvas, false\);/);
  assert.match(read('style.css'), /\.bc-wrap:not\(\.bc-column\) \.bc-tile > \.cf-ov \{ overflow: hidden; \}/);
});
