// A bot's live runs above its message box on the web page (#501): public/live-runs.js loaded the way the browser
// loads it (a plain script, no module): which runs are listed, what each row says, the card's markup and how a row
// of a run that ended leaves; then the page's own code, read for where it draws the card. The look and the fold
// are checked by hand, in a browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webSource } = require('./web-source');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const page = vm.createContext({});
vm.runInContext(read('unread.js'), page);
vm.runInContext(read('opening-line.js'), page);
vm.runInContext(read('live-runs.js'), page);
const { LiveRuns, OpeningLine } = page;
const app = webSource();
const css = read('style.css');

const run = (id, more = {}) => ({ id, botId: 'b1', status: 'running', kind: 'ai', startedAt: `2026-10-23T10:0${id.slice(-1)}:00Z`, prompt: `Task ${id}`, ...more });

test('web: the page gets it as window.LiveRuns, after opening-line.js and before app.js', () => {
  assert.equal(typeof LiveRuns.listed, 'function');
  const html = read('index.html');
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/opening-line.js') < at('/live-runs.js') && at('/live-runs.js') < at('/app.js'));
});

test('web: the runs listed are the bot\'s runs going, not a side question or a script, oldest first', () => {
  const runs = [run('r3'), run('r1'), run('r2', { btw: true }), run('r4', { kind: 'script' }), run('r5', { status: 'success' }), run('r6', { botId: 'b2' })];
  assert.deepEqual(LiveRuns.listed(runs, 'b1').map((r) => r.id), ['r1', 'r3']);
  assert.deepEqual(LiveRuns.listed(null, 'b1').length, 0);
});

test('web: what a run was asked is one line: its job, its main assignment, or the first line of its message', () => {
  assert.equal(LiveRuns.ask({ jobName: 'Morning check', prompt: 'x' }), 'Morning check');
  assert.equal(LiveRuns.ask({ customPrompt: false, prompt: 'the whole assignment' }), 'Main assignment');
  assert.equal(LiveRuns.ask({ prompt: '  Fix the alias\nand then the tests' }), 'Fix the alias');
  assert.equal(LiveRuns.ask({ trigger: 'schedule' }), 'Scheduled run');
  assert.equal(LiveRuns.ask({}), 'Working');
});

test('web: how long a run has gone', () => {
  const at = Date.parse('2026-10-23T10:00:00Z');
  assert.equal(LiveRuns.elapsed('2026-10-23T10:00:00Z', at + 18000), '18s');
  assert.equal(LiveRuns.elapsed('2026-10-23T10:00:00Z', at + 245000), '4m 05s');
  assert.equal(LiveRuns.elapsed('2026-10-23T10:00:00Z', at + 3720000), '1h 02m');
  assert.equal(LiveRuns.elapsed('nonsense', at), '0s');
});

test('web: no card for one run: the status line says it', () => {
  assert.equal(LiveRuns.html([{ id: 'r1', ask: 'A', line: 'Using github', startedAt: '' }], '#378add'), '');
  assert.equal(LiveRuns.html([], '#378add'), '');
});

test('web: a row per run, with its ask, what it does now, its time and Stop for it, as text', () => {
  const now = Date.parse('2026-10-23T10:05:00Z');
  const html = LiveRuns.html([
    { id: 'r1', ask: 'Fix <b>it</b>', line: 'Using github_mcp', startedAt: '2026-10-23T10:00:00Z' },
    { id: 'r2', ask: 'Check deploy', line: '', startedAt: '2026-10-23T10:04:42Z' },
    { id: 'r3', ask: 'Wait', line: 'x', held: true, startedAt: '2026-10-23T10:04:00Z' },
  ], '#378add', now);
  assert.match(html, /^<div class="live-runs" role="status" style="--c:#378add">/);
  assert.match(html, /<div class="live-run doing" data-live-run="r1">.*Fix &lt;b&gt;it&lt;\/b&gt;.*<em>Using github_mcp<\/em>.*5m 00s.*data-stop-live="r1">Stop</);
  assert.match(html, /data-live-run="r2">.*<em>Working<\/em>.*18s/, 'no line yet: "Working"');
  assert.match(html, new RegExp(`<div class="live-run held" data-live-run="r3">.*<em>${OpeningLine.WAITING}</em>`));
  assert.doesNotMatch(html, /plan-spin[^]*data-live-run="r3"[^]*plan-spin/, 'a held run has a still dot');
});

