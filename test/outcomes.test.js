// The outcome ledger (ADR 099): one row per finished bot run, beside its entry in memory.db, with the owner's own
// signals after it, no text of the run, and the bot's worst patterns.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toolWatch, outcomeOf, errorKind, CORRECTION } = require('../lib/outcomes');
const { scratchMemory, daysAgo, runMeta } = require('./memory-helpers');

const minutes = (iso, n) => new Date(Date.parse(iso) + n * 60_000).toISOString();
const ended = (overrides = {}) => { const m = runMeta(overrides); return { endedAt: minutes(m.startedAt, 1), ...m, ...overrides }; };

test('a finished run gets one row: how it ended, its failed tools, retries and duration, and no text of the run', (t) => {
  const { memory: m } = scratchMemory(t);
  const tools = toolWatch();
  tools.see({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }, { type: 'tool_use', id: 't2', name: 'WebFetch' }, { type: 'tool_use', id: 't3', name: 'Bash' }] } });
  tools.see({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }, { type: 'tool_result', tool_use_id: 't2' }, { type: 'tool_result', tool_use_id: 't3', is_error: true }] } });
  const run = ended({ prompt: 'SECRETPROMPT', result: 'SECRETREPLY', numTurns: 4, durationMs: 4200, model: 'claude-opus-5-5', relevant: [{ kind: 'note', id: 'ab12cd' }, { kind: 'run', id: 'r-old' }], files: ['a.pdf'] });
  m.outcomes.record(run, { tools, retries: 1, counted: true, replyAt: run.endedAt });
  const o = m.outcomes.get(run.id);
  assert.equal(o.outcome, 'done');
  assert.equal(o.source, 'owner');
  assert.equal(o.task, 'owner');
  assert.equal(o.toolErrors, 2);
  assert.deepEqual(o.failedTools, ['Bash']);
  assert.equal(o.retries, 1);
  assert.equal(o.durationMs, 4200);
  assert.equal(o.turns, 4);
  assert.deepEqual(o.inputs, { notes: ['ab12cd'], runs: ['r-old'], files: 1, model: 'claude-opus-5-5' });
  assert.ok(!JSON.stringify(m.outcomes.list({ botId: 'alpha' })).includes('SECRET'), 'no request or reply in the ledger');
  // Recorded again (indexed again): one row still.
  m.outcomes.record(run, { counted: true, replyAt: run.endedAt });
  assert.equal(m.outcomes.list({ botId: 'alpha' }).length, 1);
  assert.equal(m.outcomes.get(run.id).toolErrors, 2, 'what was known stays');
  assert.equal(m.outcomes.get(run.id).retries, 1);
});

test('the outcome and the error kind are botdot words, never the error text', () => {
  assert.equal(outcomeOf({ status: 'success' }), 'done');
  assert.equal(outcomeOf({ status: 'success' }, true), 'needs_you');
  assert.equal(outcomeOf({ status: 'success', askedChief: true }), 'needs_you');
  assert.equal(outcomeOf({ status: 'success', passed: true }), 'passed');
  assert.equal(outcomeOf({ status: 'stopped', endedBy: 'owner' }), 'stopped');
  assert.equal(outcomeOf({ status: 'error' }), 'failed');
  assert.equal(outcomeOf({ status: 'interrupted' }), 'failed');
  assert.equal(errorKind({ status: 'error', endedBy: 'idle' }), 'idle');
  assert.equal(errorKind({ status: 'error', error: 'Stopped after 300 seconds' }), 'timeout');
  assert.equal(errorKind({ status: 'error', error: 'The script ended with exit code 2' }), 'exit');
  assert.equal(errorKind({ status: 'error', error: "It didn't start: no room" }), 'no_start');
  assert.equal(errorKind({ status: 'error', error: 'Your page at https://x says SECRET' }), 'error');
  assert.equal(errorKind({ status: 'interrupted' }), 'restart');
  assert.equal(errorKind({ status: 'success' }), null);
});

