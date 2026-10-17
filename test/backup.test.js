// Backups (lib/backup.js): encrypted, the last 7 kept, and a restore into a fresh install.
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

test('off until a passphrase is set', async () => {
  assert.equal((await a.api('/backups')).data.configured, false);
  assert.match((await a.api('/backups/now', { method: 'POST' })).data.error, /passphrase first/);
  assert.match((await a.api('/backups/passphrase', { method: 'PUT', body: { passphrase: 'short' } })).data.error, /12 characters/);
  assert.match((await a.api('/backups/passphrase', { method: 'PUT', body: { passphrase: '12345678901' } })).data.error, /12 characters/);
  assert.equal((await a.api('/backups/passphrase', { method: 'PUT', body: { passphrase: '123456789012' } })).status, 200);
  const config = JSON.parse(fs.readFileSync(path.join(a.dir, 'config', 'backup.key'), 'utf8'));
  assert.deepEqual({ N: config.N, r: config.r, p: config.p }, { N: 131072, r: 8, p: 1 });
  assert.equal((await a.api('/backups/passphrase', { method: 'PUT', body: { passphrase: PASS } })).data.configured, true);
  const key = fs.readFileSync(path.join(a.dir, 'config', 'backup.key'), 'utf8');
  assert.ok(!key.includes('horse'), 'only a key made from the passphrase is stored');
});

let bot, group;
test('a backup is encrypted, small, and downloads as is; the last 7 are kept', async () => {
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
  assert.deepEqual((await a.api('/settings/writing-first', { method: 'PUT', body: { perDay: 2 } })).data.writingFirst, { perDay: 2, sentToday: 0 });
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

  const r = await a.api('/backups/now', { method: 'POST' });
  assert.equal(r.data.count, 1);
  const raw = fs.readFileSync(path.join(a.data, 'backups', r.data.last.name));
  for (const plain of ['Warsaw', 'Home Keeper', 'milk', 's3cret']) assert.ok(!raw.includes(plain), `no "${plain}" in the file`);
  assert.ok(raw.length < 300_000, 'the model and the spare are left out');
  const dl = await a.api(`/backups/${r.data.last.name}`);
  assert.equal(Buffer.compare(dl.data, raw), 0);
  for (let i = 0; i < 7; i++) { await sleep(1050); await a.api('/backups/now', { method: 'POST' }); }
  const s = (await a.api('/backups')).data;
  assert.equal(s.count, 7);
  assert.ok(!fs.existsSync(path.join(a.data, 'backups', r.data.last.name)), 'the oldest is gone');
});

test('restore into a fresh install brings everything back', async () => {
  const newest = (await a.api('/backups')).data.last.name;
  b = await startServer();
  const up = await b.api('/backups/upload', { method: 'POST', raw: fs.readFileSync(path.join(a.data, 'backups', newest)) });
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
  assert.deepEqual((await b.api('/group-chats')).data, [group], 'the group came along, with its members and its place');
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
  const up = await b.api('/backups/upload', { method: 'POST', raw: fs.readFileSync(path.join(a.data, 'backups', (await a.api('/backups')).data.last.name)) });
  const r = await b.api('/backups/restore', { method: 'POST', body: { file: up.data.file, passphrase: PASS } });
  assert.equal(r.status, 409);
  b.unhold();
});


test('oversized backup upload is refused without creating a temporary file', async () => {
  const http = require('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: a.port, path: '/api/backups/upload', method: 'POST', headers: { 'X-Bot-Dot': '1', 'Content-Length': String(256 * 1024 * 1024 + 1) } }, (res) => { res.resume(); resolve(res.statusCode); req.destroy(); });
    req.on('error', reject); req.flushHeaders();
  });
  assert.equal(status, 413);
  assert.ok(!fs.readdirSync(path.join(a.data, 'backups')).some((name) => name.startsWith('upload-')));
});

// 257 MB go through the stand-in front door to reach the 256 MB limit: on a busy machine (a CI runner) that
// takes longer than 20 s.
test('chunked backup uploads enforce the size limit and aborted uploads leave no temporary file', { timeout: 60000 }, async (t) => {
  const http = require('node:http');
  const { once } = require('node:events');
  const srv = await startServer();
  t.after(() => srv.stop());
  const uploads = () => fs.readdirSync(path.join(srv.data, 'backups')).filter((name) => name.startsWith('upload-'));
  let req;
  const response = new Promise((resolve, reject) => {
    req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/backups/upload', method: 'POST', headers: { 'X-Bot-Dot': '1' } }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
  const chunk = Buffer.alloc(1024 * 1024);
  for (let n = 0; n < 257; n++) if (!req.write(chunk)) await once(req, 'drain');
  req.end();
  assert.equal(await response, 413);
  assert.deepEqual(uploads(), []);
  const aborted = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/backups/upload', method: 'POST', headers: { 'X-Bot-Dot': '1' } });
  aborted.on('error', () => {});
  t.after(() => aborted.destroy());
  aborted.write('partial backup');
  await waitFor(() => uploads().length === 1, { what: 'partial backup file' });
  aborted.destroy();
  await waitFor(() => uploads().length === 0, { what: 'aborted backup cleanup' });
  assert.equal((await srv.api('/version')).status, 200);
});

test('an existing legacy backup key still creates backups that its old passphrase can restore', async () => {
  const crypto = require('node:crypto');
  const legacy = await startServer();
  try {
    const salt = Buffer.alloc(16, 7);
    const key = crypto.scryptSync('old password', salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    fs.mkdirSync(path.join(legacy.dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(legacy.dir, 'config', 'backup.key'), JSON.stringify({ salt: salt.toString('hex'), key: key.toString('hex') }));
    const made = await legacy.api('/backups/now', { method: 'POST' });
    assert.equal(made.status, 200);
    const restored = await legacy.api('/backups/restore', { method: 'POST', body: { file: made.data.last.name, passphrase: 'old password' } });
    assert.equal(restored.status, 200);
  } finally { await legacy.stop(); }
});
