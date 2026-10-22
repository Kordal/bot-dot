// A check of Claude's sign-in that could not tell is never taken for "signed out" (BUSY-009; docs/api.md, the
// feed's `hello.claude` and `claude` event): when the check fails, answers something unreadable, or Claude Code is
// not installed, the server sends no `claude` event, `hello.claude` is null, and the scheduler stays as it was:
// jobs run and nothing is held. A real "signed out" still does all of it, and a real sign-in ends it.
// While botdot holds jobs and messages as signed out, a hello from a check that could not tell still says
// "signed out", also after a restart (BUSY-010); and a sign-in or a sign-out reads its check the same way.
// The check is the stand-in's: $FAKE_OUT/signed-out, auth-fails and auth-unreadable.
// Tests here count on work for a busy bot waiting its turn: one run of a bot at a time (ADR 062 lets three go at
// once, and at that limit the same holds).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, restartServer, makeBot, heldRun, readData } = require('./helpers');
const setupLib = require('../lib/setup');

const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const COULD_NOT = 'Could not ask Claude Code whether it is signed in.';

test('what one check says: signed in, signed out, or nothing', () => {
  const { signedIn } = setupLib;
  assert.equal(signedIn({ installed: true, loggedIn: true }), true);
  assert.equal(signedIn({ installed: true, loggedIn: false }), false);
  for (const none of [null, undefined, { installed: false, loggedIn: false }, { installed: true, loggedIn: false, error: COULD_NOT }, { installed: true, loggedIn: true, error: COULD_NOT }]) {
    assert.equal(signedIn(none), null, JSON.stringify(none));
  }
});

test('an answer botdot cannot read, a check that fails and a botdot without Claude Code: an error or not installed, never "signed out"', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-claude-'));
  const out = path.join(dir, 'fake');
  fs.mkdirSync(out);
  const before = process.env.FAKE_OUT;
  process.env.FAKE_OUT = out;
  t.after(() => { if (before === undefined) delete process.env.FAKE_OUT; else process.env.FAKE_OUT = before; fs.rmSync(dir, { recursive: true, force: true }); });
  const setup = setupLib.create(path.join(dir, 'data'), { claudeBin: FAKE });
  const check = async (file) => {
    if (file) fs.writeFileSync(path.join(out, file), '');
    try { return await setup.claudeStatus(true); } finally { if (file) fs.rmSync(path.join(out, file)); }
  };
  assert.deepEqual([(await check()).loggedIn, (await check()).error], [true, undefined]);
  const signedOut = await check('signed-out');
  assert.deepEqual([signedOut.loggedIn, signedOut.error, setupLib.signedIn(signedOut)], [false, undefined, false]);
  for (const file of ['auth-unreadable', 'auth-fails']) {
    const status = await check(file);
    assert.deepEqual([status.installed, status.error, setupLib.signedIn(status)], [true, COULD_NOT, null], file);
  }
  const none = await setupLib.create(path.join(dir, 'data'), { claudeBin: null }).claudeStatus();
  assert.deepEqual([none, setupLib.signedIn(none)], [{ installed: false, loggedIn: false }, null]);
});

// The feed as an app that connects reads it: its hello, and the events since `id`.
async function feedSince(srv, id) {
  const ac = new AbortController();
  const res = await fetch(`${srv.base}/api/events?since=${encodeURIComponent(id)}`, { signal: ac.signal });
  const reader = res.body.getReader();
  let text = '';
  let until = null; // what was missed follows the hello at once: read on for a moment after it, then hang up
  for (;;) {
    const next = await Promise.race([reader.read(), ...(until ? [until] : [])]);
    if (!next || next.done) break;
    text += Buffer.from(next.value).toString();
    if (!until && text.includes('event: hello')) until = new Promise((r) => setTimeout(r, 150));
  }
  ac.abort();
  const events = text.split('\n\n').map((c) => ({ id: c.match(/^id: (.*)$/m)?.[1], type: c.match(/^event: (.*)$/m)?.[1], data: JSON.parse(c.match(/^data: (.*)$/m)?.[1] || '{}') })).filter((e) => e.type);
  return { hello: events.find((e) => e.type === 'hello').data, said: events.filter((e) => e.id && e.type === 'claude').map((e) => e.data.loggedIn) };
}

