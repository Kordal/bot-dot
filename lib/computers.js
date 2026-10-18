// Each bot can own a Linux desktop: a cua Ubuntu/XFCE container managed through the Docker CLI.
// The container runs cua's computer-server (control API, port 8000) and websockify (live screen, port 6080).
// A computer takes no incoming connections (see protect): botdot reaches both through `docker exec`,
// which only botdot can use, so no other bot or computer can reach its controls or its screen.
const { execFile, spawn } = require('child_process');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const registry = require('./registry');
const { IPV4_RANGES, IPV6_RANGES } = require('./network-address');

const run = promisify(execFile);

// bot-dot's desktop = cua's Ubuntu image + Camoufox as the browser (deploy/desktop/Dockerfile).
const IMAGE = process.env.BOT_DOT_COMPUTER_IMAGE || 'bot-dot/desktop:latest';
const BUILD_DIR = path.join(__dirname, '..', 'deploy', 'desktop');
// Public resolvers: the stock container DNS failed lookups in testing.
const DNS = (process.env.BOT_DOT_COMPUTER_DNS || '1.1.1.1,8.8.8.8').split(',').map((d) => d.trim()).filter(Boolean);
// Tailscale's resolver (MagicDNS) on this machine: it answers tailnet names and passes the others on. A computer
// with local network access asks it first, so a *.ts.net service resolves; its 100.x address then leaves through
// the machine's own Tailscale (#523). A bot may also join the owner's tailnet itself, in userspace and with
// shields up, once the owner approves it there (botdot-tailscale in the computer, ADR 032).
const TAILNET_DNS = process.env.BOT_DOT_TAILNET_DNS ?? '100.100.100.100';
const MEMORY = process.env.BOT_DOT_COMPUTER_MEMORY || '3g';
const API_PORT = 8000;
const VNC_PORT = 6080;

// The Compose project a Docker helper serves (lib/docker-helper.js sets it, #19). Two botdot apps on one Docker host
// share its Docker: each names its computers `botdot-<project>.<bot id>`, labels them with its project, and lists,
// counts and touches only those. A project name and a bot id never hold a dot, so no two names meet. Without a helper
// (the Mac, a test) the name is `botdot-<bot id>`, as before.
const SCOPE = process.env.BOT_DOT_COMPUTER_SCOPE || '';
const containerName = (botId) => (SCOPE ? `botdot-${SCOPE}.${botId}` : `botdot-${botId}`);
const OWN = SCOPE ? ['--label', `botdot.instance=${SCOPE}`] : [];
// Of `docker ps` lines "<name>|<bot id>|…": those of this botdot's own computers, as [bot id, …the rest].
const own = (out) => out.split('\n').filter(Boolean).map((line) => line.split('|')).filter(([name, bot]) => bot && name === containerName(bot)).map(([, ...rest]) => rest);

// The bot works on its computer as BOT_USER, not root. Camoufox and botdot's bridge into it, which types the
// secrets, run as BROWSER_USER, which no program of the bot can signal, replace or listen in place of (#311).
const BOT_USER = 'bot';
const BROWSER_USER = 'browser';
// A computer made before that is labelled otherwise: the bot was root there and may have changed anything.
// Labels: { network, users }, '1' each on a computer made since; network is NETWORK_VERSION since ADR 028.
const NETWORK_VERSION = '2';
async function labels(botId) {
  const out = await docker(['inspect', containerName(botId), '--format', '{{index .Config.Labels "botdot.network-version"}}|{{index .Config.Labels "botdot.user-version"}}']);
  const [network, users] = out.split('|');
  return { network, users };
}
const isCurrent = ({ network, users }) => network === NETWORK_VERSION && users === '1';
// Where the image keeps Camoufox's browser (deploy/desktop/Dockerfile).
const CAMOUFOX_CACHE = '/opt/camoufox-cache';

// The desktop shows botdot's own time zone, so pages like delivery trackers show local times, not UTC.
function timeZone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return /^[A-Za-z0-9_+\-/]+$/.test(tz) ? tz : 'UTC';
}

