// install.sh on a stand-in machine (test/installer-helpers.js): a first install, botdot's signed images, and what
// the installer tells a stranger. The other installer tests are in installer-*.test.js, so that they run side by side.
// Part 4 of 6 of the install tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PIN, SIGNED, installer, rerun } = require('./installer-helpers');

// The log limits every container's Docker gets (#980).
const LOGS = { 'log-driver': 'json-file', 'log-opts': { 'max-size': '20m', 'max-file': '5' } };

const logsOf = (daemon) => ({ 'log-driver': daemon['log-driver'], 'log-opts': daemon['log-opts'] });

const machineDaemon = (done) => path.join(done.etc, 'docker', 'daemon.json');

test("the admin's own Docker settings are kept: the limits join them, and a log driver the admin chose stays (#980)", (t) => {
  const first = rerun(t);
  fs.writeFileSync(machineDaemon(first), '{\n  "registry-mirrors": ["https://mirror.example.com"]\n}\n');
  const joined = installer(t, { again: first });
  assert.equal(joined.status, 0, joined.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(machineDaemon(first), 'utf8')), { ...LOGS, 'registry-mirrors': ['https://mirror.example.com'] });
  assert.match(joined.system.slice(first.system.length), /^systemctl restart docker$/m);
  const own = '{ "log-driver": "journald" }\n';
  fs.writeFileSync(machineDaemon(first), own);
  const kept = installer(t, { again: joined });
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(fs.readFileSync(machineDaemon(first), 'utf8'), own);
  assert.doesNotMatch(kept.system.slice(joined.system.length), /^systemctl restart docker$/m);
});

test('an update of a machine installed before log limits gives them to its Docker and every account\'s, each restarted once (#980)', (t) => {
  const first = rerun(t);
  const account = path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json');
  const before = JSON.parse(fs.readFileSync(account, 'utf8'));
  delete before['log-driver'];
  delete before['log-opts'];
  fs.writeFileSync(account, JSON.stringify(before, null, 2));
  fs.rmSync(machineDaemon(first));
  const update = installer(t, { again: first, args: ['--update'] });
  assert.equal(update.status, 0, `${update.said}\n${update.stderr}`);
  assert.deepEqual(logsOf(JSON.parse(fs.readFileSync(account, 'utf8'))), LOGS);
  assert.deepEqual(JSON.parse(fs.readFileSync(machineDaemon(first), 'utf8')), LOGS);
  const after = update.system.slice(first.system.length);
  assert.equal(after.match(/^systemctl restart docker$/gm).length, 1);
  assert.equal(after.match(/^systemctl restart botdot-account@ann$/gm).length, 1);
});

test("without systemd the machine's Docker gets its log limits in its settings, and the installer says they apply after its restart (#980)", (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(machineDaemon(done), 'utf8')), LOGS);
  assert.doesNotMatch(done.system, /^systemctl restart docker$/m);
  assert.match(done.said + done.stderr, /only after it next restarts/);
});

test('without systemd the account\'s Docker is started now, as its own user, and the installer says it won\'t come back by itself', (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  assert.match(done.system, /^su -s \/bin\/sh botdot-ann -c cd '.+\/accounts\/ann' && exec env HOME='.+\/accounts\/ann' XDG_RUNTIME_DIR='.+\/run\/ann' PATH=\S+ nohup '.+\/dockerd-rootless\.sh' >> '.+\/accounts\/ann\/docker\.log' 2>&1 &$/m);
  assert.doesNotMatch(done.system, /^systemctl (enable|start|restart)/m);
  assert.match(done.said, /This machine has no systemd, so the account ann's Docker was started now and doesn't start again after a restart\./);
});

