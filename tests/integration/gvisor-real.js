#!/usr/bin/env node
// The stage `gvisor-real` (tests/integration/gvisor-real.sh starts it), the spike of ADR 028 (#464): what one
// account's containers need, under gVisor.
//
// The machine is a nested Docker daemon as an account gets it: rootless, with gVisor's runsc (a pinned release)
// as the runtime of every container, and no /dev/kvm (gVisor's systrap platform, as on a VPS without nested
// virtualisation). On it botdot's real server image and real bots' computer image, built from this checkout, run
// from the real compose.yaml with one override (OVERRIDE). The steps check what the owner, the Chief, a bot, the
// tools user and the browser user meet, and measure the account's footprint, idle and with one computer running.
//
// GVISOR_REAL_SERVER_IMAGE and GVISOR_REAL_COMPUTER_IMAGE use images already on this machine in place of building
// them; GVISOR_REAL_REPORT writes the measurements there as JSON; GVISOR_REAL_KEEP leaves the machine to look at.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { until, pause } = require('./test-install');

const root = path.resolve(__dirname, '../..');
const prefix = `botdot-gvisor-real-${process.pid}`;
const step = (text) => console.log(`gvisor-real: ${text}`);
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
const docker = (...args) => run('docker', args);

// gVisor 20261005.0, each architecture's archive by its sha256 (checked against the sha512 Google publishes beside
// it when it was pinned). The machine's Docker is rootless, as an account's is (ADR 028).
const GVISOR = 'https://storage.googleapis.com/gvisor/releases/release/20261005.0';
const GVISOR_SHA256 = { amd64: '0a8a9058b9f11791a2097f03190c2ddc5b963c3dbee5bb9fd8497f4801c42f92', arm64: 'f8bd7cb4e989db445255c20e6c2962498e5b5bd1ec1407bfcf187fbd5f184a2a' };
const DIND_ROOTLESS = 'docker:28-dind-rootless@sha256:7c3e797187e43738220462658f4586572cbd3bf009f728b21e34d9c5c06ce431';
const SOCKET = '/run/user/1000/docker.sock';
const ACCOUNT = '/home/rootless/account';
// runsc's flags in a rootless Docker: it may not make cgroups there (--ignore-cgroups), botdot's services meet
// through Unix sockets in their mounts: the docker-helper's and the Docker socket (--host-uds=all), and a
// computer's firewall needs gVisor's iptables, which come with raw sockets (--net-raw; only a process with
// CAP_NET_RAW gets one, and no container of botdot's has it).
const RUNSC_FLAGS = ['--ignore-cgroups', '--host-uds=all', '--net-raw'];
// What the account changes in compose.yaml. Under gVisor host networking hands a container the host's network,
// whose sockets gVisor's /proc/net/tcp does not list, so botdot could tell nobody apart: botdot keeps a network
// of its own, as it will behind ADR 028's front door. The docker-helper gets the account's rootless Docker.
const OVERRIDE = `services:
  bot-dot:
    network_mode: !reset null
  docker-helper:
    volumes:
      - ${SOCKET}:/var/run/docker.sock
`;

// The users botdot tells apart (lib/identity.js), and one that is none of them: the owner.
const OWNER_UID = 1000, CHIEF_UID = 60500, TOOLS_UID = 60400, FIRST_BOT_UID = 61000;
// What the owner's request meets when it comes from a user botdot cannot tell (the tools user), and what a bot
// and the Chief meet on a route that is not theirs (server.js gate and api).
const UNKNOWN = "botdot couldn't tell which user on this machine made this request.";
const NOT_A_BOT_ROUTE = "Bots can only use their own run's tools.";
const NOT_A_CHIEF_ROUTE = "The Chief's tools can't do that; only the owner can.";

let machine = null, removed = false;
const built = [];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));

// --- The images ------------------------------------------------------------------------------------

function image(kind, given, context) {
  if (given) { docker('image', 'inspect', given); return given; }
  const tag = `${prefix}:${kind}`;
  step(`building botdot's real ${kind} image of this checkout`);
  docker('build', '-q', '-t', tag, context);
  built.push(tag);
  return tag;
}

