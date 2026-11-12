// install.sh on a stand-in machine (test/installer-helpers.js): a first install, botdot's signed images, and what
// the installer tells a stranger. The other installer tests are in installer-*.test.js, so that they run side by side.
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checked, ROOT, file, script, code, PIN, SIGNED, ANSWERED, SUB, tailscale, installer, rerun, KEPT_LAYER, roomAnswers, SELF, withBob } = require('./installer-helpers');

// --- A first install ------------------------------------------------------------------------------

test('a first install asks how botdot is reached and the admin\'s name, and remembers both', (t) => {
  const done = installer(t, { dotenv: '', input: '1\nBotdot.Example.com\nann\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /How will people reach botdot\?\n {2}1\) a public domain: HTTPS from Caddy, which fetches its own certificate \(ports 80, 443 and 8443 must be free\)\n {2}2\) a tailnet only: Tailscale Serve gives it an HTTPS name, and nothing is on the internet\n/);
  assert.match(done.said, /The domain botdot answers on \(its DNS must point at this machine\)/);
  assert.match(done.said, /Your own account's name, the admin's \(2 to 24 lowercase letters, digits and dashes, starting with a letter\)/);
  assert.equal(done.env.BOT_DOT_REACH, 'public');
  assert.equal(done.env.BOT_DOT_DOMAIN, 'botdot.example.com', 'in lowercase');
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'https://botdot.example.com');
  assert.equal(done.env.FRONT_DOOR_SITES_ORIGIN, 'https://botdot.example.com:8443', "bots' interactive pages on an origin of their own (#399)");
  assert.equal(done.env.FRONT_DOOR_SITES_PORT, '4701');
  assert.equal(done.env.FRONT_DOOR_ADMIN, 'ann');

  const again = installer(t, { dotenv: fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8') });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.said, /How will people reach|The domain botdot|account's name/, 'a rerun asks nothing again: a passkey belongs to one address');
});

test('the answers can be given beforehand, and a wrong one is asked again', (t) => {
  const given = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'bots.example.org', BOT_DOT_ADMIN: 'bea' } });
  assert.equal(given.status, 0, given.stderr);
  assert.doesNotMatch(given.said, /How will people reach|The domain botdot|account's name/);
  assert.equal(given.env.FRONT_DOOR_ORIGIN, 'https://bots.example.org');
  assert.equal(given.env.FRONT_DOOR_ADMIN, 'bea');

  const wrong = installer(t, { dotenv: '', input: '3\n1\nnot a domain\nbots.example.org\nAnn Smith\na\nann\n' });
  assert.equal(wrong.status, 0, wrong.stderr);
  assert.equal(wrong.said.match(/How will people reach botdot\?/g).length, 2);
  assert.match(wrong.said, /not a domain isn't a domain name\./);
  assert.equal(wrong.said.match(/An account's name is 2 to 24 lowercase letters/g).length, 2, '"Ann Smith" and "a"');
  assert.equal(wrong.env.FRONT_DOOR_ADMIN, 'ann');

  const sudo = installer(t, { dotenv: '', input: '1\nbots.example.org\n\n', given: { SUDO_USER: 'Ann_Smith' } });
  assert.match(sudo.said, /letter\) \[ann-smith\]: /, 'the one who ran sudo is suggested');
  assert.equal(sudo.env.FRONT_DOOR_ADMIN, 'ann-smith');

  const none = installer(t, { dotenv: '', input: '' });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /No answer, so nothing more was changed\./);
  assert.equal(none.docker.filter((c) => /^compose .* up/.test(c.call)).length, 0, 'nothing was started');
});

test('a public install puts Caddy in front of the front door, on the domain alone', (t) => {
  const done = rerun(t);
  assert.equal(done.env.COMPOSE_PROFILES, 'public', 'Caddy starts with the front door');
  assert.equal(done.read('front-door/Caddyfile'), '# botdot (install.sh): HTTPS for the front door on its public domain. Caddy fetches the certificate.\nbotdot.example.com {\n\treverse_proxy 127.0.0.1:4700\n\theader Strict-Transport-Security "max-age=31536000"\n}\nbotdot.example.com:8443 {\n\treverse_proxy 127.0.0.1:4701\n}\n', "and bots' interactive pages on its port 8443 (#399)");
  assert.equal(done.read('front-door/compose.yaml'), fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8'), 'the front door\'s compose file, from the image');
  assert.ok(done.calls.includes(`compose --project-directory ${done.dir}/front-door up -d --remove-orphans`));
  assert.match(done.system, /^curl -fsSk -o \/dev\/null --resolve botdot\.example\.com:443:127\.0\.0\.1 https:\/\/botdot\.example\.com\/api\/version$/m);
  assert.match(done.said, /Caddy answers on https:\/\/botdot\.example\.com/);
  assert.doesNotMatch(done.system, /^tailscale/m, 'no Tailscale');

  const test = rerun(t, '', { BOT_DOT_TLS: 'internal' });
  assert.match(test.read('front-door/Caddyfile'), /botdot\.example\.com \{\n\ttls internal\n\treverse_proxy/, 'a test machine\'s own certificate authority');
  assert.match(test.read('front-door/Caddyfile'), /botdot\.example\.com:8443 \{\n\ttls internal\n\treverse_proxy 127\.0\.0\.1:4701/);
  assert.equal(test.env.BOT_DOT_TLS, 'internal', 'kept for a rerun');

  const late = rerun(t, '', {}, { caddy: false });
  assert.match(late.said, /Caddy doesn't answer on https:\/\/botdot\.example\.com yet\. It fetches the certificate by itself once the DNS points at this machine and ports 80, 443 and 8443 are open\./);
  assert.match(late.said, /\/sign-up\/T0KEN/, 'and the installer goes on to the link');
});

test('a public install shows the exact DNS record its domain needs, and whether it is set', (t) => {
  const unset = rerun(t, '', {}, { caddy: false });
  const record = /Set this DNS for botdot\.example\.com at your domain's provider:\n {6}A {5}botdot\.example\.com {2}203\.0\.113\.7\n {4}Now it doesn't resolve\./g;
  assert.equal(unset.said.match(record).length, 2, 'before the downloads, and again when Caddy doesn\'t answer');
  assert.doesNotMatch(unset.said, /AAAA/, 'no IPv6 on this machine, none asked for');
  assert.ok(unset.said.indexOf('Set this DNS') < unset.said.indexOf('front door is running'), 'shown before the long steps');

  const elsewhere = rerun(t, '', { STAND_IN_A: '198.51.100.1', STAND_IN_AAAA: '2001:db8::1' });
  assert.match(elsewhere.said, /A {5}botdot\.example\.com {2}203\.0\.113\.7\n {4}Now it points at 198\.51\.100\.1, 2001:db8::1\.\n {4}Remove its AAAA record: this machine has no IPv6\./);

  const six = rerun(t, '', { STAND_IN_IP6: '2001:db8::7' });
  assert.match(six.said, /A {5}botdot\.example\.com {2}203\.0\.113\.7\n {6}AAAA {2}botdot\.example\.com {2}2001:db8::7\n/);

  const set = rerun(t, '', { STAND_IN_A: '203.0.113.7' });
  assert.match(set.said, /botdot\.example\.com points at this machine \(203\.0\.113\.7\)/);
  assert.doesNotMatch(set.said, /Set this DNS/);

  const proxied = rerun(t, '', { STAND_IN_A: '104.21.32.1 172.67.10.2' });
  assert.match(proxied.said, /Now it points at 104\.21\.32\.1, 172\.67\.10\.2\.\n {4}That is Cloudflare's proxy: set the record to DNS only \(grey cloud\)\./);

  const noCertificate = rerun(t, '', { STAND_IN_A: '203.0.113.7' }, { caddy: false });
  assert.ok(noCertificate.calls.includes(`compose --project-directory ${noCertificate.dir}/front-door restart caddy`), 'the DNS is set: Caddy tries again now, not after its back-off');
  assert.match(noCertificate.said, /Caddy has no certificate for botdot\.example\.com yet\. Keep ports 80, 443 and 8443 open to this machine\./);
  assert.doesNotMatch(noCertificate.said, /Set this DNS/);

  const test = rerun(t, '', { BOT_DOT_TLS: 'internal' }, { caddy: false });
  assert.doesNotMatch(test.said, /Set this DNS|\.com points at this machine/, 'a test machine\'s domain isn\'t on the internet');
  assert.doesNotMatch(test.system, /cdn-cgi/);
});

test('a tailnet install gives the front door its Tailscale name with Serve, and nothing on the internet', (t) => {
  const done = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(done.env.BOT_DOT_REACH, 'tailnet');
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'https://vm.example.ts.net');
  assert.equal(done.env.COMPOSE_PROFILES, '', 'no Caddy');
  assert.equal(done.read('front-door/Caddyfile'), '');
  assert.match(done.system, /^tailscale serve --bg 4700$/m, 'Serve passes the tailnet name\'s HTTPS to the front door on 127.0.0.1');
  assert.match(done.system, /^tailscale serve --bg --https=8443 4701$/m, "and its port 8443 to the front door's second port, for bots' interactive pages (#399)");
  assert.equal(done.env.FRONT_DOOR_SITES_ORIGIN, 'https://vm.example.ts.net:8443');
  assert.match(done.said, /Reachable on your tailnet only, at https:\/\/vm\.example\.ts\.net/);
  assert.match(done.said, /Done\. botdot is at https:\/\/vm\.example\.ts\.net/);

  const serve = 'Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve?node=n1';
  const failed = installer(t, { dotenv: '', input: '2\nann\n', bins: { tailscale: tailscale({ serve, exit: 1 }) } });
  assert.equal(failed.status, 1);
  assert.ok(failed.said.includes(serve), 'what tailscale serve said is on the screen');
  assert.match(failed.stderr, /Tailscale Serve didn't start \(its message is above\)\. Fix that and run this installer again\./);

  const without = installer(t, { dotenv: '', input: '2\nn\n', bins: { tailscale: null } });
  assert.equal(without.status, 1);
  assert.match(without.said, /botdot on a tailnet needs Tailscale\. Install it now\?/);
  assert.match(without.stderr, /botdot on a tailnet needs Tailscale \(https:\/\/tailscale\.com\/download\)/);
});

test('a local install is one account on localhost, made with a setup key, for the desktop app alone (#882)', (t) => {
  const done = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /How will people reach|The domain botdot|account's name/, 'it asks nothing');
  assert.equal(done.env.BOT_DOT_REACH, 'local');
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'http://localhost:4700', 'a passkey can belong to localhost');
  assert.equal(done.env.FRONT_DOOR_PORT, '4700');
  assert.equal(done.env.FRONT_DOOR_SITES_ORIGIN, 'http://localhost:4701', "bots' interactive pages on an origin of their own");
  assert.equal(done.env.FRONT_DOOR_SITES_PORT, '4701');
  assert.equal(done.env.FRONT_DOOR_ADMIN, 'owner');
  assert.equal(done.env.FRONT_DOOR_ONE_ACCOUNT, 'owner', 'the front door holds this one account');
  const key = done.env.FRONT_DOOR_SETUP_KEY;
  assert.match(key, /^[0-9a-f]{64}$/, 'a setup key the front door takes (32 to 100 base64url characters)');
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', '.env')).mode & 0o777, 0o600, 'kept where only root reads it');
  assert.equal(done.env.COMPOSE_PROFILES, '', 'no Caddy');
  assert.equal(done.read('front-door/Caddyfile'), '');
  assert.doesNotMatch(done.system, /^tailscale/m, 'no Tailscale');
  assert.ok(!done.calls.some((c) => /sign-up-link/.test(c)), 'no sign-up link is made');
  assert.doesNotMatch(done.said, /admin page|Whoever is root/);
  assert.ok(fs.existsSync(path.join(done.dir, 'accounts', 'owner', 'compose.yaml')), "the account's botdot server is made");
  assert.match(done.system, /^curl -fsS -o \/dev\/null -H Host: localhost:4700 http:\/\/127\.0\.0\.1:4700\/api\/version$/m);
  const lines = done.said.trim().split('\n');
  assert.match(lines.at(-1), /^BOTDOT_READY \{"origin":"http:\/\/localhost:4700","version":"[0-9a-f]*","reach":"local","accounts":\["owner"\]\}$/, 'the last line is the one for a program, without the key (#981)');
  assert.equal(lines.at(-2), `BOTDOT_LOCAL {"origin":"http://localhost:4700","signUp":"http://localhost:4700/sign-up/${key}"}`, "the last line is the app's");
  assert.equal(done.said.split(key).length, 2, 'the key is on the screen in that line alone');
  assert.deepEqual(JSON.parse(lines.at(-2).slice('BOTDOT_LOCAL '.length)), { origin: 'http://localhost:4700', signUp: `http://localhost:4700/sign-up/${key}` });

  // A rerun keeps the address, the key and the account; once the account exists its line has no sign-up address.
  const dotenv = fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8');
  fs.writeFileSync(path.join(done.dir, 'front-door', 'data', 'front-door.json'), JSON.stringify({ accounts: { owner: { created: '2026-11-02T12:00:00.000Z', userId: 'u' } }, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} }));
  const again = installer(t, { dotenv, again: done, given: { BOT_DOT_REACH: 'tailnet', BOT_DOT_PORT: '5000' } });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.equal(again.env.BOT_DOT_REACH, 'local', 'how it is reached is chosen once');
  assert.equal(again.env.FRONT_DOOR_ORIGIN, 'http://localhost:4700', 'and its address, which its passkey belongs to');
  assert.equal(again.env.FRONT_DOOR_SETUP_KEY, key);
  assert.equal(again.said.trim().split('\n').at(-2), 'BOTDOT_LOCAL {"origin":"http://localhost:4700"}');

  const port = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_PORT: '5100', BOT_DOT_ADMIN: 'bart' } });
  assert.equal(port.status, 0, port.stderr);
  assert.equal(port.env.FRONT_DOOR_ORIGIN, 'http://localhost:5100');
  assert.equal(port.env.FRONT_DOOR_SITES_ORIGIN, 'http://localhost:5101');
  assert.equal(port.env.FRONT_DOOR_ONE_ACCOUNT, 'bart');
  assert.match(port.said, /BOTDOT_LOCAL \{"origin":"http:\/\/localhost:5100","signUp":"http:\/\/localhost:5100\/sign-up\/[0-9a-f]{64}"\}\nBOTDOT_READY \{"origin":"http:\/\/localhost:5100",[^\n]*"accounts":\["bart"\]\}\n$/);

  const bad = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_PORT: '80' } });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /BOT_DOT_PORT: a port is a number from 1024 to 65534\./);
});