async function docker(args, opts = {}) {
  const { stdout } = await run('docker', args, { timeout: opts.timeout || 60_000, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

// docker with input on its stdin, e.g. a file streamed into the computer. Fails like docker().
function dockerInput(args, input, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { timeout: opts.timeout || 60_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

let dockerState = { checkedAt: 0, ok: false, error: null, image: false };
async function dockerStatus(force = false) {
  if (!force && Date.now() - dockerState.checkedAt < 30_000) return dockerState;
  const next = { checkedAt: Date.now(), ok: false, error: null, image: false, imageName: IMAGE };
  try {
    await docker(['info', '--format', '{{.ServerVersion}}'], { timeout: 10_000 });
    next.ok = true;
    // image inspect, not `docker images`, which lists nothing for an image pinned by digest.
    next.image = await docker(['image', 'inspect', '--format', '{{.Id}}', IMAGE]).then(() => true, () => false);
  } catch (e) {
    next.error = /ENOENT/.test(e.message) ? 'Docker is not installed' : 'Docker is not running';
  }
  dockerState = next;
  return next;
}

// state: 'none' | 'running' | 'stopped'.
async function inspect(botId) {
  let out;
  try {
    out = await docker(['inspect', containerName(botId), '--format', '{{json .State.Status}}|{{json .Config.Image}}|{{json .Image}}']);
  } catch {
    return { state: 'none' };
  }
  const [statusJson, imageJson, imageIdJson] = out.split('|');
  const status = JSON.parse(statusJson);
  return {
    state: status === 'running' ? 'running' : 'stopped',
    image: JSON.parse(imageJson),
    imageId: JSON.parse(imageIdJson),
  };
}

// Which of the bots' computers exist and run. Kept for 10 seconds (the web page asks often); starting,
// stopping or erasing one looks again.
let listed = null; // { at, value }
async function listAll() {
  if (listed && Date.now() - listed.at < 10_000) return listed.value;
  const out = await docker(['ps', '-a', '--filter', 'label=botdot.bot', '--format', '{{.Names}}|{{.Label "botdot.bot"}}|{{.State}}']).catch(() => '');
  const map = {};
  for (const [bot, st] of own(out)) map[bot] = st === 'running' ? 'running' : 'stopped';
  listed = { at: Date.now(), value: map };
  return map;
}

// Run a Python snippet inside the bot's computer with `input` on stdin; resolves to { code, stdout, stderr }.
function execPython(botId, script, args, { input = '', timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', ['exec', '-i', containerName(botId), 'python3', '-c', script, ...args],
      { timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (e, stdout, stderr) => (e && typeof e.code !== 'number' ? reject(e) : resolve({ code: e ? e.code : 0, stdout, stderr })));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// An HTTP request to the computer-server, made from inside the computer. Returns { ok, text }.
const HTTP_IN_COMPUTER = `
import sys, urllib.request, urllib.error
data = sys.stdin.buffer.read() or None
req = urllib.request.Request('http://127.0.0.1:${API_PORT}' + sys.argv[1], data=data, headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=float(sys.argv[2])) as r:
        sys.stdout.buffer.write(r.read())
except urllib.error.HTTPError as e:
    sys.stdout.buffer.write(e.read())
    sys.exit(22)
except OSError as e:
    sys.stdout.write(str(e))
    sys.exit(7)
`;
async function request(botId, pathname, body, { timeoutSeconds = 120 } = {}) {
  const { code, stdout, stderr } = await execPython(botId, HTTP_IN_COMPUTER, [pathname, String(timeoutSeconds)], {
    input: body === undefined ? '' : JSON.stringify(body),
    timeout: (timeoutSeconds + 15) * 1000,
  });
  return { ok: code === 0, text: code === 0 ? stdout : (stdout || stderr).trim() };
}

// A raw connection to the computer's screen (websockify), through the child's stdin and stdout.
const PIPE_IN_COMPUTER = `
import os, socket, sys, threading
s = socket.create_connection(('127.0.0.1', ${VNC_PORT}))
def up():
    while True:
        d = os.read(0, 65536)
        if not d:
            break
        s.sendall(d)
    try:
        s.shutdown(socket.SHUT_WR)
    except OSError:
        pass
threading.Thread(target=up, daemon=True).start()
out = sys.stdout.buffer
while True:
    d = s.recv(65536)
    if not d:
        break
    out.write(d)
    out.flush()
`;
const screenPipe = (botId) => spawn('docker', ['exec', '-i', containerName(botId), 'python3', '-c', PIPE_IN_COMPUTER], { stdio: ['pipe', 'pipe', 'ignore'] });

async function waitReady(botId, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await request(botId, '/status', undefined, { timeoutSeconds: 3 })).ok) return true;
    } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('The computer did not start in time');
}

// A computer is on a network of its own (per-computer bridges also keep LAN-enabled computers apart) and starts
// with nothing running: `sleep` is its entrypoint, also after a stop or a restart of Docker. root sets its
// resolvers and firewall inside it, through a privileged `docker exec` with this fixed script, and only then is the
// desktop started (startDesktop). It was given a quiet container's network before (botdot.network-version=1),
// which gVisor does not allow: there every sandbox has a network stack of its own (ADR 028).
const network = (botId) => `${containerName(botId)}-network`;
// What botdot reaches on the computer's loopback: computer control, display, and the Camoufox bridge.
const PORTS = '8000,6080,5901,6001,47111';
// The resolvers come as the script's arguments.
const RESOLVERS = `printf 'nameserver %s\\n' "$@" > /etc/resolv.conf\n`;
// runc: in and out, with conntrack.
function firewallRunc(egress) {
  return `set -eu
${RESOLVERS}rules() {
  tool="$1"
  "$tool" -P INPUT DROP
  "$tool" -P OUTPUT DROP
  "$tool" -F INPUT
  "$tool" -F OUTPUT
  "$tool" -A INPUT -i lo -j ACCEPT
  "$tool" -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  "$tool" -A OUTPUT -o lo -p tcp -m multiport --dports ${PORTS} -j ACCEPT
  "$tool" -A OUTPUT -o lo -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
}
rules iptables
rules ip6tables
${egress === 'lan' ? '' : `for block in ${IPV4_RANGES.join(' ')}; do iptables -A OUTPUT -d "$block" -j REJECT; done
for block in ${[...IPV6_RANGES, '::ffff:0:0/96'].join(' ')}; do ip6tables -A OUTPUT -d "$block" -j REJECT; done`}
iptables -A OUTPUT -j ACCEPT
ip6tables -A OUTPUT -j ACCEPT
`;
}
// gVisor: its iptables are legacy only and have no conntrack, state or TCP flag matches, so only what leaves is
// filtered. On loopback botdot's ports answer each other; from those ports nothing leaves on another interface, so
// nobody outside reaches the computer's control or screen, with LAN access too.
function firewallGvisor(egress) {
  return `set -eu
${RESOLVERS}for tool in iptables-legacy ip6tables-legacy; do
  "$tool" -P OUTPUT DROP
  "$tool" -F OUTPUT
  "$tool" -A OUTPUT -o lo -p tcp -m multiport --dports ${PORTS} -j ACCEPT
  "$tool" -A OUTPUT -o lo -p tcp -m multiport --sports ${PORTS} -j ACCEPT
  "$tool" -A OUTPUT -p tcp -m multiport --sports ${PORTS} -j DROP
done
${egress === 'lan' ? '' : `for block in ${IPV4_RANGES.join(' ')}; do iptables-legacy -A OUTPUT -d "$block" -j REJECT; done
for block in ${[...IPV6_RANGES, '::ffff:0:0/96'].join(' ')}; do ip6tables-legacy -A OUTPUT -d "$block" -j REJECT; done`}
iptables-legacy -A OUTPUT -j ACCEPT
ip6tables-legacy -A OUTPUT -j ACCEPT
`;
}
const firewall = (runtime, egress) => (runtime === 'runsc' ? firewallGvisor : firewallRunc)(egress);
// Whether this machine runs Tailscale: its resolver answers, a missing name included. Checked again after a while,
// as Tailscale may be set up or removed while botdot runs.
let tailnet = null;
async function hasTailnet() {
  if (!TAILNET_DNS) return false;
  if (tailnet && Date.now() - tailnet.at < 10 * 60_000) return tailnet.up;
  const resolver = new dns.promises.Resolver({ timeout: 1000, tries: 1 });
  resolver.setServers([TAILNET_DNS]);
  const up = await resolver.resolve4('ts.net').then(() => true, (e) => ['ENOTFOUND', 'ENODATA'].includes(e.code));
  tailnet = { at: Date.now(), up };
  return up;
}
const resolvers = async (egress) => (egress === 'lan' && await hasTailnet() ? [TAILNET_DNS, ...DNS.filter((d) => d !== TAILNET_DNS)] : DNS);
async function protect(botId, egress) {
  const runtime = await docker(['inspect', containerName(botId), '--format', '{{.HostConfig.Runtime}}']);
  await docker(['exec', '--privileged', '-u', 'root', containerName(botId), 'sh', '-c', firewall(runtime, egress), 'sh', ...await resolvers(egress)]);
}
// The desktop and cua's services, as the bot (deploy/desktop/supervisord.conf).
async function startDesktop(botId) {
  await docker(['exec', '-d', '-u', BOT_USER, '-e', `HOME=/home/${BOT_USER}`, containerName(botId),
    '/usr/bin/supervisord', '-n', '-c', '/etc/supervisor/supervisord.conf']);
}
// Always-on computers are started by bots.keepAlwaysOn, which goes through ensure.
function watch(mine) {
  // One-time upgrade of the old restart policy: no legacy desktop may keep running open.
  Promise.resolve().then(async () => {
    for (const id of mine()) {
      if ((await inspect(id)).state === 'none') continue;
      await docker(['update', '--restart', 'no', containerName(id)]);
      if (!isCurrent(await labels(id))) await stop(id);
    }
  }).catch((e) => console.error(`[computers] startup safety check failed: ${e.message}`));
}

// The computers made before #19, named `botdot-<bot id>` for the whole host, become this helper's: renamed to its own
// name, they keep their files. Run once by the helper as it starts, before it lists them. When two apps share a host
// that had one, the first helper to start takes them all; the other's bots get new computers.
async function adoptUnscoped() {
  if (!SCOPE) return [];
  const out = await docker(['ps', '-a', '--filter', 'label=botdot.bot', '--format', '{{.Names}}|{{.Label "botdot.bot"}}']);
  const taken = [];
  for (const [name, bot] of out.split('\n').filter(Boolean).map((line) => line.split('|'))) {
    if (!bot || name !== `botdot-${bot}`) continue;
    await docker(['rename', name, containerName(bot)]).then(() => taken.push(bot), (e) => console.error(`[computers] ${name}: ${e.message}`));
  }
  listed = null;
  return taken;
}

let building = null;
// Make the desktop image once if it's missing: a desktop on a registry is botdot's signed one and is
// pulled; a name without a registry (the default, or a self-built botdot server's) is built here.
function ensureImage() {
  if (building) return building;
  building = (async () => {
    // A desktop made before the bot lost root has no bot user to run a new computer as: build or pull it again.
    if (await docker(['image', 'inspect', IMAGE, '--format', '{{index .Config.Labels "botdot.user-version"}}']).catch(() => null) === '1') return;
    if (registry.parse(IMAGE)) {
      await registry.login(IMAGE);
      const ref = registry.parse(IMAGE);
      if (!ref) throw new Error('Invalid configured desktop repository');
      const release = require('./release-manifest').verify(await registry.remoteRelease(IMAGE), { app: 'desktop', installed: 0 });
      const pinned = `${ref.registry}/${ref.repo}@sha256:${release.sha256}`;
      if (release.file !== pinned || IMAGE.includes('@') && IMAGE !== pinned) throw new Error('Desktop manifest does not match the configured image');
      await docker(['pull', pinned], { timeout: 30 * 60_000 });
      if (!IMAGE.includes('@')) await docker(['tag', pinned, IMAGE]);
      return;
    }
    await docker(['build', '-t', IMAGE, BUILD_DIR], { timeout: 30 * 60_000 });
  })().finally(() => { building = null; dockerState.checkedAt = 0; });
  return building;
}

// ---------- a free computer ----------

// The account's share of the machine (ADR 028): at most so many of its bots' computers run at once. Root writes it
// (install.sh, share/share.json, mounted read-only here); without the file there is no such cap (the Mac, a test).
// It is never shown in the account: a start that would be one too many waits, first come first, until another
// computer stops, and the run's working line says "Waiting for a free computer" meanwhile (bots.js).
const SHARE_FILE = process.env.BOT_DOT_SHARE_FILE || null;
function computerCap() {
  if (!SHARE_FILE) return Infinity;
  try {
    const n = JSON.parse(fs.readFileSync(SHARE_FILE, 'utf8')).computers;
    return Number.isInteger(n) && n >= 1 ? n : Infinity;
  } catch { return Infinity; }
}
const WAIT_MS = 5000; // how often a waiting start looks again, also when nothing woke it (a computer that crashed)
const waitingFor = []; // bots whose computer waits for a free one, first come first
const letIn = new Set(); // bots whose start was let in and isn't running yet
const cancelled = new Set(); // waiting starts that were stopped
const sleepers = new Set();
const wakeWaiting = () => { for (const wake of [...sleepers]) wake(); };
async function runningComputers() {
  const out = await docker(['ps', '--filter', 'label=botdot.bot', '--filter', 'status=running', '--format', '{{.Names}}|{{.Label "botdot.bot"}}']);
  return new Set(own(out).map(([bot]) => bot));
}
// Resolves when the bot's computer may start: it runs already, or fewer than the cap run or are being started. Throws
// when the start was stopped while it waited.
async function freeComputer(botId) {
  try {
    for (;;) {
      if (cancelled.delete(botId)) throw new Error('Stopped while waiting for a free computer');
      const cap = computerCap();
      if (cap === Infinity) return;
      const running = await runningComputers();
      if (running.has(botId)) return;
      const taken = new Set([...running, ...[...letIn].filter((id) => id !== botId)]);
      if (!waitingFor.includes(botId)) waitingFor.push(botId);
      if (waitingFor.indexOf(botId) < cap - taken.size) { letIn.add(botId); return; }
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); sleepers.delete(done); resolve(); };
        const timer = setTimeout(done, WAIT_MS);
        sleepers.add(done);
      });
    }
  } finally {
    const at = waitingFor.indexOf(botId);
    if (at >= 0) waitingFor.splice(at, 1);
  }
}
// Whether the bot's computer waits for a free one now.
const waiting = (botId) => waitingFor.includes(botId);

