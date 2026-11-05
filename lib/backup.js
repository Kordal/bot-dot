// Backups: one account's data plus the vault's key, in one encrypted file the owner downloads (a .bdb).
//
// The machine backs every account up off-site every night (ADR 157); an account keeps no backups of its own (ADR 158).
// The file the owner downloads is made when they ask (Settings → Backups → Download), encrypted with a passphrase they
// choose then, and streamed to them as it is made: it is never written here. Only a consistent copy of memory.db and
// the computer's packed workspace wait for the download, at most PREPARED_MS. The front door tells the account how its
// off-site backup went (offsite()), and status() says it.
//
// One account's (ADR 028): each account's botdot server has a data folder and a vault key of its own, so its backup
// holds that account alone, and the manifest names it. It restores into whichever account uploads it, on this machine
// or another.
//
// Left out: the Claude and Bitwarden sign-ins (done again after a restore), the bots' computers (rebuilt on first
// use), downloaded models, throwaway per-run files, any node_modules folder (installed again from its project), and the
// bots' installed tools: tools.json, the list of them, is carried, and botdot installs them again from it (ADR 007).
// The account computer's /workspace, the bots' files and project folders made there, goes along as one gzipped tar
// (.computer/workspace.tgz, #1020) when the computer runs: packed by box with the computer's own pack step
// (lib/computers.js backupWorkspace), read out in pieces. After a restore it is unpacked over /workspace once the
// computer runs, then removed.
//
// File: MAGIC | salt (16) | iv (12) | AES-256-GCM( gzip( entries ) ) | tag (16)
// Entries: a 4-byte length + a JSON header, then the file's bytes. The first is the manifest.
//
// Restoring unpacks into data/.restore-pending and restarts; on the next start, before anything opens
// the data folder, applyPendingRestore() moves the current data to data/backups/replaced-<time> and
// puts the backup's in its place.
//
// Before ADR 158 an account made its own .bdb every night into data/backups, with a key kept from the owner's
// passphrase (backup.key). Those files are removed once the account's data is off-site, or once the owner downloads a
// backup: either holds all they held. A file of then still restores, in both its formats.
const fs = require('./principal-fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');
const vault = require('./vault');

const MAGIC = Buffer.from('BDBACKUP2\n');
const OLD_MAGIC = Buffer.from('BDBACKUP1\n');
// The largest file a backup reads in one call rather than as a stream.
const WHOLE = 8 * 1024 * 1024;
// The account's own nightly backups of before ADR 158.
const OLD_NAME_RE = /^bot-dot-\d{8}-\d{4,6}\.bdb$/;
const SKIP_TOP = new Set(['audit.log', 'backups', '.restore-pending', 'run-config', 'skill-packs', 'tools', 'models', 'bitwarden-cli', 'memory.db', 'memory.db-wal', 'memory.db-shm', '.spare', '.snapshot', '.computer']);
// .spare: an account's room for a full disk (lib/disk-space.js), which botdot makes again by itself. .snapshot: the
// copy of memory.db made for root's backup of the machine (snapshot() below), which a backup makes of its own.
// .computer: a restored computer's workspace waiting for the computer (restoreWorkspace() below).
const SKIP_NAMES = new Set(['.credentials.json']); // a Claude sign-in, wherever it is
// Folders a bot's project makes again from its own files (npm install): on hq one account's workspaces held 2.65
// million files in them, 94% of all its files, and its backup never finished.
const SKIP_DIRS = new Set(['node_modules']);
const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
// The passphrase's shortest length: the page, the app, docs/api.md and this check say the same (test/backup.test.js).
const MIN_PASSPHRASE = 12;
// How long a download asked for waits to be fetched; then what it made for it is removed.
const PREPARED_MS = 15 * 60_000;
// The computer's workspace in a backup, and the most bytes of it read or written in one call: the Docker helper takes
// at most 900 000 base64 characters a call (lib/docker-helper.js).
const WORKSPACE = '.computer/workspace.tgz';
const WORKSPACE_READ = 3 * 1024 * 1024;
const WORKSPACE_WRITE = 600 * 1024;
// What the front door may say of the account's off-site backup (offsite()).
const OFFSITE_STATES = new Set(['off', 'backing-up', 'done', 'failed']);

