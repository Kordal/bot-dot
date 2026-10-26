// The account's computer: one Linux desktop (a cua Ubuntu/XFCE container managed through the Docker CLI) on which
// every bot of the account that has a computer works, as the one user `box` with passwordless sudo (ADR 035). It is
// no security boundary between bots: each can see, change and end what the others do there, and read what botdot
// hands any of them there. Its walls are those around the account (ADR 028).
// Each bot has a screen of its own there (#105): its own X display with an XFCE desktop, cua's computer-server
// (control API), websockify (live screen) and Camoufox with botdot's bridge, on ports of its own (screenPorts). Every
// call for a bot takes its seat, { bot, screen }, which lib/computer-screens.js keeps; a screen starts on the bot's
// first computer tool. The screens are separate work surfaces, not walls: every bot still has sudo.
// A computer takes no incoming connections (see protect): botdot reaches a screen through `docker exec`,
// which only botdot can use, so no other account or computer can reach its controls or its screen.
const { execFile, spawn } = require('child_process');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const registry = require('./registry');
const vaultFiles = require('./vault-files');
const workspaceGit = require('./workspace-git');
const computerMove = require('./computer-move');

const run = promisify(execFile);

// bot-dot's desktop = cua's Ubuntu image + Camoufox as the browser (deploy/desktop/Dockerfile).
const IMAGE = process.env.BOT_DOT_COMPUTER_IMAGE || 'bot-dot/desktop:latest';
const BUILD_DIR = path.join(__dirname, '..', 'deploy', 'desktop');
// Public resolvers: the stock container DNS failed lookups in testing.
const DNS = (process.env.BOT_DOT_COMPUTER_DNS || '1.1.1.1,8.8.8.8').split(',').map((d) => d.trim()).filter(Boolean);
// Tailscale's resolver (MagicDNS) on this machine: it answers tailnet names and passes the others on. A computer
// asks it first when the machine runs Tailscale, so a *.ts.net service resolves; its 100.x address then leaves through
// the machine's own Tailscale (#523). The computer may also join the owner's tailnet as one device of its own, which
// every bot on it uses: root runs it in userspace with shields up, once the owner approves it there (botdot-tailscale
// in the computer, #106).
const TAILNET_DNS = process.env.BOT_DOT_TAILNET_DNS ?? '100.100.100.100';
// The account's share of the machine, in a file only root writes (install.sh; ADR 028): its GB of RAM and its CPUs
// are the computer's limits (#108). BOT_DOT_COMPUTER_MEMORY, when set, is its memory instead. Without either it has
// no limit of its own (the Mac, a test), and the account's share still bounds everything the account runs.
const SHARE_FILE = process.env.BOT_DOT_SHARE_FILE || '';
const MEMORY = process.env.BOT_DOT_COMPUTER_MEMORY || '';

// A bot's screen: its seat's number n (1..MAX_SCREENS, lib/computer-screens.js) is X display :(10 + n), so that no
// screen meets the one shared screen (display :1, its ports 5901, 6001, 6080, 8000 and 47111) a computer made by #104
// may still run until it stops. Each port is its base plus the display's number; the Camoufox launcher derives its
// own (deploy/desktop/camoufox-browser, OPEN_PORT_BASE), and the bot works in /workspace/<bot> by default.
const MAX_SCREENS = 89;
const BOT_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const SCREEN_CONF = '/etc/supervisor/botdot-screen.conf';
function screenPorts(seat) {
  const { bot, screen, name } = seat || {};
  if (typeof bot !== 'string' || !BOT_ID.test(bot) || !Number.isInteger(screen) || screen < 1 || screen > MAX_SCREENS) throw new Error('No such screen');
  const n = 10 + screen;
  return {
    bot, n, display: `:${n}`,
    vnc: 5900 + n, novnc: 6100 + n, api: 8100 + n, browser: 47200 + n,
    socket: `/run/botdot-browser/bridge-${n}.sock`,
    workdir: `/workspace/${bot}`,
    ...(typeof name === 'string' && name ? { name } : {}),
  };
}
const whole = (n) => Number.isInteger(n) && n > 0;
// What Docker says when it cannot set them: no CPU CFS scheduler, or no cgroup controllers for memory or CPU.
const LIMITS_REFUSED = /NanoCPUs|CFS scheduler|cgroup|memory limit/i;
// What Docker says when it has no init to put first (its docker-init): the computer is made without one.
const INIT_REFUSED = /docker-init|init binary|init path/i;
// The limits as `docker run` and `docker update` take them, read at each start: a share root's step changed since
// applies from the computer's next start. A share written before #108 also has `computers`, which is ignored.
function limits() {
  let share = {};
  try { share = JSON.parse(fs.readFileSync(SHARE_FILE, 'utf8')) || {}; } catch { /* none, or not one */ }
  const memory = MEMORY || (whole(share.ram) ? `${share.ram}g` : '');
  return [...(memory ? ['--memory', memory, '--memory-swap', memory] : []), ...(whole(share.cpu) ? ['--cpus', String(share.cpu)] : [])];
}

// The Compose project a Docker helper serves (lib/docker-helper.js sets it, #19). Two botdot apps on one Docker host
// share its Docker: each names its computer `botdot-<project>.account.computer`, labels it with its project, and
// lists and touches only its own. Without a helper (the Mac, a test) the name is `botdot.account.computer`.
const SCOPE = process.env.BOT_DOT_COMPUTER_SCOPE || '';
const ACCOUNT = SCOPE ? `botdot-${SCOPE}.account.computer` : 'botdot.account.computer';
// The computer a bot works on: the account's, whichever bot it is.
const containerName = () => ACCOUNT;
// A bot's old computer of its own, made before #104: `botdot-<project>.<bot id>`, or `botdot-<bot id>` without a
// helper. A project name and a bot id never hold a dot, so it never meets the account's computer's name. It is kept,
// stopped, for its files, until it is reset or its bot deleted.
const oldName = (botId) => (SCOPE ? `botdot-${SCOPE}.${botId}` : `botdot-${botId}`);
const OWN = SCOPE ? ['--label', `botdot.instance=${SCOPE}`] : [];
// Of `docker ps` lines "<name>|<bot id>|…": those of this botdot's own old computers, as [bot id, …the rest].
const own = (out) => out.split('\n').filter(Boolean).map((line) => line.split('|')).filter(([name, bot]) => bot && name === oldName(bot)).map(([, ...rest]) => rest);

// Every bot works on the computer as USER, with passwordless sudo (ADR 035). Camoufox and botdot's bridge into it,
// which types the secrets, still run as BROWSER_USER, so that a program that does not use sudo can neither read
// the browser's profile nor take a secret in its place (#311); with sudo, any bot can.
const USER = 'box';
const HOME = `/home/${USER}`;
const BROWSER_USER = 'browser';
// What outlives the computer itself (#107): /home/box, /workspace, the browsers' profiles (their logins) and the
// computer's Tailscale, root's, with its login (#106) are on named volumes of the account's own, so a computer made
// again from a newer desktop takes them over and stays on the tailnet with no new approval. What apt installed is in
// the computer and goes with it, as on Grok Bot. Under gVisor what the computer writes elsewhere still outlives a stop
// (--overlay2=none, #68). A reset of the account's computer erases the volumes too.
const TAILSCALE_DIR = '/var/lib/botdot-tailscale'; // deploy/desktop/botdot-tailscale: made when it is first used
const VOLUMES = [[`${ACCOUNT}-home`, HOME], [`${ACCOUNT}-workspace`, '/workspace'], [`${ACCOUNT}-browser`, `/home/${BROWSER_USER}`],
  [`${ACCOUNT}-tailscale`, TAILSCALE_DIR]];
// Where a bot's old computer of its own kept its files (the user bot, ADR 021), and where they are copied to.
const OLD_HOME = '/home/bot';
const oldCopy = (botId) => `/workspace/${botId}/old-computer`;
// Labels: { network, users }. network is NETWORK_VERSION since ADR 028; users is '2' on the account's computer (one
// user with sudo), '1' on a bot's old computer of its own (the user bot, without root), none before that.
const NETWORK_VERSION = '2';
const USER_VERSION = '2';
async function labels() {
  const out = await docker(['inspect', ACCOUNT, '--format', '{{index .Config.Labels "botdot.network-version"}}|{{index .Config.Labels "botdot.user-version"}}']);
  const [network, users] = out.split('|');
  return { network, users };
}
const isCurrent = ({ network, users }) => network === NETWORK_VERSION && users === USER_VERSION;
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

