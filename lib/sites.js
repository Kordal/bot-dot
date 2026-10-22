// Interactive pages (#399, ADR 072): a bot's static site, built on its computer and published with
// publish_interactive_page, kept here as versions of a page (lib/pages.js holds what the page is). It is never served on
// botdot's own address: the front door serves it on an address of its own (FRONT_DOOR_SITES_ORIGIN), with a short-lived
// signed address made here for the owner alone, and every answer there sandboxed (front-door.js, sitesAnswer).
//
// This file: the checks of a bundle (what it may hold, how big), reading the folder the computer sends (a tar),
// keeping its versions on disk, the signed addresses, the answer to the front door's request for one file, and the
// download (a zip).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MAX_BYTES = 5 * 1024 * 1024; // a whole version
const MAX_FILES = 300;
const PATH_MAX = 200;
const VERSIONS_KEPT = 10; // older versions go from the disk, newest kept
const PAGES_MAX = 20; // interactive pages a bot keeps, each with its last VERSIONS_KEPT versions
const TOKEN_MS = 12 * 3_600_000; // how long a frame's address works (an open page loads its files later too); each opening of the page gets a new one
const TILES_MAX = 20; // tiles whose values a page is handed

// What a bundle may hold, by extension, and what each is served as. Nothing that runs outside the page's own sandbox
// (no wasm: the sandbox's rules give it no 'wasm-unsafe-eval').
const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json', map: 'application/json', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};
const extOf = (p) => (p.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const SEGMENT = /^[A-Za-z0-9_@+-][A-Za-z0-9._@+-]{0,99}$/; // no dot files, no spaces, nothing a shell or an address would read twice

const refused = (message, status = 400) => Object.assign(new Error(message), { status });

// A file's path in a bundle, "assets/index-3f2a.js", or null when it is not one a bundle may hold.
function cleanPath(p) {
  const s = String(p ?? '').replace(/^\.\//, '');
  if (!s || s.length > PATH_MAX || s.includes('\\')) return null;
  const parts = s.split('/');
  if (parts.length > 8 || !parts.every((x) => SEGMENT.test(x))) return null;
  return s;
}

// The files of a tar (ustar, as `tar --format=ustar` writes it): [{ path, data }], folders left out. A link or any
// other kind of entry refuses the whole folder, so nothing is ever followed out of it.
function untar(buf) {
  const files = [];
  let ended = false;
  const field = (h, at, len) => h.subarray(at, at + len).toString('utf8').replace(/\0.*$/s, '');
  for (let at = 0; at + 512 <= buf.length;) {
    const h = buf.subarray(at, at + 512);
    if (h.every((b) => b === 0)) { ended = true; break; }
    const name = field(h, 0, 100);
    const prefix = field(h, 345, 155);
    const size = parseInt(field(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    if (!Number.isFinite(size) || size < 0) throw refused("Couldn't read the folder from the computer.");
    const full = (prefix ? `${prefix}/${name}` : name).replace(/^\.\/?/, '').replace(/\/$/, '');
    at += 512;
    if (type === '5') { /* a folder */ } else if (type === '0' || type === '\0' || type === '7') {
      if (at + size > buf.length) throw refused("Couldn't read the folder from the computer: it came cut off.");
      files.push({ path: full, data: buf.subarray(at, at + size) });
    } else throw refused(`${full || 'An entry'} is a link or a special file. A page holds plain files only: copy what it links to into the folder.`);
    at += Math.ceil(size / 512) * 512;
  }
  if (!ended) throw refused("Couldn't read the folder from the computer: it came cut off.");
  return files;
}

// A bundle checked: index.html at its top, every file of a kind a page may hold, within the limits. Returns the files,
// sorted, with their clean paths; refuses with every problem in one sentence, for the bot to fix.
function checkBundle(files) {
  if (!files.length) throw refused('The folder is empty. Build the page first, then publish its folder (with index.html at its top).');
  if (files.length > MAX_FILES) throw refused(`The folder has ${files.length} files: a page holds at most ${MAX_FILES}.`);
  const bad = [];
  const kinds = new Set();
  const out = [];
  let bytes = 0;
  for (const f of files) {
    const p = cleanPath(f.path);
    if (!p) { bad.push(f.path); continue; }
    const ext = extOf(p);
    if (!TYPES[ext]) { kinds.add(ext ? `.${ext}` : `${p} (no extension)`); continue; }
    bytes += f.data.length;
    out.push({ path: p, data: f.data });
  }
  const problems = [];
  if (bad.length) problems.push(`These names can't be served: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''} (letters, digits, . _ - @ + only, no dot files, at most 8 folders deep)`);
  if (kinds.size) problems.push(`These kinds of files are not allowed: ${[...kinds].slice(0, 8).join(', ')} (allowed: ${Object.keys(TYPES).map((e) => `.${e}`).join(' ')})`);
  if (bytes > MAX_BYTES) problems.push(`it takes ${(bytes / 1048576).toFixed(1)} MB: a page holds at most ${MAX_BYTES / 1048576} MB`);
  if (!out.some((f) => f.path === 'index.html')) problems.push('it has no index.html at its top');
  if (problems.length) throw refused(`The page wasn't published: ${problems.join('; ')}.`);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// A store-only zip of the files, for the download: what the owner opens on their own device.
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    const crc = zlib.crc32(f.data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(0, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(f.data.length, 18); head.writeUInt32LE(f.data.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    local.push(head, name, f.data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12); dir.writeUInt16LE(date, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(f.data.length, 20); dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + f.data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

// ---------- signed addresses ----------

// A frame's address names the page's bot, slug and version and when it stops working, signed with a key this server
// makes when it starts: a restart ends every address, and the apps ask for a new one each time a page opens.
const KEY = crypto.randomBytes(32);
const mac = (body) => crypto.createHmac('sha256', KEY).update(body).digest('base64url').slice(0, 32);
function sign({ botId, slug, version }, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ b: botId, s: slug, v: version, e: now + TOKEN_MS })).toString('base64url');
  return { token: `${body}.${mac(body)}`, expires: new Date(now + TOKEN_MS).toISOString() };
}
// The page a token names, or null: a token with a wrong signature, or one that ran out.
function verify(token, now = Date.now()) {
  const m = String(token || '').match(/^([A-Za-z0-9_-]{10,400})\.([A-Za-z0-9_-]{32})$/);
  if (!m) return null;
  const want = Buffer.from(mac(m[1]));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let t;
  try { t = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!t || typeof t.b !== 'string' || typeof t.s !== 'string' || !Number.isInteger(t.v) || !(t.e > now)) return null;
  return { botId: t.b, slug: t.s, version: t.v };
}

// The sandbox's address as the front door names it (x-botdot-sites): an origin of its own, never botdot's. Null when
// it names none (a front door older than #399, or a machine without the second address).
function sitesOrigin(req) {
  const v = String(req.headers['x-botdot-sites'] || '');
  return /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(v) ? v : null;
}
const frameUrl = (origin, account, token) => `${origin}/${account}/${token}/index.html`;

// ---------- versions on disk ----------

function create(dataDir) {
  const root = path.join(dataDir, 'sites');
  const versionDir = (botId, slug, n) => path.join(root, botId, slug, String(n));

  // A new version's files, written beside it and renamed into place whole.
  function write(botId, slug, n, files) {
    const dir = versionDir(botId, slug, n);
    const tmp = `${dir}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    for (const f of files) {
      const target = path.join(tmp, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.data, { flag: 'wx' });
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
  }
  const has = (botId, slug, n) => { try { return fs.statSync(path.join(versionDir(botId, slug, n), 'index.html')).isFile(); } catch { return false; } };
  // The versions kept on disk go, but those named.
  function prune(botId, slug, keep) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, botId, slug)); } catch { return; }
    for (const n of names) if (!keep.includes(Number(n))) fs.rmSync(path.join(root, botId, slug, n), { recursive: true, force: true });
  }
  const forget = (botId, slug = null) => fs.rmSync(slug ? path.join(root, botId, slug) : path.join(root, botId), { recursive: true, force: true });

  // One file of a version, by its path in the bundle ("" is index.html): { file, type } or null.
  function fileOf(botId, slug, n, rel) {
    const p = cleanPath(rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!p || !TYPES[extOf(p)]) return null;
    const file = path.join(versionDir(botId, slug, n), ...p.split('/'));
    try { if (!fs.lstatSync(file).isFile()) return null; } catch { return null; }
    return { file, type: TYPES[extOf(p)] };
  }
  // Every file of a version, for the download.
  function filesOf(botId, slug, n) {
    const dir = versionDir(botId, slug, n);
    const out = [];
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.isFile()) out.push({ path: r, data: fs.readFileSync(path.join(d, e.name)) });
      }
    };
    walk(dir, '');
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // The front door's request for one file (GET /sandbox/<token>/<path>, x-botdot-sandbox): the file, if the token is
  // good and names a version that is there. `known(botId, slug, n)`: the page and that version are still the bot's.
  // The front door adds the sandbox's rules to every answer; this one adds no cookie and nothing else of botdot's.
  function serve(req, res, known) {
    const m = String(req.url || '').split('?')[0].match(/^\/sandbox\/([^/]+)\/(.*)$/);
    const page = m && verify(m[1]);
    let rel = '';
    try { rel = m ? decodeURIComponent(m[2]) : ''; } catch { rel = '\0'; }
    const found = page && known(page.botId, page.slug, page.version) && fileOf(page.botId, page.slug, page.version, rel);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { 'Content-Type': 'text/plain' }); return res.end('Not here'); }
    if (!found) { res.writeHead(page ? 404 : 403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end(page ? 'Not found' : 'This address has run out. Open the page again in botdot.'); }
    const st = fs.statSync(found.file);
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = { 'Content-Type': found.type, 'Cache-Control': 'private, no-cache', ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    // A version pruned or a bot deleted while it is read ends this answer, never the server.
    fs.createReadStream(found.file).on('error', () => res.destroy()).pipe(res);
  }

  return { write, has, prune, forget, fileOf, filesOf, serve, versionDir };
}

module.exports = { PAGES_MAX, create, untar, checkBundle, cleanPath, zip, sign, verify, sitesOrigin, frameUrl, TYPES, MAX_BYTES, MAX_FILES, VERSIONS_KEPT, TOKEN_MS, TILES_MAX };
