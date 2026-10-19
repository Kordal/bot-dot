// Hardening before launch (#72): a body that is not JSON is the client's mistake, not botdot's, and the page
// Composio's sign-in sends people back to runs no script the page's own CSP would refuse.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('a body that is not JSON is a 400 that says so, and no crash in the log', async () => {
  const r = await srv.api('/bots', { method: 'POST', raw: '{', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'The request body is not valid JSON.');
  assert.doesNotMatch(srv.log.join(''), /\[http\]|at readBody/);
});

test("/connectors/done has the server's CSP and no inline script for it to block", async () => {
  const r = await fetch(`${srv.base}/connectors/done`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
  const page = await r.text();
  assert.doesNotMatch(page, /<script/);
  assert.match(page, /You can close this tab/);
});
