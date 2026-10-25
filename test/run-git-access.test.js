// A bot's AI run signs git in through botdot (ADR 090): SSH_AUTH_SOCK to an ssh-agent botdot serves for that run, and
// git's credential helper, set through GIT_CONFIG_*, which gets a GitHub App login's token from botdot with a key of
// that run alone. Nothing for another host or login; the key and the agent end with the run.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const githubApp = require('../lib/github-app');
const sshAgent = require('../lib/ssh-agent');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');

test('git signs in to a host with the first GitHub App of that GitHub, and with no other login', () => {
  const logins = [
    { name: 'Zed app', type: 'github-app', site: 'api.github.com' },
    { name: 'Repo app', type: 'github-app', site: 'github.com' },
    { name: 'A token', type: 'api-token', site: 'github.com' },
    { name: 'Work', type: 'github-app', site: 'git.example.com' },
  ];
  assert.equal(githubApp.forGitHost(logins, 'github.com'), 'Repo app', 'by name, api.github.com counts as github.com');
  assert.equal(githubApp.forGitHost(logins, 'GitHub.com:443'), 'Repo app');
  assert.equal(githubApp.forGitHost(logins, 'git.example.com'), 'Work', 'a GitHub Enterprise Server by its address');
  assert.equal(githubApp.forGitHost(logins.filter((l) => l.type !== 'github-app'), 'github.com'), null, 'an API token is never handed to git');
  assert.equal(githubApp.forGitHost(logins, 'gitlab.com'), null);
  assert.equal(githubApp.forGitHost(logins, ''), null);
});

test('an agent opened at once listens soon after; one closed before it listens leaves no socket', async () => {
  const a = sshAgent.open(async () => []);
  await a.ready;
  assert.equal(fs.statSync(a.socket).isSocket(), true);
  a.close();
  assert.equal(fs.existsSync(a.socket), false);
  const b = sshAgent.open(async () => []);
  b.close();
  await b.ready;
  assert.equal(fs.existsSync(b.socket), false);
});

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const APP_KEY = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const fill = (env, host) => spawnSync('git', ['credential', 'fill'], {
  input: `protocol=https\nhost=${host}\n\n`, encoding: 'utf8', timeout: 20_000,
  env: { PATH: process.env.PATH, HOME: srv.dir, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', ...env },
});

test("a bot's run has its own agent and git's helper, which asks botdot for its GitHub App and ends with the run", { timeout: 60_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Coder' });
  const saved = await srv.api('/vault', { method: 'POST', body: { name: 'Repo app', site: '127.0.0.1', username: '5237335', password: APP_KEY, type: 'github-app', allowedBots: [bot.id] } });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  const { run, rec } = await heldRun(srv, bot);
  const env = rec.git;
  assert.equal(fs.statSync(env.SSH_AUTH_SOCK).isSocket(), true, 'its agent listens');
  assert.equal(env.GIT_CONFIG_COUNT, '2');
  assert.deepEqual([env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_KEY_1], ['credential.helper', 'core.sshCommand'], 'not taken for a secret by its _KEY_');
  assert.match(env.GIT_CONFIG_VALUE_0, /script-bin\/botdot-git-credential$/);
  assert.equal(env.GIT_CONFIG_VALUE_1, 'ssh -o StrictHostKeyChecking=accept-new');
  assert.ok(env.BOTDOT_GIT && env.BOTDOT_URL);
  assert.equal(JSON.stringify(rec).includes('BEGIN RSA'), false, "the app's key is nowhere in the run");

  // The app's GitHub: botdot makes its token (here GitHub can't be reached, so that is what git hears).
  const app = fill(env, '127.0.0.1');
  assert.notEqual(app.status, 0);
  assert.match(app.stderr, /botdot: Couldn't reach GitHub for the app's token/);
  // Any other host: nothing from botdot, and git goes on as without it.
  const other = fill(env, 'gitlab.example.org');
  assert.notEqual(other.status, 0);
  assert.doesNotMatch(other.stderr, /botdot:/);
  assert.doesNotMatch(other.stdout, /password=/);

  srv.unhold();
  srv.release(rec);
  await srv.finished(run.run?.id || run.id);
  await waitFor(() => !fs.existsSync(env.SSH_AUTH_SOCK), { what: 'its agent to end with the run' });
  const late = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/vault/git/credential`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Run-Token': env.BOTDOT_GIT }, body: JSON.stringify({ protocol: 'https', host: '127.0.0.1' }) });
  assert.equal(late.status, 403, 'the key ends with the run');
});
