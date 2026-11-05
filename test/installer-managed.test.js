// install.sh on a stand-in machine (test/installer-helpers.js): a managed machine (BOT_DOT_MANAGED=1, ADR 154, #983),
// one account or several, on a public or tailnet reach, with no admin page and a guaranteed share per account.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer } = require('./installer-helpers');

const PUBLIC = { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com' };
const MANAGED = { BOT_DOT_MANAGED: '1', ...PUBLIC };
const dotenvOf = (done) => fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8');
// The front door's data, as it is once the account `names` exist.
const accounts = (done, ...names) => fs.writeFileSync(path.join(done.dir, 'front-door', 'data', 'front-door.json'),
  JSON.stringify({ accounts: Object.fromEntries(names.map((n) => [n, { created: '2026-11-04T12:00:00.000Z', userId: n }])), passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} }));
// A /proc of its own, with this much RAM.
function proc(t, done, kb) {
  const dir = path.join(done ? done.top : fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'botdot-proc-')), 'proc-small');
  fs.mkdirSync(dir, { recursive: true });
  if (!done) t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'meminfo'), `MemTotal:       ${kb} kB\nMemFree:         1000000 kB\nMemAvailable:    ${kb - 1000000} kB\n`);
  return dir;
}

test('a managed machine of one account: no admin, its passkey from the setup key, and a share of 4 CPUs and 8 GB', (t) => {
  const done = installer(t, { dotenv: '', given: MANAGED });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /How will people reach|account's name|Use Jev|boat\.dev/, 'it asks nothing');
  assert.equal(done.env.BOT_DOT_MANAGED, '1', 'kept');
  assert.equal(done.env.BOT_DOT_VARIANT, 'one', 'one account unless told otherwise');
  assert.equal(done.env.FRONT_DOOR_MANAGED, '1', 'the front door has no admin page');
  assert.equal(done.env.FRONT_DOOR_ONE_ACCOUNT, 'owner');
  assert.equal(done.env.FRONT_DOOR_FIRST_ACCOUNT, '');
  assert.equal(done.env.FRONT_DOOR_ADMIN, 'owner', "the installer's name for its first account");
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'https://botdot.example.com');
  assert.equal(done.env.COMPOSE_PROFILES, 'public', 'Caddy as on any public install');
  const key = done.env.FRONT_DOOR_SETUP_KEY;
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.ok(!done.calls.some((c) => /sign-up-link/.test(c)), 'no sign-up link is made');
  const ready = JSON.parse(done.said.trim().split('\n').at(-1).replace(/^BOTDOT_READY /, ''));
  assert.equal(ready.signUp, `https://botdot.example.com/sign-up/${key}`, "the setup key's link, for the fleet console");
  assert.equal(ready.variant, 'one');
  assert.equal(ready.reach, 'public');
  assert.deepEqual(ready.accounts, ['owner']);
  assert.equal(done.said.split(key).length, 2, 'the key is on the screen in that line alone');
  assert.doesNotMatch(done.said, /admin page|\/admin/);
  assert.match(done.system, /^systemctl set-property botdot-account@owner\.service CPUQuota=400% MemoryHigh=infinity MemoryMax=8G$/m, 'the managed share');
  assert.equal(done.read('accounts/owner/share/share.json'), '{"cpu":4,"ram":8}\n');
  assert.ok(fs.existsSync(path.join(done.dir, 'bin', 'install.sh')), "root's step as on any server");

  // A rerun keeps it all, and the link goes once the account exists.
  accounts(done, 'owner');
  const again = installer(t, { dotenv: dotenvOf(done), again: done, given: { BOT_DOT_MANAGED: '0', BOT_DOT_REACH: 'tailnet' } });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.equal(again.env.BOT_DOT_MANAGED, '1', 'managed is chosen once');
  assert.equal(again.env.BOT_DOT_REACH, 'public');
  assert.equal(again.env.FRONT_DOOR_SETUP_KEY, key);
  assert.doesNotMatch(again.said, /sign-up/);
  assert.match(again.said, /\nBOTDOT_READY \{"origin":"https:\/\/botdot\.example\.com","version":"[^"]*","reach":"public","variant":"one","accounts":\["owner"\]\}\n$/, 'its last line');
});

