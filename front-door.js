#!/usr/bin/env node
// The front door (ADR 028): the one program on a machine that people reach. It signs them in with a passkey,
// takes single-use sign-up links, and passes every other request of a signed-in session to that account's own
// botdot server over the account's socket, naming the account. A request without a session never reaches a
// botdot server. Its routes are in docs/api.md, "The front door".
//
//   node front-door.js                                 serve
//   node front-door.js sign-up-link [--account NAME]   print a new sign-up link (7 days, works once), for the account
//                                                      NAME only when given (status 3 when NAME exists already)
//   node front-door.js sign-in-link --account NAME     print a new sign-in link (1 day, works once) that makes a new
//                                                      passkey for the account NAME (status 3 when there is none): the
//                                                      admin's own way back in after losing every device
//
// FRONT_DOOR_ORIGIN   the address people open, e.g. https://botdot.example.com (a passkey belongs to its name)
// FRONT_DOOR_SOCKETS  the folder of the accounts' botdot servers' sockets: <folder>/<account>/botdot.sock, each in a
//                     folder of its own that only that account's botdot server and the front door may enter
// FRONT_DOOR_DATA     where it keeps accounts, passkeys, sessions and sign-up links (default ./front-door-data)
// FRONT_DOOR_ADMIN    the admin's account (install.sh names it): until it exists, each start prints a link for it;
//                     its session alone reaches the admin page, /admin
// FRONT_DOOR_REQUESTS the folder where the front door asks the machine to make, stop, start again or erase an account:
//                     one empty file per account, named as it, which install.sh's root step takes, reading what the
//                     account should be from this front door's data (docs/DECISIONS.md, 2026-10-16, #467, #470); and
//                     the admin page's update, as a file named UPDATE, which no account can be named (#473); and
//                     "Update now" for one account, as a file named SWITCH-<account> (ADR 053)
// FRONT_DOOR_STATUS   the folder where root's step says back what it did: version.json (the version installed),
//                     update.json (the last update), latest.json (the newest signed version, #193) and
//                     account-<account>.json (what became of that account's version, ADR 053), which only root writes
//                     and the admin page and the account's Settings show (#473)
// FRONT_DOOR_LOAD     the folder where root's step writes the machine's load and each account's use of its share
//                     (install.sh --load), which the admin page shows (lib/front-door/load.js)
// FRONT_DOOR_HOST, FRONT_DOOR_PORT   where it listens (default 127.0.0.1:4700), behind Caddy or Tailscale Serve
// FRONT_DOOR_SITES_ORIGIN  the sandbox's own address for bots' interactive pages (#399, ADR 072), another origin than
//                     FRONT_DOOR_ORIGIN (install.sh: the same name on port 8443), e.g. https://botdot.example.com:8443.
//                     Unset: no interactive page opens. FRONT_DOOR_SITES_PORT: where it listens (default 4701)
// FRONT_DOOR_ANDROID_KEYS  the SHA-256 fingerprints of the Android app's signing certificates (AA:BB:…, comma
//                     separated) besides botdot's release key, which is always named: the app's passkey sign-in is
//                     taken from those, and /.well-known/assetlinks.json names them. Only apps from before the
//                     sign-in in the browser use it: today the app signs in on the sign-in page, with a hand-off
// FRONT_DOOR_ONE_ACCOUNT  a machine of exactly this one account (the Mac app's local botdot server, ADR 028): no
//                     sign-up link is printed or opens, and the account's passkey is made with FRONT_DOOR_SETUP_KEY
// FRONT_DOOR_SETUP_KEY  with FRONT_DOOR_ONE_ACCOUNT: the secret (32 to 100 base64url characters) that only the Mac app
//                     holds, which opens the one account's sign-up page until that account exists
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/front-door/store');
const webauthn = require('./lib/front-door/webauthn');
const limits = require('./lib/front-door/limits');
const pages = require('./lib/front-door/pages');
const calls = require('./lib/front-door/calls');
const loadFiles = require('./lib/front-door/load');
const whatsNew = require('./lib/whats-new');
const roomStore = require('./lib/front-door/rooms');
const roomTurns = require('./lib/front-door/room-turns');
const groupRouterStore = require('./lib/front-door/group-router');
const groupRouterLib = require('./lib/group-router');

const ORIGIN = (() => {
  try { return new URL(process.env.FRONT_DOOR_ORIGIN || ''); } catch { return null; }
})();
if (!ORIGIN || !['http:', 'https:'].includes(ORIGIN.protocol)) {
  console.error('Set FRONT_DOOR_ORIGIN to the address people open, e.g. https://botdot.example.com');
  process.exit(1);
}
const RP_ID = ORIGIN.hostname;
// The sandbox's own address (#399, ADR 072): only another origin than the front door's own, or none.
const SITES_ORIGIN = (() => {
  if (!process.env.FRONT_DOOR_SITES_ORIGIN) return null;
  let u = null;
  try { u = new URL(process.env.FRONT_DOOR_SITES_ORIGIN); } catch { /* said below */ }
  if (!u || !['http:', 'https:'].includes(u.protocol) || u.origin === ORIGIN.origin || u.pathname !== '/') {
    console.error(`[front door] FRONT_DOOR_SITES_ORIGIN must be an address of its own, another origin than ${ORIGIN.origin}: interactive pages don't open`);
    return null;
  }
  return u;
})();
const DATA = path.resolve(process.env.FRONT_DOOR_DATA || path.join(__dirname, 'front-door-data'));
// One account (the Mac app's local botdot server): its name, and the setup key that makes its passkey.
const ONE_ACCOUNT = process.env.FRONT_DOOR_ONE_ACCOUNT || null;
if (ONE_ACCOUNT !== null && !store.ACCOUNT_NAME.test(ONE_ACCOUNT)) {
  console.error("FRONT_DOOR_ONE_ACCOUNT is an account's name: 2 to 31 lowercase letters, digits and dashes, starting with a letter.");
  process.exit(1);
}
const SETUP_KEY = ONE_ACCOUNT && /^[A-Za-z0-9_-]{32,100}$/.test(process.env.FRONT_DOOR_SETUP_KEY || '') ? process.env.FRONT_DOOR_SETUP_KEY : null;
// The machine's RAM sizes the default share (#126): the last root's step measured, kept while its file is stale.
let machineRam = null;
const doors = store.open(DATA, { machineRam: () => { const m = load.machine(); if (m?.ramTotal) machineRam = m.ramTotal; return machineRam; } });

if (process.argv[2] === 'sign-up-link' || process.argv[2] === 'sign-in-link') {
  if (ONE_ACCOUNT) {
    console.error(`This machine holds one account, ${ONE_ACCOUNT}, and takes no sign-up links.`);
    process.exit(1);
  }
  const at = process.argv.indexOf('--account');
  const account = at > 0 ? process.argv[at + 1] ?? '' : null;
  try {
    const { url, expires } = process.argv[2] === 'sign-in-link'
      ? doors.newSignInLink({ origin: ORIGIN.origin, account: account ?? '' })
      : doors.newSignUpLink({ origin: ORIGIN.origin, account });
    console.log(`${url}\n(works once, until ${new Date(expires).toISOString()})`);
    process.exit(0);
  } catch (e) {
    if (!e.status) throw e;
    console.error(e.message);
    process.exit(e.status === 409 || e.status === 404 ? 3 : 2);
  }
}

