// One run at a time on a screen and its browser (#847, ADR 133): a run takes the screen with a screen tool and keeps
// it while it uses it; another run waits a moment, then is told who holds it. The hold ends with the run, or after a
// while unused. The account's External Virtual PC is one screen for every boat bot on it; on this machine's computer
// each bot's screen is its own, shared only by its own runs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lockLib = require('../lib/screen-lock');
const screensLib = require('../lib/computer-screens');

// A clock that moves only when the lock sleeps, or when the test says so.
function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; }, pass: (ms) => { t += ms; } };
}

test('a run keeps the screen while it uses it; another run waits, then hears who holds it', async () => {
  const c = clock();
  const lock = lockLib.create({ now: c.now, sleep: c.sleep, idleMs: 120_000, waitMs: 20_000 });
  assert.equal(await lock.take('boat:@account', 'run-a', 'alice'), null);
  c.pass(60_000);
  assert.equal(await lock.take('boat:@account', 'run-a', 'alice'), null, 'its own next screen tool renews the hold');
  const start = c.now();
  const busy = await lock.take('boat:@account', 'run-b', 'bob');
  assert.equal(busy.bot, 'alice');
  assert.equal(busy.run, 'run-a');
  assert.ok(c.now() - start >= 20_000, 'it waited first');
  assert.equal(busy.freeInMs, 100_000);
  assert.equal(await lock.take('screen:bob', 'run-b', 'bob'), null, 'another screen is free');
});

test('the hold ends when the run ends, and a waiting run gets the screen then', async () => {
  const c = clock();
  const lock = lockLib.create({ now: c.now, sleep: async (ms) => { c.pass(ms); if (c.now() - start > 3000) lock.release('run-a'); }, idleMs: 120_000, waitMs: 20_000 });
  await lock.take('k', 'run-a', 'alice');
  const start = c.now();
  assert.equal(await lock.take('k', 'run-b', 'bob'), null, 'it got the screen while it waited');
  assert.ok(c.now() - start < 5000);
  assert.equal(lock.holder('k').run, 'run-b');
});

test('a hold unused for longer than the idle time ends by itself', async () => {
  const c = clock();
  const lock = lockLib.create({ now: c.now, sleep: c.sleep, idleMs: 120_000, waitMs: 20_000 });
  await lock.take('k', 'run-a', 'alice');
  c.pass(120_001);
  assert.equal(lock.holder('k'), null);
  assert.equal(await lock.take('k', 'run-b', 'bob'), null);
});

test("boat bots on the account's machine share one screen; on this machine's computer each bot has its own", async () => {
  const c = clock();
  const lock = lockLib.create({ now: c.now, sleep: c.sleep, idleMs: 120_000, waitMs: 1000 });
  const screens = screensLib.create(fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-lock-')));
  const kinds = { alice: 'boat', bob: 'boat', carol: 'linux', dave: 'linux' };
  const boat = { boxOf: () => '@account' };
  const names = { alice: 'Alice', bob: 'Bob', carol: 'Carol', dave: 'Dave' };
  const f = screensLib.facade({}, screens, { boat, kindOf: (id) => kinds[id], nameOf: (id) => names[id], lock, now: c.now });

  assert.equal(await f.holdScreen('alice', 'r1'), null);
  const busy = await f.holdScreen('bob', 'r2');
  assert.match(busy, /in use by Alice/);
  assert.match(busy, /run_shell, read_file and write_file work now/);

  assert.equal(await f.holdScreen('carol', 'r3'), null);
  assert.equal(await f.holdScreen('dave', 'r4'), null, "dave's screen is not carol's");
  assert.match(await f.holdScreen('carol', 'r5'), /in use by another run of yours/, "carol's two runs share her screen");

  f.releaseScreen('r1');
  assert.equal(await f.holdScreen('bob', 'r2'), null, "alice's run ended: bob's gets the screen");
});