test('a check that could not tell says nothing while nothing is held: no event, hello.claude null, jobs run; signed out and signed in still say it, and a held sign-out is said by every hello', async () => {
  let srv = await startServer();
  const file = (name) => path.join(srv.out, name);
  // The server asks Claude now, as when Setup is opened; the feed's hello reads that answer.
  const asked = async () => (await srv.api('/setup?fresh')).data.claude;
  const kept = () => (fs.existsSync(path.join(srv.data, 'scheduler.json')) ? readData(srv.data, 'scheduler.json').signedOut : undefined);
  try {
    const start = (await feedSince(srv, '')).hello;
    assert.deepEqual(start.claude, { loggedIn: true });

    // Signed in, and the check cannot tell: nothing is said, and what waits for a bot starts as ever.
    for (const cannot of ['auth-unreadable', 'auth-fails']) {
      const bot = await makeBot(srv, { name: `Goes On ${cannot}`, emoji: '🚶' });
      fs.writeFileSync(file(cannot), '');
      const first = await heldRun(srv, bot, `Long, while ${cannot}`);
      const mine = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: `Waits, while ${cannot}` } })).data;
      assert.equal(mine.status, 'queued');
      assert.deepEqual([(await asked()).error, kept()], [COULD_NOT, undefined], cannot);
      const now = await feedSince(srv, start.lastEventId);
      assert.deepEqual([now.hello.claude, now.said], [null, []], `${cannot}: no word of it`);
      srv.unhold();
      srv.release(first.rec);
      assert.deepEqual([(await srv.finished(first.run.id)).status, (await srv.finished(mine.id)).status], ['success', 'success'], `${cannot}: nothing is held`);
      fs.rmSync(file(cannot));
    }

    // Really signed out: the event, hello, and the scheduler's hold, as before.
    fs.writeFileSync(file('signed-out'), '');
    assert.deepEqual([(await asked()).loggedIn, kept()], [false, true]);
    let now = await feedSince(srv, start.lastEventId);
    assert.deepEqual([now.hello.claude, now.said], [{ loggedIn: false }, [false]]);
    // Signed out, and the next check cannot tell: it is not taken for a sign-in either. Nothing changes, and an app
    // that connects is still told: botdot holds jobs and messages as signed out.
    fs.writeFileSync(file('auth-fails'), '');
    assert.deepEqual([(await asked()).error, kept()], [COULD_NOT, true]);
    now = await feedSince(srv, start.lastEventId);
    assert.deepEqual([now.hello.claude, now.said], [{ loggedIn: false }, [false]]);
    // That hello came from no check: the next check that can tell is said, though nothing changed.
    fs.rmSync(file('auth-fails'));
    assert.deepEqual([(await asked()).loggedIn, kept()], [false, true]);
    now = await feedSince(srv, start.lastEventId);
    assert.deepEqual([now.hello.claude, now.said], [{ loggedIn: false }, [false, false]]);
    assert.equal((await asked()).loggedIn, false);
    assert.deepEqual((await feedSince(srv, start.lastEventId)).said, [false, false], 'and not again with every check');
    // A real sign-in ends it.
    fs.rmSync(file('signed-out'));
    assert.deepEqual([(await asked()).loggedIn, kept()], [true, undefined]);
    now = await feedSince(srv, start.lastEventId);
    assert.deepEqual([now.hello.claude, now.said], [{ loggedIn: true }, [false, false, true]]);

    // Signed out, then botdot starts again while the check cannot tell: what it kept is said before any check can tell.
    fs.writeFileSync(file('signed-out'), '');
    assert.deepEqual([(await asked()).loggedIn, kept()], [false, true]);
    fs.writeFileSync(file('auth-fails'), '');
    srv = await restartServer(srv);
    const again = await feedSince(srv, '');
    assert.deepEqual([again.hello.claude, again.said, kept()], [{ loggedIn: false }, [], true]);
    // The owner signed in meanwhile: the first check that can tell says so, and the hold ends.
    fs.rmSync(file('auth-fails'));
    fs.rmSync(file('signed-out'));
    assert.deepEqual([(await asked()).loggedIn, kept()], [true, undefined]);
    now = await feedSince(srv, again.hello.lastEventId);
    assert.deepEqual([now.hello.claude, now.said], [{ loggedIn: true }, [true]]);
  } finally { srv.unhold(); await srv.stop(); }
});

