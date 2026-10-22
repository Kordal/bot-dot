// The Chief's "Always approved" in its settings on the web page (#381): its lasting grants in connected apps
// (ADR 047) and the types of change it may make after the web (ADR 055), each with Revoke. Parts of
// public/settings.js run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element, finders } = require('./web-page');

function chiefAlways({ features = ['chief-connectors', 'more-always'], answers = {}, fail = null } = {}) {
  const row = element({}, { classes: ['hidden'] });
  const picks = element();
  const root = element({ '#chief-always': row, '#chief-always-picks': picks });
  const calls = [], toasts = [];
  let picker = null;
  const ctx = vm.createContext({
    ...finders(), state: { features }, toast: (...a) => toasts.push(a),
    foldPicker: (el, items, selected, onChange, opts) => { picker = { el, items, selected, opts }; },
    api: async (path, opts = {}) => {
      calls.push([opts.method || 'GET', path, opts.body && JSON.parse(JSON.stringify(opts.body))]);
      if (opts.method === 'DELETE' && fail) throw new Error(fail);
      return answers[path] || {};
    },
  });
  vm.runInContext(`${cut("// The Chief's lasting grants", '// The library skills you gave the Chief')}; this.loadChiefAlways = loadChiefAlways;`, ctx);
  return { ctx, root, row, picks, calls, toasts, picker: () => picker };
}

const GRANTS = {
  '/chief/connector-actions': { actions: ['gmail:GMAIL_SEND_EMAIL'], grants: [{ action: 'gmail:GMAIL_SEND_EMAIL', label: 'Send email with Gmail' }] },
  '/chief/after-web': { types: [{ type: 'reminders', label: 'reminders' }] },
};

test("web: the Chief's settings list its app actions and after-web types in the owner's words", async () => {
  const s = chiefAlways({ answers: GRANTS });
  await s.ctx.loadChiefAlways(s.root);
  assert.equal(s.row.classList.contains('hidden'), false);
  assert.equal(s.root.dataset.always, '1', 'asked once while they are open');
  const p = s.picker();
  assert.equal(p.el, s.picks);
  assert.deepEqual([...p.items.map((x) => x.label)], ['Send email with Gmail', 'Reminders']);
  assert.deepEqual([...p.selected], [...p.items.map((x) => x.id)]);
  assert.equal(p.opts.action.label, 'Revoke');
});

test('web: Revoke removes the grant by its own route and says it asks again; a refusal keeps it', async () => {
  const s = chiefAlways({ answers: GRANTS });
  await s.ctx.loadChiefAlways(s.root);
  const [app, web] = s.picker().items;
  assert.equal(await s.picker().opts.action.run(app.id), true);
  assert.deepEqual(s.calls.at(-1), ['DELETE', '/chief/connector-actions', { action: 'gmail:GMAIL_SEND_EMAIL' }]);
  assert.deepEqual(s.toasts.at(-1), ['Revoked: it asks you again']);
  assert.equal(await s.picker().opts.action.run(web.id), true);
  assert.deepEqual(s.calls.at(-1), ['DELETE', '/chief/after-web', { type: 'reminders' }]);
  const f = chiefAlways({ answers: GRANTS, fail: 'No.' });
  await f.ctx.loadChiefAlways(f.root);
  assert.equal(await f.picker().opts.action.run(f.picker().items[0].id), false);
  assert.deepEqual(f.toasts.at(-1), ['No.', true]);
});

test('web: nothing granted, or a server without either, leaves the row hidden; an older server shows the raw name', async () => {
  const none = chiefAlways({ answers: { '/chief/connector-actions': { actions: [] }, '/chief/after-web': { types: [] } } });
  await none.ctx.loadChiefAlways(none.root);
  assert.equal(none.row.classList.contains('hidden'), true);
  assert.equal(none.picker(), null);
  const old = chiefAlways({ features: [] });
  await old.ctx.loadChiefAlways(old.root);
  assert.deepEqual(old.calls, []);
  assert.equal(old.row.classList.contains('hidden'), true);
  const raw = chiefAlways({ features: ['chief-connectors'], answers: { '/chief/connector-actions': { actions: ['gmail:GMAIL_SEND_EMAIL'] } } });
  await raw.ctx.loadChiefAlways(raw.root);
  assert.deepEqual([...raw.picker().items.map((x) => x.label)], ['gmail:GMAIL_SEND_EMAIL']);
});

test("web: the row is in the Chief's settings and asked again each time they open", () => {
  const draw = cut('function renderChiefSettings()', "// The Chief's lasting grants");
  assert.match(draw, /id="chief-always"[\s\S]*id="chief-always-picks"[\s\S]*\$\{CHECKUP_HTML\}/);
  assert.match(draw, /if \(root\.dataset\.ready && !root\.dataset\.always\) loadChiefAlways\(root\);/);
  assert.match(cut('function render()', 'drawPanelHead();'), /else delete \$\('#view-chiefsettings'\)\.dataset\.always/);
});
