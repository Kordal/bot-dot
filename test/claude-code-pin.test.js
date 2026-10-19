// The pin of Claude Code in the Dockerfile and its daily bump (claude-code-bump.yml, #85).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pinnedVersion, withVersion, isNewer } = require('../deploy/claude-code-pin');

const ROOT = path.join(__dirname, '..');
const command = path.join(ROOT, 'deploy', 'claude-code-pin.js');
const DOCKERFILE = [
  'FROM x',
  '# Claude Code 2.1.284 (the bots\' engine), Bitwarden CLI 2026.9.0 (the vault).',
  'RUN npm install -g @anthropic-ai/claude-code@2.1.284 @bitwarden/cli@2026.9.0 \\',
  ' && claude --version && bw --version',
  '',
].join('\n');

test('the pin is read from the install line', () => {
  assert.equal(pinnedVersion(DOCKERFILE), '2.1.284');
  assert.throws(() => pinnedVersion('FROM x\n'), /no pinned/);
});

test('the real Dockerfile pins one version, named the same in its comment', () => {
  const text = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const version = pinnedVersion(text);
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(text, new RegExp(`^# Claude Code ${version.replace(/\./g, '\\.')} \\(`, 'm'));
  assert.equal(withVersion(text, version), text);
});

test('a bump changes only the version, on the comment and the install line', () => {
  const out = withVersion(DOCKERFILE, '2.1.303');
  assert.equal(out, DOCKERFILE.replaceAll('2.1.284', '2.1.303'));
  assert.match(out, /@bitwarden\/cli@2026\.9\.0/);
});

test('only a stable release is taken: no next, beta or anything but x.y.z', () => {
  for (const v of ['2.1.304-beta.1', 'next', '', '2.1', '2.1.303 ', '2.1.303\nRUN evil']) {
    assert.throws(() => withVersion(DOCKERFILE, v), /stable release/, JSON.stringify(v));
  }
});

test('versions compare by number, not as text', () => {
  assert.equal(isNewer('2.1.303', '2.1.284'), true);
  assert.equal(isNewer('2.1.1000', '2.1.999'), true);
  assert.equal(isNewer('3.0.0', '2.9.9'), true);
  assert.equal(isNewer('2.1.284', '2.1.284'), false);
  assert.equal(isNewer('2.1.283', '2.1.284'), false);
});

function run(t, args, text = DOCKERFILE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-claude-pin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'Dockerfile');
  fs.writeFileSync(file, text);
  const r = spawnSync(process.execPath, [command, file, ...args], { encoding: 'utf8' });
  return { ...r, after: fs.readFileSync(file, 'utf8') };
}

test('the command rewrites the Dockerfile only for a newer release, and says so for GITHUB_OUTPUT', (t) => {
  const newer = run(t, ['2.1.303']);
  assert.equal(newer.status, 0, newer.stderr);
  assert.equal(newer.stdout, 'from=2.1.284\nto=2.1.303\nbump=true\n');
  assert.equal(newer.after, withVersion(DOCKERFILE, '2.1.303'));

  for (const v of ['2.1.284', '2.1.200']) {
    const same = run(t, [v]);
    assert.equal(same.status, 0, same.stderr);
    assert.equal(same.stdout, `from=2.1.284\nto=${v}\nbump=false\n`);
    assert.equal(same.after, DOCKERFILE);
  }

  const beta = run(t, ['2.1.304-beta.1']);
  assert.notEqual(beta.status, 0);
  assert.equal(beta.after, DOCKERFILE);

  const read = run(t, []);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(read.stdout, '2.1.284\n');
});
