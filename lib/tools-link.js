// A tool from a link (ADR 007, "A tool from a link"): one file over https, pinned by its sha256. The installer
// (tools-worker.js) uses this as the tools user: it downloads the file, hashes it, looks at what it is and
// writes its files. Nothing here starts a program, and nothing from the file is ever run.
//
// What botdot places: one program file for this server's processor, or a .tar.gz or .zip that holds the named
// command as a regular file. An archive is a stranger's: every path in it is checked before anything is
// written, and a link, a special file, a path that leaves the folder or a huge expansion refuses the whole file.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { once } = require('node:events');

const MAX_DOWNLOAD = 200 * 1024 * 1024; // one release file
const MAX_UNPACKED = 1024 * 1024 * 1024; // what an archive may become
const MAX_ENTRIES = 20_000;
const MAX_REDIRECTS = 5;
const DOWNLOAD_MS = 10 * 60_000;
const IDLE_MS = 30_000;
const META_MAX = 1024 * 1024; // a long name or an extended header of a tar entry
const HEAD = 64; // the first bytes of a file say what it is

// e_machine of an ELF file, and the one this server starts.
const MACHINES = { 62: 'x86-64 (amd64)', 183: 'arm64 (aarch64)', 3: 'x86 (32-bit)', 40: 'arm (32-bit)' };
const MACHINE = { x64: 62, arm64: 183 }[process.arch];
const PROCESSOR = MACHINES[MACHINE] || process.arch;

// A refusal, with one of the installer's four causes (checksum, network, disk, other).
const no = (message, cause = 'other') => Object.assign(new Error(message), { cause });
const mine = (e) => typeof e?.cause === 'string';
// Anything else that went wrong, as a refusal the owner can read.
const refused = (e, said) => (mine(e) ? e : e?.code === 'ENOSPC' ? no('The disk is full.', 'disk') : e?.code === 'EEXIST' ? no(TWICE) : no(said));
const megabytes = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

// ---------- the address ----------

const NOT_A_LINK = 'That is not a link botdot can use. Give the https address of the release file itself.';
// What a file's name already says botdot does not place; what the file holds is checked as well (kindOf).
const BY_NAME = [
  [/\.(deb|rpm)$/i, 'is a system package. botdot installs no system packages: give the link to the program itself, or to a .tar.gz or .zip that holds it.'],
  [/\.(sh|bash|ps1|bat|cmd)$/i, 'is a script. botdot runs no installer script: give the link to the program itself, or to a .tar.gz or .zip that holds it.'],
  [/\.(tar\.(xz|bz2|zst|lz)|txz|tbz2?|7z|rar|xz|bz2|zst)$/i, 'is packed in a way botdot does not unpack: it takes one program file, a .tar.gz or a .zip.'],
  [/\.(exe|msi|dmg|pkg)$/i, 'is not a program for Linux, which is what the botdot server runs.'],
];

// A name that can be shown as it is: no line break or other control character, nothing that changes the
// direction or the look of the text around it, and no "/" that would read as more of the path.
const plain = (name) => !/[\p{C}\p{Zl}\p{Zp}/\\]/u.test(name);

// The parts of a link the card shows: where it is (host and path) and the file's name, the last part of the
// path. The name is shown decoded ("%20" as a space) only when the decoded name is plain; else as it is written.
function linkParts(url) {
  const u = new URL(url);
  const at = u.pathname.lastIndexOf('/');
  const written = u.pathname.slice(at + 1);
  let file = written;
  try { file = decodeURIComponent(written); } catch { /* shown as it is written */ }
  return { source: `${u.host}${u.pathname.slice(0, at)}`, file: plain(file) ? file : written };
}
const fileName = (url) => linkParts(url).file;

