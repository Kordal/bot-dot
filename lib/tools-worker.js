#!/usr/bin/env node
// The installer of a bot's tools (ADR 007). The privilege broker starts it as the tools user for one of
// five fixed operations: resolve a name into a pinned list, install a bot's tool from such a list, remove
// what a bot no longer has, and for a tool from a link (tools-link.js): fetch the file to note its checksum,
// and install it when it still has that checksum. It never gets a command line from its caller: it builds
// micromamba's own from the bot, the tool's name and the list, and a link's file is never run at all. Its
// environment is the fixed one of workerEnv(): no key, token or login.
//
//   data/tools/<bot>/<tool>/   the tool, at a path that never changes
//   data/tools/<bot>/bin/      links to the commands of each tool's own package (not of its dependencies);
//                              a tool from a link has one command, of the tool's own name
//   data/tools/.cache/         micromamba's cache for the length of one install, and only when the data folder
//                              refuses micromamba's copy (a Mac's disk shared into Docker): see install()
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const link = require('./tools-link');

const BOT = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const TOOL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/; // a conda-forge package name
const RESERVED = new Set(['bin']); // the folder of links
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+!]{0,63}$/;
const LINK_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,63}$/; // a release's version as its maker writes it: "2.0.0-rc.1"
const SHA256 = /^[0-9a-f]{64}$/;
// One package of the registry: conda-forge, for one of the two architectures or for any. A name may begin
// with "_" (_openmp_mutex, which libgcc needs), and a version's "!" may come written as %21; no other escape,
// so an address cannot name another folder.
const PACKAGE_URL = /^https:\/\/conda\.anaconda\.org\/conda-forge\/(linux-64|linux-aarch64|noarch)\/((?:[A-Za-z0-9_]|%21)(?:[A-Za-z0-9._+!-]|%21){0,200})\.(?:conda|tar\.bz2)$/;
const COMMAND = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/;
const MAX_PACKAGES = 400;
const MARKER = '.botdot-tool.json';
const SYSTEM_DIRS = ['/usr/local/bin', '/usr/bin', '/bin'];
const RESOLVE_MS = 5 * 60_000;
const INSTALL_MS = 30 * 60_000;

const toolName = (value) => {
  if (typeof value !== 'string' || !TOOL_NAME.test(value) || RESERVED.has(value)) throw new Error('Invalid tool name');
  return value;
};
const botName = (value) => {
  if (typeof value !== 'string' || !BOT.test(value) || value === 'chief' || value === '_chief') throw new Error('Invalid principal');
  return value;
};
// "jq-1.8.2-h80f16a2_1" is the package jq, version 1.8.2, build h80f16a2_1.
function packageOf(url) {
  const m = typeof url === 'string' && PACKAGE_URL.exec(url);
  if (!m) throw new Error('A list entry is not a package of the registry');
  const file = m[2].replaceAll('%21', '!');
  const parts = file.split('-');
  if (parts.length < 3) throw new Error('A list entry is not a package of the registry');
  return { file, subdir: m[1], name: parts.slice(0, -2).join('-'), version: parts.at(-2), build: parts.at(-1) };
}
// One value for a whole list: what a tool's folder was installed from.
const listHash = (list) => crypto.createHash('sha256').update(list.map((entry) => `${entry.url}#${entry.sha256}`).join('\n')).digest('hex');
function pinnedList(list) {
  if (!Array.isArray(list)) throw new Error('The list must be a list of packages');
  if (!list.length || list.length > MAX_PACKAGES) throw new Error('The list must hold between 1 and 400 packages');
  return list.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) throw new Error('A list entry has no sha256');
    packageOf(entry.url);
    return { url: entry.url, sha256: entry.sha256 };
  });
}

const approval = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(value)) throw new Error('Invalid approval time');
  return value;
};

