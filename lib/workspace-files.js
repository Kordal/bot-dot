// A bot's workspace in its settings (#296): its folder on this server, data/workspaces/<bot>, which the owner
// browses and manages, and its folder on the account's computer, /workspace/<bot>, which the owner browses, opens,
// downloads and deletes in while the computer runs (read there as box, by the fixed scripts below).
// A path is always relative to its root: "..", "." and absolute paths are refused, and botdot follows no link on
// this server: a link is listed as one and never opened, renamed, moved or deleted (the privilege worker refuses
// links too). What botdot itself keeps in the workspace is read-only (docs/DECISIONS.md, 2026-10-22).
const fs = require('./principal-fs');
const path = require('path');
const fileView = require('./file-view');
const uploads = require('./uploads');
const { folderOrder } = require('./principal-fs-worker');

const MAX_LISTED = 1000; // entries of one folder
const COUNT_CAP = 10000; // what a delete's confirmation counts at most
const { MAX_BYTES, MAX_FILES } = uploads; // an upload, as an attachment; the apps send at most 10 in one go
// Read-only, with everything in them: Claude Code's settings folder and file, the bot's git, its jobs' and tiles'
// state folders (lib/bots.js runScriptJob, runTileScript). `uploads` holds the Files section (#235): its files may
// go, the folder itself stays, and they keep their names, which the Files section and its pins go by.
const READ_ONLY = new Set(['.claude', 'CLAUDE.md', '.git', '.jobs', '.tiles']);
const KEPT = new Set(['uploads']);

const { refused, gone } = fileView;
const OUTSIDE = "botdot opens only what is inside the bot's folder.";
const LINK = 'That is a link. botdot never follows one.';

// A path as the apps send it: "" for the root, else names joined by "/". Throws for "..", "." and absolute paths.
function relOf(p) {
  const s = String(p ?? '');
  if (s.length > 1024 || s.includes('\0')) throw refused('Say which file.', 400, 'refused');
  if (s.startsWith('/') || s.startsWith('~') || s.includes('\\')) throw refused(OUTSIDE);
  const parts = s.split('/').filter(Boolean);
  if (parts.some((x) => x === '..' || x === '.')) throw refused(OUTSIDE);
  return parts.join('/');
}
// A new name for a file or folder: one name, no path.
function nameOf(n) {
  const s = String(n ?? '').normalize('NFC').trim();
  if (!s || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || /[\u0000-\u001f\u007f]/.test(s) || Buffer.byteLength(s) > 255) {
    throw refused('Give it a name without / in it.', 400, 'refused');
  }
  return s;
}
const top = (rel) => rel.split('/')[0];
const readOnly = (rel) => !!rel && READ_ONLY.has(top(rel));
const kept = (rel) => KEPT.has(rel);
// Whether a path may be renamed, moved or deleted; whether it keeps its name and place (a file in uploads/).
const fixed = (rel) => !rel || readOnly(rel) || kept(rel);
const keepsName = (rel) => KEPT.has(top(rel)) && rel.includes('/');
const join = (rel, name) => (rel ? `${rel}/${name}` : name);

// The real place of a path in the workspace. Its real path must be the path itself: a link anywhere on the way,
// even one that stays inside, is not followed. Throws 404 when it is not there.
function locate(ws, rel) {
  let root;
  try { root = fs.realpathSync(ws); } catch { throw gone(); }
  const abs = rel ? path.join(root, ...rel.split('/')) : root;
  let real;
  try { real = fs.realpathSync(abs); } catch (e) { throw e.code === 'EACCES' ? refused(LINK) : gone(); }
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw refused(OUTSIDE);
  if (real !== abs) throw refused(LINK);
  return { abs, st: fs.lstatSync(abs) };
}
const folderAt = (ws, rel) => {
  const f = locate(ws, rel);
  if (!f.st.isDirectory()) throw refused('That is a file, not a folder.', 400, 'not-folder');
  return f;
};
function writable(rel, words = "botdot keeps this folder as it is: it is part of how the bot works.") {
  if (readOnly(rel)) throw refused(words, 403, 'protected');
}