const SOCKETS = process.env.FRONT_DOOR_SOCKETS ? path.resolve(process.env.FRONT_DOOR_SOCKETS) : null;
if (!SOCKETS) {
  console.error("Set FRONT_DOOR_SOCKETS to the folder of the accounts' botdot servers' sockets.");
  process.exit(1);
}
const PORT = Number(process.env.FRONT_DOOR_PORT) || 4700;
const HOST = process.env.FRONT_DOOR_HOST || '127.0.0.1';
const COOKIE = 'botdot_session';
const BODY_MAX = 64 * 1024;
// A Feedback report with its screenshots (#223): three of 5 MB as base64, and the text. Every other route keeps BODY_MAX.
const FEEDBACK_BODY_MAX = Math.ceil((store.SCREENSHOTS_MAX * store.SCREENSHOT_BYTES * 4) / 3) + BODY_MAX;
const FEEDBACK_TOO_LARGE = `That is too much to send at once: at most ${store.SCREENSHOTS_MAX} screenshots of 5 MB each go in one report.`;
const CHALLENGE_MS = 5 * 60_000;
const VERSION = { app: 'bot-dot', frontDoor: true, features: ['accounts', 'passkeys'] };
// The Android app (dev.botdot.app) signs in with the site's passkey through Android's Credential Manager, which
// trusts an app with a site's passkeys when the site's asset links name it. The app's sign-in then comes from
// android:apk-key-hash:<the certificate's SHA-256, base64url> in place of the site's own origin.
const ANDROID_PACKAGE = 'dev.botdot.app';
// botdot's release key, which signs the app on botdot's releases page (.github/workflows/android.yml checks each release
// against it): always named, so that app signs in with no setting (#82). FRONT_DOOR_ANDROID_KEYS adds a build of one's own.
const RELEASE_ANDROID_KEY = 'CC:05:CE:8B:44:37:30:33:BF:34:93:34:73:21:FD:0C:C8:4B:E3:6B:0E:E5:F1:5D:23:C6:88:8F:C7:BE:6B:E3';
const ANDROID_GIVEN = String(process.env.FRONT_DOOR_ANDROID_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
const isFingerprint = (s) => /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/i.test(s);
const ANDROID_KEYS = [...new Set([RELEASE_ANDROID_KEY, ...ANDROID_GIVEN.filter(isFingerprint).map((s) => s.toUpperCase())])];
const ORIGINS = [ORIGIN.origin, ...ANDROID_KEYS.map((f) => `android:apk-key-hash:${Buffer.from(f.replace(/:/g, ''), 'hex').toString('base64url')}`)];
const ASSET_LINKS = [{
  relation: ['delegate_permission/common.get_login_creds'],
  target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_KEYS },
}];
// Read once at start: a missing file is no font, and the page falls back to the system's.
const FONTS = Object.fromEntries(['Geist.ttf', 'GeistMono.ttf'].flatMap((f) => {
  try { return [[`/front-door/fonts/${f}`, fs.readFileSync(path.join(__dirname, 'public', 'fonts', f))]]; } catch { return []; }
}));
// What installing botdot from the browser needs before anyone signs in (issue #163): a browser fetches the manifest
// and its icons without cookies, and the service worker keeps the offline page. Read once at start, the same files
// every account's botdot server serves, with nothing of an account in them.
const INSTALL_TYPES = { '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };
// The manifest's icons and screenshots are taken from it, so a new one needs no change here.
const installNames = () => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'manifest.webmanifest'), 'utf8'));
    return [...(m.icons || []), ...(m.screenshots || [])].map((i) => new URL(i.src, 'http://x').pathname.slice(1));
  } catch { return []; }
};
const INSTALL_FILES = Object.fromEntries([...new Set(['manifest.webmanifest', 'apple-touch-icon.png', 'offline.html', ...installNames()])].flatMap((f) => {
  try {
    const body = fs.readFileSync(path.join(__dirname, 'public', f));
    return [[`/${f}`, { body, type: INSTALL_TYPES[path.extname(f)], etag: `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 16)}"` }]];
  } catch { return []; }
}));
const NOT_RUNNING = "Your account's botdot server isn't running. Try again in a moment, or ask the admin of this machine.";
const CALL_NOT_RUNNING = "This account's botdot server isn't running. Try the call again later.";
const PAUSED = 'Your account is paused by the admin.';

const tries = limits.create(); // failed sign-ins and sign-up links
const callTries = limits.create(); // calls with a wrong key, or none, or to an account that doesn't exist
// The challenges given out and not yet answered: challenge → { kind: 'create' | 'get', client, until, token?, name?,
// userId? }. Asking for one needs no sign-in, so each client holds at most CHALLENGES_PER_CLIENT and all of them at
// most CHALLENGES_MAX: past that, the oldest goes.
const challenges = new Map();
const CHALLENGES_PER_CLIENT = 20;
const CHALLENGES_MAX = 10_000;
// The native apps sign in on this front door's own page in a browser: the Mac app in a sheet
// (ASWebAuthenticationSession), the Android app in a Custom Tab, so the browser's password manager answers the passkey.
// The page hands the sign-in back to the app as a code at botdot://signed-in?code=…. The app sends the code with the
// secret whose SHA-256 the page carried (`handoff`) and gets its session: a code alone, seen by anything else (on
// Android, another app may claim botdot:// too), signs nobody in.
// code → { account, app, challenge, until }: each works once, for 2 minutes, and is kept in memory only.
const handoffs = new Map();
const HANDOFF_MS = 2 * 60_000;
const HANDOFFS_MAX = 1000;
const HANDOFF_CHALLENGE = /^[A-Za-z0-9_-]{43}$/; // a SHA-256 in base64url
const APP_CALLBACK = 'botdot://signed-in';
const HANDOFF_APPS = ['mac', 'android']; // the apps that sign in through the browser
setInterval(() => {
  for (const map of [challenges, handoffs]) for (const [c, v] of map) if (v.until < Date.now()) map.delete(c);
}, 60_000).unref();
const socketOf = (account) => path.join(SOCKETS, account, 'botdot.sock');
const ADMIN = process.env.FRONT_DOOR_ADMIN || null;
const REQUESTS = process.env.FRONT_DOOR_REQUESTS ? path.resolve(process.env.FRONT_DOOR_REQUESTS) : null;
const STATUS = process.env.FRONT_DOOR_STATUS ? path.resolve(process.env.FRONT_DOOR_STATUS) : null;
const load = loadFiles.create(process.env.FRONT_DOOR_LOAD ? path.resolve(process.env.FRONT_DOOR_LOAD) : null);
// Feedback (#216) goes to the admin page: none on a machine of one account, or without an admin.
const FEEDBACK = !ONE_ACCOUNT && !!ADMIN;
// Shared rooms (ADR 060): never on a machine of one account; elsewhere when the admin turned them on.
const rooms = ONE_ACCOUNT ? null : roomStore.open(DATA);
const roomsOn = () => !!rooms && !!ADMIN && rooms.isOn();
const MAKING = 'Your account is being made. It takes a few minutes; try again then.';
const STARTING = 'Your account is starting. Try again in a moment.';

// ---------- the machine, asked to make, stop, start or erase an account ----------