const starting = new Map(); // botId -> { promise, egress, start }; last requested operation, including queued changes
// The helper owns pending starts. Queue before inspecting Docker so a slow inspection
// cannot reorder owner decisions, and a policy edit never starts an idle computer.
const reconfigure = (botId, egress) => queueComputer(botId, egress, false);
const ensure = (botId, egress = 'internet') => queueComputer(botId, egress, true);

function queueComputer(botId, egress, start) {
  if (!['internet', 'lan'].includes(egress)) return Promise.reject(new Error('Invalid computer egress'));
  const current = starting.get(botId);
  if (current?.egress === egress && (current.start || !start)) return current.promise;
  // Register queued changes immediately: a later revocation must wait for (and supersede)
  // an earlier LAN grant, even when the policy currently being applied is already internet.
  const p = (current ? current.promise.catch(() => {}) : Promise.resolve())
    .then(async () => {
      if (!start && (await inspect(botId)).state !== 'running') return;
      if (start) await freeComputer(botId);
      await startComputer(botId, egress);
    })
    .finally(() => { letIn.delete(botId); if (starting.get(botId)?.promise === p) starting.delete(botId); listed = null; wakeWaiting(); });
  starting.set(botId, { promise: p, egress, start });
  return p;
}

async function startComputer(botId, egress) {
  const st = await dockerStatus(true);
  if (!st.ok) throw new Error(`${st.error}. The bot's computer needs Docker.`);
  await ensureImage();
  // An existing computer is always kept, even if bot-dot's desktop image has changed since it was
  // made: it holds whatever the bot or you installed. details() reports when a newer desktop exists.
  let info = await inspect(botId);
  if (info.state !== 'none') {
    await docker(['update', '--restart', 'no', containerName(botId)]);
    const { network, users } = await labels(botId);
    if (network !== NETWORK_VERSION) {
      await stop(botId);
      throw new Error('This older computer is preserved but stopped. Export its files and reset it: botdot now gives every computer a network of its own.');
    }
    if (users !== '1') {
      await stop(botId);
      throw new Error('This older computer is preserved but stopped. Export its files and reset it, so that the bot no longer works as root and botdot can type saved logins into it safely.');
    }
  }
  if (info.state === 'none') {
    // The quiet container of a computer made the old way, and erased since without botdot, would be left over.
    await docker(['rm', '-f', network(botId)]).catch(() => {});
    await docker(['network', 'inspect', network(botId)]).catch(() => docker(['network', 'create', '--label', `botdot.network=${botId}`, ...OWN, network(botId)]));
    await docker([
      'run', '-d', '--name', containerName(botId),
      '--label', `botdot.bot=${botId}`, ...OWN, '--label', 'cua.sandbox=true', '--label', `botdot.network-version=${NETWORK_VERSION}`, '--label', 'botdot.user-version=1',
      '--network', network(botId), '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--user', BOT_USER, '-e', `HOME=/home/${BOT_USER}`,
      '--memory', MEMORY, '--shm-size', '1g', '-e', `TZ=${timeZone()}`,
      '--entrypoint', 'sleep', IMAGE, 'infinity',
    ], { timeout: 15 * 60_000 }); // first run may pull the image
  } else if (info.state === 'stopped') {
    await docker(['start', containerName(botId)]);
  }
  try { await protect(botId, egress); } catch (e) { await stop(botId); throw new Error(`Could not secure the computer: ${e.message}`); }
  if (info.state !== 'running') await startDesktop(botId);
  await waitReady(botId);
  await syncScripts(botId);
  await setTimeZone(botId);
  await keepScreenAwake(botId);
  await startBrowserBridge(botId);
}

