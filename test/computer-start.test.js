// How the account's computer starts (#475, ADR 028, ADR 035): on a network of its own, with nothing running, its firewall set by
// root from inside it, and only then the desktop. gVisor allows nothing else, and runc works the same way. Docker
// is a stand-in here.
const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const childProcess = require('node:child_process');
const dns = require('node:dns');

// Tailscale's resolver as a stand-in: 'up' answers (a missing name too), 'down' times out.
let tailscale = 'down';
const asked = [];
dns.promises.Resolver = class {
  setServers(servers) { this.servers = servers; }
  async resolve4(name) {
    asked.push({ servers: this.servers, name });
    const e = new Error(tailscale === 'up' ? 'not found' : 'timed out');
    e.code = tailscale === 'up' ? 'ENOTFOUND' : 'ETIMEOUT';
    throw e;
  }
};

let calls = [];
let answer = () => '';
function fakeExecFile(file, args, opts, cb) {
  calls.push({ args });
  const reply = () => { try { cb(null, answer(args) ?? '', ''); } catch (e) { cb(e, '', e.message); } };
  return { stdin: { on() {}, end() { setImmediate(reply); } } };
}
fakeExecFile[util.promisify.custom] = async (file, args) => {
  calls.push({ args });
  return { stdout: answer(args) ?? '', stderr: '' };
};
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;

// A Docker with the image and the given runtime, and a computer in the given state.
function docker({ state = 'none', network = '2', runtime = 'runsc', restart = 'no', fail = () => false } = {}) {
  return (args) => {
    if (fail(args)) throw new Error('iptables: Failed to initialize');
    const [cmd] = args;
    if (cmd === 'image') return '1';
    if (cmd === 'network' && args[1] === 'inspect') throw new Error('No such network');
    if (cmd === 'inspect' && args[3]?.includes('.State.Status')) {
      if (state === 'none') throw new Error('No such object');
      return `"${state}"|"bot-dot/desktop:latest"|"sha256:image"`;
    }
    if (cmd === 'inspect' && args[3]?.includes('user-version')) return `${network}|2`;
    if (cmd === 'inspect' && args[3]?.includes('.HostConfig.Runtime')) return runtime;
    if (cmd === 'inspect' && args[3]?.includes('RestartPolicy')) return restart;
    if (cmd === 'exec' && args.includes('python3')) return '{}';
    return '';
  };
}
const index = (match) => calls.findIndex((c) => match(c.args));
const isRun = (a) => a[0] === 'run' && a.includes('botdot.account.computer');
const isFirewall = (a) => a[0] === 'exec' && a.includes('--privileged');
const isDesktop = (a) => a[0] === 'exec' && a.includes('/usr/bin/supervisord');
const isBridge = (a) => a[0] === 'exec' && a.at(-1) === '--serve';
const firewallScript = () => { const a = calls.find((c) => isFirewall(c.args)).args; return a[a.indexOf('-c') + 1]; };