// The front door never runs as root, and tells the machine nothing but a name: an empty file named as the account in
// REQUESTS. Root's step (install.sh --requested) reads what that account should be from this front door's data and
// makes the machine match: it makes an account the machine doesn't have yet (Linux user, rootless Docker, botdot
// server and docker-helper), stops a suspended one, starts one the admin resumed, and erases one the admin deleted.
// It removes the file when it is done.
function askMachine(name) {
  if (!REQUESTS || !store.ACCOUNT_NAME.test(name)) return;
  try { fs.writeFileSync(path.join(REQUESTS, name), `${new Date().toISOString()}\n`, { flag: 'wx', mode: 0o640 }); } catch (e) {
    if (e.code !== 'EEXIST') console.error(`[front door] couldn't ask the machine about the account ${name}: ${e.message}`);
  }
}
// A new account from a sign-up link: asked of the machine, unless its botdot server is there already (the install's).
function askForAccount(name) {
  if (!fs.existsSync(path.join(SOCKETS, name))) askMachine(name);
}
const asked = (account) => !!REQUESTS && store.ACCOUNT_NAME.test(account) && fs.existsSync(path.join(REQUESTS, account));
// Whether the machine is still making this account (its socket's folder isn't there yet), or starting it again.
const making = (account) => asked(account) && !fs.existsSync(path.join(SOCKETS, account));
const starting = (account) => asked(account) && fs.existsSync(path.join(SOCKETS, account));
// A name the admin deleted whose account the machine hasn't erased yet: nobody takes it until the machine has.
const stillErasing = (name) => doors.wasDeleted(name) && (asked(name) || fs.existsSync(path.join(SOCKETS, name)));
// Whether the account's botdot server answers on its socket: a connection, opened and closed, with nothing sent.
function answers(account) {
  return new Promise((resolve) => {
    const s = net.connect(socketOf(account));
    const done = (yes) => { s.destroy(); resolve(yes); };
    s.setTimeout(1000, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

// ---------- the update of the machine ----------

// The admin page's update (#473): the front door asks for it as it asks for an account, with an empty file whose name
// no account can have, and root's step moves the front door and every account to the newest version together. It
// says back what it did in STATUS. Nothing the front door writes says which version: root's step finds it.
const UPDATE = 'UPDATE';
const UPDATE_STALE_MS = 3 * 60 * 60_000; // an update root's step never ended (the machine restarted meanwhile)
const readStatus = (name) => {
  if (!STATUS) return null;
  try { const j = JSON.parse(fs.readFileSync(path.join(STATUS, name), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; }
};
const short = (v) => (typeof v === 'string' && /^[0-9a-f]{7,12}$/.test(v) ? v : null);
const when = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
// The phases root's step names while it updates (#195), in their order; clean, preflight, download and switch are
// done account by account, and name the account too.
const UPDATE_PHASES = ['check', 'clean', 'preflight', 'download', 'switch', 'front-door', 'done'];
const UPDATE_LOG_LINES = 40;
// What the admin page shows: { version, selfBuilt, asked, update: { state, at, from, to, error?, accounts?, phase?,
// account?, log? } | null, newest: { version, at } | null }.
// Only what root's step wrote, checked field by field: the version is a short revision, a state one of three, an error
// a line, each account's result (#194) a name, updated, kept (with the version it runs) or failed, and a line why
// when it wasn't updated, a phase one of UPDATE_PHASES with the account it was at, and the log (only of a failed
// update) at most its last 40 lines of plain text. A field root's step left out, or wrote wrong, is left out. newest is
// the newest signed release root's step found (latest.json, at most once an hour, #193), none for images built on the
// machine.
const line = (v, max) => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, ' ').slice(0, max) : null);
// An account left waiting for its owner (ADR 053) is `waiting`, with the version it runs.
const accountResults = (list) => (Array.isArray(list) ? list : [])
  .filter((a) => a && typeof a.name === 'string' && store.ACCOUNT_NAME.test(a.name) && ['updated', 'kept', 'failed', 'waiting'].includes(a.result))
  .slice(0, 1000)
  .map((a) => (a.result === 'updated' ? { name: a.name, result: a.result }
    : a.result === 'waiting' ? { name: a.name, result: a.result, ...(short(a.version) ? { version: a.version } : {}) }
      : { name: a.name, result: a.result, ...(a.result === 'kept' && short(a.version) ? { version: a.version } : {}), error: line(a.error, 300) }));
function updateStatus() {
  const installed = readStatus('version.json') || {};
  const latest = readStatus('latest.json') || {};
  const newest = { version: short(latest.version), at: when(latest.at) };
  const last = readStatus('update.json');
  let update = null;
  if (last && ['updating', 'updated', 'failed'].includes(last.state)) {
    update = { state: last.state, at: when(last.at), from: short(last.from), to: short(last.to) };
    if (last.state === 'failed') update.error = line(last.error, 500);
    if (last.state !== 'updating' && Array.isArray(last.accounts)) update.accounts = accountResults(last.accounts);
    if (last.state !== 'updated' && UPDATE_PHASES.includes(last.phase)) {
      update.phase = last.phase;
      if (typeof last.account === 'string' && store.ACCOUNT_NAME.test(last.account)) update.account = last.account;
    }
    if (last.state === 'failed' && Array.isArray(last.log)) {
      const log = last.log.filter((l) => typeof l === 'string').slice(-UPDATE_LOG_LINES).map((l) => line(l, 300).trimEnd());
      if (log.length) update.log = log;
    }
    if (last.state === 'updating' && (!update.at || Date.now() - Date.parse(update.at) > UPDATE_STALE_MS)) {
      update = { ...update, state: 'failed', error: "The update didn't finish. Update again." };
    }
  }
  const asked = !!REQUESTS && fs.existsSync(path.join(REQUESTS, UPDATE));
  const selfBuilt = installed.selfBuilt === true;
  return { version: short(installed.version), selfBuilt, asked, update, newest: !selfBuilt && newest.version && newest.at ? newest : null, days: doors.updateDays() };
}
function askForUpdate() {
  if (!REQUESTS) return false;
  try { fs.writeFileSync(path.join(REQUESTS, UPDATE), `${new Date().toISOString()}\n`, { flag: 'wx', mode: 0o640 }); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  return true;
}

// ---------- when one account switches (ADR 053) ----------

// An account whose owner turned "Update automatically" off is left on the version it ran by the admin's update, with the
// new one in its Docker. Its owner (Settings) or the admin (the admin page) asks for its switch with an empty file named
// SWITCH-<account>, which no account can be named, and root's step switches that account alone to the version this front
// door's machine pins. Root says what became of it in STATUS/account-<account>.json. Past the admin's deadline, this
// front door asks for the switch itself.
const SWITCH = (name) => `SWITCH-${name}`;
const ACCOUNT_STATES = ['waiting', 'switching', 'updated', 'kept', 'failed'];
const DAY = 24 * 3600_000;
// Whether the owner of an account chooses when it switches: on a machine of several accounts root's step serves, every
// account, the admin's own too (#274).
const choosesUpdates = () => !ONE_ACCOUNT && !!REQUESTS && !!ADMIN;
const switchAsked = (name) => !!REQUESTS && fs.existsSync(path.join(REQUESTS, SWITCH(name)));
// What root's step said of the account, checked field by field: { state, at, since?, version?, from?, error? } or null.
function accountStatus(name) {
  const s = store.ACCOUNT_NAME.test(name) ? readStatus(`account-${name}.json`) : null;
  if (!s || !ACCOUNT_STATES.includes(s.state)) return null;
  const out = { state: s.state, at: when(s.at) };
  if (s.state === 'waiting') {
    out.since = when(s.since) || out.at;
    if (!out.since) return null;
    for (const k of ['version', 'from']) if (short(s[k])) out[k] = s[k];
  }
  if (s.state === 'kept' || s.state === 'failed') out.error = line(s.error, 300);
  // A switch root's step never finished (the machine restarted meanwhile).
  if (s.state === 'switching' && (!out.at || Date.now() - Date.parse(out.at) > UPDATE_STALE_MS)) return { state: 'failed', at: out.at, error: "The update didn't finish. Update now again." };
  return out;
}
// What the account's owner sees in Settings, and the admin on its card: { autoUpdate, asked, canUpdate, ready, last }.
// ready: { version, from, since, deadline } while it waits for a version the admin installed; last: how its last switch
// went, { state, at, error? }. canUpdate: "Update now" may be asked: it waits, or its last switch didn't happen.
function ownUpdate(name) {
  const s = accountStatus(name);
  const asked = switchAsked(name);
  const ready = s && s.state === 'waiting'
    ? { version: s.version || null, from: s.from || null, since: s.since, deadline: new Date(Date.parse(s.since) + doors.updateDays() * DAY).toISOString() }
    : null;
  const last = s && s.state !== 'waiting' ? { state: s.state, at: s.at, ...(s.error !== undefined ? { error: s.error } : {}) } : null;
  return { autoUpdate: doors.autoUpdate(name), asked, canUpdate: !asked && !!s && ['waiting', 'kept', 'failed'].includes(s.state), ready, last };
}
// What a waiting version brings (#303): the notes this front door's version ships after the newest one the account's
// botdot server ships, which it says in its /api/version. A server that doesn't say (older than #303), or doesn't
// answer: none.
function newestNoteOf(account) {
  return new Promise((resolve) => {
    const up = http.request({ socketPath: socketOf(account), method: 'GET', path: '/api/version', headers: { 'x-botdot-account': account }, timeout: 5000 }, (answer) => {
      let body = '';
      answer.setEncoding('utf8');
      answer.on('data', (c) => { if (body.length < BODY_MAX) body += c; });
      answer.on('end', () => { try { resolve(answer.statusCode === 200 ? JSON.parse(body).whatsNew ?? null : null); } catch { resolve(null); } });
      answer.on('error', () => resolve(null));
    });
    up.on('timeout', () => up.destroy());
    up.on('error', () => resolve(null));
    up.end();
  });
}
async function pendingNotes(account) {
  if (!ownUpdate(account).ready) return [];
  return whatsNew.after(await newestNoteOf(account));
}
function askSwitch(name) {
  if (!REQUESTS || !store.ACCOUNT_NAME.test(name)) return false;
  try { fs.writeFileSync(path.join(REQUESTS, SWITCH(name)), `${new Date().toISOString()}\n`, { flag: 'wx', mode: 0o640 }); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  return true;
}
// The deadline: an account still waiting past it is switched without its owner. Checked every minute, and whenever an
// owner or the admin looks.
// only: the one account to check (its owner looks), else every account.
function switchPastDeadline({ only = null, now = Date.now() } = {}) {
  if (!REQUESTS || ONE_ACCOUNT) return;
  for (const a of doors.listAccounts()) {
    if ((only && a.name !== only) || a.suspended || !choosesUpdates(a.name) || switchAsked(a.name)) continue;
    const { ready } = ownUpdate(a.name);
    if (!ready || Date.parse(ready.deadline) > now) continue;
    console.log(`[front door] the account ${a.name} waited past its deadline: the machine switches it to the new version`);
    askSwitch(a.name);
  }
}
setInterval(() => { try { switchPastDeadline(); } catch (e) { console.error(`[front door] couldn't check the update deadline: ${e.message}`); } }, 60_000).unref();

// ---------- requests ----------

// Who is asking, for the limits.
const { clientOf } = limits;

const cookiesOf = (req) => String(req.headers.cookie || '').split(/;\s*/).filter(Boolean);
const isSession = (c) => c.startsWith(`${COOKIE}=`);
const sessionOf = (req) => cookiesOf(req).find(isSession)?.slice(COOKIE.length + 1) || null;
// The cookies a botdot server gets: all but the session.
const withoutSession = (req) => cookiesOf(req).filter((c) => !isSession(c)).join('; ');

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function html(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
  });
  res.end(text);
}
// The session's cookie, kept for 400 days (the most a browser keeps), or with no token, cleared.
const sessionCookie = (token) => `${COOKIE}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 34560000 : 0}${ORIGIN.protocol === 'https:' ? '; Secure' : ''}`;

// max: the most bytes read (BODY_MAX unless said); past it, a 413 with `tooLarge` as its sentence.
function readJson(req, { max = BODY_MAX, tooLarge = 'Too large' } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // Read no further: the answer says so, and the connection ends with it (Connection: close).
      if (size > max) { req.removeAllListeners('data'); req.pause(); reject(Object.assign(new Error(tooLarge), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Not JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// The challenge a credential answers, taken from the waiting ones: each is used once, right or wrong.
function takeChallenge(credential, kind) {
  let challenge;
  try { challenge = JSON.parse(Buffer.from(String(credential?.response?.clientDataJSON || ''), 'base64url').toString('utf8')).challenge; } catch { return null; }
  const waiting = typeof challenge === 'string' ? challenges.get(challenge) : null;
  if (!waiting) return null;
  challenges.delete(challenge);
  return waiting.kind === kind && waiting.until > Date.now() ? { challenge, ...waiting } : null;
}
function newChallenge(client, entry) {
  const own = [...challenges].filter(([, v]) => v.client === client);
  if (own.length >= CHALLENGES_PER_CLIENT) challenges.delete(own[0][0]);
  if (challenges.size >= CHALLENGES_MAX) challenges.delete(challenges.keys().next().value);
  const challenge = crypto.randomBytes(32).toString('base64url');
  challenges.set(challenge, { ...entry, client, until: Date.now() + CHALLENGE_MS });
  return challenge;
}

// Too many failed tries from this client: answered here, and true.
function slowedDown(req, res, limit = tries, what = 'failed sign-ins') {
  const ms = limit.wait(clientOf(req));
  if (!ms) return false;
  const s = Math.ceil(ms / 1000);
  send(res, 429, { error: `Too many ${what}. Try again in ${s} second${s === 1 ? '' : 's'}.` }, { 'Retry-After': String(s) });
  return true;
}

// ---------- the front door's own routes ----------

// What a page that signs in asks for: { challenge } when it is a native app's browser (the Mac app's sheet, the
// Android app's Custom Tab), which hands the sign-in back, {} for any other, which gets its session's cookie. Null,
// answered here, for a hand-off that is wrong.
function handoffOf(body, res) {
  if (body.handoff === undefined) return {};
  if (!HANDOFF_APPS.includes(body.app) || typeof body.handoff !== 'string' || !HANDOFF_CHALLENGE.test(body.handoff)) {
    send(res, 400, { error: 'Only the botdot apps sign in through the browser.' });
    return null;
  }
  return { challenge: body.handoff };
}
// `account` is signed in, in `app`: its session's cookie, or for a native app's browser, the code that hands it on.
// A cookie replaces the one this browser had, whose session ends with it (#466: another account, signed in on top).
function signedIn(req, res, status, account, app, handoff) {
  doors.seen(account);
  if (!handoff.challenge) {
    const before = sessionOf(req);
    if (before) doors.endSession(before);
    return send(res, status, { ok: true, account }, { 'Set-Cookie': sessionCookie(doors.newSession(account, app)) });
  }
  if (handoffs.size >= HANDOFFS_MAX) handoffs.delete(handoffs.keys().next().value);
  const code = crypto.randomBytes(32).toString('base64url');
  handoffs.set(code, { account, app, challenge: handoff.challenge, until: Date.now() + HANDOFF_MS });
  return send(res, status, { ok: true, account, code, next: `${APP_CALLBACK}?code=${code}` });
}
// The hand-off that `code` names, taken (each works once, right or wrong), when `verifier` is its secret.
function takeHandoff(code, verifier) {
  const waiting = typeof code === 'string' ? handoffs.get(code) : null;
  if (!waiting) return null;
  handoffs.delete(code);
  if (waiting.until < Date.now() || typeof verifier !== 'string') return null;
  const hash = crypto.createHash('sha256').update(verifier).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(waiting.challenge)) ? waiting : null;
}

// The sign-up this token opens: an open sign-up link, or on a machine of one account, the setup key until that
// account exists (for that account), and nothing else.
function signUpLink(token) {
  if (!ONE_ACCOUNT) return doors.openLink(token);
  const opens = !!SETUP_KEY && !doors.accountCount() && token.length === SETUP_KEY.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(SETUP_KEY));
  return opens ? { for: ONE_ACCOUNT } : null;
}

async function signInRoutes(req, res, p) {
  // Until the first account is made, nobody can sign in, and only the install's link makes it.
  if (p === '/sign-in' && req.method === 'GET') return html(res, 200, doors.accountCount() ? pages.signIn() : pages.notYet());
  if (p === '/sign-in/options' && req.method === 'POST') {
    if (slowedDown(req, res)) return;
    return send(res, 200, { publicKey: webauthn.requestOptions({ rpId: RP_ID, challenge: newChallenge(clientOf(req), { kind: 'get' }) }) });
  }
  if (p === '/sign-in' && req.method === 'POST') {
    if (slowedDown(req, res)) return;
    const body = await readJson(req);
    const { credential, app } = body;
    const handoff = handoffOf(body, res);
    if (!handoff) return;
    const waiting = takeChallenge(credential, 'get');
    const key = doors.passkey(credential?.id);
    let count = null;
    if (waiting && key) {
      try { count = webauthn.verifyAssertion(credential, key, { rpId: RP_ID, origin: ORIGINS, challenge: waiting.challenge }); } catch { count = null; }
    }
    if (count === null) {
      tries.failed(clientOf(req));
      return send(res, 401, { error: "That passkey didn't sign you in." });
    }
    tries.succeeded(clientOf(req));
    doors.counted(credential.id, count);
    return signedIn(req, res, 200, key.account, app, handoff);
  }
  // A native app, back from the browser with the code and the secret it kept: its own session.
  if (p === '/sign-in/handoff' && req.method === 'POST') {
    if (slowedDown(req, res)) return;
    const { code, verifier } = await readJson(req);
    const waiting = takeHandoff(code, verifier);
    if (!waiting) {
      tries.failed(clientOf(req));
      return send(res, 401, { error: "That sign-in didn't come from this app. Sign in again." });
    }
    tries.succeeded(clientOf(req));
    return send(res, 200, { ok: true, account: waiting.account }, { 'Set-Cookie': sessionCookie(doors.newSession(waiting.account, waiting.app)) });
  }
  if (p === '/sign-out' && req.method === 'POST') {
    doors.endSession(sessionOf(req));
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(null) });
  }
  // "Sign out everywhere" (Settings, on the web page and in the apps): every session of this session's account ends,
  // this one too. Only the person signed in reaches it: no botdot server, and so no Chief or bot, ever sees a session.
  if (p === '/sign-out-everywhere' && req.method === 'POST') {
    const account = doors.sessionAccount(sessionOf(req));
    if (!account) return send(res, 401, { error: 'Sign in first.', signIn: '/sign-in' });
    const ended = doors.endAccountSessions(account);
    console.log(`[front door] account ${account} signed out everywhere (${ended} session${ended === 1 ? '' : 's'})`);
    return send(res, 200, { ok: true, ended }, { 'Set-Cookie': sessionCookie(null) });
  }
  // What the web page and the Android app ask of their session: whether it is the admin's, which then shows the way
  // to /admin, and whether Feedback goes anywhere (#216): to the admin page, which a machine of one account has not.
  if (p === '/front-door/session' && req.method === 'GET') {
    const account = doors.sessionAccount(sessionOf(req));
    if (!account) return send(res, 401, { error: 'Sign in first.', signIn: '/sign-in' });
    // feedbackScreenshots (#223): Feedback takes screenshots too; an older front door leaves it out, and the apps add none.
    // updates (ADR 053): this account's owner chooses when it switches to a new version (/front-door/update).
    // account: whose session it is; rooms (ADR 060): the admin turned shared rooms on (/front-door/rooms); roomLinks
    // (ADR 068): a room's maker makes an invite link, and opening one joins.
    return send(res, 200, { account, admin: !ONE_ACCOUNT && !!ADMIN && account === ADMIN, feedback: FEEDBACK, feedbackScreenshots: FEEDBACK, updates: choosesUpdates(account), rooms: roomsOn(), roomLinks: roomsOn() });
  }
  // When this account switches to a new version (ADR 053): its owner's "Update automatically", and "Update now" for a
  // version the admin installed. Only the owner signed in reaches it, never a botdot server.
  if (p === '/front-door/update' || p === '/front-door/update/now' || p === '/front-door/update/notes') {
    const account = doors.sessionAccount(sessionOf(req));
    if (!account) return send(res, 401, { error: 'Sign in first.', signIn: '/sign-in' });
    if (!choosesUpdates(account)) return send(res, 404, { error: 'Not found' });
    if (req.method === 'GET' && p === '/front-door/update') {
      switchPastDeadline({ only: account });
      return send(res, 200, ownUpdate(account));
    }
    // What's new in the version it waits for (#303): none while nothing waits.
    if (p === '/front-door/update/notes') return req.method === 'GET' ? send(res, 200, { entries: await pendingNotes(account) }) : send(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
    if (doors.isSuspended(account)) { req.resume(); return send(res, 503, { error: PAUSED, paused: true }); }
    const body = (await readJson(req)) || {};
    if (p === '/front-door/update') {
      const on = doors.setAutoUpdate(account, body.autoUpdate);
      console.log(`[front door] the account ${account} turned automatic updates ${on ? 'on' : 'off'}`);
      return send(res, 200, ownUpdate(account));
    }
    if (!ownUpdate(account).canUpdate) return send(res, 409, { error: 'There is no new version to switch to.' });
    askSwitch(account);
    console.log(`[front door] the account ${account} asked to switch to the new version now`);
    return send(res, 202, ownUpdate(account));
  }
  // Feedback (#216): a bug or a feature request, kept here for the admin page. Only the owner signed in sends it, from
  // the web page or the Android app; it never reaches a botdot server, and nothing of the account goes with it but the
  // screenshots the owner added (#223), checked by the store.
  if (p === '/front-door/feedback' && req.method === 'POST') {
    const session = sessionOf(req);
    const account = doors.sessionAccount(session);
    if (!account) return send(res, 401, { error: 'Sign in first.', signIn: '/sign-in' });
    if (!FEEDBACK) return send(res, 404, { error: 'Not found' });
    if (doors.isSuspended(account)) { req.resume(); return send(res, 503, { error: PAUSED, paused: true }); }
    const { kind, text, screenshots } = (await readJson(req, { max: FEEDBACK_BODY_MAX, tooLarge: FEEDBACK_TOO_LARGE })) || {};
    const report = doors.addFeedback({ account, kind, text, screenshots, app: doors.sessionApp(session), version: short(readStatus('version.json')?.version) });
    console.log(`[front door] the account ${account} sent feedback (${report.kind}, ${report.text.length} characters, ${report.screenshots?.length || 0} screenshots)`);
    return send(res, 201, { ok: true, id: report.id });
  }
  if (p === '/front-door/rooms' || p.startsWith('/front-door/rooms/')) return roomRoutes(req, res, p);
  const m = p.match(/^\/sign-up\/([A-Za-z0-9_-]{1,100})(\/options)?$/);
  if (!m) return false;
  const [, token, options] = m;
  if (slowedDown(req, res)) return;
  const link = signUpLink(token);
  if (!link) {
    tries.failed(clientOf(req));
    if (req.method === 'GET') return html(res, 410, pages.ended());
    return send(res, 410, { error: 'This sign-up link was used or has ended.' });
  }
  // The admin's sign-in link: a new passkey for an account that exists.
  const signIn = !!link.signIn;
  if (req.method === 'GET' && !options) return html(res, 200, signIn ? pages.newPasskey({ name: link.for }) : pages.signUp({ name: link.for }));
  if (req.method !== 'POST') return false;
  const body = await readJson(req);
  // One account: its own name, whatever the page sent.
  const name = ONE_ACCOUNT || (typeof body.name === 'string' ? body.name.trim() : '');
  if (!store.ACCOUNT_NAME.test(name)) return send(res, 400, { error: store.NAME_RULE });
  if (link.for && name !== link.for) return send(res, 400, { error: `This ${signIn ? 'sign-in' : 'sign-up'} link is for the account ${link.for}.` });
  if (signIn && !doors.accountExists(name)) return send(res, 410, { error: 'This sign-in link was used or has ended.' });
  if (!signIn && (doors.accountExists(name) || stillErasing(name))) return send(res, 409, { error: 'That name is taken.' });
  if (options) {
    const userId = signIn ? doors.userIdOf(name) : crypto.randomBytes(16).toString('base64url');
    const challenge = newChallenge(clientOf(req), { kind: 'create', token, name, userId });
    return send(res, 200, { publicKey: webauthn.creationOptions({ rpId: RP_ID, challenge, userId, name }) });
  }
  const handoff = handoffOf(body, res);
  if (!handoff) return;
  const waiting = takeChallenge(body.credential, 'create');
  if (!waiting || waiting.token !== token || waiting.name !== name) return send(res, 400, { error: 'That passkey was not made for this sign-up. Try again.' });
  let key;
  try { key = webauthn.verifyRegistration(body.credential, { rpId: RP_ID, origin: ORIGIN.origin, challenge: waiting.challenge }); } catch {
    return send(res, 400, { error: 'That passkey could not be checked. Try again.' });
  }
  try {
    if (signIn) doors.addPasskey({ token, name, passkey: key });
    else if (ONE_ACCOUNT) doors.createOnlyAccount({ name, userId: waiting.userId, passkey: key });
    else doors.createAccount({ token, name, userId: waiting.userId, passkey: key });
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message });
    throw e;
  }
  tries.succeeded(clientOf(req));
  if (signIn) {
    console.log(`[front door] the account ${name} has a new passkey, from the admin's sign-in link; its other sessions ended`);
    return signedIn(req, res, 201, name, body.app, handoff);
  }
  console.log(`[front door] account ${name} was made ${ONE_ACCOUNT ? 'with the setup key' : 'from a sign-up link'}`);
  askForAccount(name);
  return signedIn(req, res, 201, name, body.app, handoff);
}

// ---------- shared rooms ----------

// Shared rooms (ADR 060): people of several accounts and their bots in one chat, kept here, the one shared piece. Only
// a signed-in member reaches a room; every name of an account is a session's or the admin's. A bot gets a turn
// through its own account's botdot server (lib/front-door/room-turns.js), which is the last word on it. A room's text
// never reaches an account but in a turn of a bot it names, and comes back as a reply's plain text.

// x-bot-dot: a botdot server takes no write without it (as from a page of its own).
const ROOM_HEADERS = (account) => ({ 'x-botdot-account': account, 'x-botdot-room': '1', 'x-bot-dot': '1' });
const ROOM_ANSWER_MAX = 256 * 1024;
// One request to an account's botdot server, from the front door itself: { status, data }, status 0 when it could
// not be reached in time. A suspended or deleted account is not asked.
function askAccount(account, method, to, body, timeoutMs) {
  if (!doors.accountExists(account) || doors.isSuspended(account)) return Promise.resolve({ status: 0, data: null });
  return new Promise((resolve) => {
    const text = body === null || body === undefined ? null : JSON.stringify(body);
    const headers = { ...ROOM_HEADERS(account), ...(text ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {}) };
    const up = http.request({ socketPath: socketOf(account), method, path: to, headers, timeout: timeoutMs }, (answer) => {
      const chunks = [];
      let size = 0;
      answer.on('data', (c) => { size += c.length; if (size > ROOM_ANSWER_MAX) { up.destroy(); resolve({ status: 0, data: null }); } else chunks.push(c); });
      answer.on('end', () => {
        let data = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
        resolve({ status: answer.statusCode, data });
      });
      answer.on('error', () => resolve({ status: 0, data: null }));
    });
    up.on('timeout', () => up.destroy());
    up.on('error', () => resolve({ status: 0, data: null }));
    up.end(text || undefined);
  });
}

// The group router the admin chose (#513): handed to every account's botdot server on a change and every minute, so
// that one that started again has it back (it keeps it in memory alone). Haiku meanwhile.
const groupRouter = ONE_ACCOUNT ? null : groupRouterStore.open(DATA);
function handRouter() {
  if (!groupRouter) return;
  const body = groupRouter.forAccounts();
  for (const { name } of doors.listAccounts()) askAccount(name, 'POST', '/api/group-router', body, 5000);
}
if (groupRouter) {
  setTimeout(handRouter, 3000).unref();
  setInterval(handRouter, Number(process.env.BOT_DOT_ROUTER_HAND_MS) || 60_000).unref();
}

// The live events of rooms, per account: GET /front-door/rooms/events.
const roomStreams = new Map(); // account → Set of responses
function toAccount(account, event, data) {
  for (const res of roomStreams.get(account) || []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function closeRoomStreams() {
  for (const set of roomStreams.values()) for (const res of set) res.end();
  roomStreams.clear();
}
const roomsAll = () => (rooms ? rooms.all() : []);
const roomShown = (room) => rooms.shown(room, turns.working(room.id));
// A room changed: each member is told.
function roomChanged(room) {
  const shown = roomShown(room);
  for (const m of room.members) toAccount(m.account, 'room', { room: shown });
}
// A new message: each member is told, and for a person's or a bot's message (not a notice) each member's account
// but the writer's may push a notification (best effort).
function roomSaid(room, message) {
  for (const m of room.members) {
    toAccount(m.account, 'room_message', { roomId: room.id, message });
    if (message.kind === 'text' && (m.account !== message.account || message.bot)) askAccount(m.account, 'POST', '/api/room-notice', { room: { id: room.id, name: room.name }, message }, 10_000);
  }
}
const turns = roomTurns.create({ rooms: rooms || /** @type {any} */ ({}), ask: askAccount, changed: (room) => room && roomChanged(room), said: roomSaid, isOn: roomsOn });
// What the accounts send to rooms after their owner's OK (ADR 067): collected every few seconds while rooms are on.
if (rooms) turns.startCollecting(Number(process.env.BOT_DOT_ROOM_COLLECT_MS) || undefined);

// An account the admin deleted leaves every room.
function roomsWithout(account) {
  if (!rooms) return;
  for (const { room, gone } of rooms.dropAccount(account)) {
    if (gone) { turns.forget(room.id); for (const i of room.invites) toAccount(i.account, 'invite_gone', { id: room.id }); } else roomChanged(room);
  }
  roomStreams.delete(account);
}

// A room's id in a path: /front-door/rooms/<id>[/<what>[/<more>]].
const ROOM_PATH = /^\/front-door\/rooms\/([0-9a-f]{32})(?:\/(name|invite|link|accept|decline|leave|delete|bots|messages|stop)(?:\/(remove))?)?$/;
// An invite link's token in a path: /front-door/rooms/join/<token> (ADR 068).
const JOIN_PATH = /^\/front-door\/rooms\/join\/([A-Za-z0-9_-]{1,100})$/;
// The address of a room's invite link, as its maker shares it: the web page, which opens "Join" for it. The token is
// in the fragment, so it reaches no proxy's log on the way, and the page takes it to the sign-in and back.
const linkOut = (l) => (l ? { url: `${ORIGIN.origin}/#rooms/join=${l.token}`, expires: l.expires } : null);

async function roomRoutes(req, res, p) {
  const account = doors.sessionAccount(sessionOf(req));
  if (!account) { req.resume(); return send(res, 401, { error: 'Sign in first.', signIn: '/sign-in' }); }
  if (!roomsOn()) { req.resume(); return send(res, 404, { error: 'Not found' }); }
  if (doors.isSuspended(account)) { req.resume(); return send(res, 503, { error: PAUSED, paused: true }); }
  doors.seen(account);
  if (p === '/front-door/rooms/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.write(': rooms\n\n');
    if (!roomStreams.has(account)) roomStreams.set(account, new Set());
    roomStreams.get(account).add(res);
    const beat = setInterval(() => res.write(': still here\n\n'), 25_000);
    res.on('close', () => { clearInterval(beat); roomStreams.get(account)?.delete(res); });
    return;
  }
  if (p === '/front-door/rooms' && req.method === 'GET') {
    const mine = rooms.roomsOf(account);
    return send(res, 200, {
      rooms: mine.filter((r) => rooms.isMember(r, account)).map(roomShown),
      invites: mine.filter((r) => rooms.isInvited(r, account)).map((r) => rooms.inviteShown(r, account)),
    });
  }
  if (p === '/front-door/rooms' && req.method === 'POST') {
    const room = rooms.create(account, ((await readJson(req)) || {}).name);
    console.log(`[front door] the account ${account} made a room (${room.id.slice(0, 8)})`);
    roomChanged(room);
    return send(res, 201, { room: roomShown(room) });
  }
  const j = p.match(JOIN_PATH);
  if (j && req.method === 'GET') return send(res, 200, rooms.linkPreview(j[1], account));
  if (j && req.method === 'POST') {
    req.resume();
    const { room, joined } = rooms.joinByLink(j[1], account);
    if (joined) {
      console.log(`[front door] the account ${account} joined a room with its invite link (${room.id.slice(0, 8)})`);
      roomChanged(room);
      roomSaid(room, room.messages.at(-1));
    }
    return send(res, 200, { room: roomShown(room) });
  }
  const m = p.match(ROOM_PATH);
  if (!m) { req.resume(); return send(res, 404, { error: 'Not found' }); }
  const [, id, what = null, more = null] = m;
  if (what === null && req.method === 'GET') return send(res, 200, { room: roomShown(rooms.memberRoom(id, account)) });
  if (what === 'link' && req.method === 'GET') return send(res, 200, { link: linkOut(rooms.link(id, account)) });
  if (what === 'messages' && req.method === 'GET') {
    const q = new URL(req.url, ORIGIN.origin).searchParams;
    const limit = q.has('limit') ? Number(q.get('limit')) : 50;
    return send(res, 200, rooms.messages(id, account, { before: q.get('before') || null, limit }));
  }
  if (req.method !== 'POST' || what === null || (more && what !== 'bots' && what !== 'link')) { req.resume(); return send(res, 404, { error: 'Not found' }); }
  const body = (await readJson(req)) || {};
  if (what === 'name') {
    const room = rooms.rename(id, account, body.name);
    roomChanged(room);
    return send(res, 200, { room: roomShown(room) });
  }
  // Only the room's maker: a new link (the one before stops working), or none.
  if (what === 'link') {
    if (more === 'remove') return send(res, 200, { link: rooms.dropLink(id, account) });
    const link = linkOut(rooms.makeLink(id, account));
    console.log(`[front door] the account ${account} made an invite link for a room (${id.slice(0, 8)}, until ${link.expires})`);
    return send(res, 200, { link });
  }
  if (what === 'invite') {
    const room = rooms.invite(id, account, body.account, doors.accountExists);
    const invited = room.invites.at(-1).account;
    console.log(`[front door] the account ${account} invited the account ${invited} to a room (${room.id.slice(0, 8)})`);
    roomChanged(room);
    toAccount(invited, 'invite', rooms.inviteShown(room, invited));
    return send(res, 200, { room: roomShown(room) });
  }
  if (what === 'accept') {
    const room = rooms.accept(id, account);
    roomChanged(room);
    roomSaid(room, room.messages.at(-1));
    return send(res, 200, { room: roomShown(room) });
  }
  if (what === 'decline') {
    const room = rooms.decline(id, account);
    roomChanged(room);
    toAccount(account, 'invite_gone', { id: room.id });
    return send(res, 200, { ok: true });
  }
  if (what === 'leave') {
    const { room, gone } = rooms.leave(id, account);
    toAccount(account, 'room_gone', { id: room.id });
    if (gone) { turns.forget(room.id); for (const i of room.invites) toAccount(i.account, 'invite_gone', { id: room.id }); } else { roomChanged(room); roomSaid(room, room.messages.at(-1)); }
    return send(res, 200, { ok: true });
  }
  if (what === 'delete') {
    const room = rooms.remove(id, account);
    turns.forget(room.id);
    console.log(`[front door] the account ${account} deleted a room (${room.id.slice(0, 8)})`);
    for (const x of room.members) toAccount(x.account, 'room_gone', { id: room.id });
    for (const i of room.invites) toAccount(i.account, 'invite_gone', { id: room.id });
    return send(res, 200, { ok: true });
  }
  if (what === 'bots' && more === 'remove') {
    const room = rooms.removeBot(id, account, typeof body.bot === 'string' ? body.bot : '');
    roomChanged(room);
    roomSaid(room, room.messages.at(-1));
    return send(res, 200, { room: roomShown(room) });
  }
  if (what === 'bots') {
    rooms.memberRoom(id, account);
    const botId = typeof body.bot === 'string' ? body.bot : '';
    // The bot as its own account answers for it, and only one its room settings let in.
    const answer = await askAccount(account, 'GET', '/api/room-bots', null, 15_000);
    if (answer.status !== 200 || !Array.isArray(answer.data?.bots)) return send(res, 502, { error: "Your account's botdot server didn't say which bots may be in rooms. Try again in a moment." });
    const bot = answer.data.bots.find((b) => b && b.id === botId);
    if (!bot) return send(res, 404, { error: 'You have no such bot that may be in rooms. Turn "Rooms" on in its settings first.' });
    if (bot.rooms?.allowRooms !== true) return send(res, 403, { error: `${String(bot.name || 'This bot').slice(0, 60)} is kept out of rooms. Turn "Rooms" on in its settings first.` });
    const room = rooms.addBot(id, account, bot);
    roomChanged(room);
    roomSaid(room, room.messages.at(-1));
    return send(res, 200, { room: roomShown(room) });
  }
  if (what === 'messages') {
    const { room, message, named, again } = rooms.post(id, account, body);
    if (again) return send(res, 200, { message });
    roomSaid(room, message);
    turns.person(room, message, named);
    return send(res, 201, { message });
  }
  if (what === 'stop') {
    rooms.memberRoom(id, account);
    turns.stop(id);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Not found' });
}

// ---------- the admin page ----------

// /admin and everything under it: the admin's session alone (FRONT_DOOR_ADMIN), web only, never passed on (ADR 028).
// account: the session's. Another session is answered as if there were nothing here.
async function adminRoutes(req, res, p, account) {
  if (!ADMIN || account !== ADMIN) return send(res, 404, { error: 'Not found' });
  if (p === '/admin' && req.method === 'GET') return html(res, 200, pages.admin());
  if (p === '/admin/links' && req.method === 'GET') return send(res, 200, { links: doors.listLinks() });
  if (p === '/admin/links' && req.method === 'POST') {
    await readJson(req);
    const { url, expires, link } = doors.newSignUpLink({ origin: ORIGIN.origin });
    console.log(`[front door] the admin made a sign-up link (${link.id.slice(0, 12)}, until ${new Date(expires).toISOString()})`);
    return send(res, 201, { url, link });
  }
  const m = p.match(/^\/admin\/links\/([0-9a-f]{64})\/revoke$/);
  if (m && req.method === 'POST') {
    const link = doors.revokeLink(m[1]);
    console.log(`[front door] the admin revoked a sign-up link (${link.id.slice(0, 12)})`);
    return send(res, 200, { ok: true, link });
  }
  if (p === '/admin/update' && req.method === 'GET') return send(res, 200, updateStatus());
  // The deadline (ADR 053): the days an account whose owner turned "Update automatically" off waits at most.
  if (p === '/admin/update/days' && req.method === 'POST') {
    const days = doors.setUpdateDays(((await readJson(req)) || {}).days);
    console.log(`[front door] the admin set the update deadline: ${days} days`);
    switchPastDeadline();
    return send(res, 200, updateStatus());
  }
  if (p === '/admin/update' && req.method === 'POST') {
    await readJson(req);
    if (!askForUpdate()) return send(res, 409, { error: "This machine can't be updated from here. Run its installer again." });
    console.log('[front door] the admin asked to update botdot: the front door and every account');
    return send(res, 202, updateStatus());
  }
  // Shared rooms (ADR 060): the admin's switch for the machine, off until turned on. Off, no room is served and no
  // turn given; what the rooms hold is kept.
  if (p === '/admin/rooms' && req.method === 'GET') return send(res, 200, { on: rooms.isOn() });
  if (p === '/admin/rooms' && req.method === 'POST') {
    const on = rooms.setOn(((await readJson(req)) || {}).on);
    console.log(`[front door] the admin turned shared rooms ${on ? 'on' : 'off'}`);
    if (!on) { for (const r of roomsAll()) turns.stop(r.id); closeRoomStreams(); }
    return send(res, 200, { on });
  }
  // The group router (#513): Haiku, or Jev with the admin's OpenRouter key, checked with one call before it is kept.
  // The key is never answered.
  if (p === '/admin/group-router' && req.method === 'GET') return send(res, 200, groupRouter.shown());
  if (p === '/admin/group-router' && req.method === 'POST') {
    const body = (await readJson(req)) || {};
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (body.router === 'jev' && key) {
      const checked = await groupRouterLib.checkKey(key);
      if (checked === 'refused') return send(res, 400, { error: 'OpenRouter refused this key.' });
      if (checked === 'unreachable') return send(res, 502, { error: "OpenRouter can't be reached. Try again." });
    }
    let shown;
    const flag = (v) => (typeof v === 'boolean' ? v : undefined);
    try { shown = groupRouter.set(body.router, key || undefined, flag(body.wakeGate), flag(body.browserPicker)); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    console.log(`[front door] the admin chose ${shown.router === 'jev' ? 'Jev' : 'Haiku'} to pick who answers in a group; the wake gate is ${shown.wakeGate ? 'on' : 'off'}; Jev in the browser is ${shown.browserPicker ? 'on' : 'off'}`);
    handRouter();
    return send(res, 200, shown);
  }
  if (p === '/admin/accounts' && req.method === 'GET') {
    switchPastDeadline();
    return send(res, 200, { accounts: await listAccounts() });
  }
  // The shares of the machine: the default, and the machine's load.
  if (p === '/admin/share' && req.method === 'GET') return send(res, 200, { share: doors.defaultShare(), machine: load.machine() });
  if (p === '/admin/share' && req.method === 'POST') {
    const accounts = doors.setDefaultShare(await readJson(req));
    console.log(`[front door] the admin set the default share: ${JSON.stringify(doors.defaultShare())}`);
    for (const name of accounts) askMachine(name);
    return send(res, 200, { ok: true, share: doors.defaultShare() });
  }
  // The owners' feedback (#216), newest first: the admin marks a report done, which keeps it, or deletes it.
  if (p === '/admin/feedback' && req.method === 'GET') return send(res, 200, { reports: doors.listFeedback() });
  // A report's screenshot, as the type the front door read from its bytes, shown inline and never as a page (#223).
  const shot = p.match(/^\/admin\/feedback\/([0-9a-f]{32})\/screenshot\/([0-9])$/);
  if (shot && req.method === 'GET') {
    const found = doors.feedbackScreenshot(shot[1], Number(shot[2]));
    if (!found) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': found.type, 'Content-Length': found.bytes.length, 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    return res.end(found.bytes);
  }
  const f = p.match(/^\/admin\/feedback\/([0-9a-f]{32})\/(done|delete)$/);
  if (f && req.method === 'POST') {
    await readJson(req);
    if (f[2] === 'delete') { doors.deleteFeedback(f[1]); return send(res, 200, { ok: true }); }
    return send(res, 200, { ok: true, report: doors.feedbackDone(f[1]) });
  }
  const a = p.match(/^\/admin\/accounts\/([a-z][a-z0-9-]{1,23})\/(suspend|resume|delete|sign-in-link|share|update)$/);
  if (a && req.method === 'POST') return accountAction(req, res, a[1], a[2]);
  return send(res, 404, { error: 'Not found' });
}

// The accounts as the admin page lists them: { name, created, lastSeen, state, share, ownShare, use, admin?, update? }, from
// the front door's own data, whether each botdot server answers on its socket, and what root's step measured of the
// account from outside it (use, or null), never from inside an account. state: 'running', 'suspended', 'making' (the
// machine is making it), 'starting' (or starting it again) or 'stopped' (its botdot server doesn't answer). update: when
// it switches to a new version (ownUpdate, ADR 053), for every account, the admin's own too (#274).
async function listAccounts() {
  return Promise.all(doors.listAccounts().map(async (a) => {
    const state = a.suspended ? 'suspended' : (await answers(a.name)) ? 'running' : making(a.name) ? 'making' : starting(a.name) ? 'starting' : 'stopped';
    return { name: a.name, created: a.created, lastSeen: a.lastSeen, state, share: a.share, ownShare: a.ownShare, use: load.account(a.name),
      ...(a.name === ADMIN ? { admin: true } : {}), ...(choosesUpdates(a.name) ? { update: ownUpdate(a.name) } : {}) };
  }));
}

// The admin suspends, resumes or deletes an account, or makes a sign-in link for it. The admin's own account is
// neither suspended nor deleted here: nobody would be left to resume it, nor to reach the admin page.
async function accountAction(req, res, name, action) {
  const body = await readJson(req);
  if (!doors.accountExists(name)) return send(res, 404, { error: `There is no account ${name}.` });
  if (name === ADMIN && (action === 'suspend' || action === 'delete')) {
    return send(res, 409, { error: `${name} is your own account, the admin's: it can't be ${action === 'suspend' ? 'suspended' : 'deleted'} here.` });
  }
  // Its own share, or with { default: true } the default again: the machine applies it to the account.
  if (action === 'share') {
    const share = doors.setAccountShare(name, body.default === true ? null : body);
    console.log(`[front door] the admin set the share of the account ${name}: ${JSON.stringify(share)}`);
    askMachine(name);
    return send(res, 200, { ok: true, share });
  }
  // "Update now" for an account that waits (ADR 053): as its owner's, to the version the admin installed.
  if (action === 'update') {
    if (!choosesUpdates(name) || !ownUpdate(name).canUpdate) return send(res, 409, { error: `The account ${name} has no new version to switch to.` });
    askSwitch(name);
    console.log(`[front door] the admin asked to switch the account ${name} to the new version now`);
    return send(res, 202, { ok: true, update: ownUpdate(name) });
  }
  if (action === 'sign-in-link') {
    const { url, link } = doors.newSignInLink({ origin: ORIGIN.origin, account: name });
    console.log(`[front door] the admin made a sign-in link for the account ${name} (${link.id.slice(0, 12)})`);
    return send(res, 201, { url, link });
  }
  if (action === 'delete') {
    if (body.name !== name) return send(res, 400, { error: `Type the account's name, ${name}, to delete it.` });
    doors.deleteAccount(name);
    roomsWithout(name);
    console.log(`[front door] the admin deleted the account ${name}; the machine erases it`);
    askMachine(name);
    return send(res, 200, { ok: true });
  }
  doors.setSuspended(name, action === 'suspend');
  console.log(`[front door] the admin ${action === 'suspend' ? 'suspended' : 'resumed'} the account ${name}`);
  askMachine(name);
  return send(res, 200, { ok: true });
}

// ---------- passing a request on ----------

// Never passed on: the account is the front door's to name, a room turn is the front door's alone to ask for (ADR 060),
// and the Chief's key belongs to the Chief's tools inside the account, which never come through here.
// The sandbox's request for a file (#399) and its address are the front door's alone to say, too.
const PASSED_OFF = new Set(['x-botdot-account', 'x-botdot-room', 'x-chief-key', 'x-botdot-sandbox', 'x-botdot-sites', 'connection', 'keep-alive', 'proxy-connection', 'upgrade']);
function headersFor(req, account) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) if (!PASSED_OFF.has(k)) out[k] = v;
  const cookie = withoutSession(req);
  if (cookie) out.cookie = cookie; else delete out.cookie;
  out['x-forwarded-proto'] = ORIGIN.protocol.slice(0, -1);
  out['x-botdot-account'] = account;
  if (SITES_ORIGIN) out['x-botdot-sites'] = SITES_ORIGIN.origin;
  return out;
}

// path, headers: what the botdot server is sent (the request's own, by default). answered(status): told botdot's answer.
function pass(req, res, account, { path: to = req.url, headers: sent = headersFor(req, account), answered = () => {}, notRunning = NOT_RUNNING } = {}) {
  const up = http.request({ socketPath: socketOf(account), method: req.method, path: to, headers: sent }, (answer) => {
    answered(answer.statusCode);
    const { connection, 'keep-alive': _, ...headers } = answer.headers;
    // botdot answered before the whole body came (one too large): the rest is never read, so this connection ends.
    res.writeHead(answer.statusCode, req.complete ? headers : { ...headers, connection: 'close' });
    answer.pipe(res);
  });
  up.on('error', () => {
    if (res.headersSent) return res.destroy();
    if (!asked(account)) return send(res, 502, { error: notRunning });
    // The machine is still making this account, or starting it again: a page says so and looks again by itself.
    const made = !making(account);
    if (to === req.url && (req.method === 'GET' || req.method === 'HEAD') && !String(req.url).startsWith('/api/')) return html(res, 503, made ? pages.starting() : pages.making());
    send(res, 503, made ? { error: STARTING, starting: true } : { error: MAKING, making: true }, { 'Retry-After': made ? '10' : '30' });
  });
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  calls.sendOn(req, up);
}

// A job's call (ADR 026): passed to its account's botdot server without a session, which lets it in on the job's key
// alone. A wrong key, none, or an account that doesn't exist (answered as a wrong key, so that a sender without the
// key learns nothing) counts against the client, which is slowed down as sign-ins are. A call let in forgets nothing:
// a key of one job must not clear the guesses at another's; an hour without a wrong key does.
function takeCall(req, res, call) {
  if (slowedDown(req, res, callTries, 'calls with a wrong key')) return;
  const client = clientOf(req);
  if (!doors.accountExists(call.account)) {
    callTries.failed(client);
    req.resume();
    return send(res, 401, { error: 'Wrong key.' });
  }
  // A suspended account's botdot server isn't running: said as for any that isn't, to a sender who may be anyone.
  if (doors.isSuspended(call.account)) { req.resume(); return send(res, 502, { error: CALL_NOT_RUNNING }); }
  const answered = (status) => { if (status === 401) callTries.failed(client); };
  pass(req, res, call.account, { path: call.path, headers: calls.callHeaders(req, call.account, client), answered, notRunning: CALL_NOT_RUNNING });
}

// ---------- the server ----------

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    if (String(req.headers.host || '').toLowerCase() !== ORIGIN.host) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end(`The front door answers only as ${ORIGIN.host}.`);
    }
    let p;
    try { p = new URL(req.url, ORIGIN.origin).pathname; } catch { return send(res, 400, { error: 'Bad address' }); }
    // A write from a page of another site can't send this header without a preflight, which nothing approves.
    // A machine of one account (the Mac app's) has no admin page (ADR 028): there /admin is the account's own.
    const isAdmin = !ONE_ACCOUNT && (p === '/admin' || p.startsWith('/admin/'));
    const own = isAdmin || p === '/sign-in' || p === '/sign-in/options' || p === '/sign-in/handoff' || p === '/sign-out' || p === '/sign-out-everywhere' || p.startsWith('/sign-up/') || p.startsWith('/front-door/');
    if (own && req.method !== 'GET' && req.headers['x-bot-dot'] !== '1') return send(res, 403, { error: 'Missing X-Bot-Dot header' });
    if (p === '/front-door/passkey.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(pages.SCRIPT);
    }
    if (p === '/front-door/admin.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(pages.ADMIN_SCRIPT);
    }
    // The admin page's fonts, the web page's own (#22): Geist and Geist Mono from public/fonts, under its OFL.txt.
    if (FONTS[p] && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'font/ttf', 'Cache-Control': 'max-age=86400' });
      return res.end(FONTS[p]);
    }
    const install = INSTALL_FILES[p];
    if (install && (req.method === 'GET' || req.method === 'HEAD')) {
      const headers = { 'Content-Type': install.type, 'Cache-Control': 'no-cache', ETag: install.etag };
      if (req.headers['if-none-match'] === install.etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, { ...headers, 'Content-Length': install.body.length });
      return res.end(req.method === 'HEAD' ? undefined : install.body);
    }
    if (p === '/.well-known/assetlinks.json' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' });
      return res.end(JSON.stringify(ASSET_LINKS));
    }
    if (own && (await signInRoutes(req, res, p)) !== false) return;
    const call = calls.callOf(p);
    if (call) return takeCall(req, res, call);
    if (p.startsWith('/call/')) return send(res, 404, { error: 'This is no call address.' });
    const account = doors.sessionAccount(sessionOf(req));
    if (account) doors.seen(account);
    if (account && isAdmin) return await adminRoutes(req, res, p, account);
    // A suspended account: its owner is told that and nothing else, whatever they ask, until the admin resumes it.
    if (account && doors.isSuspended(account)) {
      req.resume();
      if ((req.method === 'GET' || req.method === 'HEAD') && !p.startsWith('/api/')) return html(res, 503, pages.paused());
      return send(res, 503, { error: PAUSED, paused: true });
    }
    if (account && calls.isPassedCall(p)) return send(res, 404, { error: 'A call goes to its call address, /call/<account>/<bot>/<job>.' });
    if (account) return pass(req, res, account);
    if (isAdmin && p !== '/admin') return send(res, 401, { error: 'Sign in first.', signIn: '/sign-in' });
    if (p === '/api/version' && req.method === 'GET') return send(res, 200, VERSION);
    if (!p.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(302, { Location: '/sign-in', 'Cache-Control': 'no-store' }); return res.end(); }
    return send(res, 401, { error: 'Sign in first.', signIn: '/sign-in' });
  } catch (e) {
    if (!e.status) console.error(`[front door] ${req.method} ${String(req.url).slice(0, 100)}: ${e.stack || e.message}`);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong' }, e.status === 413 ? { Connection: 'close' } : {});
    else res.destroy();
  }
});