// Copy the current browser launcher in, so existing computers get updates without a reset (a bridge already
// running keeps its own until the computer stops). It is root's, so the bot cannot change it. A failed copy
// stops the start instead of starting the bridge from an older launcher.
// `docker cp` would keep the owner of botdot's checkout, which root (--cap-drop ALL) can then neither chmod nor
// chown. So root writes it from stdin next to the old one, in its own folder and not /tmp where the bot could
// race it, and renames it over the old one, whoever owns that.
const SCRIPTS = ['camoufox-browser'];
async function syncScripts(botId) {
  try {
    for (const f of SCRIPTS) {
      const to = `/usr/local/bin/${f}`;
      const next = `/usr/local/bin/.${f}.new`;
      await dockerInput(['exec', '-i', '-u', 'root', containerName(botId), 'sh', '-c',
        `rm -f ${next} && cat > ${next} && chmod 755 ${next} && mv -f ${next} ${to}`], await fs.promises.readFile(path.join(BUILD_DIR, f)));
    }
  } catch (e) {
    throw new Error(`Could not copy botdot's browser into the computer: ${e.message}`);
  }
}

// Computers made before this (or before the time zone changed) run on another zone. Set the system
// zone, which the shell and newly started programs read, and close a browser still on the old one.
// Root has no right to signal the browser user's programs (--cap-drop ALL), so the browser user ends the
// browser and its bridge, which holds the old zone, and waits for the bridge to go: startBrowserBridge starts it
// again with the new zone.
const CLOSE_BROWSER = 'pkill -f "camoufox-[b]"; for _ in $(seq 1 25); do pgrep -f "camoufox-[b]rowser --serve" >/dev/null || exit 0; sleep 0.2; done';
async function setTimeZone(botId) {
  const script = '[ -f "/usr/share/zoneinfo/$1" ] || exit 0; [ "$(cat /etc/timezone 2>/dev/null)" = "$1" ] && exit 0; '
    + 'ln -sf "/usr/share/zoneinfo/$1" /etc/localtime && echo "$1" > /etc/timezone && echo changed; true';
  const changed = await docker(['exec', '-u', 'root', containerName(botId), 'sh', '-c', script, 'sh', timeZone()]).catch(() => '');
  if (changed === 'changed') await docker(['exec', '-u', BROWSER_USER, containerName(botId), 'sh', '-c', CLOSE_BROWSER]).catch(() => {});
}

