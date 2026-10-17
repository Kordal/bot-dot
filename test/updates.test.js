// Updating botdot from Settings when it runs in Docker: the helper that recreates the container brings
// the compose file that fits the install (the Mac one on a Mac, the Linux one elsewhere).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { canonical } = require('../lib/release-manifest');
const key = fs.readFileSync(path.join(__dirname, 'fixtures/release-signing/public.der.b64'), 'utf8').trim();
const sign = (m) => ({ ...m, signature: crypto.sign('sha256', canonical(m), fs.readFileSync(path.join(__dirname, 'fixtures/release-signing/private.pem'))).toString('base64') });
const release = () => sign({ app: 'server', version: 42, revision: 'a'.repeat(40), sha256: 'b'.repeat(64), file: 'ghcr.io/kordal/bot-dot@sha256:' + 'b'.repeat(64) });
const { fakeDocker, waitFor } = require('./helpers');

let docker;
before(() => {
  docker = fakeDocker();
  process.env.PATH = `${docker.bin}${path.delimiter}${process.env.PATH}`;
  docker.answer('inspect.json', JSON.stringify([{
    Image: 'sha256:old',
    Config: { Image: 'ghcr.io/kordal/bot-dot:latest', Labels: {
      'com.docker.compose.project': 'botdot',
      'com.docker.compose.service': 'bot-dot',
      'com.docker.compose.project.working_dir': '/Users/someone/Library/Application Support/botdot',
    } },
  }]));
  docker.answer('image.json', JSON.stringify([{ RepoDigests: [], Config: { Labels: {} } }]));
});
after(() => docker.remove());

// Updates, then returns the shell script the updater container was started with.
async function updaterScript(platform) {
  const updates = require('../lib/updates').create({ busy: () => 0, inDocker: true, containerId: () => 'c'.repeat(64), platform, publicKey: key, remoteRelease: async () => release() });
  const before = docker.calls().length;
  await updates.apply();
  const run = await waitFor(() => docker.calls().slice(before).find((c) => c.args[0] === 'run'), { what: 'the updater to start' });
  return run.args[run.args.length - 1];
}

test('on a Mac, the update keeps the Mac compose file', async () => {
  const script = await updaterScript('mac');
  assert.match(script, /cp \/opt\/bot-dot\/compose\.mac\.yaml compose\.yaml\.new/);
});

test('on Linux, the update brings the Linux compose file, as before', async () => {
  const script = await updaterScript(undefined);
  assert.match(script, /cp \/opt\/bot-dot\/compose\.yaml compose\.yaml\.new/);
});

test('the updater leaves the port to the install\'s .env, on a Mac and on Linux', async () => {
  for (const platform of ['mac', undefined]) {
    const script = await updaterScript(platform);
    assert.match(script, /^unset PORT && /);
  }
});

test('unsigned or wrong-repository images are rejected before any pull', async () => {
  for (const manifest of [{ ...release(), signature: '' }, sign({ ...release(), file: 'ghcr.io/evil/app@sha256:' + 'b'.repeat(64) })]) {
    const before = docker.calls().length;
    const updates = require('../lib/updates').create({ busy: () => 0, inDocker: true, containerId: () => 'c'.repeat(64), publicKey: key, remoteRelease: async () => manifest });
    await assert.rejects(updates.apply(), /signature|repository/i);
    assert.ok(!docker.calls().slice(before).some((c) => ['pull', 'run'].includes(c.args[0])));
  }
});

test('the updater waits for readiness and records completion under the server identity', async () => {
  const script = await updaterScript('mac');
  assert.match(script, /up -d --wait --wait-timeout 120 --remove-orphans bot-dot docker-helper/);
  assert.match(script, /&& docker compose -p "botdot" exec -T --user 60000:60000 bot-dot node \/opt\/bot-dot\/lib\/update-install\.js --record$/);
});

// The cleanup after an update (lib/image-cleanup.js has the rule and its tests): when the helper runs it.
const SERVER = 'ghcr.io/kordal/bot-dot';
const DESKTOP = 'ghcr.io/kordal/bot-dot-desktop';
const sha = (c) => `sha256:${c.repeat(64)}`;
const released = (c, references, labels = { 'dev.botdot.release.version': '41' }) => ({ Id: sha(c), RepoTags: references.filter((r) => !r.includes('@')), RepoDigests: references.filter((r) => r.includes('@')), Labels: labels });
// A host after two updates. The server container of inspect.json runs sha256:old.
function hostAfterUpdates(t, computerImage) {
  docker.answer('host.json', JSON.stringify({
    images: [
      { ...released('a', [`${SERVER}:latest`, `${SERVER}@${sha('1')}`]), Id: 'sha256:old' },
      released('b', [`${DESKTOP}@${sha('2')}`]), // the configured desktop
      released('c', [`${SERVER}@${sha('3')}`]),
      released('d', [`${DESKTOP}@${sha('4')}`]),
      released('e', ['bot-dot/desktop:latest'], {}),
    ],
    containers: [{ Id: 'c'.repeat(64), Image: 'sha256:old' }],
  }));
  t.after(() => docker.answer('host.json', null));
  const sizes = [5000, 1000];
  const updates = require('../lib/updates').create({ busy: () => 0, inDocker: true, containerId: () => 'c'.repeat(64), computerImage, publicKey: key, remoteRelease: async () => release(), layersSize: async () => sizes.shift() ?? null });
  const before = docker.calls().length;
  return { updates, removed: () => docker.calls().slice(before).filter((c) => c.args[1] === 'rm').map((c) => c.args[2]) };
}

