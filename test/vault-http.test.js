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

// Security review M4 (ADR 250): a public address gets a saved login over https on 443 with its certificate checked; an
// internal host keeps the self-signed exception of ADR 177 and any port.
test('a saved login goes to a public address only over https, on its own port, with its certificate checked', async (t) => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const creds = { name: 'Bank', site: 'bank.com', username: 'test', password: 'fixture-secret' };
  await assert.rejects(apiRequest(creds, { url: 'http://bank.com/v1', headers: { Authorization: 'Bearer {{password}}' } }), /https only, not http: write https:\/\/bank\.com\/v1/);
  await assert.rejects(apiRequest(creds, { url: 'https://bank.com:8443/', headers: { Authorization: 'Bearer {{password}}' } }), /https port only, not port 8443/);

  // What the request is made with, and a server whose certificate does not verify.
  const made = [];
  t.mock.method(https, 'request', (url, options) => {
    made.push({ host: new URL(url).hostname, rejectUnauthorized: options.rejectUnauthorized, headers: options.headers });
    const req = new EventEmitter();
    req.write = () => {}; req.destroy = () => {};
    req.end = () => setImmediate(() => req.emit('error', Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })));
    return req;
  });
  t.mock.method(dns.promises, 'lookup', async (host) => [{ address: host === 'nas.lan' ? '192.168.1.5' : '93.184.216.34', family: 4 }]);
  const result = await apiRequest(creds, { url: 'https://bank.com/v1', headers: { Authorization: 'Bearer {{password}}' } });
  assert.equal(result.ok, false);
  assert.match(result.text, /DEPTH_ZERO_SELF_SIGNED_CERT\. Its certificate is not valid, and a saved login goes to a public address only with a valid one: nothing was sent\./);
  assert.ok(!result.text.includes('fixture-secret'));
  assert.equal(made.at(-1).rejectUnauthorized, true, 'the certificate is checked');

  // The owner's own NAS: a self-signed certificate on another port is fine.
  const nas = { name: 'NAS', site: 'nas.lan', username: 'root', password: 'fixture-secret' };
  await apiRequest(nas, { url: 'https://nas.lan:5001/api', headers: { Authorization: 'Bearer {{password}}' } });
  assert.deepEqual([made.at(-1).host, made.at(-1).rejectUnauthorized], ['nas.lan', false]);
  // A public login with an internal additional host the owner saved: that host is internal.
  await apiRequest({ ...creds, allowedHosts: ['nas.lan'] }, { url: 'https://nas.lan:5001/', headers: { Authorization: 'Bearer {{password}}' } });
  assert.equal(made.at(-1).rejectUnauthorized, false);
});