// One entry as the apps get it; `marks`: what botdot keeps is marked (on this server only).
const entryOf = (rel, e, marks = true) => ({
  name: e.name, path: join(rel, e.name), type: e.type,
  ...(e.type === 'file' ? { size: e.size } : {}),
  ...(e.type === 'folder' && Number.isFinite(e.items) ? { items: e.items } : {}),
  at: e.mtimeMs ? new Date(e.mtimeMs).toISOString() : null,
  ...(!marks ? {} : fixed(join(rel, e.name)) ? { protected: true } : keepsName(join(rel, e.name)) ? { keepsName: true } : {}),
});

// A folder of the workspace on this server: { root, path, entries, more, readOnly }. Its root before the bot's
// first run is an empty folder.
function list(ws, p) {
  const rel = relOf(p);
  if (!rel && !fs.existsSync(ws)) return { root: 'server', path: '', entries: [], more: 0, readOnly: false };
  const { abs } = folderAt(ws, rel);
  const { entries, total } = fs.listDirSync(abs, MAX_LISTED);
  return { root: 'server', path: rel, entries: entries.map((e) => entryOf(rel, e)), more: Math.max(0, total - entries.length), readOnly: readOnly(rel) };
}

// A regular file of it, for the viewer and a download: its real path.
function file(ws, p) {
  const rel = relOf(p);
  if (!rel) throw refused('That is a folder, not a file.', 400, 'not-file');
  const f = locate(ws, rel);
  if (!f.st.isFile()) throw refused('That is a folder, not a file.', 400, 'not-file');
  return f.abs;
}

// A name not taken yet in a folder: "notes.md", then "notes (2).md", "notes (3).md"… The folder is read once.
function freeName(dir, name) {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const taken = new Set(fs.readdirSync(dir));
  for (let i = 1; i < 1000; i++) {
    const n = i === 1 ? name : `${stem} (${i})${ext}`;
    if (!taken.has(n)) return n;
  }
  throw refused('There are too many files of that name here.', 409, 'exists');
}

// A new folder in `p`. Answers its path. `free` (#576): a name that is taken becomes "name (2)", as an upload's.
function makeFolder(ws, p, name, { free = false } = {}) {
  const rel = relOf(p);
  let n = nameOf(name);
  writable(join(rel, n));
  if (!rel) fs.mkdirSync(ws, { recursive: true });
  const { abs } = folderAt(ws, rel);
  if (free) n = freeName(abs, n);
  try { fs.mkdirSync(path.join(abs, n)); } catch (e) { if (e.code === 'EEXIST') throw refused(`There is already ${n} here.`, 409, 'exists'); throw e; }
  return join(rel, n);
}

// The folders of `rel` that are not there yet, made one by one (#576: a folder uploaded with what it holds). A link
// or a file on the way is refused as for any path.
function makeFolders(ws, rel) {
  fs.mkdirSync(ws, { recursive: true });
  const parts = rel ? rel.split('/') : [];
  for (let i = 1; i <= parts.length; i++) {
    const at = parts.slice(0, i).join('/');
    try { folderAt(ws, at); } catch (e) {
      if (e.status !== 404) throw e;
      try { fs.mkdirSync(path.join(folderAt(ws, parts.slice(0, i - 1).join('/')).abs, parts[i - 1])); } catch (err) { if (err.code !== 'EEXIST') throw err; }
      folderAt(ws, at);
    }
  }
}

// Rename or move: `to` is the new path, in the same root. Answers it.
function move(ws, from, to) {
  const a = relOf(from); const b = relOf(to);
  if (!a || !b) throw refused('Say what moves where.', 400, 'refused');
  if (fixed(a)) throw refused(`botdot keeps ${a} where it is: it is part of how the bot works.`, 403, 'protected');
  if (keepsName(a)) throw refused("A file you gave the bot keeps its name and place: the Files section goes by them. Delete it, or upload it again elsewhere.", 403, 'protected');
  writable(b);
  if (b === a) return b;
  if (b.startsWith(`${a}/`)) throw refused("A folder can't go into itself.", 400, 'refused');
  nameOf(path.posix.basename(b));
  const src = locate(ws, a);
  const parent = folderAt(ws, path.posix.dirname(b) === '.' ? '' : path.posix.dirname(b));
  const dest = path.join(parent.abs, path.posix.basename(b));
  let taken = true;
  try { fs.lstatSync(dest); } catch (e) { taken = e.code !== 'ENOENT'; }
  if (taken) throw refused(`There is already ${path.posix.basename(b)} there.`, 409, 'exists');
  fs.renameSync(src.abs, dest);
  return b;
}

