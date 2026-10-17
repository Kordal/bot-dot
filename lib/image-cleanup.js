// The images an update leaves behind. After an update that ended healthy, every image of botdot's own
// repositories that nothing uses any more goes, so that updates stop filling the disk.
//
// The rule is here and nowhere else (plan). An image is removed when it
//   - has a tag or a digest reference in the configured server or desktop repository, or no reference
//     at all: with Docker's containerd image store, an image whose tag a pull moved is left nameless,
//   - carries the release label (the published images do, since 2026-09-29),
//   - is not an image botdot is configured to use, and
//   - is the image of no container on the host, running or stopped.
// Everything else stays. Nothing is forced and nothing is pruned: no container, volume, network or
// build cache is touched.
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const LABEL = 'dev.botdot.release.version';
const NOTHING = Object.freeze({ removed: 0, skipped: 0, failed: 0, bytes: 0 });
const cli = async (args, timeout = 60_000) => (await run('docker', args, { timeout, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

// "ghcr.io/kordal/bot-dot:latest", "ghcr.io/kordal/bot-dot@sha256:…" -> "ghcr.io/kordal/bot-dot".
// A colon before the last slash is a registry's port, not a tag.
function repositoryOf(reference) {
  const name = String(reference).split('@')[0];
  const colon = name.lastIndexOf(':');
  return colon > name.lastIndexOf('/') ? name.slice(0, colon) : name;
}

// The rule, over an inventory:
//   images        [{ id, repoTags, repoDigests, labels }], every image on the host
//   containers    the image ids of every container on the host, running or stopped
//   repositories  the configured server and desktop repositories; a local desktop has none
//   configured    the image ids the configured references resolve to, and the one the server runs
// Returns { remove: [{ id, references, whole }], skipped }. `whole` is false for an image that also
// has a reference in another repository: its references here go, the image stays. A nameless image
// that carries the label goes by its id; one without the label is nobody's to judge here.
function plan({ images = [], containers = [], repositories = [], configured = [] }) {
  const ours = new Set(repositories.filter(Boolean));
  const used = new Set([...containers, ...configured].filter(Boolean));
  const remove = [];
  let skipped = 0;
  for (const image of images) {
    const all = [...(image.repoTags || []), ...(image.repoDigests || [])]; // tags first: see removeImage
    const labelled = Object.hasOwn(image.labels || {}, LABEL);
    const references = all.length ? all.filter((r) => ours.has(repositoryOf(r))) : labelled && image.id ? [image.id] : [];
    if (!references.length) continue; // not botdot's: never looked at
    if (!labelled || used.has(image.id)) { skipped++; continue; }
    remove.push({ id: image.id, references, whole: !all.length || references.length === all.length });
  }
  return { remove, skipped };
}

const said = (e) => `${e?.stderr || ''}\n${e?.message || ''}`;
const GONE = /no such (image|container|object)/i;
const IN_USE = /is using its referenced image|is being used by|has dependent child images/i;

// `docker inspect` of several things prints those it found and fails for one that went meanwhile.
async function inspectAll(docker, args) {
  try { return await docker(args); } catch (e) {
    if (GONE.test(said(e)) && typeof e.stdout === 'string') return e.stdout.trim();
    throw e;
  }
}
const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

// Every image, also one that has a digest and no tag: what a pull by digest leaves, and what an image
// becomes when a pull moves its tag. A plain `docker image ls` hides those, and they are the backlog.
async function listImages(docker) {
  const ids = [...new Set(lines(await docker(['image', 'ls', '-a', '-q', '--no-trunc', '--digests'])))];
  if (!ids.length) return [];
  const found = JSON.parse(await inspectAll(docker, ['image', 'inspect', ...ids]) || '[]');
  return found.map((i) => ({ id: i.Id, repoTags: i.RepoTags || [], repoDigests: i.RepoDigests || [], labels: i.Config?.Labels || {} }));
}

// The image id of every container, of any Compose project, running or stopped.
async function containerImages(docker) {
  const ids = lines(await docker(['ps', '-aq', '--no-trunc']));
  if (!ids.length) return [];
  return lines(await inspectAll(docker, ['inspect', '--type', 'container', '--format', '{{.Image}}', ...ids]));
}

// The id a reference resolves to here, or null when the image is not on this host.
async function resolve(docker, reference) {
  try { return await docker(['image', 'inspect', '--format', '{{.Id}}', reference]); } catch (e) {
    if (GONE.test(said(e))) return null;
    throw e;
  }
}

// Reference by reference and never forced; by id only an image that has no reference. Docker deletes
// the image with its last reference, and with the last tag of a repository it drops that repository's digest references too,
// so a later reference may already be gone.
async function removeImage(docker, references) {
  for (const reference of references) {
    try { await docker(['image', 'rm', reference], 5 * 60_000); } catch (e) {
      if (GONE.test(said(e))) continue;
      return IN_USE.test(said(e)) ? 'skipped' : 'failed';
    }
  }
  return 'removed';
}

// Docker's total image layer size in bytes, or null when it does not tell.
function layersSize(socketPath = '/var/run/docker.sock') {
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path: '/system/df?type=image', method: 'GET', timeout: 120_000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; if (data.length > 64 * 1024 * 1024) res.destroy(); });
      res.on('error', () => resolve(null));
      res.on('end', () => {
        try {
          const df = JSON.parse(data);
          const size = res.statusCode === 200 ? df.LayersSize ?? df.ImageUsage?.TotalSize : null;
          resolve(Number.isSafeInteger(size) && size >= 0 ? size : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

// One pass against Docker.
//   repositories  as in plan
//   references    the configured image references (BOT_DOT_IMAGE, BOT_DOT_COMPUTER_IMAGE)
//   keep          image ids that stay whatever Docker says: the one the server container runs
//   stop          asked before each removal; true ends the pass, and what is left counts as skipped
// Returns { removed, skipped, failed, bytes }: images, and the fall of the total layer size.
// Throws when the inventory cannot be read: then nothing was removed.
async function clean({ docker = cli, repositories = [], references = [], keep = [], size = layersSize, stop = () => false } = {}) {
  repositories = repositories.filter(Boolean);
  if (!repositories.length) return { ...NOTHING };
  const images = await listImages(docker);
  const configured = [...keep];
  for (const reference of references.filter(Boolean)) configured.push(await resolve(docker, reference));
  const { remove, skipped } = plan({ images, containers: await containerImages(docker), repositories, configured });
  const result = { ...NOTHING, skipped };
  if (!remove.length) return result;
  const measure = async () => { try { return await size(); } catch { return null; } };
  const before = await measure();
  for (const image of remove) {
    if (stop()) { result.skipped++; continue; }
    // A container made since the inventory keeps its image.
    let containers;
    try { containers = await containerImages(docker); } catch { result.failed++; continue; }
    if (containers.includes(image.id)) { result.skipped++; continue; }
    // A nameless image that was given a name since the inventory is somebody's again.
    if (image.references[0] === image.id) {
      let names;
      try { names = await docker(['image', 'inspect', '--format', '{{len .RepoTags}} {{len .RepoDigests}}', image.id]); } catch (e) { result[GONE.test(said(e)) ? 'skipped' : 'failed']++; continue; }
      if (names !== '0 0') { result.skipped++; continue; }
    }
    const outcome = await removeImage(docker, image.references);
    result[outcome === 'removed' && !image.whole ? 'skipped' : outcome]++;
  }
  const after = await measure();
  if (before !== null && after !== null && before > after) result.bytes = before - after;
  return result;
}

module.exports = { LABEL, NOTHING, repositoryOf, plan, clean, layersSize };

// The machine's own Docker, which holds the front door's image (ADR 028): install.sh runs this from the image it just
// installed, with that Docker's socket, after the front door and every account moved to it.
//
//   node lib/image-cleanup.js <server image> <desktop image>
//
// The two are the configured references; their repositories are the ones looked at. It prints the four numbers as
// JSON, or one failure when the inventory could not be read.
if (require.main === module) {
  const references = process.argv.slice(2, 4).filter(Boolean);
  clean({ repositories: references.map(repositoryOf), references })
    .then((result) => console.log(JSON.stringify(result)), () => { console.log(JSON.stringify({ ...NOTHING, failed: 1 })); process.exitCode = 1; });
}
