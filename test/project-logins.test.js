// A project's logins (#804, ADR 126): the owner picks which Vault logins the cards of a project call with; a card's
// build gets api_request, GET only, with those logins and no other, by the key of its run. A build that needs one of
// the owner's servers no login reaches says which host, and the card shows it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { startServer, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const cardsLib = require('../lib/project-cards');

let srv; let pid; let other; let pve; let kuma; let service; let seen = [];
const SECRET = 'pve-token-secret-7f3a';
before(async () => {
  service = http.createServer((req, res) => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ name: 'staging', status: 'running' }], echo: req.headers.authorization })); });
  await new Promise((r) => service.listen(0, '127.0.0.1', r));
  srv = await startServer();
  pid = (await srv.api('/company', { method: 'POST', body: { start: 'Homelab' } })).data.id;
  other = (await srv.api('/company', { method: 'POST', body: { start: 'Garden' } })).data.id;
  pve = (await srv.api('/vault', { method: 'POST', body: { name: 'Proxmox pve', site: '127.0.0.1', username: 'root@pam!botdot', password: SECRET } })).data;
  kuma = (await srv.api('/vault', { method: 'POST', body: { name: 'Uptime Kuma', site: 'kuma.lan', password: 'kuma-secret-91' } })).data;
});
after(async () => { srv.unhold(); await srv.stop(); service.close(); });

const url = (p) => `http://127.0.0.1:${service.address().port}${p}`;
const project = async (id) => (await srv.api(`/company?project=${id}`)).data.company;
const isBuild = (x) => x.args.includes('🧭 Chief of Staff · card');

test('features name project-logins', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-logins'));
});

