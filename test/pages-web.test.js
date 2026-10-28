// Pages on the web page (#346, public/pages.js): the chip under a reply opens the page in the viewer, its title is
// text, the viewer's bar offers "Keep up to date" or says what keeps it, and the sheet sends the server its words.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc, words } = require('./web-page');

function page({ features = ['document-viewer', 'pages'], answers = {}, fails = {} } = {}) {
  const calls = [];
  const pills = [];
  const ctx = vm.createContext({
    ...words, state: { features, bots: [{ id: 'ops', name: 'Ops' }], view: 'bot', botId: 'ops' },
    esc, encodeURIComponent, ago: () => '5m ago', chiefName: () => 'Kai', chiefTitle: () => 'Kai', toast() {}, DocViewer: { pageChanged() {} }, SUB_BACK: '',
    api: async (p, opts = {}) => { calls.push([p, opts.method || 'GET', opts.body]); if (fails[p]) throw new Error(fails[p]); return answers[p] ?? {}; },
    // The corner pill (app.js): what it said, and the retry its error offers.
    cornerPill: (kind, text, retry) => pills.push({ kind, text, retry }),
    document: { querySelector: () => null },
  });
  vm.runInContext(`${read('app.js').match(/async function inBackground[\s\S]*?\n}\n/)[0]}\n${read('pages.js')}\nthis.Pages = Pages;`, ctx);
  return { Pages: ctx.Pages, calls, pills, ctx };
}

test('web: a page chip opens the page in the viewer, and its title stays text', () => {
  const { Pages } = page();
  const html = Pages.chipsHTML({ botId: 'ops', pages: [{ slug: 'hq-health', title: 'hq <b>health</b>' }] });
  assert.match(html, /data-view="\/bots\/ops\/pages\/hq-health"/);
  assert.match(html, /data-view-page="ops\/hq-health"/);
  assert.match(html, /data-view-from="Ops"/);
  assert.match(html, /hq &lt;b&gt;health&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>health/);
  assert.equal(Pages.chipsHTML({ botId: 'ops' }), '');
  assert.equal(page({ features: ['document-viewer'] }).Pages.chipsHTML({ botId: 'ops', pages: [{ slug: 'a', title: 'A' }] }), '', 'a server without pages');
});

test("web: the viewer's header and bar on a page", () => {
  const { Pages } = page();
  assert.equal(Pages.subtitle('Ops', { updatedAt: '2026-10-22T07:00:00Z' }), 'Page by Ops · updated 5m ago');
  assert.match(Pages.barHTML({ slug: 'a', keep: null }), /data-dv="keep">.*Keep up to date/s);
  const kept = Pages.barHTML({ slug: 'a', keep: { jobId: 'j1', when: 'Daily at 07:00' } });
  assert.match(kept, /Keeps up to date · Daily at 07:00/);
  assert.match(kept, /data-dv="refresh"/);
  assert.match(kept, /data-dv="stop"/);
});

test('web: Refresh now runs its job, Stop takes the job away', async () => {
  const { Pages, calls } = page();
  const p = { slug: 'hq-health', keep: { jobId: 'j1' } };
  assert.equal(await Pages.act('refresh', 'ops', p, 'Ops'), false);
  assert.equal(await Pages.act('stop', 'ops', p, 'Ops'), true);
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['/bots/ops/jobs/j1/run', 'POST'], ['/bots/ops/pages/hq-health/keep', 'DELETE']]);
});

