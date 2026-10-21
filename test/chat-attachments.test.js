// The owner's own files in a Chief chat and in a group (#268): a chip under the owner's message opens the file, as a
// bot's file does. botdot serves only a file a message of that chat lists (sent, steered or still waiting), from
// the Chief's folder or the group's own, as a download in a sandbox or as JSON for the viewer. No free path, never a
// page, and the owner's alone: the Chief's tools are refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const upload = async (to, name, text) => (await srv.api(`/uploads?to=${to}`, { method: 'POST', raw: Buffer.from(text), headers: { 'X-File-Name': name } })).data;
const short = (f) => encodeURIComponent(f.file.split('/').pop());
const isChief = (x) => x.args.includes('🧭 Chief of Staff');
const quiet = (id) => waitFor(async () => { const c = (await srv.api(`/chief/chats/${id}`)).data; return !c.busy && !c.queued.length && !c.messages.at(-1)?.pending ? c : null; }, { what: 'the Chief to finish' });
const raw = (p) => fetch(`${srv.base}/api${p}`, { headers: { 'X-Bot-Dot': '1' } });

test('the server says it serves them', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('chat-attachments'));
});

test("a file the owner sent in a Chief chat opens in the viewer and downloads; one no message lists doesn't", async () => {
  const id = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  const md = await upload('chief', 'qa-test.md', '# QA\nIt opens.\n');
  const zip = await upload('chief', 'pack.zip', 'PK-not-really');
  const other = await upload('chief', 'other.md', 'never sent');
  const sent = await srv.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text: 'Look at these', attachments: [md, zip] } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  await quiet(id);
  const at = (f, q = '') => `/chief/chats/${id}/uploads/${short(f)}${q}`;
  const v = await srv.api(at(md, '?view=1'));
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.deepEqual([v.data.name, v.data.kind, v.data.text], ['qa-test.md', 'markdown', '# QA\nIt opens.\n']);
  // Without view=1 it downloads under the name it was sent with, an attachment in a sandbox, never a page.
  const res = await raw(at(zip));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''pack\.zip$/);
  assert.equal(res.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  assert.equal(res.headers.get('cache-control'), 'no-store', 'the Chief may rewrite a file in its folder');
  assert.equal(await res.text(), 'PK-not-really');
  // A file in the Chief's folder that no message of this chat lists, a path, and another chat: nothing.
  assert.equal((await srv.api(at(other, '?view=1'))).status, 404);
  assert.equal((await srv.api(`/chief/chats/${id}/uploads/..%2F..%2Fchief.json`)).status, 404);
  const elsewhere = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  assert.equal((await srv.api(`/chief/chats/${elsewhere}/uploads/${short(md)}`)).status, 404);
  // The owner's alone.
  assert.equal((await srv.asChief(at(md, '?view=1'))).status, 403);
  // A file swapped for a link out of the Chief's folder is refused.
  fs.writeFileSync(path.join(srv.data, 'outside.txt'), 'not for the chat');
  const sent2 = path.join(srv.data, 'workspaces', '_chief', zip.file);
  fs.rmSync(sent2);
  fs.symlinkSync(path.join(srv.data, 'outside.txt'), sent2);
  const out = await srv.api(at(zip, '?view=1'));
  assert.equal(out.status, 403, JSON.stringify(out.data));
  assert.equal(out.data.text, undefined);
});

test('a file of a message that waits for the Chief to be free opens too', async () => {
  const id = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  srv.hold();
  try {
    await srv.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text: 'First' } });
    await srv.nextRun(isChief, 'the first turn');
    const notes = await upload('chief', 'notes.txt', 'Friday is free.');
    const waits = await srv.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text: 'Then this', attachments: [notes] } });
    assert.equal(waits.data.queued.length, 1);
    const v = await srv.api(`/chief/chats/${id}/uploads/${short(notes)}?view=1`);
    assert.equal(v.status, 200, JSON.stringify(v.data));
    assert.equal(v.data.text, 'Friday is free.');
  } finally { srv.unhold(); }
  await quiet(id);
});

test("a file the owner sent in a group opens; one no message of the group lists doesn't", async () => {
  const bots = [];
  for (const n of ['Reader', 'Writer']) bots.push(await makeBot(srv, { name: n, emoji: '🤖', prompt: `Do the work of ${n}.` }));
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Pair', members: bots.map((b) => b.id) } })).data;
  const csv = await upload(`group:${group.id}`, 'prices.csv', 'a,b\n1,2\n');
  const other = await upload(`group:${group.id}`, 'secret.csv', 'x');
  const sent = await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: 'Check the prices', attachments: [csv] } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const v = await srv.api(`/group-chats/${group.id}/uploads/${short(csv)}?view=1`);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.deepEqual([v.data.name, v.data.kind, v.data.text], ['prices.csv', 'csv', 'a,b\n1,2\n']);
  const res = await raw(`/group-chats/${group.id}/uploads/${short(csv)}`);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''prices\.csv$/);
  await res.arrayBuffer();
  assert.equal((await srv.api(`/group-chats/${group.id}/uploads/${short(other)}`)).status, 404);
  assert.equal((await srv.api(`/group-chats/${group.id}/uploads/..%2Fmessages.json`)).status, 404);
  assert.equal((await srv.asChief(`/group-chats/${group.id}/uploads/${short(csv)}`)).status, 403);
});
