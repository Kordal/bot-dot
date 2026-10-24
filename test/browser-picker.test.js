// Jev in the bots' browser tools (ADR 085, lib/browser-picker.js): off, every tool goes to the bridge as before; on,
// with Jev and its key, a control may be named by what it is and browser_navigate clicks its way to a page (and, in
// the bench's brief mode, browser_find answers with lines and an action with the page's title alone). Jev's answer is checked: a pick under SURE, a failed or late Jev, acts on nothing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const picker = require('../lib/browser-picker');
const router = require('../lib/group-router');
const { rpcClient } = require('./memory-helpers');

const SNAP = [
  'Page: Shoes – Acme (http://shop.test/shoes)',
  '- navigation:',
  '  - link "Home" [ref=e1]:',
  '    - /url: /',
  '- main:',
  '  - heading "Trail Runner 3" [level=2]',
  '  - link "View" [ref=e2]:',
  '    - /url: /p/trail-runner-3',
  '  - button "Add to cart" [ref=e3]',
  '  - heading "Road Racer" [level=2]',
  '  - link "View" [ref=e4]:',
  '    - /url: /p/road-racer',
  '  - searchbox "Search" [ref=e5]',
  '  - paragraph: "Price: $89.00"',
].join('\n');

const ON = () => ({ router: 'jev', key: 'sk-or-test-key', browserPicker: true });
// A bridge that records what it was asked and answers each with a tree named after it.
function bridge() {
  const asked = [];
  const tool = async (p) => { asked.push(p); return p.op === 'snapshot' ? { ok: true, snapshot: SNAP } : { ok: true, snapshot: `Page: after ${p.op} (http://shop.test/next)\n- main:` }; };
  return { asked, tool };
}
// A bridge on which every page is SNAP again, as on a site whose pages all have the same controls.
function samePages() {
  const asked = [];
  return { asked, tool: async (p) => { asked.push(p); return { ok: true, snapshot: SNAP }; } };
}
const jev = (key, probabilities, cost = 0.00004) => { const calls = []; const ask = async (body, opts) => { calls.push({ body, opts }); return { answers: { [key]: { type: 'choice', probabilities } }, usage: { cost } }; }; return { calls, ask }; };

test('the controls of a tree, for what a tool works, with the heading above them; the lines, without addresses', () => {
  assert.deepEqual(picker.controls(SNAP, 'click'), [
    { ref: 'e1', label: 'link "Home"' },
    { ref: 'e2', label: 'link "View" under "Trail Runner 3"' },
    { ref: 'e3', label: 'button "Add to cart" under "Trail Runner 3"' },
    { ref: 'e4', label: 'link "View" under "Road Racer"' },
  ]);
  assert.deepEqual(picker.controls(SNAP, 'fill').map((c) => c.ref), ['e5']);
  const lines = picker.lines(SNAP);
  assert.ok(lines.some((l) => l.text === 'paragraph: "Price: $89.00"'));
  assert.ok(!lines.some((l) => l.text.startsWith('/url:') || l.text.startsWith('Page:')));
});

test('off, every tool goes to the bridge as it is, and a control named by what it is or a find is refused', async () => {
  for (const config of [() => ({ router: 'jev', key: 'sk-or-test-key', browserPicker: false }), () => ({ router: 'haiku', key: null, browserPicker: true })]) {
    const b = bridge();
    const j = jev('control', { e2: 1 });
    const p = picker.create({ config, ask: j.ask });
    assert.equal(p.on(), false);
    assert.deepEqual(await p.handle({ op: 'goto', url: 'http://shop.test/' }, b.tool), { ok: true, snapshot: 'Page: after goto (http://shop.test/next)\n- main:' });
    assert.equal((await p.handle({ op: 'click', what: 'the View link of Trail Runner 3' }, b.tool)).ok, false);
    assert.equal((await p.handle({ op: 'find', question: 'the price' }, b.tool)).ok, false);
    assert.equal(j.calls.length, 0, 'Jev was never asked');
    assert.deepEqual(b.asked, [{ op: 'goto', url: 'http://shop.test/' }]);
  }
});

