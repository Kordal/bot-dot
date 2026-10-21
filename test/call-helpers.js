// Calls to a job (ADR 026), as the tests send them: a call is turned on as the owner does it (the Chief proposes it,
// the owner says yes, the key is read from the Vault), and sent to the job's call address at the front door
// (/call/<account>/<bot>/<job>, ADR 028), here the tests' stand-in, from a device behind Caddy or Tailscale Serve.
const assert = require('node:assert/strict');
const http = require('http');
const { vaultSecret } = require('./helpers');

const DEVICE = '100.101.102.103'; // the device that sends the call

// Turns calls on for job `j` of bot `b` and returns its key.
async function turnOn(srv, b, j, headers = {}) {
  const at = `/bots/${b.id}/jobs/${j.id}`;
  const proposed = await srv.asChief(at, { method: 'PUT', body: { call: true, summary: 'Runs on a call.' } });
  assert.equal(proposed.data.change?.call, true, JSON.stringify(proposed.data));
  const yes = await srv.api(`${at}/approve`, { method: 'POST', body: { approve: true }, headers });
  assert.equal(yes.data.call, true, JSON.stringify(yes.data));
  return vaultSecret(srv, `Call key: ${b.name} / ${j.name}`);
}

// The path of job `j`'s call address at the front door.
const addressOf = (srv, b, j) => `/call/${srv.account}/${b.id}/${j.id}`;

// A call to job `j` of bot `b` with `key`: { status, data }. A raw request, so that X-Forwarded-For can be set; on a
// connection of its own, as front-door-helpers.js sends its requests.
const call = (srv, b, j, key, { body = '', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1', port: srv.port, agent: false, method: 'POST', path: addressOf(srv, b, j),
    headers: { 'X-Forwarded-For': DEVICE, 'Content-Type': 'text/plain', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
  }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => { let data = text; try { data = JSON.parse(text); } catch { /* text */ } resolve({ status: res.statusCode, data }); });
  });
  req.on('error', reject);
  req.end(body);
});

module.exports = { DEVICE, turnOn, call, addressOf };
