// Password vault. Passwords are encrypted (AES-256-GCM) in data/vault.json; the key lives outside
// the data folder (macOS Keychain, or ~/.config/bot-dot/vault.key with 0600 permissions).
// Passwords are only ever decrypted to be typed into a bot's browser, never returned by the API,
// never passed to the model, and never written to logs.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exactHosts, hostname } = require('./network-address');
const { execFileSync } = require('child_process');

const KEYCHAIN_SERVICE = 'bot-dot-vault';

function loadKey() {
  if (process.env.BOT_DOT_VAULT_KEY) return Buffer.from(process.env.BOT_DOT_VAULT_KEY, 'hex');
  // macOS: keep the key in the login Keychain.
  if (process.platform === 'darwin' && !process.env.BOT_DOT_VAULT_KEY_FILE) {
    try {
      const hex = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', os.userInfo().username, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (hex) return Buffer.from(hex, 'hex');
    } catch { /* not created yet */ }
    const hex = crypto.randomBytes(32).toString('hex');
    try {
      execFileSync('security', ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', os.userInfo().username, '-w', hex, '-U'], { stdio: 'ignore' });
      return Buffer.from(hex, 'hex');
    } catch { /* fall back to a key file */ }
  }
  const file = process.env.BOT_DOT_VAULT_KEY_FILE || path.join(os.homedir(), '.config', 'bot-dot', 'vault.key');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const hex = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, hex + '\n', { mode: 0o600 });
  return Buffer.from(hex, 'hex');
}

let key = null;
const getKey = () => (key ||= loadKey());

// For backups: the key travels inside the (encrypted) backup, and a restore puts it back where
// loadKey looks for it. The folder also holds the backup passphrase's key (backup.js).
const keyFile = () => process.env.BOT_DOT_VAULT_KEY_FILE || path.join(os.homedir(), '.config', 'bot-dot', 'vault.key');
const keyDir = () => path.dirname(keyFile());
const keyHex = () => getKey().toString('hex');
function saveKey(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Not a vault key');
  key = null;
  if (process.env.BOT_DOT_VAULT_KEY) return; // given from outside; nothing to store
  if (process.platform === 'darwin' && !process.env.BOT_DOT_VAULT_KEY_FILE) {
    try { execFileSync('security', ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', os.userInfo().username, '-w', hex, '-U'], { stdio: 'ignore' }); return; } catch { /* the key file then */ }
  }
  fs.mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile(), hex + '\n', { mode: 0o600 });
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function decrypt(box) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]).toString('utf8');
}

// The types of a login-kind item: lib/vault-item-types.js.
const { ITEM_TYPES, isItemType, itemType, givenType } = require('./vault-item-types');

