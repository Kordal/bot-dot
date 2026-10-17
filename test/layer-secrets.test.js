// The image workflow's secret scan (#534) names the layer and the file of every finding in its log, so the owner can
// see which build step put a credential into the image even when a later step deleted the file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const command = path.resolve(__dirname, '../deploy/layer-secrets.js');
const lower = { Digest: 'sha256:' + '8'.repeat(64), DiffID: 'sha256:' + '1'.repeat(64), CreatedBy: 'COPY creds /opt/app/creds.txt # buildkit' };

function run(t, report) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-layer-secrets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'secrets.json');
  fs.writeFileSync(file, JSON.stringify(report));
  return spawnSync(process.execPath, [command, file], { encoding: 'utf8' });
}

test('each secret is reported with the layer that added it and the file it is in, and the check fails', (t) => {
  // Trivy's JSON for a file added by one layer and deleted by the next (trimmed).
  const result = run(t, {
    ArtifactName: 'ghcr.io/kordal/bot-dot@sha256:' + '3'.repeat(64),
    Results: [{
      Target: '/opt/app/creds.txt',
      Class: 'secret',
      Secrets: [
        { RuleID: 'aws-access-key-id', StartLine: 1, Match: 'aws_access_key_id = ********************', Layer: lower },
        { RuleID: 'github-pat', StartLine: 3, Match: 'github_token=****', Layer: lower },
      ],
    }],
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, [
    `Secret aws-access-key-id in /opt/app/creds.txt line 1, added by layer ${lower.DiffID} (COPY creds /opt/app/creds.txt # buildkit)`,
    `Secret github-pat in /opt/app/creds.txt line 3, added by layer ${lower.DiffID} (COPY creds /opt/app/creds.txt # buildkit)`,
    '',
  ].join('\n'));
  assert.doesNotMatch(result.stdout, /\*\*\*\*/, 'not even the masked line');
});

test('an image with no secret in any layer passes', (t) => {
  const result = run(t, { ArtifactName: 'ghcr.io/kordal/bot-dot@sha256:' + '3'.repeat(64) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'No secret in any layer.\n');
});

test('a report that cannot be read fails rather than passing', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-layer-secrets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [command, path.join(dir, 'missing.json')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
});