test('a sign-out whose check could not tell: botdot holds as signed out and says so to the apps that are open, until a check can tell; one that failed holds nothing', async () => {
  const srv = await startServer();
  const file = (name) => path.join(srv.out, name);
  const kept = () => (fs.existsSync(path.join(srv.data, 'scheduler.json')) ? readData(srv.data, 'scheduler.json').signedOut : undefined);
  const signOut = () => srv.api('/setup/claude', { method: 'DELETE' });
  const asked = async () => (await srv.api('/setup?fresh')).data.claude;
  try {
    const start = (await feedSince(srv, '')).hello;
    fs.writeFileSync(file('auth-fails'), '');
    let out = await signOut();
    assert.deepEqual([out.status, out.data.claude.error, kept()], [200, COULD_NOT, true], 'answered as a check that could not tell, not as signed out');
    // It did not sign out after all. No app connected meanwhile: the event alone said "signed out" to the apps that
    // were open, and the next check that can tell is said though it found what the last such check found.
    fs.rmSync(file('auth-fails'));
    assert.deepEqual([(await asked()).loggedIn, kept()], [true, undefined]);
    let now = await feedSince(srv, start.lastEventId);
    assert.deepEqual([now.hello.claude, now.said], [{ loggedIn: true }, [false, true]]);
    assert.equal((await asked()).loggedIn, true);

    // And an app that connects while it is held is told by its hello, as before.
    fs.writeFileSync(file('auth-fails'), '');
    out = await signOut();
    assert.deepEqual([out.status, out.data.claude.error, kept()], [200, COULD_NOT, true]);
    now = await feedSince(srv, start.lastEventId);
    assert.deepEqual([now.hello.claude, now.said], [{ loggedIn: false }, [false, true, false]]);
    fs.rmSync(file('auth-fails'));
    assert.deepEqual([(await asked()).loggedIn, kept()], [true, undefined]);

    // A sign-out that failed, Claude still signed in, and the check after it cannot tell: nothing is held, and
    // nothing is said.
    fs.writeFileSync(file('auth-fails-next'), '');
    out = await signOut();
    assert.deepEqual([out.status === 200, out.data.error, kept()], [false, "Couldn't sign out of Claude.", undefined]);
    assert.equal(fs.existsSync(file('auth-fails')), true, 'the check after the failed sign-out could not tell');
    fs.rmSync(file('auth-fails'));
    assert.deepEqual([(await asked()).loggedIn, kept()], [true, undefined]);
    assert.deepEqual((await feedSince(srv, start.lastEventId)).said, [false, true, false, true]);
  } finally { await srv.stop(); }
});

test('a sign-in and a sign-out read their check as every check is read: "could not tell" is neither a wrong code nor signed out', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-claude-'));
  const out = path.join(dir, 'fake');
  fs.mkdirSync(out);
  const before = { FAKE_OUT: process.env.FAKE_OUT, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  process.env.FAKE_OUT = out;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const setup = setupLib.create(path.join(dir, 'data'), { claudeBin: FAKE });
  t.after(() => {
    setup.cancelLogin();
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  // While `file` stands in the stand-in's folder.
  const during = async (file, fn) => {
    if (file) fs.writeFileSync(path.join(out, file), '');
    try { return await fn(); } finally { if (file) fs.rmSync(path.join(out, file)); }
  };
  const code = async (file) => {
    assert.match((await setup.startLogin()).url, /oauth\/authorize\?/);
    return during(file, () => setup.submitCode('a-code'));
  };

  assert.deepEqual([(await code()).loggedIn, (await code()).error], [true, undefined]);
  await assert.rejects(code('signed-out'), /^Error: That code didn't work\. Codes work once/);
  for (const cannot of ['auth-unreadable', 'auth-fails']) {
    const status = await code(cannot);
    assert.deepEqual([status.error, setupLib.signedIn(status)], [COULD_NOT, null], `${cannot}: not a wrong code`);
  }

  const signedOut = await during('signed-out', () => setup.logout());
  assert.deepEqual([signedOut.loggedIn, signedOut.error], [false, undefined]);
  await assert.rejects(setup.logout(), /^Error: Couldn't sign out of Claude\.$/);
  for (const cannot of ['auth-unreadable', 'auth-fails']) {
    const status = await during(cannot, () => setup.logout());
    assert.deepEqual([status.error, setupLib.signedIn(status)], [COULD_NOT, null], `${cannot}: not taken for signed out`);
  }
});
