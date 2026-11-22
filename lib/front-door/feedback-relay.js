// @ts-check
// Feedback to the developers (ADR 259): the front door's side of the Feedback relay, a small service of botdot's
// developers that takes a self-hosted machine's reports when its switch is on. The protocol is in docs/api.md,
// "Feedback to the developers". This module holds what is the relay's alone: its address, the install token it
// issued (a file of its own in the front door's data, mode 600), registering, sending one report, the words a report
// is cleaned of before it leaves, and the retries of a report the relay did not take. What a report is, and the
// switch, belong to the store (lib/front-door/store.js).
const fs = require('fs');
const path = require('path');

// The developers' relay. An install may change it (FRONT_DOOR_FEEDBACK_RELAY); the admin page shows it.
const DEFAULT_ADDRESS = 'https://feedback.botdot.app';
const TOKEN = /^[A-Za-z0-9_-]{16,200}$/;
const RELAY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ANSWER_MAX = 64 * 1024;
const SEND_MS = 60_000; // a report may hold 15 MB of screenshots
const REGISTER_MS = 15_000;
// A report the relay did not take waits and is sent again after this long, then twice as long, and so on, up to this.
const RETRY_FIRST_MS = 60_000;
const RETRY_MAX_MS = 6 * 3600_000;

const loopback = (host) => host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);

// The relay's address as an https URL without a trailing slash (a loopback address may be http: the tests' stand-in
// relay), or null when it is none.
function addressOf(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback(u.hostname))) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return u.href.replace(/\/+$/, '');
}

// What the front door says of the account and its bots in a report's text, replaced by neutral words before the text
// leaves the machine: names are matched whole, whatever the case, longest first. A name of one character is left,
// as it would take letters out of every word.
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function neutral(text, { account, bots = [] }) {
  const names = [[account, '[account]'], ...bots.map((b) => [b, '[bot]'])]
    .map(([name, word]) => [typeof name === 'string' ? name.trim() : '', word])
    .filter(([name]) => [...name].length >= 2)
    .sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [name, word] of names) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, 'giu'), word);
  return out;
}

// The milliseconds a report waits after its n-th failure (n from 1).
const backoff = (tries, first = RETRY_FIRST_MS) => Math.min(first * 2 ** Math.max(0, tries - 1), RETRY_MAX_MS);

async function bounded(res) {
  const chunks = [];
  let size = 0;
  for await (const c of res.body || []) {
    size += c.length;
    if (size > ANSWER_MAX) break;
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text); } catch { return null; }
}

// dir: the front door's data. address: the relay's, as given (checked here). fetchImpl: for tests.
// reports: the store's side { due(now), shots(id), sent(id, relayId), failed(id, tries, retryAt), switchOn() }.
// namesOf(account): the account's bots' names asked of its botdot server, or null when it doesn't answer.
// retryFirstMs: how long the first retry waits (shorter in tests). log: where it says what happened.
function create({ dir, address = DEFAULT_ADDRESS, fetchImpl = (/** @type {string} */ url, /** @type {RequestInit} */ init) => fetch(url, init), reports, namesOf, retryFirstMs = RETRY_FIRST_MS, now = () => Date.now(), log = console }) {
  const base = addressOf(address) || DEFAULT_ADDRESS;
  const file = path.join(dir, 'feedback-relay.json');
  let token = null;
  try { const t = JSON.parse(fs.readFileSync(file, 'utf8')).token; if (TOKEN.test(t)) token = t; } catch { /* none yet */ }

  const call = async (method, to, { body, auth = true, timeout }) => {
    const res = await fetchImpl(`${base}${to}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await bounded(res);
    if (res.status < 200 || res.status > 299) throw Object.assign(new Error(`the relay answered ${res.status}`), { status: res.status, data });
    return data;
  };

  // The install token: kept once the relay issued it, and used again when the switch is turned off and on.
  let registering = null;
  function register() {
    if (token) return Promise.resolve(token);
    registering ||= (async () => {
      try {
        const got = (await call('POST', '/v1/install', { body: {}, auth: false, timeout: REGISTER_MS }))?.token;
        if (!TOKEN.test(got)) throw new Error("the relay's answer holds no token");
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ token: got }), { mode: 0o600 });
        fs.renameSync(tmp, file);
        fs.chmodSync(file, 0o600);
        token = got;
        return token;
      } finally { registering = null; }
    })();
    return registering;
  }

  // One report to the relay, once: its relay id. Throws when the relay did not take it (nothing was kept of it).
  async function deliver(report) {
    const bots = await namesOf(report.account);
    if (!bots) throw new Error("the account's botdot server did not say its bots' names");
    await register();
    const shots = (report.screenshots || []).map((_, n) => reports.shots(report.id, n)).filter(Boolean);
    // Exactly these five, and the report's id in the address: the relay takes the same id as one report.
    const body = { kind: report.kind, text: neutral(report.text, { account: report.account, bots }), app: report.app, version: report.version, screenshots: shots.map((s) => ({ type: s.type, data: s.bytes.toString('base64') })) };
    const answer = await call('PUT', `/v1/reports/${report.id}`, { body, timeout: SEND_MS });
    if (!RELAY_ID.test(answer?.id)) throw new Error("the relay's answer holds no report id");
    return answer.id;
  }

  // Sends every report that waits and is due, one at a time; a report the relay did not take waits for its next try.
  // Never two sweeps at once, and a report already sent is never sent again.
  let sweeping = false;
  let again = false;
  async function sweep() {
    if (sweeping) { again = true; return; }
    sweeping = true;
    try {
      do {
        again = false;
        if (!reports.switchOn()) break;
        for (const report of reports.due(now())) {
          if (!reports.switchOn()) break;
          try {
            reports.sent(report.id, await deliver(report));
            log.log(`[front door] a report of ${report.account} reached the developers' relay`);
          } catch (e) {
            const tries = (report.tries || 0) + 1;
            reports.failed(report.id, tries, now() + backoff(tries, retryFirstMs));
            log.error(`[front door] a report of ${report.account} wasn't taken by the developers' relay (try ${tries}): ${e.message}`);
          }
        }
      } while (again);
    } finally { sweeping = false; }
  }

  return { address: base, hasToken: () => !!token, register, sweep };
}

module.exports = { create, addressOf, neutral, backoff, DEFAULT_ADDRESS, RETRY_MAX_MS };
