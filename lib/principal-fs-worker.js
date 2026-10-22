// This program is invoked only after the broker drops all root credentials.
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');
const OPS = new Set(['readFileSync', 'writeFileSync', 'appendFileSync', 'statSync', 'lstatSync', 'readdirSync', 'existsSync', 'realpathSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'copyFileSync', 'renameSync', 'chmodSync', 'accessSync', 'createReadStream', 'createWriteStream', 'initWorkspace', 'listDirSync', 'countTreeSync']);
// A folder as the workspace file manager lists it (#296): its entries, folders first and then by name, never
// following a link, the first `limit` with their size and time, and how many it holds in all.
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const folderOrder = (a, b) => ((a.type === 'folder') === (b.type === 'folder') ? byName(a, b) : a.type === 'folder' ? -1 : 1);
function listDir(dir, limit = 1000) {
  const kind = (d) => (d.isDirectory() ? 'folder' : d.isFile() ? 'file' : d.isSymbolicLink() ? 'link' : 'other');
  const all = fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, type: kind(d) }));
  all.sort(folderOrder);
  const entries = all.slice(0, Math.max(0, Number(limit) || 0)).map((e) => {
    try { const st = fs.lstatSync(path.join(dir, e.name)); return { ...e, size: st.size, mtimeMs: st.mtimeMs }; } catch { return { ...e, size: 0, mtimeMs: 0 }; }
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
  if (op === 'copyFileSync' || op === 'renameSync') args[1] = scoped(root, principal, args[1]);
  const options = args[op === 'writeFileSync' || op === 'appendFileSync' ? 2 : 1];
  const mode = op === 'chmodSync' ? args[1] : typeof options === 'object' && options !== null ? options.mode : op === 'mkdirSync' ? options : undefined;
  if (mode !== undefined && (Number(mode) & 0o7000)) throw denied();
  if (options && typeof options === 'object' && ('fd' in options || 'fs' in options)) throw denied();
  return args;
}
function executeFs(root, principal, op, args) {
  args = prepare(root, principal, op, args);
  if (op === 'initWorkspace') {
    if (args.length !== 1) throw denied();
    fs.mkdirSync(args[0], { recursive: true });
    const gitDir = scoped(root, principal, path.join(args[0], '.git'));
    try { fs.lstatSync(gitDir); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { require('node:child_process').execFileSync('git', ['init', '-q'], { cwd: args[0], stdio: 'ignore', timeout: 10000 }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  if (op === 'listDirSync') return listDir(args[0], args[1]);
  if (op === 'countTreeSync') return countTree(args[0], args[1]);
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
module.exports = { executeFs, encode, decode, listDir, countTree, folderOrder };