test('the owner writing again within 10 minutes re-asks the newest reply, and a correction says so; later is neither', (t) => {
  const { memory: m } = scratchMemory(t);
  const first = ended({ startedAt: daysAgo(0.1) });
  m.outcomes.record(first, { counted: true, replyAt: first.endedAt });
  assert.equal(m.outcomes.ownerWrote('alpha', 'No, I meant the other orchard', minutes(first.endedAt, 4)), first.id);
  assert.deepEqual([m.outcomes.get(first.id).reasked, m.outcomes.get(first.id).corrected], [true, true]);
  assert.equal(m.outcomes.ownerWrote('alpha', 'and one more thing', minutes(first.endedAt, 5)), null, 'a run is re-asked once');

  const second = ended({ startedAt: daysAgo(0.05) });
  m.outcomes.record(second, { counted: true, replyAt: second.endedAt });
  assert.equal(m.outcomes.ownerWrote('alpha', 'Thanks! Now check the pears', minutes(second.endedAt, 2)), second.id);
  assert.equal(m.outcomes.get(second.id).reasked, true);
  assert.equal(m.outcomes.get(second.id).corrected, undefined);

  const third = ended({ startedAt: daysAgo(0.02) });
  m.outcomes.record(third, { counted: true, replyAt: third.endedAt });
  assert.equal(m.outcomes.ownerWrote('alpha', 'wrong', minutes(third.endedAt, 11)), null, 'past 10 minutes');
  assert.equal(m.outcomes.ownerWrote('beta', 'wrong', minutes(third.endedAt, 1)), null, "another bot's runs are not touched");
  const quiet = ended({ startedAt: daysAgo(0.01) });
  m.outcomes.record(quiet, { counted: false });
  assert.equal(m.outcomes.ownerWrote('alpha', 'wrong', minutes(quiet.endedAt, 1)), null, 'a reply that never reached the owner');
  for (const s of ['nie, chodziło mi o coś innego', 'Popraw to', "That's wrong", 'try again']) assert.ok(CORRECTION.test(s), s);
  for (const s of ['Now do the pears', 'Nice work', 'Notes look fine']) assert.ok(!CORRECTION.test(s), s);
});

test('opened is read from the chat read position when asked, never stored', (t) => {
  const { memory: m } = scratchMemory(t);
  const run = ended();
  m.outcomes.record(run, { counted: true, replyAt: run.endedAt });
  assert.equal(m.outcomes.list({ botId: 'alpha', readAt: () => minutes(run.endedAt, -1) })[0].opened, false);
  assert.equal(m.outcomes.list({ botId: 'alpha', readAt: () => minutes(run.endedAt, 1) })[0].opened, true);
  assert.equal(m.outcomes.list({ botId: 'alpha' })[0].opened, undefined);
});

test("a bot's worst patterns: a task and a signal, the most frequent first, with how many of that task's runs", (t) => {
  const { memory: m } = scratchMemory(t);
  const failing = toolWatch();
  failing.see({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'mcp__gmail__send' }] } });
  failing.see({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true }] } });
  for (let i = 0; i < 4; i++) m.outcomes.record(ended({ startedAt: daysAgo(i + 0.1), jobName: 'Tide check', jobId: 'j1', status: 'error', error: 'Exited with code 1' }));
  for (let i = 0; i < 3; i++) m.outcomes.record(ended({ startedAt: daysAgo(i + 0.2), jobName: 'Tide check', jobId: 'j1' }), { tools: i < 2 ? failing : toolWatch() });
  m.outcomes.record(ended({ startedAt: daysAgo(1), status: 'stopped', endedBy: 'owner' }));
  m.outcomes.record(ended({ startedAt: daysAgo(20), status: 'error' }), {});
  const worst = m.outcomes.worst({ botId: 'alpha', since: daysAgo(7) });
  assert.deepEqual(worst[0], { task: 'job "Tide check"', signal: 'failed (exit)', runs: 4, of: 7, examples: worst[0].examples });
  assert.equal(worst[0].examples.length, 3);
  assert.deepEqual(worst[1], { task: 'job "Tide check"', signal: 'tool errors', runs: 2, of: 7, examples: worst[1].examples, tools: ['mcp__gmail__send'] });
  assert.deepEqual(worst.slice(2).map((w) => [w.task, w.signal, w.runs, w.of]), [['owner', 'stopped by the owner', 1, 1]]);
});

test('a row follows its run: a forget erases it, a deleted bot loses its rows, and the retention drops old ones', (t) => {
  const { memory: m } = scratchMemory(t);
  const forgotten = ended();
  m.indexRun(forgotten);
  m.outcomes.record(forgotten);
  const kept = ended();
  m.indexRun(kept);
  m.outcomes.record(kept);
  m.erase({ runs: [forgotten.id] });
  assert.equal(m.outcomes.get(forgotten.id), null);
  assert.ok(m.outcomes.get(kept.id));

  const old = ended({ startedAt: daysAgo(400) });
  m.indexRun(old);
  m.outcomes.record(old);
  m.prune();
  assert.equal(m.outcomes.get(old.id), null, 'older than the 365 days of past runs');
  assert.ok(m.outcomes.get(kept.id));

  m.outcomes.record(ended({ botId: 'beta' }));
  m.removeOwner('alpha');
  assert.deepEqual(m.outcomes.list({ botId: 'alpha' }), []);
  assert.equal(m.outcomes.list({ botId: 'beta' }).length, 1);
});

test("the Chief's replies and runs still going have no row", (t) => {
  const { memory: m } = scratchMemory(t);
  m.outcomes.record(ended({ botId: 'chief' }));
  m.outcomes.record(ended({ status: 'running' }));
  assert.deepEqual(m.outcomes.list({ botId: 'chief' }), []);
  assert.deepEqual(m.outcomes.list({ botId: 'alpha' }), []);
});
