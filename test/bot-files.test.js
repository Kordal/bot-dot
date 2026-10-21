// A bot's files (#235): every run is told which files the owner gave it and may read them, a file kept in mind
// (pinned) comes with every task as its text or the bot's summary, and the owner lists, pins, downloads and deletes
// them; the Chief lists and deletes them by name.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, zip } = require('./helpers');

let srv; let bot;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Recruiter', emoji: '🧑‍💼', allowedTools: [] });
});
after(async () => { srv.unhold(); await srv.stop(); });

const ws = () => path.join(srv.data, 'workspaces', bot.id);
const upload = async (name, raw) => {
  const r = await srv.api(`/uploads?to=bot:${bot.id}`, { method: 'POST', raw, headers: { 'X-File-Name': encodeURIComponent(name) } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};
const files = async () => (await srv.api(`/bots/${bot.id}/files`)).data.files;
const one = (f) => encodeURIComponent(f.file.split('/').pop());
let asked = 0;
async function nextPrompt() {
  const prompt = `Anything new? (${++asked})`;
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  await srv.finished(r.data.id);
  return srv.nextRun((x) => x.stdin.includes(prompt), prompt);
}

let cv; let sheet; let long;
test('a later run is told the files it was given and may read them without the Read permission', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('bot-files'));
  cv = await upload('CV Alex.txt', Buffer.from('Alex Example. Ten years of Android and Node.'));
  sheet = await upload('prices.xlsx', zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Milk</t></is></c></row></sheetData></worksheet>',
  }));
  long = await upload('handbook.md', Buffer.from(`# Handbook\n${'rule. '.repeat(2000)}`));
  const rec = await nextPrompt();
  assert.match(rec.system, /Your files: what the owner \(or a teammate\) gave you/);
  for (const f of [cv, sheet, long]) assert.ok(rec.system.includes(f.file), f.file);
  assert.ok(rec.system.includes(`readable copy: ${sheet.readable}`));
  assert.doesNotMatch(rec.system, /Alex Example/, 'not kept in mind: only named');
  assert.match(rec.system, /suggest in one line that you keep it in mind/);
  const tools = rec.args[rec.args.indexOf('--allowedTools') + 1];
  assert.ok(tools.includes(`Read(/${path.join(ws(), 'uploads')}/**)`), tools);

  const listed = await files();
  assert.deepEqual(listed.map((f) => f.name).sort(), ['CV-Alex.txt', 'handbook.md', 'prices.xlsx']);
  assert.ok(listed.every((f) => !f.file.endsWith('.xlsx.txt')), 'a readable copy is not a file of its own');
  assert.equal(listed.find((f) => f.name === 'prices.xlsx').readable, sheet.readable);
});

test("a pinned file's text comes with every task; a long one asks for a summary, which then comes instead", async () => {
  let r = await srv.api(`/bots/${bot.id}/files/${one(cv)}`, { method: 'PUT', body: { pinned: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.files.find((f) => f.file === cv.file).pinned, true);
  r = await srv.api(`/bots/${bot.id}/files/${one(long)}`, { method: 'PUT', body: { pinned: true } });
  let rec = await nextPrompt();
  assert.ok(rec.system.includes(`<file name="CV-Alex.txt" path="${cv.file}">\nAlex Example. Ten years of Android and Node.\n</file>`));
  assert.match(rec.system, /Too long to include, and there is no summary yet\. Read it now, then call pin_file/);
  assert.doesNotMatch(rec.system, /rule\. rule\./, 'the long text stays out');

  // The bot reads it and saves its summary with pin_file.
  const { rec: held, token } = await heldRun(srv, bot);
  const s = await self(srv, token, 'pin-file', { path: long.file, summary: 'Office rules: be on time.' });
  assert.equal(s.data.ok, true, JSON.stringify(s.data));
  srv.release(held);
  srv.unhold();
  rec = await nextPrompt();
  assert.ok(rec.system.includes(`<file name="handbook.md" path="${long.file}" summary="yours">\nOffice rules: be on time.\n</file>`));

  // It unpins by its own tool too, by the file's name.
  const { rec: held2, token: t2 } = await heldRun(srv, bot);
  assert.equal((await self(srv, t2, 'pin-file', { path: 'handbook.md', pinned: false })).data.ok, true);
  srv.release(held2);
  srv.unhold();
  assert.equal((await files()).find((f) => f.file === long.file).pinned, false);
});

test('at most five files are kept in mind', async () => {
  const more = [];
  for (let i = 0; i < 5; i++) more.push(await upload(`note-${i}.txt`, Buffer.from(`note ${i}`)));
  for (const f of more.slice(0, 4)) assert.equal((await srv.api(`/bots/${bot.id}/files/${one(f)}`, { method: 'PUT', body: { pinned: true } })).status, 200);
  const r = await srv.api(`/bots/${bot.id}/files/${one(more[4])}`, { method: 'PUT', body: { pinned: true } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /At most 5 files/);
  for (const f of more) await srv.api(`/bots/${bot.id}/files/${one(f)}`, { method: 'DELETE' });
});

test('the owner downloads a file; deleting removes it, its readable copy and its pin', async () => {
  const d = await srv.api(`/bots/${bot.id}/files/${one(cv)}`);
  assert.equal(d.status, 200);
  assert.equal(Buffer.from(d.data).toString(), 'Alex Example. Ten years of Android and Node.');

  let r = await srv.api(`/bots/${bot.id}/files/${one(sheet)}`, { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!fs.existsSync(path.join(ws(), sheet.file)));
  assert.ok(!fs.existsSync(path.join(ws(), sheet.readable)), 'its readable copy goes too');
  assert.ok(!r.data.files.some((f) => f.file === sheet.file));

  r = await srv.api(`/bots/${bot.id}/files/${one(cv)}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  const pins = JSON.parse(fs.readFileSync(path.join(srv.data, 'file-pins.json'), 'utf8'));
  assert.ok(!(pins[bot.id] || []).some((p) => p.file === cv.file), 'its pin goes with it');
  const rec = await nextPrompt();
  assert.ok(!rec.system.includes(cv.file));
  assert.equal((await srv.api(`/bots/${bot.id}/files/${one(cv)}`)).status, 404);
});

test("the Chief lists a bot's files by name and deletes one; it can't download or pin them", async () => {
  const f = await upload('rules.txt', Buffer.from('House rules'));
  await srv.api(`/bots/${bot.id}/files/${one(long)}`, { method: 'PUT', body: { pinned: true } });
  const listed = await srv.asChief(`/bots/${bot.id}/files`);
  assert.equal(listed.status, 200);
  assert.ok(listed.data.files.some((x) => x.file === f.file));
  assert.ok(!JSON.stringify(listed.data).includes('Office rules'), 'no summary: nothing of the content');
  assert.equal((await srv.asChief(`/bots/${bot.id}/files/${one(f)}`)).status, 403);
  assert.equal((await srv.asChief(`/bots/${bot.id}/files/${one(f)}`, { method: 'PUT', body: { pinned: true } })).status, 403);
  const gone = await srv.asChief(`/bots/${bot.id}/files/${one(f)}`, { method: 'DELETE' });
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  assert.ok(!fs.existsSync(path.join(ws(), f.file)));
});
