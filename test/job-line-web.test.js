// A job's line and pill, and a Board tile that asks a busy bot, on the web page (BUSY-005): the page's own code
// cut out of public/app.js and run against stand-ins. Under a job the page draws the server's `last.text` when
// it sends one ("The contract" of BUSY-004), else its own line; the pill says `did not run` or `failed <n>
// times`; an open jobs panel takes a job's new `last` without wiping what is typed in it, and "Saved." does not
// stay where the line was. The look is walked in test/browser/message-waits.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, words } = require('./web-page');

const css = read('style.css');
const lib = vm.createContext({ ...words });
vm.runInContext(read('unread.js'), lib);
vm.runInContext(read('opening-line.js'), lib);
const BOT = { id: 'doctor', name: 'Fleet Doctor' };
const job = (more = {}) => ({ id: 'j1', name: 'Disk check', kind: 'ai', cron: '0 * * * *', when: 'every hour', approved: true, enabled: true, nextRunAt: '2026-10-06T15:00:00.000Z', createdBy: 'you', ...more });
const FAILED = 'Last run at 14:00: failed, 5 times in a row since 02:00. Something went wrong and I couldn\'t finish. It said: “df: /mnt/backup: No such file”.';

// A job's card as jobCardHTML draws it: its pill before the switch, its line, and the fields a save reads.
function card(j) {
  const summary = { pill: null };
  const line = element({}, { textContent: '', classes: ['faint', 'grow', 'job-last'] });
  const field = (value = '') => element({}, { value, checked: true });
  const fields = { jobName: field(j.name), jobKind: field(j.kind), jobCron: field(j.cron), jobPrompt: field('Check the disks.'), jobScript: field(''), jobAiWhen: field('output'), jobTimeout: field('300'), jobWhen: field(j.cron) };
  const sw = element({ input: element({}, { checked: true }) }, { insertAdjacentHTML(where, html) { assert.equal(where, 'beforebegin'); summary.pill = html; } });
  const parts = { '.job-last': line, '.switch': sw, '.job-cron': element({}, { classes: ['hidden'] }), '.job-title': element(), '.job-when': element(), '.cron-preview': element(),
    '[data-remove-job]': element(), '[data-run-job]': element() };
  const el = element({}, { dataset: { job: j.id } });
  el.querySelector = (sel) => {
    const name = (sel.match(/^\[name=(\w+)\]$/) || [])[1];
    if (name) return fields[name];
    if (sel === 'summary .pill') return summary.pill === null ? null : { remove() { summary.pill = null; } };
    return parts[sel] || null;
  };
  return { el, line, fields, pill: () => summary.pill, warns: () => line.classList.contains('warn') };
}

// The page's functions for a job, with a clock that is moved by hand: no test waits.
function page({ reply = async () => ({}) } = {}) {
  const timers = [];
  const state = { bots: [{ ...BOT, jobs: [] }], botId: BOT.id };
  const said = { calls: [], toasts: [], refreshed: 0 };
  const ctx = vm.createContext({ ...words,
    esc, OpeningLine: lib.OpeningLine, state, Date,
    $: (sel, root) => root.querySelector(sel), $$: (sel, root) => root.querySelectorAll(sel),
    botById: (id) => state.bots.find((b) => b.id === id),
    shortTime: () => '15:00', ago: () => '20m ago', fmtTime: (t) => t, CRON_PRESETS: [],
    api: async (path, opts = {}) => { said.calls.push(`${opts.method || 'GET'} ${path}`); return reply(path, opts); },
    toast: (...a) => said.toasts.push(a), refresh: async () => { said.refreshed++; }, confirm: () => true,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
  });
  vm.runInContext(`${cut('const BY_WHO = ', 'function jobCardHTML(j, open = false) {')}
    ${cut('// A change that waits beside an approved job or tile', 'function pendingJobs() {')}
    ${cut('// The line of a change\'s card', 'const kindWords')}
    ${cut('const readJob = ', '// A script job\'s run in the chat')}
    Object.assign(this, { jobStatus, jobLastText, jobFootText, jobWarns, drawJobLine, jobLineSig, wireJobCard });`, ctx);
  // Let the time pass: every timer of at most `ms`, once.
  const pass = async (ms) => { for (const t of timers.splice(0)) { if (t.fn && t.ms <= ms) await t.fn(); else if (t.fn) timers.push(t); } };
  return { ctx, state, said, pass, timers };
}
const P = page();

