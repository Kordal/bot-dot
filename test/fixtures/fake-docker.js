#!/usr/bin/env node
// A stand-in for the docker CLI, for the tests: nothing runs. Each call appends its arguments as one
// JSON line to $FAKE_DOCKER_OUT/calls.jsonl. Answers: `docker inspect` prints
// $FAKE_DOCKER_OUT/inspect.json, `docker image inspect` image.json; anything else prints nothing.
// On PATH it must be called "docker": helpers.fakeDocker() puts a small wrapper by that name in a folder.
//
// For the Mac app's setup (BotDotKit's LocalServer tests), files in $FAKE_DOCKER_OUT steer it:
//   down        `docker info` fails, as when Docker isn't running
//   private     `docker pull` fails until `docker login` got the token in good-token
//   good-token  the token `docker login --password-stdin` accepts
//   missing     the image `docker pull` can't download now
// and `docker run … cat /opt/bot-dot/compose.mac.yaml` prints the real compose.mac.yaml.
//
// For the image cleanup (lib/image-cleanup.js), host.json in $FAKE_DOCKER_OUT is a small Docker host:
//   images      [{ Id, RepoTags, RepoDigests, Labels }]
//   containers  [{ Id, Image }], Image an image id; `late` alike, for containers that exist only from
//               the second `docker ps` on
//   refuse      { "<reference>": "<what docker says>" }: `docker image rm` of it fails with that
// `image ls`, `image inspect`, `ps`, `inspect --type container` and `image rm` then answer from it, and
// `image rm` changes it as Docker does: the image goes with its last reference, a repository's digest
// references go with its last tag, and an image a container uses keeps its last reference.
const fs = require('fs');
const path = require('path');

const OUT = process.env.FAKE_DOCKER_OUT;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(OUT, 'calls.jsonl'), `${JSON.stringify({ args })}\n`);
const has = (f) => fs.existsSync(path.join(OUT, f));
const fail = (message) => { process.stderr.write(`${message}\n`); process.exit(1); };

if (args[0] === 'info' && has('down')) fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
if (args[0] === 'pull' && has('private') && !has('logged-in')) fail(`Error response from daemon: Head "https://ghcr.io/v2/${args[1]}": unauthorized`);
if (args[0] === 'pull' && has('missing') && fs.readFileSync(path.join(OUT, 'missing'), 'utf8').trim() === args.at(-1)) fail('Error response from daemon: Get "https://ghcr.io/v2/": net/http: request canceled while waiting for connection');
if (args[0] === 'login') {
  const token = fs.readFileSync(0, 'utf8').trim();
  if (!has('good-token') || token !== fs.readFileSync(path.join(OUT, 'good-token'), 'utf8').trim()) fail('Error response from daemon: Get "https://ghcr.io/v2/": denied: denied');
  fs.writeFileSync(path.join(OUT, 'logged-in'), '');
  process.stdout.write('Login Succeeded\n');
}
// install.sh's signature check (`docker run … node /check/lib/signed-image.js <image> <app>`, a token on
// stdin) says what signed.json in $FAKE_DOCKER_OUT has for the image: { "<image>": "<why it was refused>" };
// any other image is signed, as its repository at sha256:c…c. With `private`, it wants the token in good-token.
// `--revision` after the app adds the source revision it was built from.
if (args[0] === 'run' && args.includes('/check/lib/signed-image.js')) {
  const [image] = args.slice(args.indexOf('/check/lib/signed-image.js') + 1);
  const token = fs.readFileSync(0, 'utf8').trim();
  if (has('private') && (!has('good-token') || token !== fs.readFileSync(path.join(OUT, 'good-token'), 'utf8').trim())) { process.stdout.write('the registry refused access\n'); process.exit(2); }
  const refused = has('signed.json') ? JSON.parse(fs.readFileSync(path.join(OUT, 'signed.json'), 'utf8'))[image] : null;
  if (refused) { process.stdout.write(`${refused}\n`); process.exit(1); }
  const name = image.split('@')[0];
  // With --revision, the source revision after it: revision in $FAKE_DOCKER_OUT, else d…d.
  const revision = args.includes('--revision') ? ` ${has('revision') ? fs.readFileSync(path.join(OUT, 'revision'), 'utf8').trim() : 'd'.repeat(40)}` : '';
  process.stdout.write(`${name.lastIndexOf(':') > name.lastIndexOf('/') ? name.slice(0, name.lastIndexOf(':')) : name}@sha256:${'c'.repeat(64)}${revision}\n`);
  process.exit(0);
}
if (args[0] === 'run' && args.at(-1) === '/opt/bot-dot/compose.mac.yaml') {
  process.stdout.write(fs.readFileSync(path.join(__dirname, '..', '..', 'compose.mac.yaml'), 'utf8'));
}

