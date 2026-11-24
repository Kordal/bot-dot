// Answer views (#1623, ADR 264): a ```ui fence in a reply holds a JSON tree of the catalog's components. The catalog is
// data the server hands out (lib/ui-catalog.json); the apps read a fence with one generic validator driven by it
// (public/answer-view.js, loaded here the way Node loads it), by the rules every app shares
// (test/fixtures/ui-cases.json). Nothing is drawn yet: what a fence draws is its normalised tree.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer } = require('./helpers');

const catalog = require('../lib/ui-catalog.json');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ui-cases.json'), 'utf8'));
const AnswerView = require('../public/answer-view');
const view = AnswerView.of(catalog);
const plain = (v) => JSON.parse(JSON.stringify(v));
const sourceOf = (c) => (c.repeat ? c.source.replace(c.repeat.mark, c.repeat.with.repeat(c.repeat.times)) : c.source);

test('every case of the shared fixture draws the tree it names, or is refused for the reason it names', () => {
  assert.ok(fixture.cases.length >= 60);
  for (const c of fixture.cases) {
    const r = view.validate(sourceOf(c));
    assert.deepEqual(plain(r.problems || []), c.problems || [], `${c.name}: problems`);
    if (c.refused) {
      assert.equal(r.ok, false, c.name);
      assert.equal(r.refused, c.refused, c.name);
      assert.equal(r.alt, c.alt, `${c.name}: alt`);
    } else {
      assert.equal(r.ok, true, c.name);
      assert.deepEqual(plain({ alt: r.alt, root: r.root }), c.drawn, c.name);
    }
  }
});

test('every reply of the shared fixture is split into its text, its views and its code', () => {
  assert.ok(fixture.replies.length >= 10);
  for (const c of fixture.replies) assert.deepEqual(plain(view.split(c.reply, { done: c.done !== false })), c.parts, c.name);
});

test('the fixture covers every limit, every refusal and every component of the catalog', () => {
  const refusals = new Set(fixture.cases.filter((c) => c.refused).map((c) => c.refused).concat(fixture.replies.flatMap((c) => c.parts.map((p) => p.refused)).filter(Boolean)));
  for (const why of ['too-big', 'too-many-nodes', 'too-deep', 'too-many-points', 'not-json', 'not-object', 'no-alt', 'no-root', 'too-many-fences', 'unclosed']) assert.ok(refusals.has(why), why);
  const seen = new Set();
  const walk = (n) => { if (n && typeof n === 'object') { if (typeof n.type === 'string') seen.add(n.type); Object.values(n).forEach(walk); } };
  fixture.cases.forEach((c) => walk(c.drawn));
  for (const name of Object.keys(catalog.components)) assert.ok(seen.has(name), `a case draws ${name}`);
  const codes = new Set(fixture.cases.flatMap((c) => (c.problems || []).map((p) => p.code)));
  for (const code of ['unknown-component', 'unknown-prop', 'missing-prop', 'bad-prop', 'bad-item', 'not-a-component', 'not-allowed-here']) assert.ok(codes.has(code), code);
});

