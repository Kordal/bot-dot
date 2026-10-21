// Handing files on (issue #58): a bot sends files with message_bot, the Chief hands them to a bot with
// run_bot, and a connector action gets a file from {"$file": …} instead of base64 the AI types out.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer, makeBot, heldRun, self, waitFor } = require('./helpers');

const KEY = 'pk_test_key_pass_files';
const PNG = Buffer.from('89504e470d0a1a0a-not-really-a-png', 'utf8');

// A stand-in for Composio: Gmail's send action has a file field; a made-up one takes base64.
const seen = { uploads: [], puts: [], executed: [] };
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const url = new URL(req.url, 'http://x');
    const body = Buffer.concat(chunks);
    if (req.method === 'PUT' && url.pathname === '/s3/put') { seen.puts.push({ type: req.headers['content-type'], body }); res.writeHead(200); return res.end(); }
    if (req.headers['x-api-key'] !== KEY) return json(401, { message: 'Bad key' });
    if (url.pathname === '/toolkits') return json(200, { items: [], next_cursor: null });
    if (url.pathname === '/connected_accounts') return json(200, { items: [{ id: 'ca_1', toolkit: { slug: 'gmail' }, status: 'ACTIVE' }] });
    if (url.pathname === '/tools/GMAIL_SEND_EMAIL') {
      return json(200, { slug: 'GMAIL_SEND_EMAIL', toolkit: { slug: 'gmail' }, input_parameters: { type: 'object', properties: {
        subject: { type: 'string' },
        attachment: { anyOf: [{ type: 'object', title: 'FileUploadable', file_uploadable: true, properties: { name: {}, mimetype: {}, s3key: {} } }, { type: 'null' }] },
        extra: { type: 'object', properties: { content_b64: { type: 'string' } } },
      } } });
    }
    if (url.pathname === '/files/upload/request') {
      const b = JSON.parse(body);
      seen.uploads.push(b);
      return json(200, { id: 'f1', key: `gmail/${b.filename}`, type: 'new', new_presigned_url: `http://127.0.0.1:${fake.address().port}/s3/put`, metadata: { storage_backend: 's3' } });
    }
    if (url.pathname === '/tools/execute/GMAIL_SEND_EMAIL') { seen.executed.push(JSON.parse(body).arguments); return json(200, { successful: true, data: { id: 'sent' } }); }
    return json(404, { message: 'Not here' });
  });
});

let srv, surfer, mail;
before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { COMPOSIO_API_URL: `http://127.0.0.1:${fake.address().port}` } });
  mail = await makeBot(srv, { name: 'Mail Keeper', emoji: '📬', mayMessage: [], connectors: ['gmail'] });
  surfer = await makeBot(srv, { name: 'Web Surfer', emoji: '🏄', mayMessage: [mail.id] });
});
after(async () => { await srv?.stop(); fake.close(); });

const ws = (bot) => path.join(srv.data, 'workspaces', bot.id);
const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;

test('message_bot hands a teammate a copy of a file from the workspace', async () => {
  const { rec, run, token } = await heldRun(srv, surfer);
  fs.writeFileSync(path.join(ws(surfer), 'recipes.png'), PNG);
  const r = await self(srv, token, 'message', { to: mail.id, message: 'Email this screenshot to owner@example.com', priority: true, files: ['recipes.png'] });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual(r.data.files, ['recipes.png']);
  const theirs = await srv.nextRun((x) => x.args.includes('📬 Mail Keeper'), 'Mail Keeper to start');
  assert.match(theirs.stdin, /🏄 Web Surfer sent you a file/);
  const rel = theirs.stdin.match(/(uploads\/\S+-recipes\.png)/)[1];
  assert.deepEqual(fs.readFileSync(path.join(ws(mail), rel)), PNG, 'its own copy, in its own workspace');
  // The chat shows it inside the folded "Message from" line.
  const started = (await runsOf(mail))[0];
  assert.equal(started.attachments[0].name, 'recipes.png');
  srv.release(theirs);
  srv.release(rec);
  await srv.finished(started.id);
  await srv.finished(run.id);
  // Mail Keeper sent no message back: Web Surfer is started once more, with Mail Keeper's reply (QW-004).
  const follow = await srv.nextRun((x) => x.args.includes('🏄 Web Surfer') && /📬 Mail Keeper did not message you back/.test(x.stdin), "Web Surfer's follow-up");
  srv.release(follow);
  await waitFor(async () => (await runsOf(surfer)).every((x) => x.status !== 'running'), { what: 'the follow-up to finish' });
});

test('a file the run attached (a screenshot of its computer) can be passed on by its name, and into the inbox', async () => {
  const { rec, run, token } = await heldRun(srv, surfer);
  fs.mkdirSync(path.join(ws(surfer), 'out'), { recursive: true });
  fs.writeFileSync(path.join(ws(surfer), 'out', 'Report.pdf'), 'pdf!');
  assert.equal((await self(srv, token, 'file', { path: 'out/Report.pdf' })).data.ok, true);
  fs.rmSync(path.join(ws(surfer), 'out'), { recursive: true }); // only the attached copy is left
  const r = await self(srv, token, 'message', { to: mail.id, message: 'For later.', priority: false, files: ['Report.pdf'] });
  assert.equal(r.data.delivered, 'inbox', JSON.stringify(r.data));
  // The note wakes Mail Keeper at once (ADR 049), and the file is in its workspace for that run.
  const woke = await srv.nextRun((x) => x.args.includes('📬 Mail Keeper') && x.stdin.includes('For later.'), 'Mail Keeper woken by the note');
  const rel = woke.stdin.match(/Files it sent you, saved in your workspace: (uploads\/\S+-Report\.pdf)/)[1];
  assert.equal(fs.readFileSync(path.join(ws(mail), rel), 'utf8'), 'pdf!');
  const wokeRun = (await runsOf(mail)).find((x) => x.status === 'running');
  srv.release(woke);
  await srv.finished(wokeRun.id);
  srv.release(rec);
  await srv.finished(run.id);
});

