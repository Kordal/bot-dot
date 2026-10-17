const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const command = path.resolve(__dirname, '../deploy/create-image-index.js');
const image = 'ghcr.io/kordal/bot-dot';
const revision = 'a'.repeat(40);
const digest = (char) => `sha256:${char.repeat(64)}`;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-publication-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const records = ['amd64', 'arm64'].map((arch, i) => ({ image, revision, runId: '123', runAttempt: '2', arch, digest: digest(String(i + 1)) }));
  const files = records.map((record) => {
    const file = path.join(dir, `${record.arch}.json`);
    fs.writeFileSync(file, JSON.stringify(record));
    return file;
  });
  // The registry boundary has moved every tag after scanning. Digest sources stay immutable.
  fs.writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync('calls.json', JSON.stringify(args));
const moved = args.slice(-2).some((ref) => !ref.includes('@'));
if (!process.env.FAKE_NO_METADATA) {
  fs.writeFileSync(args[args.indexOf('--metadata-file') + 1], JSON.stringify({
    'containerimage.descriptor': { digest: moved ? '${digest('f')}' : '${digest('3')}' },
  }));
}
`, { mode: 0o755 });
  const run = (env = {}) => spawnSync(process.execPath, [command, image, revision, '123', '2', ...files], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, DOCKER_METADATA_OUTPUT_JSON: JSON.stringify({ tags: [`${image}:latest`] }), ...env },
  });
  return { dir, files, records, run };
}

test('publication uses scanned platform digests and the created index descriptor even when tags move', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `digest=${digest('3')}`);
  const args = JSON.parse(fs.readFileSync(path.join(f.dir, 'calls.json')));
  assert.deepEqual(args.slice(-2), [`${image}@${digest('1')}`, `${image}@${digest('2')}`]);
});

test('publication rejects scan records from another image, commit, run, attempt or platform before touching the registry', (t) => {
  const f = fixture(t);
  for (const patch of [{ image: 'ghcr.io/evil/app' }, { revision: 'b'.repeat(40) }, { runId: '124' }, { runAttempt: '1' }, { arch: 'arm64' }, { digest: 'latest' }]) {
    fs.writeFileSync(f.files[0], JSON.stringify({ ...f.records[0], ...patch }));
    const result = f.run();
    assert.notEqual(result.status, 0, JSON.stringify(patch));
    assert.equal(fs.existsSync(path.join(f.dir, 'calls.json')), false);
  }
});

test('publication cannot reuse a stale index descriptor when create returns none', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'image-index.json'), JSON.stringify({ 'containerimage.descriptor': { digest: digest('4') } }));
  const result = f.run({ FAKE_NO_METADATA: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('publication requires successful scan evidence for both platforms', (t) => {
  const f = fixture(t);
  fs.rmSync(f.files[1]);
  assert.notEqual(f.run().status, 0);
  assert.equal(fs.existsSync(path.join(f.dir, 'calls.json')), false);
});
