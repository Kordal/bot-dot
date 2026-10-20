// Whether an image on a registry is one of botdot's signed images (lib/signed-image.js): the check the updater
// makes before an update and install.sh before the first download.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { canonical } = require('../lib/release-manifest');
const { signedRelease, signedImage, refusal } = require('../lib/signed-image');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/release-signing/private.pem'));
const publicKey = fs.readFileSync(path.join(__dirname, 'fixtures/release-signing/public.der.b64'), 'utf8').trim();
const DIGEST = 'b'.repeat(64);
const release = (fields = {}, key = fixture) => {
  const m = { app: 'server', version: 7, revision: 'a'.repeat(40), file: `ghcr.io/kordal/bot-dot@sha256:${DIGEST}`, sha256: DIGEST, ...fields };
  return { ...m, signature: crypto.sign('sha256', canonical(m), key).toString('base64') };
};
const check = (manifest, image = 'ghcr.io/kordal/bot-dot:latest', app = 'server') => signedImage(image, app, { publicKey, remoteRelease: async () => manifest });
const reason = async (promise) => { try { await promise; } catch (error) { return refusal(error); } assert.fail('the image was accepted'); };

test('a release signed with the pinned key gives the signed image, pinned by its digest', async () => {
  assert.equal(await check(release()), `ghcr.io/kordal/bot-dot@sha256:${DIGEST}`);
  assert.equal(await check(release(), `ghcr.io/kordal/bot-dot@sha256:${'c'.repeat(64)}`), `ghcr.io/kordal/bot-dot@sha256:${DIGEST}`, 'whichever tag or digest the name had');
});

test('the signed release also says the source revision it was built from, for "Version X is available" (#193)', async () => {
  const m = await signedRelease('ghcr.io/kordal/bot-dot:latest', 'server', { publicKey, remoteRelease: async () => release({ revision: 'd'.repeat(40) }) });
  assert.equal(m.file, `ghcr.io/kordal/bot-dot@sha256:${DIGEST}`);
  assert.equal(m.revision, 'd'.repeat(40));
  await assert.rejects(signedRelease('ghcr.io/kordal/bot-dot:latest', 'server', { publicKey, remoteRelease: async () => ({ ...release(), revision: 'e'.repeat(40) }) }), /The release signature is invalid/, 'the revision is signed too');
});

test('the registry is asked for the release of the image named', async () => {
  let asked = null;
  await signedImage('registry.test:5000/kordal/bot-dot-desktop:latest', 'desktop', { publicKey, remoteRelease: async (image) => { asked = image; return release({ app: 'desktop', file: `registry.test:5000/kordal/bot-dot-desktop@sha256:${DIGEST}` }); } });
  assert.equal(asked, 'registry.test:5000/kordal/bot-dot-desktop:latest');
});

test('an image signed with another key is refused, and says so', async () => {
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  assert.deepEqual(await reason(check(release({}, other))), { access: false, why: "it is signed, but not with botdot's release key" });
  assert.deepEqual(await reason(check({ ...release(), signature: '' })), { access: false, why: "it is signed, but not with botdot's release key" });
});

test('an image without a signed release is refused, and says so', async () => {
  const missing = Object.assign(new Error('The registry answered 404 for ghcr.io/kordal/bot-dot:release'), { status: 404 });
  assert.deepEqual(await reason(signedImage('ghcr.io/kordal/bot-dot:latest', 'server', { publicKey, remoteRelease: async () => { throw missing; } })), { access: false, why: 'it has no botdot signature' });
  assert.deepEqual(refusal(new Error('The image has no signed release manifest')), { access: false, why: 'it has no botdot signature' });
});

test('a signature for another repository or another of botdot\'s images is refused', async () => {
  assert.deepEqual(await reason(check(release({ file: `ghcr.io/evil/app@sha256:${DIGEST}` }))), { access: false, why: 'its signature is for another image' });
  assert.deepEqual(await reason(check(release({ app: 'desktop' }))), { access: false, why: 'its signature is for another image' });
});

test('a registry that wants a token is told apart from a refused signature', () => {
  assert.equal(refusal(Object.assign(new Error('The registry refused the token (401)'), { status: 401 })).access, true);
  assert.equal(refusal(Object.assign(new Error('The registry answered 403 for x'), { status: 403 })).access, true);
  assert.deepEqual(refusal(new Error('fetch failed')), { access: false, why: 'it could not be checked (fetch failed)' });
});

test('the updater makes this same check', () => {
  const updates = fs.readFileSync(path.join(__dirname, '..', 'lib', 'updates.js'), 'utf8');
  assert.match(updates, /require\('\.\/signed-image'\)/);
  assert.doesNotMatch(updates, /release-manifest/, 'and no check of its own');
});

// The command install.sh runs (node lib/signed-image.js <image> <app>, a token on stdin). A name the check
// cannot even ask about ends without the network.
test('the command says why it refused, and needs an image and which of botdot\'s it is', () => {
  const file = path.join(__dirname, '..', 'lib', 'signed-image.js');
  const local = spawnSync(process.execPath, [file, 'bot-dot:dev', 'server'], { input: '', encoding: 'utf8' });
  assert.equal(local.status, 1);
  assert.match(local.stdout, /^it could not be checked \(.+\)\n$/);
  assert.throws(() => execFileSync(process.execPath, [file, 'ghcr.io/kordal/bot-dot:latest'], { input: '', stdio: 'pipe' }), /Usage/);
  assert.throws(() => execFileSync(process.execPath, [file, 'ghcr.io/kordal/bot-dot:latest', 'server', '--other'], { input: '', stdio: 'pipe' }), /Usage/);
  const asked = spawnSync(process.execPath, [file, 'bot-dot:dev', 'server', '--revision'], { input: '', encoding: 'utf8' });
  assert.equal(asked.status, 1, 'with --revision, a refusal is said as without it');
  assert.match(asked.stdout, /^it could not be checked \(.+\)\n$/);
});

// #466: a botdot from before accounts reads its updates from the `release` tag. A version with accounts is installed
// again, never offered as an update (ADR 028), so its signed releases are under another tag that only it reads.
test('the release with accounts is read from its own tag, which a botdot from before accounts never asks for', async () => {
  const registry = require('../lib/registry');
  assert.equal(registry.RELEASE_TAG, 'accounts-release');
  const asked = [];
  const real = global.fetch;
  global.fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ annotations: { 'dev.botdot.release': JSON.stringify(release()) } }), { status: 200 });
  };
  try { await registry.remoteRelease('ghcr.io/kordal/bot-dot:latest'); } finally { global.fetch = real; }
  assert.deepEqual(asked, ['https://ghcr.io/v2/kordal/bot-dot/manifests/accounts-release']);
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/images.yml'), 'utf8');
  assert.match(workflow, /-t "\$IMAGE:accounts-release" "\$IMAGE@\$DIGEST"/, 'the image workflow signs under it');
  assert.doesNotMatch(workflow, /\$IMAGE:release\b/, 'and no longer under the old tag');
});