// A WebSocket (a bot's live screen): passed on as it is, with the account named, once its session is known.
server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  const account = String(req.headers.host || '').toLowerCase() === ORIGIN.host ? doors.sessionAccount(sessionOf(req)) : null;
  if (!account) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
  if (doors.isSuspended(account)) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
  const up = net.connect(socketOf(account));
  up.on('error', () => { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); up.destroy(); });
  up.on('connect', () => {
    const headers = { ...headersFor(req, account), connection: 'Upgrade', upgrade: req.headers.upgrade };
    const lines = Object.entries(headers).flatMap(([k, v]) => [].concat(v).map((x) => `${k}: ${String(x).replace(/[\r\n]/g, '')}`));
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
    up.on('close', () => socket.destroy());
    socket.on('close', () => up.destroy());
  });
});

// ---------- the sandbox's own address: bots' interactive pages (#399, ADR 072) ----------

// A file of an interactive page: GET /<account>/<token>/<path>, the token signed by that account's botdot server for its
// owner alone and for a short while. Passed on without a cookie or any header of the browser's, and answered with
// the sandbox's rules whatever botdot says: the page runs in a sandbox of its own (no origin, so no cookie, storage or
// API of the front door's), loads only its own files under its own address, reaches nothing else, and is framed by the
// front door's own page alone. A request on this address never reaches any other route.
const SITES_PATH = /^\/([a-z][a-z0-9-]{1,23})\/([A-Za-z0-9_-]{10,400}\.[A-Za-z0-9_-]{32})\/([^#]*)$/;
function sitesHeaders(prefix) {
  const own = `${SITES_ORIGIN.origin}${prefix}`;
  return {
    'Content-Security-Policy': [
      'sandbox allow-scripts', "default-src 'none'", `script-src ${own} 'unsafe-inline'`, `style-src ${own} 'unsafe-inline'`, `img-src ${own} data: blob:`,
      `font-src ${own} data:`, `media-src ${own} data: blob:`, `connect-src ${own}`, "worker-src 'none'", "frame-src 'none'", "object-src 'none'",
      "form-action 'none'", "base-uri 'none'", `frame-ancestors ${ORIGIN.origin}`,
    ].join('; '),
    // The page's own origin is opaque, so its scripts and its fetch of data.json are requests from another origin.
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), bluetooth=(), payment=()',
    'X-Robots-Tag': 'noindex',
  };
}
function sitesAnswer(req, res) {
  const fail = (status, text) => {
    req.resume();
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "sandbox; default-src 'none'" });
    res.end(text);
  };
  if (String(req.headers.host || '').toLowerCase() !== SITES_ORIGIN.host) return fail(403, `This address answers only as ${SITES_ORIGIN.host}.`);
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Only pages are read here.');
  const m = String(req.url || '').split('?')[0].match(SITES_PATH); // a query (a bundle's cache busting) is dropped
  if (!m || !doors.accountExists(m[1]) || doors.isSuspended(m[1])) return fail(404, 'Not found');
  const [, account, token, rest] = m;
  const headers = { host: 'sandbox', 'x-botdot-account': account, 'x-botdot-sandbox': '1', ...(req.headers['if-none-match'] ? { 'if-none-match': String(req.headers['if-none-match']).slice(0, 200) } : {}) };
  const up = http.request({ socketPath: socketOf(account), method: req.method, path: `/sandbox/${token}/${rest}`, headers, timeout: 30_000 }, (answer) => {
    const out = sitesHeaders(`/${account}/${token}/`);
    for (const k of ['content-type', 'content-length', 'etag', 'cache-control']) if (answer.headers[k]) out[k] = answer.headers[k];
    res.writeHead(answer.statusCode, out);
    answer.pipe(res);
  });
  up.on('timeout', () => up.destroy());
  up.on('error', () => { if (res.headersSent) res.destroy(); else fail(502, "This account's botdot server isn't running. Try again in a moment."); });
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  up.end();
}
const SITES_PORT = Number(process.env.FRONT_DOOR_SITES_PORT) || 4701;
if (SITES_ORIGIN) {
  const sites = http.createServer((req, res) => {
    try { sitesAnswer(req, res); } catch (e) { console.error(`[front door] sandbox: ${e.message}`); if (!res.headersSent) { res.writeHead(500); res.end(); } else res.destroy(); }
  });
  sites.on('upgrade', (req, socket) => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  // A port taken leaves interactive pages closed, never the front door.
  sites.on('error', (e) => console.error(`Interactive pages can't open on ${HOST}:${SITES_PORT}: ${e.message}`));
  sites.listen(SITES_PORT, HOST, () => console.log(`Interactive pages are at ${SITES_ORIGIN.origin} (listening on ${HOST}:${SITES_PORT})`));
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0));

