// The layers of a signed image on its registry, for this machine, without downloading it: before an update downloads
// anything, install.sh asks it how much of the new server image each account still lacks (#192), by running this file
// with the Node of botdot's image, as it runs signed-image.js:
//
//   node lib/image-layers.js <image@sha256:…>     a registry token, if any, on stdin
//
// It prints one line per layer, "<diff id> <bytes>": the id Docker knows the layer by once it is unpacked (an image's
// RootFS.Layers), and the size of its download. When the registry's answer doesn't give them (an older registry, a
// platform the image isn't built for), it prints nothing and ends with 1: the update goes on without the check.
const registry = () => require('./registry'); // only when asked: it takes the token out of the environment as it loads

const ARCH = { x64: 'amd64', arm64: 'arm64' }[process.arch] || process.arch;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

// [{ id, size }] of image, pinned by digest, for linux/arch. get(kind, digest): the registry's JSON.
async function layers(image, { arch = ARCH, get = (kind, digest) => registry().remoteJSON(image, kind, digest) } = {}) {
  const pinned = String(image).match(/@(sha256:[0-9a-f]{64})$/)?.[1];
  if (!pinned) throw new Error('The image is not pinned by its digest');
  let manifest = await get('manifests', pinned);
  if (Array.isArray(manifest.manifests)) {
    const mine = manifest.manifests.find((m) => m.platform?.os === 'linux' && m.platform?.architecture === arch && DIGEST.test(m.digest));
    if (!mine) throw new Error(`The image has no build for linux/${arch}`);
    manifest = await get('manifests', mine.digest);
  }
  if (!Array.isArray(manifest.layers) || !DIGEST.test(manifest.config?.digest)) throw new Error('The registry gave no layers');
  const ids = (await get('blobs', manifest.config.digest)).rootfs?.diff_ids;
  if (!Array.isArray(ids) || ids.length !== manifest.layers.length) throw new Error("The image's layers and its configuration disagree");
  return manifest.layers.map((layer, i) => {
    if (!DIGEST.test(ids[i]) || !Number.isSafeInteger(layer.size) || layer.size < 0) throw new Error('The registry gave a layer without its size');
    return { id: ids[i], size: layer.size };
  });
}

module.exports = { layers };

if (require.main === module) {
  const token = require('node:fs').readFileSync(0, 'utf8').trim();
  if (token) process.env.BOT_DOT_REGISTRY_TOKEN = token;
  layers(process.argv[2]).then((list) => { for (const { id, size } of list) console.log(`${id} ${size}`); }, () => { process.exitCode = 1; });
}