const scrypt = promisify(crypto.scrypt);
const deriveKey = (passphrase, salt, legacy = false) => crypto.scryptSync(String(passphrase), salt, 32, { ...SCRYPT, N: legacy ? 1 << 15 : SCRYPT.N });
const pendingDir = (dataDir) => path.join(dataDir, '.restore-pending');
const snapshotDir = (dataDir) => path.join(dataDir, '.snapshot');
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const failure = (message, status) => Object.assign(new Error(message), { status });

// computer: the account's computer ({ backupWorkspace(step) }, lib/computers.js), or null where there is none.
function create({ dataDir, memory, revision, account = null, audit = () => {}, computer = null, now = () => Date.now() }) {
  const DIR = path.join(dataDir, 'backups');
  const OLD_KEY_FILE = path.join(vault.keyDir(), 'backup.key'); // the passphrase's key of before ADR 158
  const state = { preparing: false, workspace: null };
  // The download asked for: { token, name, salt, key, snap, ws, streaming, timer }, or null.
  let ready = null;
  // What the front door last said of the off-site backup, and when the owner last downloaded one, kept across
  // restarts in data/backups/state.json, which no backup carries.
  const STATE_FILE = path.join(DIR, 'state.json');
  const kept = () => { try { const k = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); return k && typeof k === 'object' ? k : {}; } catch { return {}; } };
  const keep = (change) => {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...kept(), ...change }), { mode: 0o600 });
  };

  // Every file to back up, as paths relative to the data folder.
  function* files(rel = '') {
    for (const e of fs.readdirSync(path.join(dataDir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if ((!rel && SKIP_TOP.has(e.name)) || SKIP_NAMES.has(e.name) || (e.isDirectory() && SKIP_DIRS.has(e.name))) continue;
      if (e.isDirectory()) { yield { p, dir: true }; yield* files(p); } else if (e.isFile()) yield { p };
    }
  }

  // The computer's step, or a failure with what it said.
  const step = async (s, what) => {
    const r = await computer.backupWorkspace(s);
    if (r && r.code === 0) return r;
    throw new Error(`${what}: ${String(r?.error || r?.stderr || 'no answer').trim().split('\n').pop().slice(0, 200)}`);
  };

  // ws: the computer's packed workspace ({ size }), or null.
  async function* entries(snapshotFile, ws) {
    const header = (h) => { const j = Buffer.from(JSON.stringify(h)); const n = Buffer.alloc(4); n.writeUInt32BE(j.length); return Buffer.concat([n, j]); };
    yield header({ manifest: true, kind: 'bot-dot-backup', version: 1, createdAt: new Date().toISOString(), revision: revision || null, account: account || null, vaultKey: vault.keyHex(), computer: !!ws });
    const add = async function* (abs, p) {
      let st;
      try { st = fs.statSync(abs); } catch { return; } // gone meanwhile
      // A file up to WHOLE is read in one call: a bot's file reached through the broker as a stream starts two
      // processes, which for a workspace of many small files kept a backup going for more than ten hours.
      if (st.size <= WHOLE) {
        let data;
        try { data = fs.readFileSync(abs); } catch { return; } // gone meanwhile
        yield header({ p, size: st.size, mode: st.mode & 0o7777, uid: st.uid, gid: st.gid });
        yield data.length >= st.size ? data.subarray(0, st.size) : Buffer.concat([data, Buffer.alloc(st.size - data.length)]);
        return;
      }
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
    if (!ws) return;
    yield header({ p: WORKSPACE, size: ws.size, mode: 0o600 });
    for (let offset = 0; offset < ws.size;) {
      const r = await step({ op: 'read', offset, length: Math.min(WORKSPACE_READ, ws.size - offset) }, "Couldn't read the computer's files");
      const piece = Buffer.from(r.data || '', 'base64');
      if (!piece.length) throw new Error("Couldn't read the computer's files: they ended early");
      offset += piece.length;
      yield piece;
    }
  }

  // The account's own backups of before ADR 158 and their key: removed once nothing needs them.
  function dropOld() {
    let names = [];
    try { names = fs.readdirSync(DIR); } catch { names = []; }
    const old = names.filter((name) => OLD_NAME_RE.test(name));
    for (const name of old) fs.rmSync(path.join(DIR, name), { force: true });
    fs.rmSync(OLD_KEY_FILE, { force: true });
    if (old.length) console.log(`[backup] removed this account's ${old.length} old backup${old.length === 1 ? '' : 's'}`);
  }

  // What waits for a download (its copy of memory.db, the computer's packed files), removed.
  function discard(r = ready) {
    if (!r) return;
    clearTimeout(r.timer);
    fs.rmSync(r.snap, { force: true });
    if (r.ws) computer.backupWorkspace({ op: 'drop' }).catch(() => {});
    if (ready === r) ready = null;
  }

  // Named with the account it holds (ADR 028): bot-dot-<account>-<date>.bdb.
  const fileName = () => {
    const d = new Date(now());
    const pad = (n) => String(n).padStart(2, '0');
    const at = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return /^[a-z][a-z0-9-]{1,30}$/.test(account || '') ? `bot-dot-${account}-${at}.bdb` : `bot-dot-${at}.bdb`;
  };

  // A download asked for with its passphrase: memory.db copied and the computer's files packed now, so that the file
  // starts at once when it is fetched (download()). Returns { token, name }. One at a time: a new one replaces one not
  // fetched yet.
  async function prepare(passphrase) {
    passphrase = typeof passphrase === 'string' ? passphrase : '';
    if (passphrase.length < MIN_PASSPHRASE) throw failure(`Use at least ${MIN_PASSPHRASE} characters.`, 400);
    if (state.preparing || ready?.streaming) throw failure('A backup is already being made.', 409);
    state.preparing = true;
    discard();
    const r = { token: crypto.randomBytes(16).toString('hex'), salt: crypto.randomBytes(16), snap: path.join(DIR, `.memory-${process.pid}.db`), ws: null, streaming: false, timer: null };
    try {
      fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
      fs.rmSync(r.snap, { force: true });
      memory.snapshot(r.snap);
      // The computer's files, packed in it first; a computer that doesn't run (or none) leaves them out.
      if (computer) {
        const packed = await step({ op: 'pack' }, "Couldn't pack the computer's files");
        if (!packed.none && packed.size > 0) r.ws = { size: packed.size };
      }
      r.key = await scrypt(passphrase, r.salt, 32, SCRYPT);
      r.name = fileName();
      r.timer = setTimeout(() => discard(r), PREPARED_MS);
      r.timer.unref?.();
      ready = r;
      return { token: r.token, name: r.name };
    } catch (e) {
      discard(r);
      throw e;
    } finally { state.preparing = false; }
  }

  // The download asked for as `token`, written to `out` as it is made; false when there is none of that token.
  // started(name) is called before the first byte. Once the file is whole, the account's old backups go (dropOld()).
  async function download(token, out, { started = () => {} } = {}) {
    const r = ready;
    if (!r || r.streaming || typeof token !== 'string' || token.length !== r.token.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(r.token))) return false;
    r.streaming = true;
    clearTimeout(r.timer);
    try {
      started(r.name);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', r.key, iv);
      out.write(Buffer.concat([MAGIC, r.salt, iv]));
      await pipeline(Readable.from(entries(r.snap, r.ws)), zlib.createGzip({ level: 6 }), cipher, out, { end: false });
      await new Promise((res, rej) => out.end(cipher.getAuthTag(), (e) => (e ? rej(e) : res())));
      keep({ lastDownload: new Date(now()).toISOString() });
      audit('backup.downloaded', 'owner');
      dropOld();
      return true;
    } finally { discard(r); }
  }

  // What the front door says of this account's off-site backup: { state, lastSuccess, late }, state off, backing-up,
  // done or failed, lastSuccess when this account's data last went off-site. Once it has, the old backups go.
  function offsite(o) {
    if (!o || !OFFSITE_STATES.has(o.state)) throw failure('Say the state: off, backing-up, done or failed.', 400);
    const said = { state: o.state, lastSuccess: o.state === 'off' ? null : iso(o.lastSuccess), late: o.state !== 'off' && o.late === true };
    keep({ offsite: said });
    if (said.lastSuccess) dropOld();
    return said;
  }

  // A restored computer's workspace (.computer/workspace.tgz) put back over /workspace once the computer runs: taken
  // in pieces, unpacked by box (a file of the same name is replaced), then removed. Tried at start and every tick until
  // it succeeds; a failure is kept in status() as workspaceError.
  let restoring = null;
  function restoreWorkspace() {
    const file = path.join(dataDir, WORKSPACE);
    if (restoring || !computer || !fs.existsSync(file)) return restoring;
    restoring = (async () => {
      await computer.ensure();
      const size = fs.statSync(file).size;
      const fd = fs.openSync(file, 'r');
      try {
        for (let offset = 0; offset === 0 || offset < size;) {
          const piece = Buffer.alloc(Math.min(WORKSPACE_WRITE, size - offset));
          const n = fs.readSync(fd, piece, 0, piece.length, offset);
          await step({ op: 'write', offset, data: piece.subarray(0, n).toString('base64') }, "Couldn't put back the computer's files");
          offset += n;
          if (!n) break;
        }
      } finally { fs.closeSync(fd); }
      await step({ op: 'unpack' }, "Couldn't put back the computer's files");
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
      state.workspace = null;
      console.log("[backup] the computer's files are back");
    })().catch((e) => {
      state.workspace = e.message;
      console.error(`[backup] ${e.message}`);
      computer.backupWorkspace({ op: 'drop' }).catch(() => {});
    }).finally(() => { restoring = null; });
    return restoring;
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

  // A consistent copy of memory.db for root's backup of the machine (#1015), in data/.snapshot/memory.db: root's step
  // can't copy the live file, whose WAL changes under it, and under gVisor no lock taken from another container holds
  // this server off. Root asks for it through the front door's socket, takes it in the account's part as memory.db and
  // removes it. Written as a temp file and renamed, so root never finds half a copy at that name.
  function snapshot() {
    const dir = snapshotDir(dataDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'memory.db');
    const tmp = path.join(dir, `memory.db.${process.pid}.tmp`);
    fs.rmSync(tmp, { force: true });
    try {
      memory.snapshot(tmp);
      fs.renameSync(tmp, file);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    const st = fs.statSync(file);
    return { at: st.mtime.toISOString(), bytes: st.size };
  }

  // offsite: what the front door last said (offsite()), null before it said anything; preparing: a download is being
  // made.
  function status() {
    const o = kept().offsite;
    return { offsite: o && OFFSITE_STATES.has(o.state) ? o : null, preparing: state.preparing || !!ready?.streaming, minPassphrase: MIN_PASSPHRASE,
      ...(state.workspace ? { workspaceError: state.workspace } : {}) };
  }

  // What a backup cut off by a restart left (its .part and its copy of memory.db), which nothing else removes: a run
  // only cleans up after itself while its process lives. On hq one account held 26 GB of these.
  function clearUnfinished() {
    let names = [];
    try { names = fs.readdirSync(DIR); } catch { return; }
    for (const n of names) {
      if (/^bot-dot-\d{8}-\d{4,6}\.bdb\.part$/.test(n) || /^\.memory-\d+\.db$/.test(n)) fs.rmSync(path.join(DIR, n), { force: true });
    }
  }
  // A copy of memory.db for root (snapshot()) that a restart cut off, or one root didn't remove after it.
  function clearSnapshot() {
    let names = [];
    try { names = fs.readdirSync(snapshotDir(dataDir)); } catch { return; }
    for (const n of names) if (n === 'memory.db' || /^memory\.db\.\d+\.tmp$/.test(n)) fs.rmSync(path.join(snapshotDir(dataDir), n), { force: true });
  }

  // Once started: what a restart left removed, the old backups too once the account's data is off-site, and a restored
  // computer's files put back whenever the computer runs.
  function start() {
    clearUnfinished();
    clearSnapshot();
    if (kept().offsite?.lastSuccess) dropOld();
    const tick = () => restoreWorkspace();
    setTimeout(tick, 30_000).unref();
    setInterval(tick, 10 * 60_000).unref();
  }

  return { status, prepare, download, offsite, stage, snapshot, start, restoreWorkspace, dir: DIR };
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

module.exports = { create, applyPendingRestore, MIN_PASSPHRASE, PREPARED_MS };