// A link as botdot takes it: https, to a file, with nothing the card would not show (a login, "?…", "#…").
function linkUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2000 || /[\s\x00-\x1f\x7f<>"`\\]/.test(value)) throw no(NOT_A_LINK);
  let u;
  try { u = new URL(value); } catch { throw no(NOT_A_LINK); }
  if (u.protocol !== 'https:') throw no('botdot installs from an https address only.');
  if (u.username || u.password) throw no('The link carries a login. botdot installs only from an address anyone can read.');
  if (u.search || u.hash || value.includes('?') || value.includes('#')) throw no('The link has a "?" or "#" part, which the card would not show. Give the address of the release file itself.');
  const file = fileName(u.href);
  if (!u.hostname || !file) throw no('The link names no file. Give the address of the release file itself.');
  // The card shows the file's name decoded: an escaped line break, "/" or direction mark in it would write the card.
  let decoded = null;
  try { decoded = decodeURIComponent(u.pathname.split('/').pop()); } catch { /* not a name that can be read */ }
  if (decoded === null || !plain(decoded)) throw no("The link's file name has characters botdot does not put on a card. Give the address of the release file itself.");
  for (const [pattern, why] of BY_NAME) if (pattern.test(file)) throw no(`${file.slice(0, 80)} ${why}`);
  return u.href;
}

// ---------- the download ----------

const tooLarge = (max) => no(`The file is larger than botdot installs from a link (${megabytes(max)}).`);
const noAnswer = (e) => no(`The link does not answer${e?.code ? ` (${String(e.code).slice(0, 60)})` : ''}.`, 'network');

// One request, over https and nothing else. ca: only the tests' own file server has one.
const request = (url, { ca, signal }) => new Promise((resolve, reject) => {
  // agent: false, so that no connection is kept open after the file: the installer ends when it is done.
  const req = https.get(url, { ca, signal, agent: false, timeout: IDLE_MS, headers: { 'User-Agent': 'botdot', Accept: '*/*', 'Accept-Encoding': 'identity' } }, resolve);
  req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
  req.on('error', reject);
});

// Download a link into a new file. Every address on the way is https; the size is limited by what arrives,
// not by what the server says. Returns the file's sha256 and size; on any failure the file is not left there.
async function download(url, dest, { ca, max = MAX_DOWNLOAD, timeout = DOWNLOAD_MS } = {}) {
  const signal = AbortSignal.timeout(timeout);
  let at = new URL(url);
  let res;
  for (let hops = 0; ; hops++) {
    if (at.protocol !== 'https:') throw no(hops ? 'The link redirects to an address that is not https.' : 'botdot installs from an https address only.');
    if (at.username || at.password) throw no('The link redirects to an address that carries a login.');
    try { res = await request(at, { ca, signal }); } catch (e) { throw noAnswer(e); }
    if (![301, 302, 303, 307, 308].includes(res.statusCode)) break;
    res.resume();
    if (hops >= MAX_REDIRECTS) throw no('The link redirects too many times.', 'network');
    const to = res.headers.location;
    try { if (typeof to !== 'string' || !to) throw new Error('nowhere'); at = new URL(to, at); } catch { throw no('The link does not answer (it redirects nowhere).', 'network'); }
  }
  if (res.statusCode !== 200) { res.resume(); throw no(`The link does not answer (HTTP ${res.statusCode}).`, 'network'); }
  if (Number(res.headers['content-length']) > max) { res.destroy(); throw tooLarge(max); }
  const hash = crypto.createHash('sha256');
  let size = 0;
  let out;
  try {
    out = fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 });
    const failed = new Promise((_, reject) => out.on('error', reject));
    failed.catch(() => {});
    for await (const chunk of res) {
      size += chunk.length;
      if (size > max) throw tooLarge(max);
      hash.update(chunk);
      if (!out.write(chunk)) await Promise.race([once(out, 'drain'), failed]);
    }
    if (!res.complete) throw noAnswer({ code: 'cut off' });
    out.end();
    await Promise.race([once(out, 'finish'), failed]);
  } catch (e) {
    res.destroy();
    out?.destroy();
    fs.rmSync(dest, { force: true });
    throw mine(e) ? e : e?.code === 'ENOSPC' ? no('The disk is full.', 'disk') : noAnswer(e);
  }
  return { sha256: hash.digest('hex'), size };
}

// ---------- what a file is ----------

function headOf(file) {
  const fd = fs.openSync(file, 'r');
  try { const head = Buffer.alloc(HEAD); return head.subarray(0, fs.readSync(fd, head, 0, HEAD, 0)); } finally { fs.closeSync(fd); }
}
const padded = (head) => Buffer.concat([head, Buffer.alloc(HEAD)]);
const isElf = (h) => h.readUInt32BE(0) === 0x7f454c46;
const isScript = (h) => h[0] === 0x23 && h[1] === 0x21; // "#!"
const OTHER_SYSTEM = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]; // programs for macOS

