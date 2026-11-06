// A run that Claude Code gave up on a busy or failing API, or the network, after its own retries (#1093) carries on
// once in its own session after a pause; a usage limit or a 429 is never asked again. The problem a run shows says
// "couldn't finish" once it had taken steps, and tells a usage limit from a busy server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot } = require('./helpers');
const { friendlyProblem } = require('../lib/problems');

const OVERLOADED = 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_TRANSIENT_RETRY_MS: '200' } }); });
after(async () => {
  for (const f of ['error-result.txt', 'error-result-once.txt']) fs.rmSync(path.join(srv.out, f), { force: true });
  await srv.stop();
});
const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const flag = (rec, name) => (rec.args.includes(name) ? rec.args[rec.args.indexOf(name) + 1] : null);

test('a run that an overloaded API ended carries on once in its own session', async () => {
  const bot = await makeBot(srv, { name: 'Morning Report', emoji: '🌅' });
  fs.writeFileSync(path.join(srv.out, 'error-result-once.txt'), OVERLOADED);
  srv.reply('The report is ready.');
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Write the morning report' } })).data;
  const first = await srv.nextRun(isRunOf(bot), 'the run that failed');
  const second = await srv.nextRun(isRunOf(bot), 'the run carrying on');
  assert.equal(flag(second, '--resume'), `fake-${first.n}`);
  assert.match(second.stdin, /Claude's servers failed for a moment/);
  const ended = await srv.finished(run.id);
  assert.deepEqual([ended.status, ended.result, ended.error], ['success', 'The report is ready.', null]);
});

test('a second failure, and a usage limit, fail as before: no run is asked again for a limit', async () => {
  const bot = await makeBot(srv, { name: 'Busy Twice', emoji: '⛔' });
  fs.writeFileSync(path.join(srv.out, 'error-result.txt'), OVERLOADED);
  try {
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Do it' } })).data;
    const ended = await srv.finished(run.id);
    assert.equal(ended.status, 'error');
    assert.match(ended.problem, /^Claude's servers were busy, so I stopped/);
    assert.equal(srv.runs().filter(isRunOf(bot)).length, 2, 'one start, and one carrying on');
    const limited = await makeBot(srv, { name: 'Limited', emoji: '🧱' });
    fs.writeFileSync(path.join(srv.out, 'error-result.txt'), "Claude AI usage limit reached|1793990000");
    const l = await srv.finished((await srv.api(`/bots/${limited.id}/run`, { method: 'POST', body: { prompt: 'Do it' } })).data.id);
    // It carries on by itself after the reset instead (#1090, usage-limit.test.js).
    assert.match(l.problem, /^Claude's usage limit was reached, so I stopped\. I'll carry on by myself once it resets\./);
    assert.equal(srv.runs().filter(isRunOf(limited)).length, 1, 'a limit is not asked again');
  } finally {
    fs.rmSync(path.join(srv.out, 'error-result.txt'), { force: true });
  }
});

test("a network failure after steps says it couldn't finish, before any step that it couldn't start", () => {
  const net = { status: 'error', error: 'fetch failed: ECONNRESET' };
  assert.match(friendlyProblem(net), /^I couldn't reach Claude's servers, so I couldn't start\./);
  assert.match(friendlyProblem({ ...net, steps: { count: 30 } }), /^I lost the connection to Claude's servers, so I couldn't finish\./);
});
