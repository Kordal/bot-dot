// The document viewer (#251): the apps fetch a file's text as JSON and draw it themselves; botdot never serves it as
// a page. A file a bot attached, one of its files, and a file a path in its reply names, in its workspace or on the
// account's computer, which is never started just to read one. The owner's alone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, makeBot, seedRuns, fakeDocker } = require('./helpers');
const view = require('../lib/file-view');

let srv; let bot; let docker; let runId;
before(async () => {
  docker = fakeDocker();
  srv = await startServer({ env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  bot = await makeBot(srv, { name: 'News Monitor', emoji: '📰', computer: 'linux' });
  [runId] = seedRuns(srv, bot, [{ files: [{ name: 'report.md', file: 'x', size: 1 }, { name: 'contract.pdf', file: 'y', size: 1 }] }]);
  const dir = path.join(srv.data, 'files', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.md'), '# Weekly report\n<script>alert(1)</script>\n');
  fs.writeFileSync(path.join(dir, 'contract.pdf'), '%PDF-1.4');
});
after(async () => { await srv.stop(); docker.remove(); });

const ws = () => path.join(srv.data, 'workspaces', bot.id);
const at = (p, more = '') => `/bots/${bot.id}/path?path=${encodeURIComponent(p)}${more}`;

test('the viewer gets a file a bot attached as JSON, its text never a page', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('document-viewer'));
  const r = await srv.api(`/files/${runId}/report.md?view=1`);
  assert.equal(r.status, 200);
  assert.deepEqual({ ...r.data, at: null }, { name: 'report.md', size: 42, at: null, kind: 'markdown', type: 'text/markdown', truncated: false, text: '# Weekly report\n<script>alert(1)</script>\n' });
  const pdf = await srv.api(`/files/${runId}/contract.pdf?view=1`);
  assert.equal(pdf.data.kind, 'none', 'no preview: the apps offer Download');
  assert.equal(pdf.data.text, undefined);
  // The download stays as it was: an attachment in a sandbox.
  const res = await fetch(`${srv.base}/api/files/${runId}/report.md`, { headers: { 'X-Bot-Dot': '1' } });
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  assert.equal(res.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  assert.equal((await srv.api(`/files/${runId}/gone.md?view=1`)).status, 404);
});

test('a large file comes as its first 1,000 lines, said to be cut', async () => {
  fs.mkdirSync(path.join(ws(), 'out'), { recursive: true });
  fs.writeFileSync(path.join(ws(), 'out', 'all.csv'), Array.from({ length: 5000 }, (_, i) => `row${i},${i}`).join('\n'));
  fs.writeFileSync(path.join(ws(), 'out', 'huge.log'), 'x'.repeat(view.VIEW_BYTES + 500));
  const r = await srv.api(at('out/all.csv', '&view=1'));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.kind, 'csv');
  assert.equal(r.data.truncated, true);
  assert.equal(r.data.text.split('\n').length, 1000);
  assert.equal(r.data.text.split('\n').at(-1), 'row999,999');
  const big = await srv.api(at('out/huge.log', '&view=1'));
  assert.equal(big.data.truncated, true);
  assert.equal(big.data.text.length, view.VIEW_BYTES, 'at most 1 MB');
  assert.equal(big.data.size, view.VIEW_BYTES + 500);
  // stat=1: its size for the link's tip, no text.
  const stat = await srv.api(at('out/huge.log', '&stat=1'));
  assert.equal(stat.data.size, view.VIEW_BYTES + 500);
  assert.equal(stat.data.text, undefined);
  // Without view=1 it downloads, whole, as an attachment.
  const raw = await srv.api(at('out/all.csv'));
  assert.equal(raw.status, 200);
  assert.equal(String(raw.data).split('\n').length, 5000);
  // A path in its folder may be rewritten under the same address: never kept by the browser.
  const res = await fetch(`${srv.base}/api${at('out/all.csv')}`, { headers: { 'X-Bot-Dot': '1' } });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  await res.arrayBuffer();
});

test("one of a bot's files opens in the viewer too", async () => {
  const up = await srv.api(`/uploads?to=bot:${bot.id}`, { method: 'POST', raw: Buffer.from('a,b\n1,2\n'), headers: { 'X-File-Name': 'prices.csv' } });
  const r = await srv.api(`/bots/${bot.id}/files/${encodeURIComponent(up.data.file.split('/').pop())}?view=1`);
  assert.equal(r.status, 200);
  assert.equal(r.data.text, 'a,b\n1,2\n');
  assert.equal(r.data.name, 'prices.csv');
  const gone = await srv.api(`/bots/${bot.id}/files/nothing.csv?view=1`);
  assert.equal(gone.status, 404);
  assert.equal(gone.data.state, 'gone');
});

test('a path in a reply: a missing file is gone, a folder or a path out of the bot\'s folder is refused', async () => {
  const missing = await srv.api(at('out/nothing.md', '&view=1'));
  assert.equal(missing.status, 404);
  assert.equal(missing.data.state, 'gone');
  assert.equal((await srv.api(at('out', '&view=1'))).status, 400, 'a folder');
  for (const p of ['../other/x.md', 'out/../../x.md', '/etc/hosts', '/home/boxer/x.md', '/workspace']) {
    const r = await srv.api(at(p, '&view=1'));
    assert.equal(r.status, 403, p);
    assert.equal(r.data.state, 'refused', p);
  }
  // A link inside its folder that points out of it.
  fs.writeFileSync(path.join(srv.dir, 'secret.txt'), 'not yours');
  fs.symlinkSync(path.join(srv.dir, 'secret.txt'), path.join(ws(), 'out', 'escape.txt'));
  const esc = await srv.api(at('out/escape.txt', '&view=1'));
  assert.equal(esc.status, 403);
  assert.doesNotMatch(JSON.stringify(esc.data), /not yours/);
});

test('a bare name in a reply opens the file a teammate handed over, or one the bot made in a folder (#543)', async () => {
  // message_bot copies a teammate's files into uploads/<time>-<hex>-<name>; the reply names them by their plain name.
  const up = path.join(ws(), 'uploads');
  fs.mkdirSync(up, { recursive: true });
  fs.writeFileSync(path.join(up, '20261024120000-0a1b-Tester-Pain-Questions.md'), '# Old script\n');
  fs.writeFileSync(path.join(up, '20261025094000-c3d4-Tester-Pain-Questions.md'), '# Script\n');
  fs.utimesSync(path.join(up, '20261024120000-0a1b-Tester-Pain-Questions.md'), new Date('2026-10-24'), new Date('2026-10-24'));
  fs.writeFileSync(path.join(up, '20261025094000-e5f6-Tester-Pain-Answers-Log.csv'), 'code,question,answer\n');
  const md = await srv.api(at('Tester-Pain-Questions.md', '&view=1'));
  assert.equal(md.status, 200, JSON.stringify(md.data));
  assert.equal(md.data.name, 'Tester-Pain-Questions.md');
  assert.equal(md.data.text, '# Script\n', 'the newest copy');
  const csv = await srv.api(at('Tester-Pain-Answers-Log.csv', '&view=1'));
  assert.equal(csv.status, 200);
  assert.equal(csv.data.kind, 'csv');
  assert.equal(csv.data.text, 'code,question,answer\n');
  // Its raw download too, under its plain name.
  const res = await fetch(`${srv.base}/api${at('Tester-Pain-Answers-Log.csv')}`, { headers: { 'X-Bot-Dot': '1' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /Tester-Pain-Answers-Log\.csv$/);
  // A file the bot made in a folder of its own, named bare; never one in a hidden folder.
  fs.mkdirSync(path.join(ws(), 'drafts', 'calls'), { recursive: true });
  fs.writeFileSync(path.join(ws(), 'drafts', 'calls', 'plan.md'), '# Plan\n');
  assert.equal((await srv.api(at('plan.md', '&view=1'))).data.text, '# Plan\n');
  fs.mkdirSync(path.join(ws(), '.claude'), { recursive: true });
  fs.writeFileSync(path.join(ws(), '.claude', 'hidden.md'), 'no');
  assert.equal((await srv.api(at('hidden.md', '&view=1'))).status, 404);
  // A path with a folder is read only where it says; a link out of the workspace stays refused.
  assert.equal((await srv.api(at('other/plan.md', '&view=1'))).status, 404);
  fs.symlinkSync(path.join(srv.dir, 'secret.txt'), path.join(up, '20261025094500-0000-leak.txt'));
  const leak = await srv.api(at('leak.txt', '&view=1'));
  assert.equal(leak.status, 403);
  assert.doesNotMatch(JSON.stringify(leak.data), /not yours/);
});

test('only the owner opens files: the Chief is refused', async () => {
  for (const p of [at('out/all.csv', '&view=1'), `/files/${runId}/report.md?view=1`]) {
    const r = await srv.asChief(p);
    assert.equal(r.status, 403, p);
  }
});

test("a file on the account's computer: off, it says so and nothing starts it; on, it is read there", async () => {
  docker.answer('inspect.json', null);
  const before = docker.calls().length;
  const off = await srv.api(at('/workspace/news/report.md', '&view=1'));
  assert.equal(off.status, 409);
  assert.equal(off.data.state, 'computer-off');
  assert.ok(!docker.calls().slice(before).some((c) => ['run', 'start', 'exec'].includes(c.args[0])), 'nothing started or run');

  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"');
  docker.answer('exec.txt', `ok 11 1760000000\n${Buffer.from('# From box\n').toString('base64')}`);
  const on = await srv.api(at('~/notes/today.md', '&view=1'));
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.text, '# From box\n');
  assert.equal(on.data.name, 'today.md');
  const exec = docker.calls().filter((c) => c.args[0] === 'exec').at(-1).args;
  assert.ok(exec.includes('box'), 'read as box');
  assert.match(exec.at(-1), /p='\/home\/box\/notes\/today\.md'/);
  const raw = await srv.api(at('~/notes/today.md'));
  assert.equal(String(raw.data), '# From box\n');

  // Over 1 MB it can't come out whole: its text shows cut, a picture not at all, and the raw file is refused.
  const big = Buffer.alloc(view.VIEW_BYTES, 0x61);
  docker.answer('exec.txt', `ok ${view.VIEW_BYTES + 10} 1760000000\n${big.toString('base64')}`);
  const shot = await srv.api(at('~/shots/screen.png', '&view=1'));
  assert.equal(shot.data.kind, 'none');
  assert.equal(shot.data.downloadable, false);
  const log = await srv.api(at('~/out/big.log', '&view=1'));
  assert.equal(log.data.kind, 'text');
  assert.equal(log.data.truncated, true);
  assert.equal(log.data.downloadable, false);
  assert.equal((await srv.api(at('~/out/big.log'))).status, 413);

  docker.answer('exec.txt', 'gone\n');
  assert.equal((await srv.api(at('/workspace/news/old.md', '&view=1'))).status, 404);
  docker.answer('exec.txt', 'outside\n');
  assert.equal((await srv.api(at('/workspace/news/link.md', '&view=1'))).status, 403);
  docker.answer('inspect.json', null);
  docker.answer('exec.txt', null);
});

// The script that reads a file on the computer, run here with two scratch folders as its roots.
test('the computer script follows links itself and reads only regular files inside the roots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-view-'));
  const home = path.join(dir, 'home'); const work = path.join(dir, 'work');
  fs.mkdirSync(path.join(home, 'sub'), { recursive: true }); fs.mkdirSync(work);
  fs.writeFileSync(path.join(home, "it's.md"), 'hello');
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'secret');
  fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(work, 'link.txt'));
  fs.symlinkSync(path.join(home, "it's.md"), path.join(work, 'inside.md'));
  const run = (p) => execFileSync('sh', ['-c', view.computerScript(p, { roots: [home, work] })], { encoding: 'utf8' });
  try {
    const ok = view.computerAnswer(run(path.join(home, "it's.md")));
    assert.equal(ok.bytes.toString(), 'hello');
    assert.equal(ok.size, 5);
    assert.equal(view.computerAnswer(run(path.join(work, 'inside.md'))).bytes.toString(), 'hello');
    assert.throws(() => view.computerAnswer(run(path.join(work, 'link.txt'))), { status: 403 });
    assert.throws(() => view.computerAnswer(run(path.join(work, 'none.md'))), { status: 404 });
    assert.throws(() => view.computerAnswer(run(path.join(home, 'sub'))), { status: 400 });
    assert.throws(() => view.computerAnswer(run(home)), { status: 403 }, 'a root itself is no file in it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
