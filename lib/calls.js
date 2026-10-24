// @ts-check
// A job runs when called (ADR 026): a device or service with the job's key sends POST to the job's call address, at
// the front door with the account in it (/call/<account>/<bot>/<job>, ADR 028), and the job runs now with what the
// request carried. The front door passes it to this botdot server on its socket, as POST
// /api/bots/<bot>/jobs/<job>/call, without a session: the job's key is what lets it in (server.js takeCall). On
// botdot's own port no call is taken.
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonfile');
const { PERMISSIONS, TOOL_PERMISSION } = require('./asks');

// The most a call may carry, in bytes. A larger body is refused (413) before anything starts.
const BODY_MAX = 64 * 1024;

// A call as the front door passes it on: POST /api/bots/<botId>/jobs/<jobId>/call. Returns { botId, jobId } or null.
// Ids are letters, digits, - and _, so nothing in them is decoded.
/** @param {string} pathname @returns {{ botId: string, jobId: string } | null} */
function callPath(pathname) {
  const m = /^\/api\/bots\/([\w-]+)\/jobs\/([\w-]+)\/call$/.exec(pathname);
  return m ? { botId: m[1], jobId: m[2] } : null;
}

// Where a job's call address is: the front door's own address, as the front door last named it to this botdot
// server (the Host and X-Forwarded-Proto it sends, having checked the Host is its own), kept in
// data/call-address.json for the Chief's tools, which reach botdot on its port. account: this server's (BOT_DOT_ACCOUNT).
/** @typedef {Record<string, string | string[] | undefined>} Headers */
/** @param {string} dataDir @param {string} account */
function addresses(dataDir, account) {
  const FILE = path.join(dataDir, 'call-address.json');
  let origin = readJson(FILE, {}).origin || null;
  return {
    // A request the front door passed on: its address, when it names one, is kept.
    /** @param {Headers} headers */
    seen(headers) {
      const proto = String(headers['x-forwarded-proto'] || '');
      const host = String(headers.host || '').toLowerCase();
      if (!['http', 'https'].includes(proto) || !/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?$/.test(host)) return;
      const now = `${proto}://${host}`;
      if (now === origin) return;
      origin = now;
      writeJson(FILE, { origin });
    },
    // The call address of a job, or null while the front door has not been seen or the account has no name.
    /** @type {(botId: string, jobId: string) => string | null} */
    of: (botId, jobId) => (origin && account ? `${origin}/call/${account}/${botId}/${jobId}` : null),
    // The front door's name (the site of a call key's Vault item), or null.
    host: () => (origin ? new URL(origin).hostname : null),
  };
}

// The keys of the jobs that can be called, kept apart from the jobs (a job as the routes hand it out reaches the
// bots, the Chief and the apps): data/call-keys.json, { <botId>: { <jobId>: { hash, vaultId, vaultName } } }, the
// key's SHA-256 only, and the Vault item that holds the key itself. The key is long and random, so a fast hash is
// enough. Read at each call: calls are rare.
/** @param {string} dataDir */
function keyStore(dataDir) {
  const FILE = path.join(dataDir, 'call-keys.json');
  /** @param {string} key */
  const hashOf = (key) => crypto.createHash('sha256').update(String(key)).digest();
  return {
    // Whether `key` is the key of this job, compared in constant time. A job with no key takes no call.
    /** @param {string} botId @param {string} jobId @param {string | null} key @returns {boolean} */
    matches(botId, jobId, key) {
      const stored = readJson(FILE, {})[botId]?.[jobId]?.hash;
      if (typeof stored !== 'string' || !/^[0-9a-f]{64}$/.test(stored) || !key) return false;
      return crypto.timingSafeEqual(Buffer.from(stored, 'hex'), hashOf(key));
    },
    // Where the job's key is kept: { vaultId, vaultName }, or null for a job that never had one. Never the hash.
    /** @param {string} botId @param {string} jobId @returns {{ vaultId: string | null, vaultName: string | null } | null} */
    vaultOf(botId, jobId) {
      const kept = readJson(FILE, {})[botId]?.[jobId];
      return kept ? { vaultId: kept.vaultId || null, vaultName: kept.vaultName || null } : null;
    },
    // A new key for the job, whose Vault item is { id, name }: the old one stops at once.
    /** @param {string} botId @param {string} jobId @param {string} key @param {{ id: string, name: string }} vault */
    set(botId, jobId, key, vault) {
      const all = readJson(FILE, {});
      all[botId] = { ...all[botId], [jobId]: { hash: hashOf(key).toString('hex'), vaultId: vault.id, vaultName: vault.name } };
      writeJson(FILE, all, { mode: 0o600 });
    },
  };
}

