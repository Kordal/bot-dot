// How the stages that install botdot in a nested Docker daemon build a test install (install-real): the stand-in
// images of this checkout, and test machines to install them on.
//
// A test machine is an Ubuntu 24.04 container (privileged, no systemd) with the machine's own Docker (docker-ce, as
// Docker's packages install it), rootless Docker and gVisor's runsc, which install.sh gives each account (ADR 028).
// It shares neither socket nor port with this machine's. It has a local registry at https://registry.test:5000 (a
// container named `registry`, on its host network, which the accounts' rootless Dockers reach on the machine's own
// address) and the real install.sh in /root, with the source it checks signatures with, which trusts the test key
// (TEST_KEY): a case signs what it publishes with machine.sign. A stand-in image is built by this machine's daemon,
// so its layers stay in the build cache from run to run, and loaded into the machine that needs it.
//
//   const stage = createStage('install-real');
//   stage.run(async () => {
//     const machine = await stage.machine();
//     await machine.load(stage.server());
//     machine.publish(stage.server(), `${SERVER}:latest`);
//     machine.sign(`${SERVER}:latest`, { app: 'server' });
//     const said = machine.install({ BOT_DOT_IMAGE: `${SERVER}:latest` });
//     machine.signUp(said);               // the admin's passkey, through Caddy
//     machine.api('GET', '/api/version'); // the admin's botdot server, through the front door
//   });
//
// A stage removes what it made when it ends, also when it fails or is interrupted. With `keep` it leaves the
// machines there, to look at a failure: docker exec <machine> docker ...
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const arg = (name) => dockerfile.match(new RegExp(`^ARG ${name}=(.+)$`, 'm'))?.[1];
const NODE_IMAGE = arg('NODE_IMAGE'), CLI_IMAGE = arg('DOCKER_CLI_IMAGE');
assert.ok(NODE_IMAGE && CLI_IMAGE, 'the Dockerfile no longer names NODE_IMAGE and DOCKER_CLI_IMAGE');
// The test machine: Ubuntu 24.04, Docker's own packages at one version, gVisor at one release (as gvisor-real), and
// docker:dind's start script, which readies a container for a Docker daemon.
const DIND = 'docker:28-dind@sha256:2a232a42256f70d78e3cc5d2b5d6b3276710a0de0596c145f627ecfae90282ac'; // as test/live/signed-image-upgrade.js
const UBUNTU = 'ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55';
const DOCKER_CE = '5:29.9.1-1~ubuntu.24.04~noble';
const GVISOR = 'https://storage.googleapis.com/gvisor/releases/release/20261005.0';
const GVISOR_SHA256 = { amd64: '0a8a9058b9f11791a2097f03190c2ddc5b963c3dbee5bb9fd8497f4801c42f92', arm64: 'f8bd7cb4e989db445255c20e6c2962498e5b5bd1ec1407bfcf187fbd5f184a2a' };
const REGISTRY_IMAGE = 'registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373';
const REGISTRY = 'registry.test:5000';
// Where the official images would be, in the local registry.
const SERVER = `${REGISTRY}/kordal/bot-dot`, DESKTOP = `${REGISTRY}/kordal/bot-dot-desktop`;
// The name a test install answers on, with Caddy's own certificate authority (BOT_DOT_TLS=internal), and its admin.
const DOMAIN = 'botdot.test', ADMIN = 'ann';
const DIR = '/var/lib/botdot', RUN_DIR = '/run/botdot-accounts';
// The checked-in test key (docs/release-signing.md): what the stage signs with, and its machines trust.
const TEST_KEY = fs.readFileSync(path.join(root, 'test/fixtures/release-signing/private.pem'));
const TEST_PUBLIC_KEY = fs.readFileSync(path.join(root, 'test/fixtures/release-signing/public.der.b64'), 'utf8').trim();
const { canonical } = require('../../lib/release-manifest');
const { RELEASE_TAG } = require('../../lib/registry');
const passkey = require('../../test/fixtures/soft-passkey');
const MANIFEST_TYPES = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].join(', ');

