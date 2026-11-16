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
  assert.ok(body.indexOf('ProjectOverview.html(c)') < body.indexOf('ProjectOverview.questions(c, items)')); // the snapshot is asked for first
  assert.ok(body.includes('ProjectOverview.questions(c, items)')); // a carded chat's question once
  const po = read('public', 'project-overview.js');
  assert.match(po, /rows\(d\.blockers\.filter\(\(x\) => x\.state !== 'asks'\), tr\('No failed work\.'\)\)/); // not shown twice
});

test('web: the overview rows draw nothing for an empty list without an empty line', () => {
  const vm = require('node:vm');
  const ctx = { botById: (id) => (id === 'b1' ? { id: 'b1', color: '#123', state: 'idle' } : undefined), botFigure: (_c, st, _s, _o, id) => `<div class="avatar" data-bot="${id || ''}" data-st="${st}"></div>`, CHIEF_COLOR: '#d85a30', Figure: { CHIEF: {} }, state: {}, tr: (s) => s, esc: (s) => String(s), mdPreview: (s) => String(s), ago: () => 'now', setInterval: () => 0, document: {}, Company: {}, Dock: {}, Files: {} };
  vm.createContext(ctx);
  vm.runInContext(`${read('public', 'project-overview.js')}\nthis.ProjectOverview = ProjectOverview;`, ctx);
  const PO = ctx.ProjectOverview;
  assert.equal(PO.rows([]), '');
  assert.match(PO.rows([], 'Empty.'), /po-empty/);
  assert.match(PO.rows([{ botId: 'b1', name: 'Issue Reviewer', state: 'asks', text: 'Go ahead?', at: 'x' }]), /data-po-bot="b1"[\s\S]*Go ahead\?/);
  assert.equal(PO.questions({ id: 'none' }).length, 0);
  // Whose each row is: the bot's head, an empty place for one the page doesn't know, the Chief's, the owner's.
  assert.match(PO.rows([{ botId: 'b1', name: 'A', state: 'working' }]), /data-bot="b1"/);
  assert.match(PO.rows([{ botId: 'gone', name: 'A', state: 'working' }]), /<span class="avatar sm" aria-hidden="true"><\/span>/);
  assert.match(PO.rows([{ groupId: 'g1', name: 'Team', state: 'asks' }]), /<span class="avatar sm" aria-hidden="true"><\/span>/);
  assert.match(PO.rows([{ chatId: 'c1', name: 'Chief', state: 'working' }]), /data-st="working"/);
  assert.match(PO.rows([{ chatId: 'c1', name: 'Chief', state: 'reply' }]), /data-st="idle"/);
  assert.match(PO.rows([{ name: '', state: 'planned', text: 'Call' }]), /cf-you/);
});

// The Android logic is tested in shared/src/commonTest (ProjectOverviewNeedsYouTest); this only checks the screen uses it.
test('Android: the overview screen uses the shared Needs you rule', () => {
  const dir = ['android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app', 'ui'];
  // Overviews.needsYou (shared) holds needsYouShows and withoutCarded; both the board and the overview page call it.
  assert.equal(read(...dir, 'CompanyHome.kt').split('Overviews.needsYou(').length - 1, 2);
  const shared = read('android', 'shared', 'src', 'commonMain', 'kotlin', 'dev', 'botdot', 'app', 'data', 'ProjectOverview.kt');
  const rule = shared.slice(shared.indexOf('fun needsYou('), shared.indexOf('fun askText('));
  assert.ok(rule.includes('ProjectOverview.needsYouShows(') && rule.includes('ProjectOverview.withoutCarded('));
  const po = read(...dir, 'ProjectOverview.kt');
  assert.ok(po.includes('questions()') && po.includes('failures()'));
  assert.ok(!read(...dir, 'CompanyHome.kt').includes('SmallButton(tr("Review"), onClick = ways.onNeeds)'));
});

test('web: a waiting question comes out of Blockers into the questions Needs you shows, once', async () => {
  const vm = require('node:vm');
  const snapshot = { projectId: 'p1', at: 'x', work: [], replies: [], blockers: [
    { id: 'r1', botId: 'b1', name: 'Issue Reviewer', state: 'asks', text: 'Go ahead with the fix?', at: 'x' },
    { id: 'r2', botId: 'b2', name: 'Coder', state: 'failed', text: 'Build broke', at: 'x' },
  ] };
  const ctx = { botById: (id) => (id === 'b1' ? { id: 'b1', color: '#123', state: 'idle' } : undefined), botFigure: (_c, st, _s, _o, id) => `<div class="avatar" data-bot="${id || ''}" data-st="${st}"></div>`, CHIEF_COLOR: '#d85a30', Figure: { CHIEF: {} }, state: { company: null }, tr: (s) => s, esc: (s) => String(s), mdPreview: (s) => String(s), ago: () => 'now', setInterval: () => 0, document: {}, Company: { place: () => '' }, Dock: { docked: () => false }, Files: {},
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
  // The Chief's question in a chat that has a card there is the card's; without the card it is drawn.
  snapshot.blockers.push({ id: 'chief', chatId: 'c1', name: 'Chief', state: 'asks', text: 'Approve the team?', at: 'x' });
  assert.deepEqual(PO.questions(c, [{ a: { chatId: 'c1' } }]).map((x) => x.id), ['r1']);
  assert.deepEqual(PO.questions(c, [{ a: { chatId: 'other' } }]).map((x) => x.id), ['r1', 'chief']);
});
