// Native fs outside principal-owned directories; brokered fs inside them.
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough, Writable } = require('node:stream');
const SYNC = ['readFileSync','writeFileSync','appendFileSync','statSync','lstatSync','readdirSync','existsSync','realpathSync','mkdirSync','rmSync','rmdirSync','unlinkSync','copyFileSync','renameSync','chmodSync','accessSync'];
function encode(v) { return Buffer.isBuffer(v) ? { $buffer: v.toString('base64') } : Array.isArray(v) ? v.map(encode) : v; }
function decode(v) {
  if (!v || typeof v !== 'object') return v;
  if (v.$buffer !== undefined) return Buffer.from(v.$buffer, 'base64');
  if (v.$stats) {
    const result = Object.assign(Object.create(fs.Stats.prototype), v.$stats);
    for (const key of ['atime','mtime','ctime','birthtime']) if (result[key]) result[key] = new Date(result[key]);
    return result;
  }
  if (v.$dirent) {
    const result = { name: v.$dirent.name, parentPath: v.$dirent.parentPath, path: v.$dirent.parentPath };
    for (const type of ['File','Directory','BlockDevice','CharacterDevice','SymbolicLink','FIFO','Socket']) result['is' + type] = () => type === v.$dirent.type;
    return result;
  }
  return Array.isArray(v) ? v.map(decode) : v;
}
function createPrincipalFs({ dataDir = process.env.BOT_DOT_DATA || path.join(__dirname, '..', 'data'), client, enabled } = {}) {
  const root = path.resolve(dataDir);
  const getClient = () => client || require('./privilege-client');
  const active = () => enabled === undefined ? !!process.env.BOT_DOT_PRIVILEGE_SOCKET : enabled;
  function principal(name) {
    if (!active() || typeof name !== 'string') return null;
    // Inspect the lexical principal prefix before resolve() can erase a ../
    // escape and accidentally route it through the ordinary server filesystem.
    const lexical = name.split(path.sep);
    if (lexical.includes('..')) {
      for (let i = 0; i < lexical.length; i++) {
        if (['workspaces', 'homes'].includes(lexical[i]) && path.resolve(lexical.slice(0, i).join(path.sep) || '.') === root) {
          throw Object.assign(new Error('Principal filesystem access denied'), { code: 'EACCES' });
        }
      }
    }
    const rel = path.relative(root, path.resolve(name));
    const [area, id] = rel.split(path.sep);
    if (!['workspaces','homes'].includes(area) || !id) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || name.split(path.sep).includes('..')) throw Object.assign(new Error('Principal filesystem access denied'), { code: 'EACCES' });
    return area === 'workspaces' && id === '_chief' ? 'chief' : id;
  }
  function routing(op, args) {
    const id = principal(args[0]);
    if (op === 'copyFileSync' || op === 'renameSync') {
      const other = principal(args[1]);
      if (id !== other) throw Object.assign(new Error('Cross-principal file operation denied'), { code: 'EACCES' });
    }
    return id;
  }
  const api = Object.create(fs);
  api.initWorkspace = (dir) => {
    const id = principal(dir);
    if (id) {
      const response = getClient().callSync('files', { principal: id, request: { op: 'initWorkspace', args: [path.resolve(dir)] } });
      if (response?.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(path.join(dir, '.git'))) return;
    try { require('node:child_process').execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore', timeout: 10000 }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  for (const op of SYNC) {
    api[op] = (...args) => {
      if (op === 'copyFileSync' && principal(args[0]) !== principal(args[1])) {
        const sourceStat = api.statSync(args[0]);
        const size = sourceStat.size;
        if (size > 50 * 1024 * 1024) throw Object.assign(new Error('Cross-principal file exceeds 50 MiB'), { code: 'EFBIG' });
        const bytes = api.readFileSync(args[0]);
        if (bytes.length > 50 * 1024 * 1024) throw Object.assign(new Error('Cross-principal file exceeds 50 MiB'), { code: 'EFBIG' });
        api.writeFileSync(args[1], bytes, { mode: sourceStat.mode & 0o777, flag: args[2] & fs.constants.COPYFILE_EXCL ? 'wx' : 'w' });
        return api.chmodSync(args[1], sourceStat.mode & 0o777);
      }
      const id = routing(op, args);
      if (!id) return fs[op](...args);
      try {
        args[0] = path.resolve(args[0]);
        if (op === 'copyFileSync' || op === 'renameSync') args[1] = path.resolve(args[1]);
        const response = getClient().callSync('files', { principal: id, request: { op, args: encode(args) } });
        if (response?.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
        return decode(response?.value);
      } catch (error) { if (op === 'existsSync') return false; throw error; }
    };
    const asyncOp = op.replace(/Sync$/, '');
    api[asyncOp] = (...args) => {
      if (!principal(args[0]) && !(op === 'copyFileSync' && principal(args[1]))) return fs[asyncOp](...args);
      const cb = args.pop();
      queueMicrotask(() => { let result; try { result = api[op](...args); } catch (error) { cb(error); return; } if (asyncOp === 'exists') cb(result); else cb(null, result); });
    };
  }
  const promises = Object.create(fs.promises);
  for (const op of SYNC.filter(op => op !== 'existsSync')) promises[op.replace(/Sync$/, '')] = async (...args) => api[op](...args);
  Object.defineProperty(api, 'promises', { value: promises });
  for (const op of ['createReadStream','createWriteStream']) api[op] = (name, options) => {
    const id = principal(name);
    if (!id) return fs[op](name, options);
    const child = getClient().spawnFsStream({ principal: id, op, args: [path.resolve(name), options] });
    let failure, closed = false, finalCallback;
    child.stderr?.on('data', () => {}); // Never expose worker paths or content in errors.
    const stream = op === 'createReadStream' ? new PassThrough() : new Writable({
      write(chunk, encoding, cb) { child.stdin.write(chunk, encoding, cb); },
      final(cb) { finalCallback = cb; child.stdin.end(); if (closed) cb(failure); },
      destroy(error, cb) { child.kill(); cb(error); },
    });
    child.on('error', error => { failure = error; stream.destroy(error); });
    child.stdin?.on('error', error => { failure = error; stream.destroy(error); });
    child.on('close', code => {
      closed = true;
      if (code !== 0 && !failure) failure = Object.assign(new Error('Principal file stream failed'), { code: 'EIO' });
      if (failure) stream.destroy(failure);
      if (finalCallback) { const cb = finalCallback; finalCallback = null; cb(failure); }
      if (op === 'createReadStream' && !failure) stream.end();
    });
    if (op === 'createReadStream') {
      child.stdout.pipe(stream, { end: false });
      child.stdout.on('error', error => stream.destroy(error));
      stream.on('close', () => { if (!closed) child.kill(); });
    }
    return stream;
  };
  return api;
}
module.exports = createPrincipalFs();
module.exports.createPrincipalFs = createPrincipalFs;
