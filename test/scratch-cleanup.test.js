// A test server's scratch folder is removed when its test file ends, and npm test sweeps the ones a killed
// process left (test/helpers.js, test/run.js): left behind they filled the disk, 33 MB a server.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sweepScratch, STALE_MS } = require('./run');

test("a test server's scratch folder is gone once its test file's process ends", () => {
  const script = `
    const { startServer } = require(${JSON.stringify(path.join(__dirname, 'helpers.js'))});
    startServer().then(async (srv) => { console.log(srv.dir); await srv.stop(); process.exit(0); });`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60_000 });
  assert.strictEqual(r.status, 0, r.stderr);
  const dir = r.stdout.trim().split('\n').pop();
  assert.ok(path.basename(dir).startsWith('botdot-test-'), dir);
  assert.strictEqual(fs.existsSync(dir), false, `${dir} was left`);
});

test('npm test sweeps the scratch folders older than six hours, and only those', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-sweep-'));
  try {
    const now = Date.now();
    const make = (name, ageMs) => {
      const d = path.join(root, name);
      fs.mkdirSync(path.join(d, 'data'), { recursive: true });
      const t = new Date(now - ageMs);
      fs.utimesSync(d, t, t);
      return d;
    };
    const stale = make('botdot-test-aaaaaa', STALE_MS + 60_000);
    const fresh = make('botdot-test-bbbbbb', 60_000);
    const other = make('botdot-vault-cccccc', STALE_MS + 60_000);
    assert.strictEqual(sweepScratch(root, now), 1);
    assert.strictEqual(fs.existsSync(stale), false);
    assert.ok(fs.existsSync(fresh), 'a running test keeps its folder');
    assert.ok(fs.existsSync(other), 'another prefix is not touched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
