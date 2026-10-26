// Shared projects (#578, ADR 097): the owner makes a project of bots on the account's computer, its folder there
// is /workspace/projects/<name>, each member's Workspace browses and manages it, a member's prompt names it, and a
// deleted bot leaves it. The computer is never started for it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, makeBot, fakeDocker, heldRun } = require('./helpers');
const P = require('../lib/projects');

let srv; let docker; let coder; let scout; let plain;
before(async () => {
  docker = fakeDocker();
  srv = await startServer({ env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  coder = await makeBot(srv, { name: 'Coder', emoji: '💻', computer: 'linux' });
  scout = await makeBot(srv, { name: 'Scout', emoji: '🔎', computer: 'linux' });
  plain = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
});
after(async () => { await srv.stop(); docker.remove(); });

const execs = () => docker.calls().filter((x) => x.args[0] === 'exec');
const ws = (b, more) => `/bots/${b.id}/workspace${more}`;

test('the owner makes a project of bots on the computer; the Chief may not; a name is one folder name', async () => {
  docker.answer('inspect.json', null); // the computer is off: the folder waits for a member's run
  const n = execs().length;
  let r = await srv.api('/projects', { method: 'POST', body: { name: 'site', bots: [coder.id, scout.id] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual({ ...r.data, createdAt: null }, { name: 'site', bots: [coder.id, scout.id], createdAt: null, folder: '/workspace/projects/site' });
  assert.equal(execs().length, n, 'nothing started or run');
  assert.equal((await srv.api('/projects', { method: 'POST', body: { name: 'site', bots: [coder.id] } })).status, 409);
  r = await srv.api('/projects', { method: 'POST', body: { name: 'notes', bots: [plain.id] } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Writer doesn't use the account's computer/);
  for (const name of ['', '.hidden', 'a/b', '..', 'x'.repeat(65)]) assert.equal((await srv.api('/projects', { method: 'POST', body: { name, bots: [coder.id] } })).status, 400, name);
  assert.equal((await srv.api('/projects', { method: 'POST', body: { name: 'empty', bots: [] } })).status, 400);
  assert.equal((await srv.asChief('/projects')).status, 403);
  r = await srv.api('/projects');
  assert.deepEqual(r.data.projects.map((p) => p.name), ['site']);
});

test("a member's Workspace has the project as a root, made first where it isn't there; another bot's is refused", async () => {
  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"');
  docker.answer('exec.txt', 'ok 1\nf/3/1760000000.0/index.html\0');
  let r = await srv.api(ws(scout, '?root=project&project=site&path='));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.root, 'project');
  assert.deepEqual(r.data.entries.map((e) => e.name), ['index.html']);
  const script = execs().at(-1).args.at(-1);
  assert.match(script, /mkdir -p -- '\/workspace\/projects\/site'/);
  assert.match(script, /realpath -e -- '\/workspace\/projects\/site'/);
  assert.equal((await srv.api(ws(plain, '?root=project&project=site&path='))).data.state, 'no-project');
  assert.equal((await srv.api(ws(coder, '?root=project&project=nope&path='))).data.state, 'no-project');

  docker.answer('exec.txt', 'ok css\n');
  r = await srv.api(ws(coder, '/folder?root=project&project=site'), { method: 'POST', body: { path: '', name: 'css' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await srv.api(ws(coder, '?root=project&project=site&path='), { method: 'DELETE' })).status, 403, 'the project folder itself stays');
  docker.answer('exec.txt', null);
});

test('its bots change, and the folder is made when the computer runs', async () => {
  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"');
  const r = await srv.api('/projects/site', { method: 'PUT', body: { bots: [coder.id] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.bots, [coder.id]);
  assert.match(execs().at(-1).args.at(-1), /mkdir -p -- '\/workspace\/projects\/site'/);
  assert.equal((await srv.api('/projects/gone', { method: 'PUT', body: { bots: [coder.id] } })).status, 404);
  assert.equal((await srv.api('/projects/site', { method: 'PUT', body: { bots: [plain.id] } })).status, 400);
});

test('a deleted bot leaves its projects; a project is deleted with its folder, only while the computer runs', async () => {
  await srv.api('/projects/site', { method: 'PUT', body: { bots: [coder.id, scout.id] } });
  docker.answer('inspect.json', null);
  let r = await srv.api('/projects/site', { method: 'DELETE' });
  assert.equal(r.status, 409);
  assert.equal(r.data.state, 'computer-off');
  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"');
  docker.answer('exec.txt', 'ok\n');
  r = await srv.api('/projects/site', { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(execs().at(-1).args.at(-1), /rm -rf -- "\$t"/);
  assert.match(execs().at(-1).args.at(-1), /realpath -e -- '\/workspace\/projects'/);
  assert.deepEqual((await srv.api('/projects')).data.projects, []);

  docker.answer('exec.txt', null);
  await srv.api('/projects', { method: 'POST', body: { name: 'docs', bots: [coder.id, scout.id] } });
  docker.answer('inspect.json', null);
  assert.equal((await srv.api(`/bots/${scout.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await srv.api('/projects/docs')).data.bots, [coder.id]);
});

test("a member's prompt note names its projects, their folders and the other members; a bot in none has none", () => {
  const dir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'botdot-projects-'));
  const file = path.join(dir, 'projects.json');
  require('fs').writeFileSync(file, JSON.stringify([{ name: 'site', bots: ['c1', 's1'] }, { name: 'docs', bots: ['c1'] }]));
  const before = process.env.BOT_DOT_DATA;
  process.env.BOT_DOT_DATA = dir;
  delete require.cache[require.resolve('../lib/projects')];
  try {
    const fresh = require('../lib/projects');
    const note = fresh.promptNote('c1', (id) => ({ c1: 'Coder', s1: 'Scout' })[id]);
    assert.match(note, /^Shared projects: /);
    assert.match(note, /- site: \/workspace\/projects\/site, with Scout/);
    assert.match(note, /- docs: \/workspace\/projects\/docs$/m);
    assert.equal(fresh.promptNote('x1'), '');
  } finally {
    if (before === undefined) delete process.env.BOT_DOT_DATA; else process.env.BOT_DOT_DATA = before;
    delete require.cache[require.resolve('../lib/projects')];
    require('fs').rmSync(dir, { recursive: true, force: true });
  }
  assert.match(P.makeScript(["it's"]), /mkdir -p -- '\/workspace\/projects\/it'\\''s'/);
});

test("a member's run is told of its projects; a bot in none is not", async () => {
  docker.answer('inspect.json', null);
  const a = await makeBot(srv, { name: 'Designer', emoji: '🎨', computer: 'linux' });
  const b = await makeBot(srv, { name: 'Tester', emoji: '🧪', computer: 'linux' });
  assert.equal((await srv.api('/projects', { method: 'POST', body: { name: 'app', bots: [a.id, b.id] } })).status, 201);
  const { rec, run } = await heldRun(srv, a);
  assert.match(rec.system, /Shared projects: folders on your computer that you and the teammates named work in together/);
  assert.ok(rec.system.includes('- app: /workspace/projects/app, with Tester'), rec.system.slice(-800));
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
  const other = await heldRun(srv, coder);
  assert.doesNotMatch(other.rec.system, /\/workspace\/projects\/app/);
  srv.release(other.rec);
  await srv.finished(other.run.id);
  srv.unhold();
});
