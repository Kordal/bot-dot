// A bot's workspace in its settings (#296): the owner lists, opens, downloads, uploads, makes folders, renames,
// moves and deletes in the bot's folder on this server, and the same on the account's computer (#576) while the
// computer runs, which is never started for it; a whole folder is uploaded file by file. Paths stay inside their root, links are never
// followed, what botdot keeps there is read-only, every write is in the audit log, and the Chief is refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, makeBot, fakeDocker } = require('./helpers');
const W = require('../lib/workspace-files');

let srv; let bot; let pc; let docker;
before(async () => {
  docker = fakeDocker();
  srv = await startServer({ env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  bot = await makeBot(srv, { name: 'Researcher', emoji: '🔎' });
  pc = await makeBot(srv, { name: 'Desk Worker', emoji: '🖥', computer: 'linux' });
});
after(async () => { await srv.stop(); docker.remove(); });

const ws = (b = bot) => path.join(srv.data, 'workspaces', b.id);
const q = (p, more = '') => `?path=${encodeURIComponent(p)}${more}`;
const at = (what, p, more = '', b = bot) => `/bots/${b.id}/workspace${what ? `/${what}` : ''}${q(p, more)}`;
const audit = () => (fs.existsSync(path.join(srv.data, 'audit.log')) ? fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []).filter((l) => l.action.startsWith('workspace-file.'));
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(ws(), rel)), { recursive: true }); fs.writeFileSync(path.join(ws(), rel), text); };