function machineImage() {
  const dir = path.join(temp, 'machine');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'Dockerfile'), [
    ...Object.entries(GVISOR_SHA256).flatMap(([arch, sha]) => [`FROM scratch AS gvisor-${arch}`, `ADD --checksum=sha256:${sha} ${GVISOR}/${arch === 'amd64' ? 'x86_64' : 'aarch64'}/gvisor.tar.zstd /gvisor.tar.zstd`]),
    'FROM gvisor-${TARGETARCH} AS gvisor',
    `FROM ${DIND_ROOTLESS}`,
    'USER root',
    'RUN apk add --no-cache zstd',
    'RUN --mount=from=gvisor,source=/gvisor.tar.zstd,target=/tmp/gvisor.tar.zstd zstd -dc /tmp/gvisor.tar.zstd | tar -x -C /usr/local/bin runsc gvisor-bin && runsc --version',
    'USER rootless',
    `RUN mkdir -p /home/rootless/.config/docker && echo '${JSON.stringify({ 'default-runtime': 'runsc', runtimes: { runsc: { path: '/usr/local/bin/runsc', runtimeArgs: RUNSC_FLAGS } } })}' > /home/rootless/.config/docker/daemon.json`,
    '',
  ].join('\n'));
  const tag = `${prefix}:machine`;
  step('building the machine: rootless Docker with gVisor as its runtime');
  docker('build', '-q', '-t', tag, dir);
  built.push(tag);
  return tag;
}

// --- The machine -----------------------------------------------------------------------------------

async function startMachine(tag) {
  const name = `${prefix}-machine`;
  docker('run', '-d', '--privileged', '--name', name, '-e', 'DOCKER_TLS_CERTDIR=', tag, `--host=unix://${SOCKET}`);
  machine = name;
  const exec = (args, input) => run('docker', ['exec', ...(input === undefined ? [] : ['-i']), '-e', `DOCKER_HOST=unix://${SOCKET}`, name, ...args], input === undefined ? {} : { input });
  const m = {
    name,
    exec: (...args) => exec(args),
    inner: (...args) => exec(['docker', ...args]),
    innerInput: (input, ...args) => exec(['docker', ...args], input),
    write: (file, content) => exec(['sh', '-c', 'cat > "$1"', 'sh', file], content),
    load: (image) => new Promise((resolve, reject) => {
      const save = spawn('docker', ['save', image]);
      const into = spawn('docker', ['exec', '-i', '-e', `DOCKER_HOST=unix://${SOCKET}`, name, 'docker', 'load']);
      let error = '';
      for (const p of [save, into]) { p.stderr.on('data', (b) => { error += b; }); p.on('error', reject); }
      into.stdin.on('error', reject);
      save.stdout.pipe(into.stdin);
      Promise.all([save, into].map((p) => new Promise((done) => p.on('close', done))))
        .then((codes) => (codes.some(Boolean) ? reject(new Error(error)) : resolve()));
    }),
  };
  await until('the rootless Docker daemon', () => m.inner('info', '--format', '{{.ID}}'), 120_000);
  return m;
}

// --- The account -----------------------------------------------------------------------------------

function account(m) {
  const compose = (...args) => m.exec('docker', 'compose', '--project-directory', ACCOUNT, '-f', `${ACCOUNT}/compose.yaml`, '-f', `${ACCOUNT}/compose.gvisor.yaml`, ...args);
  let id = null;
  const server = () => id || (id = compose('ps', '-q', 'bot-dot'));
  // A command in botdot's container, as `uid`.
  const inServer = (uid, args, input) => (input === undefined
    ? m.inner('exec', '-u', String(uid), server(), ...args)
    : m.innerInput(input, 'exec', '-i', '-u', String(uid), server(), ...args));
  // botdot's API from inside its container, as `uid`: the way a program of that user reaches botdot there.
  // { status, body }, body parsed when it is JSON.
  const api = (uid, method, route, body) => {
    const args = ['curl', '-sS', '-m', '900', '-X', method, '-H', 'X-Bot-Dot: 1', '-w', '\n%{http_code}', `http://127.0.0.1:4747${route}`];
    if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
    const out = inServer(uid, args, body === undefined ? undefined : JSON.stringify(body));
    const at = out.lastIndexOf('\n');
    let parsed = out.slice(0, at);
    try { parsed = JSON.parse(parsed); } catch { /* text */ }
    return { status: Number(out.slice(at + 1)), body: parsed };
  };
  return { compose, server, inServer, api };
}

