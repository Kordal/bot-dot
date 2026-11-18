// A hand-added decision (and the other company.json fields written the same way) survives a project rename, whether
// the folder follows at once (no bot of the project runs) or is deferred for the minute's sweep (a bot runs). #1508.
//
// The rename's folder-follow (lib/project-folder.js) and the minute's sweep (lib/bots.js followProjectFolders) write
// only data/projects.json; the project's decisions live in data/company.json, written only by a fresh read-modify-write
// (lib/company.js `change`/`keep`). `patch` never touches `decisions`, and the web side sends one field per PATCH. So a
// rename cannot drop a decision; this test pins that down so a future change that does cannot slip in silently.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { startServer, makeBot, writeData, heldRun, fakeDocker } = require('./helpers');

let srv; let docker; let coder; let pid;
const RUNNING = '"running"|"bot-dot/desktop:latest"|"sha256:a"';
const DECISION = 'QA decision: log source is Open-Meteo only';
const TODO = 'Keep the decision after rename';
const EVENT = 'Rename day';

const company = async () => (await srv.api(`/company?project=${pid}`)).data.company;
const rename = (name) => srv.api(`/company?project=${pid}`, { method: 'PATCH', body: { name } });
const onDisk = () => {
  const raw = JSON.parse(fs.readFileSync(path.join(srv.data, 'company.json'), 'utf8'));
  const c = raw.projects ? raw.projects.find((x) => x.id === pid) : raw;
  return {
    decisions: (c.decisions || []).map((d) => d.text),
    todos: (c.todos || []).map((t) => t.text),
    events: (c.events || []).map((e) => e.title),
  };
};

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
  // A decision, a to-do and a calendar event: three fields kept in company.json by the same write as decisions.
  assert.equal((await srv.api('/company/decisions', { method: 'POST', body: { text: DECISION } })).status, 201);
  assert.equal((await srv.api('/company/todos', { method: 'POST', body: { text: TODO } })).status, 201);
  assert.equal((await srv.api('/company/events', { method: 'POST', body: { title: EVENT, day: '2026-11-19', time: '10:00' } })).status, 201);
});
after(async () => { srv.unhold(); await srv.stop(); docker.remove(); });

test('a decision survives a rename that follows the folder at once (no bot runs)', async () => {
  docker.answer('inspect.json', RUNNING);
  docker.answer('exec.txt', 'moved Fernhill Garden\n');
  const r = await rename('Fernhill Garden');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.decisions.map((d) => d.text), [DECISION]);
  assert.deepEqual(r.data.todos.map((t) => t.text), [TODO]);
  assert.deepEqual(r.data.events.map((e) => e.title), [EVENT]);
  assert.deepEqual(onDisk(), { decisions: [DECISION], todos: [TODO], events: [EVENT] });
  const c = await company();
  assert.deepEqual(c.decisions.map((d) => d.text), [DECISION]);
  assert.deepEqual(c.todos.map((t) => t.text), [TODO]);
  assert.deepEqual(c.events.map((e) => e.title), [EVENT]);
});

test('a decision survives a rename deferred for the sweep (a bot runs)', async () => {
  docker.answer('inspect.json', RUNNING);
  const { rec } = await heldRun(srv, coder, 'Work on the site');
  let r = await rename('Fernhill Estate');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // The folder keeps its old name while the bot runs; the decision is untouched meanwhile.
  assert.equal(r.data.folder.name, 'Fernhill Garden');
  assert.deepEqual(r.data.decisions.map((d) => d.text), [DECISION]);
  assert.deepEqual(onDisk().decisions, [DECISION]);
  srv.release(rec);
  for (let i = 0; i < 50 && (await srv.api(`/bots/${coder.id}`)).data?.running; i++) await new Promise((ok) => setTimeout(ok, 50));
  // The sweep's follow: once idle, the folder follows the new name.
  docker.answer('exec.txt', 'moved Fernhill Estate\n');
  r = await rename('Fernhill Estate');
  assert.deepEqual(r.data.folder, { name: 'Fernhill Estate', path: '/workspace/projects/Fernhill Estate' });
  assert.deepEqual(r.data.decisions.map((d) => d.text), [DECISION]);
  assert.deepEqual(r.data.todos.map((t) => t.text), [TODO]);
  assert.deepEqual(r.data.events.map((e) => e.title), [EVENT]);
  docker.answer('exec.txt', null);
});