test('web: Refresh now and Stop say at once that they work, then how it went, and a failure offers trying again (#475)', async () => {
  const { Pages, calls, pills } = page({ fails: { '/bots/ops/pages/hq-health/keep': 'botdot is busy' } });
  const p = { slug: 'hq-health', keep: { jobId: 'j1' } };
  await Pages.act('refresh', 'ops', p, 'Ops');
  assert.deepEqual(pills.map((x) => [x.kind, x.text]), [['busy', 'Starting the refresh…'], ['ok', 'Ops is refreshing it']]);
  assert.equal(await Pages.act('stop', 'ops', p, 'Ops'), false, 'a failed Stop reads nothing again');
  assert.deepEqual(pills.slice(2).map((x) => [x.kind, x.text]), [['busy', 'Stopping…'], ['err', 'botdot is busy']]);
  await pills[3].retry();
  assert.equal(calls.filter((c) => c[1] === 'DELETE').length, 2, 'a tap on the error tries again');
});

test('web: "Keep it up to date" closes the dialog at once and saves with the pill; its error opens the dialog again with what was entered (#475)', async () => {
  const { Pages, calls, pills, ctx } = page({ fails: { '/bots/ops/pages/hq-health/keep': 'Not saved' } });
  const opened = [];
  const field = (value) => ({ value, onchange: null, classList: { toggle() {} } });
  ctx.openModal = (html) => {
    const on = {};
    const m = { html, closed: false, addEventListener: (ev, fn) => { on[ev] = fn; }, close() { m.closed = true; on.close?.(); } };
    const els = { '#pg-go': { onclick: null }, '[name="pg-every"]:checked': field('hour'), '#pg-time': field('07:00'), '[name="pg-notify"]:checked': field('always'), '#pg-check': field('the CI runs'), '.pg-time': field('') };
    m.$ = (sel) => els[sel];
    opened.push(m);
    return m;
  };
  ctx.$ = (sel, m) => m.$(sel);
  ctx.$$ = () => [];
  const p = { slug: 'hq-health', title: 'HQ health', keep: null };
  const done = Pages.act('keep', 'ops', p, 'Ops');
  opened[0].$('#pg-go').onclick();
  assert.equal(opened[0].closed, true, 'closed at once, before the server answers');
  assert.equal(pills[0].kind, 'busy');
  assert.equal(await Pages.act('stop', 'ops', p, 'Ops'), false, 'its other buttons wait while it saves');
  assert.equal(await done, false);
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['/bots/ops/pages/hq-health/keep', 'POST']]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), { every: 'hour', time: '07:00', notify: 'always', check: 'the CI runs' });
  assert.deepEqual(pills.map((x) => [x.kind, x.text]), [['busy', 'Saving schedule…'], ['err', 'Not saved']]);
  pills[1].retry();
  assert.match(opened[1].html, /value="hour" checked/, 'the dialog opens again with what was entered');
  assert.match(opened[1].html, /the CI runs/);
});

test('web: Board flips at once, and back when the server says no (#475)', async () => {
  const { Pages, ctx } = page({ features: ['document-viewer', 'pages', 'pages-board'], fails: { '/bots/ops/pages/a/board': 'No' } });
  const shown = [];
  const btn = { set outerHTML(h) { shown.push(h); } };
  ctx.document.querySelector = () => btn;
  const p = { slug: 'a', onBoard: false };
  await Pages.toggleBoard('ops', p, btn);
  assert.match(shown[0], /On Board/, 'flipped before the answer');
  assert.doesNotMatch(shown[1], /On Board/, 'flipped back');
  assert.equal(p.onBoard, false);
});

