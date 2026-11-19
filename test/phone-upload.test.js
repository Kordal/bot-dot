// Upload from phone (ADR 165): the owner asks for a code for a place, the phone opens its page through the front door
// without a session and sends files there, which arrive as the owner's own upload of that place would: in a chat's
// message box, or in a folder of Files. A code is good for its place, ten minutes and 20 files; a wrong one is 404.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const uploads = require('../lib/uploads');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv; let bot;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Scanner' });
});
after(async () => { await srv.stop(); });

const code = async (to) => {
  const r = await srv.api('/drops', { method: 'POST', body: { to } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};
// The phone: no cookie, no X-Bot-Dot unless its page sends it, only the address in the QR code.
const phonePost = (url, name, body, headers = {}) => fetch(`${url}/files`, { method: 'POST', headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream', ...headers }, body });

test('a code for a chat: its QR code, its page, and a file the phone sends lands in the message box', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('phone-upload'));
  const d = await code(`/api/uploads?to=bot:${bot.id}`);
  assert.match(d.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(d.url, `${srv.base}/drop/${srv.account}/${d.token}`);
  assert.equal(d.reachable, false, 'the loopback is no address for a phone');
  assert.match(d.qr, /^<svg [^>]*viewBox="[^"]+"[^>]*><rect[^>]*\/><path d="M[\d hvz.M-]+" fill="#000"\/><\/svg>$/);
  assert.ok(d.open);
  assert.deepEqual(d.files, []);

  const pageRes = await fetch(d.url);
  assert.equal(pageRes.status, 200);
  const csp = pageRes.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-[^']+'/);
  const html = await pageRes.text();
  assert.match(html, /<h1>Scanner<\/h1>/);
  assert.match(html, /Choose files/);

  const r = await phonePost(d.url, 'IMG 4812.jpg', Buffer.from('a photo'));
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { name: 'IMG 4812.jpg', size: 7 });
  const seen = (await srv.api(`/drops/${d.token}`)).data;
  assert.equal(seen.files.length, 1);
  const [f] = seen.files;
  assert.equal(f.status, 'saved');
  assert.match(f.saved.file, /^uploads\/[\w-]*IMG-4812\.jpg$/);
  assert.equal(fs.readFileSync(path.join(srv.data, 'workspaces', bot.id, f.saved.file), 'utf8'), 'a photo');
});

test('a code for a folder of Files puts the file there', async () => {
  fs.mkdirSync(path.join(srv.data, 'workspaces', bot.id, 'scans'), { recursive: true });
  const d = await code(`/api/bots/${bot.id}/workspace/upload?root=server&path=scans`);
  const r = await phonePost(d.url, 'receipt.pdf', Buffer.from('%PDF-1.4'));
  assert.equal(r.status, 201);
  assert.equal(fs.readFileSync(path.join(srv.data, 'workspaces', bot.id, 'scans', 'receipt.pdf'), 'utf8'), '%PDF-1.4');
  const seen = (await srv.api(`/drops/${d.token}`)).data;
  assert.equal(seen.files[0].saved.path, 'scans/receipt.pdf');
});

test('only an upload of the owner\'s page is a place: anything else is refused', async () => {
  for (const to of ['/api/bots', `/api/bots/${bot.id}/workspace?path=x`, 'https://example.com/api/uploads?to=chief', '/api/uploads', null]) {
    const r = await srv.api('/drops', { method: 'POST', body: { to } });
    assert.equal(r.status, 400, String(to));
  }
});

test('a wrong code, an ended one, a request without its header: refused, and the phone reaches nothing else', async () => {
  const wrong = `${srv.base}/drop/${srv.account}/${'x'.repeat(32)}`;
  const page = await fetch(wrong);
  assert.equal(page.status, 404);
  assert.match(await page.text(), /This code has expired/);
  assert.equal((await phonePost(wrong, 'a.txt', 'a')).status, 404);

  const d = await code(`/api/uploads?to=bot:${bot.id}`);
  assert.equal((await phonePost(d.url, 'a.txt', 'a', { 'X-Bot-Dot': '' })).status, 403);
  assert.equal((await srv.api(`/drops/${d.token}`, { method: 'DELETE' })).status, 200);
  assert.equal((await phonePost(d.url, 'a.txt', 'a')).status, 410);
  assert.match(await (await fetch(d.url)).text(), /This code has expired/);
  // The mark is the front door's alone: a request of the owner's page that carries it is an ordinary request.
  const r = await srv.api('/bots', { headers: { 'X-Botdot-Drop': '1' } });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data));
});

test('a chat file beyond 25 MB is saved both directly and from a phone', async () => {
  const to = `/uploads?to=bot:${bot.id}`;
  const body = Buffer.alloc(25 * 1024 * 1024 + 1, 7);
  const direct = await srv.api(to, { method: 'POST', raw: body, headers: { 'X-File-Name': 'direct.bin' } });
  assert.equal(direct.status, 201, JSON.stringify(direct.data));
  assert.equal(fs.statSync(path.join(srv.data, 'workspaces', bot.id, direct.data.file)).size, body.length);

  const d = await code(`/api${to}`);
  const r = await phonePost(d.url, 'phone.bin', body);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { name: 'phone.bin', size: body.length });
});

test('a phone upload into a folder of botdot\'s Files is as large as the disk has room for', async () => {
  const body = Buffer.alloc(25 * 1024 * 1024 + 1, 3);
  const d = await code(`/api/bots/${bot.id}/workspace/upload?root=server`);
  const r = await phonePost(d.url, 'big.bin', body);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { name: 'big.bin', size: body.length });
  assert.equal(fs.statSync(path.join(srv.data, 'workspaces', bot.id, 'big.bin')).size, body.length);
  fs.rmSync(path.join(srv.data, 'workspaces', bot.id, 'big.bin'));
});

test('a phone upload into a folder of the computer over 25 MB is refused', async () => {
  const d = await code(`/api/bots/${bot.id}/workspace/upload?root=computer`);
  const r = await phonePost(d.url, 'big.bin', Buffer.alloc(25 * 1024 * 1024 + 1));
  assert.equal(r.status, 413);
  assert.deepEqual((await srv.api(`/drops/${d.token}`)).data.files, []);
});

test('a chat upload is refused before writing when the account has too little space', async () => {
  const req = new PassThrough();
  req.headers = { 'content-length': '100' };
  const workspace = path.join(srv.data, 'full-disk-test');
  await assert.rejects(uploads.save(req, workspace, 'does-not-fit.bin', { free: () => 99 }), {
    status: 507, message: 'No space left on the server.',
  });
  assert.equal(fs.existsSync(workspace), false);
  req.destroy();
});

test('disconnecting a chat upload removes the partial file', async () => {
  const dir = path.join(srv.data, 'workspaces', bot.id, 'uploads');
  const partials = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((name) => name.endsWith('.part'));
  const req = http.request(`${srv.base}/api/uploads?to=bot:${bot.id}`, {
    method: 'POST',
    headers: { 'X-Bot-Dot': '1', 'X-File-Name': 'interrupted.bin', 'Content-Length': 1024 * 1024 },
  });
  req.on('error', () => {}); // expected when we close the connection ourselves
  try {
    req.write(Buffer.alloc(65536, 3));
    await waitFor(() => partials().length === 1, { what: 'a partial upload on disk' });
  } finally { req.destroy(); }
  await waitFor(() => !partials().length, { what: 'removal of the partial upload' });
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('interrupted.bin')), false);
});
