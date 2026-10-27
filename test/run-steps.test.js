// A run's steps for its block in a bot's chat (lib/run-steps.js, #625): counted, put in the working line's words,
// the same words in a row kept as one row.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const runSteps = require('../lib/run-steps');

const clock = () => { let t = Date.parse('2026-10-27T10:00:00.000Z'); return () => new Date((t += 1000)); };

test('a run that took no step has none', () => {
  const k = runSteps.keeper({ now: clock() });
  assert.equal(k.view(), null);
  k.see('TodoWrite', { todos: [] });
  k.see('ToolSearch', { query: 'x' });
  assert.equal(k.view(), null, 'the plan and ToolSearch are no steps');
});

test('each tool call counts; a step with words is a row, the same words in a row are one', () => {
  const k = runSteps.keeper({ now: clock(), who: (id) => (id === 'ia' ? 'Infra Admin' : '') });
  k.see('Read', { file_path: '/w/src/a.js' });
  k.see('Read', { file_path: '/w/src/a.js' });
  k.see('Bash', { command: 'rm -rf / # SECRET', description: 'Run the tests' });
  k.see('mcp__self__message_bot', { to: 'ia', message: 'SECRET' });
  k.see('Skill', { skill: 'buildr-pr-workflow' });
  k.see('mcp__unknown__thing', {});
  const v = k.view();
  assert.equal(v.count, 6);
  assert.deepEqual(v.rows.map(({ at, ...r }) => r), [
    { text: 'Reading a.js', n: 2 },
    { text: 'Run the tests' },
    { text: 'Messaging Infra Admin', kind: 'message' },
    { text: 'Using the skill buildr-pr-workflow', kind: 'skill' },
  ]);
  assert.equal(v.rows[0].at, '2026-10-27T10:00:01.000Z');
  assert.doesNotMatch(JSON.stringify(v), /SECRET|rm -rf/);
});

test('the timeline keeps its newest rows, and the count stays whole; a new start forgets the first', () => {
  const k = runSteps.keeper({ now: clock() });
  for (let i = 0; i < runSteps.MAX_ROWS + 5; i++) k.see('Read', { file_path: `/f${i}.txt` });
  const v = k.view();
  assert.equal(v.count, runSteps.MAX_ROWS + 5);
  assert.equal(v.rows.length, runSteps.MAX_ROWS);
  assert.equal(v.rows.at(-1).text, `Reading f${runSteps.MAX_ROWS + 4}.txt`);
  k.again();
  assert.equal(k.view(), null);
});