test('the folder lists folders first, then files with their size and time; what botdot keeps is marked', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('workspace-files'));
  put('notes/today.md', '# Today\n');
  put('report.csv', 'a,b\n1,2\n');
  put('Zeta.txt', 'z');
  put('.cache/x', 'x');
  put('CLAUDE.md', 'rules');
  fs.mkdirSync(path.join(ws(), 'uploads'), { recursive: true });
  const r = await srv.api(`/bots/${bot.id}/workspace`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.root, 'server');
  assert.equal(r.data.path, '');
  assert.equal(r.data.more, 0);
  const names = r.data.entries.map((e) => e.name);
  const firstFile = r.data.entries.findIndex((e) => e.type === 'file');
  assert.ok(r.data.entries.slice(0, firstFile).every((e) => e.type === 'folder'), names.join());
  assert.ok(names.includes('.cache'), 'hidden ones come too: the apps fold them');
  const csv = r.data.entries.find((e) => e.name === 'report.csv');
  assert.equal(csv.size, 8);
  assert.equal(csv.path, 'report.csv');
  assert.match(csv.at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(r.data.entries.find((e) => e.name === 'CLAUDE.md').protected, true);
  assert.equal(r.data.entries.find((e) => e.name === 'uploads').protected, true);
  assert.equal(csv.protected, undefined);
  const sub = await srv.api(`/bots/${bot.id}/workspace${q('notes')}`);
  assert.deepEqual(sub.data.entries.map((e) => e.path), ['notes/today.md']);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace${q('report.csv')}`)).data.state, 'not-folder');
  assert.equal((await srv.api(`/bots/${bot.id}/workspace${q('nothing')}`)).status, 404);
});

test('at most 1,000 entries of a folder, and how many more there are', async () => {
  fs.mkdirSync(path.join(ws(), 'many'));
  for (let i = 0; i < 1003; i++) fs.writeFileSync(path.join(ws(), 'many', `f${i}.txt`), '');
  const r = await srv.api(`/bots/${bot.id}/workspace${q('many')}`);
  assert.equal(r.data.entries.length, 1000);
  assert.equal(r.data.more, 3);
  fs.rmSync(path.join(ws(), 'many'), { recursive: true });
});

test('a file opens in the viewer and downloads', async () => {
  const v = await srv.api(at('file', 'notes/today.md', '&view=1'));
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.kind, 'markdown');
  assert.equal(v.data.text, '# Today\n');
  const res = await fetch(`${srv.base}/api${at('file', 'report.csv')}`, { headers: { 'X-Bot-Dot': '1' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), 'a,b\n1,2\n');
  assert.equal((await srv.api(at('file', 'notes'))).data.state, 'not-file');
});

test('upload into a folder, a new folder, rename and move; each in the audit log', async () => {
  let r = await srv.api(`/bots/${bot.id}/workspace/upload${q('notes')}`, { method: 'POST', raw: Buffer.from('hello'), headers: { 'X-File-Name': encodeURIComponent('hi there.txt') } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data, { name: 'hi there.txt', path: 'notes/hi there.txt', size: 5 });
  r = await srv.api(`/bots/${bot.id}/workspace/upload${q('notes')}`, { method: 'POST', raw: Buffer.from('again'), headers: { 'X-File-Name': encodeURIComponent('hi there.txt') } });
  assert.equal(r.data.path, 'notes/hi there (2).txt', 'never over a file that is there');
  assert.equal(fs.readFileSync(path.join(ws(), 'notes/hi there.txt'), 'utf8'), 'hello');

  r = await srv.api(`/bots/${bot.id}/workspace/folder`, { method: 'POST', body: { path: 'notes', name: 'old' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.path, 'notes/old');
  assert.ok(fs.statSync(path.join(ws(), 'notes/old')).isDirectory());
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/folder`, { method: 'POST', body: { path: 'notes', name: 'old' } })).status, 409);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/folder`, { method: 'POST', body: { path: 'notes', name: 'a/b' } })).status, 400);

  r = await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'notes/hi there (2).txt', to: 'notes/second.txt' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'notes/second.txt', to: 'notes/old/second.txt' } });
  assert.equal(r.status, 200);
  assert.equal(fs.readFileSync(path.join(ws(), 'notes/old/second.txt'), 'utf8'), 'again');
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'notes', to: 'notes/old/notes' } })).status, 400, 'not into itself');
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'report.csv', to: 'notes/today.md' } })).status, 409, 'not over another');

  const log = audit();
  assert.deepEqual(log.map((l) => l.action), ['workspace-file.uploaded', 'workspace-file.uploaded', 'workspace-file.folder-made', 'workspace-file.moved', 'workspace-file.moved']);
  assert.deepEqual({ ...log[3], time: null }, { time: null, actor: 'owner', action: 'workspace-file.moved', bot: bot.id, root: 'server', path: 'notes/hi there (2).txt', to: 'notes/second.txt' });
});

test('a whole folder (#576): its top takes a free name, its files go into folders made as they come', async () => {
  put('site/old.txt', 'old');
  let r = await srv.api(`/bots/${bot.id}/workspace/folder`, { method: 'POST', body: { path: '', name: 'site', free: true } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.path, 'site (2)');
  for (const [dir, name, text] of [['site (2)', 'index.html', '<p>'], ['site (2)/css/deep', 'a.css', 'a{}'], ['site (2)/css', 'empty.txt', '']]) {
    r = await srv.api(`/bots/${bot.id}/workspace/upload${q(dir, '&folders=1')}`, { method: 'POST', raw: Buffer.from(text), headers: { 'X-File-Name': name } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.path, `${dir}/${name}`);
  }
  assert.equal(fs.readFileSync(path.join(ws(), 'site (2)/css/deep/a.css'), 'utf8'), 'a{}');
  assert.equal(fs.readFileSync(path.join(ws(), 'site (2)/css/empty.txt'), 'utf8'), '');
  assert.equal(fs.readFileSync(path.join(ws(), 'site/old.txt'), 'utf8'), 'old', 'the folder that was there is untouched');
  r = await srv.api(`/bots/${bot.id}/workspace/upload${q('nowhere/x')}`, { method: 'POST', raw: Buffer.from('x'), headers: { 'X-File-Name': 'a.txt' } });
  assert.equal(r.status, 404, 'without folders=1 a missing folder is not made');
  r = await srv.api(`/bots/${bot.id}/workspace/upload${q('.claude/x', '&folders=1')}`, { method: 'POST', raw: Buffer.from('x'), headers: { 'X-File-Name': 'a.txt' } });
  assert.equal(r.status, 403, 'nothing is made in what botdot keeps');
  assert.ok(!fs.existsSync(path.join(ws(), '.claude/x')));
  fs.rmSync(path.join(ws(), 'site'), { recursive: true }); fs.rmSync(path.join(ws(), 'site (2)'), { recursive: true });
});

test('an upload over 25 MB is refused and leaves nothing', async () => {
  const r = await srv.api(`/bots/${bot.id}/workspace/upload${q('')}`, { method: 'POST', raw: Buffer.alloc(25 * 1024 * 1024 + 1, 1), headers: { 'X-File-Name': 'big.bin' } }).catch((e) => ({ status: 0, e }));
  assert.ok([413, 0].includes(r.status), String(r.status));
  assert.ok(!fs.existsSync(path.join(ws(), 'big.bin')));
});

test('delete says first what it takes, then takes a file or a folder with what it holds', async () => {
  const c = await srv.api(at('count', 'notes'));
  assert.deepEqual(c.data, { type: 'folder', files: 3, folders: 1, capped: false });
  assert.deepEqual((await srv.api(at('count', 'report.csv'))).data, { type: 'file', files: 1, folders: 0, capped: false });
  let r = await srv.api(at('', 'notes'), { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!fs.existsSync(path.join(ws(), 'notes')));
  r = await srv.api(at('', 'Zeta.txt'), { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await srv.api(at('', 'Zeta.txt'), { method: 'DELETE' })).status, 404);
  assert.deepEqual(audit().filter((l) => l.action === 'workspace-file.deleted').map((l) => l.path), ['notes', 'Zeta.txt']);
});

test('what botdot keeps there is read-only: CLAUDE.md, .claude, .git, .jobs and .tiles; uploads/ itself stays', async () => {
  put('.claude/settings.json', '{}');
  put('.jobs/j1/state', 's');
  put('uploads/20261021070000-ab12-CV.pdf', '%PDF');
  for (const p of ['CLAUDE.md', '.claude', '.claude/settings.json', '.jobs/j1', 'uploads', '']) {
    assert.equal((await srv.api(at('', p), { method: 'DELETE' })).status, 403, p);
  }
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'CLAUDE.md', to: 'rules.md' } })).status, 403);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'uploads', to: 'given' } })).status, 403);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'report.csv', to: '.claude/report.csv' } })).status, 403, 'nothing goes in');
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'report.csv', to: 'CLAUDE.md' } })).status, 403);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/upload${q('.git')}`, { method: 'POST', raw: Buffer.from('x'), headers: { 'X-File-Name': 'x' } })).status, 403);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/folder`, { method: 'POST', body: { path: '.jobs', name: 'mine' } })).status, 403);
  // Read-only, not hidden: it opens, and its folder says so.
  assert.equal((await srv.api(at('file', 'CLAUDE.md', '&view=1'))).data.text, 'rules');
  assert.equal((await srv.api(`/bots/${bot.id}/workspace${q('.claude')}`)).data.readOnly, true);
  // A file the owner gave it keeps its name and place, as the Files section goes by them, and may go from here too,
  // with its readable copy.
  put('uploads/20261021070000-ab12-CV.pdf.txt', 'readable');
  const given = (await srv.api(`/bots/${bot.id}/workspace${q('uploads')}`)).data.entries.find((e) => e.name === '20261021070000-ab12-CV.pdf');
  assert.equal(given.keepsName, true);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: given.path, to: 'uploads/CV.pdf' } })).status, 403);
  assert.equal((await srv.api(at('', given.path), { method: 'DELETE' })).status, 200);
  assert.ok(!fs.existsSync(path.join(ws(), 'uploads/20261021070000-ab12-CV.pdf.txt')), 'its readable copy goes with it');
});

test('paths stay in the folder: "..", absolute paths and links out of it are refused, and a link is never followed', async () => {
  for (const p of ['../x', 'a/../../x', '/etc/passwd', '~/x', '..', './x']) {
    for (const u of [`/bots/${bot.id}/workspace${q(p)}`, at('file', p, '&view=1'), at('count', p)]) {
      const r = await srv.api(u);
      assert.equal(r.status, 403, `${u}: ${JSON.stringify(r.data)}`);
    }
    assert.equal((await srv.api(at('', p), { method: 'DELETE' })).status, 403, p);
  }
  fs.writeFileSync(path.join(srv.dir, 'secret.txt'), 'not yours');
  fs.mkdirSync(path.join(srv.dir, 'elsewhere'), { recursive: true });
  fs.writeFileSync(path.join(srv.dir, 'elsewhere', 'inside.txt'), 'not yours either');
  fs.symlinkSync(path.join(srv.dir, 'secret.txt'), path.join(ws(), 'escape.txt'));
  fs.symlinkSync(path.join(srv.dir, 'elsewhere'), path.join(ws(), 'away'));
  fs.symlinkSync('report.csv', path.join(ws(), 'inside-link.csv'));
  const listed = (await srv.api(`/bots/${bot.id}/workspace`)).data.entries;
  assert.equal(listed.find((e) => e.name === 'escape.txt').type, 'link');
  assert.equal(listed.find((e) => e.name === 'away').type, 'link');
  for (const u of [at('file', 'escape.txt', '&view=1'), at('file', 'escape.txt'), `/bots/${bot.id}/workspace${q('away')}`, at('file', 'away/inside.txt'), at('file', 'inside-link.csv', '&view=1')]) {
    const r = await srv.api(u);
    assert.equal(r.status, 403, u);
    assert.doesNotMatch(JSON.stringify(r.data), /not yours/);
  }
  assert.equal((await srv.api(at('', 'away'), { method: 'DELETE' })).status, 403);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/move`, { method: 'POST', body: { from: 'report.csv', to: 'away/report.csv' } })).status, 403);
  assert.equal((await srv.api(`/bots/${bot.id}/workspace/upload${q('away')}`, { method: 'POST', raw: Buffer.from('x'), headers: { 'X-File-Name': 'x' } })).status, 403);
  assert.ok(fs.existsSync(path.join(srv.dir, 'elsewhere', 'inside.txt')));
  assert.ok(!fs.existsSync(path.join(srv.dir, 'elsewhere', 'x')));
});

