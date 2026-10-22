// A run ends on Claude Code's result line, not when its process has exited (#207): Claude Code takes a moment to exit
// after it, more under gVisor. The run's status, its reply and what waited for the bot come on the result; what its
// process uses (its prompt, its MCP and settings files) goes once that process is gone, and a process that lingers is
// ended after a moment. A Chief's turn is the same. The stand-in for Claude stays on after its result while
// $FAKE_OUT/linger exists.
// Tests here count on work for a busy bot waiting its turn: one run of a bot at a time (ADR 062 lets three go at
// once, and at that limit the same holds).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv; let quick;
before(async () => {
  // quick: a process that lingers is ended after a moment there, not after five seconds.
  [srv, quick] = await Promise.all([startServer(), startServer({ env: { BOT_DOT_KILL_AFTER_MS: '300' } })]);
});
after(async () => {
  for (const s of [srv, quick]) fs.rmSync(path.join(s.out, 'linger'), { force: true });
  await Promise.all([srv.stop(), quick.stop()]);
});

const linger = (on) => fs.writeFileSync(path.join(on.out, 'linger'), '');
const letExit = (on) => fs.rmSync(path.join(on.out, 'linger'), { force: true });
const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const pidOf = (rec) => Number(rec.n.split('-')[1]);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const mcpFileOf = (rec) => rec.args[rec.args.indexOf('--mcp-config') + 1];
const gone = (file, what) => waitFor(() => !fs.existsSync(file), { what });

test("a run's reply is out on its result while its process is still there, and its files go once that process exits", async () => {
  const bot = await makeBot(srv, { name: 'Quick Reply', emoji: '⚡' });
  linger(srv);
  srv.reply('Here it is.');
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Answer me' } })).data;
  const rec = await srv.nextRun(isRunOf(bot), 'its run');
  const ended = await srv.finished(run.id);
  assert.deepEqual([ended.status, ended.result], ['success', 'Here it is.']);
  assert.ok(alive(pidOf(rec)), 'Claude Code has not exited yet');
  assert.ok(fs.existsSync(rec.promptFile.path), 'its prompt is kept while its process is there');
  assert.ok(fs.existsSync(mcpFileOf(rec)), 'and its MCP file');
  letExit(srv);
  await gone(rec.promptFile.path, 'its prompt to go');
  await gone(mcpFileOf(rec), 'its MCP file to go');
});

test('a message that waited for the bot starts on the result, before the process has exited', async () => {
  const bot = await makeBot(srv, { name: 'Next Up', emoji: '⏭️' });
  linger(srv);
  srv.hold();
  const first = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'First question' } })).data;
  const rec = await srv.nextRun((x) => isRunOf(bot)(x) && x.stdin.includes('First question'), 'the first run');
  const second = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Second question' } })).data;
  assert.equal(second.status, 'queued', 'it waits while the first run goes');
  srv.unhold();
  await srv.nextRun((x) => isRunOf(bot)(x) && x.stdin.includes('Second question'), 'the second run');
  assert.ok(alive(pidOf(rec)), 'it started while the first run\'s Claude Code was still there');
  assert.equal((await srv.finished(first.id)).status, 'success');
  letExit(srv);
  assert.equal((await srv.finished(second.id)).status, 'success');
});

test('an error result fails the run on the result', async () => {
  const bot = await makeBot(srv, { name: 'Bad Luck', emoji: '🐈‍⬛' });
  linger(srv);
  fs.writeFileSync(path.join(srv.out, 'error-result.txt'), 'API Error: 500 overloaded');
  try {
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Try it' } })).data;
    const rec = await srv.nextRun(isRunOf(bot), 'its run');
    const ended = await srv.finished(run.id);
    assert.deepEqual([ended.status, ended.error], ['error', 'API Error: 500 overloaded']);
    assert.ok(alive(pidOf(rec)), 'before Claude Code exited');
  } finally {
    fs.rmSync(path.join(srv.out, 'error-result.txt'), { force: true });
    letExit(srv);
  }
});

test('a process that lingers after its result is ended, and its files go', async () => {
  const bot = await makeBot(quick, { name: 'Slow Exit', emoji: '🐌' });
  linger(quick);
  const run = (await quick.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Answer me' } })).data;
  const rec = await quick.nextRun(isRunOf(bot), 'its run');
  assert.equal((await quick.finished(run.id)).status, 'success');
  await waitFor(() => !alive(pidOf(rec)), { what: 'Claude Code to be ended' });
  await gone(rec.promptFile.path, 'its prompt to go');
  letExit(quick);
});

test("a Chief's reply is out on its result, and its prompt goes once Claude Code exits", async () => {
  linger(srv);
  srv.reply('All set.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Is it set?' } });
  const rec = await srv.nextRun((x) => !!x.botdot && x.stdin.includes('Is it set?'), 'the Chief turn');
  const replied = await waitFor(async () => {
    const c = (await srv.api(`/chief/chats/${chat.id}`)).data;
    return !c.busy && c.messages.at(-1).role === 'chief' && !c.messages.at(-1).pending ? c.messages.at(-1) : null;
  }, { what: 'the reply' });
  assert.equal(replied.text, 'All set.');
  assert.ok(!replied.error);
  assert.ok(alive(pidOf(rec)), 'Claude Code has not exited yet');
  assert.ok(fs.existsSync(rec.promptFile.path), 'its prompt is kept while its process is there');
  letExit(srv);
  await gone(rec.promptFile.path, 'its prompt to go');
});
