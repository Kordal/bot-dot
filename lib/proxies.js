// The account's proxies (ADR 171): HTTP or SOCKS5 servers its bots' browsers go out through, each with its login, in
// data/proxies.json. A password is encrypted with the Vault's key (lib/vault.js) and leaves this file only for a bot's
// bridge (forBridge) and botdot's own test (lib/proxy-check.js): never in the API, to the Chief or to a bot.
// Which one a bot uses: its own choice (bot.proxy, an id), 'none', or '' for the account's (settings.proxy, '' = none).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./vault');

const TYPES = ['socks5', 'http'];
const HOST = /^[A-Za-z0-9._:-]{1,253}$/;
const ID = /^[a-f0-9]{8}$/;
const MAX = 50;
// What a bot's or the account's choice may be: '' (the account's, or none for the account), 'none', or a proxy's id.
const cleanRef = (value) => {
  const v = String(value ?? '').trim();
  return v === 'none' || ID.test(v) ? v : '';
};

// A proxy as the owner types or pastes it: type, host, port, login. A pasted address
// (socks5://user:pass@host:port, http://host:port, host:port:user:pass as providers list them) in host fills the rest.
function parsed(input = {}) {
  const out = { ...input };
  const raw = String(input.host ?? '').trim();
  const url = raw.match(/^(socks5h?|socks|https?):\/\/(.+)$/i);
  if (url) {
    try {
      const u = new URL(`http://${url[2]}`);
      out.type = /^socks/i.test(url[1]) ? 'socks5' : 'http';
      out.host = u.hostname.replace(/^\[|\]$/g, '');
      if (u.port) out.port = Number(u.port);
      if (u.username) out.username = decodeURIComponent(u.username);
      if (u.password) out.password = decodeURIComponent(u.password);
    } catch { /* checked below as it is */ }
  } else {
    const parts = raw.split(':');
    if (parts.length === 4 && /^\d+$/.test(parts[1])) [out.host, out.port, out.username, out.password] = [parts[0], Number(parts[1]), parts[2], parts[3]];
    else if (parts.length === 2 && /^\d+$/.test(parts[1])) [out.host, out.port] = [parts[0], Number(parts[1])];
  }
  return out;
}

function checked(input, before = null) {
  const p = parsed(input);
  const type = p.type ?? before?.type ?? 'socks5';
  if (!TYPES.includes(type)) throw new Error('Type must be socks5 or http');
  const host = String(p.host ?? before?.host ?? '').trim().replace(/^\[|\]$/g, '');
  if (!HOST.test(host)) throw new Error('Give the proxy\'s host, e.g. proxy.example.com');
  const port = Number(p.port ?? before?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Give the proxy\'s port, 1 to 65535');
  const username = String(p.username ?? before?.username ?? '');
  const password = p.password === undefined || p.password === '' ? null : String(p.password);
  if (username.length > 255 || (password || '').length > 255) throw new Error('A login has at most 255 characters');
  const name = String(p.name ?? before?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || host;
  return { type, host, port, username, password, name };
}

function create(dataDir) {
  const FILE = path.join(dataDir, 'proxies.json');
  const load = () => { try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')).proxies; return Array.isArray(l) ? l : []; } catch { return []; } };
  const save = (list) => {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify({ version: 1, proxies: list }, null, 2), { mode: 0o600 });
    fs.renameSync(FILE + '.tmp', FILE);
  };
  // What the apps and the Chief see: never the password, only whether there is one.
  const publicView = ({ secret, ...p }) => ({ ...p, hasPassword: !!secret });
  const withPassword = (p) => ({ type: p.type, host: p.host, port: p.port, username: p.username || '', password: p.secret ? decrypt(p.secret) : '', name: p.name });

  return {
    list: () => load().map(publicView),
    get: (id) => { const p = load().find((x) => x.id === id); return p ? publicView(p) : null; },
    add(input) {
      const list = load();
      if (list.length >= MAX) throw new Error(`At most ${MAX} proxies`);
      const c = checked(input);
      const now = new Date().toISOString();
      const p = { id: crypto.randomBytes(4).toString('hex'), name: c.name, type: c.type, host: c.host, port: c.port, username: c.username, ...(c.password ? { secret: encrypt(c.password) } : {}), createdAt: now, updatedAt: now };
      list.push(p);
      save(list);
      return publicView(p);
    },
    // An empty password keeps the saved one; a new login without one (username '') drops it.
    update(id, input) {
      const list = load();
      const p = list.find((x) => x.id === id);
      if (!p) return null;
      const c = checked(input, p);
      Object.assign(p, { name: c.name, type: c.type, host: c.host, port: c.port, username: c.username, updatedAt: new Date().toISOString() });
      if (c.password) p.secret = encrypt(c.password);
      else if (!c.username) delete p.secret;
      if (input.host !== undefined || input.port !== undefined || input.type !== undefined || input.username !== undefined || input.password) delete p.lastTest;
      save(list);
      return publicView(p);
    },
    remove(id) {
      const list = load();
      const next = list.filter((x) => x.id !== id);
      if (next.length === list.length) return false;
      save(next);
      return true;
    },
    // A test's result, kept beside it so every app shows it: { ok, ip, country, city, ms, error, at }.
    tested(id, result) {
      const list = load();
      const p = list.find((x) => x.id === id);
      if (!p) return null;
      p.lastTest = { ...result, at: new Date().toISOString() };
      save(list);
      return publicView(p);
    },
    // Only for a bot's bridge and botdot's test: callers must not log or return it.
    forBridge: (id) => { const p = load().find((x) => x.id === id); return p ? withPassword(p) : null; },
    // A form's proxy before it is saved, for its test: an empty password is the saved one's, when it has an id.
    draft(input, id) {
      const before = id ? load().find((x) => x.id === id) : null;
      const c = checked(input, before);
      return { ...c, password: c.password ?? (before?.secret && c.username === before.username ? decrypt(before.secret) : '') };
    },
  };
}

module.exports = { create, cleanRef, parsed, checked, TYPES };
