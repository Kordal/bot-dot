#!/usr/bin/env node
// Prepare and verify the exact scan evidence passed from image builders to the release signer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const imageNames = { app: 'bot-dot', desktop: 'bot-dot-desktop' };
const arches = ['amd64', 'arm64'];
const scanFiles = ['release-input.json', 'sbom.json', 'vulnerabilities.json', 'secrets.json'];
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fileName = (kind, arch, file) => `security-${kind}-${arch}-${file}`;
const expectedNames = Object.keys(imageNames).flatMap((kind) => arches.flatMap((arch) => scanFiles.map((file) => fileName(kind, arch, file))));

function validIdentity(owner, revision, runId, attempt) {
  return /^[a-z0-9-]+$/.test(owner || '') && /^[a-f0-9]{40}$/.test(revision || '')
    && /^[1-9][0-9]*$/.test(runId || '') && /^[1-9][0-9]*$/.test(attempt || '');
}

function validateRecord(record, owner, revision, runId, attempt, kind, arch) {
  if (record.image !== `ghcr.io/${owner}/${imageNames[kind]}` || record.revision !== revision || record.runId !== runId
    || record.runAttempt !== attempt || record.arch !== arch || !/^sha256:[a-f0-9]{64}$/.test(record.digest)) {
    throw new Error('Scan record does not match this workflow attempt');
  }
}

function stage(source, destination, owner, revision, runId, attempt) {
  const staged = new Map();
  for (const kind of Object.keys(imageNames)) {
    for (const arch of arches) {
      const dir = path.join(source, `security-${kind}-${arch}-${revision}-${attempt}`);
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'release-input.json'), 'utf8'));
      validateRecord(record, owner, revision, runId, attempt, kind, arch);
      for (const file of scanFiles) {
        const sourceFile = path.join(dir, file);
        if (!fs.lstatSync(sourceFile).isFile()) throw new Error('Scan evidence is not a regular file');
        const bytes = fs.readFileSync(sourceFile);
        JSON.parse(bytes.toString('utf8'));
        staged.set(fileName(kind, arch, file), bytes);
      }
      const sbom = JSON.parse(staged.get(fileName(kind, arch, 'sbom.json')).toString('utf8'));
      if (sbom.bomFormat !== 'CycloneDX' || sbom.metadata?.component?.name !== `${record.image}@${record.digest}`) {
        throw new Error('Scan report does not match pushed digest');
      }
      const report = (file) => {
        const findings = JSON.parse(staged.get(fileName(kind, arch, file)).toString('utf8'));
        if (findings.ArtifactName !== `${record.image}@${record.digest}` || findings.ArtifactType !== 'container_image'
          || findings.Metadata?.ImageConfig?.architecture !== arch) {
          throw new Error('Scan report does not match pushed digest');
        }
        return findings;
      };
      const findings = report('vulnerabilities.json');
      if (!Array.isArray(findings.Results)) throw new Error('Scan report does not match pushed digest');
      if (findings.Results.some((result) => result.Vulnerabilities?.some((vulnerability) => vulnerability.Severity === 'CRITICAL'))) {
        throw new Error('Critical vulnerability present');
      }
      // Trivy leaves Results out when it found no secret in any layer (#534).
      if ((report('secrets.json').Results || []).some((result) => result.Secrets?.length)) {
        throw new Error('Secret present in an image layer');
      }
    }
  }
  if (fs.existsSync(destination)) throw new Error('Evidence destination already exists');
  fs.mkdirSync(destination, { recursive: true });
  const files = {};
  for (const [name, bytes] of staged) {
    fs.writeFileSync(path.join(destination, name), bytes);
    files[name] = hash(bytes);
  }
  const manifestBytes = Buffer.from(JSON.stringify({ revision, runId, runAttempt: attempt, files }) + '\n');
  fs.writeFileSync(path.join(destination, 'manifest.json'), manifestBytes);
  process.stdout.write(`sha256=${hash(manifestBytes)}\n`);
}

function verify(directory, owner, revision, runId, attempt, kind, manifestHash) {
  if (!Object.hasOwn(imageNames, kind) || !/^[a-f0-9]{64}$/.test(manifestHash || '')) throw new Error('Invalid image evidence command');
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'));
  if (hash(manifestBytes) !== manifestHash) throw new Error('Evidence checksum mismatch');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.revision !== revision || manifest.runId !== runId || manifest.runAttempt !== attempt
    || !manifest.files || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(expectedNames.slice().sort())) {
    throw new Error('Evidence manifest does not match this workflow attempt');
  }
  for (const arch of arches) {
    for (const file of scanFiles) {
      const name = fileName(kind, arch, file);
      if (hash(fs.readFileSync(path.join(directory, name))) !== manifest.files[name]) throw new Error('Evidence checksum mismatch');
    }
    const record = JSON.parse(fs.readFileSync(path.join(directory, fileName(kind, arch, 'release-input.json')), 'utf8'));
    validateRecord(record, owner, revision, runId, attempt, kind, arch);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'stage') {
  const [source, destination, owner, revision, runId, attempt] = args;
  if (args.length !== 6 || !validIdentity(owner, revision, runId, attempt)) throw new Error('Invalid image evidence command');
  stage(source, destination, owner, revision, runId, attempt);
} else if (command === 'verify') {
  const [directory, owner, revision, runId, attempt, kind, manifestHash] = args;
  if (args.length !== 7 || !validIdentity(owner, revision, runId, attempt)) throw new Error('Invalid image evidence command');
  verify(directory, owner, revision, runId, attempt, kind, manifestHash);
} else {
  throw new Error('Invalid image evidence command');
}
