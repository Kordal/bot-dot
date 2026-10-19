// The server image's /tmp is on the container's own disk, not in gVisor's memory (#126): runsc mounts a tmpfs in
// the sandbox's memory on a /tmp that is empty in the image, sized to half the machine's RAM and outside the
// account's share; one that holds a file is left on the disk. The supervisor empties it at each start, as a
// tmpfs would be, keeping that file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { clearTmp, TMP_MARK } = require('../lib/privilege-broker');

const ROOT = path.join(__dirname, '..');

test('the server image keeps a file in /tmp, so that gVisor leaves /tmp on the disk', () => {
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.ok(docker.includes(`RUN touch /tmp/${TMP_MARK}`), 'the Dockerfile makes the file');
  const desktop = fs.readFileSync(path.join(ROOT, 'deploy', 'desktop', 'Dockerfile'), 'utf8');
  assert.match(desktop, /install -d -m 1777 \/tmp\/\.X11-unix/, "the computer's /tmp holds X's folders, so it is on the disk already");
});

test('the supervisor empties /tmp at its start, keeping the file, and follows no link out of it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-tmp-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-outside-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(dir, TMP_MARK), '');
  fs.mkdirSync(path.join(dir, 'claude-60500', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude-60500', 'tasks', 'out.log'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(dir, '.hidden'), '');
  fs.writeFileSync(path.join(outside, 'keep'), 'kept');
  fs.symlinkSync(outside, path.join(dir, 'link'));
  clearTmp(dir);
  assert.deepEqual(fs.readdirSync(dir), [TMP_MARK]);
  assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'kept', 'a link is removed, not what it points to');
  clearTmp(path.join(dir, 'missing')); // no /tmp: nothing to do
});
