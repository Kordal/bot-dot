// A Chief turn writes its message to Claude Code before Claude Code gives up waiting for it (#499): Claude Code goes
// on without a prompt after 3 s, and `-p --resume` without one fails with "No deferred tool marker found". The
// lookup is awaited for at most LOOKUP_WAIT_MS, Claude Code starts once the message is whole, and the error, with the
// warning before it, is said plainly.
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

// A stand-in for a Claude Code process: what it was given, and its output and end on demand.
function fakeProcess() {
  const EventEmitter = require('events');
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.given = null;
  p.killed = [];
  p.stdin = { on: () => p.stdin, end: (text) => { p.given = text; } };
  p.kill = (signal) => { p.killed.push(signal); return true; };
  return p;
}
const tick = () => new Promise((r) => setImmediate(r));

test('Claude Code starts only when the turn\'s message is written, and is that process from then on', async () => {
  const { startsOnMessage } = require('../lib/chief');
  let started = 0;
  const real = fakeProcess();
  const child = startsOnMessage(() => { started++; return real; });
  const seen = [];
  child.stdout.on('data', (c) => seen.push(`out:${c}`));
  child.stderr.on('data', (c) => seen.push(`err:${c}`));
  child.on('close', (code) => seen.push(`close:${code}`));
  child.stdin.on('error', () => {});
  await tick();
  assert.equal(started, 0, 'nothing runs while the lookup is awaited');
  child.stdin.end('My message: hello');
  assert.equal(started, 1);
  assert.equal(real.given, 'My message: hello', 'its prompt is whole the moment it starts');
  child.stdin.end('again');
  assert.equal(started, 1, 'started once');
  real.stdout.emit('data', '{"type":"result"}\n');
  real.stderr.emit('data', 'warn');
  real.emit('close', 0);
  assert.deepEqual(seen, ['out:{"type":"result"}\n', 'err:warn', 'close:0'], 'in the process\'s order');
  child.kill('SIGTERM');
  assert.deepEqual(real.killed, ['SIGTERM']);
});

test('a turn ended before its message ends without a process', async () => {
  const { startsOnMessage } = require('../lib/chief');
  let started = 0;
  const child = startsOnMessage(() => { started++; return fakeProcess(); });
  const closed = [];
  child.on('close', (code) => closed.push(code));
  child.kill('SIGTERM');
  child.kill('SIGKILL');
  await tick();
  assert.deepEqual(closed, [null], 'it ends once');
  child.stdin.end('late message');
  assert.equal(started, 0, 'and never starts');
});

test('a process that cannot start fails the turn', async () => {
  const { startsOnMessage } = require('../lib/chief');
  const child = startsOnMessage(() => { throw new Error('spawn EACCES'); });
  const errors = [];
  child.on('error', (e) => errors.push(e.message));
  child.stdin.end('hello');
  await tick();
  assert.deepEqual(errors, ['spawn EACCES']);
});

test('-p with no prompt at all is said plainly too', () => {
  const said = friendlyProblem({ status: 'error', error: 'Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\nError: Input must be provided either through stdin or as a prompt argument when using --print' }, '', { details: false });
  assert.equal(said, "My message didn't reach Claude in time, so I couldn't answer. Send it again.");
});
