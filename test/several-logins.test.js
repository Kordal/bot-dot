// Several Vault entries in one call (#228): run_with_login and api_request take `logins`, up to 8 names of logins
// shared with the bot. In a command each login is in BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD; in a request
// header each value is {{NAME.password}}. Every login must pass every rule a single one does, every secret is
// blanked out of what comes back, and the log names every login used, never a value.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { apiRequest, loginList, loginVar, loginVarProblems, loginEnv, hideLogins, MAX_LOGINS } = require('../lib/vault-http');
const { startServer, makeBot, heldRun } = require('./helpers');

const OVH = [
  { name: 'OVH_APPLICATION_KEY', site: 'eu.api.ovh.com', username: '', password: 'app-key-0001' },
  { name: 'OVH_APPLICATION_SECRET', site: 'eu.api.ovh.com', username: '', password: 'app-secret/+=0002' },
  { name: 'OVH_CONSUMER_KEY', site: 'eu.api.ovh.com', username: '', password: 'third-value' },
];

// ---------- which logins a call names ----------

test('a call names one login, or a list of 1 to 8, never both', () => {
  assert.deepEqual(loginList({ login: 'Bridge' }), { refs: ['Bridge'], several: false });
  assert.deepEqual(loginList({ logins: ['A', 'B'] }), { refs: ['A', 'B'], several: true });
  assert.deepEqual(loginList({ logins: ['A'] }), { refs: ['A'], several: true }, 'a list of one names its variables too');
  assert.equal(MAX_LOGINS, 8);
  assert.ok(loginList({ logins: Array.from({ length: 8 }, (_, i) => `L${i}`) }).refs);
  assert.match(loginList({ logins: Array.from({ length: 9 }, (_, i) => `L${i}`) }).error, /At most 8 logins/);
  assert.match(loginList({ login: 'A', logins: ['B'] }).error, /not both/);
  assert.match(loginList({ logins: [] }).error, /list of login names/);
  assert.match(loginList({ logins: ['A', 3] }).error, /list of login names/);
  assert.match(loginList({ logins: 'A' }).error, /list of login names/);
  assert.match(loginList({}).error, /Say which login/);
});

// ---------- the variables of a command ----------

test('each login gets BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD, its name in capitals with "_" for the rest', () => {
  assert.equal(loginVar('OVH_APPLICATION_KEY'), 'BOTDOT_OVH_APPLICATION_KEY');
  assert.equal(loginVar('mail.example.com'), 'BOTDOT_MAIL_EXAMPLE_COM');
  assert.equal(loginVar('Proton Bridge #2'), 'BOTDOT_PROTON_BRIDGE__2');
  assert.deepEqual(loginEnv(OVH), {
    BOTDOT_OVH_APPLICATION_KEY_USERNAME: '', BOTDOT_OVH_APPLICATION_KEY_PASSWORD: 'app-key-0001',
    BOTDOT_OVH_APPLICATION_SECRET_USERNAME: '', BOTDOT_OVH_APPLICATION_SECRET_PASSWORD: 'app-secret/+=0002',
    BOTDOT_OVH_CONSUMER_KEY_USERNAME: '', BOTDOT_OVH_CONSUMER_KEY_PASSWORD: 'third-value',
  });
  assert.deepEqual(loginVarProblems(OVH), []);
  // Two names that make the same variable are refused, and the problem names both.
  const [clash] = loginVarProblems([{ name: 'ovh-key' }, { name: 'OVH.KEY' }]);
  assert.match(clash, /"ovh-key" and "OVH\.KEY" both give BOTDOT_OVH_KEY_PASSWORD/);
  assert.match(loginVarProblems([{ name: 'x'.repeat(201) }])[0], /too long/);
});

test('what comes back from a command has every secret blanked out, in every form', () => {
  const hide = hideLogins(OVH);
  for (const { password } of OVH) {
    for (const form of [password, encodeURIComponent(password), Buffer.from(password).toString('base64')]) {
      assert.equal(hide(`<${form}>`), '<[hidden]>', form);
    }
  }
  // A secret that holds another is blanked whole, not cut by the shorter one.
  const nested = hideLogins([{ name: 'A', password: 'abcd' }, { name: 'B', password: 'xxabcdxx' }]);
  assert.equal(nested('xxabcdxx abcd'), '[hidden] [hidden]');
  assert.equal(hide('nothing here'), 'nothing here');
});

// ---------- api_request with several logins ----------

