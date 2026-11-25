// install.sh on a stand-in machine (test/installer-helpers.js): new accounts from sign-up links, suspend, resume and
// delete from the admin page, shares of the machine, and the uninstaller.
// Part 1 of 4 of the accounts and uninstaller tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, script, installer, rerun, withBob } = require('./installer-helpers');

// --- New accounts from sign-up links (#467) -----------------------------------------------------------

test('the front door asks for new accounts in a folder of its own, and root\'s step is a copy of the installer that systemd starts', (t) => {
  const done = rerun(t);
  const requests = `${done.dir}/front-door/requests`;
  assert.match(done.system, new RegExp(`^chown 0:990 ${requests}$`, 'm'), 'root owns it, the front door\'s group may write in it');
  assert.equal(fs.statSync(requests).mode & 0o777, 0o770);
  const compose = fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8');
  assert.match(compose, /^ {6}- \.\/requests:\/requests /m);
  assert.match(compose, /^ {6}FRONT_DOOR_REQUESTS: \/requests$/m);

  // Root's copy of the installer, which only root can change.
  const bin = `${done.dir}/bin`;
  assert.equal(fs.readFileSync(`${bin}/install.sh`, 'utf8'), script);
  assert.equal(fs.statSync(bin).mode & 0o777, 0o700);
  assert.equal(fs.statSync(`${bin}/install.sh`).mode & 0o777, 0o600);
  assert.match(done.system, new RegExp(`^chown 0:0 ${bin}$`, 'm'));

  const unit = (name) => fs.readFileSync(path.join(done.etc, 'systemd', 'system', name), 'utf8');
  assert.match(unit('botdot-accounts.path'), new RegExp(`^DirectoryNotEmpty=${requests}$`, 'm'));
  assert.match(unit('botdot-accounts.service'), /^Type=oneshot$/m);
  assert.match(unit('botdot-accounts.service'), new RegExp(`^ExecStart=/bin/sh ${bin}/install.sh --requested$`, 'm'), 'one fixed command, nothing from the front door on it');
  assert.doesNotMatch(unit('botdot-accounts.service'), /^User=/m, 'root');
  assert.match(unit('botdot-accounts.service'), new RegExp(`^Environment=BOT_DOT_DIR=${done.dir} BOT_DOT_RUN=${done.run} BOT_DOT_ETC=${done.etc}$`, 'm'), 'the folders this install has');
  assert.match(done.system, /^systemctl enable --now botdot-accounts\.path$/m);
  assert.match(done.said, /Make sign-up links for other people on the admin page: https:\/\/botdot\.example\.com\/admin/);
});

