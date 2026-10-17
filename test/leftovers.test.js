// Nothing outlives its server: a stopped botdot takes its runs with it, the stand-in Claude ends when
// its server is gone however that went, and `npm test` (test/run.js) sees a stand-in that was left.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');
const { fakes } = require('./run');

const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = (pid, what) => waitFor(() => !alive(pid), { timeout: 5000, what });
const scratch = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-left-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('a stopped botdot stops the Claude of a run that was going', async (t) => {
  // A Claude that never ends by itself, as a real one in the middle of its work: only a signal stops it.
  const dir = scratch(t);
  const claude = path.join(dir, 'claude');
  fs.writeFileSync(claude, `#!/bin/sh
case " $* " in *" -p --output-format "*) ;; *) exec "${process.execPath}" "${FAKE_CLAUDE}" "$@" ;; esac
echo $$ > "$FAKE_OUT/pid"
cat > /dev/null
exec sleep 600
`, { mode: 0o755 });
  const srv = await startServer({ env: { CLAUDE_BIN: claude } });
  let pid;
  t.after(async () => { await srv.stop(); if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); });
  const bot = await makeBot(srv);
  await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Work for a long time' } });
  pid = Number(await waitFor(() => { try { return fs.readFileSync(path.join(srv.out, 'pid'), 'utf8').trim(); } catch { return null; } }, { what: 'the run to start' }));
  assert.ok(alive(pid));

  await srv.stop();
  await gone(pid, 'the run\'s Claude to stop with its server');

  // The run is not lost from the history: the next start finds it and says it was cut short.
  const again = await startServer({ dir: srv.dir, env: { CLAUDE_BIN: claude } });
  t.after(() => again.stop());
  const runs = (await again.api(`/runs?botId=${bot.id}`)).data;
  assert.equal(runs[0].status, 'interrupted');
});

test('the stand-in Claude ends when its server is killed outright', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const bot = await makeBot(srv);
  const { rec } = await heldRun(srv, bot);
  const pid = Number(rec.n.split('-')[1]);
  assert.ok(alive(pid));

  process.kill(srv.pid, 'SIGKILL'); // no chance to stop anything itself
  await srv.exited;
  await gone(pid, 'the stand-in Claude to end without its server');
});

test('the check of npm test sees a stand-in Claude that is still running', async (t) => {
  const out = scratch(t);
  fs.writeFileSync(path.join(out, 'hold'), '');
  const child = spawn(process.execPath, [FAKE_CLAUDE, '-p'], { env: { PATH: process.env.PATH, FAKE_OUT: out }, stdio: ['pipe', 'ignore', 'ignore'] });
  const exited = new Promise((r) => child.on('exit', r));
  t.after(() => child.kill('SIGKILL'));
  child.stdin.end('A prompt');
  await waitFor(() => fs.readdirSync(out).some((f) => f.startsWith('run-')), { what: 'the stand-in to start' });
  assert.ok(fakes().some((f) => f.pid === child.pid), 'listed while it runs');

  child.kill('SIGTERM');
  await exited;
  assert.ok(!fakes().some((f) => f.pid === child.pid), 'not once it has ended');
});
