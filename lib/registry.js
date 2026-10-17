// botdot's images on a container registry (GitHub's, private): signing the Docker CLI in, and asking
// the registry which image a tag points to now, without downloading it.
//
// The read-only token from the install is taken out of the environment as soon as this loads, so
// bots never see it.
const { spawn } = require('child_process');

const TOKEN = process.env.BOT_DOT_REGISTRY_TOKEN || '';
delete process.env.BOT_DOT_REGISTRY_TOKEN;

// "ghcr.io/kordal/bot-dot:latest" -> { registry, repo, tag, owner }; null for local names.
function parse(image) {
  const m = String(image || '').match(/^([a-z0-9.-]+\.[a-z]{2,}(?::\d+)?)\/([a-z0-9._/-]+?)(?::([\w.-]+))?(?:@sha256:[0-9a-f]{64})?$/i);
  if (!m) return null;
  return { registry: m[1], repo: m[2].toLowerCase(), tag: m[3] || 'latest', owner: m[2].split('/')[0] };
}

const signedIn = new Set();
function login(image) {
  const ref = parse(image);
  if (!ref || !TOKEN || signedIn.has(ref.registry)) return Promise.resolve();
  const user = process.env.BOT_DOT_REGISTRY_USER || ref.owner || 'bot-dot';
  return new Promise((resolve, reject) => {
    const p = spawn('docker', ['login', ref.registry, '-u', user, '--password-stdin'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code) return reject(new Error(`Couldn't sign in to ${ref.registry}: ${err.trim() || `exit ${code}`}`));
      signedIn.add(ref.registry);
      resolve();
    });
    p.stdin.end(TOKEN);
  });
}

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

// The digest the tag points to on the registry now ("sha256:…").
async function remoteManifest(image, method = 'HEAD') {
  const ref = parse(image);
  if (!ref) throw new Error(`${image} isn't on a registry`);
  const base = `https://${ref.registry}`;
  const headers = { Accept: MANIFEST_TYPES };
  let res = await fetch(`${base}/v2/${ref.repo}/manifests/${ref.tag}`, { method, headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) {
    // Standard registry token exchange; the realm comes from the registry's answer.
    const auth = res.headers.get('www-authenticate') || '';
    const realm = auth.match(/realm="([^"]+)"/)?.[1] || `${base}/token`;
    if (new URL(realm).origin !== base) throw new Error('The registry requested authentication at another host');
    const service = auth.match(/service="([^"]+)"/)?.[1] || ref.registry;
    const url = `${realm}?service=${encodeURIComponent(service)}&scope=${encodeURIComponent(`repository:${ref.repo}:pull`)}`;
    const basic = TOKEN ? { Authorization: `Basic ${Buffer.from(`${process.env.BOT_DOT_REGISTRY_USER || ref.owner}:${TOKEN}`).toString('base64')}` } : {};
    const t = await fetch(url, { headers: basic, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!t.ok) throw Object.assign(new Error(`The registry refused the token (${t.status})`), { status: t.status });
    const j = await t.json();
    headers.Authorization = `Bearer ${j.token || j.access_token}`;
    res = await fetch(`${base}/v2/${ref.repo}/manifests/${ref.tag}`, { method, headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  }
  if (!res.ok) throw Object.assign(new Error(`The registry answered ${res.status} for ${image}`), { status: res.status });
  return res;
}

async function remoteDigest(image) {
  const res = await remoteManifest(image);
  const digest = res.headers.get('docker-content-digest');
  if (!digest) throw new Error('The registry did not say which version is newest');
  return digest;
}

// The tag of a repository's signed release (docs/release-signing.md). A botdot from before accounts reads `release`;
// a botdot with accounts (ADR 028) is installed again, never offered to one as an update, so its releases are signed
// under a tag of their own.
const RELEASE_TAG = 'accounts-release';

async function remoteRelease(image) {
  const ref = parse(image);
  if (!ref) throw new Error('Not a registry image');
  const res = await remoteManifest(`${ref.registry}/${ref.repo}:${RELEASE_TAG}`, 'GET');
  const index = await res.json();
  const release = index.annotations?.['dev.botdot.release'];
  if (!release || release.length > 4096) throw new Error('The image has no signed release manifest');
  return JSON.parse(release);
}

module.exports = { parse, login, remoteDigest, remoteRelease, RELEASE_TAG, hasToken: () => !!TOKEN };
