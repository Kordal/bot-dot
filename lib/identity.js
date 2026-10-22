// Linux production runs the HTTP server as UID 60000. The private privilege broker prepares
// each Chief/bot identity and launches its processes; the server has no setuid capabilities.
// Legacy root fixtures keep their direct identity path; local Mac development uses its owner.
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const { execFileSync, execFile } = require('child_process');
const broker = require('./privilege-client');
const pfs = require('./principal-fs'); // a file in a bot's or the Chief's home is reached as that user, where the broker runs

// Claude Code's own memory is off for a bot and for the Chief (ADR 014): it loads no CLAUDE.md (the user's, a
// project's, or AGENTS.md in their place) and reads and writes no auto-memory files. botdot's memory is the only
// one they keep: what a bot would leave itself there, no cap, approval or forget of botdot reaches.
// And it sends nothing beyond its requests to the model (#205): no feature flags, telemetry or update checks, which
// cost a run about 0.3 s at its start and 0.5 s between its result and its exit.
const OWN_MEMORY_OFF = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
// The plan a bot or the Chief keeps for work of several steps (lib/plan.js, ADR 057) is Claude Code's TodoWrite, one
// whole list per call. Claude Code gives the newest models no plan tool unless asked, and the Task tools in its place
// when asked: these two switches give every model TodoWrite and nothing else.
const PLAN_TOOL_ON = { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1', CLAUDE_CODE_ENABLE_TASKS: 'false' };

const CHIEF_UID = 60500;
const FIRST_BOT_UID = 61000;
const LAST_BOT_UID = 61999;
// The tools user (ADR 007, privilege-broker.js): it downloads and unpacks what bots get installed, and nobody
// signs in as it. It is nobody botdot answers.
const TOOLS_UID = 60400;

// Who a connection from this machine belongs to, by the user that opened it: 'owner' | 'chief' | { bot } |
// 'unknown'. uid: null when the user could not be told. bots: { botId: uid }. The owner is whoever is none of
// botdot's own users: with host networking the owner's own programs on the machine connect this way.
function whoHas(uid, bots = {}) {
  if (uid === null || uid === TOOLS_UID) return 'unknown'; // never guessed; and the installer's user is a stranger
  if (uid === CHIEF_UID) return 'chief';
  if (uid >= FIRST_BOT_UID && uid <= LAST_BOT_UID) return { bot: Object.keys(bots).find((k) => bots[k] === uid) || '?' };
  return 'owner';
}

function create(dataDir, { claudeBin }) {
  const brokered = !!process.env.BOT_DOT_PRIVILEGE_SOCKET;
  if (process.platform === 'linux' && process.env.BOT_DOT_SEPARATE_USERS === '1' && process.getuid() !== 0 && !brokered) throw new Error('Separate users require the privilege broker');
  if (brokered) broker.callSync('ping');
  const enabled = brokered || process.platform === 'linux'
    && typeof process.getuid === 'function' && process.getuid() === 0
    && process.env.BOT_DOT_SEPARATE_USERS !== '0'
    && (process.env.BOT_DOT_SEPARATE_USERS === '1' || fs.existsSync('/.dockerenv'));

  const claudeKey = require('./claude-key').create(dataDir);
  const FILE = path.join(dataDir, 'identities.json');
  const HOMES = path.join(dataDir, 'homes');
  const WORKSPACES = path.join(dataDir, 'workspaces');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { bots: {} }; } };
  let ids = load();
  const save = () => fs.writeFileSync(FILE, JSON.stringify(ids, null, 2) + '\n', { mode: 0o600 });

  // ---------- users ----------

  const known = new Set();
  function ensureUser(uid, name, home) {
    if (!Number.isInteger(uid) || !(uid === CHIEF_UID || uid >= FIRST_BOT_UID && uid <= LAST_BOT_UID)) throw new Error('Invalid principal UID');
    if (known.has(uid)) return;
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    if (!passwd.split('\n').some((l) => l.split(':')[2] === String(uid))) {
      fs.appendFileSync('/etc/group', `${name}:x:${uid}:\n`);
      fs.appendFileSync('/etc/passwd', `${name}:x:${uid}:${uid}:bot-dot:${home}:/bin/bash\n`);
    }
    known.add(uid);
  }

  function uidForBot(botId) {
    if (brokered) { const p = broker.callSync('prepare', { principal: botId }); ids = load(); return p.uid; }
    if (Object.hasOwn(ids.bots, botId)) {
      const uid = ids.bots[botId];
      if (!Number.isInteger(uid) || uid < FIRST_BOT_UID || uid > LAST_BOT_UID) throw new Error('Invalid principal UID');
      return uid;
    }
    const used = new Set(Object.values(ids.bots));
    let uid = FIRST_BOT_UID;
    while (used.has(uid) && uid <= LAST_BOT_UID) uid++;
    if (uid > LAST_BOT_UID) throw new Error('Too many bots for separate users');
    ids.bots[botId] = uid;
    save();
    return uid;
  }

  const homeOf = (who) => path.join(HOMES, who);

  // Hand a folder (and everything in it) to a user. The Chief's group may read bots' workspaces.
  function giveTo(dir, uid, gid = uid, mode = 0o700) {
    fs.mkdirSync(dir, { recursive: true });
    try { execFileSync('chown', ['-R', `${uid}:${gid}`, dir], { stdio: 'ignore' }); } catch { /* best effort */ }
    fs.chmodSync(dir, mode);
  }

  // ---------- data folder ----------

  // Once at start: new files are private to root, and existing ones become so. Bots and the Chief
  // can only pass through the data folder to reach their own folders in it.
  function lockDown() {
    if (!enabled) return;
    if (brokered) { process.umask(0o077); return; }
    process.umask(0o077);
    for (const d of [dataDir, WORKSPACES, HOMES, path.join(dataDir, 'skill-packs')]) {
      fs.mkdirSync(d, { recursive: true });
      fs.chmodSync(d, 0o711);
    }
    for (const name of fs.readdirSync(dataDir)) {
      if (['workspaces', 'homes', 'skill-packs'].includes(name)) continue;
      try { execFileSync('chmod', ['-R', 'go-rwx', path.join(dataDir, name)], { stdio: 'ignore' }); } catch { /* best effort */ }
    }
    for (const d of ['/root', '/config', path.dirname(process.env.BOT_DOT_VAULT_KEY_FILE || '/config/x')]) {
      try { fs.chmodSync(d, 0o700); } catch { /* not there */ }
    }
    ensureUser(CHIEF_UID, 'botdot-chief', homeOf('chief'));
    giveTo(homeOf('chief'), CHIEF_UID);
  }

  // ---------- running as someone ----------

  // Things that must not reach a bot or the Chief, even through their own environment.
  const SECRET_ENV = /TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE|BW_SESSION|_KEY(?:_|$)/i;
  function cleanEnv(env) {
    const out = {};
    for (const [k, v] of Object.entries(env)) if (!SECRET_ENV.test(k)) out[k] = v;
    return out;
  }

  // Options for spawn(): who = 'chief' or a bot id. cwd is handed to that user first.
  // Returns { uid, gid, env } to merge into the spawn options, or {} when separate users are off.
  // claude: the process is Claude Code (not a script job). Its own memory and its non-essential traffic are then off (OWN_MEMORY_OFF), and its plan
  // tool is TodoWrite (PLAN_TOOL_ON).
  function runAs(who, { cwd, env, extraDirs = [], claude = true }) {
    const off = claude ? { ...OWN_MEMORY_OFF, ...PLAN_TOOL_ON } : {};
    // On the owner's Anthropic API key (#35), Claude Code gets it in ANTHROPIC_API_KEY and no subscription token.
    const apiKey = claude ? claudeKey.runKey() : null;
    // Local development still uses the owner's Claude sign-in, but never server keys.
    if (!enabled) {
      const own = Object.fromEntries(Object.entries(env).filter(([k]) => !/_KEY(?:_|$)/i.test(k) && !(apiKey && /^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_AUTH_TOKEN)$/.test(k))));
      return { env: { ...own, ...off, ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}) } };
    }
    const signIn = () => {
      if (apiKey) return { ANTHROPIC_API_KEY: apiKey };
      const token = claude ? claudeToken() : null;
      return token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {};
    };
    if (brokered) {
      const prepared = broker.callSync('prepare', { principal: who, extraDirs });
      if (cwd && cwd !== prepared.cwd) throw new Error('Process cwd must be its principal workspace');
      ids = load();
      return { botdotPrincipal: who, env: { ...cleanEnv(env), ...off, HOME: prepared.home, ...signIn() } };
    }
    const chief = who === 'chief';
    const uid = chief ? CHIEF_UID : uidForBot(who);
    const home = homeOf(chief ? 'chief' : who);
    ensureUser(uid, chief ? 'botdot-chief' : `botdot-${uid}`, home);
    giveTo(home, uid);
    // Bots' workspaces: the Chief may look in (group), nobody else. The Chief's own: private.
    if (cwd) giveTo(cwd, uid, chief ? uid : CHIEF_UID, chief ? 0o700 : 0o750);
    for (const d of extraDirs) giveTo(d, uid);
    return {
      uid,
      gid: uid,
      env: {
        ...cleanEnv(env),
        ...off,
        HOME: home,
        USER: chief ? 'botdot-chief' : `botdot-${uid}`,
        LOGNAME: chief ? 'botdot-chief' : `botdot-${uid}`,
        ...signIn(),
      },
    };
  }

  // A private file for that user (e.g. a run's MCP settings, which hold its run token and would
  // otherwise sit on the command line, where every user can read it).
  function privateFile(who, name, content) {
    if (brokered) {
      const unique = `${require('crypto').randomBytes(8).toString('hex')}-${name}`;
      const result = broker.callSync('privateFile', { principal: who, name: unique, content });
      if (result?.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
      return path.join(homeOf(who), unique);
    }
    const dir = privateDir(who);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, name);
    // Made anew, and everything else done to the file that was made: where botdot is root the folder is that
    // user's own, and a link put there under this name is neither written through nor handed over.
    fs.rmSync(file, { force: true });
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, content);
      fs.fchmodSync(fd, 0o600);
      if (enabled) {
        const uid = who === 'chief' ? CHIEF_UID : uidForBot(who);
        fs.fchownSync(fd, uid, uid);
      }
    } finally { fs.closeSync(fd); }
    return file;
  }
  // Where a private file of that user is: its home, or one folder of the owner's where everything runs as them.
  const privateDir = (who) => (enabled ? homeOf(who) : path.join(dataDir, 'run-config'));

  // ---------- the prompt file (ADR 014) ----------

  // What a run or a Chief turn is told on top of Claude Code's own prompt (its instructions, its notes, its
  // chat) goes in a private file of the user it runs as, passed with --append-system-prompt-file: never an
  // argument, which every user of the machine can read. id: the run's id, or a name for a Chief turn.
  // Whoever starts the process removes the file when it has ended (removePrivate). One that botdot left because
  // it stopped or died meanwhile is removed when botdot starts again (sweepPromptFiles), and before that user's
  // first new one in any case.
  const PROMPT_FILE = /^(?:[0-9a-f]{16}-)?botdot-prompt-[\w.-]+\.txt$/; // the broker puts 16 hex characters in front
  function promptFile(who, id, text) {
    sweepPromptFilesOf(who);
    return privateFile(who, `botdot-prompt-${id}.txt`, text);
  }
  // Remove a private file this module wrote. Never throws: it is called where a run ends.
  function removePrivate(file) {
    if (!file) return;
    try { pfs.rmSync(file, { force: true }); } catch (e) { console.error(`[identity] couldn't remove ${path.basename(file)}: ${e.message}`); }
  }
  const swept = new Set(); // the folders looked through since botdot started
  function sweepPromptFilesOf(who) {
    const dir = privateDir(who);
    if (swept.has(dir)) return 0;
    swept.add(dir);
    let names = [];
    try { names = pfs.readdirSync(dir); } catch { return 0; } // no such folder yet: nothing was left in it
    const left = names.filter((name) => PROMPT_FILE.test(name));
    for (const name of left) removePrivate(path.join(dir, name));
    if (left.length) console.error(`[identity] removed ${left.length} prompt file${left.length === 1 ? '' : 's'} a stopped botdot left behind`);
    return left.length;
  }
  // Once, as botdot starts and before any run: every user's folder. With the broker each folder costs a
  // process, so those are looked through one after another once botdot is up; a run that starts before its
  // user's turn has come looks through that folder itself (promptFile).
  function sweepPromptFiles() {
    const all = enabled ? ['chief', ...Object.keys(ids.bots)] : ['chief'];
    if (!brokered) { for (const who of all) sweepPromptFilesOf(who); return; }
    const next = () => { const who = all.shift(); if (who === undefined) return; sweepPromptFilesOf(who); setTimeout(next, 50).unref(); };
    setTimeout(next, 50).unref();
  }

  // ---------- Claude sign-in for the Chief and bots ----------

  // They get only the short-lived access token from botdot's own sign-in, never the refresh
  // token; botdot renews the sign-in itself before the access token runs out.
  const CREDS = path.join(require('os').homedir(), '.claude', '.credentials.json');
  function readCreds() {
    try { return JSON.parse(fs.readFileSync(CREDS, 'utf8')).claudeAiOauth || null; } catch { return null; }
  }
  function claudeToken() {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN; // a long-lived token from `claude setup-token`
    const c = readCreds();
    return c && c.accessToken && c.expiresAt > Date.now() + 60_000 ? c.accessToken : null;
  }

  let renewing = null;
  let lastRenew = 0;
  function renew() {
    if (renewing || !claudeBin) return renewing;
    lastRenew = Date.now();
    // Any real request makes Claude Code refresh an expiring sign-in; this one is tiny.
    renewing = new Promise((resolve) => {
      execFile(claudeBin, ['-p', 'Reply with OK.', '--model', 'haiku', '--max-turns', '1'], { cwd: require('os').tmpdir(), timeout: 120_000 }, (err, stdout, stderr) => {
        if (!claudeToken()) console.error(`[claude] couldn't renew the sign-in: ${String(stderr || stdout || err?.message || '').trim().slice(0, 300) || 'no new token'}`);
        resolve();
      });
    }).finally(() => { renewing = null; });
    return renewing;
  }
  // Before a run starts: a sign-in that has run out (or is about to) is renewed first, so the run
  // doesn't start without a token and fail with "Not logged in".
  async function signedIn() {
    if (!enabled || claudeKey.runKey() || process.env.CLAUDE_CODE_OAUTH_TOKEN || claudeToken() || !readCreds()?.refreshToken) return;
    await renew();
  }
  function keepSignedIn() {
    if (!enabled) return;
    // Early tries every 10 minutes; in the last minutes every minute, since Claude Code may only
    // refresh a sign-in shortly before it runs out.
    const tick = () => {
      if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return;
      const c = readCreds();
      if (!c?.refreshToken) return;
      const left = c.expiresAt - Date.now();
      if (left < 6 * 60_000 || (left < 90 * 60_000 && Date.now() - lastRenew > 10 * 60_000)) renew();
    };
    tick();
    setInterval(tick, 60_000).unref();
  }

  // ---------- who is on the other end of a connection ----------

  // The user that opened a TCP connection from this machine, from the kernel's socket table (Linux):
  // the one socket whose own end is the client's address and port and whose other end is ours.
  function connectionUid(socket) {
    const tables = ['/proc/net/tcp', '/proc/net/tcp6'].map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });
    return uidInTables(tables, socket.remoteAddress, socket.remotePort, socket.localAddress, socket.localPort);
  }

  // 'owner' | 'chief' | { bot: botId } | 'unknown' for a request's socket. A connection from this
  // machine whose user can't be told for sure, or is the tools user, is 'unknown', and gets nowhere.
  function identify(socket) {
    if (!enabled) return 'owner';
    if (brokered) ids = load();
    if (socket._botdotWho) return socket._botdotWho;
    const who = isThisMachine(socket.remoteAddress || '') ? whoHas(connectionUid(socket), ids.bots) : 'owner';
    socket._botdotWho = who;
    return who;
  }

  return { enabled, brokered, spawn: broker.spawn, lockDown, runAs, privateFile, promptFile, removePrivate, sweepPromptFiles, identify, keepSignedIn, signedIn, uidForBot, CHIEF_UID };
}