// What the worker is asked, checked: everything in it is a name, a version, a checksum, a registry address
// or, for a tool from a link, one https address.
// where: { root (the data folder), cache, micromamba, ca }, the broker's own and never the caller's.
// ca: a certificate the tests' own file server has; the product has none.
function request(operation, r, where) {
  const base = { root: where.root, cache: where.cache, micromamba: where.micromamba, ...(where.ca ? { ca: where.ca } : {}) };
  if (operation === 'toolResolve') {
    if (r.version !== undefined && r.version !== null && (typeof r.version !== 'string' || !VERSION.test(r.version))) throw new Error('Invalid tool version');
    return { ...base, op: 'resolve', name: toolName(r.name), version: r.version || null };
  }
  if (operation === 'toolInstall') {
    const tool = toolName(r.tool);
    const list = pinnedList(r.list);
    if (list.filter((entry) => packageOf(entry.url).name === tool).length !== 1) throw new Error('The list must hold exactly one package of that name');
    return { ...base, op: 'install', bot: botName(r.principal), tool, list, approvedAt: approval(r.approvedAt) };
  }
  // A tool from a link: the address and the command's name, which is the tool's name. Nothing is installed.
  if (operation === 'toolFetch') return { ...base, op: 'fetch', url: link.linkUrl(r.url), command: toolName(r.command) };
  // The same, installed for a bot: only the file with the sha256 the owner approved.
  if (operation === 'toolInstallLink') {
    const tool = toolName(r.tool);
    if (r.command !== tool) throw new Error("A tool from a link has one command, of the tool's own name");
    if (typeof r.sha256 !== 'string' || !SHA256.test(r.sha256)) throw new Error('A tool from a link needs its sha256');
    return { ...base, op: 'installLink', bot: botName(r.principal), tool, url: link.linkUrl(r.url), sha256: r.sha256, command: tool, approvedAt: approval(r.approvedAt) };
  }
  if (operation === 'toolRemove') {
    // keep: [{ tool, list }], the tools the bot still has, each with the hash of its list (listHash).
    if (!Array.isArray(r.keep) || r.keep.length > 200) throw new Error('The tools to keep must be a list');
    const keep = r.keep.map((k) => {
      if (!k || typeof k !== 'object' || typeof k.list !== 'string' || !SHA256.test(k.list)) throw new Error('A tool to keep has no list');
      return { tool: toolName(k.tool), list: k.list };
    });
    return { ...base, op: 'remove', bot: botName(r.principal), keep };
  }
  throw new Error('Unsupported privilege broker operation');
}

const workerEnv = (cache) => ({ PATH: SYSTEM_DIRS.join(':'), LANG: 'C.UTF-8', HOME: path.join(cache, 'home'), MAMBA_ROOT_PREFIX: path.join(cache, 'mamba') });

// Start the worker for a checked request. as: { uid, gid } of the tools user (the broker), or nothing (the tests).
function spawn(checked, as = {}) {
  const child = cp.spawn(process.execPath, [__filename], { ...as, cwd: '/', env: workerEnv(checked.cache), detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  child.stdio[3].on('error', () => {});
  child.stdio[3].end(JSON.stringify(checked));
  child.stdin.on('error', () => {});
  child.stdin.end();
  return child;
}

module.exports = { request, spawn, workerEnv, packageOf, listHash, linkHash: link.linkHash, TOOL_NAME, VERSION, LINK_VERSION, SHA256, BOT, MARKER };

// ---------- the worker itself ----------

const rand = () => crypto.randomBytes(6).toString('hex');
const exists = (file) => { try { fs.lstatSync(file); return true; } catch { return false; } };
const remove = (file) => fs.rmSync(file, { recursive: true, force: true });

// Why micromamba failed, as one of four causes and a line the owner can read.
function failure(r) {
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const cause = r.error?.code === 'ETIMEDOUT' ? 'network'
    : /sha-?256|md5|checksum|incorrect size/i.test(text) ? 'checksum'
      : /no space left|ENOSPC|disk full|disk quota/i.test(text) ? 'disk'
        : /could not connect|could not resolve|couldn't resolve|timed? ?out|download error|connection|network|ssl|HTTP [45]\d\d/i.test(text) ? 'network'
          : 'other';
  const said = { checksum: 'A downloaded file did not match the checksum the owner approved.', disk: 'The disk is full.', network: 'The registry could not be reached.' }[cause];
  const last = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() || r.error?.message || `micromamba ended with code ${r.status}`;
  return Object.assign(new Error(said || last.slice(0, 300)), { cause });
}

// env: the worker's own, or the same four names with the cache elsewhere (install()).
function micromamba(req, args, timeout, env = process.env) {
  for (const dir of [env.HOME, env.MAMBA_ROOT_PREFIX]) fs.mkdirSync(dir, { recursive: true });
  const r = cp.spawnSync(req.micromamba, args, { env, cwd: req.cache, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error?.code === 'ENOENT') throw Object.assign(new Error('micromamba is not installed on this botdot server.'), { cause: 'other' });
  return r;
}

// The registry's answer for one name, without installing: every package it needs, each with its address and sha256.
function resolve(req) {
  const unused = path.join(req.cache, 'resolve', rand()); // a dry run leaves nothing there
  const r = micromamba(req, ['create', '--dry-run', '--json', '-y', '--no-rc', '--override-channels', '-c', 'conda-forge', '-p', unused, req.version ? `${req.name}==${req.version}` : req.name], RESOLVE_MS);
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* not an answer */ }
  const link = out?.actions?.LINK;
  if (r.error || r.status !== 0 || !Array.isArray(link) || !link.length) {
    const problems = Array.isArray(out?.solver_problems) ? out.solver_problems.join(' ') : '';
    if (problems) throw Object.assign(new Error(problems.slice(0, 300)), { cause: 'other' });
    throw failure(r);
  }
  let size = 0;
  const list = link.map((p) => {
    if (typeof p?.sha256 !== 'string' || !SHA256.test(p.sha256)) throw new Error(`The registry gave no checksum for ${String(p?.name).slice(0, 80)}.`);
    packageOf(p.url);
    size += Number.isFinite(p.size) ? p.size : 0;
    return { url: p.url, sha256: p.sha256 };
  });
  if (list.length > MAX_PACKAGES) throw new Error(`${req.name} needs ${list.length} packages, more than botdot installs for one tool.`);
  const own = list.map((entry) => packageOf(entry.url)).filter((p) => p.name === req.name);
  if (own.length !== 1) throw new Error(`The registry's answer holds no package named ${req.name}.`);
  return { ok: true, name: req.name, version: own[0].version, size, list };
}

const readMarker = (prefix) => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(prefix, MARKER), 'utf8'));
    return m && typeof m.name === 'string' && Array.isArray(m.commands) && typeof m.approvedAt === 'string' ? m : null;
  } catch { return null; }
};
const aside = (tool) => `.old~${tool}~`; // "~" is in no tool's name