test('a local install keeps the VM from the computer it runs on and its network, and a server has no such rules (#887)', (t) => {
  const done = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' }, systemd: true });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const rules = fs.readFileSync(path.join(done.dir, 'bin', 'local-firewall.sh'), 'utf8');
  assert.match(rules, /-m conntrack ! --ctstate NEW -j RETURN/, 'what the VM answers stays open: the port forward and limactl shell');
  for (const net of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', '198.18.0.0/15']) assert.ok(rules.includes(net), net);
  assert.ok(rules.indexOf('--dport 53') < rules.indexOf('-j REJECT'), 'the DNS on the gateway stays open');
  assert.ok(rules.indexOf('docker+') < rules.indexOf('-j REJECT'), "and this machine's own Docker");
  assert.match(done.system, /^systemctl enable botdot-local-firewall$/m, 'it comes back with a restart');
  assert.match(done.system, /^systemctl restart botdot-local-firewall$/m);
  assert.match(done.said, /This VM can't reach the computer it runs on/);

  const noSystemd = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' }, systemd: false });
  assert.match(noSystemd.system, /^iptables -A BOTDOT-LOCAL -d 192\.168\.0\.0\/16 -j REJECT$/m, 'without systemd the rules go in at once');

  const server = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com', BOT_DOT_ADMIN: 'ann' } });
  assert.equal(server.status, 0, server.stderr);
  assert.ok(!fs.existsSync(path.join(server.dir, 'bin', 'local-firewall.sh')));
  assert.doesNotMatch(server.system, /local-firewall|^iptables/m);
});

test("a local install on the Linux computer itself guards the account's user, never the computer's own traffic (ADR 170)", (t) => {
  const done = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_LOCAL_HOST: '1' }, systemd: true });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(done.env.BOT_DOT_LOCAL_HOST, '1', 'kept for the updates');
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'http://localhost:4700');
  assert.ok(!fs.existsSync(path.join(done.dir, 'bin', 'local-firewall.sh')), "no chain on all of OUTPUT: it would cut the owner's computer off its network");
  assert.doesNotMatch(done.system, /BOTDOT-LOCAL|local-firewall/);
  assert.doesNotMatch(done.said, /This VM can't reach/);
  assert.match(done.said, /botdot's computers can't reach this computer's network/);
  const uid = fs.readFileSync(path.join(done.top, 'users'), 'utf8').split('\n').find((l) => l.startsWith('botdot-owner:')).split(':')[1];
  assert.match(done.system, new RegExp(`^-A BOTDOT-EGRESS -m owner --uid-owner ${uid} -j BOTDOT-GUARD$`, 'm'), "the account's Linux user alone");
  assert.match(done.system, /^-A BOTDOT-GUARD -d 192\.168\.0\.0\/16 -j REJECT$/m, 'no home network');
  assert.ok(done.system.indexOf('iptables-restore -n') < done.system.search(/^systemctl (re)?start botdot-account@owner$/m), "before the account's Docker starts");
  assert.match(fs.readFileSync(path.join(done.etc, 'systemd', 'system', 'botdot-account@.service'), 'utf8'), /^Requires=botdot-egress\.service$/m);

  // An update keeps it, with no answer given.
  const dotenv = fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8');
  const again = installer(t, { dotenv, again: done });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.equal(again.env.BOT_DOT_LOCAL_HOST, '1');
  assert.doesNotMatch(again.system, /BOTDOT-LOCAL/);

  // Chosen with local at the first install alone.
  const server = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com', BOT_DOT_ADMIN: 'ann', BOT_DOT_LOCAL_HOST: '1' } });
  assert.equal(server.status, 1);
  assert.match(server.stderr, /BOT_DOT_LOCAL_HOST goes with BOT_DOT_REACH=local alone\./);
  const vm = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' } });
  const later = installer(t, { dotenv: fs.readFileSync(path.join(vm.dir, 'front-door', '.env'), 'utf8'), again: vm, given: { BOT_DOT_LOCAL_HOST: '1' } });
  assert.equal(later.status, 1);
  assert.match(later.stderr, /This botdot runs in a VM of its own, and that is chosen at its first install/);
  const odd = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_LOCAL_HOST: 'yes' } });
  assert.equal(odd.status, 1);
  assert.match(odd.stderr, /BOT_DOT_LOCAL_HOST is 1, or nothing/);
});