const resolvers = () => { const a = calls.findLast((c) => isFirewall(c.args)).args; return a.slice(a.lastIndexOf('sh') + 1); };
// The machine's Tailscale is checked at most every 10 minutes: each test starts well past the last check.
let clock = Date.parse('2026-10-17T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: clock });

beforeEach(() => { calls = []; answer = docker(); tailscale = 'down'; asked.length = 0; mock.timers.setTime(clock += 3_600_000); });

test('a new computer is on a network of its own and starts with nothing running', async () => {
  await computers.ensure('pc');
  assert.ok(index((a) => a[0] === 'network' && a[1] === 'create' && a.at(-1) === 'botdot.account.computer-network') >= 0, 'its network is made');
  const run = calls.find((c) => isRun(c.args)).args;
  assert.equal(run[run.indexOf('--network') + 1], 'botdot.account.computer-network');
  assert.ok(!run.some((a) => a.startsWith('container:')), 'it joins no other container');
  assert.deepEqual(run.slice(-4), ['--entrypoint', 'sleep', computers.IMAGE, 'infinity']);
  assert.ok(run.includes('botdot.network-version=2'));
  assert.equal(run[run.indexOf('--user') + 1], 'box');
  assert.ok(!run.includes('--cap-drop'), 'sudo needs Docker\'s default capabilities (ADR 035)');
  assert.ok(!calls.some((c) => c.args[0] === 'run' && c.args.includes('NET_ADMIN')), 'no second container sets the firewall');
});

test('root sets the firewall inside the computer, then the desktop starts as box, then the bridge', async () => {
  await computers.ensure('pc');
  const firewall = calls.find((c) => isFirewall(c.args)).args;
  assert.deepEqual(firewall.slice(0, 7), ['exec', '--privileged', '-u', 'root', 'botdot.account.computer', 'sh', '-c']);
  assert.deepEqual(firewall.slice(-3), ['sh', '1.1.1.1', '8.8.8.8'], 'the resolvers are its arguments');
  const desktop = calls.find((c) => isDesktop(c.args)).args;
  assert.deepEqual(desktop.slice(0, 4), ['exec', '-d', '-u', 'box']);
  assert.ok(index((a) => isRun(a)) < index(isFirewall));
  assert.ok(index(isFirewall) < index(isDesktop), 'nothing of the desktop runs before the firewall');
  assert.ok(index(isDesktop) < index(isBridge));
});

test('under gVisor the firewall is legacy iptables on what leaves, without conntrack', async () => {
  await computers.ensure('pc');
  const script = firewallScript();
  assert.match(script, /"\$tool" -P OUTPUT DROP/);
  assert.match(script, /for tool in iptables-legacy ip6tables-legacy/);
  assert.doesNotMatch(script, /conntrack|ctstate|--state|INPUT/);
  assert.match(script, /"\$tool" -A OUTPUT -o lo -j ACCEPT\n/, "the computer's own loopback is open: a mail bridge on 127.0.0.1:1143, Tailscale's proxy");
  assert.match(script, /-p tcp -m multiport --sports 8000,6080,5901,6001,47111 -j DROP/, 'its control and screen answer nobody outside');
  assert.match(script, /"\$tool" -A OUTPUT -j ACCEPT/);
  assert.doesNotMatch(script, /REJECT/, 'the local network is open');
  assert.match(script, /> \/etc\/resolv\.conf/);
});

test('under runc the firewall keeps its rules for what comes in, with conntrack', async () => {
  answer = docker({ runtime: 'runc' });
  await computers.ensure('pc');
  const script = firewallScript();
  assert.doesNotMatch(script, /iptables-legacy/);
  assert.match(script, /"\$tool" -P INPUT DROP/);
  assert.match(script, /"\$tool" -A INPUT -i lo -j ACCEPT/);
  assert.match(script, /-m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT/);
  assert.match(script, /"\$tool" -P OUTPUT ACCEPT/, 'what leaves is open: the internet, the local network, its own loopback');
  assert.match(script, /rules iptables\nrules ip6tables/);
  assert.doesNotMatch(script, /REJECT/);
});

test('a stopped computer starts with nothing running, gets its firewall, then its desktop', async () => {
  answer = docker({ state: 'stopped' });
  await computers.ensure('pc');
  assert.ok(!calls.some((c) => isRun(c.args)), 'it is not made again');
  const start = index((a) => a[0] === 'start' && a.includes('botdot.account.computer'));
  assert.ok(start >= 0 && start < index(isFirewall) && index(isFirewall) < index(isDesktop));
});

// A computer signed in to the owner's tailnet comes back on it when it starts (#68): botdot-tailscale resume, as the
// bot, starts Tailscale with its saved login and asks for none.
const isResume = (a) => a[0] === 'exec' && a.at(-2) === '/usr/local/bin/botdot-tailscale' && a.at(-1) === 'resume';
test('a stopped computer starts Tailscale again as box, after its firewall and with the current botdot-tailscale', async () => {
  answer = docker({ state: 'stopped' });
  await computers.ensure('pc');
  const resume = calls.find((c) => isResume(c.args));
  assert.ok(resume, 'Tailscale is resumed');
  assert.deepEqual(resume.args.slice(0, 5), ['exec', '-u', 'box', '-e', 'HOME=/home/box']);
  assert.ok(!resume.args.includes('--privileged') && !resume.args.includes('root'));
  const copy = index((a) => a[0] === 'exec' && a.at(-1).includes('mv -f /usr/local/bin/.botdot-tailscale.new /usr/local/bin/botdot-tailscale'));
  assert.ok(index(isFirewall) < copy && copy < index(isResume), 'root writes botdot-tailscale in, so an older computer has resume');
});

test('a computer whose Tailscale does not come back still starts', async () => {
  answer = docker({ state: 'stopped', fail: isResume });
  await computers.ensure('pc');
  assert.ok(index(isBridge) >= 0, 'it is ready for the run');
});

test('a running computer gets its firewall again and keeps its desktop', async () => {
  answer = docker({ state: 'running' });
  await computers.ensure('pc');
  assert.ok(index(isFirewall) >= 0, 'a computer started by an older botdot gets the open loopback too');
  assert.equal(index(isDesktop), -1, 'the desktop is not started a second time');
  assert.equal(index(isResume), -1, 'nor Tailscale');
});

// gVisor fails `docker update` on a running computer (runsc panics): a computer the owner had started, or that
// stayed on, then failed every run's start while it ran fine.
const isUpdate = (a) => a[0] === 'update';
test('a running computer whose restart policy is already off is not updated, so gVisor cannot fail its start', async () => {
  answer = docker({ state: 'running', fail: isUpdate });
  await computers.ensure('pc');
  assert.ok(!calls.some((c) => isUpdate(c.args)));
  assert.ok(index(isBridge) >= 0, 'it is ready for the run');
});

test('a computer that would still come back by itself is set not to, and a failure of that does not stop its start', async () => {
  answer = docker({ state: 'running', restart: 'unless-stopped', fail: isUpdate });
  await computers.ensure('pc');
  assert.ok(calls.some((c) => isUpdate(c.args)));
  assert.ok(index(isBridge) >= 0);
});

test('a computer whose firewall cannot be set is stopped and its desktop never starts', async () => {
  answer = docker({ fail: isFirewall });
  await assert.rejects(computers.ensure('pc'), /^Error: Could not secure the computer: iptables: Failed to initialize/);
  assert.ok(calls.some((c) => c.args[0] === 'stop' && c.args.includes('botdot.account.computer')));
  assert.equal(index(isDesktop), -1);
});

test('a computer older than the account computer is kept but stopped, with what to do', async () => {
  answer = docker({ state: 'stopped', network: '1' });
  await assert.rejects(computers.ensure('pc'), /older than botdot's account computer and is kept but stopped\. Export its files and reset it/);
  assert.ok(calls.some((c) => c.args[0] === 'stop' && c.args.includes('botdot.account.computer')));
  assert.ok(!calls.some((c) => c.args[0] === 'start'));
  assert.equal(index(isFirewall), -1);
});

test('with Tailscale on the machine, the computer asks Tailscale first, so tailnet names resolve (#523)', async () => {
  tailscale = 'up';
  await computers.ensure('pc');
  assert.deepEqual(resolvers(), ['100.100.100.100', '1.1.1.1', '8.8.8.8']);
  assert.deepEqual(asked[0].servers, ['100.100.100.100']);
});

test('with no Tailscale on the machine, the computer keeps the public resolvers', async () => {
  await computers.ensure('pc');
  assert.deepEqual(resolvers(), ['1.1.1.1', '8.8.8.8']);
});

test('the machine\'s Tailscale is checked once, then again after 10 minutes', async () => {
  tailscale = 'up';
  answer = docker({ state: 'running' });
  await computers.ensure('pc');
  calls = [];
  tailscale = 'down';
  await computers.ensure('pc');
  assert.deepEqual(resolvers(), ['100.100.100.100', '1.1.1.1', '8.8.8.8'], 'the first answer still holds');
  assert.equal(asked.length, 1);
  mock.timers.setTime(clock += 10 * 60_000 + 1);
  calls = [];
  await computers.ensure('pc');
  assert.deepEqual(resolvers(), ['1.1.1.1', '8.8.8.8']);
  assert.equal(asked.length, 2);
});
