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

// A new folder in `p`. Answers its path.
function makeFolder(ws, p, name) {
  const rel = relOf(p);
  const n = nameOf(name);
  writable(join(rel, n));
  if (!rel) fs.mkdirSync(ws, { recursive: true });
  const { abs } = folderAt(ws, rel);
  try { fs.mkdirSync(path.join(abs, n)); } catch (e) { if (e.code === 'EEXIST') throw refused(`There is already ${n} here.`, 409, 'exists'); throw e; }
  return join(rel, n);
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

// One upload, the request's body, into folder `p` under `name` (another name when it is taken). Never overwrites.
function upload(req, ws, p, name) {
  const rel = relOf(p);
  let n;
  try { n = nameOf(path.basename(String(name || ''))); } catch { n = uploads.safeName(name); }
  writable(join(rel, n));
  if (!rel) fs.mkdirSync(ws, { recursive: true });
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
function listScript(root, rel, max = MAX_LISTED) {
  const each = (kind) => `find "$t" -mindepth 1 -maxdepth 1 ${kind} -printf '%y/%s/%T@/%f\\0' | LC_ALL=C sort -z -t / -k 4`;
  return [
    ...placeLines(root, rel),
    '[ -L "$t" ] && { echo link; exit 0; }',
    '[ -d "$t" ] || { echo not-folder; exit 0; }',
    'echo "ok $(find "$t" -mindepth 1 -maxdepth 1 -printf . | wc -c)"',
    `{ ${each('-type d')}; ${each('! -type d')}; } | head -z -n ${max}`,
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
function answerWord(first) {
  if (first === 'gone') throw gone();
  if (first === 'link') throw refused(LINK);
  if (first === 'not-folder') throw refused('That is a file, not a folder.', 400, 'not-folder');
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
    return name ? { name, type: TYPES[y] || 'other', size: Number(size), mtimeMs: Math.round(Number(at) * 1000) } : null;
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

module.exports = {
  MAX_LISTED, COUNT_CAP, MAX_BYTES, MAX_FILES, READ_ONLY, KEPT,
  relOf, nameOf, list, file, makeFolder, move, count, remove, upload,
  computerRoot, listScript, countScript, removeScript, computerList, computerCount, computerRemoved,
};
