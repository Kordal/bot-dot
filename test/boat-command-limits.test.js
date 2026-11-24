// A bot's commands on the External Virtual PC end with its run and have the limits of the account's computer (ADR 134):
// a fake boat.dev runs each command botdot sends for real, here, in bash, so botdot-run holds what it starts as it does
// on the machine.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const boatLib = require('../lib/boat');
const screensLib = require('../lib/computer-screens');
const { waitFor } = require('./helpers');

const LINUX = { skip: process.platform !== 'linux' && 'botdot-run reads /proc' };
const KEY = `boat_${'x'.repeat(16)}`; // no real key
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-boat-limits-'));
const alive = (pid) => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { return false; } };
const runId = () => `run-${crypto.randomBytes(6).toString('hex')}`;

// boat.dev as far as these tests need it: one machine, always ready, whose commands run on this machine.
function fakeBoat() {
  const calls = [];
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, { method = 'GET', body } = {}) => {
    const p = new URL(url).pathname.replace(/^\/api\/v1/, '');
    const data = body ? JSON.parse(body) : null;
    calls.push({ method, path: p, body: data });
    if (p === '/sandboxes' && method === 'POST') return reply(202, { ok: true, sandbox: { id: 'bx_aaaaaaa1', state: 'provisioning' } });
    if (p === '/sandboxes/bx_aaaaaaa1' && method === 'GET') return reply(200, { ok: true, sandbox: { id: 'bx_aaaaaaa1', state: 'ready' } });
    if (p === '/sandboxes/bx_aaaaaaa1' && method === 'PATCH') return reply(200, { ok: true });
    if (p === '/sandboxes/bx_aaaaaaa1/commands') {
      return new Promise((resolve) => {
        childProcess.execFile('bash', ['-c', data.command], { timeout: data.timeoutSeconds * 1000, encoding: 'utf8' }, (err, stdout, stderr) => {
          resolve(reply(200, { ok: true, exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout, stderr, timedOut: !!err?.killed }));
        });
      });
    }
    return reply(400, { ok: false });
  };
  return { fetch, calls, commands: () => calls.filter((c) => c.path.endsWith('/commands')).map((c) => c.body.command) };
}
function machine(t, opts = {}) {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat();
  return { b, boat: boatLib.create(dir(), { kitOnStart: false, fetch: b.fetch, sleep: async () => {}, ...opts }) };
}

test("a bot's command on the External Virtual PC ends as it did, under botdot-run with its run and its memory limit", LINUX, async (t) => {
  const { b, boat } = machine(t, { size: () => 'small' });
  const run = runId();
  const r = await boat.runShell('coder', { command: "echo it\\'s here; exit 3", run });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.stdout, "it's here\n");
  assert.match(b.commands()[0], new RegExp(`^r=${run}; exec timeout -k 15 120 python3 -I -c '[\\s\\S]*' botdot-run --run "\\$r" --memory 2400000000 -- "\\$\\{BASH:-sh\\}" -c `), "60% of the small machine's 4 GB");
  assert.ok(!b.commands()[0].includes(`--run ${run}`), "the shell around it never matches the end of its run");
});

test("the end of a run ends its command on the External Virtual PC, with what it left in the background, and no other run's", LINUX, async (t) => {
  const { boat } = machine(t);
  const tmp = dir();
  const [mine, theirs] = [runId(), runId()];
  const going = boat.runShell('coder', { command: `setsid sleep 60 & echo $! > ${tmp}/pid; sleep 60`, run: mine, timeoutSeconds: 90 });
  const other = boat.runShell('coder', { command: 'sleep 4; echo done', run: theirs });
  await waitFor(() => fs.existsSync(`${tmp}/pid`) && fs.readFileSync(`${tmp}/pid`, 'utf8').trim());
  const pid = Number(fs.readFileSync(`${tmp}/pid`, 'utf8'));
  const began = Date.now();
  await boat.endRun('coder', mine);
  const r = await going;
  assert.ok(Date.now() - began < 10_000, 'it ended within seconds, not at its time limit');
  assert.notEqual(r.code, 0);
  assert.ok(!alive(pid), 'what it started in the background ended too');
  assert.equal((await other).stdout, 'done\n', "another run's command goes on");
});

test('a command over its memory limit on the External Virtual PC is stopped with all it started and says why', LINUX, async (t) => {
  const { boat } = machine(t, { size: () => 'small', memoryPercent: 1 }); // 40 MB
  const r = await boat.runShell('coder', { command: 'python3 -c "b=bytearray(120*1024*1024); import time; time.sleep(60)"', run: runId() });
  assert.equal(r.code, 137);
  assert.match(r.stderr, /botdot: stopped: this command used more than 0\.0 GB of memory/);
});

test('a command that outlives its time on the External Virtual PC is timed out, as on the account\'s computer', LINUX, async (t) => {
  const { boat } = machine(t);
  const r = await boat.runShell('coder', { command: 'sleep 30', timeoutSeconds: 1, run: runId() });
  assert.equal(r.code, 124);
  assert.equal(r.timedOut, true);
});

test('the end of a run never starts a machine that is not up, and a strange run id sends nothing', async (t) => {
  const { b, boat } = machine(t);
  await boat.endRun('coder', runId());
  assert.equal(b.calls.length, 0);
  await boat.runShell('coder', { command: 'true' });
  const before = b.calls.length;
  await boat.endRun('coder', 'x"; reboot; "');
  assert.equal(b.calls.length, before);
});

test("the end of a boat bot's run reaches its External Virtual PC and the account's computer, a linux bot's only the latter", async (t) => {
  const asked = [];
  const boat = { endRun: async (bot, run) => { asked.push(['boat', bot, run]); } };
  const raw = { endRun: async (run) => { asked.push(['computer', run]); }, inspect: async () => ({ state: 'running' }) };
  const kinds = { coder: 'boat', writer: 'linux' };
  const f = screensLib.facade(raw, screensLib.create(dir()), { boat, kindOf: (id) => kinds[id] });
  await f.endRun('r1', 'coder');
  await f.endRun('r2', 'writer');
  assert.deepEqual(asked, [['boat', 'coder', 'r1'], ['computer', 'r1'], ['computer', 'r2']]);
});