const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
const docker = (...args) => run('docker', args);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, probe, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    try { const value = await probe(); if (value) return value; } catch (error) { last = error.message; }
    await pause(1000);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last}` : ''}`);
}

// --- The stand-in images ---------------------------------------------------------------------------

// The server: this checkout's lib/ on the Dockerfile's Node and Docker CLI, without Claude Code, llama.cpp
// and the model. compose.yaml, the helper and the server in it are the real ones, as committed (HEAD); install.sh
// is taken as it is in the working tree.
function buildServer(tag, temp) {
  const context = path.join(temp, 'server');
  fs.mkdirSync(context);
  execFileSync('tar', ['-x', '-C', context], { input: execFileSync('git', ['archive', 'HEAD', 'server.js', 'front-door.js', 'package.json', 'lib', 'public', 'chief-skills', 'vendor', 'deploy/desktop', 'compose.yaml', 'compose.front-door.yaml', 'compose.mac.yaml'], { cwd: root, maxBuffer: 256 * 1024 * 1024 }) });
  fs.writeFileSync(path.join(temp, 'server.Dockerfile'), [
    `FROM ${CLI_IMAGE} AS cli`, `FROM ${NODE_IMAGE}`,
    'COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker',
    'COPY --from=cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose',
    'WORKDIR /opt/bot-dot', 'COPY . .',
    'ENV NODE_ENV=production BOT_DOT_DATA=/data BOT_DOT_VAULT_KEY_FILE=/config/vault.key PORT=4747',
    'VOLUME ["/data", "/config", "/root"]',
    // The Dockerfile's check, with Node in place of curl.
    `HEALTHCHECK --interval=2s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`,
    'USER 0:0', 'CMD ["node", "lib/privilege-broker.js"]', '',
  ].join('\n'));
  docker('build', '-q', '-f', path.join(temp, 'server.Dockerfile'), '-t', tag, context);
}

// The account's computer (ADR 035): what lib/computers.js needs of cua's desktop to start it, secure its network
// and start a bot's screen on it, and nothing else. Its users box and browser, python3 (botdot reaches the computer
// through it), iptables (the computer's firewall), supervisor (each bot's screen is a supervisord with botdot's
// deploy/desktop/botdot-screen.conf, #105), procps (botdot-tailscale ends a bot's old Tailscale with pkill, #106), a computer-server that answers /status on the screen's port, and the
// label of a desktop made for the account's computer. The screen's desktop has no VNC server here, so it stops,
// and noVNC and the browser bridge's interpreter end at once: the stand-in has no desktop and no Camoufox.
const COMPUTER_SERVER = `# The stand-in for cua's computer-server: it answers /status on its port, which botdot waits for as a screen starts.
import http.server, signal, sys
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
class Status(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == '/status' else 404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"status": "ok"}' if self.path == '/status' else b'{}')
    def log_message(self, *_):
        pass
http.server.HTTPServer(('127.0.0.1', int(sys.argv[1])), Status).serve_forever()
`;
function buildComputer(tag, temp) {
  const context = path.join(temp, 'computer');
  fs.mkdirSync(context);
  fs.writeFileSync(path.join(context, 'computer-server.py'), COMPUTER_SERVER);
  fs.writeFileSync(path.join(context, 'Dockerfile'), [
    `FROM ${NODE_IMAGE}`,
    'RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 iptables supervisor procps && rm -rf /var/lib/apt/lists/*',
    'RUN useradd --create-home --shell /bin/bash box && useradd --create-home --shell /usr/sbin/nologin --groups box browser'
      + ' && install -d -o box -g box -m 2775 /workspace && install -d -o browser -g browser -m 0700 /run/botdot-browser /home/browser/profiles'
      + ' && install -d -o box -g box -m 0755 /run/botdot-desktop /var/log/supervisor',
    // cua's Python, as botdot-screen.conf starts it: `-m computer_server --host 0.0.0.0 --port <port>` is the stand-in
    // server on that port, anything else (noVNC's websockify) ends.
    "RUN mkdir -p /opt/computer-server/venv/bin && printf '#!/bin/sh\\n[ \"$2\" = computer_server ] && exec python3 /usr/local/lib/computer-server.py \"$6\"\\nexit 0\\n' > /opt/computer-server/venv/bin/python && chmod 755 /opt/computer-server/venv/bin/python",
    "RUN mkdir -p /opt/camoufox/bin && printf '#!/bin/sh\\nexit 0\\n' > /opt/camoufox/bin/python && chmod 755 /opt/camoufox/bin/python",
    'COPY computer-server.py /usr/local/lib/computer-server.py',
    'LABEL botdot.desktop="stand-in" botdot.user-version="2"',
    'HEALTHCHECK NONE', 'ENTRYPOINT []', 'CMD ["sleep", "infinity"]', '',
  ].join('\n'));
  docker('build', '-q', '-t', tag, context);
}

