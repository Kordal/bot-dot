#!/usr/bin/env node
// Opt-in release acceptance. All installation state lives in a nested Docker daemon;
// the outer host supplies neither its socket nor a published port to that daemon.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { verify } = require('../../lib/release-manifest');

const root = path.resolve(__dirname, '../..');
const legacyRevision = '3fbb9049505541bbae0c0a552554deb08cdd4d55';
const dind = 'docker:28-dind@sha256:2a232a42256f70d78e3cc5d2b5d6b3276710a0de0596c145f627ecfae90282ac';
const cli = 'docker:29.7.2-cli@sha256:3f4743208d2338c934d7b8bcfbe1bb54c0b2355c510ad5e0f31c0c4a54bd704e';
const node = 'node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6';
const expectedRevision = process.argv[2];
const token = process.env.GH_TOKEN;
if (!/^[a-f0-9]{40}$/.test(expectedRevision || '') || !token) throw new Error('Expected revision and GH_TOKEN are required');
delete process.env.GH_TOKEN;

const name = `botdot-signed-upgrade-${process.pid}-${Date.now()}`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const source = path.join(temp, 'source');
const localImage = `${name}:bootstrap`;
const oldImage = 'ghcr.io/kordal/bot-dot:acceptance-bootstrap';
let daemonCreated = false;
let imageCreated = false;
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 20 * 1024 * 1024, ...options }).trim();
const docker = (...args) => run('docker', args);
const inner = (...args) => docker('exec', name, 'docker', ...args);
const compose = (...args) => docker('exec', '-w', '/install', name, 'docker', 'compose', '-p', name, ...args);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, probe, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { last = error.message; }
    await pause(2000);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last}` : ''}`);
}

async function loadImage() {
  await new Promise((resolve, reject) => {
    const save = spawn('docker', ['save', localImage]);
    const load = spawn('docker', ['exec', '-i', name, 'docker', 'load']);
    let error = '';
    save.stderr.on('data', (bytes) => { error += bytes; });
    load.stderr.on('data', (bytes) => { error += bytes; });
    save.on('error', reject);
    load.on('error', reject);
    load.stdin.on('error', reject);
    save.stdout.pipe(load.stdin);
    Promise.all([new Promise((done) => save.on('close', done)), new Promise((done) => load.on('close', done))])
      .then((codes) => codes.some(Boolean) ? reject(new Error(error)) : resolve());
  });
}

const requestScript = `fetch('http://127.0.0.1:4747/api'+process.argv[1],{
  method:process.argv[2],headers:{'content-type':'application/json','x-bot-dot':'1'},
  body:process.argv[3]==='null'?undefined:process.argv[3]
}).then(async response=>console.log(JSON.stringify({status:response.status,data:await response.json()})))
  .catch(error=>{console.error(error.message);process.exit(1)})`;
const currentServer = () => compose('ps', '-q', 'bot-dot');
function api(route, method = 'GET', body) {
  const server = currentServer();
  if (!server) throw new Error('Server is not running');
  return JSON.parse(inner('exec', server, 'node', '-e', requestScript, route, method, JSON.stringify(body ?? null)));
}

