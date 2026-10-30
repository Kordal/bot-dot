// Bitwarden as botdot's vault. Bots use the logins, payment cards, identities and SSH keys in one folder of
// your Bitwarden vault ("bot-dot"); nothing else in the vault is read. botdot talks to Bitwarden
// with its official CLI (`bw`), logged in with your account's personal API key.
//
// - Unlocking needs your master password, typed into a botdot pop-up after each restart. It's used
//   once and dropped; only the unlocked session stays, in memory. Restarting botdot locks it again.
// - Secrets are passed to `bw` on stdin or in its environment, never on its command line.
// - Which bots may use which item is kept here (data/bitwarden-access.json), not in Bitwarden. So is what
//   else botdot adds to a login: a self-signed certificate, its additional hosts and its type.
// - The same interface as the built-in vault (vault.js), plus cards, identities, SSH keys and files. An SSH key's private
//   key is handed to the bot's computer only, into an ssh-agent there (lib/computers.js runWithSshKey): never to a bot.
//   A file goes there only for one command (runWithFile), and only its name and size are ever shown.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const EventEmitter = require('events');
const { encrypt, decrypt, itemType, givenType } = require('./vault');
const sshKeys = require('./ssh-keys');
const vaultFiles = require('./vault-files');
const githubApp = require('./github-app');

const FOLDER = 'bot-dot';
const SERVERS = { us: 'https://vault.bitwarden.com', eu: 'https://vault.bitwarden.eu' };
// Bitwarden's item types. 5 is its SSH key item: `sshKey: { privateKey, publicKey, keyFingerprint }`.
const TYPE = { 1: 'login', 2: 'note', 3: 'card', 4: 'identity', 5: 'ssh-key' };
// A file of the Vault (#157) is a secure note botdot made, with the file in its hidden fields (lib/vault-files.js).
const kindOf = (it) => (vaultFiles.isFileItem(it) ? 'file' : TYPE[it.type] || 'other');
// The kinds botdot lists and shares; any other secure note is never read.
const LISTED = ['login', 'card', 'identity', 'ssh-key', 'file'];
const IDENTITY_FIELDS = ['title', 'firstName', 'middleName', 'lastName', 'fullName', 'company', 'email', 'phone', 'address1', 'address2', 'address3', 'city', 'state', 'postalCode', 'country', 'username'];
const CARD_FIELDS = ['number', 'code', 'expiry', 'expMonth', 'expYear', 'cardholderName'];

function findBw() {
  if (process.env.BW_BIN) return process.env.BW_BIN;
  for (const p of ['/opt/homebrew/bin/bw', '/usr/local/bin/bw', '/usr/bin/bw']) if (fs.existsSync(p)) return p;
  try { return execFileSync('/bin/sh', ['-lc', 'command -v bw'], { encoding: 'utf8', timeout: 5000 }).trim() || null; } catch { return null; }
}

