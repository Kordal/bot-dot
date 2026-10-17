#!/usr/bin/env node
// The stage `accounts-real` (tests/integration/accounts-real.sh starts it): one machine with two accounts, walled off
// (ADR 028, #467). On a test machine of tests/integration/test-install.js, the real install.sh installs botdot from a
// local registry with the admin's account, ann. The admin makes a sign-up link on the admin page, bob opens it, and
// the front door asks root's step (install.sh --requested; without systemd its loop) for bob's account. Then:
//
//   - the admin page is the admin's alone, and lists, makes and revokes links;
//   - bob's account is made as ann's was: its own Linux user, rootless Docker under gVisor, botdot server, helper;
//   - each account has its own setup: its own Claude sign-in (its own home) and time zone;
//   - ann's bot cannot list, signal or reach bob's containers, data folder or socket, nor can ann's Linux user, nor
//     ann's whole Docker;
//   - ann's session never reaches bob;
//   - the admin page lists both accounts (#470); the admin suspends bob (root's step stops bob's Docker, bob sees only
//     that his account is paused, his data stays) and resumes him as he was; a sign-in link makes bob a new passkey
//     for the same account; and the admin deletes bob, after which nothing of bob's is left on the machine: no data,
//     socket folder, Linux user, group, sub-IDs, process or file of his users;
//   - each account has the default share, and its disk is its own (#471); the admin gives bob one computer at a time,
//     and his second computer waits until the first stops; the admin page shows the machine's load and bob's use, and
//     marks his disk full when it is, which botdot in bob's account, under gVisor, takes for "No space left on the
//     server". CPU and RAM limits need systemd, which this machine hasn't: they are checked on a real machine.
//
// INSTALL_REAL_KEEP leaves the machine there to look at a failure.
const assert = require('node:assert/strict');
const { createStage, until, SERVER, DESKTOP, ADMIN, DIR, RUN_DIR } = require('./test-install');

const ANN = ADMIN, BOB = 'bob';
const home = (account) => `${DIR}/accounts/${account}`;
const stage = createStage('accounts-real', { keep: !!process.env.INSTALL_REAL_KEEP });
// The first user a bot of an account runs as, in its botdot server's container (lib/identity.js).
const BOT_UID = 61000;

// `run()` fails, as a refusal should, saying what `why` matches (any failure without one).
const DENIED = /permission denied|operation not permitted/i;
const UNSEEN = /no such file or directory|no such process|ENOENT/i;
function refused(what, run, why = null) {
  let out;
  try { out = run(); } catch (e) {
    const said = `${e.stderr || ''}${e.stdout || ''}`.trim() || e.message;
    if (why) assert.match(said, why, `${what}: refused for another reason`);
    return said;
  }
  assert.fail(`${what} should have failed, and said: ${out}`);
}