async function main() {
  // Confirm the registry's current release manifests with the production trust key.
  process.env.BOT_DOT_REGISTRY_TOKEN = token;
  const registry = require('../../lib/registry');
  const serverRelease = verify(await registry.remoteRelease('ghcr.io/kordal/bot-dot:latest'), { app: 'server', installed: 0 });
  const desktopRelease = verify(await registry.remoteRelease('ghcr.io/kordal/bot-dot-desktop:latest'), { app: 'desktop', installed: 0 });
  assert.equal(serverRelease.revision, expectedRevision);
  assert.equal(desktopRelease.revision, expectedRevision);
  console.log(`Verified production signatures for ${expectedRevision}`);

  // The legacy image is intentionally small, but its HTTP updater and Compose
  // installation are real. Its registry-looking tag exists only inside the daemon.
  fs.mkdirSync(source);
  const archive = execFileSync('git', ['archive', legacyRevision, '.dockerignore', 'server.js', 'package.json', 'lib', 'public', 'chief-skills', 'vendor', 'deploy/desktop', 'compose.yaml', 'compose.mac.yaml'], { cwd: root, maxBuffer: 50 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', source], { input: archive });
  const dockerfile = path.join(temp, 'Bootstrap.Dockerfile');
  fs.writeFileSync(dockerfile, `FROM ${cli} AS cli\nFROM ${node}\nCOPY --from=cli /usr/local/bin/docker /usr/local/bin/docker\nCOPY --from=cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose\nWORKDIR /opt/bot-dot\nCOPY . .\nENV NODE_ENV=production BOT_DOT_DATA=/data BOT_DOT_VAULT_KEY_FILE=/config/vault.key\nLABEL dev.botdot.release.version=0 org.opencontainers.image.revision=${legacyRevision}\nCMD ["node","server.js"]\n`);
  docker('build', '-q', '-f', dockerfile, '-t', localImage, source);
  imageCreated = true;
  docker('run', '-d', '--privileged', '--name', name, '-e', 'DOCKER_TLS_CERTDIR=', dind, 'dockerd', '--host=unix:///var/run/docker.sock', '--storage-driver=overlay2');
  daemonCreated = true;
  await until('isolated Docker daemon', () => inner('info', '--format', '{{.ID}}'));
  const outer = JSON.parse(docker('inspect', name))[0];
  assert.equal(outer.Mounts.some((mount) => mount.Source === '/var/run/docker.sock'), false);
  assert.equal(Object.keys(outer.HostConfig.PortBindings || {}).length, 0);
  await loadImage();
  inner('tag', localImage, oldImage);

  // Authenticate only the nested daemon. The synthetic install and token die
  // with that container; the user's Docker config and running app are untouched.
  const login = spawnSync('docker', ['exec', '-i', name, 'docker', 'login', 'ghcr.io', '-u', 'Kordal', '--password-stdin'], { input: token, encoding: 'utf8', timeout: 60_000 });
  if (login.status !== 0) throw new Error(`Nested registry login failed: ${login.stderr.trim()}`);
  docker('exec', name, 'mkdir', '-p', '/install/data');
  docker('cp', path.join(source, 'compose.yaml'), `${name}:/install/compose.yaml`);
  const envFile = path.join(temp, '.env');
  fs.writeFileSync(envFile, `BOT_DOT_IMAGE=${oldImage}\nBOT_DOT_COMPUTER_IMAGE=ghcr.io/kordal/bot-dot-desktop:latest\nBOT_DOT_REGISTRY_TOKEN=${token}\nHOST=127.0.0.1\nPORT=4747\n`, { mode: 0o600 });
  docker('cp', envFile, `${name}:/install/.env`);
  compose('up', '-d', '--pull', 'never');
  await until('legacy owner HTTP', () => api('/version').status === 200);
  const before = api('/version');
  assert.equal(before.data.revision, legacyRevision);
  const bot = api('/bots', 'POST', { name: 'Signed upgrade acceptance', description: 'synthetic preserved metadata', prompt: 'Do not run. Upgrade acceptance data only.', computer: 'none' });
  assert.equal(bot.status, 201, JSON.stringify(bot));
  inner('exec', currentServer(), 'node', '-e', `const fs=require('node:fs');fs.mkdirSync('/root/.claude',{recursive:true});fs.writeFileSync('/root/.claude/signed-upgrade','synthetic-home');fs.writeFileSync('/config/signed-upgrade','synthetic-config');fs.writeFileSync('/data/signed-upgrade','synthetic-data');`);

  const check = api('/updates/check', 'POST');
  assert.equal(check.status, 200, JSON.stringify(check));
  assert.equal(check.data.error, null, JSON.stringify(check));
  assert.equal(check.data.available, true, JSON.stringify(check));
  const apply = api('/updates/apply', 'POST');
  assert.equal(apply.status, 202, JSON.stringify(apply));
  console.log('Owner HTTP update accepted; waiting for the signed image and desktop pulls');
  await until('signed-image upgrade and restart', () => {
    const response = api('/version');
    return response.status === 200 && response.data.revision === expectedRevision;
  }, 45 * 60_000);
  await until('updated server health and audit finalization', () => {
    const container = JSON.parse(inner('inspect', currentServer()))[0];
    if (container.State.Health?.Status !== 'healthy') return false;
    return inner('exec', currentServer(), 'node', '-e', `const fs=require('node:fs');console.log(fs.readFileSync('/data/audit.log','utf8').split('\\n').filter(Boolean).map(JSON.parse).some(event=>event.action==='update.applied'));`) === 'true';
  }, 5 * 60_000);

  const server = currentServer();
  const container = JSON.parse(inner('inspect', server))[0];
  const helper = JSON.parse(inner('inspect', compose('ps', '-q', 'docker-helper')))[0];
  assert.equal(container.Config.Image, serverRelease.file);
  assert.equal(helper.Config.Image, serverRelease.file);
  assert.equal(container.State.Health.Status, 'healthy');
  assert.equal(container.Mounts.some((mount) => mount.Destination === '/var/run/docker.sock'), false);
  assert.ok(helper.Mounts.some((mount) => mount.Destination === '/var/run/docker.sock'));
  assert.equal(container.Config.Env.some((entry) => entry.startsWith('BOT_DOT_REGISTRY_TOKEN=')), false);
  assert.ok(helper.Config.Env.some((entry) => entry.startsWith('BOT_DOT_REGISTRY_TOKEN=')));
  inner('image', 'inspect', desktopRelease.file);
  const pinnedEnv = docker('exec', name, 'sh', '-c', "grep -E '^BOT_DOT_(IMAGE|COMPUTER_IMAGE)=' /install/.env");
  assert.ok(pinnedEnv.includes(`BOT_DOT_IMAGE=${serverRelease.file}`));
  assert.ok(pinnedEnv.includes(`BOT_DOT_COMPUTER_IMAGE=${desktopRelease.file}`));
  const state = JSON.parse(inner('exec', server, 'node', '-e', `const fs=require('node:fs');const p='/data/audit.log';const processes=fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x)).flatMap(x=>{try{const command=fs.readFileSync('/proc/'+x+'/cmdline','utf8').replaceAll('\\0',' ');return command.includes('server.js')?[fs.readFileSync('/proc/'+x+'/status','utf8')]:[]}catch{return[]}});console.log(JSON.stringify({data:fs.readFileSync('/data/signed-upgrade','utf8'),home:fs.readFileSync('/root/.claude/signed-upgrade','utf8'),config:fs.readFileSync('/config/signed-upgrade','utf8'),audit:fs.readFileSync(p,'utf8'),auditUid:fs.statSync(p).uid,auditMode:fs.statSync(p).mode&511,processes}));`));
  assert.equal(state.data, 'synthetic-data');
  assert.equal(state.home, 'synthetic-home');
  assert.equal(state.config, 'synthetic-config');
  assert.equal(state.auditUid, 60000);
  assert.equal(state.auditMode, 0o600);
  assert.ok(state.audit.split('\n').filter(Boolean).map(JSON.parse).some((event) => event.action === 'update.applied'));
  assert.ok(state.processes.some((status) => /^Uid:\s+60000\s+60000\s+60000\s+60000/m.test(status)));
  const bots = api('/bots');
  assert.equal(bots.status, 200);
  assert.ok(bots.data.some((saved) => saved.id === bot.data.id));
  const status = api('/updates/check', 'POST');
  assert.equal(status.status, 200);
  assert.equal(status.data.error, null, JSON.stringify(status));
  assert.equal(status.data.remote, `sha256:${serverRelease.sha256}`);
  assert.equal(status.data.version.image, serverRelease.file);
  assert.equal(status.data.available, false);
  console.log(JSON.stringify({ result: 'PASS', revision: expectedRevision, image: serverRelease.file, desktop: desktopRelease.file, syntheticBot: bot.data.id, auditUid: state.auditUid, serverUid: 60000, isolatedDaemon: true }));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(() => {
  if (daemonCreated) { try { docker('rm', '-fv', name); } catch (error) { console.error(`Isolated daemon cleanup failed: ${error.message}`); process.exitCode = 1; } }
  if (imageCreated) { try { docker('image', 'rm', localImage); } catch (error) { console.error(`Bootstrap image cleanup failed: ${error.message}`); process.exitCode = 1; } }
  fs.rmSync(temp, { recursive: true, force: true });
});