test('web: under a job the page draws the server\'s line when it sends one', () => {
  const { jobLastText, jobFootText } = P.ctx;
  assert.equal(jobLastText(job({ last: { status: 'error', at: '2026-10-06T14:00:00.000Z', failures: 5, since: '2026-10-06T02:00:00.000Z', text: FAILED } })), FAILED);
  assert.equal(jobLastText(job({ last: { status: 'missed', at: '2026-10-06T08:00:00.000Z', text: 'Did not run at 08:00: botdot was off.' } })), 'Did not run at 08:00: botdot was off.');
  assert.equal(jobLastText(job({ last: { status: 'held', at: 'x', text: '  Last run at 02:00: held till morning.  ' } })), 'Last run at 02:00: held till morning.');
  assert.equal(jobFootText(job({ createdBy: 'chief', last: { status: 'success', text: 'Last run at 14:00: done.' } })), 'Last run at 14:00: done. Set up by the Chief.', 'who set it up follows the line, as before');
});

test('web: without the server\'s line the page says its own, as before', () => {
  const { jobLastText } = P.ctx;
  assert.equal(jobLastText(job()), 'Not run yet.');
  assert.equal(jobLastText(job({ last: { status: 'error', at: 'x' } })), 'Last run 20m ago: failed.');
  assert.equal(jobLastText(job({ last: { status: 'quiet', at: 'x' } })), 'Last run 20m ago: nothing to report.');
  assert.equal(jobLastText(job({ last: { status: 'held', at: 'x' } })), 'Last run 20m ago: held till morning.');
  for (const none of ['', '   ', null, 5, {}, ['x']]) assert.equal(jobLastText(job({ last: { status: 'success', at: 'x', text: none } })), 'Last run 20m ago: done.', JSON.stringify(none));
  assert.equal(jobLastText(job({ last: { status: 'missed', at: 'x' } })), 'Did not run.', 'never "Last run": it did not run');
});

test('web: the pill: "did not run" in the warning colour, "failed <n> times" for more than one, else as before', () => {
  const { jobStatus } = P.ctx;
  assert.equal(jobStatus(job({ last: { status: 'missed' } })), '<span class="pill warn">did not run</span>');
  assert.equal(jobStatus(job({ last: { status: 'error', failures: 5 } })), '<span class="pill err">failed 5 times</span>');
  assert.equal(jobStatus(job({ last: { status: 'error', failures: 2 } })), '<span class="pill err">failed 2 times</span>');
  for (const failures of [1, 0, undefined, null, '5', 2.5, '<b>']) assert.equal(jobStatus(job({ last: { status: 'error', failures } })), '<span class="pill err">last run failed</span>', String(failures));
  assert.equal(jobStatus(job({ last: { status: 'success' } })), '<span class="pill">next 15:00</span>');
  assert.equal(jobStatus(job({ last: { status: 'success', failures: 4 } })), '<span class="pill">next 15:00</span>', 'the count is of a failure that still stands');
  // What the owner has to do, or did, comes first.
  assert.equal(jobStatus(job({ approved: false, last: { status: 'missed' } })), '<span class="pill warn">needs your OK</span>');
  assert.equal(jobStatus(job({ enabled: false, last: { status: 'error', failures: 5 } })), '<span class="pill">paused</span>');
  assert.match(css, /\.pill\.warn \{ background: var\(--warn-soft\); color: var\(--warn-text\); \}/);
});

