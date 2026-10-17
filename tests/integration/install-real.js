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
const { createStage, REGISTRY, SERVER, DESKTOP, DOMAIN, ADMIN, DIR } = require('./test-install');
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

// The owner makes a bot with a computer, starts the computer and stops it, as the web page does. The computer
// is started by the docker-helper from the configured computer image, in the account's Docker, under gVisor.
function startAndStopComputer(machine, image) {
  const created = machine.api('POST', '/api/bots', { name: 'Acceptance', prompt: 'Check that the install works.', computer: 'linux' });
  assert.equal(created.status, 201, `the bot is made: ${JSON.stringify(created.body)}`);
  const { id } = created.body;
  const container = `botdot-${id}`;

  stage.step(`starting the computer of bot ${id}`);
  const started = machine.api('POST', `/api/bots/${id}/computer`, { action: 'start' });
  assert.equal(started.status, 200, `the computer starts: ${JSON.stringify(started.body)}`);
  assert.equal(started.body.state, 'running');
  assert.equal(machine.api('GET', `/api/bots/${id}/computer`).body.state, 'running');
  const made = JSON.parse(machine.account(ADMIN, 'inspect', container))[0];
  assert.equal(made.State.Status, 'running');
  assert.equal(made.Config.Image, image, 'from the configured computer image');
  assert.equal(made.Config.User, 'bot', 'the bot works on it as a normal user');
  assert.equal(made.Config.Labels['botdot.bot'], id);
  assert.equal(made.HostConfig.Runtime, 'runsc', 'under gVisor');
  assert.throws(() => machine.inner('inspect', container), 'and not in the machine\'s own Docker');

  stage.step(`stopping the computer of bot ${id}`);
  const stopped = machine.api('POST', `/api/bots/${id}/computer`, { action: 'stop' });
  assert.equal(stopped.status, 200, `the computer stops: ${JSON.stringify(stopped.body)}`);
  assert.equal(stopped.body.state, 'stopped');
  assert.equal(machine.api('GET', `/api/bots/${id}/computer`).body.state, 'stopped');
  assert.equal(machine.account(ADMIN, 'inspect', '--format', '{{.State.Status}}', container), 'exited');
  return { id, container };
}

// The admin's account: its own Linux user, its rootless Docker under gVisor, its botdot server in it, its socket.
function accountIsWalledOff(machine) {
  assert.equal(machine.exec('stat', '-c', '%U', HOME), `botdot-${ADMIN}`, 'the account\'s own Linux user');
  assert.equal(machine.account(ADMIN, 'info', '--format', '{{.DefaultRuntime}}'), 'runsc');
  assert.match(machine.account(ADMIN, 'info', '--format', '{{.SecurityOptions}}'), /rootless/);
  const server = machine.account(ADMIN, 'compose', '--project-directory', HOME, 'ps', '-q', 'bot-dot');
  assert.match(server, /^[0-9a-f]{12,64}$/, 'its botdot server runs in its own Docker');
  const { HostConfig } = JSON.parse(machine.account(ADMIN, 'inspect', server))[0];
  assert.equal(HostConfig.Runtime, 'runsc');
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
      startAndStopComputer(machine, computer);

      stage.step('install.sh again');
      const again = machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
      assert.doesNotMatch(again, /\/sign-up\//, `once the account is made there is no link:\n${again}`);
      assert.ok(again.includes(ROOT_REACHES));
      answers(machine);
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
      const { id } = startAndStopComputer(machine, SELF_DESKTOP);

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
