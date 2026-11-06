// The setup page's "Your phone" step (GET /api/setup `access.public`): a botdot on a public domain over https is
// already reachable from a phone, so the step names that address instead of asking for Tailscale.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicHost } = require('../lib/routes/setup');

test('a public domain over https is the address a phone opens', () => {
  assert.equal(publicHost('hq2.botdot.app', 'https'), 'hq2.botdot.app');
});

test('the loopback, a bare IP, a tailnet name or plain http is not one', () => {
  for (const [host, proto] of [['localhost', 'https'], ['127.0.0.1', 'https'], ['10.0.0.4', 'https'], ['box.tail1234.ts.net', 'https'], ['app.localhost', 'https'], ['hq2.botdot.app', 'http'], ['hq2.botdot.app', undefined], ['', 'https']]) {
    assert.equal(publicHost(host, proto), null, `${host} over ${proto}`);
  }
});