// Whether the bot's program on its computer reaches host:port: 'open', or why not.
const reaches = (m, container, host, port) => inComputer(m, container, 'bot', ['python3', '-c',
  'import socket,sys\ntry:\n socket.create_connection((sys.argv[1],int(sys.argv[2])),6);print("open")\nexcept Exception as e:\n print(type(e).__name__)', host, String(port)]);

// A bot's computer: a command in it, as `user`.
const inComputer = (m, container, user, args, input) => (input === undefined
  ? m.inner('exec', '-u', user, container, ...args)
  : m.innerInput(input, 'exec', '-i', '-u', user, '-w', '/', container, ...args));
// Its processes: [{ user, args }].
const processesOf = (m, container) => inComputer(m, container, 'root', ['ps', '-eo', 'user:16,args', '--no-headers'])
  .split('\n').map((l) => l.trim().match(/^(\S+)\s+(.*)$/)).filter(Boolean).map(([, user, args]) => ({ user, args }));

// The live screen as the web page opens it: botdot's WebSocket at /computer/<bot>/websockify, which botdot
// passes on to websockify in the computer. Resolves to the first line of the answer and the VNC server's greeting.
const SCREEN = `
const net = require('net');
const s = net.connect(4747, '127.0.0.1', () => s.write([
  'GET /computer/' + process.argv[1] + '/websockify HTTP/1.1', 'Host: 127.0.0.1:4747', 'Origin: http://127.0.0.1:4747',
  'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Protocol: binary',
  'Sec-WebSocket-Key: ' + require('crypto').randomBytes(16).toString('base64'), '', ''].join('\\r\\n')));
let seen = Buffer.alloc(0);
const done = (rfb) => { console.log(JSON.stringify({ status: seen.toString('latin1').split('\\r\\n')[0], rfb })); process.exit(rfb ? 0 : 1); };
s.on('data', (d) => { seen = Buffer.concat([seen, d]); const m = seen.toString('latin1').match(/RFB \\d{3}\\.\\d{3}/); if (m) done(m[0]); });
s.on('close', () => done(null));
setTimeout(() => done(null), 20000);
`;

// --- What is measured ------------------------------------------------------------------------------

const MiB = (kb) => Math.round(kb / 1024);
// The account's memory two ways. The machine's own count (its cgroup): what it holds in RAM, its processes' memory
// and gVisor's memory files (anon + shmem), and apart from that the page cache it could give back. Summing its
// processes would not do: gVisor's stub processes each map the same memory of their sandbox. And each sandbox's
// own count (gVisor's /proc/meminfo, MemTotal - MemFree), which includes the files it keeps in its memory.
function memory(m) {
  const stat = Object.fromEntries(m.exec('cat', '/sys/fs/cgroup/memory.stat').split('\n').map((l) => l.split(' ')));
  const sandboxes = {};
  for (const name of m.inner('ps', '--format', '{{.Names}}').split('\n').filter(Boolean)) {
    const info = Object.fromEntries(m.inner('exec', name, 'cat', '/proc/meminfo').split('\n').map((l) => l.split(/:\s+/)).filter((p) => p[1]).map(([k, v]) => [k, parseInt(v, 10)]));
    sandboxes[name] = MiB(info.MemTotal - info.MemFree);
  }
  return { heldMiB: MiB((Number(stat.anon) + Number(stat.shmem)) / 1024), pageCacheMiB: MiB(Number(stat.file) / 1024), sandboxesMiB: sandboxes };
}