// The account's computer, which every bot works on. state: 'none' | 'running' | 'stopped'.
const inspect = () => inspectName(ACCOUNT);
async function inspectName(name) {
  let out;
  try {
    out = await docker(['inspect', name, '--format', '{{json .State.Status}}|{{json .Config.Image}}|{{json .Image}}']);
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

// Which bots still have an old computer of their own (#104), and whether it runs. Kept for 10 seconds; stopping or
// erasing one looks again.
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
function execPython(script, args, { input = '', timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', ['exec', '-i', ACCOUNT, 'python3', '-c', script, ...args],
      { timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (e, stdout, stderr) => (e && typeof e.code !== 'number' ? reject(e) : resolve({ code: e ? e.code : 0, stdout, stderr })));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// An HTTP request to a screen's computer-server, made from inside the computer. Returns { ok, text }.
const HTTP_IN_COMPUTER = `
import sys, urllib.request, urllib.error
data = sys.stdin.buffer.read() or None
req = urllib.request.Request('http://127.0.0.1:%d' % int(sys.argv[3]) + sys.argv[1], data=data, headers={'Content-Type': 'application/json'})
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
// To the bot's own screen: its seat decides which computer-server answers.
const request = (seat, pathname, body, opts) => requestOn(screenPorts(seat), pathname, body, opts);
async function requestOn(s, pathname, body, { timeoutSeconds = 120 } = {}) {
  const { code, stdout, stderr } = await execPython(HTTP_IN_COMPUTER, [pathname, String(timeoutSeconds), String(s.api)], {
    input: body === undefined ? '' : JSON.stringify(body),
    timeout: (timeoutSeconds + 15) * 1000,
  });
  return { ok: code === 0, text: code === 0 ? stdout : (stdout || stderr).trim() };
}

// A raw connection to a bot's screen (its websockify), through the child's stdin and stdout.
const PIPE_IN_COMPUTER = `
import os, socket, sys, threading
s = socket.create_connection(('127.0.0.1', int(sys.argv[1])))
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
const screenPipe = (seat) => spawn('docker', ['exec', '-i', ACCOUNT, 'python3', '-c', PIPE_IN_COMPUTER, String(screenPorts(seat).novnc)], { stdio: ['pipe', 'pipe', 'ignore'] });

// Whether a screen's computer-server answers.
const screenUp = (s) => requestOn(s, '/status', undefined, { timeoutSeconds: 3 }).then((r) => r.ok, () => false);
async function waitReady(s, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await screenUp(s)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("The bot's screen did not start in time");
}

// A computer is on a network of its own (per-computer bridges keep computers apart) and starts
// with nothing running: `sleep` is its entrypoint, also after a stop or a restart of Docker. root sets its
// resolvers and firewall inside it, through a privileged `docker exec` with this fixed script, and only then is a
// bot's screen started (startScreen). It was given a quiet container's network before (botdot.network-version=1),
// which gVisor does not allow: there every sandbox has a network stack of its own (ADR 028).
const network = (name) => `${name}-network`;
// botdot's own ports on the computer's loopback: each screen's VNC, X display, noVNC, computer control and Camoufox
// bridge (screenPorts), and those of the one shared screen of before. They answer nobody outside. The rest of the
// network is the bots': the internet, the local network, and its own loopback for the programs they run there (a
// mail bridge, Tailscale's proxy on localhost:1055). At most 15 ports to a multiport rule, a range counting as two.
const PORTS = ['5911:5999', '6011:6099', '6111:6199', '8111:8199', '47211:47299', '8000', '6080', '5901', '6001', '47111'].join(',');
// The resolvers come as the script's arguments.
const RESOLVERS = `printf 'nameserver %s\\n' "$@" > /etc/resolv.conf\n`;
// The computer's Tailscale runs as root in userspace (#106) and would hand a tailnet connection on to the loopback,
// where botdot's ports listen: what root sends to them there is dropped, so with its shields down (a bot has sudo),
// or a `tailscale serve`, no tailnet device reaches them still. Nothing of botdot's reaches them as root. Docker's
// runtime may lack the owner match: the rest of the firewall is then set all the same, and the script says so.
const TAILNET_GUARD = `  "$tool" -A OUTPUT -o lo -p tcp -m owner --uid-owner 0 -m multiport --dports ${PORTS} -j DROP 2>/dev/null || guard=off\n`;
const GUARD_SAID = 'echo "tailnet-guard $guard"\n';
// runc: in and out, with conntrack.
function firewallRunc() {
  return `set -eu
${RESOLVERS}guard=on
rules() {
  tool="$1"
  "$tool" -P INPUT DROP
  "$tool" -P OUTPUT ACCEPT
  "$tool" -F INPUT
  "$tool" -F OUTPUT
${TAILNET_GUARD}  "$tool" -A INPUT -i lo -j ACCEPT
  "$tool" -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
}
rules iptables
rules ip6tables
${GUARD_SAID}`;
}
// gVisor: its iptables are legacy only and have no conntrack, state or TCP flag matches, so only what leaves is
// filtered. The loopback is open; from botdot's ports nothing leaves on another interface, so nobody outside reaches
// the computer's control or screen.
function firewallGvisor() {
  return `set -eu
${RESOLVERS}guard=on
for tool in iptables-legacy ip6tables-legacy; do
  "$tool" -P OUTPUT DROP
  "$tool" -F OUTPUT
${TAILNET_GUARD}  "$tool" -A OUTPUT -o lo -j ACCEPT
  "$tool" -A OUTPUT -p tcp -m multiport --sports ${PORTS} -j DROP
  "$tool" -A OUTPUT -j ACCEPT
done
${GUARD_SAID}`;
}
const firewall = (runtime) => (runtime === 'runsc' ? firewallGvisor : firewallRunc)();
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
const resolvers = async () => (await hasTailnet() ? [TAILNET_DNS, ...DNS.filter((d) => d !== TAILNET_DNS)] : DNS);
// The firewall is set by botdot's privileged `docker exec`; root in the computer, which every bot is through sudo,
// has Docker's default capabilities only, without NET_ADMIN, so it cannot change the firewall (ADR 035).
async function protect() {
  const runtime = await docker(['inspect', ACCOUNT, '--format', '{{.HostConfig.Runtime}}']);
  const said = await docker(['exec', '--privileged', '-u', 'root', ACCOUNT, 'sh', '-c', firewall(runtime), 'sh', ...await resolvers()]);
  if (/tailnet-guard off/.test(said)) console.warn("[computers] this Docker runtime has no owner match: with its shields down, the computer's Tailscale could reach botdot's ports");
}
// A bot's screen: its desktop and cua's services on its display and ports, as box, in a supervisord of its own
// (deploy/desktop/botdot-screen.conf), with the bot's folder as the computer-server's working folder, so run_shell
// starts there. Then its screen is kept awake, and its browser's bridge is started, as on every ensure.
async function startScreen(s) {
  if (!(await screenUp(s))) {
    // What is left of an earlier start of this screen ends first, so that no second desktop runs beside the new one.
    await docker(['exec', '-u', 'root', ACCOUNT, 'sh', '-c', REST_SCREEN, 'sh', String(s.n), s.bot], { timeout: 30_000 });
    await docker(['exec', '-u', USER, ACCOUNT, 'mkdir', '-p', s.workdir]);
    await docker(['exec', '-d', '-u', USER, '-e', `HOME=${HOME}`, '-e', `TZ=${timeZone()}`,
      '-e', `SCREEN=${s.n}`, '-e', `SCREEN_DISPLAY=${s.display}`, '-e', `VNC_PORT=${s.vnc}`, '-e', `NOVNC_PORT=${s.novnc}`,
      '-e', `API_PORT=${s.api}`, '-e', `WORKDIR=${s.workdir}`, ACCOUNT,
      ...reaped(['/usr/bin/supervisord', '-n', '-c', SCREEN_CONF], { screen: s.n })]);
    await waitReady(s);
    await keepScreenAwake(s);
  }
  await startBrowserBridge(s);
}
// As botdot starts: the bots' old computers of their own are stopped and kept (#104), with their files, and come
// back by themselves no more. The account's computer is kept on by bots.keepAlwaysOn, which goes through ensure.
function watch(mine) {
  Promise.resolve().then(async () => {
    for (const id of mine()) {
      const name = oldName(id);
      if ((await inspectName(name)).state === 'none') continue;
      await restartOff(name);
      await docker(['stop', '-t', '5', name]).catch(() => {});
    }
    listed = null;
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
    await docker(['rename', name, oldName(bot)]).then(() => taken.push(bot), (e) => console.error(`[computers] ${name}: ${e.message}`));
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
    // A desktop made before the account's computer has no user box to run it as: build or pull it again.
    if (await docker(['image', 'inspect', IMAGE, '--format', '{{index .Config.Labels "botdot.user-version"}}']).catch(() => null) === USER_VERSION) return;
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

// ---------- the account's computer ----------

let starting = null; // the start under way, whichever bot asked for it
let changing = null; // an update or a reset of the account's computer under way (#107): a start waits for it
let startError = null; // { at, message }: why the last start failed, until one succeeds (#59)
const failed = (e) => { startError = { at: new Date().toISOString(), message: String(e.message).slice(0, 4000) }; throw e; };
// The helper owns the start: one at a time, and a start asked for while one runs, by any bot, is that one.
function ensureComputer() {
  if (starting) return starting;
  const p = Promise.resolve(changing).catch(() => {})
    .then(async () => {
      await startComputer();
      startError = null;
    })
    .catch(failed)
    .finally(() => { if (starting === p) starting = null; });
  starting = p;
  return p;
}
// The account's computer, and with a seat the bot's own screen on it (#105): one start of a screen at a time.
const screenStarts = new Map(); // display number -> the start under way
function ensure(seat) {
  if (seat === undefined) return ensureComputer();
  let s;
  try { s = screenPorts(seat); } catch (e) { return Promise.reject(e); }
  return ensureComputer().then(() => {
    if (!screenStarts.has(s.n)) screenStarts.set(s.n, startScreen(s).catch(failed).finally(() => screenStarts.delete(s.n)));
    return screenStarts.get(s.n);
  });
}

async function startComputer() {
  const st = await dockerStatus(true);
  if (!st.ok) throw new Error(`${st.error}. The bots' computer needs Docker.`);
  // The computer is always kept, even if bot-dot's desktop image has changed since it was made: it holds whatever
  // the bots or you installed. details() reports when a newer desktop exists. So the desktop is downloaded only for a
  // computer about to be made: one that is kept runs on its own image, and a newer one waits for its Update (#191).
  const info = await inspect();
  if (info.state === 'none') await ensureImage();
  if (info.state !== 'none') {
    await restartOff(ACCOUNT);
    if (!isCurrent(await labels())) {
      await docker(['stop', '-t', '5', ACCOUNT]).catch(() => {});
      throw new Error("This computer is older than botdot's account computer and is kept but stopped. Export its files and reset it.");
    }
  }
  if (info.state === 'none') {
    await docker(['network', 'inspect', network(ACCOUNT)]).catch(() => docker(['network', 'create', '--label', 'botdot.network=account', ...OWN, network(ACCOUNT)]));
    await makeVolumes();
    // Docker's default capabilities, without --cap-drop ALL or no-new-privileges: sudo and apt need them (ADR 035).
    // Still under the account's Docker runtime (gVisor), on a network of its own, and never privileged. A new volume
    // starts with what the desktop has in its folder; one in use already keeps what it holds (#107).
    const make = (sized, init) => docker([
      'run', '-d', '--name', ACCOUNT,
      '--label', 'botdot.computer=account', ...OWN, '--label', 'cua.sandbox=true', '--label', `botdot.network-version=${NETWORK_VERSION}`, '--label', `botdot.user-version=${USER_VERSION}`,
      '--network', network(ACCOUNT),
      ...VOLUMES.flatMap(([volume, dir]) => ['-v', `${volume}:${dir}`]),
      '--user', USER, '-e', `HOME=${HOME}`,
      // No healthcheck: the desktop image's asks the control API on port 8000, and each bot's screen has its own
      // (screenPorts), so it said unhealthy while every screen answered (#125). botdot asks each screen itself.
      '--no-healthcheck',
      ...sized, '--shm-size', '1g', '-e', `TZ=${timeZone()}`,
      // Docker's init is PID 1 and reaps every process whose parent died (#535): `sleep` alone never did, and a
      // computer up for days held more than a thousand of them. A computer made before keeps its `sleep` until its
      // next Update; botdot-run reaps what botdot's commands start on it meanwhile (reaped).
      ...(init ? ['--init'] : []),
      '--entrypoint', 'sleep', IMAGE, 'infinity',
    ], { timeout: 15 * 60_000 }); // first run may pull the image
    let sized = limits();
    let init = true;
    for (;;) {
      try {
        await make(sized, init);
        break;
      } catch (e) {
        // A Docker without the cgroup controllers refuses the limits (a rootless one without systemd's): the computer
        // is made without them, and the account's share on its unit still holds everything it runs.
        if (sized.length && LIMITS_REFUSED.test(e.message)) {
          console.warn(`[computers] Docker refused the share's limits for the account's computer, so it runs without them: ${e.message}`);
          sized = [];
        } else if (init && INIT_REFUSED.test(e.message)) {
          console.warn(`[computers] Docker has no init for the account's computer, so botdot-run alone reaps what its commands leave: ${e.message}`);
          init = false;
        } else throw e;
        await docker(['rm', '-f', ACCOUNT]).catch(() => {});
      }
    }
  } else if (info.state === 'stopped') {
    // Sized by the share as it is now. gVisor takes no `docker update` of a running computer, so a changed share
    // waits for this. One that fails keeps the limits it had.
    const now = limits();
    if (now.length) await docker(['update', ...now, ACCOUNT]).catch(() => {});
    await docker(['start', ACCOUNT]);
  }
  try { await protect(); } catch (e) { await docker(['stop', '-t', '5', ACCOUNT]).catch(() => {}); throw new Error(`Could not secure the computer: ${e.message}`); }
  // The computer has no screen of its own: each bot's starts on its first computer tool (ensure, #105).
  await syncScripts();
  if (info.state !== 'running') await resumeTailnet();
  await setTimeZone();
}

// Copy the current browser launcher, botdot-tailscale and what starts a bot's screen in, so existing computers get
// updates without a reset (a bridge or screen already running keeps its own until it stops). They are root's, which
// every bot is through sudo (ADR 035): the copy brings botdot's own back at each start, nothing more. A failed copy
// stops the start instead of starting a bridge from an older launcher. Root writes it from stdin next to the old one,
// in its own folder and not /tmp, and renames it over the old one, whoever owns that.
const SCRIPTS = {
  'camoufox-browser': ['browser', '/usr/local/bin', '755'],
  'botdot-tailscale': ['Tailscale program', '/usr/local/bin', '755'],
  'botdot-desktop': ['desktop', '/usr/local/bin', '755'],
  'botdot-screen.conf': ['screens', '/etc/supervisor', '644'],
};
async function syncScripts() {
  for (const [f, [what, dir, mode]] of Object.entries(SCRIPTS)) {
    const to = `${dir}/${f}`;
    const next = `${dir}/.${f}.new`;
    try {
      await dockerInput(['exec', '-i', '-u', 'root', ACCOUNT, 'sh', '-c',
        `rm -f ${next} && cat > ${next} && chmod ${mode} ${next} && mv -f ${next} ${to}`], await fs.promises.readFile(path.join(BUILD_DIR, f)));
    } catch (e) {
      throw new Error(`Could not copy botdot's ${what} into the computer: ${e.message}`);
    }
  }
}

// The account's computer, once on the owner's tailnet, comes back on it as it starts: one device for the whole
// computer, run by root (#106). botdot-tailscale resume starts Tailscale only when its saved state holds a login, so it
// never asks for a new one (#68), and puts its shields back up. A bot's own Tailscale in box's home, from before, is
// not carried over. Without it the computer still starts; a bot can run botdot-tailscale up itself.
async function resumeTailnet() {
  await docker(['exec', '-u', 'root', ACCOUNT, '/usr/local/bin/botdot-tailscale', 'resume'], { timeout: 30_000 })
    .catch((e) => console.warn(`[computers] Tailscale did not come back: ${e.message}`));
}

// Computers made before this (or before the time zone changed) run on another zone. Set the system
// zone, which the shell and newly started programs read, and close a browser still on the old one.
// The browser user ends the browser and its bridge, which holds the old zone, and waits for the bridge to go: startBrowserBridge starts it
// again with the new zone.
const CLOSE_BROWSER = 'pkill -f "camoufox-[b]"; for _ in $(seq 1 25); do pgrep -f "camoufox-[b]rowser --serve" >/dev/null || exit 0; sleep 0.2; done';
async function setTimeZone() {
  const script = '[ -f "/usr/share/zoneinfo/$1" ] || exit 0; [ "$(cat /etc/timezone 2>/dev/null)" = "$1" ] && exit 0; '
    + 'ln -sf "/usr/share/zoneinfo/$1" /etc/localtime && echo "$1" > /etc/timezone && echo changed; true';
  const changed = await docker(['exec', '-u', 'root', ACCOUNT, 'sh', '-c', script, 'sh', timeZone()]).catch(() => '');
  if (changed === 'changed') await docker(['exec', '-u', BROWSER_USER, ACCOUNT, 'sh', '-c', CLOSE_BROWSER]).catch(() => {});
}

// botdot's bridge into the Camoufox of a bot's screen (deploy/desktop/camoufox-browser --serve <display> <bot>), as
// the browser user: one per screen, with the bot's own profile (#105). It opens the browser when the bot asks for it
// and takes botdot's secrets on a socket of the screen's own (screenPorts) that only that user can open. A second
// start while one runs ends by itself. The launcher writes what it and Camoufox print to the screen's log, in the
// browser user's home, which a bot cannot read without sudo: `docker exec -u browser <computer> tail
// /home/browser/bridge-<display>.log`. It keeps the latest 1 MiB at most, and the previous start's in
// bridge-<display>.log.1 beside it (#355).
async function startBrowserBridge(s) {
  await docker(['exec', '-d', '-u', BROWSER_USER, '-w', '/', '-e', `HOME=/home/${BROWSER_USER}`, '-e', `DISPLAY=${s.display}`,
    '-e', `TZ=${timeZone()}`, '-e', `XDG_CACHE_HOME=${CAMOUFOX_CACHE}`, ACCOUNT,
    ...reaped(['/usr/local/bin/camoufox-browser', '--serve', s.display, s.bot], { screen: s.n })]);
}

// The desktop blanks its screen after 10 idle minutes; turn that off (it resets on every start).
async function keepScreenAwake(s) {
  await docker(['exec', '-e', `DISPLAY=${s.display}`, ACCOUNT, 'sh', '-c', 'xset s off; xset s noblank; xset -dpms 2>/dev/null; true']).catch(() => {});
}

// The account's computer is kept on by botdot (bots.keepAlwaysOn), not by Docker's restart policy: a computer that came
// back by itself would run without its firewall until botdot set it.
async function setRestartPolicy() {
  if ((await inspect()).state === 'none') return;
  await restartOff(ACCOUNT);
}

// A computer comes back only when botdot starts it. Most already don't come back by themselves, and are left as
// they are: gVisor fails `docker update` on a running computer (runsc panics), which used to fail every run's start
// of a computer that ran fine. A computer made before that is set not to, and if that fails, it still starts.
async function restartOff(name) {
  const policy = await docker(['inspect', name, '--format', '{{.HostConfig.RestartPolicy.Name}}']).catch(() => '');
  if (policy === 'no' || policy === '') return;
  await docker(['update', '--restart', 'no', name])
    .catch((e) => console.warn(`[computers] ${name}: couldn't turn off its restart policy: ${e.message}`));
}

// A bot is done with the computer (its run ended, the owner turned "its" computer off): the account's computer stays
// on for the other bots and for the next run (#104). Nothing to do.
async function stop() {}

// Whether a bot's screen is on (#105): 'running', 'off' (the computer is on, the bot has not used its screen since),
// or the computer's own state when that is not running.
async function screenState(seat) {
  const s = screenPorts(seat);
  const { state } = await inspect();
  if (state !== 'running') return { state };
  return { state: await screenUp(s) ? 'running' : 'off' };
}

// A deleted bot's screen ends (#105): its supervisord and what it started, its X server, its browser's bridge and
// Camoufox, and its browser profile is removed, so a bot given its number later starts clean. Its folder in /workspace
// stays. Nothing to do when the computer is off: its screens ended with it.
// Then botdot-run of each that ran for the screen (its supervisord, its bridge, the programs start_program started)
// ends all those started, and what is still left with SCREEN=<n> in its environment, which the screen's programs and
// start_program's inherit, is killed (#535). A bot's commands carry only its DISPLAY, and go on.
const SCREEN_RUNS = '"botdot-[r]un (--keep )?--screen $n --"';
const STOP_SCREEN = [
  'n="$1"; bot="$2"',
  'pid=$(cat "/run/botdot-desktop/screen-$n.pid" 2>/dev/null) && kill "$pid" 2>/dev/null',
  'pkill -f "camoufox-[b]rowser --serve :$n $bot\\$"',
  'pkill -u browser -f "/home/browser/profiles/$bot( |/|\\$)"',
  'pkill -f "X[a-z]*vnc :$n( |\\$)"',
  'sleep 1',
  `pkill -f ${SCREEN_RUNS}`,
  // botdot-run takes up to three times its 2 s grace: the command's end, then SIGTERM, then SIGKILL.
  `for _ in $(seq 1 50); do pgrep -f ${SCREEN_RUNS} >/dev/null || break; sleep 0.2; done`,
  'for f in $(grep -lzx "SCREEN=$n" /proc/[0-9]*/environ 2>/dev/null); do p="${f#/proc/}"; kill -9 "${p%/environ}" 2>/dev/null; done',
  'true',
];
const END_SCREEN = [...STOP_SCREEN, 'rm -rf "/home/browser/profiles/$bot" "/run/botdot-browser/bridge-$n.sock"'].join('\n');
// A screen unused for a while ends the same way (#126, lib/computer-screens.js restIdle), and keeps its browser
// profile: its next computer tool starts it again, signed in where it was.
const REST_SCREEN = [...STOP_SCREEN, 'rm -f "/run/botdot-browser/bridge-$n.sock"'].join('\n');
async function freeScreen(seat) {
  const s = screenPorts(seat);
  if ((await inspect()).state !== 'running') return;
  await docker(['exec', '-u', 'root', ACCOUNT, 'sh', '-c', END_SCREEN, 'sh', String(s.n), s.bot], { timeout: 30_000 });
}
async function restScreen(seat) {
  const s = screenPorts(seat);
  if ((await inspect()).state !== 'running') return;
  await docker(['exec', '-u', 'root', ACCOUNT, 'sh', '-c', REST_SCREEN, 'sh', String(s.n), s.bot], { timeout: 30_000 });
}

// Erase the bot's old computer of its own (#104), when it is reset or the bot deleted: never the account's computer,
// which holds every other bot's work. Returns 'erased' | 'none' | 'failed'.
async function reset(botId) {
  const name = oldName(botId);
  try {
    if ((await inspectName(name)).state === 'none') return 'none';
    await docker(['rm', '-f', name]);
    await docker(['rm', '-f', network(name)]).catch(() => {}); // a computer's quiet container, before version 2
    await docker(['network', 'rm', network(name)]).catch(() => {});
    // A computer taken over from before #19 kept the network of its old name.
    if (SCOPE) await docker(['network', 'rm', `botdot-${botId}-network`]).catch(() => {});
    return 'erased';
  } catch {
    return 'failed';
  } finally { listed = null; }
}

// ---------- what survives, a reset and an update of the account's computer (#107) ----------

async function makeVolumes() {
  for (const [volume] of VOLUMES) await docker(['volume', 'create', '--label', 'botdot.volume=account', ...OWN, volume]);
}
// Whether the computer has its folders on the volumes: one made before #107 has them in itself.
async function hasVolumes() {
  const names = (await docker(['inspect', ACCOUNT, '--format', '{{range .Mounts}}{{.Name}} {{end}}'])).split(/\s+/);
  return VOLUMES.every(([volume]) => names.includes(volume));
}

// One docker's output streamed into another's input (`docker cp … -` into a tar), without a shell and without
// holding the files: resolves when both ended well, else fails with what they said.
function pipeDocker(fromArgs, toArgs, timeout = 30 * 60_000) {
  return new Promise((resolve, reject) => {
    let said = '';
    let left = 2;
    let bad = null;
    const from = spawn('docker', fromArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const to = spawn('docker', toArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { bad = bad || 'it took too long'; from.kill(); to.kill(); }, timeout);
    const end = (why) => {
      if (why && !bad) bad = why;
      if (--left > 0) return;
      clearTimeout(timer);
      if (bad) reject(Object.assign(new Error(said.trim().split('\n').pop() || bad), { said })); else resolve();
    };
    for (const child of [from, to]) {
      child.stderr?.on('data', (d) => { said = `${said}${d}`.slice(-2000); });
      let ended = false;
      const once = (why) => { if (!ended) { ended = true; end(why); } };
      child.on('error', (e) => { once(e.message); });
      child.on('close', (code) => once(code === 0 ? null : `docker ended with ${code}`));
    }
    to.stdin.on('error', () => {});
    from.stdout.pipe(to.stdin);
  });
}

// A computer made before #107: its three folders are copied onto the volumes, stopped, each at its own place, so the
// folder keeps its owner and mode (/home/box stays box's). A volume new to it starts with the desktop's folder, and
// what the computer held is laid over that.
// The Tailscale folder is not in the desktop: a computer that never joined the tailnet has none, and nothing to copy.
async function toVolumes() {
  await makeVolumes();
  for (const [volume, dir] of VOLUMES) {
    await pipeDocker(['cp', `${ACCOUNT}:${dir}`, '-'],
      ['run', '--rm', '-i', '--network', 'none', '-u', 'root', '-v', `${volume}:${dir}`, '--entrypoint', 'tar', IMAGE, '-x', '-C', path.posix.dirname(dir)])
      .catch((e) => { if (!(dir === TAILSCALE_DIR && /Could not find the file/.test(e.said))) throw e; });
  }
}

// An update or a reset waits for a start under way, and a start asked for meanwhile waits for it.
async function exclusively(fn) {
  while (changing) await changing.catch(() => {});
  if (starting) await starting.catch(() => {});
  const p = fn();
  changing = p;
  try { return await p; } finally { if (changing === p) changing = null; }
}

// The account's computer made again from the desktop botdot has now (details' `outdated`), for every bot: /home/box,
// /workspace and the browsers' logins stay on their volumes, what apt installed goes with the old one (#107).
// Returns 'updated', or 'none' when it was never made. A computer without the volumes has its folders copied onto
// them first; should that fail, nothing is erased.
function updateAll() {
  return exclusively(async () => {
    if ((await inspect()).state === 'none') return 'none';
    await ensureImage();
    await docker(['stop', '-t', '10', ACCOUNT]).catch(() => {});
    if (!(await hasVolumes())) {
      try { await toVolumes(); } catch (e) { throw new Error(`Couldn't keep its files, so nothing was changed: ${e.message}`); }
    }
    await docker(['rm', '-f', ACCOUNT]);
    try { await startComputer(); startError = null; } catch (e) { failed(e); }
    return 'updated';
  });
}

// The account's computer off and on again, for every bot (#109): what runs on it ends, every screen with it, and
// what is on it is kept. A bot's screen starts again with its next computer tool. Returns 'restarted', or 'none' when
// it was never made (nothing is made then).
function restartAll() {
  return exclusively(async () => {
    if ((await inspect()).state === 'none') return 'none';
    await docker(['stop', '-t', '10', ACCOUNT]).catch(() => {});
    try { await startComputer(); startError = null; } catch (e) { failed(e); }
    return 'restarted';
  });
}

// The account's computer erased for every bot (#107): the computer, its volumes and so its files, its logins and
// all that was installed. The next computer tool of any bot makes it again, fresh. A bot's old computer of its own is
// not touched. Returns 'erased', or 'none' when there was no computer (its volumes go all the same).
function resetAll() {
  return exclusively(async () => {
    const had = (await inspect()).state !== 'none';
    if (had) await docker(['rm', '-f', ACCOUNT]);
    await docker(['volume', 'rm', '-f', ...VOLUMES.map(([volume]) => volume)]);
    startError = null;
    return had ? 'erased' : 'none';
  });
}

// A bot's old computer of its own, kept and stopped (#104): its home is copied into its folder on the account's
// computer, /workspace/<bot>/old-computer, as box (#107). The old one stays as it is, until the owner erases it
// (reset). Returns { copied: the folder }, or null when the bot has no old computer.
const EXTRACT = 'mkdir -p "$1" && tar -x --no-same-owner --strip-components=1 -C "$1"';
async function copyOld(botId) {
  const name = oldName(botId);
  if ((await inspectName(name)).state === 'none') return null;
  await ensureComputer();
  const to = oldCopy(botId);
  try {
    await pipeDocker(['cp', `${name}:${OLD_HOME}`, '-'], ['exec', '-i', '-u', USER, ACCOUNT, 'sh', '-c', EXTRACT, 'sh', to]);
  } catch (e) {
    throw new Error(`Couldn't copy the files of its old computer: ${e.message}`);
  }
  return { copied: to };
}

let latest = { at: 0, id: null };
async function currentImageId() {
  if (Date.now() - latest.at < 30_000) return latest.id;
  const id = await docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}']).catch(() => null);
  latest = { at: Date.now(), id };
  return id;
}

// State of a bot's computer for the screen view, incl. whether a newer desktop is available, and `old`, the state of
// the bot's old computer of its own when it still has one (#107).
async function details(botId) {
  const old = botId ? (await inspectName(oldName(botId))).state : 'none';
  const more = old === 'none' ? {} : { old };
  const info = await inspect();
  if (info.state === 'none') return { state: 'none', ...more };
  const current = await currentImageId();
  const outdated = info.image !== IMAGE || (!!current && !!info.imageId && info.imageId !== current);
  const size = await docker(['inspect', '--size', ACCOUNT, '--format', '{{.SizeRw}}']).catch(() => null);
  return { state: info.state, outdated, diskBytes: size ? Number(size) : null, ...more };
}

// What the Chief reads when a bot's computer misbehaves (#59): Docker's state of it, and why its last start failed.
async function health(botId) {
  const more = { lastStartError: startError };
  let out;
  try {
    out = await docker(['inspect', ACCOUNT, '--format', '{{json .RestartCount}}|{{json .State}}']);
  } catch (e) {
    if (/No such (object|container)/i.test(e.message)) return { state: 'none', ...more };
    throw e; // Docker itself didn't answer: not a computer that was never made
  }
  const at = out.indexOf('|'); // Docker's error in .State may hold a "|" too
  const restarts = out.slice(0, at);
  const st = JSON.parse(out.slice(at + 1));
  return {
    state: st.Status === 'running' ? 'running' : 'stopped', status: st.Status, exitCode: st.ExitCode, error: st.Error || '',
    oomKilled: !!st.OOMKilled, startedAt: st.StartedAt, finishedAt: st.FinishedAt, restartCount: Number(restarts) || 0, ...more,
  };
}

// What each bot's screen uses of the account's computer (#109): botdot's own copy of deploy/desktop/botdot-usage, run
// as root from / in Python's isolated mode, counts the memory and CPU of each screen's processes over half a second.
// Returns { state, screens: [{ screen, memoryBytes, cpuPercent, processes }], other }, `other` what runs on no bot's
// screen, with its `zombies` and `top` groups; or { state } alone when the computer is not running.
const USAGE = path.join(BUILD_DIR, 'botdot-usage');
async function usage() {
  const { state } = await inspect();
  if (state !== 'running') return { state };
  const script = await fs.promises.readFile(USAGE, 'utf8');
  const said = JSON.parse(await docker(['exec', '-u', 'root', '-w', '/', ACCOUNT, '/usr/bin/python3', '-I', '-c', script, '/proc', '0.5'], { timeout: 30_000 }));
  const count = (u) => ({ memoryBytes: Number(u?.memoryBytes) || 0, cpuPercent: Number(u?.cpuPercent) || 0, processes: Number(u?.processes) || 0 });
  const screens = Object.entries(said.screens || {})
    .map(([n, u]) => ({ screen: Number(n) - 10, ...count(u) }))
    .filter(({ screen }) => Number.isInteger(screen) && screen >= 1 && screen <= MAX_SCREENS)
    .sort((a, b) => a.screen - b.screen);
  // Of "other", its zombies and its largest groups of processes too (#535): names as the computer gave them, cut short.
  const name = (v) => String(v ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, 64);
  const top = (Array.isArray(said.other?.top) ? said.other.top : []).slice(0, 5)
    .map((g) => ({ name: name(g?.name), parent: name(g?.parent), processes: Number(g?.processes) || 0, cpuPercent: Number(g?.cpuPercent) || 0 }));
  return { state, screens, other: { ...count(said.other), zombies: Number(said.other?.zombies) || 0, top } };
}

// Its recent logs: the container's own (its first program only waits, so there is little), and the desktop's of the
// bot's own screen (its supervisord, which starts the screen and its programs), the last `lines` of each. Not the
// browser bridge's, which may hold what botdot typed. A bot without a screen yet (seat null) has no desktop logs.
const LOG_CHARS = 16_000;
async function logs(seat, lines = 100) {
  const s = seat === null ? null : screenPorts(seat);
  const n = String(Math.max(1, Math.min(500, Math.floor(lines) || 100)));
  const { state } = await inspect();
  if (state === 'none') return { state, container: '', desktop: '' };
  const tail = (text) => String(text).slice(-LOG_CHARS);
  const container = await run('docker', ['logs', '--tail', n, '--timestamps', ACCOUNT], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })
    .then(({ stdout, stderr }) => tail(`${stdout}${stderr}`), (e) => `Couldn't read them: ${e.message}`);
  const desktop = state !== 'running' || !s ? '' : await docker(['exec', '-u', 'root', ACCOUNT, 'tail', '-n', n, `/var/log/supervisor/screen-${s.n}.log`], { timeout: 30_000 })
    .then(tail, (e) => `Couldn't read them: ${e.message}`);
  return { state, container, desktop };
}

// The helper that hands a secret to the bridge is botdot's own copy, sent with every call and run as the browser
// user from /, in Python's isolated mode: no file of the computer stands between botdot and the browser, so there
// is nothing to check or race (#311). It keeps a program of the bots that does not use sudo from taking the secret;
// one that uses sudo can read it in the browser or replace the Python it runs on (ADR 035). A computer older than
// the account's computer gets no secret at all. It goes to the bridge of the bot's own screen (#105), on that
// screen's socket, and the helper still checks the browser user answers there.
// The browser tools (#170) take the same way to the same bridge, which runs them on its browser's thread.
const TYPE_SECRET = path.join(BUILD_DIR, 'botdot-type-secret');
const typeSecret = (seat, payload) => askBridge(seat, payload, "This computer is older than botdot's safe typing of saved logins. Ask the owner to export its files and reset it.");
const browserTool = (seat, payload) => askBridge(seat, payload, "This computer is older than botdot's browser tools. Use screenshots, or ask the owner to export its files and reset it.");
async function askBridge(seat, payload, older) {
  const s = screenPorts(seat);
  let helper;
  try {
    helper = await fs.promises.readFile(TYPE_SECRET, 'utf8');
    if (!isCurrent(await labels())) return { ok: false, error: older };
  } catch {
    return { ok: false, error: "Couldn't reach the bot's browser." };
  }
  return new Promise((resolve) => {
    const child = execFile('docker', ['exec', '-i', '-u', BROWSER_USER, '-w', '/', ACCOUNT, '/usr/bin/python3', '-I', '-c', helper, s.socket], { timeout: 60_000 }, (err, stdout) => {
      if (err && !stdout) return resolve({ ok: false, error: "Couldn't reach the bot's browser." });
      try { resolve(JSON.parse(String(stdout).trim().split('\n').pop())); } catch { resolve({ ok: false, error: 'The browser gave an unexpected answer.' }); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}
// botdot's own copy of deploy/desktop/botdot-run around a command, sent with every call: what the command starts is
// reaped as it ends and ended with it, or with `keep` when nothing it started runs any more (#535). `screen`, a display's
// number, lets the end of that screen find it.
const REAPER = fs.readFileSync(path.join(BUILD_DIR, 'botdot-run'), 'utf8');
const reaped = (argv, { keep = false, screen } = {}) => ['/usr/bin/python3', '-I', '-c', REAPER, 'botdot-run',
  ...(keep ? ['--keep'] : []), ...(screen ? ['--screen', String(screen)] : []), '--', ...argv];
// A command of the bot's runs in its own folder, /workspace/<bot> (#105), made again if it is gone; `sh -c` then runs
// it as it always did. The folder is a convention: nothing stops a bot from reading another's.
// Each command first puts the bot's git identity where its GIT_CONFIG_SYSTEM says, when it changed (gitIdentity).
const IN_OWN_FOLDER = '[ -z "$BOTDOT_GIT" ] || [ "$(cat "$GIT_CONFIG_SYSTEM" 2>/dev/null)" = "$BOTDOT_GIT" ] || { mkdir -p "${GIT_CONFIG_SYSTEM%/*}" && printf \'%s\n\' "$BOTDOT_GIT" > "$GIT_CONFIG_SYSTEM.$$" && mv -f "$GIT_CONFIG_SYSTEM.$$" "$GIT_CONFIG_SYSTEM"; } 2>/dev/null; unset BOTDOT_GIT; '
  + 'mkdir -p "$1" 2>/dev/null; cd "$1" 2>/dev/null; exec sh -c "$2"';
// The bot's git identity on the computer (lib/workspace-git.js): every bot is box there and shares /home/box, so it is
// a file of the bot's own at git's lowest level, and what a bot or a repository sets wins.
const gitIdentity = (s) => ['-e', `GIT_CONFIG_SYSTEM=${workspaceGit.computerIdentityFile(s.bot)}`, '-e', `BOTDOT_GIT=${workspaceGit.identityConfig(s.bot, s.name).trimEnd()}`];
// A program on the bot's own screen, detached, in its own folder. It and what it starts carry the screen in SCREEN, and
// end with the screen (STOP_SCREEN, #535).
async function startProgram(seat, command) {
  const s = screenPorts(seat);
  await docker(['exec', '-d', '-u', USER, '-e', `DISPLAY=${s.display}`, '-e', `SCREEN=${s.n}`, '-e', `HOME=${HOME}`, '-e', `TZ=${timeZone()}`, ...gitIdentity(s), ACCOUNT,
    ...reaped(['sh', '-c', IN_OWN_FOLDER, 'sh', s.workdir, command], { keep: true, screen: s.n })], { timeout: 20_000 });
}

// run_with_login: one command as the bot user, with a saved login in BOTDOT_USERNAME and BOTDOT_PASSWORD. The values
// are in the docker CLI's own environment, and `-e NAME` without a value passes them on, so they are never on a
// command line in the host's process list; nothing is written to a file. `timeout` inside the computer ends the
// command (docker stopping on its side would leave it running there). Resolves to { code, stdout, stderr, timedOut }.
const RUN_MAX_SECONDS = 600;
const RUN_MAX_BUFFER = 2 * 1024 * 1024;
const runSeconds = (timeoutSeconds) => Math.min(Math.max(Math.round(Number(timeoutSeconds) || 120), 1), RUN_MAX_SECONDS);
// With several logins (#228) `env` holds each one's BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD in their place.
function runWithLogin(seat, { command, username = '', password = '', env, timeoutSeconds = 120 }) {
  const vars = env || { BOTDOT_USERNAME: String(username), BOTDOT_PASSWORD: String(password) };
  return runAsBot(screenPorts(seat), command, runSeconds(timeoutSeconds), Object.keys(vars).flatMap((name) => ['-e', name]), vars);
}
// run_shell, read_file and write_file (#134): as box in the bot's own folder, with `docker exec` and no screen, so a bot
// that only runs commands starts no desktop. DISPLAY still names its screen, for a program that wants it while it is on.
function runShell(seat, { command, timeoutSeconds = 120 }) {
  return runAsBot(screenPorts(seat), command, runSeconds(timeoutSeconds));
}
// A path relative to the bot's folder, as the computer-server's read_text and write_text took it. At most 1 MB is read.
const FILE_MAX_BYTES = 1024 * 1024;
const READ_FILE = `cd "$1" 2>/dev/null; exec head -c ${FILE_MAX_BYTES} -- "$2"`;
const WRITE_FILE = 'mkdir -p "$1" 2>/dev/null; cd "$1" 2>/dev/null; exec cat > "$2"';
function readFile(seat, { path: file }) {
  const s = screenPorts(seat);
  return execAsBot(['sh', '-c', READ_FILE, 'sh', s.workdir, file], 60, s);
}
function writeFile(seat, { path: file, content }) {
  const s = screenPorts(seat);
  return execAsBot(['sh', '-c', WRITE_FILE, 'sh', s.workdir, file], 60, s, { input: content });
}
// The bridge between the bot's workspace on botdot and its computer (#545). bringOut runs a fixed script of botdot's
// (file-view.js computerScript) that prints a file of the bot's whole, in base64, up to 25 MB. listUploads names
// what is in uploads/ of its folder there; putUpload writes one of its files there, under its saved name, whole or
// not at all.
const BRING_MAX_BUFFER = 36 * 1024 * 1024; // 25 MB in base64, and its first line
function bringOut(seat, { script }) {
  return execAsBot(['sh', '-c', script], 120, screenPorts(seat), { maxBuffer: BRING_MAX_BUFFER });
}
const LIST_UPLOADS = 'ls -1A -- "$1/uploads" 2>/dev/null; exit 0';
const PUT_UPLOAD = 'mkdir -p "$1/uploads" && cd "$1/uploads" && cat > ".$2.part" && mv -f ".$2.part" "$2"';
function listUploads(seat) {
  const s = screenPorts(seat);
  return execAsBot(['sh', '-c', LIST_UPLOADS, 'sh', s.workdir], 30, s);
}
function putUpload(seat, { name, data }) {
  const s = screenPorts(seat);
  return execAsBot(['sh', '-c', PUT_UPLOAD, 'sh', s.workdir, name], 120, s, { input: data });
}
// publish_interactive_page (#399): a folder of the bot's, relative to its own folder, as a tar of plain files (ustar,
// so no name is longer than it can say), made by box: what box can't read is not in it. At most PACK_MAX_BYTES come
// out; lib/sites.js reads and checks the rest. Resolves { code, tar (base64), stderr, error }.
const PACK_MAX_BYTES = 8 * 1024 * 1024;
const PACK = 'cd "$1" 2>/dev/null || exit 2; [ -d "$2" ] || { echo "$2 is not a folder on your computer" >&2; exit 2; }; exec tar --format=ustar -cf - -C "$2" .';
function packFolder(seat, { path: dir }) {
  const s = screenPorts(seat);
  const args = ['exec', '-u', USER, '-e', `HOME=${HOME}`, ACCOUNT, 'timeout', '-k', '5', '120', 'sh', '-c', PACK, 'sh', s.workdir, dir];
  return new Promise((resolve) => {
    execFile('docker', args, { timeout: 150_000, maxBuffer: PACK_MAX_BYTES, encoding: 'buffer' }, (err, stdout, stderr) => {
      const said = String(stderr || '').trim().slice(-500);
      if (!err) return resolve({ code: 0, tar: Buffer.from(stdout).toString('base64'), stderr: said });
      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ code: null, tar: '', stderr: '', error: 'the folder is too large for a page (over 5 MB)' });
      resolve({ code: typeof err.code === 'number' ? err.code : null, tar: '', stderr: said, error: typeof err.code === 'number' ? null : "couldn't read the folder from the computer" });
    });
  });
}

// start_interactive_page (#400): a template of the site kit (lib/site-kit.js), a tar made by botdot, unpacked by box into
// a new folder of the bot's, relative to its own folder. A folder that holds anything already is left as it is.
// Resolves like readFile.
const UNPACK = 'cd "$1" 2>/dev/null || exit 2; if [ -e "$2" ] && [ -n "$(ls -A -- "$2" 2>/dev/null)" ]; then echo "$2 is not empty: give a new folder" >&2; exit 3; fi; '
  + 'mkdir -p -- "$2" && exec tar -xf - -C "$2" --no-same-owner --no-same-permissions';
function unpackFolder(seat, { path: dir, tar }) {
  const s = screenPorts(seat);
  return execAsBot(['sh', '-c', UNPACK, 'sh', s.workdir, dir], 60, s, { input: Buffer.from(tar, 'base64') });
}

// A bot's folder copied to or from its machine on boat.dev (#556, lib/computer-move.js): packed by box into one
// gzipped tar of the bot's in /tmp, handed out and taken in pieces in order, unpacked into its folder (a file of the
// same name is replaced) and dropped. botdot's fixed commands, the bot's folder alone: never a path it names.
// Its browser's profile (#565) the same way, as the browser user, its tar in that user's home, which box can't reach:
// the bot's Camoufox is closed first, and the profile taken in replaces the old one whole, owned by the browser user.
// A profile with links in it is not taken: the bot is root on its boat.dev machine and could have put them there.
// Resolves { code, size?, data? (base64), stderr, error }.
const MOVE_READ_MAX = 3 * 1024 * 1024; // lib/computer-move.js PIECES
const MOVE_READ = 'tail -c +"$(($3 + 1))" -- "$2" | head -c "$4" | base64 -w0';
const MOVE_WRITE = 'if [ "$3" = 0 ]; then : > "$2" || exit 1; fi; [ "$(stat -c %s -- "$2")" = "$3" ] || { echo "a piece came out of order" >&2; exit 4; }; cat >> "$2"';
const MOVE_SCRIPTS = {
  // What box can't read is left out (tar's 1: a file changed or unreadable), as on the bot's own tools.
  pack: 'mkdir -p -- "$1" && rm -f -- "$2" || exit 1; tar --ignore-failed-read -czf "$2" -C "$1" .; s=$?; [ $s -le 1 ] || exit $s; stat -c %s -- "$2"',
  read: MOVE_READ,
  write: MOVE_WRITE,
  unpack: 'mkdir -p -- "$1" && tar -xzf "$2" -C "$1" --no-same-owner; s=$?; rm -f -- "$2"; exit $s',
  drop: 'rm -f -- "$2"',
};
// $1 the profiles' folder, $5 the bot: the profile is "$1/$5", never one word of this command, so pkill can't match it.
const CLOSE_PROFILE = '[ -n "$5" ] || exit 2; umask 077; pkill -u "$(id -u)" -f "$1/$5( |/|\\$)" 2>/dev/null; for _ in $(seq 1 50); do pgrep -u "$(id -u)" -f "$1/$5( |/|\\$)" >/dev/null 2>&1 || break; sleep 0.2; done; ';
const PROFILE_SCRIPTS = {
  pack: `${CLOSE_PROFILE}rm -f -- "$2" || exit 1; [ -d "$1/$5" ] || { echo 0; exit 0; }; tar --ignore-failed-read -czf "$2" -C "$1/$5" ${computerMove.PROFILE_LEFT_OUT} .; s=$?; [ $s -le 1 ] || exit $s; stat -c %s -- "$2"`,
  read: MOVE_READ,
  write: `umask 077; ${MOVE_WRITE}`,
  unpack: `${CLOSE_PROFILE}if tar -tvzf "$2" | grep -qv '^[-d]'; then echo "its browser's profile holds links or devices" >&2; rm -f -- "$2"; exit 5; fi; `
    + 'rm -rf -- "$1/$5.new" && mkdir -p -- "$1/$5.new" && tar -xzf "$2" -C "$1/$5.new" --no-same-owner --no-same-permissions && rm -rf -- "$1/$5" && mv -- "$1/$5.new" "$1/$5"; s=$?; rm -rf -- "$1/$5.new" "$2"; exit $s',
  drop: 'rm -f -- "$2"',
};
const PROFILES = `/home/${BROWSER_USER}/profiles`;
const moveTar = (bot) => `/tmp/botdot-move-${bot}.tgz`;
const profileTar = (bot) => `/home/${BROWSER_USER}/.botdot-move-${bot}.tgz`;
async function moveFiles(seat, { op, part = 'files', offset = 0, length = 0, data }) {
  const s = screenPorts(seat);
  const profile = part === 'profile';
  const script = (profile ? PROFILE_SCRIPTS : MOVE_SCRIPTS)[op];
  if (!script || !computerMove.PARTS.includes(part)) throw new Error('No such step of a copy');
  const argv = ['sh', '-c', script, 'sh', profile ? PROFILES : s.workdir, profile ? profileTar(s.bot) : moveTar(s.bot),
    String(Math.max(0, Math.floor(offset))), String(Math.min(Math.max(0, Math.floor(length)), MOVE_READ_MAX)), s.bot];
  const r = await execAsBot(argv, op === 'pack' || op === 'unpack' ? 1800 : 120, s, {
    ...(op === 'write' ? { input: Buffer.from(String(data || ''), 'base64') } : {}),
    ...(profile ? { as: BROWSER_USER } : {}),
    maxBuffer: MOVE_READ_MAX * 2,
  });
  if (r.code !== 0) return { code: r.code, stderr: r.stderr.trim().slice(-500), error: r.error || null };
  if (op === 'pack') return { code: 0, size: Number(r.stdout.trim()) || 0 };
  if (op === 'read') return { code: 0, data: r.stdout.trim() };
  return { code: 0 };
}

// One command as the bot user in its computer, inside `timeout` and botdot-run, in its own folder and on its own
// screen: what it leaves running as box ends with it (#535). `extra` are more `docker exec` arguments, `env` more of
// the docker CLI's own environment.
function runAsBot(s, command, seconds, extra = [], env = {}) {
  return execAsBot(['sh', '-c', IN_OWN_FOLDER, 'sh', s.workdir, command], seconds, s, { extra: [...gitIdentity(s), ...extra], env, reap: true });
}
// A file read or written, botdot's own fixed command, starts nothing that could stay: it needs no botdot-run.
function execAsBot(argv, seconds, s, { extra = [], env = {}, input, reap = false, maxBuffer = RUN_MAX_BUFFER, as = USER } = {}) {
  const args = ['exec', ...(input === undefined ? [] : ['-i']), '-u', as, '-e', `HOME=/home/${as}`, '-e', `TZ=${timeZone()}`, '-e', `DISPLAY=${s.display}`, ...extra,
    ACCOUNT, 'timeout', '-k', '5', String(seconds), ...(reap ? reaped(argv) : argv)];
  return new Promise((resolve) => {
    const child = execFile('docker', args, { env: { ...process.env, ...env }, timeout: (seconds + 20) * 1000, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = { stdout: String(stdout || ''), stderr: String(stderr || '') };
      if (!err) return resolve({ code: 0, ...out, timedOut: false });
      if (typeof err.code === 'number') return resolve({ code: err.code, ...out, timedOut: err.code === 124 });
      // docker itself failed, ran out of time or said too much: never its message, which repeats the command line.
      const why = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? `the output was cut off at ${Math.round(maxBuffer / 1024 / 1024)} MB` : err.killed ? 'it ran out of time' : "couldn't run it in the computer";
      resolve({ code: null, ...out, timedOut: !!err.killed, error: why });
    });
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

// run_with_ssh_key: one command as the bot user with SSH_AUTH_SOCK set to an ssh-agent that holds one SSH key, so
// `ssh` and `git` use the key and the bot never reads it. In four steps, each its own `docker exec`:
// 1. as box, a new ssh-agent in the foreground (`-D`, so the program that listens is the one whose pid is
//    known), in a new folder of box's, its socket opened to root;
// 2. as root, botdot's own copy of deploy/desktop/botdot-ssh-add, with the key on its stdin only: it hands the key to
//    that agent alone (its pid and user, by SO_PEERCRED). The agent makes itself untraceable, so a program that does
//    not use sudo cannot read the key; one that does can, while the agent lives (ADR 035);
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
function runWithSshKey(seat, { command, privateKey = '', timeoutSeconds = 120 }) {
  const s = screenPorts(seat);
  const seconds = runSeconds(timeoutSeconds);
  return withSshAgent(privateKey, seconds, (sock) => runAsBot(s, command, seconds, ['-e', `SSH_AUTH_SOCK=${sock}`]));
}
// Steps 1, 2 and 4 of runWithSshKey around `run`, which gets the agent's socket and does step 3.
async function withSshAgent(privateKey, seconds, run) {
  const lifetime = String(seconds + 60);
  const none = (error) => ({ code: null, stdout: '', stderr: '', timedOut: false, error });
  let helper;
  try {
    helper = await fs.promises.readFile(SSH_ADD, 'utf8');
    if (!isCurrent(await labels())) return none("this computer is older than botdot's SSH keys. Ask the owner to export its files and reset it");
  } catch {
    return none("couldn't reach the computer");
  }
  const agent = await docker(['exec', '-u', USER, ACCOUNT, 'sh', '-c', START_AGENT, 'sh', lifetime], { timeout: 30_000 })
    .then((out) => String(out).match(AGENT_LINE), () => null);
  if (!agent) return none("couldn't start an ssh-agent in the computer. A computer made before botdot's SSH keys may have none: the owner can export its files and reset it");
  const [, dir, pid] = agent;
  try {
    const loaded = await new Promise((resolve) => {
      const child = execFile('docker', ['exec', '-i', '-u', 'root', '-w', '/', ACCOUNT, '/usr/bin/python3', '-I', '-c', helper, `${dir}/agent`, pid, lifetime, USER],
        { timeout: 60_000 }, (err, stdout) => {
          try { resolve(JSON.parse(String(stdout).trim().split('\n').pop())); } catch { resolve({ ok: false, error: "couldn't load the key into the computer" }); }
        });
      child.stdin.on('error', () => {});
      child.stdin.end(privateKey);
    });
    if (loaded?.ok !== true) return none(typeof loaded?.error === 'string' ? loaded.error : 'the SSH key could not be loaded');
    return await run(`${dir}/agent`);
  } finally {
    await docker(['exec', '-u', USER, ACCOUNT, 'sh', '-c', STOP_AGENT, 'sh', pid, dir]).catch(() => {});
  }
}

// run_with_file (#157): one command as the bot user with a file of the Vault at the path in BOTDOT_FILE. The file lives
// for that command only (the owner's option A): in three steps, each its own `docker exec` as box,
// 1. a new folder of box's alone (0700) with the file in it (0600), its bytes on stdin only. Folders a botdot that
//    stopped mid-command left behind go first: no command runs longer than RUN_MAX_SECONDS;
// 2. the command, as run_with_login runs it, with BOTDOT_FILE and no secret in its environment;
// 3. the folder is removed, whatever happened: done, failed or out of time.
// Every bot on the computer can read the file while it is there, as they all have sudo (ADR 035, SECURITY.md).
const START_FILE = [
  'umask 077',
  "find /tmp -maxdepth 1 -name 'botdot-file-*' -mmin +15 -exec rm -rf {} + 2>/dev/null",
  'd=$(mktemp -d /tmp/botdot-file-XXXXXXXXXX) || exit 1',
  'cat > "$d/$1" || { rm -rf "$d"; exit 1; }',
  'echo "$d"',
].join('\n');
const FILE_DIR = /^(\/tmp\/botdot-file-[A-Za-z0-9]+)$/;
async function runWithFile(seat, { command, fileName, content = '', timeoutSeconds = 120 }) {
  const s = screenPorts(seat);
  const none = (error) => ({ code: null, stdout: '', stderr: '', timedOut: false, error });
  const name = vaultFiles.FILE_NAME.test(String(fileName)) ? String(fileName) : 'file';
  const made = await dockerInput(['exec', '-i', '-u', USER, ACCOUNT, 'sh', '-c', START_FILE, 'sh', name], Buffer.from(String(content), 'base64'))
    .then((out) => out.match(FILE_DIR), () => null);
  if (!made) return none("couldn't put the file in the computer");
  const [, dir] = made;
  try {
    return await runAsBot(s, command, runSeconds(timeoutSeconds), ['-e', `BOTDOT_FILE=${dir}/${name}`]);
  } finally {
    await docker(['exec', '-u', USER, ACCOUNT, 'rm', '-rf', '--', dir]).catch(() => {});
  }
}

// place_secret_file (#253): a secret of the Vault written to a file for good, by the owner's yes per place
// (lib/secret-files.js). On the account's computer, as root: the file is made beside its path in a new temporary file
// (0600 while it is written), its bytes on stdin only, given its mode and owner, then moved over the path, so a
// program never reads half a file. On another server, the same steps over SSH from the bot's screen's user, with a
// saved SSH key in an ssh-agent as runWithSshKey loads one, the bytes in base64 in the docker CLI's own environment
// (never on a command line), as that SSH user: an owner needs it to be root there. Folders on the way are made 0755.
// Path, mode, owner and host are checked to be plain (secret-files.js), so they are quoted safely. Resolves like
// runWithLogin; no output comes back but what failed.
const PLACE = [
  'set -e',
  'if [ -d "$1" ]; then echo "$1 is a folder" >&2; exit 1; fi',
  '(umask 022; mkdir -p "$(dirname "$1")")',
  'umask 077',
  't=$(mktemp "$1.botdot-XXXXXXXXXX")',
  "trap 'rm -f \"$t\"' EXIT",
  'if [ "$4" = base64 ]; then base64 -d > "$t"; else cat > "$t"; fi',
  'chmod "$2" "$t"',
  'if [ -n "$3" ]; then chown "$3" "$t"; fi',
  'mv -f "$t" "$1"',
  'trap - EXIT',
].join('\n');
const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
const SSH = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20';
async function placeFile(seat, { path: file, mode = '600', owner = '', content = '', host, privateKey, timeoutSeconds = 120 }) {
  const s = screenPorts(seat);
  const seconds = runSeconds(timeoutSeconds);
  if (!host) return dockerRun(['exec', '-i', '-u', 'root', '-w', '/', ACCOUNT, 'timeout', '-k', '5', String(seconds), 'sh', '-c', PLACE, 'sh', file, mode, owner, 'plain'], Buffer.from(String(content), 'base64'), seconds);
  const remote = `sh -c ${shq(PLACE)} sh ${shq(file)} ${shq(mode)} ${shq(owner)} base64`;
  return withSshAgent(privateKey, seconds, (sock) => runAsBot(s, `printf '%s' "$BOTDOT_CONTENT" | ${SSH} ${shq(host)} ${shq(remote)}`, seconds,
    ['-e', `SSH_AUTH_SOCK=${sock}`, '-e', 'BOTDOT_CONTENT'], { BOTDOT_CONTENT: String(content) }));
}
// "Remove the file" on the Vault page: the placed file goes from its target, as placeFile reached it.
async function removePlacedFile(seat, { path: file, host, privateKey }) {
  const s = screenPorts(seat);
  if (!host) return dockerRun(['exec', '-u', 'root', '-w', '/', ACCOUNT, 'rm', '-f', '--', file], undefined, 60);
  return withSshAgent(privateKey, 60, (sock) => runAsBot(s, `${SSH} ${shq(host)} ${shq(`rm -f -- ${shq(file)}`)}`, 60, ['-e', `SSH_AUTH_SOCK=${sock}`]));
}
// A docker command with optional bytes on stdin, resolved as execAsBot resolves: { code, stdout, stderr, timedOut }.
function dockerRun(args, input, seconds) {
  return new Promise((resolve) => {
    const child = execFile('docker', args, { timeout: (seconds + 20) * 1000, maxBuffer: RUN_MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = { stdout: String(stdout || ''), stderr: String(stderr || '') };
      if (!err) return resolve({ code: 0, ...out, timedOut: false });
      if (typeof err.code === 'number') return resolve({ code: err.code, ...out, timedOut: err.code === 124 });
      resolve({ code: null, ...out, timedOut: !!err.killed, error: err.killed ? 'it ran out of time' : "couldn't run it in the computer" });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input === undefined ? '' : input);
  });
}

module.exports = { IMAGE, timeZone, adoptUnscoped, ensure, ensureImage, stop, reset, resetAll, updateAll, restartAll, usage, copyOld, details, health, logs, inspect, listAll, dockerStatus, containerName, setRestartPolicy, request, screenPipe, watch, typeSecret, browserTool, startProgram, runWithLogin, runWithSshKey, runWithFile, placeFile, removePlacedFile, runShell, readFile, writeFile, bringOut, listUploads, putUpload, packFolder, unpackFolder, moveFiles, PROFILE_SCRIPTS, screenState, freeScreen, restScreen, screenPorts, MAX_SCREENS };
if (process.env.BOT_DOT_HELPER_SOCKET) module.exports = require('./helper-client').computers(module.exports);