test('refused: files outside the workspace, missing ones, too many', async () => {
  const { rec, run, token } = await heldRun(srv, surfer);
  const send = (files) => self(srv, token, 'message', { to: mail.id, message: 'x', priority: false, files });
  assert.match((await send(['/etc/passwd'])).data.error, /isn't in your workspace/);
  assert.match((await send(['../../bots.json'])).data.error, /isn't in your workspace|no file/);
  fs.symlinkSync(path.join(srv.data, 'bots.json'), path.join(ws(surfer), 'sneaky.json'));
  assert.match((await send(['sneaky.json'])).data.error, /isn't in your workspace/);
  assert.match((await send(['nope.png'])).data.error, /no file nope\.png/);
  assert.match((await send(Array(11).fill('x'))).data.error, /at most 10/);
  srv.release(rec);
  await srv.finished(run.id);
});

test("the Chief hands a bot another run's file, or one the owner gave it", async () => {
  // Web Surfer attaches a screenshot; the Chief sees it as "<runId>/<name>".
  const h = await heldRun(srv, surfer);
  fs.writeFileSync(path.join(ws(surfer), 'shot.png'), PNG);
  await self(srv, h.token, 'file', { path: 'shot.png' });
  srv.release(h.rec);
  await srv.finished(h.run.id);
  const chiefDir = path.join(srv.data, 'workspaces', '_chief', 'uploads');
  fs.mkdirSync(chiefDir, { recursive: true });
  fs.writeFileSync(path.join(chiefDir, '20260928-ab12-notes.txt'), 'hello from the owner');

  srv.hold();
  const r = await srv.asChief(`/bots/${mail.id}/run`, { method: 'POST', body: { prompt: 'Email these', files: [`${h.run.id}/shot.png`, 'uploads/20260928-ab12-notes.txt'] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rec = await srv.nextRun((x) => x.args.includes('📬 Mail Keeper') && x.stdin.includes('Email these'), 'the run');
  assert.deepEqual(r.data.attachments.map((a) => a.name), ['shot.png', '20260928-ab12-notes.txt']);
  assert.deepEqual(fs.readFileSync(path.join(ws(mail), r.data.attachments[0].file)), PNG);
  assert.match(rec.stdin, /hello from the owner/);
  srv.release(rec);
  await srv.finished(r.data.id);

  const bad = await srv.asChief(`/bots/${mail.id}/run`, { method: 'POST', body: { prompt: 'x', files: [`${h.run.id}/other.png`] } });
  assert.match(bad.data.error, /no file/);
  const out = await srv.asChief(`/bots/${mail.id}/run`, { method: 'POST', body: { prompt: 'x', files: ['../../bots.json'] } });
  assert.match(out.data.error, /isn't in your workspace|no file/);
  // Only the Chief's tools pass files this way; the owner attaches them.
  const owner = await srv.api(`/bots/${mail.id}/run`, { method: 'POST', body: { prompt: 'Owner run', files: [`${h.run.id}/shot.png`] } });
  assert.equal(owner.data.attachments, undefined);
  srv.release(await srv.nextRun((x) => x.stdin.includes('Owner run'), 'the owner run'));
  await srv.finished(owner.data.id);
});

test('a connector action gets the file from {"$file"}: uploaded for a file field, base64 elsewhere', async () => {
  assert.equal((await srv.api('/connectors/key', { method: 'PUT', body: { key: KEY } })).status, 200);
  const { rec, run } = await heldRun(srv, mail);
  const token = rec.connectors.env.RUN_TOKEN;
  fs.writeFileSync(path.join(ws(mail), 'recipes.png'), PNG);
  const request = { method: 'POST', headers: { 'X-Run-Token': token }, body: {
    app: 'gmail', action: 'GMAIL_SEND_EMAIL',
    arguments: { subject: 'Screenshot', attachment: { $file: 'recipes.png' }, extra: { content_b64: { $file: 'recipes.png' } } },
  } };
  const pending = await srv.api('/connectors/session/run', request);
  assert.equal(pending.data.needsApproval, true);
  assert.equal(seen.uploads.length, 0, 'even the file upload waits for approval');
  await srv.api(`/asks/${pending.data.requestId}`, { method: 'POST', body: { yes: true, always: true } });
  const r = await srv.api('/connectors/session/run', request);
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(seen.uploads[0].filename, 'recipes.png');
  assert.equal(seen.uploads[0].mimetype, 'image/png');
  assert.deepEqual(seen.puts[0].body, PNG);
  assert.deepEqual(seen.executed[0].attachment, { name: 'recipes.png', mimetype: 'image/png', s3key: 'gmail/recipes.png' });
  assert.equal(seen.executed[0].extra.content_b64, PNG.toString('base64'));
  const bad = await srv.api('/connectors/session/run', { method: 'POST', headers: { 'X-Run-Token': token }, body: { app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: { attachment: { $file: '/etc/hosts' } } } });
  assert.match(bad.data.error, /isn't in your workspace/);
  srv.release(rec);
  await srv.finished(run.id);
});
