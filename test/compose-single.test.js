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

// A value as Compose fills it in from the app's environment: ${NAME:-default}.
const filled = (value, vars) => String(value).replace(/\$\{(\w+):-([^}]*)\}/g, (_, name, def) => vars[name] || def);

test("the one account's name is FRONT_DOOR_ACCOUNT, owner by default, the same in the front door and botdot", () => {
  for (const file of ['compose.single.yaml', 'compose.mac.yaml']) {
    const s = parseYaml(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).services;
    for (const [vars, name] of [[{}, 'owner'], [{ FRONT_DOOR_ACCOUNT: 'ann-2' }, 'ann-2']]) {
      assert.equal(filled(s['front-door'].environment.FRONT_DOOR_ONE_ACCOUNT, vars), name, file);
      assert.equal(filled(s['bot-dot'].environment.BOT_DOT_ACCOUNT, vars), name, file);
      assert.equal(filled(s['bot-dot'].environment.BOT_DOT_FRONT_DOOR_SOCKET, vars), `/run/front-door/${name}/botdot.sock`, file);
    }
  }
});

test('one account, made with the setup key, and the client is the address the proxy added', () => {
  const env = services['front-door'].environment;
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

// The front door's data folder as the init step leaves it, run with stand-ins for stat, chmod and chown. Like the real
// step (root with only CAP_CHOWN), the chmod is refused on a folder that is no longer root's.
const initStep = (owner) => {
  const { spawnSync } = require('child_process');
  const bin = fs.mkdtempSync(path.join(require('os').tmpdir(), 'front-door-data-'));
  const log = path.join(bin, 'calls');
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
  stub('stat', `echo "$FOLDER"`);
  stub('chmod', `case "$FOLDER" in 0:*) ;; *) echo "chmod: changing permissions of '/front-door': Operation not permitted" >&2; exit 1;; esac`);
  stub('chown', '');
  // Compose reads $$ as one $.
  const script = services['front-door-data'].entrypoint.at(-1).replace(/\$\$/g, '$');
  const run = spawnSync('sh', ['-c', script], { env: { PATH: `${bin}:/usr/bin:/bin`, FOLDER: owner }, encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter((l) => !l.startsWith('stat ')) : [];
  fs.rmSync(bin, { recursive: true, force: true });
  return { status: run.status, calls };
};

test("the front door's data step gives a new volume to its user, and leaves one it already has as it is, so a redeploy starts", () => {
  assert.deepEqual(initStep('0:0:755'), { status: 0, calls: ['chmod 700 /front-door', 'chown 60000:60000 /front-door'] }, 'a new volume');
  assert.deepEqual(initStep('60000:60000:700'), { status: 0, calls: [] }, 'a redeploy');
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
