// The Files view's server side (#603): a folder says how many entries it holds, a copy never writes over anything,
// a move goes into a folder of this place or another (botdot <-> the account's computer <-> a project, carried as a
// tar), an image comes small for a grid, and any file on botdot can be kept in mind. Paths stay inside their root,
// what botdot keeps stays as it is, the computer is never started for it, every write is in the audit log, and the
// Chief is refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, makeBot, fakeDocker } = require('./helpers');
const W = require('../lib/workspace-files');
const tar = require('../lib/tar-lite');

let srv; let bot; let pc; let docker;
before(async () => {
  docker = fakeDocker();
  srv = await startServer({ env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  bot = await makeBot(srv, { name: 'Researcher', emoji: '🔎' });
  pc = await makeBot(srv, { name: 'Desk Worker', emoji: '🖥', computer: 'linux' });
});
after(async () => { await srv.stop(); docker.remove(); });

const ws = (b = bot) => path.join(srv.data, 'workspaces', b.id);
const put = (rel, text, b = bot) => { fs.mkdirSync(path.dirname(path.join(ws(b), rel)), { recursive: true }); fs.writeFileSync(path.join(ws(b), rel), text); };
const u = (what, more = '', b = bot) => `/bots/${b.id}/workspace/${what}${more}`;
const post = (what, body, more = '', b = bot) => srv.api(u(what, more, b), { method: 'POST', body });
const audit = () => (fs.existsSync(path.join(srv.data, 'audit.log')) ? fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []).filter((l) => l.action.startsWith('workspace-file.'));
const lastExec = () => docker.calls().filter((x) => x.args[0] === 'exec').at(-1).args;

test('features name files-explorer, and a folder says how many entries it holds', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('files-explorer'));
  put('notes/a.md', 'a'); put('notes/b.md', 'b'); put('notes/deep/c.md', 'c');
  fs.mkdirSync(path.join(ws(), 'empty'), { recursive: true });
  const r = await srv.api(`/bots/${bot.id}/workspace`);
  assert.equal(r.data.entries.find((e) => e.name === 'notes').items, 3);
  assert.equal(r.data.entries.find((e) => e.name === 'empty').items, 0);
  assert.equal(r.data.entries.find((e) => e.type === 'file')?.items, undefined);
});