// What a delete takes: { type, files, folders, capped }, for its confirmation.
function count(ws, p) {
  const rel = relOf(p);
  const f = locate(ws, rel);
  if (!f.st.isDirectory()) return { type: 'file', files: 1, folders: 0, capped: false };
  return { type: 'folder', ...fs.countTreeSync(f.abs, COUNT_CAP) };
}

// Delete a file, or a folder with what it holds.
function remove(ws, p) {
  const rel = relOf(p);
  if (fixed(rel)) throw refused(rel ? `botdot keeps ${rel}: it is part of how the bot works.` : "The bot's folder itself stays.", 403, 'protected');
  const f = locate(ws, rel);
  fs.rmSync(f.abs, { recursive: f.st.isDirectory(), force: false });
  return rel;
}

// An upload's name: its own, or a safe one made of it.
function uploadName(name) {
  try { return nameOf(path.basename(String(name || ''))); } catch { return uploads.safeName(name); }
}

// One upload, the request's body, into folder `p` under `name` (another name when it is taken). Never overwrites.
// `folders` (#576): the folders of `p` that are not there yet are made first.
function upload(req, ws, p, name, { folders = false } = {}) {
  const rel = relOf(p);
  let n = uploadName(name);
  writable(join(rel, n));
  if (folders) makeFolders(ws, rel);
  else if (!rel) fs.mkdirSync(ws, { recursive: true });
  const { abs: dir } = folderAt(ws, rel);
  n = freeName(dir, n);
  const abs = path.join(dir, n);
  return new Promise((resolve, reject) => {
    let size = 0; let failed = false;
    const out = fs.createWriteStream(abs, { flags: 'wx', mode: 0o644 });
    const fail = (e) => {
      if (failed) return;
      failed = true;
      req.unpipe(out); out.destroy();
      fs.rm(abs, { force: true }, () => reject(e));
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) { fail(refused(`That file is over ${MAX_BYTES / 1024 / 1024} MB.`, 413, 'too-large')); req.resume(); }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => { if (!failed) resolve({ name: n, path: join(rel, n), size }); });
    req.pipe(out);
  });
}

