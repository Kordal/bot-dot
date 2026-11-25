// install.sh on a stand-in machine (test/installer-helpers.js): a first install, botdot's signed images, and what
// the installer tells a stranger. The other installer tests are in installer-*.test.js, so that they run side by side.
// Part 2 of 6 of the install tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tailscale, installer, rerun } = require('./installer-helpers');

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
  assert.equal(done.env.COMPOSE_PROFILES, 'embed', 'no Caddy, but the shared embedding server');
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
  assert.doesNotMatch(done.said, /admin page|Whoever has full control/);
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
