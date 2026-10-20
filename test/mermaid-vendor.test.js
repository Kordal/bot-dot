// Mermaid on the web page (#177, ADR 041): botdot's own copy of it, in vendor/mermaid, comes from the page's own
// address, compressed like the page's files, and the page still runs only its own scripts; the frame Mermaid draws
// in loads nothing from anywhere. Nothing outside Mermaid's folder is reached through its address.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { startServer, ROOT } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const BUNDLE = path.join(ROOT, 'vendor', 'mermaid', 'mermaid.min.js');
// fetch tidies up "..", so a raw request; the body as bytes, unpacked by the test.
const raw = (p, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: srv.port, path: p, headers }, (res) => {
    const parts = [];
    res.on('data', (c) => parts.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
  });
  req.on('error', reject);
  req.end();
});

test('the copy is Mermaid 12.2.0 under its MIT licence, and NOTICE names it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor', 'mermaid', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'mermaid');
  assert.equal(pkg.version, '12.2.0');
  assert.equal(pkg.license, 'MIT');
  assert.match(fs.readFileSync(path.join(ROOT, 'vendor', 'mermaid', 'LICENSE'), 'utf8'), /^The MIT License/);
  assert.match(fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8'), /- vendor\/mermaid: Mermaid 12\.2\.0, MIT/);
  // One file that sets window.mermaid when the page adds it as a script.
  assert.match(fs.readFileSync(BUNDLE, 'utf8').slice(-200), /globalThis\["mermaid"\] = /);
});

test('the page gets Mermaid from its own address, with gzip or brotli, checked back like its own files', async () => {
  const bytes = fs.readFileSync(BUNDLE);
  const gz = await raw('/vendor/mermaid/mermaid.min.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.status, 200);
  assert.equal(gz.headers['content-type'], 'text/javascript');
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gz.headers['cache-control'], 'no-cache');
  assert.ok(gz.body.length < bytes.length / 2, `${gz.body.length} bytes sent`);
  assert.ok(zlib.gunzipSync(gz.body).equals(bytes), 'the file unchanged');
  const br = await raw('/vendor/mermaid/mermaid.min.js', { 'Accept-Encoding': 'gzip, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.ok(zlib.brotliDecompressSync(br.body).equals(bytes));
  assert.equal((await raw('/vendor/mermaid/mermaid.min.js', { 'If-None-Match': gz.headers.etag })).status, 304);
});

test("the page still runs only its own scripts: no CDN, the same policy", async () => {
  const page = await raw('/');
  assert.match(page.headers['content-security-policy'], /(^|; )script-src 'self'(;|$)/);
  assert.match(page.headers['content-security-policy'], /(^|; )connect-src 'self'(;|$)/);
});

test('the frame Mermaid draws in has a policy of its own: its own scripts and nothing from anywhere else', async () => {
  const frame = await raw('/diagram-frame.html');
  assert.equal(frame.status, 200);
  const csp = frame.headers['content-security-policy'].split('; ');
  for (const rule of ["default-src 'none'", "script-src 'self'", "img-src data:", "font-src 'self'", "frame-ancestors 'self'", "form-action 'none'"]) assert.ok(csp.includes(rule), rule);
  assert.ok(!csp.some((r) => /^connect-src|https:/.test(r)), 'it reaches no address');
  // Every other page keeps the page's policy.
  assert.match((await raw('/offline.html')).headers['content-security-policy'], /default-src 'self'/);
});

test("nothing outside Mermaid's folder through its address", async () => {
  for (const p of ['/vendor/mermaid/../../server.js', '/vendor/mermaid/%2e%2e/%2e%2e/server.js', '/vendor/mermaid/..%2f..%2fpackage.json',
    '/vendor/mermaid/', '/vendor/mermaid', '/vendor/novnc/vnc.html', '/vendor/mermaid/nope.js']) {
    const r = await raw(p);
    assert.equal(r.status, 404, `${p}: ${r.status}`);
  }
});
