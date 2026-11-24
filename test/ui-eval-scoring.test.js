// The rules the eval of answer views scores by (test/live/ui-scoring.js), and its cases (test/live/ui-eval-cases.js),
// checked without a Claude: make ui-eval is the slow suite that uses them (#1625).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { skillPicked, fencesOf, score, summary, report } = require('./live/ui-scoring');
const { CASES } = require('./live/ui-eval-cases');

const fence = (obj) => `\`\`\`ui\n${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\`\`\``;
const TABLE = { alt: 'Three options.', root: { type: 'table', columns: [{ label: 'A' }, { label: 'B' }], rows: [['1', '2']], source: 'the owner\'s message' } };
const CHART = { alt: 'Sales.', root: { type: 'chart', labels: ['Jan', 'Feb'], series: [{ points: [1, 2] }], source: 'sales.csv' } };
const events = (...calls) => [{ type: 'assistant', message: { content: calls.map((input, i) => ({ type: 'tool_use', id: `t${i}`, name: input.name || 'Skill', input: input.input || input })) } }];

test('the skill is picked when the run loaded kit:ui with the Skill tool, and not for any other skill or tool', () => {
  assert.equal(skillPicked(events({ skill: 'kit:ui' })), true);
  assert.equal(skillPicked(events({ skill: 'ui' })), true);
  assert.equal(skillPicked(events({ skill: 'kit:ui', args: '' }, { skill: 'kit:pages' })), true);
  assert.equal(skillPicked(events({ skill: 'kit:pages' })), false);
  assert.equal(skillPicked(events({ skill: 'botdot:ui' })), false);
  assert.equal(skillPicked(events({ name: 'Bash', input: { command: 'cat kit:ui' } })), false);
  assert.equal(skillPicked([{ type: 'user', message: { content: [{ type: 'text', text: 'kit:ui' }] } }]), false);
  assert.equal(skillPicked([]), false);
  assert.equal(skillPicked(undefined), false);
});

test('the fences a reply holds are read by the validator of the apps: drawn, or refused with why', () => {
  const none = fencesOf('Warsaw.');
  assert.deepEqual({ n: none.fences.length, text: none.text }, { n: 0, text: 'Warsaw.' });

  const ok = fencesOf(`Three fit.\n\n${fence(TABLE)}\n\nThe second is cheapest.`);
  assert.equal(ok.fences.length, 1);
  assert.deepEqual({ drawn: ok.fences[0].drawn, problems: ok.fences[0].problems, types: ok.fences[0].types }, { drawn: true, problems: [], types: ['table'] });
  assert.match(ok.text, /Three fit\./);
  assert.match(ok.text, /cheapest/);

  // Not JSON, no alt, over a limit: refused, with the validator's own reason.
  assert.equal(fencesOf(fence('{ not json')).fences[0].refused, 'not-json');
  assert.equal(fencesOf(fence({ root: { type: 'text', text: 'x' } })).fences[0].refused, 'no-alt');
  const four = [1, 2, 3, 4].map(() => fence({ alt: 'a', root: { type: 'text', text: 'x' } })).join('\n\n');
  assert.deepEqual(fencesOf(four).fences.map((f) => f.drawn), [true, true, true, false]);
  assert.equal(fencesOf(four).fences[3].refused, 'too-many-fences');
  // An unclosed fence is code, with the reason.
  assert.equal(fencesOf('```ui\n{ "alt": "x"').fences[0].refused, 'unclosed');

  // What the validator had to drop, cut or refuse is a problem: a colour, an unknown component, a missing needed prop.
  const styled = fencesOf(fence({ alt: 'x', root: { type: 'text', text: 'hi', color: 'red' } })).fences[0];
  assert.equal(styled.drawn, true);
  assert.deepEqual(styled.problems.map((p) => p.code), ['unknown-prop']);
  const unknown = fencesOf(fence({ alt: 'x', root: { type: 'stack', children: [{ type: 'carousel' }] } })).fences[0];
  assert.ok(unknown.problems.some((p) => p.code === 'unknown-component'));
  // A source left out is noted: the apps draw "No source".
  const bare = fencesOf(fence({ alt: 'x', root: { type: 'chart', series: [{ points: [1, 2] }] } })).fences[0];
  assert.equal(bare.noSource, true);
  assert.equal(fencesOf(fence(TABLE)).fences[0].noSource, false);
  // Another code block in a reply is not a view.
  assert.equal(fencesOf('```json\n{"a":1}\n```').fences.length, 0);
});

test('a prompt where a view is right passes when the skill was picked and a valid, sourced view fits it', () => {
  const c = { id: 'x', view: true, fits: ['table', 'comparison'] };
  const good = { picked: true, reply: `Here.\n\n${fence(TABLE)}` };
  assert.equal(score(c, good).pass, true);
  assert.deepEqual(score(c, good).checks.map((x) => [x.id, x.ok]), [['picked', true], ['drew', true], ['valid', true], ['source', true], ['fit', true], ['prose', true]]);
  // Prose only: the skill was not picked and nothing was drawn.
  const prose = score(c, { picked: false, reply: 'Option B is cheapest.' });
  assert.deepEqual(prose.checks.filter((x) => x.ok === false).map((x) => x.id), ['picked', 'drew', 'fit']);
  assert.equal(prose.pass, false);
  // Picked but wrote an invalid fence.
  const bad = score(c, { picked: true, reply: `Here.\n\n${fence('{ nope')}` });
  assert.deepEqual(bad.checks.filter((x) => x.ok === false).map((x) => x.id), ['drew', 'valid', 'fit']);
  // A fence with no answer in words beside it, or with no source, or of a kind that doesn't fit.
  assert.equal(score(c, { picked: true, reply: fence(TABLE) }).checks.find((x) => x.id === 'prose').ok, false);
  assert.equal(score(c, { picked: true, reply: `Here.\n${fence({ ...TABLE, root: { ...TABLE.root, source: undefined } })}` }).checks.find((x) => x.id === 'source').ok, false);
  assert.equal(score(c, { picked: true, reply: `Here.\n${fence(CHART)}` }).checks.find((x) => x.id === 'fit').ok, false);
  // A problem the validator named fails valid, even though the fence was drawn.
  const styled = score(c, { picked: true, reply: `Here.\n${fence({ ...TABLE, root: { ...TABLE.root, color: 'red' } })}` });
  assert.equal(styled.checks.find((x) => x.id === 'valid').ok, false);
  assert.match(styled.checks.find((x) => x.id === 'valid').detail, /unknown-prop/);
});