test('one grows into several without a reinstall, and goes back only while it has no other account', (t) => {
  const done = installer(t, { dotenv: '', given: MANAGED });
  assert.equal(done.status, 0, done.stderr);
  const key = done.env.FRONT_DOOR_SETUP_KEY;
  accounts(done, 'owner');
  const several = installer(t, { dotenv: dotenvOf(done), again: done, given: { BOT_DOT_VARIANT: 'several' } });
  assert.equal(several.status, 0, `${several.said}\n${several.stderr}`);
  assert.equal(several.env.BOT_DOT_VARIANT, 'several');
  assert.equal(several.env.FRONT_DOOR_ONE_ACCOUNT, '', 'the front door takes sign-up links now');
  assert.equal(several.env.FRONT_DOOR_FIRST_ACCOUNT, 'owner');
  assert.equal(several.env.FRONT_DOOR_SETUP_KEY, key);
  assert.match(several.said, /This machine now holds several accounts: its accounts and passkeys are kept/);
  assert.ok(fs.existsSync(path.join(done.dir, 'accounts', 'owner', 'compose.yaml')), 'the account stays');
  assert.equal(JSON.parse(several.read('front-door/data/front-door.json')).accounts.owner.userId, 'owner', "and the front door's data");
  assert.ok(several.calls.includes(`compose --project-directory ${done.dir}/front-door up -d --remove-orphans`), 'the front door starts again with it');

  // Several with an account besides the first, made or asked for: no way back.
  fs.writeFileSync(path.join(done.dir, 'front-door', 'requests', 'bea'), '');
  const back = installer(t, { dotenv: dotenvOf(several), again: done, given: { BOT_DOT_VARIANT: 'one' } });
  assert.equal(back.status, 1);
  assert.match(back.stderr, /This machine holds more accounts than owner \(bea\), so it stays a machine of several accounts\. Nothing was changed\./);
  assert.equal(back.env.BOT_DOT_VARIANT, 'several');
  assert.equal(back.env.FRONT_DOOR_ONE_ACCOUNT, '');

  // With the first account alone it goes back.
  fs.rmSync(path.join(done.dir, 'front-door', 'requests', 'bea'));
  const one = installer(t, { dotenv: dotenvOf(several), again: done, given: { BOT_DOT_VARIANT: 'one' } });
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.env.FRONT_DOOR_ONE_ACCOUNT, 'owner');
  assert.equal(one.env.FRONT_DOOR_FIRST_ACCOUNT, '');
});

test('several from the start makes the first account with the setup key, on a tailnet too, and opens no sign-up link', (t) => {
  const done = installer(t, { dotenv: '', given: { BOT_DOT_MANAGED: '1', BOT_DOT_REACH: 'tailnet', BOT_DOT_VARIANT: 'several', BOT_DOT_ADMIN: 'bart' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(done.env.FRONT_DOOR_FIRST_ACCOUNT, 'bart');
  assert.equal(done.env.FRONT_DOOR_ONE_ACCOUNT, '');
  assert.match(done.system, /^tailscale serve --bg 4700$/m);
  assert.ok(!done.calls.some((c) => /sign-up-link/.test(c)));
  assert.match(done.said, /\nBOTDOT_READY \{.*"variant":"several".*"signUp":"https:\/\/vm\.example\.ts\.net\/sign-up\/[0-9a-f]{64}"\}\n$/);
  assert.ok(fs.existsSync(path.join(done.dir, 'accounts', 'bart', 'compose.yaml')));
});

test('a machine without room for one share is refused before anything is installed', (t) => {
  // 4 CPUs (the stand-in getconf) and 9.5 GB: 8 GB of share and 2 GB for the system don't fit.
  const small = installer(t, { dotenv: '', given: { ...MANAGED, BOT_DOT_PROC: proc(t, null, 9961472) } });
  assert.equal(small.status, 1);
  assert.match(small.stderr, /This machine has 4 CPUs and 9\.5 GB of RAM: a managed machine needs 4 CPUs and 8 GB of RAM for each of its 1 account, and 2 GB more for the system\. Nothing was changed\./);
  assert.equal(small.docker.filter((c) => /^compose .* up/.test(c.call)).length, 0, 'nothing was started');
  assert.ok(!fs.existsSync(path.join(small.dir, 'front-door', '.env')) || !/BOT_DOT_MANAGED/.test(dotenvOf(small)));

  const fits = installer(t, { dotenv: '', given: { ...MANAGED, BOT_DOT_PROC: proc(t, null, 11 * 1048576) } });
  assert.equal(fits.status, 0, fits.stderr);

  const cpus = installer(t, { dotenv: '', given: MANAGED, bins: { getconf: '#!/bin/sh\necho 3\n' } });
  assert.equal(cpus.status, 1);
  assert.match(cpus.stderr, /This machine has 3 CPUs/);
});

test('managed is chosen at the first install, never on this computer only, and its answers are checked', (t) => {
  const server = installer(t, { dotenv: '', given: { ...PUBLIC, BOT_DOT_ADMIN: 'ann' } });
  assert.equal(server.status, 0, server.stderr);
  assert.equal(server.env.BOT_DOT_MANAGED, undefined, 'a machine that is not managed is as before');
  assert.equal(server.env.FRONT_DOOR_MANAGED, undefined);
  assert.equal(server.read('accounts/ann/share/share.json'), '{"cpu":2,"ram":5}\n', 'with the share as before');
  const late = installer(t, { dotenv: dotenvOf(server), again: server, given: { BOT_DOT_MANAGED: '1' } });
  assert.equal(late.status, 1);
  assert.match(late.stderr, /This machine isn't managed, and that is chosen at its first install, so nothing was changed\./);

  const local = installer(t, { dotenv: '', given: { BOT_DOT_MANAGED: '1', BOT_DOT_REACH: 'local' } });
  assert.equal(local.status, 1);
  assert.match(local.stderr, /A managed machine is reached on a public domain or a tailnet, not on this computer only\./);

  const variant = installer(t, { dotenv: '', given: { ...MANAGED, BOT_DOT_VARIANT: 'many' } });
  assert.equal(variant.status, 1);
  assert.match(variant.stderr, /BOT_DOT_VARIANT is one or several\./);

  const odd = installer(t, { dotenv: '', given: { ...PUBLIC, BOT_DOT_MANAGED: 'yes' } });
  assert.equal(odd.status, 1);
  assert.match(odd.stderr, /BOT_DOT_MANAGED is 1, or nothing for a machine that isn't managed\./);
});
