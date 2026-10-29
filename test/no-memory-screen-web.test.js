// Memory has no screen on the web page (MEM-007; docs/api.md, Memory, "The contract" and "What a run learned"):
// the page's own code, cut out of public/app.js and run against stand-ins (test/web-page.js, test/need-cards.js),
// with what a botdot server of Milestone 9 sends. The chip under a reply and the card of a waiting change read
// the server's words; a guarded change is answered by itself; the Memory sections and the Settings card are gone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc } = require('./web-page');
const { page, plain, titleOf, metaOf, buttonsOf, CODER, NEWS, BAD } = require('./need-cards');

const css = read('style.css');
const said = (v) => (typeof v === 'string' ? v.trim() : '');

// ---------- the chip ----------

const opened = [];
const chips = vm.createContext({ esc, said, state: {}, setView: (view, id) => opened.push([view, id, chips.state.openSkill]) });
vm.runInContext(`${cut('const LEARN_ICON = {', '// ---------- model & reasoning')}\nthis.page = { learnedChips, learnedOpens, openLearned };`, chips);
const { learnedChips, learnedOpens, openLearned } = chips.page;
// The chips of a run, in order: [what it is drawn as, the kind it opens something for or null, its line].
const chipsOf = (learned) => [...learnedChips({ learned }).matchAll(/<(button|span) class="action-chip[^"]*"(?: data-learned="([^"]*)")?[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => [m[1], m[2] ?? null, m[3]]);

test('web: a skill\'s chip carries its skill, for the settings to open on it (#619)', () => {
  const html = learnedChips({ learned: [
    { kind: 'skill-updated', chip: 'Changed the skill buildr-pr-workflow', skill: 'buildr-pr-workflow' },
    { kind: 'skill', chip: 'Saved the skill "x"', skill: '"><img>' },
    { kind: 'job', chip: 'Added job Morning news' },
  ] });
  assert.match(html, /data-learned="skill-updated" data-skill="buildr-pr-workflow">/);
  assert.ok(!html.includes('<img'));
  assert.equal((html.match(/data-skill=/g) || []).length, 2);
});

test('web: a chip prints the server\'s `chip`, whole, and no word of the page\'s own', () => {
  const long = `Created skill review-drafts: ${'Pull requests are opened as drafts. '.repeat(4).trim()}`;
  const learned = [
    { kind: 'skill', text: long, chip: long },
    { kind: 'skill-updated', text: 'Updated skill review-drafts', chip: 'Updated skill review-drafts' },
    { kind: 'memory-pending', text: 'Asked to forget for good: 1 note and 2 chats (waiting for your OK)', chip: 'Asked to forget for good: 1 note and 2 chats (waiting for your OK)' },
  ];
  assert.deepEqual(chipsOf(learned).map(([, , line]) => line), [
    `✦ ${long}`,
    '✦ Updated skill review-drafts',
    '⏳ Asked to forget for good: 1 note and 2 chats (waiting for your OK)',
  ], 'the line is the chip: not cut');
});

test('web: an item without `chip` is drawn from its `text`, and one with neither is no chip', () => {
  assert.deepEqual(chipsOf([
    { kind: 'job', text: 'Added job Morning news' },
    { kind: 'memory-pending', text: 'Asked to add to the shared memory: Lives in Ghent' },
    { kind: 'connector', text: '  ', chip: '' },
    { kind: 'connector' },
  ]), [['button', 'job', '⏰ Added job Morning news'], ['span', null, '⏳ Asked to add to the shared memory: Lives in Ghent']]);
  assert.equal(learnedChips({ learned: [{ kind: 'job', chip: ' ' }] }), '');
  assert.equal(learnedChips({}), '');
  // A run whose memory changes were all done: the server sends it none (ADR 024), and there is no row.
  assert.equal(learnedChips({ learned: [] }), '');
});

test('web: a chip is text, never markup', () => {
  const html = learnedChips({ learned: [{ kind: BAD, chip: BAD }, { kind: 'job', text: BAD }] });
  assert.ok(!html.includes('<img') && !html.includes('<script'));
  assert.ok(html.includes(esc(BAD)));
});

test('web: a memory chip opens nothing; the chips for jobs, skills and instructions open what they opened', () => {
  const drawn = Object.fromEntries(['memory', 'memory-shared', 'memory-pending', 'memory-pin', 'memory-removed', 'memory-restored', 'forgot', 'job', 'instructions', 'skill', 'skill-updated', 'skill-pending', 'connector', 'new-kind']
    .map((kind) => [kind, chipsOf([{ kind, chip: 'A line', text: 'A line' }])[0].slice(0, 2)]));
  assert.deepEqual(drawn, {
    memory: ['span', null], 'memory-shared': ['span', null], 'memory-pending': ['span', null], 'memory-pin': ['span', null], 'memory-removed': ['span', null], 'memory-restored': ['span', null], forgot: ['span', null],
    job: ['button', 'job'], instructions: ['button', 'instructions'], skill: ['button', 'skill'], 'skill-updated': ['button', 'skill-updated'], 'skill-pending': ['button', 'skill-pending'], connector: ['button', 'connector'],
    'new-kind': ['span', null], // a kind the page does not know opens nothing
  });
  assert.equal(learnedOpens('job'), 'botjobs');
  for (const kind of ['instructions', 'skill', 'skill-updated', 'skill-pending', 'connector']) assert.equal(learnedOpens(kind), 'botsettings', kind);
  for (const kind of ['memory', 'memory-shared', 'forgot', undefined]) assert.equal(learnedOpens(kind), '', String(kind));
  // The click goes where learnedOpens says, and nowhere for a chip that is no button.
  assert.match(app, /\$\$\('\[data-learned\]', thread\)\.forEach\(\(el\) => \(el\.onclick = \(\) => openLearned\(el, bot\.id\)\)\);/);
  const tap = (learned, skill) => { chips.state.openSkill = undefined; opened.length = 0; openLearned({ dataset: { learned, ...(skill ? { skill } : {}) } }, 'b1'); return opened[0] ?? null; };
  assert.deepEqual(tap('job'), ['botjobs', 'b1', undefined]);
  assert.deepEqual(tap('instructions'), ['botsettings', 'b1', undefined]);
  assert.deepEqual({ ...tap('skill-updated', 'weekly')[2] }, { bot: 'b1', name: 'weekly' }, 'a skill\'s chip opens the settings on it (#619)');
  assert.deepEqual({ ...tap('skill')[2] }, { bot: 'b1', name: '' }, 'with no name, on the Skills');
  assert.equal(tap('memory'), null);
  assert.match(css, /\.action-chip\.said, \.action-chip\.said:hover \{ cursor: default;/, 'a chip that opens nothing does not look like a button');
});

// ---------- the card ----------

// Waiting changes as GET /api/memory/pending?guarded=1 lists them, with the server's words (lib/learning.js).
const AT = '2026-10-07T10:12:00.000Z';
const SHARED = { id: 'm1', action: 'add', owner: '_shared', text: 'The owner flies from Brussels.', at: AT, bot: NEWS, botId: 'news', current: null, title: 'Add to the shared memory', meta: 'after reading outside content', yes: 'Approve', no: 'Decline' };
const SHARED2 = { ...SHARED, id: 'm2', text: 'The owner reads Polish.' };
const SHARED_EDIT = { ...SHARED, id: 'm3', action: 'edit', text: 'The owner flies from Antwerp.', current: { text: 'The owner flies from Brussels.' }, title: 'Change in the shared memory', meta: 'from its memory review' };
const SHARED_REMOVE = { ...SHARED, id: 'm4', action: 'remove', text: '', current: { text: 'The owner flies from Brussels.' }, title: 'Remove from the shared memory' };
const GUARDED_EDIT = { id: 'g1', action: 'edit', owner: 'coder', text: 'Package manager: npm', current: { text: 'Package manager: pnpm for JavaScript' }, at: AT, bot: CODER, botId: 'coder', guarded: true, title: 'Change what you said', meta: 'in a run you did not start', yes: 'Change it', no: 'Keep it' };
const GUARDED_REMOVE = { ...GUARDED_EDIT, id: 'g2', action: 'remove', text: '', title: 'Remove what you said', yes: 'Remove it' };
const FORGET = { id: 'g3', action: 'erase', owner: 'coder', noteId: 'n1', text: 'Deploy key lives in the Vault login “GitHub deploy”. · 2 chats', notes: [{ id: 'n1', text: 'Deploy key lives in the Vault login “GitHub deploy”.' }], runs: [{ runId: 'r1' }, { runId: 'r2' }], at: AT, bot: CODER, botId: 'coder', guarded: true, title: 'Forget for good', meta: 'after reading outside content', yes: 'Forget for good', no: 'Keep' };
const ALL = [SHARED, SHARED_EDIT, SHARED_REMOVE, GUARDED_EDIT, GUARDED_REMOVE, FORGET];
// The texts of a card's body, in order: [struck, the text]. A change is one block that holds both.
const bodiesOf = (html) => html.split('<div class="need-body').slice(1).flatMap((block) => [...block.matchAll(/<div class="nb( faint-strike)?">([\s\S]*?)<\/div>/g)].map((m) => [!!m[1], m[2]]));
const blocksOf = (html) => html.split('<div class="need-body').length - 1;
const withoutTime = (meta) => meta.split(' · ').slice(1).join(' · ');

test('web: the card of a waiting memory change prints the server\'s title, why it waits and both buttons', () => {
  const p = page({ state: { memPending: ALL, bots: [CODER, NEWS] } });
  const drawn = ALL.map((m) => { const html = p.needCardHTML(p.item(`mem:${m.id}`)); return [titleOf(html), withoutTime(metaOf(html)), buttonsOf(html), bodiesOf(html)]; });
  assert.deepEqual(drawn, [
    ['Add to the shared memory', 'after reading outside content', ['Decline', 'Approve'], [[false, 'The owner flies from Brussels.']]],
    ['Change in the shared memory', 'from its memory review', ['Decline', 'Approve'], [[true, 'The owner flies from Brussels.'], [false, 'The owner flies from Antwerp.']]],
    ['Remove from the shared memory', 'after reading outside content', ['Decline', 'Approve'], [[false, 'The owner flies from Brussels.']]],
    ['Change what you said', 'in a run you did not start', ['Keep it', 'Change it'], [[true, 'Package manager: pnpm for JavaScript'], [false, 'Package manager: npm']]],
    ['Remove what you said', 'in a run you did not start', ['Keep it', 'Remove it'], [[false, 'Package manager: pnpm for JavaScript']]],
    ['Forget for good', 'after reading outside content', ['Keep', 'Forget for good'], [[false, 'Deploy key lives in the Vault login “GitHub deploy”. · 2 chats']]],
  ]);
  // A change is one block, what goes above what comes: a closed card shows its first block only (style.css), and
  // so the start of both. Nothing a yes would save is behind a click.
  for (const m of ALL) assert.equal(blocksOf(p.needCardHTML(p.item(`mem:${m.id}`))), 1, m.id);
  assert.ok(p.needCardHTML(p.item('mem:g1')).includes('<div class="need-body need-change"><div class="nb faint-strike">Package manager: pnpm for JavaScript</div><div class="nb">Package manager: npm</div></div>'));
  assert.match(css, /\.need-card:not\(\.open\) \.need-body ~ \.need-body, \.need-card:not\(\.open\) \.job-why \{ display: none; \}/);
  // Each is a card of its own, with its bot, on the Needs you page and at the end of that bot's chat.
  assert.deepEqual(plain(p.needsItems().map((x) => [x.key, x.bot.id])), [['mem:m1', 'news'], ['mem:m3', 'news'], ['mem:m4', 'news'], ['mem:g1', 'coder'], ['mem:g2', 'coder'], ['mem:g3', 'coder']]);
  assert.deepEqual(plain(p.chatNeeds('coder').map((x) => x.key)), ['mem:g1', 'mem:g2', 'mem:g3']);
  assert.deepEqual(plain(p.chatNeeds('chief').map((x) => x.key)), []);
  // The page holds none of those words.
  const card = cut("  if (x.kind === 'memory') {\n    const p = x.p;", "  if (x.kind === 'ask' && x.a.kind === 'permission')");
  for (const own of [/shared memory/, /outside content/, /Approve/, /Decline/, /Forget/, /Keep/]) assert.doesNotMatch(card, own);
  for (const own of [/the shared memory`/, /Shared memory changes/, /wants to \$\{verb\}/]) assert.doesNotMatch(app, own);
});

test('web: the words of a memory card are text, never markup', () => {
  const p = page({ state: { memPending: [{ ...GUARDED_EDIT, title: BAD, meta: BAD, yes: BAD, no: BAD, text: BAD, reason: BAD, current: { text: BAD } }] } });
  const html = p.needCardHTML(p.item('mem:g1'));
  assert.ok(!html.includes('<img') && !html.includes('<script'));
  assert.equal(titleOf(html), esc(BAD));
});

test('web: after the answer a memory card reads the answer\'s `text`', async () => {
  const texts = { m1: ['Approved', 'Declined'], g1: ['Changed', 'Kept'], g2: ['Removed', 'Kept'], g3: ['Forgotten', 'Kept'] };
  for (const [id, [yes, no]] of Object.entries(texts)) {
    for (const approve of [true, false]) {
      const p = page({ state: { memPending: ALL }, answer: (url, body) => (body.approve ? { text: yes } : { declined: true, text: no }) });
      const card = p.show(`mem:${id}`);
      await p.decide(p.item(`mem:${id}`), approve, false);
      assert.deepEqual(plain(p.calls), [[`/memory/pending/${id}`, 'POST', { approve }]]);
      assert.equal(card.actions.innerHTML, `<span class="muted">${approve ? yes : no}</span>`, `${id} ${approve}`);
      assert.ok(card.classList.contains('done'));
    }
  }
  assert.equal(page().answeredWord({ kind: 'memory', p: FORGET }, true, false, { text: 'Forgotten' }), 'Forgotten');
  assert.equal(page().answeredWord({ kind: 'memory', p: FORGET }, false, false, { declined: true, text: 'Kept' }), 'Kept');
});

test('web: an answer the server refuses leaves the card as it is and says why', async () => {
  const p = page({ state: { memPending: [FORGET] }, answer: () => new Error('That request is gone') });
  const card = p.show('mem:g3');
  await p.decide(p.item('mem:g3'), true, false);
  assert.deepEqual(plain(p.toasts), [['That request is gone', true]]);
  assert.ok(!card.classList.contains('done'));
});

test('web: one memory change that waits opens the Needs you page, where its card is: there is no dialog', () => {
  const openNeed = cut('function openNeed(x) {', '// Decided cards stay on the page');
  assert.doesNotMatch(openNeed, /x\.kind === 'memory'/);
  assert.match(openNeed, /return setView\('needs'\);/);
  for (const gone of [/openMemoryApprovals/, /showMemoryApprovals/, /settlePending/, /pendingItemHTML/]) assert.doesNotMatch(app, gone);
});

// ---------- guarded changes and "Approve all" ----------

test('web: the page asks for waiting memory changes with guarded=1, in the list and on the feed', () => {
  assert.match(app, /const MEMORY_WAITS = '\/memory\/pending\?guarded=1';/);
  assert.equal((app.match(/api\(MEMORY_WAITS\)/g) || []).length, 2, 'at every refresh, and after an answer');
  assert.doesNotMatch(app, /api\('\/memory\/pending'\)/);
  assert.match(app, /new EventSource\('\/api\/events\?guarded=1'\)/);
  assert.doesNotMatch(app, /new EventSource\('\/api\/events'\)/);
});

test('web: "Approve all" leaves a guarded change out, and so does its count', async () => {
  const AI = { id: 'j1', name: 'Morning news', kind: 'ai', cron: '0 8 * * *', when: 'Every day at 08:00', prompt: 'Send me the news.', approved: false, enabled: true, changedBy: 'bot', no: 'Decline and remove' };
  const p = page({ state: { bots: [{ ...CODER, jobs: [AI] }], memPending: [SHARED, SHARED2, GUARDED_EDIT, GUARDED_REMOVE, FORGET], view: 'needs' } });
  const all = p.approveAll(p.needsItems());
  assert.equal(all.label, 'Approve 3');
  assert.deepEqual(plain(all.takes.map((x) => x.key)), ['job:j1', 'mem:m1', 'mem:m2']);
  p.renderNeeds();
  assert.match(p.needsPage.innerHTML, /id="needs-all">Approve 3</);
  // The guarded ones are still cards of their own on the page.
  for (const id of ['g1', 'g2', 'g3']) assert.ok(p.needsPage.innerHTML.includes(`data-need="mem:${id}"`), id);
  for (const x of all.takes) await p.decide(x, true, false);
  assert.deepEqual(plain(p.calls.map(([url]) => url)), ['/bots/coder/jobs/j1/approve', '/memory/pending/m1', '/memory/pending/m2'], 'no guarded change is answered by the button');
});

test('web: with only guarded changes and scripts waiting there is no "Approve all"', () => {
  const SCRIPT = { id: 'j3', name: 'Disk check', kind: 'script', cron: '0 * * * *', when: 'Every hour', script: 'df -h', aiWhen: 'output', prompt: '', approved: false, enabled: true, changedBy: 'bot', no: 'Decline and remove' };
  const TILE = { id: 't1', kind: 'value', title: 'Disk', section: 'Home', bot: 'coder', approved: false, changedBy: 'chief', read: { type: 'script', script: 'df -h / | tail -1' }, scripts: ['df -h / | tail -1'], no: 'Decline and remove' };
  for (const [state, why] of [
    [{ memPending: [GUARDED_EDIT, GUARDED_REMOVE, FORGET] }, 'three guarded changes'],
    [{ memPending: [GUARDED_EDIT, FORGET], bots: [{ ...CODER, jobs: [SCRIPT, { ...SCRIPT, id: 'j4', name: 'Ping' }] }], dash: { pending: [TILE], suggestions: [] } }, 'guarded changes and scripts'],
    [{ memPending: [SHARED, GUARDED_EDIT, FORGET] }, 'one change it would approve beside two guarded ones'],
  ]) {
    const p = page({ state: { view: 'needs', bots: [CODER], ...state } });
    assert.deepEqual(plain(p.approveAll(p.needsItems())), { takes: [], label: '', line: '' }, why);
    p.renderNeeds();
    assert.doesNotMatch(p.needsPage.innerHTML, /needs-all|needs-left/, why);
  }
});

test('web: a change that becomes guarded while it waits is drawn again', () => {
  const p = page({ state: { memPending: [SHARED_EDIT], view: 'needs' } });
  p.renderNeeds();
  assert.equal(titleOf(p.needsPage.innerHTML), 'Change in the shared memory');
  p.state.memPending = [{ ...SHARED_EDIT, guarded: true, title: 'Change what you said', yes: 'Change it', no: 'Keep it' }];
  p.renderNeeds();
  assert.equal(titleOf(p.needsPage.innerHTML), 'Change what you said');
});

// ---------- a skill a bot wrote ----------

test('web: a skill a bot wrote that waits shows the server\'s line and the whole text a yes would save', async () => {
  const text = `# Weekly roundup\n\n1. Read the feeds.\n2. ${'Write one line per story. '.repeat(60)}\n3. ${BAD}`;
  const ASK = { id: 's1', kind: 'skill', botId: 'coder', bot: CODER, written: true, url: '', reason: 'It does this every Monday', text: 'Wants to keep a skill it wrote: “weekly-roundup”', skill: { name: 'weekly-roundup', description: 'The Monday roundup', files: 1, exists: false, instructions: text }, at: AT };
  const p = page({ state: { asks: [ASK], bots: [CODER] }, answer: () => ({ ok: true, skill: 'weekly-roundup' }) });
  const html = p.needCardHTML(p.item('ask:s1'));
  assert.equal(titleOf(html), 'Wants to keep a skill it wrote: “weekly-roundup”');
  assert.equal(metaOf(html), 'It does this every Monday');
  assert.ok(html.includes(`<div class="need-body"><pre class="nb">${esc(text)}</pre></div>`), 'the whole text, as text');
  assert.deepEqual(buttonsOf(html), ['Decline', 'Approve']);
  assert.doesNotMatch(html, /Install/);
  assert.deepEqual(plain(p.chatNeeds('coder').map((x) => x.key)), ['ask:s1'], 'in that bot\'s chat');
  const card = p.show('ask:s1');
  await p.decide(p.item('ask:s1'), true, false);
  assert.deepEqual(plain(p.calls), [['/asks/s1', 'POST', { yes: true, always: false }]]);
  assert.equal(card.actions.innerHTML, '<span class="muted">Approved</span>');
  // A skill from a link is drawn as it was.
  const link = page({ state: { asks: [{ id: 's2', kind: 'skill', botId: 'coder', bot: CODER, url: 'https://github.com/a/b', skill: { name: 'pdf', description: 'Reads PDFs', files: 2 }, at: AT }] } });
  assert.equal(titleOf(link.needCardHTML(link.item('ask:s2'))), 'Install the skill "pdf"?');
  assert.equal(link.answeredWord(link.item('ask:s2'), true, false, {}), 'Installed');
});

// ---------- no memory screen ----------

test('web: a bot\'s settings, the Chief\'s settings and Settings hold no Memory section and no Memory card', () => {
  const bot = cut('function renderBotSettings(', '// The bits of the settings page that follow the bot while it\'s open');
  const chief = cut('function renderChiefSettings() {', '// ---------- Needs you');
  for (const [name, part] of [['a bot\'s settings', bot], ['the Chief\'s settings and Settings', chief]]) {
    for (const gone of [/>Memory</, /mountMemory/, /bs-memory/, /chief-memory/, /mem-settings/, /Weekly review, search, past runs/, /Search its memory/, /Don't recall/]) assert.doesNotMatch(part, gone, `${name}: ${gone}`);
  }
  // The code of the screens is gone from the page: the lists, the search, add, pin, delete, restore, history,
  // "Don't recall", the review's schedule, the search model's download and how long past runs are kept.
  for (const gone of [
    /mountMemory/, /wireMemory/, /notesCardHTML/, /noteRowHTML/, /resultHTML/, /openNoteHistory/, /openBotMemory/, /loadMemorySettings/, /loadSemanticCard/, /reviewCardHTML/,
    /Recently deleted/, /Don't recall/, /Teach it something/, /Earlier versions/, /Memory review<\/h3>/, /mem-retention/, /sem-pull/,
  ]) assert.doesNotMatch(app, gone);
});

test('web: the page calls none of the owner\'s routes for notes', () => {
  for (const route of ['/memory/notes', '/memory/versions', '/memory/search', '/memory/runs', '/memory/settings', '/memory/review', '/memory/shared', '/learning/memory', "api('/memory')", '/memory/semantic/pull']) {
    assert.ok(!app.includes(route), route);
  }
  // What is left of /api/memory: the changes that wait and their answer.
  assert.deepEqual([...new Set(app.match(/\/memory\/[a-z]+/g))].sort(), ['/memory/pending']);
  // Undoing a change to a bot's instructions deletes no note with it.
  assert.doesNotMatch(app, /relatedNotes/);
});

test('web: the styles of the removed screens are gone', () => {
  for (const gone of [/\.mem-/, /\.memory-note\.(searchable|run-hit|pending-change)/, /\.memory-note \.(pin|topic)/, /\.memory-note mark/, /\.topic-input/, /\.review-line/, /Settings → Memory/]) assert.doesNotMatch(css, gone);
  // What other parts of the page still draw with stays: a struck text on a card. The history of a bot's instructions went with its learning row (#305).
  assert.match(css, /\.faint-strike \{ color: var\(--faint\); text-decoration: line-through; \}/);
  assert.doesNotMatch(css, /\.memory-(list|note)/);
  assert.doesNotMatch(app, /Settings → Memory/);
});

test('web: Setup has no row about memory: meaning-based search is the Chief\'s to set up', () => {
  assert.ok(!/Meaning-based memory search/.test(app), 'no such row in Setup');
  assert.ok(!app.includes('meaning-on'), 'and no button that switches it on');
});