test("the owner picks a project's logins; the Chief cannot; the apps get each one's name and site", async () => {
  assert.equal((await srv.asChief(`/company?project=${pid}`, { method: 'PATCH', body: { logins: [pve.id] } })).status, 403, "the owner's alone");
  assert.equal((await srv.api(`/company?project=${pid}`, { method: 'PATCH', body: { logins: 'x' } })).status, 400);
  const r = await srv.api(`/company?project=${pid}`, { method: 'PATCH', body: { logins: [pve.id, pve.id, 'gone1234'] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.logins, [{ id: pve.id, name: 'Proxmox pve', site: '127.0.0.1' }, { id: 'gone1234' }], 'once each; one the Vault no longer has is only its id');
  assert.equal((await project(other)).logins, undefined, 'another project has none');
  assert.doesNotMatch(JSON.stringify(await project(pid)), new RegExp(SECRET));
});

test("a card's build GETs with its project's logins, never another's, and its key ends with the run", async (t) => {
  fs.writeFileSync(path.join(srv.out, 'card-questions.txt'), JSON.stringify({ title: 'VM status', questions: [] }));
  srv.reply('```card\n{"title":"VMs","show":"number","value":"6","sub":"running","how":"GET cluster/resources with Proxmox pve."}\n```');
  srv.hold();
  const r = await srv.api(`/company/cards?project=${pid}`, { method: 'POST', body: { ask: 'Proxmox VM status' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const run = await srv.nextRun(isBuild, 'the build');
  const allowed = run.args.slice(run.args.indexOf('--allowedTools') + 1).filter((a) => a.startsWith('mcp__botdot__'));
  assert.deepEqual(allowed, ['mcp__botdot__list_project_files', 'mcp__botdot__read_project_file', 'mcp__botdot__api_request']);
  assert.match(run.system + run.stdin, /"Proxmox pve" \(127\.0\.0\.1\)/, 'told which logins, by name and site');
  assert.doesNotMatch(run.system + run.stdin, /Uptime Kuma/, "a login the project doesn't have is not named");
  const env = JSON.parse(fs.readFileSync(run.args[run.args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.botdot.env;
  assert.equal(env.BOT_DOT_CARD_LOGINS, '1');
  const tools = rpcClient(t, 'mcp-server.js', { ...env, BOT_DOT_URL: srv.base });
  assert.deepEqual((await tools.request('tools/list')).tools.map((x) => x.name), ['list_project_files', 'read_project_file', 'api_request']);

  seen = [];
  const text = await tools.text('api_request', { login: 'Proxmox pve', url: url('/api2/json/cluster/resources'), headers: { Authorization: 'PVEAPIToken={{username}}={{password}}' } });
  assert.match(text, /HTTP 200/);
  assert.match(text, /staging/);
  assert.doesNotMatch(text, new RegExp(SECRET), 'the secret is blanked out of the answer');
  assert.deepEqual(seen.map((x) => [x.method, x.url, x.auth]), [['GET', '/api2/json/cluster/resources', `PVEAPIToken=root@pam!botdot=${SECRET}`]]);
  assert.match((await tools.call('api_request', { login: 'Uptime Kuma', url: 'http://kuma.lan/' })).content[0].text, /^Error: Use one of this project's logins: "Proxmox pve"/);
  assert.match((await tools.call('api_request', { login: 'Proxmox pve', url: 'https://example.com/' })).content[0].text, /^Error: .*can only be used with 127\.0\.0\.1/);
  assert.equal((await srv.asChief('/company/card-request', { method: 'POST', body: { login: 'Proxmox pve', url: url('/') } })).status, 403, "the Chief's key alone calls nothing");
  assert.equal((await srv.asChief('/company/card-request', { method: 'POST', headers: { 'X-Card-Key': 'nope' }, body: { login: 'Proxmox pve', url: url('/') } })).status, 403);
  assert.equal(seen.length, 1);

  srv.unhold();
  srv.release(run);
  await waitFor(async () => ((await project(pid)).cards.at(-1).state === 'ready' ? true : null), { what: 'the card built' });
  assert.match((await tools.call('api_request', { login: 'Proxmox pve', url: url('/') })).content[0].text, /run has ended/);
  assert.equal(seen.length, 1);
});

test('a build that needs a login the project lacks fails with the host, which the apps show', async () => {
  fs.writeFileSync(path.join(srv.out, 'card-questions.txt'), JSON.stringify({ title: 'Garden VMs', questions: [] }));
  srv.reply('I have no login for it.\nNEEDS LOGIN: https://pve.example.ts.net:8006/api2');
  srv.hold();
  await srv.api(`/company/cards?project=${other}`, { method: 'POST', body: { ask: 'Proxmox VM status' } });
  const run = await srv.nextRun(isBuild, 'the build');
  const allowed = run.args.slice(run.args.indexOf('--allowedTools') + 1).filter((a) => a.startsWith('mcp__botdot__'));
  assert.ok(!allowed.includes('mcp__botdot__api_request'), 'no logins, no api_request');
  assert.match(run.system + run.stdin, /NEEDS LOGIN:/);
  srv.unhold();
  srv.release(run);
  const c = await waitFor(async () => { const x = (await project(other)).cards.at(-1); return x.state === 'failed' ? x : null; }, { what: 'the failed card' });
  assert.equal(c.needsLogin, 'pve.example.ts.net:8006');
  assert.equal(c.error, 'No login for pve.example.ts.net:8006');
});

test('cardOf reads NEEDS LOGIN; a card keeps needsLogin only while it failed', () => {
  assert.deepEqual(cardsLib.cardOf('NEEDS LOGIN: 10.0.0.5'), { error: 'No login for 10.0.0.5', needsLogin: '10.0.0.5' });
  assert.deepEqual(cardsLib.cardOf('NEEDS LOGIN: <b>x</b>'), { error: 'No login for that server' });
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cards-'));
  const store = cardsLib.create({ file: path.join(dir, 'c.json') });
  const c = store.add('p', { ask: 'VMs' });
  store.building('p', c.id);
  assert.equal(store.built('p', c.id, { error: 'No login for pve.lan', needsLogin: 'pve.lan' }).needsLogin, 'pve.lan');
  store.building('p', c.id);
  const ok = store.built('p', c.id, { body: { show: 'number', value: '3' } });
  assert.equal(ok.needsLogin, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