test('web: a job\'s card is drawn with its line, in the warning colour when it failed or did not run', () => {
  const html = cut('function jobCardHTML(j, open = false) {', 'const readJob = ');
  assert.match(html, /<span class="faint grow job-last\$\{jobWarns\(j\) \? ' warn' : ''\}">\$\{esc\(jobFootText\(j\)\)\}<\/span>/, 'the server\'s words are text, never markup');
  assert.match(html, /data-line="\$\{esc\(jobLineSig\(j\)\)\}"/);
  const { jobWarns } = P.ctx;
  for (const status of ['error', 'missed', 'stopped', 'interrupted']) assert.equal(jobWarns(job({ last: { status } })), true, status);
  for (const status of ['success', 'quiet', 'held']) assert.equal(jobWarns(job({ last: { status } })), false, status);
  assert.equal(jobWarns(job()), false);
  // A long line wraps, at phone and desktop width, and takes the row to itself before it gets narrow.
  assert.match(css, /\.job-foot \{ display: flex; align-items: center; gap: 8px; flex-wrap: wrap;/);
  assert.match(css, /\.job-foot \.job-last \{ flex-basis: 200px; line-height: 1\.45; overflow-wrap: anywhere; \}/);
  assert.match(css, /\.job-foot \.job-last\.warn \{ color: var\(--warn-text\); \}/);
  assert.match(css, /\.grow \{ flex: 1; min-width: 0; \}/);
});

test('web: an open jobs panel takes a job\'s new `last` when the feed brings one, without wiping what is being typed', () => {
  const p = page();
  const first = job({ last: { status: 'success', at: 'x', text: 'Last run at 13:00: done.' } });
  const c = card(first);
  c.el.dataset.line = p.ctx.jobLineSig(first);
  c.line.textContent = 'Last run at 13:00: done.';
  c.fields.jobPrompt.value = 'Check the disks and the back';
  const root = element({ '.job-card': [c.el] }, { dataset: { bot: BOT.id }, innerHTML: '<the panel>' });
  Object.assign(p.ctx, { leaveBot() {}, botLabel: () => '', jobCardHTML: () => assert.fail('the panel is not drawn again') });
  const find = p.ctx.$;
  p.ctx.$ = (sel, r) => (sel === '#view-botjobs' ? root : find(sel, r));
  vm.runInContext(`${cut('function renderBotJobs(force = false) {', '// ---------- runs ----------')}\nthis.renderBotJobs = renderBotJobs;`, p.ctx);
  // The same again: nothing is touched.
  p.state.bots[0].jobs = [first];
  p.ctx.renderBotJobs();
  assert.equal(c.pill(), null, 'the pill it was drawn with stays');
  assert.equal(c.line.textContent, 'Last run at 13:00: done.');
  // The feed brought a run that failed again: the refresh has the job's new `last`.
  p.state.bots[0].jobs = [job({ last: { status: 'error', at: 'x', failures: 5, text: FAILED } })];
  p.ctx.renderBotJobs();
  assert.equal(c.line.textContent, FAILED);
  assert.equal(c.warns(), true);
  assert.equal(c.pill(), '<span class="pill err">failed 5 times</span>');
  assert.equal(root.innerHTML, '<the panel>', 'the panel itself is not drawn again');
  assert.equal(c.fields.jobPrompt.value, 'Check the disks and the back', 'what is being typed stays');
  // It did not run; then it ran well again.
  p.state.bots[0].jobs = [job({ last: { status: 'missed', at: 'x', text: 'Did not run at 15:00: Claude was signed out.' } })];
  p.ctx.renderBotJobs();
  assert.equal(c.pill(), '<span class="pill warn">did not run</span>');
  assert.equal(c.line.textContent, 'Did not run at 15:00: Claude was signed out.');
  p.state.bots[0].jobs = [job({ last: { status: 'success', at: 'x', text: 'Last run at 16:00: done.' } })];
  p.ctx.renderBotJobs();
  assert.equal(c.warns(), false);
  assert.equal(c.pill(), '<span class="pill">next 15:00</span>');
  // A job that is gone from the list leaves its card to the panel's own redraw.
  p.state.bots[0].jobs = [];
  p.ctx.renderBotJobs();
  assert.equal(c.line.textContent, 'Last run at 16:00: done.');
});

test('web: saving a job says "Saved." for a moment; then the line is the job\'s again', async () => {
  const failed = job({ last: { status: 'error', at: 'x', failures: 5, text: FAILED } });
  const p = page({ reply: async () => failed });
  p.state.bots[0].jobs = [failed];
  const c = card(failed);
  c.line.textContent = FAILED;
  c.line.classList.add('warn');
  p.ctx.wireJobCard(c.el, p.state.bots[0]);
  c.fields.jobPrompt.value = 'Check the disks, and the backup disk too.';
  c.el.listeners.change[0]({ target: { name: 'jobPrompt' } });
  await p.pass(300); // the moment after the last change
  assert.deepEqual(p.said.calls, ['PUT /bots/doctor/jobs/j1']);
  assert.equal(c.line.textContent, 'Saved.');
  assert.equal(c.warns(), false, '"Saved." is no warning');
  assert.equal(p.said.refreshed, 1);
  // The refresh that follows the save brings nothing new about the job: "Saved." is not wiped at once.
  p.ctx.drawJobLine(c.el, failed);
  assert.equal(c.line.textContent, 'Saved.');
  // A moment later the line is the job's again, with why it failed.
  await p.pass(2500);
  assert.equal(c.line.textContent, FAILED);
  assert.equal(c.warns(), true);
  assert.equal(c.pill(), '<span class="pill err">failed 5 times</span>');
  assert.equal(p.timers.length, 0, 'no timer is left running');
});

test('web: a job that runs while "Saved." stands takes its new line at once', async () => {
  const before = job({ last: { status: 'success', at: 'x', text: 'Last run at 13:00: done.' } });
  const p = page({ reply: async () => ({ ...before, approved: false }) });
  p.state.bots[0].jobs = [before];
  const c = card(before);
  p.ctx.wireJobCard(c.el, p.state.bots[0]);
  c.fields.jobPrompt.value = 'Changed.';
  c.el.listeners.change[0]({ target: { name: 'jobPrompt' } });
  await p.pass(300);
  assert.equal(c.line.textContent, 'Saved. It waits for your OK again.');
  const after = job({ approved: false, last: { status: 'missed', at: 'x', text: 'Did not run at 14:00: Fleet Doctor had 10 things waiting.' } });
  p.ctx.drawJobLine(c.el, after);
  assert.equal(c.line.textContent, 'Did not run at 14:00: Fleet Doctor had 10 things waiting.');
});

test('web: "Run now" says the server\'s reason when the job did not start', async () => {
  const answers = [{ skipped: 'Its script is still running.' }, { queued: true }, { started: 'ai' }];
  const p = page({ reply: async () => answers.shift() });
  const c = card(job());
  p.ctx.wireJobCard(c.el, p.state.bots[0]);
  const run = c.el.querySelector('[data-run-job]');
  await run.onclick();
  await run.onclick();
  await run.onclick();
  assert.deepEqual(p.said.toasts.map((t) => t[0]), ['Its script is still running.', 'It will run as soon as the bot is free', 'Started']);
});

// The Board's tapTile, with the tiles it redraws.
function board(reply) {
  const tile = { id: 't1', bot: 'doctor', title: 'Disk check', asks: true, look: { tap: 'act', dot: { filled: true } } };
  const state = { dash: { tiles: [tile] } };
  const draws = [];
  const timers = [];
  const ctx = vm.createContext({
    ...words, state, tapped: new Map(), popped: new Set(), botById: (id) => (id === 'doctor' ? BOT : null),
    renderDashboard: () => draws.push(ctx.tapped.get('t1') ?? null), setTimeout: (fn) => timers.push(fn), openTilePanel() {}, setView() {}, loadDash() {},
    toast: () => assert.fail('no toast'), api: async () => reply(),
  });
  vm.runInContext(`${cut('const tileWaits = ', '// ---------- login requests')}\nthis.tapTile = tapTile;`, ctx);
  return { ctx, state, tile, draws, timers };
}

test('web: a Board tile that asks a busy bot says "<Bot> will do it when it is free"', async () => {
  const b = board(async () => ({ runId: 'q1', queued: true }));
  await b.ctx.tapTile(b.tile);
  assert.equal(b.draws[0], 'Asked Fleet Doctor', 'at the tap, before botdot answered');
  assert.equal(b.ctx.tapped.get('t1'), 'Fleet Doctor will do it when it is free');
  assert.equal(b.draws[b.draws.length - 1], 'Fleet Doctor will do it when it is free');
  assert.equal(b.state.dash.tiles[0].runId, 'q1');
  assert.equal('queued' in b.state.dash.tiles[0], false, 'the answer\'s word is no part of the tile');
  // The note goes after its moment, as "Asked" does.
  b.timers.forEach((fn) => fn());
  assert.equal(b.ctx.tapped.has('t1'), false);
  assert.match(cut('function tileHTML(t, waiting, sourced = false) {', 'function renderDashboard() {'), /const note = waiting \? tr\('Waiting for your OK'\) : tapped\.get\(t\.id\)/, 'drawn as the tile\'s line, as text');
});

test('web: a tile whose bot was free says "Asked <Bot>", as before; a bot the page does not know is "Its bot"', async () => {
  const free = board(async () => ({ runId: 'r7' }));
  await free.ctx.tapTile(free.tile);
  assert.deepEqual(free.draws, ['Asked Fleet Doctor', 'Asked Fleet Doctor']);
  for (const not of [false, 'true', 1, null]) {
    const b = board(async () => ({ runId: 'r7', queued: not }));
    await b.ctx.tapTile(b.tile);
    assert.equal(b.ctx.tapped.get('t1'), 'Asked Fleet Doctor', `only the server's true: ${JSON.stringify(not)}`);
  }
  const gone = board(async () => ({ runId: 'q1', queued: true }));
  gone.tile.bot = 'gone';
  await gone.ctx.tapTile(gone.tile);
  assert.equal(gone.ctx.tapped.get('t1'), 'Its bot will do it when it is free');
});
