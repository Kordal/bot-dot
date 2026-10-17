// Backups: everything in the data folder plus the vault's key, in one encrypted file.
//
// One account's (ADR 028): each account's botdot server has a data folder and a vault key of its own, so its backup
// holds that account alone, and the manifest names it. It restores into whichever account uploads it.
//
// Nightly at 03:00 (local time) and on request, into data/backups (the last KEEP are kept). The file
// is encrypted with a key made from the owner's backup passphrase, so a downloaded copy is useless
// without it. Left out: the Claude and Bitwarden sign-ins (done again after a restore), the bots'
// computers (rebuilt on first use), downloaded models, throwaway per-run files, and the bots' installed
// tools: tools.json, the list of them, is carried, and botdot installs them again from it (ADR 007).
//
// File: MAGIC | salt (16) | iv (12) | AES-256-GCM( gzip( entries ) ) | tag (16)
// Entries: a 4-byte length + a JSON header, then the file's bytes. The first is the manifest.
//
// Restoring unpacks into data/.restore-pending and restarts; on the next start, before anything opens
// the data folder, applyPendingRestore() moves the current data to data/backups/replaced-<time> and
// puts the backup's in its place.
const fs = require('./principal-fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');
const vault = require('./vault');

const MAGIC = Buffer.from('BDBACKUP2\n');
const OLD_MAGIC = Buffer.from('BDBACKUP1\n');
const KEEP = 7;
const NAME_RE = /^bot-dot-\d{8}-\d{4,6}\.bdb$/;
const SKIP_TOP = new Set(['audit.log', 'backups', '.restore-pending', 'run-config', 'skill-packs', 'tools', 'models', 'bitwarden-cli', 'memory.db', 'memory.db-wal', 'memory.db-shm', '.spare']);
// .spare: an account's room for a full disk (lib/disk-space.js), which botdot makes again by itself.
const SKIP_NAMES = new Set(['.credentials.json']); // a Claude sign-in, wherever it is
const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

const deriveKey = (passphrase, salt, legacy = false) => crypto.scryptSync(String(passphrase), salt, 32, { ...SCRYPT, N: legacy ? 1 << 15 : SCRYPT.N });
const pendingDir = (dataDir) => path.join(dataDir, '.restore-pending');

