// The only root process in the app container. It has no Docker socket. Requests select a
// principal and a fixed operation; neither a root command nor an arbitrary chown is expressible.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const cp = require('node:child_process');
const toolsWorker = require('./tools-worker');
const SERVER_UID = 60000, CHIEF_UID = 60500, FIRST_UID = 61000, LAST_UID = 61999;
// The tools user (ADR 007): it owns every bot's installed tools and runs the installer; nobody signs in as it.
const TOOLS_UID = 60400;
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
// git's GIT_CONFIG_KEY_<n> holds the name of a setting, never a secret (a bot's run sets git up with it, ADR 090).
const GIT_SETTING = /^GIT_CONFIG_KEY_\d+$/;
const SECRET = /TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE|BW_SESSION|_KEY(?:_|$)|^NODE_OPTIONS$|^LD_|^DYLD_|^BOT_DOT_/i;
const MAX = 128 * 1024 * 1024;
function principalName(value) {
  if (typeof value !== 'string' || !ID.test(value) || value === '_chief') throw new Error('Invalid principal');
  return value;
}
function nofollowOpen(file, flags = fs.constants.O_RDONLY) {
  return fs.openSync(file, flags | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
}
function readIds(dataDir) {
  const file = path.join(dataDir, 'identities.json');
  let fd;
  try { fd = nofollowOpen(file); } catch (e) { if (e.code === 'ENOENT') return { bots: {} }; throw e; }
  try {
    const st = fs.fstatSync(fd); if (!st.isFile() || st.nlink !== 1) throw new Error('Unsafe identities file');
    const ids = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!ids || !ids.bots || typeof ids.bots !== 'object' || Array.isArray(ids.bots)) throw new Error('Invalid identities');
    const used = new Set();
    for (const [name, uid] of Object.entries(ids.bots)) {
      principalName(name);
      if (name === 'chief' || !Number.isInteger(uid) || uid < FIRST_UID || uid > LAST_UID || used.has(uid)) throw new Error('Invalid principal UID mapping');
      used.add(uid);
    }
    return ids;
  } finally { fs.closeSync(fd); }
}
function ensureUser(uid, name, home) {
  if (!Number.isInteger(uid) || !(uid === SERVER_UID || uid === TOOLS_UID || uid === CHIEF_UID || uid >= FIRST_UID && uid <= LAST_UID)) throw new Error('Invalid principal UID');
  const passwd = fs.readFileSync('/etc/passwd', 'utf8').split('\n').filter(Boolean).map((l) => l.split(':'));
  const existing = passwd.find((p) => Number(p[2]) === uid || p[0] === name);
  if (existing) { if (existing[0] !== name || Number(existing[2]) !== uid || Number(existing[3]) !== uid) throw new Error(`Conflicting account for ${name}`); return; }
  const groups = fs.readFileSync('/etc/group', 'utf8').split('\n').filter(Boolean).map((l) => l.split(':'));
  const group = groups.find((g) => Number(g[2]) === uid || g[0] === name);
  if (group && (group[0] !== name || Number(group[2]) !== uid)) throw new Error(`Conflicting group for ${name}`);
  if (!group) fs.appendFileSync('/etc/group', `${name}:x:${uid}:\n`);
  fs.appendFileSync('/etc/passwd', `${name}:x:${uid}:${uid}:bot-dot:${home}:/bin/bash\n`);
}
// Pin every directory and file before changing ownership. No following links, including during
// concurrent renames; special files and multiply-linked files are never migrated as privileged data.
function ownTree(file, uid, gid = uid, { recursive = true, mode, directoryOnly = false, readOnlyGroup = false, principalTree = false } = {}) {
  if (principalTree) {
    const kind = fs.lstatSync(file);
    if (!kind.isDirectory() && !kind.isFile() && !kind.isSymbolicLink()) return;
  }
  const fd = nofollowOpen(file);
  try {
    const st = fs.fstatSync(fd);
    if (directoryOnly && !st.isDirectory()) throw new Error('Expected a directory');
    if (!st.isDirectory() && !st.isFile()) { if (principalTree) return; throw new Error(`Unsafe special file: ${file}`); }
    if (st.isFile() && st.nlink !== 1) {
      if (principalTree && st.uid === uid) return; // already isolated; do not mutate its other links
      throw new Error(`Refusing hard-linked file: ${file}`);
    }
    if (st.isDirectory() && recursive) {
      for (const name of fs.readdirSync(`/proc/self/fd/${fd}`)) {
        const child = `/proc/self/fd/${fd}/${name}`;
        if (fs.lstatSync(child).isSymbolicLink()) continue; // keep links as links; never change their target
        ownTree(child, uid, gid, { readOnlyGroup, principalTree });
      }
    }
    fs.fchownSync(fd, uid, gid);
    fs.fchmodSync(fd, readOnlyGroup ? (st.isDirectory() || (st.mode & 0o111) ? 0o750 : 0o640) : mode === undefined ? (st.mode & 0o777) & ~0o007 : mode);
  } finally { fs.closeSync(fd); }
}
function directory(dir, uid, gid, mode) {
  try { fs.mkdirSync(dir, { mode }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  ownTree(dir, uid, gid, { recursive: false, mode, directoryOnly: true });
}
// toolsCache: micromamba's cache and the tools user's home. It is not data: it lives in the container's own
// filesystem, is gone after an update and is never backed up. (Where the data folder refuses the installer's
// copy, the worker keeps a second cache in data/tools/.cache for the length of one install: tools-worker.js.)
// linkCa: the certificate of the tests' own file server, for a tool from a link. main() gives none, and no
// request and no environment can: in the product a link is fetched with the system's certificates only.
function createBroker({ dataDir, socket, claudeBin = process.env.CLAUDE_BIN || '/usr/local/bin/claude', micromambaBin = process.env.MICROMAMBA_BIN || '/usr/local/bin/micromamba', toolsCache = process.env.BOT_DOT_TOOLS_CACHE || '/var/cache/botdot-tools', linkCa = null }) {
  dataDir = path.resolve(dataDir);
  toolsCache = path.resolve(toolsCache);
  const processes = new Set();
  function principal(who, create = true) {
    principalName(who);
    const ids = readIds(dataDir);
    let uid = who === 'chief' ? CHIEF_UID : Object.hasOwn(ids.bots, who) ? ids.bots[who] : undefined;
    if (!uid && create) {
      const used = new Set(Object.values(ids.bots)); uid = FIRST_UID;
      while (used.has(uid) && uid <= LAST_UID) uid++;
      if (uid > LAST_UID) throw new Error('Too many bots for separate users');
      ids.bots[who] = uid;
      const temp = path.join(dataDir, `.identities-${process.pid}-${require('node:crypto').randomBytes(8).toString('hex')}`);
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(ids, null, 2) + '\n'); fs.fchownSync(fd, SERVER_UID, SERVER_UID); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, path.join(dataDir, 'identities.json'));
    }
    if (!Number.isInteger(uid) || !(who === 'chief' ? uid === CHIEF_UID : uid >= FIRST_UID && uid <= LAST_UID)) throw new Error('Invalid principal UID');
    return { who, uid, home: path.join(dataDir, 'homes', who), cwd: path.join(dataDir, 'workspaces', who === 'chief' ? '_chief' : who) };
  }
  function inArea(area, action) {
    const rootFd = nofollowOpen(dataDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    let areaFd;
    try {
      areaFd = nofollowOpen(`/proc/self/fd/${rootFd}/${area}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      return action(`/proc/self/fd/${areaFd}`);
    } finally { if (areaFd !== undefined) fs.closeSync(areaFd); fs.closeSync(rootFd); }
  }
  function prepare(who, extraDirs = []) {
    if (process.getuid() !== 0) throw new Error('Privilege broker requires root');
    const p = principal(who);
    ensureUser(p.uid, who === 'chief' ? 'botdot-chief' : `botdot-${p.uid}`, p.home);
    inArea('homes', (area) => directory(`${area}/${who}`, p.uid, p.uid, 0o700));
    inArea('workspaces', (area) => directory(`${area}/${who === 'chief' ? '_chief' : who}`, p.uid, who === 'chief' ? p.uid : CHIEF_UID, who === 'chief' ? 0o700 : 0o750));
    for (const dir of extraDirs) {
      const root = path.join(dataDir, 'skill-packs'); const rel = path.relative(root, dir);
      if (!ID.test(rel) || path.dirname(dir) !== root) throw new Error('Invalid skill pack');
      inArea('skill-packs', (area) => ownTree(`${area}/${rel}`, SERVER_UID, p.uid, { directoryOnly: true, readOnlyGroup: true }));
    }
    return p;
  }
  // A bot's installed tools (ADR 007). The request names a bot, a tool and a list of registry packages, or
  // for a tool from a link one https address, its sha256 and the command's name, and nothing else: no path
  // and no command line. The tools user does the work, the download and the unpacking included; root only
  // makes the folders: the bot's own belongs to the tools user with the bot's group, mode 0750, so that bot
  // runs its tools, cannot change them, and no other bot gets in.
  function toolsWork(request) {
    const checked = toolsWorker.request(request.operation, request, { root: dataDir, cache: toolsCache, micromamba: micromambaBin, ca: linkCa });
    if (process.getuid() !== 0) throw new Error('Privilege broker requires root');
    ensureUser(TOOLS_UID, 'botdot-tools', path.join(toolsCache, 'home'));
    fs.mkdirSync(toolsCache, { recursive: true, mode: 0o700 });
    directory(toolsCache, TOOLS_UID, TOOLS_UID, 0o700);
    directory(path.join(dataDir, 'tools'), TOOLS_UID, TOOLS_UID, 0o755);
    if (checked.op === 'install' || checked.op === 'installLink') {
      const p = prepare(checked.bot);
      inArea('tools', (area) => directory(`${area}/${checked.bot}`, TOOLS_UID, p.uid, 0o750));
    }
    return toolsWorker.spawn(checked, { uid: TOOLS_UID, gid: TOOLS_UID });
  }
  function cleanEnv(input, p, claude = false) {
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' };
    for (const [key, value] of Object.entries(input || {})) {
      if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid process environment');
      if (!SECRET.test(key) || GIT_SETTING.test(key) || (claude && (key === 'CLAUDE_CODE_OAUTH_TOKEN' || key === 'ANTHROPIC_API_KEY'))) env[key] = value;
    }
    return { ...env, HOME: p.home, USER: p.who === 'chief' ? 'botdot-chief' : `botdot-${p.uid}`, LOGNAME: p.who === 'chief' ? 'botdot-chief' : `botdot-${p.uid}` };
  }
  function fileWorker(p, request) {
    if (!request || typeof request.op !== 'string' || !Array.isArray(request.args)) throw new Error('Invalid file request');
    return cp.spawn(process.execPath, [path.join(__dirname, 'principal-fs-worker.js')], {
      uid: p.uid, gid: p.uid, cwd: '/', env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, detached: true,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
  }
  function kill(child, signal = 'SIGKILL') { try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') console.error('Broker cancellation failed:', e.message); } }
  const server = net.createServer((connection) => {
    connection.setEncoding('utf8');
    let buffer = ''; let started = false; let child = null; let done = false;
    const send = (message) => { if (!connection.destroyed && !connection.write(JSON.stringify(message) + '\n')) { child?.stdout.pause(); child?.stderr.pause(); } };
    connection.on('drain', () => { child?.stdout.resume(); child?.stderr.resume(); });
    const fail = (e) => { send({ error: { message: e.message, code: e.code } }); connection.end(); };
    const runWorker = (p, request, stream) => {
      child = fileWorker(p, request);
      child.stdio[3].on('error', () => {});
      child.stdio[3].end(JSON.stringify({ ...request, root: dataDir, principal: p.who }));
      if (!stream) child.stdin.end();
      wire(stream);
    };
    const wire = (stream = true) => {
      child.stdin.on('error', () => {});
      child.stdin.on('drain', () => connection.resume());
      if (!stream) child.stdout.setEncoding('utf8');
      processes.add(child); let output = ''; let error = '';
      child.stdout.on('data', (b) => { if (stream) send({ stdout: b.toString('base64') }); else { output += b; if (output.length > MAX) kill(child); } });
      child.stderr.on('data', (b) => { if (stream) send({ stderr: b.toString('base64') }); else error = (error + b).slice(-4096); });
      child.on('error', fail);
      // 'close' waits for inherited pipes: kill the remaining process group as soon as the
      // shell exits so background descendants cannot keep those pipes (and the run) alive.
      child.on('exit', () => { kill(child); processes.delete(child); });
      child.on('close', (code) => {
        processes.delete(child); done = true;
        if (stream) send({ exit: code });
        else { try { if (code && !output) throw new Error(error || 'Principal file operation failed'); send({ value: JSON.parse(output) }); } catch (e) { fail(e); } }
        connection.end();
      });
    };
    function begin(request) {
      const { operation, principal: who } = request;
      if (operation === 'ping') { send({ value: { uid: process.getuid(), serverUid: SERVER_UID } }); connection.end(); return; }
      if (!['prepare', 'privateFile', 'files', 'fileStream', 'spawn', 'toolResolve', 'toolInstall', 'toolRemove', 'toolFetch', 'toolInstallLink'].includes(operation)) throw new Error('Unsupported privilege broker operation');
      if (operation.startsWith('tool')) { child = toolsWork(request); wire(false); return; }
      principalName(who);
      const expectedCwd = path.join(dataDir, 'workspaces', who === 'chief' ? '_chief' : who);
      if (operation === 'spawn') {
        if (request.cwd !== expectedCwd) throw new Error('Process cwd must be its principal workspace');
        if (![claudeBin, '/bin/bash'].includes(request.command)) throw new Error('Unsupported executable');
        if (!Array.isArray(request.args) || request.args.some((a) => typeof a !== 'string' || a.includes('\0'))) throw new Error('Invalid process arguments');
      }
      const p = prepare(who, operation === 'prepare' ? request.extraDirs || [] : []);
      if (operation === 'prepare') { send({ value: p }); connection.end(); return; }
      if (operation === 'privateFile') {
        if (typeof request.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(request.name) || typeof request.content !== 'string') throw new Error('Invalid private file');
        runWorker(p, { op: 'writeFileSync', args: [path.join(p.home, request.name), request.content, { mode: 0o600, flag: 'wx' }] }, false); return;
      }
      if (operation === 'files' || operation === 'fileStream') { runWorker(p, request.request, operation === 'fileStream'); return; }
      child = cp.spawn(request.command, request.args, { cwd: p.cwd, uid: p.uid, gid: p.uid, env: cleanEnv(request.env, p, request.command === claudeBin), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      wire();
    }
    connection.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX) { fail(new Error('Privilege broker request too large')); connection.destroy(); return; }
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const request = JSON.parse(line);
          if (!started) { started = true; begin(request); }
          else if (child && !done) {
            if (request.stdin !== undefined && !child.stdin.write(Buffer.from(request.stdin, 'base64'))) connection.pause();
            if (request.end) child.stdin.end();
            if (request.signal) { if (!['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGKILL'].includes(request.signal)) throw new Error('Invalid signal'); kill(child, request.signal); }
          }
        } catch (e) { fail(e); }
      }
    });
    connection.on('error', () => {});
    connection.on('close', () => { if (child && !done) kill(child); });
  });
  server.stopChildren = () => { for (const child of processes) kill(child); };
  return server;
}
function migrate(dataDir, home, config) {
  ensureUser(SERVER_UID, 'botdot-server', home);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o711 });
  directory(dataDir, SERVER_UID, SERVER_UID, 0o711);
  for (const name of fs.readdirSync(dataDir)) {
    if (['homes', 'workspaces', 'skill-packs', 'tools'].includes(name)) continue; // tools: the tools user's, set by toolsWork()
    const file = path.join(dataDir, name);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing linked server data: ${name}`);
    if (name === 'backups') {
      // Replaced data is an untouched recovery snapshot, not active server state. Preserve
      // only the exact names made by applyPendingRestore, and only inside this directory.
      const fd = nofollowOpen(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try {
        for (const entry of fs.readdirSync(`/proc/self/fd/${fd}`)) {
          const child = `/proc/self/fd/${fd}/${entry}`;
          if (/^replaced-\d{14}$/.test(entry) && fs.lstatSync(child).isDirectory()) continue;
          ownTree(child, SERVER_UID, SERVER_UID);
        }
        fs.fchownSync(fd, SERVER_UID, SERVER_UID); fs.fchmodSync(fd, 0o700);
      } finally { fs.closeSync(fd); }
    } else ownTree(file, SERVER_UID, SERVER_UID);
  }
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const homeFd = nofollowOpen(home, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    for (const name of fs.readdirSync(`/proc/self/fd/${homeFd}`)) {
      const entry = `/proc/self/fd/${homeFd}/${name}`;
      if (name === '.docker') {
        ownTree(entry, 0, 0, { directoryOnly: true });
        directory(entry, 0, 0, 0o700);
      } else if (!fs.lstatSync(entry).isSymbolicLink()) ownTree(entry, SERVER_UID, SERVER_UID);
    }
    // Keep the parent root-owned and sticky: the server may create its own home state, but
    // cannot rename .docker and trick the next migration into handing it registry secrets.
    fs.fchownSync(homeFd, 0, SERVER_UID); fs.fchmodSync(homeFd, 0o1770);
  } finally { fs.closeSync(homeFd); }
  fs.mkdirSync(config, { recursive: true, mode: 0o700 });
  ownTree(config, SERVER_UID, SERVER_UID); directory(config, SERVER_UID, SERVER_UID, 0o700);
  const ids = readIds(dataDir);
  for (const name of ['homes', 'workspaces', 'skill-packs']) directory(path.join(dataDir, name), SERVER_UID, SERVER_UID, 0o711);
  const principals = [['chief', CHIEF_UID], ...Object.entries(ids.bots)];
  for (const [who, uid] of principals) {
    const pHome = path.join(dataDir, 'homes', who);
    const workspace = path.join(dataDir, 'workspaces', who === 'chief' ? '_chief' : who);
    ensureUser(uid, who === 'chief' ? 'botdot-chief' : `botdot-${uid}`, pHome);
    // A tree whose own folder is the principal's already was walked to its end (ownTree owns a folder after what it
    // holds), and only the principal writes inside it since: only its folder is set again. A bot's workspace of
    // millions of files took minutes on each start under gVisor (#521).
    for (const dir of [pHome, workspace]) {
      fs.mkdirSync(dir, { recursive: true });
      const gid = dir === workspace && who !== 'chief' ? CHIEF_UID : uid;
      const st = fs.lstatSync(dir);
      ownTree(dir, uid, gid, { principalTree: true, recursive: !(st.isDirectory() && st.uid === uid && st.gid === gid) });
    }
    directory(pHome, uid, uid, 0o700); directory(workspace, uid, who === 'chief' ? uid : CHIEF_UID, who === 'chief' ? 0o700 : 0o750);
  }
  // Abandoned packs are ephemeral and will be replaced by the server before the next run.
  ownTree(path.join(dataDir, 'skill-packs'), SERVER_UID, SERVER_UID);
  directory(path.join(dataDir, 'skill-packs'), SERVER_UID, SERVER_UID, 0o711);
}
async function main() {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('The privilege supervisor must start as root on Linux');
  process.umask(0o077); process.setgroups([]);
  const dataDir = path.resolve(process.env.BOT_DOT_DATA || path.join(__dirname, '..', 'data'));
  const home = process.env.HOME || '/root';
  const config = path.dirname(process.env.BOT_DOT_VAULT_KEY_FILE || '/config/vault.key');
  // Application restore logic handles server-controlled paths and must never run as root.
  // Normalize old installations first, apply as the server, then assign restored principal data.
  migrate(dataDir, home, config);
  if (fs.existsSync(path.join(dataDir, '.restore-pending', 'ready.json'))) {
    const restore = cp.spawnSync(process.execPath, ['-e', 'require(process.argv[1]).applyPendingRestore(process.argv[2])', path.join(__dirname, 'backup.js'), dataDir], {
      uid: SERVER_UID, gid: SERVER_UID, env: { ...process.env, HOME: home, BOT_DOT_PRIVILEGE_SOCKET: '', BOT_DOT_REGISTRY_TOKEN: '' }, stdio: 'inherit', timeout: 120_000,
    });
    if (restore.error || restore.status !== 0) throw restore.error || new Error('Pending restore failed');
    migrate(dataDir, home, config);
  }
  // The folder of the front door's socket (ADR 028): botdot's user's alone, which the socket's front door runs as
  // where it has a container of its own (compose.mac.yaml) and a volume made by root. Made only when missing: a folder
  // the installer made (compose.yaml) keeps its owner, mode and ACL, which let the front door's group through.
  if (process.env.BOT_DOT_FRONT_DOOR_SOCKET) {
    const doorDir = path.dirname(path.resolve(process.env.BOT_DOT_FRONT_DOOR_SOCKET));
    if (!fs.existsSync(doorDir)) directory(doorDir, SERVER_UID, SERVER_UID, 0o700);
  }
  const runtime = '/run/botdot-privilege';
  fs.mkdirSync(runtime, { recursive: true, mode: 0o711 }); directory(runtime, 0, 0, 0o711);
  const socket = path.join(runtime, 'broker.sock');
  try { fs.unlinkSync(socket); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const broker = createBroker({ dataDir, socket });
  await new Promise((resolve, reject) => { broker.once('error', reject); broker.listen(socket, resolve); });
  fs.chownSync(socket, SERVER_UID, SERVER_UID); fs.chmodSync(socket, 0o600);
  const serverEnv = { ...process.env }; delete serverEnv.BOT_DOT_REGISTRY_TOKEN;
  const child = cp.spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    uid: SERVER_UID, gid: SERVER_UID, cwd: path.join(__dirname, '..'), stdio: 'inherit',
    env: { ...serverEnv, HOME: home, USER: 'botdot-server', LOGNAME: 'botdot-server', BOT_DOT_PRIVILEGE_SOCKET: socket, BOT_DOT_SEPARATE_USERS: '1' },
  });
  const stop = (signal) => { child.kill(signal); broker.stopChildren(); };
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));
  child.on('error', (e) => { console.error(e); broker.stopChildren(); broker.close(() => process.exit(1)); });
  child.on('exit', (code) => { broker.stopChildren(); broker.close(() => process.exit(code === null ? 1 : code)); });
}
module.exports = { createBroker, migrate, SERVER_UID, CHIEF_UID, TOOLS_UID };
if (require.main === module) main().catch((e) => { console.error(`[privilege] ${e.message}`); process.exit(1); });
