// The number on the Settings button (the running tasks, app.js markMore) is named where the owner looks: in the
// button's label and on Settings → Activity, which is drawn again on every refresh, also while the form keeps edits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element } = require('./web-page');

function page(runs) {
  const badge = element();
  const btn = element();
  btn.attrs = {};
  btn.setAttribute = (k, v) => (btn.attrs[k] = v);
  const links = element({}, {});
  links.querySelectorAll = () => [];
  const root = element({ '#settings-links': links, '#settings-form': element() });
  const ctx = vm.createContext({
    state: { runs, bots: [], settings: {}, chiefBusy: false, view: 'settings' },
    $: (sel, r) => (r ? r.querySelector(sel) : { '#more-badge': badge, '#more-btn': btn, '#brand': element(), '#view-settings': root }[sel] || null),
    $$: (sel, r) => r.querySelectorAll(sel),
    setView() {},
    chiefFigure: () => '',
  });
  vm.runInContext(`${cut('// The Settings button: the number of running tasks', 'function renderStatus()')}
    ${cut('// The pages that open from Settings.', '  const s = state.settings;')} }
    Object.assign(this, { markMore, renderSettings });`, ctx);
  return { ctx, badge, btn, links };
}

test('web: the number on Settings is named on the button and on Settings → Activity', () => {
  const { ctx, badge, btn, links } = page([{ status: 'running' }, { status: 'success' }]);
  ctx.markMore();
  assert.equal(badge.textContent, 1);
  assert.equal(btn.title, 'Settings: 1 task running');
  assert.equal(btn.attrs['aria-label'], 'Settings: 1 task running');
  ctx.renderSettings(); // the form is already there: the links are drawn again all the same
  assert.match(links.innerHTML, /data-go="runs"[\s\S]*1 task running/);
});

test('web: with nothing running, no number and no hint', () => {
  const { ctx, badge, btn, links } = page([{ status: 'success' }]);
  ctx.markMore();
  assert.equal(badge.textContent, '');
  assert.equal(btn.title, 'Settings');
  ctx.renderSettings();
  assert.doesNotMatch(links.innerHTML, /running/);
});
