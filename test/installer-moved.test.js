// botdot's images moved from ghcr.io/kordal to ghcr.io/ladrok with the repository: an install that saved or names an
// address of the old one moves to the new by itself, and only after the new one's signature is checked as a first
// install's is (docs/decisions/2026-11-23-an-update-moves-a-saved-kordal-image-to-ladrok.md).
//
// The first test runs the installer's own moved_image and needs only a POSIX shell. The others are install.sh on a
// stand-in machine (test/installer-helpers.js) and run on Linux.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { onLinux } = require('./linux');
const { checked, script, PIN, SIGNED, installer, rerun, status, SELF } = require('./installer-helpers');

const OLD = 'ghcr.io/kordal';
const NEW = 'ghcr.io/ladrok';
const OLD_PINS = `BOT_DOT_IMAGE=${OLD}/bot-dot${PIN}\nBOT_DOT_COMPUTER_IMAGE=${OLD}/bot-dot-desktop${PIN}\n`;
const D = 'b'.repeat(64);

test('moved_image reads a name under the old address as the same name under the new one, and nothing else', () => {
  const body = script.match(/^moved_image\(\) \{\n[\s\S]*?\n\}\n/m);
  assert.ok(body, 'install.sh has moved_image');
  const prelude = `IMAGES=${NEW}\nMOVED_FROM=${OLD}\n`;
  const moved = (image) => {
    const run = (name) => spawnSync('sh', ['-c', `${prelude}${body[0]}\nmoved_image "$1"`, 'sh', name], { encoding: 'utf8' });
    const once = run(image);
    assert.equal(once.status, 0, once.stderr);
    assert.equal(run(once.stdout).stdout, once.stdout, `moving ${image} twice changes nothing more`);
    return once.stdout;
  };
  // A digest names an image of the old repository: it is dropped, never carried over.
  assert.equal(moved(`${OLD}/bot-dot@sha256:${D}`), `${NEW}/bot-dot:latest`);
  assert.equal(moved(`${OLD}/bot-dot-desktop@sha256:${D}`), `${NEW}/bot-dot-desktop:latest`);
  assert.equal(moved(`${OLD}/bot-dot:latest`), `${NEW}/bot-dot:latest`);
  assert.equal(moved(`${OLD}/bot-dot`), `${NEW}/bot-dot:latest`);
  assert.equal(moved(`${OLD}/bot-dot:staging@sha256:${D}`), `${NEW}/bot-dot:staging`);
  // The new address, a self-built image, a mirror, another owner of the same registry and a longer name stay.
  for (const same of [`${NEW}/bot-dot@sha256:${D}`, `${NEW}/bot-dot:latest`, 'bot-dot/server:latest', 'registry.example:5000/team/bot-dot:latest', 'ghcr.io/someone/bot-dot:latest', 'ghcr.io/kordalx/bot-dot:latest', '']) {
    assert.equal(moved(same), same);
  }
});