// botdot's bridge into Camoufox (deploy/desktop/camoufox-browser --serve), as the browser user. It opens the
// browser when the bot asks for it and takes botdot's secrets on a socket only that user can open. A second
// start while one runs ends by itself. The launcher writes what it and Camoufox print to its log, in the
// browser user's home, which the bot cannot read: `docker exec -u browser <computer> tail /home/browser/bridge.log`.
// It keeps the latest 1 MiB at most, and the previous start's in bridge.log.1 beside it (#355).
async function startBrowserBridge(botId) {
  await docker(['exec', '-d', '-u', BROWSER_USER, '-w', '/', '-e', `HOME=/home/${BROWSER_USER}`, '-e', 'DISPLAY=:1',
    '-e', `TZ=${timeZone()}`, '-e', `XDG_CACHE_HOME=${CAMOUFOX_CACHE}`, containerName(botId),
    '/usr/local/bin/camoufox-browser', '--serve']);
}

// The desktop blanks its screen after 10 idle minutes; turn that off (it resets on every start).
async function keepScreenAwake(botId) {
  await docker(['exec', '-e', 'DISPLAY=:1', containerName(botId), 'sh', '-c', 'xset s off; xset s noblank; xset -dpms 2>/dev/null; true']).catch(() => {});
}

// Always-on computers also come back by themselves when Docker restarts (e.g. after a reboot).
async function setRestartPolicy(botId, alwaysOn) {
  if ((await inspect(botId)).state === 'none') return;
  await docker(['update', '--restart', 'no', containerName(botId)]).catch(() => {});
}

