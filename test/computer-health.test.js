// What the Chief reads of a bot's computer (#59): Docker's state of it with the error of its last start that failed,
// and its recent logs. And the Docker helper takes these two operations for one bot id only, and a line count up to
// 500. Docker is a stand-in here.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const childProcess = require('node:child_process');

let calls = [];
let answer = () => '';
function fakeExecFile(file, args, opts, cb) {
  calls.push(args);
  const reply = () => { try { cb(null, answer(args) ?? '', ''); } catch (e) { cb(e, '', e.message); } };
  return { stdin: { on() {}, end() { setImmediate(reply); } } };
}
fakeExecFile[util.promisify.custom] = async (file, args) => {
  calls.push(args);
  const out = answer(args);
  return typeof out === 'object' && out ? out : { stdout: out ?? '', stderr: '' };
};
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;

const STATE = { Status: 'exited', ExitCode: 137, Error: '', OOMKilled: true, StartedAt: '2026-10-18T17:00:00Z', FinishedAt: '2026-10-18T17:05:00Z' };
// A computer in `state`; `failStart` makes its firewall fail, so a start fails after the container runs.
function docker({ state = 'running', failStart = false } = {}) {
  return (args) => {
    const [cmd] = args;
    const format = args[args.indexOf('--format') + 1] || '';
    if (cmd === 'image') return '1';
    if (cmd === 'inspect' && state === 'none') throw new Error('No such object');
    if (cmd === 'inspect' && format.includes('.State.Status')) return `"${state}"|"bot-dot/desktop:latest"|"sha256:image"`;
    if (cmd === 'inspect' && format.includes('{{json .State}}')) return `3|${JSON.stringify({ ...STATE, Status: state, Error: state === 'stopped' ? 'a | in its error' : '' })}`;
    if (cmd === 'inspect' && format.includes('user-version')) return '2|2';
    if (cmd === 'inspect' && format.includes('.HostConfig.Runtime')) return 'runsc';
    if (cmd === 'inspect' && format.includes('RestartPolicy')) return 'no';
    if (cmd === 'exec' && args.includes('--privileged') && failStart) throw new Error('iptables: Failed to initialize');
    if (cmd === 'exec' && args.includes('python3')) return '{}';
    if (cmd === 'logs') return { stdout: 'out line\n', stderr: 'err line\n' };
    if (cmd === 'exec' && args.includes('/var/log/supervisor/supervisord.log')) return 'novnc exited';
    return '';
  };
}
beforeEach(() => { calls = []; answer = docker(); });

test("health is Docker's state of the computer, and why its last start failed until one succeeds", async () => {
  answer = docker({ state: 'stopped', failStart: true });
  await assert.rejects(computers.ensure('pc'), /Could not secure the computer: iptables/);
  const h = await computers.health('pc');
  assert.deepEqual({ ...h, lastStartError: undefined }, {
    state: 'stopped', status: 'stopped', exitCode: 137, error: 'a | in its error', oomKilled: true,
    startedAt: STATE.StartedAt, finishedAt: STATE.FinishedAt, restartCount: 3, waiting: false, lastStartError: undefined,
  });
  assert.match(h.lastStartError.message, /Could not secure the computer: iptables: Failed to initialize/);
  assert.ok(!Number.isNaN(Date.parse(h.lastStartError.at)));
  answer = docker({ state: 'stopped' });
  await computers.ensure('pc');
  assert.equal((await computers.health('pc')).lastStartError, null, 'a start that succeeds clears it');
});

test('health of a computer that was never made says so, and Docker that does not answer is not that', async () => {
  answer = docker({ state: 'none' });
  assert.deepEqual(await computers.health('nobody'), { state: 'none', waiting: false, lastStartError: null });
  answer = () => { throw new Error('Cannot connect to the Docker daemon'); };
  await assert.rejects(computers.health('pc'), /Cannot connect to the Docker daemon/);
});

test("erasing a bot's old computer leaves why the account's computer did not start (#104)", async () => {
  answer = docker({ state: 'stopped', failStart: true });
  await assert.rejects(computers.ensure('gone'));
  await computers.reset('gone');
  assert.ok((await computers.health('other')).lastStartError, "every bot reads the account computer's");
});

test("logs are the container's own and the desktop's, the last lines of each", async () => {
  const logs = await computers.logs('pc', 50);
  assert.deepEqual(logs, { state: 'running', container: 'out line\nerr line\n', desktop: 'novnc exited' });
  assert.deepEqual(calls.find((a) => a[0] === 'logs'), ['logs', '--tail', '50', '--timestamps', 'botdot.account.computer']);
  assert.ok(calls.some((a) => a[0] === 'exec' && a.includes('-n') && a[a.indexOf('-n') + 1] === '50'));
  assert.ok(!calls.some((a) => a.some((x) => /bridge\.log/.test(x))), "not the browser bridge's, which may hold what botdot typed");
  calls = [];
  await computers.logs('pc', 9999);
  assert.equal(calls.find((a) => a[0] === 'logs')[2], '500');
});

test('a stopped computer has no desktop logs, and one never made has none at all', async () => {
  answer = docker({ state: 'stopped' });
  assert.equal((await computers.logs('pc')).desktop, '');
  answer = docker({ state: 'none' });
  assert.deepEqual(await computers.logs('nobody'), { state: 'none', container: '', desktop: '' });
});

test('the Docker helper takes health and logs for one bot id, and a line count of 1 to 500', async () => {
  const http = require('node:http');
  const { createServer } = require('../lib/docker-helper');
  const asked = [];
  const server = createServer({ computers: { health: async (...a) => { asked.push(['health', ...a]); return {}; }, logs: async (...a) => { asked.push(['logs', ...a]); return {}; } }, updates: {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const call = (operation, args) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/call', method: 'POST' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(JSON.stringify({ operation, args }));
  });
  try {
    for (const [op, args] of [['health', ['pc']], ['logs', ['pc']], ['logs', ['pc', 1]], ['logs', ['pc', 500]]]) assert.equal(await call(op, args), 200, `${op} ${JSON.stringify(args)}`);
    for (const [op, args] of [['health', []], ['health', ['../x']], ['health', ['pc', 1]], ['logs', ['pc', 0]], ['logs', ['pc', 501]], ['logs', ['pc', 1.5]], ['logs', ['pc', '10']], ['logs', ['pc', 10, 1]]]) {
      assert.equal(await call(op, args), 400, `${op} ${JSON.stringify(args)}`);
    }
    assert.equal(asked.length, 4);
  } finally { server.close(); }
});
