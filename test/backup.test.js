// Backups (lib/backup.js, ADR 158): a download made on request, encrypted with the passphrase given then, never kept on
// the machine; the off-site backup's state as the front door says it; and a restore into a fresh install.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, makeBot, sleep, waitFor, ROOT } = require('./helpers');

const PASS = 'correct horse battery';
let a, b;
before(async () => { a = await startServer(); });
after(async () => { await a?.stop(); await b?.stop(); });

test('a download needs a passphrase of 12 characters, and the old nightly routes are gone', async () => {
  const st = (await a.api('/backups')).data;
  assert.deepEqual(st, { offsite: null, preparing: false, minPassphrase: 12 }, 'nothing said of the off-site backup yet');
  for (const passphrase of [undefined, 'short', '12345678901']) {
    const r = await a.api('/backups/download', { method: 'POST', body: { passphrase } });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /12 characters/);
  }
  assert.equal((await a.api('/backups/passphrase', { method: 'PUT', body: { passphrase: PASS } })).status, 410);
  assert.match((await a.api('/backups/now', { method: 'POST' })).data.error, /off-site now/);
  assert.equal((await a.api('/backups/download/0123456789abcdef0123456789abcdef')).status, 404, 'no download asked for');
  const chief = await a.asChief('/backups/download', { method: 'POST', body: { passphrase: PASS } });
  assert.equal(chief.status, 403, 'not the Chief');
  // The off-site backup's state, from the front door alone.
  assert.equal((await a.api('/backups/offsite', { method: 'POST', body: { state: 'done' } })).status, 403, "a person's request");
  assert.equal((await a.api('/backups/offsite', { method: 'POST', headers: { 'x-botdot-room': '1' }, body: { state: 'nope' } })).status, 400);
  const told = await a.api('/backups/offsite', { method: 'POST', headers: { 'x-botdot-room': '1' }, body: { state: 'done', lastSuccess: '2026-11-05T02:14:00Z', late: false } });
  assert.equal(told.status, 200, JSON.stringify(told.data));
  assert.deepEqual((await a.api('/backups')).data.offsite, { state: 'done', lastSuccess: '2026-11-05T02:14:00.000Z', late: false });
});

