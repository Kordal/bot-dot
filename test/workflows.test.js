// Every job runs on GitHub's own throwaway machines (#528): the repository is public, and a fork's pull request
// can change a workflow, so a runner of the owner's would run anyone's code (audit S1). The image carries the
// Android app and no native Mac app (ADR 142).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseYaml, evaluate, readWorkflows, selfHostedJobs, triggersOf, ANY, FALSY } = require('./workflow-runners');

const WORKFLOWS = path.join(__dirname, '..', '.github', 'workflows');
const PULL_REQUEST = ['pull_request', 'pull_request_target'];
const reach = (files) => selfHostedJobs(Object.fromEntries(Object.entries(files).map(([name, src]) => [name, parseYaml(src)])));
const brief = (rows) => rows.map((r) => `${r.workflow} ${r.job} on ${r.event}`).sort();

test('the YAML the workflows use reads as GitHub reads it', () => {
  const doc = parseYaml([
    'on:',
    '  push:',
    "    branches: [main] # only main",
    "    paths-ignore: ['**.md', \"docs/**\"]",
    'jobs:',
    '  a:',
    "    runs-on: ${{ github.event_name == 'push' && 'ubuntu-latest' || fromJSON('[\"self-hosted\",\"x\"]') }}",
    '    with: { server: false, name: "a, b" }',
    '    steps:',
    '      - uses: actions/checkout@v4 # v4',
    '      - run: |',
    '          echo "# kept" # and this too',
    '',
    '          echo two',
    '        env: { A: 1 }',
    '      - plain item',
  ].join('\n'));
  assert.deepEqual(doc.on, { push: { branches: ['main'], 'paths-ignore': ['**.md', 'docs/**'] } });
  assert.equal(doc.jobs.a['runs-on'], "${{ github.event_name == 'push' && 'ubuntu-latest' || fromJSON('[\"self-hosted\",\"x\"]') }}");
  assert.deepEqual(doc.jobs.a.with, { server: false, name: 'a, b' });
  assert.deepEqual(doc.jobs.a.steps, [
    { uses: 'actions/checkout@v4' },
    { run: 'echo "# kept" # and this too\n\necho two', env: { A: 1 } },
    'plain item',
  ]);
});

test('an expression has every value it may take when only the event is known', () => {
  const pr = { github: { event_name: 'pull_request' } };
  assert.deepEqual(evaluate("github.event_name == 'pull_request' && 'ubuntu-latest' || 'self'", pr), ['ubuntu-latest']);
  assert.deepEqual(evaluate("github.event_name == 'PUSH' && 'ubuntu-latest' || 'self'", { github: { event_name: 'push' } }), ['ubuntu-latest']);
  // Whether the pull request comes from a fork is not known: both runners are possible.
  const fromFork = "github.event.pull_request.head.repo.full_name != github.repository && 'ubuntu-latest' || 'self'";
  assert.deepEqual(new Set(evaluate(fromFork, pr)), new Set(['ubuntu-latest', 'self']));
  const fork = { github: { event_name: 'pull_request', repository: 'a/b', event: { pull_request: { head: { repo: { full_name: 'c/b' } } } } } };
  assert.deepEqual(evaluate(fromFork, fork), ['ubuntu-latest']);
  assert.deepEqual(evaluate("fromJSON('[\"self-hosted\",\"a\"]')", pr), [['self-hosted', 'a']]);
  assert.deepEqual(evaluate('inputs.runner', pr), [ANY]);
  assert.deepEqual(evaluate("inputs.big && 'ubuntu-latest'", pr), [FALSY, 'ubuntu-latest']);
});

