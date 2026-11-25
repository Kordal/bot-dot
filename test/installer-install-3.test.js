// install.sh on a stand-in machine (test/installer-helpers.js): a first install, botdot's signed images, and what
// the installer tells a stranger. The other installer tests are in installer-*.test.js, so that they run side by side.
// Part 3 of 3 of the install tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checked, ROOT, file, script, code, PIN, SIGNED, ANSWERED, installer, rerun, KEPT_LAYER, roomAnswers, SELF, withBob } = require('./installer-helpers');

// --- The images: botdot's signed images, checked before any download (lib/signed-image.js) --------

const DOWNLOADS = /^pull ghcr\.io\//;

const touchesRegistry = (docker) => docker.filter((c) => /^(pull|login|push)\b/.test(c.call));

// The sentence is made by the image's own Node, as install.sh's json() does it.
function sentence(result) {
  const expression = script.match(/CLEANED="\$\(printf '%s' "\$CLEANED" \| json '(.+)' \|\| true\)"/)[1];
  const program = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(String((${expression})??''))}catch{}})`;
  return execFileSync(process.execPath, ['-e', program], { input: result, encoding: 'utf8' });
}

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

// --- Jev and boat.dev ------------------------------------------------------------------------------

// The image's key check (lib/group-router.js, lib/boat.js and lib/connectors.js checkKey), stood in for: a key starting "good" is taken,
// "down" can't be checked, any other is refused. It writes down which check it was asked and the key it read.
const keyChecks = [
  'case "$*" in *checkKey*) k="$(cat)"; for a; do l="$a"; done; echo "checkKey $l $k" >> "$STAND_IN_LOG";',
  '  case "$k" in good*) printf ok ;; down*) printf unreachable ;; *) printf refused ;; esac; exit 0 ;; esac',
];

const keysOf = (done) => { const f = path.join(done.dir, 'front-door', 'data', 'install-keys.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

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
  assert.match(stderr, /The installer makes a Linux user for each account, so it needs full control of this machine\. Run it with: sudo sh install\.sh/);
  assert.deepEqual(docker, []);
});

test('a rerun installs the newest signed images, into the machine\'s Docker and the account\'s, pinned by digest', (t) => {
  const done = rerun(t, `BOT_DOT_IMAGE=ghcr.io/ladrok/bot-dot${PIN}\nBOT_DOT_COMPUTER_IMAGE=ghcr.io/ladrok/bot-dot-desktop${PIN}\n`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  assert.equal(done.env.BOT_DOT_COMPUTER_IMAGE, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`);
  assert.ok(done.calls.includes(`pull ghcr.io/ladrok/bot-dot${SIGNED}`), 'the front door\'s');
  const own = done.accountCalls('ann');
  assert.ok(own.includes(`pull ghcr.io/ladrok/bot-dot${SIGNED}`) && own.includes(`pull ghcr.io/ladrok/bot-dot-desktop${SIGNED}`), own.join('\n'));
  assert.ok(!done.calls.includes(`pull ghcr.io/ladrok/bot-dot-desktop${SIGNED}`), 'the computer only where it runs');
  assert.ok(!done.docker.some((c) => /^pull .*:latest$/.test(c.call)), 'never the tag, which may have moved since the check');
  const at = (call) => own.indexOf(call);
  assert.ok(at(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`) > at(`pull ghcr.io/ladrok/bot-dot-desktop${SIGNED}`));
  assert.ok(at(`compose --project-directory ${done.dir}/accounts/ann exec -T --user 60000:60000 bot-dot node /opt/bot-dot/lib/update-install.js --clean`) > at(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`), 'the cleanup comes after the new containers');
  // The stand-in gives the cleanup no answer: one warning, and the installer ends as always.
  assert.match(done.said, /Couldn't remove every old image now; the next update tries again\./);
});

