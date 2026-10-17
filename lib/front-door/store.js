// What the front door keeps (ADR 028): accounts, their passkeys, the sessions signed in with them, sign-up links and
// the admin's sign-in links, the accounts the admin deleted (their names only, which root's step reads), and each
// account's share of the machine (the default, and an account's own, which root's step applies). One file, front-door.json, private to the front door's user, read again when another process (the
// command that makes a sign-up link) changed it. A session and a sign-up link are kept as their SHA-256 only: the
// file never holds what lets someone in. Nothing that belongs inside an account is here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LINK_DAYS = 7;
// A sign-in link (the admin's, for an owner who lost every device) gives a way into an account that exists: one day.
const SIGN_IN_LINK_DAYS = 1;
const DAY = 24 * 3600_000;
// How stale an account's "last seen" may get before a request writes it again: not every request rewrites the file.
const SEEN_EVERY = 5 * 60_000;
// Also the name of the account's socket folder, of its Linux user (botdot-<name>, at most 31 characters) and, later,
// in its call addresses.
const ACCOUNT_NAME = /^[a-z][a-z0-9-]{1,23}$/;
const NAME_RULE = "An account's name is 2 to 24 lowercase letters, digits and dashes, starting with a letter.";
const APPS = ['web', 'android', 'mac'];
// An account's share of the machine (ADR 028): CPUs and GB of RAM (hard limits), how many bots' computers run at once,
// and GB of disk. The same default for every account unless the admin gives one its own. The default RAM holds an idle
// account and one running computer (ADR 028, "Spike result"); the default disk holds its images (7.2 GB) and its data.
const DEFAULT_SHARE = { cpu: 2, ram: 5, computers: 2, disk: 30 };
const SHARE_RANGE = { cpu: [1, 256], ram: [2, 4096], computers: [1, 50], disk: [12, 100000] };
const SHARE_RULE = 'A share is whole numbers: 1 to 256 CPUs, 2 to 4096 GB of RAM, 1 to 50 computers and 12 to 100000 GB of disk.';
// A share from the admin page, checked: { cpu, ram, computers, disk }, or throws with the status 400.
function checkShare(share) {
  const ok = share && typeof share === 'object' && Object.keys(SHARE_RANGE).every((k) => Number.isInteger(share[k]) && share[k] >= SHARE_RANGE[k][0] && share[k] <= SHARE_RANGE[k][1]);
  if (!ok) throw Object.assign(new Error(SHARE_RULE), { status: 400 });
  return { cpu: share.cpu, ram: share.ram, computers: share.computers, disk: share.disk };
}

// Whether a sign-up link still makes an account: not used, not revoked, not ended.
const isOpen = (link, now) => !!link && !link.usedAt && !link.revokedAt && Date.parse(link.expires) > now;
const hash = (secret) => crypto.createHash('sha256').update(String(secret)).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
// A link as the admin page shows it.
function shown(id, link, now) {
  const state = link.usedAt ? 'used' : isOpen(link, now) ? 'open' : 'ended';
  const out = { id, created: link.created, expires: link.expires, state };
  for (const k of ['for', 'signIn', 'account', 'usedAt', 'revokedAt']) if (link[k]) out[k] = link[k];
  return out;
}