// One program file, or an archive botdot unpacks; everything else is refused with what it is.
function kindOf(head) {
  const h = padded(head);
  if (isElf(h)) return 'program';
  if (h[0] === 0x1f && h[1] === 0x8b) return 'tar.gz';
  if (h.readUInt32LE(0) === 0x04034b50 || h.readUInt32LE(0) === 0x06054b50) return 'zip';
  if (h.subarray(0, 8).toString('latin1') === '!<arch>\n') throw no('The file is a system package (.deb). botdot installs no system packages.');
  if (h.readUInt32BE(0) === 0xedabeedb) throw no('The file is a system package (.rpm). botdot installs no system packages.');
  if (isScript(h)) throw no('The file is a script. botdot runs no installer script, and takes a script as a tool only inside a .tar.gz or .zip.');
  if (OTHER_SYSTEM.includes(h.readUInt32BE(0)) || (h[0] === 0x4d && h[1] === 0x5a)) throw no('The file is a program for another system, not for Linux, which is what the botdot server runs.');
  if (/^\s*<(!doctype|html)/i.test(h.toString('latin1'))) throw no('The link leads to a web page, not to a file. Give the address of the release file itself.');
  throw no('The file is not a program botdot can place: it takes one program file for Linux, a .tar.gz or a .zip.');
}

// These first bytes are a program this server can start: an ELF file for its processor, or, inside an archive
// only, a script. Looked at, never started.
function program(head, { script = false, what = 'The file' } = {}) {
  const h = padded(head);
  if (isScript(h)) {
    if (script) return 'script';
    throw no(`${what} is a script, not a program.`);
  }
  if (!isElf(h)) throw no(`${what} is not a program for Linux.`);
  const le = h[5] !== 2;
  const type = le ? h.readUInt16LE(16) : h.readUInt16BE(16);
  const machine = le ? h.readUInt16LE(18) : h.readUInt16BE(18);
  if (machine !== MACHINE) throw no(`${what} is a program for ${MACHINES[machine] || 'another processor'}; this botdot server's processor is ${PROCESSOR}. Give the link to the release for ${PROCESSOR}.`);
  if (type !== 2 && type !== 3) throw no(`${what} is not a program that can be started.`);
  return 'elf';
}

// ---------- an archive ----------

const NOT_TAR = 'The file is not a .tar.gz archive botdot can read.';
const NOT_ZIP = 'The file is not a .zip archive botdot can read.';
const A_LINK = 'The archive holds a link. botdot unpacks plain files and folders only.';
const SPECIAL = 'The archive holds a special file (a device, a pipe or a socket). botdot unpacks plain files and folders only.';
const TOO_MANY = `The archive holds more than ${MAX_ENTRIES} files and folders.`;
const TWICE = 'The archive holds one path twice.';

// A path of an archive, as it is placed under the tool's own folder: relative, with no "..", nothing odd.
// '' is the folder itself ("./").
function safePath(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 || /[\x00-\x1f\x7f\\]/.test(name) || name.includes('�')) throw no('The archive holds a path botdot cannot place.');
  if (name.startsWith('/')) throw no('The archive holds an absolute path. botdot unpacks only into the tool\'s own folder.');
  const parts = name.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) throw no('The archive holds a path with "..", which leaves the tool\'s own folder.');
  if (parts.length > 40 || parts.some((part) => Buffer.byteLength(part) > 255)) throw no('The archive holds a path botdot cannot place.');
  return parts.join('/');
}

// Whatever of an entry's bytes its reader left.
const drain = async (chunks) => { for await (const chunk of chunks) void chunk; };

