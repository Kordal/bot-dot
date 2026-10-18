// compose.single.yaml (docs/install-docker.md): botdot as one Compose app behind a Docker host's own reverse proxy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseYaml } = require('./workflow-runners');

const compose = parseYaml(fs.readFileSync(path.join(__dirname, '..', 'compose.single.yaml'), 'utf8'));
const { services } = compose;

test('nothing publishes a port or uses the host network: the host\'s proxy reaches the front door on 4700', () => {
  for (const [name, s] of Object.entries(services)) {
    assert.equal(s.ports, undefined, name);
    assert.notEqual(s.network_mode, 'host', name);
  }
  assert.deepEqual(services['front-door'].expose, ['4700']);
  assert.equal(services['front-door'].environment.FRONT_DOOR_PORT, 4700);
});

test('one account, made with the setup key, and the client is the address the proxy added', () => {
  const env = services['front-door'].environment;
  assert.equal(env.FRONT_DOOR_ONE_ACCOUNT, 'owner');
  assert.equal(services['bot-dot'].environment.BOT_DOT_ACCOUNT, 'owner');
  assert.equal(services['bot-dot'].environment.BOT_DOT_FRONT_DOOR_SOCKET, '/run/front-door/owner/botdot.sock');
  assert.equal(String(env.FRONT_DOOR_BEHIND_PROXY), '1');
  assert.match(env.FRONT_DOOR_ORIGIN, /^\$\{FRONT_DOOR_ORIGIN:\?/, 'required');
  assert.match(env.FRONT_DOOR_SETUP_KEY, /^\$\{FRONT_DOOR_SETUP_KEY:\?/, 'required');
  assert.match(env.FRONT_DOOR_ANDROID_KEYS, /^\$\{FRONT_DOOR_ANDROID_KEYS:-([0-9A-F]{2}:){31}[0-9A-F]{2}\}$/);
  assert.equal(services['bot-dot'].environment.BOT_DOT_PLATFORM, undefined, 'the Linux platform, not the Mac\'s');
});

test('data is kept in named volumes, which a redeploy keeps, and the front door\'s is given to its user first', () => {
  for (const [name, s] of Object.entries(services)) {
    for (const v of s.volumes || []) {
      const from = String(v).split(':')[0];
      assert.ok(from === '/var/run/docker.sock' || Object.hasOwn(compose.volumes, from), `${name}: ${v}`);
    }
  }
  assert.equal(services['front-door'].user, '60000:60000');
  assert.equal(services['front-door'].depends_on['front-door-data'].condition, 'service_completed_successfully');
  assert.match(services['front-door-data'].entrypoint.join(' '), /chown 60000:60000 \/front-door/);
  assert.deepEqual(services['front-door-data'].cap_add, ['CHOWN']);
});

test('every service drops its capabilities and new privileges', () => {
  for (const [name, s] of Object.entries(services)) {
    assert.deepEqual(s.cap_drop, ['ALL'], name);
    assert.deepEqual(s.security_opt, ['no-new-privileges:true'], name);
  }
});

test('Caddy, for a host without a proxy, takes 80 and 443 and passes everything to the front door', () => {
  const caddy = parseYaml(fs.readFileSync(path.join(__dirname, '..', 'compose.single.caddy.yaml'), 'utf8')).services.caddy;
  assert.match(caddy.image, /^caddy:\d+\.\d+/, 'a pinned version');
  assert.deepEqual(caddy.command.slice(0, 2), ['caddy', 'reverse-proxy']);
  assert.equal(caddy.command.at(-1), 'front-door:4700');
  assert.deepEqual(caddy.ports, ['80:80', '443:443', '443:443/udp']);
});
