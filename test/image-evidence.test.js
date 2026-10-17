const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const command = path.resolve(__dirname, '../deploy/image-evidence.js');
const revision = 'a'.repeat(40);
const digest = 'sha256:' + '1'.repeat(64);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-image-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const staged = path.join(root, 'staged');
  for (const [kind, name] of [['app', 'bot-dot'], ['desktop', 'bot-dot-desktop']]) {
    for (const arch of ['amd64', 'arm64']) {
      const dir = path.join(source, `security-${kind}-${arch}-${revision}-2`);
      const image = `ghcr.io/kordal/${name}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'release-input.json'), JSON.stringify({ image, revision, runId: '123', runAttempt: '2', arch, digest }));
      fs.writeFileSync(path.join(dir, 'sbom.json'), JSON.stringify({ bomFormat: 'CycloneDX', metadata: { component: { name: `${image}@${digest}` } } }));
      fs.writeFileSync(path.join(dir, 'vulnerabilities.json'), JSON.stringify({ ArtifactName: `${image}@${digest}`, ArtifactType: 'container_image', Metadata: { ImageConfig: { architecture: arch } }, Results: [] }));
      fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ ArtifactName: `${image}@${digest}`, ArtifactType: 'container_image', Metadata: { ImageConfig: { architecture: arch } } }));
    }
  }
  const stage = () => spawnSync(process.execPath, [command, 'stage', source, staged, 'kordal', revision, '123', '2'], { encoding: 'utf8' });
  const verify = (manifestHash, kind = 'app', directory = staged) => spawnSync(process.execPath, [command, 'verify', directory, 'kordal', revision, '123', '2', kind, manifestHash], { encoding: 'utf8' });
  return { source, staged, stage, verify };
}

test('scan evidence from a different run attempt is rejected before staging', (t) => {
  const f = fixture(t);
  const file = path.join(f.source, `security-app-amd64-${revision}-2`, 'release-input.json');
  const record = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...record, runAttempt: '1' }));
  const result = f.stage();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Scan record does not match this workflow attempt/);
  assert.equal(fs.existsSync(path.join(f.staged, 'manifest.json')), false);
});

test('staging keeps all four scanned digests with SBOMs and findings in a hashed release manifest', (t) => {
  const f = fixture(t);
  const result = f.stage();
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.staged, 'manifest.json')));
  assert.equal(manifest.revision, revision);
  assert.equal(manifest.runId, '123');
  assert.equal(manifest.runAttempt, '2');
  assert.equal(Object.keys(manifest.files).length, 16);
  assert.ok(fs.existsSync(path.join(f.staged, 'security-desktop-arm64-secrets.json')));
  assert.ok(fs.existsSync(path.join(f.staged, 'security-app-amd64-sbom.json')));
  assert.match(result.stdout, /^sha256=[a-f0-9]{64}\n$/);
});

test('the signer rejects a changed release asset even when its filename and scan record are correct', (t) => {
  const f = fixture(t);
  const staged = f.stage();
  assert.equal(staged.status, 0, staged.stderr);
  fs.appendFileSync(path.join(f.staged, 'security-app-amd64-sbom.json'), '\n');
  const result = f.verify(staged.stdout.trim().split('=')[1]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Evidence checksum mismatch/);
});

test('staging rejects an SBOM for another digest before publishing any evidence', (t) => {
  const f = fixture(t);
  const file = path.join(f.source, `security-app-amd64-${revision}-2`, 'sbom.json');
  const sbom = JSON.parse(fs.readFileSync(file));
  sbom.metadata.component.name = 'ghcr.io/kordal/bot-dot@sha256:' + 'f'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(sbom));
  const result = f.stage();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Scan report does not match pushed digest/);
  assert.equal(fs.existsSync(path.join(f.staged, 'manifest.json')), false);
});

test('staging refuses a critical finding even if an earlier scanner step was misreported green', (t) => {
  const f = fixture(t);
  const file = path.join(f.source, `security-app-arm64-${revision}-2`, 'vulnerabilities.json');
  const report = JSON.parse(fs.readFileSync(file));
  report.Results = [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-TEST-1', Severity: 'CRITICAL' }] }];
  fs.writeFileSync(file, JSON.stringify(report));
  const result = f.stage();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Critical vulnerability present/);
  assert.equal(fs.existsSync(path.join(f.staged, 'manifest.json')), false);
});

// #534: a secret in any layer, even one a later layer deleted, stops the release.
test('staging refuses a secret found in an image layer even if the secret scan was misreported green', (t) => {
  const f = fixture(t);
  const file = path.join(f.source, `security-desktop-amd64-${revision}-2`, 'secrets.json');
  const report = JSON.parse(fs.readFileSync(file));
  report.Results = [{ Target: '/opt/leak.env', Class: 'secret', Secrets: [{ RuleID: 'aws-access-key-id', Layer: { DiffID: 'sha256:' + '2'.repeat(64) } }] }];
  fs.writeFileSync(file, JSON.stringify(report));
  const result = f.stage();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Secret present in an image layer/);
  assert.equal(fs.existsSync(path.join(f.staged, 'manifest.json')), false);
});

test('staging refuses a platform whose secret scan is missing or for another digest', (t) => {
  const f = fixture(t);
  const file = path.join(f.source, `security-app-arm64-${revision}-2`, 'secrets.json');
  const report = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...report, ArtifactName: 'ghcr.io/kordal/bot-dot@sha256:' + 'f'.repeat(64) }));
  const other = f.stage();
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /Scan report does not match pushed digest/);
  fs.rmSync(file);
  const missing = f.stage();
  assert.notEqual(missing.status, 0);
  assert.equal(fs.existsSync(path.join(f.staged, 'manifest.json')), false);
});

test('the signer accepts its image evidence downloaded from the same attempt', (t) => {
  const f = fixture(t);
  const staged = f.stage();
  assert.equal(staged.status, 0, staged.stderr);
  const downloaded = path.join(f.source, 'downloaded');
  fs.mkdirSync(downloaded);
  for (const name of fs.readdirSync(f.staged).filter((name) => name === 'manifest.json' || name.startsWith('security-app-'))) {
    fs.copyFileSync(path.join(f.staged, name), path.join(downloaded, name));
  }
  const result = f.verify(staged.stdout.trim().split('=')[1], 'app', downloaded);
  assert.equal(result.status, 0, result.stderr);
});