let bot, group;
let file;
test('a download is encrypted, small, made once at its address and kept nowhere on the machine', async () => {
  bot = await makeBot(a, { name: 'Home Keeper', emoji: '🏠' });
  // A group of two bots, with its place in the list and how far the owner has read it (ADR 018).
  const second = await makeBot(a, { name: 'Garden Keeper', emoji: '🌱' });
  group = (await a.api('/group-chats', { method: 'POST', body: { name: 'House', members: [bot.id, second.id] } })).data;
  group = (await a.api(`/group-chats/${group.id}`, { method: 'PUT', body: { pinned: true } })).data;
  await a.api('/read', { method: 'POST', body: { chat: `group:${group.id}`, app: 'phone-1' } });
  await a.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'The owner lives in Warsaw with a cat named Pixel.' } });
  fs.mkdirSync(path.join(a.data, 'workspaces', bot.id, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(a.data, 'workspaces', bot.id, 'uploads', 'list.md'), '# shopping\n- milk\n');
  // A saved login, a Claude sign-in and a downloaded model: the first goes along, the others don't.
  execFileSync(process.execPath, ['-e', `require('./lib/vault').create(${JSON.stringify(a.data)}).add({ site: 'food.example', username: 'bart', password: 's3cret-pw-XYZ' })`], { cwd: ROOT, env: { ...process.env, BOT_DOT_VAULT_KEY_FILE: path.join(a.dir, 'config', 'vault.key') } });
  fs.mkdirSync(path.join(a.data, 'homes', 'x', '.claude'), { recursive: true });
  fs.writeFileSync(path.join(a.data, 'homes', 'x', '.claude', '.credentials.json'), '{}');
  fs.mkdirSync(path.join(a.data, 'models'), { recursive: true });
  fs.writeFileSync(path.join(a.data, 'models', 'big.bin'), Buffer.alloc(1_000_000, 7));
  // An account's spare room for a full disk (lib/disk-space.js), as it is: what doesn't compress.
  fs.writeFileSync(path.join(a.data, '.spare'), require('crypto').randomBytes(400_000));

  // The Chief writes first (ADR 006): a rated unasked message, how often it may write, and today's count.
  fs.writeFileSync(path.join(a.data, 'chief', 'unasked.json'), JSON.stringify({ id: 'unasked', title: 'A tip', sessionId: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z', costUsd: 0,
    messages: [{ role: 'chief', text: 'A tip about your shopping list.', at: '2026-10-01T09:00:00.000Z', unasked: true }] }));
  assert.equal((await a.api('/chief/chats/unasked/messages/0/rating', { method: 'PUT', body: { rating: 'down' } })).status, 200);
  assert.deepEqual((await a.api('/settings/writing-first', { method: 'PUT', body: { perDay: 2 } })).data.writingFirst, { perDay: 2, sentToday: 0, times: [] });
  // The look's record: the rated message (its rating followed it there), and one whose chat was deleted since.
  const looks = JSON.parse(fs.readFileSync(path.join(a.data, 'looks.json'), 'utf8'));
  assert.deepEqual(looks.raised.map((r) => [r.chatId, r.text, r.rating]), [['unasked', 'A tip about your shopping list.', 'down']]);
  looks.raised.push({ id: 'gone-1', chatId: 'gone', at: '2026-09-30T09:00:00.000Z', text: 'A tip from a chat deleted since.', rating: 'up', answer: 'thanks' });
  fs.writeFileSync(path.join(a.data, 'looks.json'), JSON.stringify({ ...looks, day: '2026-10-01', posted: 2, look: 29323253 }));
  assert.equal((await a.api('/chief/look', { method: 'POST' })).status, 404, 'a look by hand is for test environments only');
  // The checkup (ADR 023): when it runs, and its record of proposals with how the owner answered.
  assert.equal((await a.api('/settings/checkup', { method: 'PUT', body: { days: [1, 4], time: '07:30', webSearch: true } })).data.checkup.when, 'Mondays and Thursdays at 07:30');
  fs.writeFileSync(path.join(a.data, 'checkups.json'), JSON.stringify({ day: '2026-10-01', ranAt: '2026-10-01T07:30:00.000Z', proposals: [{ id: 'p1', kind: 'rule', bot: 'Shopper', change: 'Ask once.', evidence: 'said twice', day: '2026-09-30', at: '2026-10-01T07:30:00.000Z', shown: 1, status: 'declined', decidedAt: '2026-10-01T08:00:00.000Z', chatId: 'gone', n: 1 }] }));
  assert.equal((await a.api('/chief/checkup/now', { method: 'POST' })).status, 404, 'a checkup by hand is for test environments only');

  // Old nightly backups of before ADR 158, and their key: a whole download makes them go.
  fs.mkdirSync(path.join(a.data, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(a.data, 'backups', 'bot-dot-20261101-030000.bdb'), 'old');
  fs.writeFileSync(path.join(a.dir, 'config', 'backup.key'), '{}');

  const asked = await a.api('/backups/download', { method: 'POST', body: { passphrase: PASS } });
  assert.equal(asked.status, 200, JSON.stringify(asked.data));
  assert.match(asked.data.url, /^\/api\/backups\/download\/[0-9a-f]{32}$/);
  assert.match(asked.data.name, /^bot-dot-([a-z][a-z0-9-]+-)?\d{8}-\d{6}\.bdb$/);
  assert.deepEqual(fs.readdirSync(path.join(a.data, 'backups')).filter((n) => n !== 'state.json').map((n) => n.replace(/^\.memory-\d+\.db$/, '.memory-<pid>.db')).sort(), ['.memory-<pid>.db', 'bot-dot-20261101-030000.bdb'], 'only the copy of the memory waits');
  const res = await fetch(`${a.base}${asked.data.url}`, { headers: { 'X-Bot-Dot': '1' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-disposition'), `attachment; filename="${asked.data.name}"`);
  file = Buffer.from(await res.arrayBuffer());
  for (const plain of ['Warsaw', 'Home Keeper', 'milk', 's3cret']) assert.ok(!file.includes(plain), `no "${plain}" in the file`);
  assert.ok(file.length < 300_000, 'the model and the spare are left out');
  assert.equal((await fetch(`${a.base}${asked.data.url}`, { headers: { 'X-Bot-Dot': '1' } })).status, 404, 'fetched once');
  assert.deepEqual(fs.readdirSync(path.join(a.data, 'backups')).sort(), ['state.json'], 'nothing kept: no file, no copy of the memory, no old backups');
  assert.ok(!fs.existsSync(path.join(a.dir, 'config', 'backup.key')), 'nor their key');
  const audit = fs.readFileSync(path.join(a.data, 'audit.log'), 'utf8');
  assert.match(audit, /"action":"backup\.downloaded"/);
});

test('restore into a fresh install brings everything back', async () => {
  b = await startServer();
  const up = await b.api('/backups/upload', { method: 'POST', raw: file });
  assert.ok(up.data.file);
  const wrong = await b.api('/backups/restore', { method: 'POST', body: { file: up.data.file, passphrase: 'wrong passphrase' } });
  assert.match(wrong.data.error, /Wrong passphrase/);
  assert.ok(!fs.existsSync(path.join(b.data, '.restore-pending')), 'nothing staged');
  const r = await b.api('/backups/restore', { method: 'POST', body: { file: up.data.file, passphrase: PASS } });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.bots, 2);
  await b.exited; // it stops itself, for Docker to start it again
  b = await startServer({ dir: b.dir });
  const audit = fs.readFileSync(path.join(b.data, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(audit.some((entry) => entry.action === 'backup.restored' && entry.actor === 'owner'), 'the restore preserves the installation audit trail');
  assert.ok((await b.api('/bots')).data.some((x) => x.id === bot.id && x.name === 'Home Keeper'));
  // Not its read position: a chat never read is read up to when this install began.
  const unplaced = ({ readAt, ...g }) => g;
  assert.deepEqual((await b.api('/group-chats')).data.map(unplaced), [unplaced(group)], 'the group came along, with its members and its place');
  assert.equal(JSON.parse(fs.readFileSync(path.join(b.data, 'read-positions.json'), 'utf8')).chats[`group:${group.id}`], JSON.parse(fs.readFileSync(path.join(a.data, 'read-positions.json'), 'utf8')).chats[`group:${group.id}`]);
  assert.match(JSON.stringify((await b.api('/memory/search?q=Pixel')).data), /Pixel/);
  assert.match(fs.readFileSync(path.join(b.data, 'workspaces', bot.id, 'uploads', 'list.md'), 'utf8'), /milk/);
  const rated = (await b.api('/chief/chats/unasked')).data.messages[0];
  assert.deepEqual([rated.unasked, rated.rating], [true, 'down'], 'the rating came along');
  assert.equal((await b.api('/settings/writing-first')).data.writingFirst.perDay, 2, 'and how often the Chief may write first');
  const looks = JSON.parse(fs.readFileSync(path.join(b.data, 'looks.json'), 'utf8'));
  assert.deepEqual([looks.day, looks.posted, looks.look], ['2026-10-01', 2, 29323253], "and the day's count");
  assert.deepEqual(looks.raised.map((r) => [r.chatId, r.text, r.rating, r.answer]), [['unasked', 'A tip about your shopping list.', 'down', null], ['gone', 'A tip from a chat deleted since.', 'up', 'thanks']], "and the look's record of what it raised, once");
  assert.equal(rated.lookId, looks.raised[0].id);
  const checkup = (await b.api('/settings/checkup')).data.checkup;
  assert.deepEqual([checkup.when, checkup.webSearch, checkup.lastRanAt], ['Mondays and Thursdays at 07:30', true, '2026-10-01T07:30:00.000Z'], 'and when the checkup runs');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(b.data, 'checkups.json'), 'utf8')).proposals.map((p) => [p.id, p.status, p.decidedAt]), [['p1', 'declined', '2026-10-01T08:00:00.000Z']], 'and what it proposed, with the owner\'s answer');
  assert.equal(fs.readFileSync(path.join(b.dir, 'config', 'vault.key'), 'utf8').trim(), fs.readFileSync(path.join(a.dir, 'config', 'vault.key'), 'utf8').trim());
  const pw = execFileSync(process.execPath, ['-e', `const v = require('./lib/vault'); const e = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(b.data, 'vault.json'))}, 'utf8')).entries[0]; process.stdout.write(v.decrypt(e.secret))`], { cwd: ROOT, env: { ...process.env, BOT_DOT_VAULT_KEY_FILE: path.join(b.dir, 'config', 'vault.key') } }).toString();
  assert.equal(pw, 's3cret-pw-XYZ');
  assert.ok(!fs.existsSync(path.join(b.data, 'homes', 'x', '.claude', '.credentials.json')), 'no Claude sign-in');
  assert.ok(!fs.existsSync(path.join(b.data, 'models', 'big.bin')), 'no models');
  // b's own spare, if botdot made one; never a's.
  const spare = path.join(b.data, '.spare');
  assert.ok(!fs.existsSync(spare) || !fs.readFileSync(spare).equals(fs.readFileSync(path.join(a.data, '.spare'))), "not a's spare");
  const kept = fs.readdirSync(path.join(b.data, 'backups')).filter((n) => n.startsWith('replaced-'));
  assert.equal(kept.length, 1, 'what was there is kept aside');
  assert.ok(!fs.readdirSync(path.join(b.data, 'backups')).some((n) => n.startsWith('upload-')));
});

test('no restore while bots are working', async () => {
  const bot2 = await makeBot(b, { name: 'Busy' });
  b.hold();
  await b.api(`/bots/${bot2.id}/run`, { method: 'POST', body: { prompt: 'work' } });
  await waitFor(async () => (await b.api(`/runs?botId=${bot2.id}`)).data[0]?.status === 'running');
  const up = await b.api('/backups/upload', { method: 'POST', raw: file });
  const r = await b.api('/backups/restore', { method: 'POST', body: { file: up.data.file, passphrase: PASS } });
  assert.equal(r.status, 409);
  b.unhold();
});


test('an upload larger than the disk has room for is refused, saying how much it needs, without a temporary file (#1020)', async () => {
  const http = require('node:http');
  const answer = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: a.port, path: '/api/backups/upload', method: 'POST', headers: { 'X-Bot-Dot': '1', 'Content-Length': String(2 ** 52) } }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => { resolve({ status: res.statusCode, body: JSON.parse(body) }); req.destroy(); });
    });
    req.on('error', reject); req.flushHeaders();
  });
  assert.equal(answer.status, 507);
  assert.match(answer.body.error, /^There isn't room on the disk for this backup: it needs \d+ GB and [\d.]+ GB is free\./);
  assert.ok(!fs.readdirSync(path.join(a.data, 'backups')).some((name) => name.startsWith('upload-')));
});

