// The layers of a signed image on its registry (lib/image-layers.js), which the update's room check adds up (#192).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { layers } = require('../lib/image-layers');

const d = (c) => `sha256:${c.repeat(64)}`;
const IMAGE = `ghcr.io/kordal/bot-dot@${d('a')}`;
// A registry of JSON documents by digest.
const registry = (docs) => {
  const asked = [];
  return { asked, get: async (kind, digest) => { asked.push(`${kind} ${digest}`); if (!docs[digest]) throw new Error('The registry answered 404'); return docs[digest]; } };
};
const manifest = { config: { digest: d('c') }, layers: [{ digest: d('1'), size: 300 }, { digest: d('2'), size: 4000 }] };
const config = { rootfs: { type: 'layers', diff_ids: [d('e'), d('f')] } };

test("an image built for several platforms gives this machine's layers, by the ids Docker knows them by", async () => {
  const index = { manifests: [
    { digest: d('9'), platform: { os: 'unknown', architecture: 'unknown' } },
    { digest: d('8'), platform: { os: 'linux', architecture: 'arm64' } },
    { digest: d('b'), platform: { os: 'linux', architecture: 'amd64' } },
  ] };
  const r = registry({ [d('a')]: index, [d('b')]: manifest, [d('c')]: config });
  assert.deepEqual(await layers(IMAGE, { arch: 'amd64', get: r.get }), [{ id: d('e'), size: 300 }, { id: d('f'), size: 4000 }]);
  assert.deepEqual(r.asked, [`manifests ${d('a')}`, `manifests ${d('b')}`, `blobs ${d('c')}`]);
  await assert.rejects(layers(IMAGE, { arch: 'riscv64', get: r.get }), /no build for linux\/riscv64/);
});

test('an image of one platform gives its layers as they are', async () => {
  const r = registry({ [d('a')]: manifest, [d('c')]: config });
  assert.deepEqual((await layers(IMAGE, { arch: 'amd64', get: r.get })).map((l) => l.size), [300, 4000]);
});

test("an answer that doesn't give the sizes is refused, so the update goes on without the check", async () => {
  const no = (docs) => layers(IMAGE, { arch: 'amd64', get: registry(docs).get });
  await assert.rejects(layers('ghcr.io/kordal/bot-dot:latest', { get: async () => manifest }), /not pinned/);
  await assert.rejects(no({ [d('a')]: { schemaVersion: 1, fsLayers: [] } }), /no layers/);
  await assert.rejects(no({ [d('a')]: manifest, [d('c')]: { rootfs: { diff_ids: [d('e')] } } }), /disagree/);
  await assert.rejects(no({ [d('a')]: { ...manifest, layers: [{ digest: d('1') }, { digest: d('2'), size: 1 }] }, [d('c')]: config }), /without its size/);
  await assert.rejects(no({}), /404/);
});

test('the registry hands a blob from its storage elsewhere, and the token stays with the registry', async () => {
  const real = global.fetch;
  const asked = [];
  global.fetch = async (url, options = {}) => {
    asked.push({ url: String(url), auth: options.headers?.Authorization || null });
    const u = new URL(url);
    if (u.pathname === '/token') return Response.json({ token: 'T' });
    if (u.host === 'ghcr.io' && !options.headers?.Authorization) return new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' } });
    if (u.host === 'ghcr.io') return new Response('', { status: 307, headers: { location: 'https://storage.example/blob?sig=1' } });
    return Response.json(config);
  };
  try {
    const registry = require('../lib/registry');
    assert.deepEqual(await registry.remoteJSON(IMAGE, 'blobs', d('c')), config);
    await assert.rejects(registry.remoteJSON(IMAGE, 'blobs', 'latest'), /Not a digest/);
  } finally { global.fetch = real; }
  assert.equal(asked.at(-2).auth, 'Bearer T');
  assert.deepEqual(asked.at(-1), { url: 'https://storage.example/blob?sig=1', auth: null });
});