test("a job that may run on a machine other than GitHub's is found, however it gets there", () => {
  // GitHub's machines for a fork, the owner's for everything else: found.
  assert.deepEqual(brief(reach({ 'a.yml': [
    'on: [pull_request]',
    'jobs:',
    '  t:',
    "    runs-on: ${{ github.event.pull_request.head.repo.full_name != github.repository && 'ubuntu-latest' || fromJSON('[\"self-hosted\",\"botdot-mac\"]') }}",
  ].join('\n') })), ['a.yml t on pull_request']);

  // For an event that only a trusted run has.
  assert.deepEqual(brief(reach({ 'a.yml': "on:\n  schedule:\n    - cron: '0 3 * * *'\njobs:\n  t:\n    runs-on: [self-hosted, x]\n" })), ['a.yml t on schedule']);

  // From a matrix.
  assert.deepEqual(brief(reach({ 'a.yml': [
    'on:',
    '  pull_request_target:',
    'jobs:',
    '  t:',
    '    runs-on: ${{ matrix.runner }}',
    '    strategy:',
    '      matrix:',
    '        os: [one, two]',
    '        include:',
    '          - os: one',
    '            runner: ubuntu-latest',
    '          - os: two',
    '            runner: [self-hosted, botdot-linux]',
  ].join('\n') })), ['a.yml t on pull_request_target']);

  // Through a reusable workflow, for the events of the workflows that call it.
  assert.deepEqual(brief(reach({
    'pr.yml': 'on: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/checks.yml\n',
    'checks.yml': 'on:\n  workflow_call:\njobs:\n  t:\n    runs-on: [self-hosted, botdot-linux]\n',
  })), ['checks.yml t on pull_request']);

  // A runner it cannot tell, a runner group, or another repository's reusable workflow; GitHub's own are fine.
  assert.deepEqual(brief(reach({ 'a.yml': [
    'on: pull_request',
    'jobs:',
    '  input:',
    '    runs-on: ${{ inputs.runner }}',
    '  part:',
    '    runs-on: ubuntu-${{ inputs.version }}',
    '  group:',
    '    runs-on: { group: botdot }',
    '  remote:',
    '    uses: someone/else/.github/workflows/x.yml@v1',
    '  fine:',
    '    runs-on: ubuntu-24.04',
    '  arm:',
    '    runs-on: ubuntu-24.04-arm',
    '  mac:',
    '    runs-on: macos-15',
  ].join('\n') })), ['a.yml group on pull_request', 'a.yml input on pull_request', 'a.yml part on pull_request', 'a.yml remote on pull_request']);
});