// 257 MB go through the stand-in front door, past the 256 MB the upload was once capped at (#1020): on a busy machine
// (a CI runner) that takes longer than 20 s.
test('a chunked upload over 256 MB is taken whole, and an aborted one leaves no temporary file', { timeout: 60000 }, async (t) => {
  const http = require('node:http');
  const { once } = require('node:events');
  const srv = await startServer();
  t.after(() => srv.stop());
  const uploads = () => fs.readdirSync(path.join(srv.data, 'backups')).filter((name) => name.startsWith('upload-'));
  let req;
  const response = new Promise((resolve, reject) => {
    req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/backups/upload', method: 'POST', headers: { 'X-Bot-Dot': '1' } }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
  });
  const chunk = Buffer.alloc(1024 * 1024);
  for (let n = 0; n < 257; n++) if (!req.write(chunk)) await once(req, 'drain');
  req.end();
  const done = await response;
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(fs.statSync(path.join(srv.data, 'backups', done.body.file)).size, 257 * 1024 * 1024);
  fs.rmSync(path.join(srv.data, 'backups', done.body.file));
  const aborted = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/backups/upload', method: 'POST', headers: { 'X-Bot-Dot': '1' } });
  aborted.on('error', () => {});
  t.after(() => aborted.destroy());
  aborted.write('partial backup');
  await waitFor(() => uploads().length === 1, { what: 'partial backup file' });
  aborted.destroy();
  await waitFor(() => uploads().length === 0, { what: 'aborted backup cleanup' });
  assert.equal((await srv.api('/version')).status, 200);
});

