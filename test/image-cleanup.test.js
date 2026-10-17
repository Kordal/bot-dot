// The images an update leaves behind (lib/image-cleanup.js): the rule over an inventory, then the pass
// against the stand-in docker, which keeps a small host and removes as Docker does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { fakeDocker } = require('./helpers');
const { plan, clean, layersSize, repositoryOf } = require('../lib/image-cleanup');

const SERVER = 'ghcr.io/kordal/bot-dot';
const DESKTOP = 'ghcr.io/kordal/bot-dot-desktop';
const RELEASE = { 'dev.botdot.release.version': '41' };
const sha = (c) => `sha256:${c.repeat(64)}`;
const image = (c, { tags = [], digests = [], labels = RELEASE } = {}) => ({ id: sha(c), repoTags: tags, repoDigests: digests, labels });
const ids = (planned) => planned.remove.map((i) => i.id);
const repositories = [SERVER, DESKTOP];

test('a reference names its repository, with or without a tag, a digest or a registry port', () => {
  assert.equal(repositoryOf(`${SERVER}:latest`), SERVER);
  assert.equal(repositoryOf(`${SERVER}@${sha('a')}`), SERVER);
  assert.equal(repositoryOf(SERVER), SERVER);
  assert.equal(repositoryOf('registry.example:5000/team/app:1'), 'registry.example:5000/team/app');
  assert.equal(repositoryOf('registry.example:5000/team/app'), 'registry.example:5000/team/app');
});

test('a superseded server image and a superseded desktop image go', () => {
  const planned = plan({ repositories, images: [
    image('a', { digests: [`${SERVER}@${sha('1')}`] }),
    image('b', { digests: [`${DESKTOP}@${sha('2')}`] }),
  ] });
  assert.deepEqual(ids(planned), [sha('a'), sha('b')]);
  assert.equal(planned.skipped, 0);
  assert.ok(planned.remove.every((i) => i.whole));
});

test('the configured images stay, by tag and by digest of one image', () => {
  const current = image('a', { tags: [`${SERVER}:latest`], digests: [`${SERVER}@${sha('1')}`] });
  const desktop = image('b', { digests: [`${DESKTOP}@${sha('2')}`] });
  const planned = plan({ repositories, images: [current, desktop], configured: [sha('a'), sha('b')] });
  assert.deepEqual(planned, { remove: [], skipped: 2 });
});

test('an image with a tag and a digest reference goes once, the tag first', () => {
  const planned = plan({ repositories, images: [image('a', { tags: [`${SERVER}:sha-1234567`], digests: [`${SERVER}@${sha('1')}`] })] });
  assert.deepEqual(planned.remove, [{ id: sha('a'), references: [`${SERVER}:sha-1234567`, `${SERVER}@${sha('1')}`], whole: true }]);
});

test('a stopped computer keeps its old desktop image, and so does a container of another Compose project', () => {
  const planned = plan({ repositories, containers: [sha('b'), sha('c')], images: [
    image('a', { digests: [`${SERVER}@${sha('1')}`] }),
    image('b', { digests: [`${DESKTOP}@${sha('2')}`] }), // botdot-<bot id>, stopped
    image('c', { digests: [`${SERVER}@${sha('3')}`] }), // another botdot on this host
  ] });
  assert.deepEqual(ids(planned), [sha('a')]);
  assert.equal(planned.skipped, 2);
});

test('an image of another repository is never listed', () => {
  const planned = plan({ repositories, images: [
    image('a', { tags: ['postgres:17'], digests: [`postgres@${sha('1')}`] }),
    image('b', { tags: ['ghcr.io/kordal/bot-dot-extra:latest'] }), // a longer name is another repository
    image('c', { tags: ['ghcr.io/someone/bot-dot:latest'] }),
    image('d', { labels: {} }), // nameless and not botdot's
  ] });
  assert.deepEqual(planned, { remove: [], skipped: 0 });
});

test('a nameless image that carries the release label goes by its id, unless a container has it', () => {
  // Docker's containerd image store leaves an image whose tag a pull moved with no tag and no digest.
  const images = [image('a'), image('b'), image('c', { labels: {} })];
  assert.deepEqual(plan({ repositories, images, containers: [sha('b')] }), { remove: [{ id: sha('a'), references: [sha('a')], whole: true }], skipped: 1 });
  assert.deepEqual(plan({ repositories, images, configured: [sha('a')], containers: [sha('b')] }), { remove: [], skipped: 2 });
});

test('an image of the repository without the release label is skipped', () => {
  const planned = plan({ repositories, images: [
    image('a', { digests: [`${SERVER}@${sha('1')}`], labels: {} }),
    image('b', { digests: [`${DESKTOP}@${sha('2')}`], labels: { 'org.opencontainers.image.revision': 'abc' } }),
  ] });
  assert.deepEqual(planned, { remove: [], skipped: 2 });
});

