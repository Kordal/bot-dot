// The owner watches a boat.dev bot's desktop (#564, ADR 093): the server hands the owner's app a new stream address
// each time, and the web page frames it in a frame of its own, whose policy alone allows an https frame.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { srv.unhold(); await srv.stop(); });

test("the desktop's frame may frame an https stream; the page itself frames only its own", async () => {
  const frame = await fetch(`${srv.base}/boat-desktop.html`);
  assert.equal(frame.status, 200);
  const csp = frame.headers.get('content-security-policy');
  assert.match(csp, /frame-src https:(;|$)/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'self'(;|$)/);
  assert.match(csp, /default-src 'none'/);
  const page = (await fetch(`${srv.base}/`)).headers.get('content-security-policy');
  assert.match(page, /frame-src 'self'(;|$)/);
  assert.doesNotMatch(page, /frame-src[^;]*https:/);
});

test("only the owner asks for a bot's desktop, and only for a bot on boat.dev", async () => {
  const { id } = await makeBot(srv, { name: 'Coder' });
  const asked = await srv.api(`/bots/${id}/computer/desktop`, { method: 'POST' });
  assert.equal(asked.status, 409);
  const chief = await srv.asChief(`/bots/${id}/computer/desktop`, { method: 'POST' });
  assert.equal(chief.status, 403);
  const v = await srv.api('/version');
  assert.ok(v.data.features.includes('boat-desktop'));
});