// The processes in botdot's sandbox, as gVisor's own kernel counts them (resident memory).
function serverProcesses(acc) {
  const out = acc.inServer(0, ['sh', '-c', 'for p in /proc/[0-9]*; do r=$(awk \'/^VmRSS:/ {print $2}\' $p/status 2>/dev/null); [ -n "$r" ] && echo "$r $(tr "\\0" " " < $p/cmdline | cut -c1-160)"; done']);
  const of = (re) => MiB(out.split('\n').filter((l) => re.test(l)).reduce((sum, l) => sum + Number(l.split(' ')[0]), 0));
  return { botdotMiB: of(/node (lib\/privilege-broker|server)\.js/), embeddingModelMiB: of(/llama-server/), claudeCodeMiB: of(/claude/) };
}

function disk(m, images) {
  const kb = (p) => Number(m.exec('sh', '-c', `du -sk "${p}" | cut -f1`));
  const size = (ref) => Math.round(Number(m.inner('image', 'inspect', '--format', '{{.Size}}', ref)) / 1024 / 1024);
  return {
    accountDockerMiB: MiB(kb('/home/rootless/.local/share/docker')),
    serverImageMiB: size(images.server),
    computerImageMiB: size(images.computer),
    writableLayers: Object.fromEntries(m.inner('ps', '-a', '-s', '--format', '{{.Names}}|{{.Size}}').split('\n').filter(Boolean).map((l) => l.split('|'))),
  };
}

// --- The steps -------------------------------------------------------------------------------------

