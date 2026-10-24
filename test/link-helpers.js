// For the tests of a tool from a link (lib/tools-link.js): a file server of the test's own, over https on a
// free port, and the files a link can lead to, built byte by byte so that each can be made wrong in one way.
// The server's key and certificate are made anew for every run and kept nowhere; the installer is given the
// certificate through BOT_DOT_TOOLS_TEST_CA, which nothing sets in the product.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const { MACHINE } = require('../lib/tools-link');

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const OTHER_MACHINE = MACHINE === 183 ? 62 : 183;

// The start of a program for Linux (an ELF file) for a processor: this server's unless another is named.
function elf(machine = MACHINE, label = 'a program') {
  const h = Buffer.alloc(256);
  h.writeUInt32BE(0x7f454c46, 0);
  h[4] = 2; h[5] = 1; h[6] = 1; // 64-bit, little-endian
  h.writeUInt16LE(2, 16); // an executable
  h.writeUInt16LE(machine, 18);
  h.write(label, 64);
  return h;
}

// A script that says which tool it is, and leaves a line in `ran` whenever it is started.
const script = (says, ran) => `#!/bin/sh\n${ran ? `echo "${says}" >> "${ran}"\n` : ''}echo "${says} (botdot test tool)"\n`;

// One entry of a tar archive. type: '0' a file, '5' a folder, '1' a hard link, '2' a symbolic link,
// '3' '4' '6' special files, 'L' a long name and 'x' an extended header for the entry after it.
function tarEntry({ name, data = '', type = '0', mode = type === '5' ? 0o755 : 0o644, linkname = '' }) {
  const body = Buffer.from(data);
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write(linkname, 157, 100);
  h.write('ustar\0' + '00', 257, 'latin1');
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
const tar = (entries) => Buffer.concat([...entries.map(tarEntry), Buffer.alloc(1024)]);
const tarGz = (entries) => zlib.gzipSync(tar(entries));

// A .zip as a Unix zip writes it: each entry's kind and mode, compressed unless `store`. says: the size the
// archive states for a file, when it is not the true one.
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const name = Buffer.from(e.name);
    const method = e.store ? 0 : 8;
    const packed = method ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const full = e.says ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(full, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE((3 << 8) | 20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(e.flags || 0, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(full, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(((e.mode ?? (e.name.endsWith('/') ? 0o040755 : 0o100644)) << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + packed.length;
  }
  const list = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(list.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, list, end]);
}

// A key and a certificate for 127.0.0.1, signed by itself: Node makes keys and signs, but writes no certificate,
// so its few fields are put together here (DER: a tag, a length, the content).
function certificate() {
  const der = (tag, ...parts) => {
    const body = Buffer.concat(parts);
    const length = body.length < 128 ? [body.length] : body.length < 256 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 255];
    return Buffer.concat([Buffer.from([tag, ...length]), body]);
  };
  const seq = (...parts) => der(0x30, ...parts);
  const oid = (hex) => der(0x06, Buffer.from(hex, 'hex'));
  const utc = (date) => der(0x17, Buffer.from(`${date.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serial = crypto.randomBytes(8);
  serial[0] = (serial[0] & 0x7f) | 0x40; // a positive number
  const name = seq(der(0x31, seq(oid('550403'), der(0x0c, Buffer.from('botdot test file server'))))); // commonName
  const ecdsaWithSha256 = seq(oid('2a8648ce3d040302'));
  const forLocalhost = seq(oid('551d11'), der(0x04, seq(der(0x87, Buffer.from([127, 0, 0, 1]))))); // subjectAltName: this address
  const body = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), ecdsaWithSha256, name,
    seq(utc(new Date(Date.now() - 864e5)), utc(new Date(Date.now() + 864e5))), name,
    publicKey.export({ type: 'spki', format: 'der' }), der(0xa3, seq(forLocalhost)),
  );
  const signed = seq(body, ecdsaWithSha256, der(0x03, Buffer.from([0]), crypto.sign('sha256', body, privateKey)));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: `-----BEGIN CERTIFICATE-----\n${signed.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n` };
}

// The file server: put(path, body, how) gives the link. how: { redirect: an address } answers with a redirect,
// { status: 302 } with a redirect that names no address, { says: n } states n bytes and sends a few,
// { chunked: true } states no size. drop(path): the file is gone. hits: every path asked for.
// plain: a second server, over http, that only counts what reaches it (a redirect away from https must not).
// cert: the server's certificate; with `dir` it is also written there, as the file `ca`, for an installer to read.
async function fileServer({ dir = null } = {}) {
  const files = new Map();
  const hits = [];
  const { key, cert } = certificate();
  const ca = dir ? path.join(dir, 'file-server.pem') : null;
  if (ca) fs.writeFileSync(ca, cert, { mode: 0o644 });
  const server = https.createServer({ key, cert }, (req, res) => {
    hits.push(req.url);
    const f = files.get(req.url);
    if (!f) { res.writeHead(404); return res.end('Not found'); }
    if (f.redirect) { res.writeHead(302, { Location: f.redirect }); return res.end(); }
    if (f.status) { res.writeHead(f.status); return res.end(); }
    if (f.says) { res.writeHead(200, { 'Content-Length': String(f.says) }); return res.write(f.body.subarray(0, 16)); }
    if (f.chunked) { res.writeHead(200); res.write(f.body.subarray(0, 1)); return res.end(f.body.subarray(1)); }
    res.writeHead(200, { 'Content-Length': String(f.body.length) });
    res.end(f.body);
  });
  const plainHits = [];
  const plain = http.createServer((req, res) => { plainHits.push(req.url); res.end(elf()); });
  await Promise.all([server, plain].map((s) => new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))));
  const origin = `https://127.0.0.1:${server.address().port}`;
  return {
    origin, host: `127.0.0.1:${server.address().port}`, hits, plainHits, cert, ca,
    plain: `http://127.0.0.1:${plain.address().port}`,
    put(at, body, how = {}) { files.set(at, { body: Buffer.from(body || ''), ...how }); return `${origin}${at}`; },
    drop: (at) => files.delete(at),
    asked: (at) => hits.filter((url) => url === at).length,
    close() { for (const s of [server, plain]) { s.closeAllConnections(); s.close(); } },
  };
}

module.exports = { certificate, sha, elf, script, tar, tarGz, tarEntry, zip, fileServer, MACHINE, OTHER_MACHINE };
