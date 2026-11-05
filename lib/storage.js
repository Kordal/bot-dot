// Storage (docs/api.md, Storage): what the account's files take on the disk, in groups, the folders and files worth
// showing in each, and the largest files, for Settings → Storage and the Chief's `storage` tool.
//
// One check walks every place once, in the background (lib/storage-walk.js on botdot, deploy/desktop/botdot-sizes on
// the account's computer), and is kept in data/storage.json: a walk of 150 GB takes minutes, so the apps show the
// last check and ask for a new one. The computer is only looked at while it runs; nothing starts it for this, and
// what an earlier check saw of it stays until then.
//
// Groups: computer (the bots' folders on the account's computer, its home, its browser's and what was installed
// there), bots (each bot's and the Chief's folder on botdot, without uploads), projects (the projects' folders on the
// computer), uploads (the files given to each bot), chats (the runs, memory and each bot's home on botdot), caches (the
// package managers' downloads, which come back by themselves: the one thing Storage clears itself) and other. When the
// account has a disk of its own (install.sh, BOT_DOT_OWN_DISK), other also holds what that disk uses beyond what was
// counted (the programs Docker keeps, the computer while it was off, the filesystem's own), so the total is the disk's.
// A node a Files place can open carries `place` ({ bot, root } or { project }) and `path`: the apps open it in Files
// and delete it with the Files routes, which tell this (forget) so that the check need not run again.
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { SEAT } = require('./project-folder');

const GROUPS = ['computer', 'bots', 'projects', 'uploads', 'chats', 'caches', 'other'];
// A check older than this is done again when the page asks.
const STALE_MS = 6 * 60 * 60 * 1000;
// The package managers' caches in a home: each comes back by itself when it is needed again.
const CACHES = ['.cache/pip', '.cache/uv', '.cache/yarn', '.cache/pnpm', '.cache/go-build', '.cache/node-gyp', '.npm/_cacache', '.cargo/registry/cache', '.gradle/caches'];
const COMPUTER_HOME = '/home/box';
const COMPUTER_BROWSER = '/home/browser';
const SIZES = path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-sizes');
const WALK = path.join(__dirname, 'storage-walk.js');
const WALK_MS = 15 * 60 * 1000;

// A walk in a thread of its own, so that the server never waits on it.
function walkHere(dir, options = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WALK, { workerData: { storageWalk: { dir, options } } });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('The walk took too long')); }, WALK_MS);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); if (m.error) reject(new Error(m.error)); else resolve(m.value); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// The node at `rel` (names joined by /) under `node`, taken out of it: every node on the way is that much smaller.
function takeOut(node, rel) {
  const names = String(rel).split('/').filter(Boolean);
  if (!names.length) return null;
  const chain = [node];
  for (const name of names) {
    const at = chain[chain.length - 1];
    const kid = (at.kids || []).find((k) => k.name === name);
    if (!kid) return null;
    chain.push(kid);
  }
  const gone = chain.pop();
  const parent = chain[chain.length - 1];
  parent.kids = parent.kids.filter((k) => k !== gone);
  for (const n of chain) n.bytes = Math.max(0, n.bytes - gone.bytes);
  return gone;
}

// A walk's answer as a node: { name, bytes, dir, files, kids, rest } and what is given in `more`.
const nodeOf = (name, walked, more = {}) => ({
  name, bytes: walked.bytes || 0, dir: true, ...(walked.files ? { files: walked.files } : {}),
  ...(walked.kids?.length ? { kids: walked.kids } : {}), ...(walked.rest ? { rest: walked.rest } : {}), ...more,
});
const sum = (nodes) => nodes.reduce((n, k) => n + (k.bytes || 0), 0);
const sorted = (nodes) => nodes.filter((k) => k.bytes > 0).sort((a, b) => b.bytes - a.bytes);