test('a copy on botdot never writes over anything, takes a folder whole and is refused into itself or what botdot keeps', async () => {
  put('report.md', '# Week 43\n');
  let r = await post('copy', { from: 'report.md', into: '' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data, { ok: true, path: 'report (2).md', root: 'server' });
  assert.equal(fs.readFileSync(path.join(ws(), 'report (2).md'), 'utf8'), '# Week 43\n');
  r = await post('copy', { from: 'notes', into: 'empty' });
  assert.deepEqual(r.data.path, 'empty/notes');
  assert.equal(fs.readFileSync(path.join(ws(), 'empty/notes/deep/c.md'), 'utf8'), 'c');
  assert.ok(!fs.readdirSync(ws()).some((n) => n.startsWith('.botdot-copy')), 'nothing left behind');
  assert.equal((await post('copy', { from: 'notes', into: 'notes/deep' })).status, 400, 'not into itself');
  put('CLAUDE.md', 'rules');
  assert.equal((await post('copy', { from: 'report.md', into: '.claude' })).data.state, 'protected');
  r = await post('copy', { from: 'CLAUDE.md', into: 'notes' });
  assert.equal(r.status, 201, 'what botdot keeps may be copied out');
  assert.equal((await post('copy', { from: '../x', into: '' })).status, 403);
  assert.equal((await post('copy', { from: 'nothing.md', into: '' })).status, 404);
  assert.equal((await post('copy', { from: 'report.md', into: 'report.md' })).data.state, 'not-folder');
  fs.symlinkSync(path.join(srv.dir), path.join(ws(), 'away'));
  assert.equal((await post('copy', { from: 'away', into: 'notes' })).status, 403, 'a link is never copied');
  assert.equal((await post('copy', { from: 'report.md', into: 'away' })).status, 403, 'nor copied into');
  fs.unlinkSync(path.join(ws(), 'away'));
  assert.deepEqual(audit().filter((l) => l.action === 'workspace-file.copied').slice(0, 2).map((l) => [l.path, l.to, l.root]), [['report.md', 'report (2).md', 'server'], ['notes', 'empty/notes', 'server']]);
});

test('a move into a folder takes a free name, stays where it is in its own folder, and never moves what botdot keeps', async () => {
  put('draft.md', 'v1'); put('old/draft.md', 'v0');
  let r = await post('move', { from: 'draft.md', into: 'old' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { ok: true, path: 'old/draft (2).md', root: 'server' });
  assert.ok(!fs.existsSync(path.join(ws(), 'draft.md')));
  r = await post('move', { from: 'old/draft.md', into: 'old' });
  assert.equal(r.data.path, 'old/draft.md', 'in its folder already');
  assert.equal((await post('move', { from: 'CLAUDE.md', into: 'old' })).data.state, 'protected');
  assert.equal((await post('move', { from: 'old', into: 'old' })).status, 400);
  r = await post('move', { from: 'old/draft.md', to: 'old/renamed.md' });
  assert.equal(r.data.path, 'old/renamed.md', 'a rename is as before');
});

test('keep in mind: a file anywhere on botdot is copied into uploads/ and pinned; one given already is pinned as it is', async () => {
  put('summary.md', '# Summary\n');
  const r = await post('keep', { path: 'summary.md' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.file, /^uploads\/\d{14}-[0-9a-f]{4}-summary\.md$/);
  const files = (await srv.api(`/bots/${bot.id}/files`)).data.files;
  assert.deepEqual(files.filter((f) => f.pinned).map((f) => f.file), [r.data.file]);
  assert.ok(fs.existsSync(path.join(ws(), 'summary.md')), 'the file itself stays');
  const again = await post('keep', { path: r.data.file });
  assert.equal(again.data.file, r.data.file, 'no second copy');
  assert.equal((await post('keep', { path: 'notes' })).data.state, 'not-file');
  put('blank.md', '');
  assert.equal((await post('keep', { path: 'blank.md' })).status, 400, 'an empty file has nothing to keep in mind');
  assert.equal(audit().at(-1).action, 'workspace-file.kept');
});

test('a small image comes as itself for a grid, kept a few minutes; anything else has no small picture', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  fs.writeFileSync(path.join(ws(), 'acme.png'), png);
  const res = await fetch(`${srv.base}/api${u('thumb', '?path=acme.png')}`, { headers: { 'X-Bot-Dot': '1' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), 'private, max-age=300');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
  assert.equal((await srv.api(u('thumb', '?path=report.md'))).data.state, 'no-thumb');
  fs.writeFileSync(path.join(ws(), 'huge.png'), Buffer.alloc(1024 * 1024 + 1));
  assert.equal((await srv.api(u('thumb', '?path=huge.png'))).data.state, 'no-thumb');
  fs.symlinkSync(path.join(ws(), 'acme.png'), path.join(ws(), 'linked.png'));
  assert.notEqual((await srv.api(u('thumb', '?path=linked.png'))).status, 200, 'never through a link');
});

test('between botdot and the computer: off it says so and nothing starts; on, a tar goes each way as box', async () => {
  put('report.md', '# On botdot\n', pc);
  put('site/index.html', '<p>', pc);
  docker.answer('inspect.json', null);
  const before = docker.calls().length;
  let r = await post('copy', { from: 'report.md', into: '', place: { root: 'computer' } }, '', pc);
  assert.equal(r.data.state, 'computer-off');
  r = await post('move', { from: 'a.txt', into: '', place: { root: 'server' } }, '?root=computer', pc);
  assert.equal(r.data.state, 'computer-off');
  assert.ok(!docker.calls().slice(before).some((x) => ['run', 'start', 'exec'].includes(x.args[0])), 'nothing started or run');
  assert.equal((await post('copy', { from: 'report.md', into: '', place: { root: 'computer' } })).data.state, 'no-computer', 'a bot without the computer');
  assert.equal((await post('copy', { from: 'report.md', into: '', place: { root: 'project', project: 'nope' } }, '', pc)).data.state, 'no-project');

  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"');
  docker.answer('exec.txt', 'ok site\n');
  r = await post('move', { from: 'site', into: 'www', place: { root: 'computer' } }, '', pc);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { ok: true, path: 'www/site', root: 'computer' });
  assert.ok(lastExec().includes('-i') && lastExec().includes('box'), 'unpacked by box from its stdin');
  assert.match(lastExec().at(-1), /tar -xf - -C "\$p" --no-same-owner/);
  assert.ok(!fs.existsSync(path.join(ws(pc), 'site')), 'moved: gone from botdot once it is whole there');

  const packed = tar.pack([{ name: 'out', type: 'folder' }, { name: 'out/a.txt', type: 'file', data: Buffer.from('from box') }]);
  docker.answer('exec.txt', `ok\n${packed.toString('base64')}`);
  r = await post('copy', { from: 'proj/out', into: '', place: { root: 'server' } }, '?root=computer', pc);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data, { ok: true, path: 'out', root: 'server' });
  assert.equal(fs.readFileSync(path.join(ws(pc), 'out/a.txt'), 'utf8'), 'from box');
  assert.match(lastExec().at(-1), /tar --format=ustar --hard-dereference -cf "\$p"/);
  docker.answer('exec.txt', 'too-large\n');
  assert.equal((await post('copy', { from: 'big', into: '', place: { root: 'server' } }, '?root=computer', pc)).data.state, 'too-large');

  // A move to another place never loses a link: botdot leaves links out of what it carries, so it refuses instead.
  put('linked/f.md', 'f', pc);
  fs.symlinkSync('f.md', path.join(ws(pc), 'linked', 'l'));
  r = await post('move', { from: 'linked', into: '', place: { root: 'computer' } }, '', pc);
  assert.equal(r.data.state, 'has-links');
  assert.ok(fs.existsSync(path.join(ws(pc), 'linked', 'l')), 'nothing moved');
  docker.answer('exec.txt', 'has-links\n');
  assert.equal((await post('move', { from: 'proj/with-links', into: '', place: { root: 'server' } }, '?root=computer', pc)).data.state, 'has-links');
  assert.match(lastExec().at(-1), /! -type f ! -type d -print -quit/, 'the computer looks for links first on a move');

  docker.answer('exec.txt', 'ok notes (2)\n');
  r = await post('copy', { from: 'notes', into: 'x' }, '?root=computer', pc);
  assert.deepEqual(r.data, { ok: true, path: 'x/notes (2)', root: 'computer' });
  assert.match(lastExec().at(-1), /cp -R -P -- "\$s" "\$t\/\$f"/);
  assert.deepEqual(audit().filter((l) => l.bot === pc.id).slice(-3).map((l) => [l.action, l.root, l.path, l.to, l.toRoot]), [
    ['workspace-file.moved', 'server', 'site', 'www/site', 'computer'],
    ['workspace-file.copied', 'computer', 'proj/out', 'out', 'server'],
    ['workspace-file.copied', 'computer', 'notes', 'x/notes (2)', undefined],
  ]);
  docker.answer('exec.txt', null);
  docker.answer('inspect.json', null);
});

test('the Chief is refused copy, move, keep and thumb; its own workspace copies only on botdot', async () => {
  for (const [what, body] of [['copy', { from: 'report.md', into: '' }], ['move', { from: 'report.md', into: 'notes' }], ['keep', { path: 'report.md' }]]) {
    assert.equal((await srv.asChief(u(what), { method: 'POST', body })).status, 403, what);
  }
  assert.equal((await srv.asChief(u('thumb', '?path=acme.png'))).status, 403);
  assert.equal((await srv.api('/chief/workspace/copy', { method: 'POST', body: { from: 'x', into: '', place: { root: 'computer' } } })).status, 400);
});

// The computer's new scripts, run here with scratch folders as the places.
test('the computer scripts copy, move, pack and unpack inside their folders, never over anything', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-carry-'));
  const a = path.join(dir, 'a'); const b = path.join(dir, 'b');
  fs.mkdirSync(path.join(a, 'proj', 'sub'), { recursive: true });
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'proj', 'sub', 'f'), 'hi');
  const sh = (script, input) => execFileSync('sh', ['-c', script], { input }).toString().trim();
  assert.equal(sh(W.carryScript(a, 'proj', b, '')), 'ok proj');
  assert.equal(sh(W.carryScript(a, 'proj', b, '')), 'ok proj (2)');
  assert.equal(sh(W.carryScript(a, 'proj', a, 'proj/sub')), 'into-itself');
  assert.equal(sh(W.carryScript(b, 'proj (2)', b, '', { move: true })), 'ok proj (2)', 'in its folder already');
  assert.equal(sh(W.carryScript(b, 'proj (2)', a, 'proj', { move: true })), 'ok proj (2)');
  assert.ok(!fs.existsSync(path.join(b, 'proj (2)')));
  fs.symlinkSync(dir, path.join(a, 'out'));
  assert.equal(sh(W.carryScript(a, 'proj', a, 'out')), 'link');
  assert.equal(sh(W.packScript(a, 'out')), 'link');
  const got = tar.unpack(W.computerPacked(sh(W.packScript(a, 'proj'))));
  assert.deepEqual(got.filter((e) => e.type === 'file').map((e) => [e.name, String(e.data)]), [['proj/proj (2)/sub/f', 'hi'], ['proj/sub/f', 'hi']]);
  assert.equal(sh(W.packScript(a, 'proj', 10)), 'too-large');
  fs.symlinkSync('f', path.join(a, 'proj', 'sub', 'l'));
  assert.equal(sh(W.packScript(a, 'proj', undefined, { move: true })), 'has-links', 'a move would lose the link');
  assert.notEqual(sh(W.packScript(a, 'proj')).split('\n')[0], 'has-links', 'a copy leaves it out');
  const packed = tar.pack([{ name: 'site', type: 'folder' }, { name: 'site/i.html', type: 'file', data: Buffer.from('<p>') }]);
  assert.equal(sh(W.unpackScript(b, '', 'site'), packed), 'ok site');
  assert.equal(sh(W.unpackScript(b, '', 'site'), packed), 'ok site (2)');
  assert.equal(fs.readFileSync(path.join(b, 'site (2)', 'i.html'), 'utf8'), '<p>');
  assert.deepEqual(fs.readdirSync(b).sort(), ['proj', 'site', 'site (2)'], 'nothing left behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a tar from the computer holds only plain files and folders inside it', () => {
  const evil = tar.pack([{ name: 'x/../../etc', type: 'file', data: Buffer.from('x') }]);
  assert.throws(() => tar.unpack(evil), /outside its folder/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-tar-'));
  fs.mkdirSync(path.join(dir, 'top'));
  fs.writeFileSync(path.join(dir, 'top', 'f'), 'f');
  fs.symlinkSync('/etc/passwd', path.join(dir, 'top', 'l'));
  const real = execFileSync('tar', ['--format=ustar', '-cf', '-', '-C', dir, 'top']);
  assert.deepEqual(tar.unpack(real).map((e) => e.name).sort(), ['top', 'top/f'], 'a link is left out');
  fs.rmSync(dir, { recursive: true, force: true });
});