test('the cleanup keeps the server\'s image and the configured desktop, and removes what the updates left', async (t) => {
  const { updates, removed } = hostAfterUpdates(t, `${DESKTOP}@${sha('2')}`);
  assert.deepEqual(await updates.clean(), { removed: 2, skipped: 2, failed: 0, bytes: 4000 });
  assert.deepEqual(removed(), [`${SERVER}@${sha('3')}`, `${DESKTOP}@${sha('4')}`]);
  assert.deepEqual(await updates.clean(), { removed: 0, skipped: 2, failed: 0, bytes: 0 });
});

test('two cleanups asked for at once run one after the other, and no image is counted twice', async (t) => {
  const { updates, removed } = hostAfterUpdates(t, `${DESKTOP}@${sha('2')}`);
  const [first, second] = await Promise.all([updates.clean(), updates.clean()]);
  assert.deepEqual(first, { removed: 2, skipped: 2, failed: 0, bytes: 4000 });
  assert.deepEqual(second, { removed: 0, skipped: 2, failed: 0, bytes: 0 });
  assert.equal(removed().length, 2);
});

test('with a locally built desktop, no desktop image is looked at', async (t) => {
  const { updates, removed } = hostAfterUpdates(t, 'bot-dot/desktop:latest');
  assert.deepEqual(await updates.clean(), { removed: 1, skipped: 1, failed: 0, bytes: 4000 });
  assert.deepEqual(removed(), [`${SERVER}@${sha('3')}`]);
});

test('on a Mac the cleanup does nothing', async () => {
  const before = docker.calls().length;
  const mac = require('../lib/updates').create({ busy: () => 0, inDocker: true, containerId: () => 'c'.repeat(64), platform: 'mac', publicKey: key });
  assert.equal(await mac.clean(), null);
  const outside = require('../lib/updates').create({ busy: () => 0, inDocker: false });
  assert.equal(await outside.clean(), null);
  assert.deepEqual(docker.calls().slice(before), []);
});

test('the cleanup is refused while an update downloads or restarts', async (t) => {
  const { updates, removed } = hostAfterUpdates(t, undefined);
  const before = docker.calls().length;
  assert.equal((await updates.apply()).state, 'downloading');
  await assert.rejects(updates.clean(), /An update is in progress/);
  await waitFor(() => docker.calls().slice(before).find((c) => c.args[0] === 'run'), { what: 'the updater to start' });
  assert.equal((await updates.status()).state, 'restarting');
  await assert.rejects(updates.clean(), /An update is in progress/);
  assert.deepEqual(removed(), []);
});

// A self-built botdot server (CONTEXT.md) runs an image named without a registry: it is updated from its
// source, and the updater says so instead of failing.
function selfBuilt(t) {
  const inspect = JSON.parse(require('fs').readFileSync(path.join(docker.bin, '..', 'out', 'inspect.json'), 'utf8'));
  docker.answer('inspect.json', JSON.stringify([{ ...inspect[0], Config: { ...inspect[0].Config, Image: 'bot-dot/server:latest' } }]));
  t.after(() => docker.answer('inspect.json', JSON.stringify(inspect)));
  let asked = 0;
  const updates = require('../lib/updates').create({ busy: () => 0, inDocker: true, containerId: () => 'c'.repeat(64), computerImage: 'bot-dot/desktop:latest', publicKey: key, remoteRelease: async () => { asked++; return release(); } });
  const before = docker.calls().length;
  return { updates, asked: () => asked, calls: () => docker.calls().slice(before).map((c) => c.args[0]) };
}
const { SELF_BUILT } = require('../lib/updates');

test('a self-built server is told to pull the source and build again, by the status and by a check', async (t) => {
  const { updates, asked } = selfBuilt(t);
  assert.match(SELF_BUILT, /pulling the source and building again/);
  for (const u of [await updates.status(), await updates.check(), await updates.status()]) {
    assert.equal(u.selfBuilt, true);
    assert.equal(u.howToUpdate, SELF_BUILT);
    assert.equal(u.available, false);
    assert.equal(u.error, null, 'a self-built server is no failed check');
  }
  assert.equal(asked(), 0, 'no registry is asked');
});

test('an update of a self-built server pulls nothing and answers with the sentence', async (t) => {
  const { updates, asked, calls } = selfBuilt(t);
  await assert.rejects(updates.apply({ force: true }), (e) => e.message === SELF_BUILT);
  assert.equal(asked(), 0);
  assert.ok(!calls().some((c) => ['pull', 'login', 'run'].includes(c)), `no pull, sign-in or updater: ${calls()}`);
  assert.equal((await updates.status()).state, 'idle');
});

test('a server from botdot\'s registry is no self-built one', async () => {
  const updates = require('../lib/updates').create({ busy: () => 0, inDocker: true, containerId: () => 'c'.repeat(64), publicKey: key, remoteRelease: async () => release() });
  const u = await updates.status();
  assert.equal(u.selfBuilt, false);
  assert.equal(u.howToUpdate, undefined);
});

test('the Mac app\'s local botdot server is never called self-built', async (t) => {
  selfBuilt(t);
  const mac = require('../lib/updates').create({ busy: () => 0, inDocker: true, containerId: () => 'c'.repeat(64), platform: 'mac', publicKey: key });
  assert.equal((await mac.status()).selfBuilt, false);
  assert.match((await mac.check()).error, /local image/);
});