test('the question offers a public domain and a tailnet only: local is never an answer to it (#882)', (t) => {
  const done = installer(t, { dotenv: '', input: 'local\n3\n' });
  assert.equal(done.status, 1);
  assert.equal(done.said.match(/How will people reach botdot\?/g).length, 3, '"local" and "3" are asked again');
  assert.doesNotMatch(done.said, /3\)|local/);
  assert.equal(done.env.BOT_DOT_REACH, undefined);
});

test('the front door takes the one account and its setup key from .env', () => {
  const door = fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8');
  assert.match(door, /FRONT_DOOR_ONE_ACCOUNT: \$\{FRONT_DOOR_ONE_ACCOUNT:-\}/);
  assert.match(door, /FRONT_DOOR_SETUP_KEY: \$\{FRONT_DOOR_SETUP_KEY:-\}/);
});

test('the front door runs as its own user, with the accounts\' socket folders and its data', (t) => {
  const done = rerun(t);
  assert.match(done.system, /^useradd --system --user-group --no-create-home --home-dir \/nonexistent --shell \/usr\/sbin\/nologin botdot-door$/m);
  assert.equal(done.env.FRONT_DOOR_USER, '990:990');
  assert.equal(done.env.BOT_DOT_SOCKETS, `${done.dir}/sockets`);
  assert.equal(done.env.COMPOSE_PROJECT_NAME, 'botdot');
  assert.match(done.system, new RegExp(`^chown 990:990 ${done.dir}/front-door/data$`, 'm'));
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', 'data')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', '.env')).mode & 0o777, 0o600);
  assert.equal(done.env.FRONT_DOOR_ANDROID_KEYS, undefined, 'no Android app signs in until its keys are given');

  const keys = `${'AB:'.repeat(31)}AB`;
  const android = rerun(t, '', { FRONT_DOOR_ANDROID_KEYS: keys });
  assert.equal(android.env.FRONT_DOOR_ANDROID_KEYS, keys, 'the Android app\'s signing keys are kept for the front door');
  // An update from the admin page is given no keys: it keeps the ones given before (#82).
  const update = rerun(t, `FRONT_DOOR_ANDROID_KEYS=${keys}\n`, {}, { args: ['--update'] });
  assert.equal(update.env.FRONT_DOOR_ANDROID_KEYS, keys, 'an update keeps them');
  assert.match(fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8'), /FRONT_DOOR_ANDROID_KEYS: \$\{FRONT_DOOR_ANDROID_KEYS:-\}/);
});

