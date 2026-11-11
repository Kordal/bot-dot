const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function machine(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-prepare-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of ['bin', 'accounts/ann', 'computer-preparation', 'run']) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'accounts/ann/compose.yaml'), 'services: {}');
  const image = 'ghcr.io/kordal/bot-dot-desktop@sha256:' + 'a'.repeat(64);
  const task = path.join(root, 'computer-preparation/ann');
  fs.writeFileSync(task, image);
  const bin = (n, text) => fs.writeFileSync(path.join(root, 'bin', n), '#!/bin/sh\n' + text, { mode: 0o755 });
  bin('flock', 'exit 0'); bin('chown', 'exit 0'); bin('timeout', 'shift; exec "$@"'); bin('sleep', 'exit 0');
  bin('docker', 'echo pull >> "$BOT_DOT_DIR/calls"; if [ ! -f "$BOT_DOT_DIR/once" ]; then touch "$BOT_DOT_DIR/once"; echo "TLS handshake timeout"; exit 1; fi\n');
  const run = () => spawnSync('sh', ['deploy/prepare-computers.sh'], { encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, BOT_DOT_DIR: root, BOT_DOT_RUN: `${root}/run` } });
  return { root, task, bin, run, status: () => JSON.parse(fs.readFileSync(path.join(root, 'front-door/status/computer-preparation.json'))) };
}
test('computer preparation retries transient downloads and survives an interrupted claim', (t) => {
  const m = machine(t);
  fs.renameSync(m.task, m.task + '.running');
  const done = m.run();
  assert.equal(done.status, 0, done.stderr);
  assert.equal(m.status().state, 'ready');
  assert.equal(fs.readFileSync(path.join(m.root, 'calls'), 'utf8').trim().split('\n').length, 2);
  assert.ok(!fs.existsSync(m.task));
});
test('a permanent computer failure keeps its task and reports failure without repeated pulls', (t) => {
  const m = machine(t);
  m.bin('docker', 'echo pull >> "$BOT_DOT_DIR/calls"; echo "no space left on device"; exit 1');
  assert.equal(m.run().status, 1);
  assert.equal(m.status().state, 'failed');
  assert.ok(fs.existsSync(m.task + '.blocked'));
  assert.equal(m.run().status, 1);
  assert.equal(fs.readFileSync(path.join(m.root, 'calls'), 'utf8').trim(), 'pull');
});
