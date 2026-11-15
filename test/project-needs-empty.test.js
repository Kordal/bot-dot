const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// 2026-11-15: a project's overview showed "Needs you" with only a Review button while nothing waited, and a bot's
// question waiting for the owner stood under Blockers instead of in Needs you.
test('web: Needs you on the overview holds the cards and the questions, and is gone when nothing waits', () => {
  const home = read('public', 'company-home.js');
  const body = home.slice(home.indexOf('function overviewHome('), home.indexOf('function teamHome('));
  assert.match(body, /\$\{items\.length \|\| questions\.length \? `<section class="po-section"><h2>\$\{tr\('Needs you'\)\}<\/h2>\$\{ProjectOverview\.rows\(questions\)\}\$\{needsHTML\(c, items\)\}<\/section>` : ''\}/);
  assert.ok(body.indexOf('ProjectOverview.html(c)') < body.indexOf('ProjectOverview.questions(c)')); // the snapshot is asked for first
  const po = read('public', 'project-overview.js');
  assert.match(po, /rows\(d\.blockers\.filter\(\(x\) => x\.state !== 'asks'\), tr\('No failed work\.'\)\)/); // not shown twice
  assert.match(po, /const questions = \(c\) => \(stateOf\(c\.id\)\.data\?\.blockers \|\| \[\]\)\.filter\(\(x\) => x\.state === 'asks'\)/);
});

test('web: the overview rows draw nothing for an empty list without an empty line', () => {
  const vm = require('node:vm');
  const ctx = { state: {}, tr: (s) => s, esc: (s) => String(s), ago: () => 'now', setInterval: () => 0, document: {}, Company: {}, Dock: {}, Files: {} };
  vm.createContext(ctx);
  vm.runInContext(`${read('public', 'project-overview.js')}\nthis.ProjectOverview = ProjectOverview;`, ctx);
  const PO = ctx.ProjectOverview;
  assert.equal(PO.rows([]), '');
  assert.match(PO.rows([], 'Empty.'), /po-empty/);
  assert.match(PO.rows([{ botId: 'b1', name: 'Issue Reviewer', state: 'asks', text: 'Go ahead?', at: 'x' }]), /data-po-bot="b1"[\s\S]*Go ahead\?/);
  assert.equal(PO.questions({ id: 'none' }).length, 0);
});

test('Android: Needs you on the overview holds the cards and the questions, and is gone when nothing waits', () => {
  const dir = ['android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app', 'ui'];
  const home = read(...dir, 'CompanyHome.kt');
  assert.match(home, /if \(here\.isNotEmpty\(\) \|\| chiefAsks\.isNotEmpty\(\) \|\| questions\.isNotEmpty\(\)\) \{\n\s+Text\(tr\("Needs you"\)/);
  assert.doesNotMatch(home, /SmallButton\(tr\("Review"\), onClick = ways\.onNeeds\)/);
  const po = read(...dir, 'ProjectOverview.kt');
  assert.match(po, /val \(questions, blockers\) = snapshot\?\.blockers\.orEmpty\(\)\.partition \{ it\.state == "asks" \}/);
  assert.match(po, /OverviewRows\(blockers, ::open, tr\("No failed work\."\)\)/);
});

test('web: a waiting question comes out of Blockers into the questions Needs you shows, once', async () => {
  const vm = require('node:vm');
  const snapshot = { projectId: 'p1', at: 'x', work: [], replies: [], blockers: [
    { id: 'r1', botId: 'b1', name: 'Issue Reviewer', state: 'asks', text: 'Go ahead with the fix?', at: 'x' },
    { id: 'r2', botId: 'b2', name: 'Coder', state: 'failed', text: 'Build broke', at: 'x' },
  ] };
  const ctx = { state: { company: null }, tr: (s) => s, esc: (s) => String(s), ago: () => 'now', setInterval: () => 0, document: {}, Company: { place: () => '' }, Dock: { docked: () => false }, Files: {},
    api: (p) => Promise.resolve(p.startsWith('/company/overview') ? snapshot : { files: [] }) };
  vm.createContext(ctx);
  vm.runInContext(`${read('public', 'project-overview.js')}\nthis.ProjectOverview = ProjectOverview;`, ctx);
  const PO = ctx.ProjectOverview;
  const c = { id: 'p1', goal: '' };
  PO.html(c);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(PO.questions(c).map((x) => x.id), ['r1']);
  const html = PO.html(c);
  const blockers = html.slice(html.indexOf('<h2>Blockers</h2>'), html.indexOf('<h2>Latest replies</h2>'));
  assert.match(blockers, /Build broke/);
  assert.doesNotMatch(blockers, /Go ahead with the fix\?/); // not under Blockers too
  assert.equal(html.split('Go ahead with the fix?').length - 1, 0); // the overview itself does not draw it: Needs you does
});
