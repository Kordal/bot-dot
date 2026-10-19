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

// The bot's seat: its screen number 1 is display :11 (#105).
const PC = { bot: 'pc', screen: 1 };
// A Docker with the image and the given runtime, and a computer in the given state. The bot's screen answers once its
// supervisord was started, or from the start when `screen` is 'up'.
function docker({ state = 'none', network = '2', runtime = 'runsc', restart = 'no', screen = 'down', fail = () => false } = {}) {
  const up = new Set(); // the computer-servers' ports that answer
  return (args) => {
    if (fail(args)) throw new Error('iptables: Failed to initialize');
    const [cmd] = args;
    if (cmd === 'exec' && args.includes('/usr/bin/supervisord')) up.add(args.find((a) => a.startsWith('API_PORT=')).slice(9));
    if (cmd === 'exec' && args.includes('python3') && screen !== 'up' && !up.has(args.at(-1))) throw new Error('Connection refused');
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
const isBridge = (a) => a[0] === 'exec' && a.includes('--serve');
const firewallScript = () => { const a = calls.find((c) => isFirewall(c.args)).args; return a[a.indexOf('-c') + 1]; };

const resolvers = () => { const a = calls.findLast((c) => isFirewall(c.args)).args; return a.slice(a.lastIndexOf('sh') + 1); };
// The machine's Tailscale is checked at most every 10 minutes: each test starts well past the last check.
let clock = Date.parse('2026-10-17T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: clock });

beforeEach(() => { calls = []; answer = docker(); tailscale = 'down'; asked.length = 0; mock.timers.setTime(clock += 3_600_000); });

test('a new computer is on a network of its own and starts with nothing running', async () => {
  await computers.ensure(PC);
  assert.ok(index((a) => a[0] === 'network' && a[1] === 'create' && a.at(-1) === 'botdot.account.computer-network') >= 0, 'its network is made');
  const run = calls.find((c) => isRun(c.args)).args;
  assert.equal(run[run.indexOf('--network') + 1], 'botdot.account.computer-network');
  assert.ok(!run.some((a) => a.startsWith('container:')), 'it joins no other container');
  assert.deepEqual(run.slice(-4), ['--entrypoint', 'sleep', computers.IMAGE, 'infinity']);
  assert.ok(run.includes('botdot.network-version=2'));
  assert.equal(run[run.indexOf('--user') + 1], 'box');
  assert.ok(!run.includes('--cap-drop'), 'sudo needs Docker\'s default capabilities (ADR 035)');
  assert.ok(run.includes('--no-healthcheck'), 'the desktop image\'s check asks a port no bot\'s screen uses, so it would say unhealthy (#125)');
  assert.ok(!calls.some((c) => c.args[0] === 'run' && c.args.includes('NET_ADMIN')), 'no second container sets the firewall');
});

test('root sets the firewall inside the computer, then the desktop starts as box, then the bridge', async () => {
  await computers.ensure(PC);
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
  await computers.ensure(PC);
  const script = firewallScript();
  assert.match(script, /"\$tool" -P OUTPUT DROP/);
  assert.match(script, /for tool in iptables-legacy ip6tables-legacy/);
  assert.doesNotMatch(script, /conntrack|ctstate|--state|INPUT/);
  assert.match(script, /"\$tool" -A OUTPUT -o lo -j ACCEPT\n/, "the computer's own loopback is open: a mail bridge on 127.0.0.1:1143, Tailscale's proxy");
  assert.match(script, /-p tcp -m multiport --sports 5911:5999,6011:6099,6111:6199,8111:8199,47211:47299,8000,6080,5901,6001,47111 -j DROP/, "every screen's control and view answer nobody outside, and the shared screen's of before (#105)");
  assert.match(script, /"\$tool" -A OUTPUT -j ACCEPT/);
  assert.doesNotMatch(script, /REJECT/, 'the local network is open');
  // The computer's Tailscale runs as root in userspace and forwards a tailnet connection to the loopback (#106):
  // what root sends to botdot's ports there is dropped, before the loopback is let through.
  const guard = script.indexOf('"$tool" -A OUTPUT -o lo -p tcp -m owner --uid-owner 0 -m multiport --dports 5911:5999,6011:6099,6111:6199,8111:8199,47211:47299,8000,6080,5901,6001,47111 -j DROP');
  assert.ok(guard > 0 && guard < script.indexOf('"$tool" -A OUTPUT -o lo -j ACCEPT'), script);
  assert.match(script, /> \/etc\/resolv\.conf/);
});

test('under runc the firewall keeps its rules for what comes in, with conntrack', async () => {
  answer = docker({ runtime: 'runc' });
  await computers.ensure(PC);
  const script = firewallScript();
  assert.doesNotMatch(script, /iptables-legacy/);
  assert.match(script, /"\$tool" -P INPUT DROP/);
  assert.match(script, /"\$tool" -A INPUT -i lo -j ACCEPT/);
  assert.match(script, /-m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT/);
  assert.match(script, /"\$tool" -P OUTPUT ACCEPT/, 'what leaves is open: the internet, the local network, its own loopback');
  assert.match(script, /"\$tool" -F OUTPUT\n[^]*"\$tool" -A OUTPUT -o lo -p tcp -m owner --uid-owner 0 -m multiport --dports 5911:5999,[^ ]*,47111 -j DROP/, 'nor under runc does Tailscale forward a tailnet connection to them (#106)');
  assert.match(script, /rules iptables\nrules ip6tables/);
  assert.doesNotMatch(script, /REJECT/);
});

test('a stopped computer starts with nothing running, gets its firewall, then its desktop', async () => {
  answer = docker({ state: 'stopped' });
  await computers.ensure(PC);
  assert.ok(!calls.some((c) => isRun(c.args)), 'it is not made again');
  const start = index((a) => a[0] === 'start' && a.includes('botdot.account.computer'));
  assert.ok(start >= 0 && start < index(isFirewall) && index(isFirewall) < index(isDesktop));
});

test('a Docker runtime without the owner match still sets the rest of the firewall, and says the guard is off (#106)', async () => {
  await computers.ensure(PC);
  const script = firewallScript();
  assert.match(script, /--uid-owner 0 [^\n]* -j DROP 2>\/dev\/null \|\| guard=off/, 'a failed rule leaves the other rules in place');
  assert.match(script, /echo "tailnet-guard \$guard"/);
  const base = docker();
  answer = (args) => (isFirewall(args) ? 'tailnet-guard off' : base(args));
  const warn = mock.method(console, 'warn', () => {});
  try {
    calls = [];
    await computers.ensure(PC);
    assert.ok(index(isBridge) >= 0, 'the computer starts all the same');
    assert.ok(warn.mock.calls.some((c) => /no owner match/.test(c.arguments[0])), 'and botdot says so in its log');
  } finally { warn.mock.restore(); }
});

// The account's computer on the owner's tailnet comes back on it when it starts (#68, #106): botdot-tailscale resume,
// as root, starts its one Tailscale with its saved login, asks for none, and puts its shields back up.
const isResume = (a) => a[0] === 'exec' && a.at(-2) === '/usr/local/bin/botdot-tailscale' && a.at(-1) === 'resume';
test('a stopped computer starts Tailscale again as root, after its firewall and with the current botdot-tailscale', async () => {
  answer = docker({ state: 'stopped' });
  await computers.ensure(PC);
  const resume = calls.find((c) => isResume(c.args));
  assert.ok(resume, 'Tailscale is resumed');
  assert.deepEqual(resume.args.slice(0, 4), ['exec', '-u', 'root', 'botdot.account.computer']);
  assert.ok(!resume.args.includes('--privileged'), 'no NET_ADMIN: the firewall stays botdot\'s');
  const copy = index((a) => a[0] === 'exec' && a.at(-1).includes('mv -f /usr/local/bin/.botdot-tailscale.new /usr/local/bin/botdot-tailscale'));
  assert.ok(index(isFirewall) < copy && copy < index(isResume), 'root writes botdot-tailscale in, so an older computer has resume');
});

test('a computer whose Tailscale does not come back still starts', async () => {
  answer = docker({ state: 'stopped', fail: isResume });
  await computers.ensure(PC);
  assert.ok(index(isBridge) >= 0, 'it is ready for the run');
});

test('a running computer gets its firewall again and keeps its desktop', async () => {
  answer = docker({ state: 'running', screen: 'up' });
  await computers.ensure(PC);
  assert.ok(index(isFirewall) >= 0, 'a computer started by an older botdot gets the open loopback too');
  assert.equal(index(isDesktop), -1, "the bot's screen is not started a second time");
  assert.equal(index(isResume), -1, 'nor Tailscale');
});

// gVisor fails `docker update` on a running computer (runsc panics): a computer the owner had started, or that
// stayed on, then failed every run's start while it ran fine.
const isUpdate = (a) => a[0] === 'update';
test('a running computer whose restart policy is already off is not updated, so gVisor cannot fail its start', async () => {
  answer = docker({ state: 'running', fail: isUpdate });
  await computers.ensure(PC);
  assert.ok(!calls.some((c) => isUpdate(c.args)));
  assert.ok(index(isBridge) >= 0, 'it is ready for the run');
});

test('a computer that would still come back by itself is set not to, and a failure of that does not stop its start', async () => {
  answer = docker({ state: 'running', restart: 'unless-stopped', fail: isUpdate });
  await computers.ensure(PC);
  assert.ok(calls.some((c) => isUpdate(c.args)));
  assert.ok(index(isBridge) >= 0);
});

test('a computer whose firewall cannot be set is stopped and its desktop never starts', async () => {
  answer = docker({ fail: isFirewall });
  await assert.rejects(computers.ensure(PC), /^Error: Could not secure the computer: iptables: Failed to initialize/);
  assert.ok(calls.some((c) => c.args[0] === 'stop' && c.args.includes('botdot.account.computer')));
  assert.equal(index(isDesktop), -1);
});

test('a computer older than the account computer is kept but stopped, with what to do', async () => {
  answer = docker({ state: 'stopped', network: '1' });
  await assert.rejects(computers.ensure(PC), /older than botdot's account computer and is kept but stopped\. Export its files and reset it/);
  assert.ok(calls.some((c) => c.args[0] === 'stop' && c.args.includes('botdot.account.computer')));
  assert.ok(!calls.some((c) => c.args[0] === 'start'));
  assert.equal(index(isFirewall), -1);
});

test('with Tailscale on the machine, the computer asks Tailscale first, so tailnet names resolve (#523)', async () => {
  tailscale = 'up';
  await computers.ensure(PC);
  assert.deepEqual(resolvers(), ['100.100.100.100', '1.1.1.1', '8.8.8.8']);
  assert.deepEqual(asked[0].servers, ['100.100.100.100']);
});

test('with no Tailscale on the machine, the computer keeps the public resolvers', async () => {
  await computers.ensure(PC);
  assert.deepEqual(resolvers(), ['1.1.1.1', '8.8.8.8']);
});

test('the machine\'s Tailscale is checked once, then again after 10 minutes', async () => {
  tailscale = 'up';
  answer = docker({ state: 'running' });
  await computers.ensure(PC);
  calls = [];
  tailscale = 'down';
  await computers.ensure(PC);
  assert.deepEqual(resolvers(), ['100.100.100.100', '1.1.1.1', '8.8.8.8'], 'the first answer still holds');
  assert.equal(asked.length, 1);
  mock.timers.setTime(clock += 10 * 60_000 + 1);
  calls = [];
  await computers.ensure(PC);
  assert.deepEqual(resolvers(), ['1.1.1.1', '8.8.8.8']);
  assert.equal(asked.length, 2);
});

// Each bot's screen (#105): its own display and ports, its own supervisord, its own bridge and its own folder. The
// account's computer alone starts no screen.
const envOf = (a) => Object.fromEntries(a.filter((x, i) => a[i - 1] === '-e').map((x) => x.split(/=(.*)/s).slice(0, 2)));
test("a bot's screen starts on its own display and ports, in its own folder, with its own bridge (#105)", async () => {
  await computers.ensure({ bot: 'alice', screen: 1 });
  await computers.ensure({ bot: 'bob', screen: 2 });
  const desktops = calls.filter((c) => isDesktop(c.args)).map((c) => c.args);
  assert.equal(desktops.length, 2, 'one screen for each bot');
  assert.deepEqual(desktops[0].slice(-3), ['-n', '-c', '/etc/supervisor/botdot-screen.conf']);
  const [a, b] = desktops.map(envOf);
  assert.deepEqual([a.SCREEN, a.SCREEN_DISPLAY, a.VNC_PORT, a.NOVNC_PORT, a.API_PORT, a.WORKDIR], ['11', ':11', '5911', '6111', '8111', '/workspace/alice']);
  assert.deepEqual([b.SCREEN, b.SCREEN_DISPLAY, b.VNC_PORT, b.NOVNC_PORT, b.API_PORT, b.WORKDIR], ['12', ':12', '5912', '6112', '8112', '/workspace/bob']);
  assert.ok(calls.some((c) => c.args.join(' ') === 'exec -u box botdot.account.computer mkdir -p /workspace/alice'), 'its folder is made as box');
  const bridges = calls.filter((c) => isBridge(c.args)).map((c) => c.args);
  assert.deepEqual(bridges.map((x) => x.slice(-3)), [['--serve', ':11', 'alice'], ['--serve', ':12', 'bob']]);
  assert.deepEqual(bridges.map((x) => envOf(x).DISPLAY), [':11', ':12'], 'each Camoufox on its own screen');
  // The computer-server each status check asks is the bot's own.
  const ports = calls.filter((c) => c.args[0] === 'exec' && c.args.includes('python3')).map((c) => c.args.at(-1));
  assert.ok(ports.includes('8111') && ports.includes('8112'), JSON.stringify(ports));
});

test("the account's computer alone starts no screen, and a screen that is on is not started again (#105)", async () => {
  await computers.ensure();
  assert.equal(index(isDesktop), -1);
  assert.equal(index(isBridge), -1);
  answer = docker({ state: 'running', screen: 'up' });
  calls = [];
  await computers.ensure(PC);
  assert.equal(index(isDesktop), -1);
  assert.ok(index(isBridge) >= 0, 'its bridge is started again; a second one ends by itself');
});

test('a seat that is no screen is refused before anything runs (#105)', async () => {
  for (const seat of [{ bot: 'a', screen: 0 }, { bot: 'a', screen: 90 }, { bot: '../x', screen: 1 }, { bot: 'a', screen: 1.5 }, 'a']) {
    await assert.rejects(computers.ensure(seat), /No such screen/, JSON.stringify(seat));
  }
  assert.deepEqual(calls, []);
});