test("the installer moves the names where it makes them, before the check and the pin that follow, and not in root's step", () => {
  const lines = script.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  const move = at(/^IMAGE="\$\(moved_image "\$IMAGE"\)"$/);
  assert.ok(move > 0 && at(/^COMPUTER_IMAGE="\$\(moved_image "\$COMPUTER_IMAGE"\)"$/) === move + 1, 'both names are moved, where they are made');
  assert.ok(move < at(/^if \[ "\$MODE" = requested \]; then$/), 'before the step that takes the names of .env as they are');
  assert.ok(move < at(/^REGISTRY="\$\(registry_of "\$IMAGE"\)"$/), 'before the registry and the check are chosen from it');
  assert.equal(lines.filter((l) => /moved_image "/.test(l)).length, 3, 'the two names, and the look for the newest');
});

test("an update of an install that saved the old address checks the new one's signature and pins that, in the front door and every account", onLinux('install.sh'), (t) => {
  const done = rerun(t, OLD_PINS, {}, { args: ['--update'] });
  assert.deepEqual(done.checks.map((args) => checked(args).slice(0, 2)), [[`${NEW}/bot-dot:latest`, 'server'], [`${NEW}/bot-dot-desktop:latest`, 'desktop']]);
  assert.equal(done.env.BOT_DOT_IMAGE, `${NEW}/bot-dot${SIGNED}`, 'what was checked, not the digest of the old address');
  assert.equal(done.env.BOT_DOT_COMPUTER_IMAGE, `${NEW}/bot-dot-desktop${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `${NEW}/bot-dot${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `${NEW}/bot-dot-desktop${SIGNED}`);
  assert.ok(done.calls.includes(`pull ${NEW}/bot-dot${SIGNED}`), 'the front door\'s');
  assert.ok(done.accountCalls('ann').includes(`pull ${NEW}/bot-dot-desktop${SIGNED}`), "the account's computer");
  assert.ok(!done.docker.some((c) => /^pull /.test(c.call) && c.call.includes('kordal')), 'nothing is downloaded from the old address');
  assert.ok(!done.docker.some((c) => /^pull /.test(c.call) && c.call.includes(PIN.slice(1))), 'and the digest saved from it is no one\'s now');
});

test('a tag saved under the old address moves too, and an address given now', onLinux('install.sh'), (t) => {
  const byTag = rerun(t, `BOT_DOT_IMAGE=${OLD}/bot-dot:latest\nBOT_DOT_COMPUTER_IMAGE=${OLD}/bot-dot-desktop:latest\n`, {}, { args: ['--update'] });
  assert.deepEqual(byTag.checks.map((args) => checked(args)[0]), [`${NEW}/bot-dot:latest`, `${NEW}/bot-dot-desktop:latest`]);
  assert.equal(byTag.env.BOT_DOT_IMAGE, `${NEW}/bot-dot${SIGNED}`);
  // What the docs told people to type before the move.
  const given = rerun(t, OLD_PINS, { BOT_DOT_IMAGE: `${OLD}/bot-dot:latest`, BOT_DOT_COMPUTER_IMAGE: `${OLD}/bot-dot-desktop:latest` });
  assert.deepEqual(given.checks.map((args) => checked(args)[0]), [`${NEW}/bot-dot:latest`, `${NEW}/bot-dot-desktop:latest`]);
  assert.equal(given.env.BOT_DOT_IMAGE, `${NEW}/bot-dot${SIGNED}`);
});

test('an image that is not under the old address is left as it is', onLinux('install.sh'), (t) => {
  const repo = 'registry.example:5000/team';
  const own = rerun(t, `BOT_DOT_IMAGE=${repo}/bot-dot${PIN}\nBOT_DOT_COMPUTER_IMAGE=${repo}/bot-dot-desktop${PIN}\n`, {}, { args: ['--update'] });
  assert.deepEqual(own.checks.map((args) => checked(args)[0]), [`${repo}/bot-dot:latest`, `${repo}/bot-dot-desktop:latest`]);
  assert.equal(own.env.BOT_DOT_IMAGE, `${repo}/bot-dot${SIGNED}`);
  const self = rerun(t, '', SELF);
  assert.deepEqual(self.checks, [], 'a self-built install has nothing to check');
  assert.equal(self.env.BOT_DOT_IMAGE, SELF.BOT_DOT_IMAGE);
});

test('the move is done once: the next update changes nothing in the address', onLinux('install.sh'), (t) => {
  const first = rerun(t, OLD_PINS, {}, { args: ['--update'] });
  const again = installer(t, { again: first, dotenv: null, args: ['--update'] });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.deepEqual(again.checks.map((args) => checked(args)[0]), [`${NEW}/bot-dot:latest`, `${NEW}/bot-dot-desktop:latest`]);
  for (const key of ['BOT_DOT_IMAGE', 'BOT_DOT_COMPUTER_IMAGE']) assert.equal(again.env[key], first.env[key], key);
  assert.doesNotMatch(fs.readFileSync(path.join(first.dir, 'front-door', '.env'), 'utf8'), /kordal/);
});

test('an update whose new address is not signed by botdot changes nothing and keeps the old pin', onLinux('install.sh'), (t) => {
  const done = rerun(t, OLD_PINS, {}, { args: ['--update'], signed: { [`${NEW}/bot-dot:latest`]: 'it has no botdot signature' }, refuse: true });
  assert.match(done.stderr, new RegExp(`Refused ${NEW.replace(/\./g, '\\.')}/bot-dot:latest: it has no botdot signature\\. Nothing was downloaded or started\\.`));
  assert.ok(!done.docker.some((c) => /^pull ghcr\.io\//.test(c.call) || /^compose .*(up|exec)/.test(c.call)), done.docker.map((c) => c.call).join('\n'));
  assert.equal(done.env.BOT_DOT_IMAGE, `${OLD}/bot-dot${PIN}`, 'what was running is still what .env names');
  assert.equal(done.env.BOT_DOT_COMPUTER_IMAGE, `${OLD}/bot-dot-desktop${PIN}`);
});

test("root's hourly look for the newest version asks about the new address when .env still names the old one", onLinux('install.sh'), (t) => {
  const first = rerun(t);
  fs.writeFileSync(path.join(first.dir, 'front-door', '.env'), fs.readFileSync(path.join(first.dir, 'front-door', '.env'), 'utf8').replace(/^BOT_DOT_IMAGE=.*$/m, `BOT_DOT_IMAGE=${OLD}/bot-dot${PIN}`));
  const look = installer(t, { again: first, dotenv: null, script: path.join(first.dir, 'bin', 'install.sh'), args: ['--load'], answers: { revision: 'e'.repeat(40) } });
  assert.equal(look.status, 0, `${look.said}\n${look.stderr}`);
  assert.deepEqual(look.checks.map((args) => args.slice(-3)), [[`${NEW}/bot-dot:latest`, 'server', '--revision']]);
  assert.equal(status(look, 'latest.json').version, 'eeeeeee');
});