test('on, Jev picks the control: a sure pick is clicked and answered with one line, an unsure one is not', async () => {
  const b = bridge();
  const j = jev('control', { e1: 0, e2: 0.93, e3: 0.05, e4: 0.02 });
  const p = picker.create({ config: ON, ask: j.ask });
  const r = await p.handle({ op: 'click', what: 'the View link of Trail Runner 3' }, b.tool);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot, 'Clicked link "View" under "Trail Runner 3" [ref=e2].\nPage: after click (http://shop.test/next)\n- main:');
  assert.equal(r.picked.ref, 'e2');
  assert.deepEqual(b.asked, [{ op: 'snapshot' }, { op: 'click', ref: 'e2' }]);
  const body = j.calls[0].body;
  assert.equal(body.model, router.JEV_MODEL);
  assert.deepEqual(body.provider, { data_collection: 'deny' });
  assert.deepEqual(body.state, { page: 'Page: Shoes – Acme (http://shop.test/shoes)', wanted: 'the View link of Trail Runner 3' });
  assert.deepEqual(Object.keys(body.questions.control.criteria), ['e1', 'e2', 'e3', 'e4']);
  assert.equal(j.calls[0].opts.key, 'sk-or-test-key');

  const unsure = bridge();
  const u = picker.create({ config: ON, ask: jev('control', { e2: 0.5, e4: 0.45, e1: 0.05 }).ask });
  const said = await u.handle({ op: 'click', what: 'View' }, unsure.tool);
  assert.equal(said.ok, false);
  assert.match(said.error, /^Not sure which control that is\. The likeliest: e2: link "View" under "Trail Runner 3"; e4: link "View" under "Road Racer"; e1: link "Home"\. Use its ref\.$/);
  assert.deepEqual(unsure.asked, [{ op: 'snapshot' }], 'nothing was clicked');
});

test('on, a ref still works and answers with the tree; brief, with the page title alone; fill picks among boxes', async () => {
  assert.deepEqual(await picker.create({ config: ON, ask: jev('control', {}).ask }).handle({ op: 'click', ref: 'e3' }, bridge().tool), { ok: true, snapshot: 'Page: after click (http://shop.test/next)\n- main:' });
  const b = bridge();
  const j = jev('control', { e5: 0.99 });
  const p = picker.create({ config: ON, ask: j.ask, brief: true });
  assert.deepEqual(await p.handle({ op: 'click', ref: 'e3' }, b.tool), { ok: true, snapshot: 'Done. Page: after click (http://shop.test/next)' });
  assert.deepEqual(await p.handle({ op: 'snapshot' }, b.tool), { ok: true, snapshot: SNAP }, 'a snapshot is the whole tree');
  const filled = await p.handle({ op: 'fill', what: 'the search box', text: 'boots' }, b.tool);
  assert.equal(filled.snapshot, 'Filled searchbox "Search" under "Road Racer" [ref=e5]. Page: after fill (http://shop.test/next)');
  assert.deepEqual(b.asked.at(-1), { op: 'fill', ref: 'e5', text: 'boots' });
  assert.deepEqual(Object.keys(j.calls[0].body.questions.control.criteria), ['e5'], 'only boxes are offered for fill');
});

test('a failed or late Jev clicks nothing and says so', async () => {
  const b = bridge();
  const p = picker.create({ config: ON, ask: async () => { throw Object.assign(new Error('no answer in time'), { status: 0 }); } });
  const r = await p.handle({ op: 'click', what: 'Home' }, b.tool);
  assert.deepEqual(r, { ok: false, error: "botdot couldn't pick the control (no answer in time). Take a snapshot and use a ref." });
  assert.deepEqual(b.asked, [{ op: 'snapshot' }]);
  const nothing = picker.create({ config: ON, ask: async () => ({ answers: {} }) });
  assert.equal((await nothing.handle({ op: 'click', what: 'Home' }, bridge().tool)).ok, false, 'no answer is no pick');
});

test('browser_find answers with the likeliest line, and the next ones only when Jev gives them a chance', async () => {
  const lines = picker.lines(SNAP);
  const price = lines.find((l) => l.text.includes('$89.00')).id;
  const home = lines.find((l) => l.text.includes('Home')).id;
  const j = jev('line', { [price]: 0.85, [home]: 0.12 });
  const p = picker.create({ config: ON, ask: j.ask, brief: true });
  const r = await p.handle({ op: 'find', question: 'the price of Trail Runner 3' }, bridge().tool);
  assert.equal(r.snapshot, 'Page: Shoes – Acme (http://shop.test/shoes)\nThe likeliest lines, best first:\n- paragraph: "Price: $89.00"\n- link "Home" [ref=e1]:');
  assert.equal(j.calls[0].body.state.question, 'the price of Trail Runner 3');
});