test('an upload without a length that fills the disk stops there, says so and leaves no file (#1020)', async () => {
  const os = require('os');
  const { PassThrough } = require('stream');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-upload-'));
  const file = path.join(dir, 'upload-1.tmp');
  const req = Object.assign(new PassThrough(), { headers: {} });
  let left = 100 * 1024 * 1024; // what the disk has room for
  const saving = require('../lib/backup-upload').save(req, file, { free: () => left });
  const piece = Buffer.alloc(16 * 1024 * 1024);
  for (let n = 0; n < 8; n++) { req.write(piece); left -= piece.length; }
  req.end();
  await assert.rejects(saving, (e) => e.status === 507 && /disk filled up/.test(e.message));
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the page, the app, docs/api.md and the server ask for the same shortest passphrase (#1020)', async () => {
  const { MIN_PASSPHRASE } = require('../lib/backup');
  assert.equal((await a.api('/backups')).data.minPassphrase, MIN_PASSPHRASE);
  const page = fs.readFileSync(path.join(ROOT, 'public', 'settings.js'), 'utf8');
  const card = page.slice(page.indexOf('// Settings → Backups'), page.indexOf('// Setup → Restore a backup'));
  assert.match(card, /b\.minPassphrase \|\| 12/);
  assert.equal(MIN_PASSPHRASE, 12, 'the fallback for a server that sends none');
  assert.doesNotMatch(card, /minlength="\d|at least \d+ characters/, 'no number of its own on the page');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'lib', 'i18n', 'pl', 'web.json'), 'utf8'), /co najmniej \d+ znak/);
  const model = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app', 'data', 'Models.kt'), 'utf8');
  assert.match(model, /val minPassphrase: Int = 12/);
  const api = fs.readFileSync(path.join(ROOT, 'docs', 'api.md'), 'utf8');
  assert.match(api, /`minPassphrase` \(12\)/);
});

test('a backup of before ADR 158, made with a key of the older strength, still restores with its passphrase', async (t) => {
  const crypto = require('node:crypto');
  const zlib = require('node:zlib');
  const os = require('os');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-backup-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const entry = (h, body = Buffer.alloc(0)) => { const j = Buffer.from(JSON.stringify(h)); const n = Buffer.alloc(4); n.writeUInt32BE(j.length); return Buffer.concat([n, j, body]); };
  const bots = Buffer.from('[{"id":"b1","name":"Old Keeper"}]');
  const plain = zlib.gzipSync(Buffer.concat([entry({ manifest: true, kind: 'bot-dot-backup', version: 1, createdAt: '2026-10-01T03:00:00.000Z', account: null, vaultKey: 'ab'.repeat(32) }), entry({ p: 'bots.json', size: bots.length, mode: 0o600 }, bots)]));
  const salt = Buffer.alloc(16, 7);
  const iv = Buffer.alloc(12, 3);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync('old password', salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }), iv);
  const file = path.join(top, 'bot-dot-20261001-030000.bdb');
  fs.writeFileSync(file, Buffer.concat([Buffer.from('BDBACKUP1\n'), salt, iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]));
  const dataDir = path.join(top, 'data');
  fs.mkdirSync(dataDir);
  const r = await require('../lib/backup').create({ dataDir, memory: {} }).stage(file, 'old password');
  assert.deepEqual([r.createdAt, r.bots], ['2026-10-01T03:00:00.000Z', 1]);
});