const hostFile = path.join(OUT, 'host.json');
if (fs.existsSync(hostFile) && (['ps'].includes(args[0]) || args[0] === 'image' && ['ls', 'inspect', 'rm'].includes(args[1]) || args[0] === 'inspect' && args.includes('--type'))) {
  const host = JSON.parse(fs.readFileSync(hostFile, 'utf8'));
  const say = (text) => process.stdout.write(`${text}\n`);
  const repo = (ref) => { const name = ref.split('@')[0]; const colon = name.lastIndexOf(':'); return colon > name.lastIndexOf('/') ? name.slice(0, colon) : name; };
  const named = (ref) => (ref.includes('@') || repo(ref) !== ref ? ref : `${ref}:latest`);
  const find = (ref) => host.images.find((i) => i.Id === ref || i.RepoTags.includes(named(ref)) || i.RepoDigests.includes(ref));
  const psCalls = fs.readFileSync(path.join(OUT, 'calls.jsonl'), 'utf8').trim().split('\n').filter((l) => JSON.parse(l).args[0] === 'ps').length;
  const containers = [...(host.containers || []), ...(psCalls > 1 || args[0] !== 'ps' ? host.late || [] : [])];
  const things = args.filter((a, i) => i > 1 && !a.startsWith('-') && args[i - 1] !== '--format' && args[i - 1] !== '--type');
  let missing = null;
  if (args[0] === 'ps') for (const c of containers) say(c.Id);
  else if (args[0] === 'inspect') {
    for (const id of things) { const c = containers.find((x) => x.Id === id); if (c) say(c.Image); else missing = `No such container: ${id}`; }
  } else if (args[1] === 'ls') {
    // One row per tag. An image with a digest and no tag, which is what a pull by digest and a moved tag
    // leave, has a row only with --digests or -a: Docker hides it otherwise.
    const all = args.includes('--digests') || args.includes('-a');
    for (const i of host.images) for (let n = all ? Math.max(1, i.RepoTags.length) : i.RepoTags.length; n > 0; n--) say(i.Id);
  } else if (args[1] === 'inspect') {
    const found = [];
    for (const ref of things) { const i = find(ref); if (i) found.push(i); else missing = `No such image: ${ref}`; }
    const format = args[args.indexOf('--format') + 1] || '';
    if (format.includes('len .RepoTags')) for (const i of found) say(`${i.RepoTags.length} ${i.RepoDigests.length}`);
    else if (args.includes('--format')) for (const i of found) say(i.Id);
    else say(JSON.stringify(found.map((i) => ({ Id: i.Id, RepoTags: i.RepoTags, RepoDigests: i.RepoDigests, Config: { Labels: i.Labels || null } }))));
  } else {
    const ref = things[0];
    const image = host.images.find((i) => i.Id === ref || i.RepoTags.includes(named(ref)) || i.RepoDigests.includes(ref));
    if (host.refuse?.[ref]) fail(host.refuse[ref]);
    if (!image) fail(`Error response from daemon: No such image: ${ref}`);
    const user = containers.find((c) => c.Image === image.Id);
    if (ref === image.Id) { // by id: the whole image, which only a nameless one is asked for
      if (user) fail(`Error response from daemon: conflict: unable to delete ${image.Id.slice(7, 19)} (must be forced) - image is being used by stopped container ${user.Id.slice(0, 12)}`);
      image.RepoTags = []; image.RepoDigests = [];
    }
    if (user && image.RepoTags.length + image.RepoDigests.length === 1) fail(`Error response from daemon: conflict: unable to remove repository reference "${ref}" (must force) - container ${user.Id.slice(0, 12)} is using its referenced image ${image.Id.slice(7, 19)}`);
    const wasTag = !ref.includes('@');
    image.RepoTags = image.RepoTags.filter((r) => r !== named(ref));
    image.RepoDigests = image.RepoDigests.filter((r) => r !== ref);
    if (wasTag && !image.RepoTags.some((r) => repo(r) === repo(ref)) && !user) image.RepoDigests = image.RepoDigests.filter((r) => repo(r) !== repo(ref));
    say(`Untagged: ${ref}`);
    if (!image.RepoTags.length && !image.RepoDigests.length) { host.images = host.images.filter((i) => i !== image); say(`Deleted: ${image.Id}`); }
    fs.writeFileSync(hostFile, JSON.stringify(host));
  }
  if (missing) fail(`Error response from daemon: ${missing}`);
  process.exit(0);
}

const answer = args[0] === 'inspect' ? 'inspect.json' : args[0] === 'image' && args[1] === 'inspect' ? 'image.json' : null;
if (answer) {
  try { process.stdout.write(fs.readFileSync(path.join(OUT, answer), 'utf8')); } catch { /* nothing to say */ }
}
