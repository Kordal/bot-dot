// sudo on the account's computer without setuid (ADR 259, #1562): /usr/local/bin/sudo (deploy/desktop/botdot-sudo) hands
// the command to botdot-sudod, the computer's root process, on a Unix socket, and the helper only asks who is on the
// other end (SO_PEERCRED). Run here as the user running the tests, with a socket in a scratch folder: the plumbing is
// the same as in the computer, the user the command ends up as is not (that is root there; the tests as root check it).
const { linuxOnlyFile } = require('./linux');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

if (!linuxOnlyFile('SO_PEERCRED and descriptor passing are checked against the Linux helper')) {
  const DIR = path.join(__dirname, '..', 'deploy', 'desktop');
  const SUDOD = process.env.BOTDOT_TEST_SUDOD || path.join(DIR, 'botdot-sudod');
  const SUDO = path.join(DIR, 'botdot-sudo');
  const python = spawnSync('python3', ['--version']).status === 0;
  const skip = python ? {} : { skip: 'needs python3' };
  const ROOT = process.getuid() === 0;

  // A helper on a socket of its own, allowing `allow` (user ids), and what stops it.
  function helper(t, { allow = [process.getuid()] } = {}) {
    const dir = fs.mkdtempSync(path.join('/tmp', 'sudo-test-'));
    const socket = path.join(dir, 's');
    const env = { ...process.env, BOTDOT_SUDO_SOCKET: socket, BOTDOT_SUDO_ALLOW: allow.join(',') };
    const child = spawn('python3', ['-I', SUDOD, '--serve'], { env, stdio: 'ignore' });
    t.after(() => { child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); });
    // As root, sudo runs a command itself unless it is asked for a user: -u root makes it use the helper, as box does.
    const sudo = (args, { input, env: more = {}, wait = true } = {}) => {
      const argv = ['-I', SUDO, ...(ROOT ? ['-u', 'root'] : []), ...args];
      if (!wait) return spawn('python3', argv, { env: { ...env, ...more }, stdio: ['ignore', 'pipe', 'pipe'] });
      return spawnSync('python3', argv, { env: { ...env, ...more }, input, encoding: 'utf8', timeout: 20_000 });
    };
    return { dir, socket, env, child, sudo, up: async () => { for (let i = 0; i < 100 && !fs.existsSync(socket); i++) await new Promise((r) => setTimeout(r, 50)); } };
  }

  test("a command runs through the helper: its stdin, stdout, stderr and exit code are the caller's own", skip, async (t) => {
    const h = helper(t);
    await h.up();
    const ok = h.sudo(['-n', 'sh', '-c', 'cat; echo to-stderr >&2; exit 7'], { input: 'from stdin\n' });
    assert.equal(ok.status, 7);
    assert.equal(ok.stdout, 'from stdin\n');
    assert.equal(ok.stderr, 'to-stderr\n');
    assert.equal(h.sudo(['-n', 'true']).status, 0, 'the check botdot makes at each start');
    assert.equal(h.sudo(['-n', 'false']).status, 1);
  });

  test("sudo's environment: reset to what sudo keeps, with HOME, SUDO_USER and a VAR=value; -E keeps all", skip, async (t) => {
    const h = helper(t);
    await h.up();
    const show = 'echo "[$SECRET][$TERM][$LC_ALL][$VAR][$SUDO_UID][$HOME][$LOGNAME][$PATH]"';
    const env = { SECRET: 'kept-out', TERM: 'xterm', LC_ALL: 'C', GIT_CONFIG_SYSTEM: '/x' };
    const out = h.sudo(['-n', 'VAR=given', 'sh', '-c', show], { env });
    assert.equal(out.status, 0, out.stderr);
    // The command runs as the target user (root); here, as the user of the tests, with root's HOME as the helper sets it.
    assert.match(out.stdout, /^\[\]\[xterm\]\[C\]\[given\]\[\d+\]\[\/root\]\[root\]\[\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin\]\n$/);
    assert.match(out.stdout, new RegExp(`\\]\\[${process.getuid()}\\]\\[`));
    const kept = h.sudo(['-n', '-E', 'sh', '-c', 'echo "[$SECRET]"'], { env });
    assert.equal(kept.stdout, '[kept-out]\n');
    assert.equal(h.sudo(['-n', 'sh', '-c', 'echo "[$SUDO_USER]"']).stdout, `[${os.userInfo().username}]\n`);
  });

  test('options are read as sudo reads them: grouped, with a value, after --, and -l, -v, -k', skip, async (t) => {
    const h = helper(t);
    await h.up();
    assert.equal(h.sudo(['-nH', '--', 'printf', '%s', '-n']).stdout, '-n', 'what follows -- is the command');
    assert.equal(h.sudo(['-n', '-D', '/tmp', 'pwd']).stdout, `${fs.realpathSync('/tmp')}\n`);
    assert.equal(h.sudo(['-n', '--chdir=/tmp', 'pwd']).stdout, `${fs.realpathSync('/tmp')}\n`);
    assert.match(h.sudo(['-l']).stdout, /NOPASSWD: ALL/);
    for (const flag of ['-v', '-k', '-K']) assert.equal(h.sudo([flag]).status, 0, flag);
    const bare = h.sudo([]);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /^sudo: a command is required/);
    assert.match(h.sudo(['-Z', 'true']).stderr, /invalid option -- 'Z'/);
    assert.equal(h.sudo(['-s', 'echo', 'in', 'a', 'shell'], { env: { SHELL: '/bin/sh' } }).stdout, 'in a shell\n');
  });

  test('a command that is not there, or a user that is not, is said as sudo says it', skip, async (t) => {
    const h = helper(t);
    await h.up();
    const missing = h.sudo(['-n', 'no-such-command-here']);
    assert.equal(missing.status, 1);
    assert.equal(missing.stderr, 'sudo: no-such-command-here: command not found\n');
    const user = h.sudo(['-n', '-u', 'no-such-user-here', 'true']);
    assert.equal(user.status, 1);
    assert.equal(user.stderr, 'sudo: unknown user no-such-user-here\n');
  });

  test("only the users the helper allows may use it: any other process of the computer, the browser's included, is refused", skip, async (t) => {
    const h = helper(t, { allow: [process.getuid() + 4242] });
    await h.up();
    const out = h.sudo(['-n', 'touch', path.join(h.dir, 'must-not-exist')]);
    assert.equal(out.status, 1);
    assert.equal(out.stderr, 'sudo: you are not allowed to use sudo on this computer\n');
    assert.equal(fs.existsSync(path.join(h.dir, 'must-not-exist')), false);
  });

  test('without a helper sudo says so, and what still works', skip, (t) => {
    const dir = fs.mkdtempSync(path.join('/tmp', 'sudo-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const out = spawnSync('python3', ['-I', SUDO, ...(ROOT ? ['-u', 'root'] : []), '-n', 'true'], { env: { ...process.env, BOTDOT_SUDO_SOCKET: path.join(dir, 'none') }, encoding: 'utf8' });
    assert.equal(out.status, 1);
    assert.match(out.stderr, /^sudo: botdot's root helper on this computer does not answer/);
    assert.match(out.stderr, /botdot-install/);
  });

  test("a signal to sudo reaches the command, and a sudo that is killed ends its command", skip, async (t) => {
    const h = helper(t);
    await h.up();
    const marker = path.join(h.dir, 'm');
    // Ended by TERM: the command's own exit status, 128 + 15.
    const run = h.sudo(['-n', 'sh', '-c', `echo $$ > ${marker}; exec sleep 60`], { wait: false });
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 50));
    const pid = Number(fs.readFileSync(marker, 'utf8'));
    run.kill('SIGTERM');
    const code = await new Promise((r) => run.on('close', r));
    assert.equal(code, 143);
    await new Promise((r) => setTimeout(r, 200));
    assert.throws(() => process.kill(pid, 0), 'the command is gone');
    // The caller killed outright (a bot's command that ran out of time): the command ends with it.
    fs.rmSync(marker);
    const killed = h.sudo(['-n', 'sh', '-c', `echo $$ > ${marker}; exec sleep 60`], { wait: false });
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 50));
    const second = Number(fs.readFileSync(marker, 'utf8'));
    killed.kill('SIGKILL');
    let gone = false;
    for (let i = 0; i < 100 && !gone; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try { process.kill(second, 0); } catch { gone = true; }
    }
    assert.ok(gone, 'a command whose sudo is gone does not run on');
  });

  test('--ensure starts the helper once, and a changed build replaces it after the commands of the old one', skip, async (t) => {
    const dir = fs.mkdtempSync(path.join('/tmp', 'sudo-test-'));
    const copy = path.join(dir, 'botdot-sudod');
    fs.copyFileSync(SUDOD, copy);
    const socket = path.join(dir, 's');
    const env = { ...process.env, BOTDOT_SUDO_SOCKET: socket, BOTDOT_SUDO_ALLOW: String(process.getuid()) };
    const ensure = () => spawnSync('python3', ['-I', copy, '--ensure'], { env, encoding: 'utf8', timeout: 30_000 });
    const pids = [];
    const ask = () => spawnSync('python3', ['-I', '-c', 'import socket,struct,sys\ns=socket.socket(socket.AF_UNIX);s.connect(sys.argv[1]);s.sendall(struct.pack(">I",0));print(s.recv(100).decode())', socket], { encoding: 'utf8' }).stdout.trim();
    t.after(() => { for (const p of pids) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); });
    assert.equal(ensure().status, 0);
    const first = ask().split(' ');
    assert.equal(first[0], 'P');
    pids.push(Number(first[2]));
    assert.equal(ensure().status, 0);
    assert.equal(ask(), first.join(' '), 'a helper of the same build is left as it is');
    fs.appendFileSync(copy, '\n# a newer build\n');
    assert.equal(ensure().status, 0);
    const second = ask().split(' ');
    pids.push(Number(second[2]));
    assert.notEqual(second[1], first[1], 'the new build answers');
    assert.notEqual(second[2], first[2]);
    for (let i = 0; i < 50; i++) { try { process.kill(Number(first[2]), 0); } catch { break; } await new Promise((r) => setTimeout(r, 100)); }
    assert.throws(() => process.kill(Number(first[2]), 0), 'the old helper ended once it had no command');
  });

  test('as root the command runs as the user asked for, with its groups', { skip: ROOT ? false : 'needs root' }, async (t) => {
    const h = helper(t, { allow: [0] });
    await h.up();
    assert.equal(h.sudo(['-n', 'id', '-u']).stdout, '0\n');
    const nobody = h.sudo(['-n', '-u', 'nobody', '-D', '/', 'sh', '-c', 'id -un; echo $HOME']);
    assert.equal(nobody.status, 0, nobody.stderr);
    assert.match(nobody.stdout, /^nobody\n/);
  });

}

test("the computer's image installs the helper, with no sudoers file and no sudo package that needs setuid", () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY botdot-sudo \/usr\/local\/bin\/sudo/);
  assert.match(dockerfile, /COPY botdot-sudod \/usr\/local\/bin\/botdot-sudod/);
  assert.doesNotMatch(dockerfile, /NOPASSWD|sudoers/, 'no sudoers: the helper is the way to root');
  assert.doesNotMatch(dockerfile, /openssh-client sudo/, 'the real sudo is not installed');
});