test("root's step gets a consistent copy of memory.db, through the front door's socket alone (#1015)", async () => {
  const { DatabaseSync } = require('node:sqlite');
  await a.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'The spare key is under the blue pot.' } });
  assert.equal((await a.api('/backups/snapshot', { method: 'POST' })).status, 403, "a person's request: the front door strips the header from theirs");
  assert.equal((await a.api('/backups/snapshot', { headers: { 'x-botdot-room': '1' } })).status, 405);
  const chief = await fetch(`http://127.0.0.1:${a.botdotPort}/api/backups/snapshot`, { method: 'POST', headers: { 'X-Chief-Key': a.chiefKey, 'x-botdot-room': '1', 'X-Bot-Dot': '1' } });
  assert.equal(chief.status, 403, 'not the Chief');
  const r = await a.api('/backups/snapshot', { method: 'POST', headers: { 'x-botdot-room': '1' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const file = path.join(a.data, '.snapshot', 'memory.db');
  assert.equal(r.data.bytes, fs.statSync(file).size);
  assert.deepEqual(fs.readdirSync(path.join(a.data, '.snapshot')), ['memory.db'], 'no temp file is left');
  const db = new DatabaseSync(file, { readOnly: true });
  const texts = db.prepare('SELECT text FROM notes').all().map((n) => n.text);
  db.close();
  assert.ok(texts.includes('The spare key is under the blue pot.'), 'the copy opens and holds the notes');
  assert.ok(!fs.existsSync(`${file}-wal`), 'a whole file, no WAL of its own');
  // Asked again, it replaces the copy.
  assert.equal((await a.api('/backups/snapshot', { method: 'POST', headers: { 'x-botdot-room': '1' } })).status, 200);
  assert.deepEqual(fs.readdirSync(path.join(a.data, '.snapshot')), ['memory.db']);
});

test('what a backup cut off by a restart left is removed when the server starts', () => {
  const os = require('os');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-backup-'));
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir);
  for (const n of ['bot-dot-20261104-231853.bdb.part', '.memory-4242.db', 'bot-dot-20261021-030952.bdb', 'notes.txt']) fs.writeFileSync(path.join(dir, n), 'x');
  // A copy of memory.db for root that a restart cut off, and one root didn't remove (#1015).
  fs.mkdirSync(path.join(dataDir, '.snapshot'));
  for (const n of ['memory.db.4242.tmp', 'memory.db', 'other']) fs.writeFileSync(path.join(dataDir, '.snapshot', n), 'x');
  require('../lib/backup').create({ dataDir, memory: {} }).start();
  assert.deepEqual(fs.readdirSync(dir).sort(), ['bot-dot-20261021-030952.bdb', 'notes.txt'], 'finished backups and anything else stay');
  assert.deepEqual(fs.readdirSync(path.join(dataDir, '.snapshot')), ['other']);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a backup reads each file up to 8 MB in one call, not as a stream (one for each would start processes)', async () => {
  const os = require('os');
  const pfs = require('../lib/principal-fs');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-backup-'));
  const dataDir = path.join(top, 'data');
  fs.mkdirSync(path.join(dataDir, 'workspaces', 'b1'), { recursive: true });
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dataDir, 'workspaces', 'b1', `f${i}.txt`), `file ${i}\n`);
  fs.mkdirSync(path.join(dataDir, 'workspaces', 'b1', 'app', 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'workspaces', 'b1', 'app', 'node_modules', 'left-pad', 'big.js'), Buffer.alloc(9 * 1024 * 1024, 2));
  fs.writeFileSync(path.join(dataDir, 'big.bin'), Buffer.alloc(9 * 1024 * 1024, 1));
  const saved = { file: process.env.BOT_DOT_VAULT_KEY_FILE, key: process.env.BOT_DOT_VAULT_KEY };
  process.env.BOT_DOT_VAULT_KEY_FILE = path.join(top, 'config', 'vault.key');
  process.env.BOT_DOT_VAULT_KEY = 'ab'.repeat(32);
  const streamed = [];
  const original = pfs.createReadStream;
  pfs.createReadStream = (name, options) => { streamed.push(path.relative(dataDir, name)); return original(name, options); };
  try {
    const backup = require('../lib/backup').create({ dataDir, memory: { snapshot: (p) => fs.writeFileSync(p, 'memory') } });
    const file = await made(backup, dataDir);
    assert.ok(fs.statSync(file).size > 0);
    assert.deepEqual(streamed, ['big.bin'], 'only the file over 8 MB is streamed, and nothing of node_modules is read');
    await backup.stage(file, PASS);
    const staged = path.join(dataDir, '.restore-pending', 'data');
    assert.equal(fs.readFileSync(path.join(staged, 'workspaces', 'b1', 'f7.txt'), 'utf8'), 'file 7\n', 'a file read whole comes back as it was');
    assert.equal(fs.statSync(path.join(staged, 'big.bin')).size, 9 * 1024 * 1024);
    assert.ok(fs.existsSync(path.join(staged, 'workspaces', 'b1', 'app')) && !fs.existsSync(path.join(staged, 'workspaces', 'b1', 'app', 'node_modules')), 'node_modules is left out');
  } finally {
    pfs.createReadStream = original;
    for (const [k, v] of [['BOT_DOT_VAULT_KEY_FILE', saved.file], ['BOT_DOT_VAULT_KEY', saved.key]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(top, { recursive: true, force: true });
  }
});

