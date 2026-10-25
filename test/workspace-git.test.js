// Git for bots: no empty repository at the top of a bot's workspace, git stops at the workspaces, and each bot
// commits under its own name, on the botdot server and on the account's computer, unless something it or a
// repository sets says otherwise (lib/workspace-git.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const childProcess = require('node:child_process');
const { spawnSync } = childProcess;
const workspaceGit = require('../lib/workspace-git');
const { startServer, makeBot, heldRun } = require('./helpers');

const NO_GIT = spawnSync('git', ['--version']).error?.code === 'ENOENT';
// git as a bot runs it: no identity of the machine's own, only what env gives.
const git = (cwd, args, env = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(cwd, '.no-home'), GIT_CONFIG_NOSYSTEM: '', ...env } });
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

test('only a repository nothing was done in counts as empty', { skip: NO_GIT }, () => {
  const dir = tmp('empty-repo');
  try {
    const repo = (name) => { const d = path.join(dir, name); fs.mkdirSync(d); git(d, ['init', '-q']); return d; };
    assert.equal(workspaceGit.emptyRepo(path.join(repo('fresh'), '.git')), true);
    const remote = repo('remote');
    git(remote, ['remote', 'add', 'origin', 'https://example.com/x.git']);
    assert.equal(workspaceGit.emptyRepo(path.join(remote, '.git')), false, 'a remote');
    const staged = repo('staged');
    fs.writeFileSync(path.join(staged, 'a.txt'), 'a');
    git(staged, ['add', 'a.txt']);
    assert.equal(workspaceGit.emptyRepo(path.join(staged, '.git')), false, 'a staged file');
    const committed = repo('committed');
    git(committed, ['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '--allow-empty', '-m', 'x']);
    assert.equal(workspaceGit.emptyRepo(path.join(committed, '.git')), false, 'a commit');
    fs.mkdirSync(path.join(dir, 'worktree'));
    fs.writeFileSync(path.join(dir, 'worktree', '.git'), 'gitdir: /elsewhere\n');
    assert.equal(workspaceGit.emptyRepo(path.join(dir, 'worktree', '.git')), false, 'a .git file');
    assert.equal(workspaceGit.emptyRepo(path.join(dir, 'none', '.git')), false, 'none at all');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('preparing a workspace removes only an empty repository, and writes the identity only when it changed', { skip: NO_GIT }, () => {
  const dir = tmp('prepare');
  try {
    const ws = path.join(dir, 'ws');
    fs.mkdirSync(ws);
    git(ws, ['init', '-q']);
    const identity = { file: path.join(dir, 'home', '.botdot-gitconfig'), content: workspaceGit.identityConfig('b1', 'Coder') };
    workspaceGit.prepare(ws, identity);
    assert.equal(fs.existsSync(path.join(ws, '.git')), false);
    assert.equal(fs.readFileSync(identity.file, 'utf8'), identity.content);
    fs.utimesSync(identity.file, new Date(0), new Date(0));
    workspaceGit.prepare(ws, identity);
    assert.equal(fs.statSync(identity.file).mtimeMs, 0, 'the same identity is not written again');
    workspaceGit.prepare(ws, { ...identity, content: workspaceGit.identityConfig('b1', 'Renamed') });
    assert.match(fs.readFileSync(identity.file, 'utf8'), /Renamed/, 'a new name is');
    git(ws, ['init', '-q']);
    git(ws, ['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '--allow-empty', '-m', 'x']);
    workspaceGit.prepare(ws, identity);
    assert.equal(fs.existsSync(path.join(ws, '.git')), true, "the bot's own repository stays");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("git commits under the bot's name from the system level, and what a repository sets wins", { skip: NO_GIT }, () => {
  const dir = tmp('identity');
  try {
    const file = path.join(dir, 'gitconfig');
    fs.writeFileSync(file, workspaceGit.identityConfig('b1', 'Ops "Night" \\ Bot\nevil = 1'));
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    git(repo, ['init', '-q']);
    const env = { GIT_CONFIG_SYSTEM: file };
    assert.equal(git(repo, ['config', 'user.name'], env).stdout.trim(), 'Ops "Night" \\ Bot evil = 1', 'one line, quoted as it was');
    assert.equal(git(repo, ['config', 'user.email'], env).stdout.trim(), 'b1@bots.botdot.invalid');
    assert.equal(git(repo, ['config', '--get-all', 'user.evil'], env).status, 1, 'no key of its own');
    const r = git(repo, ['commit', '-q', '--allow-empty', '-m', 'first'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(repo, ['log', '-1', '--format=%an <%ae>'], env).stdout.trim(), 'Ops "Night" \\ Bot evil = 1 <b1@bots.botdot.invalid>');
    git(repo, ['config', 'user.email', 'owner@example.com'], env);
    assert.equal(git(repo, ['config', 'user.email'], env).stdout.trim(), 'owner@example.com');
    assert.equal(workspaceGit.identityConfig('b2', ' \n '), '[include]\n\tpath = /etc/gitconfig\n[user]\n\tname = "b2"\n\temail = "b2@bots.botdot.invalid"\n', 'no name: the id');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a bot's run has no repository of its own: git stops at the workspaces, and commits a clone under the bot's name", { skip: NO_GIT }, async () => {
  const srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Repo Keeper' });
    const { rec } = await heldRun(srv, bot);
    srv.unhold(); srv.release(rec);
    const ws = path.join(srv.data, 'workspaces', bot.id);
    assert.equal(rec.git.GIT_CEILING_DIRECTORIES, path.join(srv.data, 'workspaces'));
    assert.equal(rec.git.GIT_CONFIG_SYSTEM, path.join(srv.data, 'homes', bot.id, '.botdot-gitconfig'));
    assert.equal(fs.existsSync(path.join(ws, '.git')), false, 'no empty repository');
    // In the workspace itself git finds nothing, not even a repository the data folder sits in.
    git(srv.data, ['init', '-q']);
    assert.match(git(ws, ['status'], rec.git).stderr, /not a git repository/);
    const clone = path.join(ws, 'project');
    fs.mkdirSync(clone);
    git(clone, ['init', '-q']);
    const r = git(clone, ['commit', '-q', '--allow-empty', '-m', 'x'], rec.git);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(clone, ['log', '-1', '--format=%an <%ae>'], rec.git).stdout.trim(), `Repo Keeper <${bot.id}@bots.botdot.invalid>`);
  } finally { await srv.stop(); }
});

test("each command on the account's computer has the bot's identity in a file of its own, written once", { skip: NO_GIT }, async () => {
  const calls = [];
  const realExecFile = childProcess.execFile;
  const fake = (file, args, opts, cb) => { calls.push(args); setImmediate(() => cb(null, '', '')); return { stdin: { on() {}, end() {} } }; };
  fake[util.promisify.custom] = async () => ({ stdout: '', stderr: '' });
  childProcess.execFile = fake;
  delete require.cache[require.resolve('../lib/computers')];
  const dir = tmp('computer-git');
  try {
    const computers = require('../lib/computers');
    await computers.runShell({ bot: 'ops', screen: 1, name: 'Night Ops' }, { command: 'git commit' });
    const args = calls.pop();
    const env = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === '-e' ? [a.split(/=(.*)/s).slice(0, 2)] : [])));
    assert.equal(env.GIT_CONFIG_SYSTEM, '/home/box/.config/botdot/git/ops');
    assert.equal(env.BOTDOT_GIT, workspaceGit.identityConfig('ops', 'Night Ops').trimEnd());
    // The script the computer runs, here with its file in a folder of the test's.
    const at = args.indexOf('-c', args.indexOf('sh'));
    const script = args[at + 1];
    const file = path.join(dir, 'box', 'git', 'ops');
    const run = () => spawnSync('sh', ['-c', script, 'sh', path.join(dir, 'ws'), 'git config user.name; echo "[$BOTDOT_GIT]"'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_SYSTEM: file, BOTDOT_GIT: env.BOTDOT_GIT } });
    assert.equal(run().stdout, 'Night Ops\n[]\n', 'git has the name, and the command not the variable');
    assert.equal(fs.readFileSync(file, 'utf8'), workspaceGit.identityConfig('ops', 'Night Ops'));
    fs.utimesSync(file, new Date(0), new Date(0));
    run();
    assert.equal(fs.statSync(file).mtimeMs, 0, 'the same identity is not written again');
  } finally {
    childProcess.execFile = realExecFile;
    delete require.cache[require.resolve('../lib/computers')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