server.listen(PORT, HOST, () => {
  console.log(`The front door is at ${ORIGIN.origin} (listening on ${HOST}:${PORT})`);
  // Which Android builds sign in, said once: a build the asset links leave out finds no passkey on the phone (#82).
  for (const s of ANDROID_GIVEN.filter((s) => !isFingerprint(s))) {
    console.log(`[front door] FRONT_DOOR_ANDROID_KEYS: "${s.slice(0, 120)}" is no SHA-256 fingerprint (AA:BB:…, 32 pairs), so it is left out`);
  }
  const more = ANDROID_KEYS.length - 1;
  console.log(ANDROID_GIVEN.length
    ? `[front door] the Android app signs in as botdot's release build and with ${more} more key${more === 1 ? '' : 's'} from FRONT_DOOR_ANDROID_KEYS`
    : "[front door] FRONT_DOOR_ANDROID_KEYS is not set: the Android app signs in only as botdot's release build; a build of your own needs its signing key's SHA-256 there (docs/install-linux.md)");
  // Until the first account is made, every start prints a link that makes it: the admin's own (ADR 028).
  if (!doors.accountCount() && !ONE_ACCOUNT) {
    const { url } = doors.newSignUpLink({ origin: ORIGIN.origin, account: ADMIN });
    console.log(`Sign-up link for the first account${ADMIN ? `, ${ADMIN},` : ''} which is the admin's: ${url}`);
  }
});