test("the admin's account gets its own Linux user, rootless Docker under gVisor, and botdot server", (t) => {
  const done = rerun(t);
  const home = `${done.dir}/accounts/ann`;
  assert.match(done.system, new RegExp(`^useradd --no-create-home --home-dir ${home} --shell /usr/sbin/nologin --comment botdot account ann botdot-ann$`, 'm'));
  assert.match(done.system, new RegExp(`^chown 1002:1002 ${home}$`, 'm'), 'its home, its disk, is its own');
  assert.ok(done.system.indexOf(`mount -o loop ${done.dir}/disks/ann.img ${home}`) < done.system.indexOf('useradd --no-create-home'), 'its disk is its home before anything is in it');
  const daemon = JSON.parse(fs.readFileSync(path.join(home, '.config', 'docker', 'daemon.json'), 'utf8'));
  assert.equal(daemon['default-runtime'], 'runsc');
  assert.deepEqual(daemon.runtimes.runsc.runtimeArgs, ['--ignore-cgroups', '--net-raw', '--overlay2=none'],
    'the spike\'s flags (ADR 028), and a computer\'s files are written to its disk, so they outlive a stop (#68): no host sockets for a bot\'s computer (#72)');
  assert.deepEqual(daemon.runtimes['runsc-uds'], { path: daemon.runtimes.runsc.path, runtimeArgs: ['--ignore-cgroups', '--net-raw', '--overlay2=none', '--host-uds=all'] },
    'the server and the helper meet through Unix sockets in their mounts');
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  for (const service of ['bot-dot', 'docker-helper']) {
    assert.match(compose, new RegExp(`\\n  ${service}:\\n(    .*\\n)*?    runtime: runsc-uds\\b`), service);
  }
  assert.deepEqual(daemon['exec-opts'], ['native.cgroupdriver=cgroupfs']);
  // gVisor through root's script beside the share, which sizes each sandbox by it (ADR 152).
  assert.equal(daemon.runtimes.runsc.path, `${home}/share/runsc`);
  const runsc = path.join(home, 'share', 'runsc');
  assert.equal(fs.statSync(runsc).mode & 0o777, 0o755);
  assert.match(fs.readFileSync(runsc, 'utf8'), /^RUNSC='\/\S+\/runsc'$/m, 'the machine\'s runsc');
  assert.match(done.system, new RegExp(`^chown 0:0 ${home}/share$`, 'm'), 'root\'s');

  // Started by systemd as the account's own user.
  const unit = fs.readFileSync(path.join(done.etc, 'systemd', 'system', 'botdot-account@.service'), 'utf8');
  assert.match(unit, /^User=botdot-%i$/m);
  assert.match(unit, new RegExp(`^Environment=XDG_RUNTIME_DIR=${done.run}/%i$`, 'm'));
  assert.match(unit, /^ExecStart=.*\/dockerd-rootless\.sh$/m);
  assert.match(unit, /^Delegate=yes$/m);
  assert.match(unit, new RegExp(`^ExecStartPre=\\+/bin/sh -c '\\[ ! -f ${done.dir}/disks/%i\\.img \\] \\|\\| mountpoint -q ${done.dir}/accounts/%i \\|\\| mount -o loop ${done.dir}/disks/%i\\.img ${done.dir}/accounts/%i'$`, 'm'), 'it starts only on its disk, mounted by root');
  assert.match(done.system, /^systemctl enable botdot-account@ann$/m);
  assert.match(done.system, /^systemctl restart botdot-account@ann$/m, 'its Docker settings are new');

  // Its socket folder: botdot's server user of its containers owns it, the front door may only pass through.
  const folder = `${done.dir}/sockets/ann`;
  assert.match(done.system, new RegExp(`^chown ${SUB + 59999}:${SUB + 59999} ${folder}$`, 'm'));
  assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
  assert.match(done.system, new RegExp(`^setfacl -m g:botdot-door:x,m::x ${folder}$`, 'm'));

  // Its botdot server, in its own Docker.
  assert.equal(done.read('accounts/ann/compose.yaml').trim(), fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8').trim());
  const env = done.accountEnv('ann');
  assert.equal(env.BOT_DOT_ACCOUNT, 'ann');
  assert.equal(env.BOT_DOT_FRONT_DOOR_FOLDER, folder);
  assert.equal(env.DOCKER_SOCKET, `${done.run}/ann/docker.sock`);
  assert.equal(env.TZ, 'UTC');
  assert.match(env.BOT_DOT_INSTANCE, /^[0-9a-f]{8}$/, "the machine's own id, in its boat.dev machines' names (#982)");
  assert.ok(done.accountCalls('ann').includes(`compose --project-directory ${home} up -d --remove-orphans`));
  assert.ok(!done.calls.some((c) => /^compose --project-directory .*accounts/.test(c)), 'never in the machine\'s Docker');
  assert.match(done.said, /The account ann is running/);
});

test("an account's Docker without a runtime the compose file names stops the installer before the server starts", (t) => {
  const done = installer(t, { runtimes: '' });
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /The account ann's Docker has no runsc-uds runtime, which this version's compose file needs\. Restart it \(systemctl restart botdot-account@ann\) and run this again\./);
  assert.ok(!done.accountCalls('ann').some((c) => / up\b/.test(c)), done.accountCalls('ann').join('\n'));
});

test('a rerun keeps its Docker running when nothing of its settings changed', (t) => {
  const first = rerun(t);
  const again = installer(t, { again: first });
  assert.equal(again.status, 0, again.stderr);
  const after = again.system.slice(first.system.length);
  assert.equal(again.accountEnv('ann').BOT_DOT_INSTANCE, first.accountEnv('ann').BOT_DOT_INSTANCE, "the machine's id is made once and kept");
  assert.match(after, /^systemctl start botdot-account@ann$/m);
  assert.doesNotMatch(after, /^systemctl restart/m, 'its bots keep running');
  assert.doesNotMatch(after, /^useradd .*botdot-ann$/m, 'its user is there already');
  assert.match(first.system, /^chown \d+:\d+ \S+\/accounts\/ann\/data$/m, 'its data folder is the account\'s when it is made');
  assert.doesNotMatch(after, /\/accounts\/ann\/data$/m, 'and then the server\'s: its running server keeps writing it');
});

test('an installer older than the image stops before it changes an account, and says to take the newer one (#142)', (t) => {
  const first = rerun(t);
  const file = path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json');
  const before = fs.readFileSync(file, 'utf8');
  // The image's compose names a runtime this installer doesn't set up in an account's Docker.
  const newer = `[ "$1" = run ] && [ "$8" = /opt/bot-dot/compose.yaml ] && { printf 'services:\\n  bot-dot:\\n    runtime: runsc-next\\n'; exit 0; }`;
  const again = installer(t, { again: first, dockerFirst: [newer] });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /runtime runsc-next/);
  assert.match(again.stderr, /older than the image/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the account\'s Docker keeps its settings');
  const after = again.system.slice(first.system.length);
  assert.doesNotMatch(after, /^systemctl (restart|stop) botdot-account@ann$/m, 'its containers keep running');
  assert.ok(!again.accountCalls('ann').slice(first.accountCalls('ann').length).some((c) => /^compose .* up /.test(c)), 'nothing of the account is made again');
});

test('the runtimes compose.yaml names are the ones an account\'s Docker gets', () => {
  const named = [...fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8').matchAll(/^\s*runtime:\s*([\w.-]+)/gm)].map((m) => m[1]);
  assert.ok(named.length > 0);
  const known = /^RUNTIMES='([^']*)'/m.exec(script)[1].split(' ');
  for (const r of named) assert.ok(known.includes(r), r);
});

test('an account installed before computers kept their files gets --overlay2=none, and its Docker restarts with it (#68)', (t) => {
  const first = rerun(t);
  const file = path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(', "--overlay2=none"', ''));
  const again = installer(t, { again: first });
  assert.equal(again.status, 0, again.stderr);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).runtimes.runsc.runtimeArgs.includes('--overlay2=none'));
  assert.match(again.system.slice(first.system.length), /^systemctl restart botdot-account@ann$/m, 'its computers keep their files from their next start');
});

// The log limits every container's Docker gets (#980).
const LOGS = { 'log-driver': 'json-file', 'log-opts': { 'max-size': '20m', 'max-file': '5' } };
const logsOf = (daemon) => ({ 'log-driver': daemon['log-driver'], 'log-opts': daemon['log-opts'] });
const machineDaemon = (done) => path.join(done.etc, 'docker', 'daemon.json');

