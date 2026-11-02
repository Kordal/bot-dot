// The desktop app's builds, releases and updates (#883): what desktop.yml builds, desktop-release.yml signs and
// publishes, desktop/manifest.js lists for the updater, and tauri.conf.json makes the app read.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseYaml, readWorkflows, triggersOf } = require('./workflow-runners');
const { manifest, PLATFORMS } = require('../desktop/manifest');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const workflow = (name) => parseYaml(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'));

function builds(version, files = Object.values(PLATFORMS), sigs = files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-release-'));
  for (const suffix of files) fs.writeFileSync(path.join(dir, `botdot-${version}-${suffix}`), 'build');
  for (const suffix of sigs) fs.writeFileSync(path.join(dir, `botdot-${version}-${suffix}.sig`), `sig of ${suffix}\n`);
  return dir;
}

test('the manifest names each system’s build in its versioned release, with its signature', () => {
  const date = new Date('2026-11-02T18:00:00Z');
  const got = manifest({ version: '0.1.7', repository: 'Kordal/bot-dot', dir: builds('0.1.7'), date });
  assert.equal(got.version, '0.1.7');
  assert.equal(got.pub_date, '2026-11-02T18:00:00.000Z');
  assert.deepEqual(Object.keys(got.platforms).sort(), ['darwin-aarch64', 'darwin-x86_64', 'windows-aarch64', 'windows-x86_64']);
  assert.deepEqual(got.platforms['darwin-aarch64'], {
    signature: 'sig of mac-apple-silicon.app.tar.gz',
    url: 'https://github.com/Kordal/bot-dot/releases/download/desktop-v0.1.7/botdot-0.1.7-mac-apple-silicon.app.tar.gz',
  });
  assert.equal(got.platforms['windows-aarch64'].url, 'https://github.com/Kordal/bot-dot/releases/download/desktop-v0.1.7/botdot-0.1.7-windows-arm64-setup.exe');
});

test('no manifest without every build, its signature and a plain version', () => {
  const all = Object.values(PLATFORMS);
  assert.throws(() => manifest({ version: '0.1.7', repository: 'a/b', dir: builds('0.1.7', all.slice(1)) }), /Missing botdot-0\.1\.7-mac-apple-silicon/);
  assert.throws(() => manifest({ version: '0.1.7', repository: 'a/b', dir: builds('0.1.7', all, all.slice(0, 3)) }), /Missing the signature of botdot-0\.1\.7-windows-arm64-setup\.exe/);
  for (const version of ['0.1', 'v0.1.7', '0.1.07', '0.1.7-beta', '0.1.7\n']) {
    assert.throws(() => manifest({ version, repository: 'a/b', dir: builds('0.1.7') }), /Not a version/, JSON.stringify(version));
  }
  assert.throws(() => manifest({ version: '0.1.7', repository: 'a/b/c', dir: builds('0.1.7') }), /Not a repository/);
});

test('the app reads the manifest the release workflow publishes, checked by a real update key', () => {
  const updater = config.plugins.updater;
  assert.deepEqual(updater.endpoints, ['https://github.com/Kordal/bot-dot/releases/download/desktop-latest/latest.json']);
  // A minisign public key, base64 of its two text lines.
  const pub = Buffer.from(updater.pubkey, 'base64').toString('utf8');
  assert.match(pub, /^untrusted comment: minisign public key: [0-9A-F]{16}\n[A-Za-z0-9+/=]{56}\n?$/);
  assert.equal(updater.windows.installMode, 'passive');
  // The Mac build is signed ad hoc, so macOS offers Open Anyway for it.
  assert.equal(config.bundle.macOS.signingIdentity, '-');
  const release = fs.readFileSync(path.join(WORKFLOWS, 'desktop-release.yml'), 'utf8');
  assert.match(release, /gh release upload desktop-latest --clobber latest\.json/);
  assert.match(release, /node \.\.\/desktop\/manifest\.js /);
});

test('desktop.yml builds Windows x64 and arm64 and the Mac for Apple silicon and Intel, as the manifest names them', () => {
  const build = workflow('desktop.yml').jobs.build;
  const rows = build.strategy.matrix.include;
  assert.deepEqual(rows.map((r) => [r.name, r.runner, r.target]), [
    ['windows-x64', 'windows-latest', 'x86_64-pc-windows-msvc'],
    ['windows-arm64', 'windows-latest', 'aarch64-pc-windows-msvc'],
    ['mac-apple-silicon', 'macos-latest', 'aarch64-apple-darwin'],
    ['mac-intel', 'macos-latest', 'x86_64-apple-darwin'],
  ]);
  for (const suffix of Object.values(PLATFORMS)) assert.ok(rows.some((r) => suffix.startsWith(`${r.name}.`) || suffix.startsWith(`${r.name}-`)), suffix);
  // Lint and the unit tests, once per system, where the build runs on the machine it is built for; no Docker.
  assert.deepEqual(rows.filter((r) => r.check).map((r) => r.name), ['windows-x64', 'mac-apple-silicon']);
  const runs = build.steps.map((st) => st.run || '').join('\n');
  assert.match(runs, /cargo clippy --locked --all-targets -- -D warnings/);
  assert.match(runs, /cargo test --locked/);
  assert.doesNotMatch(runs, /docker/i);
  // The cached target/ holds an earlier version's bundles: they are cleared, and only this version's collected.
  assert.match(runs, /rm -rf target\/\$\{\{ matrix\.target \}\}\/release\/bundle\n/);
  assert.match(runs, /nsis\/botdot_"\$VERSION"_\*-setup\.exe/);
  assert.match(runs, /dmg\/botdot_"\$VERSION"_\*\.dmg/);
});

test('a pull request that changes the app builds it; a release is nightly, by hand or by tag, and only its publish job holds the key', () => {
  const workflows = readWorkflows(WORKFLOWS);
  const desktop = workflow('desktop.yml');
  assert.deepEqual(desktop.on.pull_request.paths, ['desktop/**', '.github/workflows/desktop.yml', '.github/workflows/desktop-release.yml']);
  assert.doesNotMatch(JSON.stringify(desktop.jobs), /secrets\./);

  const release = workflow('desktop-release.yml');
  assert.deepEqual(Object.keys(release.on).sort(), ['push', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(release.on.push, { tags: ['desktop-v*'] });
  assert.equal(release.on.schedule.length, 1);
  assert.deepEqual(triggersOf(workflows, 'desktop-release.yml').map((t) => t.event).sort(), ['push', 'schedule', 'workflow_dispatch']);
  const jobs = release.jobs;
  assert.equal(jobs.build.uses, './.github/workflows/desktop.yml');
  assert.equal(jobs.build.if, "needs.plan.outputs.release == 'true'");
  assert.deepEqual(jobs.publish.needs, ['plan', 'build']);
  for (const [id, job] of Object.entries(jobs)) {
    assert.equal(/secrets\./.test(JSON.stringify(job)), id === 'publish', id);
  }
  const plan = jobs.plan.steps.map((st) => st.run || '').join('\n');
  assert.match(plan, /refs\/heads\/main\) ;;/, 'a run on another branch releases nothing');
  assert.match(plan, /git merge-base --is-ancestor HEAD origin\/main/, 'a tag must be on main');
  assert.match(plan, /git diff --name-only "\$SHA" HEAD -- desktop /, 'a nightly run releases only what changed');
  assert.match(plan, /is not newer than/, 'never a version the apps would not take');
  // The desktop app is not in the server image: a change to it builds no image.
  assert.match(workflow('images.yml').jobs.plan.steps.map((st) => st.run || '').join('\n'), /':!desktop\/'/);
});
