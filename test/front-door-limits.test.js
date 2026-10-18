// Who the front door's limits count (lib/front-door/limits.js clientOf): never an address the client wrote itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clientOf } = require('../lib/front-door/limits');

const req = (peer, forwarded) => ({ socket: { remoteAddress: peer }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} });

test('a client reaching the front door directly is its own address, whatever it writes', () => {
  assert.equal(clientOf(req('203.0.113.7', '198.51.100.1'), false), '203.0.113.7');
  assert.equal(clientOf(req('::ffff:203.0.113.7'), false), '203.0.113.7');
});

test('behind Caddy or Tailscale Serve on this machine, the address they added last', () => {
  assert.equal(clientOf(req('127.0.0.1', '198.51.100.1, 203.0.113.7'), false), '203.0.113.7');
  assert.equal(clientOf(req('::1', '203.0.113.7'), false), '203.0.113.7');
  assert.equal(clientOf(req('127.0.0.1'), false), '127.0.0.1');
});

test('behind a reverse proxy on its Docker network (FRONT_DOOR_BEHIND_PROXY), the address the proxy added last', () => {
  assert.equal(clientOf(req('172.18.0.5', '198.51.100.1, 203.0.113.7'), true), '203.0.113.7');
  assert.equal(clientOf(req('172.18.0.5'), true), '172.18.0.5', 'nothing added: the proxy itself');
  process.env.FRONT_DOOR_BEHIND_PROXY = '1';
  try { assert.equal(clientOf(req('172.18.0.5', '203.0.113.7')), '203.0.113.7', 'read from the environment'); } finally { delete process.env.FRONT_DOOR_BEHIND_PROXY; }
  assert.equal(clientOf(req('172.18.0.5', '203.0.113.7')), '172.18.0.5');
});