// A start that waits for a free computer is stopped too: it doesn't start later.
async function stop(botId) {
  if (waitingFor.includes(botId)) { cancelled.add(botId); wakeWaiting(); }
  await docker(['stop', '-t', '5', containerName(botId)]).catch(() => {});
  listed = null;
  wakeWaiting();
}

// Wipe the computer; the next run starts from a fresh desktop. Returns 'erased' | 'none' | 'failed'.
async function reset(botId) {
  const info = await inspect(botId);
  try {
    if (info.state !== 'none') await docker(['rm', '-f', containerName(botId)]);
    await docker(['rm', '-f', network(botId)]).catch(() => {}); // a computer's quiet container, before version 2
    await docker(['network', 'rm', network(botId)]).catch(() => {});
    // A computer taken over from before #19 kept the network of its old name.
    if (SCOPE) await docker(['network', 'rm', `botdot-${botId}-network`]).catch(() => {});
    return 'erased';
  } catch {
    return 'failed';
  } finally { listed = null; wakeWaiting(); }
}

let latest = { at: 0, id: null };
async function currentImageId() {
  if (Date.now() - latest.at < 30_000) return latest.id;
  const id = await docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}']).catch(() => null);
  latest = { at: Date.now(), id };
  return id;
}

// State of a bot's computer for the screen view, incl. whether a newer desktop is available.
async function details(botId) {
  const info = await inspect(botId);
  if (info.state === 'none') return { state: 'none' };
  const current = await currentImageId();
  const outdated = info.image !== IMAGE || (!!current && !!info.imageId && info.imageId !== current);
  const size = await docker(['inspect', '--size', containerName(botId), '--format', '{{.SizeRw}}']).catch(() => null);
  return { state: info.state, outdated, diskBytes: size ? Number(size) : null };
}