test('a locally built desktop is never listed: it has no repository', () => {
  const planned = plan({ repositories: [SERVER, null], images: [
    image('a', { tags: ['bot-dot/desktop:latest'] }),
    image('b', { digests: [`${DESKTOP}@${sha('2')}`] }), // nor is the published desktop, then
  ] });
  assert.deepEqual(planned, { remove: [], skipped: 0 });
});

test('an image that also has a reference in another repository loses only its references here', () => {
  const planned = plan({ repositories, images: [image('a', { tags: [`${SERVER}:latest`, 'ghcr.io/someone/fork:latest'], digests: [`${SERVER}@${sha('1')}`] })] });
  assert.deepEqual(planned.remove, [{ id: sha('a'), references: [`${SERVER}:latest`, `${SERVER}@${sha('1')}`], whole: false }]);
});

// The pass, against a host the stand-in docker keeps in host.json.
const run = promisify(execFile);
function host(t, state) {
  const docker = fakeDocker();
  t.after(() => docker.remove());
  const file = (images) => images.map((i) => ({ Id: i.id, RepoTags: i.repoTags, RepoDigests: i.repoDigests, Labels: i.labels }));
  docker.answer('host.json', JSON.stringify({ ...state, images: file(state.images) }));
  const call = async (args) => (await run(path.join(docker.bin, 'docker'), args)).stdout.trim();
  const sizes = [...(state.sizes || [])];
  return {
    pass: (options = {}) => clean({ docker: call, repositories, references: [`${SERVER}:latest`, `${DESKTOP}@${sha('9')}`], size: async () => sizes.shift() ?? null, ...options }),
    left: () => JSON.parse(fs.readFileSync(path.join(docker.bin, '..', 'out', 'host.json'), 'utf8')).images.map((i) => i.Id),
    removals: () => docker.calls().filter((c) => c.args[0] === 'image' && c.args[1] === 'rm').map((c) => c.args.slice(2)),
    calls: docker.calls,
    docker: call,
    bin: docker.bin,
  };
}
// What three updates leave: the images in use, and the backlog.
const afterUpdates = () => [
  image('a', { tags: [`${SERVER}:latest`], digests: [`${SERVER}@${sha('8')}`] }), // the server runs it
  image('b', { digests: [`${DESKTOP}@${sha('9')}`] }), // the configured desktop
  image('c', { digests: [`${SERVER}@${sha('1')}`] }),
  image('d', { tags: [`${SERVER}:sha-1234567`], digests: [`${SERVER}@${sha('2')}`] }),
  image('e', { digests: [`${DESKTOP}@${sha('3')}`] }),
  image('f', { digests: [`${DESKTOP}@${sha('4')}`] }), // a stopped computer was made from it
  image('g', { tags: ['postgres:17'] }),
  image('h', { digests: [`${SERVER}@${sha('5')}`], labels: {} }), // pulled before the label
  image('i'), // nameless: its tag moved, in the containerd image store
];
const containers = [{ Id: '1'.repeat(64), Image: sha('a') }, { Id: '2'.repeat(64), Image: sha('f') }, { Id: '3'.repeat(64), Image: sha('g') }];

test('the pass removes the whole backlog at once, and a second pass removes nothing', async (t) => {
  const h = host(t, { images: afterUpdates(), containers, sizes: [9000, 2500] });
  assert.deepEqual(await h.pass(), { removed: 4, skipped: 4, failed: 0, bytes: 6500 });
  assert.deepEqual(h.left(), ['a', 'b', 'f', 'g', 'h'].map(sha));
  // By reference, and the digest Docker dropped with the last tag is asked for and found gone.
  assert.deepEqual(h.removals(), [[`${SERVER}@${sha('1')}`], [`${SERVER}:sha-1234567`], [`${SERVER}@${sha('2')}`], [`${DESKTOP}@${sha('3')}`], [sha('i')]]);
  const before = h.calls().length;
  assert.deepEqual(await h.pass(), { removed: 0, skipped: 4, failed: 0, bytes: 0 });
  assert.deepEqual(h.removals().length, 5);
  for (const call of h.calls()) {
    assert.ok(!call.args.some((a) => /^(--force|-f|prune)$/.test(a)), call.args.join(' '));
    assert.ok(['image', 'ps', 'inspect'].includes(call.args[0]), call.args.join(' '));
    if (call.args[0] === 'image') assert.ok(['ls', 'inspect', 'rm'].includes(call.args[1]), call.args.join(' '));
  }
  assert.ok(h.calls().length > before);
});

test('an image Docker says is in use is skipped, another refusal is failed, and the pass goes on', async (t) => {
  const h = host(t, { images: afterUpdates(), containers, sizes: [9000, 8000], refuse: {
    [`${SERVER}@${sha('1')}`]: `Error response from daemon: conflict: unable to remove repository reference "${SERVER}@${sha('1')}" (must force) - container 0123456789ab is using its referenced image cccccccccccc`,
    [`${SERVER}:sha-1234567`]: 'Error response from daemon: open /var/lib/docker/image/overlay2/repositories.json: read-only file system',
  } });
  assert.deepEqual(await h.pass(), { removed: 2, skipped: 5, failed: 1, bytes: 1000 });
  assert.deepEqual(h.left(), ['a', 'b', 'c', 'd', 'f', 'g', 'h'].map(sha));
});

