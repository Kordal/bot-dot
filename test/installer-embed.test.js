// install.sh on a stand-in machine (test/installer-helpers.js): the machine's one shared embedding server (ADR 273) and
// each account's way into it, a folder of its own with a Unix socket in it, the mirror of the front door's socket folder.
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, SUB, installer, rerun, withBob } = require('./installer-helpers');

const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('a machine with accounts has an embedding server of its own user, and each account a folder only its server and that user enter', (t) => {
  const done = rerun(t);
  assert.match(done.system, /^useradd --system --user-group --no-create-home --home-dir \/nonexistent --shell \/usr\/sbin\/nologin botdot-embed$/m);
  assert.equal(done.env.FRONT_DOOR_USER, '990:990', "the front door's user is as before");
  assert.equal(done.env.BOT_DOT_EMBED_USER, '989:989');
  assert.equal(done.env.BOT_DOT_EMBED_SOCKETS, `${done.dir}/embed`);
  assert.equal(done.env.COMPOSE_PROFILES, 'public,embed', 'the embedding server starts with the front door');
  assert.equal(fs.statSync(`${done.dir}/embed`).mode & 0o777, 0o755, 'the service lists the accounts there');

  // The folder: the account's botdot server's user (60000 in its containers) owns it, shut to everyone, and the
  // embedding server's user alone may enter it, to make the socket. The chmod comes before the setfacl, which sets the mask.
  const folder = `${done.dir}/embed/ann`;
  assert.match(done.system, new RegExp(`^chown ${SUB + 59999}:${SUB + 59999} ${folder}$`, 'm'));
  assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
  assert.match(done.system, new RegExp(`^setfacl -m u:botdot-embed:wx,m::wx ${folder}$`, 'm'));
  assert.ok(done.system.indexOf(`setfacl -m u:botdot-embed:wx,m::wx ${folder}`) > done.system.indexOf(`chown ${SUB + 59999}:${SUB + 59999} ${folder}`));
  assert.doesNotMatch(done.system, /setfacl -m g:botdot-door.* \S*\/embed\//, "the front door has no way into it");
  assert.doesNotMatch(done.system, new RegExp(`setfacl -m u:botdot-embed.* ${done.dir}/sockets/`), "and the embedding server none into the front door's");

  // Its botdot server is told the socket, and has the folder.
  const env = done.accountEnv('ann');
  assert.equal(env.EMBED_SOCKET, '/run/embed/embed.sock');
  assert.equal(env.BOT_DOT_EMBED_FOLDER, folder);
  assert.ok(done.accountCalls('ann').includes(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`));
});

test("a second account has a folder of its own, and a suspended account's stays", (t) => {
  const { first, door, step } = withBob(t);
  const bob = path.join(first.dir, 'embed', 'bob');
  assert.ok(fs.statSync(bob).isDirectory());
  assert.equal(fs.statSync(bob).mode & 0o777, 0o700);
  assert.equal(first.accountEnv('bob').BOT_DOT_EMBED_FOLDER, bob);
  assert.notEqual(first.accountEnv('bob').BOT_DOT_EMBED_FOLDER, first.accountEnv('ann').BOT_DOT_EMBED_FOLDER, "no account has another's");
  door({ accounts: { ann: {}, bob: { suspended: '2026-11-11T12:00:00.000Z' } } });
  const done = step('bob');
  assert.match(done.system, /^systemctl disable --now botdot-account@bob$/m);
  assert.ok(fs.existsSync(bob), 'a suspended account keeps its folder, to start again with');
  assert.ok(fs.existsSync(path.join(first.dir, 'embed', 'ann')), "and ann's stays");
});

test("root's step takes a deleted account's embedding folder with the rest of it", (t) => {
  const { first, door, step } = withBob(t);
  const bob = path.join(first.dir, 'embed', 'bob');
  assert.ok(fs.existsSync(bob));
  door({ accounts: { ann: {} }, deleted: { bob: '2026-11-11T12:00:00.000Z' } });
  step('bob');
  assert.ok(!fs.existsSync(bob), 'bob\'s folder, and the socket the service made in it, are gone');
  assert.ok(fs.existsSync(path.join(first.dir, 'embed', 'ann')), "ann's stays");
});

test('an update gives an account made before the embedding server its folder and its socket', (t) => {
  const first = rerun(t);
  fs.rmSync(path.join(first.dir, 'embed'), { recursive: true });
  const env = path.join(first.dir, 'accounts', 'ann', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').split('\n').filter((l) => !/^(EMBED_SOCKET|BOT_DOT_EMBED_FOLDER)=/.test(l)).join('\n'));
  const done = installer(t, { again: first, dotenv: '', args: ['--update'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(done.accountEnv('ann').EMBED_SOCKET, '/run/embed/embed.sock');
  assert.ok(fs.statSync(path.join(done.dir, 'embed', 'ann')).isDirectory());
});

test("the desktop app's one-account install has no shared embedding server and no folder: its account runs its own", (t) => {
  const done = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.system, /botdot-embed/);
  assert.equal(done.env.COMPOSE_PROFILES, '');
  assert.equal(done.env.BOT_DOT_EMBED_USER, undefined);
  const env = done.accountEnv('owner');
  assert.equal(env.EMBED_SOCKET, '', 'no socket: it starts llama-server itself');
  assert.equal(env.BOT_DOT_EMBED_FOLDER, '');
  assert.ok(!fs.existsSync(path.join(done.dir, 'embed', 'owner')));
});

test("the service has no network, no way into any account but through its sockets, and is no part of an account's own Docker", () => {
  const door = read('compose.front-door.yaml');
  const embed = door.slice(door.indexOf('\n  embed:\n'), door.indexOf('\nvolumes:\n'));
  assert.match(embed, /command: \["node", "lib\/embed-share\.js"\]/);
  assert.match(embed, /profiles: \[embed\]/);
  assert.match(embed, /network_mode: none/);
  assert.match(embed, /user: \$\{BOT_DOT_EMBED_USER:-65534:65534\}/, 'never root, also when the variable is missing');
  assert.match(embed, /read_only: true/);
  assert.match(embed, /cap_drop: \[ALL\]/);
  assert.match(embed, /no-new-privileges:true/);
  assert.doesNotMatch(embed, /ports:|docker\.sock|privileged/);
  assert.deepEqual(embed.match(/^ {6}- .*$/gm).filter((l) => l.includes(':/')), ['      - ${BOT_DOT_EMBED_SOCKETS:-./embed}:/sockets'], 'only the accounts\' folders');
  // The account's botdot server: the folder at /run/embed, the socket named in its environment.
  const account = read('compose.yaml');
  assert.match(account, /EMBED_SOCKET: \$\{EMBED_SOCKET:-\}/);
  assert.match(account, /- \$\{BOT_DOT_EMBED_FOLDER:-\.\/embed\}:\/run\/embed/);
  assert.doesNotMatch(account.slice(account.indexOf('docker-helper:')), /EMBED|\/run\/embed/, "its helper, which holds the account's Docker, has no part in it");
});
