// @ts-check
// What the front door keeps (ADR 028): accounts, their passkeys, the sessions signed in with them, sign-up links and
// the admin's sign-in links, the accounts the admin deleted (their names only, which root's step reads), and each
// account's share of the machine (the default, and an account's own, which root's step applies), and the feedback an
// account's owner sent the admin (#216): what they typed and the screenshots they added (#223), nothing else. One file, front-door.json, private to the front door's user, read again when another process (the
// command that makes a sign-up link) changed it. A session and a sign-up link are kept as their SHA-256 only: the
// file never holds what lets someone in. Nothing else that belongs inside an account is here.
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
// An account's share of the machine (ADR 028): CPUs and GB of RAM (hard limits, and the limits of the account's one
// computer, ADR 035, #108), and GB of disk. The same default for every account unless the admin gives one its own.
// The default RAM holds an idle account and its computer (ADR 028, "Spike result"); the default disk holds its images
// (7.2 GB) and its data.
const DEFAULT_SHARE = { cpu: 2, ram: 5, disk: 30 };
// On a machine whose RAM root's step measured, the default RAM is half of it, at least DEFAULT_SHARE's (install.sh
// DEFAULT_RAM has the same rule): under gVisor a sandbox keeps its file cache in its own memory, so an account held to
// 4 GB on a 16 GB machine filled it and thrashed its disk (#126). Bytes of RAM in, whole GB out.
const defaultRam = (ramTotal) => {
  if (!Number.isFinite(ramTotal) || ramTotal <= 0) return DEFAULT_SHARE.ram;
  return Math.min(SHARE_RANGE.ram[1], Math.max(DEFAULT_SHARE.ram, Math.floor(Math.round(ramTotal / 2 ** 30) / 2)));
};
const SHARE_RANGE = { cpu: [1, 256], ram: [2, 4096], disk: [12, 100000] };
const SHARE_RULE = 'A share is whole numbers: 1 to 256 CPUs, 2 to 4096 GB of RAM and 12 to 100000 GB of disk.';
// A share as it is kept and handed out: { cpu, ram, disk }. One kept before #108 also has `computers` (how many of the
// bots' computers ran at once), which is read without it, as is one an older admin page sends.
const shareOf = (share) => ({ cpu: share.cpu, ram: share.ram, disk: share.disk });
// A share from the admin page, checked: { cpu, ram, disk }, or throws with the status 400.
function checkShare(share) {
  const ok = share && typeof share === 'object' && Object.keys(SHARE_RANGE).every((k) => Number.isInteger(share[k]) && share[k] >= SHARE_RANGE[k][0] && share[k] <= SHARE_RANGE[k][1]);
  if (!ok) throw Object.assign(new Error(SHARE_RULE), { status: 400 });
  return shareOf(share);
}

