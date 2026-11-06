// A run that carries on after the owner's yes goes on in the stopped run's own session (ADR 166): Claude Code is
// started with --resume and that session, and handed only the owner's answer, so what the bot read and did is still
// there. A session Claude Code no longer has starts the run afresh with the request and its reply, as before (ADR 009),
// and a run cut off by a restart of botdot always starts afresh (ADR 140). Against the stand-in for Claude.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot } = require('./helpers');
const { kit, BASH } = require('./carry-on-helpers');

let srv, asksOf, answer, lastRun, refused, carriedOn;
before(async () => {
  srv = await startServer();
  ({ asksOf, answer, lastRun, refused, carriedOn } = kit(srv));
  fs.writeFileSync(path.join(srv.out, 'uuid-sessions'), ''); // sessions with ids as Claude Code writes them
});
after(async () => { srv.unhold(); await srv.stop(); });
beforeEach(() => fs.rmSync(path.join(srv.out, 'no-session'), { force: true }));

test("after Allow the bot goes on in its stopped run's session, handed only the owner's answer", async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '💻', allowedTools: ['Read'] });
  srv.reply("I can't run commands yet.");
  const first = await refused(bot, [BASH], { prompt: 'Check the PRs and say which are stale' });
  assert.match(first.sessionId, /^[0-9a-f-]{36}$/);
  const [card] = await asksOf(bot);
  srv.reply('Two are stale: #4 and #9.');
  await answer(card, true);
  const next = await carriedOn(bot, first);
  const rec = await lastRun(bot);
  assert.equal(rec.args[rec.args.indexOf('--resume') + 1], first.sessionId, 'its own session');
  assert.match(rec.stdin, /^botdot writes this, not the owner: nobody typed it\. Your run \S+ stopped above/);
  assert.match(rec.stdin, /The owner allowed you to: run commands\./);
  assert.doesNotMatch(rec.stdin, /<request>|<your-reply>|read_run/, 'the session holds the request and the reply');
  assert.equal(next.status, 'success');
  assert.equal(next.result, 'Two are stale: #4 and #9.');
  assert.equal(next.resumed, true, 'the run says it went on in that session');
  assert.equal(next.prompt, first.prompt, 'the request stays the run\'s, as before');
  assert.equal(next.continues, first.id);
});

test('a session Claude Code no longer has: the run starts afresh with the request and its reply, once', async () => {
  const bot = await makeBot(srv, { name: 'Writer', emoji: '✍️', allowedTools: ['Read'] });
  srv.reply("I can't run commands yet.");
  const first = await refused(bot, [BASH], { prompt: 'Tidy the repo' });
  const [card] = await asksOf(bot);
  fs.writeFileSync(path.join(srv.out, 'no-session'), '');
  srv.reply('Tidied.');
  await answer(card, true);
  const next = await carriedOn(bot, first);
  const runs = srv.runs().filter((x) => x.args.includes(`${bot.emoji} ${bot.name}`));
  const [tried, fresh] = runs.slice(-2);
  assert.ok(tried.args.includes('--resume'), 'it tried the session first');
  assert.ok(!fresh.args.includes('--resume'), 'then started afresh');
  assert.ok(fresh.stdin.includes(`<request>\n${first.prompt}\n</request>`), 'with the request as it was written');
  assert.equal(next.status, 'success');
  assert.equal(next.result, 'Tidied.');
  assert.equal(next.error, null);
  assert.equal(next.resumed, undefined);
});
