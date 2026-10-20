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
const { createStage, until, REGISTRY, SERVER, DESKTOP, DOMAIN, ADMIN, DIR, REGISTRY_IMAGE } = require('./test-install');
// The names `make images` gives a self-built botdot server's images.
const SELF_SERVER = 'bot-dot/server:latest', SELF_DESKTOP = 'bot-dot/desktop:latest';
const HOME = `${DIR}/accounts/${ADMIN}`;
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

  stage.step(`asking to stop the computer of bot ${id}`);
  const stopped = machine.api('POST', `/api/bots/${id}/computer`, { action: 'stop' });
  assert.equal(stopped.status, 409, `the account's computer stays on: ${JSON.stringify(stopped.body)}`);
  assert.equal(machine.account(ADMIN, 'inspect', '--format', '{{.State.Status}}', container), 'running');
  return { id, container };
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

      // What was checked is what runs: both images pinned by their signed digests, in the account's Docker.
      const env = machine.exec('cat', `${HOME}/.env`);
      assert.ok(env.includes(`BOT_DOT_IMAGE=${server}\n`) && env.includes(`BOT_DOT_COMPUTER_IMAGE=${computer}\n`), `the signed images are pinned:\n${env}`);
      assert.match(env, /^TZ=UTC$/m);
      const running = machine.account(ADMIN, 'compose', '--project-directory', HOME, 'ps', '-q', 'bot-dot');
      assert.equal(JSON.parse(machine.account(ADMIN, 'inspect', running))[0].Config.Image, server);
      assert.ok(machine.downloads().some((request) => request.includes('/blobs/')), 'the registry\'s log shows what was downloaded, which the refused installs are checked by');
      accountIsWalledOff(machine);
      helperHasNoPrivileges(machine);

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
      answers(machine);
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