test('without systemd a loop started now takes the requests, and the installer says it won\'t come back by itself', async (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  // Started in the background: the stand-in writes it down a moment after the installer ends.
  const log = path.join(done.top, 'system.log');
  for (let i = 0; i < 50 && !/^nohup /m.test(fs.readFileSync(log, 'utf8')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(fs.readFileSync(log, 'utf8'), /^nohup sh -c i=0; while :; do \[ -z "\$\(ls -A '.+\/front-door\/requests' 2>\/dev\/null\)" \] \|\| BOT_DOT_DIR='.+' BOT_DOT_RUN='.+' BOT_DOT_ETC='.+' sh '.+\/bin\/install\.sh' --requested; \[ \$\(\(i % 20\)\) != 0 \] \|\| BOT_DOT_DIR='.+' BOT_DOT_RUN='.+' BOT_DOT_ETC='.+' sh '.+\/bin\/install\.sh' --load; i=\$\(\(i \+ 1\)\); sleep 3; done$/m, 'and every minute measures the load');
  assert.match(done.said, /This machine has no systemd, so the accounts sign-up links make are made by a loop started now, which doesn't start again after a restart\./);
});

test("root's step makes each account the front door made and asked for, as the install made the admin's, and nothing else", (t) => {
  const first = rerun(t);
  const requests = path.join(first.dir, 'front-door', 'requests');
  fs.writeFileSync(path.join(first.dir, 'front-door', 'data', 'front-door.json'), JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {} }));
  for (const name of ['bob', 'carl', 'ann', 'Bad Name', '.hidden', '..dots', 'dan\nab']) fs.writeFileSync(path.join(requests, name), '');
  fs.mkdirSync(path.join(requests, 'eve'));
  const before = { system: first.system.length, docker: first.docker.length };

  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.deepEqual(fs.readdirSync(requests), [], 'every request is taken');
  const system = done.system.slice(before.system);
  const docker = done.docker.slice(before.docker);

  // bob: made as the admin's account was.
  const home = `${done.dir}/accounts/bob`;
  assert.match(system, new RegExp(`^useradd --no-create-home --home-dir ${home} --shell /usr/sbin/nologin --comment botdot account bob botdot-bob$`, 'm'));
  assert.match(system, /^systemctl enable botdot-account@bob$/m);
  assert.match(system, new RegExp(`^setfacl -m g:botdot-door:x,m::x ${done.dir}/sockets/bob$`, 'm'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.config', 'docker', 'daemon.json'), 'utf8'))['default-runtime'], 'runsc');
  const env = done.accountEnv('bob');
  assert.equal(env.BOT_DOT_ACCOUNT, 'bob');
  assert.equal(env.DOCKER_SOCKET, `${done.run}/bob/docker.sock`);
  assert.equal(env.BOT_DOT_IMAGE, first.accountEnv('ann').BOT_DOT_IMAGE, 'the images the install pinned');
  assert.equal(env.BOT_DOT_COMPUTER_IMAGE, first.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE);
  assert.ok(docker.some((c) => c.host === `unix://${done.run}/bob/docker.sock` && c.call === `compose --project-directory ${home} up -d --remove-orphans`));
  assert.match(done.said, /Making the account bob, which a sign-up link made at the front door/);
  assert.match(done.said, /The account bob is running/);

  // Nothing else: no account the front door doesn't have, no name that isn't one, nothing made twice.
  assert.doesNotMatch(system, /useradd .*botdot-(carl|ann|dan|eve)/);
  assert.match(done.said, /Not an account's name, so nothing was done: danab/, 'a name of two lines is no name');
  assert.match(done.said, /The front door has no account carl, so nothing was done\./);
  assert.match(done.said, /Not an account's name, so nothing was done: BadName/);
  assert.match(done.said, /The account ann is made already/);
  assert.ok(!docker.some((c) => c.host === `unix://${done.run}/ann/docker.sock` && /^compose .* up/.test(c.call)), "ann's botdot server is left as it is");
  // And nothing of the machine: no package, no front door, no Caddy or Tailscale, no unit, no link.
  assert.doesNotMatch(system, /^(apt-get|apparmor_parser|tailscale|systemctl daemon-reload|useradd --system)/m);
  assert.ok(!docker.some((c) => c.host === 'machine' && /^compose --project-directory/.test(c.call)), JSON.stringify(docker));
  assert.doesNotMatch(done.said, /botdot installer|\/sign-up\//);
});

// --- Suspend, resume and delete from the admin page (#470) -------------------------------------------

test("root's step stops a suspended account's Docker, and with it all it runs, and keeps its data and user", (t) => {
  const { door, step, home, upIn, users } = withBob(t);
  fs.writeFileSync(path.join(home, 'data', 'bots.json'), '[]');
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  const done = step('bob');
  assert.match(done.system, /^systemctl disable --now botdot-account@bob$/m, "its Docker stops, and doesn't start with the machine");
  assert.ok(!upIn(done, 'bob'), 'nothing of it is started');
  assert.match(done.said, /The account bob is suspended: it is stopped, and its data kept/);
  assert.ok(fs.existsSync(path.join(home, 'data', 'bots.json')), 'its data stays');
  assert.match(fs.readFileSync(users, 'utf8'), /^botdot-bob:/m, 'its Linux user stays');
  assert.doesNotMatch(done.system, /^(userdel|useradd)/m);
});
