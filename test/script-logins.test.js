// A script job that uses Vault logins (ADR 085): its job lists them (`logins`, up to 8), the owner approves them with
// the script, and the script calls an API with botdot-request. botdot sends the request, with the values in its
// headers only, to the login's own address, and blanks the secret out of the answer. The command works only while
// that job's run goes, on that run's own key, and only with the logins its job lists.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jobs = require('../lib/jobs');
const { startServer, makeBot, waitFor } = require('./helpers');

// ---------- the job's list ----------

const SCRIPT = { name: 'Open issues', kind: 'script', cron: '0 8 * * *', script: 'botdot-request --login GitHub GET https://api.github.com/x' };

test('a script job lists its logins: trimmed, each once, up to 8; an AI job has none', () => {
  const j = jobs.normalizeJob({ ...SCRIPT, logins: [' GitHub ', 'github', 'Proxmox'] });
  assert.deepEqual(j.logins, ['GitHub', 'Proxmox'], 'the same name in another case is the same login');
  assert.equal('logins' in jobs.normalizeJob({ ...SCRIPT, logins: [] }), false, 'none: no logins on the job, as before');
  assert.equal('logins' in jobs.normalizeJob({ ...SCRIPT, kind: 'ai', script: '', logins: ['GitHub'] }), false);
  assert.throws(() => jobs.normalizeJob({ ...SCRIPT, logins: Array.from({ length: 9 }, (_, i) => `L${i}`) }), /up to 8 logins, not 9/);
  assert.throws(() => jobs.normalizeJob({ ...SCRIPT, logins: 'GitHub' }), /list of login names/);
  assert.throws(() => jobs.normalizeJob({ ...SCRIPT, logins: ['GitHub', ''] }), /list of login names/);
  assert.deepEqual(jobs.definitionOf(j).logins, ['GitHub', 'Proxmox'], 'the owner approves them with the script');
});

test('a script job the Chief sets up waits with its logins; a login added later waits, even on a job the owner always approves', () => {
  const asked = jobs.normalizeJob({ ...SCRIPT, logins: ['GitHub'] }, null, 'chief');
  assert.equal(asked.approved, false);
  const approved = { ...asked, approved: true, alwaysApprove: true };
  // A change of the script alone is approved at once on a job the owner always approves…
  const edited = jobs.normalizeJob({ script: 'echo 1' }, approved, 'chief');
  assert.equal(edited.change, undefined);
  assert.deepEqual(edited.logins, ['GitHub']);
  // …but one more login waits beside the approved job, which keeps its own list meanwhile.
  const more = jobs.normalizeJob({ logins: ['GitHub', 'Proxmox'], summary: 'Also reads the Proxmox API' }, approved, 'chief');
  assert.deepEqual(more.logins, ['GitHub']);
  assert.deepEqual(more.change.job.logins, ['GitHub', 'Proxmox']);
  // A login fewer is no new login: on such a job it is made at once.
  const fewer = jobs.normalizeJob({ logins: [] }, { ...approved, logins: ['GitHub', 'Proxmox'] }, 'chief');
  assert.equal(fewer.change, undefined);
  assert.equal('logins' in fewer, false);
  // On a job approved one by one, any change of the list waits.
  const strict = jobs.normalizeJob({ logins: [] }, { ...approved, alwaysApprove: false }, 'chief');
  assert.deepEqual(strict.logins, ['GitHub']);
  assert.equal('logins' in strict.change.job, false);
  // The owner's own edit is made at once.
  assert.deepEqual(jobs.normalizeJob({ logins: ['GitHub', 'Proxmox'] }, approved, 'you').logins, ['GitHub', 'Proxmox']);
  // A bot's own edit of its approved job waits too.
  assert.ok(jobs.normalizeJob({ logins: ['GitHub', 'Proxmox'], summary: 'x' }, { ...approved, alwaysApprove: false }, 'bot').change);
});

// ---------- botdot-request ----------