test('only the owner: the Chief is refused everything', async () => {
  const u = `/bots/${bot.id}/workspace`;
  for (const [p, opts] of [[u, {}], [at('file', 'report.csv', '&view=1'), {}], [at('count', 'report.csv'), {}], [at('', 'report.csv'), { method: 'DELETE' }],
    [`${u}/folder`, { method: 'POST', body: { name: 'x' } }], [`${u}/move`, { method: 'POST', body: { from: 'report.csv', to: 'r.csv' } }], [`${u}/upload`, { method: 'POST', raw: Buffer.from('x') }], [`${u}?root=computer`, {}]]) {
    const r = await srv.asChief(p, opts);
    assert.equal(r.status, 403, p);
  }
  assert.ok(fs.existsSync(path.join(ws(), 'report.csv')));
});

test("on the computer: off, it says so and nothing starts; on, the bot's folder there is listed, opened and deleted in", async () => {
  const c = (what, p, more = '') => at(what, p, `&root=computer${more}`, pc);
  assert.equal((await srv.api(at('', '', '&root=computer'))).data.state, 'no-computer', 'a bot without the computer');
  docker.answer('inspect.json', null);
  const before = docker.calls().length;
  const off = await srv.api(c('', ''));
  assert.equal(off.status, 409);
  assert.equal(off.data.state, 'computer-off');
  assert.equal((await srv.api(c('', 'a.txt'), { method: 'DELETE' })).data.state, 'computer-off');
  assert.ok(!docker.calls().slice(before).some((x) => ['run', 'start', 'exec'].includes(x.args[0])), 'nothing started or run');

  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"');
  docker.answer('exec.txt', `ok 4\nf/12/1760000000.5/b notes.md\0d/4096/1760000001.0/src\0l/9/1760000002.0/link\0f/3/1760000003.0/a.txt\0`);
  const on = await srv.api(c('', 'proj'));
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.root, 'computer');
  assert.deepEqual(on.data.entries.map((e) => [e.name, e.type, e.path]), [['src', 'folder', 'proj/src'], ['a.txt', 'file', 'proj/a.txt'], ['b notes.md', 'file', 'proj/b notes.md'], ['link', 'link', 'proj/link']]);
  assert.equal(on.data.entries[2].size, 12);
  assert.equal(on.data.entries[2].at, new Date(1760000000500).toISOString());
  const exec = docker.calls().filter((x) => x.args[0] === 'exec').at(-1).args;
  assert.ok(exec.includes('box'), 'read as box');
  assert.match(exec.at(-1), new RegExp(`realpath -e -- '/workspace/${pc.id}'`));

  docker.answer('exec.txt', `ok 11 1760000000\n${Buffer.from('# From box\n').toString('base64')}`);
  const v = await srv.api(c('file', 'proj/b notes.md', '&view=1'));
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.text, '# From box\n');
  assert.match(docker.calls().filter((x) => x.args[0] === 'exec').at(-1).args.at(-1), new RegExp(`case "\\$f" in '/workspace/${pc.id}'/\\*\\)`), 'only inside its own folder');

  docker.answer('exec.txt', 'ok folder 3 1 all\n');
  assert.deepEqual((await srv.api(c('count', 'proj/src'))).data, { type: 'folder', files: 3, folders: 1, capped: false });
  docker.answer('exec.txt', 'ok\n');
  const del = await srv.api(c('', 'proj/src'), { method: 'DELETE' });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.match(docker.calls().filter((x) => x.args[0] === 'exec').at(-1).args.at(-1), /rm -rf -- "\$t"/);
  assert.deepEqual(audit().at(-1), { ...audit().at(-1), action: 'workspace-file.deleted', bot: pc.id, root: 'computer', path: 'proj/src' });

  docker.answer('exec.txt', 'link\n');
  assert.equal((await srv.api(c('', 'proj/link'))).status, 403);
  docker.answer('exec.txt', 'gone\n');
  assert.equal((await srv.api(c('', 'proj/old'))).status, 404);
  assert.equal((await srv.api(c('', ''), { method: 'DELETE' })).status, 403, 'its folder itself stays');
  assert.equal((await srv.api(c('', '../other'))).status, 403);

  // #576: a folder, an upload and a move there, each by botdot's script as box, each in the audit log.
  const lastScript = () => docker.calls().filter((x) => x.args[0] === 'exec').at(-1).args;
  docker.answer('exec.txt', 'ok site (2)\n');
  let w = await srv.api(`/bots/${pc.id}/workspace/folder?root=computer`, { method: 'POST', body: { path: 'proj', name: 'site', free: true } });
  assert.equal(w.status, 201, JSON.stringify(w.data));
  assert.deepEqual(w.data, { ok: true, path: 'proj/site (2)' });
  assert.ok(lastScript().includes('box'), 'made as box');
  assert.match(lastScript().at(-1), /mkdir -- "\$t\/\$f"/);
  docker.answer('exec.txt', 'exists\n');
  assert.equal((await srv.api(`/bots/${pc.id}/workspace/folder?root=computer`, { method: 'POST', body: { path: 'proj', name: 'site' } })).status, 409);
  assert.equal((await srv.api(`/bots/${pc.id}/workspace/folder?root=computer`, { method: 'POST', body: { path: 'proj', name: 'a/b' } })).status, 400);

  docker.answer('exec.txt', 'ok index.html\n');
  w = await srv.api(`/bots/${pc.id}/workspace/upload?root=computer&path=${encodeURIComponent('proj/site (2)/css')}&folders=1`, { method: 'POST', raw: Buffer.from('<p>'), headers: { 'X-File-Name': 'index.html' } });
  assert.equal(w.status, 201, JSON.stringify(w.data));
  assert.deepEqual(w.data, { name: 'index.html', path: 'proj/site (2)/css/index.html', size: 3 });
  assert.ok(lastScript().includes('-i'), 'the bytes on its stdin');
  assert.match(lastScript().at(-1), /mkdir -- "\$t" \|\| \{ echo failed/, 'the missing folders are made');

  docker.answer('exec.txt', 'ok\n');
  w = await srv.api(`/bots/${pc.id}/workspace/move?root=computer`, { method: 'POST', body: { from: 'proj/a.txt', to: 'proj/src/a.txt' } });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.match(lastScript().at(-1), /mv -n -T -- "\$s" "\$t\/\$f"/);
  assert.equal((await srv.api(`/bots/${pc.id}/workspace/move?root=computer`, { method: 'POST', body: { from: 'proj', to: 'proj/x/proj' } })).status, 400, 'not into itself');
  assert.equal((await srv.api(`/bots/${pc.id}/workspace/move?root=computer`, { method: 'POST', body: { from: '', to: 'x' } })).status, 400, 'its folder itself stays');
  assert.deepEqual(audit().slice(-3).map((l) => [l.action, l.root, l.path, l.to]), [
    ['workspace-file.folder-made', 'computer', 'proj/site (2)', undefined],
    ['workspace-file.uploaded', 'computer', 'proj/site (2)/css/index.html', undefined],
    ['workspace-file.moved', 'computer', 'proj/a.txt', 'proj/src/a.txt'],
  ]);
  docker.answer('inspect.json', null);
  const still = docker.calls().length;
  assert.equal((await srv.api(`/bots/${pc.id}/workspace/upload?root=computer&path=`, { method: 'POST', raw: Buffer.from('x'), headers: { 'X-File-Name': 'a' } })).data.state, 'computer-off');
  assert.equal((await srv.api(`/bots/${pc.id}/workspace/move?root=computer`, { method: 'POST', body: { from: 'a', to: 'b' } })).data.state, 'computer-off');
  assert.ok(!docker.calls().slice(still).some((x) => ['run', 'start', 'exec'].includes(x.args[0])), 'nothing started or run');
  docker.answer('exec.txt', null);
});

