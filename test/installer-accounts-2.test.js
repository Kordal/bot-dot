// install.sh on a stand-in machine (test/installer-helpers.js): new accounts from sign-up links, suspend, resume and
// delete from the admin page, shares of the machine, and the uninstaller.
// Part 2 of 3 of the accounts and uninstaller tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer, withBob } = require('./installer-helpers');

test("root's step starts a resumed account again as it was, and leaves a running one as it is", (t) => {
  const { door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: {} } });
  const running = step('bob');
  assert.match(running.said, /The account bob is made already, and runs/);
  assert.ok(!upIn(running, 'bob'));

  fs.rmSync(started); // suspended: its Docker doesn't answer
  const done = step('bob');
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.match(done.system, /^systemctl enable botdot-account@bob$/m);
  assert.match(done.system, /^systemctl (re)?start botdot-account@bob$/m);
  assert.ok(upIn(done, 'bob'), 'its botdot server starts');
  assert.doesNotMatch(done.system, /^useradd/m, 'the same user, made once');
  assert.doesNotMatch(done.system, /\/accounts\/bob\/data$/m, 'the data folder its restarted server owns stays its');
  assert.match(done.said, /The account bob is running/);
});

test("root's step starts again an account whose Docker runs but whose botdot server doesn't answer", (t) => {
  const { first, door, step, upIn } = withBob(t);
  door({ accounts: { ann: {}, bob: {} } });
  fs.rmSync(path.join(first.dir, 'sockets', 'bob', 'botdot.sock')); // its server stopped
  const done = step('bob');
  assert.match(done.said, /Starting the account bob again/);
  assert.ok(upIn(done, 'bob'), 'its botdot server starts');
  assert.doesNotMatch(done.system, /^useradd/m, 'the same user, made once');
});

test("root's step reads the front door again when it is done, so the admin's resume meanwhile isn't lost", (t) => {
  const { first, door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  // While bob's Docker stops, the admin resumes bob: the front door's data says so, and its request found this one.
  const data = path.join(first.dir, 'front-door', 'data', 'front-door.json');
  const resumed = JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} });
  const systemctl = ['#!/bin/sh', 'echo "systemctl $*" >> "$STAND_IN_LOG"', '[ "$1" = show ] && exit 0',
    `[ "$1" = disable ] && { rm -f "${started}"; printf '%s' '${resumed}' > "${data}"; }`,
    `case "$1" in start|restart) touch "${started}" ;; esac`, 'exit 0', ''].join('\n');
  const done = step('bob', { bins: { systemctl } });
  assert.match(done.said, /The account bob is suspended: it is stopped/);
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.ok(upIn(done, 'bob'), 'bob runs again');
});

test("root's step keeps a request made while it read the front door once more, and the next run takes it", (t) => {
  const { first, door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  const requests = path.join(first.dir, 'front-door', 'requests');
  const data = path.join(first.dir, 'front-door', 'data', 'front-door.json');
  const resumed = JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} });
  fs.writeFileSync(path.join(requests, 'bob'), '');
  // The front door's data is read once more after bob is stopped: while it is read (the file it reads is the one from
  // before), the admin resumes bob, and the front door asks again.
  const resumes = [
    `if [ "$1" = run ] && [ "$5" = node ] && [ "$7" = -e ] && [ ! -e "${requests}/bob" ] && [ ! -e "${first.top}/resumed" ]; then`,
    `  touch "${first.top}/resumed"; printf '%s' '${resumed}' > "${data}.new"; mv "${data}.new" "${data}"; touch "${requests}/bob"`,
    'fi',
  ];
  const suspended = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ["--requested"], dockerFirst: resumes });
  assert.equal(suspended.status, 0, `${suspended.said}\n${suspended.stderr}`);
  assert.match(suspended.said, /The account bob is suspended: it is stopped/);
  assert.ok(fs.existsSync(path.join(requests, 'bob')), 'the new request stays');
  fs.rmSync(started, { force: true });
  const done = step('bob');
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.ok(upIn(done, 'bob'), 'bob runs again');
});

test("root's step erases a deleted account: its Docker, data, socket folder, Linux user and sub-IDs", (t) => {
  const { first, door, step, home, users } = withBob(t);
  fs.mkdirSync(path.join(first.run, 'bob'), { recursive: true });
  door({ accounts: { ann: {} }, deleted: { bob: '2026-10-16T12:00:00.000Z' } });
  const done = step('bob');
  assert.match(done.system, /^systemctl disable --now botdot-account@bob$/m);
  assert.match(done.system, /^userdel botdot-bob$/m);
  assert.ok(fs.existsSync(path.join(first.dir, 'disks', 'bob.img')) === false, 'its disk is gone');
  assert.ok(fs.existsSync(path.join(first.dir, 'disks', 'ann.img')), "ann's stays");
  for (const gone of [home, path.join(first.dir, 'sockets', 'bob'), path.join(first.run, 'bob')]) assert.ok(!fs.existsSync(gone), `${gone} is gone`);
  for (const map of ['subuid', 'subgid']) {
    const ids = fs.readFileSync(path.join(first.etc, map), 'utf8');
    assert.doesNotMatch(ids, /^botdot-bob:/m, `${map} has nothing of bob`);
    assert.match(ids, /^botdot-ann:/m, "ann's stay");
  }
  assert.doesNotMatch(fs.readFileSync(users, 'utf8'), /^botdot-bob:/m);
  assert.match(done.said, /The account bob is erased: its data, containers and Linux user/);
  assert.ok(fs.existsSync(path.join(first.dir, 'accounts', 'ann', 'compose.yaml')), "ann's account is untouched");

  const again = step('bob');
  assert.match(again.said, /The account bob is deleted, and nothing of it is on this machine/);
  assert.doesNotMatch(again.system, /^userdel/m);
});

test("root's step erases nothing the front door doesn't say it deleted, and never the admin's account", (t) => {
  const { first, door, step, home } = withBob(t);
  for (const data of ['{"accounts": {"ann": {}, "bo', JSON.stringify({ accounts: { ann: {} } })]) {
    door(data);
    const done = step('bob');
    assert.match(done.said, /The front door has no account bob, so nothing was done\./);
    assert.doesNotMatch(done.system, /^(userdel|systemctl disable)/m);
    assert.ok(fs.existsSync(path.join(home, 'compose.yaml')));
  }
  door({ accounts: {}, deleted: { ann: '2026-10-16T12:00:00.000Z' } });
  const admin = step('ann');
  assert.match(admin.stderr, /The account ann is the admin's own, so it wasn't erased\./);
  assert.doesNotMatch(admin.system, /^(userdel|systemctl disable)/m);
  assert.ok(fs.existsSync(path.join(first.dir, 'accounts', 'ann', 'compose.yaml')));
});
