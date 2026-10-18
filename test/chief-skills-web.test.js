// The owner's skills for the Chief on the web page (issue #34): the Chief is the first choice wherever a skill is
// given to bots, and its settings tick library skills as a bot's settings do, each change one PUT of chiefSkills.
// Parts of public/app.js run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, esc, element, finders } = require('./web-page');

const CHIEF_BOT = { id: 'chief', name: 'Chief of Staff' };
const LIBRARY = [
  { name: 'house-style', description: 'How I write.' },
  { name: 'trip-planner', description: 'How to plan a trip.' },
];

test('web: the Chief is the first box where a skill is given to bots, ticked when it has the skill', () => {
  const ctx = vm.createContext({ CHIEF_BOT, esc, state: { bots: [{ id: 'b1', name: 'Report Bot' }] }, botLabel: (b) => esc(b.name) });
  vm.runInContext(`${cut('function botCheckboxes(', '// opts.forBot: pre-tick this bot.')}; this.botCheckboxes = botCheckboxes;`, ctx);
  const html = ctx.botCheckboxes(['chief']);
  const boxes = [...html.matchAll(/value="([^"]+)" ([^>]*)>/g)].map((m) => [m[1], /checked/.test(m[2])]);
  assert.deepEqual(boxes, [['chief', true], ['b1', false]]);
  assert.match(html, /Chief of Staff/);
});

function chiefSettings({ chiefSkills = [], answers = [] } = {}) {
  const box = element();
  const calls = [], toasts = [];
  let picker = null;
  const state = { settings: { chiefSkills } };
  const ctx = vm.createContext({
    ...finders(), state, esc,
    skillMoreHTML: () => '',
    toast: (...a) => toasts.push(a),
    foldPicker: (el, items, selected, onChange, opts) => { picker = { el, items, selected, onChange, opts }; },
    api: async (path, opts = {}) => {
      calls.push([opts.method || 'GET', path, opts.body && JSON.parse(JSON.stringify(opts.body))]);
      if (path === '/skills') return { library: LIBRARY, machine: [], builtin: [] };
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a;
    },
  });
  vm.runInContext(`${cut('function drawChiefSkills(', '// The pages that open from Settings.')}; this.drawChiefSkills = drawChiefSkills;`, ctx);
  return { ctx, state, box, root: element({ '#chief-skill-picks': box }), calls, toasts, picker: () => picker };
}
const settle = () => new Promise((r) => setImmediate(r));

test("web: the Chief's settings list the library with its skills first and ticked", async () => {
  const s = chiefSettings({ chiefSkills: ['trip-planner'] });
  s.ctx.drawChiefSkills(s.root);
  await settle();
  const p = s.picker();
  assert.equal(p.el, s.box);
  assert.deepEqual([...p.items.map((x) => x.id)], ['trip-planner', 'house-style']);
  assert.deepEqual([...p.selected], ['trip-planner']);
});

test('web: ticking a skill saves the whole list in one PUT, and a refusal is said', async () => {
  const s = chiefSettings({ answers: [{ settings: { chiefSkills: ['house-style'] } }, new Error('No.')] });
  s.ctx.drawChiefSkills(s.root);
  await settle();
  const p = s.picker();
  p.selected.add('house-style');
  await p.onChange();
  assert.deepEqual(s.calls.at(-1), ['PUT', '/settings', { chiefSkills: ['house-style'] }]);
  assert.deepEqual([...s.state.settings.chiefSkills], ['house-style']);
  p.selected.delete('house-style');
  await p.onChange();
  assert.deepEqual(s.calls.at(-1), ['PUT', '/settings', { chiefSkills: [] }]);
  assert.deepEqual(s.toasts.at(-1), ['No.', true]);
});

test("web: the skills row is in the Chief's settings, outside the form that saves its model and rules", () => {
  const draw = cut('function renderChiefSettings()', '// The library skills you gave the Chief');
  assert.match(draw, /<\/form>\s*<h3 class="page-sub">Skills<\/h3>[\s\S]*id="chief-skill-picks"[\s\S]*\$\{CHECKUP_HTML\}/);
  assert.match(draw, /drawChiefSkills\(root\);/);
});