// A .tar.gz, entry by entry as it is unpacked: nothing is believed before it is read.
async function tarEntries(file, visit, counted) {
  const source = fs.createReadStream(file);
  const gunzip = zlib.createGunzip();
  source.on('error', (e) => gunzip.destroy(e));
  source.pipe(gunzip);
  const stream = gunzip[Symbol.asyncIterator]();
  let buf = Buffer.alloc(0);
  const more = async () => {
    const next = await stream.next();
    if (next.done) return false;
    counted(next.value.length);
    buf = buf.length ? Buffer.concat([buf, next.value]) : next.value;
    return true;
  };
  const read = async (n) => {
    while (buf.length < n) if (!(await more())) throw no(NOT_TAR);
    const out = buf.subarray(0, n);
    buf = buf.subarray(n);
    return out;
  };
  async function* body(size) {
    for (let left = size; left > 0;) {
      if (!buf.length && !(await more())) throw no(NOT_TAR);
      const chunk = buf.subarray(0, Math.min(left, buf.length));
      buf = buf.subarray(chunk.length);
      left -= chunk.length;
      yield chunk;
    }
  }
  const text = (h, at, length) => { const s = h.subarray(at, at + length); const end = s.indexOf(0); return s.subarray(0, end < 0 ? length : end).toString('utf8'); };
  const octal = (h, at, length) => {
    if (h[at] & 0x80) throw no('The archive holds a file too large for botdot.'); // a size in binary: 8 GB or more
    const s = text(h, at, length).trim();
    if (s && !/^[0-7]+$/.test(s)) throw no(NOT_TAR);
    return s ? parseInt(s, 8) : 0;
  };
  // The records of an extended header: "<length> <key>=<value>\n".
  const extended = (data) => {
    const out = {};
    for (let at = 0; at < data.length;) {
      const space = data.indexOf(32, at);
      const length = space < 0 ? NaN : Number(data.subarray(at, space).toString('latin1'));
      if (!Number.isInteger(length) || length <= space - at + 1 || at + length > data.length) throw no(NOT_TAR);
      const record = data.subarray(space + 1, at + length - 1).toString('utf8');
      const eq = record.indexOf('=');
      if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
      at += length;
    }
    return out;
  };
  try {
    let longName = null;
    let pax = {};
    for (let seen = 0; ;) {
      while (buf.length < 512 && await more()) { /* the next header */ }
      if (!buf.length) break;
      const h = await read(512);
      if (h.every((byte) => byte === 0)) break; // the end of the archive
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
      if (octal(h, 148, 8) !== sum) throw no(NOT_TAR);
      const type = String.fromCharCode(h[156] || 48);
      let size = octal(h, 124, 12);
      const pad = () => read((512 - (size % 512)) % 512);
      if ('LKxg'.includes(type)) { // a long name, or an extended header, for the entry that follows
        if (size > META_MAX) throw no(NOT_TAR);
        const parts = [];
        for await (const chunk of body(size)) parts.push(chunk);
        await pad();
        const data = Buffer.concat(parts);
        if (type === 'L') longName = text(data, 0, data.length);
        if (type === 'x') pax = extended(data);
        continue;
      }
      const prefix = text(h, 257, 6) === 'ustar' && h[262] === 0 ? text(h, 345, 155) : '';
      const name = pax.path ?? longName ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100));
      if (pax.size !== undefined) {
        if (!/^\d{1,15}$/.test(pax.size)) throw no(NOT_TAR);
        size = Number(pax.size);
      }
      const sparse = Object.keys(pax).some((key) => key.startsWith('GNU.sparse'));
      longName = null;
      pax = {};
      if (++seen > MAX_ENTRIES) throw no(TOO_MANY);
      if (type === '1' || type === '2') throw no(A_LINK);
      if (type === '3' || type === '4' || type === '6') throw no(SPECIAL);
      if (!'057'.includes(type) || sparse) throw no('The archive holds an entry botdot does not unpack.');
      const dir = type === '5' || name.endsWith('/');
      const rel = safePath(name);
      const chunks = body(size);
      if (dir) { if (rel) await visit({ path: rel, dir: true }); } else {
        if (!rel) throw no('The archive holds a path botdot cannot place.');
        await visit({ path: rel, dir: false, exec: !!(octal(h, 100, 8) & 0o111) }, chunks);
      }
      await drain(chunks);
      await pad();
    }
  } catch (e) {
    throw refused(e, NOT_TAR);
  } finally { source.destroy(); gunzip.destroy(); }
}

