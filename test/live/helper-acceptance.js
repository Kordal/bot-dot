// Opt-in, isolated daemon: never expose the host Docker socket to the helper under test.
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { waitFor } = require('../helpers');
const ROOT = path.resolve(__dirname, '../..');
const DIND = 'docker:28-dind@sha256:2a232a42256f70d78e3cc5d2b5d6b3276710a0de0596c145f627ecfae90282ac';
const NODE = 'node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6';
async function setup() {
  const name = `botdot-acceptance-${process.pid}-${Date.now()}`;
  const image = `${name}:test`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const docker = async (...args) => (await promisify(execFile)('docker', args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
  const inner = (...args) => docker('exec', name, 'docker', ...args);
  const input = (args, data) => new Promise((resolve, reject) => {
    const p = spawn('docker', args, { timeout: 300000 }); let out = ''; let err = '';
    p.stdout.on('data', c => out += c); p.stderr.on('data', c => err += c);
    p.on('error', reject); p.on('close', code => code !== 0 ? reject(new Error(err)) : resolve(out.trim()));
    p.stdin.on('error', reject); p.stdin.end(data);
  });
  const cleanup = async () => {
    await docker('rm', '-fv', name).catch(() => {});
    await docker('image', 'rm', image).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    const file = path.join(dir, 'Dockerfile');
    fs.writeFileSync(file, `FROM ${DIND} AS dockercli\nFROM ${NODE}\nCOPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker\nWORKDIR /opt/bot-dot\nCOPY . .\n`);
    console.log('Building scratch server/helper image');
    await docker('build', '-q', '-f', file, '-t', image, ROOT);
    await docker('run', '-d', '--privileged', '--name', name, '-e', 'DOCKER_TLS_CERTDIR=', '-p', '127.0.0.1::4747', DIND, 'dockerd', '--host=unix:///var/run/docker.sock', '--storage-driver=overlay2');
    await waitFor(() => inner('info').catch(() => false), { timeout: 60000, what: 'isolated Docker daemon' });
    console.log('Loading images into isolated Docker daemon');
    await new Promise((resolve, reject) => {
      const save = spawn('docker', ['save', image, 'bot-dot/desktop:latest'], { timeout: 600000 });
      const load = spawn('docker', ['exec', '-i', name, 'docker', 'load'], { timeout: 600000 });
      load.stdin.on('error', reject);
      let err = ''; save.stderr.on('data', c => err += c); load.stderr.on('data', c => err += c);
      save.on('error', reject); load.on('error', reject); save.stdout.pipe(load.stdin);
      Promise.all([new Promise(r => save.on('close', r)), new Promise(r => load.on('close', r))]).then(codes => codes.some(code => code !== 0) ? reject(new Error(err)) : resolve());
    });
    const environment = { HOST: '0.0.0.0', PORT: '4747', BOT_DOT_DATA: '/data', BOT_DOT_VAULT_KEY_FILE: '/config/vault.key', BOT_DOT_HELPER_SOCKET: '/run/botdot/helper.sock', BOT_DOT_SEPARATE_USERS: '1', BOT_DOT_PRIVILEGE_SOCKET: '/run/botdot-privilege/broker.sock', EMBED_SERVER_BIN: '/nonexistent', CLAUDE_BIN: '/nonexistent', BW_BIN: '/nonexistent', COMPOSIO_API_URL: 'http://127.0.0.1:9' };
    const compose = JSON.stringify({ services: {
      'bot-dot': { image, command: ['node', 'lib/privilege-broker.js'], cap_drop: ['ALL'], cap_add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID', 'KILL'], security_opt: ['no-new-privileges:true'], ports: ['4747:4747'], environment, volumes: ['data:/data', 'config:/config', 'home:/root', 'helper:/run/botdot:ro'] },
      'docker-helper': { image, command: ['node', 'lib/docker-helper.js'], environment: { BOT_DOT_COMPUTER_IMAGE: 'bot-dot/desktop:latest', BOT_DOT_PLATFORM: 'linux' }, volumes: ['helper:/run/botdot', '/var/run/docker.sock:/var/run/docker.sock'] },
    }, volumes: { data: {}, config: {}, home: {}, helper: {} } });
    const composeRun = (...args) => input(['exec', '-i', name, 'docker', 'compose', '-p', name, '-f', '-', ...args], compose);
    // Synthetic legacy state, written as root before the first supervisor startup.
    const markers = { '/root/.claude/acceptance.json': 'synthetic-claude-state', '/data/bitwarden-cli/acceptance.json': 'synthetic-bitwarden-state', '/config/vault.key': 'a'.repeat(64) + '\n' };
    await composeRun('run', '--rm', '--no-deps', '--entrypoint', 'node', 'bot-dot', '-e',
      'const fs=require("fs"),path=require("path");for(const [p,v] of Object.entries(JSON.parse(process.argv[1]))){fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,v,{mode:0o600});}', JSON.stringify(markers));
    console.log('Starting isolated server and helper');
    await composeRun('up', '-d');
    const port = (await docker('port', name, '4747/tcp')).split(':').at(-1);
    const base = `http://127.0.0.1:${port}`;
    const api = async (p, method = 'GET', body) => {
      const res = await fetch(`${base}/api${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, data: await res.json() };
    };
    await waitFor(() => api('/version').then(r => r.status === 200).catch(() => false), { timeout: 30000, what: 'server HTTP' });
    const server = await composeRun('ps', '-q', 'bot-dot');
    const helper = (operation, args) => inner('exec', '--user', '60000:60000', server, 'node', '-e', 'require("./lib/helper-client").call(process.argv[1],JSON.parse(process.argv[2])).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exit(1)})', operation, JSON.stringify(args)).then(JSON.parse);
    await waitFor(() => helper('listAll', []).then(() => true).catch(() => false), { timeout: 30000, what: 'helper accessible to server UID' });
    return { name, dir, base, api, helper, docker, inner, composeRun, server, markers, cleanup };
  } catch (e) { await cleanup(); throw e; }
}
module.exports = { setup };