// An upload's bytes, whole, for the computer (#576): at most MAX_BYTES, else 413 and the rest is drained.
function readUpload(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let over = false;
    req.on('data', (c) => { size += c.length; if (size > MAX_BYTES) over = true; else chunks.push(c); });
    req.on('end', () => (over ? reject(refused(`That file is over ${MAX_BYTES / 1024 / 1024} MB.`, 413, 'too-large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

// ---------- copies, and moves between places (#603) ----------

const MAX_CARRIED = MAX_BYTES; // what goes between botdot and the computer in one copy or move, packed
const MAX_COPIED = 10000; // entries of one folder copied
const EXCL = require('fs').constants.COPYFILE_EXCL;
const tar = require('./tar-lite');

// A new entry made whole in `dir` under `name`, or not at all: built in a hidden folder there first, by `fill(tmp)`,
// which leaves what it made at `tmp/<what>`; then renamed into place.
function staged(dir, what, name, fill) {
  const tmp = path.join(dir, `.botdot-copy-${require('crypto').randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmp);
  try {
    fill(tmp);
    fs.renameSync(path.join(tmp, what), path.join(dir, name));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// The folder `into` that something goes into: there, taking writes, and not `from` or inside it.
function intoFolder(ws, into, from = null) {
  const dir = relOf(into);
  if (from !== null && (dir === from || dir.startsWith(`${from}/`))) throw refused("A folder can't go into itself.", 400, 'refused');
  writable(dir, 'botdot keeps this folder as it is: nothing goes into it.');
  if (!dir) fs.mkdirSync(ws, { recursive: true });
  return { dir, abs: folderAt(ws, dir).abs };
}
// What may leave its place: not what botdot keeps, nor a file the owner gave the bot (its Files section goes by it).
function movable(rel) {
  if (fixed(rel)) throw refused(rel ? `botdot keeps ${rel} where it is: it is part of how the bot works.` : "The bot's folder itself stays.", 403, 'protected');
  if (keepsName(rel)) throw refused('A file you gave the bot keeps its name and place: the Files section goes by them.', 403, 'protected');
}

// A copy of `from` in folder `into`, on botdot, under its own name or a free one ("notes (2).md"). Never over
// anything. A link is not copied; one inside a folder is left out. Answers its path.
function copy(ws, from, into) {
  const a = relOf(from);
  if (!a) throw refused('Say what to copy.', 400, 'refused');
  const src = locate(ws, a);
  const { dir, abs } = intoFolder(ws, into, src.st.isDirectory() ? a : null);
  const n = freeName(abs, path.posix.basename(a));
  writable(join(dir, n));
  if (!src.st.isDirectory()) {
    if (!src.st.isFile()) throw refused(LINK);
    fs.copyFileSync(src.abs, path.join(abs, n), EXCL);
    return join(dir, n);
  }
  const { entries, capped } = fs.walkTreeSync(src.abs, MAX_COPIED);
  if (capped) throw refused(`That folder holds over ${MAX_COPIED.toLocaleString('en')} entries: too many to copy at once.`, 413, 'too-large');
  staged(abs, 'copy', n, (tmp) => {
    const top = path.join(tmp, 'copy');
    fs.mkdirSync(top);
    for (const e of entries) {
      const to = path.join(top, ...e.rel.split('/'));
      if (e.type === 'folder') fs.mkdirSync(to);
      else if (e.type === 'file') fs.copyFileSync(path.join(src.abs, ...e.rel.split('/')), to, EXCL);
    }
  });
  return join(dir, n);
}

// `from` moved into folder `into` on botdot, under its own name or a free one. Answers its path; in that folder
// already, it stays as it is.
function moveInto(ws, from, into) {
  const a = relOf(from); const dir = relOf(into);
  if (!a) throw refused('Say what moves where.', 400, 'refused');
  movable(a);
  if (path.posix.dirname(a) === (dir || '.')) return a;
  const { abs } = intoFolder(ws, dir, a);
  return move(ws, a, join(dir, freeName(abs, path.posix.basename(a))));
}

const tooLarge = () => refused(`Over ${MAX_CARRIED / 1024 / 1024} MB: too much to carry between botdot and the computer at once.`, 413, 'too-large');

// `from` on botdot packed as a tar of its files and folders, under its own name, for the computer. Links are left
// out. At most MAX_CARRIED bytes of files.
function packServer(ws, from) {
  const a = relOf(from);
  if (!a) throw refused('Say what to copy.', 400, 'refused');
  const src = locate(ws, a);
  const name = path.posix.basename(a);
  if (!src.st.isDirectory()) {
    if (!src.st.isFile()) throw refused(LINK);
    if (src.st.size > MAX_CARRIED) throw tooLarge();
    return { name, tar: tar.pack([{ name, type: 'file', data: fs.readFileSync(src.abs), mtimeMs: src.st.mtimeMs }]) };
  }
  const { entries, capped } = fs.walkTreeSync(src.abs, MAX_COPIED);
  if (capped) throw refused(`That folder holds over ${MAX_COPIED.toLocaleString('en')} entries: too many to carry at once.`, 413, 'too-large');
  const kept = entries.filter((e) => e.type === 'folder' || e.type === 'file');
  if (kept.reduce((n, e) => n + (e.type === 'file' ? e.size : 0), 0) > MAX_CARRIED) throw tooLarge();
  const packed = [{ name, type: 'folder', mtimeMs: src.st.mtimeMs }, ...kept.map((e) => ({
    name: `${name}/${e.rel}`, type: e.type, mtimeMs: e.mtimeMs, ...(e.type === 'file' ? { data: fs.readFileSync(path.join(src.abs, ...e.rel.split('/'))) } : {}),
  }))];
  return { name, tar: tar.pack(packed) };
}

// A tar from the computer unpacked into folder `into` on botdot: its one top entry under its own name or a free one,
// whole or not at all. Answers its path.
function unpackServer(ws, into, packed) {
  const entries = tar.unpack(packed);
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  if (tops.size !== 1) throw refused('The copy came back broken.', 502, 'failed');
  const [top] = tops;
  nameOf(top);
  const { dir, abs } = intoFolder(ws, into);
  const n = freeName(abs, top);
  writable(join(dir, n));
  staged(abs, top, n, (tmp) => {
    for (const e of entries) {
      const to = path.join(tmp, ...e.name.split('/'));
      if (e.type === 'folder') fs.mkdirSync(to, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, e.data, { flag: 'wx', mode: 0o644 });
      }
    }
  });
  return join(dir, n);
}

// "Keep in mind" for any file on botdot: a copy in uploads/ under a saved name, as a file the owner gave the bot,
// which its Files section lists and pins. Answers that copy's path.
function keepCopy(ws, from) {
  const a = relOf(from);
  const abs = file(ws, a);
  fs.mkdirSync(path.join(ws, 'uploads'), { recursive: true });
  const to = uploads.uploadPath(uploads.safeName(path.posix.basename(a)));
  fs.copyFileSync(abs, path.join(ws, to), EXCL);
  return to;
}

// ---------- the bot's folder on the account's computer, /workspace/<bot> ----------

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const computerRoot = (botId) => `/workspace/${botId}`;
// The script's start: the folder's real path in $r and the path asked for in $t, refused when a link is on the
// way there. Answers one word for why not.
const placeLines = (root, rel) => [
  `r=$(realpath -e -- ${shq(root)} 2>/dev/null) || { echo gone; exit 0; }`,
  `t="$r"${rel ? `/${shq(rel)}` : ''}`,
  '[ -e "$t" ] || [ -L "$t" ] || { echo gone; exit 0; }',
  'd=$(dirname -- "$t"); [ "$t" = "$r" ] || [ "$(realpath -e -- "$d")" = "$d" ] || { echo link; exit 0; }',
];
// A folder: "ok <total>", then its first `max` entries, folders first and each kind by name, each
// "<type>/<size>/<mtime>/<name>" ended by a NUL (find's %y: d, f, l…; a name never holds a /).
// A folder's size is how many entries it holds (#603).
function listScript(root, rel, max = MAX_LISTED) {
  const sorted = 'LC_ALL=C sort -z -t / -k 4';
  const folders = `find "$t" -mindepth 1 -maxdepth 1 -type d -exec sh -c 'for d; do printf "d/%s/%s/%s\\0" "$(find "$d" -mindepth 1 -maxdepth 1 -printf . 2>/dev/null | wc -c)" "$(stat -c %Y -- "$d")" "\${d##*/}"; done' sh {} + | ${sorted}`;
  return [
    ...placeLines(root, rel),
    '[ -L "$t" ] && { echo link; exit 0; }',
    '[ -d "$t" ] || { echo not-folder; exit 0; }',
    'echo "ok $(find "$t" -mindepth 1 -maxdepth 1 -printf . | wc -c)"',
    `{ ${folders}; find "$t" -mindepth 1 -maxdepth 1 ! -type d -printf '%y/%s/%T@/%f\\0' | ${sorted}; } | head -z -n ${max}`,
  ].join('\n');
}
// What a delete takes: "ok <type> <files> <folders>", counting at most `cap`.
function countScript(root, rel, cap = COUNT_CAP) {
  return [
    ...placeLines(root, rel),
    '[ -d "$t" ] && [ ! -L "$t" ] || { echo "ok file 1 0 all"; exit 0; }',
    `s=$(find "$t" -mindepth 1 \\( -type d -printf d -o -printf f \\) | head -c ${cap + 1})`,
    'f=$(printf %s "$s" | tr -cd f | wc -c); d=$(printf %s "$s" | tr -cd d | wc -c)',
    `[ $((f + d)) -gt ${cap} ] && c=capped || c=all`,
    'echo "ok folder $f $d $c"',
  ].join('\n');
}
// Delete one file, link or folder: "ok". A link goes itself; what it points to stays.
function removeScript(root, rel) {
  return [...placeLines(root, rel), 'rm -rf -- "$t" && echo ok'].join('\n');
}
// The folder `rel`, every folder on the way checked to be a folder and not a link; with `make`, the ones that are not
// there are made (#576). Leaves its path in $t.
const folderLines = (root, rel, make = false) => [
  `r=$(realpath -e -- ${shq(root)} 2>/dev/null) || { echo gone; exit 0; }`,
  't="$r"',
  ...(rel ? [
    `q=${shq(rel)}`,
    'set -f; IFS=/',
    `for p in $q; do t="$t/$p"; [ -L "$t" ] && { echo link; exit 0; }; [ -e "$t" ] || ${make ? 'mkdir -- "$t" || { echo failed; exit 0; }' : '{ echo gone; exit 0; }'}; [ -d "$t" ] || { echo not-folder; exit 0; }; done`,
    'unset IFS; set +f',
  ] : []),
];
// A name not taken in $t, in $f: "notes.md", then "notes (2).md"… as freeName; `free` false: a taken one is refused.
const freeLines = (name, free = true) => [
  `n=${shq(name)}`,
  free ? [
    'case "$n" in ?*.*) stem="${n%.*}"; ext=".${n##*.}";; *) stem="$n"; ext="";; esac',
    'f="$n"; i=1',
    'while [ -e "$t/$f" ] || [ -L "$t/$f" ]; do i=$((i + 1)); [ $i -ge 1000 ] && { echo exists; exit 0; }; f="$stem ($i)$ext"; done',
  ].join('\n') : 'f="$n"; { [ -e "$t/$f" ] || [ -L "$t/$f" ]; } && { echo exists; exit 0; }',
];
// A new folder in `rel`: "ok <its name>".
function folderScript(root, rel, name, { free = false } = {}) {
  return [...folderLines(root, rel), ...freeLines(name, free), 'mkdir -- "$t/$f" && printf \'ok %s\\n\' "$f"'].join('\n');
}
// One file, its bytes on stdin, into `rel` under `name` or a free one: "ok <its name>". Whole or not at all, never
// over another file. `folders`: the folders of `rel` that are not there are made.
function putScript(root, rel, name, { folders = false } = {}) {
  return [
    ...folderLines(root, rel, folders), ...freeLines(name),
    'p="$t/.botdot-upload.$$"',
    'if cat > "$p" && mv -n -T -- "$p" "$t/$f" && [ ! -e "$p" ]; then printf \'ok %s\\n\' "$f"; else rm -f -- "$p"; echo failed; fi',
  ].join('\n');
}
// Rename or move `from` to `to`, in the same folder: "ok". `to`'s folder must be there; something at `to` is refused.
function moveScript(root, from, to) {
  const dir = path.posix.dirname(to);
  return [
    ...placeLines(root, from), 's="$t"',
    ...folderLines(root, dir === '.' ? '' : dir), ...freeLines(path.posix.basename(to), false),
    'mv -n -T -- "$s" "$t/$f" && [ ! -e "$s" ] && [ ! -L "$s" ] && echo ok || echo failed',
  ].join('\n');
}
// A copy, or a move, of `from` in folder `root` into folder `into` of `toRoot`, both on the computer (the bot's own
// folder and its projects'), under its own name or a free one: "ok <its name>". A link is copied as a link; moved
// into the folder it is in already, it stays.
function carryScript(root, from, toRoot, into, { move: moving = false } = {}) {
  const name = path.posix.basename(from);
  return [
    ...placeLines(root, from), 's="$t"',
    ...folderLines(toRoot, into),
    'case "$t/" in "$s"/*) echo into-itself; exit 0;; esac',
    ...(moving ? [`[ "$(dirname -- "$s")" = "$t" ] && { printf 'ok %s\\n' ${shq(name)}; exit 0; }`] : []),
    ...freeLines(name),
    moving
      ? 'if mv -n -T -- "$s" "$t/$f" && [ ! -e "$s" ] && [ ! -L "$s" ]; then printf \'ok %s\\n\' "$f"; else echo failed; fi'
      : 'if cp -R -P -- "$s" "$t/$f"; then printf \'ok %s\\n\' "$f"; else rm -rf -- "${t:?}/${f:?}"; echo failed; fi',
  ].join('\n');
}
// `from` packed by box as a tar, for botdot: "ok", then the tar in base64; "too-large" past `max` bytes.
function packScript(root, from, max = MAX_CARRIED) {
  return [
    ...placeLines(root, from),
    '[ -L "$t" ] && { echo link; exit 0; }',
    'p=$(mktemp /tmp/botdot-pack.XXXXXXXX) || { echo failed; exit 0; }',
    'tar --format=ustar -cf "$p" -C "$(dirname -- "$t")" -- "$(basename -- "$t")" 2>/dev/null || { rm -f -- "$p"; echo failed; exit 0; }',
    `[ "$(stat -c %s -- "$p")" -le ${max} ] || { rm -f -- "$p"; echo too-large; exit 0; }`,
    'echo ok; base64 -w0 -- "$p"; rm -f -- "$p"',
  ].join('\n');
}
// A tar from botdot, on stdin, unpacked by box into folder `into`: its top entry, `name`, under its own name or a free
// one, whole or not at all: "ok <its name>".
function unpackScript(root, into, name) {
  return [
    ...folderLines(root, into), ...freeLines(name),
    'p=$(mktemp -d "$t/.botdot-copy.XXXXXXXX") || { echo failed; exit 0; }',
    `if tar -xf - -C "$p" --no-same-owner --no-same-permissions && mv -n -T -- "$p"/${shq(name)} "$t/$f" && [ ! -e "$p"/${shq(name)} ]; then rm -rf -- "\${p:?}"; printf 'ok %s\\n' "$f"; else rm -rf -- "\${p:?}"; echo failed; fi`,
  ].join('\n');
}
// The answer of packScript: the tar.
function computerPacked(stdout) {
  const [first = '', rest = ''] = String(stdout || '').split(/\n([\s\S]*)/);
  if (first.trim() !== 'ok') answerWord(first.trim());
  return Buffer.from(rest.trim(), 'base64');
}

// The answer of folderScript and putScript: the name it got.
function computerMade(stdout) {
  const first = String(stdout || '').trim().split('\n')[0];
  const m = first.match(/^ok (.+)$/);
  if (!m) answerWord(first);
  return m[1];
}
function answerWord(first) {
  if (first === 'gone') throw gone();
  if (first === 'exists') throw refused('Something of that name is already there.', 409, 'exists');
  if (first === 'link') throw refused(LINK);
  if (first === 'not-folder') throw refused('That is a file, not a folder.', 400, 'not-folder');
  if (first === 'into-itself') throw refused("A folder can't go into itself.", 400, 'refused');
  if (first === 'too-large') throw refused(`Over ${MAX_CARRIED / 1024 / 1024} MB: too much to carry between botdot and the computer at once.`, 413, 'too-large');
  throw refused("Couldn't read it on the computer.", 502, 'failed');
}
const TYPES = { d: 'folder', f: 'file', l: 'link' };
// The answer of listScript, as list() answers.
function computerList(stdout, rel) {
  const s = String(stdout || '');
  const nl = s.indexOf('\n');
  const first = (nl < 0 ? s : s.slice(0, nl)).trim();
  const m = first.match(/^ok (\d+)$/);
  if (!m) answerWord(first);
  const all = s.slice(nl + 1).split('\0').filter(Boolean).map((line) => {
    const [, y, size, at, name] = line.match(/^(\S)\/(\d+)\/([\d.]+)\/([^/]+)$/) || [];
    const type = TYPES[y] || 'other';
    return name ? { name, type, size: Number(size), ...(type === 'folder' ? { items: Number(size) } : {}), mtimeMs: Math.round(Number(at) * 1000) } : null;
  }).filter(Boolean);
  const shown = all.sort(folderOrder).slice(0, MAX_LISTED);
  return { root: 'computer', path: rel, entries: shown.map((e) => entryOf(rel, e, false)), more: Math.max(0, Number(m[1]) - shown.length), readOnly: false };
}
function computerCount(stdout) {
  const first = String(stdout || '').trim().split('\n')[0];
  const m = first.match(/^ok (file|folder) (\d+) (\d+)(?: (capped|all))?$/);
  if (!m) answerWord(first);
  let files = Number(m[2]); let folders = Number(m[3]);
  const capped = m[4] === 'capped';
  if (capped && files + folders > COUNT_CAP) { if (files) files--; else folders--; } // it counted one past the cap
  return { type: m[1], files, folders, capped };
}
function computerRemoved(stdout) {
  const first = String(stdout || '').trim().split('\n')[0];
  if (first !== 'ok') answerWord(first);
}
const computerMoved = computerRemoved;

module.exports = {
  MAX_LISTED, COUNT_CAP, MAX_BYTES, MAX_FILES, MAX_CARRIED, MAX_COPIED, READ_ONLY, KEPT,
  relOf, nameOf, uploadName, list, file, makeFolder, makeFolders, move, count, remove, upload, readUpload,
  copy, moveInto, movable, packServer, unpackServer, keepCopy,
  computerRoot, listScript, countScript, removeScript, folderScript, putScript, moveScript, carryScript, packScript, unpackScript,
  computerList, computerCount, computerRemoved, computerMade, computerMoved, computerPacked,
};
