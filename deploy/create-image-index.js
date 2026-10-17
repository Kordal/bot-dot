#!/usr/bin/env node
// Join only the platform digests whose scans succeeded in this workflow attempt.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const [image, revision, runId, runAttempt, amd64, arm64] = process.argv.slice(2);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
if (!/^ghcr\.io\/[a-z0-9][a-z0-9._/-]+$/.test(image) || !/^[a-f0-9]{40}$/.test(revision)
  || !/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)) throw new Error('Invalid publication identity');
const sources = [amd64, arm64].map((file, i) => {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.image !== image || record.revision !== revision || record.runId !== runId || record.runAttempt !== runAttempt
    || record.arch !== ['amd64', 'arm64'][i] || !digestPattern.test(record.digest)) throw new Error('Scan record does not match this publication');
  return `${image}@${record.digest}`;
});
const { tags } = JSON.parse(process.env.DOCKER_METADATA_OUTPUT_JSON);
if (!Array.isArray(tags) || !tags.length || tags.some((tag) => typeof tag !== 'string' || !tag.startsWith(`${image}:`)
  || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag.slice(image.length + 1)))) throw new Error('Invalid publication tags');
// A failed create must never leave an old descriptor available to a rerun.
fs.rmSync('image-index.json', { force: true });
execFileSync('docker', ['buildx', 'imagetools', 'create', '--metadata-file', 'image-index.json', ...tags.flatMap((tag) => ['-t', tag]), ...sources], { stdio: ['ignore', 2, 2] });
const result = JSON.parse(fs.readFileSync('image-index.json', 'utf8'));
const digest = result['containerimage.descriptor']?.digest;
if (!digestPattern.test(digest)) throw new Error('The created index has no valid immutable digest');
process.stdout.write(`digest=${digest}\n`);
