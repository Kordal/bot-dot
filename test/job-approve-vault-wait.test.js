// The owner's yes to a call on a job (ADR 026) makes its key in the Vault first. A Bitwarden that doesn't answer
// in time, or is locked, answers the yes with what happened (nothing was approved, try again), never a request
// that hangs or "Something went wrong"; the call keeps waiting, and a later yes approves it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeBot, waitFor } = require('./helpers');

// The secret of the Bitwarden item `name`, as the stand-in CLI keeps it. Read while that CLI writes the file, it may
// be cut short: then undefined, and waitFor reads it again.
const bwSecret = (srv, name) => {
  let items;
  try { items = JSON.parse(fs.readFileSync(path.join(srv.data, 'bitwarden-cli', 'items.json'), 'utf8')); } catch { return undefined; }
  return items.find((x) => x.name === name)?.login?.password;
};

const FAKE_BW = path.join(__dirname, 'fixtures', 'fake-bw.js');
const CLIENT_ID = 'user.00000000-0000-0000-0000-000000000000';

test("a yes to a call while Bitwarden doesn't answer, or is locked, says nothing was approved; a later yes approves it", async (t) => {
  const srv = await startServer({ env: { BW_BIN: FAKE_BW, BOT_DOT_VAULT_WAIT_MS: '1500' } });
  t.after(() => srv.stop());
  assert.equal((await srv.api('/vault/bitwarden/setup', { method: 'POST', body: { server: 'us', clientId: CLIENT_ID, clientSecret: 'fixture-client-secret' } })).status, 200);
  assert.equal((await srv.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } })).status, 200);
  const bot = await makeBot(srv, { name: 'Kuma Watch' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Alert', kind: 'script', cron: '0 4 1 1 *', script: 'cat' } })).data;
  const at = `/bots/${bot.id}/jobs/${job.id}`;
  assert.equal((await srv.asChief(at, { method: 'PUT', body: { call: true, summary: 'Runs on a call.' } })).data.change?.call, true);
  const approve = () => srv.api(`${at}/approve`, { method: 'POST', body: { approve: true } });
  const waiting = async () => (await srv.api(`/bots/${bot.id}/jobs`)).data.find((x) => x.id === job.id);

  const slowFile = path.join(srv.data, 'bitwarden-cli', 'slow');
  fs.writeFileSync(slowFile, 'create item');
  const started = Date.now();
  const slow = await approve();
  assert.ok(Date.now() - started < 3500, 'answered before Bitwarden did');
  assert.equal(slow.status, 503, JSON.stringify(slow.data));
  assert.match(slow.data.error, /Bitwarden didn't answer in time\. Nothing was approved/);
  assert.equal((await waiting()).call, false);
  assert.equal((await waiting()).change?.call, true, 'the call still waits');
  fs.rmSync(slowFile);

  assert.equal((await srv.api('/vault/bitwarden/lock', { method: 'POST' })).status, 200);
  const locked = await approve();
  assert.equal(locked.status, 503, JSON.stringify(locked.data));
  assert.match(locked.data.error, /Bitwarden is locked.*Nothing was approved/);
  assert.equal((await waiting()).change?.call, true);

  assert.equal((await srv.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } })).status, 200);
  const yes = await approve();
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.equal(yes.data.call, true);

  // The Chief's new key (new_job_call_key) on a slow Bitwarden: an answer in time, never a connection that drops;
  // the old key works until the new one is in the Vault, and a second ask meanwhile makes none.
  const key = bwSecret(srv, `Call key: ${bot.name} / ${job.name}`);
  assert.ok(key);
  fs.writeFileSync(slowFile, 'edit item');
  const rotate = () => srv.asChief(`${at}/call/setup`, { method: 'POST' });
  const [late, again] = await Promise.all([rotate(), new Promise((r) => setTimeout(r, 300)).then(rotate)]);
  assert.equal(late.status, 503, JSON.stringify(late.data));
  assert.match(late.data.error, /Bitwarden didn't answer in time\. The new one is made once it answers/);
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.match(again.data.error, /being made in the Vault already/);
  fs.rmSync(slowFile);
  await waitFor(() => bwSecret(srv, `Call key: ${bot.name} / ${job.name}`) !== key, { what: 'the new key in the Vault' });
});

test('yeses to a call pressed again and again while Bitwarden works make one key in the Vault, not one each', async (t) => {
  const srv = await startServer({ env: { BW_BIN: FAKE_BW } });
  t.after(() => srv.stop());
  assert.equal((await srv.api('/vault/bitwarden/setup', { method: 'POST', body: { server: 'us', clientId: CLIENT_ID, clientSecret: 'fixture-client-secret' } })).status, 200);
  assert.equal((await srv.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } })).status, 200);
  const bot = await makeBot(srv, { name: 'Kuma Watch' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Alert', kind: 'script', cron: '0 4 1 1 *', script: 'cat' } })).data;
  const at = `/bots/${bot.id}/jobs/${job.id}`;
  assert.equal((await srv.asChief(at, { method: 'PUT', body: { call: true, summary: 'Runs on a call.' } })).data.change?.call, true);
  const answers = await Promise.all([1, 2, 3, 4].map(() => srv.api(`${at}/approve`, { method: 'POST', body: { approve: true } })));
  assert.ok(answers.some((a) => a.status === 200 && a.data.call === true), JSON.stringify(answers.map((a) => a.data)));
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'bitwarden-cli', 'items.json'), 'utf8'));
  assert.equal(kept.filter((x) => x.name === `Call key: ${bot.name} / ${job.name}`).length, 1);
});