// A download made with the module itself, into a file under dataDir/out: its path.
async function made(backup, dataDir) {
  const r = await backup.prepare(PASS);
  const file = path.join(dataDir, '..', r.name);
  assert.equal(await backup.download(r.token, fs.createWriteStream(file)), true);
  return file;
}

// A stand-in for the account's computer (lib/computers.js backupWorkspace): its /workspace packed as `packed`, steps
// written down, pieces taken in kept.
function standInComputer(packed, { running = true } = {}) {
  const calls = [];
  const taken = [];
  let unpacked = null;
  return {
    calls, taken, unpacked: () => unpacked,
    ensure: async () => { calls.push('ensure'); },
    backupWorkspace: async (s) => {
      calls.push(s.op);
      if (!running) return s.op === 'pack' ? { code: 0, size: 0, none: true } : { code: null, error: "the computer isn't running" };
      if (s.op === 'pack') return { code: 0, size: packed.length };
      if (s.op === 'read') return { code: 0, data: packed.subarray(s.offset, s.offset + s.length).toString('base64') };
      if (s.op === 'write') { taken.push(Buffer.from(s.data, 'base64')); return { code: 0 }; }
      if (s.op === 'unpack') { unpacked = Buffer.concat(taken); return { code: 0 }; }
      return { code: 0 };
    },
  };
}
async function withBackup(t, computer, work) {
  const os = require('os');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-backup-'));
  const dataDir = path.join(top, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'bots.json'), '[]');
  const saved = { file: process.env.BOT_DOT_VAULT_KEY_FILE, key: process.env.BOT_DOT_VAULT_KEY };
  process.env.BOT_DOT_VAULT_KEY_FILE = path.join(top, 'config', 'vault.key');
  process.env.BOT_DOT_VAULT_KEY = 'ab'.repeat(32);
  t.after(() => {
    for (const [k, v] of [['BOT_DOT_VAULT_KEY_FILE', saved.file], ['BOT_DOT_VAULT_KEY', saved.key]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(top, { recursive: true, force: true });
  });
  const backup = require('../lib/backup').create({ dataDir, memory: { snapshot: (p) => fs.writeFileSync(p, 'memory') }, computer });
  await work(backup, dataDir);
}

test("a backup carries the computer's /workspace, read in pieces, and a restore puts it back once the computer runs (#1020)", async (t) => {
  // Over one piece, so it is read in two.
  const packed = require('crypto').randomBytes(3 * 1024 * 1024 + 4321);
  const computer = standInComputer(packed);
  await withBackup(t, computer, async (backup, dataDir) => {
    const file = await made(backup, dataDir);
    assert.deepEqual(computer.calls, ['pack', 'read', 'read', 'drop']);
    await backup.stage(file, PASS);
    const staged = path.join(dataDir, '.restore-pending', 'data', '.computer', 'workspace.tgz');
    assert.ok(fs.readFileSync(staged).equals(packed), 'the packed workspace, whole');
    require('../lib/backup').applyPendingRestore(dataDir);
    computer.calls.length = 0;
    await backup.restoreWorkspace();
    assert.equal(computer.calls[0], 'ensure', 'the computer is started first');
    assert.deepEqual(computer.calls.slice(1, -1).every((c) => c === 'write'), true);
    assert.equal(computer.calls.at(-1), 'unpack');
    assert.ok(computer.unpacked().equals(packed), 'the same bytes go back, in order');
    assert.ok(!fs.existsSync(path.join(dataDir, '.computer')), 'and the copy here is removed');
    assert.equal(backup.status().workspaceError, undefined);
  });
});

test("an account whose computer doesn't run is backed up as before, and a backup of it restores (#1020)", async (t) => {
  const computer = standInComputer(Buffer.alloc(0), { running: false });
  await withBackup(t, computer, async (backup, dataDir) => {
    const file = await made(backup, dataDir);
    assert.deepEqual(computer.calls, ['pack']);
    await backup.stage(file, PASS);
    assert.ok(!fs.existsSync(path.join(dataDir, '.restore-pending', 'data', '.computer')));
  });
});

test("a restored computer's files that can't go back yet stay, and status says why (#1020)", async (t) => {
  const computer = standInComputer(Buffer.from('x'));
  computer.backupWorkspace = async (s) => (s.op === 'write' ? { code: null, error: "the computer isn't running" } : { code: 0 });
  await withBackup(t, computer, async (backup, dataDir) => {
    fs.mkdirSync(path.join(dataDir, '.computer'));
    fs.writeFileSync(path.join(dataDir, '.computer', 'workspace.tgz'), 'tgz');
    await backup.restoreWorkspace();
    assert.match(backup.status().workspaceError, /Couldn't put back the computer's files: the computer isn't running/);
    assert.ok(fs.existsSync(path.join(dataDir, '.computer', 'workspace.tgz')), 'kept for the next try');
    // A backup made meanwhile doesn't carry the waiting copy as a file of the data.
    await backup.stage(await made(backup, dataDir), PASS);
    assert.ok(!fs.existsSync(path.join(dataDir, '.restore-pending', 'data', '.computer')));
  });
});

test("the off-site backup's state is kept across a restart, and the account's old backups go once its data is off-site (ADR 158)", async (t) => {
  const os = require('os');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-backup-'));
  const dataDir = path.join(top, 'data');
  fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
  const saved = process.env.BOT_DOT_VAULT_KEY_FILE;
  process.env.BOT_DOT_VAULT_KEY_FILE = path.join(top, 'config', 'vault.key');
  t.after(() => {
    if (saved === undefined) delete process.env.BOT_DOT_VAULT_KEY_FILE; else process.env.BOT_DOT_VAULT_KEY_FILE = saved;
    fs.rmSync(top, { recursive: true, force: true });
  });
  for (const n of ['bot-dot-20261101-030000.bdb', 'bot-dot-20261102-030000.bdb', 'replaced-20261020000000']) fs.writeFileSync(path.join(dataDir, 'backups', n), 'x');
  fs.mkdirSync(path.join(top, 'config'));
  fs.writeFileSync(path.join(top, 'config', 'backup.key'), '{}');
  const make = () => require('../lib/backup').create({ dataDir, memory: {} });
  const first = make();
  assert.throws(() => first.offsite({ state: 'gone' }), /off, backing-up, done or failed/);
  assert.deepEqual(first.offsite({ state: 'off', lastSuccess: '2026-11-05T02:10:00Z', late: true }), { state: 'off', lastSuccess: null, late: false });
  first.offsite({ state: 'done', lastSuccess: null });
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).filter((n) => n.endsWith('.bdb')).length, 2, 'kept while no off-site copy holds the account');
  assert.deepEqual(first.offsite({ state: 'failed', lastSuccess: '2026-11-05T02:10:00Z', late: true }), { state: 'failed', lastSuccess: '2026-11-05T02:10:00.000Z', late: true });
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'backups')).sort(), ['replaced-20261020000000', 'state.json'], 'gone once it is off-site; what a restore replaced stays');
  assert.ok(!fs.existsSync(path.join(top, 'config', 'backup.key')));
  assert.deepEqual(make().status().offsite, { state: 'failed', lastSuccess: '2026-11-05T02:10:00.000Z', late: true }, 'after a restart');
});