// --- A test machine --------------------------------------------------------------------------------

function buildMachine(tag, temp) {
  const context = path.join(temp, 'machine');
  fs.mkdirSync(context);
  fs.writeFileSync(path.join(context, 'Dockerfile'), [
    ...Object.entries(GVISOR_SHA256).flatMap(([arch, sha]) => [`FROM scratch AS gvisor-${arch}`, `ADD --checksum=sha256:${sha} ${GVISOR}/${arch === 'amd64' ? 'x86_64' : 'aarch64'}/gvisor.tar.zstd /gvisor.tar.zstd`]),
    'FROM gvisor-${TARGETARCH} AS gvisor',
    `FROM ${DIND} AS dind`,
    `FROM ${UBUNTU}`,
    'RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl iproute2 iptables uidmap slirp4netns acl zstd'
      + ' && install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc'
      + ' && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list'
      + ` && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker-ce=${DOCKER_CE} docker-ce-cli=${DOCKER_CE} docker-ce-rootless-extras=${DOCKER_CE} containerd.io docker-compose-plugin`
      + ' && rm -rf /var/lib/apt/lists/*',
    'RUN --mount=from=gvisor,source=/gvisor.tar.zstd,target=/tmp/gvisor.tar.zstd zstd -dc /tmp/gvisor.tar.zstd | tar -x -C /usr/local/bin runsc gvisor-bin && runsc --version',
    'COPY --from=dind /usr/local/bin/dind /usr/local/bin/dind',
    // On the container's own filesystem neither Docker could lay its images over another overlay.
    'VOLUME ["/var/lib/docker", "/var/lib/botdot"]',
    'ENTRYPOINT ["dind"]',
    'CMD ["dockerd", "--host=unix:///var/run/docker.sock"]', '',
  ].join('\n'));
  docker('build', '-q', '-t', tag, context);
}

// An account's Docker on the machine (install.sh: its rootless Docker's socket).
const accountDocker = (account) => ['env', `DOCKER_HOST=unix://${RUN_DIR}/${account}/docker.sock`, 'docker'];

// The last lines of an install's services, for a failure's report: the front door, root's step for new accounts,
// and each account's botdot server and Docker.
const logsOf = (name) => [
  ['front door', ['docker', 'compose', '--project-directory', `${DIR}/front-door`, 'logs', '--tail', '40']],
  ["root's step", ['tail', '-n', '60', `${DIR}/requests.log`]],
  ...(() => { try { return run('docker', ['exec', name, 'ls', `${DIR}/accounts`]).split('\n').filter(Boolean); } catch { return [ADMIN]; } })().flatMap((account) => [
    [`${account}'s botdot`, [...accountDocker(account), 'compose', '--project-directory', `${DIR}/accounts/${account}`, 'logs', '--tail', '40']],
    [`${account}'s Docker`, ['tail', '-n', '40', `${DIR}/accounts/${account}/docker.log`]],
  ]),
].map(([what, args]) => {
  try { return `--- ${name}: ${what}\n${run('docker', ['exec', name, ...args])}`; } catch { return ''; }
}).filter(Boolean).join('\n');

