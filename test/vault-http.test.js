const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const dns = require('node:dns');
const { apiRequest } = require('../lib/vault-http');
const { startServer, makeBot, heldRun } = require('./helpers');

test('only the owner can save additional exact hosts for the same login', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const server = http.createServer((req, res) => res.end(req.headers.authorization === 'Bearer fixture-secret' ? 'accepted' : 'missing'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const bot = await makeBot(srv);
  const { token } = await heldRun(srv, bot);
  const login = { site: 'bank.com', password: 'fixture-secret', allowedBots: [bot.id], allowedHosts: ['127.0.0.1'] };
  assert.equal((await srv.asChief('/vault', { method: 'POST', body: login })).status, 403);
  assert.equal((await srv.api('/vault', { method: 'POST', body: login })).status, 201);
  const result = await srv.api('/vault/session/http', { method: 'POST', headers: { 'X-Vault-Token': token }, body: { login: 'bank.com', url: `http://127.0.0.1:${server.address().port}/`, headers: { Authorization: 'Bearer {{password}}' } } });
  assert.equal(result.data.ok, true, JSON.stringify(result.data));
  assert.match(result.data.text, /accepted/);
});

test('saved login destinations are exact hosts, never implicit subdomains', async (t) => {
  const creds = { name: 'Bank', site: 'bank.com', username: 'test', password: 'fixture-secret' };
  for (const host of ['evil.bank.com', 'api.bank.com', 'notbank.com']) {
    await assert.rejects(apiRequest(creds, { url: `https://${host}/` }), /only be used with/);
  }
  // A public-looking name resolving to a local address must be refused before any request.
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(apiRequest(creds, { url: 'https://bank.com/' }), /private|local/i);
});

test('an explicitly saved internal address works; redirects and body secrets stay blocked', async (t) => {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(req.headers.authorization);
    res.writeHead(302, { Location: '/destination' });
    res.end('fixture-secret');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const creds = { name: 'Home', site: '127.0.0.1', username: '', password: 'fixture-secret' };
  const url = `http://127.0.0.1:${server.address().port}/`;
  const result = await apiRequest(creds, { url, headers: { Authorization: 'Bearer {{password}}' } });
  assert.equal(result.status, 302);
  assert.deepEqual(calls, ['Bearer fixture-secret']);
  assert.ok(!result.text.includes('fixture-secret'));
  await assert.rejects(apiRequest(creds, { url, body: '{{password}}' }), /headers/);
  assert.equal(calls.length, 1);
});