test("the machine's and every account's Docker keep containers' logs to a fixed size, and the machine's restarts once for it (#980)", (t) => {
  const first = rerun(t);
  assert.deepEqual(logsOf(JSON.parse(fs.readFileSync(path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json'), 'utf8'))), LOGS);
  assert.deepEqual(JSON.parse(fs.readFileSync(machineDaemon(first), 'utf8')), LOGS);
  assert.equal(fs.statSync(machineDaemon(first)).mode & 0o777, 0o644);
  assert.equal(first.system.match(/^systemctl restart docker$/gm).length, 1);
  assert.ok(first.system.indexOf('systemctl restart docker') < first.system.indexOf('useradd'), 'before anything of botdot runs in it');
  const again = installer(t, { again: first });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.system.slice(first.system.length), /^systemctl restart docker$/m, 'a rerun leaves it running');
});

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

test('the install prints the admin\'s sign-up link, after it says that root reaches every account', (t) => {
  const done = rerun(t);
  const root = done.said.indexOf('Whoever is root on this machine can reach every account on it: its data, its bots and the logins they hold. Keep root to yourself.');
  const link = done.said.indexOf('\n  https://botdot.example.com/sign-up/T0KEN\n');
  assert.ok(root > 0 && link > root, done.said);
  assert.ok(done.calls.includes(`compose --project-directory ${done.dir}/front-door exec -T front-door node front-door.js sign-up-link --account ann`));
  assert.match(done.said, /Done\. botdot is at https:\/\/botdot\.example\.com\u001b\[0m\nOpen this link to make your account, ann, the admin's \(it works once, for 7 days\):\n/);
  assert.match(done.said, /Until it is used, botdot shows only "Open the link from your server's install"\./);

  const made = rerun(t, '', {}, { exists: true });
  assert.doesNotMatch(made.said, /\/sign-up\/|Open this link/, 'once the account exists there is no link');
  assert.match(made.said, /Whoever is root on this machine can reach every account/, 'and the warning stays');
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
  assert.match(stderr, /The installer makes a Linux user for each account, so it runs as root\. Run it with: sudo sh install\.sh/);
  assert.deepEqual(docker, []);
});

// --- The images: botdot's signed images, checked before any download (lib/signed-image.js) --------

const DOWNLOADS = /^pull ghcr\.io\//;

test('a rerun installs the newest signed images, into the machine\'s Docker and the account\'s, pinned by digest', (t) => {
  const done = rerun(t, `BOT_DOT_IMAGE=ghcr.io/kordal/bot-dot${PIN}\nBOT_DOT_COMPUTER_IMAGE=ghcr.io/kordal/bot-dot-desktop${PIN}\n`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.equal(done.env.BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`);
  assert.ok(done.calls.includes(`pull ghcr.io/kordal/bot-dot${SIGNED}`), 'the front door\'s');
  const own = done.accountCalls('ann');
  assert.ok(own.includes(`pull ghcr.io/kordal/bot-dot${SIGNED}`) && own.includes(`pull ghcr.io/kordal/bot-dot-desktop${SIGNED}`), own.join('\n'));
  assert.ok(!done.calls.includes(`pull ghcr.io/kordal/bot-dot-desktop${SIGNED}`), 'the computer only where it runs');
  assert.ok(!done.docker.some((c) => /^pull .*:latest$/.test(c.call)), 'never the tag, which may have moved since the check');
  const at = (call) => own.indexOf(call);
  assert.ok(at(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`) > at(`pull ghcr.io/kordal/bot-dot-desktop${SIGNED}`));
  assert.ok(at(`compose --project-directory ${done.dir}/accounts/ann exec -T --user 60000:60000 bot-dot node /opt/bot-dot/lib/update-install.js --clean`) > at(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`), 'the cleanup comes after the new containers');
  // The stand-in gives the cleanup no answer: one warning, and the installer ends as always.
  assert.match(done.said, /Couldn't remove every old image now; the next update tries again\./);
});

test('an update makes room first: the images no container uses go before the new ones are downloaded (#190)', (t) => {
  const was = `ghcr.io/kordal/bot-dot${PIN}`, desk = `ghcr.io/kordal/bot-dot-desktop${PIN}`;
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
  assert.ok(inAccount < at(own, new RegExp(`^pull ghcr\\.io/kordal/bot-dot@`)), 'before the account\'s download');
  const args = calls[inAccount].call.split(' ');
  assert.equal(args[12], `ghcr.io/kordal/bot-dot${SIGNED}`, 'run from the new version, already in the machine\'s Docker');
  assert.deepEqual(args.slice(14), [`ghcr.io/kordal/bot-dot${SIGNED}`, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`, `ghcr.io/kordal/bot-dot${SIGNED}`, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`]);
  // The machine's Docker: by the rule of the version it runs now, before the front door's download.
  const inMachine = at('machine', cleanup('/var/run/docker\\.sock'));
  assert.ok(inMachine >= 0 && inMachine < at('machine', /^pull ghcr\.io\/kordal\/bot-dot@/), 'before the machine\'s download');
  const machine = calls[inMachine].call.split(' ');
  assert.equal(machine[12], first.env.BOT_DOT_IMAGE, 'run from what the machine runs now');
  assert.deepEqual(machine.slice(14), [first.env.BOT_DOT_IMAGE, first.env.BOT_DOT_COMPUTER_IMAGE]);
  // The stand-in's cleanup answers nothing: a warning, and the update goes on.
  assert.match(done.said, /Couldn't remove the old images first; the download goes on\./);
});

test('a first install has nothing to make room for in the machine\'s Docker', (t) => {
  const fresh = installer(t, { dotenv: '', input: '1\nbotdot.example.com\nann\n' });
  assert.equal(fresh.status, 0, fresh.stderr);
  const download = fresh.calls.findIndex((c) => c.startsWith('pull ghcr.io/kordal/bot-dot@'));
  const cleanup = fresh.calls.findIndex((c) => c.includes('-v /var/run/docker.sock:/var/run/docker.sock') && c.includes('image-cleanup.js'));
  assert.ok(download >= 0);
  assert.ok(cleanup === -1 || cleanup > download, 'nothing runs before the first download');
});

test('what the room made first is said: how many images went and how much space came back', (t) => {
  const first = rerun(t);
  const answer = (json) => `case "$*" in *image-cleanup.js*) echo '${json}'; exit 0 ;; esac`;
  const freed = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: [answer('{"removed":3,"skipped":0,"failed":0,"bytes":7400000000}')] });
  assert.equal(freed.status, 0, freed.stderr);
  assert.match(freed.said, /Made room first: removed 3 old images \(7\.4 GB freed\)/);
  const none = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: [answer('{"removed":0,"skipped":1,"failed":0,"bytes":0}')] });
  assert.equal(none.status, 0, none.stderr);
  assert.doesNotMatch(none.said, /Made room first|Couldn't remove the old images first/);
});

test("a download that fails says Docker's own reason, as far as the admin page (#190)", (t) => {
  const server = `ghcr.io/kordal/bot-dot${SIGNED}`;
  const done = rerun(t, '', {}, { failPull: server, refuse: true });
  assert.match(done.stderr, new RegExp(`Couldn't download ${server.replace(/[.]/g, '\\.')}: failed to register layer: write \\S+: no space left on device\\.`));
  // The same through root's step, for the admin page.
  const { first } = withBob(t);
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const step = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], failPull: server });
  assert.equal(step.status, 0, `${step.said}\n${step.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  assert.equal(update.state, 'failed');
  assert.match(update.error, /no space left on device\.$/);
});

test("an update pins the bots' computer's new image but doesn't download it into an account whose computer is kept (#191)", (t) => {
  const first = rerun(t);
  const has = `[ -n "\${DOCKER_HOST:-}" ] && [ "$1" = ps ] && [ "$4" = label=botdot.computer=account ] && { echo 4f1c2a; exit 0; }`;
  const done = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: [has] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const own = done.accountCalls('ann').slice(first.accountCalls('ann').length);
  assert.ok(own.includes(`pull ghcr.io/kordal/bot-dot${SIGNED}`), 'the server is downloaded');
  assert.ok(!own.some((c) => c.startsWith('pull ghcr.io/kordal/bot-dot-desktop')), own.join('\n'));
  assert.equal(done.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`, 'and pinned for its next update or reset');
  assert.match(done.said, /The bots' computer keeps its image; its Update or reset takes the newest/);
});


test('an update stops before any download when an account\'s disk is short of room, and the admin page says it (#192)', (t) => {
  const { first } = withBob(t);
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  // 1 GB free; the update needs 2 GB downloaded and unpacked (6 GB) and 1 GB to go on working.
  const step = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: roomAnswers(), given: { STAND_IN_DISK_FREE: '1048576' } });
  assert.equal(step.status, 0, `${step.said}\n${step.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  assert.equal(update.state, 'failed');
  assert.equal(update.error, 'The account ann needs 7.0 GB free for this update and has 1.1 GB. Give it a bigger disk share, or update or reset its computer so the old computer image can go, then update again. No account was changed.');
  assert.equal(update.phase, 'preflight', 'the admin page names the phase it stopped in (#195)');
  assert.equal(update.account, 'ann');
  const since = step.docker.slice(before);
  assert.ok(since.some((c) => /lib\/image-layers\.js ghcr\.io\/kordal\/bot-dot@/.test(c.call)), 'the registry is asked for the signed image\'s layers');
  assert.ok(since.some((c) => c.call.includes(`-v ${first.run}/ann/docker.sock:/var/run/docker.sock`) && c.call.includes('image-cleanup.js')), 'after the account\'s unused images went');
  assert.deepEqual(since.filter((c) => /^pull /.test(c.call)).map((c) => c.call), [], 'nothing is downloaded');
  assert.deepEqual(since.filter((c) => /^compose .* up/.test(c.call)).map((c) => c.call), [], 'nothing is restarted');
});

test('an update with room in every account goes on, and so does one whose registry gives no sizes (#192)', (t) => {
  const first = rerun(t);
  // Downloaded into the machine's Docker and the account's.
  const downloads = (done) => [...new Set(done.docker.slice(first.docker.length).filter((c) => /^pull ghcr\.io\/kordal\/bot-dot@/.test(c.call)).map((c) => c.host))].length;
  const roomy = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: roomAnswers() });
  assert.equal(roomy.status, 0, `${roomy.said}\n${roomy.stderr}`);
  assert.equal(downloads(roomy), 2);
  // Short of room, but nothing to download: the account has every layer. The snapshot of its data isn't counted: one
  // without room is skipped at its switch.
  const has = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: roomAnswers(`${KEPT_LAYER} 500000000\\n`), given: { STAND_IN_DISK_FREE: '64' } });
  assert.equal(has.status, 0, `${has.said}\n${has.stderr}`);
  // An older registry's answer: no layers, no check.
  const unknown = installer(t, { again: first, dotenv: '', args: ['--update'], given: { STAND_IN_DISK_FREE: '1' } });
  assert.equal(unknown.status, 0, `${unknown.said}\n${unknown.stderr}`);
  assert.match(unknown.said, /Couldn't tell how much room the update needs in each account; it goes on without that check\./);
  assert.equal(downloads(unknown), 2);
});

test('a computer image that could not be downloaded now is downloaded by botdot later', (t) => {
  const { said, accountEnv } = rerun(t, '', {}, { failPull: `ghcr.io/kordal/bot-dot-desktop${SIGNED}` });
  assert.match(said, /Couldn't download the bots' computer now; botdot tries again when a bot needs it\./);
  assert.equal(accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`);
});

test('the image it is given is installed as its repository\'s signed release, as the updater does', (t) => {
  const mine = `ghcr.io/kordal/bot-dot@sha256:${'b'.repeat(64)}`;
  const { env, checks } = rerun(t, `BOT_DOT_IMAGE=ghcr.io/kordal/bot-dot${PIN}\n`, { BOT_DOT_IMAGE: mine });
  assert.equal(checked(checks[0])[0], mine);
  assert.equal(env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
});

test('compose starts what .env names, not the names the installer was given', () => {
  const unset = code.indexOf('unset BOT_DOT_IMAGE BOT_DOT_COMPUTER_IMAGE');
  assert.ok(unset > code.lastIndexOf('set_env "$ENV" BOT_DOT_COMPUTER_IMAGE') && unset < code.indexOf('up -d --remove-orphans'), 'after .env has them, before compose reads them');
});

test('both images\' signatures are checked before anything of botdot\'s is downloaded', (t) => {
  const { docker, checks } = rerun(t);
  assert.deepEqual(checks.map((args) => checked(args).slice(0, 2)), [['ghcr.io/kordal/bot-dot:latest', 'server'], ['ghcr.io/kordal/bot-dot-desktop:latest', 'desktop']]);
  const lastCheck = docker.reduce((last, c, i) => (c.call.includes('/check/lib/signed-image.js') ? i : last), -1);
  assert.ok(docker.findIndex((c) => DOWNLOADS.test(c.call)) > lastCheck, docker.map((c) => c.call).join('\n'));
});

test('the check is the source\'s own, on the Node of botdot\'s image, as nobody, with nothing to write', (t) => {
  const args = rerun(t).checks[0].join(' ');
  const node = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').match(/^ARG NODE_IMAGE=(.+)$/m)[1];
  assert.ok(args.startsWith('run --rm -i '), args);
  assert.ok(args.includes(` -v ${ROOT}/lib:/check/lib:ro `), `the source next to the installer: ${args}`);
  assert.ok(args.includes(` ${node} node /check/lib/signed-image.js `), `the Dockerfile's Node, pinned by its digest: ${args}`);
  for (const flag of ['--pull never', '--network host', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--user 65534:65534']) assert.ok(args.includes(` ${flag} `), flag);
});

test('an unsigned image stops the installer before any download, with a sentence that says why', (t) => {
  const { said, stderr, docker, env } = rerun(t, '', {}, { signed: { 'ghcr.io/kordal/bot-dot:latest': 'it has no botdot signature' }, refuse: true });
  assert.match(stderr, /Refused ghcr\.io\/kordal\/bot-dot:latest: it has no botdot signature\. Nothing was downloaded or started\./);
  assert.ok(!docker.some((c) => DOWNLOADS.test(c.call) || /^compose .*(up|exec)/.test(c.call)), docker.map((c) => c.call).join('\n'));
  assert.doesNotMatch(said, /up to date|running/);
  assert.equal(env.BOT_DOT_IMAGE, undefined);
});

test('a computer image signed with another key stops the installer before the server is downloaded too', (t) => {
  const { stderr, docker } = rerun(t, '', {}, { signed: { 'ghcr.io/kordal/bot-dot-desktop:latest': "it is signed, but not with botdot's release key" }, refuse: true });
  assert.match(stderr, /Refused ghcr\.io\/kordal\/bot-dot-desktop:latest: it is signed, but not with botdot's release key\. Nothing was downloaded or started\./);
  assert.ok(!docker.some((c) => DOWNLOADS.test(c.call) || /^compose .*(up|exec)/.test(c.call)));
});

test('the registry token goes to the check on its input, never on its command line', (t) => {
  const { checks, docker, accountEnv } = rerun(t, 'BOT_DOT_REGISTRY_TOKEN=ghp_stored\n', {}, { answers: { private: '', 'good-token': 'ghp_stored' } });
  assert.equal(checks.length, 2);
  assert.ok(!docker.some((c) => c.call.includes('ghp_stored')));
  assert.equal(accountEnv('ann').BOT_DOT_REGISTRY_TOKEN, 'ghp_stored', 'the account\'s botdot downloads newer computers with it');
});

test('a stored token the registry refuses ends the installer before any download', (t) => {
  const { stderr, docker } = rerun(t, 'BOT_DOT_REGISTRY_TOKEN=ghp_old\n', {}, { answers: { private: '', 'good-token': 'ghp_new' }, refuse: true });
  assert.match(stderr, /That token didn't work for ghcr\.io\. Check that it has the read:packages scope\./);
  assert.ok(!docker.some((c) => DOWNLOADS.test(c.call)));
});

test('without botdot\'s source next to it, the installer says where to get it and downloads nothing', (t) => {
  const alone = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-installer-'));
  t.after(() => fs.rmSync(alone, { recursive: true, force: true }));
  fs.copyFileSync(file, path.join(alone, 'install.sh'));
  const { stderr, docker } = rerun(t, '', {}, { script: path.join(alone, 'install.sh'), refuse: true });
  assert.match(stderr, /checks the signature of botdot's images with botdot's source/);
  assert.ok(!docker.some((c) => c.call.startsWith('pull') || c.call.startsWith('run')));
});

const touchesRegistry = (docker) => docker.filter((c) => /^(pull|login|push)\b/.test(c.call));

test('a self-built install asks for no token, downloads nothing, and hands both images to the account', (t) => {
  const { env, docker, said, accountCalls, accountEnv } = rerun(t, '', SELF);
  assert.deepEqual(touchesRegistry(docker), []);
  assert.doesNotMatch(said, /Token:|private|Downloading/);
  assert.match(said, /Using the local image bot-dot\/server:latest/);
  assert.match(said, /Using the local image bot-dot\/desktop:latest for the bots' computer/);
  assert.equal(env.BOT_DOT_IMAGE, 'bot-dot/server:latest');
  assert.equal(accountEnv('ann').BOT_DOT_IMAGE, 'bot-dot/server:latest');
  assert.equal(accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, 'bot-dot/desktop:latest');
  assert.equal(env.BOT_DOT_REGISTRY_TOKEN, undefined);
  assert.ok(docker.some((c) => c.host === 'machine' && c.call === 'save bot-dot/server:latest'));
  assert.ok(docker.some((c) => c.host === 'machine' && c.call === 'save bot-dot/desktop:latest'));
  assert.equal(accountCalls('ann').filter((c) => c === 'load -q').length, 2);
});

test('a rerun after a rebuild keeps the self-built images, and still downloads nothing', (t) => {
  const { env, docker } = rerun(t, 'BOT_DOT_IMAGE=bot-dot/server:latest\nBOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest\n');
  assert.deepEqual(touchesRegistry(docker), []);
  assert.equal(env.BOT_DOT_IMAGE, 'bot-dot/server:latest');
  assert.equal(env.BOT_DOT_COMPUTER_IMAGE, 'bot-dot/desktop:latest');
});

test('naming botdot\'s images goes back from self-built to them', (t) => {
  const { env, calls } = rerun(t, 'BOT_DOT_IMAGE=bot-dot/server:latest\nBOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest\n', { BOT_DOT_IMAGE: 'ghcr.io/kordal/bot-dot:latest' });
  assert.ok(calls.includes(`pull ghcr.io/kordal/bot-dot${SIGNED}`));
  assert.equal(env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.equal(env.BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`);
});

// --- What the installer tells a stranger, and what it leaves to botdot ------------------------------

test('a missing curl is said at the start, before anything is installed', (t) => {
  const { status, stderr, docker } = installer(t, { bins: { curl: null }, onlyStandIns: true });
  assert.equal(status, 1);
  assert.match(stderr, /The installer needs curl\./);
  assert.deepEqual(docker, [], 'Docker is not even asked');
});

test('a missing docker compose names the package for each Docker', (t) => {
  const { status, stderr } = installer(t, { noCompose: true });
  assert.equal(status, 1);
  assert.match(stderr, /Docker Compose \(docker compose\) is missing\. Install the package for your Docker and run this again:/);
  assert.match(stderr, /Docker's own packages \(docker-ce, from Docker's repository\): docker-compose-plugin/);
  assert.match(stderr, /Ubuntu's docker\.io: docker-compose-v2/);
  assert.match(stderr, /Debian's docker\.io: docker-compose on Debian 13\. Debian 12 has none/);
  const fine = rerun(t);
  assert.doesNotMatch(fine.said + fine.stderr, /Compose/, 'and nothing when it is there');
});

test('the installer removes no image of botdot by name: botdot decides which old ones go', () => {
  // The one removal: in an account's Docker of a self-built install, the images a newer build left without a name,
  // each by its id and never forced (lib/image-cleanup.js knows only the signed images).
  const removals = code.split('\n').filter((l) => /\bimage\s+(rm|prune)\b|\brmi\b|\b(system|container|volume|builder|buildx)\s+prune\b/.test(l)).map((l) => l.trim());
  assert.deepEqual(removals, ['case "$was" in sha256:*) $A image rm "$was" </dev/null >/dev/null 2>&1 || true ;; esac']);
  assert.match(code, /for was in \$\(\$A image ls -q --no-trunc --filter dangling=true/);
});

// The sentence is made by the image's own Node, as install.sh's json() does it.
function sentence(result) {
  const expression = script.match(/CLEANED="\$\(printf '%s' "\$CLEANED" \| json '(.+)' \|\| true\)"/)[1];
  const program = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(String((${expression})??''))}catch{}})`;
  return execFileSync(process.execPath, ['-e', program], { input: result, encoding: 'utf8' });
}

test('the cleanup line says how many images went and how much space came back, or warns', () => {
  assert.equal(sentence('{"removed":3,"skipped":1,"failed":0,"bytes":4200000000}'), 'Removed 3 old images (4.2 GB freed)');
  assert.equal(sentence('{"removed":1,"skipped":0,"failed":0,"bytes":90000000}'), 'Removed 1 old image (0.1 GB freed)');
  assert.equal(sentence('{"removed":2,"skipped":0,"failed":0,"bytes":2000002}'), 'Removed 2 old images (2 MB freed)');
  assert.equal(sentence('{"removed":1,"skipped":0,"failed":0,"bytes":0}'), 'Removed 1 old image', 'Docker did not tell the size');
  assert.equal(sentence('{"removed":0,"skipped":2,"failed":0,"bytes":0}'), 'No old images to remove');
  assert.equal(sentence('{"removed":2,"skipped":0,"failed":1,"bytes":10}'), '');
  assert.equal(sentence(''), '');
  assert.equal(sentence('not json'), '');
});

// A function of install.sh, run on its own in sh.
function shell(name, args = [], env = {}) {
  const body = script.match(new RegExp(`^${name}\\(\\) \\{\\n[^]*?\\n\\}$`, 'm'));
  assert.ok(body, `install.sh has the function ${name}`);
  return execFileSync('/bin/sh', ['-c', `${body[0]}\n${name} "$@"`, name, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env } }).trim();
}
// A folder of files; a text that starts with -> is a symbolic link to the rest.
function folder(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-etc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    if (text.startsWith('->')) fs.symlinkSync(text.slice(2), path.join(dir, name));
    else fs.writeFileSync(path.join(dir, name), text, { mode: text.startsWith('#!') ? 0o755 : 0o644 });
  }
  return dir;
}

test('botdot takes the machine\'s time zone, or UTC when it has none', (t) => {
  const chicago = folder(t, { timedatectl: '#!/bin/sh\necho America/Chicago\n' });
  const none = folder(t, { timedatectl: '#!/bin/sh\nexit 1\n' });
  const zone = (etc, bin = none) => shell('host_time_zone', [etc], { PATH: `${bin}:/usr/bin:/bin` });
  assert.equal(zone(folder(t, { timezone: 'Asia/Tokyo\n' }), chicago), 'America/Chicago', 'timedatectl first, where there is one');
  assert.equal(zone(folder(t, { timezone: 'Asia/Tokyo\n' })), 'Asia/Tokyo');
  assert.equal(zone(folder(t, { localtime: '->/usr/share/zoneinfo/Europe/Lisbon' })), 'Europe/Lisbon');
  assert.equal(zone(folder(t, { localtime: '->../usr/share/zoneinfo/Etc/GMT+5' })), 'Etc/GMT+5');
  assert.equal(zone(folder(t, {})), 'UTC', 'none at all');
  assert.equal(zone(folder(t, { localtime: '->/opt/clock/here' })), 'UTC', 'a link that names no zone');
  assert.equal(zone(folder(t, { timezone: 'not a zone\n' })), 'UTC');

  const { env, said, accountEnv } = installer(t, { dotenv: ANSWERED.replace('TZ=UTC\n', ''), bins: { timedatectl: '#!/bin/sh\necho America/Chicago\n' } });
  assert.equal(env.TZ, 'America/Chicago');
  assert.equal(accountEnv('ann').TZ, 'America/Chicago', 'the account\'s botdot server gets it');
  assert.match(said, /Time zone America\/Chicago/);
  assert.equal(rerun(t, '', {}, { bins: { timedatectl: '#!/bin/sh\necho America/Chicago\n' } }).env.TZ, 'UTC', 'a time zone in .env stays');
});

test('compose gives the server, the helper and the front door the time zone of .env, or UTC', () => {
  for (const [name, services] of [['compose.yaml', ['bot-dot', 'docker-helper']], ['compose.front-door.yaml', ['front-door']]]) {
    const compose = fs.readFileSync(path.join(ROOT, name), 'utf8');
    for (const service of services) {
      const block = compose.slice(compose.indexOf(`\n  ${service}:\n`) + 1).split(/\n {2}(?=\S)/)[0];
      assert.match(block, /\n {6}TZ: \$\{TZ:-UTC\}/, `${name}: ${service}`);
    }
  }
});

test('an account\'s botdot server keeps a network of its own, and its helper the account\'s Docker', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  // The account's Docker's default network, never the machine's (ADR 028): under gVisor only there do names resolve.
  assert.deepEqual(compose.match(/^ {4}network_mode: \S+/gm), ['    network_mode: bridge', '    network_mode: bridge']);
  assert.doesNotMatch(compose, /network_mode: host|^networks:/m);
  assert.match(compose, /- \$\{DOCKER_SOCKET:-\/var\/run\/docker\.sock\}:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \$\{BOT_DOT_FRONT_DOOR_FOLDER:-\.\/front-door\}:\/run\/front-door/);
  assert.match(compose, /BOT_DOT_FRONT_DOOR_SOCKET: \/run\/front-door\/botdot\.sock/);
  for (const name of ['compose.yaml', 'compose.front-door.yaml', 'install.sh', 'README.md', 'docs/install-linux.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, name), 'utf8'), /BOT_DOT_ALLOWED_USERS/, `${name}: the variable does nothing since the front door`);
  }
});

// --- Jev and boat.dev ------------------------------------------------------------------------------

// The image's key check (lib/group-router.js, lib/boat.js and lib/connectors.js checkKey), stood in for: a key starting "good" is taken,
// "down" can't be checked, any other is refused. It writes down which check it was asked and the key it read.
const keyChecks = [
  'case "$*" in *checkKey*) k="$(cat)"; for a; do l="$a"; done; echo "checkKey $l $k" >> "$STAND_IN_LOG";',
  '  case "$k" in good*) printf ok ;; down*) printf unreachable ;; *) printf refused ;; esac; exit 0 ;; esac',
];
const keysOf = (done) => { const f = path.join(done.dir, 'front-door', 'data', 'install-keys.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

test('a first install asks for Jev, boat.dev and Composio, checks each key, asks again after a refusal, and hands them to the front door', (t) => {
  const done = installer(t, { dotenv: '', dockerFirst: keyChecks, input: '1\nbots.example.org\nann\ny\nwrong-key-1\ny\ngood-openrouter-1\ny\ngood-boat-1\ny\ngood-composio-1\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /Use Jev as the decision model\? \[y\/N\]/);
  assert.match(done.said, /OpenRouter key:/);
  assert.match(done.said, /OpenRouter refused this key\./);
  assert.match(done.said, /Use boat\.dev for the External Virtual PC\? \[y\/N\]/);
  assert.match(done.said, /boat\.dev API key:/);
  assert.match(done.said, /Use Composio for connectors\? \[y\/N\]/);
  assert.match(done.said, /Composio API key:/);
  // Where each key is made, on the line before its prompt.
  assert.match(done.said, /https:\/\/openrouter\.ai\/settings\/keys\nOpenRouter key:/);
  assert.match(done.said, /https:\/\/boat\.dev\/dashboard\?tab=api-keys\nboat\.dev API key:/);
  assert.match(done.said, /https:\/\/platform\.composio\.dev\nComposio API key:/);
  assert.ok(!['good-openrouter-1', 'good-boat-1', 'good-composio-1'].some((k) => done.said.includes(k)), 'a key is never shown');
  assert.match(done.system, /checkKey group-router wrong-key-1\ncheckKey group-router good-openrouter-1\ncheckKey boat good-boat-1\ncheckKey connectors good-composio-1/);
  assert.ok(done.calls.every((c) => !c.includes('good-')), 'a key goes on standard input, never on a command line');
  assert.deepEqual(keysOf(done), { openrouter: 'good-openrouter-1', boat: 'good-boat-1', composio: 'good-composio-1' });
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', 'data', 'install-keys.json')).mode & 0o777, 0o600);
  assert.match(done.system, /chown \d+:\d+ \S*front-door\/data\/install-keys\.json/, "the front door's to take");
  assert.ok(!Object.keys(done.env).some((k) => /OPENROUTER|BOAT|COMPOSIO/.test(k)), 'no key in .env');

  const again = installer(t, { dotenv: fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8'), dockerFirst: keyChecks });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.said, /Jev|boat\.dev|Composio/, 'a rerun asks nothing again: the admin page and the Apps page set them');
});

test('a first install with no answer takes neither, and an unreachable check is left to the admin page', (t) => {
  const none = installer(t, { dotenv: '', dockerFirst: keyChecks, input: '1\nbots.example.org\nann\n' });
  assert.equal(none.status, 0, `${none.said}\n${none.stderr}`);
  assert.match(none.said, /Use Jev as the decision model\?/);
  assert.equal(keysOf(none), null);
  assert.doesNotMatch(none.system, /checkKey/);

  const down = installer(t, { dotenv: '', dockerFirst: keyChecks, input: '1\nbots.example.org\nann\ny\ndown-key-1\nn\n' });
  assert.equal(down.status, 0, `${down.said}\n${down.stderr}`);
  assert.match(down.said, /OpenRouter couldn't be reached: set the key on the admin page\./);
  assert.equal(keysOf(down), null);
});

test('BOT_DOT_OPENROUTER_KEY, BOT_DOT_BOAT_KEY and BOT_DOT_COMPOSIO_KEY answer beforehand, empty is no, and a refused one only warns', (t) => {
  const given = installer(t, { dotenv: '', dockerFirst: keyChecks, given: { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'bots.example.org', BOT_DOT_ADMIN: 'bea', BOT_DOT_OPENROUTER_KEY: 'good-openrouter-2', BOT_DOT_BOAT_KEY: '', BOT_DOT_COMPOSIO_KEY: '' } });
  assert.equal(given.status, 0, `${given.said}\n${given.stderr}`);
  assert.doesNotMatch(given.said, /Use Jev|Use boat\.dev|Use Composio/, 'nothing asked');
  assert.match(given.said, /OpenRouter key set/);
  assert.deepEqual(keysOf(given), { openrouter: 'good-openrouter-2', boat: null, composio: null });

  const rerunGiven = rerun(t, '', { BOT_DOT_BOAT_KEY: 'good-boat-2' }, { dockerFirst: keyChecks });
  assert.deepEqual(keysOf(rerunGiven), { openrouter: null, boat: 'good-boat-2', composio: null }, 'on a rerun too');

  const composio = rerun(t, '', { BOT_DOT_COMPOSIO_KEY: 'good-composio-2' }, { dockerFirst: keyChecks });
  assert.match(composio.said, /Composio key set/);
  assert.deepEqual(keysOf(composio), { openrouter: null, boat: null, composio: 'good-composio-2' });

  const composioRefused = rerun(t, '', { BOT_DOT_COMPOSIO_KEY: 'bad-composio-2' }, { dockerFirst: keyChecks });
  assert.match(composioRefused.said, /Composio refused BOT_DOT_COMPOSIO_KEY: set the key on the Apps page\./);
  assert.equal(keysOf(composioRefused), null);

  const refused = rerun(t, '', { BOT_DOT_BOAT_KEY: 'bad-boat-2' }, { dockerFirst: keyChecks });
  assert.match(refused.said, /boat\.dev refused BOT_DOT_BOAT_KEY: set the key on the admin page\./);
  assert.equal(keysOf(refused), null);
});

test('botdot on this computer only never asks for Jev, boat.dev or Composio: it has no admin page', (t) => {
  const done = installer(t, { dotenv: '', dockerFirst: keyChecks, given: { BOT_DOT_REACH: 'local', BOT_DOT_OPENROUTER_KEY: 'good-openrouter-3', BOT_DOT_COMPOSIO_KEY: 'good-composio-3' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /Jev|boat\.dev|OpenRouter|Composio/);
  assert.doesNotMatch(done.system, /checkKey/);
  assert.equal(keysOf(done), null);
});
