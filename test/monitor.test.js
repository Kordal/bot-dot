// Claude Code's Monitor (#641): since 2.1.310 Bash refuses a command that starts with a long `sleep` and points to
// Monitor or run_in_background. Monitor is checked against the run's Bash rules, so a bot that may run commands has it
// with no rule of its own; a Monitor rule in a bot's settings is dropped (a bare one runs any command), and a run
// without Bash has Monitor taken away. Work left running keeps the run going past its first result, to the reply.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun } = require('./helpers');
const fs = require('fs');
const path = require('path');
const { withoutMonitor, monitorDenied } = require('../lib/bots');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

// The tools a run was given: what follows --allowedTools, up to the next flag.
const listOf = (rec, flag) => {
  const from = rec.args.indexOf(flag) + 1;
  const end = rec.args.findIndex((a, i) => i >= from && a.startsWith('--'));
  return rec.args.slice(from, end < 0 ? undefined : end);
};
async function toolsOf(allowedTools, name) {
  const bot = await makeBot(srv, { name, allowedTools });
  const h = await heldRun(srv, bot);
  const tools = { allowed: listOf(h.rec, '--allowedTools'), denied: listOf(h.rec, '--disallowedTools') };
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();
  return tools;
}

test('a Monitor rule never reaches a run, and Monitor is denied only without Bash', () => {
  assert.deepEqual(withoutMonitor(['Read', 'Bash', 'Monitor', 'Monitor(rm *)']), ['Read', 'Bash']);
  assert.deepEqual(withoutMonitor(['Bash(git log *)', 'MonitorX']), ['Bash(git log *)', 'MonitorX']);
  assert.deepEqual(monitorDenied(['Read', 'Bash']), []);
  assert.deepEqual(monitorDenied(['Read', 'Bash(git log *)']), []);
  assert.deepEqual(monitorDenied(['Read', 'BashOutput']), ['Monitor']);
  assert.deepEqual(monitorDenied([]), ['Monitor']);
});

test('a bot that may run commands keeps Monitor, with no rule of its own', async () => {
  const { allowed, denied } = await toolsOf(['Read', 'Bash', 'Monitor'], 'Waiter');
  assert.ok(allowed.includes('Bash'), allowed.join(' '));
  assert.ok(!allowed.some((t) => /^Monitor/.test(t)), allowed.join(' '));
  assert.ok(!denied.includes('Monitor'), denied.join(' '));
});

test('a narrow Bash rule is all a bot has, even when its settings name Monitor', async () => {
  const { allowed, denied } = await toolsOf(['Read', 'Bash(git log *)', 'Monitor'], 'Logger');
  assert.ok(allowed.includes('Bash(git log *)'), allowed.join(' '));
  assert.ok(!allowed.some((t) => /^Monitor/.test(t)), allowed.join(' '));
  assert.ok(!denied.includes('Monitor'), denied.join(' '));
});

test('a bot without commands has no Monitor at all', async () => {
  const { allowed, denied } = await toolsOf(['Read', 'Monitor'], 'Reader');
  assert.ok(!allowed.some((t) => /^Monitor/.test(t)), allowed.join(' '));
  assert.ok(denied.includes('Monitor'), denied.join(' '));
});

test('work left running keeps the run going to the reply after it, not its first result', async () => {
  const bot = await makeBot(srv, { name: 'Deployer', allowedTools: ['Read', 'Bash'] });
  fs.writeFileSync(path.join(srv.out, 'background'), '');
  fs.writeFileSync(path.join(srv.out, 'result.txt'), 'The page is ready.');
  try {
    const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Tell me when the page is ready' } });
    const meta = await srv.finished(r.data.id);
    assert.equal(meta.status, 'success', meta.error);
    assert.equal(meta.result, 'The page is ready.');
  } finally {
    fs.rmSync(path.join(srv.out, 'background'), { force: true });
    fs.rmSync(path.join(srv.out, 'result.txt'), { force: true });
  }
});

test('a run that wrote its reply and left a command running ends with that reply when the idle stop ends it (#1096)', async () => {
  const quiet = await startServer({ env: { BOT_DOT_RUN_IDLE_MS: '1500' } });
  try {
    const bot = await makeBot(quiet, { name: 'Server Starter', allowedTools: ['Read', 'Bash'] });
    fs.writeFileSync(path.join(quiet.out, 'background'), '');
    fs.writeFileSync(path.join(quiet.out, 'background-ms.txt'), '600000'); // a dev server: it never ends
    const r = await quiet.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Start the dev server' } });
    const meta = await quiet.finished(r.data.id);
    assert.equal(meta.status, 'success', meta.error);
    assert.equal(meta.backgroundStopped, 'idle');
    assert.equal(meta.result, 'I will reply once it is ready.\n\n_botdot stopped what this run left running in the background._');
    assert.equal(meta.endedBy, undefined, 'nobody ended a reply that was written');
  } finally { await quiet.stop(); }
});