async function echoServer(t) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.end(`got ${req.headers['x-key']} and ${req.headers['x-secret']} (${Buffer.from(String(req.headers['x-secret'])).toString('base64')})`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/1.0/domain/zone`, seen };
}

test('api_request with two logins sends both values and blanks both out of the response', async (t) => {
  const { url, seen } = await echoServer(t);
  const list = [
    { key: 'A', creds: { name: 'A', site: '127.0.0.1', username: 'app', password: 'key-value-A' } },
    { key: 'b', creds: { name: 'B', site: 'example.com', allowedHosts: ['127.0.0.1'], username: '', password: 'secret-value-B' } },
  ];
  const r = await apiRequest(list, { method: 'POST', url, headers: { 'X-Key': '{{A.password}}', 'X-Secret': '{{ B.password }}', 'X-User': '{{a.username}}' }, body: { x: 1 } });
  assert.equal(r.status, 200);
  assert.equal(seen[0]['x-key'], 'key-value-A');
  assert.equal(seen[0]['x-secret'], 'secret-value-B');
  assert.equal(seen[0]['x-user'], 'app', 'a name matches in any case');
  assert.equal(r.body, 'got [hidden] and [hidden] ([hidden])');
  assert.ok(!r.text.includes('key-value-A') && !r.text.includes('secret-value-B'));
});

test('api_request with several logins: every login must allow the host, and every placeholder must name one of them', async (t) => {
  const { url, seen } = await echoServer(t);
  const A = { key: 'A', creds: { name: 'A', site: '127.0.0.1', password: 'key-value-A' } };
  const B = { key: 'B', creds: { name: 'B', site: 'example.com', password: 'secret-value-B' } };
  await assert.rejects(apiRequest([A, B], { url, headers: { 'X-Key': '{{A.password}}' } }), /"B" login can only be used with example\.com/);
  const B2 = { key: 'B', creds: { ...B.creds, allowedHosts: ['127.0.0.1'] } };
  await assert.rejects(apiRequest([A, B2], { url, headers: { 'X-Key': '{{C.password}}' } }), /"C" isn't one of the logins of this request/);
  await assert.rejects(apiRequest([A, B2], { url, headers: { 'X-Key': '{{password}}' } }), /say whose value goes where: \{\{NAME\.password\}\}/);
  // Values stay header-only: in the address or the body they are refused, named or not.
  await assert.rejects(apiRequest([A, B2], { url: `${url}?k={{A.password}}` }), /only go in headers/);
  await assert.rejects(apiRequest([A, B2], { url, body: '{"k":"{{B.password}}"}' }), /only go in headers/);
  await assert.rejects(apiRequest({ name: 'A', site: '127.0.0.1', password: 'p' }, { url, body: '{{password}}' }), /only go in headers/);
  // The single login's form names no login.
  await assert.rejects(apiRequest(A.creds, { url, headers: { 'X-Key': '{{A.password}}' } }), /needs logins/);
  await assert.rejects(apiRequest(Array.from({ length: 9 }, () => A), { url }), /1 to 8 logins/);
  assert.equal(seen.length, 0, 'nothing was sent');
  // A single login's body may carry named text, as before (a Board tile's templating API): nothing is filled in.
  await apiRequest({ name: 'A', site: '127.0.0.1', password: 'p' }, { method: 'POST', url, body: '{{A.password}}' });
  assert.equal(seen.length, 1);
});

test('a name the bot gave wins over another login\'s own name', async (t) => {
  const { url, seen } = await echoServer(t);
  // "b" is the login named "C"; "a" is the login named "b". {{b.password}} is the one the bot called b.
  const list = [
    { key: 'b', creds: { name: 'C', site: '127.0.0.1', password: 'value-of-C' } },
    { key: 'a', creds: { name: 'b', site: '127.0.0.1', password: 'value-of-b' } },
  ];
  await apiRequest(list, { url, headers: { 'X-Key': '{{b.password}}', 'X-Secret': '{{c.password}}' } });
  assert.deepEqual([seen[0]['x-key'], seen[0]['x-secret']], ['value-of-C', 'value-of-C']);
});

// ---------- the routes ----------

// A docker that always fails, first on PATH: the computer never starts.
function noDocker(t) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-no-docker-'));
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\necho "no docker in this test" >&2\nexit 1\n', { mode: 0o755 });
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('run_with_login with logins: every one must be shared and usable in the computer, or no command runs', async (t) => {
  const srv = await startServer({ env: noDocker(t) });
  t.after(() => srv.stop());
  const infra = await makeBot(srv, { name: 'Infra Admin', computer: 'linux', computerAlwaysOn: true });
  const other = await makeBot(srv, { name: 'Other' });
  const add = async (name, password, extra = {}) => (await srv.api('/vault', { method: 'POST', body: { name, site: 'eu.api.ovh.com', password, allowedBots: [infra.id], inComputer: true, ...extra } })).data;
  await add('OVH_APPLICATION_KEY', 'app-key-0001');
  const secret = await add('OVH_APPLICATION_SECRET', 'app-secret-0002', { inComputer: false });
  await add('OVH_CONSUMER_KEY', 'third-value', { allowedBots: [other.id] });
  await add('ovh-application-key', 'clash-0004');
  await add('Spare', 'spare-0005', { inComputer: false });
  const held = await heldRun(srv, infra);
  const run = (body) => srv.api('/vault/session/computer/run-with-login', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { command: 'true', ...body } });
  const three = ['OVH_APPLICATION_KEY', 'OVH_APPLICATION_SECRET', 'OVH_CONSUMER_KEY'];

  let r = await run({ logins: three });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /isn't allowed to use the "OVH_CONSUMER_KEY" login/, 'the one not shared is named');
  assert.match(r.data.error, /The "OVH_APPLICATION_SECRET" login isn't usable in your computer\. Ask the owner for it with ask_vault_switch \(switch "inComputer"\)/, 'the one switched off is named');
  assert.doesNotMatch(r.data.error, /"OVH_APPLICATION_KEY"/, 'the one that passes is not');
  assert.match((await run({ logins: [...three, 'a', 'b', 'c', 'd', 'e', 'f'] })).data.error, /At most 8 logins in one call, not 9/);
  // Two switched off: both named, one card each.
  r = await run({ logins: ['OVH_APPLICATION_SECRET', 'Spare'] });
  assert.match(r.data.error, /The "OVH_APPLICATION_SECRET", "Spare" logins aren't usable in your computer\. Ask the owner for each with ask_vault_switch \(switch "inComputer", once per login\)/);
  assert.match((await run({ logins: ['OVH_APPLICATION_KEY', 'ovh_application_key'] })).data.error, /"OVH_APPLICATION_KEY" is in logins twice/);
  assert.match((await run({ login: 'OVH_APPLICATION_KEY', logins: three })).data.error, /not both/);
  r = await run({ logins: ['OVH_APPLICATION_KEY', 'ovh-application-key'] });
  assert.match(r.data.error, /"OVH_APPLICATION_KEY" and "ovh-application-key" both give BOTDOT_OVH_APPLICATION_KEY_PASSWORD/);
  assert.ok(!srv.log.join('').includes('ran a command'), 'no command ran for any of these');

  // Once every login passes, the route goes on to the computer (here a stand-in that never starts), and its log
  // line names each login and no value.
  await srv.api(`/vault/${secret.id}`, { method: 'PUT', body: { inComputer: true } });
  r = await run({ logins: ['OVH_APPLICATION_KEY', 'OVH_APPLICATION_SECRET'] });
  assert.equal(r.data.ok, false);
  assert.doesNotMatch(r.data.error, /usable in your computer|isn't allowed/);
  const log = srv.log.join('');
  assert.match(log, /\[vault\] \S+ ran a command in its computer with "OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET": failed/);
  assert.ok(!/app-key-0001|app-secret-0002/.test(log), 'no value is logged');
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
});

test('api_request through the route with two logins: both values sent, both hidden, both named in the log', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const { url, seen } = await echoServer(t);
  const bot = await makeBot(srv);
  const held = await heldRun(srv, bot);
  for (const [name, password] of [['Key', 'route-key-value'], ['Secret', 'route-secret-value']]) {
    await srv.api('/vault', { method: 'POST', body: { name, site: '127.0.0.1', password, allowedBots: [bot.id] } });
  }
  await srv.api('/vault', { method: 'POST', body: { name: 'Elsewhere', site: 'example.com', password: 'elsewhere-value', allowedBots: [bot.id] } });
  const call = (body) => srv.api('/vault/session/http', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { url, ...body } });
  let r = await call({ logins: ['Key', 'Secret'], headers: { 'X-Key': '{{Key.password}}', 'X-Secret': '{{Secret.password}}' } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual([seen[0]['x-key'], seen[0]['x-secret']], ['route-key-value', 'route-secret-value']);
  assert.match(r.data.text, /got \[hidden\] and \[hidden\] \(\[hidden\]\)/);
  assert.match(srv.log.join(''), /\[vault\] \S+ GET 127\.0\.0\.1\/1\.0\/domain\/zone with "Key", "Secret": 200/);
  assert.ok(!/route-key-value|route-secret-value/.test(srv.log.join('')));
  // One login that doesn't allow the host: refused, nothing sent.
  r = await call({ logins: ['Key', 'Elsewhere'], headers: { 'X-Key': '{{Key.password}}' } });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /"Elsewhere" login can only be used with example\.com/);
  // One not shared with the bot: refused by name.
  r = await call({ logins: ['Key', 'Nope'] });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /Nope/);
  assert.equal(seen.length, 1);
  // The single login keeps working as before.
  r = await call({ login: 'Key', headers: { 'X-Key': '{{password}}' } });
  assert.equal(r.data.ok, true);
  assert.equal(seen[1]['x-key'], 'route-key-value');
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
});
