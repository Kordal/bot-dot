const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonical, verify, secureURL } = require('../lib/release-manifest');
const key = fs.readFileSync(path.join(__dirname, 'fixtures/release-signing/private.pem'));
const publicKey = fs.readFileSync(path.join(__dirname, 'fixtures/release-signing/public.der.b64'), 'utf8').trim();
const release = { app: 'mac', version: 42, revision: '1'.repeat(40), file: 'botdot-1.0.42-mac.zip', sha256: crypto.createHash('sha256').update('fixture').digest('hex') };
const signed = () => ({ ...release, signature: crypto.sign('sha256', canonical(release), key).toString('base64') });

test('production trust is a pinned P-256 key and never accepts the published fixture signer', () => {
  const pin = require('../lib/release-trust');
  const production = crypto.createPublicKey({ key: Buffer.from(pin, 'base64'), type: 'spki', format: 'der' });
  assert.equal(production.asymmetricKeyType, 'ec');
  assert.equal(production.asymmetricKeyDetails.namedCurve, 'prime256v1');
  assert.notEqual(pin, publicKey);
  assert.throws(() => verify(signed(), { app: 'mac', installed: 41 }), /signature/);
});

test('a pinned fixture key authenticates the release and rollback or tampering is rejected', () => {
  assert.equal(verify(signed(), { app: 'mac', installed: 41, publicKey }).version, 42);
  assert.throws(() => verify({ ...signed(), signature: Buffer.alloc(70).toString('base64') }, { app: 'mac', installed: 41, publicKey }), /signature/);
  assert.throws(() => verify(signed(), { app: 'mac', installed: 43, publicKey }), /older/);
  assert.throws(() => verify({ ...signed(), sha256: '0'.repeat(64) }, { app: 'mac', installed: 41, publicKey }), /signature/);
  assert.throws(() => verify(signed(), { app: 'android', installed: 41, publicKey }), /app/);
});

test('update transport accepts HTTPS and literal loopback HTTP only', () => {
  for (const url of ['http://127.0.0.1:4747', 'http://[::1]:4747', 'https://bot.example']) assert.equal(secureURL(url), true);
  for (const url of ['http://bot.example', 'http://127.0.0.1.evil.example', 'http://10.0.0.1', 'ftp://127.0.0.1', 'https://user:pass@bot.example']) assert.equal(secureURL(url), false);
});

test('retired Linux GUI manifest types are rejected while supported release types authenticate', () => {
  for (const app of ['linux-x86_64', 'linux-aarch64']) {
    assert.throws(() => canonical({ ...release, app }), /Invalid release manifest/);
  }
  for (const app of ['mac', 'android', 'server', 'desktop']) {
    const manifest = { ...release, app };
    manifest.signature = crypto.sign('sha256', canonical(manifest), key).toString('base64');
    assert.equal(verify(manifest, { app, installed: 41, publicKey }).app, app);
  }
});

test('release signing refuses a retired Linux GUI request without rewriting its metadata', (t) => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'botdot-retired-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'app.json');
  const contents = JSON.stringify({ versionCode: 42, bundles: {} });
  fs.writeFileSync(file, contents);
  const result = spawnSync(process.execPath, [path.join(__dirname, '../deploy/sign-release.js'), file, 'linux', release.revision], {
    encoding: 'utf8', env: { ...process.env, BOTDOT_RELEASE_PRIVATE_KEY: key.toString() },
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), contents);
});