test('the install prints the admin\'s sign-up link, after it says that full control of the machine reaches every account', (t) => {
  const done = rerun(t);
  const root = done.said.indexOf('Whoever has full control of this machine can reach every account on it: its data, its bots and the logins they hold. Keep that control to yourself.');
  const link = done.said.indexOf('\n  https://botdot.example.com/sign-up/T0KEN\n');
  assert.ok(root > 0 && link > root, done.said);
  assert.ok(done.calls.includes(`compose --project-directory ${done.dir}/front-door exec -T front-door node front-door.js sign-up-link --account ann`));
  assert.match(done.said, /Done\. botdot is at https:\/\/botdot\.example\.com\u001b\[0m\nOpen this link to make your account, ann, the admin's \(it works once, for 7 days\):\n/);
  assert.match(done.said, /Until it is used, botdot shows only "Open the link from your server's install"\./);

  const made = rerun(t, '', {}, { exists: true });
  assert.doesNotMatch(made.said, /\/sign-up\/|Open this link/, 'once the account exists there is no link');
  assert.match(made.said, /Whoever has full control of this machine can reach every account/, 'and the warning stays');
});

test('a machine without rootless Docker, gVisor or setfacl is offered them, and told what they are', (t) => {
  const missing = { 'dockerd-rootless.sh': null, runsc: null, setfacl: null };
  const declined = installer(t, { bins: missing, input: 'n\n', given: { STAND_IN_PACKAGES: 'docker-ce' } });
  assert.equal(declined.status, 1);
  assert.match(declined.said, /Each account runs in a rootless Docker under gVisor, which needs: docker-ce-rootless-extras acl runsc/);
  assert.match(declined.said, /Install them now with apt-get \(gVisor's runsc from gVisor's own repository\)\?/);
  assert.match(declined.stderr, /botdot needs them\. Install them and run this again\./);
  assert.doesNotMatch(declined.system, /apt-get/);

  const agreed = installer(t, { bins: { ...missing, dpkg: '#!/bin/sh\necho amd64\n' }, input: 'y\n', given: { STAND_IN_PACKAGES: 'docker-ce' } });
  assert.match(agreed.system, /^apt-get install -y -qq docker-ce-rootless-extras acl runsc=20261102\.0$/m, 'gVisor at its pinned release');
  assert.equal(fs.readFileSync(path.join(agreed.etc, 'apt', 'sources.list.d', 'gvisor.list'), 'utf8'),
    'deb [arch=amd64 signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases 20261102 main\n',
    "gVisor's source names the release, not the moving channel");
});

test("an update moves gVisor's apt source off the moving channel, and names a runsc of another release", (t) => {
  const first = rerun(t);
  assert.doesNotMatch(first.said + first.stderr, /botdot is tested with/, 'the pinned runsc is not named');
  const list = path.join(first.etc, 'apt', 'sources.list.d', 'gvisor.list');
  fs.mkdirSync(path.dirname(list), { recursive: true });
  fs.writeFileSync(list, 'deb [arch=arm64 signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases release main\n');
  const done = installer(t, { again: first, args: ['--update'], bins: { runsc: '#!/bin/sh\necho "runsc version release-20261005.0"\n' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(fs.readFileSync(list, 'utf8'), 'deb [arch=arm64 signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases 20261102 main\n');
  assert.match(done.said, /gVisor's apt source now holds release 20261102\.0/);
  assert.match(done.said + done.stderr, /gVisor 20261005\.0 is installed; botdot is tested with 20261102\.0\. Once no account is busy: sudo apt-get update && sudo apt-get install --allow-downgrades runsc=20261102\.0/);
  assert.doesNotMatch(done.system, /^apt-get/m, 'runsc is not replaced under running sandboxes');

  const again = installer(t, { again: first, args: ['--update'] });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.doesNotMatch(again.said + again.stderr, /gVisor's apt source now holds|botdot is tested with/, 'once pinned, nothing more is said');
});

test('a botdot from before accounts is never updated: it is stopped only if asked, and its folder is left as it is', (t) => {
  const old = '/home/ann/bot-dot\n';
  const no = installer(t, { dotenv: '', old, input: 'n\n' });
  assert.equal(no.status, 1);
  assert.match(no.said, /botdot from before accounts is installed in \/home\/ann\/bot-dot\. This version can't update it: it is installed again, and you sign in with a passkey\. Its data folder stays as it is; delete it yourself once you're sure you don't need it\./);
  assert.match(no.stderr, /Nothing was changed\./);
  assert.deepEqual(no.calls.filter((c) => !c.startsWith('compose version') && !c.startsWith('version') && c !== '--version' && !c.startsWith('ps ') && !c.startsWith('info')), [], 'nothing else was done');

  const yes = installer(t, { dotenv: '', old, input: 'y\n1\nbotdot.example.com\nann\n' });
  assert.equal(yes.status, 0, yes.stderr);
  assert.ok(yes.calls.includes('compose --project-directory /home/ann/bot-dot stop'), 'stopped, not removed');
  assert.ok(!yes.docker.some((c) => c.call.includes('/home/ann/bot-dot') && !c.call.endsWith(' stop')), 'and nothing else of it is touched');
  assert.match(yes.said, /The old botdot is stopped\. Its data is still in its folder\./);

  const into = installer(t, { dotenv: '', old: '/srv/old-botdot\n', given: { BOT_DOT_DIR: '/srv/old-botdot' }, input: 'y\n' });
  assert.equal(into.status, 1);
  assert.match(into.stderr, /BOT_DOT_DIR is that old install's folder/);
});

test('the installer runs as root, and says so first', (t) => {
  const { status, stderr, docker } = installer(t, { bins: { id: '#!/bin/sh\necho 1000\n' } });
  assert.equal(status, 1);
  assert.match(stderr, /The installer makes a Linux user for each account, so it needs full control of this machine\. Run it with: sudo sh install\.sh/);
  assert.deepEqual(docker, []);
});

test('a rerun installs the newest signed images, into the machine\'s Docker and the account\'s, pinned by digest', (t) => {
  const done = rerun(t, `BOT_DOT_IMAGE=ghcr.io/ladrok/bot-dot${PIN}\nBOT_DOT_COMPUTER_IMAGE=ghcr.io/ladrok/bot-dot-desktop${PIN}\n`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  assert.equal(done.env.BOT_DOT_COMPUTER_IMAGE, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`);
  assert.ok(done.calls.includes(`pull ghcr.io/ladrok/bot-dot${SIGNED}`), 'the front door\'s');
  const own = done.accountCalls('ann');
  assert.ok(own.includes(`pull ghcr.io/ladrok/bot-dot${SIGNED}`) && own.includes(`pull ghcr.io/ladrok/bot-dot-desktop${SIGNED}`), own.join('\n'));
  assert.ok(!done.calls.includes(`pull ghcr.io/ladrok/bot-dot-desktop${SIGNED}`), 'the computer only where it runs');
  assert.ok(!done.docker.some((c) => /^pull .*:latest$/.test(c.call)), 'never the tag, which may have moved since the check');
  const at = (call) => own.indexOf(call);
  assert.ok(at(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`) > at(`pull ghcr.io/ladrok/bot-dot-desktop${SIGNED}`));
  assert.ok(at(`compose --project-directory ${done.dir}/accounts/ann exec -T --user 60000:60000 bot-dot node /opt/bot-dot/lib/update-install.js --clean`) > at(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`), 'the cleanup comes after the new containers');
  // The stand-in gives the cleanup no answer: one warning, and the installer ends as always.
  assert.match(done.said, /Couldn't remove every old image now; the next update tries again\./);
});

test('an update makes room first: the images no container uses go before the new ones are downloaded (#190)', (t) => {
  const was = `ghcr.io/ladrok/bot-dot${PIN}`, desk = `ghcr.io/ladrok/bot-dot-desktop${PIN}`;
  const first = rerun(t, `BOT_DOT_IMAGE=${was}\nBOT_DOT_COMPUTER_IMAGE=${desk}\n`);
  const done = installer(t, { again: first, dotenv: '', args: ['--update'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const calls = done.docker.slice(first.docker.length);
  const at = (host, re) => calls.findIndex((c) => c.host === host && re.test(c.call));
  const cleanup = (sock) => new RegExp(`^run --rm --pull never --network none --user 0:0 -v ${sock}:/var/run/docker\\.sock --entrypoint node \\S+ /opt/bot-dot/lib/image-cleanup\\.js `);
  const own = `unix://${done.run}/ann/docker.sock`;
  // The account's Docker: by the new version's rule, keeping what the account runs now and what is about to come.
  const inAccount = at('machine', cleanup(`${done.run}/ann/docker\\.sock`));
  assert.ok(inAccount >= 0, calls.map((c) => c.call).join('\n'));
  assert.ok(inAccount < at(own, new RegExp(`^pull ghcr\\.io/ladrok/bot-dot@`)), 'before the account\'s download');
  const args = calls[inAccount].call.split(' ');
  assert.equal(args[12], `ghcr.io/ladrok/bot-dot${SIGNED}`, 'run from the new version, already in the machine\'s Docker');
  assert.deepEqual(args.slice(14), [`ghcr.io/ladrok/bot-dot${SIGNED}`, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`, `ghcr.io/ladrok/bot-dot${SIGNED}`, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`]);
  // The machine's Docker: by the rule of the version it runs now, before the front door's download.
  const inMachine = at('machine', cleanup('/var/run/docker\\.sock'));
  assert.ok(inMachine >= 0 && inMachine < at('machine', /^pull ghcr\.io\/ladrok\/bot-dot@/), 'before the machine\'s download');
  const machine = calls[inMachine].call.split(' ');
  assert.equal(machine[12], first.env.BOT_DOT_IMAGE, 'run from what the machine runs now');
  assert.deepEqual(machine.slice(14), [first.env.BOT_DOT_IMAGE, first.env.BOT_DOT_COMPUTER_IMAGE]);
  // The stand-in's cleanup answers nothing: a warning, and the update goes on.
  assert.match(done.said, /Couldn't remove the old images first; the download goes on\./);
});

test('a first install has nothing to make room for in the machine\'s Docker', (t) => {
  const fresh = installer(t, { dotenv: '', input: '1\nbotdot.example.com\nann\n' });
  assert.equal(fresh.status, 0, fresh.stderr);
  const download = fresh.calls.findIndex((c) => c.startsWith('pull ghcr.io/ladrok/bot-dot@'));
  const cleanup = fresh.calls.findIndex((c) => c.includes('-v /var/run/docker.sock:/var/run/docker.sock') && c.includes('image-cleanup.js'));
  assert.ok(download >= 0);
  assert.ok(cleanup === -1 || cleanup > download, 'nothing runs before the first download');
});