// The computer's scripts, run here with a scratch folder as the bot's folder.
test('the computer scripts list, count and delete inside the folder only, never through a link', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-ws-'));
  const root = path.join(dir, 'bot');
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'deep', 'x.js'), 'x');
  fs.writeFileSync(path.join(root, "it's.md"), 'hello');
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'secret');
  fs.mkdirSync(path.join(dir, 'other'));
  fs.writeFileSync(path.join(dir, 'other', 'keep.txt'), 'keep');
  fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(root, 'link.txt'));
  fs.symlinkSync(path.join(dir, 'other'), path.join(root, 'away'));
  const run = (script) => execFileSync('sh', ['-c', script], { encoding: 'utf8' });
  try {
    const listed = W.computerList(run(W.listScript(root, '')), '');
    assert.deepEqual(listed.entries.map((e) => [e.name, e.type]), [['src', 'folder'], ['away', 'link'], ["it's.md", 'file'], ['link.txt', 'link']]);
    assert.equal(listed.entries.find((e) => e.name === "it's.md").size, 5);
    assert.throws(() => W.computerList(run(W.listScript(root, 'away')), 'away'), { status: 403 });
    assert.throws(() => W.computerList(run(W.listScript(root, 'away/keep.txt')), ''), { status: 403 });
    assert.throws(() => W.computerList(run(W.listScript(root, 'nothing')), ''), { status: 404 });
    assert.deepEqual(W.computerCount(run(W.countScript(root, 'src'))), { type: 'folder', files: 1, folders: 1, capped: false });
    assert.deepEqual(W.computerCount(run(W.countScript(root, 'src', 1))).capped, true);
    assert.throws(() => W.computerRemoved(run(W.removeScript(root, 'away/keep.txt'))), { status: 403 });
    W.computerRemoved(run(W.removeScript(root, 'away')));
    W.computerRemoved(run(W.removeScript(root, 'link.txt')));
    assert.ok(fs.existsSync(path.join(dir, 'other', 'keep.txt')), 'a link goes, not what it points to');
    assert.ok(fs.existsSync(path.join(dir, 'outside.txt')));
    W.computerRemoved(run(W.removeScript(root, 'src')));
    W.computerRemoved(run(W.removeScript(root, "it's.md")));
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the computer scripts (#576) make a folder, put a file and move, inside the folder only, never through a link or over a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-ws-'));
  const root = path.join(dir, 'bot');
  fs.mkdirSync(path.join(root, 'proj'), { recursive: true });
  fs.writeFileSync(path.join(root, 'proj', 'a.txt'), 'a');
  fs.mkdirSync(path.join(dir, 'other'));
  fs.symlinkSync(path.join(dir, 'other'), path.join(root, 'away'));
  const run = (script, input) => execFileSync('sh', ['-c', script], { encoding: 'utf8', input });
  try {
    assert.equal(W.computerMade(run(W.folderScript(root, 'proj', "it's new"))), "it's new");
    assert.throws(() => W.computerMade(run(W.folderScript(root, 'proj', "it's new"))), { status: 409 });
    assert.equal(W.computerMade(run(W.folderScript(root, 'proj', "it's new", { free: true }))), "it's new (2)");
    assert.throws(() => W.computerMade(run(W.folderScript(root, 'away', 'x'))), { status: 403 });
    assert.throws(() => W.computerMade(run(W.folderScript(root, 'nothing', 'x'))), { status: 404 });
    assert.throws(() => W.computerMade(run(W.folderScript(root, 'proj/a.txt', 'x'))), { status: 400 });

    assert.equal(W.computerMade(run(W.putScript(root, 'proj', 'a.txt'), 'second')), 'a (2).txt');
    assert.equal(fs.readFileSync(path.join(root, 'proj', 'a.txt'), 'utf8'), 'a', 'never over a file');
    assert.equal(W.computerMade(run(W.putScript(root, 'proj/site/css', '.env', { folders: true }), '')), '.env');
    assert.equal(fs.readFileSync(path.join(root, 'proj/site/css/.env'), 'utf8'), '');
    // A refusal ends before it reads stdin: given none, as a pipe written to then would break (EPIPE).
    assert.throws(() => W.computerMade(run(W.putScript(root, 'nope/x', 'a.txt'))), { status: 404 });
    assert.throws(() => W.computerMade(run(W.putScript(root, 'away/x', 'a.txt', { folders: true }))), { status: 403 });
    assert.deepEqual(fs.readdirSync(path.join(dir, 'other')), [], 'nothing through a link');
    assert.deepEqual(fs.readdirSync(path.join(root, 'proj')).filter((n) => n.startsWith('.botdot-upload')), []);

    W.computerMoved(run(W.moveScript(root, 'proj/a (2).txt', "proj/it's new/b.txt")));
    assert.equal(fs.readFileSync(path.join(root, "proj/it's new/b.txt"), 'utf8'), 'second');
    assert.throws(() => W.computerMoved(run(W.moveScript(root, 'proj/a.txt', "proj/it's new/b.txt"))), { status: 409 });
    assert.throws(() => W.computerMoved(run(W.moveScript(root, 'proj/a.txt', 'away/a.txt'))), { status: 403 });
    assert.throws(() => W.computerMoved(run(W.moveScript(root, 'proj/gone.txt', 'proj/b.txt'))), { status: 404 });
    W.computerMoved(run(W.moveScript(root, 'proj/site', 'site')));
    assert.ok(fs.statSync(path.join(root, 'site/css')).isDirectory());
    assert.deepEqual(fs.readdirSync(path.join(dir, 'other')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a project's folder is written over botdot (#702): in place of a file, the folders on the way made, never through a link or over a folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-ws-'));
  const root = path.join(dir, 'site');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plan.md'), 'old');
  fs.mkdirSync(path.join(dir, 'other'));
  fs.symlinkSync(path.join(dir, 'other'), path.join(root, 'away'));
  fs.symlinkSync(path.join(dir, 'other', 'x.txt'), path.join(root, 'x.txt'));
  const run = (script, input) => execFileSync('sh', ['-c', script], { encoding: 'utf8', input });
  try {
    W.computerRemoved(run(W.writeScript(root, 'plan.md'), "new, it's"));
    assert.equal(fs.readFileSync(path.join(root, 'plan.md'), 'utf8'), "new, it's");
    W.computerRemoved(run(W.writeScript(root, 'site/css/main.css'), 'a{}'));
    assert.equal(fs.readFileSync(path.join(root, 'site/css/main.css'), 'utf8'), 'a{}');
    assert.throws(() => W.computerRemoved(run(W.writeScript(root, 'away/x.txt'))), { status: 403 });
    assert.throws(() => W.computerRemoved(run(W.writeScript(root, 'x.txt'))), { status: 403 });
    assert.throws(() => W.computerRemoved(run(W.writeScript(root, 'docs'))), { status: 400 });
    assert.deepEqual(fs.readdirSync(path.join(dir, 'other')), [], 'nothing written through a link');
    assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith('.botdot')), [], 'no part left');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