// dataDir: botdot's data folder. bots(): the bots, { id, name }. projects(): { name, folder }. chiefName(). computers:
// lib/computer-screens.js's facade (B.computers). brokered(): whether the privilege broker holds the bots' folders.
// client: lib/privilege-client.js. audit(action, by, details).
function create({ dataDir, bots = () => [], projects = () => [], chiefName = () => 'Chief of Staff', computers = null, brokered = () => !!process.env.BOT_DOT_PRIVILEGE_SOCKET, client = null, audit = () => {}, now = () => Date.now(), ownDisk = () => !!process.env.BOT_DOT_OWN_DISK, diskUsed = null }) {
  const FILE = path.join(dataDir, 'storage.json');
  const WORKSPACES = path.join(dataDir, 'workspaces');
  const HOMES = path.join(dataDir, 'homes');
  let kept = null;
  try { kept = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* never checked */ }
  let checking = null;
  let failed = null;
  const save = () => { try { fs.writeFileSync(`${FILE}.new`, JSON.stringify(kept)); fs.renameSync(`${FILE}.new`, FILE); } catch (e) { console.error(`[storage] ${e.message}`); } };
  const getClient = () => client || require('./privilege-client');
  // One file operation as a bot, through the broker: its answer is { value } or { error }.
  async function asPrincipal(principal, op, args) {
    const r = await getClient().call('files', { principal, request: { op, args } }, { timeout: WALK_MS });
    if (r?.error) throw Object.assign(new Error(r.error.message || 'Principal filesystem operation failed'), { code: r.error.code });
    return r?.value;
  }
  // What the account's disk uses in all, or null.
  const used = () => {
    if (diskUsed) return diskUsed();
    try { const s = fs.statfsSync(dataDir); return (s.blocks - s.bfree) * s.bsize; } catch { return null; }
  };

  // A bot's folder or home on botdot: as that bot, through the broker, when it holds them.
  const principalOf = (area, id) => (area === 'workspaces' && id === '_chief' ? 'chief' : id);
  async function walkPrincipal(area, id) {
    const dir = path.join(dataDir, area, id);
    if (!brokered()) return walkHere(dir);
    return asPrincipal(principalOf(area, id), 'sizeTreeSync', [dir, {}]);
  }
  const ids = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(d.name)).map((d) => d.name); } catch { return []; } };

  // The account's computer, while it runs: { state, walked: { [dir]: answer }, system } or { state } alone.
  async function walkComputer() {
    if (!computers) return { state: 'none' };
    const { state } = await computers.inspect(SEAT).catch(() => ({ state: 'none' }));
    if (state !== 'running') return { state: state === 'none' ? 'none' : 'off' };
    const script = fs.readFileSync(SIZES, 'utf8');
    const dirs = ['/workspace', COMPUTER_HOME, COMPUTER_BROWSER];
    const command = `sudo -n /usr/bin/python3 -I - ${dirs.join(' ')} <<'BOTDOT_SIZES'\n${script}\nBOTDOT_SIZES`;
    const r = await computers.runShell(SEAT, { command, timeoutSeconds: 600 });
    if (r.code !== 0) throw new Error(`Couldn't look at the computer${r.stderr ? `: ${String(r.stderr).trim().split('\n').pop()}` : ''}`);
    const walked = JSON.parse(r.stdout);
    const details = await computers.details(SEAT).catch(() => null);
    return { state, walked, system: Number(details?.diskBytes) || 0 };
  }

  // The groups from what was walked. `before`: the last check, whose computer part stays while the computer is off.
  function assemble({ server, computer, before }) {
    const botName = new Map(bots().map((b) => [b.id, b.name]));
    const nameOf = (id) => (id === '_chief' || id === 'chief' ? chiefName() : botName.get(id) || id);
    const groups = Object.fromEntries(GROUPS.map((g) => [g, []]));
    const largest = [];
    const addLargest = (list, place, base, owner) => {
      for (const f of list || []) largest.push({ name: f.path.split('/').pop(), path: base ? `${base}/${f.path}` : f.path, bytes: f.bytes, place, owner });
    };

    for (const [id, walked] of Object.entries(server.workspaces)) {
      const place = { bot: id, root: 'server' };
      const node = nodeOf(nameOf(id), walked, { place, path: '', bot: id });
      const uploads = takeOut(node, 'uploads');
      if (uploads) groups.uploads.push({ ...uploads, name: nameOf(id), place, path: 'uploads', bot: id });
      groups.bots.push(node);
      addLargest(walked.largest, place, '', nameOf(id));
    }
    for (const [id, walked] of Object.entries(server.homes)) {
      const node = nodeOf(nameOf(id), walked, { bot: id });
      const caches = CACHES.map((rel) => ({ rel, node: takeOut(node, rel) })).filter((c) => c.node);
      if (caches.length) groups.caches.push({ name: nameOf(id), bot: id, dir: true, bytes: sum(caches.map((c) => c.node)), kids: sorted(caches.map((c) => ({ ...c.node, name: c.rel }))) });
      groups.chats.push(node);
    }
    if (server.runs) groups.chats.push(nodeOf('runs', server.runs, { label: 'runs' }));
    if (server.memory) groups.chats.push({ name: 'memory', label: 'memory', bytes: server.memory, dir: false });
    if (server.rest) groups.other.push(nodeOf('botdot', server.rest, { label: 'botdot' }));

    // The computer: as walked now, or as the last check saw it.
    let comp = { state: computer.state, at: now() };
    if (computer.walked) {
      const ws = computer.walked['/workspace'] || {};
      const projectsKid = (ws.kids || []).find((k) => k.name === 'projects' && k.dir);
      const known = new Set(projects().map((p) => p.name));
      const bots_ = [];
      for (const k of ws.kids || []) {
        if (k === projectsKid) continue;
        if (!k.dir) continue;
        const isBot = botName.has(k.name);
        bots_.push(isBot ? { ...k, name: nameOf(k.name), bot: k.name, place: { bot: k.name, root: 'computer' }, path: '' } : { ...k });
      }
      const projs = (projectsKid?.kids || []).filter((k) => k.dir).map((k) => (known.has(k.name) ? { ...k, project: k.name, place: { project: k.name }, path: '' } : { ...k }));
      const home = computer.walked[COMPUTER_HOME];
      const homeNode = home && !home.missing ? nodeOf('home', home, { label: 'home' }) : null;
      const cacheNodes = homeNode ? CACHES.map((rel) => ({ rel, node: takeOut(homeNode, rel) })).filter((c) => c.node) : [];
      const browser = computer.walked[COMPUTER_BROWSER];
      const parts = [...bots_];
      if (homeNode?.bytes) parts.push(homeNode);
      if (browser && !browser.missing && browser.bytes) parts.push(nodeOf('browser', browser, { label: 'browser' }));
      if (computer.system) parts.push({ name: 'system', label: 'system', bytes: computer.system, dir: false });
      const computerLargest = [];
      for (const f of ws.largest || []) {
        const [top, ...rest] = f.path.split('/');
        if (top === 'projects' && rest.length > 1 && known.has(rest[0])) computerLargest.push({ name: rest[rest.length - 1], path: rest.slice(1).join('/'), bytes: f.bytes, place: { project: rest[0] }, owner: rest[0] });
        else if (top !== 'projects' && rest.length && botName.has(top)) computerLargest.push({ name: rest[rest.length - 1], path: rest.join('/'), bytes: f.bytes, place: { bot: top, root: 'computer' }, owner: nameOf(top) });
      }
      comp = {
        state: computer.state, at: now(),
        computer: sorted(parts), projects: sorted(projs),
        caches: cacheNodes.length ? [{ name: 'computer', label: 'computer', dir: true, bytes: sum(cacheNodes.map((c) => c.node)), kids: sorted(cacheNodes.map((c) => ({ ...c.node, name: c.rel }))) }] : [],
        largest: computerLargest,
      };
    } else if (before?.computerPart?.computer) {
      comp = { ...before.computerPart, state: computer.state };
    }
    groups.computer.push(...(comp.computer || []));
    groups.projects.push(...(comp.projects || []));
    groups.caches.push(...(comp.caches || []));
    largest.push(...(comp.largest || []));
    const out = GROUPS.map((id) => ({ id, bytes: sum(groups[id]), kids: sorted(groups[id]) }));
    largest.sort((a, b) => b.bytes - a.bytes);
    return { groups: out, largest: largest.slice(0, 25), computerPart: comp };
  }

  async function check() {
    const server = { workspaces: {}, homes: {}, runs: null, memory: 0, rest: null };
    for (const id of ids(WORKSPACES)) server.workspaces[id] = await walkPrincipal('workspaces', id).catch((e) => { console.error(`[storage] ${id}: ${e.message}`); return { bytes: 0 }; });
    for (const id of ids(HOMES)) server.homes[id] = await walkPrincipal('homes', id).catch((e) => { console.error(`[storage] home ${id}: ${e.message}`); return { bytes: 0 }; });
    server.runs = await walkHere(path.join(dataDir, 'runs')).catch(() => null);
    for (const name of (() => { try { return fs.readdirSync(dataDir); } catch { return []; } })()) {
      if (!/^memory\.db/.test(name)) continue;
      try { const st = fs.statSync(path.join(dataDir, name)); server.memory += st.blocks * 512 || st.size; } catch { /* gone meanwhile */ }
    }
    // The spare (lib/disk-space.js) is botdot's room for a full disk, not the account's files.
    const skip = ['workspaces', 'homes', 'runs', '.spare', ...(() => { try { return fs.readdirSync(dataDir).filter((n) => /^memory\.db/.test(n)); } catch { return []; } })()];
    server.rest = await walkHere(dataDir, { skip }).catch(() => null);
    let computer;
    try { computer = await walkComputer(); } catch (e) { console.error(`[storage] computer: ${e.message}`); computer = { state: 'off' }; }
    const made = assemble({ server, computer, before: kept });
    const all = ownDisk() ? used() : null;
    const counted = sum(made.groups);
    if (all > counted) {
      const other = made.groups.find((g) => g.id === 'other');
      other.kids = sorted([...other.kids, { name: 'system', label: 'disk', bytes: all - counted, dir: false }]);
      other.bytes = sum(other.kids);
    }
    kept = { checkedAt: new Date(now()).toISOString(), ...made };
    save();
    return kept;
  }

  // Starts a check unless one runs; resolves when it ends.
  function start() {
    if (!checking) {
      failed = null;
      checking = check().catch((e) => { failed = e.message; console.error(`[storage] ${e.message}`); }).finally(() => { checking = null; });
    }
    return checking;
  }

  // What the apps and the Chief get: the last check, and whether one runs now. A check is started when there is
  // none yet, or the last is older than STALE_MS.
  function view({ fresh = false } = {}) {
    const stale = !kept || now() - Date.parse(kept.checkedAt) > STALE_MS;
    if (fresh || stale) start();
    const groups = kept?.groups || GROUPS.map((id) => ({ id, bytes: 0, kids: [] }));
    return {
      checking: !!checking,
      checkedAt: kept?.checkedAt || null,
      ...(failed ? { error: failed } : {}),
      computer: kept?.computerPart?.state || 'none',
      ...(kept?.computerPart?.at ? { computerAt: new Date(kept.computerPart.at).toISOString() } : {}),
      total: sum(groups),
      groups,
      largest: kept?.largest || [],
    };
  }

  const samePlace = (a, b) => !!a && !!b && (a.project ? a.project === b.project : !b.project && a.bot === b.bot && (a.root || 'server') === (b.root || 'server'));
  // Something deleted through Files: taken out of the last check at once.
  function forget(place, rel) {
    if (!kept) return;
    const p = String(rel || '').replace(/^\/+|\/+$/g, '');
    let changed = false;
    const visit = (nodes) => {
      for (const n of nodes) {
        if (n.place && samePlace(n.place, place)) {
          const base = n.path || '';
          if (p === base) { n.bytes = 0; n.kids = []; n.rest = 0; changed = true; continue; }
          if (!base || p.startsWith(`${base}/`)) { if (takeOut(n, base ? p.slice(base.length + 1) : p)) changed = true; continue; }
        }
        if (n.kids && !n.place) visit(n.kids);
      }
    };
    for (const g of kept.groups) { visit(g.kids); g.kids = sorted(g.kids); g.bytes = sum(g.kids); }
    const before = kept.largest.length;
    kept.largest = kept.largest.filter((f) => !(samePlace(f.place, place) && (f.path === p || f.path.startsWith(`${p}/`))));
    if (changed || kept.largest.length !== before) save();
  }

  // The caches of every home, on botdot and on the computer while it runs. Resolves with { freed } in bytes.
  async function clearCaches(by = 'you') {
    const group = kept?.groups.find((g) => g.id === 'caches');
    const freed = group?.bytes || 0;
    for (const id of ids(HOMES)) {
      for (const rel of CACHES) {
        const dir = path.join(HOMES, id, ...rel.split('/'));
        try {
          if (brokered()) await asPrincipal(id, 'rmSync', [dir, { recursive: true, force: true }]);
          else await fs.promises.rm(dir, { recursive: true, force: true });
        } catch (e) { console.error(`[storage] clear ${id} ${rel}: ${e.message}`); }
      }
    }
    const ran = !!computers && (await computers.inspect(SEAT).catch(() => ({ state: 'none' }))).state === 'running';
    if (ran) {
      const dirs = CACHES.map((rel) => `'${COMPUTER_HOME}/${rel}'`).join(' ');
      await computers.runShell(SEAT, { command: `sudo -n rm -rf -- ${dirs}`, timeoutSeconds: 600 }).catch((e) => console.error(`[storage] clear on the computer: ${e.message}`));
    }
    if (kept) {
      // What is left: the computer's, when it was off.
      const caches = kept.groups.find((g) => g.id === 'caches');
      if (caches) { caches.kids = ran ? [] : caches.kids.filter((k) => k.label === 'computer'); caches.bytes = sum(caches.kids); }
      if (ran && kept.computerPart) kept.computerPart.caches = [];
      save();
    }
    try { audit('storage.caches-cleared', by, { bytes: freed }); } catch (e) { console.error(`[audit] ${e.message}`); }
    return { freed };
  }

  return { view, start, check, forget, clearCaches, checking: () => !!checking };
}

module.exports = { create, takeOut, GROUPS, CACHES, STALE_MS };
