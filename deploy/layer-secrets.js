#!/usr/bin/env node
// Prints each secret Trivy found in an image (images.yml, #534) with the file and the layer that added it, and exits
// 1 when there is one. Trivy keeps a finding from every layer, also when a later layer deleted the file, so the
// layer's build step is what tells the owner where the credential came from. The secret itself is never printed.
const fs = require('node:fs');

const [file] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = (report.Results || []).flatMap((result) => (result.Secrets || []).map((secret) => {
  const layer = secret.Layer || {};
  const step = layer.CreatedBy ? ` (${layer.CreatedBy})` : '';
  return `Secret ${secret.RuleID} in ${result.Target} line ${secret.StartLine}, added by layer ${layer.DiffID || layer.Digest || 'unknown'}${step}`;
}));
process.stdout.write(lines.length ? lines.join('\n') + '\n' : 'No secret in any layer.\n');
process.exitCode = lines.length ? 1 : 0;
