// Updating botdot, when it runs in Docker from the published images: the Mac app's local botdot server, which the Mac
// app updates (ADR 028). On a Linux machine the admin updates the front door and every account together from the admin
// page, through install.sh (#473), and an account's own server never does (server.js, UPDATES_BY_ADMIN).
//
// Checking asks the registry which image the tag (e.g. ghcr.io/kordal/bot-dot:latest) points to now
// and compares it with the image this container runs; nothing is downloaded. Updating downloads the
// new images, then starts a short-lived helper container from the new image that recreates this
// one with `docker compose up -d` in the install folder (and refreshes compose.yaml from the image).
// Data, settings and sign-ins live in volumes, so they stay.
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const registry = require('./registry');
const cleanup = require('./image-cleanup');
const signed = require('./signed-image');

const run = promisify(execFile);
const docker = async (args, timeout = 60_000) => (await run('docker', args, { timeout, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// A self-built botdot server (CONTEXT.md) runs images named without a registry: there is nothing to
// download, and it is updated from its source instead. Settings shows this sentence.
const SELF_BUILT = 'This botdot server was built from the source. Update it by pulling the source and building again: git pull, then make images and sh install.sh.';

// This container's id: the Docker-managed files it mounts carry it, even with host networking.
function ownContainerId() {
  try {
    const m = fs.readFileSync('/proc/self/mountinfo', 'utf8').match(/\/containers\/([0-9a-f]{64})\//);
    return m ? m[1] : null;
  } catch { return null; }
}

// platform: 'mac' for a local botdot server on a Mac (its compose file sets BOT_DOT_PLATFORM), whose
// compose file differs from Linux's. inDocker and containerId are normally found out here.
function create({ busy, computerImage, platform = process.env.BOT_DOT_PLATFORM, inDocker = fs.existsSync('/.dockerenv'), containerId = ownContainerId, publicKey, remoteRelease = registry.remoteRelease, layersSize = cleanup.layersSize }) {
  const composeFile = platform === 'mac' ? 'compose.mac.yaml' : 'compose.yaml';
  const state = { state: 'idle', available: false, checkedAt: null, error: null, remote: null };
  let self = null; // what this container runs, read once
  // The Mac app's local botdot server is updated by the Mac app and is never a self-built one.
  const selfBuilt = (me) => platform !== 'mac' && !registry.parse(me.image);

  async function describeSelf() {
    if (self) return self;
    const id = containerId();
    if (!id) throw new Error("Couldn't tell which container botdot runs in");
    const c = JSON.parse(await docker(['inspect', id]))[0];
    const img = JSON.parse(await docker(['image', 'inspect', c.Image]))[0];
    const labels = c.Config.Labels || {};
    const il = img.Config?.Labels || {};
    self = {
      id,
      image: c.Config.Image, // the tag it was started from
      imageId: c.Image,
      repoDigests: img.RepoDigests || [],
      revision: il['org.opencontainers.image.revision'] || null,
      version: Number(il['dev.botdot.release.version'] || 0),
      created: il['org.opencontainers.image.created'] || img.Created || null,
      project: labels['com.docker.compose.project'] || null,
      service: labels['com.docker.compose.service'] || null,
      dir: labels['com.docker.compose.project.working_dir'] || null,
    };
    return self;
  }

  const signedImage = (image, app, installed = 0) => signed.signedImage(image, app, { installed, publicKey, remoteRelease });

  async function check() {
    if (!inDocker) return status();
    if (['downloading', 'restarting'].includes(state.state)) return status();
    state.state = 'checking';
    try {
      const me = await describeSelf();
      if (selfBuilt(me)) {
        Object.assign(state, { available: false, remote: null, error: null, checkedAt: new Date().toISOString(), state: 'idle' });
        return status();
      }
      if (!registry.parse(me.image)) throw new Error(`botdot runs the local image ${me.image}, so there's nothing to check`);
      const image = await signedImage(me.image, 'server', me.version);
      const digest = image.split('@')[1];
      state.remote = digest;
      state.available = !me.repoDigests.some((d) => d.endsWith(`@${digest}`));
      state.error = null;
    } catch (e) {
      state.error = e.message;
    }
    state.checkedAt = new Date().toISOString();
    state.state = 'idle';
    return status();
  }

  async function apply({ force = false } = {}) {
    if (!inDocker) throw new Error('botdot isn\'t running in Docker here. Update it with git pull and a restart.');
    if (['downloading', 'restarting'].includes(state.state)) return status();
    const me = await describeSelf();
    if (selfBuilt(me)) throw new Error(SELF_BUILT);
    if (!me.dir || !me.project || !me.service) throw new Error('botdot wasn\'t started with Docker Compose, so it can\'t update itself. Run the installer again.');
    const n = busy();
    if (n && !force) throw new Error(`${n} ${n === 1 ? 'task is' : 'tasks are'} still running. Update when they're done, or update anyway and they stop.`);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(me.project) || me.service !== 'bot-dot' || !me.dir.startsWith('/') || /[\r\n]/.test(me.dir)) throw new Error('Invalid Compose installation');
    const image = await signedImage(me.image, 'server', me.version);
    let desktopVersion = 0;
    if (computerImage) {
      const current = await docker(['image', 'inspect', computerImage]).catch(() => '[]');
      desktopVersion = Number(JSON.parse(current)[0]?.Config?.Labels?.['dev.botdot.release.version'] || 0);
    }
    const desktop = computerImage ? await signedImage(computerImage, 'desktop', desktopVersion) : null;
    state.state = 'downloading';
    state.error = null;
    (async () => {
      try {
        await registry.login(me.image);
        await docker(['pull', '-q', image], 30 * 60_000);
        if (computerImage && registry.parse(computerImage)) {
          await registry.login(computerImage);
          await docker(['pull', '-q', desktop], 30 * 60_000);
        }
        state.state = 'restarting';
        // The helper runs from the new image, so it brings the matching compose file (the install
        // keeps it as compose.yaml). It outlives this container, recreates it, and removes itself.
        const script = [
          // The image's PORT=4747 would beat the install's .env in compose and move the server (#376).
          'unset PORT',
          'sleep 2',
          // Keep the old compose.yaml if the image has none, rather than not restarting at all.
          `cp /opt/bot-dot/${composeFile} compose.yaml.new && mv compose.yaml.new compose.yaml`,
          `node /opt/bot-dot/lib/update-install.js '${image}' '${desktop || ''}'`,
          // On a Mac its front door too (compose.mac.yaml), so that it never runs another version than its botdot server.
          `docker compose -p "${me.project}" up -d --wait --wait-timeout 120 --remove-orphans bot-dot docker-helper${platform === 'mac' ? ' front-door' : ''}`,
          `docker compose -p "${me.project}" exec -T --user 60000:60000 bot-dot node /opt/bot-dot/lib/update-install.js --record`,
        ].join(' && ');
        const p = spawn('docker', [
          'run', '-d', '--rm', '--name', `${me.project}-updater-${Date.now()}`,
          '-v', '/var/run/docker.sock:/var/run/docker.sock',
          '-v', `${me.dir}:${me.dir}`, '-w', me.dir,
          '--entrypoint', 'sh', image, '-c', script,
        ], { stdio: 'ignore', detached: true });
        p.on('error', (e) => { state.state = 'idle'; state.error = `Couldn't start the update: ${e.message}`; });
        p.on('exit', (code) => { if (code) { state.state = 'idle'; state.error = `Couldn't start the update (exit ${code})`; } });
        p.unref();
      } catch (e) {
        state.state = 'idle';
        state.error = e.message.includes('denied') ? 'The registry refused the download. Check the token in .env.' : e.message;
      }
    })();
    return status();
  }

  // Removes the images the updates left behind (lib/image-cleanup.js has the rule). Asked for by the
  // new server once an update ended healthy, and by the installer. Nothing on a Mac: null.
  const updating = () => ['downloading', 'restarting'].includes(state.state);
  const repository = (image) => { const ref = registry.parse(image); return ref ? `${ref.registry}/${ref.repo}` : null; };
  let cleaning = Promise.resolve();
  function clean() {
    if (!inDocker || platform === 'mac') return Promise.resolve(null);
    // One pass at a time: a second caller waits and reports its own pass, so no image is counted twice.
    const pass = cleaning.then(async () => {
      if (updating()) throw new Error('An update is in progress');
      // Read now, not from describeSelf's memory: the server may have been recreated since.
      const server = JSON.parse(await docker(['inspect', containerId()]))[0];
      return cleanup.clean({ // with the module's own docker: an inventory of every image is larger than this file's calls
        repositories: [repository(server.Config.Image), repository(computerImage)],
        references: [server.Config.Image, computerImage],
        keep: [server.Image],
        size: layersSize,
        stop: updating, // an update that starts meanwhile ends the pass
      });
    });
    cleaning = pass.catch(() => {});
    return pass;
  }

  function status() {
    const built = inDocker && !!self && selfBuilt(self);
    return {
      supported: inDocker,
      ...state,
      selfBuilt: built,
      ...(built ? { howToUpdate: SELF_BUILT } : {}),
      version: self ? { revision: self.revision, short: self.revision ? self.revision.slice(0, 7) : null, created: self.created, image: self.image } : null,
    };
  }

  function start() {
    if (!inDocker) return;
    describeSelf().catch(() => {});
    setTimeout(() => check().catch(() => {}), 60_000).unref();
    setInterval(() => check().catch(() => {}), CHECK_EVERY_MS).unref();
  }

  return { check, apply, clean, lastStatus: () => ({ available: state.available }), status: async () => { if (inDocker) await describeSelf().catch(() => {}); return status(); }, start };
}

module.exports = { create: process.env.BOT_DOT_HELPER_SOCKET ? require('./helper-client').updates : create, SELF_BUILT };
