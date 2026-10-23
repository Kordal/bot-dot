// Pages on the web page (#346, public/pages.js): the chip under a reply opens the page in the viewer, its title is
// text, the viewer's bar offers "Keep up to date" or says what keeps it, and the sheet sends the server its words.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc } = require('./web-page');

function page({ features = ['document-viewer', 'pages'], answers = {} } = {}) {
  const calls = [];
  const ctx = vm.createContext({
    state: { features, bots: [{ id: 'ops', name: 'Ops' }], view: 'bot', botId: 'ops' },
    esc, encodeURIComponent, ago: () => '5m ago', chiefName: () => 'Kai', toast() {}, DocViewer: { pageChanged() {} }, SUB_BACK: '',
    api: async (p, opts = {}) => { calls.push([p, opts.method || 'GET', opts.body]); return answers[p] ?? {}; },
  });
  vm.runInContext(`${read('pages.js')}\nthis.Pages = Pages;`, ctx);
  return { Pages: ctx.Pages, calls };
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
  assert.match(read('settings.js'), /\['pages', 'Pages'/);
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
