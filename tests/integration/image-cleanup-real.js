#!/usr/bin/env node
// The stage `image-cleanup-real` (tests/integration/image-cleanup-real.sh starts it): updates of a machine of several
// accounts (ADR 028) move the front door and every account to one release together, and stop filling the disk, in
// real Dockers.
//
// One test machine of tests/integration/test-install.js (the machine's Docker, and each account's rootless Docker under
// gVisor) with a local registry, two accounts (the admin ann, and bob, from a sign-up link the admin made), a stopped
// bot's computer with a marker file in ann's Docker, and an unrelated workload in the machine's. botdot is updated
// three times, each to a release of both images with its own digest and release label: by running install.sh again,
// and twice by the admin page's Update (#473), which root's step (install.sh --requested; without systemd its loop)
// carries out. After each, the front door and both accounts run that release, and no Docker keeps an image of botdot's
// it no longer uses: the machine's (lib/image-cleanup.js, run by the installer) and each account's (botdot's own
// cleanup, its `update.cleaned` line in the account's audit log). A last release signed with another key is refused:
// the admin page says the update failed, and nothing changes.
//
// IMAGE_CLEANUP_REPORT names a file that gets each Docker's `docker image ls` before and after each update.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createStage, until, REGISTRY_IMAGE, SERVER, DESKTOP, TEST_KEY, ADMIN, DIR } = require('./test-install');

const LABEL = 'dev.botdot.release.version';
const MARKER = 'the bot left this here';
const OWN_LAYER = 2_000_000; // bytes of each server release that no other image shares
const ANN = ADMIN, BOB = 'bob', ACCOUNTS = [ANN, BOB];

const stage = createStage('image-cleanup-real', { keep: !!process.env.IMAGE_CLEANUP_KEEP });
const { step, temp } = stage;
let machine, base;
const inner = (...args) => machine.inner(...args);
const innerInput = (input, ...args) => machine.innerInput(input, ...args);

// --- What each Docker holds: the machine's (null) or an account's ----------------------------------

const dockerOf = (account) => (account ? (...args) => machine.account(account, ...args) : inner);
const where = (account) => (account ? `${account}'s Docker` : "the machine's Docker");
function images(account) {
  const d = dockerOf(account);
  const ids = [...new Set(d('image', 'ls', '-a', '-q', '--no-trunc').split('\n').filter(Boolean))];
  if (!ids.length) return [];
  return JSON.parse(d('image', 'inspect', ...ids)).map((i) => ({ id: i.Id, refs: [...(i.RepoTags || []), ...(i.RepoDigests || [])], release: i.Config?.Labels?.[LABEL] ?? null }));
}
const of = (account, repository) => images(account).filter((i) => i.refs.some((r) => r.startsWith(`${repository}:`) || r.startsWith(`${repository}@`)));
// botdot's images that have no name left: the containerd store's superseded ones.
const nameless = (account) => images(account).filter((i) => !i.refs.length && i.release !== null);
const idOf = (account, reference) => dockerOf(account)('image', 'inspect', '--format', '{{.Id}}', reference);
const runningRelease = (account, service) => {
  const d = dockerOf(account);
  const id = d('ps', '-q', '--no-trunc', '--filter', `label=com.docker.compose.service=${service}`).split('\n')[0];
  assert.ok(id, `${where(account)} runs ${service}`);
  return d('inspect', '--format', `{{index .Config.Labels "${LABEL}"}}`, id);
};
const audit = (account) => machine.exec('sh', '-c', `cat ${DIR}/accounts/${account}/data/audit.log 2>/dev/null || true`).split('\n').filter(Boolean).map((line) => JSON.parse(line));
const cleaned = (account) => audit(account).filter((event) => event.action === 'update.cleaned');
const report = [];
function inventory(label) {
  for (const account of [null, ...ACCOUNTS]) report.push(`### ${label}: ${where(account)}\n${dockerOf(account)('image', 'ls', '--no-trunc', '--digests')}\n`);
}

// --- Releases --------------------------------------------------------------------------------------

