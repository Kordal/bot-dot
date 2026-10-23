// A Chief turn writes its message to Claude Code before Claude Code gives up waiting for it (#499): Claude Code goes
// on without a prompt after 3 s, and `-p --resume` without one fails with "No deferred tool marker found". The
// lookup is awaited for at most LOOKUP_WAIT_MS, and that error, with the warning before it, is said plainly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inTime, LOOKUP_WAIT_MS } = require('../lib/chief');
const { friendlyProblem } = require('../lib/problems');

const NONE = { block: '', given: [] };

test('the lookup is awaited well inside Claude Code\'s 3 seconds', () => {
  assert.ok(LOOKUP_WAIT_MS <= 2500, `${LOOKUP_WAIT_MS} ms leaves no margin before Claude Code's 3 s`);
});

test('a lookup in time is given, a late or failed one is left out', async () => {
  const found = { block: 'notes', given: [{ kind: 'note', id: 'n1' }] };
  assert.deepEqual(await inTime(Promise.resolve(found), 50, NONE), found);
  const started = Date.now();
  assert.deepEqual(await inTime(new Promise(() => {}), 50, NONE), NONE, 'one that never answers');
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(await inTime(Promise.reject(new Error('busy')), 50, NONE), NONE);
});

const STDERR = 'Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\nError: No deferred tool marker found in the resumed session. Either the session was not deferred, the marker is stale (tool already ran), or it exceeds the tail-scan window. Provide a prompt to continue the conversation.';

test('a message that never reached Claude is said plainly, without Claude Code\'s words', () => {
  const said = friendlyProblem({ status: 'error', error: STDERR }, '', { details: false });
  assert.equal(said, "My message didn't reach Claude in time, so I couldn't answer. Send it again.");
});

test('the stdin warning is left out of another error it came before', () => {
  const said = friendlyProblem({ status: 'error', error: 'Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\nError: something else' }, '', { details: false });
  assert.equal(said, 'Something went wrong and I couldn\'t finish. It said: “Error: something else”.');
});