stage.run(async () => {
  const machine = await stage.machine();
  await machine.load(stage.server());
  await machine.load(stage.computer());
  machine.publish(stage.server(), `${SERVER}:latest`);
  machine.publish(stage.computer(), `${DESKTOP}:latest`);
  const server = machine.sign(`${SERVER}:latest`, { app: 'server' });
  machine.sign(`${DESKTOP}:latest`, { app: 'desktop' });
  const as = (jar) => (method, route, body, headers) => machine.api(method, route, body, { jar, headers });
  const ann = as('ann'), bob = as('bob');

  stage.step('install.sh, with the admin\'s account');
  const said = machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
  assert.match(said, /Make sign-up links for other people on the admin page: https:\/\/botdot\.test\/admin/);
  assert.match(said, /This machine has no systemd, so the accounts sign-up links make are made by a loop started now/);
  machine.signUp(said, ANN, { jar: 'ann' });
  assert.equal(ann('GET', '/api/version').status, 200);

  stage.step('the admin page: the admin makes a sign-up link');
  const page = ann('GET', '/admin');
  assert.equal(page.status, 200);
  assert.match(String(page.body), /Sign-up links/);
  const made = ann('POST', '/admin/links', {});
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(ann('GET', '/admin/links').body.links.find((l) => l.id === made.body.link.id).state, 'open');

  stage.step('bob opens it: the sign-up page says what the admin can reach, before the passkey');
  const signUpPage = bob('GET', new URL(made.body.url).pathname);
  assert.equal(signUpPage.status, 200);
  const text = String(signUpPage.body);
  assert.ok(text.indexOf('The admin of this machine can technically reach everything in your account.') > 0, text);
  assert.ok(text.indexOf('The admin of this machine can technically reach everything') < text.indexOf('Create my passkey'));
  machine.signUp(made.body.url, BOB, { jar: 'bob' });
  const first = bob('GET', '/');
  if (first.status !== 200) {
    assert.equal(first.status, 503, `until it is made, bob's page says so: ${first.status} ${first.body}`);
    assert.match(String(first.body), /Your account is being made/);
  }

  stage.step("root's step makes bob's account");
  await until("bob's botdot server", () => {
    const v = bob('GET', '/api/version');
    return v.status === 200 && v.body.frontDoor !== true;
  }, 10 * 60_000);
  const used = ann('GET', '/admin/links').body.links.find((l) => l.id === made.body.link.id);
  assert.equal(used.state, 'used');
  assert.equal(used.account, BOB);
  // Taken once root's step is done with it, a moment after bob's botdot server answers.
  await until('the request to be taken', () => machine.exec('ls', '-A', `${DIR}/front-door/requests`) === '', 60_000);

  stage.step('bob\'s account is made as the admin\'s was');
  assert.equal(machine.exec('stat', '-c', '%U %a', home(BOB)), `botdot-${BOB} 700`);
  assert.equal(machine.account(BOB, 'info', '--format', '{{.DefaultRuntime}}'), 'runsc');
  assert.match(machine.account(BOB, 'info', '--format', '{{.SecurityOptions}}'), /rootless/);
  const containers = (account) => Object.fromEntries(['bot-dot', 'docker-helper'].map((s) => [s, machine.account(account, 'compose', '--project-directory', home(account), 'ps', '-q', s)]));
  const annC = containers(ANN), bobC = containers(BOB);
  for (const [s, id] of Object.entries(bobC)) {
    assert.match(id, /^[0-9a-f]{12,64}$/, `bob's ${s} runs in bob's Docker`);
    const { HostConfig, Config } = JSON.parse(machine.account(BOB, 'inspect', id))[0];
    assert.equal(HostConfig.Runtime, 'runsc');
    assert.equal(Config.Image, server, 'the image the install checked and pinned');
  }
  assert.match(machine.exec('cat', `${home(BOB)}/.env`), /^BOT_DOT_ACCOUNT=bob$/m);
  assert.match(machine.exec('getfacl', '-cp', `${DIR}/sockets/${BOB}`), /^group:botdot-door:--x$/m);

  stage.step('the admin page is the admin\'s alone; a revoked link makes nothing');
  assert.equal(bob('GET', '/admin').status, 404);
  assert.equal(bob('GET', '/admin/links').status, 404);
  assert.equal(bob('POST', '/admin/links', {}).status, 404);
  const other = ann('POST', '/admin/links', {});
  assert.equal(ann('POST', `/admin/links/${other.body.link.id}/revoke`, {}).status, 200);
  assert.equal(as('carl')('GET', new URL(other.body.url).pathname).status, 410);
  assert.equal(ann('GET', '/admin/links').body.links.find((l) => l.id === other.body.link.id).state, 'ended');

  stage.step('each account has its own setup: Claude sign-in and time zone');
  assert.equal(ann('PUT', '/api/setup', { done: true, timezone: 'Europe/Brussels' }).status, 200);
  const bobSetup = bob('GET', '/api/setup').body;
  assert.equal(bobSetup.done ?? false, false, "bob's setup is still to do");
  assert.equal(bobSetup.timezone, 'UTC');
  assert.equal(bob('PUT', '/api/setup', { timezone: 'America/New_York' }).status, 200);
  assert.equal(ann('GET', '/api/setup').body.timezone, 'Europe/Brussels');
  assert.equal(bob('GET', '/api/setup').body.timezone, 'America/New_York');
  // Claude Code keeps its sign-in in the server's home, a volume in the account's own Docker.
  const volumes = (account) => machine.account(account, 'volume', 'ls', '--format', '{{.Name}}').split('\n');
  assert.ok(volumes(ANN).includes(`${ANN}_bot-dot-home`) && !volumes(ANN).includes(`${BOB}_bot-dot-home`));
  assert.ok(volumes(BOB).includes(`${BOB}_bot-dot-home`) && !volumes(BOB).includes(`${ANN}_bot-dot-home`));

  stage.step("bob starts with an empty list and a Chief of Staff of his own");
  const bobsList = bob('GET', '/api/bots');
  assert.equal(bobsList.status, 200);
  assert.deepEqual(Array.isArray(bobsList.body) ? bobsList.body : bobsList.body.bots, [], JSON.stringify(bobsList.body).slice(0, 300));
  assert.equal(bob('GET', '/api/chief').status, 200, "bob's Chief answers on bob's own botdot server");

  stage.step("ann's session never reaches bob");
  const bobsBot = bob('POST', '/api/bots', { name: 'BobsOwn', prompt: 'Only bob has me.' });
  assert.equal(bobsBot.status, 201, JSON.stringify(bobsBot.body));
  for (const headers of [{}, { 'X-Botdot-Account': BOB }, { Cookie: 'botdot_account=bob' }]) {
    const bots = ann('GET', '/api/bots', undefined, headers);
    assert.equal(bots.status, 200);
    assert.ok(!JSON.stringify(bots.body).includes('BobsOwn'), `${JSON.stringify(headers)}: ann sees no bot of bob's`);
    assert.equal(ann('GET', '/api/setup', undefined, headers).body.timezone, 'Europe/Brussels', 'ann\'s own server answers');
  }

  stage.step("ann's bot cannot list, signal or reach bob's containers, data folder or socket");
  // A bot of ann's account: a user of its own in ann's botdot server's container, under gVisor.
  const annBot = (script) => machine.account(ANN, 'exec', '-u', `${BOT_UID}:${BOT_UID}`, annC['bot-dot'], 'sh', '-c', script);
  assert.equal(annBot('id -u'), String(BOT_UID));
  // From inside ann's sandbox none of bob's is there to name: no path, no Docker, no process. bob's botdot server's
  // address is on bob's own network, in bob's own Docker's namespace, which no route of ann's leads to.
  refused("ann's bot lists bob's data folder", () => annBot(`ls ${home(BOB)}/data`), UNSEEN);
  refused("ann's bot opens bob's socket", () => annBot(`node -e "require('net').connect('${DIR}/sockets/${BOB}/botdot.sock').on('connect', () => process.exit(0)).on('error', (e) => { console.error(e.message); process.exit(1); })"`), UNSEEN);
  refused("ann's bot lists bob's containers", () => annBot(`docker -H unix://${RUN_DIR}/${BOB}/docker.sock ps -q`), UNSEEN);
  refused("ann's bot lists any Docker's containers", () => annBot('docker ps -q'), UNSEEN);
  // bob's processes: the host's PIDs of bob's Docker, which ann's sandbox has no way to name.
  const bobPids = machine.exec('sh', '-c', `for p in /proc/[0-9]*; do [ "$(stat -c %U "$p" 2>/dev/null)" = botdot-${BOB} ] && basename "$p"; done | head -n 5`).split('\n').filter(Boolean);
  assert.ok(bobPids.length, "bob's Docker runs as bob's user");
  for (const pid of bobPids) refused(`ann's bot signals bob's process ${pid}`, () => annBot(`kill -0 ${pid}`), UNSEEN);
  assert.ok(!annBot('cat /proc/*/cmdline 2>/dev/null | tr "\\0" " "').includes(`accounts/${BOB}`), "ann's sandbox shows nothing of bob's");

  stage.step("nor can ann's Linux user, the wall if a bot ever left its sandbox");
  const annUser = (script) => machine.exec('su', '-s', '/bin/sh', `botdot-${ANN}`, '-c', script);
  // Here everything of bob's is there, and is refused.
  refused("ann's user lists bob's data folder", () => annUser(`ls ${home(BOB)}`), DENIED);
  refused("ann's user reads bob's settings", () => annUser(`cat ${home(BOB)}/.env`), DENIED);
  refused("ann's user lists bob's containers", () => annUser(`DOCKER_HOST=unix://${RUN_DIR}/${BOB}/docker.sock docker ps -q`), DENIED);
  refused("ann's user opens bob's socket", () => annUser(`ls ${DIR}/sockets/${BOB}/`), DENIED);
  for (const pid of bobPids) refused(`ann's user signals bob's process ${pid}`, () => annUser(`kill -0 ${pid}`), DENIED);

  stage.step("nor can ann's whole Docker, which ann's bots reach only through ann's helper");
  const annIds = machine.account(ANN, 'ps', '-aq', '--no-trunc');
  for (const id of Object.values(bobC)) assert.ok(!annIds.includes(id), "ann's Docker doesn't list bob's containers");
  refused("ann's Docker signals bob's server", () => machine.account(ANN, 'kill', '-s', 'SIGWINCH', bobC['bot-dot']));
  refused("ann's Docker mounts bob's data folder", () => machine.account(ANN, 'run', '--rm', '-v', `${home(BOB)}/data:/x`, server, 'ls', '/x'), DENIED);
  refused("ann's Docker mounts bob's Docker", () => machine.account(ANN, 'run', '--rm', '-v', `${RUN_DIR}/${BOB}/docker.sock:/s`, server, 'docker', '-H', 'unix:///s', 'ps'), DENIED);
  refused("ann's Docker mounts bob's socket", () => machine.account(ANN, 'run', '--rm', '-v', `${DIR}/sockets/${BOB}:/x`, server, 'ls', '/x'), DENIED);

  stage.step('and the other way round: bob reaches nothing of ann\'s');
  refused("bob's user lists ann's data folder", () => machine.exec('su', '-s', '/bin/sh', `botdot-${BOB}`, '-c', `ls ${home(ANN)}`));
  refused("bob's user lists ann's containers", () => machine.exec('su', '-s', '/bin/sh', `botdot-${BOB}`, '-c', `DOCKER_HOST=unix://${RUN_DIR}/${ANN}/docker.sock docker ps -q`));
  const bobIds = machine.account(BOB, 'ps', '-aq', '--no-trunc');
  for (const id of Object.values(annC)) assert.ok(!bobIds.includes(id));
  assert.ok(!JSON.stringify(bob('GET', '/api/bots').body).includes('Acceptance'));

  // --- The admin's accounts (#470) ---
  const bobsBots = (as_ = bob) => JSON.stringify(as_('GET', '/api/bots').body);
  const bobRuns = () => { try { machine.account(BOB, 'info', '--format', '{{.ID}}'); return true; } catch { return false; } };
  const bobUid = Number(machine.exec('id', '-u', `botdot-${BOB}`));
  const bobSub = Number(machine.exec('sh', '-c', `awk -F: '$1 == "botdot-${BOB}" { print $2 }' /etc/subuid`));
  assert.ok(bobUid > 0 && bobSub > 0);
  // The processes of bob's user and of its containers' users (its sub-IDs), but those that ended and that nobody has
  // waited for yet (zombies: the test machine's first process doesn't wait for orphans).
  const bobsProcesses = () => machine.exec('sh', '-c', `cat /proc/[0-9]*/status 2>/dev/null | awk '/^Name:/ { n = $2 } /^State:/ { z = ($2 == "Z") } /^Pid:/ { p = $2 } /^Uid:/ { if (!z && ($2 == ${bobUid} || ($2 >= ${bobSub} && $2 < ${bobSub + 65536}))) print p, n, $2 }'`);

  stage.step('the admin page lists the accounts, and nothing from inside them');
  const listed = ann('GET', '/admin/accounts');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.accounts.map((a) => [a.name, a.state]), [[ANN, 'running'], [BOB, 'running']]);
  for (const a of listed.body.accounts) {
    assert.deepEqual(Object.keys(a).filter((k) => !['name', 'created', 'lastSeen', 'state', 'admin', 'share', 'ownShare', 'use'].includes(k)), []);
    assert.ok(a.lastSeen, `${a.name} was seen`);
  }
  assert.ok(!JSON.stringify(listed.body).includes('BobsOwn'));
  assert.equal(ann('POST', `/admin/accounts/${ANN}/suspend`, {}).status, 409, "the admin's own account isn't suspended");

  stage.step("the admin suspends bob: bob's botdot server and Docker stop, and bob sees only that it is paused");
  assert.equal(ann('POST', `/admin/accounts/${BOB}/suspend`, {}).status, 200);
  const paused = bob('GET', '/api/bots');
  assert.equal(paused.status, 503);
  assert.deepEqual(paused.body, { error: 'Your account is paused by the admin.', paused: true });
  assert.match(String(bob('GET', '/').body), /Your account is paused by the admin\./);
  // What root's step said, and what of bob's still runs, when a wait for it ends without it.
  const rootSaid = async (label, probe, ms) => {
    try { await until(label, probe, ms); } catch (e) {
      throw new Error(`${e.message}\nbob's processes:\n${bobsProcesses()}\nroot's step:\n${machine.exec('sh', '-c', `tail -n 40 ${DIR}/requests.log`)}`);
    }
  };
  await rootSaid("root's step to stop bob's account", () => !bobRuns() && bobsProcesses() === '', 3 * 60_000);
  assert.equal(ann('GET', '/admin/accounts').body.accounts.find((a) => a.name === BOB).state, 'suspended');
  assert.match(machine.exec('ls', `${home(BOB)}/data`), /bots/, "bob's data stays");
  assert.equal(machine.exec('id', '-un', `botdot-${BOB}`), `botdot-${BOB}`);
  assert.equal(ann('GET', '/api/setup').body.timezone, 'Europe/Brussels', "ann's account carries on");

  stage.step('the admin resumes bob: as it was');
  assert.equal(ann('POST', `/admin/accounts/${BOB}/resume`, {}).status, 200);
  await rootSaid("bob's botdot server again", () => bob('GET', '/api/bots').status === 200, 5 * 60_000);
  assert.ok(bobsBots().includes('BobsOwn'), "bob's bot is there");
  assert.equal(bob('GET', '/api/setup').body.timezone, 'America/New_York');
  await until('the request to be taken', () => machine.exec('ls', '-A', `${DIR}/front-door/requests`) === '', 60_000);

  stage.step('a sign-in link makes bob a new passkey for the same account');
  const signInLink = ann('POST', `/admin/accounts/${BOB}/sign-in-link`, {});
  assert.equal(signInLink.status, 201);
  machine.signUp(signInLink.body.url, BOB, { jar: 'bob-again' });
  const bobAgain = as('bob-again');
  assert.ok(bobsBots(bobAgain).includes('BobsOwn'), "the new passkey opens bob's own account");
  assert.equal(bob('GET', '/api/bots').status, 401, "the lost devices' sessions ended");
  assert.equal(as('carl')('GET', new URL(signInLink.body.url).pathname).status, 410, 'the link works once');

  // --- Shares of the machine (#471) ---
  const shareFile = `${home(BOB)}/share/share.json`;
  const diskOf = (account) => machine.exec('df', '-k', '--output=size,avail', home(account)).split('\n')[1].trim().split(/\s+/).map((k) => Number(k) * 1024);
  const GB = 1024 ** 3;

  stage.step('every account has the default share, and its disk is its own');
  const shares = ann('GET', '/admin/share');
  assert.equal(shares.status, 200);
  assert.deepEqual(shares.body.share, { cpu: 2, ram: 5, computers: 2, disk: 30 });
  assert.equal(bobAgain('GET', '/admin/share').status, 404, 'an account never sees a share');
  for (const account of [ANN, BOB]) {
    assert.equal(machine.exec('sh', '-c', `mountpoint -q ${home(account)} && echo mounted`), 'mounted', `${account}'s home is its own disk`);
    const [size] = diskOf(account);
    assert.ok(size > 28 * GB && size <= 30 * GB, `${account}'s disk is 30 GB: ${size}`);
  }
  assert.equal(machine.exec('cat', shareFile), '{"computers":2}');
  assert.equal(machine.exec('stat', '-c', '%U %a', shareFile), 'root 644');
  refused("bob's user changes his share", () => machine.exec('su', '-s', '/bin/sh', `botdot-${BOB}`, '-c', `echo '{"computers":9}' > ${shareFile}`), DENIED);

  stage.step('the admin gives bob one computer at a time, and a bigger disk: root\'s step applies it');
  const bobShare = { cpu: 1, ram: 4, computers: 1, disk: 31 };
  const changed = ann('POST', `/admin/accounts/${BOB}/share`, bobShare);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(changed.body.share, bobShare);
  await rootSaid("root's step to apply bob's share", () => machine.exec('cat', shareFile) === '{"computers":1}' && diskOf(BOB)[0] > 30 * GB, 3 * 60_000);
  assert.ok(diskOf(ANN)[0] <= 30 * GB, "ann's share stays");
  assert.deepEqual(ann('GET', '/admin/accounts').body.accounts.find((a) => a.name === BOB).share, bobShare);
  assert.ok(bobsBots(bobAgain).includes('BobsOwn'), "bob's account carries on");

  stage.step("bob's second computer waits until his first stops");
  const computerBot = (name) => {
    const made = bobAgain('POST', '/api/bots', { name, prompt: 'Look at a page.', computer: 'linux' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return made.body.id;
  };
  const one = computerBot('First'), two = computerBot('Second');
  const computer = (id, action) => bobAgain('POST', `/api/bots/${id}/computer`, { action });
  const computersOfBob = () => machine.account(BOB, 'ps', '-q', '--filter', 'label=botdot.bot', '--filter', 'status=running').split('\n').filter(Boolean).length;
  const firstStart = computer(one, 'start');
  assert.equal(firstStart.status, 200, `the first computer starts: ${JSON.stringify(firstStart.body)}`);
  // The second start, as the web page asks it, while it waits: in the background, its answer in a file.
  machine.exec('sh', '-c', `nohup curl -sS -k --resolve botdot.test:443:127.0.0.1 -b /root/bob-again -X POST -H 'X-Bot-Dot: 1' -H 'Content-Type: application/json' --data-binary '{"action":"start"}' -o /root/second.json -w '%{http_code}' https://botdot.test/api/bots/${two}/computer > /root/second.status 2>&1 &`);
  await new Promise((r) => setTimeout(r, 20_000));
  assert.equal(computersOfBob(), 1, 'one computer runs, as bob\'s share allows');
  assert.equal(bobAgain('GET', `/api/bots/${two}/computer`).body.state === 'running', false, 'the second waits');
  assert.equal(machine.exec('cat', '/root/second.status'), '', 'its start has no answer yet');
  assert.equal(computer(one, 'stop').status, 200);
  await until('the second computer to start once the first stopped', () => bobAgain('GET', `/api/bots/${two}/computer`).body.state === 'running', 5 * 60_000);
  await until('its start to answer', () => machine.exec('cat', '/root/second.status') === '200', 60_000);
  assert.equal(computersOfBob(), 1);
  assert.equal(computer(two, 'stop').status, 200);

  stage.step("the admin page shows the machine's load and bob's use, and marks bob's full disk");
  await until('root\'s step to measure the load', () => {
    const { machine: load } = ann('GET', '/admin/share').body;
    const use = ann('GET', '/admin/accounts').body.accounts.find((a) => a.name === BOB).use;
    return load?.cpus > 0 && load.ramTotal > 0 && load.diskTotal > 0 && use?.diskSize > 30 * GB && use.full !== true;
  }, 3 * 60_000);
  // bob's disk fills up, to less than the 64 MB botdot counts as full.
  const [, avail] = diskOf(BOB);
  machine.exec('fallocate', '-l', String(avail - 16 * 1024 * 1024), `${home(BOB)}/data/fill`);
  const bobC2 = containers(BOB)['bot-dot'];
  // In bob's botdot server, under gVisor: what a run that fails now would say.
  const inBob = (script) => machine.account(BOB, 'exec', bobC2, 'node', '-e', script);
  const failed = refused('a write in bob\'s full disk', () => machine.account(BOB, 'exec', bobC2, 'sh', '-c', 'head -c 67108864 /dev/zero > /data/more'), /no space left on device/i);
  machine.account(BOB, 'exec', bobC2, 'rm', '-f', '/data/more');
  assert.equal(inBob(`const d = require('/opt/bot-dot/lib/disk-space').create('/data', { spare: false }); const { friendlyProblem } = require('/opt/bot-dot/lib/problems'); console.log(JSON.stringify([d.full(''), friendlyProblem({ status: 'error', error: ${JSON.stringify(failed)} })]))`),
    JSON.stringify([true, 'No space left on the server.']));
  await until('the admin page to mark bob\'s disk full', () => ann('GET', '/admin/accounts').body.accounts.find((a) => a.name === BOB).use?.full === true, 3 * 60_000);
  assert.equal(ann('GET', '/admin/accounts').body.accounts.find((a) => a.name === ANN).use?.full, undefined, "ann's disk isn't bob's");
  assert.equal(bobAgain('GET', '/api/version').status, 200, "bob's botdot server still answers");
  machine.exec('rm', '-f', `${home(BOB)}/data/fill`);

  stage.step("the admin deletes bob after typing bob's name: nothing of it is left on the machine");
  assert.equal(ann('POST', `/admin/accounts/${BOB}/delete`, { name: 'bo' }).status, 400);
  assert.ok(bobsBots(bobAgain).includes('BobsOwn'), 'a wrong name deletes nothing');
  assert.equal(ann('POST', `/admin/accounts/${BOB}/delete`, { name: BOB }).status, 200);
  assert.equal(bobAgain('GET', '/api/bots').status, 401, "bob's sessions end at once");
  const gone = (p) => machine.exec('sh', '-c', `[ -e '${p}' ] && echo there || echo gone`) === 'gone';
  await rootSaid("root's step to erase bob's account", () => gone(home(BOB)) && machine.exec('sh', '-c', `id -u botdot-${BOB} >/dev/null 2>&1 && echo there || echo gone`) === 'gone', 3 * 60_000);
  await until('the request to be taken', () => machine.exec('ls', '-A', `${DIR}/front-door/requests`) === '', 60_000);
  for (const p of [home(BOB), `${DIR}/sockets/${BOB}`, `${RUN_DIR}/${BOB}`]) assert.ok(gone(p), `${p} is gone`);
  assert.equal(machine.exec('sh', '-c', `getent group botdot-${BOB} || true`), '', 'its group is gone');
  assert.equal(machine.exec('sh', '-c', `grep -c '^botdot-${BOB}:' /etc/subuid /etc/subgid || true`), '/etc/subuid:0\n/etc/subgid:0', 'its sub-IDs are gone');
  assert.equal(bobsProcesses(), '', 'none of its processes runs');
  // No file anywhere on the machine belongs to bob's user or to its containers' users.
  const left = machine.exec('sh', '-c', `find / /var /var/lib/botdot /run /tmp /home -xdev\\( -path /proc -o -path /sys \\) -prune -o -printf '%U %G %p\\n' 2>/dev/null | awk '{ for (i = 1; i <= 2; i++) if ($i == ${bobUid} || ($i >= ${bobSub} && $i < ${bobSub + 65536})) { print; next } }' | head -n 5`);
  assert.equal(left, '', `files of bob's are left:\n${left}`);
  assert.equal(machine.exec('sh', '-c', `ls /etc/systemd/system/*.wants 2>/dev/null | grep -c 'botdot-account@${BOB}' || true`), '0', 'nothing starts it with the machine');
  assert.deepEqual(ann('GET', '/admin/accounts').body.accounts.map((a) => a.name), [ANN]);
  assert.equal(ann('GET', '/api/setup').body.timezone, 'Europe/Brussels', "ann's account carries on");
  assert.equal(machine.account(ANN, 'info', '--format', '{{.DefaultRuntime}}'), 'runsc');

  stage.remove(machine);
  console.log(JSON.stringify({ result: 'PASS', accounts: [ANN, BOB] }));
});