test('the catalog: every component says its group, its meaning and the version it came in, and its props are ones the validator reads', () => {
  const TYPES = ['string', 'number', 'int', 'boolean', 'enum', 'tone', 'https', 'media', 'list', 'object'];
  const check = (spec, where) => {
    assert.ok(TYPES.includes(spec.type), `${where}: type ${spec.type}`);
    if (spec.type === 'string') assert.ok(spec.max > 0, `${where}: a string has its length`);
    if (spec.type === 'enum') assert.ok(Array.isArray(spec.values) && spec.values.length, `${where}: values`);
    if (spec.type === 'media') assert.ok(spec.from.length && spec.from.every((f) => ['file', 'https'].includes(f)), `${where}: from`);
    if (spec.type === 'list') { assert.ok(spec.of, `${where}: a list says what it holds`); check(spec.of, `${where}[]`); }
    if (spec.type === 'object') Object.entries(spec.props).forEach(([k, s]) => check(s, `${where}.${k}`));
    if (spec.default !== undefined && spec.type === 'enum') assert.ok(spec.values.includes(spec.default), `${where}: default`);
    if (spec.default !== undefined && spec.type === 'tone') assert.ok(catalog.tones.includes(spec.default), `${where}: default tone`);
  };
  const names = Object.keys(catalog.components);
  assert.ok(names.length >= 40);
  for (const [name, c] of Object.entries(catalog.components)) {
    assert.ok(['layout', 'text', 'data', 'charts', 'media', 'feedback', 'inputs', 'actions'].includes(c.group), `${name}: group`);
    assert.ok(c.means && c.means.length < 200, `${name}: means`);
    assert.ok(Number.isInteger(c.since) && c.since >= 1 && c.since <= catalog.version, `${name}: since`);
    Object.entries(c.props).forEach(([k, s]) => check(s, `${name}.${k}`));
    for (const other of [...(c.children?.only || []), ...(c.in || [])]) assert.ok(names.includes(other), `${name}: ${other}`);
    if (c.sourced) assert.ok(c.props.source?.type === 'string', `${name}: a sourced component has a source`);
    assert.ok(!('type' in c.props) && !('children' in c.props), `${name}: type and children are the node's own`);
  }
  assert.equal(catalog.version, Math.max(...Object.values(catalog.components).map((c) => c.since)), 'the version is the newest since');
  assert.deepEqual(catalog.tones, ['neutral', 'good', 'warn', 'bad', 'accent']);
  assert.deepEqual(catalog.limits, { fences: 3, nodes: 200, depth: 6, bytes: 65536, points: 500, alt: 200 });
  for (const group of ['layout', 'text', 'data', 'charts', 'media', 'inputs', 'actions']) assert.ok(names.some((n) => catalog.components[n].group === group), group);
  // The page blocks are the first components of the catalog (ADR 071).
  for (const block of ['hero', 'kpi', 'chart', 'status', 'callout', 'table', 'grid']) assert.ok(names.includes(block), block);
  // Sourced: every chart, table and KPI says where its numbers came from.
  for (const n of ['chart', 'pie', 'scatter', 'histogram', 'sparkline', 'gauge', 'table', 'kpi']) assert.equal(catalog.components[n].sourced, true, n);
});

test('an app that draws an older catalog shows a component that came later as one quiet unknown node', () => {
  const later = plain(catalog);
  later.version = catalog.version + 1;
  later.components.flow = { group: 'data', since: later.version, means: 'A flow.', props: { label: { type: 'string', max: 40, required: true } } };
  const src = JSON.stringify({ alt: 'A', root: { type: 'stack', children: [{ type: 'flow', label: 'Budget' }, { type: 'divider' }] } });
  const newer = AnswerView.of(later).validate(src);
  assert.deepEqual(plain(newer.root.children), [{ type: 'flow', label: 'Budget' }, { type: 'divider' }]);
  const older = AnswerView.of(later, { known: catalog.version }).validate(src);
  assert.deepEqual(plain(older.root.children), [{ type: 'unknown' }, { type: 'divider' }]);
  assert.deepEqual(plain(older.problems), [{ at: 'root/children/0', code: 'unknown-component', name: 'flow' }]);
  // The catalog the app already has is what it reads with, and that is one it can read.
  assert.deepEqual(plain(AnswerView.of(catalog, { known: 99 }).validate(src).root.children[0]), { type: 'unknown' });
  // An app that knows only wave 1 draws no input: the inputs and actions came in version 2.
  const wave1 = AnswerView.of(catalog, { known: 1 }).validate(JSON.stringify({ alt: 'A', root: { type: 'stack', children: [{ type: 'slider', label: 'Budget' }, { type: 'button', label: 'Go' }, { type: 'divider' }] } }));
  assert.deepEqual(plain(wave1.root.children), [{ type: 'unknown' }, { type: 'unknown' }, { type: 'divider' }]);
});