test('a prompt where prose is right passes when the skill was not picked and no fence was written', () => {
  const c = { id: 'fact', view: false };
  const good = score(c, { picked: false, reply: 'Warsaw.' });
  assert.equal(good.pass, true);
  assert.deepEqual(good.checks.map((x) => [x.id, x.ok]), [['picked', true], ['drew', true], ['valid', null], ['source', null], ['fit', null], ['prose', null]]);
  const drew = score(c, { picked: true, reply: `Warsaw.\n\n${fence(TABLE)}` });
  assert.deepEqual(drew.checks.filter((x) => x.ok === false).map((x) => x.id), ['picked', 'drew']);
  // Even a refused fence is a fence written where prose was right; its validity is still reported.
  const refused = score(c, { picked: false, reply: fence('{ nope') });
  assert.deepEqual(refused.checks.filter((x) => x.ok === false).map((x) => x.id), ['drew', 'valid']);
});

test('the form case of wave 2 may be a view or a written list: the pick is not scored, a fence written still must be valid', () => {
  const c = { id: 'form', view: 'either', wave: 2 };
  assert.equal(score(c, { picked: false, reply: '1. Where to? 2. When? 3. Budget? 4. Who comes?' }).pass, true);
  assert.equal(score(c, { picked: false, reply: '1. Where to?' }).checks.find((x) => x.id === 'picked').ok, null);
  assert.equal(score(c, { picked: true, reply: `Fill in:\n${fence({ alt: 'Four questions.', root: { type: 'list', items: ['Where to?', 'When?', 'Budget?', 'Who comes?'], ordered: true } })}` }).pass, true);
  assert.equal(score(c, { picked: true, reply: fence('{ nope') }).pass, false);
});

test('a run that did not finish is reported as an error, not as a failed case', () => {
  const r = report([{ id: 'a', says: 'x', error: 'timed out' }], {});
  assert.match(r, /\| a \| error \|/);
  assert.match(r, /did not finish: timed out/);
});

test('the report names each case, how the skill was picked and every fence checked, and what failed and why', () => {
  const results = [
    { id: 'compare', view: true, score: score({ id: 'compare', view: true, fits: ['table'] }, { picked: true, reply: `Here.\n${fence(TABLE)}` }), seen: { picked: true, reply: `Here.\n${fence(TABLE)}` } },
    { id: 'fact', view: false, score: score({ id: 'fact', view: false }, { picked: true, reply: `Warsaw.\n${fence(TABLE)}` }), seen: { picked: true, reply: `Warsaw.\n${fence(TABLE)}` } },
    { id: 'form', view: 'either', wave: 2, score: score({ id: 'form', view: 'either', wave: 2 }, { picked: false, reply: 'Where to?' }), seen: { picked: false, reply: 'Where to?' } },
  ];
  const s = summary(results);
  assert.deepEqual(s, { viewPrompts: 1, viewPicked: 1, prosePrompts: 1, prosePicked: 1, fences: 2, fencesValid: 2 });
  const md = report(results, { date: '2026-11-24', model: 'm', commit: 'abc' });
  assert.match(md, /# Answer views — 2026-11-24/);
  assert.match(md, /\| compare \| pass \|/);
  assert.match(md, /\| fact \| FAIL \|/);
  assert.match(md, /\| form \(wave 2\) \| pass \|/);
  assert.match(md, /kit:ui was picked for 1 of 1 prompts where a view is right and for 1 of 1 where prose is right/);
  assert.match(md, /2 of 2 fences passed the validator/);
  assert.match(md, /1\/3 cases passed|2\/3 cases passed/);
  assert.match(md, /fact · picked/);
});

test('its cases: two where a view is right, the form of wave 2 where either will do, three where prose is right', () => {
  assert.deepEqual(CASES.map((c) => c.id), ['compare-three', 'time-series', 'four-field-form', 'one-line-fact', 'apology', 'yes-no']);
  const ids = new Set(CASES.map((c) => c.id));
  assert.equal(ids.size, CASES.length);
  assert.deepEqual(CASES.filter((c) => c.view === true).map((c) => c.id), ['compare-three', 'time-series']);
  assert.deepEqual(CASES.filter((c) => c.view === 'either').map((c) => [c.id, c.wave]), [['four-field-form', 2]]);
  assert.deepEqual(CASES.filter((c) => c.view === false).map((c) => c.id), ['one-line-fact', 'apology', 'yes-no']);
  const catalog = require('../lib/ui-catalog.json');
  for (const c of CASES) {
    assert.ok(c.says.length > 20, c.id);
    // Every prompt carries the figures it needs, so that nothing is looked up and the run is one turn.
    for (const k of c.fits || []) assert.ok(catalog.components[k], `${c.id}: ${k} is in the catalog`);
  }
  // What each is about is in what the owner says: three options, a time series, four values.
  assert.match(CASES[0].says, /three/i);
  assert.match(CASES[1].says, /month|week|day/i);
  assert.match(CASES[2].says, /four|4/i);
});
