// @ts-check
// A job tells an address when its run ends (#37, section 1; docs/api.md "Telling an address when a run ends"):
// its `notifyUrl`, which the owner approved on a card. botdot POSTs the end of each run there as JSON, signed with
// HMAC-SHA256 under the job's own secret, which the owner's yes made and keeps in the Vault (given to no bot), so the
// receiver can check that the request is botdot's and recent. A notification never holds a run up: it is sent after
// the run ended, a few seconds at most each try, twice more after a failure, and what failed is kept for the Chief
// (job_call, the checkup).
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { readJson, writeJson } = require('./jsonfile');
const { hostname, privateAddress, internalHost } = require('./network-address');

const URL_MAX = 2000;
const TEXT_MAX = 16 * 1024; // of the run's reply, in a notification
const TIMEOUT_MS = 5000; // each try
const BACKOFF_MS = [1000, 4000]; // before the second and the third try
const SIGNATURE_HEADER = 'X-Botdot-Signature-256';
const TIMESTAMP_HEADER = 'X-Botdot-Timestamp';
const DELIVERY_HEADER = 'X-Botdot-Delivery';

// What a card says of a notify address before the proposer's own sentence: where each run's reply goes.
/** @param {string} url */
const cardWords = (url) => `When a run of this job ends, botdot sends how it ended and its reply to ${url}, signed with a secret kept in the Vault.`;

// A notify address as a proposal may give it, or why not: https, a public host by its name or address, no
// credentials in it. local: the tests' own receiver on 127.0.0.1 over http (BOT_DOT_NOTIFY_LOCAL=1, never in use).
/** @param {unknown} value @param {{ local?: boolean }} [opts] @returns {string} */
function checkUrl(value, { local = false } = {}) {
  const raw = String(value ?? '').trim();
  if (raw.length > URL_MAX) throw new Error(`Keep the notify address under ${URL_MAX} characters.`);
  let u;
  try { u = new URL(raw); } catch { throw new Error(`"${raw.slice(0, 100)}" isn't an address. Give a full one, e.g. https://example.com/hooks/botdot`); }
  const loopback = local && u.protocol === 'http:' && hostname(u.hostname) === '127.0.0.1';
  if (u.protocol !== 'https:' && !loopback) throw new Error('A notify address must start with https://');
  if (u.username || u.password) throw new Error("Don't put a name or password in the notify address: the receiver checks the signature instead.");
  if (u.hash) throw new Error('A notify address has no #part.');
  if (!loopback && internalHost(u.hostname)) throw new Error(`${u.hostname} is a local or private address: botdot tells only public addresses of a run's end.`);
  return u.toString();
}

// The signature of a body sent at `timestamp` (seconds since 1970), as the header carries it: "sha256=<hex>" of
// HMAC-SHA256 under the secret, over "<timestamp>.<body>".
/** @param {string} secret @param {string | number} timestamp @param {string} body */
const sign = (secret, timestamp, body) => `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

// A new secret: 32 random bytes, as text the receiver can keep.
const newSecret = () => crypto.randomBytes(32).toString('base64url');

// What is sent: the job, the bot and the run, how it ended and its reply (or what went wrong), clipped.
/** @param {{ bot: { id: string, name: string }, job: { id: string, name: string }, runId: string | null, status: string, text: string, at?: string }} p */
function payloadOf({ bot, job, runId, status, text, at }) {
  const t = String(text || '');
  return {
    event: 'run.ended',
    bot: { id: bot.id, name: bot.name },
    job: { id: job.id, name: job.name },
    runId: runId || null,
    status,
    text: t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX)}\n…(cut off)` : t,
    at: at || new Date().toISOString(),
  };
}

// The Vault item that holds a job's secret: an API token by the job's name.
/** @type {(botName: string, jobName: string) => string} */
const vaultName = (botName, jobName) => `Notify secret: ${botName} / ${jobName}`.slice(0, 60);

// The secrets of the jobs that notify, beside their Vault items: data/notify-secrets.json, { <botId>: { <jobId>:
// { secret (encrypted with the Vault's key), vaultId, vaultName } } }. Signing needs the secret itself at each run's
// end, and a locked Bitwarden must not stop that, so the copy the server signs with is kept here, encrypted.
/** @param {string} dataDir @param {{ encrypt: (t: string) => object, decrypt: (b: any) => string }} box */
function secretStore(dataDir, box) {
  const FILE = path.join(dataDir, 'notify-secrets.json');
  return {
    /** @param {string} botId @param {string} jobId @returns {string | null} */
    secretOf(botId, jobId) {
      const kept = readJson(FILE, {})[botId]?.[jobId];
      if (!kept?.secret) return null;
      try { return box.decrypt(kept.secret); } catch { return null; }
    },
    /** @param {string} botId @param {string} jobId @returns {{ vaultId: string | null, vaultName: string | null } | null} */
    vaultOf(botId, jobId) {
      const kept = readJson(FILE, {})[botId]?.[jobId];
      return kept ? { vaultId: kept.vaultId || null, vaultName: kept.vaultName || null } : null;
    },
    /** @param {string} botId @param {string} jobId @param {string} secret @param {{ id: string, name: string }} vault */
    set(botId, jobId, secret, vault) {
      const all = readJson(FILE, {});
      all[botId] = { ...all[botId], [jobId]: { secret: box.encrypt(secret), vaultId: vault.id, vaultName: vault.name } };
      writeJson(FILE, all, { mode: 0o600 });
    },
  };
}