// What an interrupted install left: a half-made folder goes, and the tool it was replacing comes back.
function settle(botDir, tool) {
  const prefix = path.join(botDir, tool);
  if (exists(prefix) && !readMarker(prefix)) remove(prefix);
  const olds = fs.readdirSync(botDir).filter((n) => n.startsWith(aside(tool))).sort();
  if (!exists(prefix) && olds.length) fs.renameSync(path.join(botDir, olds.pop()), prefix);
  for (const old of olds) remove(path.join(botDir, old));
}

// Everyone may read and run what the bot's folder holds; who gets in is decided at that folder (mode 0750, the bot's group).
function openModes(file) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    fs.chmodSync(file, 0o755);
    for (const name of fs.readdirSync(file)) openModes(path.join(file, name));
  } else if (st.isFile()) fs.chmodSync(file, st.mode & 0o111 ? 0o755 : 0o644);
}

// The commands a tool brings: the files its own package put into bin.
function commandsOf(prefix, own) {
  let record;
  try { record = JSON.parse(fs.readFileSync(path.join(prefix, 'conda-meta', `${own.file}.json`), 'utf8')); } catch { throw new Error(`${own.name} was not installed as its list says.`); }
  const commands = [];
  for (const file of Array.isArray(record.files) ? record.files : []) {
    const m = typeof file === 'string' && /^bin\/([^/]+)$/.exec(file);
    if (!m || !COMMAND.test(m[1])) continue;
    let real;
    try { real = fs.realpathSync(path.join(prefix, 'bin', m[1])); } catch { continue; }
    const st = fs.statSync(real);
    if (real.startsWith(fs.realpathSync(prefix) + path.sep) && st.isFile() && st.mode & 0o111) commands.push(m[1]);
  }
  return commands.sort();
}