// Release n of both images: one own layer and its own release label on the base, pushed to the nested registry as
// v<n>. Nothing of it stays in the machine's Docker: an update has to pull it.
const digests = {};
function release(n) {
  const build = (tag, lines) => innerInput(`FROM ${base}\nLABEL ${LABEL}=${n}\n${lines}`, 'docker', 'build', '-q', '-t', tag, '-');
  build(`${SERVER}:v${n}`, `RUN head -c ${OWN_LAYER} /dev/urandom > /server-${n}\n`);
  build(`${DESKTOP}:v${n}`, `RUN echo ${n} > /desktop-${n}\nHEALTHCHECK NONE\nCMD ["sleep","infinity"]\n`);
  digests[n] = {};
  for (const [kind, repository] of [['server', SERVER], ['desktop', DESKTOP]]) {
    inner('push', '-q', `${repository}:v${n}`);
    digests[n][kind] = inner('image', 'inspect', '--format', '{{range .RepoDigests}}{{println .}}{{end}}', `${repository}:v${n}`).split('\n').find((r) => r.startsWith(`${repository}@`));
    assert.match(digests[n][kind], /@sha256:[a-f0-9]{64}$/);
    inner('image', 'rm', `${repository}:v${n}`);
  }
}
// A release is published: the registry's `latest` names it, and its signature (by `key`, the test key the machine
// trusts unless another is given) says it is botdot's. The machine's Docker keeps nothing of it.
function publishLatest(n, { key } = {}) {
  for (const [kind, repository] of [['server', SERVER], ['desktop', DESKTOP]]) {
    inner('pull', '-q', digests[n][kind]);
    inner('tag', digests[n][kind], `${repository}:latest`);
    inner('push', '-q', `${repository}:latest`);
    machine.sign(digests[n][kind], { app: kind, version: n, ...(key ? { key } : {}) });
    inner('image', 'rm', `${repository}:latest`);
    try { inner('image', 'rm', digests[n][kind]); } catch (error) { if (!/No such image/i.test(String(error.stderr || error.message))) throw error; }
  }
}
// Another key of the same kind as the test key, which the machine does not trust.
function otherKey() {
  const k = crypto.createPrivateKey(TEST_KEY);
  const d = k.asymmetricKeyDetails || {};
  return crypto.generateKeyPairSync(k.asymmetricKeyType, d.namedCurve ? { namedCurve: d.namedCurve } : d.modulusLength ? { modulusLength: d.modulusLength } : {}).privateKey;
}

// --- The ways to update ----------------------------------------------------------------------------

