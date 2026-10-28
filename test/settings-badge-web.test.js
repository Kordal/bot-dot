// The Settings button carries no number (the owner read it as something waiting for them). The tasks running now are
// shown beside Activity on Settings instead, drawn again on every refresh, also while the form keeps its edits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, element, words } = require('./web-page');

function page(runs) {
  const links = element();
  links.querySelectorAll = () => [];
  const root = element({ '#settings-links': links, '#settings-form': element() });
  const ctx = vm.createContext({
    ...words,
    state: { runs, bots: [], settings: {} },
    activityRuns: () => runs,
    $: (sel, r) => (r ? r.querySelector(sel) : sel === '#view-settings' ? root : null),
    $$: (sel, r) => r.querySelectorAll(sel),
    setView() {},
  });
  vm.runInContext(`${cut('const CHEV = ', '// A change on a settings screen saves by itself')}
    ${cut('// The running tasks, shown beside Activity', '// The Settings button: marked')}
    ${cut('// The pages that open from Settings.', '  const s = state.settings;')} }
    Object.assign(this, { renderSettings });`, ctx);
  return { ctx, links };
}

test('web: the Settings button has no number', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /more-badge/);
  assert.doesNotMatch(cut('function markMore()', 'function renderStatus()'), /badge/);
});

test('web: Settings shows the running tasks beside Activity, also on a refresh that keeps the form', () => {
  const { ctx, links } = page([{ status: 'running' }, { status: 'success' }]);
  ctx.renderSettings(); // the form is already there: the links are drawn again all the same
  assert.match(links.innerHTML, /data-go="runs"><b>Activity<\/b><span class="bs-val">1 running<\/span>/, 'its value, right of it');
  const idle = page([{ status: 'success' }]);
  idle.ctx.renderSettings();
  assert.doesNotMatch(idle.links.innerHTML, /running/);
});

test("web: Activity holds the bots' turns in groups too, and counts them as running (#294)", () => {
  const ctx = vm.createContext({ state: { runs: [{ id: 'a', startedAt: '2026-10-22T08:00:00Z', status: 'success' }], activity: [
    { id: 'a', startedAt: '2026-10-22T08:00:00Z', status: 'running' },
    { id: 'g', groupId: 'dev', startedAt: '2026-10-22T09:00:00Z', status: 'running' },
  ] } });
  vm.runInContext(`${cut("// Activity's runs (#294)", 'function renderRunList()')}
    ${cut('// The running tasks, shown beside Activity', '// The Settings button: marked')}
    Object.assign(this, { activityRuns, runningTasks });`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.activityRuns().map((r) => [r.id, r.status]))), [['g', 'running'], ['a', 'success']], "newest first; a bot's own run as the live list has it");
  assert.equal(ctx.runningTasks(), 1);
});