// A .zip, by its directory at the end. Sizes it states are not believed: what is unpacked is counted.
async function zipEntries(file, visit, counted) {
  const fd = fs.openSync(file, 'r');
  const at = (buffer, position) => { if (fs.readSync(fd, buffer, 0, buffer.length, position) !== buffer.length) throw no(NOT_ZIP); return buffer; };
  async function* body(start, packed, method) {
    if (!packed) return;
    const raw = fs.createReadStream(file, { start, end: start + packed - 1 });
    const out = method === 8 ? zlib.createInflateRaw() : raw;
    if (out !== raw) { raw.on('error', (e) => out.destroy(e)); raw.pipe(out); }
    try { for await (const chunk of out) { counted(chunk.length); yield chunk; } } finally { raw.destroy(); out.destroy(); }
  }
  try {
    const size = fs.fstatSync(fd).size;
    const tail = at(Buffer.alloc(Math.min(size, 65_557)), size - Math.min(size, 65_557));
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) throw no(NOT_ZIP);
    const count = tail.readUInt16LE(end + 10);
    const listSize = tail.readUInt32LE(end + 12);
    const listAt = tail.readUInt32LE(end + 16);
    const BIG = 'The archive is a zip64 archive, which botdot does not unpack.';
    if (count === 0xffff || listSize === 0xffffffff || listAt === 0xffffffff) throw no(BIG);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count) throw no(NOT_ZIP); // in several parts
    if (count > MAX_ENTRIES) throw no(TOO_MANY);
    if (listAt + listSize > size || listSize > 64 * 1024 * 1024) throw no(NOT_ZIP);
    const list = at(Buffer.alloc(listSize), listAt);
    for (let n = 0, p = 0; n < count; n++) {
      if (p + 46 > list.length || list.readUInt32LE(p) !== 0x02014b50) throw no(NOT_ZIP);
      const unix = list[p + 5] === 3; // made on a system whose files have a kind and a mode
      const flags = list.readUInt16LE(p + 8);
      const method = list.readUInt16LE(p + 10);
      const packed = list.readUInt32LE(p + 20);
      const full = list.readUInt32LE(p + 24);
      const nameLength = list.readUInt16LE(p + 28);
      const mode = unix ? list.readUInt32LE(p + 38) >>> 16 : 0;
      const offset = list.readUInt32LE(p + 42);
      if (p + 46 + nameLength > list.length) throw no(NOT_ZIP);
      const name = list.subarray(p + 46, p + 46 + nameLength).toString('utf8');
      p += 46 + nameLength + list.readUInt16LE(p + 30) + list.readUInt16LE(p + 32);
      if (flags & 1) throw no('The archive is encrypted.');
      if (packed === 0xffffffff || full === 0xffffffff || offset === 0xffffffff) throw no(BIG);
      const kind = mode & 0o170000;
      if (kind === 0o120000) throw no(A_LINK);
      if (kind && kind !== 0o100000 && kind !== 0o040000) throw no(SPECIAL);
      const rel = safePath(name);
      if (name.endsWith('/') || kind === 0o040000) { if (rel) await visit({ path: rel, dir: true }); continue; }
      if (!rel) throw no('The archive holds a path botdot cannot place.');
      if (method !== 0 && method !== 8) throw no('The archive is packed in a way botdot does not unpack.');
      const local = at(Buffer.alloc(30), offset);
      if (local.readUInt32LE(0) !== 0x04034b50) throw no(NOT_ZIP);
      const start = offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (start + packed > size) throw no(NOT_ZIP);
      const chunks = body(start, packed, method);
      try {
        await visit({ path: rel, dir: false, exec: !!(mode & 0o111) }, chunks);
        await drain(chunks);
      } finally { await chunks.return(); } // its streams are closed, also after a refusal
    }
  } catch (e) {
    throw refused(e, NOT_ZIP);
  } finally { fs.closeSync(fd); }
}