// Whether a connection from this address was made on this machine: any loopback address (Linux lets
// any user pick one from all of 127.0.0.0/8), or one of this machine's own (with host networking a
// bot can also reach botdot on the VM's LAN or Tailscale address).
function isThisMachine(addr) {
  const a = String(addr).replace(/^::ffff:/i, '');
  if (a === '::1' || (net.isIPv4(a) && a.startsWith('127.'))) return true;
  return Object.values(os.networkInterfaces()).flat().some((i) => i && i.address.replace(/^::ffff:/i, '') === a);
}

// An address and port the way /proc/net/tcp{,6} write them: IPv4 as one little-endian 32-bit word,
// IPv6 as four; an IPv4 address also as IPv4-mapped IPv6 (for a server listening on ::).
function procAddrs(ip, port) {
  const p = `:${Number(port).toString(16).toUpperCase().padStart(4, '0')}`;
  const v4 = String(ip).replace(/^::ffff:/i, '');
  const word = (bytes) => bytes.slice().reverse().map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  if (net.isIPv4(v4)) {
    const w = word(v4.split('.').map(Number));
    return [`${w}${p}`, `0000000000000000FFFF0000${w}${p}`];
  }
  if (!net.isIPv6(ip)) return [];
  const [head, tail] = String(ip).split('%')[0].split('::');
  const groups = (s) => (s ? s.split(':') : []);
  const hs = groups(head);
  const ts = tail === undefined ? [] : groups(tail);
  const all = tail === undefined ? hs : [...hs, ...Array(8 - hs.length - ts.length).fill('0'), ...ts];
  const bytes = all.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
  return [[0, 4, 8, 12].map((i) => word(bytes.slice(i, i + 4))).join('') + p];
}

// The user owning the socket from (clientIp, clientPort) to (serverIp, serverPort) in the kernel's
// socket tables, or null when there is none, or more than one user (never guess).
function uidInTables(tables, clientIp, clientPort, serverIp, serverPort) {
  const from = new Set(procAddrs(clientIp, clientPort));
  const to = new Set(procAddrs(serverIp, serverPort));
  const uids = new Set();
  for (const text of tables) {
    for (const line of String(text).split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 7 && from.has(cols[1].toUpperCase()) && to.has(cols[2].toUpperCase())) uids.add(Number(cols[7]));
    }
  }
  return uids.size === 1 ? [...uids][0] : null;
}

module.exports = { create, isThisMachine, procAddrs, uidInTables, whoHas, TOOLS_UID };
