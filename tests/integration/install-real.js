#!/usr/bin/env node
// The stage `install-real` (tests/integration/install-real.sh starts it): botdot installed the way a stranger
// installs it, on a clean machine, in a real Docker daemon.
//
// Each case gets a test machine of its own (tests/integration/test-install.js): Ubuntu 24.04 with Docker, rootless
// Docker and gVisor, a local registry and the real install.sh, and nothing of botdot's on it. The real installer,
// compose files, front door, Caddy, docker-helper and server run there, the admin's account in its own rootless
// Docker under gVisor (ADR 028); the images are stand-ins built from this checkout, which the case publishes or loads
// as it needs. A case drives the install as a person does (run the installer, open the sign-up link, make a passkey,
// start a bot's computer) and checks what they would see. The machine has no systemd, so the installer starts each
// account's Docker itself.
//
// To add a case, add { name, run } to `cases`: run(machine, stage) gets a fresh machine. INSTALL_REAL_CASE runs
// only the cases whose name contains it; INSTALL_REAL_KEEP leaves the machines there to look at a failure.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const passkey = require('../../test/fixtures/soft-passkey');
const { createStage, until, REGISTRY, SERVER, DESKTOP, DOMAIN, ADMIN, DIR, REGISTRY_IMAGE } = require('./test-install');
// The names `make images` gives a self-built botdot server's images.
const SELF_SERVER = 'bot-dot/server:latest', SELF_DESKTOP = 'bot-dot/desktop:latest';
const HOME = `${DIR}/accounts/${ADMIN}`;
// readyOf(said): the run's last line for a program, BOTDOT_READY and its JSON (#981), the one such line it printed.
function readyOf(said) {
  const lines = said.trim().split('\n');
  assert.equal(lines.filter((l) => l.startsWith('BOTDOT_READY ')).length, 1, `one BOTDOT_READY line:\n${said}`);
  assert.match(lines.at(-1), /^BOTDOT_READY \{/, `the run's last line is BOTDOT_READY:\n${said}`);
  return JSON.parse(lines.at(-1).slice('BOTDOT_READY '.length));
}
const NOT_YET = "Open the link from your server's install";
const ROOT_REACHES = 'Whoever is root on this machine can reach every account on it: its data, its bots and the logins they hold. Keep root to yourself.';

const stage = createStage('install-real', { keep: !!process.env.INSTALL_REAL_KEEP });

// The admin's botdot server answers through the front door, and reaches its account's Docker through its helper.
function answers(machine) {
  const version = machine.api('GET', '/api/version');
  assert.equal(version.status, 200, `botdot answers: ${JSON.stringify(version.body)}`);
  assert.equal(version.body.app, 'bot-dot');
  assert.notEqual(version.body.frontDoor, true, 'the account\'s own botdot server, not the front door');
  const status = machine.api('GET', '/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.docker.ok, true, `botdot reaches Docker through its helper: ${JSON.stringify(status.body.docker)}`);
  return status.body;
}

// The owner makes a bot with a computer and starts it, as the web page does. Every bot of the account works on its
// one computer, as box (ADR 035), which the docker-helper starts from the configured computer image, in the
// account's Docker, under gVisor; the bot gets its own screen and folder on it (#105). A bot cannot stop it: the
// account's computer stays on for every bot.
function startComputer(machine, image) {
  const created = machine.api('POST', '/api/bots', { name: 'Acceptance', prompt: 'Check that the install works.', computer: 'linux' });
  assert.equal(created.status, 201, `the bot is made: ${JSON.stringify(created.body)}`);
  const { id } = created.body;

  stage.step(`starting the computer of bot ${id}`);
  const started = machine.api('POST', `/api/bots/${id}/computer`, { action: 'start' });
  assert.equal(started.status, 200, `the computer starts: ${JSON.stringify(started.body)}`);
  assert.equal(started.body.state, 'running');
  assert.equal(machine.api('GET', `/api/bots/${id}/computer`).body.state, 'running');
  // Named after the account's Compose project (#19): botdot-<project>.account.computer.
  const container = machine.account(ADMIN, 'ps', '-a', '--filter', 'label=botdot.computer=account', '--format', '{{.Names}}');
  assert.match(container, /^botdot-[a-z0-9_-]+\.account\.computer$/, 'one computer, named after its project');
  const made = JSON.parse(machine.account(ADMIN, 'inspect', container))[0];
  assert.equal(made.State.Status, 'running');
  assert.equal(made.Config.Image, image, 'from the configured computer image');
  assert.equal(made.Config.User, 'box', 'the bots work on it as box');
  assert.equal(made.Config.Labels['botdot.computer'], 'account');
  assert.equal(made.HostConfig.Runtime, 'runsc', 'under gVisor');
  assert.throws(() => machine.inner('inspect', container), 'and not in the machine\'s own Docker');
  assert.equal(machine.account(ADMIN, 'exec', container, 'sh', '-c', `test -d /workspace/${id} && ls /run/botdot-desktop/screen-*.pid >/dev/null && echo yes`), 'yes', 'the bot\'s screen runs, and its folder is made');
  // gVisor sizes it by the account's share, not the machine (ADR 152): its RAM and CPUs are the share's.
  const share = JSON.parse(machine.exec('cat', `${HOME}/share/share.json`));
  const [ram, cpus] = machine.account(ADMIN, 'exec', container, 'sh', '-c', "awk '/^MemTotal:/ { print $2 }' /proc/meminfo; nproc").split('\n').map(Number);
  const [machineRam, machineCpus] = machine.exec('sh', '-c', "awk '/^MemTotal:/ { print $2 }' /proc/meminfo; nproc").split('\n').map(Number);
  assert.ok(ram <= Math.min(share.ram * 1048576, machineRam), `the computer's RAM is the share's ${share.ram} GB: ${ram} kB of ${machineRam}`);
  assert.equal(cpus, Math.min(share.cpu, machineCpus), `the computer's CPUs are the share's ${share.cpu}`);

  stage.step(`asking to stop the computer of bot ${id}`);
  const stopped = machine.api('POST', `/api/bots/${id}/computer`, { action: 'stop' });
  assert.equal(stopped.status, 409, `the account's computer stays on: ${JSON.stringify(stopped.body)}`);
  assert.equal(machine.account(ADMIN, 'inspect', '--format', '{{.State.Status}}', container), 'running');
  return { id, container };
}

// #980: a container's log in the account's Docker is json-file, rotated at 20 MB and kept to five files: 130 MB written
// leave at most 100 MB. The machine's Docker has the same limits in its settings (it reads them when it next starts:
// the test machine has no systemd to restart it).
function logsStayWithinLimit(machine, image) {
  stage.step('a container\'s log stops growing past its limit');
  const MB = 1024 * 1024;
  const chatty = machine.account(ADMIN, 'run', '-d', '--network', 'none', '--entrypoint', 'node', image, '-e',
    "const l = 'x'.repeat(1023) + '\\n'; let n = 0; (function w() { while (n < 130 * 1024) { n++; if (!process.stdout.write(l)) return process.stdout.once('drain', w); } })()");
  assert.equal(machine.account(ADMIN, 'wait', chatty), '0');
  const made = JSON.parse(machine.account(ADMIN, 'inspect', chatty))[0];
  assert.deepEqual(made.HostConfig.LogConfig, { Type: 'json-file', Config: { 'max-size': '20m', 'max-file': '5' } });
  const sizes = machine.exec('sh', '-c', `stat -c %s ${made.LogPath}*`).split('\n').map(Number);
  assert.ok(sizes.length > 1 && sizes.length <= 5, `rotated, five files at most: ${sizes}`);
  for (const size of sizes) assert.ok(size <= 20 * MB + 64 * 1024, `each file about 20 MB at most: ${sizes}`);
  assert.ok(sizes.reduce((a, b) => a + b, 0) < 101 * MB, `100 MB at most of the 130 MB written: ${sizes}`);
  machine.account(ADMIN, 'rm', chatty);
  const own = JSON.parse(machine.exec('cat', '/etc/docker/daemon.json'));
  assert.deepEqual([own['log-driver'], own['log-opts']], ['json-file', { 'max-size': '20m', 'max-file': '5' }], 'the machine\'s Docker has the same limits');
}

// #984: on a managed machine, a container of the account's Docker, under gVisor and leaving as a computer does (through
// the account's slirp4netns, as its Linux user), is refused a private address, the cloud's
// metadata address and SMTP, each by its rule, and still reaches an internet host on 443 and resolves names. The
// probe tries each "host port" and says how it went: open, or the error.
const PROBE = `const net = require('node:net'), dns = require('node:dns');
const one = (t) => new Promise((ok) => { const [host, port] = t.split(' '); const s = net.connect({ host, port: Number(port) });
  const end = (r) => { s.destroy(); ok(r); }; s.setTimeout(10000, () => end('timeout')); s.on('connect', () => end('open')); s.on('error', (e) => end(e.code)); });
(async () => { const out = {}; for (const t of process.argv.slice(1)) out[t] = await one(t);
  out.dns = await new Promise((ok) => dns.lookup('github.com', (e) => ok(e ? e.code : 'ok'))); console.log(JSON.stringify(out)); })();`;
function computersAreGuarded(machine) {
  stage.step('a computer is refused private addresses, the metadata address and SMTP, and reaches the internet');
  const image = machine.exec('sh', '-c', `sed -n 's/^BOT_DOT_IMAGE=//p' ${HOME}/.env`);
  // A private address outside the account's own networks (its Docker's bridges in 172.16/12 and 192.168/16, slirp4netns's
  // 10.0.2/24), so that the connection leaves through slirp4netns, as one to the provider's private network would.
  const priv = '10.255.255.1';
  // The packets each of the guard's rules refused: its line in `iptables -L -v -x -n`, by what it matches.
  const counts = () => {
    const lines = machine.exec('iptables', '-L', 'BOTDOT-GUARD', '-v', '-x', '-n').split('\n');
    const of = (what) => Number(lines.find((l) => l.includes('REJECT') && l.includes(what))?.trim().split(/\s+/)[0] ?? NaN);
    return { private: of('172.16.0.0/12') + of('10.0.0.0/8') + of('192.168.0.0/16'), metadata: of('169.254.0.0/16'), smtp: of('25,465') };
  };
  const before = counts();
  const targets = [`${priv} 80`, '169.254.169.254 80', '1.1.1.1 25', '1.1.1.1 443'];
  const said = JSON.parse(machine.account(ADMIN, 'run', '--rm', '--entrypoint', 'node', image, '-e', PROBE, ...targets));
  const after = counts();
  for (const t of targets.slice(0, 3)) assert.notEqual(said[t], 'open', `${t} is refused: ${JSON.stringify(said)}`);
  assert.ok(after.private > before.private, `the private address by its rule: ${JSON.stringify({ before, after })}`);
  assert.ok(after.metadata > before.metadata, `the metadata address by its rule: ${JSON.stringify({ before, after })}`);
  assert.ok(after.smtp > before.smtp, `port 25 by its rule: ${JSON.stringify({ before, after })}`);
  assert.equal(said['1.1.1.1 443'], 'open', `an internet host on 443 is reached: ${JSON.stringify(said)}`);
  assert.equal(said.dns, 'ok', 'and names resolve');
  // Only the accounts' Linux users go through the guard: the front door's and Caddy's traffic doesn't.
  assert.equal(machine.exec('iptables', '-S', 'BOTDOT-EGRESS').split('\n').filter((l) => l.includes('--uid-owner')).length, 1, 'one account, one user');
}

// A stand-in tailscaled for root's Tailscale folder (#106): it notes its arguments there and listens on its socket, as
// botdot-tailscale waits for (deploy/desktop/botdot-tailscale), and a state that holds a login, as tailscaled keeps it
// once approved.
const TAILSCALE_DIR = '/var/lib/botdot-tailscale';
const TAILSCALED = `#!/usr/bin/python3
import json, socket, sys, time
open('${TAILSCALE_DIR}/tailscaled.args', 'w').write(json.dumps(sys.argv[1:]))
s = socket.socket(socket.AF_UNIX); s.bind([a.split('=', 1)[1] for a in sys.argv if a.startswith('--socket=')][0]); s.listen(); time.sleep(600)
`;
const SIGNED_IN = JSON.stringify({ _machinekey: Buffer.from('privkey:00').toString('base64'), _profiles: Buffer.from(JSON.stringify({ a1b2: { ID: 'a1b2' } })).toString('base64') });

// What the bots keep on the account's computer outlives a stop under gVisor (#68), as when the machine restarts: a file
// in box's home, its SSH folder and its Tailscale login, which botdot starts again as the computer starts. A bot's
// reset erases only an old computer of its own, never the account's (#104).
function computerKeepsItsFiles(machine, id, container) {
  const computer = (action) => machine.api('POST', `/api/bots/${id}/computer`, { action });
  const asBox = (script, ...args) => machine.account(ADMIN, 'exec', '-u', 'box', '-e', 'HOME=/home/box', container, 'sh', '-c', script, 'sh', ...args);
  const asRoot = (script, ...args) => machine.account(ADMIN, 'exec', '-u', 'root', container, 'sh', '-c', script, 'sh', ...args);
  const startedAgain = (why) => {
    const args = JSON.parse(asRoot(`cat ${TAILSCALE_DIR}/tailscaled.args`));
    assert.ok(args.includes(`--statedir=${TAILSCALE_DIR}/state`), why);
  };
  stage.step(`writing into box's home and root's Tailscale folder on the account's computer, then stopping it and starting it for bot ${id}`);
  assert.equal(computer('start').status, 200);
  asBox('set -e; echo kept > ~/kept.txt; mkdir -p ~/.ssh; echo key > ~/.ssh/id_test');
  asRoot(`set -e; mkdir -p ${TAILSCALE_DIR}/bin ${TAILSCALE_DIR}/state; cd ${TAILSCALE_DIR}`
    + '; printf %s "$1" > bin/tailscaled; printf "#!/bin/sh\\n" > bin/tailscale; chmod 755 bin/*'
    + '; printf %s "$2" > state/tailscaled.state', TAILSCALED, SIGNED_IN);
  machine.account(ADMIN, 'stop', '-t', '5', container);
  assert.equal(computer('start').body.state, 'running');
  assert.equal(asBox('cat ~/kept.txt ~/.ssh/id_test'), 'kept\nkey', 'the home is there after a stop and a start under gVisor');
  startedAgain('Tailscale is started again, as root, from its saved login');

  stage.step(`resetting the computer of bot ${id}`);
  assert.equal(computer('reset').body.state, 'running', 'the account\'s computer stays on');
  assert.equal(asBox('cat ~/kept.txt'), 'kept', 'and keeps what the bots made');

  // #107: an update makes the account's computer again with the same volumes; a reset erases them, for every bot.
  stage.step("updating the account's computer: box's home and root's Tailscale folder stay on their volumes");
  asRoot(`rm ${TAILSCALE_DIR}/tailscaled.args`);
  const updated = machine.api('POST', '/api/computer/update');
  assert.equal(updated.body.updated, true, JSON.stringify(updated.body));
  assert.equal(asBox('cat ~/kept.txt'), 'kept', 'an update keeps the home');
  startedAgain('and the computer\'s Tailscale login, which starts it again (#106)');
  stage.step("resetting the account's computer for every bot");
  assert.equal(machine.api('POST', '/api/computer/reset').body.erased, true);
  assert.equal(computer('start').body.state, 'running');
  assert.equal(asBox('cat ~/kept.txt 2>/dev/null || echo gone'), 'gone', 'a reset erases the home');
}

// The admin's account: its own Linux user, its rootless Docker under gVisor, its botdot server in it, its socket.
function accountIsWalledOff(machine) {
  assert.equal(machine.exec('stat', '-c', '%U', HOME), `botdot-${ADMIN}`, 'the account\'s own Linux user');
  assert.equal(machine.account(ADMIN, 'info', '--format', '{{.DefaultRuntime}}'), 'runsc');
  assert.match(machine.account(ADMIN, 'info', '--format', '{{.SecurityOptions}}'), /rootless/);
  const server = machine.account(ADMIN, 'compose', '--project-directory', HOME, 'ps', '-q', 'bot-dot');
  assert.match(server, /^[0-9a-f]{12,64}$/, 'its botdot server runs in its own Docker');
  const { HostConfig } = JSON.parse(machine.account(ADMIN, 'inspect', server))[0];
  assert.equal(HostConfig.Runtime, 'runsc-uds', 'the server alone reaches host sockets, not a bot\'s computer (#72)');
  assert.notEqual(HostConfig.NetworkMode, 'host', 'on a network of its own');
  assert.equal(machine.inner('ps', '-q', '--filter', 'label=com.docker.compose.service=bot-dot'), '', 'nothing of the account runs in the machine\'s Docker');
  // Its socket: only the front door's user gets in, another user of the machine doesn't.
  machine.exec('useradd', '--create-home', 'mallory');
  const sock = `${DIR}/sockets/${ADMIN}/botdot.sock`;
  assert.equal(machine.exec('su', '-s', '/bin/sh', 'botdot-door', '-c', `test -S ${sock} && echo in`), 'in', 'the front door\'s user reaches the socket');
  assert.equal(machine.exec('su', '-s', '/bin/sh', 'mallory', '-c', `test -e ${sock} && echo in || echo out`), 'out', 'another user of the machine doesn\'t');
}

// The docker-helper holds the account's Docker socket, so a flaw in it should give as little as possible: it runs
// with no-new-privileges and without any capability.
function helperHasNoPrivileges(machine) {
  const helper = machine.account(ADMIN, 'compose', '--project-directory', HOME, 'ps', '-q', 'docker-helper');
  assert.match(helper, /^[0-9a-f]{12,64}$/, 'the docker-helper runs');
  const { HostConfig } = JSON.parse(machine.account(ADMIN, 'inspect', helper))[0];
  assert.deepEqual(HostConfig.SecurityOpt, ['no-new-privileges:true'], 'the helper gains no privileges');
  assert.deepEqual(HostConfig.CapDrop, ['ALL'], 'the helper drops every capability');
  assert.deepEqual(HostConfig.CapAdd ?? [], [], 'and adds none back');
}

// install.sh stopped with `sentence`, and nothing of botdot's was downloaded or started (#430).
function refusedBeforeAnyPull(machine, result, sentence) {
  assert.notEqual(result.status, 0, `the installer stops:\n${result.stdout}\n${result.stderr}`);
  assert.ok(result.stderr.includes(sentence), `it says what it refused and why:\n${result.stderr}`);
  assert.deepEqual(machine.downloads(), [], 'nothing was downloaded from the registry');
  assert.ok(!machine.inner('image', 'ls', '--format', '{{.Repository}}').split('\n').some((r) => r.startsWith(REGISTRY)), 'no image of botdot\'s is on the machine');
  assert.equal(machine.inner('ps', '-a', '--filter', 'label=com.docker.compose.project=botdot', '-q'), '', 'nothing was started');
  assert.equal(machine.exec('sh', '-c', `id botdot-${ADMIN} >/dev/null 2>&1 && echo made || echo none`), 'none', 'no account was made');
}

const cases = [
  {
    // Today's installer, with the images in a registry, on a public domain: what a stranger gets.
    name: 'a public install from the registry, the admin\'s sign-up through Caddy, and a computer under gVisor',
    async run(machine) {
      await machine.load(stage.server());
      await machine.load(stage.computer());
      machine.publish(stage.server(), `${SERVER}:latest`);
      machine.publish(stage.computer(), `${DESKTOP}:latest`);
      // Signed with the key the machine trusts, as the image workflow signs botdot's (#430).
      const server = machine.sign(`${SERVER}:latest`, { app: 'server' });
      const computer = machine.sign(`${DESKTOP}:latest`, { app: 'desktop' });
      assert.ok(!machine.inner('image', 'ls', '--format', '{{.Repository}}').split('\n').some((r) => r.startsWith(REGISTRY)), 'nothing of botdot is on the machine yet');

      stage.step('install.sh');
      const said = machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
      assert.match(said, /botdot image is up to date/);
      assert.match(said, /Bots' computer image is up to date/, `the installer downloads the bots' computer now:\n${said}`);
      assert.match(said, /The front door is running/);
      assert.match(said, new RegExp(`The account ${ADMIN} is running`));
      assert.match(said, new RegExp(`Caddy answers on https://${DOMAIN.replace('.', '\\.')}`));
      assert.match(said, /Time zone UTC/, 'a machine without a time zone gets UTC');
      assert.ok(said.includes(ROOT_REACHES), `the installer says that root reaches every account:\n${said}`);
      assert.ok(said.indexOf(ROOT_REACHES) < said.indexOf('/sign-up/'), 'before the link');
      assert.ok(said.includes(`Until it is used, botdot shows only "${NOT_YET}".`));
      const ready = readyOf(said);
      assert.equal(ready.origin, `https://${DOMAIN}`);
      assert.equal(ready.reach, 'public');
      assert.match(ready.version, /^[0-9a-f]{7,12}$/);
      assert.deepEqual(ready.accounts, [ADMIN]);
      assert.ok(said.includes(`  ${ready.signUp}\n`), `signUp is the admin's link the installer printed:\n${said}`);

      // What was checked is what runs: both images pinned by their signed digests, in the account's Docker.
      const env = machine.exec('cat', `${HOME}/.env`);
      assert.ok(env.includes(`BOT_DOT_IMAGE=${server}\n`) && env.includes(`BOT_DOT_COMPUTER_IMAGE=${computer}\n`), `the signed images are pinned:\n${env}`);
      assert.match(env, /^TZ=UTC$/m);
      const running = machine.account(ADMIN, 'compose', '--project-directory', HOME, 'ps', '-q', 'bot-dot');
      assert.equal(JSON.parse(machine.account(ADMIN, 'inspect', running))[0].Config.Image, server);
      assert.ok(machine.downloads().some((request) => request.includes('/blobs/')), 'the registry\'s log shows what was downloaded, which the refused installs are checked by');
      accountIsWalledOff(machine);
      helperHasNoPrivileges(machine);
      logsStayWithinLimit(machine, server);
      assert.equal(machine.exec('sh', '-c', 'iptables -S BOTDOT-EGRESS >/dev/null 2>&1 && echo there || echo none'), 'none', 'a machine that isn\'t managed has no guard of its computers (#984)');

      stage.step('botdot before the sign-up, and the admin\'s sign-up through Caddy');
      const before = machine.api('GET', '/sign-in');
      assert.equal(before.status, 200);
      assert.ok(String(before.body).includes(NOT_YET), `until the link is used, botdot shows only that:\n${before.body}`);
      assert.equal(machine.api('GET', '/api/status').status, 401, 'and nothing of an account');
      machine.signUp(said);
      const status = answers(machine);
      assert.equal(status.docker.image, true, 'botdot sees the bots\' computer image');
      const { id, container } = startComputer(machine, computer);
      computerKeepsItsFiles(machine, id, container);

      stage.step('install.sh again');
      const again = machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
      assert.doesNotMatch(again, /\/sign-up\//, `once the account is made there is no link:\n${again}`);
      assert.ok(again.includes(ROOT_REACHES));
      assert.deepEqual(readyOf(again), { origin: `https://${DOMAIN}`, version: ready.version, reach: 'public', accounts: [ADMIN] }, 'no signUp once the account exists');
      answers(machine);

      stage.step("root's update ends with the line too");
      const updated = machine.exec('sh', `${DIR}/bin/install.sh`, '--update');
      assert.deepEqual(readyOf(updated), { origin: `https://${DOMAIN}`, version: ready.version, reach: 'public', accounts: [ADMIN] }, `the version it runs:\n${updated}`);
      answers(machine);
    },
  },
  {
    // #882: the desktop app's botdot, on this computer only: one account at http://localhost:4700, no Caddy, no
    // Tailscale, no admin page, its passkey made with the setup key the installer printed in its one line for the app.
    name: 'a local install: one account on localhost, made with the setup key, and a rerun that keeps it',
    async run(machine) {
      await machine.load(stage.server());
      await machine.load(stage.computer());
      machine.publish(stage.server(), `${SERVER}:latest`);
      machine.publish(stage.computer(), `${DESKTOP}:latest`);
      machine.sign(`${SERVER}:latest`, { app: 'server' });
      machine.sign(`${DESKTOP}:latest`, { app: 'desktop' });
      const ORIGIN = 'http://localhost:4700';
      // botdot as the app's window reaches it: http://localhost:4700 on the machine itself, with one browser's cookies.
      const local = (method, route, body) => {
        const args = ['exec', '-i', machine.name, 'curl', '-sS', '-b', '/root/local', '-c', '/root/local', '-X', method, '-H', 'X-Bot-Dot: 1', '-w', '\n%{http_code}', `${ORIGIN}${route}`];
        if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
        const out = spawnSync('docker', args, { encoding: 'utf8', timeout: 10 * 60_000, input: body === undefined ? '' : JSON.stringify(body) }).stdout;
        const at = out.lastIndexOf('\n');
        let parsed = out.slice(0, at);
        try { parsed = JSON.parse(parsed); } catch { /* not JSON */ }
        return { status: Number(out.slice(at + 1)), body: parsed };
      };
      // The app's line, just before the one for a program (#981), which carries no setup key.
      const lineOf = (said) => {
        const ready = readyOf(said);
        assert.equal(ready.origin, ORIGIN);
        assert.equal(ready.reach, 'local');
        assert.ok(!('signUp' in ready), `the setup key stays in the app's line alone:\n${said}`);
        const app = said.trim().split('\n').at(-2);
        assert.match(app, /^BOTDOT_LOCAL \{/, `the line before it is the app's:\n${said}`);
        return JSON.parse(app.slice('BOTDOT_LOCAL '.length));
      };

      stage.step('install.sh, local');
      const said = machine.install({ BOT_DOT_REACH: 'local', BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
      assert.match(said, /The front door is running/);
      assert.match(said, new RegExp(`The account ${ADMIN} is running`));
      assert.match(said, /Reachable on this computer only, at http:\/\/localhost:4700/);
      assert.doesNotMatch(said, /Caddy|Tailscale|admin page|Whoever is root/, `nothing of a server's install:\n${said}`);
      const line = lineOf(said);
      assert.equal(line.origin, ORIGIN);
      const key = new URL(line.signUp).pathname.slice('/sign-up/'.length);
      assert.equal(said.split(key).length, 2, 'the setup key is on the screen in that line alone');
      assert.match(machine.exec('stat', '-c', '%a %U', `${DIR}/front-door/.env`), /^600 root$/, 'and kept where only root reads it');
      assert.ok(!machine.inner('ps', '--format', '{{.Names}}').includes('caddy'), 'no Caddy runs');
      assert.match(machine.exec('iptables', '-S', 'BOTDOT-LOCAL'), /-d 192\.168\.0\.0\/16 -j REJECT/, 'the VM keeps away from the computer and its network');

      stage.step('the passkey, made with the setup key on localhost');
      const at = new URL(line.signUp).pathname;
      const options = local('POST', `${at}/options`, { name: ADMIN });
      assert.equal(options.status, 200, `the sign-up page asks for a passkey: ${JSON.stringify(options.body)}`);
      const pass = passkey.create({ rpId: 'localhost', origin: ORIGIN });
      const made = local('POST', at, { name: ADMIN, credential: pass.register(options.body.publicKey) });
      assert.equal(made.status, 201, `the account is made: ${JSON.stringify(made.body)}`);
      const version = local('GET', '/api/version');
      assert.equal(version.status, 200);
      assert.notEqual(version.body.frontDoor, true, "the account's own botdot server answers");
      const status = local('GET', '/api/status');
      assert.equal(status.body.docker.ok, true, `botdot reaches Docker through its helper: ${JSON.stringify(status.body.docker)}`);
      assert.equal(status.body.docker.image, true, "and sees the bots' computer image");
      assert.notEqual(local('GET', at).status, 200, 'the setup key opens nothing once the account exists');
      const session = local('GET', '/front-door/session');
      assert.equal(session.status, 200);
      assert.equal(session.body.account, ADMIN);
      assert.equal(session.body.admin, false, 'no admin page');

      stage.step('install.sh again');
      const again = machine.install({ BOT_DOT_REACH: 'local', BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
      assert.deepEqual(lineOf(again), { origin: ORIGIN }, 'once the account is made, no sign-up address');
      assert.equal(local('GET', '/api/version').status, 200, 'the same browser is still signed in: account and passkey kept');
    },
  },
  {
    // #983 (ADR 154): a managed machine of one account on a public domain: no admin page, its passkey made with the
    // setup key's link, and a rerun that turns it into a machine of several and keeps the account and its passkey.
    name: 'a managed install: one account without an admin page, then several, keeping the account',
    async run(machine) {
      await machine.load(stage.server());
      await machine.load(stage.computer());
      machine.publish(stage.server(), `${SERVER}:latest`);
      machine.publish(stage.computer(), `${DESKTOP}:latest`);
      machine.sign(`${SERVER}:latest`, { app: 'server' });
      machine.sign(`${DESKTOP}:latest`, { app: 'desktop' });
      const IMAGES = { BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` };

      stage.step('install.sh, managed, one account');
      const said = machine.install({ ...IMAGES, BOT_DOT_MANAGED: '1', BOT_DOT_VARIANT: 'one' });
      assert.match(said, /The front door is running/);
      assert.match(said, new RegExp(`The account ${ADMIN} is running`));
      assert.doesNotMatch(said, /admin page|\/admin/, `no admin page is named:\n${said}`);
      const env = machine.exec('cat', `${DIR}/front-door/.env`);
      assert.match(env, /^FRONT_DOOR_MANAGED=1$/m);
      assert.match(env, new RegExp(`^FRONT_DOOR_ONE_ACCOUNT=${ADMIN}$`, 'm'));
      assert.match(machine.exec('cat', `${HOME}/share/share.json`), /^\{"cpu":4,"ram":8\}$/, 'the managed share');
      assert.equal(machine.api('GET', '/admin').status, 404, 'no admin page');

      const ready = readyOf(said);
      assert.equal(ready.variant, 'one');
      assert.match(ready.signUp, new RegExp(`^https://${DOMAIN.replace('.', '\\.')}/sign-up/[0-9a-f]{64}$`), "the setup key's link");

      stage.step('the passkey, made with the setup key');
      machine.signUp(ready.signUp);
      answers(machine);
      computersAreGuarded(machine);
      answers(machine);
      assert.equal(machine.api('GET', '/admin').status, 404, 'not for the account either');
      assert.equal(machine.api('GET', '/front-door/session').body.admin, false);

      // #985: the links the admin page makes elsewhere, asked of root's step by root, kept where only root and the
      // front door read them, and in no log.
      const linkAsked = async (request, file, text = '') => {
        machine.exec('rm', '-f', `${DIR}/front-door/status/${file}`);
        machine.exec('sh', '-c', `printf '%s' '${text}' > ${DIR}/front-door/requests/${request}`);
        return until(`root's step to answer ${request}`, () => {
          const said = JSON.parse(machine.exec('sh', '-c', `cat ${DIR}/front-door/status/${file} 2>/dev/null || echo null`));
          return said && ['made', 'refused', 'failed'].includes(said.state) ? said : null;
        }, 5 * 60_000);
      };
      stage.step("a sign-in link and a refused sign-up link, asked of root's step");
      const signIn = await linkAsked(`SIGN-IN-${ADMIN}`, `sign-in-${ADMIN}.json`);
      assert.equal(signIn.state, 'made', JSON.stringify({ ...signIn, url: undefined }));
      assert.equal(signIn.account, ADMIN);
      assert.match(machine.exec('stat', '-c', '%a %U %G', `${DIR}/front-door/status/sign-in-${ADMIN}.json`), /^640 root botdot-door$/);
      machine.signUp(signIn.url, ADMIN, { jar: 'lost-every-device' });
      assert.equal(machine.api('GET', '/front-door/session', undefined, { jar: 'lost-every-device' }).body.account, ADMIN, 'the new passkey signs in');
      assert.equal(machine.api('GET', new URL(signIn.url).pathname).status, 410, 'once');
      const noSignUp = await linkAsked('SIGN-UP', 'sign-up.json');
      assert.equal(noSignUp.state, 'refused', 'a machine of one account takes no sign-up link');
      const token = new URL(signIn.url).pathname.split('/').pop();
      const audit = machine.exec('cat', `${DIR}/front-door/data/audit.jsonl`);
      assert.match(audit, /"actor":"console","action":"sign-in-link"/);
      assert.match(audit, /"actor":"console","action":"link-refused"/);
      const logs = machine.exec('sh', '-c', `journalctl -u botdot-accounts --no-pager 2>/dev/null; cat ${DIR}/requests.log 2>/dev/null; true`) + machine.exec('docker', 'compose', '--project-directory', `${DIR}/front-door`, 'logs', '--no-color');
      for (const [where, text] of [['the audit log', audit], ["root's step's and the front door's logs", logs]]) assert.ok(!text.includes(token), `the link is not in ${where}`);

      stage.step('install.sh again, several accounts');
      const again = machine.install({ ...IMAGES, BOT_DOT_VARIANT: 'several' });
      assert.match(again, /This machine now holds several accounts: its accounts and passkeys are kept/);
      assert.doesNotMatch(again, /\/sign-up\//, `the account exists, so no link:\n${again}`);
      assert.deepEqual(readyOf(again), { origin: `https://${DOMAIN}`, version: ready.version, reach: 'public', variant: 'several', accounts: [ADMIN] });
      assert.match(machine.exec('cat', `${DIR}/front-door/.env`), new RegExp(`^FRONT_DOOR_FIRST_ACCOUNT=${ADMIN}$`, 'm'));
      answers(machine);
      assert.equal(machine.api('GET', '/admin').status, 404);
      const signUp = await linkAsked('SIGN-UP', 'sign-up-bea.json', 'bea');
      assert.equal(signUp.state, 'made', JSON.stringify({ ...signUp, url: undefined }));
      assert.equal(signUp.account, 'bea');
      assert.ok([200, 409].includes(machine.api('GET', new URL(signUp.url).pathname).status), 'its page, or the machine is full');

      stage.step('back to one account, which it still is');
      assert.equal(machine.tryInstall({ ...IMAGES, BOT_DOT_VARIANT: 'one' }).status, 0, 'with no other account it goes back');
    },
  },
  {
    // #76: `install.sh --uninstall` after an install leaves nothing of botdot's: no botdot-* user, unit, container,
    // AppArmor profile or BOT_DOT_DIR, and the machine's Docker still works, with what else it ran.
    name: 'an uninstall after an install leaves nothing of botdot, and Docker works',
    async run(machine) {
      await machine.load(stage.server());
      machine.publish(stage.server(), `${SERVER}:latest`);
      machine.sign(`${SERVER}:latest`, { app: 'server' });
      stage.step('install.sh');
      machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest` });
      assert.equal(machine.api('GET', '/api/version').status, 200, 'botdot answers');
      const uninstall = (input) => spawnSync('docker', ['exec', '-i', machine.name, 'sh', '/root/install.sh', '--uninstall'], { input, encoding: 'utf8', timeout: 10 * 60_000 });
      const botdotUsers = () => machine.exec('sh', '-c', "getent passwd | cut -d: -f1 | grep '^botdot-' || true");
      assert.match(botdotUsers(), new RegExp(`^botdot-${ADMIN}$`, 'm'));

      stage.step('install.sh --uninstall, answering no');
      const no = uninstall('no\n');
      assert.notEqual(no.status, 0);
      assert.match(no.stdout, new RegExp(`This removes botdot from this machine for good:\\n.*the front door.*\\n.*the account ${ADMIN}:`));
      assert.match(no.stdout, /Type yes to remove all of it: /);
      assert.match(no.stderr, /Nothing was removed\./);
      assert.equal(machine.api('GET', '/api/version').status, 200, 'botdot still answers');

      stage.step('install.sh --uninstall, answering yes, and yes to the packages');
      const yes = uninstall('yes\ny\n');
      assert.equal(yes.status, 0, `the uninstall ends well:\n${yes.stdout}\n${yes.stderr}`);
      assert.match(yes.stdout, /botdot's installer may have installed these: docker-ce-rootless-extras\./);
      assert.match(yes.stdout, /botdot is removed from this machine\. Docker and Tailscale stay\./);

      assert.equal(botdotUsers(), '', 'no botdot-* user');
      assert.equal(machine.exec('sh', '-c', 'ls /etc/systemd/system /etc/systemd/system.control 2>/dev/null | grep botdot || true'), '', 'no unit');
      // A zombie doesn't run: the test machine's first process may never reap the orphans the uninstall ended.
      assert.equal(machine.exec('sh', '-c', "for f in /proc/[0-9]*/status; do awk '/^Name:/ { n = $2 } /^State:/ { s = $2 } /^Pid:/ { p = $2 } /^Uid:/ { if (n == \"rootlesskit\" && s != \"Z\") print p, s, $2 }' $f 2>/dev/null; done"), '', "no account's rootless Docker runs");
      for (const what of ['ps -a', 'volume ls', 'network ls']) {
        assert.equal(machine.inner(...what.split(' '), '-q', '--filter', 'label=com.docker.compose.project=botdot'), '', `no ${what.split(' ')[0]} of the front door`);
      }
      assert.equal(machine.exec('sh', '-c', 'test -e /etc/apparmor.d/botdot-rootlesskit && echo there || echo gone'), 'gone', 'no AppArmor profile');
      // BOT_DOT_DIR is a volume of the test machine, so its folder stays there, empty.
      assert.equal(machine.exec('sh', '-c', `ls -A ${DIR} 2>/dev/null || true`), '', `nothing in ${DIR}`);
      assert.equal(machine.exec('sh', '-c', 'test -e /run/botdot-accounts && echo there || echo gone'), 'gone');
      assert.equal(machine.exec('sh', '-c', 'grep "^botdot-" /etc/subuid /etc/subgid || true'), '', 'no sub-IDs of an account');

      stage.step('Docker after the uninstall');
      const status = (p) => machine.exec('sh', '-c', `dpkg-query -W --showformat='\${Status}' ${p} 2>/dev/null || true`);
      for (const p of ['docker-ce', 'docker-ce-cli', 'containerd.io']) assert.equal(status(p), 'install ok installed', `${p} stays`);
      assert.notEqual(status('docker-ce-rootless-extras'), 'install ok installed', 'the rootless extras went, as asked');
      assert.equal(machine.inner('inspect', '--format', '{{.State.Running}}', 'registry'), 'true', 'what else the machine ran runs on');
      assert.equal(machine.inner('run', '--rm', '--network', 'none', '--entrypoint', 'echo', REGISTRY_IMAGE, 'works'), 'works', 'Docker runs a container');
    },
  },
  {
    // #430: an image without botdot's signature stops the first install before anything is downloaded.
    name: 'a first install refuses an unsigned image before any pull',
    async run(machine) {
      await machine.load(stage.server());
      await machine.load(stage.computer());
      machine.publish(stage.server(), `${SERVER}:latest`);
      machine.publish(stage.computer(), `${DESKTOP}:latest`);
      machine.sign(`${DESKTOP}:latest`, { app: 'desktop' }); // the server alone is unsigned

      stage.step('install.sh, on an unsigned server image');
      const result = machine.tryInstall({ BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
      refusedBeforeAnyPull(machine, result, `Refused ${SERVER}:latest: it has no botdot signature. Nothing was downloaded or started.`);
    },
  },
  {
    // #430: a signature made with another key than the one the installer trusts is refused the same way.
    name: 'a first install refuses an image signed with another key before any pull',
    async run(machine) {
      await machine.load(stage.server());
      await machine.load(stage.computer());
      machine.publish(stage.server(), `${SERVER}:latest`);
      machine.publish(stage.computer(), `${DESKTOP}:latest`);
      const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
      machine.sign(`${SERVER}:latest`, { app: 'server' });
      machine.sign(`${DESKTOP}:latest`, { app: 'desktop', key: other }); // the computer alone: nothing of botdot's is downloaded either

      stage.step('install.sh, on a computer image signed with another key');
      const result = machine.tryInstall({ BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
      refusedBeforeAnyPull(machine, result, `Refused ${DESKTOP}:latest: it is signed, but not with botdot's release key. Nothing was downloaded or started.`);
    },
  },
  {
    // A self-built botdot server (CONTEXT.md): `make images` named both images without a registry on the
    // machine itself. The installer signs in to and downloads nothing and hands both to the account's Docker, a
    // bot's computer starts from the self-built computer image, Settings says how it is updated, and a rebuild plus
    // a rerun keeps the bot.
    name: 'a self-built install, its computer, and a rebuild',
    async run(machine) {
      await machine.load(stage.server());
      await machine.load(stage.computer());
      machine.inner('tag', stage.server(), SELF_SERVER);
      machine.inner('tag', stage.computer(), SELF_DESKTOP);
      machine.inner('image', 'rm', stage.server(), stage.computer());
      // Any download from it would fail: the registry on the machine is stopped, and it holds nothing.
      machine.inner('stop', 'registry');
      const fromRegistry = () => [machine.inner, (...a) => machine.account(ADMIN, ...a)].flatMap((d) => d('image', 'ls', '--format', '{{.Repository}}').split('\n')).filter((r) => r.startsWith(REGISTRY));

      stage.step('install.sh, self-built');
      let said = machine.install({ BOT_DOT_IMAGE: SELF_SERVER, BOT_DOT_COMPUTER_IMAGE: SELF_DESKTOP });
      assert.match(said, new RegExp(`Using the local image ${SELF_SERVER}\\n`));
      assert.match(said, new RegExp(`Using the local image ${SELF_DESKTOP} for the bots' computer`));
      assert.doesNotMatch(said, /Token:|Downloading/, `no token is asked and nothing downloaded:\n${said}`);
      assert.match(said, new RegExp(`The account ${ADMIN} is running`));
      const env = machine.exec('cat', `${HOME}/.env`);
      assert.match(env, new RegExp(`^BOT_DOT_COMPUTER_IMAGE=${SELF_DESKTOP}$`, 'm'));
      assert.doesNotMatch(env, /BOT_DOT_REGISTRY_TOKEN/);
      assert.equal(machine.account(ADMIN, 'image', 'inspect', '--format', '{{.Id}}', SELF_DESKTOP), machine.idOf(SELF_DESKTOP), 'the account\'s Docker has the self-built computer');

      machine.signUp(said);
      const status = answers(machine);
      assert.equal(status.docker.image, true, 'botdot sees the self-built computer image');
      const { id } = startComputer(machine, SELF_DESKTOP);

      stage.step('an account has no update of its own: the admin updates every account (#473)');
      for (const route of ['/api/updates', '/api/updates/check']) {
        const u = machine.api(route.endsWith('check') ? 'POST' : 'GET', route);
        assert.equal(u.status, 200);
        assert.equal(u.body.byAdmin, true, `${route}: ${JSON.stringify(u.body)}`);
        assert.equal(u.body.available, false);
        assert.equal(u.body.error, null);
      }
      const update = machine.api('POST', '/api/updates/apply', { force: true });
      assert.equal(update.status, 403, `an update from Settings is refused: ${JSON.stringify(update.body)}`);
      assert.match(update.body.error, /admin updates botdot for every account at once/);
      const features = machine.api('GET', '/api/version').body.features;
      assert.ok(features.includes('self-built'));
      assert.ok(!features.includes('updates'));

      stage.step('a rebuild, and install.sh again');
      const before = machine.idOf(SELF_SERVER);
      machine.inner('create', '--name', 'rebuild', SELF_SERVER);
      machine.inner('commit', '--change', 'LABEL dev.botdot.rebuilt=1', 'rebuild', SELF_SERVER);
      machine.inner('rm', 'rebuild');
      const rebuilt = machine.idOf(SELF_SERVER);
      assert.notEqual(rebuilt, before, 'the rebuild is a new image');
      said = machine.install({}); // no names: the rerun keeps the self-built ones
      assert.match(said, new RegExp(`Using the local image ${SELF_SERVER}\\n`));
      assert.doesNotMatch(said, /Token:|Downloading/);
      const running = machine.account(ADMIN, 'compose', '--project-directory', HOME, 'ps', '-q', 'bot-dot');
      assert.equal(machine.account(ADMIN, 'inspect', '--format', '{{.Image}}', running), rebuilt, 'the account runs the rebuilt image');
      answers(machine);
      const bots = machine.api('GET', '/api/bots');
      assert.ok(JSON.stringify(bots.body).includes(`"${id}"`), `the bot is kept: ${JSON.stringify(bots.body).slice(0, 400)}`);
      assert.deepEqual(fromRegistry(), [], 'nothing came from a registry');
    },
  },
  {
    // A botdot from before accounts (ADR 027) is never updated: the installer stops it when asked, installs this
    // version beside it, and leaves its folder as it is.
    name: 'a botdot from before accounts is stopped, and its folder left as it is',
    async run(machine) {
      await machine.load(stage.server());
      machine.inner('tag', stage.server(), SELF_SERVER);
      machine.exec('mkdir', '-p', '/root/bot-dot/data');
      machine.exec('sh', '-c', `printf 'services:\\n  bot-dot:\\n    image: ${SELF_SERVER}\\n    command: ["sleep", "infinity"]\\n' > /root/bot-dot/compose.yaml && echo '{"bots":[]}' > /root/bot-dot/data/bots.json`);
      machine.exec('docker', 'compose', '--project-directory', '/root/bot-dot', 'up', '-d');
      const files = () => machine.exec('sh', '-c', 'cd /root/bot-dot && find . -type f | sort | xargs sha256sum');
      const was = files();

      stage.step('install.sh, saying no');
      const no = machine.tryInstall({ BOT_DOT_IMAGE: SELF_SERVER }, { input: 'n\n' });
      assert.notEqual(no.status, 0);
      assert.match(no.stdout, /botdot from before accounts is installed in \/root\/bot-dot\. This version can't update it/);
      assert.match(no.stderr, /Nothing was changed\./);
      assert.equal(machine.exec('docker', 'compose', '--project-directory', '/root/bot-dot', 'ps', '--format', '{{.State}}', 'bot-dot'), 'running', 'the old botdot still runs');

      stage.step('install.sh, saying yes');
      const said = machine.install({ BOT_DOT_IMAGE: SELF_SERVER }, { input: 'y\n' });
      assert.match(said, /The old botdot is stopped\. Its data is still in its folder\./);
      assert.equal(machine.exec('docker', 'compose', '--project-directory', '/root/bot-dot', 'ps', '-a', '--format', '{{.State}}', 'bot-dot'), 'exited', 'stopped, not removed');
      assert.equal(files(), was, 'its folder is as it was');
      machine.signUp(said);
      answers(machine);
    },
  },
  {
    // #194: an account whose new botdot server doesn't start goes back to the version it ran, the other accounts are
    // updated, and the run ends failed, naming it. The new release starts for every account but the admin's.
    name: 'an account whose new botdot server doesn\'t start runs the version it ran, and the others are updated',
    async run(machine) {
      await machine.load(stage.server());
      machine.publish(stage.server(), `${SERVER}:latest`);
      const server = machine.sign(`${SERVER}:latest`, { app: 'server' });
      stage.step('install.sh, and a second account, bob, from a sign-up link');
      const said = machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest` });
      machine.signUp(said);
      answers(machine);
      const made = machine.api('POST', '/admin/links', {});
      assert.equal(made.status, 201, JSON.stringify(made.body));
      machine.signUp(made.body.url, 'bob', { jar: 'bob' });
      const bobAnswers = () => { const v = machine.api('GET', '/api/version', undefined, { jar: 'bob' }); return v.status === 200 && v.body.frontDoor !== true; };
      await until("bob's botdot server", bobAnswers, 10 * 60_000);
      await until("root's step to be done with bob's request", () => machine.exec('ls', '-A', `${DIR}/front-door/requests`) === '', 60_000);

      stage.step('a new release whose botdot server doesn\'t start for the admin\'s account');
      await machine.load(stage.server());
      machine.inner('create', '--name', 'release-2', stage.server());
      const script = `[ "$BOT_DOT_ACCOUNT" != ${ADMIN} ] || { echo "This release doesn't start for ${ADMIN}." >&2; exit 1; }; exec node lib/privilege-broker.js`;
      machine.inner('commit', '--change', `CMD ${JSON.stringify(['sh', '-c', script])}`, 'release-2', 'release-2:latest');
      machine.inner('rm', '-v', 'release-2');
      machine.inner('image', 'rm', stage.server());
      machine.publish('release-2:latest', `${SERVER}:latest`);
      const release2 = machine.sign(`${SERVER}:latest`, { app: 'server', version: 2 });
      assert.notEqual(release2, server);
      const files = () => machine.exec('sh', '-c', `cd ${HOME} && cat compose.yaml && echo --- && cat .env`);
      const was = files();

      stage.step('install.sh again');
      const result = machine.tryInstall({ BOT_DOT_IMAGE: `${SERVER}:latest` });
      assert.equal(result.status, 1, `the run ends failed:\n${result.stdout}\n${result.stderr}`);
      assert.ok(result.stderr.includes(`Not every account was updated: ${ADMIN}. The others run the new version.`), `it names the account:\n${result.stderr}`);
      assert.ok(result.stdout.includes(`The account ${ADMIN}'s new botdot server didn't start, so it goes back to the version it ran.`), result.stdout);
      assert.ok(result.stdout.includes(`The account ${ADMIN} wasn't updated, and runs the version it ran: Its new botdot server didn't start, so it runs the version it ran before.`), result.stdout);
      assert.match(result.stdout, /The account bob is running/);

      stage.step('the admin\'s account runs the version it ran, bob\'s the new one');
      answers(machine);
      assert.equal(files(), was, 'its compose.yaml and .env are the ones it ran with');
      assert.equal(machine.exec('sh', '-c', `ls -A ${HOME} | grep '\\.before$' || true`), '', 'and nothing of the new version is left beside them');
      const imageOf = (account, service) => {
        const id = machine.account(account, 'compose', '--project-directory', `${DIR}/accounts/${account}`, 'ps', '-q', service);
        return JSON.parse(machine.account(account, 'inspect', id))[0].Config.Image;
      };
      for (const service of ['bot-dot', 'docker-helper']) assert.equal(imageOf(ADMIN, service), server, `the admin's ${service} runs the version it ran`);
      assert.ok(bobAnswers(), "bob's botdot answers");
      assert.equal(imageOf('bob', 'bot-dot'), release2, 'bob runs the new version');
      assert.ok(machine.exec('cat', `${DIR}/accounts/bob/.env`).includes(`BOT_DOT_IMAGE=${release2}\n`), 'pinned in its .env');
    },
  },
  {
    // #986: root's step writes a backup set of the whole machine, and puts it back on a fresh install of the same
    // version on another machine: the owner signs in there with the passkey made on the first, and finds the bot,
    // a file it left in its workspace and a Vault entry that still decrypts.
    name: 'a backup set of the whole machine, put back on a clean machine',
    async run(machine) {
      const images = async (m) => {
        await m.load(stage.server());
        await m.load(stage.computer());
        m.publish(stage.server(), `${SERVER}:latest`);
        m.publish(stage.computer(), `${DESKTOP}:latest`);
        m.sign(`${SERVER}:latest`, { app: 'server' });
        return m.sign(`${DESKTOP}:latest`, { app: 'desktop' });
      };
      const env = { BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` };
      // A request of root's, which the loop of root's step takes, and the status it ends with.
      const ask = async (m, request, file, states) => {
        m.exec('rm', '-f', `${DIR}/front-door/status/${file}`);
        m.exec('touch', `${DIR}/front-door/requests/${request}`);
        return until(`root's step to answer ${request}`, () => {
          const said = JSON.parse(m.exec('sh', '-c', `cat ${DIR}/front-door/status/${file} 2>/dev/null || echo null`));
          return said && states.includes(said.state) ? said : null;
        }, 15 * 60_000);
      };
      const server = (m) => m.account(ADMIN, 'compose', '--project-directory', HOME, 'ps', '-q', 'bot-dot');
      const secretOf = (m, name) => m.account(ADMIN, 'exec', '--user', '60000:60000', server(m), 'node', '-e',
        "const v = require('/opt/bot-dot/lib/vault'); const e = JSON.parse(require('fs').readFileSync('/data/vault.json', 'utf8')).entries.find((x) => x.name === process.argv[1]); process.stdout.write(v.decrypt(e.secret))", name);

      const computerImage = await images(machine);
      stage.step('install.sh on the first machine, a bot with a file in its workspace, and a Vault entry');
      const said = machine.install(env);
      const key = machine.signUp(said);
      answers(machine);
      const { id, container } = startComputer(machine, computerImage);
      machine.account(ADMIN, 'exec', '-u', 'box', container, 'sh', '-c', `echo "kept in the set" > /workspace/${id}/notes.md`);
      const saved = machine.api('POST', '/api/vault', { name: 'Restore test', site: 'https://example.com', username: 'ann', password: 'a secret kept' });
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      assert.equal(secretOf(machine, 'Restore test'), 'a secret kept');

      stage.step('a backup set, asked of root\'s step');
      const done = await ask(machine, 'BACKUP', 'backup.json', ['done', 'failed', 'refused']);
      assert.equal(done.state, 'done', JSON.stringify(done));
      const manifest = JSON.parse(machine.exec('cat', `${DIR}/backup/manifest.json`));
      assert.deepEqual(manifest.accounts, [ADMIN]);
      const parts = manifest.parts.map((p) => p.path);
      for (const p of ['front-door/data.tar', `accounts/${ADMIN}/data.tar`, `accounts/${ADMIN}/env`, `accounts/${ADMIN}/config.tar`, `accounts/${ADMIN}/workspace.tar`, `accounts/${ADMIN}/home.tar`]) {
        assert.ok(parts.includes(p), `the set holds ${p}: ${parts.join(', ')}`);
      }
      assert.match(machine.exec('sh', '-c', `cd ${DIR}/backup && stat -c '%a %U' . manifest.json accounts/${ADMIN}/env | sort -u`), /^600 root\n700 root$/, 'root\'s alone');
      assert.equal(machine.account(ADMIN, 'inspect', '--format', '{{.State.Status}}', container), 'running', 'the computer kept running');

      stage.step('a clean machine, the same version installed on it, and the set put back');
      const other = await stage.machine();
      await images(other);
      const fresh = other.install(env);
      assert.match(fresh, /\/sign-up\//, 'a fresh install, whose admin has no passkey yet');
      spawnSync('sh', ['-c', `docker exec ${machine.name} tar -C ${DIR} -cf - backup | docker exec -i ${other.name} tar -C ${DIR} -xpf -`], { stdio: 'inherit' });
      // A damaged set is refused, and nothing changes.
      other.exec('sh', '-c', `cp ${DIR}/backup/accounts/${ADMIN}/env /root/env && echo X=1 >> ${DIR}/backup/accounts/${ADMIN}/env`);
      const damaged = await ask(other, 'RESTORE', 'restore.json', ['restored', 'failed', 'refused']);
      assert.equal(damaged.state, 'refused', JSON.stringify(damaged));
      assert.match(damaged.error, /doesn't match its checksum/);
      assert.equal(other.api('GET', '/sign-in').status, 200);
      other.exec('cp', '/root/env', `${DIR}/backup/accounts/${ADMIN}/env`);
      const restored = await ask(other, 'RESTORE', 'restore.json', ['restored', 'failed', 'refused']);
      assert.equal(restored.state, 'restored', `${JSON.stringify(restored)}\n${other.exec('tail', '-n', '60', `${DIR}/requests.log`)}`);

      stage.step('the owner signs in on the clean machine with the passkey of the first');
      const options = other.api('POST', '/sign-in/options', {}, { jar: 'restored' });
      assert.equal(options.status, 200, JSON.stringify(options.body));
      const signedIn = other.api('POST', '/sign-in', { credential: key.signIn(options.body.publicKey) }, { jar: 'restored' });
      assert.equal(signedIn.status, 200, `the old passkey signs in: ${JSON.stringify(signedIn.body)}`);
      const bots = other.api('GET', '/api/bots', undefined, { jar: 'restored' });
      assert.ok(JSON.stringify(bots.body).includes(`"${id}"`), `the bot is back: ${JSON.stringify(bots.body).slice(0, 400)}`);
      const started = other.api('POST', `/api/bots/${id}/computer`, { action: 'start' }, { jar: 'restored' });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      const computer = other.account(ADMIN, 'ps', '--filter', 'label=botdot.computer=account', '--format', '{{.Names}}');
      assert.equal(other.account(ADMIN, 'exec', '-u', 'box', computer, 'cat', `/workspace/${id}/notes.md`), 'kept in the set', 'the bot\'s file is in its workspace');
      assert.equal(other.account(ADMIN, 'exec', '-u', 'box', computer, 'stat', '-c', '%U', `/workspace/${id}/notes.md`), 'box', 'and still box\'s');
      assert.ok(JSON.stringify(other.api('GET', '/api/vault', undefined, { jar: 'restored' }).body).includes('Restore test'));
      assert.equal(secretOf(other, 'Restore test'), 'a secret kept', 'the Vault entry decrypts with the restored key');
      stage.remove(other);
    },
  },
  {
    // #979, ADR 155: root's step updates to the version a request names, keeps a snapshot of the account's data before
    // its switch, takes it back on a rollback request, and puts it back when the named version doesn't start.
    name: 'a named update keeps a snapshot of the data, a rollback request restores it, and so does a failed switch',
    async run(machine) {
      const REQUESTS = `${DIR}/front-door/requests`, STATUS = `${DIR}/front-door/status`;
      const read = (file) => { try { return JSON.parse(machine.exec('cat', file)); } catch { return null; } };
      const marker = () => machine.exec('cat', `${HOME}/data/release-marker`);
      const mark = (text) => machine.exec('sh', '-c', `echo ${text} > ${HOME}/data/release-marker && chmod 666 ${HOME}/data/release-marker`);
      const pinned = () => machine.exec('sh', '-c', `sed -n 's/^BOT_DOT_IMAGE=//p' ${HOME}/.env`);
      // A release of the stand-in server: committed with a label of its own (another digest), CMD replacing its command.
      const release = async (n, cmd) => {
        await machine.load(stage.server());
        machine.inner('create', '--name', `release-${n}`, stage.server());
        machine.inner('commit', '--change', `LABEL dev.botdot.test.release=${n}`, ...(cmd ? ['--change', `CMD ${JSON.stringify(cmd)}`] : []), `release-${n}`, `release-${n}:latest`);
        machine.inner('rm', '-v', `release-${n}`);
        machine.inner('image', 'rm', stage.server());
        machine.publish(`release-${n}:latest`, `${SERVER}:release-${n}`);
        return machine.sign(`${SERVER}:release-${n}`, { app: 'server', version: n, revision: String(n).repeat(40) });
      };
      // An update root's step takes from the request file, as the console writes it: how it went.
      const updateTo = async (image) => {
        const was = read(`${STATUS}/update.json`)?.at || '';
        machine.exec('sh', '-c', `echo ${image.split('@')[1]} > ${REQUESTS}/UPDATE`);
        return until(`the update to ${image}`, () => { const u = read(`${STATUS}/update.json`); return u && u.at !== was && u.state !== 'updating' && u; }, 15 * 60_000);
      };

      await machine.load(stage.server());
      machine.publish(stage.server(), `${SERVER}:latest`);
      const one = machine.sign(`${SERVER}:latest`, { app: 'server', version: 1, revision: '1'.repeat(40) });
      stage.step('install.sh, release 1');
      const said = machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest` });
      machine.signUp(said);
      answers(machine);
      mark('release-1');

      stage.step('an update to release 2, named by its digest');
      const two = await release(2);
      const named = await updateTo(two);
      assert.equal(named.state, 'updated', JSON.stringify(named));
      assert.equal(named.named, two.split('@')[1], 'update.json says the version asked for');
      assert.equal(pinned(), two, 'the account runs exactly that release');
      await until('the account on release 2', () => { try { answers(machine); return true; } catch { return false; } }, 5 * 60_000);
      assert.equal(machine.exec('cat', `${HOME}/snapshot/data/release-marker`), 'release-1', 'its data was kept before the switch');
      assert.equal(machine.exec('sh', '-c', `sed -n 's/^BOT_DOT_IMAGE=//p' ${HOME}/snapshot/.env`), one, 'with the version it ran');

      stage.step('a rollback request takes it back to the snapshot and release 1');
      mark('release-2');
      machine.exec('touch', `${REQUESTS}/ROLLBACK-${ADMIN}`);
      const back = await until('the rollback', () => { const a = read(`${STATUS}/account-${ADMIN}.json`); return a && a.state !== 'updated' && a; }, 10 * 60_000);
      assert.equal(back.state, 'rolledback', JSON.stringify(back));
      assert.equal(pinned(), one, 'it runs release 1 again');
      assert.equal(marker(), 'release-1', 'with its data as the snapshot kept it');
      assert.equal(machine.exec('sh', '-c', `ls -A ${HOME} | grep -E '^(snapshot|data\\.after)$' || true`), '', 'the snapshot is used up');
      answers(machine);

      stage.step('an update to release 3, which changes the data and never starts: the snapshot comes back');
      const three = await release(3, ['sh', '-c', 'echo release-3 > /data/release-marker; echo "This release does not start." >&2; exit 1']);
      const failed = await updateTo(three);
      assert.equal(failed.state, 'failed', JSON.stringify(failed));
      assert.deepEqual(failed.accounts.map((a) => [a.name, a.result]), [[ADMIN, 'kept']]);
      assert.equal(pinned(), one, 'it runs the version it ran');
      assert.equal(marker(), 'release-1', 'with its data as it was before the switch');
      answers(machine);
    },
  },
];

stage.run(async () => {
  const only = process.env.INSTALL_REAL_CASE;
  const chosen = cases.filter((c) => !only || c.name.includes(only));
  assert.ok(chosen.length, `no case is named like "${only}"`);
  for (const c of chosen) {
    stage.step(`--- ${c.name}`);
    const machine = await stage.machine();
    await c.run(machine, stage);
    stage.remove(machine);
    stage.step(`passed: ${c.name}`);
  }
  console.log(JSON.stringify({ result: 'PASS', cases: chosen.map((c) => c.name) }));
});