// The notifications that failed, oldest first, the last FAILURES_KEPT of each job: data/notify-failures.json,
// { <botId>: { <jobId>: [{ at, runId, why }] } }. `why` is botdot's own sentence; nothing of the reply is kept.
const FAILURES_KEPT = 20;
/** @param {string} dataDir */
function failureLog(dataDir) {
  const FILE = path.join(dataDir, 'notify-failures.json');
  return {
    /** @param {string} botId @param {string} jobId @param {{ runId: string | null, why: string }} f @param {Date} [now] */
    add(botId, jobId, { runId, why }, now = new Date()) {
      const all = readJson(FILE, {});
      const list = [...(all[botId]?.[jobId] || []), { at: now.toISOString(), runId: runId || null, why: String(why).slice(0, 300) }].slice(-FAILURES_KEPT);
      all[botId] = { ...all[botId], [jobId]: list };
      writeJson(FILE, all);
    },
    /** @type {(botId: string, jobId: string) => { at: string, runId: string | null, why: string }[]} */
    of: (botId, jobId) => readJson(FILE, {})[botId]?.[jobId] || [],
  };
}

// One try: resolves { ok, status?, why?, retry }. The host's addresses are checked and pinned for the request, so a
// second lookup cannot point it somewhere private; a redirect is not followed and counts as a failure.
/** @param {string} url @param {Record<string, string>} headers @param {string} body @param {{ timeoutMs: number, lookup: any, local: boolean }} o */
async function tryOnce(url, headers, body, { timeoutMs, lookup, local }) {
  const u = new URL(url);
  const host = hostname(u.hostname);
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true });
  } catch (e) { return { ok: false, why: `${host} has no address (${e.code || e.message}).`, retry: true }; }
  if (!addresses?.length) return { ok: false, why: `${host} has no address.`, retry: true };
  const loopback = local && addresses.every((a) => a.address === '127.0.0.1');
  if (!loopback && addresses.some((a) => privateAddress(a.address))) return { ok: false, why: `${host} points to a private or local address, so botdot did not send it.`, retry: false };
  /** @type {any} */
  const pinned = (_h, options, cb) => cb(null, ...(options?.all ? [addresses] : [addresses[0].address, addresses[0].family]));
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    let done = false;
    const end = (/** @type {any} */ r) => { if (!done) { done = true; resolve(r); } };
    const req = lib.request(u, { method: 'POST', headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) }, timeout: timeoutMs, lookup: pinned, agent: false }, (res) => {
      res.resume(); // what the receiver answers is not read
      const status = res.statusCode || 0;
      if (status >= 200 && status < 300) return end({ ok: true, status });
      if (status >= 300 && status < 400) return end({ ok: false, status, why: `The receiver answered ${status}, a redirect, which botdot does not follow.`, retry: false });
      end({ ok: false, status, why: `The receiver answered ${status}.`, retry: status >= 500 || status === 429 || status === 408 });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (/** @type {any} */ e) => end({ ok: false, why: e.message === 'timeout' ? `The receiver did not answer within ${Math.round(timeoutMs / 1000)} seconds.` : `Couldn't reach the receiver (${e.code || e.message}).`, retry: true }));
    req.end(body);
  });
}

// Sends one notification: tried once, and again after BACKOFF_MS each while it fails in a way that may pass (no
// answer, 5xx, 429). Never throws. Resolves { ok, tries, status?, why? }.
/** @param {{ url: string, secret: string, payload: object }} n @param {{ timeoutMs?: number, backoffMs?: number[], lookup?: any, local?: boolean, now?: () => number, sleep?: (ms: number) => Promise<void> }} [o] */
async function deliver({ url, secret, payload }, { timeoutMs = TIMEOUT_MS, backoffMs = BACKOFF_MS, lookup = dns.promises.lookup, local = false, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const body = JSON.stringify(payload);
  const delivery = crypto.randomUUID(); // the same on each try: a receiver can drop a repeat
  /** @type {any} */
  let last = { ok: false, why: 'Not sent.' };
  for (let i = 0; i <= backoffMs.length; i++) {
    if (i) await sleep(backoffMs[i - 1]);
    const timestamp = String(Math.floor(now() / 1000));
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'botdot', [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: sign(secret, timestamp, body), [DELIVERY_HEADER]: delivery };
    try { last = await tryOnce(url, headers, body, { timeoutMs, lookup, local }); } catch (e) { last = { ok: false, why: `Couldn't send it (${/** @type {Error} */ (e).message}).`, retry: false }; }
    if (last.ok || !last.retry) return { ...last, tries: i + 1 };
  }
  return { ...last, tries: backoffMs.length + 1 };
}

module.exports = { checkUrl, sign, newSecret, payloadOf, vaultName, secretStore, failureLog, deliver, cardWords, SIGNATURE_HEADER, TIMESTAMP_HEADER, DELIVERY_HEADER, TIMEOUT_MS, BACKOFF_MS, FAILURES_KEPT, TEXT_MAX };