test('web: the viewer draws a page with pages.js, and the feed passes `page` on', () => {
  const viewer = read('viewer.js');
  assert.match(viewer, /Pages\.subtitle\(c\.from, v\?\.page\)/);
  assert.match(viewer, /Pages\.barHTML\(v\.page\)/);
  assert.match(read('feed.js'), /addEventListener\('page'/);
  const html = read('index.html');
  assert.ok(html.indexOf('/pages.js') > html.indexOf('/viewer.js'), 'after the viewer');
  assert.ok(html.indexOf('/pages.js') > html.indexOf('/boot.js'), 'not between feed.js and boot.js');
});

test("web: the Pages view lists every bot's pages, kept up to date first, and its titles stay text (#361)", () => {
  const { Pages } = page({ features: ['document-viewer', 'pages', 'pages-all'] });
  assert.equal(Pages.showsAll(), true);
  assert.equal(page().Pages.showsAll(), false, 'a server without pages-all');
  const html = Pages.allHTML([
    { botId: 'ops', bot: 'Ops', slug: 'router-ports', title: 'Router <i>ports</i>', updatedAt: '2026-10-22T08:00:00Z', keep: null },
    { botId: 'ops', bot: 'Ops', slug: 'hq-health', title: 'hq health', updatedAt: '2026-10-22T07:00:00Z', keep: { jobId: 'j1', when: 'Daily at 07:00' } },
  ]);
  assert.ok(html.indexOf('Kept up to date') < html.indexOf('hq health'));
  assert.ok(html.indexOf('hq health') < html.indexOf('Other pages'));
  assert.ok(html.indexOf('Other pages') < html.indexOf('Router'));
  assert.match(html, /Ops · updated 5m ago · Daily at 07:00/);
  assert.match(html, /data-open-page="ops\/hq-health"/);
  assert.match(html, /Router &lt;i&gt;ports&lt;\/i&gt;/);
  assert.match(Pages.allHTML([{ botId: 'w', bot: 'W', slug: 'a', title: 'A', updatedAt: '', keep: null }]), /All pages/, 'one section when none is kept');
  assert.match(Pages.allHTML([]), /No pages yet/);
});

test('web: Pages opens from Settings only from a server with pages-all, and has a view of its own (#361)', () => {
  assert.match(read('settings.js'), /\['pages', tr\('Pages'\)\]/);
  assert.match(read('settings.js'), /view !== 'pages' \|\| \(typeof Pages !== 'undefined' && Pages\.showsAll\(\)\)/);
  assert.match(read('index.html'), /id="view-pages"/);
  assert.match(read('app.js'), /state\.view === 'pages'\) Pages\.renderAll\(\)/);
  assert.match(read('boot.js'), /'skills', 'pages'/);
});

test("web: the Chief's pages (#384) open at the bots' page routes with the id chief, by its name, only from a server with chief-pages", async () => {
  const { Pages, calls } = page({ features: ['document-viewer', 'pages', 'chief-pages'] });
  const html = Pages.chipsHTML({ botId: 'chief', pages: [{ slug: 'team', title: 'Team' }] });
  assert.match(html, /data-view="\/bots\/chief\/pages\/team"/);
  assert.match(html, /data-view-from="Kai"/);
  assert.equal(page().Pages.chipsHTML({ botId: 'chief', pages: [{ slug: 'team', title: 'Team' }] }), '', 'a server without chief-pages');
  await Pages.act('refresh', 'chief', { slug: 'team', keep: { jobId: 'page-team' } }, 'Kai');
  assert.deepEqual(calls.at(-1).slice(0, 2), ['/bots/chief/jobs/page-team/run', 'POST']);
  // Under its reply, and as a list in its settings.
  assert.match(read('chief.js'), /Pages\.chipsHTML\(\{ botId: 'chief', pages: \[\.\.\.\(m\.pages \|\| \[\]\), \.\.\.\(m\.botPages \|\| \[\]\)\] \}\)/);
  assert.match(read('settings.js'), /id="chief-page-list"/);
});

test("web: a Chief reply's pages from its bots open at each bot's routes, by its name, also from a server without chief-pages", () => {
  const { Pages } = page();
  const html = Pages.chipsHTML({ botId: 'chief', pages: [{ slug: 'team', title: 'Team' }, { botId: 'ops', bot: 'Ops', slug: 'launch-plan', title: 'Launch plan' }] });
  assert.match(html, /data-view="\/bots\/ops\/pages\/launch-plan"/);
  assert.match(html, /data-view-from="Ops"/);
  assert.doesNotMatch(html, /\/bots\/chief\//, "the Chief's own page waits for chief-pages");
});
