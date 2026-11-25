// install.sh on a stand-in machine (test/installer-helpers.js): the admin page's update, and whether a newer version
// exists.
// Part 3 of 4 of the update tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, script, installer, withBob } = require('./installer-helpers');

// An update through root's step, as the admin page asks for it, whose account Docker of bob answers with `bobFirst`
// first: what the run said, update.json and bob's home.
function updateWithBob(t, bobFirst) {
  const { first, home } = withBob(t);
  const sock = `${first.run}/bob/docker.sock`;
  fs.appendFileSync(path.join(home, 'compose.yaml'), '# the version before\n');
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: [`if [ "\${DOCKER_HOST:-}" = "unix://${sock}" ]; then ${bobFirst}; fi`] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  const calls = (name) => done.docker.slice(before).filter((c) => c.host === `unix://${first.run}/${name}/docker.sock`).map((c) => c.call);
  return { home, update, calls, log: fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8') };
}

test("an account whose download fails keeps its version, and the update goes on with the others (#194)", (t) => {
  const { update, log, home, calls } = updateWithBob(t, `[ "$1" = pull ] && case "$2" in *bot-dot@*) echo 'write /var/lib/docker/x: no space left on device' >&2; exit 1 ;; esac`);
  assert.equal(update.state, 'failed', log);
  assert.ok(update.accounts, `${JSON.stringify(update)}\n${log}`);
  assert.equal(update.accounts.find((a) => a.name === 'ann').result, 'updated');
  assert.ok(!calls('bob').some((c) => /^compose .* up -d/.test(c)), 'it is not restarted');
  const bob = update.accounts.find((a) => a.name === 'bob');
  assert.equal(bob.result, 'kept');
  assert.match(bob.error, /Couldn't download \S+ for the account bob: write \S+: no space left on device\./);
  assert.match(log, /The account bob wasn't updated, and runs the version it ran/);
  assert.match(fs.readFileSync(path.join(home, 'compose.yaml'), 'utf8'), /# the version before/, 'nothing of it was switched');
});

test("an account whose old version doesn't start again either is said to run no version (#194)", (t) => {
  const { update } = updateWithBob(t, `[ "$1" = compose ] && [ "$4" = up ] && { rm -f "$(sed -n 's/^BOT_DOT_FRONT_DOOR_FOLDER=//p' "$3/.env")/botdot.sock"; exit 0; }`);
  assert.equal(update.state, 'failed');
  const bob = update.accounts.find((a) => a.name === 'bob');
  assert.equal(bob.result, 'failed');
  assert.match(bob.error, /neither the new version nor the one it ran/);
});

test("the admin's update goes on in the installer of the version it installs, from that version's image", (t) => {
  const { first } = withBob(t);
  const bin = path.join(first.dir, 'bin');
  // Root's copy is the version before's: one that wrote no host sockets for the server and the helper, and an older
  // release check beside it.
  const old = fs.readFileSync(path.join(bin, 'install.sh'), 'utf8').replace('RUNSC_UDS_FLAGS="$RUNSC_FLAGS, \\"--host-uds=all\\""', 'RUNSC_UDS_FLAGS="$RUNSC_FLAGS"');
  assert.notEqual(old, script, 'the copy is an older installer');
  fs.writeFileSync(path.join(bin, 'install.sh'), old);
  fs.appendFileSync(path.join(bin, 'lib', 'registry.js'), '// the version before\n');
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const done = installer(t, { again: first, dotenv: '', script: path.join(bin, 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const log = fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8');
  assert.equal(JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8')).state, 'updated', log);
  assert.equal(fs.readFileSync(path.join(bin, 'install.sh'), 'utf8'), script, 'root\'s copy is the new version\'s installer');
  assert.equal(fs.readFileSync(path.join(bin, 'lib', 'registry.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'lib', 'registry.js'), 'utf8'), 'and its release check');
  assert.match(log, /The installer is the new version's/);
  for (const account of ['ann', 'bob']) {
    const daemon = JSON.parse(fs.readFileSync(path.join(first.dir, 'accounts', account, '.config', 'docker', 'daemon.json'), 'utf8'));
    assert.ok(daemon.runtimes['runsc-uds'].runtimeArgs.includes('--host-uds=all'), `${account}'s Docker is set up as the new version needs`);
  }
  // A copy that is the version's own goes on as it is.
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const again = installer(t, { again: first, dotenv: '', script: path.join(bin, 'install.sh'), args: ['--requested'] });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.doesNotMatch(fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8'), /The installer is the new version's/);
});