const install = () => machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest`, BOT_DOT_COMPUTER_IMAGE: `${DESKTOP}:latest` });
const updateStatus = () => { try { return JSON.parse(machine.exec('cat', `${DIR}/front-door/status/update.json`)); } catch { return null; } };
// The admin page's Update: the admin's session asks the front door, which leaves the request for root's step. Done
// when root's step says how it went (the front door restarts on the way, so this reads root's own status file).
async function adminUpdate(label) {
  const was = updateStatus()?.at || '';
  const asked = machine.api('POST', '/admin/update', {});
  assert.equal(asked.status, 202, `${label}: the admin page asks: ${JSON.stringify(asked.body)}`);
  assert.equal(asked.body.asked, true);
  const done = await until(`${label} to end`, () => { const u = updateStatus(); return u && u.at !== was && u.state !== 'updating' && u; }, 15 * 60_000);
  // The admin page shows what root's step said, once the front door is back.
  const shown = await until('the admin page', () => { const r = machine.api('GET', '/admin/update'); return r.status === 200 && r.body; });
  assert.equal(shown.update.state, done.state);
  return { done, shown };
}

// --- What must hold after every update that ended healthy -----------------------------------------

let computerImage = null;
const seen = { [ANN]: 0, [BOB]: 0 };
async function settled(label, n) {
  inventory(`after ${label}`);
  // The front door and every account run release n.
  assert.equal(runningRelease(null, 'front-door'), String(n), `${label}: the front door runs release ${n}`);
  for (const account of ACCOUNTS) assert.equal(runningRelease(account, 'bot-dot'), String(n), `${label}: ${account} runs release ${n}`);
  // The machine's Docker holds the server image the front door runs, and nothing else of botdot's.
  assert.deepEqual(of(null, SERVER).map((i) => i.release), [String(n)], `${label}: one server image in the machine's Docker`);
  assert.deepEqual(of(null, DESKTOP), [], `${label}: no computer image in the machine's Docker`);
  assert.deepEqual(nameless(null), [], `${label}: no nameless image of botdot's in the machine's Docker`);
  for (const account of ACCOUNTS) {
    await until(`${account}'s cleanup after ${label}`, () => cleaned(account).length > seen[account]);
    seen[account] = cleaned(account).length;
    const last = cleaned(account).at(-1);
    step(`${label}: ${account}'s update.cleaned ${JSON.stringify({ removed: last.removed, skipped: last.skipped, failed: last.failed, bytes: last.bytes })}`);
    assert.equal(last.failed, 0, `${label}: no image of ${account}'s failed`);
    assert.deepEqual(of(account, SERVER).map((i) => i.release), [String(n)], `${label}: one server image in ${account}'s Docker`);
    const computers = account === ANN ? [computerImage] : [];
    assert.deepEqual(nameless(account).map((i) => i.id).filter((id) => !computers.includes(id)), [], `${label}: no nameless image of botdot's in ${account}'s Docker`);
    // The configured computer image, and in ann's the one her stopped computer was made from.
    assert.deepEqual([...new Set([...of(account, DESKTOP), ...nameless(account)].map((i) => i.release))].sort(), [...new Set([...(account === ANN ? ['1'] : []), String(n)])].sort(), `${label}: ${account}'s computer images`);
  }
  assert.equal(idOf(ANN, computerImage), computerImage, `${label}: ann's computer's image is still there`);
  assert.equal(machine.account(ANN, 'inspect', '--format', '{{.State.Status}}', 'botdot-acceptance'), 'exited', `${label}: ann's stopped computer is still there`);
}

// The accounts' own data is kept: a bot each, made before the first update.
const as = (jar) => (method, route, body) => machine.api(method, route, body, { jar });
const bots = {};
function kept(label) {
  for (const account of ACCOUNTS) {
    const list = as(account === ANN ? 'cookies' : account)('GET', '/api/bots');
    assert.equal(list.status, 200, `${label}: ${account}'s botdot answers`);
    assert.ok(list.body.some((b) => b.id === bots[account]), `${label}: ${account}'s bot is still there`);
  }
}

