// Activity was one row per run, newest first: a bot on a schedule filled it with dozens of the same line. Now what
// needs a look comes first, a bot's runs in one place on one day are one row that opens to them, and the days before
// today wait behind "Show earlier".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element, words } = require('./web-page');

const NOW = new Date(2026, 10, 15, 15, 0).getTime(); // local time, as the page counts its days
const at = (h, m = 0, d = 15) => new Date(2026, 10, d, h, m).toISOString();

function rows(runs) {
  const ctx = vm.createContext({});
  vm.runInContext(`${cut("// Activity's rows", 'const runTitle =')} Object.assign(this, { activityRows });`, ctx);
  const { top, earlier } = ctx.activityRows(runs, NOW);
  const ids = (list) => JSON.parse(JSON.stringify(list.map((row) => row.runs.map((r) => r.id))));
  return { top: ids(top), earlier: ids(earlier) };
}

test("web: Activity folds a bot's runs in one place on one day into one row, at its newest", () => {
  const { top } = rows([
    { id: 'r5', botId: 'rev', groupId: 'dev', startedAt: at(14, 30), status: 'success' },
    { id: 'c1', botId: 'coder', startedAt: at(14), status: 'success' },
    { id: 'r4', botId: 'rev', startedAt: at(13, 50), status: 'success' },
    { id: 'r3', botId: 'rev', groupId: 'dev', startedAt: at(13, 40), status: 'success' },
    { id: 'r2', botId: 'rev', groupId: 'dev', startedAt: at(13, 30), status: 'success' },
    { id: 'r1', botId: 'rev', startedAt: at(13), status: 'error' }, // an older failure, followed by one that went well
  ]);
  assert.deepEqual(top, [['r5', 'r3', 'r2'], ['c1'], ['r4', 'r1']], 'the same bot alone and in a group are two places');
});

test('web: a run at work, waiting its turn, or the newest failure or question of its place today comes first, alone', () => {
  const { top, earlier } = rows([
    { id: 'q', botId: 'a', startedAt: at(14, 50), status: 'queued' },
    { id: 'run', botId: 'a', startedAt: at(14, 40), status: 'running' },
    { id: 'ok', botId: 'b', startedAt: at(14, 30), status: 'success' },
    { id: 'asks', botId: 'c', startedAt: at(14, 20), status: 'success', asks: true },
    { id: 'c-old', botId: 'c', startedAt: at(14, 10), status: 'success' },
    { id: 'err', botId: 'b', groupId: 'g', startedAt: at(14), status: 'error' },
    { id: 'b-old', botId: 'b', startedAt: at(13), status: 'success' },
    { id: 'old-err', botId: 'd', startedAt: at(9, 0, 14), status: 'error' }, // yesterday's: not pinned
  ]);
  assert.deepEqual(top, [['q'], ['run'], ['asks'], ['err'], ['ok', 'b-old'], ['c-old']]);
  assert.deepEqual(earlier, [['old-err']]);
});

test('web: the days before today are behind "Show earlier", one row per bot, place and day', () => {
  const { top, earlier } = rows([
    { id: 't', botId: 'a', startedAt: at(8), status: 'success' },
    { id: 'y2', botId: 'a', startedAt: at(20, 0, 14), status: 'success' },
    { id: 'y1', botId: 'a', startedAt: at(10, 0, 14), status: 'success' },
    { id: 'z', botId: 'a', startedAt: at(10, 0, 13), status: 'success' },
  ]);
  assert.deepEqual(top, [['t']]);
  assert.deepEqual(earlier, [['y2', 'y1'], ['z']]);
});

function page(runs, extra = {}) {
  const list = element();
  const buttons = [];
  const ctx = vm.createContext({
    ...words,
    state: { runs, activity: [], selectedRun: null, runsOpen: new Set(), runsEarlier: false, ...extra },
    $: (sel) => (sel === '#run-list' ? list : null),
    $$: () => buttons,
    esc: (s) => String(s ?? ''),
    ago: () => '1h ago',
    dur: () => '',
    runFigure: () => '',
    groupById: () => null,
    statusPill: (s) => `<span class="pill">${s}</span>`,
    CHEV: '<span class="bs-chev">›</span>',
  });
  vm.runInContext(`${cut("// Activity's runs (#294)", 'function openRun(id)')} Object.assign(this, { renderRunList });`, ctx);
  ctx.renderRunList();
  return list.innerHTML;
}

test('web: a folded row says how many runs it holds and opens in place; earlier days wait behind a button', () => {
  const runs = [
    { id: 'a2', botId: 'a', botName: 'Reviewer', startedAt: new Date(Date.now() - 60_000).toISOString(), status: 'success' },
    { id: 'a1', botId: 'a', botName: 'Reviewer', startedAt: new Date(Date.now() - 120_000).toISOString(), status: 'success' },
    { id: 'old', botId: 'a', botName: 'Reviewer', startedAt: '2020-01-01T10:00:00Z', status: 'success' },
  ];
  const html = page(runs);
  assert.match(html, /class="run-item run-group" data-key="a\|\|[^"]+" aria-expanded="false"/);
  assert.match(html, /2 runs/);
  assert.doesNotMatch(html, /data-id="a1"/, 'folded');
  assert.match(html, /class="run-more">Show earlier</);
  assert.doesNotMatch(html, /data-id="old"/);
  const open = page(runs, { selectedRun: 'a1', runsEarlier: true });
  assert.match(open, /aria-expanded="true"/, 'the run open in the view keeps its row open');
  assert.match(open, /data-id="a1"/);
  assert.match(open, /data-id="old"/);
  assert.doesNotMatch(open, /run-more/);
});