// Go through an archive with every check, and with `dest` write its files there (a new, empty folder of the
// tool's own). Without `dest` nothing is written: the same checks, for the ask. Returns the path of the named
// command in it: a regular file of that name that is a program for this server, the least deep one.
async function unpack(file, kind, { command, dest = null, max = MAX_UNPACKED } = {}) {
  let bytes = 0;
  const counted = (n) => { if ((bytes += n) > max) throw no(`The archive unpacks to more than botdot installs for one tool (${megabytes(max)}).`); };
  const folders = new Set();
  const files = new Set();
  // Each folder on the way is made here, one by one: none is there before, so none can be a link elsewhere.
  const folder = (rel) => {
    let at = '';
    for (const part of rel.split('/')) {
      at = at ? `${at}/${part}` : part;
      if (files.has(at)) throw no(TWICE);
      if (folders.has(at)) continue;
      if (folders.size + files.size >= MAX_ENTRIES) throw no(TOO_MANY); // a folder made on the way counts like one the archive names
      if (dest) { fs.mkdirSync(path.join(dest, at)); fs.chmodSync(path.join(dest, at), 0o755); }
      folders.add(at);
    }
  };
  const found = []; // files named as the command: { path, head }
  const programs = []; // what the archive has to run, for the reason when the command is not in it
  const visit = async (entry, chunks) => {
    if (entry.dir) return folder(entry.path);
    if (folders.has(entry.path) || files.has(entry.path)) throw no(TWICE);
    if (entry.path.includes('/')) folder(path.posix.dirname(entry.path));
    if (folders.size + files.size >= MAX_ENTRIES) throw no(TOO_MANY);
    files.add(entry.path);
    const named = path.posix.basename(entry.path) === command;
    if (entry.exec && programs.length < 6) programs.push(path.posix.basename(entry.path));
    let head = Buffer.alloc(0);
    // A new file, never through a link, and no mode of the archive's but whether it may be run.
    const fd = dest ? fs.openSync(path.join(dest, entry.path), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600) : null;
    try {
      if (fd !== null) fs.fchmodSync(fd, entry.exec ? 0o755 : 0o644);
      for await (const chunk of chunks) {
        if (named && head.length < HEAD) head = Buffer.concat([head, chunk]).subarray(0, HEAD);
        for (let done = 0; fd !== null && done < chunk.length;) done += fs.writeSync(fd, chunk, done);
      }
    } finally { if (fd !== null) fs.closeSync(fd); }
    if (named) found.push({ path: entry.path, head });
  };
  try {
    await (kind === 'zip' ? zipEntries : tarEntries)(file, visit, counted);
  } catch (e) {
    throw refused(e, kind === 'zip' ? NOT_ZIP : NOT_TAR);
  }
  if (!found.length) {
    const others = [...new Set(programs)].filter((name) => /^[\w.+-]{1,64}$/.test(name));
    throw no(`The archive holds no file named ${command}.${others.length ? ` It has: ${others.join(', ')}.` : ''} Name the command as the archive has it.`);
  }
  const usable = [];
  let why = null;
  for (const f of found) { try { program(f.head, { script: true, what: `${command} in the archive` }); usable.push(f); } catch (e) { why ||= e; } }
  if (!usable.length) throw why;
  const depth = (f) => f.path.split('/').length;
  const inBin = (f) => (path.posix.basename(path.posix.dirname(f.path)) === 'bin' ? 0 : 1);
  usable.sort((a, b) => depth(a) - depth(b) || inBin(a) - inBin(b));
  return { member: usable[0].path, files: files.size, bytes };
}

// What a downloaded file is, with every check an install makes and nothing written: for the ask.
async function inspect(file, command) {
  const head = headOf(file);
  const kind = kindOf(head);
  if (kind === 'program') { program(head); return { kind }; }
  return { kind, member: (await unpack(file, kind, { command })).member };
}

// Put a downloaded file into the tool's new folder: bin/<command> is the program itself, or a link to it
// among the archive's files under files/. The command is the tool's only one.
async function place(file, { prefix, command }) {
  const head = headOf(file);
  const kind = kindOf(head);
  try {
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true, mode: 0o755 });
    const target = path.join(prefix, 'bin', command);
    if (kind === 'program') {
      program(head);
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, 0o755);
      return { kind };
    }
    const dest = path.join(prefix, 'files');
    fs.mkdirSync(dest, { mode: 0o755 });
    const { member } = await unpack(file, kind, { command, dest });
    fs.chmodSync(path.join(dest, member), 0o755);
    fs.symlinkSync(path.join('..', 'files', member), target);
    return { kind, member };
  } catch (e) {
    throw refused(e, `The file could not be placed: ${String(e?.message).slice(0, 200)}`);
  }
}

// One value for what a tool from a link was installed from: the address, the checksum and the command.
const linkHash = ({ url, sha256, command }) => crypto.createHash('sha256').update(['link', url, sha256, command].join('\n')).digest('hex');

module.exports = { linkUrl, linkParts, fileName, download, kindOf, program, unpack, inspect, place, linkHash, safePath, PROCESSOR, MACHINE, MAX_DOWNLOAD, MAX_UNPACKED, MAX_ENTRIES };
