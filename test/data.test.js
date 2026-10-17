// Memory, attached files, scheduled jobs and the vault.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, makeBot, zip, ROOT } = require('./helpers');

let srv, bot;
before(async () => { srv = await startServer(); bot = await makeBot(srv, { name: 'Home Keeper', emoji: '🏠' }); });
after(() => srv.stop());

test('memory: a note is found by search, and bots are kept apart', async () => {
  const other = await makeBot(srv, { name: 'Other' });
  const n = await srv.api('/memory/notes', { method: 'POST', body: { owner: bot.id, text: 'The router is in the hallway cupboard.', topic: 'home' } });
  assert.equal(n.status, 201, JSON.stringify(n.data));
  const found = await srv.api(`/memory/search?q=${encodeURIComponent('router cupboard')}&bot=${bot.id}`);
  assert.ok(found.data.results.some((r) => /hallway cupboard/.test(r.text || r.excerpt || '')));
  const theirs = await srv.api(`/memory/search?q=${encodeURIComponent('router cupboard')}&bot=${other.id}`);
  assert.ok(!theirs.data.results.some((r) => /hallway cupboard/.test(r.text || r.excerpt || '')), "another bot doesn't see it");
});

test('an attached Excel file gets a readable copy, and the run is told about it', async () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Price</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Milk</t></is></c><c r="B2"><v>3.5</v></c></row></sheetData></worksheet>';
  const xlsx = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Shopping" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  });
  const up = await srv.api(`/uploads?to=bot:${bot.id}`, { method: 'POST', raw: xlsx, headers: { 'X-File-Name': encodeURIComponent('list.xlsx') } });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.ok(up.data.readable, 'a readable copy');
  const text = fs.readFileSync(path.join(srv.data, 'workspaces', bot.id, up.data.readable), 'utf8');
  assert.match(text, /## Sheet: Shopping/);
  assert.match(text, /Milk,3\.5/);
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'What does it cost?', attachments: [up.data] } });
  await srv.finished(r.data.id);
  const rec = srv.runs().at(-1);
  assert.match(rec.stdin, /list\.xlsx/);
});

test('uploads go only to a bot or the Chief', async () => {
  const r = await srv.api('/uploads?to=nowhere', { method: 'POST', raw: Buffer.from('x') });
  assert.equal(r.status, 400);
});

test('a job can be added, paused and removed', async () => {
  const add = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Morning check', kind: 'ai', cron: '0 9 * * *', prompt: 'Check the home' } });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  assert.equal(add.data.approved, true, 'jobs you add need no approval');
  assert.ok(add.data.nextRunAt);
  const paused = await srv.api(`/bots/${bot.id}/jobs/${add.data.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal(paused.data.enabled, false);
  assert.equal(paused.data.nextRunAt, null, 'a paused job has no next run');
  const back = await srv.api(`/bots/${bot.id}/jobs/${add.data.id}`, { method: 'PUT', body: { enabled: true } });
  assert.ok(back.data.nextRunAt);
  assert.equal((await srv.api(`/bots/${bot.id}/jobs/${add.data.id}`, { method: 'DELETE' })).data.ok, true);
  assert.equal((await srv.api(`/bots/${bot.id}/jobs`)).data.length, 0);
});

test('a script job the Chief adds waits for your approval', async () => {
  const add = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Disk check', kind: 'script', cron: '0 2 * * *', script: 'df -h /', aiWhen: 'output', assessment: 'No AI needed: it only reads the disk.' } });
  assert.equal(add.data.approved, false);
  assert.equal(add.data.nextRunAt, null);
  const ok = await srv.asChief(`/bots/${bot.id}/jobs/${add.data.id}/approve`, { method: 'POST', body: {} });
  assert.equal(ok.status, 403, 'the Chief can’t approve its own job');
  const yes = await srv.api(`/bots/${bot.id}/jobs/${add.data.id}/approve`, { method: 'POST', body: {} });
  assert.equal(yes.data.approved, true);
  const audit = fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8');
  const records = audit.trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.at(-1).actor, 'owner');
  assert.equal(records.at(-1).action, 'job.approved');
  assert.ok(!audit.includes('df -h'));
  assert.equal(fs.statSync(path.join(srv.data, 'audit.log')).mode & 0o777, 0o600);
});

test('"always approve" a job: only you can, and then its later changes need no OK', async () => {
  const add = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Log size', kind: 'script', cron: '0 3 * * *', script: 'du -sh .', aiWhen: 'never', alwaysApprove: true, assessment: 'No AI: it only measures.' } });
  assert.equal(add.data.approved, false, 'new: it asks once');
  assert.equal(add.data.alwaysApprove, false, 'the Chief can’t give it');
  const job = `/bots/${bot.id}/jobs/${add.data.id}`;
  assert.equal((await srv.api(`${job}/approve`, { method: 'POST', body: { always: true } })).data.alwaysApprove, true);
  const changed = await srv.asChief(job, { method: 'PUT', body: { cron: '0 4 * * *', alwaysApprove: false } });
  assert.deepEqual([changed.data.approved, changed.data.alwaysApprove], [true, true], 'a change needs no OK, and the Chief can’t take it away');
  await srv.api(job, { method: 'PUT', body: { alwaysApprove: false } });
  const again = await srv.asChief(job, { method: 'PUT', body: { cron: '0 5 * * *' } });
  assert.deepEqual([again.data.approved, again.data.cron, again.data.change?.cron], [true, '0 4 * * *', '0 5 * * *'], 'taken back: it asks again, and the change waits beside the approved job (ADR 013)');
});

test('vault: a saved password is stored encrypted and opens with the key', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'botdot-vault-'));
  const env = { ...process.env, BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key') };
  const out = execFileSync(process.execPath, ['-e', `
    const v = require('./lib/vault'); const box = v.create(${JSON.stringify(dir)});
    const e = box.add({ site: 'https://food.example/login', username: 'bart', password: 'pw-123-secret' });
    const raw = require('fs').readFileSync(${JSON.stringify(path.join(dir, 'vault.json'))}, 'utf8');
    process.stdout.write(JSON.stringify({ site: e.site, plain: raw.includes('pw-123-secret'), back: v.decrypt(JSON.parse(raw).entries[0].secret), listed: JSON.stringify(box.list()).includes('pw-123') }));
  `], { cwd: ROOT, env }).toString();
  const r = JSON.parse(out);
  assert.equal(r.site, 'food.example');
  assert.equal(r.plain, false, 'not in plain text on disk');
  assert.equal(r.back, 'pw-123-secret');
  assert.equal(r.listed, false, 'never in the list');
});

test('Office members over the expansion limit are rejected without killing the server', async () => {
  const zlib = require('node:zlib');
  const name = Buffer.from('word/document.xml');
  const text = Buffer.from('<w:p>' + 'A'.repeat(200000) + '</w:p>');
  const compressed = zlib.deflateRawSync(text);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + compressed.length, 16);
  const raw = Buffer.concat([local, name, compressed, central, name, end]);
  const r = await srv.api(`/uploads?to=bot:${bot.id}`, { method: 'POST', raw, headers: { 'X-File-Name': 'bomb.docx' } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /expansion limit/);
  assert.equal((await srv.api('/bots')).status, 200);
});