// The calls to a job that were refused, oldest first: the last REFUSALS_KEPT with a wrong key and the last
// REFUSALS_KEPT of every other kind, so that requests without a key cannot push the wrong keys out before the
// checkup reads them (a wrong signature counts with the wrong keys):
// data/call-refusals.json, { <botId>: { <jobId>: [{ at, why, device }] } }. `why` is one of WHY; `device`
// the address the call came from, as the front door saw it (X-Forwarded-For). Nothing a call sent is kept: not its
// key, not its body.
const REFUSALS_KEPT = 20;
const WRONG = ['wrong key', 'wrong signature']; // a sender set up wrong, or someone guessing
const WHY = ['no key', 'wrong key', 'no signature', 'wrong signature', 'too old', 'repeated', 'refused origin', 'not a POST', 'too large', 'calls off', 'bypassPermissions', 'waits for approval', 'switched off', 'paused', 'still running', 'too many waiting'];
/** @param {unknown} v */
const short = (v) => String(v || '').replace(/[^\w.:@+-]/g, '').slice(0, 100);
/** @param {string} dataDir */
function refusalLog(dataDir) {
  const FILE = path.join(dataDir, 'call-refusals.json');
  return {
    /** @param {string} botId @param {string} jobId @param {string} why @param {Headers} headers @param {Date} [now] */
    add(botId, jobId, why, headers, now = new Date()) {
      if (!WHY.includes(why)) throw new TypeError(`No refusal is "${why}"`);
      const all = readJson(FILE, {});
      const entry = { at: now.toISOString(), why, device: short(String(headers['x-forwarded-for'] || '').split(',')[0].trim()) || null };
      const list = [...(all[botId]?.[jobId] || []), entry];
      const wrong = list.filter((c) => WRONG.includes(c.why)).slice(-REFUSALS_KEPT);
      const other = list.filter((c) => !WRONG.includes(c.why)).slice(-REFUSALS_KEPT);
      all[botId] = { ...all[botId], [jobId]: list.filter((c) => wrong.includes(c) || other.includes(c)) };
      writeJson(FILE, all);
    },
    // A job's refused calls, oldest first.
    /** @type {(botId: string, jobId: string) => { at: string, why: string, device: string | null }[]} */
    of: (botId, jobId) => readJson(FILE, {})[botId]?.[jobId] || [],
  };
}

// A new key: 32 random bytes, as text a sender can put in a header.
const newKey = () => crypto.randomBytes(32).toString('base64url');

// The Vault item that holds a job's key: an API token by the job's name.
/** @type {(botName: string, jobName: string) => string} */
const vaultName = (botName, jobName) => `Call key: ${botName} / ${jobName}`.slice(0, 60);

// What the owner reads on the card of a proposed call, before the Chief's own sentence: the warning, and what the
// bot can do in short. appName: a connected app's name by its slug.
const WARNING = 'Anything that can reach this machine and has the key can run this job now and send it text.';
// A signed call's (#37): the secret is what lets a sender in.
const WARNING_SIGNED = "Anything that can reach this machine and has the job's secret can run this job now and send it text, signing what it sends with the secret.";
/** @param {string | null | undefined} mode */
const warningOf = (mode) => (mode === 'signed' ? WARNING_SIGNED : WARNING);
/** @param {{ name: string, allowedTools?: string[], computer?: string, connectors?: string[] }} bot @param {(app: string) => string} [appName] @param {string | null} [mode] */
function cardWords(bot, appName = (app) => app, mode = 'bearer') {
  // The permissions of "What it may do", in their own words (lib/asks.js): "browse the web", "run commands".
  const held = new Set((bot.allowedTools || []).map((t) => TOOL_PERMISSION[String(t).replace(/\(.*$/, '')]).filter(Boolean));
  const can = [
    ...Object.keys(PERMISSIONS).filter((p) => held.has(p)).map((p) => PERMISSIONS[p].label),
    ...(bot.computer === 'linux' ? ["use the account's computer, on your home network"] : bot.computer === 'boat' ? ['use its machine on boat.dev'] : []),
    ...(bot.connectors || []).map((app) => `use ${appName(app)}`),
  ];
  const list = can.length > 1 ? `${can.slice(0, -1).join(', ')} and ${can.at(-1)}` : can[0];
  return `${warningOf(mode)} ${list ? `${bot.name} can ${list}.` : `${bot.name} has no tools beyond reading its folder.`}`;
}

// The key a call carries: Authorization: Bearer <key>. A key anywhere else (the address) is not read.
/** @param {Headers} headers @returns {string | null} */
function bearer(headers) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(headers.authorization || ''));
  return m ? m[1] : null;
}

