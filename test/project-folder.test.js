// A project's folder (#702, ADR 122): every project of the Projects place has a folder on the account's computer,
// /workspace/projects/<name>, shared by the bots of its teams. A bot on the computer works there with its own tools; a
// bot without it reaches it over botdot with the project file tools. The owner opens it in Files from the project's
// settings, and deleting the project keeps the folder or deletes it with what it holds.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { startServer, makeBot, writeData, heldRun, self, fakeDocker } = require('./helpers');
const tar = require('../lib/tar-lite');

let srv; let docker; let coder; let writer; let pid;
const RUNNING = '"running"|"bot-dot/desktop:latest"|"sha256:a"';
before(async () => {
  docker = fakeDocker();
  srv = await startServer({ env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  coder = await makeBot(srv, { name: 'Folder Coder', emoji: '💻', computer: 'linux' });
  writer = await makeBot(srv, { name: 'Folder Writer', emoji: '✍️' });
  docker.answer('inspect.json', null); // the computer is off: the folder waits for its first use
  const r = await srv.api('/company', { method: 'POST', body: { start: 'Fernhill/Shop' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  pid = r.data.id;
  const c = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), { ...c, name: 'Fernhill', phase: 'running', startedAt: new Date().toISOString(), teams: [{ id: 't1', name: 'Site', bots: [coder.id, writer.id], lead: coder.id }] });
});
after(async () => { srv.unhold(); await srv.stop(); docker.remove(); });

const execs = () => docker.calls().filter((x) => x.args[0] === 'exec');

test('a project has a folder named as it was made, listed with the shared projects and holding every bot of its teams', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-folder'));
  const c = (await srv.api('/company')).data.company;
  assert.deepEqual(c.folder, { name: 'Fernhill Shop', path: '/workspace/projects/Fernhill Shop' }, 'a / is no part of a folder name');
  const listed = (await srv.api('/projects')).data.projects.find((p) => p.project === pid);
  assert.deepEqual([listed.name, listed.bots], ['Fernhill Shop', [coder.id, writer.id]], 'its bots are its teams’, whichever computer');
  // Its bots follow its teams, and are changed there.
  let r = await srv.api(`/projects/${encodeURIComponent('Fernhill Shop')}`, { method: 'PUT', body: { bots: [coder.id] } });
  assert.deepEqual([r.status, r.data.state], [409, 'linked']);
  r = await srv.api(`/projects/${encodeURIComponent('Fernhill Shop')}`, { method: 'DELETE' });
  assert.deepEqual([r.status, r.data.state], [409, 'linked']);
  // A new project of the same name gets a folder of its own.
  r = await srv.api('/company', { method: 'POST', body: { start: 'Fernhill Shop' } });
  assert.equal(r.data.folder.name, 'Fernhill Shop (2)');
  await srv.api(`/company?project=${r.data.id}`, { method: 'DELETE' });
});

test('a bot on the computer is told the folder on its computer; a bot without it gets the project file tools', async () => {
  let { rec } = await heldRun(srv, coder, 'Where are the files?');
  assert.match(rec.system, /Project folder, shared by its bots: "\/workspace\/projects\/Fernhill Shop" on your computer\./);
  assert.equal(rec.self.env.SELF_FOLDER, '0');
  assert.doesNotMatch(rec.system, /Shared projects:/, 'said once, in the team note');
  srv.release(rec);
  ({ rec } = await heldRun(srv, writer, 'Where are the files?'));
  assert.match(rec.system, /on the account's computer, reached with the project file tools \(list_project_files/);
  assert.equal(rec.self.env.SELF_FOLDER, '1');
  srv.release(rec);
});

test("a bot without the computer lists, reads, writes, copies and deletes in the folder, on the account's computer", async () => {
  docker.answer('inspect.json', RUNNING);
  const { rec, token } = await heldRun(srv, writer, 'Write the plan');
  const lastScript = () => execs().at(-1).args.join(' ');
  const onSeat = () => assert.ok(execs().at(-1).args.includes('botdot.account.computer'), 'on the account’s computer');

  docker.answer('exec.txt', 'ok 2\nd/1/1760000000.0/docs\0f/5/1760000000.0/plan.md\0');
  let r = (await self(srv, token, 'project-files', { action: 'list' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.text, 'docs/ (1 items)\nplan.md (5 bytes)');
  assert.match(lastScript(), /mkdir -p -- '\/workspace\/projects\/Fernhill Shop'/, 'the folder is made first');
  onSeat();

  docker.answer('exec.txt', `ok 5 1760000000\n${Buffer.from('hello').toString('base64')}`);
  r = (await self(srv, token, 'project-files', { action: 'read', path: 'plan.md' })).data;
  assert.equal(r.text, 'hello');
  assert.match(lastScript(), /'\/workspace\/projects\/Fernhill Shop\/plan\.md'/);

  docker.answer('exec.txt', 'ok\n');
  r = (await self(srv, token, 'project-files', { action: 'write', path: 'docs/plan.md', content: '# Plan' })).data;
  assert.equal(r.text, 'Wrote docs/plan.md.');
  assert.match(lastScript(), /\.botdot-write/);
  r = (await self(srv, token, 'project-files', { action: 'write', path: '../escape.md', content: 'x' })).data;
  assert.equal(r.ok, false, 'never outside the folder');

  // From its workspace on botdot into the folder, and back.
  const ws = path.join(srv.data, 'workspaces', writer.id);
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'logo.png'), Buffer.from([137, 80, 78, 71]));
  docker.answer('exec.txt', 'ok logo.png\n');
  r = (await self(srv, token, 'project-files', { action: 'copy-in', from: 'logo.png', into: 'docs' })).data;
  assert.equal(r.text, "Copied to docs/logo.png in the project's folder.", JSON.stringify(r));
  docker.answer('exec.txt', `ok\n${tar.pack([{ name: 'report.pdf', type: 'file', data: Buffer.from('%PDF'), mtimeMs: Date.now() }]).toString('base64')}`);
  r = (await self(srv, token, 'project-files', { action: 'copy-out', path: 'report.pdf' })).data;
  assert.equal(r.text, 'Copied to report.pdf in your workspace.', JSON.stringify(r));
  assert.equal(fs.readFileSync(path.join(ws, 'report.pdf'), 'utf8'), '%PDF');

  docker.answer('exec.txt', 'ok\n');
  r = (await self(srv, token, 'project-files', { action: 'remove', path: 'docs/plan.md' })).data;
  assert.equal(r.text, 'Deleted docs/plan.md.');
  r = (await self(srv, token, 'project-files', { action: 'remove', path: '' })).data;
  assert.equal(r.ok, false, 'the folder itself stays');
  srv.release(rec);
  docker.answer('exec.txt', null);
});

test("the owner's Files opens the folder alone, starting nothing new for it while the computer runs", async () => {
  docker.answer('inspect.json', RUNNING);
  docker.answer('exec.txt', 'ok 1\nf/3/1760000000.0/index.html\0');
  const at = `/projects/${encodeURIComponent('Fernhill Shop')}/workspace`;
  let r = await srv.api(`${at}?root=project&project=${encodeURIComponent('Fernhill Shop')}&path=`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.entries.map((e) => e.name), ['index.html']);
  docker.answer('exec.txt', 'ok css\n');
  r = await srv.api(`${at}/folder?root=project`, { method: 'POST', body: { path: '', name: 'css' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await srv.api(`${at}?root=project&path=`, { method: 'DELETE' })).status, 403, 'the folder itself stays');
  assert.equal((await srv.asChief(`${at}?root=project&path=`)).status, 403, "the owner's alone");
  assert.equal((await srv.api('/projects/nope/workspace?path=')).status, 404);
  docker.answer('exec.txt', null);
});

test("deleting a project keeps its folder for its bots on the computer, or deletes it with what it holds", async () => {
  docker.answer('inspect.json', RUNNING);
  // Kept: a shared project of its own, with the bots of its teams on the computer.
  let r = await srv.api(`/company?project=${pid}`, { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const kept = (await srv.api('/projects')).data.projects.find((p) => p.name === 'Fernhill Shop');
  assert.deepEqual([kept.bots, kept.project], [[coder.id], undefined]);

  // Deleted: with what it holds, on the computer.
  r = await srv.api('/company', { method: 'POST', body: { start: 'Oakwood' } });
  const id = r.data.id;
  assert.equal(r.data.folder.name, 'Oakwood');
  docker.answer('exec.txt', 'ok\n');
  r = await srv.api(`/company?project=${id}&folder=delete`, { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(execs().at(-1).args.join(' '), /rm -rf/);
  assert.ok(!(await srv.api('/projects')).data.projects.some((p) => p.name === 'Oakwood'));
  docker.answer('exec.txt', null);
});
