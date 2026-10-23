// The Chief's own files and workspace (#383), as a bot's (#235, #296): what the owner attached in its chats, in
// uploads/ of its folder, is named in every Chief turn and a file kept in mind comes with it; the owner lists, opens,
// keeps in mind and deletes them under /api/chief/files, and manages its folder under /api/chief/workspace. The Chief
// lists its own and keeps one in mind only in a turn the owner started; it never deletes one.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const ws = () => path.join(srv.data, 'workspaces', '_chief');
const upload = async (name, text) => {
  const r = await srv.api('/uploads?to=chief', { method: 'POST', raw: Buffer.from(text), headers: { 'X-File-Name': encodeURIComponent(name) } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};
const one = (f) => encodeURIComponent(f.file.split('/').pop());
const isChief = (x) => x.args.includes('🧭 Chief of Staff');
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const replyDone = (id) => waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
// A Chief turn on the owner's message; held while `during` runs, with the Chief's headers of that chat.
async function turn(text, during = async () => {}) {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const run = await srv.nextRun((x) => isChief(x) && x.stdin.includes(text), "the Chief's turn");
  try { await during({ headers: { 'X-Chief-Chat': chat.id } }); } finally { srv.unhold(); srv.release(run); await replyDone(chat.id); }
  return run;
}

let cv; let long;
test('the files attached in its chats are listed, and a turn is told of them', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('chief-files'));
  cv = await upload('CV Alex.txt', 'Alex Example. Ten years of Android and Node.');
  long = await upload('handbook.md', `# Handbook\n${'rule. '.repeat(3000)}`);
  const r = await srv.api('/chief/files');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.files.map((f) => f.name).sort(), ['CV-Alex.txt', 'handbook.md']);
  assert.equal(r.data.maxPinned, 10);
  const rec = await turn('What files do I have here?');
  assert.match(rec.system, /Your files: what the owner attached in your chats, in uploads\/ in your workspace/);
  assert.ok(rec.system.includes(cv.file) && rec.system.includes(long.file));
  assert.doesNotMatch(rec.system, /Alex Example/, 'not kept in mind: only named');
});

test("a file the owner keeps in mind comes with every turn; the Chief saves its summary of a long one", async () => {
  let r = await srv.api(`/chief/files/${one(cv)}`, { method: 'PUT', body: { pinned: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.files.find((f) => f.file === cv.file).pinned, true);
  const rec = await turn('Remind me of my CV');
  assert.ok(rec.system.includes(`<file name="CV-Alex.txt" path="${cv.file}">\nAlex Example. Ten years of Android and Node.\n</file>`));
  assert.ok(!fs.readFileSync(path.join(srv.data, 'file-pins.json'), 'utf8').includes('Alex Example'), 'the pin holds no text');

  // Outside a turn the owner started, the Chief keeps nothing new in mind.
  r = await srv.asChief(`/chief/files/${one(long)}`, { method: 'PUT', body: { pinned: true } });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  // In one, it does, with its summary, which then comes in place of the long text.
  await turn('Keep the handbook in mind', async (as) => {
    r = await srv.asChief(`/chief/files/${one(long)}`, { ...as, method: 'PUT', body: { pinned: true, summary: 'Office rules: be on time.' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.file.summary, 'Office rules: be on time.');
  });
  const next = await turn('Anything to keep in mind?');
  assert.ok(next.system.includes(`<file name="handbook.md" path="${long.file}" summary="yours">\nOffice rules: be on time.\n</file>`));
  assert.doesNotMatch(next.system, /rule\. rule\./);
});

test('only the owner opens or deletes one of its files', async () => {
  assert.equal((await srv.asChief(`/chief/files/${one(cv)}`)).status, 403);
  assert.equal((await srv.asChief(`/chief/files/${one(cv)}`, { method: 'DELETE' })).status, 403);
  const got = await srv.api(`/chief/files/${one(cv)}`);
  assert.equal(got.status, 200);
  assert.match(String(got.data), /Alex Example/);
  const r = await srv.api(`/chief/files/${one(cv)}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.files.map((f) => f.name), ['handbook.md']);
  assert.ok(!fs.existsSync(path.join(ws(), cv.file)));
  assert.equal((await srv.api(`/chief/files/${one(cv)}`, { method: 'DELETE' })).status, 404);
});

test("its workspace is its folder on this server, the owner's to manage, with no folder on the computer", async () => {
  let r = await srv.api('/chief/workspace');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const uploads = r.data.entries.find((e) => e.name === 'uploads');
  assert.ok(uploads && uploads.protected, 'uploads/ stays');
  r = await srv.api('/chief/workspace/folder', { method: 'POST', body: { path: '', name: 'notes' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(fs.statSync(path.join(ws(), 'notes')).isDirectory());
  r = await srv.api('/chief/workspace/upload?root=server&path=notes', { method: 'POST', raw: Buffer.from('hello'), headers: { 'X-File-Name': 'a.txt' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await srv.api('/chief/workspace?path=uploads');
  assert.ok(r.data.entries.some((e) => e.name === long.file.split('/').pop() && e.keepsName));
  // A file kept in mind goes from the workspace with its pin, as from Files.
  r = await srv.api(`/chief/workspace?path=${encodeURIComponent(long.file)}`, { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await srv.api('/chief/files')).data.files, []);
  assert.equal((await srv.api('/chief/workspace?root=computer')).status, 400);
  assert.equal((await srv.asChief('/chief/workspace')).status, 403);
});
