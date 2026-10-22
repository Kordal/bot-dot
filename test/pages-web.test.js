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
    esc, encodeURIComponent, ago: () => '5m ago', toast() {}, DocViewer: { pageChanged() {} },
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