test('a container that appears between the inventory and the removal keeps its image', async (t) => {
  const h = host(t, { images: afterUpdates(), containers, late: [{ Id: '4'.repeat(64), Image: sha('c') }], sizes: [9000, 8000] });
  assert.deepEqual(await h.pass(), { removed: 3, skipped: 5, failed: 0, bytes: 1000 });
  assert.ok(h.left().includes(sha('c')));
  assert.ok(!h.removals().flat().includes(`${SERVER}@${sha('1')}`), 'never asked Docker to remove it');
});

test('a nameless image that was given a name since the inventory stays', async (t) => {
  const h = host(t, { images: [image('i')], containers: [], sizes: [100, 100] });
  const named = async (args) => (args.join(' ').includes('len .RepoTags') ? '1 0' : h.docker(args));
  assert.deepEqual(await h.pass({ docker: named }), { removed: 0, skipped: 1, failed: 0, bytes: 0 });
  assert.deepEqual(h.removals(), []);
  assert.deepEqual(await h.pass(), { removed: 1, skipped: 0, failed: 0, bytes: 0 }, 'and goes while it has none');
  assert.deepEqual(h.removals(), [[sha('i')]]);
});

test('an image with a reference in another repository stays and counts as skipped', async (t) => {
  const forked = image('c', { tags: [`${SERVER}:sha-7654321`, 'ghcr.io/someone/fork:latest'] });
  const h = host(t, { images: [forked], containers: [], sizes: [100, 100] });
  assert.deepEqual(await h.pass(), { removed: 0, skipped: 1, failed: 0, bytes: 0 });
  assert.deepEqual(h.left(), [sha('c')]);
  assert.deepEqual(h.removals(), [[`${SERVER}:sha-7654321`]]);
});

test('the pass ends when asked to, and reports 0 bytes when Docker does not tell the size', async (t) => {
  const h = host(t, { images: afterUpdates(), containers });
  let asked = 0;
  assert.deepEqual(await h.pass({ stop: () => ++asked > 1 }), { removed: 1, skipped: 7, failed: 0, bytes: 0 });
  assert.deepEqual(h.removals(), [[`${SERVER}@${sha('1')}`]]);
});

test('nothing is looked at without a registry repository, and a pass that cannot read the inventory removes nothing', async (t) => {
  const h = host(t, { images: afterUpdates(), containers });
  assert.deepEqual(await h.pass({ repositories: [null, null] }), { removed: 0, skipped: 0, failed: 0, bytes: 0 });
  assert.equal(h.calls().length, 0);
  // The containers cannot be listed: nothing says which images are in use.
  const asked = [];
  const docker = async (args) => { asked.push(args); if (args[0] === 'ps') throw new Error('Cannot connect to the Docker daemon'); return h.docker(args); };
  await assert.rejects(h.pass({ docker }), /Cannot connect/);
  assert.ok(asked.some((args) => args[0] === 'ps') && !asked.some((args) => args[1] === 'rm'));
  assert.equal(h.left().length, afterUpdates().length);
});

test("Docker's total layer size is read from its socket, and is null when it does not tell", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-df-'));
  const socket = path.join(dir, 'docker.sock');
  let answer = { LayersSize: 4096 };
  const asked = [];
  const server = http.createServer((req, res) => { asked.push(`${req.method} ${req.url}`); res.writeHead(answer ? 200 : 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(answer || { message: 'no' })); });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(await layersSize(socket), 4096);
  assert.deepEqual(asked, ['GET /system/df?type=image']);
  answer = { ImageUsage: { TotalSize: 7 } };
  assert.equal(await layersSize(socket), 7);
  answer = { Images: [] };
  assert.equal(await layersSize(socket), null);
  answer = null;
  assert.equal(await layersSize(socket), null);
  assert.equal(await layersSize(path.join(dir, 'no.sock')), null);
});

// The machine's Docker (ADR 028): install.sh runs the pass from the image it installed, for the front door's images.
test('run by the installer, the pass looks at the two references it is given and prints what it did', async (t) => {
  const h = host(t, { images: afterUpdates(), containers });
  const cli = path.join(__dirname, '..', 'lib', 'image-cleanup.js');
  const env = { ...process.env, PATH: `${h.bin}:${process.env.PATH}` };
  const { stdout } = await run(process.execPath, [cli, `${SERVER}:latest`, `${DESKTOP}@${sha('9')}`], { env });
  const result = JSON.parse(stdout);
  assert.deepEqual({ ...result, bytes: 0 }, { removed: 4, skipped: 4, failed: 0, bytes: 0 });
  assert.deepEqual(h.left(), ['a', 'b', 'f', 'g', 'h'].map(sha));
});
