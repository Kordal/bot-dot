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
function callPath(pathname) {
  const m = /^\/api\/bots\/([\w-]+)\/jobs\/([\w-]+)\/call$/.exec(pathname);
  return m ? { botId: m[1], jobId: m[2] } : null;
}

// Where a job's call address is: the front door's own address, as the front door last named it to this botdot
// server (the Host and X-Forwarded-Proto it sends, having checked the Host is its own), kept in
// data/call-address.json for the Chief's tools, which reach botdot on its port. account: this server's (BOT_DOT_ACCOUNT).
function addresses(dataDir, account) {
  const FILE = path.join(dataDir, 'call-address.json');
  let origin = readJson(FILE, {}).origin || null;
  return {
    // A request the front door passed on: its address, when it names one, is kept.
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
    of: (botId, jobId) => (origin && account ? `${origin}/call/${account}/${botId}/${jobId}` : null),
    // The front door's name (the site of a call key's Vault item), or null.
    host: () => (origin ? new URL(origin).hostname : null),
  };
}

// The keys of the jobs that can be called, kept apart from the jobs (a job as the routes hand it out reaches the
// bots, the Chief and the apps): data/call-keys.json, { <botId>: { <jobId>: { hash, vaultId, vaultName } } }, the
// key's SHA-256 only, and the Vault item that holds the key itself. The key is long and random, so a fast hash is
// enough. Read at each call: calls are rare.
function keyStore(dataDir) {
  const FILE = path.join(dataDir, 'call-keys.json');
  const hashOf = (key) => crypto.createHash('sha256').update(String(key)).digest();
  return {
    // Whether `key` is the key of this job, compared in constant time. A job with no key takes no call.
    matches(botId, jobId, key) {
      const stored = readJson(FILE, {})[botId]?.[jobId]?.hash;
      if (typeof stored !== 'string' || !/^[0-9a-f]{64}$/.test(stored) || !key) return false;
      return crypto.timingSafeEqual(Buffer.from(stored, 'hex'), hashOf(key));
    },
    // Where the job's key is kept: { vaultId, vaultName }, or null for a job that never had one. Never the hash.
    vaultOf(botId, jobId) {
      const kept = readJson(FILE, {})[botId]?.[jobId];
      return kept ? { vaultId: kept.vaultId || null, vaultName: kept.vaultName || null } : null;
    },
    // A new key for the job, whose Vault item is { id, name }: the old one stops at once.
    set(botId, jobId, key, vault) {
      const all = readJson(FILE, {});
      all[botId] = { ...all[botId], [jobId]: { hash: hashOf(key).toString('hex'), vaultId: vault.id, vaultName: vault.name } };
      writeJson(FILE, all, { mode: 0o600 });
    },
  };
}

// The calls to a job that were refused, oldest first: the last REFUSALS_KEPT with a wrong key and the last
// REFUSALS_KEPT of every other kind, so that requests without a key cannot push the wrong keys out before the
// checkup reads them:
// data/call-refusals.json, { <botId>: { <jobId>: [{ at, why, device }] } }. `why` is one of WHY; `device`
// the address the call came from, as the front door saw it (X-Forwarded-For). Nothing a call sent is kept: not its
// key, not its body.
const REFUSALS_KEPT = 20;
const WHY = ['no key', 'wrong key', 'refused origin', 'not a POST', 'too large', 'calls off', 'bypassPermissions', 'waits for approval', 'switched off', 'paused', 'still running', 'too many waiting'];
const short = (v) => String(v || '').replace(/[^\w.:@+-]/g, '').slice(0, 100);
function refusalLog(dataDir) {
  const FILE = path.join(dataDir, 'call-refusals.json');
  return {
    add(botId, jobId, why, headers, now = new Date()) {
      if (!WHY.includes(why)) throw new TypeError(`No refusal is "${why}"`);
      const all = readJson(FILE, {});
      const entry = { at: now.toISOString(), why, device: short(String(headers['x-forwarded-for'] || '').split(',')[0].trim()) || null };
      const list = [...(all[botId]?.[jobId] || []), entry];
      const wrong = list.filter((c) => c.why === 'wrong key').slice(-REFUSALS_KEPT);
      const other = list.filter((c) => c.why !== 'wrong key').slice(-REFUSALS_KEPT);
      all[botId] = { ...all[botId], [jobId]: list.filter((c) => wrong.includes(c) || other.includes(c)) };
      writeJson(FILE, all);
    },
    // A job's refused calls, oldest first.
    of: (botId, jobId) => readJson(FILE, {})[botId]?.[jobId] || [],
  };
}

// A new key: 32 random bytes, as text a sender can put in a header.
const newKey = () => crypto.randomBytes(32).toString('base64url');

// The Vault item that holds a job's key: an API token by the job's name.
const vaultName = (botName, jobName) => `Call key: ${botName} / ${jobName}`.slice(0, 60);

// What the owner reads on the card of a proposed call, before the Chief's own sentence: the warning, and what the
// bot can do in short. appName: a connected app's name by its slug.
const WARNING = 'Anything that can reach this machine and has the key can run this job now and send it text.';
function cardWords(bot, appName = (app) => app) {
  // The permissions of "What it may do", in their own words (lib/asks.js): "browse the web", "run commands".
  const held = new Set((bot.allowedTools || []).map((t) => TOOL_PERMISSION[String(t).replace(/\(.*$/, '')]).filter(Boolean));
  const can = [
    ...Object.keys(PERMISSIONS).filter((p) => held.has(p)).map((p) => PERMISSIONS[p].label),
    ...(bot.computer === 'linux' ? [bot.computerEgress === 'lan' ? 'use its own computer on your home network' : 'use its own computer'] : []),
    ...(bot.connectors || []).map((app) => `use ${appName(app)}`),
  ];
  const list = can.length > 1 ? `${can.slice(0, -1).join(', ')} and ${can.at(-1)}` : can[0];
  return `${WARNING} ${list ? `${bot.name} can ${list}.` : `${bot.name} has no tools beyond reading its folder.`}`;
}

// The key a call carries: Authorization: Bearer <key>. A key anywhere else (the address) is not read.
function bearer(headers) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(headers.authorization || ''));
  return m ? m[1] : null;
}

module.exports = { BODY_MAX, REFUSALS_KEPT, WARNING, refusalLog, callPath, addresses, keyStore, bearer, newKey, vaultName, cardWords };
