// A bot's computer: the live-screen viewer is botdot's own copy of noVNC (nothing on it comes from the
// computer), and a computer's tools reach it only through botdot, with the run's key.
// No Docker needed: these computers are never created.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startServer, restartServer, makeBot, heldRun, ROOT } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

// fetch tidies up "..", so a raw request.
const raw = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: srv.port, path: p }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
  });
  req.on('error', reject);
  req.end();
});

test("the screen viewer is botdot's own copy of noVNC", async () => {
  const js = await raw('/computer/abc123/app/ui.js');
  assert.equal(js.status, 200);
  assert.match(js.type, /javascript/);
  assert.equal(js.body, fs.readFileSync(path.join(ROOT, 'vendor', 'novnc', 'app', 'ui.js'), 'utf8'));
  assert.equal(JSON.parse((await raw('/computer/abc123/package.json')).body).name, '@novnc/novnc');
});

test('a computer that is off shows that instead of the viewer', async () => {
  const r = await raw('/computer/abc123/vnc.html?autoconnect=1&view_only=1');
  assert.equal(r.status, 503);
  assert.match(r.body, /turned off/);
});

test("nothing outside the viewer's folder", async () => {
  for (const p of ['/computer/abc123/../../server.js', '/computer/abc123/%2e%2e/%2e%2e/server.js', '/computer/abc123/..%2f..%2fpackage.json', '/computer/abc123/']) {
    const r = await raw(p);
    assert.ok(r.status === 404 || (p.endsWith('/') && r.status === 503), `${p}: ${r.status}`);
  }
});

test('a bot with a computer is told the desktop is its own and that the owner can take over', async () => {
  const bot = await makeBot(srv, { name: 'Clicker', computer: 'linux' });
  const { rec, run } = await heldRun(srv, bot);
  assert.match(rec.system, /You have your own computer: an Ubuntu Linux desktop \(XFCE, 1024x768\)\. The desktop is your own, and the owner can watch it and take the mouse and keyboard at any time: when the screen changed in a way you did not cause, the owner did it, and you carry on from what you see\./);
  assert.doesNotMatch(rec.system, /that only you use/);
  assert.match(rec.system, /use run_with_login with a command that reads "\$BOTDOT_USERNAME" and "\$BOTDOT_PASSWORD"\. It works only for a login with inComputer in list_logins/);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
  // A bot without one is told nothing of it.
  const plain = await heldRun(srv, await makeBot(srv, { name: 'No Desk' }));
  assert.doesNotMatch(plain.rec.system, /You have your own computer/);
  srv.release(plain.rec);
  await srv.finished(plain.run.id);
  srv.unhold();
});

test("a computer's commands need the run's key, and a bot with a computer", async () => {
  const cmd = (token) => srv.api('/vault/session/computer/cmd', { method: 'POST', body: { command: 'screenshot' }, headers: { 'X-Vault-Token': token } });
  assert.equal((await cmd('made-up')).status, 403);
  const bot = await makeBot(srv);
  const { rec, run, token } = await heldRun(srv, bot);
  const r = await cmd(token);
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /doesn't have a computer/);
  // send_screenshot too (it takes the screenshot through botdot and attaches it).
  const share = await srv.api('/vault/session/computer/share', { method: 'POST', body: { name: 'QR' }, headers: { 'X-Vault-Token': token } });
  assert.equal(share.data.ok, false);
  assert.match(share.data.error, /doesn't have a computer/);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

test("a bot with a computer is told it turns off when it replies, and to keep it on only for the owner's step on it (#340)", async () => {
  const bot = await makeBot(srv, { name: 'Holder', computer: 'linux' });
  const { rec, run } = await heldRun(srv, bot);
  assert.match(rec.system, /Your computer turns off when you reply/);
  assert.match(rec.system, /call keep_computer_on just before you reply/);
  assert.match(rec.system, /until the owner's next message to you, or 1 hour at most\. Say that in your reply\./);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

test('keep_computer_on needs the run\'s key and a bot with a computer (#340)', async () => {
  const keep = (token) => srv.api('/vault/session/computer/hold', { method: 'POST', body: {}, headers: { 'X-Vault-Token': token } });
  assert.equal((await keep('made-up')).status, 403);
  const { rec, run, token } = await heldRun(srv, await makeBot(srv, { name: 'No Desk Either' }));
  const r = await keep(token);
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /doesn't have a computer/);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
  // A bot whose computer stays on all the time is told so, and holds nothing.
  const always = await heldRun(srv, await makeBot(srv, { name: 'Always On', computer: 'linux', computerAlwaysOn: true }));
  const kept = await keep(always.token);
  assert.deepEqual([kept.data.ok, kept.data.text], [true, 'Your computer is set to stay on all the time, so it stays on after you reply anyway.']);
  srv.release(always.rec);
  await srv.finished(always.run.id);
  srv.unhold();
  assert.equal(fs.existsSync(path.join(srv.data, 'computer-holds.json')), false);
});

test('"Turn off", "Reset" and deleting the bot end a saved hold of the computer (#340)', async () => {
  const off = await makeBot(srv, { name: 'Held Off', computer: 'linux' });
  const reset = await makeBot(srv, { name: 'Held Reset', computer: 'linux' });
  const gone = await makeBot(srv, { name: 'Held Gone', computer: 'linux' });
  const since = new Date().toISOString();
  const holds = path.join(srv.data, 'computer-holds.json');
  srv = await restartServer(srv, () => fs.writeFileSync(holds, JSON.stringify({ [gone.id]: { since }, [off.id]: { since }, [reset.id]: { since } })));
  assert.equal((await srv.api(`/bots/${gone.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(holds, 'utf8'))).sort(), [off.id, reset.id].sort());
  assert.equal((await srv.api(`/bots/${off.id}/computer`, { method: 'POST', body: { action: 'stop' } })).status, 200);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(holds, 'utf8'))), [reset.id]);
  assert.equal((await srv.api(`/bots/${reset.id}/computer`, { method: 'POST', body: { action: 'reset' } })).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(holds, 'utf8')), {});
});
