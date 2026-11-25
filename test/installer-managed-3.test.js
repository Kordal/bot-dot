// install.sh on a stand-in machine (test/installer-helpers.js): a managed machine (BOT_DOT_MANAGED=1, ADR 154, #983),
// one account or several, on a public or tailnet reach, with no admin page and a guaranteed share per account.
// Part 3 of 5 of the managed machine tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
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

// #984: a managed machine's computers reach no private range, no link-local address (the cloud's metadata) and no
// SMTP: the rules apply to the accounts' Linux users alone, and come before any account's Docker.
const uidOf = (done, user) => fs.readFileSync(path.join(done.top, 'users'), 'utf8').split('\n').find((l) => l.startsWith(`${user}:`)).split(':')[1];

test('a machine without room for one share is refused before anything is installed', (t) => {
  // 6 CPUs (the stand-in getconf) and 10.5 GB: 9 GB of share and 2 GB for the system don't fit.
  const small = installer(t, { dotenv: '', given: { ...MANAGED, BOT_DOT_PROC: proc(t, null, 11010048) } });
  assert.equal(small.status, 1);
  assert.match(small.stderr, /This machine has 6 CPUs and 10\.5 GB of RAM: a managed machine needs 6 CPUs and 9 GB of RAM for each of its 1 account, and 2 GB more for the system\. Nothing was changed\./);
  assert.equal(small.docker.filter((c) => /^compose .* up/.test(c.call)).length, 0, 'nothing was started');
  assert.ok(!fs.existsSync(path.join(small.dir, 'front-door', '.env')) || !/BOT_DOT_MANAGED/.test(dotenvOf(small)));

  const fits = installer(t, { dotenv: '', given: { ...MANAGED, BOT_DOT_PROC: proc(t, null, 12268339) } });
  assert.equal(fits.status, 0, fits.stderr);

  const cpus = installer(t, { dotenv: '', given: MANAGED, bins: { getconf: '#!/bin/sh\necho 5\n' } });
  assert.equal(cpus.status, 1);
  assert.match(cpus.stderr, /This machine has 5 CPUs/);
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

test('a managed machine keeps its computers from private addresses, the metadata address and SMTP, before their Docker starts', (t) => {
  const done = installer(t, { dotenv: '', given: MANAGED });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const uid = uidOf(done, 'botdot-owner');
  const [v4, v6] = done.system.split(/^ip6tables-restore -n$/m);
  const rules = v4.slice(v4.lastIndexOf('iptables-restore -n'));
  assert.match(rules, /^:BOTDOT-EGRESS - \[0:0\]$/m, 'rebuilt at once');
  assert.match(rules, new RegExp(`^-A BOTDOT-EGRESS -m owner --uid-owner ${uid} -j BOTDOT-GUARD$`, 'm'), "the account's Linux user");
  assert.equal(rules.match(/--uid-owner/g).length, 1, 'and no other user: not the front door\'s, not Caddy\'s');
  assert.match(rules, /^-A BOTDOT-GUARD -m conntrack ! --ctstate NEW -j RETURN$/m, 'every answer goes out');
  assert.match(rules, /^-A BOTDOT-GUARD -o lo -j RETURN$/m, 'and this machine itself is reached: the front door and Caddy');
  assert.match(rules, /^-A BOTDOT-GUARD -p tcp -m multiport --dports 25,465 -j REJECT --reject-with tcp-reset$/m, 'no SMTP');
  for (const net of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10']) {
    assert.match(rules, new RegExp(`^-A BOTDOT-GUARD -d ${net.replace(/\./g, '\\.')} -j REJECT$`, 'm'), net);
  }
  assert.ok(rules.indexOf('-o lo') < rules.indexOf('-j REJECT'));
  assert.match(done.system, /^iptables -C OUTPUT -j BOTDOT-EGRESS$/m, 'the machine\'s OUTPUT goes through it');
  for (const net of ['fc00::/7', 'fe80::/10']) assert.match(v6, new RegExp(`^-A BOTDOT-GUARD -d ${net.replace(/\//g, '\\/')} -j REJECT$`, 'm'), `IPv6: ${net}`);
  assert.match(v6, /--dports 25,465 -j REJECT/);
  assert.ok(done.system.indexOf('iptables-restore -n') < done.system.search(/^systemctl (re)?start botdot-account@owner$/m), 'before the account\'s Docker starts');

  const unit = fs.readFileSync(path.join(done.etc, 'systemd', 'system', 'botdot-egress.service'), 'utf8');
  assert.match(unit, /^Before=network-pre\.target docker\.service$/m, 'at boot, before Docker');
  assert.match(unit, new RegExp(`^ExecStart=/bin/sh ${done.dir}/bin/egress\\.sh$`, 'm'));
  assert.match(done.system, /^systemctl enable botdot-egress$/m);
  assert.doesNotMatch(done.system, /^systemctl restart botdot-egress$/m, 'never restarted: that would restart every account');
  const account = fs.readFileSync(path.join(done.etc, 'systemd', 'system', 'botdot-account@.service'), 'utf8');
  assert.match(account, /^Requires=botdot-egress\.service\nAfter=botdot-egress\.service$/m, 'no account starts without it');

  // The machine's resolvers stay open, also a private or link-local one, read again whenever the rules are rebuilt.
  fs.writeFileSync(path.join(done.etc, 'resolv.conf'), 'nameserver 10.0.0.2\nnameserver fe80::1%eth0\n');
  accounts(done, 'owner');
  const again = installer(t, { dotenv: dotenvOf(done), again: done });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  const [v4again, v6again] = again.system.slice(done.system.length).split(/^ip6tables-restore -n$/m);
  assert.match(v4again, /^-A BOTDOT-GUARD -d 10\.0\.0\.2 -p udp --dport 53 -j RETURN$/m);
  assert.match(v4again, /^-A BOTDOT-GUARD -d 10\.0\.0\.2 -p tcp --dport 53 -j RETURN$/m);
  assert.ok(v4again.indexOf('--dport 53') < v4again.indexOf('-j REJECT'), 'before what is refused');
  assert.doesNotMatch(v4again, /fe80::1/, 'an IPv6 resolver in the IPv6 rules alone');
  assert.match(v6again, /^-A BOTDOT-GUARD -d fe80::1 -p udp --dport 53 -j RETURN$/m);

  // Without systemd the rules go in at once too.
  const noSystemd = installer(t, { dotenv: '', given: MANAGED, systemd: false });
  assert.equal(noSystemd.status, 0, noSystemd.stderr);
  assert.match(noSystemd.system, /^-A BOTDOT-GUARD -d 169\.254\.0\.0\/16 -j REJECT$/m);
});

test('a machine that is not managed has no such rules, and the uninstaller removes a managed machine\'s', (t) => {
  const server = installer(t, { dotenv: '', given: { ...PUBLIC, BOT_DOT_ADMIN: 'ann' } });
  assert.equal(server.status, 0, server.stderr);
  assert.ok(!fs.existsSync(path.join(server.dir, 'bin', 'egress.sh')));
  assert.ok(!fs.existsSync(path.join(server.etc, 'systemd', 'system', 'botdot-egress.service')));
  assert.doesNotMatch(server.system, /BOTDOT-EGRESS|iptables-restore|botdot-egress/);
  assert.doesNotMatch(fs.readFileSync(path.join(server.etc, 'systemd', 'system', 'botdot-account@.service'), 'utf8'), /Requires=|egress/);

  const done = installer(t, { dotenv: '', given: MANAGED });
  assert.equal(done.status, 0, done.stderr);
  const gone = installer(t, { again: done, dotenv: '', args: ['--uninstall'], input: 'yes\nn\n' });
  assert.equal(gone.status, 0, `${gone.said}\n${gone.stderr}`);
  const after = gone.system.slice(done.system.length);
  assert.match(after, /^systemctl disable --now botdot-egress$/m);
  for (const t6 of ['iptables', 'ip6tables']) {
    assert.match(after, new RegExp(`^${t6} -D OUTPUT -j BOTDOT-EGRESS$`, 'm'));
    assert.match(after, new RegExp(`^${t6} -X BOTDOT-GUARD$`, 'm'));
  }
  assert.ok(after.indexOf('systemctl disable --now botdot-egress') > after.indexOf('userdel botdot-owner'), 'once no account runs');
  assert.ok(!fs.existsSync(path.join(done.etc, 'systemd', 'system', 'botdot-egress.service')));
});