test('an update makes room first: the images no container uses go before the new ones are downloaded (#190)', (t) => {
  const was = `ghcr.io/ladrok/bot-dot${PIN}`, desk = `ghcr.io/ladrok/bot-dot-desktop${PIN}`;
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
  assert.ok(inAccount < at(own, new RegExp(`^pull ghcr\\.io/ladrok/bot-dot@`)), 'before the account\'s download');
  const args = calls[inAccount].call.split(' ');
  assert.equal(args[12], `ghcr.io/ladrok/bot-dot${SIGNED}`, 'run from the new version, already in the machine\'s Docker');
  assert.deepEqual(args.slice(14), [`ghcr.io/ladrok/bot-dot${SIGNED}`, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`, `ghcr.io/ladrok/bot-dot${SIGNED}`, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`]);
  // The machine's Docker: by the rule of the version it runs now, before the front door's download.
  const inMachine = at('machine', cleanup('/var/run/docker\\.sock'));
  assert.ok(inMachine >= 0 && inMachine < at('machine', /^pull ghcr\.io\/ladrok\/bot-dot@/), 'before the machine\'s download');
  const machine = calls[inMachine].call.split(' ');
  assert.equal(machine[12], first.env.BOT_DOT_IMAGE, 'run from what the machine runs now');
  assert.deepEqual(machine.slice(14), [first.env.BOT_DOT_IMAGE, first.env.BOT_DOT_COMPUTER_IMAGE]);
  // The stand-in's cleanup answers nothing: a warning, and the update goes on.
  assert.match(done.said, /Couldn't remove the old images first; the download goes on\./);
});

test('a first install has nothing to make room for in the machine\'s Docker', (t) => {
  const fresh = installer(t, { dotenv: '', input: '1\nbotdot.example.com\nann\n' });
  assert.equal(fresh.status, 0, fresh.stderr);
  const download = fresh.calls.findIndex((c) => c.startsWith('pull ghcr.io/ladrok/bot-dot@'));
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
  const server = `ghcr.io/ladrok/bot-dot${SIGNED}`;
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
  assert.ok(own.includes(`pull ghcr.io/ladrok/bot-dot${SIGNED}`), 'the server is downloaded');
  assert.ok(!own.some((c) => c.startsWith('pull ghcr.io/ladrok/bot-dot-desktop')), own.join('\n'));
  assert.equal(done.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`, 'and pinned for its next update or reset');
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
  assert.ok(since.some((c) => /lib\/image-layers\.js ghcr\.io\/ladrok\/bot-dot@/.test(c.call)), 'the registry is asked for the signed image\'s layers');
  assert.ok(since.some((c) => c.call.includes(`-v ${first.run}/ann/docker.sock:/var/run/docker.sock`) && c.call.includes('image-cleanup.js')), 'after the account\'s unused images went');
  assert.deepEqual(since.filter((c) => /^pull /.test(c.call)).map((c) => c.call), [], 'nothing is downloaded');
  assert.deepEqual(since.filter((c) => /^compose .* up/.test(c.call)).map((c) => c.call), [], 'nothing is restarted');
});

test('an update with room in every account goes on, and so does one whose registry gives no sizes (#192)', (t) => {
  const first = rerun(t);
  // Downloaded into the machine's Docker and the account's.
  const downloads = (done) => [...new Set(done.docker.slice(first.docker.length).filter((c) => /^pull ghcr\.io\/ladrok\/bot-dot@/.test(c.call)).map((c) => c.host))].length;
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
  const { said, accountEnv } = rerun(t, '', {}, { failPull: `ghcr.io/ladrok/bot-dot-desktop${SIGNED}` });
  assert.match(said, /Couldn't download the bots' computer now; botdot tries again when a bot needs it\./);
  assert.equal(accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`);
});

test('the image it is given is installed as its repository\'s signed release, as the updater does', (t) => {
  const mine = `ghcr.io/ladrok/bot-dot@sha256:${'b'.repeat(64)}`;
  const { env, checks } = rerun(t, `BOT_DOT_IMAGE=ghcr.io/ladrok/bot-dot${PIN}\n`, { BOT_DOT_IMAGE: mine });
  assert.equal(checked(checks[0])[0], mine);
  assert.equal(env.BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
});

test('compose starts what .env names, not the names the installer was given', () => {
  const unset = code.indexOf('unset BOT_DOT_IMAGE BOT_DOT_COMPUTER_IMAGE');
  assert.ok(unset > code.lastIndexOf('set_env "$ENV" BOT_DOT_COMPUTER_IMAGE') && unset < code.indexOf('up -d --remove-orphans'), 'after .env has them, before compose reads them');
});

test('both images\' signatures are checked before anything of botdot\'s is downloaded', (t) => {
  const { docker, checks } = rerun(t);
  assert.deepEqual(checks.map((args) => checked(args).slice(0, 2)), [['ghcr.io/ladrok/bot-dot:latest', 'server'], ['ghcr.io/ladrok/bot-dot-desktop:latest', 'desktop']]);
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
  const { said, stderr, docker, env } = rerun(t, '', {}, { signed: { 'ghcr.io/ladrok/bot-dot:latest': 'it has no botdot signature' }, refuse: true });
  assert.match(stderr, /Refused ghcr\.io\/ladrok\/bot-dot:latest: it has no botdot signature\. Nothing was downloaded or started\./);
  assert.ok(!docker.some((c) => DOWNLOADS.test(c.call) || /^compose .*(up|exec)/.test(c.call)), docker.map((c) => c.call).join('\n'));
  assert.doesNotMatch(said, /up to date|running/);
  assert.equal(env.BOT_DOT_IMAGE, undefined);
});

test('a computer image signed with another key stops the installer before the server is downloaded too', (t) => {
  const { stderr, docker } = rerun(t, '', {}, { signed: { 'ghcr.io/ladrok/bot-dot-desktop:latest': "it is signed, but not with botdot's release key" }, refuse: true });
  assert.match(stderr, /Refused ghcr\.io\/ladrok\/bot-dot-desktop:latest: it is signed, but not with botdot's release key\. Nothing was downloaded or started\./);
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
  const { env, calls } = rerun(t, 'BOT_DOT_IMAGE=bot-dot/server:latest\nBOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest\n', { BOT_DOT_IMAGE: 'ghcr.io/ladrok/bot-dot:latest' });
  assert.ok(calls.includes(`pull ghcr.io/ladrok/bot-dot${SIGNED}`));
  assert.equal(env.BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  assert.equal(env.BOT_DOT_COMPUTER_IMAGE, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`);
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
