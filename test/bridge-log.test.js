// The browser bridge's log in a bot's computer stays bounded (#355): the launcher keeps the previous run as
// bridge.log.1 and caps the live bridge.log, whoever writes to it. Runs the launcher with a stand-in Camoufox
// (test/fixtures/camoufox-bridge-log.py), no Docker.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LAUNCHER = path.join(__dirname, '..', 'deploy', 'desktop', 'camoufox-browser');
const FIXTURE = path.join(__dirname, 'fixtures', 'camoufox-bridge-log.py');
const CAP = 4096;

function hasPython() {
  try { execFileSync('python3', ['-c', '']); return true; } catch { return false; }
}

function scratch(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

function start(dir, scenario) {
  return JSON.parse(execFileSync('python3', [FIXTURE, LAUNCHER, dir, String(CAP), scenario], { timeout: 30_000, encoding: 'utf8' }));
}

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('a bridge start keeps the previous run as bridge.log.1, replacing an older one, and begins a fresh bridge.log (#355)', { skip: !hasPython() }, (t) => {
  const dir = scratch(t, { 'bridge.log': 'the previous run\n', 'bridge.log.1': 'the run before\n' });
  const out = start(dir, 'write');
  assert.equal(out.where.ok, false, 'the bridge serves');
  assert.equal(read(dir, 'bridge.log.1'), 'the previous run\n');
  assert.ok(!read(dir, 'bridge.log').includes('the previous run'), 'bridge.log began fresh');
});

test("bridge.log stays at or under the cap, with the last lines of the bridge and of Camoufox's processes at its end (#355)", { skip: !hasPython() }, (t) => {
  const dir = scratch(t);
  const out = start(dir, 'write');
  assert.ok(out.drained, 'the last line reached the log');
  const log = read(dir, 'bridge.log');
  assert.ok(Buffer.byteLength(log) <= CAP, `bridge.log is ${Buffer.byteLength(log)} bytes, over ${CAP}`);
  assert.ok(log.endsWith('child last\nown last\n'), `the last lines are at the end:\n${log.slice(-200)}`);
  assert.match(log, /^own|^child/, 'it begins with a whole line');
  assert.ok(!fs.existsSync(path.join(dir, 'bridge.log.1')), 'no copy of a run there was not');
});

test('a second start while a bridge answers leaves bridge.log and bridge.log.1 as they are (#355)', { skip: !hasPython() }, (t) => {
  const dir = scratch(t, { 'bridge.log': 'the running bridge\n', 'bridge.log.1': 'the run before\n' });
  const out = start(dir, 'running');
  assert.ok(out.returned, 'the second start ended by itself');
  assert.equal(read(dir, 'bridge.log'), 'the running bridge\n');
  assert.equal(read(dir, 'bridge.log.1'), 'the run before\n');
});

test('a log that cannot be opened does not stop the bridge from serving (#355)', { skip: !hasPython() }, (t) => {
  const dir = scratch(t);
  const out = start(dir, 'nolog');
  assert.equal(out.where.ok, false);
  assert.match(out.where.error, /open_browser/, 'the bridge answered');
});

test("a bridge that fails after taking its log leaves its traceback at the end of bridge.log (#355)", { skip: !hasPython() }, (t) => {
  const dir = scratch(t);
  assert.throws(() => start(dir, 'crash'), 'the bridge failed');
  assert.match(read(dir, 'bridge.log'), /Traceback[\s\S]*FileNotFoundError.*\n$/, 'its last words are in the log');
});

test('a Camoufox that cannot be imported is told in bridge.log, and the bridge stays (#355)', { skip: !hasPython() }, (t) => {
  const dir = scratch(t);
  const out = start(dir, 'broken');
  assert.ok(out.told, 'the failure reached the log');
  assert.match(read(dir, 'bridge.log'), /Camoufox did not start: (ModuleNotFoundError|ImportError)/);
});

const NOISE = /Traceback|BrokenPipeError|ConnectionResetError|Exception occurred during processing of request/;

test("the second start's check that a bridge answers leaves no traceback in the running bridge's bridge.log (#360)", { skip: !hasPython() }, (t) => {
  const dir = scratch(t);
  const out = start(dir, 'again');
  assert.ok(out.returned, 'the second start ended by itself');
  assert.equal(out.where_after.ok, false);
  assert.match(out.where_after.error, /open_browser/, 'the running bridge still answers');
  assert.ok(out.marked, 'the log caught up');
  const log = read(dir, 'bridge.log');
  assert.doesNotMatch(log, NOISE, `bridge.log:\n${log}`);
});

test('a client that closes before its answer leaves no traceback in bridge.log (#360)', { skip: !hasPython() }, (t) => {
  const dir = scratch(t);
  const out = start(dir, 'gone');
  assert.match(out.where_after.error, /open_browser/, 'the bridge still answers');
  assert.ok(out.marked, 'the log caught up');
  const log = read(dir, 'bridge.log');
  assert.doesNotMatch(log, NOISE, `bridge.log:\n${log}`);
});

test("an empty request is answered at once and never reaches the browser's queue (#360)", { skip: !hasPython() }, (t) => {
  const dir = scratch(t);
  const out = start(dir, 'empty');
  assert.equal(out.empty.ok, false);
  assert.equal(typeof out.empty.error, 'string');
  assert.deepEqual(out.queued, []);
});