function create(dataDir) {
  const FILE = path.join(dataDir, 'vault.json');

  const load = () => {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).entries || []; } catch { return []; }
  };
  const save = (entries) => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };

  // Accept "recipes.example.com", "https://recipes.example.com/login" etc. and keep just the host.
  const normalizeSite = (site) => {
    const s = String(site || '').trim().toLowerCase();
    try { return new URL(s.includes('://') ? s : `https://${s}`).hostname; } catch { return s; }
  };

  // A login by id, name or website, then by one of its additional hosts (exactly), that this bot may use
  // (preferring allowed ones when several match).
  function findFor(botId, login) {
    const q = String(login || '').trim().toLowerCase();
    const host = normalizeSite(q);
    const all = load();
    const named = all.filter((x) => x.id === q || x.name.toLowerCase() === q || x.site === host);
    const matches = [...named, ...all.filter((x) => !named.includes(x) && (x.allowedHosts || []).includes(hostname(host)))];
    const e = matches.find((x) => x.allowedBots.includes(botId)) || matches[0];
    if (!e) throw new Error(`No saved login called "${login}"`);
    if (!e.allowedBots.includes(botId)) throw new Error(`This bot isn't allowed to use the "${e.name}" login. Ask the owner with request_login, or they can allow it in the Vault.`);
    return e;
  }

  // What the UI and bots may see. Never includes the password. Every item here is of kind login; one saved
  // before the types is a login.
  const publicView = ({ secret, ...e }) => ({ ...e, kind: 'login', type: itemType(e.type), hasPassword: !!secret, inComputer: !!e.inComputer });

  return {
    normalizeSite,
    list: () => load().map(publicView),
    findBySite: (site) => load().filter((e) => e.site === normalizeSite(site)).map(publicView),

    // Save from a pop-up: update the login for this site + username if there is one, else add it.
    upsert(input) {
      const site = normalizeSite(input.site);
      const username = String(input.username || '').toLowerCase();
      // The item of that site and username. Without a username only the site says which item is meant, and a
      // host can hold several secrets: a save that names a type then changes only an item of that type, so a
      // key saved beside an API token is a second item and the token stays as it is.
      const same = load().find((e) => e.site === site && e.username.toLowerCase() === username && (username || input.type === undefined || itemType(e.type) === input.type));
      // A save that names no type (an app from before the types): a new item gets the type that was asked
      // for (typeIfNew), and the one already saved keeps its own.
      if (!same) return this.add({ ...input, type: input.type ?? input.typeIfNew });
      return this.update(same.id, {
        name: input.name || same.name,
        password: input.password,
        insecureTls: input.insecureTls === undefined ? undefined : !!input.insecureTls,
        inComputer: input.inComputer === undefined ? undefined : !!input.inComputer,
        allowedHosts: input.allowedHosts,
        allowedBots: [...new Set([...same.allowedBots, ...(input.allowedBots || [])])],
        type: input.type,
      });
    },

    add(input) {
      const entries = load();
      const insecureTls = !!input.insecureTls;
      const site = normalizeSite(input.site);
      if (!site) throw new Error('Website is required');
      if (!input.password) throw new Error('Password is required');
      const type = givenType(input.type) || 'login';
      const now = new Date().toISOString();
      const entry = {
        id: crypto.randomUUID().slice(0, 8),
        name: String(input.name || site).slice(0, 60),
        type,
        site,
        allowedHosts: exactHosts(input.allowedHosts),
        username: String(input.username || ''),
        allowedBots: Array.isArray(input.allowedBots) ? input.allowedBots.map(String) : [],
        insecureTls, // accept a self-signed certificate when bots call this address's API
        inComputer: !!input.inComputer, // "Usable in its computer": run_with_login may hand it to a command there
        secret: encrypt(input.password),
        createdAt: now,
        updatedAt: now,
      };
      entries.push(entry);
      save(entries);
      return publicView(entry);
    },

    update(id, input) {
      const entries = load();
      const e = entries.find((x) => x.id === id);
      if (!e) return null;
      const type = givenType(input.type); // refused before anything of the item changes
      if (type !== undefined) e.type = type;
      if (input.name !== undefined) e.name = String(input.name).slice(0, 60);
      if (input.site !== undefined) e.site = normalizeSite(input.site);
      if (input.allowedHosts !== undefined) e.allowedHosts = exactHosts(input.allowedHosts);
      if (input.username !== undefined) e.username = String(input.username);
      if (Array.isArray(input.allowedBots)) e.allowedBots = input.allowedBots.map(String);
      if (input.insecureTls !== undefined) e.insecureTls = !!input.insecureTls;
      if (input.inComputer !== undefined) e.inComputer = !!input.inComputer;
      if (input.password) e.secret = encrypt(input.password); // empty = keep the current one
      e.updatedAt = new Date().toISOString();
      save(entries);
      return publicView(e);
    },

    remove(id) {
      const entries = load();
      const next = entries.filter((x) => x.id !== id);
      save(next);
      return next.length !== entries.length;
    },

    // Logins a bot may use, by id or name (case-insensitive), site or additional host.
    // inComputer only where it is on: the bot may use that one with run_with_login.
    forBot: (botId) => load().filter((e) => e.allowedBots.includes(botId)).map(({ name, site, username, type, allowedHosts, inComputer }) => ({ name, site, username, type: itemType(type), allowedHosts: allowedHosts || [], ...(inComputer ? { inComputer: true } : {}) })),
    // The rest, which a bot sees but may not use until the owner shares it: no username.
    notSharedWith: (botId) => load().filter((e) => !e.allowedBots.includes(botId)).map(({ name, site, type }) => ({ name, site, type: itemType(type) })),

    // Only for typing into the bot's browser. Callers must not log or return the value.
    reveal(botId, login, field) {
      const e = findFor(botId, login);
      return { site: e.site, allowedHosts: e.allowedHosts || [], name: e.name, value: field === 'username' ? e.username : decrypt(e.secret) };
    },

    // Everything, with passwords: only for moving the logins into Bitwarden.
    exportAll: () => load().map((e) => ({ ...publicView(e), password: decrypt(e.secret) })),

    // Only for bot-dot's own API calls (vault-http). Callers must not log or return the values.
    credentials(botId, login) {
      const e = findFor(botId, login);
      return { name: e.name, site: e.site, allowedHosts: e.allowedHosts || [], username: e.username, password: decrypt(e.secret), insecureTls: !!e.insecureTls, inComputer: !!e.inComputer };
    },
  };
}

module.exports = { create, encrypt, decrypt, keyHex, saveKey, keyDir, ITEM_TYPES, isItemType, itemType, givenType };