async function main() {
  base = stage.server();
  machine = await stage.machine();
  await machine.load(base);

  // The unrelated workload in the machine's Docker: the running local registry, a stopped container and their images.
  inner('create', '--name', 'unrelated-stopped', base, 'true');
  const unrelated = { registry: idOf(null, REGISTRY_IMAGE), base: idOf(null, base) };

  step('publishing five releases to the nested registry');
  for (const n of [1, 2, 3, 4, 5]) release(n);

  // --- The first install, and two accounts ---------------------------------------------------------
  publishLatest(1);
  step('install.sh, first run');
  let said = install();
  assert.match(said, /The account ann is running/);
  machine.signUp(said);
  step('the admin makes a sign-up link, and bob signs up');
  const link = machine.api('POST', '/admin/links', {});
  assert.equal(link.status, 201, JSON.stringify(link.body));
  machine.signUp(link.body.url, BOB, { jar: BOB });
  await until("bob's botdot server", () => as(BOB)('GET', '/api/version').status === 200, 10 * 60_000);
  for (const account of ACCOUNTS) {
    const made = as(account === ANN ? 'cookies' : account)('POST', '/api/bots', { name: `${account}'s keeper`, emoji: '🏠', prompt: 'Keep the house.' });
    assert.equal(made.status, 201, `${account}'s bot is made: ${JSON.stringify(made.body)}`);
    bots[account] = made.body.id;
  }
  for (const account of ACCOUNTS) seen[account] = cleaned(account).length;

  // A bot's computer in ann's Docker, as lib/computers.js makes it from the configured image, stopped, with a file.
  const pinned = machine.exec('sed', '-n', 's/^BOT_DOT_COMPUTER_IMAGE=//p', `${DIR}/accounts/${ANN}/.env`);
  assert.equal(pinned, digests[1].desktop, 'the installer pinned the signed computer image for the account');
  machine.account(ANN, 'create', '--name', 'botdot-acceptance', '--label', 'botdot.bot=acceptance', '--label', 'cua.sandbox=true', '--label', 'botdot.network-version=1', digests[1].desktop);
  innerInput(MARKER, 'sh', '-c', 'cat > /root/marker');
  machine.account(ANN, 'cp', '/root/marker', 'botdot-acceptance:/home/marker');
  machine.account(ANN, 'start', 'botdot-acceptance');
  machine.account(ANN, 'stop', '-t', '1', 'botdot-acceptance');
  computerImage = machine.account(ANN, 'inspect', '--format', '{{.Image}}', 'botdot-acceptance');
  inventory('after the first install');

  // --- Update 1: the installer again ---------------------------------------------------------------
  publishLatest(2);
  step('update 1: install.sh again');
  said = install();
  assert.match(said, /Removed 1 old image of the front door/, `the installer says what went from the machine's Docker:\n${said}`);
  await settled('update 1 (install.sh)', 2);
  kept('update 1');

  // --- Updates 2 and 3: the admin page -------------------------------------------------------------
  for (const n of [3, 4]) {
    publishLatest(n);
    step(`update ${n - 1}: the admin page's Update`);
    const { done, shown } = await adminUpdate(`update ${n - 1}`);
    assert.equal(done.state, 'updated', `root's step updated every account: ${JSON.stringify(done)}\n${machine.exec('sh', '-c', `tail -n 40 ${DIR}/update.log`)}`);
    assert.notEqual(done.from, done.to, 'to another version');
    assert.equal(shown.version, done.to, 'the admin page shows the version now installed');
    await settled(`update ${n - 1} (admin page)`, n);
    kept(`update ${n - 1}`);
  }

  // --- A release signed with another key: refused, and nothing changes ------------------------------
  const before = Object.fromEntries([null, ...ACCOUNTS].map((a) => [a || 'machine', images(a).map((i) => i.id).sort()]));
  publishLatest(5, { key: otherKey() });
  step('an update to a release botdot did not sign');
  const { done, shown } = await adminUpdate('the refused update');
  assert.equal(done.state, 'failed');
  assert.match(done.error, /Refused/, JSON.stringify(done));
  assert.equal(shown.update.error, done.error, 'the admin page says why');
  for (const a of [null, ...ACCOUNTS]) assert.deepEqual(images(a).map((i) => i.id).sort(), before[a || 'machine'], `nothing changed in ${where(a)}`);
  assert.equal(runningRelease(null, 'front-door'), '4');
  for (const account of ACCOUNTS) assert.equal(runningRelease(account, 'bot-dot'), '4');
  kept('the refused update');

  // The computer starts and still has its file; the unrelated workload is as it was.
  machine.account(ANN, 'start', 'botdot-acceptance');
  assert.equal(machine.account(ANN, 'exec', 'botdot-acceptance', 'cat', '/home/marker'), MARKER);
  machine.account(ANN, 'stop', '-t', '1', 'botdot-acceptance');
  assert.equal(idOf(null, REGISTRY_IMAGE), unrelated.registry);
  assert.equal(idOf(null, base), unrelated.base);
  assert.equal(inner('inspect', '--format', '{{.State.Status}}', 'registry'), 'running');
  assert.equal(inner('inspect', '--format', '{{.State.Status}} {{.Image}}', 'unrelated-stopped'), `created ${unrelated.base}`);

  fs.writeFileSync(path.join(temp, 'inventories.txt'), report.join('\n'));
  if (process.env.IMAGE_CLEANUP_REPORT) fs.copyFileSync(path.join(temp, 'inventories.txt'), process.env.IMAGE_CLEANUP_REPORT);
  console.log(JSON.stringify({ result: 'PASS', updates: 3, accounts: ACCOUNTS, cleaned: Object.fromEntries(ACCOUNTS.map((a) => [a, cleaned(a).map(({ removed, skipped, failed, bytes }) => ({ removed, skipped, failed, bytes }))])) }));
}

stage.run(main);