async function startMachine(name, { image, step }) {
  docker('run', '-d', '--privileged', '--name', name, '-e', 'DOCKER_TLS_CERTDIR=', image);
  const inner = (...args) => docker('exec', name, 'docker', ...args);
  const machine = {
    name,
    // docker in the machine, and any command in it.
    inner,
    exec: (...args) => docker('exec', name, ...args),
    innerInput: (input, ...args) => run('docker', ['exec', '-i', name, ...args], { input }),
    idOf: (reference) => inner('image', 'inspect', '--format', '{{.Id}}', reference),

    // An image of this machine's daemon, handed to the nested one.
    load: (image) => new Promise((resolve, reject) => {
      const save = spawn('docker', ['save', image]);
      const into = spawn('docker', ['exec', '-i', name, 'docker', 'load']);
      let error = '';
      save.stderr.on('data', (bytes) => { error += bytes; });
      into.stderr.on('data', (bytes) => { error += bytes; });
      save.on('error', reject); into.on('error', reject); into.stdin.on('error', reject);
      save.stdout.pipe(into.stdin);
      Promise.all([new Promise((done) => save.on('close', done)), new Promise((done) => into.on('close', done))])
        .then((codes) => codes.some(Boolean) ? reject(new Error(error)) : resolve());
    }),

    // An image of the nested daemon goes to the local registry as `reference`, and neither name stays in
    // the daemon: whoever needs it has to pull it.
    publish(image, reference) {
      inner('tag', image, reference);
      inner('push', '-q', reference);
      inner('image', 'rm', reference, image);
    },

    // docker in an account's own rootless Docker.
    account: (account, ...args) => docker('exec', name, ...accountDocker(account), ...args),

    // install.sh as a person runs it as root, with `env`, answering `input`. The questions are answered
    // beforehand: a public domain (DOMAIN, with Caddy's own certificate authority) and the admin ADMIN.
    // { status, stdout, stderr }.
    tryInstall(env = {}, { input = '' } = {}) {
      const vars = Object.entries({ BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: DOMAIN, BOT_DOT_ADMIN: ADMIN, BOT_DOT_TLS: 'internal', ...env }).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
      return spawnSync('docker', ['exec', '-i', ...vars, name, 'sh', '/root/install.sh'], { input, encoding: 'utf8', timeout: 10 * 60_000 });
    },
    // The same, which has to succeed: what it said.
    install(env, options) {
      const result = machine.tryInstall(env, options);
      if (result.status !== 0) throw new Error(`install.sh failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    },

    // botdot as a browser reaches it: through Caddy on https://DOMAIN, with the header the web page sends and
    // the cookies of one browser, `jar` (the admin's by default; another name is another browser). headers: more of
    // them. { status, body }, body parsed when it is JSON.
    api(method, route, body, { jar = 'cookies', headers = {} } = {}) {
      const more = Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
      const args = ['exec', '-i', name, 'curl', '-sS', '-k', '--resolve', `${DOMAIN}:443:127.0.0.1`, '-b', `/root/${jar}`, '-c', `/root/${jar}`, '-X', method, '-H', 'X-Bot-Dot: 1', ...more, '-w', '\n%{http_code}', `https://${DOMAIN}${route}`];
      if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
      const out = run('docker', args, { timeout: 10 * 60_000, input: body === undefined ? '' : JSON.stringify(body) });
      const at = out.lastIndexOf('\n');
      const text = out.slice(0, at);
      let parsed = text;
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      return { status: Number(out.slice(at + 1)), body: parsed };
    },

    // The admin's sign-up, with the link the installer printed (`said`) and a passkey of its own: the browser
    // is then signed in to the admin's account. Or another's, with a link the admin made, in the browser `jar`.
    signUp(said, account = ADMIN, { jar } = {}) {
      const link = said.match(new RegExp(`https://${DOMAIN.replace('.', '\\.')}/sign-up/\\S+`))?.[0];
      assert.ok(link, `the installer printed a sign-up link:\n${said}`);
      const at = new URL(link).pathname;
      const key = passkey.create({ rpId: DOMAIN, origin: `https://${DOMAIN}` });
      const options = machine.api('POST', `${at}/options`, { name: account }, { jar });
      assert.equal(options.status, 200, `the sign-up page asks for a passkey: ${JSON.stringify(options.body)}`);
      const made = machine.api('POST', at, { name: account, credential: key.register(options.body.publicKey) }, { jar });
      assert.equal(made.status, 201, `the account is made: ${JSON.stringify(made.body)}`);
      return key;
    },
  };
  await until('the nested Docker daemon', () => inner('info', '--format', '{{.ID}}'));
  const outer = JSON.parse(docker('inspect', name))[0];
  assert.equal(outer.Mounts.some((mount) => mount.Source === '/var/run/docker.sock'), false, 'the nested daemon has no socket of this machine');
  assert.equal(Object.keys(outer.HostConfig.PortBindings || {}).length, 0, 'and publishes no port');
  // The registry on the machine's own address, which an account's rootless Docker reaches too (its 127.0.0.1 is its
  // own); before any account's Docker starts, as it takes a copy of /etc.
  machine.exec('sh', '-c', 'echo "$(hostname -i | cut -d" " -f1) registry.test" >> /etc/hosts');
  docker('cp', path.join(root, 'install.sh'), `${name}:/root/install.sh`);
  // The source install.sh checks signatures with, trusting the test key in place of botdot's release key:
  // only this copy, on this machine, knows the test key.
  docker('cp', path.join(root, 'lib'), `${name}:/root/lib`);
  machine.innerInput(`// The stage's trust (tests/integration/test-install.js): the test key, never a release key.\nmodule.exports = '${TEST_PUBLIC_KEY}';\n`, 'sh', '-c', 'cat > /root/lib/release-trust.js');
  step('starting the local registry');
  // On HTTPS, as a real registry, with a certificate the machine trusts: the signature check reaches
  // registries over HTTPS only (lib/registry.js).
  machine.exec('sh', '-c', [
    'mkdir -p /root/certs "/etc/docker/certs.d/' + REGISTRY + '"',
    `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 -subj /CN=registry.test -addext subjectAltName=DNS:registry.test -keyout /root/certs/registry.key -out /root/certs/registry.crt 2>/dev/null`,
    'cat /root/certs/registry.crt >> /etc/ssl/certs/ca-certificates.crt',
    `cp /root/certs/registry.crt "/etc/docker/certs.d/${REGISTRY}/ca.crt"`,
  ].join(' && '));
  await machine.load(REGISTRY_IMAGE);
  inner('run', '-d', '--name', 'registry', '--network', 'host', '-v', '/root/certs:/certs:ro', '-e', 'REGISTRY_HTTP_TLS_CERTIFICATE=/certs/registry.crt', '-e', 'REGISTRY_HTTP_TLS_KEY=/certs/registry.key', REGISTRY_IMAGE);
  await until('the local registry', () => machine.exec('curl', '-fsS', `https://${REGISTRY}/v2/`) === '{}');

  // `reference` (a tag or a digest in the local registry) is signed as its repository's release, as the image
  // workflow signs botdot's images: an index tagged RELEASE_TAG whose annotation is the signed manifest
  // (docs/release-signing.md). key: the test key, or another one. The signed image, pinned by its digest.
  machine.sign = (reference, { app, version = 1, key = TEST_KEY } = {}) => {
    const [, repo, tag, digest] = reference.match(/^[^/]+\/([^:@]+)(?::([\w.-]+))?(?:@(sha256:[a-f0-9]{64}))?$/);
    const head = machine.exec('curl', '-fsSI', '-H', `Accept: ${MANIFEST_TYPES}`, `https://${REGISTRY}/v2/${repo}/manifests/${digest || tag || 'latest'}`);
    const header = (field) => head.match(new RegExp(`^${field}:\\s*(\\S+)`, 'im'))[1];
    const m = { app, version, revision: '0'.repeat(40), file: `${REGISTRY}/${repo}@${header('docker-content-digest')}`, sha256: header('docker-content-digest').slice(7) };
    m.signature = crypto.sign('sha256', canonical(m), key).toString('base64');
    const index = { schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ mediaType: header('content-type'), digest: `sha256:${m.sha256}`, size: Number(header('content-length')) }], annotations: { 'dev.botdot.release': JSON.stringify(m) } };
    machine.innerInput(JSON.stringify(index), 'curl', '-fsS', '-X', 'PUT', '-H', 'Content-Type: application/vnd.oci.image.index.v1+json', '--data-binary', '@-', `https://${REGISTRY}/v2/${repo}/manifests/${RELEASE_TAG}`);
    return m.file;
  };
  // What was downloaded from the local registry so far, by the registry's log: the requests for an image's
  // contents (its manifest by a tag other than RELEASE_TAG, or by digest, and its layers), not the pushes.
  machine.downloads = () => machine.exec('sh', '-c', 'docker logs registry 2>&1').split('\n')
    .map((line) => line.match(/"GET (\/v2\/[^ ]+\/(?:blobs|manifests)\/[^ "]+)/)?.[1]).filter((request) => request && !request.endsWith(`/manifests/${RELEASE_TAG}`));
  return machine;
}

