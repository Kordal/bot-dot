// Every job runs on GitHub's own throwaway machines (#528): the repository is public, and a fork's pull request
// can change a workflow, so a runner of the owner's would run anyone's code (audit S1). The image carries the
// Android app and no Mac app (ADR 022).
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
  for (const [name, job] of [['images.yml', 'publish'], ['android.yml', 'build']]) {
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

test('the image build tests the commit it builds first; a failure publishes nothing', () => {
  const jobs = workflow('images.yml').jobs;
  assert.equal(jobs.test.uses, './.github/workflows/tests.yml');
  assert.deepEqual(jobs.test.with, { android: false });
  assert.ok([].concat(jobs.build.needs).includes('test'));
  assert.equal(jobs.evidence.needs, 'build');
  assert.equal(jobs.publish.needs, 'evidence');
});

test('a nightly Android release starts no image build of its own; a run by hand starts one', () => {
  const step = workflow('android.yml').jobs.build.steps.find((st) => /gh workflow run images\.yml/.test(st.run || ''));
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
  assert.equal(jobs.evidence.needs, 'build');
});

test("the Android release builds on GitHub's machines; the Mac app is built and tested on a Mac when macos/ changes", () => {
  assert.equal(workflow('android.yml').jobs.build['runs-on'], 'ubuntu-latest');
  const tests = workflow('tests.yml').jobs;
  assert.equal(tests.mac['runs-on'], 'macos-26', 'the app and BotDotKit need macOS 26');
  assert.equal(tests.mac.if, "needs.changes.outputs.mac == 'true'");
  const runs = tests.mac.steps.map((st) => st.run || '').join('\n');
  assert.match(runs, /make mac-build/);
  assert.match(runs, /make mac-test/);
  assert.match(tests.changes.steps.map((st) => st.run || '').join('\n'), /grep -qE '\^\(macos\/\|.*then MAC=true/);
  // A release started by hand calls Tests as a workflow_dispatch too: only a run of Tests itself tests the Mac app.
  assert.equal(tests.changes.steps.find((st) => st.id === 'which').env.MAC, "${{ github.event_name == 'workflow_dispatch' && github.workflow == 'Tests' }}");
});
