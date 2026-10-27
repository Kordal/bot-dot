// This program is invoked only after the broker drops all root credentials.
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');
const workspaceGit = require('./workspace-git');
const OPS = new Set(['readFileSync', 'writeFileSync', 'appendFileSync', 'statSync', 'lstatSync', 'readdirSync', 'existsSync', 'realpathSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'copyFileSync', 'renameSync', 'chmodSync', 'accessSync', 'createReadStream', 'createWriteStream', 'prepareWorkspace', 'listDirSync', 'countTreeSync', 'walkTreeSync', 'readSmallSync', 'copyTreeSync', 'searchTreeSync']);
// A folder as the workspace file manager lists it (#296): its entries, folders first and then by name, never
// following a link, the first `limit` with their size and time, and how many it holds in all.
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const folderOrder = (a, b) => ((a.type === 'folder') === (b.type === 'folder') ? byName(a, b) : a.type === 'folder' ? -1 : 1);
function listDir(dir, limit = 1000) {
  const kind = (d) => (d.isDirectory() ? 'folder' : d.isFile() ? 'file' : d.isSymbolicLink() ? 'link' : 'other');
  const all = fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, type: kind(d) }));
  all.sort(folderOrder);
  // A folder says how many entries it holds (#603), counted without following a link.
  const items = (e) => { if (e.type !== 'folder') return {}; try { return { items: fs.readdirSync(path.join(dir, e.name)).length }; } catch { return {}; } };
  const entries = all.slice(0, Math.max(0, Number(limit) || 0)).map((e) => {
    try { const st = fs.lstatSync(path.join(dir, e.name)); return { ...e, size: st.size, mtimeMs: st.mtimeMs, ...items(e) }; } catch { return { ...e, size: 0, mtimeMs: 0 }; }
  });
  return { entries, total: all.length };
}
// What a folder holds, for a delete's confirmation (#296): files and folders under it, links counted as files and
// never followed: `capped` once there are more than `cap`.
function countTree(dir, cap = 10000) {
  let files = 0; let folders = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      if (files + folders >= cap) return { files, folders, capped: true };
      if (e.isDirectory()) { folders++; stack.push(path.join(d, e.name)); } else files++;
    }
  }
  return { files, folders, capped: false };
}
// Everything under a folder, never following a link, for a copy (#603). Each entry is { rel (from `dir`, names
// joined by /), type, size, mtimeMs }; folders come before what they hold. Past `cap` entries: `capped`. With
// `withData` (bytes), each plain file comes with its bytes in base64 (`data`), all in this one call; past that many
// bytes in all: `tooLarge`.
function walkTree(dir, cap = 10000, withData = 0) {
  let total = 0;
  const kind = (d) => (d.isDirectory() ? 'folder' : d.isFile() ? 'file' : d.isSymbolicLink() ? 'link' : 'other');
  const entries = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.shift();
    let list;
    try { list = fs.readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true }); } catch { continue; }
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of list) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      const type = kind(d);
      if (type === 'folder') stack.push(r);
      if (entries.length >= cap) return { entries, capped: true };
      let st = null;
      try { st = fs.lstatSync(path.join(dir, r)); } catch { /* gone meanwhile */ }
      const entry = { rel: r, type, size: st?.size || 0, mtimeMs: st?.mtimeMs || 0 };
      if (withData && type === 'file') {
        total += entry.size;
        if (total > withData) return { entries, capped: false, tooLarge: true };
        entry.data = fs.readFileSync(path.join(dir, r)).toString('base64');
      }
      entries.push(entry);
    }
  }
  return { entries, capped: false };
}
// A copy of the folder `src` made at `dest`, not there yet, in one call (#603): its folders and plain files, never a
// link, no file written over. Past `cap` entries nothing is made: { capped: true }.
function copyTree(src, dest, cap = 10000) {
  const { entries, capped } = walkTree(src, cap);
  if (capped) return { copied: 0, capped: true };
  fs.mkdirSync(dest);
  for (const e of entries) {
    const to = path.join(dest, ...e.rel.split('/'));
    if (e.type === 'folder') fs.mkdirSync(to);
    else if (e.type === 'file') fs.copyFileSync(path.join(src, ...e.rel.split('/')), to, fs.constants.COPYFILE_EXCL);
  }
  return { copied: entries.length, capped: false };
}
// A small file read whole in one call, for a grid's picture (#603): { size, data } when `file` is a plain file whose
// real path is itself (no link anywhere on the way) and at most `max` bytes, its bytes in base64; else { size } or null.
function readSmall(file, max, top = path.dirname(file)) {
  let real; let expected;
  // No link on the way down from `top`, which may itself be reached through one (a linked data folder).
  try { real = fs.realpathSync(file); expected = path.join(fs.realpathSync(top), path.relative(top, file)); } catch { return null; }
  if (real !== expected || path.relative(top, file).startsWith('..')) return null;
  const st = fs.lstatSync(file);
  if (!st.isFile()) return null;
  if (st.size > max) return { size: st.size };
  return { size: st.size, data: fs.readFileSync(file).toString('base64') };
}
// Files and folders whose name holds `q` (any case), under `dir`, for the "@" file picker and the explorer's search
// (#604, #603): nearest first, never following a link, never into a dot-folder or node_modules. At most `max` found,
// and `visit` entries looked at; `more` when either cut the search short. Paths are relative to `dir`. One call for
// all of it: through the broker each call holds the server up (#468).
const SKIPPED = (name) => name.startsWith('.') || name === 'node_modules';
function searchTree(dir, q, max = 200, visit = 20000) {
  const want = String(q || '').toLowerCase();
  const found = [];
  const queue = [''];
  let seen = 0;
  const kind = (d) => (d.isDirectory() ? 'folder' : d.isFile() ? 'file' : d.isSymbolicLink() ? 'link' : 'other');
  try { if (!fs.lstatSync(dir).isDirectory()) return { found, more: false }; } catch { return { found, more: false }; } // not there yet, or a link
  while (queue.length) {
    const rel = queue.shift();
    let list;
    try { list = fs.readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true }); } catch { continue; }
    list.sort((a, b) => byName(a, b));
    for (const d of list) {
      if (SKIPPED(d.name)) continue;
      if (++seen > visit) return { found, more: true };
      const p = rel ? `${rel}/${d.name}` : d.name;
      const type = kind(d);
      if (want && d.name.toLowerCase().includes(want)) {
        let st = null;
        try { st = fs.lstatSync(path.join(dir, p)); } catch { /* gone meanwhile */ }
        found.push({ name: d.name, path: p, type, size: st?.size || 0, mtimeMs: st?.mtimeMs || 0 });
        if (found.length >= max) return { found, more: true };
      }
      if (type === 'folder') queue.push(p);
    }
  }
  return { found, more: false };
}
function denied() { return Object.assign(new Error('Principal filesystem access denied'), { code: 'EACCES' }); }
function scoped(root, principal, name) {
  if (typeof name !== 'string' || name.includes('\0') || !path.isAbsolute(name) || name.split(path.sep).includes('..')) throw denied();
  const absolute = path.resolve(name);
  const roots = [path.resolve(root, 'workspaces', principal === 'chief' ? '_chief' : principal), path.resolve(root, 'homes', principal)];
  const base = roots.find(p => absolute === p || absolute.startsWith(p + path.sep));
  if (!base) throw denied();
  // Reject links, including links in the principal root. Missing suffixes are
  // allowed for creation; the worker's UID remains the kernel security boundary.
  let current = path.resolve(root);
  for (const part of path.relative(current, absolute).split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw denied(); }
    catch (e) { if (e.code === 'ENOENT') break; throw e; }
  }
  return absolute;
}
function prepare(root, principal, op, args) {
  if (!/^[a-zA-Z0-9_-]+$/.test(principal) || !OPS.has(op) || !Array.isArray(args)) throw denied();
  args = [...args]; args[0] = scoped(root, principal, args[0]);
  if (op === 'copyFileSync' || op === 'renameSync' || op === 'copyTreeSync') args[1] = scoped(root, principal, args[1]);
  const options = args[op === 'writeFileSync' || op === 'appendFileSync' ? 2 : 1];
  const mode = op === 'chmodSync' ? args[1] : typeof options === 'object' && options !== null ? options.mode : op === 'mkdirSync' ? options : undefined;
  if (mode !== undefined && (Number(mode) & 0o7000)) throw denied();
  if (options && typeof options === 'object' && ('fd' in options || 'fs' in options)) throw denied();
  return args;
}
function executeFs(root, principal, op, args) {
  args = prepare(root, principal, op, args);
  if (op === 'prepareWorkspace') {
    const identity = args[1];
    if (args.length !== 2 || (identity !== null && (typeof identity !== 'object' || typeof identity.content !== 'string'))) throw denied();
    workspaceGit.prepare(args[0], identity && { file: scoped(root, principal, identity.file), content: identity.content });
    return;
  }
  if (op === 'listDirSync') return listDir(args[0], args[1]);
  if (op === 'countTreeSync') return countTree(args[0], args[1]);
  if (op === 'walkTreeSync') return walkTree(args[0], args[1], args[2]);
  if (op === 'copyTreeSync') return copyTree(args[0], args[1], args[2]);
  if (op === 'readSmallSync') return readSmall(args[0], args[1], typeof args[2] === 'string' ? args[2] : undefined);
  if (op === 'searchTreeSync') return searchTree(args[0], args[1], args[2], args[3]);
  if (['readFileSync', 'writeFileSync', 'appendFileSync', 'createReadStream', 'createWriteStream'].includes(op)) {
    const index = op === 'writeFileSync' || op === 'appendFileSync' ? 2 : 1;
    const supplied = args[index];
    const options = typeof supplied === 'string' ? { encoding: supplied } : { ...supplied };
    const c = fs.constants;
    const defaults = op.startsWith('read') || op === 'createReadStream' ? 'r' : op === 'appendFileSync' ? 'a' : 'w';
    const flags = options.flag ?? options.flags ?? defaults;
    const named = { r: c.O_RDONLY, 'r+': c.O_RDWR, w: c.O_WRONLY | c.O_CREAT | c.O_TRUNC, 'w+': c.O_RDWR | c.O_CREAT | c.O_TRUNC, a: c.O_WRONLY | c.O_CREAT | c.O_APPEND, 'a+': c.O_RDWR | c.O_CREAT | c.O_APPEND };
    const basic = typeof flags === 'string' ? flags.replace('x', '') : flags;
    const numeric = typeof basic === 'number' ? basic : named[basic];
    if (numeric === undefined) throw denied();
    const safeFlags = numeric | c.O_NOFOLLOW | (typeof flags === 'string' && flags.includes('x') ? c.O_EXCL : 0);
    if (op.startsWith('create')) { options.flags = safeFlags; args[index] = options; }
    else {
      const fd = fs.openSync(args[0], safeFlags, options.mode);
      try {
        if (op === 'readFileSync') {
          // Synchronous callers necessarily retain the result. Bound it even if a
          // bot grows the file between stat and read; backups use streams instead.
          const chunks = []; let total = 0;
          for (;;) {
            const chunk = Buffer.allocUnsafe(65536);
            const n = fs.readSync(fd, chunk, 0, chunk.length, null);
            if (!n) break;
            total += n;
            if (total > 50 * 1024 * 1024) throw Object.assign(new Error('Principal file exceeds 50 MiB'), { code: 'EFBIG' });
            chunks.push(chunk.subarray(0, n));
          }
          const result = Buffer.concat(chunks, total);
          return options.encoding ? result.toString(options.encoding) : result;
        }
        return fs[op](fd, args[1], options);
      } finally { fs.closeSync(fd); }
    }
  }
  return fs[op](...args);
}
function encode(value) {
  if (Buffer.isBuffer(value)) return { $buffer: value.toString('base64') };
  if (value instanceof fs.Stats) return { $stats: Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== 'function')) };
  if (value instanceof fs.Dirent) return { $dirent: { name: value.name, parentPath: value.parentPath, type: ['File','Directory','BlockDevice','CharacterDevice','SymbolicLink','FIFO','Socket'].find(t => value['is' + t]()) } };
  if (Array.isArray(value)) return value.map(encode);
  return value;
}
function decode(value) {
  if (value && typeof value === 'object' && value.$buffer !== undefined) return Buffer.from(value.$buffer, 'base64');
  return Array.isArray(value) ? value.map(decode) : value;
}
if (require.main === module) {
  let streaming = false;
  try {
    if (!process.getuid || process.getuid() === 0 || process.geteuid() === 0) throw denied();
    const { root, principal, op, args } = JSON.parse(fs.readFileSync(3, 'utf8'));
    streaming = op === 'createReadStream' || op === 'createWriteStream';
    const result = executeFs(root, principal, op, decode(args));
    if (streaming) {
      const streams = op === 'createReadStream' ? [result, process.stdout] : [process.stdin, result];
      pipeline(...streams, error => { if (error) { process.stderr.write(JSON.stringify({ code: error.code || 'EIO', message: 'Principal file stream failed' })); process.exitCode = 1; } });
    } else process.stdout.write(JSON.stringify({ value: encode(result) }));
  } catch (error) {
    const response = JSON.stringify({ error: { code: error.code || 'EIO', message: 'Principal filesystem operation failed' } });
    (streaming ? process.stderr : process.stdout).write(response);
    process.exitCode = 1;
  }
}
module.exports = { executeFs, encode, decode, listDir, countTree, walkTree, readSmall, copyTree, searchTree, folderOrder };