// --- A stage ---------------------------------------------------------------------------------------

function createStage(label, { keep = false } = {}) {
  const prefix = `botdot-${label}-${process.pid}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const step = (text) => console.log(`${label}: ${text}`);
  const machines = new Set(), built = new Map();
  let registryImage = null, count = 0, removed = false; // registryImage: 'here' before the stage, or 'pulled' by it

  // Built once per stage, on the first ask.
  const image = (kind, build) => {
    const tag = `${prefix}:${kind}`;
    if (!built.has(kind)) { step(`building the stand-in ${kind} image of this checkout`); build(tag, temp); built.set(kind, tag); }
    return tag;
  };
  const stage = {
    temp, step,
    server: () => image('server', buildServer),
    computer: () => image('computer', buildComputer),

    async machine() {
      if (!registryImage) {
        try { docker('image', 'inspect', REGISTRY_IMAGE); registryImage = 'here'; } catch { docker('pull', '-q', REGISTRY_IMAGE); registryImage = 'pulled'; }
      }
      const name = `${prefix}-${++count}`;
      machines.add(name);
      return startMachine(name, { image: image('machine', buildMachine), step });
    },
    // A machine whose case is done; with `keep`, teardown names it.
    remove(machine) {
      if (keep) return;
      docker('rm', '-fv', machine.name);
      machines.delete(machine.name);
    },

    teardown() {
      if (removed) return;
      removed = true;
      const attempt = (what, action) => { try { action(); } catch (error) { console.error(`${what} was not removed: ${error.message}`); process.exitCode = 1; } };
      if (keep) for (const name of machines) console.error(`kept ${name}`);
      else for (const name of machines) attempt(`The nested daemon ${name}`, () => docker('rm', '-fv', name));
      for (const tag of built.values()) attempt(`The image ${tag}`, () => docker('image', 'rm', tag));
      // The registry image only when this run brought it: one that was here before stays.
      if (registryImage === 'pulled') attempt(`The image ${REGISTRY_IMAGE}`, () => docker('image', 'rm', REGISTRY_IMAGE));
      fs.rmSync(temp, { recursive: true, force: true });
    },

    // Runs the stage's steps; on a failure prints what the machines' services said. Removes everything at
    // the end, and when the stage is interrupted.
    run(main) {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stage.teardown(); process.exit(1); });
      return Promise.resolve().then(main).catch((error) => {
        console.error(error.stack || error.message);
        for (const name of machines) { const logs = logsOf(name); if (logs) console.error(logs); }
        process.exitCode = 1;
      }).finally(() => stage.teardown());
    },
  };
  return stage;
}

module.exports = { createStage, until, pause, REGISTRY, SERVER, DESKTOP, REGISTRY_IMAGE, TEST_KEY, DOMAIN, ADMIN, DIR, RUN_DIR };
