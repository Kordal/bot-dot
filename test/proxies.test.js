// The account's proxies (ADR 171): kept with the password encrypted and never handed out, the account's one and a bot's
// own choice, the Chief's part, and the test through a stand-in SOCKS5 and HTTP proxy to a stand-in address service.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

process.env.BOT_DOT_VAULT_KEY ||= crypto.randomBytes(32).toString('hex');
const proxiesLib = require('../lib/proxies');
const { check } = require('../lib/proxy-check');
const { startServer, makeBot } = require('./helpers');

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-proxies-'));

test('a pasted address fills the form, and a proxy keeps its password encrypted and to itself', () => {
  assert.deepEqual(proxiesLib.parsed({ host: 'socks5://kordal:p%40ss@pl.example.com:1080' }), { host: 'pl.example.com', type: 'socks5', port: 1080, username: 'kordal', password: 'p@ss' });
  assert.deepEqual(proxiesLib.parsed({ host: 'geo.example.com:12321:user:secret' }), { host: 'geo.example.com', port: 12321, username: 'user', password: 'secret' });
  assert.deepEqual(proxiesLib.parsed({ host: 'http://10.0.0.2:3128' }), { host: '10.0.0.2', type: 'http', port: 3128 });
  assert.throws(() => proxiesLib.checked({ host: 'x.example', port: 0 }), /port/);
  assert.throws(() => proxiesLib.checked({ host: 'bad host', port: 80 }), /host/);
  assert.throws(() => proxiesLib.checked({ host: 'x.example', port: 80, type: 'ftp' }), /socks5 or http/);
  assert.equal(proxiesLib.cleanRef('none'), 'none');
  assert.equal(proxiesLib.cleanRef('a1b2c3d4'), 'a1b2c3d4');
  assert.equal(proxiesLib.cleanRef('../x'), '');

  const dir = scratch();
  try {
    const store = proxiesLib.create(dir);
    const p = store.add({ name: 'PL', host: 'socks5://kordal:s3cret@pl.example.com:1080' });
    assert.deepEqual(Object.keys(p).sort(), ['createdAt', 'hasPassword', 'host', 'id', 'name', 'port', 'type', 'updatedAt', 'username']);
    assert.equal(p.hasPassword, true);
    const file = fs.readFileSync(path.join(dir, 'proxies.json'), 'utf8');
    assert.ok(!file.includes('s3cret'), 'the password is not in the file as it is');
    assert.equal((fs.statSync(path.join(dir, 'proxies.json')).mode & 0o777).toString(8), '600');
    assert.equal(store.forBridge(p.id).password, 's3cret');
    store.update(p.id, { name: 'PL 2', password: '' });
    assert.equal(store.forBridge(p.id).password, 's3cret', 'an empty password keeps the saved one');
    assert.equal(store.draft({ name: 'x' }, p.id).password, 's3cret', 'a test of the form uses the saved one');
    assert.equal(store.draft({ username: 'other' }, p.id).password, '', 'but not for another login');
    store.update(p.id, { username: '' });
    assert.equal(store.get(p.id).hasPassword, false, 'no login, no password');
    assert.equal(store.remove(p.id), true);
    assert.deepEqual(store.list(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A stand-in SOCKS5 proxy with one login, and an HTTP proxy with the same, that reach `to` whatever they are asked for.
function standIns(to) {
  const asked = [];
  const relay = (client) => { const up = net.connect(to); up.on('error', () => client.destroy()); client.on('error', () => up.destroy()); client.pipe(up).pipe(client); };
  const socks = net.createServer((c) => {
    let stage = 0;
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2 + buf[1]) { buf = buf.subarray(2 + buf[1]); c.write(Buffer.from([5, 2])); stage = 1; }
      if (stage === 1 && buf.length >= 2 && buf.length >= 3 + buf[1] && buf.length >= 3 + buf[1] + buf[2 + buf[1]]) {
        const user = buf.subarray(2, 2 + buf[1]).toString();
        const word = buf.subarray(3 + buf[1], 3 + buf[1] + buf[2 + buf[1]]).toString();
        buf = buf.subarray(3 + buf[1] + buf[2 + buf[1]]);
        if (user !== 'kordal' || word !== 's3cret') { c.end(Buffer.from([1, 1])); return; }
        c.write(Buffer.from([1, 0]));
        stage = 2;
      }
      if (stage === 2 && buf.length >= 5 && buf.length >= 7 + buf[4]) {
        asked.push(['socks', buf[3], buf.subarray(5, 5 + buf[4]).toString(), buf.readUInt16BE(5 + buf[4])]);
        c.off('data', onData);
        c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        relay(c);
      }
    };
    c.on('data', onData);
  });
  const http = net.createServer((c) => {
    let head = '';
    const onData = (d) => {
      head += d.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      c.off('data', onData);
      asked.push(['http', head.split(' ')[1]]);
      if (!head.includes(`Proxy-Authorization: Basic ${Buffer.from('kordal:s3cret').toString('base64')}`)) { c.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }
      c.write('HTTP/1.1 200 Connection established\r\n\r\n');
      relay(c);
    };
    c.on('data', onData);
  });
  return { socks, http, asked };
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

function selfSigned(dir) {
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=ipinfo.test', '-addext', 'subjectAltName=DNS:ipinfo.test'], { stdio: 'ignore' });
    return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
  } catch { return null; }
}

test('a test goes through the proxy with its login, the site\'s name resolved there, and says where it comes out', async (t) => {
  const dir = scratch();
  const pem = selfSigned(dir);
  if (!pem) { t.skip('no openssl'); fs.rmSync(dir, { recursive: true, force: true }); return; }
  const site = tls.createServer(pem, (s) => s.once('data', () => s.end('HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"ip":"198.51.100.9","city":"Warsaw","country":"PL"}')));
  const sitePort = await listen(site);
  const { socks, http, asked } = standIns({ host: '127.0.0.1', port: sitePort });
  const [socksPort, httpPort] = [await listen(socks), await listen(http)];
  const opts = { site: 'ipinfo.test', sitePort: 443, ca: pem.cert, seconds: 5 };
  try {
    const viaSocks = await check({ type: 'socks5', host: '127.0.0.1', port: socksPort, username: 'kordal', password: 's3cret' }, opts);
    assert.deepEqual({ ...viaSocks, ms: typeof viaSocks.ms }, { ok: true, ip: '198.51.100.9', country: 'PL', city: 'Warsaw', ms: 'number' });
    assert.deepEqual(asked.at(-1), ['socks', 3, 'ipinfo.test', 443], 'the name goes to the proxy');
    assert.deepEqual(await check({ type: 'socks5', host: '127.0.0.1', port: socksPort, username: 'kordal', password: 'nope' }, opts), { ok: false, error: 'refused the login' });
    const viaHttp = await check({ type: 'http', host: '127.0.0.1', port: httpPort, username: 'kordal', password: 's3cret' }, opts);
    assert.equal(viaHttp.ok, true);
    assert.deepEqual(asked.at(-1), ['http', 'ipinfo.test:443']);
    assert.deepEqual(await check({ type: 'http', host: '127.0.0.1', port: httpPort, username: '', password: '' }, opts), { ok: false, error: 'refused the login' });
    const closed = net.createServer();
    const dead = await listen(closed);
    closed.close();
    assert.match((await check({ type: 'socks5', host: '127.0.0.1', port: dead, username: '', password: '' }, opts)).error, /^didn't answer/);
  } finally {
    for (const s of [site, socks, http]) s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the owner keeps the proxies, the account\'s and each bot\'s choice; the Chief reads and picks but never adds', async () => {
  const srv = await startServer();
  try {
    assert.ok((await srv.api('/features')).data.features?.includes('proxies') ?? true);
    const added = await srv.api('/proxies', { method: 'POST', body: { name: 'PL', type: 'socks5', host: 'pl.example.com', port: 1080, username: 'kordal', password: 's3cret' } });
    assert.equal(added.status, 201);
    const id = added.data.proxy.id;
    const list = await srv.api('/proxies');
    assert.equal(list.data.default, '');
    assert.equal(list.data.proxies[0].hasPassword, true);
    assert.ok(!JSON.stringify(list.data).includes('s3cret'), 'the API never hands out the password');
    assert.equal((await srv.api('/proxies', { method: 'POST', body: { host: 'x', port: 99999 } })).status, 400);

    assert.equal((await srv.asChief('/proxies', { method: 'POST', body: { host: 'x.example', port: 80 } })).status, 403);
    assert.equal((await srv.asChief(`/proxies/${id}`, { method: 'PUT', body: { name: 'Mine' } })).status, 403);
    assert.equal((await srv.asChief(`/proxies/${id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await srv.asChief('/proxies')).status, 200);
    assert.equal((await srv.asChief('/proxies/default', { method: 'PUT', body: { proxy: id } })).data.default, id);
    assert.equal((await srv.api('/settings')).data.settings.proxy, id);
    assert.equal((await srv.api('/proxies/default', { method: 'PUT', body: { proxy: 'deadbeef' } })).status, 404);

    const bot = await makeBot(srv, { name: 'Hunter' });
    assert.equal(bot.proxy, '', 'a bot uses the account\'s');
    assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { proxy: 'none' } })).data.proxy ?? (await srv.api('/bots')).data.find((b) => b.id === bot.id).proxy, 'none');
    assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { proxy: 'deadbeef' } })).status, 400);
    await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { proxy: id } });
    assert.equal((await srv.api('/bots')).data.find((b) => b.id === bot.id).proxy, id);

    const gone = await srv.api(`/proxies/${id}`, { method: 'DELETE' });
    assert.deepEqual(gone.data, { proxies: [], default: '' }, 'removed, and the account goes back to none');
    assert.equal((await srv.api('/bots')).data.find((b) => b.id === bot.id).proxy, '', 'and its bots to the account\'s');
  } finally { await srv.stop(); }
});