test('browser_navigate clicks its way while Jev is sure, and stops on the page it calls the goal or when unsure', async () => {
  const steps = [{ e2: 0.9 }, { e4: 0.8 }, { here: 0.95 }];
  const asked = [];
  const ask = async (body) => { asked.push(body); return { answers: { next: { probabilities: steps[asked.length - 1] } }, usage: { cost: 0.00002 } }; };
  const b = samePages();
  const r = await picker.create({ config: ON, ask }).handle({ op: 'navigate', goal: 'the page of Road Racer' }, b.tool);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.split('\n')[0], 'Clicked link "View" under "Trail Runner 3" > link "View" under "Road Racer". This looks like the page.');
  assert.deepEqual(b.asked.filter((a) => a.op === 'click'), [{ op: 'click', ref: 'e2' }, { op: 'click', ref: 'e4' }]);
  assert.equal(r.picks.length, 3);
  assert.deepEqual(asked[1].state.clicked, ['link "View" under "Trail Runner 3"'], 'Jev is told the way so far');
  assert.ok(picker.HERE in asked[0].questions.next.criteria);

  const unsure = samePages();
  const u = await picker.create({ config: ON, ask: async () => ({ answers: { next: { probabilities: { e2: 0.4, e4: 0.4 } } } }) }).handle({ op: 'navigate', goal: 'x' }, unsure.tool);
  assert.equal(u.snapshot.split('\n')[0], 'Clicked nothing. botdot was not sure of the next step.');
  assert.ok(!unsure.asked.some((a) => a.op === 'click'));

  const busy = samePages();
  const n = await picker.create({ config: ON, ask: async () => ({ answers: { next: { probabilities: { e1: 0.99 } } } }) }).handle({ op: 'navigate', goal: 'x' }, busy.tool);
  assert.equal(busy.asked.filter((a) => a.op === 'click').length, picker.STEPS, 'never more than STEPS clicks');
  assert.match(n.snapshot, /^Clicked (link "Home" > ){5}link "Home"\. It took 6 steps/);
});

test('the admin switch is handed with the router, and is off unless true', () => {
  try {
    assert.equal(router.setConfig({ router: 'jev', key: 'sk-or-test-key', browserPicker: true }), 'jev');
    assert.equal(router.config().browserPicker, true);
    assert.equal(picker.create().on(), true);
    router.setConfig({ router: 'jev', key: 'sk-or-test-key', browserPicker: 'yes' });
    assert.equal(router.config().browserPicker, false);
    router.setConfig({ router: 'haiku', browserPicker: true });
    assert.equal(picker.create().on(), false, 'Jev alone works in the browser');
  } finally { router.setConfig({ router: 'haiku' }); }
});

test('the bot\'s browser tools take what a control is and offer browser_find only when botdot switches them on', async (t) => {
  const asked = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { asked.push(JSON.parse(body || '{}')); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true,"snapshot":"Clicked."}'); });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const env = { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture' };
  const on = rpcClient(t, 'computer-mcp.js', { ...env, BROWSER_PICKER: 'on' });
  await on.request('initialize', {});
  const tools = (await on.request('tools/list')).tools;
  const click = tools.find((x) => x.name === 'browser_click');
  assert.deepEqual(click.inputSchema.required, []);
  assert.ok(click.inputSchema.properties.what);
  assert.ok(tools.some((x) => x.name === 'browser_navigate'));
  assert.ok(!tools.some((x) => x.name === 'browser_find'), 'browser_find is the bench\'s brief mode only');
  await on.request('tools/call', { name: 'browser_click', arguments: { what: 'the Log in button' } });
  assert.deepEqual(asked.at(-1), { op: 'click', what: 'the Log in button' });
  await on.request('tools/call', { name: 'browser_navigate', arguments: { goal: 'the pricing page' } });
  assert.deepEqual(asked.at(-1), { op: 'navigate', goal: 'the pricing page' });
  const off = rpcClient(t, 'computer-mcp.js', env);
  await off.request('initialize', {});
  const plain = (await off.request('tools/list')).tools;
  assert.deepEqual(plain.find((x) => x.name === 'browser_click').inputSchema, { type: 'object', properties: { ref: { type: 'string', description: 'A ref from your last browser_snapshot, e.g. "e12"' } }, required: ['ref'] });
  assert.ok(!plain.some((x) => ['browser_find', 'browser_navigate'].includes(x.name)));
});
