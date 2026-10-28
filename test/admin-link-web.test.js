// The way to the admin page from the web page (ADR 028): beside Settings, an "Admin" icon that opens /admin, shown
// only when the front door says the session is the admin's. Every other session, and a botdot server without a front
// door, shows nothing. The page's own code, cut out of public/app.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, read, element, answer, words } = require('./web-page');

function page({ features = ['accounts'], fetch = answer(200, { admin: true }) } = {}) {
  const calls = [];
  const link = element({}, { classes: ['hidden'] });
  const ctx = vm.createContext({ ...words,
    state: { features },
    $: (sel) => (sel === '#admin-link' ? link : null),
    fetch: async (url, opts) => { calls.push([url, opts]); return fetch(url, opts); },
  });
  vm.runInContext(`${cut('// ---------- the way to the admin page ----------', '// ---------- backups ----------')}
    Object.assign(this, { showAdminLink });`, ctx);
  return { ctx, calls, link };
}

test("web: the admin's session gets the Admin icon, asked of the front door", async () => {
  const { ctx, calls, link } = page();
  await ctx.showAdminLink();
  assert.equal(link.classList.contains('hidden'), false);
  assert.deepEqual(calls.map(([url]) => url), ['/front-door/session'], "the front door's own route, not botdot's /api");
});

test('web: any other session, an odd answer or no front door shows no Admin icon', async () => {
  for (const fetch of [answer(200, { admin: false }), answer(200, {}), answer(200, { admin: 'yes' }), answer(401, { error: 'Sign in first.' }), answer(404), async () => { throw new TypeError('Failed to fetch'); }]) {
    const { ctx, link } = page({ fetch });
    await ctx.showAdminLink();
    assert.equal(link.classList.contains('hidden'), true);
  }
  const none = page({ features: [] });
  await none.ctx.showAdminLink();
  assert.equal(none.link.classList.contains('hidden'), true);
  assert.deepEqual(none.calls, [], 'a botdot server without a front door is not asked');
});

test('web: the Admin icon sits beside Settings in the top bar, opens /admin in the same tab, and is asked for at the start', () => {
  const html = read('index.html');
  const tools = html.slice(html.indexOf('<nav class="side-tools">'), html.indexOf('</nav>', html.indexOf('<nav class="side-tools">')));
  assert.match(tools, /id="more-btn"/);
  const a = tools.match(/<a [^>]*id="admin-link"[^>]*>/);
  assert.ok(a, 'the icon is in the top bar\'s tools (#635)');
  assert.match(a[0], /href="\/admin"/);
  assert.match(a[0], /class="more-btn hidden"/, 'the gear\'s look, hidden until the front door says so');
  assert.match(a[0], /title="Admin"/);
  assert.match(a[0], /aria-label="Admin"/);
  assert.doesNotMatch(a[0], /target=/);
  assert.match(cut('(async () => {', 'setupNow'), /showAdminLink\(\)/);
});
