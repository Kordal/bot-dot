// Whether an image on a registry is one of botdot's signed images: its repository's release (the annotation
// of the `:release` tag, docs/release-signing.md), checked against the key pinned in release-trust.js. The
// updater asks it before it downloads an update (updates.js), and install.sh before the first download, by
// running this file with the Node of botdot's image:
//
//   node lib/signed-image.js <image> <server|desktop>     a registry token, if any, on stdin
//
// It prints the signed image pinned by its digest. Refused, it prints why ("it has no botdot signature") and
// ends with 1, or with 2 when the registry refused access, so that the installer can ask for a token.
const registry = () => require('./registry'); // only when asked: it takes the token out of the environment as it loads
const { verify } = require('./release-manifest');

// The signed image of `image`'s repository ("ghcr.io/kordal/bot-dot@sha256:…"); the tag or digest in the name
// does not choose it. installed: the release version that runs now, so that an older one is refused.
async function signedImage(image, app, { installed = 0, publicKey, remoteRelease = (name) => registry().remoteRelease(name) } = {}) {
  const ref = registry().parse(image);
  if (!ref) throw new Error('Updates require a configured registry repository');
  const m = verify(await remoteRelease(image), { app, installed, publicKey });
  if (m.file !== `${ref.registry}/${ref.repo}@sha256:${m.sha256}`) throw new Error('The signed image belongs to another repository');
  return m.file;
}

// Why an image was refused, said to the person installing it. access: the registry wants a (better) token.
function refusal(error) {
  const { status, message } = error;
  if (status === 401 || status === 403 || /^The registry refused the token/.test(message)) return { access: true, why: 'the registry refused access' };
  if (status === 404 || message === 'The image has no signed release manifest') return { access: false, why: 'it has no botdot signature' };
  if (message === 'The release signature is invalid') return { access: false, why: "it is signed, but not with botdot's release key" };
  if (message === 'The signed image belongs to another repository' || message === 'The release is for another app') return { access: false, why: 'its signature is for another image' };
  return { access: false, why: `it could not be checked (${message})` };
}

module.exports = { signedImage, refusal };

if (require.main === module) {
  const [image, app] = process.argv.slice(2);
  if (!image || !['server', 'desktop'].includes(app)) throw new Error('Usage: node lib/signed-image.js <image> <server|desktop>');
  const token = require('node:fs').readFileSync(0, 'utf8').trim();
  if (token) process.env.BOT_DOT_REGISTRY_TOKEN = token;
  signedImage(image, app).then((pinned) => console.log(pinned), (error) => {
    const { access, why } = refusal(error);
    console.log(why);
    process.exitCode = access ? 2 : 1;
  });
}