// The helper that hands a secret to the bridge is botdot's own copy, sent with every call and run as the browser
// user from /, in Python's isolated mode: no file of the computer stands between botdot and the browser, so there
// is nothing to check or race (#311). A computer made before the bot lost root gets no secret at all.
const TYPE_SECRET = path.join(BUILD_DIR, 'botdot-type-secret');
async function typeSecret(botId, payload) {
  let helper;
  try {
    helper = await fs.promises.readFile(TYPE_SECRET, 'utf8');
    if (!isCurrent(await labels(botId))) {
      return { ok: false, error: "This computer is older than botdot's safe typing of saved logins. Ask the owner to export its files and reset it." };
    }
  } catch {
    return { ok: false, error: "Couldn't reach the bot's browser." };
  }
  return new Promise((resolve) => {
    const child = execFile('docker', ['exec', '-i', '-u', BROWSER_USER, '-w', '/', containerName(botId), '/usr/bin/python3', '-I', '-c', helper], { timeout: 60_000 }, (err, stdout) => {
      if (err && !stdout) return resolve({ ok: false, error: "Couldn't reach the bot's browser." });
      try { resolve(JSON.parse(String(stdout).trim().split('\n').pop())); } catch { resolve({ ok: false, error: 'The browser gave an unexpected answer.' }); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}
async function startProgram(botId, command) {
  await docker(['exec', '-d', '-u', BOT_USER, '-e', 'DISPLAY=:1', '-e', `HOME=/home/${BOT_USER}`, '-e', `TZ=${timeZone()}`, containerName(botId), 'sh', '-c', command], { timeout: 20_000 });
}

// run_with_login: one command as the bot user, with a saved login in BOTDOT_USERNAME and BOTDOT_PASSWORD. The values
// are in the docker CLI's own environment, and `-e NAME` without a value passes them on, so they are never on a
// command line in the host's process list; nothing is written to a file. `timeout` inside the computer ends the
// command (docker stopping on its side would leave it running there). Resolves to { code, stdout, stderr, timedOut }.
const RUN_MAX_SECONDS = 600;
const RUN_MAX_BUFFER = 2 * 1024 * 1024;
const runSeconds = (timeoutSeconds) => Math.min(Math.max(Math.round(Number(timeoutSeconds) || 120), 1), RUN_MAX_SECONDS);
function runWithLogin(botId, { command, username = '', password = '', timeoutSeconds = 120 }) {
  return runAsBot(botId, command, runSeconds(timeoutSeconds), ['-e', 'BOTDOT_USERNAME', '-e', 'BOTDOT_PASSWORD'],
    { BOTDOT_USERNAME: String(username), BOTDOT_PASSWORD: String(password) });
}
// One command as the bot user in its computer, inside `timeout`: `extra` are more `docker exec` arguments, `env` more
// of the docker CLI's own environment.
function runAsBot(botId, command, seconds, extra = [], env = {}) {
  const args = ['exec', '-u', BOT_USER, '-e', `HOME=/home/${BOT_USER}`, '-e', `TZ=${timeZone()}`, ...extra,
    containerName(botId), 'timeout', '-k', '5', String(seconds), 'sh', '-c', command];
  return new Promise((resolve) => {
    execFile('docker', args, { env: { ...process.env, ...env }, timeout: (seconds + 20) * 1000, maxBuffer: RUN_MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = { stdout: String(stdout || ''), stderr: String(stderr || '') };
      if (!err) return resolve({ code: 0, ...out, timedOut: false });
      if (typeof err.code === 'number') return resolve({ code: err.code, ...out, timedOut: err.code === 124 });
      // docker itself failed, ran out of time or said too much: never its message, which repeats the command line.
      const why = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'the output was cut off at 2 MB' : err.killed ? 'it ran out of time' : "couldn't run it in the computer";
      resolve({ code: null, ...out, timedOut: !!err.killed, error: why });
    });
  });
}

// run_with_ssh_key: one command as the bot user with SSH_AUTH_SOCK set to an ssh-agent that holds one SSH key, so
// `ssh` and `git` use the key and the bot never reads it. In four steps, each its own `docker exec`:
// 1. as the bot user, a new ssh-agent in the foreground (`-D`, so the program that listens is the one whose pid is
//    known), in a new folder of the bot's, its socket opened to root, who has no right to the bot's files;
// 2. as root, botdot's own copy of deploy/desktop/botdot-ssh-add, with the key on its stdin only: it hands the key to
//    that agent alone (its pid and user, by SO_PEERCRED). The agent makes itself untraceable, and root's processes
//    are closed to the bot (--cap-drop ALL), so nobody else in the computer reads the key;
// 3. the command, as run_with_login runs it, with SSH_AUTH_SOCK and no secret in its environment;
// 4. the agent is ended and its folder removed, whatever happened. The key also leaves the agent by itself a minute
//    after the time limit (-t), should step 4 not reach it.
// A computer made before the bot lost root gets no key. Resolves like runWithLogin, with `error` when no command ran.
const SSH_ADD = path.join(BUILD_DIR, 'botdot-ssh-add');
const START_AGENT = [
  'umask 077',
  'd=$(mktemp -d /tmp/botdot-ssh-XXXXXXXXXX) || exit 1',
  'chmod 711 "$d" || exit 1',
  '/usr/bin/ssh-agent -D -a "$d/agent" -t "$1" </dev/null >/dev/null 2>&1 &',
  'pid=$!',
  'i=0; while [ ! -S "$d/agent" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i+1)); done',
  '[ -S "$d/agent" ] || { kill "$pid" 2>/dev/null; rm -rf "$d"; exit 1; }',
  'chmod 666 "$d/agent" || exit 1',
  'echo "$d $pid"',
].join('\n');
const STOP_AGENT = 'kill "$1" 2>/dev/null; rm -rf "$2"';
const AGENT_LINE = /^(\/tmp\/botdot-ssh-[A-Za-z0-9]+) ([0-9]+)$/;
async function runWithSshKey(botId, { command, privateKey = '', timeoutSeconds = 120 }) {
  const seconds = runSeconds(timeoutSeconds);
  const lifetime = String(seconds + 60);
  const none = (error) => ({ code: null, stdout: '', stderr: '', timedOut: false, error });
  let helper;
  try {
    helper = await fs.promises.readFile(SSH_ADD, 'utf8');
    if (!isCurrent(await labels(botId))) return none("this computer is older than botdot's SSH keys. Ask the owner to export its files and reset it");
  } catch {
    return none("couldn't reach the computer");
  }
  const agent = await docker(['exec', '-u', BOT_USER, containerName(botId), 'sh', '-c', START_AGENT, 'sh', lifetime], { timeout: 30_000 })
    .then((out) => String(out).match(AGENT_LINE), () => null);
  if (!agent) return none("couldn't start an ssh-agent in the computer. A computer made before botdot's SSH keys may have none: the owner can export its files and reset it");
  const [, dir, pid] = agent;
  try {
    const loaded = await new Promise((resolve) => {
      const child = execFile('docker', ['exec', '-i', '-u', 'root', '-w', '/', containerName(botId), '/usr/bin/python3', '-I', '-c', helper, `${dir}/agent`, pid, lifetime, BOT_USER],
        { timeout: 60_000 }, (err, stdout) => {
          try { resolve(JSON.parse(String(stdout).trim().split('\n').pop())); } catch { resolve({ ok: false, error: "couldn't load the key into the computer" }); }
        });
      child.stdin.on('error', () => {});
      child.stdin.end(privateKey);
    });
    if (loaded?.ok !== true) return none(typeof loaded?.error === 'string' ? loaded.error : 'the SSH key could not be loaded');
    return await runAsBot(botId, command, seconds, ['-e', `SSH_AUTH_SOCK=${dir}/agent`]);
  } finally {
    await docker(['exec', '-u', BOT_USER, containerName(botId), 'sh', '-c', STOP_AGENT, 'sh', pid, dir]).catch(() => {});
  }
}

module.exports = { IMAGE, timeZone, adoptUnscoped, ensure, reconfigure, ensureImage, stop, reset, details, inspect, listAll, dockerStatus, containerName, setRestartPolicy, request, screenPipe, watch, typeSecret, startProgram, runWithLogin, runWithSshKey, waiting };
if (process.env.BOT_DOT_HELPER_SOCKET) module.exports = require('./helper-client').computers(module.exports);