async function main() {
  const report = { measured: new Date().toISOString(), arch: process.arch, gvisor: null, runscFlags: RUNSC_FLAGS, findings: [] };
  const images = {
    computer: image('computer', process.env.GVISOR_REAL_COMPUTER_IMAGE, path.join(root, 'deploy/desktop')),
    server: image('server', process.env.GVISOR_REAL_SERVER_IMAGE, root),
  };
  const m = await startMachine(machineImage());

  step('the machine: rootless Docker, runsc for every container, no /dev/kvm');
  assert.equal(m.exec('sh', '-c', 'test -e /dev/kvm && echo kvm || echo none'), 'none', 'no nested virtualisation');
  assert.equal(m.inner('info', '--format', '{{.DefaultRuntime}}'), 'runsc');
  assert.match(m.inner('info', '--format', '{{.SecurityOptions}}'), /rootless/);
  report.gvisor = m.exec('runsc', '--version').split('\n')[0];

  step('loading botdot\'s server image into the account\'s Docker');
  await m.load(images.server);
  let kernel;
  try { kernel = m.inner('run', '--rm', '--network', 'none', '--entrypoint', 'sh', images.server, '-c', 'dmesg | head -1'); } catch (e) { kernel = String(e.stderr || e.message); }
  if (!/gVisor/.test(kernel)) {
    const why = `gVisor cannot start a sandbox on this Docker: ${kernel.trim().split('\n').pop()}`;
    if (process.env.CI) throw new Error(why);
    console.log(`gvisor-real skipped: ${why}`);
    return;
  }

  // Recorded, not asserted: why the account's compose file gives botdot a network of its own (OVERRIDE).
  step('host networking under gVisor: a connection on 127.0.0.1, and the kernel\'s TCP table');
  let hostNetwork;
  try {
    hostNetwork = `/proc/net/tcp lists ${m.inner('run', '--rm', '--network', 'host', '--entrypoint', 'node', images.server, '-e',
      "require('net').createServer().listen(4999,'127.0.0.1',()=>{require('net').connect(4999,'127.0.0.1',()=>{console.log(require('fs').readFileSync('/proc/net/tcp','utf8').split('\\n').filter(l=>/:1387 /.test(l)).length);process.exit(0)})})")} of the connection's 2 sockets`;
  } catch (e) {
    hostNetwork = String(e.stderr || e.message).match(/Error: .+/)?.[0] || 'the connection could not be made';
  }
  report.findings.push(`Host networking under runsc in a rootless Docker: ${hostNetwork}.`);

  step('loading the bots\' computer image');
  await m.load(images.computer);

  step('the account: compose.yaml with its override, botdot starts');
  m.exec('mkdir', '-p', ACCOUNT);
  m.write(`${ACCOUNT}/compose.yaml`, fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8'));
  m.write(`${ACCOUNT}/compose.gvisor.yaml`, OVERRIDE);
  m.write(`${ACCOUNT}/.env`, `BOT_DOT_IMAGE=${images.server}\nBOT_DOT_COMPUTER_IMAGE=${images.computer}\n`);
  const acc = account(m);
  acc.compose('up', '-d');
  try {
    await until('botdot', () => acc.api(OWNER_UID, 'GET', '/api/version').status === 200, 300_000);
  } catch (e) {
    throw new Error(`${e.message}\n${acc.compose('logs', '--tail', '60')}`);
  }
  for (const service of ['bot-dot', 'docker-helper']) {
    const id = acc.compose('ps', '-q', service);
    assert.equal(m.inner('inspect', '--format', '{{.HostConfig.Runtime}}', id), 'runsc', `${service} runs under runsc`);
    assert.match(m.inner('exec', id, 'sh', '-c', 'dmesg | head -1'), /gVisor/, `${service} runs on gVisor's kernel`);
  }
  const status = acc.api(OWNER_UID, 'GET', '/api/status');
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.docker.ok, true, `botdot reaches the account's Docker through its helper: ${JSON.stringify(status.body.docker)}`);

  step('the embedding model loads');
  await until('the embedding model', () => acc.api(OWNER_UID, 'GET', '/api/memory/semantic').body?.state === 'ready', 300_000)
    .catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(acc.api(OWNER_UID, 'GET', '/api/memory/semantic').body)}`); });

  step('the identity check tells the owner, the Chief, a bot and the tools user apart');
  const made = acc.api(OWNER_UID, 'POST', '/api/bots', { name: 'Spike', prompt: 'Check that botdot works under gVisor.', computer: 'linux' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const botId = made.body.id;
  // A bot gets its own user at its first run; until then any user of the bots' range is one.
  const ids = JSON.parse(acc.inServer(0, ['sh', '-c', 'cat /data/identities.json 2>/dev/null || true']) || '{"bots":{}}');
  const botUid = ids.bots?.[botId] ?? FIRST_BOT_UID;
  const asked = (uid, route) => acc.api(uid, 'GET', route);
  const owner = asked(OWNER_UID, '/api/status');
  assert.equal(owner.status, 200, `the owner: ${JSON.stringify(owner.body)}`);
  const chiefOwn = asked(CHIEF_UID, '/api/bots');
  assert.equal(chiefOwn.status, 200, `the Chief on its own route: ${JSON.stringify(chiefOwn.body)}`);
  const chiefNot = asked(CHIEF_UID, '/api/status');
  assert.equal(chiefNot.status, 403);
  assert.equal(chiefNot.body.error, NOT_A_CHIEF_ROUTE, 'the Chief, told apart from the owner');
  const bot = asked(botUid, '/api/status');
  assert.equal(bot.status, 403);
  assert.equal(bot.body, NOT_A_BOT_ROUTE, `bot ${botId} (${botUid}), told apart from the owner and the Chief`);
  const botOwn = acc.api(botUid, 'GET', '/api/self/session');
  assert.equal(botOwn.status, 403);
  assert.equal(botOwn.body, "That run key isn't this bot's.", 'a bot on its own route still needs its run key');
  const tools = asked(TOOLS_UID, '/api/status');
  assert.equal(tools.status, 403);
  assert.equal(tools.body, UNKNOWN, 'the tools user gets nowhere');
  report.identity = { owner: owner.status, chief: [chiefOwn.status, chiefNot.status], bot: bot.status, tools: tools.status, botUid };

  step('Claude Code, the Chief\'s engine, starts as the Chief\'s user');
  const version = acc.inServer(CHIEF_UID, ['sh', '-c', 'HOME=/tmp claude --version']);
  assert.match(version, /\d+\.\d+\.\d+/, version);

  step('footprint, idle: botdot, its embedding model, and Claude Code idling as the Chief would');
  // Without a Claude sign-in no Chief turn runs: Claude Code is started as the Chief's user, idle, in its place.
  m.inner('exec', '-d', '-u', String(CHIEF_UID), '-e', 'HOME=/tmp/chief', acc.server(), 'sh', '-c', 'mkdir -p /tmp/chief && cd /tmp/chief && sleep 600 | claude mcp serve');
  await pause(20_000);
  assert.ok(serverProcesses(acc).claudeCodeMiB > 0, 'Claude Code is running as the Chief\'s user');
  report.idle = { machine: memory(m), inServer: serverProcesses(acc), disk: disk(m, images) };
  acc.inServer(0, ['sh', '-c', 'pkill -f "[c]laude mcp serve"; pkill -f "[s]leep 600"; true']);

  step(`starting the computer of bot ${botId}`);
  const started = acc.api(OWNER_UID, 'POST', `/api/bots/${botId}/computer`, { action: 'start' });
  assert.equal(started.status, 200, `botdot starts the computer: ${JSON.stringify(started.body)}`);
  assert.equal(started.body.state, 'running');
  const computer = `botdot-${botId}`, network = `${computer}-network`;
  assert.equal(m.inner('inspect', '--format', '{{.HostConfig.NetworkMode}}', computer), network, 'the computer is on its own network (#475)');

  step('its firewall, set by root inside its sandbox');
  const gateway = m.inner('network', 'inspect', network, '--format', '{{(index .IPAM.Config 0).Gateway}}');
  report.firewall = { internet: reaches(m, computer, '1.1.1.1', 443), gateway: reaches(m, computer, gateway, 22), loopbackOtherPort: reaches(m, computer, '127.0.0.1', 22) };
  assert.equal(report.firewall.internet, 'open', 'the computer reaches the internet');
  assert.notEqual(report.firewall.gateway, 'open', 'and not the machine it runs on');
  assert.notEqual(report.firewall.loopbackOtherPort, 'open', 'and of its own loopback only botdot\'s ports');
  assert.match(inComputer(m, computer, 'bot', ['sh', '-c', 'iptables-legacy -F OUTPUT 2>&1; true']), /denied|not permitted/i, 'the bot cannot change the firewall');
  assert.equal(m.inner('inspect', '--format', '{{.HostConfig.Runtime}}', computer), 'runsc', 'the computer runs under runsc');
  assert.equal(m.inner('inspect', '--format', '{{.Config.User}}', computer), 'bot');
  assert.match(inComputer(m, computer, 'bot', ['sh', '-c', 'dmesg | head -1']), /gVisor/);

  step('the desktop: TigerVNC with XFCE, noVNC, the computer-server');
  await until('the desktop', () => {
    const ps = processesOf(m, computer);
    const has = (re, user = 'bot') => ps.some((p) => p.user === user && re.test(p.args));
    return has(/X(tiger)?vnc :1/i) && has(/xfce4-session|xfwm4/) && has(/websockify/) && has(/computer_server/) && ps;
  }, 120_000).catch((e) => { throw new Error(`${e.message}\n${processesOf(m, computer).map((p) => `${p.user} ${p.args}`).join('\n')}`); });
  const statusAnswer = inComputer(m, computer, 'bot', ['python3', '-c', "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/status',timeout=10).read().decode())"]);
  assert.match(statusAnswer, /ok/i, `the computer-server answers: ${statusAnswer}`);
  const screen = JSON.parse(acc.inServer(OWNER_UID, ['node', '-e', SCREEN, botId]));
  assert.match(screen.status, /^HTTP\/1\.1 101/, `botdot opens the live screen: ${JSON.stringify(screen)}`);
  assert.match(screen.rfb, /^RFB 003\.00\d$/, 'and the VNC server greets through it');
  report.screen = screen;

  step('Camoufox and its bridge run as browser, and a page opens');
  await until('the bridge', () => processesOf(m, computer).some((p) => p.user === 'browser' && /camoufox-browser --serve/.test(p.args)), 60_000);
  const page = `data:text/html,<title>spike</title><input autofocus oninput="document.title='typed '+this.value.length">`;
  const opened = inComputer(m, computer, 'bot', ['python3', '-c', 'import json,sys,urllib.request;r=urllib.request.Request("http://127.0.0.1:47111",json.dumps({"op":"open","url":sys.argv[1]}).encode(),{"Content-Type":"application/json"});print(urllib.request.urlopen(r,timeout=40).read().decode())', page]);
  assert.deepEqual(JSON.parse(opened), { ok: true }, 'the bot asks the bridge to open a page');
  const typeSecret = fs.readFileSync(path.join(root, 'deploy/desktop/botdot-type-secret'), 'utf8');
  const bridge = (payload) => JSON.parse(inComputer(m, computer, 'browser', ['/usr/bin/python3', '-I', '-c', typeSecret], JSON.stringify(payload)).split('\n').pop());
  await until('Camoufox with the page', () => bridge({ op: 'where' }).ok, 180_000)
    .catch((e) => { throw new Error(`${e.message}\n${inComputer(m, computer, 'browser', ['tail', '-40', '/home/browser/bridge.log'])}`); });
  const browserProcs = processesOf(m, computer).filter((p) => /camoufox/i.test(p.args) && !/camoufox-browser/.test(p.args));
  assert.ok(browserProcs.length > 0, 'Camoufox runs');
  assert.deepEqual([...new Set(browserProcs.map((p) => p.user))], ['browser'], `Camoufox runs as browser: ${JSON.stringify(browserProcs.slice(0, 3))}`);

  step('a secret reaches only the bridge');
  const secret = `spike-${crypto.randomBytes(9).toString('hex')}`;
  const typed = await until('the bridge to type', () => { const r = bridge({ op: 'type', site: '', field: 'text', value: secret, submit: false }); return r.ok ? r : (/Click the/.test(r.error) ? null : Promise.reject(new Error(r.error))); }, 60_000);
  assert.equal(typed.ok, true);
  const title = await until('the page to see the typing', () => {
    // The desktop's window titles, as the bot sees them on its screen: the page shows only how much was typed.
    const t = inComputer(m, computer, 'bot', ['sh', '-c', 'export DISPLAY=:1 XAUTHORITY=/home/bot/.Xauthority; for w in $(xprop -root _NET_CLIENT_LIST | tr -d , | cut -d"#" -f2); do xprop -id "$w" _NET_WM_NAME; done 2>/dev/null; true']);
    return t.includes(`typed ${secret.length}`) && t;
  }, 30_000);
  assert.ok(title, 'Camoufox received every character');
  const asBot = inComputer(m, computer, 'bot', ['python3', '-c', 'import socket\ntry:\n s=socket.socket(socket.AF_UNIX);s.connect("/run/botdot-browser/bridge.sock");print("connected")\nexcept OSError as e:\n print(type(e).__name__)']);
  assert.equal(asBot, 'PermissionError', 'the bot cannot open the bridge\'s socket');
  assert.ok(!processesOf(m, computer).some((p) => p.args.includes(secret)), 'the secret is on no command line');
  assert.notEqual(inComputer(m, computer, 'bot', ['sh', '-c', 'cat /home/browser/bridge.log >/dev/null 2>&1 && echo read || echo refused']), 'read', 'the bot cannot read the bridge\'s log');

  step('footprint with one computer running, Camoufox open');
  report.withComputer = { machine: memory(m), inServer: serverProcesses(acc), disk: disk(m, images) };

  step(`stopping the computer of bot ${botId}`);
  const stopped = acc.api(OWNER_UID, 'POST', `/api/bots/${botId}/computer`, { action: 'stop' });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  assert.equal(stopped.body.state, 'stopped');

  const text = JSON.stringify(report, null, 2);
  if (process.env.GVISOR_REAL_REPORT) fs.writeFileSync(process.env.GVISOR_REAL_REPORT, `${text}\n`);
  console.log(text);
  console.log(JSON.stringify({ result: 'PASS' }));
}

// --- A run -----------------------------------------------------------------------------------------

function teardown() {
  if (removed) return;
  removed = true;
  const attempt = (what, action) => { try { action(); } catch (error) { console.error(`${what} was not removed: ${error.message}`); process.exitCode = 1; } };
  const keep = machine && process.env.GVISOR_REAL_KEEP;
  if (keep) console.error(`kept ${machine}: docker exec -e DOCKER_HOST=unix://${SOCKET} ${machine} docker ps`);
  else if (machine) attempt(`The machine ${machine}`, () => docker('rm', '-fv', machine));
  for (const tag of built) if (!keep || !tag.endsWith(':machine')) attempt(`The image ${tag}`, () => docker('image', 'rm', tag));
  fs.rmSync(temp, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { teardown(); process.exit(1); });
main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(teardown);
