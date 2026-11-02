// A project's folder follows its name (#865, ADR 135): renamed on the account's computer when the project is, once no
// bot of the project runs and while the computer runs (never started for it), into a name free there and in the list.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, makeBot, writeData, heldRun, fakeDocker } = require('./helpers');

let srv; let docker; let coder; let pid;
const RUNNING = '"running"|"bot-dot/desktop:latest"|"sha256:a"';
before(async () => {
  docker = fakeDocker();
  srv = await startServer({ env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  coder = await makeBot(srv, { name: 'Rename Coder', emoji: '💻', computer: 'linux' });
  docker.answer('inspect.json', null);
  const r = await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Fernhill' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  pid = r.data.id;
  const c = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), { ...c, teams: [{ id: 't1', name: 'Site', bots: [coder.id], lead: coder.id }] });
});
after(async () => { srv.unhold(); await srv.stop(); docker.remove(); });

const moves = () => docker.calls().filter((x) => x.args[0] === 'exec' && x.args.join(' ').includes('mv -T'));
const rename = (name) => srv.api(`/company?project=${pid}`, { method: 'PATCH', body: { name } });

test('with the computer off, the folder keeps its name and nothing is started', async () => {
  docker.answer('inspect.json', null);
  const r = await rename('Fernhill Garden');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.name, 'Fernhill Garden');
  assert.deepEqual(r.data.folder, { name: 'Fernhill', path: '/workspace/projects/Fernhill' });
  assert.equal(moves().length, 0);
  assert.ok(!docker.calls().some((x) => x.args[0] === 'start' || x.args[0] === 'run'), 'the computer is not started for it');
});

test('while a bot of the project runs, the folder keeps its name; once it is idle, it follows', async () => {
  docker.answer('inspect.json', RUNNING);
  const { rec } = await heldRun(srv, coder, 'Work on the site');
  let r = await rename('Fernhill Garden');
  assert.equal(r.data.folder.name, 'Fernhill', 'a running bot keeps the path its prompt gave it');
  assert.equal(moves().length, 0);
  srv.release(rec);
  for (let i = 0; i < 50 && (await srv.api(`/bots/${coder.id}`)).data?.running; i++) await new Promise((ok) => setTimeout(ok, 50));
  docker.answer('exec.txt', 'moved Fernhill Garden\n');
  r = await rename('Fernhill Garden');
  assert.deepEqual(r.data.folder, { name: 'Fernhill Garden', path: '/workspace/projects/Fernhill Garden' });
  const script = moves().at(-1).args.join(' ');
  assert.match(script, /mv -T -- '\/workspace\/projects\/Fernhill' '\/workspace\/projects\/Fernhill Garden'/);
  assert.ok(moves().at(-1).args.includes('botdot.account.computer'), "on the account's computer");
  // Bots' prompts name the new folder.
  const { rec: next } = await heldRun(srv, coder, 'Where are the files?');
  assert.match(next.system, /Project folder, shared by its bots: "\/workspace\/projects\/Fernhill Garden" on your computer\./);
  srv.release(next);
  docker.answer('exec.txt', null);
});

test('a name taken on the computer gets " (2)"; a folder never made is renamed in the list alone; the same name moves nothing', async () => {
  docker.answer('inspect.json', RUNNING);
  for (let i = 0; i < 50 && (await srv.api(`/bots/${coder.id}`)).data?.running; i++) await new Promise((ok) => setTimeout(ok, 50));
  docker.answer('exec.txt', 'moved Oak (2)\n');
  let r = await rename('Oak');
  assert.equal(r.data.folder.name, 'Oak (2)');
  assert.match(moves().at(-1).args.join(' '), /'\/workspace\/projects\/Oak'.*'\/workspace\/projects\/Oak \(2\)'/s, 'tries the name, then " (2)"');
  const n = moves().length;
  r = await rename('Oak');
  assert.equal(r.data.folder.name, 'Oak (2)', 'it carries the name already');
  assert.equal(moves().length, n);
  docker.answer('exec.txt', 'none\n');
  r = await rename('Birch');
  assert.equal(r.data.folder.name, 'Birch');
  docker.answer('exec.txt', null);
});
