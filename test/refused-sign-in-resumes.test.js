// A run whose Claude sign-in is refused midway (botdot renewed the sign-in, which ends the token the run was started
// with, #481) carries on in its own session with a new token, once, instead of failing with "Claude refused my sign-in".
// A second refusal is a sign-in that is really gone: the run fails as it did.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot } = require('./helpers');

const REVOKED = 'Failed to authenticate: OAuth token revoked. Please log in again or contact your administrator.';
let srv;
before(async () => { srv = await startServer(); });
after(async () => {
  for (const f of ['error-result.txt', 'error-result-once.txt']) fs.rmSync(path.join(srv.out, f), { force: true });
  await srv.stop();
});
const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const flag = (rec, name) => (rec.args.includes(name) ? rec.args[rec.args.indexOf(name) + 1] : null);

test('a run whose sign-in Claude refused midway carries on in its own session', async () => {
  const bot = await makeBot(srv, { name: 'Long Haul', emoji: '🚚' });
  fs.writeFileSync(path.join(srv.out, 'error-result-once.txt'), REVOKED);
  srv.reply('All twelve steps done.');
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Update the issues page' } })).data;
  const first = await srv.nextRun(isRunOf(bot), 'the refused run');
  const second = await srv.nextRun(isRunOf(bot), 'the run carrying on');
  assert.equal(flag(first, '--resume'), null);
  assert.equal(flag(second, '--resume'), `fake-${first.n}`, 'it resumes the session the refused run was in');
  assert.match(second.stdin, /Claude refused your sign-in midway/);
  assert.doesNotMatch(second.stdin, /Update the issues page/, 'the task is not handed again: the session holds it');
  const ended = await srv.finished(run.id);
  assert.deepEqual([ended.status, ended.result, ended.error], ['success', 'All twelve steps done.', null]);
});

test('a sign-in refused again fails as it did', async () => {
  const bot = await makeBot(srv, { name: 'Signed Out', emoji: '🔒' });
  fs.writeFileSync(path.join(srv.out, 'error-result.txt'), REVOKED);
  try {
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Do it' } })).data;
    const ended = await srv.finished(run.id);
    assert.equal(ended.status, 'error');
    assert.match(ended.problem, /^Claude refused my sign-in/);
    assert.equal(srv.runs().filter(isRunOf(bot)).length, 2, 'one start, and one carrying on');
  } finally {
    fs.rmSync(path.join(srv.out, 'error-result.txt'), { force: true });
  }
});