// Make bin again from the tools that are there. Of two tools with a command of the same name, the one approved later has it.
function relink(botDir) {
  const tools = fs.readdirSync(botDir).filter((n) => TOOL_NAME.test(n) && !RESERVED.has(n)).map((n) => readMarker(path.join(botDir, n))).filter(Boolean)
    .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt) || a.name.localeCompare(b.name));
  const owner = new Map(); // command -> the tool that has it
  const over = []; // { command, tool, of }: tool's command stands in for the server's own ("system") or for another tool's
  for (const t of tools) {
    for (const c of t.commands.filter((x) => COMMAND.test(x))) {
      if (owner.has(c)) over.push({ command: c, tool: t.name, of: owner.get(c) });
      else if (SYSTEM_DIRS.some((dir) => exists(path.join(dir, c)))) over.push({ command: c, tool: t.name, of: 'system' });
      owner.set(c, t.name);
    }
  }
  const next = path.join(botDir, `.bin~${rand()}`);
  fs.mkdirSync(next, { mode: 0o755 });
  fs.chmodSync(next, 0o755);
  for (const [c, tool] of owner) fs.symlinkSync(path.join('..', tool, 'bin', c), path.join(next, c));
  remove(path.join(botDir, 'bin'));
  fs.renameSync(next, path.join(botDir, 'bin'));
  return { owner, over };
}

// Make a bot's tool anew at its place, which never changes. make(prefix) puts it there and returns
// { commands, list (what it was made from, as one hash), version }. When it fails nothing half-installed
// stays, and what was there is there again.
async function inPlace(req, make) {
  const botDir = path.join(req.root, 'tools', req.bot);
  if (!fs.statSync(botDir, { throwIfNoEntry: false })?.isDirectory()) throw new Error("The bot's tools folder is missing.");
  const prefix = path.join(botDir, req.tool);
  settle(botDir, req.tool);
  const old = exists(prefix) ? path.join(botDir, `${aside(req.tool)}${rand()}`) : null;
  if (old) fs.renameSync(prefix, old);
  let made;
  try {
    made = await make(prefix);
    openModes(prefix);
    // A new file, never one the tool brought under that name: a link there could point at another bot's tool.
    remove(path.join(prefix, MARKER));
    fs.writeFileSync(path.join(prefix, MARKER), JSON.stringify({ name: req.tool, version: made.version, approvedAt: req.approvedAt, list: made.list, commands: made.commands, ...(made.way ? { way: made.way } : {}) }), { flag: 'wx', mode: 0o644 });
  } catch (e) {
    remove(prefix);
    if (old) fs.renameSync(old, prefix);
    throw e;
  }
  if (old) remove(old);
  const { owner, over } = relink(botDir);
  return {
    ok: true, name: req.tool, version: made.version, commands: made.commands, ...(made.way ? { way: made.way } : {}), // way: how a registry tool was placed (install())
    replaces: over.filter((o) => o.tool === req.tool && owner.get(o.command) === req.tool).map((o) => ({ command: o.command, of: o.of })),
    hidden: made.commands.filter((c) => owner.get(c) !== req.tool).map((c) => ({ command: c, by: owner.get(c) })),
  };
}

// The cache of the second way of installing: on the data folder, next to the bots' folders (no bot's name
// begins with a dot), and there only while one install runs.
const dataCache = (root) => path.join(root, 'tools', '.cache');
// micromamba's own copy of a file onto the data folder was refused. A Mac's disk shared into Docker does that
// (measured on 2026-10-03: "filesystem error: cannot copy: Permission denied [<cache>/pkgs/…] [<prefix>/…]"),
// with the cache in the container and on the mount alike, while a hard link from a cache on that mount works.
// Only an install that failed counts: one that ended well is done, whatever it printed.
const copyRefused = (r) => (!!r.error || r.status !== 0) && /cannot copy: (permission denied|operation not permitted)/i.test(`${r.stdout || ''}\n${r.stderr || ''}`);