function create(dataDir) {
  const BW = findBw();
  const CONFIG = path.join(dataDir, 'bitwarden.json');
  const ACCESS = path.join(dataDir, 'bitwarden-access.json');
  const APPDATA = path.join(dataDir, 'bitwarden-cli'); // bw's own (encrypted) cache, apart from yours
  fs.mkdirSync(APPDATA, { recursive: true, mode: 0o700 });

  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJson = (f, v) => { const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(t, f); };

  let session = null; // the unlocked session key: memory only
  let items = []; // the bot-dot folder, decrypted: memory only, while unlocked
  let folderId = null;
  let lastSync = null;
  let lastError = null;
  const events = new EventEmitter();
  events.setMaxListeners(100);

  // One bw command at a time (they share a data folder). The owner's go first: a save, an unlock or a bot's read waits
  // for the command running now only, not for the background syncs queued behind it (#129), each of which is seconds
  // of bw on a small server. background: a sync nobody waits on (every 5 minutes, after an unlock or a bot's request).
  const lanes = { now: [], later: [] };
  let running = false;
  const idle = [];
  function pump() {
    if (running) return;
    const next = lanes.now.shift() || lanes.later.shift();
    if (!next) { idle.splice(0).forEach((done) => done()); return; }
    running = true;
    next().finally(() => { running = false; pump(); });
  }
  function bw(args, { input, env = {}, timeout = 60_000, background = false } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (!BW) return reject(new Error('The Bitwarden CLI (bw) is not installed. Install it with: brew install bitwarden-cli'));
      const child = spawn(BW, [...args, '--nointeraction'], {
        env: { PATH: process.env.PATH, HOME: process.env.HOME, BITWARDENCLI_APPDATA_DIR: APPDATA, ...(session ? { BW_SESSION: session } : {}), ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = ''; let err = '';
      const t = setTimeout(() => child.kill('SIGKILL'), timeout);
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (err += c));
      child.on('error', (e) => { clearTimeout(t); reject(e); });
      child.on('close', (code) => {
        clearTimeout(t);
        if (code === 0) resolve(out.trim());
        else reject(new Error(cleanError(err || out) || `bw exited with ${code}`));
      });
      child.stdin.end(input || '');
    });
    return new Promise((resolve, reject) => {
      lanes[background ? 'later' : 'now'].push(() => run().then(resolve, reject));
      pump();
    });
  }
  // Resolves when no bw command runs or waits (the tests read what the commands did).
  const whenIdle = () => (running || lanes.now.length || lanes.later.length ? new Promise((done) => idle.push(done)) : Promise.resolve());
  const cleanError = (t) => String(t).replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] || '';
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

  // ---------- setup, unlock, sync ----------

  const config = () => readJson(CONFIG, {});
  const configured = () => !!config().clientId;
  const unlocked = () => !!session;

  async function cliStatus() {
    try { return JSON.parse(await bw(['status'])); } catch { return null; }
  }

  async function status() {
    const c = config();
    return {
      installed: !!BW,
      configured: !!c.clientId,
      unlocked: !!session,
      server: c.server || null,
      email: c.email || null,
      folder: FOLDER,
      items: session ? items.length : null,
      lastSync,
      error: lastError,
    };
  }

  // Log in with the account's personal API key (Settings → Security → Keys in the web vault).
  async function setup({ server = 'us', serverUrl, clientId, clientSecret }) {
    clientId = String(clientId || '').trim();
    clientSecret = String(clientSecret || '').trim();
    if (!/^user\.[0-9a-f-]{36}$/i.test(clientId)) throw new Error('The client_id looks like "user.xxxxxxxx-…". Copy it from Bitwarden: Settings → Security → Keys → View API key.');
    if (!clientSecret) throw new Error('Paste the client_secret too');
    const url = server === 'custom' ? String(serverUrl || '').trim().replace(/\/+$/, '') : SERVERS[server] || SERVERS.us;
    if (!/^https:\/\/[^\s/]+/.test(url)) throw new Error('Enter your Bitwarden server address, e.g. https://vault.example.com');
    session = null; items = [];
    try { await bw(['logout']); } catch { /* not logged in */ }
    await bw(['config', 'server', url]);
    await bw(['login', '--apikey'], { env: { BW_CLIENTID: clientId, BW_CLIENTSECRET: clientSecret } });
    const st = await cliStatus();
    writeJson(CONFIG, { server: url, email: st?.userEmail || null, clientId, clientSecret: encrypt(clientSecret), since: new Date().toISOString() });
    lastError = null;
    return status();
  }

  // bw forgets its login now and then (e.g. a new CLI version); log in again with the saved key.
  async function ensureLoggedIn() {
    const st = await cliStatus();
    if (st && st.status !== 'unauthenticated') return;
    const c = config();
    if (!c.clientId) throw new Error('Connect Bitwarden first (Vault page)');
    await bw(['config', 'server', c.server]).catch(() => {});
    await bw(['login', '--apikey'], { env: { BW_CLIENTID: c.clientId, BW_CLIENTSECRET: decrypt(c.clientSecret) } });
  }

  // Each bw command takes a second or more, so unlocking runs as few as it can: unlock, then read the
  // bot-dot folder from bw's local copy. The online sync follows in the background.
  async function unlock(masterPassword) {
    if (!masterPassword) throw new Error('Enter your master password');
    const tryUnlock = () => bw(['unlock', '--passwordenv', 'BW_MASTER', '--raw'], { env: { BW_MASTER: String(masterPassword) } });
    let key;
    try {
      try { key = await tryUnlock(); } catch (e) {
        if (!/not logged in/i.test(e.message)) throw e;
        await ensureLoggedIn();
        key = await tryUnlock();
      }
    } catch (e) {
      throw new Error(/invalid master password|decryption operation failed/i.test(e.message) ? 'That master password is not right' : e.message);
    }
    if (!key) throw new Error('Bitwarden did not unlock');
    session = key;
    try { await loadItems(); } catch (e) { if (!session) throw e; }
    events.emit('unlocked');
    sync({ background: true }).catch(() => {});
    return status();
  }

  async function lock() {
    session = null; items = []; folderId = null;
    await bw(['lock']).catch(() => {});
    events.emit('locked');
  }

  // Read the bot-dot folder from bw's local copy (finding or creating the folder when its id isn't known yet).
  async function loadItems({ findFolder = false, background = false } = {}) {
    try {
      // Found in a local first: a save meanwhile still knows the folder.
      let id = findFolder ? null : folderId || config().folderId || null;
      if (!id) {
        const folders = JSON.parse(await bw(['list', 'folders'], { background }));
        let f = folders.find((x) => x.name === FOLDER);
        if (!f) f = JSON.parse(await bw(['create', 'folder'], { input: encode({ name: FOLDER }) }));
        id = f.id;
        if (config().folderId !== id) writeJson(CONFIG, { ...config(), folderId: id });
      }
      folderId = id;
      items = JSON.parse(await bw(['list', 'items', '--folderid', folderId], { background }));
      lastError = null;
    } catch (e) {
      lastError = e.message;
      if (/not logged in|locked|session/i.test(e.message)) { session = null; items = []; }
      throw e;
    }
  }

  // A sync is three bw commands. Syncs asked for while one runs (the 5-minute one, each bot's or the Chief's login
  // request, the Vault page's Sync) are that one, so they don't queue three more each. ifOlderThan: skip it when the
  // vault was synced that many ms ago (a login request asks with it).
  let syncing = null;
  function sync({ background = false, ifOlderThan = 0 } = {}) {
    if (!session) return Promise.resolve();
    if (ifOlderThan && lastSync && Date.now() - Date.parse(lastSync) < ifOlderThan) return Promise.resolve();
    if (!syncing) syncing = syncNow({ background }).finally(() => { syncing = null; });
    return syncing;
  }
  async function syncNow({ background }) {
    try { await bw(['sync'], { background }); } catch (e) {
      lastError = e.message;
      if (/not logged in|locked|session/i.test(e.message)) { session = null; items = []; }
      throw e;
    }
    await loadItems({ findFolder: true, background }); // the folder may have been renamed or deleted elsewhere
    lastSync = new Date().toISOString();
  }
  setInterval(() => { if (session) sync({ background: true }).catch(() => {}); }, 5 * 60_000).unref();

  // Wait (up to ms) for the owner to unlock, e.g. when a bot needs a login right now.
  function waitUnlocked(ms) {
    if (session) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); resolve(true); };
      const t = setTimeout(() => { events.off('unlocked', done); resolve(false); }, ms);
      events.once('unlocked', done);
    });
  }

  // ---------- access: which bots may use which item ----------

  const access = () => readJson(ACCESS, {});
  const accessOf = (id) => ({ bots: [], insecureTls: false, ...(access()[id] || {}) });
  function setAccess(id, patch) {
    const a = access();
    a[id] = { ...accessOf(id), ...patch };
    writeJson(ACCESS, a);
  }

  // ---------- views ----------

  const normalizeSite = (site) => {
    const s = String(site || '').trim().toLowerCase();
    try { return new URL(s.includes('://') ? s : `https://${s}`).hostname; } catch { return s; }
  };
  const siteOf = (it) => {
    const u = (it.login?.uris || []).map((x) => x.uri).find(Boolean);
    return u ? normalizeSite(u) : '';
  };
  // x.com and www.x.com (or mobile.x.com) count as the same site.
  const sameSite = (a, b) => !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
  const needLocked = () => { if (!session) throw new Error("The owner's Bitwarden is locked. They need to unlock it in botdot (a banner is showing there); then try again."); };

  // What the UI, the Chief and bots may see. Never a password, card number, code, TOTP secret or private key.
  function publicView(it) {
    const a = accessOf(it.id);
    const kind = kindOf(it);
    const v = { id: it.id, kind, name: it.name, allowedBots: a.bots, reprompt: it.reprompt === 1, updatedAt: it.revisionDate };
    // A login's type (login, API token or other) is botdot's own: Bitwarden has none. A card and an identity have no type.
    if (kind === 'login') Object.assign(v, { type: itemType(a.type), site: siteOf(it), username: it.login?.username || '', hasPassword: !!it.login?.password, hasTotp: !!it.login?.totp, insecureTls: a.insecureTls, inComputer: !!a.inComputer, allowedHosts: a.allowedHosts || [] });
    if (kind === 'card') Object.assign(v, { brand: it.card?.brand || '', last4: String(it.card?.number || '').slice(-4), expiry: it.card?.expMonth ? `${String(it.card.expMonth).padStart(2, '0')}/${String(it.card.expYear || '').slice(-2)}` : '', holder: it.card?.cardholderName || '' });
    if (kind === 'identity') Object.assign(v, { holder: [it.identity?.firstName, it.identity?.lastName].filter(Boolean).join(' '), email: it.identity?.email || '' });
    // An SSH key: its type is `ssh-key`, and only its public half and fingerprint are shown.
    if (kind === 'ssh-key') Object.assign(v, { type: 'ssh-key', publicKey: String(it.sshKey?.publicKey || ''), fingerprint: String(it.sshKey?.keyFingerprint || '') });
    // A file: its name and size, never its content.
    if (kind === 'file') { const f = vaultFiles.fromFields(it.fields); Object.assign(v, { type: 'file', fileName: f.fileName, size: f.size }); }
    return v;
  }

  const usable = (it) => it.reprompt !== 1; // items that ask for the master password again stay yours
  function findFor(botId, ref, kind = 'login') {
    needLocked();
    const q = String(ref || '').trim().toLowerCase();
    const host = normalizeSite(q);
    const exact = require('./network-address').hostname(host); // as an additional host is kept
    const ofKind = items.filter((it) => kindOf(it) === kind);
    const named = ofKind.filter((it) => it.id === q || it.name.toLowerCase() === q || (kind === 'login' && sameSite(siteOf(it), host)));
    // Then a login by one of its additional hosts, exactly.
    const matches = kind === 'login' ? [...named, ...ofKind.filter((it) => !named.includes(it) && (accessOf(it.id).allowedHosts || []).includes(exact))] : named;
    const it = matches.find((x) => accessOf(x.id).bots.includes(botId)) || matches[0];
    if (!it) throw new Error(`No saved ${kind} called "${ref}"`);
    if (!usable(it)) throw new Error(`"${it.name}" asks for the master password again in Bitwarden, so bots can't use it.`);
    if (!accessOf(it.id).bots.includes(botId)) {
      // request_login saves a login: an SSH key is only shared, in the Vault.
      if (kind === 'ssh-key') throw new Error(`This bot isn't allowed to use the SSH key "${it.name}". Ask the owner to share it with you in the Vault.`);
      if (kind === 'file') throw new Error(`This bot isn't allowed to use the file "${it.name}". Ask the owner to share it with you in the Vault.`);
      throw new Error(`This bot isn't allowed to use "${it.name}". Ask the owner with request_login, or they can allow it in the Vault.`);
    }
    return it;
  }

  // ---------- the vault interface ----------

  const loginItem = (input, base = {}) => ({
    ...base,
    type: 1,
    folderId,
    name: String(input.name || normalizeSite(input.site) || base.name || 'Login').slice(0, 100),
    login: {
      ...(base.login || {}),
      uris: input.site !== undefined ? [{ match: null, uri: `https://${normalizeSite(input.site)}` }] : base.login?.uris || [],
      username: input.username !== undefined ? String(input.username) : base.login?.username || null,
      password: input.password ? String(input.password) : base.login?.password || null,
    },
  });

  async function add(input) {
    needLocked();
    if (!folderId) await sync();
    if (!folderId) throw new Error("Couldn't find the bot-dot folder in Bitwarden. Try Sync on the Vault page.");
    const site = normalizeSite(input.site);
    if (!site) throw new Error('Website is required');
    if (!input.password) throw new Error('Password is required');
    const type = givenType(input.type) || 'login';
    if (type === githubApp.TYPE) githubApp.check(input); // an App ID and a private key it can use, or nothing is saved
    const allowedHosts = require('./network-address').exactHosts(input.allowedHosts);
    const into = folderId;
    const created = JSON.parse(await bw(['create', 'item'], { input: encode({ organizationId: null, collectionIds: null, notes: null, favorite: false, fields: [], reprompt: 0, ...loginItem(input) }) }));
    // inComputer ("Usable in its computer") is kept only when it is on: off is the default.
    // bw answers with the item as Bitwarden keeps it: in the bot-dot folder, or it isn't saved. That answer is kept
    // as it is, without downloading the whole vault again (a bw sync and a reading of the folder, seconds each).
    if (!created?.id || created.folderId !== into) throw new Error('Bitwarden did not keep the new login. Nothing was saved; please try again.');
    setAccess(created.id, { bots: Array.isArray(input.allowedBots) ? input.allowedBots.map(String) : [], insecureTls: !!input.insecureTls, allowedHosts, type, ...(input.inComputer ? { inComputer: true } : {}) });
    items = [...items.filter((x) => x.id !== created.id), created];
    return publicView(created);
  }

  // An SSH key the owner adds in the Vault (#160): pasted or picked (privateKey), or made here (generate). Saved as
  // Bitwarden's own SSH key item in the bot-dot folder, the kind run_with_ssh_key uses. Its public key and
  // fingerprint come from the private key (lib/ssh-keys.js), and bw needs all three.
  async function addSshKey(input) {
    needLocked();
    const name = String(input.name || '').trim().slice(0, 100);
    if (!name) throw new Error('Give the SSH key a name');
    const key = input.generate ? sshKeys.generate(`botdot:${name}`) : sshKeys.readPrivateKey(input.privateKey);
    if (!folderId) await sync();
    if (!folderId) throw new Error("Couldn't find the bot-dot folder in Bitwarden. Try Sync on the Vault page.");
    const into = folderId;
    const created = JSON.parse(await bw(['create', 'item'], { input: encode({ organizationId: null, collectionIds: null, notes: null, favorite: false, fields: [], reprompt: 0, type: 5, folderId: into, name, sshKey: { privateKey: key.privateKey, publicKey: key.publicKey, keyFingerprint: key.fingerprint } }) }));
    if (!created?.id || created.folderId !== into) throw new Error('Bitwarden did not keep the new SSH key. Nothing was saved; please try again.');
    setAccess(created.id, { bots: Array.isArray(input.allowedBots) ? input.allowedBots.map(String) : [] });
    items = [...items.filter((x) => x.id !== created.id), created];
    return publicView(created);
  }

  // A file the owner adds in the Vault (#157): checked (lib/vault-files.js), then saved as a secure note of the bot-dot
  // folder with the file in its hidden fields. Its bytes go to bw on stdin only, as every secret.
  async function addFile(input) {
    needLocked();
    const { fileName, bytes } = vaultFiles.readFile(input);
    const name = String(input.name || '').trim().slice(0, 100) || fileName;
    if (!folderId) await sync();
    if (!folderId) throw new Error("Couldn't find the bot-dot folder in Bitwarden. Try Sync on the Vault page.");
    const into = folderId;
    const notes = `A file of botdot (${fileName}). Its content is in the hidden fields; botdot reads them, so don't change them.`;
    const created = JSON.parse(await bw(['create', 'item'], { input: encode({ organizationId: null, collectionIds: null, favorite: false, reprompt: 0, type: 2, secureNote: { type: 0 }, folderId: into, name, notes, fields: vaultFiles.toFields(fileName, bytes) }) }));
    if (!created?.id || created.folderId !== into || !vaultFiles.isFileItem(created)) throw new Error('Bitwarden did not keep the new file. Nothing was saved; please try again.');
    setAccess(created.id, { bots: Array.isArray(input.allowedBots) ? input.allowedBots.map(String) : [] });
    items = [...items.filter((x) => x.id !== created.id), created];
    return publicView(created);
  }

  async function update(id, input) {
    needLocked();
    const it = items.find((x) => x.id === id);
    if (!it) return null;
    const isLogin = kindOf(it) === 'login';
    const type = givenType(input.type); // refused before anything of the item changes
    if (isLogin && (type ?? accessOf(id).type) === githubApp.TYPE) githubApp.check({ username: input.username ?? it.login?.username, password: input.password || it.login?.password });
    const allowedHosts = input.allowedHosts === undefined ? undefined : require('./network-address').exactHosts(input.allowedHosts);
    // The input names something of the Bitwarden item itself, and the item it makes differs from the one
    // there: only then is Bitwarden asked to edit it. So a change of the type, the bots or the hosts never
    // touches the owner's item, also when an editor sends the name, the address and the username along, as
    // they are. What the form does change is written as before: an emptied username too.
    const next = isLogin && ['name', 'site', 'username', 'password'].some((k) => input[k] !== undefined && input[k] !== '') ? loginItem(input, it) : null;
    const changesItem = !!next && (
      next.name !== it.name
      || siteOf(next) !== siteOf(it)
      || (next.login.username || '') !== (it.login?.username || '')
      || (next.login.password || '') !== (it.login?.password || ''));
    // An SSH key is renamed as it is, its key and everything else of it as they are (#182): the Chief renames one.
    const newName = kindOf(it) === 'ssh-key' && input.name !== undefined ? String(input.name).trim().slice(0, 100) : '';
    const renamed = newName && newName !== it.name ? { ...it, name: newName } : null;
    // Kept as bw answers it, as a new item is.
    if (changesItem || renamed) { const edited = JSON.parse(await bw(['edit', 'item', id], { input: encode(next || renamed) })); items = items.map((x) => (x.id === id ? edited : x)); }
    const patch = {};
    if (type !== undefined && isLogin) patch.type = type; // kept here, beside the item's bots
    if (Array.isArray(input.allowedBots)) patch.bots = input.allowedBots.map(String);
    if (input.insecureTls !== undefined) patch.insecureTls = !!input.insecureTls;
    if (input.inComputer !== undefined && isLogin) patch.inComputer = !!input.inComputer;
    if (input.allowedHosts !== undefined) patch.allowedHosts = allowedHosts;
    if (Object.keys(patch).length) setAccess(id, patch);
    return publicView(items.find((x) => x.id === id) || it);
  }

  async function upsert(input) {
    needLocked();
    const site = normalizeSite(input.site);
    const username = String(input.username || '').toLowerCase();
    // As in vault.js: without a username, a save that names a type changes only an item of that type.
    const same = items.find((it) => kindOf(it) === 'login' && siteOf(it) === site && String(it.login?.username || '').toLowerCase() === username && (username || input.type === undefined || itemType(accessOf(it.id).type) === input.type));
    // As in vault.js: without a type, a new item gets the one asked for, the one already saved keeps its own.
    if (!same) return add({ ...input, type: input.type ?? input.typeIfNew });
    return update(same.id, { name: input.name || same.name, password: input.password, insecureTls: input.insecureTls, inComputer: input.inComputer, allowedHosts: input.allowedHosts, allowedBots: [...new Set([...accessOf(same.id).bots, ...(input.allowedBots || [])])], type: input.type });
  }

  async function remove(id) {
    needLocked();
    if (!items.some((x) => x.id === id)) return false;
    await bw(['delete', 'item', id]); // goes to Bitwarden's trash, restorable there for 30 days
    const a = access(); delete a[id]; writeJson(ACCESS, a);
    items = items.filter((x) => x.id !== id);
    return true;
  }

  return {
    backend: 'bitwarden',
    BW,
    whenIdle,
    configured,
    unlocked,
    status,
    setup,
    unlock,
    lock,
    sync,
    waitUnlocked,
    normalizeSite,
    add, addSshKey, addFile, update, upsert, remove,
    list: () => (session ? items.filter((it) => LISTED.includes(kindOf(it))).map(publicView) : []),
    findBySite: (site) => (session ? items.filter((it) => kindOf(it) === 'login' && sameSite(siteOf(it), normalizeSite(site))).map(publicView) : []),
    // What a bot may use (names only). Includes cards and identities, which it can only type, and SSH keys, which
    // it can only use through an ssh-agent on its computer.
    forBot: (botId) => (session ? items.filter((it) => usable(it) && LISTED.includes(kindOf(it)) && accessOf(it.id).bots.includes(botId)).map(publicView).map(({ id, allowedBots, reprompt, updatedAt, hasPassword, insecureTls, inComputer, ...v }) => (inComputer ? { ...v, inComputer } : v)) : []),
    // The rest, which a bot sees but may not use until the owner shares it: a name, and a login's type and website.
    notSharedWith: (botId) => (session ? items.filter((it) => usable(it) && LISTED.includes(kindOf(it)) && !accessOf(it.id).bots.includes(botId)).map(publicView)
      .map(({ kind, name, type, site }) => (kind === 'login' ? { kind, name, type, site } : ['ssh-key', 'file'].includes(kind) ? { kind, name, type } : { kind, name })) : []),

    // An entry of every bot's list (forBot and notSharedWith: shared with that bot or not), by its name, else a login by its
    // address, for a bot that asks the owner to remove it (#132). Which one it is, never a secret of it.
    listedItem(ref) {
      needLocked();
      const q = String(ref || '').trim().toLowerCase();
      const listed = items.filter((it) => usable(it) && LISTED.includes(kindOf(it)));
      const named = listed.filter((it) => it.name.toLowerCase() === q);
      const host = normalizeSite(q);
      const matches = named.length ? named : listed.filter((it) => kindOf(it) === 'login' && sameSite(siteOf(it), host));
      if (!matches.length) throw new Error(`No entry called "${ref}" in the Vault. Use the name list_logins shows.`);
      if (matches.length > 1) throw new Error(`Several entries are called "${ref}". Name one by its address instead.`);
      const [it] = matches;
      return { id: it.id, kind: kindOf(it), name: it.name, site: kindOf(it) === 'login' ? siteOf(it) : '' };
    },

    // Only for typing into the bot's browser. Callers must not log or return the value.
    async reveal(botId, login, field) {
      const it = findFor(botId, login);
      let value;
      if (field === 'username') value = it.login?.username || '';
      else if (field === 'totp') {
        if (!it.login?.totp) throw new Error(`"${it.name}" has no two-step code saved in Bitwarden`);
        // Made here from the saved secret: a bw command would take seconds. One it can't make (Steam's) is bw's.
        value = totp(it.login.totp) ?? await bw(['get', 'totp', it.id]);
      } else value = it.login?.password || '';
      return { site: siteOf(it), allowedHosts: accessOf(it.id).allowedHosts || [], name: it.name, type: itemType(accessOf(it.id).type), value };
    },
    // As in vault.js: a login shared with this bot, without its secret.
    sharedLogin(botId, login) {
      const it = findFor(botId, login);
      return { id: it.id, name: it.name, site: siteOf(it), insecureTls: !!accessOf(it.id).insecureTls, inComputer: !!accessOf(it.id).inComputer };
    },
    // A login a project's cards call with (#804, ADR 126), by its id: the owner picked it for that project, so no
    // bot's share is asked. Only for bot-dot's own API calls (vault-http); callers must not log or return the values.
    projectCredentials(id) {
      needLocked();
      const it = items.find((x) => x.id === id && kindOf(x) === 'login');
      if (!it) throw new Error('That login is no longer in the Vault.');
      if (!usable(it)) throw new Error(`"${it.name}" asks for the master password again in Bitwarden, so it can't be used.`);
      return { name: it.name, type: itemType(accessOf(it.id).type), site: siteOf(it), allowedHosts: accessOf(it.id).allowedHosts || [], username: it.login?.username || '', password: it.login?.password || '', insecureTls: accessOf(it.id).insecureTls };
    },
    credentials(botId, login) {
      const it = findFor(botId, login);
      return { name: it.name, type: itemType(accessOf(it.id).type), site: siteOf(it), allowedHosts: accessOf(it.id).allowedHosts || [], username: it.login?.username || '', password: it.login?.password || '', insecureTls: accessOf(it.id).insecureTls, inComputer: !!accessOf(it.id).inComputer };
    },
    // A card field, for typing into a checkout page the owner approved.
    cardField(botId, card, field) {
      const it = findFor(botId, card, 'card');
      if (!CARD_FIELDS.includes(field)) throw new Error(`Card fields: ${CARD_FIELDS.join(', ')}`);
      const c = it.card || {};
      const mm = String(c.expMonth || '').padStart(2, '0');
      const value = field === 'expiry' ? `${mm}/${String(c.expYear || '').slice(-2)}` : field === 'expMonth' ? mm : String(c[field] || '');
      if (!value || value === '00/') throw new Error(`"${it.name}" has no ${field} saved`);
      return { name: it.name, last4: String(c.number || '').slice(-4), value };
    },
    card: (botId, card) => publicView(findFor(botId, card, 'card')),
    // An SSH key shared with the bot, for loading into an ssh-agent on its computer and nothing else (server.js
    // run-with-ssh-key). Callers must not log or return privateKey.
    sshKey(botId, key) {
      const it = findFor(botId, key, 'ssh-key');
      const privateKey = String(it.sshKey?.privateKey || '');
      if (!privateKey.trim()) throw new Error(`The SSH key "${it.name}" has no private key in Bitwarden`);
      return { name: it.name, fingerprint: String(it.sshKey?.keyFingerprint || ''), privateKey };
    },
    // A file shared with the bot, for one command on its computer and nothing else (run_with_file). Its content in
    // base64. Callers must not log or return it.
    file(botId, ref) {
      const it = findFor(botId, ref, 'file');
      const f = vaultFiles.fromFields(it.fields);
      if (!f.size) throw new Error(`The file "${it.name}" has no content in Bitwarden`);
      return { name: it.name, fileName: f.fileName, content: f.content };
    },
    identityField(botId, identity, field) {
      const it = findFor(botId, identity, 'identity');
      if (!IDENTITY_FIELDS.includes(field)) throw new Error(`Identity fields: ${IDENTITY_FIELDS.join(', ')}`);
      const i = it.identity || {};
      const value = field === 'fullName' ? [i.firstName, i.middleName, i.lastName].filter(Boolean).join(' ') : String(i[field] || '');
      if (!value) throw new Error(`"${it.name}" has no ${field} saved`);
      return { name: it.name, value };
    },
    setAccess,
    CARD_FIELDS,
    IDENTITY_FIELDS,
  };
}

// A two-step code (RFC 6238) from what Bitwarden keeps in a login's totp: a base32 secret, or an otpauth://totp/
// address with its own digits, period and algorithm. null for what it can't make (steam://, a secret that isn't base32).
function totp(saved, now = Date.now()) {
  let secret = String(saved || '').trim();
  let digits = 6, period = 30, algorithm = 'sha1';
  if (/^otpauth:\/\/totp\//i.test(secret)) {
    let q;
    try { q = new URL(secret).searchParams; } catch { return null; }
    secret = q.get('secret') || '';
    digits = Number(q.get('digits') || 6);
    period = Number(q.get('period') || 30);
    algorithm = String(q.get('algorithm') || 'sha1').toLowerCase();
  } else if (/^[a-z]+:\/\//i.test(secret)) return null;
  const clean = secret.replace(/[\s=-]/g, '').toUpperCase();
  if (!clean || /[^A-Z2-7]/.test(clean) || ![6, 7, 8].includes(digits) || !(period > 0) || !['sha1', 'sha256', 'sha512'].includes(algorithm)) return null;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of clean) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const h = require('crypto').createHmac(algorithm, key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

module.exports = { create, SERVERS, totp };