function create({ dataDir, memory, revision, account = null, audit = () => {} }) {
  const DIR = path.join(dataDir, 'backups');
  const KEY_FILE = path.join(vault.keyDir(), 'backup.key'); // next to the vault's key, outside the data
  let state = { running: false, error: null, lastError: null };

  const readKey = () => { try { const k = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); return { salt: Buffer.from(k.salt, 'hex'), key: Buffer.from(k.key, 'hex'), legacy: !k.N || k.N === 1 << 15 }; } catch { return null; } };

  function setPassphrase(passphrase) {
    passphrase = String(passphrase || '');
    if (passphrase.length < 12) throw new Error('Use at least 12 characters.');
    const salt = crypto.randomBytes(16);
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY_FILE, JSON.stringify({ N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('hex'), key: deriveKey(passphrase, salt).toString('hex') }), { mode: 0o600 });
  }

  function list() {
    let names = [];
    try { names = fs.readdirSync(DIR).filter((n) => NAME_RE.test(n)); } catch { /* none yet */ }
    return names.sort().reverse().map((name) => {
      const st = fs.statSync(path.join(DIR, name));
      return { name, size: st.size, at: st.mtime.toISOString() };
    });
  }

  // Every file to back up, as paths relative to the data folder.
  function* files(rel = '') {
    for (const e of fs.readdirSync(path.join(dataDir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if ((!rel && SKIP_TOP.has(e.name)) || SKIP_NAMES.has(e.name)) continue;
      if (e.isDirectory()) { yield { p, dir: true }; yield* files(p); } else if (e.isFile()) yield { p };
    }
  }

  async function* entries(snapshotFile) {
    const header = (h) => { const j = Buffer.from(JSON.stringify(h)); const n = Buffer.alloc(4); n.writeUInt32BE(j.length); return Buffer.concat([n, j]); };
    yield header({ manifest: true, kind: 'bot-dot-backup', version: 1, createdAt: new Date().toISOString(), revision: revision || null, account: account || null, vaultKey: vault.keyHex() });
    const add = async function* (abs, p) {
      let st;
      try { st = fs.statSync(abs); } catch { return; } // gone meanwhile
      yield header({ p, size: st.size, mode: st.mode & 0o7777, uid: st.uid, gid: st.gid });
      let sent = 0;
      for await (const chunk of fs.createReadStream(abs, { end: Math.max(0, st.size - 1) })) {
        const part = st.size ? chunk.subarray(0, st.size - sent) : Buffer.alloc(0);
        sent += part.length;
        yield part;
        if (sent >= st.size) break;
      }
      if (sent < st.size) yield Buffer.alloc(st.size - sent); // it shrank while being read: keep the format intact
    };
    for (const f of files()) {
      const abs = path.join(dataDir, f.p);
      if (f.dir) {
        const st = fs.statSync(abs);
        yield header({ p: f.p, dir: true, mode: st.mode & 0o7777, uid: st.uid, gid: st.gid });
      } else yield* add(abs, f.p);
    }
    yield* add(snapshotFile, 'memory.db');
  }

  async function run() {
    const k = readKey();
    if (!k) throw new Error('Set a backup passphrase first.');
    if (state.running) throw new Error('A backup is already being made.');
    state.running = true;
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `bot-dot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.bdb`;
    const file = path.join(DIR, name);
    const tmp = `${file}.part`;
    const snap = path.join(DIR, `.memory-${process.pid}.db`);
    try {
      fs.rmSync(snap, { force: true });
      memory.snapshot(snap);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', k.key, iv);
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      out.write(Buffer.concat([k.legacy ? OLD_MAGIC : MAGIC, k.salt, iv]));
      await pipeline(Readable.from(entries(snap)), zlib.createGzip({ level: 6 }), cipher, out, { end: false });
      await new Promise((res, rej) => out.end(cipher.getAuthTag(), (e) => (e ? rej(e) : res())));
      fs.renameSync(tmp, file);
      for (const old of list().slice(KEEP)) fs.rmSync(path.join(DIR, old.name), { force: true });
      state.error = null;
      audit('backup.created', 'owner');
      return list()[0];
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      state.error = e.message;
      throw e;
    } finally {
      fs.rmSync(snap, { force: true });
      state.running = false;
    }
  }

  // Unpack a backup into data/.restore-pending (checking the passphrase), for the next start.
  async function stage(file, passphrase) {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(MAGIC.length + 28);
    fs.readSync(fd, head, 0, head.length, 0);
    const tag = Buffer.alloc(16);
    fs.readSync(fd, tag, 0, 16, size - 16);
    fs.closeSync(fd);
    if (size < head.length + 16 || ![MAGIC, OLD_MAGIC].some((m) => head.subarray(0, m.length).equals(m))) throw new Error("That isn't a botdot backup.");
    const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
    const iv = head.subarray(MAGIC.length + 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt, head.subarray(0, OLD_MAGIC.length).equals(OLD_MAGIC)), iv);
    decipher.setAuthTag(tag);

    const dest = pendingDir(dataDir);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.join(dest, 'data'), { recursive: true, mode: 0o700 });
    let buf = Buffer.alloc(0);
    let cur = null; // the file being written: { fd, left }
    let manifest = null;
    const safe = (p) => {
      const abs = path.resolve(dest, 'data', p);
      if (!abs.startsWith(path.join(dest, 'data') + path.sep)) throw new Error('The backup is damaged.');
      return abs;
    };
    // Archive ownership is data, never authority. Stage as the server; startup migration
    // assigns bot files from the validated identity map and strips special permission bits.
    const own = (abs, h) => fs.chmodSync(abs, Number.isInteger(h.mode) ? h.mode & 0o777 : 0o600);
    const sink = new Writable({
      write(chunk, _enc, done) {
        try {
          buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
          for (;;) {
            if (cur) {
              const n = Math.min(cur.left, buf.length);
              if (n) fs.writeSync(cur.fd, buf, 0, n);
              cur.left -= n;
              buf = buf.subarray(n);
              if (cur.left) break;
              fs.closeSync(cur.fd);
              own(cur.abs, cur.h);
              cur = null;
            }
            if (buf.length < 4) break;
            const len = buf.readUInt32BE(0);
            if (buf.length < 4 + len) break;
            const h = JSON.parse(buf.subarray(4, 4 + len).toString());
            buf = buf.subarray(4 + len);
            if (h.manifest) { manifest = h; continue; }
            const abs = safe(h.p);
            if (h.dir) { fs.mkdirSync(abs, { recursive: true }); own(abs, h); continue; }
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            cur = { fd: fs.openSync(abs, 'w', 0o600), left: h.size, abs, h };
          }
          done();
        } catch (e) { done(e); }
      },
    });
    try {
      await pipeline(fs.createReadStream(file, { start: head.length, end: size - 17 }), decipher, zlib.createGunzip(), sink);
    } catch (e) {
      if (cur) try { fs.closeSync(cur.fd); } catch { /* closed */ }
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error(/auth|unable to authenticate/i.test(e.message) ? 'Wrong passphrase, or the file is damaged.' : /header check|incorrect/i.test(e.message) ? 'Wrong passphrase, or the file is damaged.' : e.message);
    }
    if (!manifest || manifest.kind !== 'bot-dot-backup') { fs.rmSync(dest, { recursive: true, force: true }); throw new Error("That isn't a botdot backup."); }
    fs.writeFileSync(path.join(dest, 'vault.key'), manifest.vaultKey, { mode: 0o600 });
    let bots = 0;
    try { bots = JSON.parse(fs.readFileSync(path.join(dest, 'data', 'bots.json'), 'utf8')).length; } catch { /* none */ }
    fs.writeFileSync(path.join(dest, 'ready.json'), JSON.stringify({ createdAt: manifest.createdAt, bots }));
    return { createdAt: manifest.createdAt, bots, account: typeof manifest.account === 'string' ? manifest.account : null };
  }

  function status() {
    const all = list();
    return { configured: !!readKey(), running: state.running, error: state.error, last: all[0] || null, count: all.length, keep: KEEP };
  }

  // Nightly, at 03:00 local time, once a day (also after a night the server was down).
  function start() {
    const tick = () => {
      if (!readKey() || state.running) return;
      const due = new Date();
      due.setHours(3, 0, 0, 0);
      if (Date.now() < due.getTime()) return;
      const last = list()[0];
      if (last && Date.parse(last.at) >= due.getTime()) return;
      run().then((b) => console.log(`[backup] ${b.name}`)).catch((e) => console.error(`[backup] ${e.message}`));
    };
    setTimeout(tick, 30_000).unref();
    setInterval(tick, 10 * 60_000).unref();
  }

  return { status, list, run, stage, setPassphrase, start, dir: DIR, isName: (n) => NAME_RE.test(n) };
}

// On start, before the data folder is opened: put a staged restore in place. The data it replaces is
// kept in data/backups/replaced-<time>, so nothing is lost.
function applyPendingRestore(dataDir) {
  const dest = pendingDir(dataDir);
  if (!fs.existsSync(path.join(dest, 'ready.json'))) return false;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const keep = path.join(dataDir, 'backups', `replaced-${stamp}`);
  fs.mkdirSync(keep, { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(dataDir)) {
    // tools: the tools user's folder, which the server may not move; the next start makes it match the restored list.
    if (name === 'audit.log' || name === 'backups' || name === '.restore-pending' || name === 'tools') continue;
    fs.renameSync(path.join(dataDir, name), path.join(keep, name));
  }
  const from = path.join(dest, 'data');
  for (const name of fs.readdirSync(from).filter((name) => name !== 'audit.log' && name !== 'tools')) fs.renameSync(path.join(from, name), path.join(dataDir, name));
  vault.saveKey(fs.readFileSync(path.join(dest, 'vault.key'), 'utf8').trim());
  fs.rmSync(dest, { recursive: true, force: true });
  console.log(`[backup] restored; the data it replaced is in ${keep}`);
  return true;
}

module.exports = { create, applyPendingRestore };