// Exactly the list: no solver, no index, no script of a package, every file checked. Two ways (ADR 007):
//   copy   the cache is in the container and every file is copied onto the data folder (--always-copy).
//          Always tried first; on a Docker volume it is the only one that runs.
//   links  only after the data folder refused that copy: the cache is on the data folder itself and
//          micromamba hard-links from it. The cache is removed when the install ends, so no file of the tool
//          stays linked to anything: not to a cache, not to another bot's tool, and nothing is left to back up.
function install(req) {
  const own = req.list.map((entry) => packageOf(entry.url)).find((p) => p.name === req.tool);
  const listFile = path.join(req.cache, 'lists', `${rand()}.txt`);
  const onData = dataCache(req.root);
  const until = Date.now() + INSTALL_MS; // both ways together get what one install is given: the second has what the first left
  return inPlace(req, (prefix) => {
    try {
      remove(onData); // what an install that was stopped left there
      fs.mkdirSync(path.dirname(listFile), { recursive: true });
      fs.writeFileSync(listFile, ['@EXPLICIT', ...req.list.map((entry) => `${entry.url}#sha256:${entry.sha256}`)].join('\n') + '\n');
      const create = ['create', '-y', '--no-rc', '-p', prefix, '--file', listFile, '--skip-run-link-scripts'];
      const checks = ['--safety-checks', 'enabled', '--extra-safety-checks'];
      let way = 'copy';
      let r = micromamba(req, [...create, '--always-copy', ...checks], INSTALL_MS);
      if (copyRefused(r)) {
        way = 'links';
        remove(prefix); // the half-made folder of the first way
        fs.mkdirSync(onData, { mode: 0o700 });
        r = micromamba(req, [...create, ...checks], Math.max(1000, until - Date.now()), { ...process.env, MAMBA_ROOT_PREFIX: onData });
      }
      if (r.error || r.status !== 0) throw failure(r);
      const commands = commandsOf(prefix, own);
      if (!commands.length) throw new Error(`${req.tool} brings no command of its own, so it is not a tool botdot can install.`);
      return { commands, list: listHash(req.list), version: own.version, way };
    } finally {
      fs.rmSync(listFile, { force: true });
      remove(onData); // before any mode in the tool's folder is set: a hard link would carry that into the cache
    }
  });
}

// ---------- a tool from a link ----------

const CHANGED = 'The file behind the link is not the file that was approved: its checksum differs.';
const STALE_MS = 60 * 60_000; // longer than any install is given

// The link's file, downloaded into the cache for as long as `use` looks at it. An installer that the broker
// stopped (it took too long, or the server went) could not remove its download: what is that old goes now.
async function fetched(req, use) {
  const dir = path.join(req.cache, 'links');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(dir)) {
    const left = fs.statSync(path.join(dir, name), { throwIfNoEntry: false });
    if (left && Date.now() - left.mtimeMs > STALE_MS) remove(path.join(dir, name));
  }
  const file = path.join(dir, rand());
  try {
    const got = await link.download(req.url, file, { ca: req.ca ? fs.readFileSync(req.ca) : undefined });
    return await use(file, got);
  } finally { fs.rmSync(file, { force: true }); }
}

// For the ask: the file's sha256 and size, and that it is something botdot can place. Nothing is kept.
const fetchLink = (req) => fetched(req, async (file, got) => ({ ok: true, ...got, ...(await link.inspect(file, req.command)) }));

// Install the file behind a link for a bot: fetched again, and only with the sha256 the owner approved.
// Nothing in the bot's folder is touched before the file is here and is that file.
const installLink = (req) => fetched(req, (file, got) => {
  if (got.sha256 !== req.sha256) throw Object.assign(new Error(CHANGED), { cause: 'checksum' });
  return inPlace(req, async (prefix) => {
    fs.mkdirSync(prefix, { mode: 0o755 });
    await link.place(file, { prefix, command: req.command });
    return { commands: [req.command], list: link.linkHash(req) };
  });
});

// Everything in the bot's folder that is not a tool to keep, installed from the list it is kept with, goes;
// with nothing to keep, so does the folder.
function removeTools(req) {
  const botDir = path.join(req.root, 'tools', req.bot);
  remove(dataCache(req.root)); // a cache that an install which was stopped left on the data folder (install())
  if (!exists(botDir)) return { ok: true, removed: [] };
  if (!req.keep.length) { remove(botDir); return { ok: true, removed: [] }; }
  for (const k of req.keep) settle(botDir, k.tool);
  const removed = [];
  for (const name of fs.readdirSync(botDir)) {
    const kept = req.keep.find((k) => k.tool === name);
    if (name === 'bin' || (kept && readMarker(path.join(botDir, name))?.list === kept.list)) continue;
    remove(path.join(botDir, name));
    if (TOOL_NAME.test(name)) removed.push(name);
  }
  relink(botDir);
  return { ok: true, removed };
}

if (require.main === module) {
  process.umask(0o022);
  const OPERATIONS = { resolve, install, remove: removeTools, fetch: fetchLink, installLink };
  (async () => {
    const req = JSON.parse(fs.readFileSync(3, 'utf8'));
    if (!Object.hasOwn(OPERATIONS, req.op)) throw new Error('Unsupported tools operation');
    return OPERATIONS[req.op](req);
  })().catch((e) => {
    process.exitCode = 1;
    return { error: { message: e.message, cause: typeof e.cause === 'string' ? e.cause : 'other' } };
  }).then((out) => process.stdout.write(JSON.stringify(out)));
}