// Feedback (#216): a bug or a feature request an owner sends the admin from Settings' neighbour, on the web page or
// in the Android app. Only what they typed is kept, with the account, the time, the kind, the app and the version.
const FEEDBACK_KINDS = ['bug', 'feature'];
const FEEDBACK_MAX = 2000; // characters of text
const FEEDBACK_KEPT = 1000; // reports kept: past that, the oldest goes
const FEEDBACK_PER_HOUR = 10; // reports one account sends in an hour
const FEEDBACK_ID = /^[0-9a-f]{32}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
// Screenshots a report may hold (#223): at most 3, each at most 5 MB, as PNG, JPEG or WebP, its type read from its first
// bytes and never from what the app says. No SVG (it can carry script) and no GIF. Each is its own file in
// feedback-screenshots/, beside front-door.json, and the report keeps only its type and size. Past 500 MB of them on
// the machine, the oldest reports' screenshots go first, and those reports keep their text.
const SCREENSHOTS_MAX = 3;
const SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOTS_KEPT_BYTES = 500 * 1024 * 1024;
const SCREENSHOT_RULE = 'A screenshot is a PNG, JPEG or WebP picture.';
// The type of a picture from its first bytes, or null for anything else.
function pictureType(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
// The screenshots a report was sent with, checked: [{ type, bytes }], or throws with the status 400 in plain words.
// Each comes as { data: base64 } (a type sent with it is not read).
function checkScreenshots(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw fail(400, 'The screenshots are a list.');
  if (list.length > SCREENSHOTS_MAX) throw fail(400, `That is ${list.length} screenshots: at most ${SCREENSHOTS_MAX} go in one report.`);
  return list.map((s, i) => {
    const data = s && typeof s === 'object' ? s.data : null;
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw fail(400, `Screenshot ${i + 1} isn't a picture. ${SCREENSHOT_RULE}`);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > SCREENSHOT_BYTES) throw fail(400, `Screenshot ${i + 1} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB: each can be at most 5 MB.`);
    const type = pictureType(bytes);
    if (!type) throw fail(400, `Screenshot ${i + 1} isn't a PNG, JPEG or WebP picture. ${SCREENSHOT_RULE}`);
    return { type, bytes };
  });
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

// machineRam: the machine's bytes of RAM as root's step measured them, or null while unknown.
// screenshotsKept: the bytes of Feedback screenshots kept on the machine (SCREENSHOTS_KEPT_BYTES; smaller in tests).
function open(dir, { machineRam = () => null, screenshotsKept = SCREENSHOTS_KEPT_BYTES } = {}) {
  const fallback = () => ({ ...DEFAULT_SHARE, ram: defaultRam(machineRam()) });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const FILE = path.join(dir, 'front-door.json');
  const SHOTS = path.join(dir, 'feedback-screenshots');
  const shotFile = (id, n) => path.join(SHOTS, `${id}-${n}`);
  // A report's screenshot files go: when it goes, its account goes, or the machine keeps too many.
  const dropShots = (report) => { for (let n = 0; n < (report.screenshots?.length || 0); n++) fs.rmSync(shotFile(report.id, n), { force: true }); };
  let cache = null;
  let cachedAt = null;

  function load() {
    let stat = null;
    try { stat = fs.statSync(FILE); } catch { /* none yet */ }
    const stamp = stat ? `${stat.mtimeMs}:${stat.size}:${stat.ino}` : 'none';
    if (cache && cachedAt === stamp) return cache;
    const empty = { accounts: {}, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {}, share: null, feedback: [] };
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
      name, created: a.created, lastSeen: a.lastSeen || null, share: shareOf(a.share || d.share || fallback()), ownShare: !!a.share,
      ...(a.suspended ? { suspended: a.suspended } : {}),
    }));
  }

  // ---------- shares of the machine ----------

  // The share every account has unless the admin gave it its own.
  const defaultShare = () => shareOf(load().share || fallback());
  // The admin sets the default share: { cpu, ram, disk }. Returns the accounts it applies to (those
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
      return shareOf(a.share || d.share || fallback());
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
  // The admin deletes an account: it, its passkeys, its sessions, its open sign-in links and its Feedback go, and its name is kept in
  // `deleted`, which tells root's step to erase it from the machine. Throws with a status 404 when there is no such
  // account.
  function deleteAccount(name, now = Date.now()) {
    const gone = change((d) => {
      if (typeof name !== 'string' || !Object.hasOwn(d.accounts, name)) throw Object.assign(new Error(`There is no account ${name}.`), { status: 404 });
      delete d.accounts[name];
      d.deleted[name] = new Date(now).toISOString();
      for (const id of Object.keys(d.passkeys)) if (d.passkeys[id].account === name) delete d.passkeys[id];
      for (const h of Object.keys(d.sessions)) if (d.sessions[h].account === name) delete d.sessions[h];
      for (const link of Object.values(d.signUpLinks)) if (link.signIn && link.for === name && isOpen(link, now)) link.revokedAt = new Date(now).toISOString();
      const theirs = d.feedback.filter((f) => f.account === name);
      d.feedback = d.feedback.filter((f) => f.account !== name);
      return theirs;
    });
    gone.forEach(dropShots);
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

  // ---------- feedback ----------

  // An owner's report: { kind: 'bug' | 'feature', text, screenshots? } from `account`, sent in `app`, on `version` (or
  // null). screenshots: [{ data: base64 }], checked by checkScreenshots. The report as kept: { id, account, created,
  // kind, text, app, version, screenshots? }, screenshots: [{ type, size }] (the bytes are files of their own). Throws
  // with a status: 400 for a kind, a text or a screenshot that isn't one, 429 for the 11th from one account within an hour.
  function addFeedback({ account, kind, text, screenshots, app, version = null, now = Date.now() }) {
    if (!FEEDBACK_KINDS.includes(kind)) throw fail(400, 'Pick Bug or Feature request.');
    const said = typeof text === 'string' ? text.trim() : '';
    if (!said) throw fail(400, 'Write what happened, or what you would like.');
    if (said.length > FEEDBACK_MAX) throw fail(400, `That is ${said.length} characters: at most ${FEEDBACK_MAX} go in one report. Make it shorter.`);
    const shots = checkScreenshots(screenshots);
    if (load().feedback.filter((f) => f.account === account && now - Date.parse(f.created) < 3600_000).length >= FEEDBACK_PER_HOUR) throw fail(429, `You sent ${FEEDBACK_PER_HOUR} reports in the last hour. Try again later.`);
    const report = { id: crypto.randomBytes(16).toString('hex'), account, created: new Date(now).toISOString(), kind, text: said, app: APPS.includes(app) ? app : 'web', version: typeof version === 'string' ? version : null };
    // The pictures are written before the report is kept, and gone again if it isn't: a kept report always has its files.
    // Those of the reports that make way go once the file no longer names them.
    if (shots.length) report.screenshots = shots.map((s) => ({ type: s.type, size: s.bytes.length }));
    let gone = [];
    try {
      if (shots.length) {
        fs.mkdirSync(SHOTS, { recursive: true, mode: 0o700 });
        shots.forEach((s, n) => fs.writeFileSync(shotFile(report.id, n), s.bytes, { mode: 0o600 }));
      }
      gone = change((d) => {
        const out = [];
        d.feedback.push({ ...report });
        if (d.feedback.length > FEEDBACK_KEPT) out.push(...d.feedback.splice(0, d.feedback.length - FEEDBACK_KEPT));
        // Past the machine's 500 MB of screenshots, the oldest reports' go first; each keeps its text and says they went.
        let total = d.feedback.reduce((sum, f) => sum + (f.screenshots || []).reduce((t, s) => t + s.size, 0), 0);
        for (const f of d.feedback) {
          if (total <= screenshotsKept) break;
          if (!f.screenshots?.length || f.id === report.id) continue;
          total -= f.screenshots.reduce((t, s) => t + s.size, 0);
          out.push({ ...f });
          delete f.screenshots;
          f.screenshotsDeleted = true;
        }
        return out;
      });
    } catch (e) { dropShots(report); throw e; }
    gone.forEach(dropShots);
    return { ...report };
  }
  // Every report, newest first, as the admin page lists them: { id, account, created, kind, text, app, version,
  // screenshots?: [{ id, type, size }] (id: its number in the report, from 0), screenshotsDeleted?, doneAt? }.
  const listFeedback = () => load().feedback.slice().reverse().map((f) => ({ ...f, ...(f.screenshots ? { screenshots: f.screenshots.map((s, id) => ({ id, ...s })) } : {}) }));
  // A report's screenshot n for the admin page: { type, bytes }, or null when there is no such report or screenshot.
  function feedbackScreenshot(id, n) {
    const f = FEEDBACK_ID.test(String(id)) ? load().feedback.find((x) => x.id === id) : null;
    const shot = f && Number.isInteger(n) ? f.screenshots?.[n] : null;
    if (!shot) return null;
    try { return { type: shot.type, bytes: fs.readFileSync(shotFile(f.id, n)) }; } catch { return null; }
  }
  // The admin marks a report done (it stays, shown as done) or deletes it, with its screenshots. Throws with the
  // status 404 for no such report.
  function feedbackDone(id, now = Date.now()) {
    return change((d) => {
      const f = FEEDBACK_ID.test(String(id)) ? d.feedback.find((x) => x.id === id) : null;
      if (!f) throw fail(404, 'There is no such report.');
      f.doneAt ||= new Date(now).toISOString();
      return { ...f };
    });
  }
  function deleteFeedback(id) {
    const gone = change((d) => {
      const at = FEEDBACK_ID.test(String(id)) ? d.feedback.findIndex((x) => x.id === id) : -1;
      if (at < 0) throw fail(404, 'There is no such report.');
      return d.feedback.splice(at, 1)[0];
    });
    dropShots(gone);
  }

  // ---------- sessions ----------

  // A new session of `account` in one app: the secret its cookie holds.
  function newSession(account, app, now = Date.now()) {
    const token = secret();
    change((d) => { d.sessions[hash(token)] = { account, app: APPS.includes(app) ? app : 'web', created: new Date(now).toISOString() }; });
    return token;
  }
  // The app a session's secret was signed in with ('web', 'android' or 'mac'), or null.
  function sessionApp(token) {
    if (typeof token !== 'string' || !token) return null;
    return load().sessions[hash(token)]?.app || null;
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
    sessionApp, addFeedback, listFeedback, feedbackScreenshot, feedbackDone, deleteFeedback,
  };
}

module.exports = { open, ACCOUNT_NAME, NAME_RULE, LINK_DAYS, SIGN_IN_LINK_DAYS, DEFAULT_SHARE, SHARE_RULE, defaultRam, FEEDBACK_MAX, FEEDBACK_PER_HOUR, FEEDBACK_KEPT,
  SCREENSHOTS_MAX, SCREENSHOT_BYTES, SCREENSHOTS_KEPT_BYTES };