// A signed call (#37, section 2; docs/api.md "A signed call"): for a sender that can only sign what it sends, a job
// takes no key but an HMAC-SHA256 signature of the raw body under the job's secret. The botdot server checks it: it
// reads the body anyway and holds the secret (lib/bots.js callSecrets); the front door passes the headers on and
// slows down the 401s, as for keys. Two forms:
// - botdot's own, the one its notifications carry (lib/notify.js): X-Botdot-Timestamp: <seconds since 1970> and
//   X-Botdot-Signature-256: sha256=<hex of the HMAC over "<timestamp>.<body>">, refused TOLERANCE_S from this
//   server's clock;
// - GitHub's: X-Hub-Signature-256: sha256=<hex of the HMAC over the body>, which carries no time.
// Either way a signature is taken once (seenStore): a request played again is refused, the timestamped form for as
// long as its timestamp holds, GitHub's for SEEN_FOR_MS.
const TOLERANCE_S = 5 * 60;
const SEEN_FOR_MS = 24 * 60 * 60 * 1000;
const SEEN_KEPT = 1000; // signatures kept for a job, at most
const SIGNED_HEADERS = ['x-botdot-signature-256', 'x-botdot-timestamp', 'x-hub-signature-256'];
/** @param {Headers} headers @param {string} name */
const headerOf = (headers, name) => { const v = headers[name]; return String((Array.isArray(v) ? v[0] : v) ?? '').trim(); };
// Checks a signed call's body against the job's secret, in constant time. Returns { ok: true, signature } (its hex,
// for seenStore), or { ok: false, why, error }: why one of WHY, error the sentence for the sender's log.
/** @param {Headers} headers @param {Buffer} body @param {string | null} secret @param {number} [now] @returns {{ ok: true, signature: string } | { ok: false, why: string, error: string }} */
function checkSigned(headers, body, secret, now = Date.now()) {
  const ours = headerOf(headers, 'x-botdot-signature-256');
  const given = ours || headerOf(headers, 'x-hub-signature-256');
  if (!given) return { ok: false, why: 'no signature', error: 'This job takes signed calls: send X-Botdot-Signature-256 with X-Botdot-Timestamp, or X-Hub-Signature-256.' };
  const timestamp = headerOf(headers, 'x-botdot-timestamp');
  if (ours && !/^\d{1,12}$/.test(timestamp)) return { ok: false, why: 'no signature', error: 'Send X-Botdot-Timestamp, the seconds since 1970 that were signed, with X-Botdot-Signature-256.' };
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(given);
  if (!m || !secret) return { ok: false, why: 'wrong signature', error: 'Wrong signature.' };
  const hmac = crypto.createHmac('sha256', secret);
  if (ours) hmac.update(`${timestamp}.`);
  if (!crypto.timingSafeEqual(Buffer.from(m[1], 'hex'), hmac.update(body).digest())) return { ok: false, why: 'wrong signature', error: 'Wrong signature.' };
  if (ours && Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_S) return { ok: false, why: 'too old', error: `The timestamp is more than ${TOLERANCE_S / 60} minutes from this server's clock.` };
  return { ok: true, signature: m[1].toLowerCase() };
}

// The signatures of the signed calls each job took lately: data/call-signatures.json, { <botId>: { <jobId>:
// { <signature>: <ms> } } }, each for SEEN_FOR_MS, the last SEEN_KEPT of a job. Nothing else of a call is kept.
/** @param {string} dataDir */
function seenStore(dataDir) {
  const FILE = path.join(dataDir, 'call-signatures.json');
  /** @param {Record<string, number> | undefined} seen @param {number} now @returns {[string, number][]} */
  const fresh = (seen, now) => Object.entries(seen || {}).filter(([, at]) => now - at < SEEN_FOR_MS).sort((a, b) => a[1] - b[1]).slice(-SEEN_KEPT);
  return {
    // Takes a signature once: false when the job took it already. Checked and kept in one step.
    /** @param {string} botId @param {string} jobId @param {string} signature @param {number} [now] */
    take(botId, jobId, signature, now = Date.now()) {
      const all = readJson(FILE, {});
      const kept = fresh(all[botId]?.[jobId], now);
      if (kept.some(([s]) => s === signature)) return false;
      all[botId] = { ...all[botId], [jobId]: Object.fromEntries([...kept, [signature, now]].slice(-SEEN_KEPT)) };
      writeJson(FILE, all);
      return true;
    },
    // A signature given back: the call it came with started nothing after all, and may come again.
    /** @param {string} botId @param {string} jobId @param {string} signature */
    giveBack(botId, jobId, signature) {
      const all = readJson(FILE, {});
      if (!all[botId]?.[jobId]?.[signature]) return;
      delete all[botId][jobId][signature];
      writeJson(FILE, all);
    },
  };
}

// The Vault item that holds the secret of a job's signed calls.
/** @type {(botName: string, jobName: string) => string} */
const secretVaultName = (botName, jobName) => `Call secret: ${botName} / ${jobName}`.slice(0, 60);

module.exports = { BODY_MAX, REFUSALS_KEPT, WARNING, WARNING_SIGNED, warningOf, refusalLog, callPath, addresses, keyStore, bearer, newKey, vaultName, cardWords,
  TOLERANCE_S, SEEN_FOR_MS, SIGNED_HEADERS, checkSigned, seenStore, secretVaultName };