function open(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const FILE = path.join(dir, 'front-door.json');
  let cache = null;
  let cachedAt = null;

  function load() {
    let stat = null;
    try { stat = fs.statSync(FILE); } catch { /* none yet */ }
    const stamp = stat ? `${stat.mtimeMs}:${stat.size}:${stat.ino}` : 'none';
    if (cache && cachedAt === stamp) return cache;
    const empty = { accounts: {}, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {}, share: null };
    cache = stat ? { ...empty, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) } : empty;
    cachedAt = stamp;
    return cache;
  }
  function save(data) {
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
    cache = null;
  }
  const change = (fn) => { const data = load(); const out = fn(data); save(data); return out; };

  // ---------- sign-up links ----------

  // A new sign-up link: { url, expires }. origin: the front door's address. account: the one account it may make
  // (the install's link makes the admin's), or any name the person picks. Throws with a status when that account
  // exists already.
  function newSignUpLink({ origin, account = null, now = Date.now() }) {
    if (account !== null && !ACCOUNT_NAME.test(account)) throw Object.assign(new Error(NAME_RULE), { status: 400 });
    if (account !== null && accountExists(account)) throw Object.assign(new Error(`The account ${account} exists already.`), { status: 409 });
    const token = secret();
    const expires = now + LINK_DAYS * DAY;
    const id = hash(token);
    const link = change((d) => (d.signUpLinks[id] = { created: new Date(now).toISOString(), expires: new Date(expires).toISOString(), ...(account ? { for: account } : {}) }));
    return { url: `${origin}/sign-up/${token}`, expires, link: shown(id, link, now) };
  }
  // A new sign-in link for the account `account`, which exists: { url, expires, link }. Opened, it makes a new passkey
  // for that account (an owner who lost every device), once, within SIGN_IN_LINK_DAYS. It goes where a sign-up link
  // goes, /sign-up/<token>, and is listed with them (signIn: true). Throws with a status when there is no such account.
  function newSignInLink({ origin, account, now = Date.now() }) {
    if (!accountExists(account)) throw Object.assign(new Error(`There is no account ${account}.`), { status: 404 });
    const token = secret();
    const expires = now + SIGN_IN_LINK_DAYS * DAY;
    const id = hash(token);
    const link = change((d) => (d.signUpLinks[id] = { created: new Date(now).toISOString(), expires: new Date(expires).toISOString(), for: account, signIn: true }));
    return { url: `${origin}/sign-up/${token}`, expires, link: shown(id, link, now) };
  }
  // The open link for this token, or null: unknown, used, revoked or ended.
  function openLink(token, now = Date.now()) {
    const link = load().signUpLinks[hash(token)];
    return isOpen(link, now) ? link : null;
  }

  // Every sign-up link, newest first, as the admin page lists them: { id, created, expires, state, for?, signIn?,
  // account?, usedAt?, revokedAt? }. id is the link's hash, which lets nobody in. state: 'open', 'used' (account: the account it
  // made) or 'ended' (it ran out, or the admin revoked it: revokedAt).
  function listLinks(now = Date.now()) {
    return Object.entries(load().signUpLinks).map(([id, link]) => shown(id, link, now))
      .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
  }
  // The admin revokes an open link: it makes no account from now on. Throws with a status when there is no such link
  // (404) or it is not open (409). The link as listed.
  function revokeLink(id, now = Date.now()) {
    return change((d) => {
      const link = typeof id === 'string' && Object.hasOwn(d.signUpLinks, id) ? d.signUpLinks[id] : null;
      if (!link) throw Object.assign(new Error('There is no such sign-up link.'), { status: 404 });
      if (!isOpen(link, now)) throw Object.assign(new Error('This sign-up link was used or has ended.'), { status: 409 });
      link.revokedAt = new Date(now).toISOString();
      return shown(id, link, now);
    });
  }

  // ---------- accounts and passkeys ----------

  const accountExists = (name) => Object.hasOwn(load().accounts, name);
  const accountCount = () => Object.keys(load().accounts).length;

  // The account from an open sign-up link, with its first passkey. The link is used by it. Throws with a status
  // when the link is no longer open or the name was taken meanwhile.
  function createAccount({ token, name, userId, passkey, now = Date.now() }) {
    return change((d) => {
      const link = d.signUpLinks[hash(token)];
      if (!isOpen(link, now)) throw Object.assign(new Error('This sign-up link was used or has ended.'), { status: 410 });
      if (link.signIn) throw Object.assign(new Error('This link makes a new passkey for an account that exists.'), { status: 400 });
      if (link.for && link.for !== name) throw Object.assign(new Error(`This sign-up link is for the account ${link.for}.`), { status: 400 });
      if (Object.hasOwn(d.accounts, name)) throw Object.assign(new Error('That name is taken.'), { status: 409 });
      if (Object.hasOwn(d.passkeys, passkey.id)) throw Object.assign(new Error('That passkey belongs to an account already.'), { status: 409 });
      const at = new Date(now).toISOString();
      link.usedAt = at;
      link.account = name;
      d.accounts[name] = { created: at, userId };
      delete d.deleted[name];
      d.passkeys[passkey.id] = { account: name, alg: passkey.alg, jwk: passkey.jwk, signCount: passkey.signCount, created: at };
    });
  }
  // A new passkey for an account that exists, from the admin's open sign-in link for it, which it uses. Every session
  // of the account ends (its owner lost the devices they were on); its other passkeys stay. Throws with a status when
  // the link is no longer open or the account is gone.
  function addPasskey({ token, name, passkey, now = Date.now() }) {
    return change((d) => {
      const link = d.signUpLinks[hash(token)];
      if (!isOpen(link, now) || !link.signIn) throw Object.assign(new Error('This sign-in link was used or has ended.'), { status: 410 });
      if (link.for !== name || !Object.hasOwn(d.accounts, name)) throw Object.assign(new Error(`This sign-in link is for the account ${link.for}.`), { status: 400 });
      if (Object.hasOwn(d.passkeys, passkey.id)) throw Object.assign(new Error('That passkey belongs to an account already.'), { status: 409 });
      const at = new Date(now).toISOString();
      link.usedAt = at;
      link.account = name;
      d.passkeys[passkey.id] = { account: name, alg: passkey.alg, jwk: passkey.jwk, signCount: passkey.signCount, created: at };
      for (const h of Object.keys(d.sessions)) if (d.sessions[h].account === name) delete d.sessions[h];
    });
  }
  // The account's own user handle, which a new passkey of it is made with.
  const userIdOf = (name) => (accountExists(name) ? load().accounts[name].userId : null);

  // ---------- the admin's accounts ----------

  // Every account, by name, as the admin page lists it: { name, created, lastSeen, share, ownShare, suspended? }.
  // Nothing else: the front door holds nothing from inside an account, and this is all it shows of one.
  function listAccounts() {
    const d = load();
    return Object.entries(d.accounts).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, a]) => ({
      name, created: a.created, lastSeen: a.lastSeen || null, share: a.share || d.share || DEFAULT_SHARE, ownShare: !!a.share,
      ...(a.suspended ? { suspended: a.suspended } : {}),
    }));
  }

  // ---------- shares of the machine ----------

  // The share every account has unless the admin gave it its own.
  const defaultShare = () => load().share || DEFAULT_SHARE;
  // The admin sets the default share: { cpu, ram, computers, disk }. Returns the accounts it applies to (those
  // without a share of their own), which the machine is asked about. Throws with the status 400 for a share that isn't one.
  function setDefaultShare(share) {
    const checked = checkShare(share);
    return change((d) => {
      d.share = checked;
      return Object.keys(d.accounts).filter((name) => !d.accounts[name].share).sort();
    });
  }
  // The admin gives one account its own share, or with null, the default again. Throws with a status: 400 for a share
  // that isn't one, 404 for no such account.
  function setAccountShare(name, share) {
    const checked = share === null ? null : checkShare(share);
    return change((d) => {
      const a = typeof name === 'string' && Object.hasOwn(d.accounts, name) ? d.accounts[name] : null;
      if (!a) throw Object.assign(new Error(`There is no account ${name}.`), { status: 404 });
      if (checked) a.share = checked; else delete a.share;
      return a.share || d.share || DEFAULT_SHARE;
    });
  }
  const isSuspended = (name) => accountExists(name) && !!load().accounts[name].suspended;
  // The account was reached with one of its sessions: kept as its last seen, at most every SEEN_EVERY.
  function seen(name, now = Date.now()) {
    const a = accountExists(name) ? load().accounts[name] : null;
    if (!a || (a.lastSeen && now - Date.parse(a.lastSeen) < SEEN_EVERY)) return;
    change((d) => { if (d.accounts[name]) d.accounts[name].lastSeen = new Date(now).toISOString(); });
  }
  // The admin suspends (true) or resumes (false) an account. Throws with a status: 404 no such account, 409 when it is
  // suspended already, or running already.
  function setSuspended(name, suspended, now = Date.now()) {
    return change((d) => {
      const a = typeof name === 'string' && Object.hasOwn(d.accounts, name) ? d.accounts[name] : null;
      if (!a) throw Object.assign(new Error(`There is no account ${name}.`), { status: 404 });
      if (!!a.suspended === suspended) throw Object.assign(new Error(suspended ? `The account ${name} is suspended already.` : `The account ${name} isn't suspended.`), { status: 409 });
      if (suspended) a.suspended = new Date(now).toISOString(); else delete a.suspended;
    });
  }
  // The admin deletes an account: it, its passkeys, its sessions and its open sign-in links go, and its name is kept in
  // `deleted`, which tells root's step to erase it from the machine. Throws with a status 404 when there is no such
  // account.
  function deleteAccount(name, now = Date.now()) {
    return change((d) => {
      if (typeof name !== 'string' || !Object.hasOwn(d.accounts, name)) throw Object.assign(new Error(`There is no account ${name}.`), { status: 404 });
      delete d.accounts[name];
      d.deleted[name] = new Date(now).toISOString();
      for (const id of Object.keys(d.passkeys)) if (d.passkeys[id].account === name) delete d.passkeys[id];
      for (const h of Object.keys(d.sessions)) if (d.sessions[h].account === name) delete d.sessions[h];
      for (const link of Object.values(d.signUpLinks)) if (link.signIn && link.for === name && isOpen(link, now)) link.revokedAt = new Date(now).toISOString();
    });
  }
  // Whether the admin deleted an account of this name (which no account has since).
  const wasDeleted = (name) => typeof name === 'string' && Object.hasOwn(load().deleted, name);

  // The one account of a machine of one account (FRONT_DOOR_ONE_ACCOUNT, made with its setup key), with its passkey.
  // Throws with a status when the machine has an account already.
  function createOnlyAccount({ name, userId, passkey, now = Date.now() }) {
    return change((d) => {
      if (Object.keys(d.accounts).length) throw Object.assign(new Error('This machine has its account already.'), { status: 410 });
      const at = new Date(now).toISOString();
      d.accounts[name] = { created: at, userId };
      d.passkeys[passkey.id] = { account: name, alg: passkey.alg, jwk: passkey.jwk, signCount: passkey.signCount, created: at };
    });
  }
  const passkey = (id) => (typeof id === 'string' && Object.hasOwn(load().passkeys, id) ? load().passkeys[id] : null);
  function counted(id, signCount) { change((d) => { if (d.passkeys[id]) d.passkeys[id].signCount = signCount; }); }

  // ---------- sessions ----------

  // A new session of `account` in one app: the secret its cookie holds.
  function newSession(account, app, now = Date.now()) {
    const token = secret();
    change((d) => { d.sessions[hash(token)] = { account, app: APPS.includes(app) ? app : 'web', created: new Date(now).toISOString() }; });
    return token;
  }
  // The account a session's secret belongs to, or null.
  function sessionAccount(token) {
    if (typeof token !== 'string' || !token) return null;
    const s = load().sessions[hash(token)];
    return s && Object.hasOwn(load().accounts, s.account) ? s.account : null;
  }
  function endSession(token) { if (token) change((d) => { delete d.sessions[hash(token)]; }); }
  // "Sign out everywhere": every session of `account`, in every app, ends. Returns how many did.
  function endAccountSessions(account) {
    return change((d) => {
      const ended = Object.keys(d.sessions).filter((h) => d.sessions[h].account === account);
      for (const h of ended) delete d.sessions[h];
      return ended.length;
    });
  }

  return {
    newSignUpLink, newSignInLink, openLink, listLinks, revokeLink, accountExists, accountCount, createAccount, createOnlyAccount, addPasskey, userIdOf,
    listAccounts, defaultShare, setDefaultShare, setAccountShare, isSuspended, seen, setSuspended, deleteAccount, wasDeleted, passkey, counted, newSession, sessionAccount, endSession, endAccountSessions,
  };
}

module.exports = { open, ACCOUNT_NAME, NAME_RULE, LINK_DAYS, SIGN_IN_LINK_DAYS, DEFAULT_SHARE, SHARE_RULE };