test('what a view posts as the owner\'s next message is the text the shared fixture names: a form\'s lines, a button\'s words', () => {
  const words = require('../public/answer-text').of(view);
  assert.ok(fixture.sends.length >= 9);
  for (const c of fixture.sends) {
    if ('posts' in c) assert.equal(words.form(c.view.root, c.values), c.posts, c.name);
    if (c.presses) assert.deepEqual(Object.fromEntries(words.buttons(c.view.root).map((b) => [b.path, words.press(b.node)])), c.presses, c.name);
  }
  // every input of the catalog is in a case
  const seen = new Set();
  const walk = (n) => { if (n && typeof n === 'object') { if (typeof n.type === 'string') seen.add(n.type); Object.values(n).forEach(walk); } };
  fixture.sends.forEach((c) => walk(c.view));
  for (const [name, c] of Object.entries(catalog.components)) if (c.group === 'inputs' || name === 'button') assert.ok(seen.has(name), `a send case has ${name}`);
  // a button's words are at most 200 characters: the validator cut them, and the page cuts them again
  assert.equal(words.press({ type: 'button', label: 'Go', send: 'x'.repeat(300) }).length, 200);
  assert.equal(words.press({ type: 'button', label: 'Go', send: '   ' }), 'Go');
});

test('a bot cannot reach what is not in the catalog through the names of a JavaScript object', () => {
  const src = '{"alt":"A","root":{"type":"text","text":"Hi","__proto__":{"x":1},"constructor":"y","toString":"z"}}';
  const r = view.validate(src);
  assert.deepEqual(plain(r.root), { type: 'text', text: 'Hi' });
  assert.equal({}.x, undefined);
  assert.equal(Object.getPrototypeOf(r.root), Object.prototype);
  assert.equal(Object.keys(r.root).length, 2);
});

test('a view never approves: nothing in the catalog runs or changes anything, and only a button names what it sends', () => {
  const ACTS = ['button', 'button-group', 'link', 'copy'];
  const INPUTS = ['text-input', 'textarea', 'number', 'slider', 'range', 'select', 'multi-select', 'radio', 'checkbox', 'toggle', 'date', 'time', 'rating', 'segmented'];
  for (const [name, c] of Object.entries(catalog.components)) {
    // The inputs and actions of wave 2 are the catalog's only ones (ADR 265): they post text to the chat and nothing else.
    if (c.group === 'inputs') assert.ok(INPUTS.includes(name), name);
    else if (c.group === 'actions') assert.ok(ACTS.includes(name), name);
    else assert.ok(!/button|input|form|approve|send|run|script|style|css|html|embed|iframe/i.test(name), name);
    assert.ok(!/approve|run|script|style|css|html|embed|iframe|form\b/i.test(name), name);
    // A chart's `style` is one of its own kinds (line, bar, …), never a style of the bot's own.
    for (const [prop, spec] of Object.entries(c.props)) {
      assert.ok(!/^(on[A-Z]|style|css|class|html|script|href|action|run)/.test(prop) || (prop === 'style' && spec.type === 'enum'), `${name}.${prop}`);
      if (/^send/.test(prop)) assert.ok(name === 'button' && spec.type === 'string' && spec.max === 200, `${name}.${prop}: only a button says what it sends, in at most 200 characters`);
    }
    // An address a view holds is an https one; nothing a view holds is a path to run.
    if (c.group === 'actions') for (const spec of Object.values(c.props)) assert.ok(['string', 'tone', 'https'].includes(spec.type), name);
  }
  assert.equal(catalog.components.link.props.url.type, 'https');
});

test('the module loads in a browser page too, as a global the page reads', () => {
  const page = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'answer-view.js'), 'utf8'), page);
  assert.equal(typeof page.AnswerView.of, 'function');
  const r = page.AnswerView.of(catalog).validate(JSON.stringify({ alt: 'A divider', root: { type: 'divider' } }));
  assert.equal(r.ok, true);
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('the server hands the catalog out, and says so in features', async () => {
  const r = await srv.api('/ui-catalog');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, catalog);
  assert.ok((await srv.api('/version')).data.features.includes('ui-catalog'));
});
