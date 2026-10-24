// GET /api/favicon (#530): the owner's apps ask botdot for a site's icon; a bad host is refused, a site without an
// icon is a 404 the browser keeps for a day, and the Chief's tools can't ask.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('features name site-icons', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('site-icons'));
});

test('a host that is no public name is refused', async () => {
  for (const host of ['', 'localhost', '10.0.0.1', 'example.com:8443', 'nas.local']) {
    const r = await srv.api(`/favicon?host=${encodeURIComponent(host)}`);
    assert.equal(r.status, 400, host);
  }
});

test('a site without an icon is a 404 kept for a day', async () => {
  const res = await fetch(`${srv.base}/api/favicon?host=nothing.invalid`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=86400');
});

test("the Chief's tools can't ask for an icon", async () => {
  assert.equal((await srv.asChief('/favicon?host=example.com')).status, 403);
});