let srv;
let api;
before(async () => {
  srv = await startServer();
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.statusCode = req.url === '/missing' ? 404 : 200;
    res.end(`{"key":"${req.headers['x-key']}","path":"${req.url}"}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  api = { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
});
after(async () => { api.close(); await srv.stop(); });

const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
async function runScript(bot, fields) {
  const add = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Count', kind: 'script', cron: '0 3 * * *', aiWhen: 'never', ...fields } });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  const job = add.data.job || add.data;
  const before = (await runsOf(bot)).length;
  const r = await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return waitFor(async () => { const runs = await runsOf(bot); return runs.length > before ? runs.find((x) => x.kind === 'script' && x.jobId === job.id && x.status !== 'running') : null; }, { timeout: 20_000, what: 'the script to end' });
}

test('a script calls an API with its job\'s login: the value goes in the header, never back to the script', { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Counter' });
  const other = await makeBot(srv, { name: 'Other' });
  await srv.api('/vault', { method: 'POST', body: { name: 'Issues token', site: '127.0.0.1', password: 'tok-value-0001', allowedBots: [bot.id] } });
  await srv.api('/vault', { method: 'POST', body: { name: 'Spare', site: '127.0.0.1', password: 'spare-value-0002', allowedBots: [bot.id] } });

  const run = await runScript(bot, {
    logins: ['Issues token'],
    script: [
      `botdot-request --login "issues token" -H 'X-Key: {{token}}' GET ${api.url}/repos; echo " exit=$?"`,
      `botdot-request --login "Issues token" -H 'X-Key: {{token}}' ${api.url}/missing >/dev/null 2>&1; echo "missing=$?"`,
      `botdot-request --login Spare -H 'X-Key: {{token}}' ${api.url}/x; echo "spare=$?"`,
      `env | grep -c tok-value-0001`,
      'echo "key=$BOTDOT_RUN"',
    ].join('\n'),
  });
  assert.equal(api.seen[0]['x-key'], 'tok-value-0001', 'botdot filled the value in');
  assert.match(run.result, /\{"key":"\[hidden\]","path":"\/repos"\} exit=0/, 'and blanked it out of the answer');
  assert.match(run.result, /missing=22/, 'an answer of 400 or more ends with 22, as curl -f');
  assert.match(run.result, /This job may use only the logins it lists \("Issues token"\), not "Spare"\.[^\n]*\nspare=1/);
  assert.match(run.result, /^0$/m, 'no value in the script\'s environment');
  assert.ok(!run.result.includes('tok-value-0001') && !run.result.includes('spare-value-0002'));
  assert.equal(api.seen.length, 2, 'the login the job does not list sent nothing');

  // The run's key works only while its run goes.
  const key = run.result.match(/key=(\S+)/)[1];
  const late = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/vault/script/http`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Run-Token': key }, body: JSON.stringify({ login: 'Issues token', url: `${api.url}/late` }) });
  assert.equal(late.status, 403);
  assert.equal(api.seen.length, 2);
  // Its bot's login, and only its bot's: another bot's job cannot list a login that is not shared with it.
  const theirs = await runScript(other, { logins: ['Issues token'], script: `botdot-request --login "Issues token" ${api.url}/y; echo "theirs=$?"` });
  assert.match(theirs.result, /theirs=1/);
  assert.equal(api.seen.length, 2);
  assert.match(srv.log.join(''), /\[vault\] \S+ job \S+ GET 127\.0\.0\.1\/repos with "Issues token": 200/);
});

test('without logins on its job a script has no botdot-request key', { timeout: 30_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Plain' });
  const run = await runScript(bot, { script: `echo "run=[$BOTDOT_RUN]"; ${process.execPath} ${require.resolve('../lib/script-bin/botdot-request')} --login X ${api.url}/z; echo "code=$?"` });
  assert.match(run.result, /run=\[\]/);
  assert.match(run.result, /works only in a script job's run whose job lists the logins it uses[^\n]*\ncode=1/);
});

test("web: a script job's settings show its logins, read-only; a job without any shows nothing", () => {
  const vm = require('vm');
  const { cut, esc } = require('./web-page');
  const ctx = vm.createContext({ esc });
  vm.runInContext(`${cut('const jobLoginsLine = ', 'const jobNotifyLine = ')}\nthis.jobLoginsLine = jobLoginsLine;`, ctx);
  assert.equal(ctx.jobLoginsLine({ kind: 'script' }), '');
  assert.equal(ctx.jobLoginsLine({ kind: 'ai', logins: ['A'] }), '');
  assert.equal(ctx.jobLoginsLine({ kind: 'script', logins: ['GitHub <token>', 'Proxmox'] }), '<div class="faint job-logins">Logins: GitHub &lt;token&gt;, Proxmox</div>');
});
