// Files a bot gives the owner with its reply (attach_file): copied out of its workspace, listed on the
// run, downloadable from /api/files/<runId>/<name>, and removed after 90 days.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, heldRun, self } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('a bot attaches a file from its workspace and the owner downloads it', async () => {
  const bot = await makeBot(srv);
  const { run, rec, token } = await heldRun(srv, bot, 'Make me the morning paper');
  assert.equal(rec.self.env.SELF_FILES, '1', 'it has attach_file');
  assert.match(rec.system, /attach_file/, 'and is told how to use it');
  const ws = path.join(srv.data, 'workspaces', bot.id);
  fs.mkdirSync(path.join(ws, 'paper'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'paper', 'Morning Paper.pdf'), '%PDF-1.7 the news');

  const r = await self(srv, token, 'file', { path: 'paper/Morning Paper.pdf' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.file, { name: 'Morning-Paper.pdf', file: `${run.id}/Morning-Paper.pdf`, size: 17 });
  // The same name again gets its own copy; nothing outside the workspace can be attached, not even through a link.
  assert.equal((await self(srv, token, 'file', { path: path.join(ws, 'paper', 'Morning Paper.pdf') })).data.file.name, 'Morning-Paper-2.pdf');
  const secret = path.join(os.tmpdir(), `botdot-secret-${process.pid}.txt`);
  fs.writeFileSync(secret, 'secret');
  fs.symlinkSync(secret, path.join(ws, 'link.txt'));
  for (const p of [secret, '../../vault.json', 'link.txt', 'nothing.pdf', 'paper']) {
    const bad = await self(srv, token, 'file', { path: p });
    assert.equal(bad.data.ok, false, `${p} is refused`);
  }
  fs.rmSync(secret);

  // Changing the original afterwards doesn't change what was sent.
  fs.writeFileSync(path.join(ws, 'paper', 'Morning Paper.pdf'), 'changed');
  srv.release(rec);
  const done = await srv.finished(run.id);
  assert.deepEqual(done.files.map((f) => f.name), ['Morning-Paper.pdf', 'Morning-Paper-2.pdf']);
  const res = await fetch(`${srv.base}/api/files/${run.id}/Morning-Paper.pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(await res.text(), '%PDF-1.7 the news');
  assert.equal((await fetch(`${srv.base}/api/files/${run.id}/other.pdf`)).status, 404, 'only files the run lists');
  assert.equal((await fetch(`${srv.base}/api/files/${run.id}/..%2F${run.id}.json`)).status, 404);
  srv.unhold();
});

test("a scheduled run that only attached a file isn't quiet", async () => {
  const { quietRun } = require('../lib/problems');
  const meta = { trigger: 'schedule', status: 'success', result: '' };
  assert.equal(quietRun(meta), true);
  assert.equal(quietRun({ ...meta, files: [{ name: 'a.pdf' }] }), false);
});

test('files older than 90 days are removed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-outbox-'));
  const outbox = require('../lib/outbox').create(dir);
  for (const id of ['old', 'new']) { fs.mkdirSync(path.join(outbox.DIR, id), { recursive: true }); fs.writeFileSync(path.join(outbox.DIR, id, 'a.pdf'), 'x'); }
  const long = new Date(Date.now() - 91 * 24 * 3600_000);
  fs.utimesSync(path.join(outbox.DIR, 'old'), long, long);
  assert.equal(outbox.prune(), 1);
  assert.deepEqual(fs.readdirSync(outbox.DIR), ['new']);
  fs.rmSync(dir, { recursive: true, force: true });
});