// A clock the test moves by hand, and the calls the keeper asked for later.
function clock() {
  let now = 0;
  const due = [];
  return { now: () => now, later: (f, ms) => due.push({ f, at: now + ms }), move(ms) { now += ms; for (const d of due.splice(0)) if (d.at <= now) d.f(); else due.push(d); } };
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const row = (id) => ({ id, ask: id, line: '', startedAt: `2026-10-23T10:0${id.slice(-1)}:00Z` });

test('web: a run that ends shows done, then folds, then leaves; with one left the card goes', () => {
  const c = clock();
  let changes = 0;
  const k = LiveRuns.keeper(() => changes++, c);
  assert.deepEqual(plain(k.rows([row('r1')])), [], 'one run: no card');
  assert.deepEqual(plain(k.rows([row('r1'), row('r2')])).map((r) => r.id), ['r1', 'r2']);
  let rows = plain(k.rows([row('r2')]));
  assert.deepEqual(rows.map((r) => [r.id, !!r.done, !!r.gone]), [['r1', true, false], ['r2', false, false]], 'it keeps its place');
  c.move(LiveRuns.DONE);
  assert.equal(changes, 1);
  rows = plain(k.rows([row('r2')]));
  assert.deepEqual(rows.map((r) => [r.id, !!r.done, !!r.gone]), [['r1', true, true], ['r2', false, false]]);
  c.move(LiveRuns.GONE);
  assert.equal(changes, 2);
  assert.deepEqual(plain(k.rows([row('r2')])), [], 'one left: the status line takes over');
  assert.deepEqual(plain(k.rows([])), []);
});

test('web: three runs, two end at once: both fold, the card goes with the last fold', () => {
  const c = clock();
  const k = LiveRuns.keeper(() => {}, c);
  plain(k.rows([row('r1'), row('r2'), row('r3')]));
  assert.deepEqual(plain(k.rows([row('r3')])).map((r) => [r.id, !!r.done]), [['r1', true], ['r2', true], ['r3', false]]);
  c.move(LiveRuns.DONE + LiveRuns.GONE);
  assert.deepEqual(plain(k.rows([row('r3')])), []);
});

test('web: a run that ends while the card is not drawn leaves no row', () => {
  const c = clock();
  const k = LiveRuns.keeper(() => {}, c);
  plain(k.rows([row('r1')]));
  assert.deepEqual(plain(k.rows([])), []);
  assert.deepEqual(plain(k.rows([row('r2'), row('r3')])).map((r) => r.id), ['r2', 'r3']);
});

test('web: the opening lines keep each run\'s line', () => {
  const k = OpeningLine.keeper();
  k.say('bot:b1', 'Using github_mcp', 'r1');
  k.say('bot:b1', 'Reading logs', 'r2');
  assert.equal(k.ofRun('bot:b1', 'r1'), 'Using github_mcp');
  assert.equal(k.ofRun('bot:b1', 'r2'), 'Reading logs');
  assert.equal(k.ofRun('bot:b1', 'r9'), '');
  assert.equal(k.ofRun('bot:b9', 'r1'), '');
});

test('web: the card stands above the message box, and with it the status line is not drawn', () => {
  assert.match(app, /<div class="plan-slot"><\/div>\s*<div class="live-slot"><\/div>/);
  assert.match(app, /const card = drawLiveRuns\(botId\);/);
  assert.match(app, /drawStatusLine\(\$\('#bot-thread'\), botId && !card \?/);
  assert.match(app, /data-stop-live[^]*stopRun\(b\.dataset\.stopLive\)/);
  assert.match(css, /\.live-slot:empty \{ display: none; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.live-run\.gone/);
});
