// install.sh on a stand-in machine (test/installer-helpers.js): a first install, botdot's signed images, and what
// the installer tells a stranger. The other installer tests are in installer-*.test.js, so that they run side by side.
// Part 1 of 3 of the install tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, tailscale, installer, rerun } = require('./installer-helpers');

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
  assert.equal(done.env.COMPOSE_PROFILES, 'public,embed', 'Caddy starts with the front door, and the shared embedding server beside it');
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