// The repository is public (#528): a fork's pull request can change a workflow, so any runner but GitHub's own
// throwaway machines could run anyone's code. No workflow names one.
test('no workflow uses a self-hosted runner', () => {
  const rows = selfHostedJobs(readWorkflows(WORKFLOWS));
  assert.deepEqual(rows.map((r) => `${r.workflow} ${r.job} on ${r.event} (via ${r.via}): ${r.runner}`), []);
  for (const name of fs.readdirSync(WORKFLOWS)) {
    assert.doesNotMatch(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'), /self-hosted|botdot-mac|botdot-linux/i, name);
  }
});

test('no job a pull request starts holds a secret or the release environment', () => {
  const workflows = readWorkflows(WORKFLOWS);
  const found = [];
  for (const [name, wf] of Object.entries(workflows)) {
    if (!triggersOf(workflows, name).some((t) => PULL_REQUEST.includes(t.event))) continue;
    for (const [id, job] of Object.entries(wf.jobs || {})) {
      if (/\$\{\{[^}]*\bsecrets\./.test(JSON.stringify(job)) || job.environment) found.push(`${name} ${id}`);
    }
  }
  assert.deepEqual(found, []);
  // Signing and publishing are in jobs that only a nightly run or a run by hand starts.
  for (const [name, job] of [['images.yml', 'publish'], ['android.yml', 'build'], ['android.yml', 'publish'], ['android.yml', 'play']]) {
    assert.equal(workflows[name].jobs[job].environment, 'release', `${name} ${job}`);
    assert.deepEqual(triggersOf(workflows, name).map((t) => t.event).sort(), ['schedule', 'workflow_dispatch'], name);
  }
});

// Releases (#512): once a night or by hand, never on a merge; tests first; one image build for a new Android app.
const workflow = (name) => parseYaml(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'));

test('the images and the Android app are released nightly or by hand, never on a merge to main', () => {
  for (const name of ['images.yml', 'android.yml']) {
    const on = workflow(name).on;
    assert.deepEqual(Object.keys(on).sort(), ['schedule', 'workflow_dispatch'], name);
    assert.equal(on.schedule.length, 1, `${name}: once a night`);
  }
  const hour = (name) => Number(workflow(name).on.schedule[0].cron.split(' ')[1]);
  assert.ok(hour('android.yml') < hour('images.yml'), 'the Android release runs before the image build that carries it');
});

test('a nightly run that has nothing new does nothing; a run by hand always does', () => {
  for (const [name, gate] of [['images.yml', 'build'], ['android.yml', 'release']]) {
    const jobs = workflow(name).jobs;
    const plan = jobs.plan.steps.map((st) => st.run || '').join('\n');
    assert.match(plan, /\[ "\$EVENT" = schedule \] \|\| /, `${name}: only a nightly run may skip`);
    for (const [job, def] of Object.entries(jobs)) {
      if (job === 'plan') continue;
      const needs = [].concat(def.needs || []);
      // Every job hangs on the plan, directly or through a job that does.
      assert.ok(needs.length, `${name} ${job} needs a job`);
      if (needs.includes('plan')) assert.equal(def.if, `needs.plan.outputs.${gate} == 'true'`, `${name} ${job}`);
    }
  }
  const images = workflow('images.yml').jobs.plan.steps.map((st) => st.run || '').join('\n');
  assert.match(images, /--workflow images\.yml --branch main --status success/, 'since the last image published');
  assert.equal(workflow('images.yml').permissions.actions, 'read', 'which it may read in a private repository');
  assert.match(images, /':!android\/'/, 'an Android change counts once it is released');
  assert.match(images, /startswith\(\\"android-v\\"\)\) \| select\(\.createdAt > /, 'or a newer Android release');
});

// The tests and the builds run side by side (a build pushes only its own platform tags, which nothing installs);
// what is signed and published waits for both.
test('the image build tests the commit it builds; a failure publishes nothing', () => {
  const jobs = workflow('images.yml').jobs;
  assert.equal(jobs.test.uses, './.github/workflows/tests.yml');
  assert.deepEqual(jobs.test.with, { android: false });
  assert.ok(![].concat(jobs.build.needs).includes('test'), 'the build does not wait for the tests');
  assert.deepEqual([].concat(jobs.evidence.needs).sort(), ['build', 'test']);
  assert.equal(jobs.publish.needs, 'evidence');
  assert.doesNotMatch(jobs.evidence.if, /always\(\)|failure\(\)|cancelled\(\)/, 'a failed test stops the evidence');
  const tags = jobs.build.steps.find((st) => st.id === 'build').with.tags;
  assert.equal(tags, '${{ env.IMAGE }}:sha-${{ github.sha }}-${{ matrix.arch }}', 'the build pushes only its platform tag');
});

test('the Android release tests the commit it builds; a failure publishes nothing', () => {
  const jobs = workflow('android.yml').jobs;
  assert.deepEqual(jobs.test.with, { server: false });
  assert.ok(![].concat(jobs.build.needs).includes('test'), 'the build does not wait for the tests');
  assert.deepEqual([].concat(jobs.publish.needs).sort(), ['build', 'test']);
  assert.equal(jobs.publish.if, undefined, 'a failed test stops the release');
  assert.ok(!jobs.build.steps.some((st) => /gh release/.test(st.run || '')), 'only the publish job releases');
});

// Google Play (ADR 173): the same run builds the Play bundle and checks it; it goes to Play only after the tests.
test('the Android release builds the Play bundle and sends it to Play only after the tests', () => {
  const jobs = workflow('android.yml').jobs;
  const build = jobs.build.steps.map((st) => st.run || '').join('\n');
  assert.match(build, /\.\/gradlew assembleRelease bundlePlay /);
  assert.match(build, /REQUEST_INSTALL_PACKAGES REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/, 'the bundle asks for no permission Play restricts');
  assert.match(build, /keytool -printcert -jarfile "\$AAB"[^\n]*cc05ce8b/, 'signed with the release key, which Play knows as the upload key');
  assert.deepEqual([].concat(jobs.play.needs).sort(), ['build', 'test']);
  assert.equal(jobs.play.if, undefined, 'a failed test sends nothing to Play');
  const upload = jobs.play.steps.find((st) => /play-upload\.js/.test(st.run || ''));
  assert.match(upload.run, /\[ -z "\$PLAY_SERVICE_ACCOUNT_JSON" \]/, 'without the secret the bundle stays an artifact');
  assert.match(upload.run, / internal$/m, 'only the internal track: promoting stays a step in Play Console');
});

test('a nightly Android release starts no image build of its own; a run by hand starts one', () => {
  const step = workflow('android.yml').jobs.publish.steps.find((st) => /gh workflow run images\.yml/.test(st.run || ''));
  assert.equal(step.if, "github.event_name == 'workflow_dispatch'");
});

test('the image carries the Android app and no Mac app', () => {
  const images = parseYaml(fs.readFileSync(path.join(WORKFLOWS, 'images.yml'), 'utf8'));
  const runs = images.jobs.build.steps.map((s) => s.run || '').join('\n');
  assert.match(runs, /^fetch android-v android-app '\*\.apk'$/m);
  assert.doesNotMatch(runs, /mac-v|mac-app/);
});

// On GitHub's machines (#528) no disk outlives a job: what one job hands the next goes as a workflow artifact.
test('each image platform builds on its own kind of machine, and its scan evidence goes to the evidence job as an artifact', () => {
  const jobs = workflow('images.yml').jobs;
  const runners = Object.fromEntries(jobs.build.strategy.matrix.include.filter((m) => m.arch).map((m) => [m.arch, m.runner]));
  assert.deepEqual(runners, { amd64: 'ubuntu-latest', arm64: 'ubuntu-24.04-arm' });
  const text = fs.readFileSync(path.join(WORKFLOWS, 'images.yml'), 'utf8');
  assert.doesNotMatch(text, /_share|RUNNER_NAME/);
  const upload = jobs.build.steps.find((st) => /^actions\/upload-artifact@/.test(st.uses || ''));
  assert.ok(upload, 'the build uploads its scans');
  assert.equal(upload.with.name, 'security-${{ matrix.image }}-${{ matrix.arch }}-${{ github.sha }}-${{ github.run_attempt }}');
  const download = jobs.evidence.steps.find((st) => /^actions\/download-artifact@/.test(st.uses || ''));
  assert.ok(download, 'the evidence job downloads them');
  assert.equal(download.with.pattern, 'security-*-${{ github.sha }}-${{ github.run_attempt }}');
  assert.ok(jobs.build.steps.some((st) => /^actions\/cache@/.test(st.uses || '') && /trivy/.test(st.with.path)), "Trivy's database is cached");
});

// #534: a credential added by one layer and deleted by a later one is still in the image anyone can download.
test('every layer of both images is scanned for secrets before evidence, signing or publishing, and a finding stops the run', () => {
  const jobs = workflow('images.yml').jobs;
  assert.deepEqual(jobs.build.strategy.matrix.image, ['app', 'desktop']);
  const steps = jobs.build.steps;
  const scan = steps.find((st) => st.id === 'scan');
  assert.match(scan.run, /^\s*scan --scanners secret --secret-config \/secret\.yaml --exit-code 1 --format json --output \/out\/secrets\.json \|\| PASSED=false$/m);
  assert.match(scan.run, /-v "\$PWD\/deploy\/trivy-secret\.yaml:\/secret\.yaml:ro"/);
  assert.ok(scan.run.indexOf('[ "$PASSED" = true ]') < scan.run.indexOf('release-input.json'), 'no release record after a finding');
  const fixture = steps.findIndex((st) => st.run === 'sh deploy/test-layer-secret-scan.sh');
  assert.ok(fixture >= 0 && fixture < steps.indexOf(scan), 'the scanner is shown to catch a deleted lower layer first');
  const findings = steps.find((st) => /node deploy\/layer-secrets\.js security-artifacts\/secrets\.json/.test(st.run || ''));
  assert.match(findings.if, /always\(\)/, 'the log names the layer and file when the scan fails');
  assert.ok([].concat(jobs.evidence.needs).includes('build'));
});

// A Mac runs only the desktop app's Tauri builds (ADR 137), never the stopped native Mac app.
test("the Android release builds on GitHub's machines, and no workflow builds or tests the Mac app (ADR 031)", () => {
  assert.equal(workflow('android.yml').jobs.build['runs-on'], 'ubuntu-latest');
  const tests = workflow('tests.yml').jobs;
  assert.equal(tests.mac, undefined);
  assert.equal(tests.changes.outputs.mac, undefined);
  for (const name of fs.readdirSync(WORKFLOWS)) {
    const text = fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');
    assert.doesNotMatch(text, /make mac-|runs-on: macos|xcodebuild|swift (build|test)|working-directory: macos/, name);
    if (name !== 'desktop.yml') assert.doesNotMatch(text, /\bmacos-(latest|\d)/, name);
  }
});

// #306: Claude Code is bumped by hand in the Dockerfile; no workflow opens bump pull requests.
test('no workflow bumps Claude Code', () => {
  assert.ok(!fs.existsSync(path.join(WORKFLOWS, 'claude-code-bump.yml')));
  for (const name of fs.readdirSync(WORKFLOWS)) {
    assert.doesNotMatch(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'), /dist-tags\.latest|bump\/claude-code/, name);
  }
});

// Build all: one click starts the three release workflows as runs by hand, so each keeps its version, tests and
// publishing; it holds no secret and never builds anything itself.
test('Build all starts the Android, image and desktop releases as their own runs and follows them', () => {
  const wf = workflow('build-all.yml');
  assert.deepEqual(Object.keys(wf.on), ['workflow_dispatch']);
  assert.doesNotMatch(JSON.stringify(wf), /secrets\.|environment/);
  const runs = (job) => wf.jobs[job].steps.map((st) => st.run || '').join('\n');
  assert.match(runs('android'), /build-all\.sh start android\.yml/);
  assert.match(runs('desktop'), /build-all\.sh start desktop-release\.yml/);
  assert.equal(wf.jobs.images.needs, 'android', 'the image carries the newest released app');
  assert.match(wf.jobs.images.if, /!cancelled\(\)/, 'the images are built when Android fails');
  assert.match(runs('images'), /build-all\.sh find images\.yml/, 'it follows the build the Android run started');
  assert.equal(wf.jobs.desktop.needs, undefined, 'the desktop app builds beside them');
  for (const job of Object.values(wf.jobs)) assert.match(job.if, /github\.ref == 'refs\/heads\/main'/);
  // What it relies on: a run of Android by hand starts the image build itself.
  const step = workflow('android.yml').jobs.publish.steps.find((st) => /gh workflow run images\.yml/.test(st.run || ''));
  assert.equal(step.if, "github.event_name == 'workflow_dispatch'");
});

test('build-all.sh finds the run it started and fails when it failed', () => {
  const { execFileSync, spawnSync } = require('child_process');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-all-'));
  const log = path.join(dir, 'log');
  // A fake gh: a run list answers the run once it was started; a run view says how it ended.
  fs.writeFileSync(path.join(dir, 'gh'), [
    '#!/usr/bin/env bash',
    `echo "$*" >> ${JSON.stringify(log)}`,
    'case "$1 $2" in',
    `  "workflow run") touch ${JSON.stringify(path.join(dir, 'started'))} ;;`,
    `  "run list") [ -e ${JSON.stringify(path.join(dir, 'started'))} ] && echo 42 ;;`,
    '  "run view") [ "$3" = 42 ] && echo "completed success" || echo "completed failure" ;;',
    'esac',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  const script = path.join(__dirname, '..', 'deploy', 'build-all.sh');
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', BUILD_ALL_POLL: '0', BUILD_ALL_TRIES: '3', GITHUB_STEP_SUMMARY: path.join(dir, 'summary') };
  assert.equal(execFileSync(script, ['find', 'images.yml', '2026-01-01T00:00:00Z'], { env, encoding: 'utf8' }), '');
  assert.equal(execFileSync(script, ['start', 'android.yml'], { env, encoding: 'utf8' }).trim(), '42');
  assert.match(fs.readFileSync(log, 'utf8'), /^workflow run android\.yml --repo o\/r --ref main$/m);
  execFileSync(script, ['wait', '42', 'Android'], { env, stdio: 'pipe' });
  assert.equal(spawnSync(script, ['wait', '7', 'Images'], { env }).status, 1, 'a failed run fails the job');
  assert.equal(spawnSync(script, ['wait', '', 'Desktop'], { env }).status, 1, 'no run fails the job');
  assert.equal(fs.readFileSync(path.join(dir, 'summary'), 'utf8'),
    '- Android: [success](https://github.com/o/r/actions/runs/42)\n- Images: [failure](https://github.com/o/r/actions/runs/7)\n');
  fs.rmSync(dir, { recursive: true, force: true });
});
