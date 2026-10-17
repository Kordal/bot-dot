// Run from a verified updater image in its own Compose installation directory; --record and --clean
// also in the server's container, as the server's user.
const fs = require('node:fs');
async function record() {
  if (process.getuid?.() === 0) {
    // Older helpers invoke the NEW image's recorder in the host install directory.
    // Coordinate through Docker; never open server-controlled data paths as root.
    const exec = require('node:util').promisify(require('node:child_process').execFile);
    const deadline = Date.now() + 120_000;
    const docker = async args => (await exec('docker', args, { encoding: 'utf8', timeout: Math.max(1, Math.min(10_000, deadline - Date.now())), maxBuffer: 1024 * 1024 })).stdout.trim();
    while (Date.now() < deadline) {
      const output = await docker(['ps', '-q', '--no-trunc', '--filter', `label=com.docker.compose.project.working_dir=${process.cwd()}`, '--filter', 'label=com.docker.compose.service=bot-dot']);
      const ids = output ? output.split('\n') : [];
      if (ids.length > 1 || ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('Cannot identify one running server in this installation');
      if (ids.length === 1) {
        const health = await docker(['inspect', '--format', '{{.State.Health.Status}}', ids[0]]);
        if (health === 'healthy') {
          await docker(['exec', '--user', '60000:60000', ids[0], 'node', '/opt/bot-dot/lib/update-install.js', '--record']);
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Timed out waiting for the updated server to become healthy');
  }
  require('./audit').create(serverData())('update.applied', 'owner');
  // The images this update replaced go now (lib/image-cleanup.js). Apart from this process, which ends
  // here with the code it always had: an older updater gives it ten seconds, and removing images takes longer.
  // A cleanup that could not even start is one failure, as for a helper that does not answer. The next update cleans.
  const notStarted = () => { try { require('./audit').create(serverData())('update.cleaned', 'owner', { ...require('./image-cleanup').NOTHING, failed: 1 }); } catch { /* the update itself is recorded */ } };
  try {
    const child = require('node:child_process').spawn(process.execPath, [__filename, '--clean'], { detached: true, stdio: 'ignore' });
    child.on('error', notStarted); // a start that failed is told here, not thrown
    child.unref();
  } catch { notStarted(); }
}
function serverData() {
  if (process.getuid?.() !== 60000) throw new Error('Update audit requires the server identity');
  const data = process.env.BOT_DOT_DATA;
  if (typeof data !== 'string' || !require('node:path').isAbsolute(data)) throw new Error('Update audit requires an absolute server data directory');
  return data;
}
// Asks the helper to remove the images no longer used and writes what it did to the audit log, as
// `update.cleaned`. A cleanup that could not run at all is one failure, tried again at the next update.
// On a Mac-hosted botdot there is no cleanup and no line.
async function clean() {
  const audit = require('./audit').create(serverData());
  const none = { ...require('./image-cleanup').NOTHING };
  if (process.env.BOT_DOT_PLATFORM === 'mac') return none;
  const failed = { ...none, failed: 1 };
  let result = failed;
  try {
    if (!process.env.BOT_DOT_HELPER_SOCKET) throw new Error('No Docker helper');
    result = await require('./helper-client').updates({ busy: () => 0 }).clean();
    if (result === null) return none; // the helper runs on a Mac
  } catch { result = failed; }
  try { audit('update.cleaned', 'owner', result); } catch (e) {
    if (e.message !== 'Invalid audit detail') throw e;
    audit('update.cleaned', 'owner', result = failed); // not the four numbers: the helper's answer is not trusted
  }
  return result;
}
if (process.argv[2] === '--record') {
  record().catch(error => { console.error(error.message); process.exitCode = 1; });
  return;
}
if (process.argv[2] === '--clean') {
  clean().then(result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1; });
  return;
}
const image = process.argv[2];
const desktop = process.argv[3];
const valid = (s) => /^[a-z0-9.-]+(?::\d+)?\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(s);
if (!valid(image) || desktop && !valid(desktop)) throw new Error('Invalid pinned image');
let env = '';
try { env = fs.readFileSync('.env', 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
for (const [key, value] of Object.entries({ BOT_DOT_IMAGE: image, ...(desktop ? { BOT_DOT_COMPUTER_IMAGE: desktop } : {}) })) {
  env = env.split('\n').filter((line) => !new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)).join('\n');
  env += `\n${key}=${value}\n`;
}
fs.writeFileSync('.env.update', env, { mode: 0o600 });
// .env stays its owner's: the updater is root, and the installer, run again as that user, changes it.
try { const owner = fs.statSync('.env'); fs.chownSync('.env.update', owner.uid, owner.gid); } catch (e) { if (e.code !== 'ENOENT') throw e; }
fs.renameSync('.env.update', '.env');
